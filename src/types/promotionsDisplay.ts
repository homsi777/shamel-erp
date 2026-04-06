export interface PromotionsDisplayEntry {
  id: string;
  name: string;
  description?: string;
  offerBarcode?: string;
  startDate: string;
  endDate: string;
  status: 'active' | 'inactive';
  displayOrder: number;
  displayDurationSeconds: number;
  mainImageUrl?: string;
  extraImageUrls: string[];
  itemNames: string[];
  priceLabel?: string;
  discountLabel?: string;
}

export interface PromotionsDisplayPayload {
  companyName: string;
  title: string;
  entries: PromotionsDisplayEntry[];
  updatedAt: string;
}
