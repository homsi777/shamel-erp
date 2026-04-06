export interface PublicMenuItem {
  itemId: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  unitName: string | null;
  basePrice: number;
  sortOrder: number;
}

export interface PublicMenuCategory {
  name: string;
  items: PublicMenuItem[];
}

export interface PublicPriorRequestLine {
  name: string;
  quantity: number;
  note?: string | null;
}

export interface PublicPriorRequest {
  id: string;
  status: string;
  submittedAt: string;
  note: string | null;
  lines: PublicPriorRequestLine[];
}

export interface PublicMenuPayload {
  table: { code: string; name: string; zoneName: string | null };
  publicToken: string;
  sessionOpen: boolean;
  session: { status: string; openedAt: string } | null;
  menuCategories: PublicMenuCategory[];
  priorRequests: PublicPriorRequest[];
  notice: string;
  /** صحيح عند أول فتح للمنيو وإنشاء جلسة تلقائياً من QR */
  qrGuestAutoSession?: boolean;
}
