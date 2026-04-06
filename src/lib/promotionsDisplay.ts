import type { InventoryItem, Promotion } from '../types';
import type { PromotionsDisplayEntry, PromotionsDisplayPayload } from '../types/promotionsDisplay';

const STORAGE_KEY = 'shamel_promotions_display_state';
const CHANNEL_NAME = 'shamel-promotions-display';

const normalizeImageList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || '').trim()).filter(Boolean);
  }
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((entry) => String(entry || '').trim()).filter(Boolean) : [];
  } catch {
    return value.split(/\r?\n|,/).map((entry) => entry.trim()).filter(Boolean);
  }
};

const normalizeItemIds = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || '').trim()).filter(Boolean);
  }
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((entry) => String(entry || '').trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
};

const buildPriceLabel = (promotion: Promotion) => {
  if (promotion.discountType === 'special_price' && Number(promotion.specialPrice || 0) > 0) {
    return `السعر الخاص ${Number(promotion.specialPrice || 0).toLocaleString('en-US')}`;
  }
  if (promotion.discountType === 'amount' && Number(promotion.discountValue || 0) > 0) {
    return `خصم مباشر ${Number(promotion.discountValue || 0).toLocaleString('en-US')}`;
  }
  return undefined;
};

const buildDiscountLabel = (promotion: Promotion) => {
  if (promotion.discountType === 'percentage' && Number(promotion.discountPercent || 0) > 0) {
    return `خصم ${Number(promotion.discountPercent || 0)}%`;
  }
  if (promotion.discountType === 'buy_quantity_discount' && Number(promotion.buyQuantity || 0) > 0) {
    return `عند شراء ${Number(promotion.buyQuantity || 0)} خصم ${Number(promotion.getDiscountPercent || 0)}%`;
  }
  return undefined;
};

export const buildPromotionsDisplayPayload = (
  promotions: Promotion[],
  items: InventoryItem[],
  companyName = 'العالمية للمحاسبة',
): PromotionsDisplayPayload => {
  const itemMap = new Map(items.map((item) => [String(item.id), item]));
  const isVisibleOnDisplay = (value: unknown) => value !== false && value !== 0 && value !== '0';
  const entries: PromotionsDisplayEntry[] = promotions
    .filter((promotion) => promotion.status === 'active' && isVisibleOnDisplay((promotion as any).showOnDisplay))
    .map((promotion) => {
      const selectedItems = normalizeItemIds(promotion.itemIds).map((itemId) => itemMap.get(String(itemId))).filter(Boolean) as InventoryItem[];
      const primaryItem =
        itemMap.get(String(promotion.primaryItemId || '')) ||
        selectedItems[0] ||
        null;
      const extraImages = normalizeImageList(promotion.extraImageUrls);
      return {
        id: promotion.id,
        name: promotion.name,
        description: promotion.description,
        offerBarcode: promotion.offerBarcode,
        startDate: promotion.startDate,
        endDate: promotion.endDate,
        status: promotion.status,
        displayOrder: Number(promotion.displayOrder || 0),
        displayDurationSeconds: Math.max(5, Number(promotion.displayDurationSeconds || 10)),
        mainImageUrl: promotion.mainImageUrl || primaryItem?.imageUrl || extraImages[0],
        extraImageUrls: extraImages,
        itemNames: selectedItems.map((item) => item.name).filter(Boolean),
        priceLabel: buildPriceLabel(promotion),
        discountLabel: buildDiscountLabel(promotion),
      };
    })
    .sort((a, b) => (a.displayOrder - b.displayOrder) || a.name.localeCompare(b.name, 'ar'));

  return {
    companyName,
    title: 'شاشة العروض',
    entries,
    updatedAt: new Date().toISOString(),
  };
};

export const publishPromotionsDisplayState = (payload: PromotionsDisplayPayload) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {}

  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(CHANNEL_NAME);
      channel.postMessage(payload);
      channel.close();
    }
  } catch {}

  try {
    window.electronAPI?.updatePromotionsDisplay?.(payload);
  } catch {}
};

export const readPromotionsDisplayState = (): PromotionsDisplayPayload | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

export const openPromotionsDisplayFallback = () => {
  const url = `${window.location.origin}${window.location.pathname}#/promotions-display`;
  const opened = window.open(url, 'shamel-promotions-display', 'popup=yes,width=1600,height=900');
  return Boolean(opened);
};

export const promotionsDisplayChannelName = CHANNEL_NAME;
export const promotionsDisplayStorageKey = STORAGE_KEY;
