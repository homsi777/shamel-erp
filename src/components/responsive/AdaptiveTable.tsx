import React from 'react';
import useResponsiveLayout from '../../hooks/useResponsiveLayout';

export type AdaptiveTableColumn<T> = {
  id: string;
  header: React.ReactNode;
  cell: (row: T, index: number) => React.ReactNode;
  mobileLabel?: React.ReactNode;
  mobileValue?: (row: T, index: number) => React.ReactNode;
  thClassName?: string;
  tdClassName?: string;
  hideOnMobile?: boolean;
};

type AdaptiveTableProps<T> = {
  rows: T[];
  columns: AdaptiveTableColumn<T>[];
  keyExtractor: (row: T, index: number) => string;
  onRowClick?: (row: T, index: number) => void;
  onRowContextMenu?: (event: React.MouseEvent, row: T, index: number) => void;
  emptyState?: React.ReactNode;
  loading?: boolean;
  loadingState?: React.ReactNode;
  mobileCardRender?: (row: T, index: number) => React.ReactNode;
  rowClassName?: (row: T, index: number) => string;
  desktopWrapperClassName?: string;
  tableClassName?: string;
  minTableWidthClassName?: string;
  mobileContainerClassName?: string;
  mobileCardClassName?: string;
  mobileMode?: 'auto' | 'cards' | 'scroll';
  tabletMode?: 'table' | 'cards' | 'scroll';
  enableStickyActions?: boolean;
  tabletColumnVisibility?: string[];
};

const AdaptiveTable = <T,>({
  rows,
  columns,
  keyExtractor,
  onRowClick,
  onRowContextMenu,
  emptyState = null,
  loading = false,
  loadingState = null,
  mobileCardRender,
  rowClassName,
  desktopWrapperClassName = 'overflow-auto rounded-2xl border border-gray-200',
  tableClassName = 'w-full text-sm',
  minTableWidthClassName = 'min-w-[680px]',
  mobileContainerClassName = 'space-y-3',
  mobileCardClassName = 'rounded-2xl border border-gray-200 bg-white p-4 shadow-sm',
  mobileMode = 'auto',
  tabletMode = 'table',
  enableStickyActions = false,
  tabletColumnVisibility,
}: AdaptiveTableProps<T>) => {
  const layout = useResponsiveLayout();

  if (loading) {
    return <>{loadingState}</>;
  }

  if (rows.length === 0) {
    return <>{emptyState}</>;
  }

  const shouldRenderCardsOnMobile = mobileMode === 'cards' || (mobileMode === 'auto' && Boolean(mobileCardRender));
  const shouldRenderCardsOnTablet = tabletMode === 'cards';
  const shouldRenderScrollableTableOnTablet = tabletMode === 'scroll';
  const shouldRenderCards = (layout.isMobile && shouldRenderCardsOnMobile) || (layout.isTablet && shouldRenderCardsOnTablet);
  const shouldRenderScrollableTable = layout.isMobile
    ? mobileMode === 'scroll'
    : layout.isTablet
      ? shouldRenderScrollableTableOnTablet
      : false;
  const visibleColumns = layout.isTablet && tabletColumnVisibility?.length
    ? columns.filter((column) => tabletColumnVisibility.includes(column.id))
    : columns;
  const stickyActionsActive = enableStickyActions && layout.isTablet && visibleColumns.length > 0;
  const stickyActionsColumnId = stickyActionsActive ? visibleColumns[visibleColumns.length - 1]?.id : null;

  if (shouldRenderCards) {
    return (
      <div className={mobileContainerClassName}>
        {rows.map((row, index) => (
          <div
            key={keyExtractor(row, index)}
            className={`${mobileCardClassName} ${onRowClick ? 'cursor-pointer hover:border-primary/40 tap-feedback touch-highlight' : ''}`.trim()}
            onClick={onRowClick ? () => onRowClick(row, index) : undefined}
            onContextMenu={onRowContextMenu ? (event) => onRowContextMenu(event, row, index) : undefined}
            role={onRowClick ? 'button' : undefined}
            tabIndex={onRowClick ? 0 : undefined}
            onKeyDown={(event) => {
              if (!onRowClick) return;
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onRowClick(row, index);
              }
            }}
          >
            {mobileCardRender ? (
              mobileCardRender(row, index)
            ) : (
              <div className="space-y-3">
                {visibleColumns.filter((column) => !column.hideOnMobile).map((column) => (
                  <div key={column.id} className="flex items-start justify-between gap-3">
                    <div className="shrink-0 text-[11px] font-bold text-gray-500">
                      {column.mobileLabel || column.header}
                    </div>
                    <div className="text-left text-sm font-bold text-gray-800">
                      {column.mobileValue ? column.mobileValue(row, index) : column.cell(row, index)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={`${desktopWrapperClassName} ${shouldRenderScrollableTable ? 'overflow-x-auto' : ''}`.trim()}>
      <table className={`${tableClassName} ${shouldRenderScrollableTable ? minTableWidthClassName : ''}`.trim()}>
        <thead className="sticky top-0 z-10 bg-white shadow-sm">
          <tr className="border-b-2 border-gray-300">
            {visibleColumns.map((column) => (
              <th
                key={column.id}
                className={`px-4 py-3 text-right ${layout.isTablet ? 'text-xs' : ''} ${
                  stickyActionsColumnId === column.id ? 'sticky right-0 z-30 bg-white shadow-[-8px_0_10px_-8px_rgba(0,0,0,0.25)]' : ''
                } ${column.thClassName || ''}`.trim()}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={keyExtractor(row, index)}
              className={`${rowClassName ? rowClassName(row, index) : (index % 2 === 0 ? 'bg-white' : 'bg-gray-50')} ${onRowClick ? 'cursor-pointer hover:bg-teal-50' : ''}`.trim()}
              onClick={onRowClick ? () => onRowClick(row, index) : undefined}
              onContextMenu={onRowContextMenu ? (event) => onRowContextMenu(event, row, index) : undefined}
            >
              {visibleColumns.map((column) => (
                <td
                  key={column.id}
                  className={`px-4 ${layout.isTablet ? 'py-1.5 text-xs' : 'py-2'} ${
                    stickyActionsColumnId === column.id ? 'sticky right-0 z-20 bg-white shadow-[-8px_0_10px_-8px_rgba(0,0,0,0.15)]' : ''
                  } ${column.tdClassName || ''}`.trim()}
                >
                  {column.cell(row, index)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default AdaptiveTable;
