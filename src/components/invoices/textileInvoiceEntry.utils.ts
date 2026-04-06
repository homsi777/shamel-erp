export const shouldUseTextileEntryLayout = (
  textileModeEnabled: boolean,
  invoiceType: 'sale' | 'purchase' | 'opening_stock',
) => textileModeEnabled && invoiceType !== 'opening_stock';

export const shouldShowTextileDecompositionButton = (params: {
  textileModeEnabled: boolean;
  invoiceType: 'sale' | 'purchase' | 'opening_stock';
  entryIsTextile?: boolean;
  selectedItemIsTextile?: boolean;
}) => (
  shouldUseTextileEntryLayout(params.textileModeEnabled, params.invoiceType)
  && params.invoiceType === 'sale'
  && Boolean(params.entryIsTextile || params.selectedItemIsTextile)
);

export const shouldAutoCreatePurchaseMaterialOnEnter = (invoiceType: 'sale' | 'purchase' | 'opening_stock') => (
  invoiceType === 'purchase'
);

export const normalizeTextileDecompositionDraft = (
  rows: Array<{ sequence: number; lengthValue: string | number; unit: 'meter' | 'yard'; rollLabel?: string | null }>,
  unit: 'meter' | 'yard',
) => {
  const normalized = rows.map((row) => ({
    sequence: row.sequence,
    lengthValue: Number(row.lengthValue || 0),
    unit,
    rollLabel: row.rollLabel || null,
  }));
  const totalLength = normalized.reduce((sum, row) => sum + Number(row.lengthValue || 0), 0);
  const isComplete = normalized.length > 0 && normalized.every((row) => Number(row.lengthValue || 0) > 0);
  return { rows: normalized, totalLength, isComplete };
};
