import React from 'react';
import { Check } from 'lucide-react';
import { getProjectProfileDefinitionForWizard } from '../../wizardConstants';
import type { SetupWizardData } from '../../wizardTypes';

interface OptionalDataStepProps {
  data: SetupWizardData;
  onChange: (patch: Partial<SetupWizardData>) => void;
}

const OptionalDataStep: React.FC<OptionalDataStepProps> = ({ data, onChange }) => {
  const profile = getProjectProfileDefinitionForWizard(data.projectProfileId);

  const cards = [
    {
      key: 'addOpeningBalances',
      title: 'تذكير بالأرصدة الافتتاحية',
      description: 'بعد الإطلاق.',
      active: data.addOpeningBalances,
    },
    {
      key: 'addOpeningStock',
      title: 'تذكير بالمخزون الافتتاحي',
      description: 'بعد الإطلاق.',
      active: data.addOpeningStock,
    },
  ] as const;

  return (
    <div className="setup-step-inner space-y-3">
      {profile ? (
        <div className="setup-stack-block-muted">
          <div className="setup-support-label">مقترحات لملف {profile.arabicMeaning}</div>
          <ul className="setup-reminder-list mt-2">
            {profile.reminders.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="space-y-2">
        {cards.map((card) => (
          <button
            key={card.key}
            type="button"
            onClick={() =>
              onChange({
                [card.key]: !card.active,
              } as Partial<SetupWizardData>)
            }
            className="setup-check-row"
            data-active={card.active}
          >
            <span className="setup-check-box" aria-hidden>
              {card.active ? <Check size={12} strokeWidth={3} /> : null}
            </span>
            <span>
              <span className="block text-[13px] font-extrabold text-[var(--setup-text)]">{card.title}</span>
              <span className="block text-[11px] font-semibold text-[var(--setup-text-soft)]">{card.description}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default OptionalDataStep;
