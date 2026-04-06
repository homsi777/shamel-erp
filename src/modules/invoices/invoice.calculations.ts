
import { InvoiceItem, METER_TO_YARD, toNumericValue } from '../../types';

export const getAdditionalCostsTotal = (purchaseCosts: any) => {
  return (parseFloat(purchaseCosts.customs) || 0) + 
         (parseFloat(purchaseCosts.shipping) || 0) + 
         (parseFloat(purchaseCosts.transport) || 0) + 
         (parseFloat(purchaseCosts.labor) || 0) + 
         (parseFloat(purchaseCosts.others) || 0);
};

export const calculateGrandTotal = (cart: InvoiceItem[], invoiceType: string, purchaseCosts: any, discount: number = 0) => {
   const itemsTotal = cart.reduce((sum, item) => sum + toNumericValue(item.total), 0);
   const baseTotal = invoiceType === 'purchase' ? itemsTotal + getAdditionalCostsTotal(purchaseCosts) : itemsTotal;
   return Math.max(0, baseTotal - (Number(discount) || 0));
};

// New Helper: Calculate extra cost per unit based on total expenses and total quantity
export const calculateExpensePerUnit = (cart: InvoiceItem[], purchaseCosts: any) => {
    const totalExpenses = getAdditionalCostsTotal(purchaseCosts);
    const totalQuantity = cart.reduce((sum, item) => sum + toNumericValue(item.quantity), 0);
    
    if (totalQuantity === 0) return 0;
    return totalExpenses / totalQuantity;
};

export const generateInvoiceNumber = (type: string, invoicesCount: number, customInvoiceNumber: string) => {
   if (customInvoiceNumber.trim() !== '') return customInvoiceNumber;
   
   const prefix = type === 'sale' ? 'SL' : type === 'purchase' ? 'PR' : type === 'return' ? 'RT' : 'doc';
   const nextNum = invoicesCount + 1;
   return `${prefix}-${new Date().getFullYear()}-${nextNum.toString().padStart(4, '0')}`;
};

export const calculateYardPrice = (priceMeter: number) => {
    return priceMeter > 0 ? (priceMeter / METER_TO_YARD) : 0;
};

export const calculateMeterPrice = (priceYard: number) => {
    return priceYard > 0 ? (priceYard * METER_TO_YARD) : 0;
};

export const calculateLineTotal = (meters: number, price: number) => {
    return meters * price;
};
