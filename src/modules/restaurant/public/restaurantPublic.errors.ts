/** Arabic copy for restaurant public API `code` values (no internal leakage). */

export function mapRestaurantPublicErrorCode(code: string | undefined, fallbackMessage: string): string {
  const c = String(code || '').trim();
  const map: Record<string, string> = {
    RESTAURANT_SESSION_CLOSED: 'انتهت جلسة الطاولة — لا يمكن إرسال طلب جديد.',
    RESTAURANT_NO_OPEN_SESSION: 'لا توجد جلسة مفتوحة على هذه الطاولة حاليًا.',
    RESTAURANT_ITEM_NOT_VISIBLE_IN_QR: 'أحد الأصناف لم يعد ضمن منيو QR. راجع السلة وأعد المحاولة.',
    RESTAURANT_ITEM_UNAVAILABLE: 'أحد الأصناف غير متاح حاليًا. راجع السلة أو حدّث الصفحة.',
    RESTAURANT_DUPLICATE_CLIENT_REQUEST: 'تم استلام هذا الطلب مسبقًا.',
    VALIDATION_ERROR: 'بيانات الطلب غير صالحة. حدّث الصفحة وأعد المحاولة.',
    TABLE_INACTIVE: 'الطاولة غير مفعّلة.',
    NOT_FOUND: 'رابط المنيو غير صالح.',
  };
  return map[c] || fallbackMessage;
}
