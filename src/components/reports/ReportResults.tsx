import React, { useMemo, useState } from 'react';
import { CheckCircle2, Search, XCircle, Printer, Table2 } from 'lucide-react';
import { ReportData } from '../../modules/reports/report.types';
import { AppSettings, formatDate } from '../../types';
import { accountingNumberClass, formatAccountingNumber, formatPercent } from '../../lib/formatters';
import SmartLink from '../smart/SmartLink';
import { AdaptiveTable } from '../responsive';
import useResponsiveLayout from '../../hooks/useResponsiveLayout';

interface Props {
  data: ReportData | null;
  searchQuery: string;
  onSearchChange: (val: string) => void;
  settings?: AppSettings;
  reportId?: string;
  allowPrint?: boolean;
  printBlockReason?: string;
  /** When provided, report row cells with referenceType/referenceId can navigate to the exact record (e.g. invoice, consignment). */
  onNavigateToRecord?: (referenceType: string, referenceId: string) => void;
}

const typeLabel: Record<string, string> = {
  assets: 'الأصول',
  liabilities: 'الخصوم',
  equity: 'حقوق الملكية',
  revenue: 'الإيرادات',
  expenses: 'المصروفات',
};

const ReportResults: React.FC<Props> = ({
  data,
  searchQuery,
  onSearchChange,
  settings,
  reportId,
  allowPrint = true,
  printBlockReason = '',
  onNavigateToRecord,
}) => {
  const [showZeroBalances, setShowZeroBalances] = useState(false);
  const layout = useResponsiveLayout();

  const companyName = settings?.company?.name || 'نظام ERP';
  const raw = data?.raw;
  const isFinancial = ['trial_balance', 'account_statement', 'journal_book', 'income_statement', 'balance_sheet'].includes(reportId || '');
  const status = String(data?.meta?.status || '');
  const completeness = String(data?.meta?.completeness || '');
  const canonicalLevel = String(data?.meta?.canonicalLevel || data?.meta?.audit?.canonicalLevel || '');
  const note = String(data?.meta?.note || '');
  const missingDataset = String(data?.meta?.missingDataset || '');
  const isRequiresDataset = status === 'requires_dataset' || completeness === 'requires_dataset';
  const isOperationalEstimate = canonicalLevel === 'operational_estimate';

  const filteredRows = useMemo(() => {
    const q = (searchQuery || '').trim().toLowerCase();
    const rows = data?.tableRows || [];
    if (!q) return rows;
    return rows.filter((row) => row.some((cell) => String(cell ?? '').toLowerCase().includes(q)));
  }, [data?.tableRows, searchQuery]);

  const trialRows = useMemo(() => {
    if (reportId !== 'trial_balance') return [] as any[];
    const list = Array.isArray(raw) ? raw : [];
    return list
      .filter((r: any) => showZeroBalances || Number(r.debit || 0) !== 0 || Number(r.credit || 0) !== 0)
      .sort((a: any, b: any) => {
        const order = ['assets', 'liabilities', 'equity', 'revenue', 'expenses'];
        return order.indexOf(a.accountType) - order.indexOf(b.accountType) || String(a.code).localeCompare(String(b.code));
      });
  }, [raw, reportId, showZeroBalances]);

  const renderToolbar = () => (
    <div className="mb-4 flex flex-col gap-3 print:hidden md:flex-row md:items-center md:justify-between">
      <div className="flex gap-2">
        <button
          onClick={() => window.print()}
          disabled={!allowPrint}
          title={!allowPrint ? printBlockReason : '\u0637\u0628\u0627\u0639\u0629'}
          className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Printer className="h-4 w-4" />
          {'\u0637\u0628\u0627\u0639\u0629'}
        </button>
      </div>
      {reportId === 'trial_balance' ? (
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={showZeroBalances} onChange={(e) => setShowZeroBalances(e.target.checked)} />
          {'\u0639\u0631\u0636 \u0627\u0644\u0623\u0631\u0635\u062f\u0629 \u0627\u0644\u0635\u0641\u0631\u064a\u0629'}
        </label>
      ) : null}
    </div>
  );

  const renderHeader = () => (
    <div className="mb-6 text-center print:mb-4">
      <h2 className="text-xl font-bold text-gray-800">{companyName}</h2>
      <h3 className="mt-1 text-lg font-semibold text-blue-700">{data?.title || ''}</h3>
      {data?.subtitle ? <p className="mt-1 text-sm text-gray-500">{data.subtitle}</p> : null}
      <p className="mt-1 text-xs text-gray-400">{'\u062a\u0627\u0631\u064a\u062e \u0627\u0644\u0637\u0628\u0627\u0639\u0629:'} {new Date().toLocaleDateString('ar-SA')}</p>
    </div>
  );

  const renderTrialBalance = () => {
    const grouped = trialRows.reduce((acc: Record<string, any[]>, row: any) => {
      const key = row.accountType || 'other';
      if (!acc[key]) acc[key] = [];
      acc[key].push(row);
      return acc;
    }, {});

    const totalDebit = trialRows.reduce((s: number, r: any) => s + Number(r.debit || 0), 0);
    const totalCredit = trialRows.reduce((s: number, r: any) => s + Number(r.credit || 0), 0);
    const balanced = Math.abs(totalDebit - totalCredit) < 0.01;

    return (
      <div>
        {layout.isMobile ? (
          <div className="space-y-4">
            {['assets', 'liabilities', 'equity', 'revenue', 'expenses'].map((groupKey) => {
              const rows = grouped[groupKey] || [];
              if (!rows.length) return null;
              const groupDebit = rows.reduce((s: number, r: any) => s + Number(r.debit || 0), 0);
              const groupCredit = rows.reduce((s: number, r: any) => s + Number(r.credit || 0), 0);
              return (
                <div key={groupKey} className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
                  <div className="flex items-start justify-between gap-3 bg-gray-50 px-4 py-3">
                    <div className="font-black text-gray-800">{typeLabel[groupKey] || groupKey}</div>
                    <div className="space-y-1 text-left text-[11px] text-gray-500">
                      <div>{'\u0645\u062f\u064a\u0646:'} <span className="font-mono text-emerald-700">{formatAccountingNumber(groupDebit)}</span></div>
                      <div>{'\u062f\u0627\u0626\u0646:'} <span className="font-mono text-red-600">{formatAccountingNumber(groupCredit)}</span></div>
                    </div>
                  </div>
                  <AdaptiveTable
                    rows={rows}
                    keyExtractor={(row, index) => row.accountId || `${groupKey}-${index}`}
                    tabletColumnVisibility={['name', 'debit', 'credit']}
                    columns={[
                      { id: 'code', header: '\u0627\u0644\u0643\u0648\u062f', cell: (row) => <span className="font-mono text-gray-700">{row.code || '-'}</span> },
                      { id: 'name', header: '\u0627\u0644\u062d\u0633\u0627\u0628', cell: (row) => <span className="font-bold text-gray-800">{row.nameAr || row.name || '-'}</span> },
                      { id: 'debit', header: '\u0645\u062f\u064a\u0646', cell: (row) => <span className="font-mono text-emerald-700">{formatAccountingNumber(Number(row.debit || 0))}</span>, tdClassName: 'text-left' },
                      { id: 'credit', header: '\u062f\u0627\u0626\u0646', cell: (row) => <span className="font-mono text-red-600">{formatAccountingNumber(Number(row.credit || 0))}</span>, tdClassName: 'text-left' },
                    ]}
                    mobileCardRender={(row) => (
                      <div className="space-y-2">
                        <div>
                          <div className="font-bold text-gray-800">{row.nameAr || row.name || '-'}</div>
                          <div className="mt-1 font-mono text-xs text-gray-500">{row.code || '-'}</div>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div className="rounded-xl bg-emerald-50 p-3">
                            <div className="text-[11px] text-emerald-700">{'\u0645\u062f\u064a\u0646'}</div>
                            <div className="mt-1 font-mono font-black text-emerald-700">{formatAccountingNumber(Number(row.debit || 0))}</div>
                          </div>
                          <div className="rounded-xl bg-red-50 p-3">
                            <div className="text-[11px] text-red-700">{'\u062f\u0627\u0626\u0646'}</div>
                            <div className="mt-1 font-mono font-black text-red-700">{formatAccountingNumber(Number(row.credit || 0))}</div>
                          </div>
                        </div>
                      </div>
                    )}
                    desktopWrapperClassName="border-t border-gray-100"
                    mobileContainerClassName="space-y-2 p-3"
                    mobileCardClassName="rounded-xl border border-gray-100 bg-white p-3 shadow-none"
                  />
                </div>
              );
            })}
            <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 font-bold">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-gray-500">{'\u0625\u062c\u0645\u0627\u0644\u064a \u0627\u0644\u0645\u062f\u064a\u0646'}</div>
                  <div className="mt-1 font-mono">{formatAccountingNumber(totalDebit)}</div>
                </div>
                <div>
                  <div className="text-gray-500">{'\u0625\u062c\u0645\u0627\u0644\u064a \u0627\u0644\u062f\u0627\u0626\u0646'}</div>
                  <div className="mt-1 font-mono">{formatAccountingNumber(totalCredit)}</div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <AdaptiveTable
            rows={[
              ...['assets', 'liabilities', 'equity', 'revenue', 'expenses'].flatMap((groupKey) => {
                const rows = grouped[groupKey] || [];
                if (!rows.length) return [];
                const groupDebit = rows.reduce((s: number, r: any) => s + Number(r.debit || 0), 0);
                const groupCredit = rows.reduce((s: number, r: any) => s + Number(r.credit || 0), 0);
                return [
                  { rowType: 'group', code: '', name: typeLabel[groupKey] || groupKey, debit: groupDebit, credit: groupCredit, groupKey },
                  ...rows.map((row: any) => ({ rowType: 'row', code: row.code, name: row.nameAr || row.name, debit: Number(row.debit || 0), credit: Number(row.credit || 0), groupKey })),
                ];
              }),
              { rowType: 'total', code: '', name: '\u0627\u0644\u0645\u062c\u0645\u0648\u0639', debit: totalDebit, credit: totalCredit, groupKey: 'total' },
            ]}
            keyExtractor={(row: any, index) => `${row.rowType}-${row.groupKey || 'g'}-${row.code || index}`}
            tabletColumnVisibility={['name', 'debit', 'credit']}
            columns={[
              { id: 'code', header: '\u0627\u0644\u0643\u0648\u062f', cell: (row: any) => <span className="font-mono">{row.code || '\u2014'}</span> },
              { id: 'name', header: '\u0627\u0633\u0645 \u0627\u0644\u062d\u0633\u0627\u0628', cell: (row: any) => <span className={row.rowType !== 'row' ? 'font-black' : ''}>{row.name}</span> },
              { id: 'debit', header: '\u0645\u062f\u064a\u0646', cell: (row: any) => <span className="font-mono">{formatAccountingNumber(Number(row.debit || 0))}</span>, tdClassName: 'text-left' },
              { id: 'credit', header: '\u062f\u0627\u0626\u0646', cell: (row: any) => <span className="font-mono">{formatAccountingNumber(Number(row.credit || 0))}</span>, tdClassName: 'text-left' },
            ]}
            rowClassName={(row: any, index) => {
              if (row.rowType === 'group') return 'bg-gray-100 font-semibold border-t border-gray-300';
              if (row.rowType === 'total') return 'bg-blue-50 font-bold border-t-2 border-blue-300';
              return index % 2 === 0 ? 'bg-white' : 'bg-gray-50';
            }}
            mobileCardRender={(row: any) => (
              <div className="space-y-2">
                <div className="font-bold text-gray-800">{row.name}</div>
                {row.code ? <div className="font-mono text-xs text-gray-500">{row.code}</div> : null}
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-xl bg-emerald-50 p-3">
                    <div className="text-[11px] text-emerald-700">{'\u0645\u062f\u064a\u0646'}</div>
                    <div className="mt-1 font-mono font-black text-emerald-700">{formatAccountingNumber(Number(row.debit || 0))}</div>
                  </div>
                  <div className="rounded-xl bg-red-50 p-3">
                    <div className="text-[11px] text-red-700">{'\u062f\u0627\u0626\u0646'}</div>
                    <div className="mt-1 font-mono font-black text-red-700">{formatAccountingNumber(Number(row.credit || 0))}</div>
                  </div>
                </div>
              </div>
            )}
            desktopWrapperClassName="overflow-auto max-h-[70vh] border rounded-2xl"
          />
        )}
        {balanced ? (
          <div className="text-green-600 font-bold mt-3 flex items-center gap-1"><CheckCircle2 className="w-5 h-5" /> {'\u0627\u0644\u0645\u064a\u0632\u0627\u0646 \u0645\u062a\u0648\u0627\u0632\u0646'}</div>
        ) : (
          <div className="text-red-600 font-bold mt-3 flex items-center gap-1"><XCircle className="w-5 h-5" /> {'\u0627\u0644\u0645\u064a\u0632\u0627\u0646 \u063a\u064a\u0631 \u0645\u062a\u0648\u0627\u0632\u0646 - \u0641\u0631\u0642:'} {formatAccountingNumber(Math.abs(totalDebit - totalCredit))}</div>
        )}
      </div>
    );
  };

  const renderAccountStatement = () => {
    const lines = Array.isArray(raw?.lines) ? raw.lines : [];
    const totalDebit = Number(raw?.totals?.debit || 0);
    const totalCredit = Number(raw?.totals?.credit || 0);
    const endBalance = Number(raw?.totals?.balance || 0);

    return (
      <div className="space-y-3">
        <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 font-semibold">
          <div className="flex items-center justify-between gap-3">
            <span>{'\u0631\u0635\u064a\u062f \u0623\u0648\u0644 \u0627\u0644\u0645\u062f\u0629'}</span>
            <span className="font-mono">{formatAccountingNumber(0)}</span>
          </div>
        </div>
        <AdaptiveTable
          rows={lines as any[]}
          keyExtractor={(line: any, index) => `${line.entryNumber || 'line'}-${index}`}
          tabletColumnVisibility={['date', 'description', 'debit', 'credit', 'balance']}
          columns={[
            { id: 'date', header: '\u0627\u0644\u062a\u0627\u0631\u064a\u062e', cell: (line: any) => <span>{formatDate(line.date || line.entryDate || '')}</span> },
            { id: 'entryNumber', header: '\u0631\u0642\u0645 \u0627\u0644\u0642\u064a\u062f', cell: (line: any) => <span className="font-mono text-blue-700">{line.entryNumber || '-'}</span> },
            { id: 'description', header: '\u0627\u0644\u0628\u064a\u0627\u0646', cell: (line: any) => <span>{line.description || '-'}</span> },
            { id: 'debit', header: '\u0645\u062f\u064a\u0646', cell: (line: any) => <span className="font-mono text-emerald-700">{formatAccountingNumber(Number(line.debit || 0))}</span>, tdClassName: 'text-left' },
            { id: 'credit', header: '\u062f\u0627\u0626\u0646', cell: (line: any) => <span className="font-mono text-red-600">{formatAccountingNumber(Number(line.credit || 0))}</span>, tdClassName: 'text-left' },
            {
              id: 'balance',
              header: '\u0627\u0644\u0631\u0635\u064a\u062f',
              cell: (line: any) => (
                <span className={`font-mono ${accountingNumberClass(Number(line.balance || 0))}`}>
                  {formatAccountingNumber(Number(line.balance || 0))}
                </span>
              ),
              tdClassName: 'text-left',
            },
          ]}
          rowClassName={(_, index) => index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
          mobileCardRender={(line: any) => (
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-bold text-gray-800">{line.description || '-'}</div>
                  <div className="mt-1 text-xs text-gray-500">{formatDate(line.date || line.entryDate || '')}</div>
                </div>
                <div className="font-mono text-xs text-blue-700">{line.entryNumber || '-'}</div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div className="rounded-xl bg-emerald-50 p-3">
                  <div className="text-[11px] text-emerald-700">{'\u0645\u062f\u064a\u0646'}</div>
                  <div className="mt-1 font-mono font-black text-emerald-700">{formatAccountingNumber(Number(line.debit || 0))}</div>
                </div>
                <div className="rounded-xl bg-red-50 p-3">
                  <div className="text-[11px] text-red-700">{'\u062f\u0627\u0626\u0646'}</div>
                  <div className="mt-1 font-mono font-black text-red-700">{formatAccountingNumber(Number(line.credit || 0))}</div>
                </div>
                <div className="rounded-xl bg-gray-50 p-3">
                  <div className="text-[11px] text-gray-500">{'\u0627\u0644\u0631\u0635\u064a\u062f'}</div>
                  <div className={`mt-1 font-mono font-black ${accountingNumberClass(Number(line.balance || 0))}`}>
                    {formatAccountingNumber(Number(line.balance || 0))}
                  </div>
                </div>
              </div>
            </div>
          )}
        />
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 font-bold">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            <div>{'\u0625\u062c\u0645\u0627\u0644\u064a \u0627\u0644\u0645\u062f\u064a\u0646:'} <span className="font-mono">{formatAccountingNumber(totalDebit)}</span></div>
            <div>{'\u0625\u062c\u0645\u0627\u0644\u064a \u0627\u0644\u062f\u0627\u0626\u0646:'} <span className="font-mono">{formatAccountingNumber(totalCredit)}</span></div>
            <div className={accountingNumberClass(endBalance)}>{'\u0627\u0644\u0631\u0635\u064a\u062f \u0627\u0644\u0646\u0647\u0627\u0626\u064a:'} <span className="font-mono">{formatAccountingNumber(endBalance)}</span></div>
          </div>
        </div>
      </div>
    );
  };

  const renderJournalBook = () => {
    const entries = Array.isArray(raw?.entries) ? raw.entries : [];
    return (
      <div className="space-y-4">
        {entries.map((entry: any, idx: number) => (
          <div key={`${entry.entryNumber || 'je'}-${idx}`} className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b bg-gray-50 px-4 py-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-blue-700">{entry.entryNumber || '-'}</span>
                  <span className="text-sm text-gray-500">{formatDate(entry.entryDate || '')}</span>
                </div>
                <div className="mt-1 text-sm text-gray-600">{entry.description || '-'}</div>
              </div>
              <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-bold text-green-700">مرحل</span>
            </div>
            <AdaptiveTable
              rows={Array.isArray(entry.lines) ? entry.lines : []}
              keyExtractor={(line: any, lineIdx) => `${entry.entryNumber || 'je'}-${line.accountCode || lineIdx}`}
              tabletColumnVisibility={['account', 'debit', 'credit']}
              emptyState={<div className="p-4 text-sm text-gray-400">لا توجد سطور لهذا القيد.</div>}
              columns={[
                {
                  id: 'account',
                  header: 'الحساب',
                  cell: (line: any) => (
                    <div>
                      <div className="font-bold text-gray-800">{line.accountName || '-'}</div>
                      <div className="mt-1 font-mono text-xs text-gray-500">{line.accountCode || '-'}</div>
                    </div>
                  ),
                },
                {
                  id: 'debit',
                  header: 'مدين',
                  cell: (line: any) => (
                    <span className="font-mono text-emerald-700">
                      {Number(line.debit || 0) ? formatAccountingNumber(Number(line.debit || 0)) : '-'}
                    </span>
                  ),
                  tdClassName: 'text-left',
                },
                {
                  id: 'credit',
                  header: 'دائن',
                  cell: (line: any) => (
                    <span className="font-mono text-red-600">
                      {Number(line.credit || 0) ? formatAccountingNumber(Number(line.credit || 0)) : '-'}
                    </span>
                  ),
                  tdClassName: 'text-left',
                },
              ]}
              mobileCardRender={(line: any) => (
                <div className="space-y-3">
                  <div>
                    <div className="font-bold text-gray-800">{line.accountName || '-'}</div>
                    <div className="mt-1 font-mono text-xs text-gray-500">{line.accountCode || '-'}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="rounded-xl bg-emerald-50 p-3">
                      <div className="text-[11px] text-emerald-700">مدين</div>
                      <div className="mt-1 font-mono font-black text-emerald-700">
                        {Number(line.debit || 0) ? formatAccountingNumber(Number(line.debit || 0)) : '-'}
                      </div>
                    </div>
                    <div className="rounded-xl bg-red-50 p-3">
                      <div className="text-[11px] text-red-700">دائن</div>
                      <div className="mt-1 font-mono font-black text-red-700">
                        {Number(line.credit || 0) ? formatAccountingNumber(Number(line.credit || 0)) : '-'}
                      </div>
                    </div>
                  </div>
                </div>
              )}
              desktopWrapperClassName="overflow-hidden border-t border-gray-100"
              mobileContainerClassName="space-y-2 p-3"
              mobileCardClassName="rounded-xl border border-gray-100 bg-white p-3 shadow-none"
            />
          </div>
        ))}
      </div>
    );
  };

  const renderIncomeStatement = () => {
    const revenues = Array.isArray(raw?.revenues) ? raw.revenues : [];
    const expenses = Array.isArray(raw?.expenses) ? raw.expenses : [];
    const totalRevenue = Number(raw?.totalRevenue || 0);
    const totalExpenses = Number(raw?.totalExpenses || 0);
    const netIncome = Number(raw?.netIncome || 0);
    const renderStatementSection = (
      title: string,
      rows: any[],
      total: number,
      accent: 'blue' | 'red',
    ) => (
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className={`border-b px-4 py-3 font-black ${accent === 'blue' ? 'border-blue-100 bg-blue-50 text-blue-700' : 'border-red-100 bg-red-50 text-red-700'}`}>
          {title}
        </div>
        <AdaptiveTable
          rows={rows}
          keyExtractor={(row, index) => `${title}-${row.code || index}`}
          tabletColumnVisibility={['name', 'share', 'value']}
          emptyState={<div className="p-4 text-sm text-gray-400">لا توجد بيانات.</div>}
          columns={[
            {
              id: 'name',
              header: 'الحساب',
              cell: (row: any) => (
                <div>
                  <div className="font-bold text-gray-800">{row.name || '-'}</div>
                  {row.code ? <div className="mt-1 font-mono text-xs text-gray-400">{row.code}</div> : null}
                </div>
              ),
            },
            {
              id: 'share',
              header: 'النسبة',
              cell: (row: any) => {
                const value = Number(row.balance || 0);
                const pct = totalRevenue ? (Math.abs(value) / totalRevenue) * 100 : 0;
                return <span className="text-xs font-bold text-gray-500">{formatPercent(pct)}</span>;
              },
              tdClassName: 'text-center',
            },
            {
              id: 'value',
              header: 'القيمة',
              cell: (row: any) => (
                <span className={`font-mono ${accountingNumberClass(Number(row.balance || 0))}`}>
                  {formatAccountingNumber(Number(row.balance || 0))}
                </span>
              ),
              tdClassName: 'text-left',
            },
          ]}
          mobileCardRender={(row: any) => {
            const value = Number(row.balance || 0);
            const pct = totalRevenue ? (Math.abs(value) / totalRevenue) * 100 : 0;
            return (
              <div className="space-y-3">
                <div>
                  <div className="font-bold text-gray-800">{row.name || '-'}</div>
                  {row.code ? <div className="mt-1 font-mono text-xs text-gray-400">{row.code}</div> : null}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-gray-50 p-3">
                    <div className="text-[11px] text-gray-500">النسبة</div>
                    <div className="mt-1 font-bold text-gray-700">{formatPercent(pct)}</div>
                  </div>
                  <div className={`rounded-xl p-3 ${accent === 'blue' ? 'bg-blue-50' : 'bg-red-50'}`}>
                    <div className={`text-[11px] ${accent === 'blue' ? 'text-blue-700' : 'text-red-700'}`}>القيمة</div>
                    <div className={`mt-1 font-mono font-black ${accountingNumberClass(value)}`}>{formatAccountingNumber(value)}</div>
                  </div>
                </div>
              </div>
            );
          }}
          desktopWrapperClassName="overflow-hidden"
          mobileContainerClassName="space-y-2 p-3"
          mobileCardClassName="rounded-xl border border-gray-100 bg-white p-3 shadow-none"
        />
        <div className={`border-t px-4 py-3 text-sm font-black ${accent === 'blue' ? 'border-blue-100 bg-blue-50 text-blue-700' : 'border-red-100 bg-red-50 text-red-700'}`}>
          إجمالي {title}: <span className="font-mono">{formatAccountingNumber(total)}</span>
        </div>
      </div>
    );

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
            <div className="text-xs font-bold text-blue-700">إجمالي الإيرادات</div>
            <div className="mt-2 font-mono text-2xl font-black text-blue-800">{formatAccountingNumber(totalRevenue)}</div>
          </div>
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
            <div className="text-xs font-bold text-red-700">إجمالي المصروفات</div>
            <div className="mt-2 font-mono text-2xl font-black text-red-800">{formatAccountingNumber(totalExpenses)}</div>
          </div>
          <div className={`rounded-2xl border p-4 sm:col-span-2 lg:col-span-1 ${netIncome >= 0 ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
            <div className={`text-xs font-bold ${netIncome >= 0 ? 'text-green-700' : 'text-red-700'}`}>{netIncome >= 0 ? 'صافي الربح' : 'صافي الخسارة'}</div>
            <div className={`mt-2 font-mono text-2xl font-black ${netIncome >= 0 ? 'text-green-800' : 'text-red-800'}`}>{formatAccountingNumber(Math.abs(netIncome))}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {renderStatementSection('الإيرادات', revenues, totalRevenue, 'blue')}
          {renderStatementSection('المصروفات', expenses, totalExpenses, 'red')}
        </div>

        <div className={`rounded-2xl border p-4 text-center text-xl font-black ${netIncome >= 0 ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
          {netIncome >= 0 ? 'صافي الربح' : 'صافي الخسارة'}: {formatAccountingNumber(Math.abs(netIncome))}
        </div>
      </div>
    );
  };

  const renderBalanceSheet = () => {
    const assets = Array.isArray(raw?.assets) ? raw.assets : [];
    const liabilities = Array.isArray(raw?.liabilities) ? raw.liabilities : [];
    const equity = Array.isArray(raw?.equity) ? raw.equity : [];
    const netIncome = Number(raw?.totals?.netIncome || 0);
    const totalAssets = Number(raw?.totals?.assets || 0);
    const totalLiabilities = Number(raw?.totals?.liabilities || 0);
    const totalEquity = Number(raw?.totals?.equity || 0);
    const totalLiabilitiesAndEquity = totalLiabilities + totalEquity;
    const balanced = Math.abs(totalAssets - totalLiabilitiesAndEquity) < 0.01;

    const renderSection = (
      title: string,
      rows: any[],
      total: number,
      accent: 'blue' | 'red' | 'emerald',
      extraRows: Array<{ label: string; value: number }> = []
    ) => (
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className={`border-b px-4 py-3 font-black ${
          accent === 'blue'
            ? 'border-blue-100 bg-blue-50 text-blue-700'
            : accent === 'red'
              ? 'border-red-100 bg-red-50 text-red-700'
              : 'border-emerald-100 bg-emerald-50 text-emerald-700'
        }`}>
          {title}
        </div>
        <AdaptiveTable
          rows={[
            ...rows.map((row: any) => ({ code: row.code, name: row.name, balance: Number(row.balance || 0), isExtra: false })),
            ...extraRows.map((row) => ({ code: 'extra', name: row.label, balance: row.value, isExtra: true })),
          ]}
          keyExtractor={(row, index) => `${title}-${row.code}-${index}`}
          tabletColumnVisibility={['name', 'balance']}
          emptyState={<div className="p-4 text-sm text-gray-400">لا توجد بيانات.</div>}
          columns={[
            {
              id: 'name',
              header: 'الحساب',
              cell: (row) => <div className={row.isExtra ? 'font-bold text-gray-800' : 'text-gray-700'}>{row.name}</div>,
            },
            {
              id: 'balance',
              header: 'الرصيد',
              cell: (row) => <span className="font-mono">{formatAccountingNumber(Number(row.balance || 0))}</span>,
              tdClassName: 'text-left',
            },
          ]}
          mobileCardRender={(row) => (
            <div className="flex items-center justify-between gap-3">
              <div className={row.isExtra ? 'font-bold text-gray-800' : 'text-sm text-gray-700'}>{row.name}</div>
              <div className="font-mono font-bold text-gray-900">{formatAccountingNumber(Number(row.balance || 0))}</div>
            </div>
          )}
          desktopWrapperClassName="overflow-hidden"
          mobileContainerClassName="space-y-2 p-3"
          mobileCardClassName="rounded-xl border border-gray-100 bg-white p-3 shadow-none"
        />
        <div className={`border-t px-4 py-3 text-sm font-black ${
          accent === 'blue'
            ? 'border-blue-100 bg-blue-50 text-blue-700'
            : accent === 'red'
              ? 'border-red-100 bg-red-50 text-red-700'
              : 'border-emerald-100 bg-emerald-50 text-emerald-700'
        }`}>
          إجمالي {title}: <span className="font-mono">{formatAccountingNumber(total)}</span>
        </div>
      </div>
    );

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
            <div className="text-xs font-bold text-blue-700">إجمالي الأصول</div>
            <div className="mt-2 font-mono text-2xl font-black text-blue-800">{formatAccountingNumber(totalAssets)}</div>
          </div>
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
            <div className="text-xs font-bold text-red-700">الخصوم وحقوق الملكية</div>
            <div className="mt-2 font-mono text-2xl font-black text-red-800">{formatAccountingNumber(totalLiabilitiesAndEquity)}</div>
          </div>
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="text-xs font-bold text-emerald-700">صافي ربح العام الحالي</div>
            <div className="mt-2 font-mono text-2xl font-black text-emerald-800">{formatAccountingNumber(netIncome)}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {renderSection('الأصول', assets, totalAssets, 'blue')}
          <div className="space-y-4">
            {renderSection('الخصوم', liabilities, totalLiabilities, 'red')}
            {renderSection('حقوق الملكية', equity, totalEquity + netIncome, 'emerald', [
              { label: 'صافي ربح العام الحالي', value: netIncome },
            ])}
          </div>
        </div>

        {balanced ? (
          <div className="rounded-2xl border border-green-200 bg-green-50 p-4 text-center font-bold text-green-700">الميزانية متوازنة</div>
        ) : (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-center font-bold text-red-700">
            الميزانية غير متوازنة. الفرق: {formatAccountingNumber(Math.abs(totalAssets - totalLiabilitiesAndEquity))}
          </div>
        )}
      </div>
    );
  };

  const renderMovementReport = (title: string) => {
    if (!data?.tableHeaders?.length) {
      return (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-6 text-center text-gray-500">
          لا توجد بيانات لعرضها.
        </div>
      );
    }

    const highlightHeaders = ['المبلغ', 'القيمة', 'مدين', 'دائن', 'الرصيد', 'الصافي'];
    const isHighlightHeader = (header: string) => highlightHeaders.some((token) => header.includes(token));

    return (
      <div className="space-y-3">
        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3 text-sm font-bold text-gray-700">
          {title}
        </div>
        <AdaptiveTable
          rows={filteredRows}
          keyExtractor={(_, rowIndex) => `report-row-${rowIndex}`}
          tabletColumnVisibility={data.tableHeaders.slice(0, 5).map((_, colIndex) => `col-${colIndex}`)}
          columns={data.tableHeaders.map((header, colIndex) => ({
            id: `col-${colIndex}`,
            header,
            cell: (row: any[], rowIndex: number) => buildCellContent(rowIndex, colIndex, row[colIndex]),
            tdClassName: isHighlightHeader(header) ? 'text-left' : undefined,
          }))}
          rowClassName={(_, rowIndex) => rowIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
          mobileCardRender={(row: any[], rowIndex: number) => (
            <div className="space-y-3">
              {data.tableHeaders.map((header, colIndex) => (
                <div key={`${rowIndex}-${colIndex}`} className="flex items-start justify-between gap-3">
                  <div className="shrink-0 text-[11px] font-bold text-gray-500">{header}</div>
                  <div className={`text-left text-sm font-bold ${isHighlightHeader(header) ? 'text-emerald-700' : 'text-gray-800'}`}>
                    {buildCellContent(rowIndex, colIndex, row[colIndex])}
                  </div>
                </div>
              ))}
            </div>
          )}
          desktopWrapperClassName="overflow-hidden rounded-2xl border border-gray-200"
          mobileContainerClassName="space-y-3"
          mobileCardClassName="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
        />
      </div>
    );
  };

  const entityRefs: any[] | undefined = data?.meta?.entityRefs;

  /** Build a SmartLink map: {colIndex → {type, idKey}} per report */
  const smartLinkMap = useMemo(() => {
    if (!entityRefs || !reportId) return null;
    if (data?.meta?.smartLinkMap) return data.meta.smartLinkMap as any;
    const map: Record<number, { type: 'invoice' | 'voucher' | 'party' | 'product'; idKey: string }> = {};
    switch (reportId) {
      case 'sales':
      case 'purchases':
      case 'sales_invoices_aggregate':
      case 'purchases_invoices_aggregate':
        map[0] = { type: 'invoice', idKey: 'invoiceId' };
        if (reportId === 'sales' || reportId === 'sales_invoices_aggregate') map[2] = { type: 'party', idKey: 'partyId' };
        if (reportId === 'purchases' || reportId === 'purchases_invoices_aggregate') map[3] = { type: 'party', idKey: 'partyId' };
        break;
      case 'fund_movement':
      case 'expenses':
        map[1] = { type: 'voucher', idKey: 'voucherId' };
        break;
      case 'product_movement':
        map[1] = { type: 'invoice', idKey: 'invoiceId' };
        break;
      case 'warehouse_movement':
        map[1] = { type: 'invoice', idKey: 'invoiceId' };
        map[2] = { type: 'party', idKey: 'partyId' };
        break;
      case 'invoices_report':
        map[1] = { type: 'invoice', idKey: 'invoiceId' };
        map[3] = { type: 'party', idKey: 'partyId' };
        break;
      case 'party_statement':
      case 'client_statement':
      case 'supplier_statement':
      case 'parties_customer_statement':
      case 'parties_supplier_statement':
        map[1] = { type: 'party', idKey: 'partyId' };
        map[3] = { type: 'invoice', idKey: 'invoiceId' };
        break;
      case 'cashbox_report':
        map[1] = { type: 'voucher', idKey: 'voucherId' };
        map[4] = { type: 'party', idKey: 'partyId' };
        break;
      case 'inventory_report_core':
      case 'inventory_item_movement':
      case 'inventory_total_movement':
        map[1] = { type: 'invoice', idKey: 'invoiceId' };
        map[3] = { type: 'product', idKey: 'itemId' };
        map[0] = { type: 'product', idKey: 'itemId' };
        break;
      default:
        break;
    }
    return Object.keys(map).length > 0 ? map : null;
  }, [reportId, entityRefs]);

  const buildCellContent = (rowIndex: number, colIndex: number, cell: unknown) => {
    const ref = entityRefs?.[rowIndex] as { referenceId?: string; referenceType?: string; invoiceId?: string; voucherId?: string; partyId?: string; itemId?: string } | undefined;
    const linkDef = smartLinkMap?.[colIndex];
    const num = Number(cell);
    const isNumeric = !Number.isNaN(num) && String(cell).trim() !== '';

    let entityId: string | null = null;
    let entityType: 'invoice' | 'voucher' | 'party' | 'product' | null = null;
    const referenceType = ref?.referenceType ?? null;
    const referenceId = ref?.referenceId ?? null;

    if (linkDef && ref) {
      entityId = ref[linkDef.idKey as keyof typeof ref] || null;
      entityType = linkDef.type;
      if (!entityId && reportId === 'party_statement' && colIndex === 3 && ref.voucherId) {
        entityId = ref.voucherId;
        entityType = 'voucher';
      }
    }

    const content = isNumeric ? (
      <span className={`font-mono ${accountingNumberClass(num)}`}>{formatAccountingNumber(num)}</span>
    ) : (
      String(cell || '?')
    );

    if (onNavigateToRecord && referenceId && (referenceType === 'invoice' || referenceType === 'consignment' || referenceType === 'settlement' || referenceType === 'voucher' || referenceType === 'party')) {
      return (
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onNavigateToRecord(referenceType, referenceId); }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNavigateToRecord(referenceType, referenceId); } }}
          className="hover:text-primary hover:underline cursor-pointer"
        >
          {content}
        </span>
      );
    }

    if (entityId && entityType) {
      return (
        <SmartLink type={entityType} id={entityId} inheritStyle className="hover:text-primary hover:underline cursor-pointer">
          {content}
        </SmartLink>
      );
    }

    return content;
  };

  if (!data) {
    return <div className="text-center p-10 text-gray-400 font-bold">جاري تجهيز التقرير...</div>;
  }

  const generatedAt = String(data.meta?.generatedAt || new Date().toISOString());
  const generatedBy = String(data.meta?.generatedBy || settings?.company?.name || 'النظام');
  const filtersSummary = data.meta?.filtersSummary || data.meta?.filters;

  const renderSummaryCards = () => {
    if (!data.summary?.length) return null;
    return (
      <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {data.summary.map((s, idx) => {
          const numeric = Number(s.value);
          const hasNumeric = !Number.isNaN(numeric) && String(s.value).trim() !== '';
          return (
            <div key={`${s.title}-${idx}`} className="rounded-xl border border-gray-200 bg-gray-50 p-3">
              <p className="text-xs text-gray-500">{s.title}</p>
              <p className={`mt-1 text-lg font-black ${hasNumeric ? accountingNumberClass(numeric) : 'text-gray-800'}`}>
                {hasNumeric ? formatAccountingNumber(numeric) : String(s.value)}
                {s.suffix ? ` ${s.suffix}` : ''}
              </p>
              {s.subValue ? <p className="text-xs text-gray-500 mt-1">{s.subValue}</p> : null}
            </div>
          );
        })}
      </div>
    );
  };

  const renderDefaultTable = () => (
    <AdaptiveTable
      rows={filteredRows}
      keyExtractor={(_, rowIndex) => `report-row-${rowIndex}`}
      tabletColumnVisibility={data.tableHeaders.slice(0, 5).map((_, colIndex) => `col-${colIndex}`)}
      columns={data.tableHeaders.map((header, colIndex) => ({
        id: `col-${colIndex}`,
        header,
        cell: (row: any[], rowIndex: number) => buildCellContent(rowIndex, colIndex, row[colIndex]),
      }))}
      rowClassName={(_, rowIndex) => rowIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
      mobileCardRender={(row: any[], rowIndex: number) => (
        <div className="space-y-3">
          {data.tableHeaders.map((header, colIndex) => (
            <div key={`${rowIndex}-${colIndex}`} className="flex items-start justify-between gap-3">
              <div className="shrink-0 text-[11px] font-bold text-gray-500">{header}</div>
              <div className="text-left text-sm font-bold text-gray-800">{buildCellContent(rowIndex, colIndex, row[colIndex])}</div>
            </div>
          ))}
        </div>
      )}
      desktopWrapperClassName="overflow-hidden rounded-2xl border border-gray-200"
      mobileContainerClassName="space-y-3"
      mobileCardClassName="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
    />
  );

  return (
    <div
      id="report-content"
      data-report-status={status || completeness || 'ok'}
      className="reports-arabic bg-white p-6 rounded-3xl shadow-lg border border-gray-100"
      dir="rtl"
    >
      {renderHeader()}
      {renderToolbar()}
      {!allowPrint && printBlockReason ? (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 print:hidden">
          {printBlockReason}
        </div>
      ) : null}
      {isOperationalEstimate && !isRequiresDataset ? (
        <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
          هذا التقرير ذو طبيعة تشغيلية تقديرية وليس تقريرًا محاسبيًا نهائيًا.
          {note ? <span className="mr-1">{note}</span> : null}
        </div>
      ) : null}
      {isRequiresDataset ? (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <h4 className="font-black text-amber-900">قيد التجهيز - يتطلب بيانات إضافية</h4>
          <p className="mt-2 text-sm text-amber-800">
            {missingDataset || note || 'هذا التقرير غير مكتمل حاليًا ولا يمكن عرضه أو طباعته أو تصديره.'}
          </p>
        </div>
      ) : null}
      {renderSummaryCards()}

      {!isRequiresDataset && (
        <div className="mb-4 print:hidden">
          <div className="relative">
            <input
              type="text"
              placeholder="بحث داخل التقرير..."
              className="w-full pl-10 pr-10 py-2 border rounded-xl"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
            />
            <Search className="absolute right-3 top-2.5 text-gray-400" size={18} />
          </div>
        </div>
      )}

      {!isRequiresDataset && (
        <>
          {reportId === 'trial_balance' && renderTrialBalance()}
          {reportId === 'account_statement' && renderAccountStatement()}
          {reportId === 'journal_book' && renderJournalBook()}
          {reportId === 'income_statement' && renderIncomeStatement()}
          {reportId === 'balance_sheet' && renderBalanceSheet()}
          {reportId === 'fund_movement' && renderMovementReport('حركة الصندوق')}
          {reportId === 'cashbox_report' && renderMovementReport('تقرير الصندوق')}
          {!isFinancial && reportId !== 'fund_movement' && reportId !== 'cashbox_report' && renderDefaultTable()}
        </>
      )}

      {data.extraInfo}

      <div className="mt-6 rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Table2 size={14} />
            <span>تم إنشاء التقرير وفق معايير النظام المحاسبية.</span>
          </div>
          <span>وقت الإنشاء: {formatDate(generatedAt)}</span>
          <span>أنشأه: {generatedBy}</span>
        </div>
        {filtersSummary ? (
          <div className="mt-2 text-gray-500 break-all">
            الفلاتر: {typeof filtersSummary === 'string' ? filtersSummary : JSON.stringify(filtersSummary)}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default ReportResults;

