/**
 * Recent print_jobs audit (troubleshooting / admin).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { getApiBase } from '../../lib/printEngine';
import { getCurrentOrgId } from '../../lib/api';

type Row = {
  id: string;
  createdAt?: string;
  printedAt?: string | null;
  invoiceId?: string | null;
  invoiceNumber?: string | null;
  printType?: string;
  documentType?: string | null;
  printerAddress?: string | null;
  printerConnectionType?: string | null;
  status?: string;
  errorMessage?: string | null;
  source?: string | null;
  copies?: number | null;
};

const PrintJobsHistoryPanel: React.FC = () => {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('auth_token') : null;
      const companyId = getCurrentOrgId();
      const qs = new URLSearchParams({ limit: '50' });
      if (companyId) qs.set('companyId', companyId);
      const res = await fetch(`${getApiBase()}/print/jobs?${qs}`, {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      const j = (await res.json()) as any;
      if (!res.ok) throw new Error(j?.error || 'فشل التحميل');
      setRows(Array.isArray(j?.data) ? j.data : []);
    } catch (e: any) {
      setErr(e?.message || 'خطأ');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-gray-600">
          آخر محاولات الطباعة (زبون / مطبخ) — تُسجّل تلقائياً عند كل محاولة.
        </p>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-800 hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          تحديث
        </button>
      </div>
      {err && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{err}</div>}
      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="min-w-full text-right text-xs">
          <thead className="bg-gray-50 font-black text-gray-700">
            <tr>
              <th className="px-2 py-2">الوقت</th>
              <th className="px-2 py-2">الفاتورة</th>
              <th className="px-2 py-2">النوع</th>
              <th className="px-2 py-2">الهدف</th>
              <th className="px-2 py-2">الحالة</th>
              <th className="px-2 py-2">المصدر</th>
              <th className="px-2 py-2">خطأ</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-gray-400">
                  لا توجد سجلات بعد
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50/80">
                <td className="px-2 py-2 font-mono whitespace-nowrap">{r.createdAt || '—'}</td>
                <td className="px-2 py-2 font-mono">{r.invoiceNumber || r.invoiceId || '—'}</td>
                <td className="px-2 py-2">{r.printType || r.documentType || '—'}</td>
                <td className="px-2 py-2 max-w-[200px] truncate font-mono" title={r.printerAddress || ''}>
                  {r.printerConnectionType || '—'} {r.printerAddress ? `· ${r.printerAddress}` : ''}
                </td>
                <td className="px-2 py-2 font-bold">{r.status || '—'}</td>
                <td className="px-2 py-2">{r.source || '—'}</td>
                <td className="px-2 py-2 font-mono text-red-700 max-w-[220px] truncate" title={r.errorMessage || ''}>
                  {r.errorMessage || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default PrintJobsHistoryPanel;
