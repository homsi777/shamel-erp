import type { Currency, ProjectProfileId, UserRole } from '../../types';

export type WizardActivationChoice = 'local' | 'cloud' | 'trial';
export type WizardStepId =
  | 'activation'
  | 'profile'
  | 'company'
  | 'user'
  | 'reminders'
  | 'printers'
  | 'currency'
  | 'review';

export interface SetupWizardData {
  activationChoice: WizardActivationChoice;
  activationCode: string;
  activationCustomerName: string;
  activationOrgName: string;
  activationContactName: string;
  activationPhone: string;
  activationBusinessDomain: string;
  projectProfileId: ProjectProfileId | '';
  companyName: string;
  branchName: string;
  warehouseName: string;
  cashBoxName: string;
  username: string;
  password: string;
  userRole: UserRole;
  addOpeningBalances: boolean;
  addOpeningStock: boolean;
  thermalPrinter: string;
  networkPrinter: string;
  a4Printer: string;
  primaryCurrency: Currency;
  secondaryCurrency: Currency | '';
  secondaryCurrencyRate: string;
}

export interface WizardStepDefinition {
  id: WizardStepId;
  label: string;
  title: string;
  description: string;
}
