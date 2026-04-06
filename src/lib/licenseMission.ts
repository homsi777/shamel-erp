export type LicenseMission =
  | 'LOCAL_STANDALONE'
  | 'LOCAL_NETWORK_HOST'
  | 'LOCAL_NETWORK_TERMINAL'
  | 'TRIAL'
  | 'CLOUD_PLACEHOLDER';

export type ActivationTypeLegacy = 'local' | 'trial' | 'cloud' | 'branch';

export interface LicenseMissionDefinition {
  id: LicenseMission;
  legacyActivationType: ActivationTypeLegacy;
  label: string;
  arabicLabel: string;
  operatorSummary: string;
  nextStepSummary: string;
  setupPath: 'full_setup' | 'terminal_link' | 'trial_setup' | 'cloud_placeholder';
  allowsProjectSetup: boolean;
  requiresHostAddress: boolean;
  deploymentDefault: {
    mode: 'standalone' | 'local_network';
    role: 'standalone' | 'host' | 'terminal';
  };
  highlightTone: 'emerald' | 'blue' | 'violet' | 'amber' | 'slate';
}

export interface LicenseRecognitionResult {
  mission: LicenseMission;
  normalizedCode: string;
  legacyActivationType: ActivationTypeLegacy;
  confidence: 'explicit_prefix' | 'legacy_prefix' | 'unknown';
  matchedPrefix: string | null;
}

const MISSION_DEFINITIONS: Record<LicenseMission, LicenseMissionDefinition> = {
  LOCAL_STANDALONE: {
    id: 'LOCAL_STANDALONE',
    legacyActivationType: 'local',
    label: 'Local Standalone',
    arabicLabel: 'محلي مستقل',
    operatorSummary: 'هذا الترخيص مخصص لجهاز واحد يملك التشغيل الكامل محليًا.',
    nextStepSummary: 'سيتم فتح الإعداد الكامل للمؤسسة والمستخدم والطابعات والعملات بدون أي ربط شبكي إلزامي.',
    setupPath: 'full_setup',
    allowsProjectSetup: true,
    requiresHostAddress: false,
    deploymentDefault: { mode: 'standalone', role: 'standalone' },
    highlightTone: 'emerald',
  },
  LOCAL_NETWORK_HOST: {
    id: 'LOCAL_NETWORK_HOST',
    legacyActivationType: 'local',
    label: 'Local Network Host',
    arabicLabel: 'مضيف شبكة محلية',
    operatorSummary: 'هذا الترخيص مخصص للجهاز الرئيسي داخل الموقع لامتلاك الخادم وقاعدة البيانات.',
    nextStepSummary: 'سيتم فتح الإعداد الكامل مع ضبط هذا الجهاز كمضيف محلي لتتصل به الطرفيات لاحقًا.',
    setupPath: 'full_setup',
    allowsProjectSetup: true,
    requiresHostAddress: false,
    deploymentDefault: { mode: 'local_network', role: 'host' },
    highlightTone: 'blue',
  },
  LOCAL_NETWORK_TERMINAL: {
    id: 'LOCAL_NETWORK_TERMINAL',
    legacyActivationType: 'local',
    label: 'Local Network Terminal',
    arabicLabel: 'طرفية شبكة محلية',
    operatorSummary: 'هذا الترخيص مخصص لطرفية عميل ترتبط بمضيف موجود داخل نفس الموقع.',
    nextStepSummary: 'لن يتم تشغيل الإعداد الكامل هنا. سيتم الاكتفاء بربط هذه الطرفية بعنوان المضيف فقط.',
    setupPath: 'terminal_link',
    allowsProjectSetup: false,
    requiresHostAddress: true,
    deploymentDefault: { mode: 'local_network', role: 'terminal' },
    highlightTone: 'violet',
  },
  TRIAL: {
    id: 'TRIAL',
    legacyActivationType: 'trial',
    label: 'Trial',
    arabicLabel: 'تجريبي',
    operatorSummary: 'هذا الترخيص مخصص لتجربة النظام بشكل موجّه ومتوافق مع سياسة النسخة التجريبية الحالية.',
    nextStepSummary: 'سيتم فتح مسار إعداد تجريبي آمن مع المحافظة على القيود الحالية للنسخة التجريبية.',
    setupPath: 'trial_setup',
    allowsProjectSetup: true,
    requiresHostAddress: false,
    deploymentDefault: { mode: 'standalone', role: 'standalone' },
    highlightTone: 'amber',
  },
  CLOUD_PLACEHOLDER: {
    id: 'CLOUD_PLACEHOLDER',
    legacyActivationType: 'cloud',
    label: 'Cloud Placeholder',
    arabicLabel: 'سحابي مؤجل',
    operatorSummary: 'هذا الترخيص معروف كمشروع سحابي مستقبلي، لكنه غير قابل للتجهيز داخل هذا الإصدار المحلي الحالي.',
    nextStepSummary: 'سيتم إيقاف الإعداد المحلي هنا مع رسالة واضحة بأن هذا المسار محجوز لتطوير السحابة لاحقًا.',
    setupPath: 'cloud_placeholder',
    allowsProjectSetup: false,
    requiresHostAddress: false,
    deploymentDefault: { mode: 'standalone', role: 'standalone' },
    highlightTone: 'slate',
  },
};

