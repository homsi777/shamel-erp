
import React from 'react';
import { Settings as SettingsIcon, Save, RefreshCw, Activity, Trash2, CheckCircle2 } from 'lucide-react';
import { AppSettings, AppUser } from '../types';
import { isSyncedMode } from '../lib/appMode';
import { getEffectiveVisibleSettingsTabs } from '../lib/systemModules';
import { resolveProjectProfile } from '../lib/projectProfiles';
import { useSettings } from '../hooks/useSettings';
import { useSyncQueue } from '../hooks/useSyncQueue'; 

// Components
import SettingsSidebar from '../components/settings/SettingsSidebar';
import CompanyForm from '../components/settings/CompanyForm';
import ThemeForm from '../components/settings/ThemeForm';
import LabelsEditor from '../components/settings/LabelsEditor';
import PrintingInvoicesHub from '../components/settings/PrintingInvoicesHub';
import DeploymentModeSettings from '../components/settings/DeploymentModeSettings';
import DeviceManager from '../components/settings/DeviceManager';
import UserManager from '../components/settings/UserManager';
import CloudLink from '../components/settings/CloudLink';
import CurrencySettings from '../components/settings/CurrencySettings';
import PricingSettings from '../components/settings/PricingSettings';
import InvoiceSettings from '../components/settings/InvoiceSettings';
import ItemSettings from '../components/settings/ItemSettings';
import { DatabaseStatus } from '../components/settings/DatabaseStatus';
import BackupManager from '../components/settings/BackupManager';
import { ResponsiveActionBar, ResponsivePage, ResponsiveTableContainer } from '../components/responsive';

interface SettingsProps {
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  users: AppUser[];
  setUsers: React.Dispatch<React.SetStateAction<AppUser[]>>;
}

