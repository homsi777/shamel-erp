/**
 * Pricing Resolution Service
 * Priority: 1) customer-item special price  2) last sold price  3) customer pricing mode  4) item default sale price  5) manual
 */
import { eq, and, desc } from 'drizzle-orm';
import * as schema from './db/schema';

export type PricingMode = 'retail' | 'wholesale' | 'wholesale2' | 'distribution' | 'delegate' | 'pos' | 'custom';

export interface PriceResolution {
  unitPrice: number;
  source: string;          // Arabic label for display
  sourceKey: string;       // machine key
  mode: PricingMode;
  lastPurchasePrice?: number;
  availableQty?: number;
}

const PRICING_MODE_LABELS: Record<string, string> = {
  'customer_special': 'سعر خاص للعميل',
  'last_sold':        'آخر سعر بيع',
  'retail':           'سعر المفرق',
  'wholesale':        'سعر الجملة',
  'wholesale2':       'سعر جملة الجملة',
  'distribution':     'سعر التوزيع',
  'delegate':         'سعر المندوب',
  'pos':              'سعر نقطة البيع',
  'default':          'سعر البيع الافتراضي',
  'manual':           'سعر يدوي',
};

function itemPriceByMode(item: any, mode: PricingMode): number {
  switch (mode) {
    case 'retail':       return Number(item.salePrice || item.salePriceBase || 0);
    case 'wholesale':    return Number(item.wholesalePrice || item.wholesalePriceBase || 0);
    case 'wholesale2':   return Number(item.wholesaleWholesalePrice || item.wholesaleWholesalePriceBase || 0);
    case 'distribution': return Number(item.distributionPrice || item.distributionPriceBase || 0);
    case 'delegate':     return Number(item.delegatePrice || item.delegatePriceBase || 0);
    case 'pos':          return Number(item.posPrice || item.posPriceBase || 0);
    default:             return Number(item.salePrice || 0);
  }
}

export type ResolvePriceOptions = {
  /** When false, skip customer-item special pricing (from settings). */
  enableCustomerSpecificPrices?: boolean;
  /** When false, skip last-sold price recall (from settings). */
  enableLastSoldPriceRecall?: boolean;
};

export function resolvePrice(
  db: any,
  itemId: string,
  customerId: string | null,
  unitId?: string,
  qty?: number,
  options?: ResolvePriceOptions,
): PriceResolution {
  const item = db.select().from(schema.items).where(eq(schema.items.id, itemId)).get();
  if (!item) return { unitPrice: 0, source: 'مادة غير موجودة', sourceKey: 'not_found', mode: 'retail' };

  const lastPurchasePrice = Number(item.lastPurchasePriceTransaction || item.costPrice || 0);
  const availableQty = Number(item.quantity || 0);

  let party: any = null;
  if (customerId) {
    party = db.select().from(schema.parties).where(eq(schema.parties.id, customerId)).get();
  }

  const allowCustomerSpecial = options?.enableCustomerSpecificPrices !== false && party?.allowCustomerItemSpecialPrices !== false;
  const allowLastPrice = options?.enableLastSoldPriceRecall !== false && party?.allowLastPriceOverride !== false;

  // 1) Customer-item special price
  if (customerId && allowCustomerSpecial) {
    const specialRows = db.select().from(schema.customerItemPrices)
      .where(and(
        eq(schema.customerItemPrices.customerId, customerId),
        eq(schema.customerItemPrices.itemId, itemId),
        eq(schema.customerItemPrices.isActive, true),
      ))
      .all();

    if (specialRows.length > 0) {
      let best = specialRows[0];
      if (unitId) {
        const unitMatch = specialRows.find((r: any) => r.unitId === unitId);
        if (unitMatch) best = unitMatch;
      }
      if (qty && best.minQty && qty >= best.minQty) {
        return {
          unitPrice: Number(best.price),
          source: PRICING_MODE_LABELS['customer_special'],
          sourceKey: 'customer_special',
          mode: (party?.defaultPricingMode || 'retail') as PricingMode,
          lastPurchasePrice,
          availableQty,
        };
      }
      if (!best.minQty) {
        return {
          unitPrice: Number(best.price),
          source: PRICING_MODE_LABELS['customer_special'],
          sourceKey: 'customer_special',
          mode: (party?.defaultPricingMode || 'retail') as PricingMode,
          lastPurchasePrice,
          availableQty,
        };
      }
    }
  }

  // 2) Last sold price (if enabled on customer and settings)
  if (customerId && allowLastPrice) {
    try {
      const invoices = db.select().from(schema.invoices)
        .where(and(
          eq(schema.invoices.clientId, customerId),
          eq(schema.invoices.type, 'sale'),
        ))
        .orderBy(desc(schema.invoices.createdAt))
        .limit(20)
        .all();

      for (const inv of invoices) {
        try {
          const items = JSON.parse(inv.items || '[]');
          const match = items.find((li: any) => li.itemId === itemId);
          if (match && Number(match.unitPrice) > 0) {
            return {
              unitPrice: Number(match.unitPrice),
              source: PRICING_MODE_LABELS['last_sold'],
              sourceKey: 'last_sold',
              mode: (party?.defaultPricingMode || 'retail') as PricingMode,
              lastPurchasePrice,
              availableQty,
            };
          }
        } catch { /* skip malformed */ }
      }
    } catch { /* no invoices table yet? */ }
  }

  // 3) Customer default pricing mode
  if (party?.defaultPricingMode && party.defaultPricingMode !== 'retail') {
    const modePrice = itemPriceByMode(item, party.defaultPricingMode as PricingMode);
    if (modePrice > 0) {
      return {
        unitPrice: modePrice,
        source: PRICING_MODE_LABELS[party.defaultPricingMode] || party.defaultPricingMode,
        sourceKey: party.defaultPricingMode,
        mode: party.defaultPricingMode as PricingMode,
        lastPurchasePrice,
        availableQty,
      };
    }
  }

  // 4) Item default sale price
  const defaultPrice = Number(item.salePrice || item.salePriceBase || 0);
  return {
    unitPrice: defaultPrice,
    source: PRICING_MODE_LABELS['retail'],
    sourceKey: 'retail',
    mode: 'retail',
    lastPurchasePrice,
    availableQty,
  };
}

export function getSourceLabel(key: string): string {
  return PRICING_MODE_LABELS[key] || key;
}
