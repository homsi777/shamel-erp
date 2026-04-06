import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CloudOff, MonitorSmartphone, ServerCog } from 'lucide-react';
import { apiRequest, getStoredServerIP, saveOrgsList, setActiveInstitutionId } from '../lib/api';
import { getActivationMission, getActivationType, updateActivationContext } from '../lib/appMode';
import { clearStoredSession, setSelectedBranchId, setSelectedCompanyId } from '../lib/companySession';
import {
  getLicenseMissionDefinition,
  getLicenseMissionLabel,
  inferLicenseMissionFromLegacyActivationType,
  type LicenseMission,
} from '../lib/licenseMission';
import { getActiveModulesForProfile, getLegacyBusinessTypeForProfile, normalizeProjectProfile } from '../lib/projectProfiles';
import { DEFAULT_PRINT_SETTINGS } from '../types';
import { runActivationFlow } from '../modules/setup/activationService';
import { getResolvedDeploymentConfig, normalizeDeploymentConfigInput, persistRuntimeDeploymentConfig } from '../lib/deployment';
import SetupWizardShell from '../modules/setup/components/SetupWizardShell';
import DeploymentModeSettings from '../components/settings/DeploymentModeSettings';
import BusinessTypeStep from '../modules/setup/components/steps/BusinessTypeStep';
import CompanyInfoStep from '../modules/setup/components/steps/CompanyInfoStep';
import CurrencyStep from '../modules/setup/components/steps/CurrencyStep';
import OptionalDataStep from '../modules/setup/components/steps/OptionalDataStep';
import PrintersStep from '../modules/setup/components/steps/PrintersStep';
import ReviewStep from '../modules/setup/components/steps/ReviewStep';
import UserSetupStep from '../modules/setup/components/steps/UserSetupStep';
import WizardActivationStep from '../modules/setup/components/steps/WizardActivationStep';
import { CANONICAL_COMPANY_ID } from '../modules/setup/constants';
import {
  getActivationLabel,
  getOptionalDataSummary,
  getProjectProfileLabelForWizard,
  getRelativeCurrencyRate,
  getRolePermissions,
  getUserRoleLabel,
  WIZARD_STEPS,
} from '../modules/setup/wizardConstants';
import type { SetupWizardData, WizardActivationChoice } from '../modules/setup/wizardTypes';

interface SetupWizardProps {
  onSetupComplete: () => void;
}

const INITIAL_DATA: SetupWizardData = {
  activationChoice: 'local',
  activationCode: '',
  activationCustomerName: '',
  activationOrgName: '',
  activationContactName: '',
  activationPhone: '',
  activationBusinessDomain: '',
  projectProfileId: '',
  companyName: '',
  branchName: 'الفرع الرئيسي',
  warehouseName: 'المستودع الرئيسي',
  cashBoxName: 'الصندوق الرئيسي',
  username: 'admin',
  password: '',
  userRole: 'admin',
  addOpeningBalances: false,
  addOpeningStock: false,
  thermalPrinter: '',
  networkPrinter: '',
  a4Printer: '',
  primaryCurrency: 'USD',
  secondaryCurrency: 'SYP',
  secondaryCurrencyRate: String(getRelativeCurrencyRate('USD', 'SYP')),
};

const mapActivationChoice = (activationType?: string | null): WizardActivationChoice => {
  if (activationType === 'trial') return 'trial';
  if (activationType === 'cloud' || activationType === 'branch') return 'cloud';
  return 'local';
};

const getSavedServerHost = () => {
  const directHost = getStoredServerIP();
  if (directHost) return directHost;

  const rawUrl = localStorage.getItem('shamel_api_url');
  if (!rawUrl) return '';

  try {
    return new URL(rawUrl.replace('/api', '')).hostname;
  } catch {
    return '';
  }
};

