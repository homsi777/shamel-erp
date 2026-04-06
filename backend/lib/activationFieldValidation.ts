/**
 * Shared validation for activation identity fields (UTF-8 / Arabic safe).
 * Returns Arabic error message or null if valid.
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

export function validateActivatorName(raw: unknown): string | null {
  return validateIdentityName(raw, 'اسم الشخص المسؤول عن التفعيل');
}

export function validateOptionalActivatorName(raw: unknown): string | null {
  const v = trimActivationField(raw);
  if (!v) return null;
  return validateActivatorName(v);
}

export function validateBusinessDomain(raw: unknown): string | null {
  const v = trimActivationField(raw);
  if (!v) return 'يرجى إدخال مجال العمل أو نوع النشاط (مثل: تجارة عامة، مطعم، مستودع).';
  if (v.length < 2) return 'وصف مجال العمل قصير جداً (حرفان على الأقل).';
  if (v.length > 200) return 'وصف مجال العمل طويل جداً (الحد 200 حرف).';
  if (PLACEHOLDER_RE.test(v)) return 'يرجى إدخال مجال عمل حقيقي وليس قيمة وهمية.';
  return null;
}

export function validateOptionalBusinessDomain(raw: unknown): string | null {
  const v = trimActivationField(raw);
  if (!v) return null;
  return validateBusinessDomain(v);
}

export function validateActivationCodeForNotify(code: unknown, expectedType: string): string | null {
  const c = trimActivationField(code).toUpperCase();
  if (!c) return 'الرمز مطلوب.';
  if (c.length > 64) return 'الرمز غير صالح.';
  const recognition = recognizeLicenseMissionFromCode(c);
  if (!recognition) return 'تعذر التعرف على مهمة الترخيص من الرمز.';
  const t = String(expectedType || '').toLowerCase();
  if (t && recognition.legacyActivationType !== t && !(t === 'branch' && recognition.mission === 'LOCAL_NETWORK_TERMINAL')) {
    return 'نوع التفعيل لا يطابق الرمز.';
  }
  return null;
}
import { recognizeLicenseMissionFromCode } from '../../src/lib/licenseMission';
