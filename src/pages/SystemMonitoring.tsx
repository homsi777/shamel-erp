import React from 'react';
import { ShieldAlert } from 'lucide-react';
import { shouldUseLocalApiRuntime } from '../lib/runtimeContext';
import SystemMonitoringDashboard from '../modules/system-monitoring/SystemMonitoringDashboard';

const SystemMonitoringPage: React.FC = () => {
  if (shouldUseLocalApiRuntime()) {
    return (
      <div className="min-h-full p-4 md:p-6" dir="rtl">
        <div className="mx-auto max-w-5xl rounded-3xl border border-amber-200 bg-gradient-to-l from-amber-50 via-white to-white p-8 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="rounded-2xl bg-amber-100 p-3 text-amber-700">
              <ShieldAlert size={28} />
            </div>
            <div>
              <h1 className="text-2xl font-black text-gray-900">مركز المراقبة التشغيلية</h1>
              <p className="mt-2 text-sm font-bold leading-7 text-gray-600">
                هذه الشاشة تعتمد على الخادم canonical وطبقة <span className="font-mono">system_events</span>.
                في وضع <span className="font-mono">local runtime</span> المباشر لا توجد طبقة backend مراقَبة بنفس
                النموذج، لذلك لا يتم عرض مركز التشغيل هنا.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return <SystemMonitoringDashboard />;
};

export default SystemMonitoringPage;