const PREFIX_TO_MISSION: Array<{ prefixes: string[]; mission: LicenseMission; confidence: LicenseRecognitionResult['confidence'] }> = [
  { prefixes: ['ALM-HST-', 'HST-', 'LNH-'], mission: 'LOCAL_NETWORK_HOST', confidence: 'explicit_prefix' },
  { prefixes: ['ALM-TRM-', 'TRM-', 'LNT-', 'BRN-', 'BR-'], mission: 'LOCAL_NETWORK_TERMINAL', confidence: 'explicit_prefix' },
  { prefixes: ['TEST-', 'TEST'], mission: 'TRIAL', confidence: 'explicit_prefix' },
  { prefixes: ['CLD-'], mission: 'CLOUD_PLACEHOLDER', confidence: 'explicit_prefix' },
  { prefixes: ['ALM-'], mission: 'LOCAL_STANDALONE', confidence: 'legacy_prefix' },
];

export const DEFAULT_LICENSE_MISSION: LicenseMission = 'LOCAL_STANDALONE';

export const getLicenseMissionDefinition = (mission?: LicenseMission | null): LicenseMissionDefinition => {
  return MISSION_DEFINITIONS[mission || DEFAULT_LICENSE_MISSION] || MISSION_DEFINITIONS[DEFAULT_LICENSE_MISSION];
};

export const normalizeLicenseMission = (value?: string | null): LicenseMission => {
  const raw = String(value || '').trim().toUpperCase() as LicenseMission;
  return MISSION_DEFINITIONS[raw] ? raw : DEFAULT_LICENSE_MISSION;
};

export const getLicenseMissionLabel = (mission?: LicenseMission | null): string => {
  const def = getLicenseMissionDefinition(mission);
  return `${def.arabicLabel} (${def.label})`;
};

export const recognizeLicenseMissionFromCode = (code: string): LicenseRecognitionResult | null => {
  const normalizedCode = String(code || '').trim().toUpperCase();
  if (!normalizedCode) return null;

  for (const rule of PREFIX_TO_MISSION) {
    const matchedPrefix = rule.prefixes.find((prefix) => normalizedCode.startsWith(prefix));
    if (!matchedPrefix) continue;
    const def = getLicenseMissionDefinition(rule.mission);
    return {
      mission: rule.mission,
      normalizedCode,
      legacyActivationType: def.legacyActivationType,
      confidence: rule.confidence,
      matchedPrefix,
    };
  }

  return null;
};

export const inferLicenseMissionFromLegacyActivationType = (activationType?: string | null): LicenseMission => {
  const normalized = String(activationType || '').trim().toLowerCase();
  if (normalized === 'trial') return 'TRIAL';
  if (normalized === 'cloud') return 'CLOUD_PLACEHOLDER';
  if (normalized === 'branch') return 'LOCAL_NETWORK_TERMINAL';
  return 'LOCAL_STANDALONE';
};

export const maskActivationCode = (code: string) => {
  const normalized = String(code || '').trim().toUpperCase();
  if (normalized.length <= 8) return normalized;
  return `${normalized.slice(0, 4)}•••${normalized.slice(-4)}`;
};
