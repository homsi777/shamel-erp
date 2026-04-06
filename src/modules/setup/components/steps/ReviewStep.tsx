import React from 'react';
import {
  getActivationLabel,
  getOptionalDataSummary,
  getProjectProfileLabelForWizard,
  getUserRoleLabel,
} from '../../wizardConstants';
import type { SetupWizardData } from '../../wizardTypes';
import type { DeploymentConfig } from '../../../../lib/deployment';

interface ReviewStepProps {
  data: SetupWizardData;
  resolvedActivationType: string | null;
  deploymentConfig?: DeploymentConfig | null;
}

const getDeploymentSummary = (deploymentConfig?: DeploymentConfig | null) => {
  if (!deploymentConfig || deploymentConfig.mode === 'standalone') {
    return 'مستقل — خادم وقاعدة بيانات على هذا الجهاز';
  }
  if (deploymentConfig.role === 'host') {
    return 'مضيف شبكة محلية';
  }
  return `طرفية → ${deploymentConfig.apiBaseUrl || 'غير محدد'}`;
};

const ReviewStep: React.FC<ReviewStepProps> = ({ data, resolvedActivationType, deploymentConfig }) => {
  const items: Array<{ label: string; value: string }> = [
    {
      label: 'التفعيل',
      value: `${getActivationLabel(resolvedActivationType || data.activationChoice)} • ${data.activationCode || '—'}`,
    },
    {
      label: 'العميل / المنشأة',
      value: `${data.activationCustomerName} • ${data.activationOrgName}`,
    },
    {
      label: 'المسؤول',
      value: `${data.activationContactName}${data.activationPhone ? ` • ${data.activationPhone}` : ''}`,
    },
    {
      label: 'مجال النشاط',
      value: data.activationBusinessDomain || '—',
    },
    { label: 'ملف المشروع', value: getProjectProfileLabelForWizard(data.projectProfileId) },
    { label: 'المؤسسة', value: data.companyName },
    {
      label: 'فرع / مستودع / صندوق',
      value: `${data.branchName} • ${data.warehouseName} • ${data.cashBoxName}`,
    },
    { label: 'المستخدم الأول', value: `${data.username} • ${getUserRoleLabel(data.userRole)}` },
    {
      label: 'الطابعات',
      value:
        [data.thermalPrinter && 'حرارية', data.networkPrinter && 'شبكة', data.a4Printer && 'A4'].filter(Boolean).join('، ') ||
        'لاحقاً',
    },
    {
      label: 'العملات',
      value: data.secondaryCurrency
        ? `${data.primaryCurrency} + ${data.secondaryCurrency} (${data.secondaryCurrencyRate || '-'})`
        : data.primaryCurrency,
    },
    { label: 'نمط التشغيل', value: getDeploymentSummary(deploymentConfig) },
    { label: 'تذكيرات', value: getOptionalDataSummary(data) },
  ];

  return (
    <div className="setup-step-inner">
      <dl className="setup-review-dl">
        {items.map((item) => (
          <React.Fragment key={item.label}>
            <dt className="setup-review-dt">{item.label}</dt>
            <dd className="setup-review-dd">{item.value || '—'}</dd>
          </React.Fragment>
        ))}
      </dl>
    </div>
  );
};

export default ReviewStep;
