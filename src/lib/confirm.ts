export type ConfirmOptions = {
  message: string;
  title?: string;
  confirmText?: string;
  cancelText?: string;
};

const CONFIRM_EVENT_NAME = 'shamel-confirm';

export const confirmDialog = (options: ConfirmOptions | string): Promise<boolean> => {
  const normalized: ConfirmOptions = typeof options === 'string' ? { message: options } : options;
  return new Promise((resolve) => {
    window.dispatchEvent(new CustomEvent(CONFIRM_EVENT_NAME, { detail: { ...normalized, resolve } }));
  });
};

