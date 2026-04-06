import React from 'react';
import useResponsiveLayout from '../../hooks/useResponsiveLayout';

type AdaptiveModalProps = {
  open: boolean;
  onClose?: () => void;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  zIndex?: number;
  panelClassName?: string;
  overlayClassName?: string;
  closeOnBackdrop?: boolean;
  mobilePresentation?: 'fullscreen' | 'sheet';
};

const sizeClassMap: Record<NonNullable<AdaptiveModalProps['size']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
  xl: 'max-w-6xl',
};

const AdaptiveModal: React.FC<AdaptiveModalProps> = ({
  open,
  onClose,
  children,
  size = 'md',
  zIndex = 500,
  panelClassName = '',
  overlayClassName = '',
  closeOnBackdrop = true,
  mobilePresentation = 'fullscreen',
}) => {
  const layout = useResponsiveLayout();

  if (!open) return null;

  const panelBaseClass = layout.isMobile
    ? mobilePresentation === 'sheet'
      ? 'mt-auto w-full max-w-none max-h-[90dvh] rounded-t-[1.5rem] android-safe-bottom overscroll-contain'
      : 'h-[100dvh] w-full max-w-none rounded-none android-safe-bottom overscroll-contain'
    : layout.isTablet
      ? `w-full ${sizeClassMap[size]} max-w-[calc(100vw-2rem)] max-h-[92vh] rounded-[1.75rem]`
      : `w-full ${sizeClassMap[size]} max-h-[92vh] rounded-2xl`;

  return (
    <div
      className={`fixed inset-0 bg-black/60 backdrop-blur-sm flex justify-center ${layout.isMobile ? (mobilePresentation === 'sheet' ? 'items-end p-0' : 'items-stretch p-0') : 'items-center p-4'} animate-fadeIn ${overlayClassName}`.trim()}
      style={{ zIndex }}
      onClick={closeOnBackdrop ? onClose : undefined}
    >
      <div
        className={`bg-white shadow-2xl overflow-hidden ${panelBaseClass} ${panelClassName}`.trim()}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
};

export default AdaptiveModal;
