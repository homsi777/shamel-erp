import { apiRequest } from '../lib/api';
import type {
  BulkPriceUpdateRequest,
  BulkPriceScope,
  BulkPriceUpdatePayload,
  InventoryItem,
  PriceUpdatePreviewResult,
} from '../types';
import { buildBulkPricePreview, type CurrencyRatesMap } from '../lib/bulkPriceEngine';

export const buildPriceUpdatePreview = (
  items: InventoryItem[],
  payload: BulkPriceUpdatePayload,
  currencyRates: CurrencyRatesMap = { USD: 1 },
): PriceUpdatePreviewResult => buildBulkPricePreview(items, payload, currencyRates);

const requestBulkPriceUpdate = async (request: BulkPriceUpdateRequest) =>
  apiRequest('inventory/bulk-price-update', {
    method: 'POST',
    body: JSON.stringify(request),
  }) as Promise<PriceUpdatePreviewResult>;

export const previewBulkPriceUpdate = async ({
  payload,
  currencyRates,
  userId,
}: {
  payload: BulkPriceUpdatePayload;
  currencyRates: CurrencyRatesMap;
  userId: string;
}) => requestBulkPriceUpdate({ mode: 'preview', payload, currencyRates, userId });

export const applyBulkPriceUpdate = async ({
  payload,
  currencyRates,
  userId,
}: {
  payload: BulkPriceUpdatePayload;
  currencyRates: CurrencyRatesMap;
  userId: string;
}) => requestBulkPriceUpdate({ mode: 'execute', payload, currencyRates, userId });

export const getSupportedScopeOptions = (
  selectedCount: number,
  hasGroups: boolean,
): Array<{ value: BulkPriceScope; enabled: boolean }> => [
  { value: 'single', enabled: selectedCount === 1 },
  { value: 'selected', enabled: selectedCount > 1 },
  { value: 'all', enabled: true },
  { value: 'category', enabled: true },
  { value: 'unit', enabled: true },
  { value: 'group', enabled: hasGroups },
];
