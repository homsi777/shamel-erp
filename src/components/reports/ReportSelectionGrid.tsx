import React, { useEffect, useMemo, useState } from 'react';
import { FileText, Pin, PinOff, Search, Sparkles } from 'lucide-react';
import {
    getQuickAccessReports,
    getReportTypes,
    REPORT_CATEGORIES,
    searchReports,
    type ReportDefinition,
} from '../../modules/reports/report.definitions';
import { LabelSettings } from '../../types';

interface Props {
    onSelect: (id: string) => void;
    labels?: LabelSettings;
}

const PIN_STORAGE_KEY = 'erp_report_pins';

const ReportSelectionGrid: React.FC<Props> = ({ onSelect }) => {
    const [query, setQuery] = useState('');
    const [pinnedIds, setPinnedIds] = useState<string[]>([]);

    useEffect(() => {
        try {
            const raw = localStorage.getItem(PIN_STORAGE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                setPinnedIds(parsed.map((x) => String(x)));
            }
        } catch {
            setPinnedIds([]);
        }
    }, []);

    const togglePin = (id: string) => {
        setPinnedIds((prev) => {
            const next = prev.includes(id) ? prev.filter((x) => x !== id) : [id, ...prev].slice(0, 24);
            localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify(next));
            return next;
        });
    };

    const allReports = useMemo(() => getReportTypes(), []);

    const visibleReports = useMemo(() => {
        if (!query.trim()) return allReports;
        return searchReports(query).filter((r) => !r.hidden);
    }, [allReports, query]);

    const pinnedReports = useMemo(() => {
        const byId = new Map(allReports.map((r) => [r.id, r] as const));
        return pinnedIds.map((id) => byId.get(id)).filter(Boolean) as ReportDefinition[];
    }, [allReports, pinnedIds]);

    const quickAccess = useMemo(
        () => getQuickAccessReports().filter((r) => r.availability !== 'requires_dataset'),
        []
    );

    const groupedReports = useMemo(() => {
        return REPORT_CATEGORIES
            .map((category) => ({
                category,
                reports: visibleReports.filter((r) => r.categoryId === category.id),
            }))
            .filter((group) => group.reports.length > 0)
            .sort((a, b) => a.category.order - b.category.order);
    }, [visibleReports]);

    const renderCard = (report: ReportDefinition) => {
        const pinned = pinnedIds.includes(report.id);
        const isRequiresDataset = report.availability === 'requires_dataset';
        return (
            <div
                key={report.id}
                className={`bg-white rounded-2xl border p-4 shadow-sm transition ${
                    isRequiresDataset ? 'border-amber-300' : 'border-gray-200 hover:shadow-md'
                }`}
            >
                <div className="flex items-start justify-between gap-2">
                    <button
                        type="button"
                        onClick={() => onSelect(report.id)}
                        className="flex-1 text-right"
                    >
                        <div className="flex items-center gap-3">
                            <div className="shrink-0 rounded-xl bg-gray-50 p-2">
                                {React.cloneElement(report.icon as React.ReactElement<any>, { size: 20 })}
                            </div>
                            <div className="min-w-0">
                                <h3 className="font-bold text-gray-800 truncate">{report.name}</h3>
                                <p className="text-xs text-gray-500 mt-1 line-clamp-2">{report.description}</p>
                                {isRequiresDataset ? (
                                    <>
                                        <div className="mt-2 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                                            قيد التجهيز - يتطلب بيانات إضافية
                                        </div>
                                        {report.availabilityNote ? (
                                            <p className="mt-1 text-[11px] text-amber-700 line-clamp-2">{report.availabilityNote}</p>
                                        ) : null}
                                    </>
                                ) : null}
                            </div>
                        </div>
                    </button>
                    <button
                        type="button"
                        onClick={() => togglePin(report.id)}
                        className={`rounded-lg p-2 border ${pinned ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-gray-50 border-gray-200 text-gray-500'}`}
                        title={pinned ? 'إلغاء التثبيت' : 'تثبيت التقرير'}
                        aria-label={pinned ? 'إلغاء التثبيت' : 'تثبيت التقرير'}
                    >
                        {pinned ? <PinOff size={14} /> : <Pin size={14} />}
                    </button>
                </div>
            </div>
        );
    };

    return (
        <div className="animate-fadeIn" dir="rtl">
            <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                    <h2 className="text-2xl font-black text-gray-800 flex items-center gap-2">
                        <FileText className="text-primary" /> مركز التقارير
                    </h2>
                    <p className="text-sm text-gray-500 mt-1">هيكل تقارير محاسبي وإداري مصنّف حسب القسم.</p>
                </div>
                <div className="relative w-full md:w-96">
                    <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="ابحث عن تقرير بالاسم..."
                        className="w-full rounded-xl border border-gray-300 bg-white py-2.5 pr-9 pl-3 text-sm outline-none focus:border-primary"
                    />
                </div>
            </div>

            {!!pinnedReports.length && (
                <section className="mb-8">
                    <h3 className="font-bold text-gray-800 mb-3 flex items-center gap-2">
                        <Pin size={16} className="text-amber-600" /> التقارير المثبتة
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                        {pinnedReports.map(renderCard)}
                    </div>
                </section>
            )}

            <section className="mb-8">
                <h3 className="font-bold text-gray-800 mb-3 flex items-center gap-2">
                    <Sparkles size={16} className="text-primary" /> التقارير السريعة
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {quickAccess.map(renderCard)}
                </div>
            </section>

            <div className="space-y-8">
                {groupedReports.map(({ category, reports }) => (
                    <section key={category.id}>
                        <div className="mb-3">
                            <h3 className="text-lg font-black text-gray-800 flex items-center gap-2">
                                {React.cloneElement(category.icon as React.ReactElement<any>, { size: 18 })}
                                {category.label}
                            </h3>
                            <p className="text-xs text-gray-500 mt-1">{category.description}</p>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                            {reports.map(renderCard)}
                        </div>
                    </section>
                ))}
            </div>
        </div>
    );
};

export default ReportSelectionGrid;
