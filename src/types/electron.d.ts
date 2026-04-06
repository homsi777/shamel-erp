import type { CustomerDisplayPayload } from './customerDisplay';
import type { PromotionsDisplayPayload } from './promotionsDisplay';

declare global {
  interface Window {
    electronAPI?: {
      openCustomerDisplay: () => Promise<{ success: boolean; alreadyOpen?: boolean }>;
      closeCustomerDisplay: () => Promise<{ success: boolean }>;
      updateCustomerDisplay: (payload: CustomerDisplayPayload) => void;
      getCustomerDisplayState: () => Promise<CustomerDisplayPayload | null>;
      onCustomerDisplayUpdate: (handler: (payload: CustomerDisplayPayload) => void) => () => void;
      openPromotionsDisplay: () => Promise<{ success: boolean; alreadyOpen?: boolean }>;
      closePromotionsDisplay: () => Promise<{ success: boolean }>;
      updatePromotionsDisplay: (payload: PromotionsDisplayPayload) => void;
      getPromotionsDisplayState: () => Promise<PromotionsDisplayPayload | null>;
      onPromotionsDisplayUpdate: (handler: (payload: PromotionsDisplayPayload) => void) => () => void;
      listPrinters?: () => Promise<string[]>;
      /** طباعة مباشرة إلى طابعة محددة دون فتح نافذة (يُستخدم عند ضبط الطابعة الافتراضية في الإعدادات) */
      printToPrinter?: (printerName: string, htmlContent: string, paperSize: string) => Promise<boolean>;
      deploymentConfig?: {
        mode: 'standalone' | 'local_network';
        role: 'standalone' | 'host' | 'terminal';
        apiBaseUrl: string | null;
        canOwnBackend: boolean;
        canOwnDatabase: boolean;
        allowLocalUsbPrinting: boolean;
      };
      getDeploymentConfig?: () => Promise<{
        mode: 'standalone' | 'local_network';
        role: 'standalone' | 'host' | 'terminal';
        apiBaseUrl: string | null;
        canOwnBackend: boolean;
        canOwnDatabase: boolean;
        allowLocalUsbPrinting: boolean;
      }>;
      saveDeploymentConfig?: (config: {
        mode: 'standalone' | 'local_network';
        role: 'standalone' | 'host' | 'terminal';
        apiBaseUrl: string | null;
        canOwnBackend?: boolean;
        canOwnDatabase?: boolean;
        allowLocalUsbPrinting: boolean;
      }) => Promise<{
        mode: 'standalone' | 'local_network';
        role: 'standalone' | 'host' | 'terminal';
        apiBaseUrl: string | null;
        canOwnBackend: boolean;
        canOwnDatabase: boolean;
        allowLocalUsbPrinting: boolean;
      }>;
      restartApp?: () => Promise<boolean>;
    };
  }
}

export {};
