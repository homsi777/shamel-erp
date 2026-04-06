import React, { useState } from 'react';
import { Eye, EyeOff, Lock, User } from 'lucide-react';
import { ROLE_OPTIONS, WIZARD_FIELD_STYLES } from '../../wizardConstants';
import type { SetupWizardData } from '../../wizardTypes';

interface UserSetupStepProps {
  data: SetupWizardData;
  onChange: (patch: Partial<SetupWizardData>) => void;
}

const UserSetupStep: React.FC<UserSetupStepProps> = ({ data, onChange }) => {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="setup-step-inner space-y-3">
      <div className="setup-fields-grid">
        <div className="setup-stack-block-muted">
          <label className={WIZARD_FIELD_STYLES.label}>اسم المستخدم</label>
          <div className="relative">
            <User className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--setup-text-faint)]" size={14} />
            <input
              type="text"
              value={data.username}
              onChange={(event) => onChange({ username: event.target.value })}
              className={`${WIZARD_FIELD_STYLES.input} pr-9`}
              placeholder="admin"
              autoComplete="username"
            />
          </div>
        </div>

        <div className="setup-stack-block-muted">
          <label className={WIZARD_FIELD_STYLES.label}>كلمة المرور</label>
          <div className="relative">
            <Lock className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--setup-text-faint)]" size={14} />
            <input
              type={showPassword ? 'text' : 'password'}
              value={data.password}
              onChange={(event) => onChange({ password: event.target.value })}
              className={`${WIZARD_FIELD_STYLES.input} px-9`}
              placeholder="••••"
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowPassword((current) => !current)}
              className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--setup-text-faint)] hover:text-[var(--setup-text)]"
              aria-label={showPassword ? 'إخفاء' : 'إظهار'}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <p className={WIZARD_FIELD_STYLES.helper}>4 أحرف على الأقل.</p>
        </div>
      </div>

      <div>
        <div className="mb-2 text-[11px] font-extrabold text-[var(--setup-text-faint)]">الصلاحية الابتدائية</div>
        <div className="setup-role-grid">
          {ROLE_OPTIONS.map((role) => {
            const isActive = data.userRole === role.id;
            return (
              <button
                key={role.id}
                type="button"
                onClick={() => onChange({ userRole: role.id })}
                className="setup-role-tile"
                data-active={isActive}
              >
                <div className="setup-role-tile-title">{role.label}</div>
                <div className="setup-role-tile-desc">{role.description}</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default UserSetupStep;
