// IMPORTANT: keep this file encoded as UTF-8.
// Centralized Arabic labels to avoid encoding regressions on Windows builds.

const utf8 = (value: string): string => Buffer.from(value, 'utf8').toString('utf8');

export const ACCOUNTING_LABELS = {
  SALE_INVOICE: utf8('فاتورة مبيعات'),
  PURCHASE_INVOICE: utf8('فاتورة مشتريات'),
  SALE_RETURN: utf8('مردودات مبيعات'),
  PURCHASE_RETURN: utf8('مردودات مشتريات'),
  SALES_REVENUE: utf8('إيرادات المبيعات'),
  INVENTORY: utf8('المخزون'),
  RECEIVABLES: utf8('ذمم مدينة'),
  PAYABLES: utf8('ذمم دائنة'),
  SALES_DISCOUNT: utf8('خصم مسموح به'),
  PURCHASE_DISCOUNT: utf8('خصم مكتسب'),

  RECEIPT_VOUCHER: utf8('سند قبض'),
  PAYMENT_VOUCHER: utf8('سند دفع'),
  CASH_RECEIVED: utf8('نقدية مقبوضة'),
  CASH_PAID: utf8('نقدية مدفوعة'),

  STOCK_ADJUSTMENT: utf8('تسوية جرد'),
  STOCK_SHORTAGE: utf8('عجز جرد'),
  STOCK_SURPLUS: utf8('فائض جرد'),
  OPENING_STOCK: utf8('مخزون افتتاحي'),
  OPENING_BALANCE: utf8('رصيد افتتاحي'),

  MANUFACTURING_ORDER: utf8('أمر تصنيع'),
  RAW_MATERIALS: utf8('مواد خام مستهلكة'),
  DIRECT_LABOR: utf8('أجور تصنيع مباشرة'),
  PRODUCTION_OUTPUT: utf8('إنتاج'),

  SALARY_ACCRUAL: utf8('إثبات استحقاق رواتب'),
  SALARY_PAYABLE: utf8('رواتب مستحقة غير مدفوعة'),
  SALARY_SETTLEMENT: utf8('تسوية رواتب مستحقة'),
  SALARY_PAYMENT: utf8('صرف راتب'),
  SALARY_EXPENSE: utf8('رواتب وأجور'),
  NET_SALARY_PAID: utf8('صافي راتب مدفوع'),
  TAX_DEDUCTION: utf8('استقطاعات ضريبية'),
  TAX_RECLASS: utf8('تخفيض صافي الراتب مقابل الضرائب'),
  INSURANCE_DEDUCTION: utf8('تأمينات اجتماعية مستحقة'),
  INSURANCE_RECLASS: utf8('تخفيض صافي الراتب مقابل التأمينات'),
  ADVANCE_RECOVERY: utf8('استرداد سلفة من الراتب'),
  ADVANCE_RECLASS: utf8('تخفيض صافي الراتب مقابل السلفة'),
  PENDING_SALARY: utf8('رواتب مستحقة غير مدفوعة'),
  PENDING_RECLASS: utf8('تخفيض صافي الراتب للأجزاء المعلقة'),

  NUMBER: utf8('رقم'),
  MONTHLY_PAYROLL: utf8('صرف رواتب')
} as const;

export const buildDescription = (...parts: Array<string | number | null | undefined>) =>
  parts.filter((part) => part !== null && part !== undefined && String(part).trim() !== '').join(' ');

