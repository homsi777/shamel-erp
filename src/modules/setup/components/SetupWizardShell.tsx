import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Loader2, MoonStar, SunMedium } from 'lucide-react';
import type { WizardStepDefinition } from '../wizardTypes';

interface ActionProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
}

interface SetupWizardShellProps {
  step: number;
  steps: WizardStepDefinition[];
  title: string;
  description: string;
  errorMsg?: string | null;
  infoMsg?: string | null;
  infoTone?: 'blue' | 'green' | 'amber';
  backAction?: ActionProps | null;
  secondaryAction?: ActionProps | null;
  primaryAction: ActionProps;
  children: React.ReactNode;
}

type SetupThemeMode = 'day' | 'night';

const THEME_KEY = 'shamel_setup_theme';

const toneLabel = {
  blue: 'معلومة',
  green: 'حالة',
  amber: 'تنبيه',
};

const SetupWizardShell: React.FC<SetupWizardShellProps> = ({
  step,
  steps,
  title,
  description,
  errorMsg,
  infoMsg,
  infoTone = 'blue',
  backAction,
  secondaryAction,
  primaryAction,
  children,
}) => {
  const [theme, setTheme] = useState<SetupThemeMode>(() => {
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem(THEME_KEY) : null;
    return stored === 'night' ? 'night' : 'day';
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const timeline = useMemo(
    () =>
      steps.map((entry, index) => {
        const stepNumber = index + 1;
        const state = stepNumber < step ? 'done' : stepNumber === step ? 'current' : 'upcoming';
        return { ...entry, stepNumber, state };
      }),
    [step, steps],
  );

  return (
    <div className="setup-theme-root" data-setup-theme={theme} dir="rtl">
      <div className="setup-wizard-outer">
        <div className="setup-wizard-card">
          <header className="setup-wizard-topbar">
            <span className="setup-wizard-product">Shamel ERP — إعداد أولي</span>
            <div className="setup-theme-switch" aria-label="وضع العرض">
              <button type="button" data-active={theme === 'day'} onClick={() => setTheme('day')}>
                <SunMedium size={14} />
                نهاري
              </button>
              <button type="button" data-active={theme === 'night'} onClick={() => setTheme('night')}>
                <MoonStar size={14} />
                ليلي
              </button>
            </div>
            <span className="setup-wizard-stepcount">
              {step} / {steps.length}
            </span>
          </header>

          <nav className="setup-step-strip" aria-label="خطوات الإعداد">
            {timeline.map((item) => (
              <div key={item.id} className="setup-step-pill" data-state={item.state} title={item.title}>
                <span className="setup-step-pill-num">
                  {item.state === 'done' ? <Check size={12} strokeWidth={3} /> : item.stepNumber}
                </span>
                <span className="setup-step-pill-label">{item.label}</span>
              </div>
            ))}
          </nav>

          <div className="setup-stage-header">
            <h1 className="setup-stage-title">{title}</h1>
            <p className="setup-stage-copy">{description}</p>
          </div>

          {errorMsg ? (
            <div className="setup-callout setup-callout--inset" data-tone="error">
              {errorMsg}
            </div>
          ) : infoMsg ? (
            <div className="setup-callout setup-callout--inset" data-tone={infoTone}>
              <div className="setup-callout-kicker">{toneLabel[infoTone]}</div>
              <div>{infoMsg}</div>
            </div>
          ) : null}

          <div className="setup-stage-body">{children}</div>

          <footer className="setup-stage-footer">
            <div className="setup-footer-start">
              {backAction ? (
                <button
                  type="button"
                  onClick={backAction.onClick}
                  disabled={backAction.disabled}
                  className="setup-btn-back"
                >
                  <ArrowRight size={16} />
                  {backAction.label}
                </button>
              ) : null}
            </div>

            <div className="setup-action-cluster">
              {secondaryAction ? (
                <button
                  type="button"
                  onClick={secondaryAction.onClick}
                  disabled={secondaryAction.disabled || secondaryAction.loading}
                  className="setup-btn-secondary"
                >
                  {secondaryAction.label}
                </button>
              ) : null}

              <button
                type="button"
                onClick={primaryAction.onClick}
                disabled={primaryAction.disabled || primaryAction.loading}
                className="setup-btn-primary"
              >
                {primaryAction.loading ? <Loader2 size={16} className="animate-spin" /> : null}
                {primaryAction.label}
                {!primaryAction.loading ? <ArrowLeft size={16} /> : null}
              </button>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
};

export default SetupWizardShell;