const DeploymentRoutingCard: React.FC<{
  mission: LicenseMission | null;
  deploymentConfig: ReturnType<typeof getResolvedDeploymentConfig>;
}> = ({ mission, deploymentConfig }) => {
  const missionDefinition = getLicenseMissionDefinition(mission);

  if (mission === 'CLOUD_PLACEHOLDER') {
    return (
      <div className="setup-stack-block text-right">
        <div className="mb-2 inline-flex h-9 w-9 items-center justify-center rounded-md bg-[var(--setup-text)] text-[var(--setup-card-bg)]">
          <CloudOff size={18} />
        </div>
        <h3 className="text-sm font-extrabold text-[var(--setup-text)]">ترخيص سحابي مؤجل</h3>
        <p className="mt-1 text-xs font-semibold leading-relaxed text-[var(--setup-text-soft)]">{missionDefinition.operatorSummary}</p>
        <p className="mt-2 border-t border-[var(--setup-line)] pt-2 text-xs font-semibold text-[var(--setup-text)]">
          {missionDefinition.nextStepSummary}
        </p>
      </div>
    );
  }

  if (mission === 'LOCAL_NETWORK_TERMINAL') {
    return (
      <div className="space-y-3">
        <div className="setup-stack-block text-right">
          <div className="mb-2 inline-flex h-9 w-9 items-center justify-center rounded-md bg-[var(--setup-accent)] text-white">
            <MonitorSmartphone size={18} />
          </div>
          <h3 className="text-sm font-extrabold text-[var(--setup-text)]">طرفية عميل فقط</h3>
          <p className="mt-1 text-xs font-semibold leading-relaxed text-[var(--setup-text-soft)]">{missionDefinition.operatorSummary}</p>
          <p className="mt-2 border-t border-[var(--setup-line)] pt-2 text-xs font-semibold text-[var(--setup-text)]">
            {missionDefinition.nextStepSummary}
          </p>
        </div>

        <DeploymentModeSettings
          value={deploymentConfig}
          onChange={() => undefined}
          title="ربط الطرفية بالمضيف"
          hint="أدخل عنوان المضيف ثم احفظ لإعادة التشغيل."
        />
      </div>
    );
  }

  return (
    <div className="setup-stack-block text-right">
      <div className="mb-2 inline-flex h-9 w-9 items-center justify-center rounded-md bg-[var(--setup-accent-2)] text-[var(--setup-card-bg)]">
        <ServerCog size={18} />
      </div>
      <h3 className="text-sm font-extrabold text-[var(--setup-text)]">المهمة الترخيصية</h3>
      <p className="mt-1 text-xs font-semibold leading-relaxed text-[var(--setup-text-soft)]">{missionDefinition.operatorSummary}</p>
      <p className="mt-2 border-t border-[var(--setup-line)] pt-2 text-xs font-semibold text-[var(--setup-text)]">
        {missionDefinition.nextStepSummary}
      </p>
    </div>
  );
};

