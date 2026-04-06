
import React, { useState, useEffect } from 'react';
import { Smartphone, Server, Trash2 } from 'lucide-react';
import { AppSettings, RegisteredDevice } from '../../types';
import { apiRequest } from '../../lib/api';

interface Props {
    settings: AppSettings;
    handleAddDevice: (device: RegisteredDevice) => void;
    handleDeleteDevice: (id: string) => void;
}

const DeviceManager: React.FC<Props> = ({ settings, handleAddDevice, handleDeleteDevice }) => {
    const [serverInfo, setServerInfo] = useState<{ ip: string, port: number, online: boolean } | null>(null);
    const [form, setForm] = useState({ name: '', role: 'warehouse_keeper', ipAddress: '' });

    useEffect(() => {
        const fetchStatus = async () => {
            try {
                const status = await apiRequest('system/status');
                setServerInfo({ ip: status.serverIp, port: status.port, online: true });
            } catch (e) {
                setServerInfo({ ip: 'غير متصل', port: 0, online: false });
            }
        };
        fetchStatus();
    }, []);

    const onSubmit = () => {
        if (!form.name || !form.ipAddress) { alert('البيانات ناقصة'); return; }
        handleAddDevice({ ...form, id: '', connectionType: 'local', notes: '', addedAt: '' });
        setForm({ name: '', role: 'warehouse_keeper', ipAddress: '' });
    };

    const normalizeDevices = (raw: unknown): RegisteredDevice[] => {
        if (Array.isArray(raw)) return raw as RegisteredDevice[];
        if (typeof raw === 'string') {
            try {
                const parsed = JSON.parse(raw);
                return Array.isArray(parsed) ? parsed : [];
            } catch {
                return [];
            }
        }
        return [];
    };
    const devices = normalizeDevices((settings as any).registeredDevices);

    return (
        <div className="space-y-6 animate-fadeIn">
            <div className="bg-gray-800 text-white p-8 rounded-2xl shadow-lg relative overflow-hidden">
                <div className="relative z-10 flex flex-col md:flex-row justify-between items-center gap-6">
                    <div>
                        <h3 className="text-2xl font-bold mb-2 flex items-center gap-2"><Server /> عنوان السيرفر (المدير)</h3>
                        <div className="bg-white/10 p-4 rounded-xl backdrop-blur-sm border border-white/20 inline-block">
                            <div className="text-3xl font-mono font-bold tracking-wide text-green-400 dir-ltr select-all">{serverInfo?.online ? serverInfo.ip : 'جاري الكشف...'}</div>
                            <div className="text-xs text-gray-400 mt-1">Port: 3333</div>
                        </div>
                    </div>
                </div>
            </div>
            <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100">
                <h3 className="text-xl font-bold mb-6 text-gray-800 flex items-center gap-2"><Smartphone className="text-primary"/> إدارة الأجهزة المصرح لها</h3>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="bg-gray-50 p-5 rounded-xl border border-gray-200 h-fit">
                        <h4 className="font-bold text-gray-700 mb-4 border-b pb-2">إضافة جهاز جديد</h4>
                        <div className="space-y-3">
                            <div><label className="block text-xs font-bold text-gray-500 mb-1">اسم الجهاز</label><input type="text" className="w-full border rounded p-2" value={form.name} onChange={e => setForm({...form, name: e.target.value})} /></div>
                            <div><label className="block text-xs font-bold text-gray-500 mb-1">المستخدم</label><select className="w-full border rounded p-2" value={form.role} onChange={e => setForm({...form, role: e.target.value})}><option value="warehouse_keeper">أمين مستودع</option><option value="accountant">محاسب</option></select></div>
                            <div><label className="block text-xs font-bold text-gray-500 mb-1">IP (اختياري)</label><input type="text" className="w-full border rounded p-2 font-mono text-sm" value={form.ipAddress} onChange={e => setForm({...form, ipAddress: e.target.value})} dir="ltr" /></div>
                            <button onClick={onSubmit} className="w-full bg-primary text-white py-2 rounded font-bold hover:bg-teal-800 transition shadow mt-2">إضافة</button>
                        </div>
                    </div>
                    <div className="lg:col-span-2">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {devices.map((device) => (
                                <div key={device.id} className="border rounded-xl p-4 flex justify-between items-start hover:shadow-md transition bg-white group">
                                    <div><div className="font-bold text-gray-800">{device.name}</div><div className="text-sm text-gray-500">{device.role}</div><div className="text-xs font-mono text-gray-400 bg-gray-50 px-2 py-1 rounded w-fit">{device.ipAddress}</div></div>
                                    <button onClick={() => handleDeleteDevice(device.id)} className="text-red-400 hover:text-red-600 hover:bg-red-50 p-2 rounded transition"><Trash2 size={16}/></button>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
export default DeviceManager;
