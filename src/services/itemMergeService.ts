import { apiRequest } from '../lib/api';
import type { InventoryItem, ItemGroupItem, ItemMergePreview, ItemMergeResult } from '../types';

const countInvoiceLines = (invoices: any[], sourceItemId: string) => {
  let affectedInvoiceCount = 0;
  let affectedInvoiceLineCount = 0;
  for (const invoice of invoices || []) {
    const lines = Array.isArray(invoice?.items) ? invoice.items : [];
    const matches = lines.filter((line: any) => String(line?.itemId || '') === sourceItemId).length;
    if (matches > 0) {
      affectedInvoiceCount += 1;
      affectedInvoiceLineCount += matches;
    }
  }
  return { affectedInvoiceCount, affectedInvoiceLineCount };
};

export const buildItemMergePreview = async (
  sourceItem: InventoryItem | null,
  targetItem: InventoryItem | null,
  itemGroupItems: ItemGroupItem[] = [],
): Promise<ItemMergePreview | null> => {
  if (!sourceItem || !targetItem) return null;

  const [invoices, transfers, agentInventory, deliveryNotices, inventoryTransactions] = await Promise.all([
    apiRequest('invoices').catch(() => []),
    apiRequest('inventory/transfers').catch(() => []),
    apiRequest('agent-inventory').catch(() => []),
    apiRequest('delivery-notices').catch(() => []),
    apiRequest('inventory-transactions').catch(() => []),
  ]);

  const sourceItemId = String(sourceItem.id);
  const targetItemId = String(targetItem.id);
  const { affectedInvoiceCount, affectedInvoiceLineCount } = countInvoiceLines(Array.isArray(invoices) ? invoices : [], sourceItemId);
  const affectedTransferCount = (Array.isArray(transfers) ? transfers : []).filter((row: any) =>
    [row?.itemId, row?.fromItemId, row?.toItemId].some((value) => String(value || '') === sourceItemId),
  ).length;
  const affectedAgentInventoryCount = (Array.isArray(agentInventory) ? agentInventory : []).filter((row: any) => String(row?.itemId || '') === sourceItemId).length;
  const affectedDeliveryNoticeCount = (Array.isArray(deliveryNotices) ? deliveryNotices : []).filter((notice: any) => {
    const lines = Array.isArray(notice?.items) ? notice.items : [];
    return lines.some((line: any) => String(line?.itemId || '') === sourceItemId);
  }).length;
  const affectedItemGroupLinks = (itemGroupItems || []).filter((row) => String(row.itemId || '') === sourceItemId).length;
  const affectedInventoryTransactionCount = (Array.isArray(inventoryTransactions) ? inventoryTransactions : []).filter((row: any) => String(row?.itemId || '') === sourceItemId).length;

  const warnings: string[] = ['هذه العملية حساسة ولا يمكن التراجع عنها تلقائيًا بعد التنفيذ.'];
  if (sourceItem.warehouseId !== targetItem.warehouseId) warnings.push('المادتان في مستودعين مختلفين.');
  if (sourceItem.unitId !== targetItem.unitId) warnings.push('المادتان بوحدتين مختلفتين.');
  if (sourceItemId === targetItemId) warnings.push('لا يمكن دمج المادة بنفسها.');
  if (sourceItem.merged || sourceItem.inactive) warnings.push('المادة المصدر غير صالحة للدمج.');
  if (targetItem.inactive) warnings.push('المادة الهدف غير صالحة للدمج.');

  const affectedRecordsCount =
    affectedInvoiceLineCount +
    affectedTransferCount +
    affectedAgentInventoryCount +
    affectedDeliveryNoticeCount +
    affectedItemGroupLinks +
    affectedInventoryTransactionCount;

  return {
    sourceItemId,
    targetItemId,
    sourceItemName: sourceItem.name,
    targetItemName: targetItem.name,
    quantityToTransfer: Number(sourceItem.quantity || 0),
    affectedInvoiceCount,
    affectedInvoiceLineCount,
    affectedTransferCount,
    affectedAgentInventoryCount,
    affectedDeliveryNoticeCount,
    affectedItemGroupLinks,
    affectedInventoryTransactionCount,
    affectedRecordsCount,
    warnings,
  };
};

export const executeItemMerge = async (payload: { sourceItemId: string; targetItemId: string; userId: string }) =>
  apiRequest('inventory/merge', {
    method: 'POST',
    body: JSON.stringify(payload),
  }) as Promise<ItemMergeResult>;
