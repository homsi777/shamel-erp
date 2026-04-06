/**
 * Smart Drawer Hook
 * نظام البطاقة الذكية - Hook للاستخدام
 */
import { useSmartDrawerContext } from '../context/SmartDrawerProvider';
import { SmartOpenPayload, SmartEntityType } from '../types/smart';
import { useCallback } from 'react';

export const useSmartDrawer = () => {
  const context = useSmartDrawerContext();
  
  const openEntity = useCallback((type: SmartEntityType, id: string, meta?: Record<string, any>) => {
    context.open({ type, id, meta });
  }, [context]);

  const openInvoice = useCallback((invoiceId: string) => {
    openEntity('invoice', invoiceId);
  }, [openEntity]);

  const openParty = useCallback((partyId: string) => {
    openEntity('party', partyId);
  }, [openEntity]);

  const openProduct = useCallback((productId: string) => {
    openEntity('product', productId);
  }, [openEntity]);

  const openVoucher = useCallback((voucherId: string) => {
    openEntity('voucher', voucherId);
  }, [openEntity]);

  const openLedgerRow = useCallback((rowId: string, meta?: { partyId?: string; currency?: string }) => {
    openEntity('ledgerRow', rowId, meta);
  }, [openEntity]);

  const openCashBox = useCallback((cashBoxId: string) => {
    openEntity('cashBox', cashBoxId);
  }, [openEntity]);

  return {
    // State
    isOpen: context.state.isOpen,
    isLoading: context.state.isLoading,
    error: context.state.error,
    data: context.state.data,
    payload: context.state.payload,
    
    // Generic actions
    open: (payload: SmartOpenPayload) => context.open(payload),
    close: context.close,
    retry: context.retry,
    
    // Typed shortcuts
    openInvoice,
    openParty,
    openProduct,
    openVoucher,
    openLedgerRow,
    openCashBox,
    openEntity,
  };
};

export default useSmartDrawer;
