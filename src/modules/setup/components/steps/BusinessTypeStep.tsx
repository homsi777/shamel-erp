import React from 'react';
import { PROJECT_PROFILE_OPTIONS } from '../../wizardConstants';
import type { SetupWizardData } from '../../wizardTypes';

interface BusinessTypeStepProps {
  data: SetupWizardData;
  onChange: (patch: Partial<SetupWizardData>) => void;
}

const BusinessTypeStep: React.FC<BusinessTypeStepProps> = ({ data, onChange }) => {
  return (
    <div className="setup-step-inner space-y-2">
      <div className="max-h-[min(52vh,420px)] space-y-2 overflow-y-auto pr-1">
        {PROJECT_PROFILE_OPTIONS.map((option) => {
          const isActive = data.projectProfileId === option.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onChange({ projectProfileId: option.id })}
              className="setup-profile-row"
              data-active={isActive}
            >
              <div className="setup-profile-row-title">{option.arabicMeaning}</div>
              <div className="setup-profile-row-sub">{option.label} — {option.description}</div>
              {option.includes.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {option.includes.slice(0, 4).map((entry) => (
                    <span key={entry} className="setup-chip">
                      {entry}
                    </span>
                  ))}
                  {option.includes.length > 4 ? <span className="setup-chip">+{option.includes.length - 4}</span> : null}
                </div>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default BusinessTypeStep;
