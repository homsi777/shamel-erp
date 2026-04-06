import React from 'react';
import { Building2, Landmark, Package, Store } from 'lucide-react';
import { WIZARD_FIELD_STYLES } from '../../wizardConstants';
import type { SetupWizardData } from '../../wizardTypes';

interface CompanyInfoStepProps {
  data: SetupWizardData;
  onChange: (patch: Partial<SetupWizardData>) => void;
}

const CompanyInfoStep: React.FC<CompanyInfoStepProps> = ({ data, onChange }) => {
  const fields = [
    {
      key: 'companyName',
      label: 'اسم المؤسسة',
      placeholder: 'مثال: مؤسسة النور',
      icon: Building2,
      value: data.companyName,
      helper: 'يظهر في التقارير والطباعة.',
    },
    {
      key: 'branchName',
      label: 'الفرع الرئيسي',
      placeholder: 'الفرع الرئيسي',
      icon: Store,
      value: data.branchName,
      helper: 'فرع التشغيل الافتراضي.',
    },
    {
      key: 'warehouseName',
      label: 'المستودع الافتراضي',
      placeholder: 'المستودع الرئيسي',
      icon: Package,
      value: data.warehouseName,
      helper: 'لحركات المخزون الأولى.',
    },
    {
      key: 'cashBoxName',
      label: 'الصندوق الافتراضي',
      placeholder: 'الصندوق الرئيسي',
      icon: Landmark,
      value: data.cashBoxName,
      helper: 'للسندات والنقدية.',
    },
  ] as const;

  return (
    <div className="setup-step-inner">
      <div className="setup-fields-grid">
        {fields.map((field) => {
          const Icon = field.icon;
          return (
            <div key={field.key} className="setup-stack-block-muted">
              <label className={WIZARD_FIELD_STYLES.label}>{field.label}</label>
              <div className="relative">
                <Icon className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--setup-text-faint)]" size={14} />
                <input
                  type="text"
                  value={field.value}
                  onChange={(event) =>
                    onChange({
                      [field.key]: event.target.value,
                    } as Partial<SetupWizardData>)
                  }
                  className={`${WIZARD_FIELD_STYLES.input} pr-9`}
                  placeholder={field.placeholder}
                />
              </div>
              <p className={WIZARD_FIELD_STYLES.helper}>{field.helper}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default CompanyInfoStep;
