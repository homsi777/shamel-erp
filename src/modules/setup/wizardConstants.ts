import type { Currency, ProjectProfileId, UserRole } from '../../types';
import { DEFAULT_ROLE_PERMISSIONS } from '../../types';
import { getProjectProfileDefinition, getProjectProfileLabel, PROJECT_PROFILES } from '../../lib/projectProfiles';
import type {
  SetupWizardData,
  WizardActivationChoice,
  WizardStepDefinition,
} from './wizardTypes';

export const WIZARD_STEPS: WizardStepDefinition[] = [
  {
    id: 'activation',
    label: 'التفعيل',
    title: 'تفعيل النظام',
    description: 'رمز التفعيل وبيانات الجهة المسؤولة قبل متابعة الإعداد.',
  },
  {
    id: 'profile',
    label: 'الملف',
    title: 'ملف المشروع',
    description: 'يحدد الأقسام الظاهرة والتركيز التشغيلي بعد الإطلاق.',
  },
  {
    id: 'company',
    label: 'المؤسسة',
    title: 'بيانات المؤسسة',
    description: 'الاسم مع الفرع والمستودع والصندوق الافتراضيين.',
  },
  {
    id: 'user',
    label: 'المستخدم',
    title: 'المستخدم الأول',
    description: 'حساب الدخول الأول وصلاحية البداية.',
  },
  {
    id: 'reminders',
    label: 'لاحقاً',
    title: 'تذكيرات ما بعد الإطلاق',
    description: 'تذكيرات اختيارية فقط؛ لا تُنشئ بيانات الآن.',
  },
  {
    id: 'printers',
    label: 'الطباعة',
    title: 'الطابعات',
    description: 'حرارية، A4، أو شبكة — يمكن ترك الحقول فارغة.',
  },
  {
    id: 'currency',
    label: 'العملات',
    title: 'العملات',
    description: 'عملة أساسية وثانوية اختيارية مع سعر صرف.',
  },
  {
    id: 'review',
    label: 'المراجعة',
    title: 'المراجعة والإنهاء',
    description: 'تأكيد البيانات ونمط التشغيل ثم إكمال الإعداد.',
  },
];

export const ACTIVATION_OPTIONS: Array<{ id: WizardActivationChoice; label: string; hint: string; accent: string }> = [
  { id: 'local', label: 'محلي', hint: 'ALM-XXXX', accent: 'from-emerald-500 to-teal-500' },
  { id: 'cloud', label: 'سحابي', hint: 'CLD-XXXX', accent: 'from-sky-500 to-blue-500' },
  { id: 'trial', label: 'تجريبي', hint: 'TEST-XXXX', accent: 'from-amber-400 to-orange-500' },
];

export const PROJECT_PROFILE_OPTIONS = PROJECT_PROFILES.map((profile) => ({
  id: profile.id,
  label: profile.label,
  arabicMeaning: profile.arabicMeaning,
  description: profile.description,
  focusLabel: profile.focusLabel,
  includes: profile.includes,
  hiddenByDefault: profile.hiddenByDefault,
}));

export const ROLE_OPTIONS: Array<{ id: UserRole; label: string; description: string }> = [
  { id: 'admin', label: 'مدير النظام', description: 'صلاحيات كاملة على جميع الأقسام.' },
  { id: 'manager', label: 'مدير', description: 'إدارة يومية مع صلاحيات تشغيل واسعة.' },
  { id: 'accountant', label: 'محاسب', description: 'وصول مالي وتقارير ومتابعة حسابات.' },
  { id: 'cashier', label: 'كاشير', description: 'تركيز على نقطة البيع والفواتير.' },
  { id: 'warehouse_keeper', label: 'أمين مستودع', description: 'إدارة المواد والمخزون والجرد.' },
  { id: 'textile_warehouse_keeper', label: 'أمين مستودع الأقمشة', description: 'وصول تشغيلي محدود إلى سندات تجهيز الأقمشة فقط.' },
];

export const CURRENCY_OPTIONS: Currency[] = ['USD', 'SYP', 'TRY'];

const USD_REFERENCE_RATES: Record<Currency, number> = { USD: 1, SYP: 15000, TRY: 32 };

export const getRelativeCurrencyRate = (primary: Currency, secondary: Currency) => {
  return Number((USD_REFERENCE_RATES[secondary] / USD_REFERENCE_RATES[primary]).toFixed(6));
};

export const getActivationLabel = (activationType?: string | null) => {
  switch (activationType) {
    case 'local':
      return 'محلي';
    case 'cloud':
      return 'سحابي';
    case 'branch':
      return 'فرعي';
    case 'trial':
      return 'تجريبي';
    default:
      return 'غير محدد';
  }
};

export const getProjectProfileLabelForWizard = (projectProfileId: ProjectProfileId | '') => {
  return projectProfileId ? getProjectProfileLabel(projectProfileId) : 'غير محدد';
};

export const getProjectProfileDefinitionForWizard = (projectProfileId: ProjectProfileId | '') => {
  return projectProfileId ? getProjectProfileDefinition(projectProfileId) : null;
};

export const getUserRoleLabel = (role: UserRole) => {
  return ROLE_OPTIONS.find((option) => option.id === role)?.label || 'مدير النظام';
};

export const getRolePermissions = (role: UserRole) => {
  return DEFAULT_ROLE_PERMISSIONS[role] || DEFAULT_ROLE_PERMISSIONS.admin;
};

export const getOptionalDataSummary = (data: SetupWizardData) => {
  const labels: string[] = [];
  if (data.addOpeningBalances) labels.push('تذكير بالأرصدة الافتتاحية');
  if (data.addOpeningStock) labels.push('تذكير بالمخزون الافتتاحي');
  const focus = getProjectProfileDefinition((data.projectProfileId || undefined) as ProjectProfileId | undefined).importantSubsections[0];
  if (focus) labels.push(`تركيز لاحق: ${focus}`);
  return labels.length > 0 ? labels.join(' + ') : 'بدون مهام لاحقة محددة';
};

export const WIZARD_FIELD_STYLES = {
  label: 'setup-label',
  input: 'setup-input',
  select: 'setup-select',
  softCard: 'setup-stack-block',
  mutedCard: 'setup-stack-block-muted',
  helper: 'setup-helper',
};
