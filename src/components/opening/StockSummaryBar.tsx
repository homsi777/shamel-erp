import React from 'react';

interface StockSummaryBarProps {
  totalItems: number;
  totalQuantity: number;
  totalByUSD: number;
  totalBySYP: number;
  totalByTRY: number;
}

const StockSummaryBar: React.FC<StockSummaryBarProps> = ({
  totalItems,
  totalQuantity,
  totalByUSD,
  totalBySYP,
  totalByTRY
}) => {
  return (
    <div className="bg-white rounded-2xl border shadow-sm p-4 md:p-5 flex flex-wrap items-center gap-4">
      <div className="text-sm font-black text-gray-800">الأصناف: {totalItems}</div>
      <div className="text-sm font-black text-gray-800">الكميات: {totalQuantity}</div>
      <div className="text-sm font-black text-gray-800">USD: {totalByUSD.toFixed(2)}</div>
      <div className="text-sm font-black text-gray-800">SYP: {totalBySYP.toFixed(2)}</div>
      <div className="text-sm font-black text-gray-800">TRY: {totalByTRY.toFixed(2)}</div>
    </div>
  );
};

export default StockSummaryBar;
