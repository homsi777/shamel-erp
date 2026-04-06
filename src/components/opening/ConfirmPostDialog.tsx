import { confirmDialog } from '../../lib/confirm';

export const confirmPostDialog = () => {
  return confirmDialog({
    title: 'تأكيد الترحيل',
    message: 'هل تريد ترحيل القيد الآن؟ هذه العملية للعرض فقط في الواجهة الأمامية.',
    confirmText: 'ترحيل',
    cancelText: 'إلغاء'
  });
};
