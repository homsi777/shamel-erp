export type WorkspaceItemRow = {
  key: string;
  itemId?: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  note?: string | null;
  source: 'request' | 'cashier';
  requestId?: string;
};

export type AddDialogDraftLine = {
  itemId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  note: string;
  category: string;
};

