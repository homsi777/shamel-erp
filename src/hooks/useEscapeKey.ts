import { useEffect } from 'react';

/**
 * Closes a modal/dialog when Escape key is pressed.
 */
export const useEscapeKey = (isOpen: boolean, onClose: () => void) => {
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);
};

/**
 * Hook that listens to the global 'shamel-modal-escape' custom event.
 * Pages use this to close their modals when ESC is pressed globally.
 */
export const useModalEscape = (isOpen: boolean, onClose: () => void) => {
  useEffect(() => {
    if (!isOpen) return;
    const handler = () => onClose();
    window.addEventListener('shamel-modal-escape', handler);
    return () => window.removeEventListener('shamel-modal-escape', handler);
  }, [isOpen, onClose]);
};
