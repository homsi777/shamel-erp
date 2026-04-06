export interface RecognizedLicenseExtension {
  extensionType: 'module_unlock';
  code: string;
  label: string;
  description: string;
  forceEnabledTabs: string[];
}

const EXTENSION_RULES: Array<{
  prefixes: string[];
  label: string;
  description: string;
  forceEnabledTabs: string[];
}> = [
  {
    prefixes: ['EXT-REST-'],
    label: 'Restaurant Extension',
    description: 'يفتح حزمة المطعم والطاولات وQR وتقارير المطعم.',
    forceEnabledTabs: ['restaurant', 'restaurant_tables', 'restaurant_settings', 'restaurant_qr', 'restaurant_menu_qr', 'restaurant_reports'],
  },
  {
    prefixes: ['EXT-MFG-'],
    label: 'Manufacturing Extension',
    description: 'يفتح قسم التصنيع على هذه النسخة.',
    forceEnabledTabs: ['manufacturing'],
  },
  {
    prefixes: ['EXT-DIST-'],
    label: 'Distribution Extension',
    description: 'يفتح قسم الوكلاء والتوزيع.',
    forceEnabledTabs: ['agents'],
  },
  {
    prefixes: ['EXT-MON-'],
    label: 'System Monitoring Extension',
    description: 'يفتح مركز مراقبة النظام.',
    forceEnabledTabs: ['system_monitoring'],
  },
];

export const recognizeLicenseExtensionCode = (rawCode: string): RecognizedLicenseExtension | null => {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!code) return null;
  for (const rule of EXTENSION_RULES) {
    if (rule.prefixes.some((prefix) => code.startsWith(prefix))) {
      return {
        extensionType: 'module_unlock',
        code,
        label: rule.label,
        description: rule.description,
        forceEnabledTabs: [...rule.forceEnabledTabs],
      };
    }
  }
  return null;
};
