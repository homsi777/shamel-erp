import { useMemo, useState } from 'react';
import { Currency, OpeningStockLine } from '../types';
import { postOpeningStock } from '../lib/api';

const todayIso = () => new Date().toISOString().slice(0, 10);

const emptyLine = (): OpeningStockLine => ({
  id: `line-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  item_id: null,
  item_name: '',
  item_code: '',
  unit: '',
  quantity: 0,
  cost_price: 0,
  currency: 'USD',
  warehouse_id: null,
  total: 0,
  notes: ''
});

interface UseOpeningStockProps {
  items?: { id: number | string; name: string; code: string; unit: string }[];
}

export const useOpeningStock = ({ items = [] }: UseOpeningStockProps = {}) => {
  const [lines, setLines] = useState<OpeningStockLine[]>([emptyLine()]);
  const [fiscalYear, setFiscalYear] = useState('2026');
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [currency, setCurrency] = useState<Currency>('USD');
  const [date, setDate] = useState(todayIso());
  const [isPosting, setIsPosting] = useState(false);
  const [isPosted, setIsPosted] = useState(false);

  const addLine = () => setLines((prev) => [...prev, { ...emptyLine(), currency }]);
  const removeLine = (id: string) => setLines((prev) => prev.filter((l) => l.id !== id));
  const duplicateLine = (id: string) => {
    const target = lines.find((l) => l.id === id);
    if (!target) return;
    const copy = { ...target, id: `line-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` };
    setLines((prev) => [...prev, copy]);
  };

  const updateLine = (id: string, field: keyof OpeningStockLine, value: any) => {
    setLines((prev) =>
      prev.map((line) => {
        if (line.id !== id) return line;
        const next = { ...line, [field]: value } as OpeningStockLine;
        if (field === 'item_id') {
          const match = items.find((i) => String(i.id) === String(value));
          next.item_name = match?.name || '';
          next.item_code = match?.code || '';
          next.unit = match?.unit || '';
        }
        if (field === 'quantity' || field === 'cost_price') {
          const qty = Number(next.quantity) || 0;
          const cost = Number(next.cost_price) || 0;
          next.total = Number((qty * cost).toFixed(2));
        }
        return next;
      })
    );
  };

  const summary = useMemo(() => {
    const totalItems = lines.filter((l) => l.item_id).length;
    const totalQuantity = lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0);
    const totalsByCurrency = {
      USD: 0,
      SYP: 0,
      TRY: 0
    } as Record<Currency, number>;
    lines.forEach((line) => {
      totalsByCurrency[line.currency] += Number(line.total) || 0;
    });
    return {
      totalItems,
      totalQuantity,
      totalByUSD: totalsByCurrency.USD,
      totalBySYP: totalsByCurrency.SYP,
      totalByTRY: totalsByCurrency.TRY
    };
  }, [lines]);

  const handleConfirm = async () => {
    const validLines = lines.filter((l) => l.item_id && Number(l.quantity || 0) > 0);
    if (validLines.length === 0) {
      window.dispatchEvent(new CustomEvent('shamel-alert', { detail: { message: 'أضف صنفاً واحداً على الأقل بكمية أكبر من صفر.' } }));
      return;
    }

    const lineWarehouseIds = Array.from(
      new Set(
        validLines
          .map((l) => (l.warehouse_id ? String(l.warehouse_id) : ''))
          .filter(Boolean)
      )
    );
    const effectiveWarehouseId =
      (warehouseId ? String(warehouseId) : '') ||
      (lineWarehouseIds.length === 1 ? lineWarehouseIds[0] : '');

    if (!effectiveWarehouseId) {
      const message = lineWarehouseIds.length > 1
        ? 'يجب اختيار مخزن واحد في إعدادات أول المدة عند وجود أصناف من عدة مخازن.'
        : 'يجب اختيار المخزن.';
      window.dispatchEvent(new CustomEvent('shamel-alert', { detail: { message } }));
      return;
    }

    const payloadLines = validLines.map((line) => ({
      ...line,
      warehouse_id: line.warehouse_id || effectiveWarehouseId
    }));

    setIsPosting(true);
    try {
      const result = await postOpeningStock({
        fiscalYear,
        warehouseId: effectiveWarehouseId,
        currency,
        date,
        lines: payloadLines
      });
      setWarehouseId(effectiveWarehouseId);
      setIsPosted(true);
      setLines([emptyLine()]);
      window.dispatchEvent(new CustomEvent('shamel-alert', {
        detail: { message: `تم التأكيد بنجاح: ${result?.linesPosted ?? payloadLines.length} سطر — الإجمالي ${result?.totalAmount ?? ''} ${currency}` }
      }));
    } catch (e: any) {
      const msg = e?.message || 'فشل ترحيل مواد أول المدة.';
      window.dispatchEvent(new CustomEvent('shamel-alert', { detail: { message: msg } }));
    } finally {
      setIsPosting(false);
    }
  };

  return {
    lines,
    setLines,
    fiscalYear,
    setFiscalYear,
    warehouseId,
    setWarehouseId,
    currency,
    setCurrency,
    date,
    setDate,
    addLine,
    removeLine,
    duplicateLine,
    updateLine,
    summary,
    handleConfirm,
    isPosting,
    isPosted
  };
};
