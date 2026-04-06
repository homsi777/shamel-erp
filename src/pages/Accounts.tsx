
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useModalEscape } from '../hooks/useEscapeKey';
import {
  Plus, Search, ChevronRight, ChevronDown,
  FolderOpen, FileText, CheckCircle2, XCircle, Trash2,
  RefreshCw, Scale, ListTree, FolderTree, ArrowLeftRight, Info,
  Receipt, ArrowUpRight, ArrowDownRight, Loader2, CalendarDays, Pencil
} from 'lucide-react';
import { Account, AccountType, formatNumber } from '../types';
import { apiRequest } from '../lib/api';
import { confirmDialog } from '../lib/confirm';
import { extractAccountsFromResponse } from '../lib/accounts-response';
import { AdaptiveModal, AdaptiveTable } from '../components/responsive';

const TYPE_COLORS: Record<AccountType, string> = {
  assets: 'text-emerald-600 bg-emerald-50',
  liabilities: 'text-rose-600 bg-rose-50',
  equity: 'text-indigo-600 bg-indigo-50',
  revenue: 'text-blue-600 bg-blue-50',
  expenses: 'text-orange-600 bg-orange-50'
};

const formatAccountAmount = (value: unknown) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return '0';
  const abs = Math.abs(numeric);
  const decimals = abs >= 1000 ? 0 : abs >= 1 ? 2 : 3;
  const formatted = formatNumber(numeric, decimals);
  if (!formatted.includes('.')) return formatted;
  return formatted.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
};

type TrialRow = { accountId: number; debit: number; credit: number; balance: number };

type TrialMap = Record<number, TrialRow>;

