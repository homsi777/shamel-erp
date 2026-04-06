import React, { Suspense, lazy } from 'react';
import type { AppUser } from '../../types';

const RestaurantOperationsDashboard = lazy(() => import('./RestaurantOperationsDashboard'));

const ShellFallback: React.FC = () => (
  <div className="flex min-h-[240px] items-center justify-center bg-gray-50 text-sm font-bold text-gray-500" dir="rtl">
    جاري تحميل المطعم…
  </div>
);

export type RestaurantModuleView = 'tables' | 'qr';

export interface RestaurantModuleProps {
  view: RestaurantModuleView;
  currentUser?: AppUser;
}

/**
 * Lazy-loaded shell: loads only the active sub-screen chunk.
 */
const RestaurantModule: React.FC<RestaurantModuleProps> = ({ view, currentUser }) => {
  return (
    <Suspense fallback={<ShellFallback />}>
      {/* UI-only concept: both "tables" and "qr" routes show the same unified operations dashboard */}
      <RestaurantOperationsDashboard currentUser={currentUser} />
    </Suspense>
  );
};

export default RestaurantModule;
