export type CustomerDisplayMode = 'standby' | 'live' | 'success';

export type CustomerDisplayLine = {
  id: string;
  name: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
};

export type CustomerDisplayPayload = {
  mode: CustomerDisplayMode;
  companyName: string;
  title: string;
  currency: 'USD' | 'SYP' | 'TRY';
  currencySymbol: string;
  items: CustomerDisplayLine[];
  cartCount: number;
  subtotal: number;
  discount: number;
  total: number;
  paid: number;
  remaining: number;
  invoiceNumber?: string;
  successMessage?: string;
  thankYouMessage?: string;
  updatedAt: string;
};

export const customerDisplayStandbyPayload = (): CustomerDisplayPayload => ({
  mode: 'standby',
  companyName: 'العالمية للمحاسبة',
  title: 'شاشة الزبون',
  currency: 'USD',
  currencySymbol: '$',
  items: [],
  cartCount: 0,
  subtotal: 0,
  discount: 0,
  total: 0,
  paid: 0,
  remaining: 0,
  successMessage: '',
  thankYouMessage: 'شكرًا لتسوقكم معنا',
  updatedAt: new Date().toISOString(),
});