const SetupWizard: React.FC<SetupWizardProps> = ({ onSetupComplete }) => {
  const [step, setStep] = useState(1);
  const [data, setData] = useState<SetupWizardData>(INITIAL_DATA);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [activationDone, setActivationDone] = useState(false);
  const [resolvedActivationType, setResolvedActivationType] = useState<string | null>(null);
  const [resolvedActivationMission, setResolvedActivationMission] = useState<LicenseMission | null>(null);
  const [activationTelegramStatus, setActivationTelegramStatus] = useState<string | null>(null);
  const [activationBusy, setActivationBusy] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deploymentConfig, setDeploymentConfig] = useState(() => getResolvedDeploymentConfig());
  const setupCompleteOnce = useRef(false);

  const updateData = (patch: Partial<SetupWizardData>) => {
    setData((current) => ({ ...current, ...patch }));
  };

  const storedServerHost = getSavedServerHost();
  const missionDefinition = getLicenseMissionDefinition(resolvedActivationMission);
  const effectiveSteps = useMemo(() => {
    if (resolvedActivationMission === 'LOCAL_NETWORK_TERMINAL' || resolvedActivationMission === 'CLOUD_PLACEHOLDER') {
      return WIZARD_STEPS.filter((entry) => entry.id === 'activation' || entry.id === 'review');
    }
    return WIZARD_STEPS;
  }, [resolvedActivationMission]);
  const currentStepDef = effectiveSteps[Math.max(0, step - 1)] || effectiveSteps[0];
  const isTerminalOnlyFlow = resolvedActivationMission === 'LOCAL_NETWORK_TERMINAL';
  const isCloudDeferredFlow = resolvedActivationMission === 'CLOUD_PLACEHOLDER';

  useEffect(() => {
    if (step > effectiveSteps.length) {
      setStep(effectiveSteps.length);
    }
  }, [effectiveSteps.length, step]);

  useEffect(() => {
    let active = true;

    const resumeActivation = async () => {
      try {
        const response = await apiRequest('activation/status');
        if (!active || !response?.activated) return;

        const activationType = response.activationType || 'local';
        const activationMission = (response.activationMission || inferLicenseMissionFromLegacyActivationType(activationType)) as LicenseMission;
        setActivationDone(true);
        setResolvedActivationType(activationType);
        setResolvedActivationMission(activationMission);
        setData((current) => ({
          ...current,
          activationChoice: mapActivationChoice(activationType),
        }));
        localStorage.setItem('shamel_activated', '1');
        updateActivationContext(activationType, null, { mission: activationMission });
        setDeploymentConfig((current) => normalizeDeploymentConfigInput({ ...current, ...getLicenseMissionDefinition(activationMission).deploymentDefault }));
        setStep(activationMission === 'LOCAL_NETWORK_TERMINAL' || activationMission === 'CLOUD_PLACEHOLDER' ? 2 : 2);
        return;
      } catch {
        // local fallback
      }

      const storedActivated = localStorage.getItem('shamel_activated') === '1';
      const storedType = getActivationType();
      const storedMission = getActivationMission();
      if (!active || !storedActivated || !storedType) return;

      const activationMission = storedMission || inferLicenseMissionFromLegacyActivationType(storedType);
      setActivationDone(true);
      setResolvedActivationType(storedType);
      setResolvedActivationMission(activationMission);
      setData((current) => ({
        ...current,
        activationChoice: mapActivationChoice(storedType),
      }));
      updateActivationContext(storedType, null, { mission: activationMission });
      setDeploymentConfig((current) => normalizeDeploymentConfigInput({ ...current, ...getLicenseMissionDefinition(activationMission).deploymentDefault }));
      setStep(activationMission === 'LOCAL_NETWORK_TERMINAL' || activationMission === 'CLOUD_PLACEHOLDER' ? 2 : 2);
    };

    void resumeActivation();

    return () => {
      active = false;
    };
  }, []);

  const infoMsg = useMemo(() => {
    if (currentStepDef?.id === 'activation' && activationDone && resolvedActivationType && resolvedActivationMission) {
      const missionLabel = getLicenseMissionLabel(resolvedActivationMission);
      if (activationTelegramStatus === 'sent') {
        return `تم اعتماد الترخيص ${missionLabel} وإرسال إشعار Telegram بنجاح.`;
      }
      if (activationTelegramStatus === 'failed') {
        return `تم التعرف على ${missionLabel} لكن إشعار Telegram لم يرسل بنجاح.`;
      }
      return `تم التعرف على ${missionLabel}. ${missionDefinition.nextStepSummary}`;
    }
    if (currentStepDef?.id === 'review' && isCloudDeferredFlow) {
      return 'هذا المسار لا يدخل إلى الإعداد المحلي. الترخيص معروف لكنه محجوز لمسار سحابي مؤجل.';
    }
    if (currentStepDef?.id === 'review' && isTerminalOnlyFlow) {
      return 'سيتم اختصار الإعداد هنا إلى ربط هذه الطرفية بعنوان المضيف فقط.';
    }
    if (currentStepDef?.id === 'reminders') {
      return 'هذه خطوة تذكيرية فقط. لا تنشئ بيانات تشغيلية فعلية.';
    }
    if (currentStepDef?.id === 'review' && !isTerminalOnlyFlow) {
      return `ملف المشروع: ${getProjectProfileLabelForWizard(data.projectProfileId)} • الصلاحية: ${getUserRoleLabel(
        data.userRole,
      )} • التذكيرات: ${getOptionalDataSummary(data)}`;
    }
    return null;
  }, [
    activationDone,
    activationTelegramStatus,
    currentStepDef?.id,
    data.addOpeningBalances,
    data.addOpeningStock,
    data.projectProfileId,
    data.userRole,
    isCloudDeferredFlow,
    isTerminalOnlyFlow,
    missionDefinition.nextStepSummary,
    resolvedActivationMission,
    resolvedActivationType,
  ]);

  const validateStep = (stepId?: string) => {
    switch (stepId) {
      case 'profile':
        if (!data.projectProfileId) return 'اختر ملف المشروع قبل المتابعة.';
        return null;
      case 'company':
        if (!data.companyName.trim()) return 'أدخل اسم المؤسسة.';
        if (!data.branchName.trim()) return 'أدخل اسم الفرع.';
        if (!data.warehouseName.trim()) return 'أدخل اسم المستودع.';
        if (!data.cashBoxName.trim()) return 'أدخل اسم الصندوق.';
        return null;
      case 'user':
        if (!data.username.trim()) return 'أدخل اسم المستخدم.';
        if (!data.password.trim()) return 'أدخل كلمة المرور.';
        if (data.password.length < 4) return 'كلمة المرور يجب أن تحتوي على 4 أحرف على الأقل.';
        return null;
      case 'currency':
        if (!data.primaryCurrency) return 'اختر العملة الأساسية.';
        if (data.secondaryCurrency && data.secondaryCurrency === data.primaryCurrency) {
          return 'العملة الثانوية يجب أن تختلف عن العملة الأساسية.';
        }
        if (data.secondaryCurrency) {
          const rate = Number(data.secondaryCurrencyRate);
          if (!Number.isFinite(rate) || rate <= 0) {
            return 'أدخل سعر صرف صالحًا للعملة الثانوية.';
          }
        }
        return null;
      default:
        return null;
    }
  };

  const activateAndContinue = async () => {
    const activationCode = data.activationCode.trim().toUpperCase();

    if (!activationCode) {
      setErrorMsg('أدخل رمز التفعيل أولًا.');
      return;
    }

    if (!data.activationCustomerName.trim()) {
      setErrorMsg('أدخل اسم العميل المراد تفعيل المشروع له.');
      return;
    }

    if (!data.activationOrgName.trim()) {
      setErrorMsg('أدخل اسم المنشأة أو المؤسسة.');
      return;
    }

    if (!data.activationContactName.trim()) {
      setErrorMsg('أدخل اسم المسؤول عن التفعيل.');
      return;
    }

    if (!data.activationBusinessDomain.trim()) {
      setErrorMsg('أدخل مجال العمل أو النشاط التجاري.');
      return;
    }

    setActivationBusy(true);
    setErrorMsg(null);
    setActivationTelegramStatus(null);

    try {
      const result = await runActivationFlow({
        code: activationCode,
        customerName: data.activationCustomerName,
        orgName: data.activationOrgName,
        businessDomain: data.activationBusinessDomain,
        activatorName: data.activationContactName,
        activatorPhone: data.activationPhone,
        province: '',
        activationMethod: '',
        serverHost: storedServerHost || '',
      });

      if (!result.ok) {
        setErrorMsg(result.error);
        return;
      }

      localStorage.setItem('shamel_setup_activation_done', '1');
      setActivationDone(true);
      setResolvedActivationType(result.activationType);
      setResolvedActivationMission(result.activationMission);
      setActivationTelegramStatus(result.telegramStatus || null);
      setDeploymentConfig((current) =>
        normalizeDeploymentConfigInput({
          ...current,
          ...getLicenseMissionDefinition(result.activationMission).deploymentDefault,
          apiBaseUrl: result.activationMission === 'LOCAL_NETWORK_TERMINAL' ? (current.apiBaseUrl || getResolvedDeploymentConfig().apiBaseUrl) : current.apiBaseUrl,
        }),
      );
      setData((current) => ({
        ...current,
        activationCode,
        activationChoice: mapActivationChoice(result.activationType),
        companyName: current.companyName.trim() ? current.companyName : current.activationOrgName,
      }));

      if (result.deferred || result.activationMission === 'LOCAL_NETWORK_TERMINAL') {
        setStep(2);
        return;
      }
      setStep(2);
    } finally {
      setActivationBusy(false);
    }
  };

  const handleFinish = async () => {
    if (isCloudDeferredFlow) {
      setStep(1);
      setActivationDone(false);
      setResolvedActivationType(null);
      setResolvedActivationMission(null);
      setActivationTelegramStatus(null);
      localStorage.removeItem('shamel_activated');
      return;
    }

    if (setupCompleteOnce.current || isSubmitting) return;

    setupCompleteOnce.current = true;
    setIsSubmitting(true);
    setErrorMsg(null);
    const normalizedDeployment = normalizeDeploymentConfigInput(deploymentConfig);

    if (normalizedDeployment.mode === 'local_network' && normalizedDeployment.role === 'terminal' && !normalizedDeployment.apiBaseUrl) {
      setErrorMsg('أدخل عنوان Host صحيح للطرفية قبل الإكمال.');
      setupCompleteOnce.current = false;
      setIsSubmitting(false);
      return;
    }

    if (normalizedDeployment.mode === 'local_network' && normalizedDeployment.role === 'terminal') {
      try {
        await persistRuntimeDeploymentConfig(normalizedDeployment);
        const currentSettingsRaw = localStorage.getItem('shamel_settings');
        const currentSettings = currentSettingsRaw ? JSON.parse(currentSettingsRaw) : {};
        localStorage.setItem('shamel_settings', JSON.stringify({
          ...currentSettings,
          deployment: normalizedDeployment,
        }));
        if (window.electronAPI?.restartApp) {
          await window.electronAPI.restartApp();
          return;
        }
        window.location.reload();
        return;
      } catch (error: any) {
        setupCompleteOnce.current = false;
        setIsSubmitting(false);
        setErrorMsg(error?.message || 'تعذر حفظ إعداد الطرفية.');
        return;
      }
    }

    const normalizedProfile = normalizeProjectProfile({
      id: data.projectProfileId || undefined,
      source: 'setup_wizard',
      configuredAt: new Date().toISOString(),
    });
    const legacyBusinessType = getLegacyBusinessTypeForProfile(normalizedProfile.id);
    const secondaryCurrencyRate = data.secondaryCurrency
      ? Number(data.secondaryCurrencyRate || getRelativeCurrencyRate(data.primaryCurrency, data.secondaryCurrency))
      : undefined;

    const printerSettings: Record<string, unknown> = {
      ...DEFAULT_PRINT_SETTINGS,
      defaultPrinter: data.a4Printer || undefined,
      defaultA4PrinterId: data.a4Printer || undefined,
      defaultA4PrinterName: data.a4Printer || undefined,
      thermal: {
        enabled: Boolean(data.thermalPrinter),
        printerId: data.thermalPrinter,
        paperSize: '80mm',
        autoPrintPos: true,
        windowsPrinterId: data.thermalPrinter || undefined,
        windowsPrinterName: data.thermalPrinter || undefined,
      },
      networkPrinter: data.networkPrinter
        ? {
            host: data.networkPrinter,
            name: data.networkPrinter,
          }
        : undefined,
    };

    const payload = {
      user: {
        username: data.username.trim(),
        password: data.password,
        name: data.username.trim(),
        role: data.userRole,
        permissions: getRolePermissions(data.userRole),
      },
      company: {
        name: data.companyName.trim(),
        address: data.branchName.trim(),
        phone: '',
        logo: '',
        type: legacyBusinessType,
        businessType: legacyBusinessType,
      },
      settings: {
        primaryCurrency: data.primaryCurrency,
        secondaryCurrency: data.secondaryCurrency || undefined,
        secondaryCurrencyRate,
        mainCashBoxName: data.cashBoxName.trim(),
        mainWarehouseName: data.warehouseName.trim(),
        defaultUnit: 'قطعة',
        defaultClientName: 'عميل نقدي عام',
        defaultSupplierName: 'مورد أساسي',
        branchName: data.branchName.trim(),
        onboardingFlags: {
          openingBalances: data.addOpeningBalances,
          openingStock: data.addOpeningStock,
        },
      },
      projectProfile: normalizedProfile,
      parties: [],
      printers: printerSettings,
      deployment: normalizedDeployment,
    };

    try {
      const response = await apiRequest('setup/complete', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      if (!response?.success) {
        setupCompleteOnce.current = false;
        const details = response?.details;
        if (Array.isArray(details) && details.length > 0) {
          const msgs = details.map((d: any) => d.message || d.code).join(' | ');
          setErrorMsg(msgs);
        } else {
          setErrorMsg(response?.error || 'تعذر إكمال الإعداد.');
        }
        return;
      }

      const effectiveCompanyId = response.user?.companyId || CANONICAL_COMPANY_ID;
      const effectiveBranchId = response.user?.currentBranchId || response.user?.defaultBranchId || 'br-main';

      clearStoredSession();

      saveOrgsList([
        {
          id: effectiveCompanyId,
          name: data.companyName.trim(),
          type: legacyBusinessType,
          address: data.branchName.trim(),
          phone: '',
          primaryCurrency: data.primaryCurrency,
          mode: 'local',
          activeModules: getActiveModulesForProfile(normalizedProfile.id),
          config: {
            mainWarehouseName: data.warehouseName.trim(),
            mainCashBoxName: data.cashBoxName.trim(),
            defaultUnit: 'قطعة',
          },
          createdAt: new Date().toISOString(),
        },
      ]);

      setActiveInstitutionId(effectiveCompanyId);
      setSelectedCompanyId(effectiveCompanyId);
      setSelectedBranchId(effectiveBranchId);
      localStorage.setItem('shamel_has_org', '1');
      localStorage.setItem('shamel_setup_done', '1');

      const settingsObject = {
        company: {
          name: data.companyName.trim(),
          address: data.branchName.trim(),
          phone1: '',
          logo: '',
          type: legacyBusinessType,
          businessType: legacyBusinessType,
        },
        theme: {
          primaryColor: '#60a5fa',
          backgroundColor: '#f6fbff',
        },
        labels: {},
        print: printerSettings,
        deployment: normalizedDeployment,
        projectProfile: normalizedProfile,
        currencyRates: data.secondaryCurrency
          ? {
              [data.primaryCurrency]: 1,
              [data.secondaryCurrency]: secondaryCurrencyRate,
            }
          : { SYP: 15000, TRY: 32 },
        onboarding: {
          openingBalances: data.addOpeningBalances,
          openingStock: data.addOpeningStock,
        },
      };

      await persistRuntimeDeploymentConfig(normalizedDeployment);
      localStorage.setItem('shamel_settings', JSON.stringify(settingsObject));
      onSetupComplete();
    } catch (error: any) {
      setupCompleteOnce.current = false;
      setErrorMsg(error?.message || 'حدث خطأ أثناء تجهيز النظام.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePrimaryAction = async () => {
    if (currentStepDef?.id === 'activation') {
      await activateAndContinue();
      return;
    }

    if (currentStepDef?.id === 'review') {
      await handleFinish();
      return;
    }

    const validationError = validateStep(currentStepDef?.id);
    if (validationError) {
      setErrorMsg(validationError);
      return;
    }

    setErrorMsg(null);
    setStep((current) => Math.min(current + 1, effectiveSteps.length));
  };

  const handleBack = () => {
    setErrorMsg(null);
    if (step === 1) return;
    setStep((current) => Math.max(current - 1, 1));
  };

  const currentStepContent = (() => {
    switch (currentStepDef?.id) {
      case 'activation':
        return (
          <WizardActivationStep
            data={data}
            onChange={updateData}
            activationDone={activationDone}
            resolvedActivationMission={resolvedActivationMission}
            serverHost={storedServerHost}
          />
        );
      case 'profile':
        return <BusinessTypeStep data={data} onChange={updateData} />;
      case 'company':
        return <CompanyInfoStep data={data} onChange={updateData} />;
      case 'user':
        return <UserSetupStep data={data} onChange={updateData} />;
      case 'reminders':
        return <OptionalDataStep data={data} onChange={updateData} />;
      case 'printers':
        return <PrintersStep data={data} onChange={updateData} />;
      case 'currency':
        return <CurrencyStep data={data} onChange={updateData} />;
      case 'review':
        return (
          <div className="space-y-3">
            <DeploymentRoutingCard mission={resolvedActivationMission} deploymentConfig={deploymentConfig} />
            {!isTerminalOnlyFlow && !isCloudDeferredFlow && (
              <ReviewStep data={data} resolvedActivationType={resolvedActivationType} deploymentConfig={deploymentConfig} />
            )}
            {!isCloudDeferredFlow && (
              <DeploymentModeSettings
                value={deploymentConfig}
                onChange={setDeploymentConfig}
                title={isTerminalOnlyFlow ? 'ربط الطرفية بالمضيف' : 'اختر نمط تشغيل هذا الجهاز'}
                hint={
                  isTerminalOnlyFlow
                    ? 'هذه الرخصة مخصصة لطرفية شبكة محلية فقط. أدخل عنوان المضيف وتأكد من بقاء هذا الجهاز في وضع Terminal.'
                    : 'سيتم اقتراح نمط التشغيل تلقائيًا من مهمة الترخيص، ويمكنك مراجعته هنا قبل الإنهاء.'
                }
              />
            )}
          </div>
        );
      default:
        return null;
    }
  })();

  const primaryLabel =
    currentStepDef?.id === 'activation'
      ? activationDone && isCloudDeferredFlow
        ? 'إدخال رمز آخر'
        : 'تفعيل ومتابعة'
      : currentStepDef?.id === 'review'
        ? isCloudDeferredFlow
          ? 'إدخال رمز آخر'
          : isTerminalOnlyFlow
            ? 'حفظ الربط وإعادة التشغيل'
            : 'تأكيد والانتقال لتسجيل الدخول'
        : 'التالي';

  return (
    <SetupWizardShell
      step={step}
      steps={effectiveSteps}
      title={currentStepDef?.title || ''}
      description={currentStepDef?.description || ''}
      errorMsg={errorMsg}
      infoMsg={infoMsg}
      infoTone={
        currentStepDef?.id === 'activation'
          ? activationTelegramStatus === 'failed'
            ? 'amber'
            : 'green'
          : currentStepDef?.id === 'reminders'
            ? 'amber'
            : 'blue'
      }
      backAction={step > 1 ? { label: 'السابق', onClick: handleBack } : null}
      secondaryAction={
        currentStepDef?.id === 'reminders'
          ? {
              label: 'تخطي',
              onClick: () => {
                updateData({ addOpeningBalances: false, addOpeningStock: false });
                setErrorMsg(null);
                setStep((current) => Math.min(current + 1, effectiveSteps.length));
              },
            }
          : null
      }
      primaryAction={{
        label: primaryLabel,
        onClick: () => {
          void handlePrimaryAction();
        },
        loading: activationBusy || isSubmitting,
      }}
    >
      {currentStepContent}
    </SetupWizardShell>
  );
};

export default SetupWizard;
