/**
 * ERP hardening: invoice validations (commission, pricing, edge cases).
 * Commission: percentage only; if commissionPercent > 0 then manual price override not allowed.
 */

const SUPPORTED_CURRENCIES = new Set(['USD', 'SYP', 'TRY']);

/** When true, enforce all validations and reject unsafe data (negative qty, zero qty, missing unit, invalid currency). */
export const ERP_STRICT_MODE = process.env.ERP_STRICT_MODE === 'true' || process.env.ERP_STRICT_MODE === '1';

export function validateInvoiceEdgeCases(
  items: any[],
  currency: string,
  strictMode?: boolean
): { ok: boolean; error?: string; warning?: string } {
  const strict = strictMode ?? ERP_STRICT_MODE;
  for (let i = 0; i < items.length; i++) {
    const line = items[i];
    const qty = Number(line.baseQuantity ?? line.quantity ?? 0);
    const unitPrice = Number(line.unitPrice ?? line.unitPriceTransaction ?? 0);
    const unitName = line.unitName ?? line.unit_id;

    if (qty < 0) {
      if (ERP_STRICT_MODE) console.warn('[ERP strict] Rejecting: negative quantity', { row: i + 1, line: line.itemName || line.itemId });
      return { ok: false, error: `الكمية لا يمكن أن تكون سالبة (سطر ${i + 1}: ${line.itemName || line.itemId}).` };
    }
    if (strict && qty === 0) {
      if (ERP_STRICT_MODE) console.warn('[ERP strict] Rejecting: zero quantity', { row: i + 1 });
      return { ok: false, error: `الكمية يجب أن تكون أكبر من صفر (سطر ${i + 1}).` };
    }
    if (strict && !unitName) {
      if (ERP_STRICT_MODE) console.warn('[ERP strict] Rejecting: missing unit', { row: i + 1, line: line.itemName || line.itemId });
      return { ok: false, error: `الوحدة مطلوبة (سطر ${i + 1}: ${line.itemName || line.itemId}).` };
    }
    if (unitPrice < 0) {
      if (ERP_STRICT_MODE) console.warn('[ERP strict] Rejecting: negative unit price', { row: i + 1 });
      return { ok: false, error: `سعر الوحدة لا يمكن أن يكون سالباً (سطر ${i + 1}).` };
    }
  }
  const currencyNorm = String(currency || '').trim().toUpperCase();
  if (strict && currencyNorm && !SUPPORTED_CURRENCIES.has(currencyNorm)) {
    if (ERP_STRICT_MODE) console.warn('[ERP strict] Rejecting: invalid currency', { currency });
    return { ok: false, error: `عملة غير مدعومة: ${currency}.` };
  }
  return { ok: true };
}

/**
 * Final data integrity: itemId exists, quantity > 0, price >= 0.
 * Optionally check item exists in DB when checkItemExists is provided.
 */
export function validateInvoiceDataIntegrity(
  items: any[],
  checkItemExists?: (itemId: string) => boolean
): { ok: boolean; error?: string } {
  for (let i = 0; i < items.length; i++) {
    const line = items[i];
    const itemId = String(line.itemId ?? '').trim();
    const qty = Number(line.baseQuantity ?? line.quantity ?? 0);
    const price = Number(line.unitPrice ?? line.unitPriceTransaction ?? 0);

    if (!itemId) {
      return { ok: false, error: `معرف المادة مطلوب (سطر ${i + 1}).` };
    }
    if (checkItemExists && !checkItemExists(itemId)) {
      return { ok: false, error: `المادة غير موجودة (سطر ${i + 1}: ${itemId}).` };
    }
    if (qty <= 0) {
      return { ok: false, error: `الكمية يجب أن تكون أكبر من صفر (سطر ${i + 1}).` };
    }
    if (price < 0) {
      return { ok: false, error: `السعر لا يمكن أن يكون سالباً (سطر ${i + 1}).` };
    }
  }
  return { ok: true };
}

/**
 * Commission rule: commission is percentage only.
 * If commissionPercent > 0 then manual price override is not allowed (accounting rule).
 */
export function validateCommissionRule(line: any): { ok: boolean; error?: string } {
  const commissionPercent = Number(line.commissionPercent ?? line.commission_percent ?? 0);
  const isManualOverride = line.isManualPriceOverride === true || line.isManualPriceOverride === 1;
  if (commissionPercent > 0 && isManualOverride) {
    if (ERP_STRICT_MODE) console.warn('[ERP strict] Rejecting: commission and manual price together');
    return { ok: false, error: 'لا يمكن استخدام العمولة النسبية مع تعديل السعر يدوياً في نفس السطر.' };
  }
  if (commissionPercent < 0 || (ERP_STRICT_MODE && commissionPercent > 100)) {
    if (ERP_STRICT_MODE) console.warn('[ERP strict] Rejecting: commission percent out of range 0-100', { commissionPercent });
    return { ok: false, error: 'نسبة العمولة يجب أن تكون بين 0 و 100.' };
  }
  return { ok: true };
}

/**
 * Compute commission amount on backend: quantity * unitPrice * commissionPercent / 100.
 * Client-sent commissionAmount must be ignored.
 */
export function computeLineCommission(line: any): number {
  const commissionPercent = Number(line.commissionPercent ?? line.commission_percent ?? 0);
  if (!(commissionPercent > 0)) return 0;
  const qty = Number(line.baseQuantity ?? line.quantity ?? 0);
  const unitPrice = Number(line.unitPrice ?? line.unitPriceTransaction ?? 0);
  return Math.round((qty * unitPrice * commissionPercent / 100) * 100) / 100;
}
