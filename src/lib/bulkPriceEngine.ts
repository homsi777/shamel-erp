import type {
  BulkPriceOperation,
  BulkPriceUpdatePayload,
  InventoryItem,
  PriceFieldKey,
  PriceUpdatePreviewResult,
  PriceUpdatePreviewRow,
} from '../types';

export type CurrencyRatesMap = Record<string, number>;

export const BULK_PRICE_FIELD_MAP: Record<PriceFieldKey, { key: keyof InventoryItem; baseKey?: string }> = {
  sale_price: { key: 'salePrice', baseKey: 'salePriceBase' },
  purchase_price: { key: 'costPrice', baseKey: 'costPriceBase' },
  wholesale_price: { key: 'wholesalePrice', baseKey: 'wholesalePriceBase' },
  pos_price: { key: 'posPrice', baseKey: 'posPriceBase' },
};

export const roundPrice = (value: number) => Math.round((Number(value) || 0) * 100) / 100;

export const getNumeric = (value: unknown) => {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
};

export const getFieldValue = (item: InventoryItem, field: PriceFieldKey) => {
  const map = BULK_PRICE_FIELD_MAP[field];
  return getNumeric(item[map.key]);
};

export const getBaseValue = (item: InventoryItem, field: PriceFieldKey) => {
  const map = BULK_PRICE_FIELD_MAP[field];
  if (map.baseKey && map.baseKey in (item as any)) {
    return getNumeric((item as any)[map.baseKey]);
  }
  return getFieldValue(item, field);
};

export const inferSystemCurrency = (currencyRates: CurrencyRatesMap) => {
  const match = Object.entries(currencyRates || {}).find(([, rate]) => getNumeric(rate) === 1);
  return String(match?.[0] || 'USD').toUpperCase();
};

export const convertFixedAmountToItemCurrency = (
  amount: number,
  amountMode: BulkPriceUpdatePayload['amountMode'],
  itemCurrency: string,
  currencyRates: CurrencyRatesMap,
) => {
  const targetCurrency = String(itemCurrency || 'USD').toUpperCase();
  const normalizedMode = amountMode || 'item_currency';
  if (normalizedMode === 'item_currency') return amount;
  if (normalizedMode === 'usd') {
    if (targetCurrency === 'USD') return amount;
    const targetRate = getNumeric(currencyRates[targetCurrency]);
    return targetRate > 0 ? amount * targetRate : amount;
  }
  if (normalizedMode === 'syp') {
    if (targetCurrency === 'SYP') return amount;
    const sypRate = getNumeric(currencyRates.SYP);
    const targetRate = targetCurrency === 'USD' ? 1 : getNumeric(currencyRates[targetCurrency]);
    if (sypRate <= 0) return amount;
    const usdAmount = amount / sypRate;
    return targetCurrency === 'USD' ? usdAmount : usdAmount * (targetRate > 0 ? targetRate : 1);
  }
  return amount;
};

export const matchesBulkPriceScope = (item: InventoryItem, payload: BulkPriceUpdatePayload) => {
  if (item.inactive || item.merged) return false;
  const scope = payload.scope;
  if (scope === 'all') return true;
  if (scope === 'single' || scope === 'selected') {
    return (payload.itemIds || []).includes(String(item.id));
  }
  if (scope === 'category') {
    return String(item.categoryId || '') === String(payload.categoryId || '');
  }
  if (scope === 'unit') {
    return String(item.unitId || '') === String(payload.unitId || '');
  }
  if (scope === 'group') {
    return String((item as any).groupId || '') === String(payload.groupId || '');
  }
  return false;
};

export const computeBulkPriceNextValue = (
  item: InventoryItem,
  payload: BulkPriceUpdatePayload,
  currencyRates: CurrencyRatesMap,
) => {
  const currentValue = getFieldValue(item, payload.targetField);
  const itemCurrency = String(item.priceCurrency || 'USD').toUpperCase();

  switch (payload.operation as BulkPriceOperation) {
    case 'add_fixed': {
      const delta = convertFixedAmountToItemCurrency(
        getNumeric(payload.amount),
        payload.amountMode,
        itemCurrency,
        currencyRates,
      );
      return roundPrice(currentValue + delta);
    }
    case 'add_percentage': {
      const percentage = getNumeric(payload.percentage);
      return roundPrice(currentValue * (1 + (percentage / 100)));
    }
    case 'set_profit_margin': {
      const marginPercent = getNumeric(payload.marginPercent);
      const sourceField = payload.sourceField || 'purchase_price';
      const sourceValue = getFieldValue(item, sourceField);
      return roundPrice(sourceValue * (1 + (marginPercent / 100)));
    }
    case 'adjust_exchange_rate': {
      const systemCurrency = inferSystemCurrency(currencyRates);
      if (payload.useDailyExchangeRate && itemCurrency === systemCurrency) return currentValue;
      const exchangeRate = payload.useDailyExchangeRate
        ? (itemCurrency === 'USD' ? 1 : getNumeric(currencyRates[itemCurrency]))
        : getNumeric(payload.exchangeRate);
      const baseValue = getBaseValue(item, payload.targetField);
      if (exchangeRate <= 0) return currentValue;
      if (itemCurrency === systemCurrency) return currentValue;
      return roundPrice(baseValue * exchangeRate);
    }
    case 'copy_from_other_price': {
      const sourceField = payload.sourceField || 'sale_price';
      return roundPrice(getFieldValue(item, sourceField));
    }
    default:
      return roundPrice(currentValue);
  }
};

export const buildBulkPricePreview = (
  items: InventoryItem[],
  payload: BulkPriceUpdatePayload,
  currencyRates: CurrencyRatesMap = { USD: 1 },
): PriceUpdatePreviewResult => {
  const rows: PriceUpdatePreviewRow[] = [];
  const skippedIds: string[] = [];

  for (const item of items) {
    if (!matchesBulkPriceScope(item, payload)) continue;
    const oldValue = getFieldValue(item, payload.targetField);
    const newValue = computeBulkPriceNextValue(item, payload, currencyRates);

    if (!Number.isFinite(newValue) || newValue < 0) {
      skippedIds.push(String(item.id));
      continue;
    }

    if (roundPrice(oldValue) === roundPrice(newValue)) {
      skippedIds.push(String(item.id));
      continue;
    }

    rows.push({
      itemId: String(item.id),
      itemName: item.name,
      itemCode: item.code,
      priceCurrency: String(item.priceCurrency || 'USD').toUpperCase(),
      targetField: payload.targetField,
      oldValue: roundPrice(oldValue),
      newValue,
      delta: roundPrice(newValue - oldValue),
      differencePercent: oldValue === 0 ? 100 : roundPrice((Math.abs(newValue - oldValue) / Math.abs(oldValue)) * 100),
      hasLargeDifference: oldValue !== newValue && (oldValue === 0 ? true : ((Math.abs(newValue - oldValue) / Math.abs(oldValue)) * 100) > 30),
    });
  }

  return {
    affectedCount: rows.length,
    rows,
    skippedIds,
  };
};
