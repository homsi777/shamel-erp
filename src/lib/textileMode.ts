import type { AppSettings } from '../types';

export const isTextileModeEnabled = (settings?: Partial<AppSettings> | null) =>
  Boolean(settings?.itemSettings?.enableTextileMode);

export const textileRequiresWarehousePreparation = (settings?: Partial<AppSettings> | null) =>
  settings?.itemSettings?.textileRequireWarehousePreparationForSales !== false;
