import React from 'react';
import useResponsiveLayout from '../../hooks/useResponsiveLayout';

type ResponsivePageProps = {
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
  maxWidth?: 'default' | 'wide' | 'full';
};

const ResponsivePage: React.FC<ResponsivePageProps> = ({
  children,
  className = '',
  contentClassName = '',
  maxWidth = 'default',
}) => {
  const layout = useResponsiveLayout();
  const maxWidthClass =
    maxWidth === 'full'
      ? 'max-w-none'
      : maxWidth === 'wide'
        ? (layout.isDesktopWide ? 'max-w-[1760px]' : 'max-w-[1600px]')
        : layout.contentMaxWidthClass;

  return (
    <div className={`w-full ${layout.pagePaddingClass} ${className}`.trim()}>
      <div className={`mx-auto w-full min-w-0 ${maxWidthClass} ${contentClassName}`.trim()}>
        {children}
      </div>
    </div>
  );
};

export default ResponsivePage;
