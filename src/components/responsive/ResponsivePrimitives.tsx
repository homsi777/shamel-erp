import React from 'react';
import useResponsiveLayout from '../../hooks/useResponsiveLayout';

type ResponsiveSectionProps = {
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
};

export const ResponsiveSection: React.FC<ResponsiveSectionProps> = ({
  children,
  className = '',
  padded = true,
}) => {
  const layout = useResponsiveLayout();
  const paddingClass = !padded ? '' : layout.isMobile ? 'p-3' : layout.isTablet ? 'p-4' : 'p-5';
  return (
    <section className={`rounded-2xl border border-gray-100 bg-white shadow-sm ${paddingClass} ${className}`.trim()}>
      {children}
    </section>
  );
};

type ResponsiveFormGridProps = {
  children: React.ReactNode;
  className?: string;
  columns?: '2' | '3' | '4';
};

const formGridClassMap: Record<NonNullable<ResponsiveFormGridProps['columns']>, string> = {
  '2': 'grid-cols-1 md:grid-cols-2',
  '3': 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3',
  '4': 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-4',
};

export const ResponsiveFormGrid: React.FC<ResponsiveFormGridProps> = ({
  children,
  className = '',
  columns = '3',
}) => (
  <div className={`grid gap-3 ${formGridClassMap[columns]} ${className}`.trim()}>
    {children}
  </div>
);

type ResponsiveActionBarProps = {
  children: React.ReactNode;
  className?: string;
};

export const ResponsiveActionBar: React.FC<ResponsiveActionBarProps> = ({ children, className = '' }) => (
  <div className={`flex flex-wrap items-center gap-2 sm:gap-3 ${className}`.trim()}>
    {children}
  </div>
);

type ResponsiveTableContainerProps = {
  children: React.ReactNode;
  className?: string;
  minTableWidthClassName?: string;
};

export const ResponsiveTableContainer: React.FC<ResponsiveTableContainerProps> = ({
  children,
  className = '',
  minTableWidthClassName = 'min-w-[680px]',
}) => (
  <div className={`w-full overflow-x-auto rounded-2xl border border-gray-200 bg-white ${className}`.trim()}>
    <div className={minTableWidthClassName}>{children}</div>
  </div>
);

