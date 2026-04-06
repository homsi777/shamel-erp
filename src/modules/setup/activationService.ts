import { apiRequest, checkServerConnection, setApiUrl } from '../../lib/api';
import { updateActivationContext } from '../../lib/appMode';
import {
  getLicenseMissionDefinition,
  getLicenseMissionLabel,
  recognizeLicenseMissionFromCode,
  type ActivationTypeLegacy,
  type LicenseMission,
} from '../../lib/licenseMission';
import { getClientActivationContext } from '../../lib/activationNotifications';
import { validateActivationIdentityFields } from './activationValidation';

export const ACTIVATION_PROVINCES = [
  'دمشق', 'ريف دمشق', 'حلب', 'حمص', 'حماة', 'اللاذقية', 'طرطوس',
  'إدلب', 'دير الزور', 'الرقة', 'الحسكة', 'درعا', 'السويداء', 'القنيطرة',
] as const;

export type ActivationFormFields = {
  code: string;
  customerName?: string;
  orgName: string;
  businessDomain: string;
  activatorName: string;
  activatorPhone: string;
  province: string;
  activationMethod: string;
  serverHost: string;
};

export type ActivationRunResult =
  | {
      ok: true;
      activationType: ActivationTypeLegacy;
      activationMission: LicenseMission;
      activationMissionLabel: string;
      telegramStatus?: string;
      deferred?: boolean;
    }
  | { ok: false; error: string };

export async function checkActivationServer(host: string): Promise<{ ok: boolean; message: string }> {
  const trimmed = host.trim();
  if (!trimmed) {
    return { ok: false, message: 'يرجى إدخال عنوان المضيف أولًا.' };
  }
  setApiUrl(trimmed);
  const ok = await checkServerConnection();
  if (ok) {
    return { ok: true, message: 'تم الاتصال بالمضيف بنجاح.' };
  }
  return { ok: false, message: 'تعذر الاتصال بالمضيف. تحقق من العنوان والشبكة المحلية.' };
}

export async function runActivationFlow(fields: ActivationFormFields): Promise<ActivationRunResult> {
  const code = fields.code.trim().toUpperCase();
  if (!code) {
    return { ok: false, error: 'يرجى إدخال رمز التفعيل.' };
  }

  const recognition = recognizeLicenseMissionFromCode(code);
  if (!recognition) {
    return { ok: false, error: 'تعذر التعرف على مهمة الترخيص من هذا الرمز. تأكد من الصيغة ثم أعد المحاولة.' };
  }

  const missionDefinition = getLicenseMissionDefinition(recognition.mission);
  const identityErr = validateActivationIdentityFields({
    customerName: fields.customerName,
    orgName: fields.orgName,
    activatorName: fields.activatorName,
    businessDomain: fields.businessDomain,
  });
  if (identityErr) {
    return { ok: false, error: identityErr };
  }

  if (missionDefinition.requiresHostAddress) {
    const host = fields.serverHost.trim();
    if (!host) {
      return { ok: false, error: 'هذا الترخيص يحتاج عنوان المضيف قبل متابعة الربط.' };
    }
    setApiUrl(host);
  }

  try {
    const notificationContext = getClientActivationContext(recognition.legacyActivationType, recognition.mission, {
      code,
      customerName: fields.customerName,
      orgName: fields.orgName,
      businessDomain: fields.businessDomain,
      activatorName: fields.activatorName,
      activatorPhone: fields.activatorPhone,
      province: fields.province,
      activationMethod: fields.activationMethod,
    });

    const response = await apiRequest('activation/activate', {
      method: 'POST',
      body: JSON.stringify({
        code,
        customerName: fields.customerName?.trim() || fields.orgName.trim() || undefined,
        orgName: fields.orgName.trim() || undefined,
        businessDomain: fields.businessDomain.trim(),
        profession: fields.businessDomain.trim(),
        activatorName: fields.activatorName.trim(),
        activatorPhone: fields.activatorPhone.trim() || undefined,
        province: fields.province.trim() || undefined,
        activationMethod: fields.activationMethod.trim() || undefined,
        clientPlatform: notificationContext.platform,
        clientPlatformLabel: notificationContext.platformLabel,
        clientDeviceName: notificationContext.deviceName,
        clientAppMode: notificationContext.appMode,
        clientActivationPath: notificationContext.activationPath,
        activationMission: recognition.mission,
        activationMissionLabel: notificationContext.activationMissionLabel,
      }),
    });

    if (!response?.success) {
      return { ok: false, error: response?.error || 'فشل التفعيل.' };
    }

    const activationType = (response.activationType || recognition.legacyActivationType) as ActivationTypeLegacy;
    const activationMission = (response.activationMission || recognition.mission) as LicenseMission;
    const deferred = Boolean(response.deferred);

    if (!deferred) {
      localStorage.setItem('shamel_activated', '1');
    }
    updateActivationContext(
      activationType,
      missionDefinition.requiresHostAddress ? localStorage.getItem('shamel_api_url') : null,
      { mission: activationMission, deferred },
    );

    return {
      ok: true,
      activationType,
      activationMission,
      activationMissionLabel: getLicenseMissionLabel(activationMission),
      telegramStatus: response.telegram,
      deferred,
    };
  } catch (err: any) {
    const msg =
      err?.response?.data?.error ||
      err?.message ||
      'حدث خطأ أثناء التفعيل. تحقق من الخادم وأعد المحاولة.';

    try {
      const res = await apiRequest('activation/status');
      if (res?.activated) {
        const activationType = (res.activationType || recognition.legacyActivationType) as ActivationTypeLegacy;
        const activationMission = (res.activationMission || recognition.mission) as LicenseMission;
        localStorage.setItem('shamel_activated', '1');
        updateActivationContext(activationType, null, { mission: activationMission });
        return {
          ok: true,
          activationType,
          activationMission,
          activationMissionLabel: getLicenseMissionLabel(activationMission),
          telegramStatus: 'recovered',
        };
      }
    } catch {
      // keep original error
    }

    return { ok: false, error: msg };
  }
}
