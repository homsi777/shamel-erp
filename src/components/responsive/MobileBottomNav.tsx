import React from 'react';

type MobileBottomNavItem = {
  id: string;
  label: string;
  icon: React.ReactNode;
  active?: boolean;
  onClick: () => void;
};

type MobileBottomNavProps = {
  items: MobileBottomNavItem[];
  className?: string;
};

const MobileBottomNav: React.FC<MobileBottomNavProps> = ({ items, className = '' }) => {
  if (items.length === 0) return null;

  return (
    <div className={`fixed inset-x-0 bottom-0 z-[140] border-t border-white/60 bg-white/95 backdrop-blur-xl shadow-[0_-12px_40px_rgba(15,23,42,0.12)] android-safe-bottom ${className}`.trim()}>
      <div className="grid grid-cols-5 gap-1 px-2 py-2">
        {items.map((item) => (
          <button
            key={item.id}
            onClick={item.onClick}
            className={`flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2 text-[11px] font-black transition tap-feedback ${
              item.active ? 'bg-primary text-white shadow-lg' : 'text-slate-500 hover:bg-slate-100'
            }`}
          >
            <span className="shrink-0">{item.icon}</span>
            <span className="truncate">{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

export type { MobileBottomNavItem };
export default MobileBottomNav;
