/**
 * Smart Card Component
 * عرض بطاقة التفاصيل
 */
import React from 'react';
import { SmartQuickViewResponse, SmartBadge, SmartField, SmartSection, SmartTable } from '../../types/smart';

interface SmartCardProps {
  data: SmartQuickViewResponse;
}

const BadgeDisplay: React.FC<{ badge: SmartBadge }> = ({ badge }) => {
  const kindClasses: Record<string, string> = {
    default: 'bg-gray-100 text-gray-700',
    success: 'bg-green-100 text-green-700',
    warning: 'bg-amber-100 text-amber-700',
    danger: 'bg-red-100 text-red-700',
    info: 'bg-blue-100 text-blue-700',
    muted: 'bg-gray-50 text-gray-500',
  };

  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${kindClasses[badge.kind] || kindClasses.default}`}>
      {badge.label}: {badge.value}
    </span>
  );
};

const FieldDisplay: React.FC<{ field: SmartField }> = ({ field }) => {
  const formatValue = (value: string | number | null, type?: string): string => {
    if (value === null || value === undefined) return '—';
    if (type === 'currency' && typeof value === 'number') {
      return new Intl.NumberFormat('ar-SY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
    }
    if (type === 'number' && typeof value === 'number') {
      return new Intl.NumberFormat('ar-SY').format(value);
    }
    if (type === 'date' && value) {
      try {
        return new Date(value as string).toLocaleDateString('ar-SY');
      } catch {
        return String(value);
      }
    }
    return String(value);
  };

  return (
    <div className="flex justify-between items-start py-2 border-b border-gray-50 last:border-0">
      <span className="text-gray-500 text-sm">{field.label}</span>
      <span className="font-medium text-gray-800 text-sm text-left max-w-[60%]">
        {field.badge ? (
          <BadgeDisplay badge={field.badge} />
        ) : (
          formatValue(field.value, field.type)
        )}
      </span>
    </div>
  );
};

const formatTableValue = (value: string | number | null, type?: string): string => {
  if (value === null || value === undefined) return '—';
  if (type === 'currency' && typeof value === 'number') {
    return new Intl.NumberFormat('ar-SY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  }
  if (type === 'number' && typeof value === 'number') {
    return new Intl.NumberFormat('ar-SY').format(value);
  }
  return String(value);
};

const TableDisplay: React.FC<{ table: SmartTable }> = ({ table }) => {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50/50">
            <th className="py-2 px-2 text-right text-xs font-semibold text-gray-500 w-8">#</th>
            {table.columns.map((col) => (
              <th
                key={col.key}
                className={`py-2 px-2 text-xs font-semibold text-gray-500 ${
                  col.type === 'number' || col.type === 'currency' ? 'text-left' : 'text-right'
                }`}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.data.map((row, rowIdx) => (
            <tr key={rowIdx} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors">
              <td className="py-1.5 px-2 text-xs text-gray-400">{rowIdx + 1}</td>
              {table.columns.map((col) => (
                <td
                  key={col.key}
                  className={`py-1.5 px-2 text-sm ${
                    col.type === 'number' || col.type === 'currency'
                      ? 'text-left font-medium text-gray-700'
                      : 'text-right text-gray-800'
                  }`}
                >
                  {formatTableValue(row[col.key] ?? null, col.type)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Summary row */}
      {table.summary && table.summary.length > 0 && (
        <div className="border-t-2 border-gray-200 mt-1 pt-2 px-2 space-y-1">
          {table.summary.map((item, idx) => (
            <div key={idx} className="flex justify-between items-center text-sm">
              <span className="text-gray-500 font-medium">{item.label}</span>
              <span className="font-bold text-gray-800">{String(item.value)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const SectionDisplay: React.FC<{ section: SmartSection }> = ({ section }) => {
  const [isCollapsed, setIsCollapsed] = React.useState(section.collapsed || false);

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="w-full flex justify-between items-center px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
      >
        <span className="font-semibold text-gray-700 text-sm">{section.title}</span>
        <span className="text-gray-400 text-xs">{isCollapsed ? '▼' : '▲'}</span>
      </button>
      {!isCollapsed && (
        <div className="px-4 py-2">
          {section.table ? (
            <TableDisplay table={section.table} />
          ) : (
            section.rows.map((field, idx) => (
              <FieldDisplay key={idx} field={field} />
            ))
          )}
        </div>
      )}
    </div>
  );
};

const SmartCard: React.FC<SmartCardProps> = ({ data }) => {
  return (
    <div className="space-y-4">
      {/* Badges */}
      {data.badges && data.badges.length > 0 && (
        <div className="flex flex-wrap gap-2 pb-2">
          {data.badges.map((badge, idx) => (
            <BadgeDisplay key={idx} badge={badge} />
          ))}
        </div>
      )}

      {/* Main Fields */}
      {data.fields && data.fields.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          {data.fields.map((field, idx) => (
            <FieldDisplay key={idx} field={field} />
          ))}
        </div>
      )}

      {/* Sections */}
      {data.sections && data.sections.length > 0 && (
        <div className="space-y-3">
          {data.sections.map((section, idx) => (
            <SectionDisplay key={idx} section={section} />
          ))}
        </div>
      )}
    </div>
  );
};

export default SmartCard;
