
import React from 'react';
import { Phone, FileText, CalendarClock, DollarSign, Trash2 } from 'lucide-react';
import { Client, Invoice, formatDate, formatNumber } from '../../types';

interface Props {
    clients: Client[];
    invoices: Invoice[];
    onSelect: (client: Client) => void;
    onDelete: (id: string) => void;
}

const CustomerList: React.FC<Props> = ({ clients, invoices, onSelect, onDelete }) => {
    
    // Helpers
    const getBalanceDisplay = (client: Client) => {
        const bal = client.balance || 0;
        const color = bal > 0 ? 'text-green-600 bg-green-50' : bal < 0 ? 'text-red-600 bg-red-50' : 'text-gray-500 bg-gray-100';
        if (client.type === 'CUSTOMER') {
            return {
                text: formatNumber(Math.abs(bal)),
                color,
                label: bal > 0 ? 'عليه (دين)' : (bal < 0 ? 'له (رصيد)' : 'صافي')
            };
        }
        return {
            text: formatNumber(Math.abs(bal)),
            color,
            label: bal > 0 ? 'له (دين علينا)' : (bal < 0 ? 'لنا (مرتجع)' : 'صافي')
        };
    };

    const getClientActivity = (clientId: string) => {
        const invs = invoices.filter(i => i.clientId === clientId);
        const lastInv = invs.length > 0 ? invs.sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0] : null;
        return { count: invs.length, lastDate: lastInv ? formatDate(lastInv.date) : '-' };
    };

    return (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100">
            <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                    <tr>
                        <th className="px-6 py-4 text-right text-xs font-bold text-gray-500 uppercase">الاسم / العنوان</th>
                        <th className="px-6 py-4 text-right text-xs font-bold text-gray-500 uppercase">الاتصال</th>
                        <th className="px-6 py-4 text-right text-xs font-bold text-gray-500 uppercase">النشاط</th>
                        <th className="px-6 py-4 text-center text-xs font-bold text-gray-500 uppercase">الرصيد المالي</th>
                        <th className="px-6 py-4 text-center text-xs font-bold text-gray-500 uppercase">إجراءات</th>
                    </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                    {clients.length === 0 ? (
                        <tr><td colSpan={5} className="px-6 py-10 text-center text-gray-400 font-bold">لا يوجد بيانات لعرضها</td></tr>
                    ) : (
                        clients.map((client) => {
                            const bal = getBalanceDisplay(client);
                            const activity = getClientActivity(client.id);
                            return (
                                <tr key={client.id} className="hover:bg-blue-50/30 cursor-pointer transition group" onClick={() => onSelect(client)}>
                                    <td className="px-6 py-4">
                                        <div className="font-bold text-gray-900 text-base mb-1">{client.name}</div>
                                        <div className="text-xs text-gray-400 flex items-center gap-1">{client.address || 'لا يوجد عنوان'}</div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="text-sm text-gray-600 font-numeric flex items-center gap-2 bg-gray-50 w-fit px-2 py-1 rounded border border-gray-100">
                                            <Phone size={14} className="text-gray-400"/> {client.phone || '-'}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex flex-col gap-1">
                                            <span className="text-xs font-bold text-gray-600 flex items-center gap-1"><FileText size={12}/> {activity.count} فواتير</span>
                                            <span className="text-[10px] text-gray-400 flex items-center gap-1"><CalendarClock size={10}/> {activity.lastDate}</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-center">
                                        <div className={`inline-flex flex-col items-center justify-center px-4 py-1.5 rounded-lg border border-transparent ${bal.color}`}>
                                            <div className="font-bold font-numeric text-lg flex items-center gap-1"><DollarSign size={14}/> {bal.text}</div>
                                            <div className="text-[10px] font-bold opacity-80">{bal.label}</div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-center">
                                        <div className="flex justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button onClick={(e) => {e.stopPropagation(); onSelect(client)}} className="text-blue-600 bg-white border border-blue-200 p-2 rounded-lg hover:bg-blue-600 hover:text-white transition shadow-sm" title="التفاصيل"><FileText size={16} /></button>
                                            <button onClick={(e) => {e.stopPropagation(); onDelete(client.id)}} className="text-red-600 bg-white border border-red-200 p-2 rounded-lg hover:bg-red-600 hover:text-white transition shadow-sm" title="حذف"><Trash2 size={16} /></button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })
                    )}
                </tbody>
            </table>
        </div>
    );
};

export default CustomerList;