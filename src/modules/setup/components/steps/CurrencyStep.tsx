import React from 'react';
import { CURRENCY_OPTIONS, getRelativeCurrencyRate, WIZARD_FIELD_STYLES } from '../../wizardConstants';
import type { SetupWizardData } from '../../wizardTypes';

interface CurrencyStepProps {
  data: SetupWizardData;
  onChange: (patch: Partial<SetupWizardData>) => void;
}

const CurrencyStep: React.FC<CurrencyStepProps> = ({ data, onChange }) => {
  const suggestedRate = data.secondaryCurrency
    ? String(getRelativeCurrencyRate(data.primaryCurrency, data.secondaryCurrency))
    : '';

  return (
    <div className="setup-step-inner space-y-3">
      <div>
        <div className="mb-2 text-[11px] font-extrabold text-[var(--setup-text-faint)]">العملة الأساسية</div>
        <div className="setup-option-grid">
          {CURRENCY_OPTIONS.map((currency) => {
            const isActive = data.primaryCurrency === currency;
            return (
              <button
                key={currency}
                type="button"
                onClick={() =>
                  onChange({
                    primaryCurrency: currency,
                    secondaryCurrency: data.secondaryCurrency === currency ? '' : data.secondaryCurrency,
                    secondaryCurrencyRate:
                      data.secondaryCurrency && data.secondaryCurrency !== currency
                        ? String(getRelativeCurrencyRate(currency, data.secondaryCurrency))
                        : '',
                  })
                }
                className="setup-option-btn"
                data-active={isActive}
              >
                {currency}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="mb-2 text-[11px] font-extrabold text-[var(--setup-text-faint)]">عملة ثانوية (اختياري)</div>
        <div className="setup-option-grid">
          <button
            type="button"
            onClick={() => onChange({ secondaryCurrency: '', secondaryCurrencyRate: '' })}
            className="setup-option-btn"
            data-active={!data.secondaryCurrency}
          >
            بدون
          </button>

          {CURRENCY_OPTIONS.filter((currency) => currency !== data.primaryCurrency).map((currency) => {
            const isActive = data.secondaryCurrency === currency;
            return (
              <button
                key={currency}
                type="button"
                onClick={() =>
                  onChange({
                    secondaryCurrency: currency,
                    secondaryCurrencyRate: String(getRelativeCurrencyRate(data.primaryCurrency, currency)),
                  })
                }
                className="setup-option-btn"
                data-active={isActive}
              >
                {currency}
              </button>
            );
          })}
        </div>

        {data.secondaryCurrency ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="setup-stack-block-muted">
              <label className={WIZARD_FIELD_STYLES.label}>سعر الصرف (1 {data.primaryCurrency} = ?)</label>
              <input
                dir="ltr"
                type="number"
                min="0"
                step="0.000001"
                value={data.secondaryCurrencyRate}
                onChange={(event) => onChange({ secondaryCurrencyRate: event.target.value })}
                className={`${WIZARD_FIELD_STYLES.input} text-left`}
                placeholder={suggestedRate}
              />
            </div>
            <div className="setup-stack-block-muted flex flex-col justify-center text-[12px] font-bold text-[var(--setup-text-soft)]">
              <span>
                1 {data.primaryCurrency} = {data.secondaryCurrencyRate || suggestedRate} {data.secondaryCurrency}
              </span>
            </div>
          </div>
        ) : null}
      </div>

      <div className="setup-callout" data-tone="blue">
        {data.secondaryCurrency
          ? `مرجع مقترح: 1 ${data.primaryCurrency} = ${suggestedRate} ${data.secondaryCurrency}`
          : 'بدون عملة ثانوية في الإعداد الأولي.'}
      </div>
    </div>
  );
};

export default CurrencyStep;