const SettingsPage: React.FC<SettingsProps> = ({ settings, setSettings, users, setUsers }) => {
  const isSynced = isSyncedMode();
  const { state, setters, actions } = useSettings(settings, setSettings);
  const { syncLogs, clearLogs } = useSyncQueue(); 
  const resolvedProfile = React.useMemo(() => resolveProjectProfile(settings), [settings]);
  const effectiveSettingsTabs = React.useMemo(
    () => getEffectiveVisibleSettingsTabs(resolvedProfile.id, settings.moduleControl),
    [resolvedProfile.id, settings.moduleControl],
  );
  const allowedTabs = React.useMemo(() => {
    const next = new Set<string>(effectiveSettingsTabs);
    if (!isSynced) {
      next.delete('cloud_link');
      next.delete('sync');
    }
    return next;
  }, [effectiveSettingsTabs, isSynced]);

  React.useEffect(() => {
    if (!allowedTabs.has(state.activeTab)) {
      const [firstAllowed] = Array.from(allowedTabs);
      setters.setActiveTab(firstAllowed || 'company');
    }
  }, [allowedTabs, state.activeTab, setters]);

  const updateThermal = (field: string, value: any) => {
      if (!state.localSettings.print) return;
      const current = state.localSettings.print;
      const thermal = current.thermal || { enabled: false, printerId: '', paperSize: '80mm', autoPrintPos: true };
      const newSettings: AppSettings = {
          ...state.localSettings,
          print: { ...current, thermal: { ...thermal, [field]: value } }
      };
      setters.setLocalSettings(newSettings);
  };

  const updateRestaurant = (field: string, value: any) => {
    if (!state.localSettings.print) return;
    const current = state.localSettings.print;
    const restaurant = current.restaurant || {};
    const newSettings: AppSettings = {
      ...state.localSettings,
      print: { ...current, restaurant: { ...restaurant, [field]: value } },
    };
    setters.setLocalSettings(newSettings);
  };

  return (
    <ResponsivePage className="bg-gray-50 min-h-screen" contentClassName="pb-20" maxWidth="wide">
      <ResponsiveActionBar className="mb-6 justify-between">
        <h2 className="flex items-center gap-3 text-2xl font-bold text-gray-900 md:text-3xl"><SettingsIcon size={32} className="text-gray-600"/> لوحة التحكم والإعدادات</h2>
        {state.activeTab !== 'sync' && state.activeTab !== 'cloud_link' && (
            <button 
                onClick={actions.handleSaveSettings} 
                disabled={state.isSaving}
                className="bg-gray-900 hover:bg-black text-white px-8 py-3 rounded-xl font-bold shadow-xl flex items-center gap-2 fixed bottom-6 left-6 z-50 md:static transition"
            >
                {state.isSaving ? <RefreshCw className="animate-spin" size={20}/> : <Save size={20} />} 
                حفظ التغييرات
            </button>
        )}
      </ResponsiveActionBar>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:gap-8">
        <SettingsSidebar activeTab={state.activeTab} setActiveTab={setters.setActiveTab} allowedTabs={allowedTabs} />

        <div className="col-span-12 lg:col-span-10">
          {state.activeTab === 'company' && <CompanyForm settings={state.localSettings} updateCompany={actions.updateCompany} />}
          {state.activeTab === 'labels' && <LabelsEditor settings={state.localSettings} updateLabel={actions.updateLabel} />}
          {state.activeTab === 'currency' && <CurrencySettings settings={state.localSettings} updateCurrencyRate={actions.updateCurrencyRate} updateDefaultCurrency={actions.updateDefaultCurrency} />}
          {state.activeTab === 'theme' && <ThemeForm settings={state.localSettings} updateTheme={actions.updateTheme} />}
          {state.activeTab === 'pricing_settings' && <PricingSettings />}
          {state.activeTab === 'invoice_settings' && <InvoiceSettings />}
          {state.activeTab === 'item_settings' && (
            <ItemSettings
              settings={state.localSettings}
              onChange={(itemSettings) => setters.setLocalSettings((prev) => ({ ...prev, itemSettings }))}
              onSave={actions.handleSaveSettings}
              saving={state.isSaving}
            />
          )}
          {state.activeTab === 'printing_invoices' && (
            <PrintingInvoicesHub
              settings={state.localSettings}
              updatePrintProfile={actions.updatePrintProfile}
              updateThermal={updateThermal}
              updatePrintField={actions.updatePrintField}
              updateRestaurant={updateRestaurant}
              companyId={(state.localSettings as any)?.company?.id}
            />
          )}
          {state.activeTab === 'deployment' && (
            <DeploymentModeSettings
              value={state.localSettings.deployment}
              onChange={(deployment) => setters.setLocalSettings((prev) => ({ ...prev, deployment }))}
              hint="اختر هذا الإعداد لكل جهاز على حدة. Terminal يحتاج عنوان Host واضح، وStandalone لا يحتاج أي إعداد شبكة."
            />
          )}
          {state.activeTab === 'devices' && <DeviceManager settings={state.localSettings} handleAddDevice={actions.handleAddDevice} handleDeleteDevice={actions.handleDeleteDevice} />}
          {state.activeTab === 'users' && <UserManager users={users} setUsers={setUsers} />}
          {state.activeTab === 'dbstatus' && <DatabaseStatus />}
          {state.activeTab === 'backups' && <BackupManager />}
          {isSynced && state.activeTab === 'cloud_link' && <CloudLink />}
          {isSynced && state.activeTab === 'sync' && (
              <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100 animate-fadeIn">
                  <div className="flex justify-between items-center mb-6">
                      <div>
                          <h3 className="text-xl font-bold text-gray-800 flex items-center gap-2"><Activity className="text-green-600"/> سجل المزامنة (Sync Logs)</h3>
                          <p className="text-gray-500 text-sm mt-1">عرض العمليات التي تم حفظها أثناء وضع عدم الاتصال (Offline) وتمت مزامنتها بنجاح.</p>
                      </div>
                      <button onClick={clearLogs} className="text-red-500 hover:text-red-700 font-bold flex items-center gap-2 text-sm border border-red-200 px-3 py-2 rounded-lg hover:bg-red-50">
                          <Trash2 size={16}/> مسح السجل
                      </button>
                  </div>

                  <ResponsiveTableContainer className="rounded-xl shadow-sm" minTableWidthClassName="min-w-[820px]">
                      <table className="w-full text-right">
                          <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
                              <tr>
                                  <th className="p-4">وقت المزامنة</th>
                                  <th className="p-4">نوع العملية</th>
                                  <th className="p-4">الوجهة (Endpoint)</th>
                                  <th className="p-4">التفاصيل</th>
                                  <th className="p-4 text-center">الحالة</th>
                              </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 bg-white">
                              {syncLogs.length === 0 ? (
                                  <tr><td colSpan={5} className="p-8 text-center text-gray-400">سجل المزامنة فارغ.</td></tr>
                              ) : (
                                  syncLogs.map((log: any) => (
                                      <tr key={log.id} className="hover:bg-green-50/30 transition">
                                          <td className="p-4 text-sm font-numeric text-gray-600" dir="ltr">{new Date(log.syncedAt).toLocaleString('ar-EG')}</td>
                                          <td className="p-4">
                                              <span className={`px-2 py-1 rounded text-xs font-bold ${log.method === 'POST' ? 'bg-blue-100 text-blue-700' : log.method === 'PUT' ? 'bg-orange-100 text-orange-700' : 'bg-red-100 text-red-700'}`}>
                                                  {log.method}
                                              </span>
                                          </td>
                                          <td className="p-4 font-mono text-xs text-gray-500">{log.endpoint}</td>
                                          <td className="p-4 text-xs text-gray-400 truncate max-w-xs" title={log.payloadSummary}>{log.payloadSummary}</td>
                                          <td className="p-4 text-center">
                                              <div className="flex items-center justify-center gap-1 text-green-600 font-bold text-xs">
                                                  <CheckCircle2 size={14}/> تم
                                              </div>
                                          </td>
                                      </tr>
                                  ))
)}
                          </tbody>
                      </table>
                  </ResponsiveTableContainer>
              </div>
          )}
        </div>
      </div>
    </ResponsivePage>
  );
};

export default SettingsPage;


