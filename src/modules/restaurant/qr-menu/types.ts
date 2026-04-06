import type { InventoryItem } from '../../../types';
import type { RestaurantMenuItemRow } from '../restaurant.api';

export type MenuItemStatusFilter = 'all' | 'active' | 'hidden';

export type MenuDisplayItem = {
  row: RestaurantMenuItemRow;
  inventoryItem: InventoryItem | null;
  itemId: string;
  name: string;
  category: string;
  price: number;
  imageUrl: string | null;
  status: 'active' | 'hidden';
  isAvailableNow: boolean;
  description: string | null;
};

