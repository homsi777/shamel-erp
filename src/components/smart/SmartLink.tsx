/**
 * Smart Link Component
 * عنصر قابل للنقر يفتح Drawer
 */
import React from 'react';
import { Eye } from 'lucide-react';
import { SmartEntityType } from '../../types/smart';
import { useSmartDrawer } from '../../hooks/useSmartDrawer';

interface SmartLinkProps {
  type: SmartEntityType;
  id: string;
  meta?: Record<string, any>;
  children: React.ReactNode;
  tooltip?: string;
  showIcon?: boolean;
  className?: string;
  /** Don't change the text style, only add click handler */
  inheritStyle?: boolean;
}

const SmartLink: React.FC<SmartLinkProps> = ({
  type,
  id,
  meta,
  children,
  tooltip,
  showIcon = false,
  className = '',
  inheritStyle = false,
}) => {
  const { open } = useSmartDrawer();

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    open({ type, id, meta });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open({ type, id, meta });
    }
  };

  if (inheritStyle) {
    return (
      <span
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        title={tooltip || 'انقر لعرض التفاصيل'}
        className={`cursor-pointer ${className}`}
      >
        {children}
      </span>
    );
  }

  return (
    <span
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      title={tooltip || 'انقر لعرض التفاصيل'}
      className={`
        inline-flex items-center gap-1 
        text-primary hover:text-primary/80 
        cursor-pointer 
        hover:underline underline-offset-2
        transition-colors
        ${className}
      `}
    >
      {children}
      {showIcon && <Eye size={14} className="opacity-60" />}
    </span>
  );
};

export default SmartLink;
