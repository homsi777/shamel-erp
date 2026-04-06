import React from 'react';
import { Briefcase, Building2, CheckCircle2, CloudOff, KeyRound, MonitorSmartphone, Phone, ServerCog, ServerCrash, UserRound } from 'lucide-react';
import { WIZARD_FIELD_STYLES } from '../../wizardConstants';
import type { SetupWizardData } from '../../wizardTypes';
import {
  getLicenseMissionDefinition,
  getLicenseMissionLabel,
  recognizeLicenseMissionFromCode,
  type LicenseMission,
} from '../../../../lib/licenseMission';

interface WizardActivationStepProps {
  data: SetupWizardData;
  onChange: (patch: Partial<SetupWizardData>) => void;
  activationDone: boolean;
  resolvedActivationMission: LicenseMission | null;
  serverHost: string;
}

const getMissionIcon = (mission: LicenseMission | null) => {
  switch (mission) {
    case 'LOCAL_NETWORK_HOST':
      return ServerCog;
    case 'LOCAL_NETWORK_TERMINAL':
      return MonitorSmartphone;
    case 'CLOUD_PLACEHOLDER':
      return CloudOff;
    default:
      return KeyRound;
  }
};

const WizardActivationStep: React.FC<WizardActivationStepProps> = ({
  data,
  onChange,
  activationDone,
  resolvedActivationMission,
  serverHost,
}) => {
  const recognition = recognizeLicenseMissionFromCode(data.activationCode);
  const detectedMission = resolvedActivationMission || recognition?.mission || null;
  const missionDefinition = getLicenseMissionDefinition(detectedMission);
  const needsServer = missionDefinition.requiresHostAddress;
  const MissionIcon = getMissionIcon(detectedMission);

  const metadataFields: Array<{
    key:
      | 'activationCustomerName'
      | 'activationOrgName'
      | 'activationContactName'
      | 'activationPhone'
      | 'activationBusinessDomain';
    label: string;
    placeholder: string;
    icon: typeof Building2 | typeof UserRound | typeof Phone | typeof Briefcase;
    value: string;
    dir?: 'ltr';
  }> = [
    {
      key: 'activationCustomerName',
      label: 'اسم العميل',
      placeholder: 'مثال: أحمد محمد',
      icon: UserRound,
      value: data.activationCustomerName,
    },
    {
      key: 'activationOrgName',
      label: 'اسم المنشأة',
      placeholder: 'مثال: مؤسسة النور',
      icon: Building2,
      value: data.activationOrgName,
    },
    {
      key: 'activationContactName',
      label: 'مسؤول التفعيل',
      placeholder: 'الاسم الكامل',
      icon: UserRound,
      value: data.activationContactName,
    },
    {
      key: 'activationPhone',
      label: 'الهاتف (اختياري)',
      placeholder: '09XXXXXXXX',
      icon: Phone,
      value: data.activationPhone,
      dir: 'ltr',
    },
    {
      key: 'activationBusinessDomain',
      label: 'مجال النشاط',
      placeholder: 'تجارة، مطعم، مصنع…',
      icon: Briefcase,
      value: data.activationBusinessDomain,
    },
  ];

  const missionTitle = detectedMission ? getLicenseMissionLabel(detectedMission) : null;
  const missionHint = detectedMission ? missionDefinition.nextStepSummary : 'أدخل الرمز ليظهر نوع الترخيص والمسار.';

  return (
    <div className="setup-step-inner space-y-3">
      <div className="setup-stack-block">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <label className={WIZARD_FIELD_STYLES.label} htmlFor="wizard-activation-code">
              رمز التفعيل
            </label>
            <input
              id="wizard-activation-code"
              dir="ltr"
              type="text"
              value={data.activationCode}
              onChange={(event) => onChange({ activationCode: event.target.value.toUpperCase() })}
              className={`${WIZARD_FIELD_STYLES.input} text-center font-mono tracking-wider`}
              placeholder="ALM-…"
              maxLength={30}
              autoComplete="off"
              autoFocus
            />
            <p className="setup-mission-line">
              <span className="inline-flex items-center gap-1 font-extrabold text-[var(--setup-text)]">
                {missionTitle ? (
                  <>
                    <MissionIcon size={14} className="shrink-0 opacity-80" aria-hidden />
                    {missionTitle}
                  </>
                ) : (
                  'في انتظار الرمز'
                )}
              </span>
              <span className="text-[var(--setup-text-faint)]"> — </span>
              <span>{missionHint}</span>
            </p>
            {recognition?.matchedPrefix ? (
              <p className={`${WIZARD_FIELD_STYLES.helper} font-mono`} dir="ltr">
                بادئة: {recognition.matchedPrefix}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {needsServer ? (
        <div className="setup-inline-note" data-tone={serverHost ? 'ok' : 'warn'}>
          {serverHost ? (
            <span className="inline-flex items-center gap-2">
              <CheckCircle2 size={14} className="shrink-0" />
              عنوان المضيف المحفوظ: <span dir="ltr">{serverHost}</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-2">
              <ServerCrash size={14} className="shrink-0" />
              ترخيص طرفية: يلزم عنوان Host صحيح قبل الإكمال (من خطوة المراجعة).
            </span>
          )}
        </div>
      ) : null}

      {activationDone ? (
        <div className="setup-inline-note" data-tone="ok">
          تم اعتماد التفعيل
          {detectedMission ? ` — ${getLicenseMissionLabel(detectedMission)}` : ''}.
        </div>
      ) : null}

      <div className="setup-fields-grid">
        {metadataFields.map((field) => {
          const Icon = field.icon;
          return (
            <div key={field.key} className="setup-stack-block-muted">
              <label className={WIZARD_FIELD_STYLES.label}>{field.label}</label>
              <div className="relative">
                <Icon className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--setup-text-faint)]" size={14} />
                <input
                  dir={field.dir}
                  type="text"
                  value={field.value}
                  onChange={(event) =>
                    onChange({
                      [field.key]: event.target.value,
                    } as Partial<SetupWizardData>)
                  }
                  className={`${WIZARD_FIELD_STYLES.input} pr-9 ${field.dir === 'ltr' ? 'text-left' : ''}`}
                  placeholder={field.placeholder}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default WizardActivationStep;