const Accounts: React.FC = () => {
  const [viewMode, setViewMode] = useState<'tree' | 'table'>('tree');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [trialMap, setTrialMap] = useState<TrialMap>({});
  const [editingId, setEditingId] = useState<number | null>(null);
  const [statementAccount, setStatementAccount] = useState<Account | null>(null);
  const [statementLines, setStatementLines] = useState<any[]>([]);
  const [statementLoading, setStatementLoading] = useState(false);
  const [statementBalance, setStatementBalance] = useState(0);

  const [form, setForm] = useState<Partial<Account>>({
    code: '',
    nameAr: '',
    nameEn: '',
    parentId: null,
    level: 1,
    accountType: 'assets',
    accountNature: 'debit',
    isParent: false,
    isActive: true,
    isSystem: false
  });

  const loadAccounts = async () => {
    try {
      const data = await apiRequest('accounts');
      const list = extractAccountsFromResponse(data) as any[];
      setAccounts(list);

      const map: TrialMap = {};
      list.forEach((acc: any) => {
        const id = Number(acc?.id);
        if (!id) return;
        map[id] = {
          accountId: id,
          debit: Number(acc?.totalDebit || 0),
          credit: Number(acc?.totalCredit || 0),
          balance: Number(acc?.balance || 0)
        };
      });
      setTrialMap(map);
    } catch (e) {
      console.error('COA load error', e);
    }
  };

  useEffect(() => { loadAccounts(); }, []);

  const accountMap = useMemo(() => {
    const map = new Map<number, Account>();
    for (const acc of accounts) map.set(acc.id, acc);
    return map;
  }, [accounts]);

  useModalEscape(isModalOpen, useCallback(() => setIsModalOpen(false), []));
  useModalEscape(!!statementAccount, useCallback(() => setStatementAccount(null), []));

  const handleShowStatement = async (node: Account) => {
    const row = trialMap[node.id];
    const balance = Number((node.balance ?? row?.balance) || 0);
    if (balance === 0) return;
    setStatementAccount(node);
    setStatementLines([]);
    setStatementLoading(true);
    try {
      const data = await apiRequest(`accounts/${node.id}/statement`);
      setStatementLines((data as any).lines || []);
      setStatementBalance(Number((data as any).balance || 0));
    } catch (e) {
      console.error('Statement load error', e);
    } finally {
      setStatementLoading(false);
    }
  };

  const filteredAccounts = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return accounts;
    const include = new Set<number>();

    const matches = (a: Account) => {
      const nameAr = (a.nameAr || '').toLowerCase();
      const nameEn = (a.nameEn || '').toLowerCase();
      const code = (a.code || '').toLowerCase();
      return nameAr.includes(term) || nameEn.includes(term) || code.includes(term);
    };

    const addAncestors = (id: number) => {
      let current = accountMap.get(id);
      while (current?.parentId) {
        include.add(current.parentId);
        current = accountMap.get(current.parentId);
      }
    };

    for (const acc of accounts) {
      if (matches(acc)) {
        include.add(acc.id);
        addAncestors(acc.id);
      }
    }

    return accounts.filter(a => include.has(a.id));
  }, [accounts, accountMap, searchTerm]);

  const treeData = useMemo(() => {
    const build = (parentId: number | null): Account[] => {
      return filteredAccounts
        .filter(a => a.parentId === parentId)
        .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
        .map(a => ({ ...a, children: build(a.id) }));
    };
    return build(null);
  }, [filteredAccounts]);

  const handleToggleExpand = (id: number) => {
    const next = new Set(expandedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setExpandedIds(next);
  };

  const resetForm = (next?: Partial<Account>) => {
    setForm({
      code: '',
      nameAr: '',
      nameEn: '',
      parentId: null,
      level: 1,
      accountType: 'assets',
      accountNature: 'debit',
      isParent: false,
      isActive: true,
      isSystem: false,
      ...next
    });
  };

  const handleOpenAdd = (parent?: Account) => {
    setEditingId(null);
    if (parent) {
      resetForm({
        code: '',
        nameAr: '',
        nameEn: '',
        parentId: parent.id,
        accountType: parent.accountType,
        accountNature: parent.accountNature,
        level: (parent.level || 1) + 1,
        isParent: false,
        isActive: true,
        isSystem: false
      });
    } else {
      resetForm({ code: '', nameAr: '', nameEn: '', parentId: null, accountType: 'assets', accountNature: 'debit', level: 1, isParent: true, isActive: true, isSystem: false });
    }
    setIsModalOpen(true);
  };

  const handleOpenEdit = (node: Account) => {
    setEditingId(node.id);
    resetForm({
      id: node.id,
      code: node.code || '',
      nameAr: node.nameAr || '',
      nameEn: node.nameEn || '',
      parentId: node.parentId ?? null,
      level: node.level || 1,
      accountType: node.accountType,
      accountNature: node.accountNature,
      isParent: !!node.isParent,
      isActive: node.isActive !== false,
      isSystem: !!node.isSystem
    });
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    const payload = {
      ...form,
      code: String(form.code || '').trim(),
      nameAr: String(form.nameAr || '').trim(),
      nameEn: String(form.nameEn || '').trim(),
      accountType: form.accountType || 'assets',
      accountNature: form.accountNature || 'debit',
      isParent: !!form.isParent,
      isActive: form.isActive !== false,
      isSystem: !!form.isSystem
    };
    try {
      if (editingId) {
        await apiRequest(`accounts/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await apiRequest('accounts', { method: 'POST', body: JSON.stringify(payload) });
      }
      await loadAccounts();
      setIsModalOpen(false);
    } catch (e) {
      alert('فشل حفظ الحساب');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    const node = accounts.find(a => a.id === id);
    const hasChildren = accounts.some(a => a.parentId === id);
    if (hasChildren) {
      alert('لا يمكن حذف حساب رئيسي يحتوي حسابات فرعية.');
      return;
    }
    const bal = Number((node?.balance ?? trialMap[node?.id || 0]?.balance) || 0);
    if (bal !== 0) {
      alert('لا يمكن حذف حساب يحتوي رصيدًا أو حركات.');
      return;
    }
    if (node?.isSystem) {
      alert('لا يمكن حذف حساب نظامي.');
      return;
    }
    if (!(await confirmDialog('هل تريدين حذف هذا الحساب؟ لا يمكن التراجع عن العملية.'))) return;
    try {
      await apiRequest(`accounts/${id}`, { method: 'DELETE' });
      await loadAccounts();
    } catch (e: any) {
      alert(e.message || 'حدث خطأ');
    }
  };

  const totals = useMemo(() => {
    let debit = 0;
    let credit = 0;
    for (const acc of accounts) {
      const row = trialMap[acc.id];
      if (!row) continue;
      debit += Number(row.debit || 0);
      credit += Number(row.credit || 0);
    }
    return { debit, credit };
  }, [accounts, trialMap]);

  const renderNode = (node: Account) => {
    const isExpanded = expandedIds.has(node.id);
    const hasChildren = node.children && node.children.length > 0;
    const colorClass = TYPE_COLORS[node.accountType];
    const isLeaf = !node.isParent;
    const row = trialMap[node.id];
    const balance = Number((node.balance ?? row?.balance) || 0);

    return (
      <div key={node.id} className="mr-6 select-none animate-fadeIn">
        <div className={`flex items-center gap-3 p-2 rounded-xl border border-transparent hover:border-gray-200 hover:bg-white transition-all group mb-1 ${!node.isActive ? 'opacity-50 grayscale' : ''}`}>
          <button
            onClick={() => handleToggleExpand(node.id)}
            className={`p-1 rounded transition-colors ${hasChildren ? 'text-gray-400 hover:text-primary hover:bg-gray-100' : 'opacity-0 pointer-events-none'}`}
          >
            {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>

          <div className={`p-2 rounded-lg ${colorClass} shadow-inner`}>
            {isLeaf ? <FileText size={18} /> : <FolderOpen size={18} />}
          </div>

          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-gray-400 font-bold">{node.code}</span>
              <span className={`font-bold text-sm ${isLeaf ? 'text-gray-800' : 'text-gray-900'}`}>{node.nameAr}</span>
            </div>
            {node.nameEn ? <div className="text-[10px] text-gray-400">{node.nameEn}</div> : null}
          </div>

          <button
            onClick={(e) => { e.stopPropagation(); if (balance !== 0) handleShowStatement(node); }}
            className={`text-[11px] font-black uppercase tracking-tight mr-4 font-numeric px-2.5 py-1 rounded-lg transition-all tabular-nums ${balance !== 0 ? 'hover:bg-gray-100 hover:scale-105 cursor-pointer' : 'cursor-default'} ${balance > 0 ? 'text-emerald-600' : balance < 0 ? 'text-rose-500' : 'text-gray-400'}`}
            title={balance !== 0 ? 'انقر لعرض تفاصيل الرصيد' : ''}
          >
            {formatAccountAmount(Math.abs(balance))} $
          </button>

          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={() => handleOpenEdit(node)} className="p-1.5 bg-gray-50 text-gray-600 rounded-lg hover:bg-gray-700 hover:text-white transition" title="تعديل">
              <Pencil size={14} />
            </button>
            {node.isParent && (
              <button onClick={() => handleOpenAdd(node)} className="p-1.5 bg-green-50 text-green-600 rounded-lg hover:bg-green-600 hover:text-white transition" title="إضافة فرعي">
                <Plus size={14} />
              </button>
            )}
            <button onClick={() => handleDelete(node.id)} className="p-1.5 bg-red-50 text-red-600 rounded-lg hover:bg-red-600 hover:text-white transition" title="حذف">
              <Trash2 size={14} />
            </button>
          </div>
        </div>
        {isExpanded && hasChildren && (
          <div className="border-r-2 border-dashed border-gray-100 mr-4 pr-2">
            {node.children!.map(child => renderNode(child))}
          </div>
        )}
      </div>
    );
  };
  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-center gap-4 bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
        <div className="flex items-center gap-6">
          <h2 className="text-2xl font-black text-gray-800 flex items-center gap-3">
            <ListTree className="text-emerald-600" size={32} /> شجرة الحسابات المحاسبية
          </h2>
          <div className="flex bg-gray-100 p-1 rounded-xl border">
            <button onClick={() => setViewMode('tree')} className={`px-6 py-1.5 rounded-lg text-xs font-bold transition-all ${viewMode === 'tree' ? 'bg-white shadow text-emerald-600' : 'text-gray-500'}`}>
              عرض شجري
            </button>
            <button onClick={() => setViewMode('table')} className={`px-6 py-1.5 rounded-lg text-xs font-bold transition-all ${viewMode === 'table' ? 'bg-white shadow text-emerald-600' : 'text-gray-500'}`}>
              جدول الأرصدة
            </button>
          </div>
        </div>
        <button onClick={() => handleOpenAdd()} className="bg-emerald-600 text-white px-8 py-2.5 rounded-xl font-bold flex items-center gap-2 hover:bg-emerald-700 transition shadow-lg shadow-emerald-100 active:scale-95">
          <Plus size={18} /> إضافة حساب جديد
        </button>
      </div>

      {viewMode === 'tree' ? (
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-10 min-h-[600px] animate-fadeIn">
          <div className="flex justify-between items-center mb-10 border-b pb-6">
            <div>
              <h3 className="text-xl font-black text-gray-900">دليل شجرة الحسابات المحاسبية</h3>
              <p className="text-xs text-gray-400 font-bold mt-1">تصفح هيكل الحسابات من المستوى الأعلى حتى الحسابات الفرعية.</p>
            </div>
            <div className="relative w-64">
              <Search className="absolute right-3 top-2.5 text-gray-400" size={16} />
              <input
                type="text"
                placeholder="ابحث حساب..."
                className="w-full pr-10 pl-4 py-2 border rounded-xl text-xs"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-4">
            {treeData.map(root => renderNode(root))}
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden animate-fadeIn">
          <div className="p-8 border-b bg-gray-50/50 flex justify-between items-center">
            <h3 className="font-bold text-gray-700 flex items-center gap-2"><Scale size={24} className="text-emerald-500" /> ميزان المراجعة المحاسبي (Trial Balance)</h3>
            <div className="flex gap-2">
              <div className="bg-white border rounded-xl px-4 py-2 text-xs font-bold text-gray-400">
                إجمالي المدين: <span className="text-emerald-600 font-numeric tabular-nums">{formatAccountAmount(totals.debit)}</span>
              </div>
              <div className="bg-white border rounded-xl px-4 py-2 text-xs font-bold text-gray-400">
                إجمالي الدائن: <span className="text-rose-600 font-numeric tabular-nums">{formatAccountAmount(totals.credit)}</span>
              </div>
            </div>
          </div>
          <AdaptiveTable
            rows={[...accounts].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))}
            keyExtractor={(acc) => String(acc.id)}
            tabletColumnVisibility={['code', 'name', 'balance']}
            onRowClick={(acc) => {
              const row = trialMap[acc.id] || {
                debit: Number((acc as any).totalDebit || 0),
                credit: Number((acc as any).totalCredit || 0),
                balance: Number((acc as any).balance || 0),
                accountId: acc.id
              };
              if (row.balance !== 0) handleShowStatement(acc);
            }}
            columns={[
              { id: 'code', header: 'الكود', cell: (acc) => <span className="font-mono font-bold text-primary">{acc.code}</span> },
              {
                id: 'name',
                header: 'اسم الحساب',
                cell: (acc) => (
                  <div className="flex items-center gap-2">
                    {acc.isParent ? <FolderTree size={14} className="text-gray-400" /> : <ArrowLeftRight size={14} className="text-emerald-300" />}
                    <span className={acc.isParent ? 'text-gray-900 font-black' : 'text-gray-600'}>{acc.nameAr}</span>
                  </div>
                ),
              },
              { id: 'type', header: 'النوع', cell: (acc) => <span className={`px-2 py-0.5 rounded text-[8px] font-black ${TYPE_COLORS[acc.accountType]}`}>{acc.accountType}</span> },
              {
                id: 'debit',
                header: 'مدين (+)',
                cell: (acc) => {
                  const row = trialMap[acc.id] || { debit: Number((acc as any).totalDebit || 0) };
                  return <span className="font-numeric tabular-nums text-[11px] font-bold text-emerald-500">{formatAccountAmount((row as any).debit)}</span>;
                },
                tdClassName: 'text-center',
              },
              {
                id: 'credit',
                header: 'دائن (-)',
                cell: (acc) => {
                  const row = trialMap[acc.id] || { credit: Number((acc as any).totalCredit || 0) };
                  return <span className="font-numeric tabular-nums text-[11px] font-bold text-rose-500">{formatAccountAmount((row as any).credit)}</span>;
                },
                tdClassName: 'text-center',
              },
              {
                id: 'balance',
                header: 'الرصيد الحالي',
                cell: (acc) => {
                  const row = trialMap[acc.id] || { balance: Number((acc as any).balance || 0) };
                  return <span className="font-numeric tabular-nums font-black text-sm">{formatAccountAmount((row as any).balance)}</span>;
                },
                tdClassName: 'text-center',
              },
            ]}
            rowClassName={(acc, idx) => {
              const row = trialMap[acc.id] || { balance: Number((acc as any).balance || 0) };
              return `${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} ${acc.isParent ? 'font-black' : ''} ${(row as any).balance !== 0 ? 'cursor-pointer hover:bg-gray-50' : ''}`;
            }}
            mobileCardRender={(acc) => {
              const row = trialMap[acc.id] || {
                debit: Number((acc as any).totalDebit || 0),
                credit: Number((acc as any).totalCredit || 0),
                balance: Number((acc as any).balance || 0),
              };
              return (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-primary font-mono">{acc.code}</span>
                    <span className={`px-2 py-0.5 rounded text-[8px] font-black ${TYPE_COLORS[acc.accountType]}`}>{acc.accountType}</span>
                  </div>
                  <div className="font-bold text-gray-800">{acc.nameAr}</div>
                  <div className="grid grid-cols-3 gap-2 text-[11px]">
                    <div className="rounded-lg bg-emerald-50 p-2 text-emerald-700 font-bold font-numeric">{formatAccountAmount((row as any).debit)}</div>
                    <div className="rounded-lg bg-rose-50 p-2 text-rose-700 font-bold font-numeric">{formatAccountAmount((row as any).credit)}</div>
                    <div className="rounded-lg bg-gray-100 p-2 text-gray-700 font-bold font-numeric">{formatAccountAmount((row as any).balance)}</div>
                  </div>
                </div>
              );
            }}
          />
        </div>
      )}

      {statementAccount && (() => {
        const isPositive = statementBalance >= 0;
        const totalDebit = statementLines.reduce((s, l) => s + l.debit, 0);
        const totalCredit = statementLines.reduce((s, l) => s + l.credit, 0);
        return (
        <AdaptiveModal
          open={!!statementAccount}
          onClose={() => setStatementAccount(null)}
          size="xl"
          zIndex={100}
          panelClassName={`flex h-full max-h-[90vh] flex-col overflow-hidden rounded-[2rem] ring-1 ${isPositive ? 'ring-emerald-200' : 'ring-rose-200'}`}
        >
            <div className={`relative overflow-hidden ${isPositive ? 'bg-gradient-to-l from-emerald-600 via-emerald-700 to-emerald-800' : 'bg-gradient-to-l from-rose-600 via-rose-700 to-rose-800'}`}>
              <div className={`absolute -top-10 -right-10 w-40 h-40 rounded-full ${isPositive ? 'bg-emerald-500/20' : 'bg-rose-500/20'}`} />
              <div className={`absolute -bottom-8 -left-8 w-28 h-28 rounded-full ${isPositive ? 'bg-emerald-400/10' : 'bg-rose-400/10'}`} />

              <div className="relative z-10 p-6 flex justify-between items-start">
                <div className="flex items-center gap-4">
                  <div className="bg-white/15 backdrop-blur-sm p-3.5 rounded-2xl">
                    <Receipt size={24} className="text-white" />
                  </div>
                  <div>
                    <h3 className="text-xl font-black text-white leading-tight">{statementAccount.nameAr}</h3>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-[11px] font-mono text-white/60 bg-white/10 px-2.5 py-0.5 rounded-lg">{statementAccount.code}</span>
                    </div>
                  </div>
                </div>
                <button onClick={() => setStatementAccount(null)} className="p-2 hover:bg-white/15 rounded-xl transition text-white/70 hover:text-white">
                  <XCircle size={22} />
                </button>
              </div>

              <div className="relative z-10 px-6 pb-6 pt-2">
                <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-5 flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-bold text-white/50 mb-1">الرصيد الحالي</p>
                    <p className="text-3xl font-black text-white font-numeric tracking-tight">
                      {formatNumber(Math.abs(statementBalance))}
                      <span className="text-base text-white/50 mr-1.5">$</span>
                    </p>
                  </div>
                  <div className="flex gap-6">
                    <div className="text-center">
                      <p className="text-[10px] text-white/40 font-bold mb-0.5">إجمالي مدين</p>
                      <p className="text-lg font-black text-white/90 font-numeric flex items-center gap-1">
                        <ArrowUpRight size={14} className="text-emerald-300" />
                        {formatNumber(totalDebit)}
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-[10px] text-white/40 font-bold mb-0.5">إجمالي دائن</p>
                      <p className="text-lg font-black text-white/90 font-numeric flex items-center gap-1">
                        <ArrowDownRight size={14} className="text-rose-300" />
                        {formatNumber(totalCredit)}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {statementLoading ? (
                <div className="flex flex-col items-center justify-center py-24 text-gray-400 gap-3">
                  <Loader2 className="animate-spin" size={28} />
                  <span className="text-sm font-bold">جاري تحميل الحركات...</span>
                </div>
              ) : statementLines.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-24 text-gray-300 gap-2">
                  <Receipt size={36} className="opacity-30" />
                  <p className="text-sm font-bold">لا توجد حركات مسجّلة على هذا الحساب</p>
                </div>
              ) : (
                <AdaptiveTable
                  rows={statementLines}
                  keyExtractor={(line: any, idx) => `${line.entryNumber || 'line'}-${idx}`}
                  tabletColumnVisibility={['entryDate', 'description', 'debit', 'credit', 'runningBalance']}
                  columns={[
                    { id: 'index', header: '#', cell: (_: any, idx) => <span className="text-[10px] text-gray-300 font-bold font-numeric">{idx + 1}</span> },
                    {
                      id: 'entryDate',
                      header: 'التاريخ',
                      cell: (line: any) => (
                        <div className="flex items-center gap-1.5">
                          <CalendarDays size={11} className="text-gray-300 shrink-0" />
                          <span className="font-mono text-[11px] text-gray-500 font-bold">{line.entryDate}</span>
                        </div>
                      ),
                    },
                    { id: 'description', header: 'البيان', cell: (line: any) => <span className="block max-w-[280px] truncate text-gray-700 font-bold text-[11px]" title={line.description}>{line.description}</span> },
                    { id: 'entryNumber', header: 'رقم القيد', cell: (line: any) => <span className={`font-mono text-[10px] font-bold px-2 py-0.5 rounded-md ${isPositive ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>{line.entryNumber}</span>, tdClassName: 'text-center' },
                    {
                      id: 'debit',
                      header: 'مدين (+)',
                      cell: (line: any) => line.debit > 0 ? <span className="text-emerald-600 font-bold inline-flex items-center gap-0.5 bg-emerald-50 px-2 py-0.5 rounded-lg text-[11px]"><ArrowUpRight size={11} />{formatNumber(line.debit)}</span> : <span className="text-gray-200">—</span>,
                      tdClassName: 'text-center',
                    },
                    {
                      id: 'credit',
                      header: 'دائن (-)',
                      cell: (line: any) => line.credit > 0 ? <span className="text-rose-500 font-bold inline-flex items-center gap-0.5 bg-rose-50 px-2 py-0.5 rounded-lg text-[11px]"><ArrowDownRight size={11} />{formatNumber(line.credit)}</span> : <span className="text-gray-200">—</span>,
                      tdClassName: 'text-center',
                    },
                    {
                      id: 'runningBalance',
                      header: 'الرصيد',
                      cell: (line: any) => <span className={`font-numeric font-black text-[11px] ${line.runningBalance > 0 ? 'text-emerald-600' : line.runningBalance < 0 ? 'text-rose-500' : 'text-gray-400'}`}>{formatNumber(Math.abs(line.runningBalance))}</span>,
                      tdClassName: 'text-center',
                    },
                  ]}
                  rowClassName={(_, idx) => `${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} transition-colors ${isPositive ? 'hover:bg-emerald-50/40' : 'hover:bg-rose-50/40'}`}
                  mobileCardRender={(line: any, idx) => (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] text-gray-300 font-bold">#{idx + 1}</span>
                        <span className="font-mono text-[11px] text-gray-500">{line.entryDate}</span>
                      </div>
                      <div className="font-bold text-[11px] text-gray-700">{line.description}</div>
                      <div className="grid grid-cols-3 gap-2 text-[11px]">
                        <div className="rounded-lg bg-emerald-50 p-2 text-emerald-700 font-bold font-numeric">{line.debit > 0 ? formatNumber(line.debit) : '—'}</div>
                        <div className="rounded-lg bg-rose-50 p-2 text-rose-700 font-bold font-numeric">{line.credit > 0 ? formatNumber(line.credit) : '—'}</div>
                        <div className="rounded-lg bg-gray-100 p-2 text-gray-700 font-bold font-numeric">{formatNumber(Math.abs(line.runningBalance))}</div>
                      </div>
                    </div>
                  )}
                />
              )}
            </div>

            <div className={`px-6 py-3 flex items-center justify-between border-t ${isPositive ? 'bg-emerald-50/50 border-emerald-100' : 'bg-rose-50/50 border-rose-100'}`}>
              <p className="text-[10px] text-gray-400 font-bold">
                عدد الحركات: <span className="text-gray-700 font-numeric font-black">{statementLines.length}</span>
              </p>
              <div className={`text-[10px] font-black px-3 py-1 rounded-lg ${isPositive ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                {isPositive ? 'رصيد مدين ↗' : 'رصيد دائن ↘'}
              </div>
            </div>
        </AdaptiveModal>
        );
      })()}

      {isModalOpen && (
        <AdaptiveModal open={isModalOpen} onClose={() => setIsModalOpen(false)} size="lg" zIndex={100} panelClassName="flex h-full max-h-[92vh] flex-col">
          <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-lg overflow-hidden animate-fadeIn border-t-8 border-emerald-600 flex flex-col">
            <div className="p-8 bg-gray-900 text-white flex justify-between items-center relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full translate-x-10 -translate-y-10"></div>
                <div className="relative z-10 flex items-center gap-4">
                  <div className="bg-emerald-600 p-3 rounded-2xl shadow-xl shadow-emerald-500/20"><ListTree size={24} /></div>
                  <div>
                  <h3 className="text-xl font-black">{editingId ? 'تعديل حساب' : 'إضافة حساب جديد'}</h3>
                  <p className="text-[10px] text-gray-400 mt-1 uppercase tracking-widest font-bold">Chart of Accounts Engine v1.0</p>
                  </div>
                </div>
              <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-rose-500 rounded-full transition relative z-10"><XCircle size={24} /></button>
            </div>

            <form onSubmit={handleSave} className="p-10 space-y-8 bg-white">
              <div className="space-y-6">
                <div>
                  <label className="text-[10px] font-black text-gray-400 block mb-2 uppercase tracking-widest">اسم الحساب (عربي)</label>
                  <input
                    required
                    value={form.nameAr || ''}
                    onChange={e => setForm({ ...form, nameAr: e.target.value })}
                    className="w-full border-2 border-gray-100 rounded-2xl p-4 font-black text-lg focus:border-emerald-500 outline-none transition shadow-sm"
                    placeholder="مثال: الصندوق الرئيسي..."
                  />
                </div>

                <div>
                  <label className="text-[10px] font-black text-gray-400 block mb-2 uppercase tracking-widest">اسم الحساب (إنجليزي - اختياري)</label>
                  <input
                    value={form.nameEn || ''}
                    onChange={e => setForm({ ...form, nameEn: e.target.value })}
                    className="w-full border-2 border-gray-100 rounded-2xl p-4 font-bold focus:border-emerald-500 outline-none transition shadow-sm"
                    placeholder="Optional English name"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-black text-gray-400 block mb-2 uppercase tracking-widest">كود الحساب</label>
                  <input
                    required
                    value={form.code || ''}
                    onChange={e => setForm({ ...form, code: e.target.value })}
                    className="w-full border-2 border-gray-100 rounded-2xl p-4 font-bold focus:border-emerald-500 outline-none transition shadow-sm font-mono"
                    placeholder="1100, 4100, ..."
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-black text-gray-400 block mb-2 uppercase tracking-widest">نوع الحساب</label>
                    <select
                      disabled={!!form.parentId}
                      value={form.accountType}
                      onChange={e => setForm({ ...form, accountType: e.target.value as AccountType })}
                      className="w-full border-2 border-gray-100 rounded-2xl p-4 font-bold bg-gray-50 disabled:opacity-50 outline-none focus:border-emerald-500"
                    >
                      <option value="assets">أصول (Assets)</option>
                      <option value="liabilities">خصوم (Liabilities)</option>
                      <option value="equity">حقوق ملكية (Equity)</option>
                      <option value="revenue">إيرادات (Revenue)</option>
                      <option value="expenses">مصروفات (Expenses)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-gray-400 block mb-2 uppercase tracking-widest">طبيعة الحساب</label>
                    <select
                      value={form.accountNature}
                      onChange={e => setForm({ ...form, accountNature: e.target.value as any })}
                      className="w-full border-2 border-gray-100 rounded-2xl p-4 font-bold bg-gray-50 outline-none focus:border-emerald-500"
                    >
                      <option value="debit">مدين (Debit)</option>
                      <option value="credit">دائن (Credit)</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="flex items-center gap-4 bg-gray-50 p-4 rounded-2xl border border-gray-100">
                    <div className="flex-1">
                      <label className="text-[10px] font-black text-gray-400 block uppercase tracking-widest">حساب رئيسي</label>
                      <p className="text-[9px] text-gray-400">لن يتم القيد عليه مباشرة</p>
                    </div>
                    <input type="checkbox" checked={!!form.isParent} onChange={e => setForm({ ...form, isParent: e.target.checked })} className="w-6 h-6 text-emerald-600 rounded-lg cursor-pointer" />
                  </div>
                  <div className="flex items-center gap-4 bg-gray-50 p-4 rounded-2xl border border-gray-100">
                    <div className="flex-1">
                      <label className="text-[10px] font-black text-gray-400 block uppercase tracking-widest">الحساب فعال</label>
                      <p className="text-[9px] text-gray-400">يمكن استخدامه أثناء القيود</p>
                    </div>
                    <input type="checkbox" checked={form.isActive !== false} onChange={e => setForm({ ...form, isActive: e.target.checked })} className="w-6 h-6 text-emerald-600 rounded-lg cursor-pointer" />
                  </div>
                </div>

                <div className="flex items-center gap-4 bg-gray-50 p-4 rounded-2xl border border-gray-100">
                  <div className="flex-1">
                    <label className="text-[10px] font-black text-gray-400 block uppercase tracking-widest">حساب نظام</label>
                    <p className="text-[9px] text-gray-400">الحسابات النظامية الأساسية غير قابلة للحذف</p>
                  </div>
                  <input type="checkbox" checked={!!form.isSystem} onChange={e => setForm({ ...form, isSystem: e.target.checked })} className="w-6 h-6 text-emerald-600 rounded-lg cursor-pointer" />
                </div>

                {form.parentId && (
                  <div className="bg-emerald-50 p-4 rounded-2xl border border-emerald-100 flex items-start gap-3">
                    <Info size={18} className="text-emerald-500 shrink-0" />
                    <div className="text-[10px] text-emerald-800 font-bold leading-relaxed">
                      سيتم إنشاء هذا الحساب كحساب فرعي تحت <span className="font-black">({accounts.find(a => a.id === form.parentId)?.nameAr})</span>.
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-3 pt-6 border-t">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-8 py-3 text-gray-500 font-bold hover:bg-gray-100 rounded-xl transition">إلغاء</button>
                <button type="submit" disabled={isSaving} className="bg-emerald-600 text-white px-12 py-3 rounded-2xl font-black shadow-xl hover:bg-emerald-700 transition flex items-center gap-2 transform active:scale-95 disabled:bg-gray-400">
                  {isSaving ? <RefreshCw className="animate-spin" size={20} /> : <CheckCircle2 size={20} />} حفظ الحساب
                </button>
              </div>
            </form>
          </div>
        </AdaptiveModal>
      )}
    </div>
  );
};

export default Accounts;
