/**
 * Client-side validation mirrors backend `activationFieldValidation` (Arabic / UTF-8 safe).
 */

const PLACEHOLDER_RE = /^(test|xxx|null|n\/a|na|none|undefined|غير\s*محدد|لا\s*يوجد|\.+|-+)$/i;

export function trimActivationField(s: unknown): string {
  return String(s ?? '').replace(/\u200c|\u200f/g, '').trim();
}

function validateIdentityName(raw: unknown, label: string, maxLength = 120): string | null {
  const v = trimActivationField(raw);
  if (!v) return `يرجى إدخال ${label}.`;
  if (v.length < 2) return `${label} قصير جداً (حرفان على الأقل).`;
  if (v.length > maxLength) return `${label} طويل جداً (الحد ${maxLength} حرفاً).`;
  if (PLACEHOLDER_RE.test(v)) return `يرجى إدخال ${label} الحقيقي وليس قيمة وهمية.`;
  return null;
}

export function validateCustomerName(raw: unknown): string | null {
  return validateIdentityName(raw, 'اسم العميل');
}

export function validateOrganizationName(raw: unknown): string | null {
  return validateIdentityName(raw, 'اسم المنشأة');
}

export function validateActivatorName(raw: unknown): string | null {
  return validateIdentityName(raw, 'اسم الشخص المسؤول عن التفعيل');
}

export function validateBusinessDomain(raw: unknown): string | null {
  const v = trimActivationField(raw);
  if (!v) return 'يرجى إدخال مجال العمل أو نوع النشاط (مثل: تجارة عامة، مطعم، مستودع).';
  if (v.length < 2) return 'وصف مجال العمل قصير جداً (حرفان على الأقل).';
  if (v.length > 200) return 'وصف مجال العمل طويل جداً (الحد 200 حرف).';
  if (PLACEHOLDER_RE.test(v)) return 'يرجى إدخال مجال عمل حقيقي وليس قيمة وهمية.';
  return null;
}

export function validateActivationIdentityFields(fields: {
  customerName?: string;
  orgName: string;
  activatorName: string;
  businessDomain: string;
}): string | null {
  return (
    validateCustomerName(fields.customerName || fields.orgName) ||
    validateOrganizationName(fields.orgName) ||
    validateActivatorName(fields.activatorName) ||
    validateBusinessDomain(fields.businessDomain)
  );
}
