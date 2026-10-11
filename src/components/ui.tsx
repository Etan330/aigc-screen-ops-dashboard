import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';

/* --------------------------------- 卡片 ---------------------------------- */

export interface ChartCardProps {
  title: string;
  subtitle?: string;
  note?: ReactNode;
  extra?: ReactNode;
  /**
   * 图表区高度（px）。
   * 传入 'auto' 时不再固定高度，由内容自行撑开——用于漏斗等「非图表」内容，
   * 避免内容超出固定高度后溢出卡片、压住下方模块。
   */
  height?: number | 'auto';
  isEmpty?: boolean;
  emptyText?: string;
  children: ReactNode;
}

export function ChartCard({
  title,
  subtitle,
  note,
  extra,
  height = 240,
  isEmpty = false,
  emptyText = '当前筛选条件下没有数据',
  children,
}: ChartCardProps) {
  const autoHeight = height === 'auto';
  const boxStyle = autoHeight ? undefined : { height };

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h3 className="card-title">{title}</h3>
          {subtitle ? <p className="card-sub">{subtitle}</p> : null}
        </div>
        {extra}
      </div>
      <div className="card-body">
        {isEmpty ? (
          <div className="empty" style={autoHeight ? { minHeight: 200 } : { height }}>
            <Inbox className="icon" size={26} />
            <div>{emptyText}</div>
          </div>
        ) : (
          <div style={boxStyle}>{children}</div>
        )}
        {note ? <div style={{ padding: '0 4px', marginTop: 6 }}>{note}</div> : null}
      </div>
    </div>
  );
}

/* --------------------------------- 徽标 ---------------------------------- */

export function Badge({
  tone = 'gray',
  children,
}: {
  tone?: 'success' | 'danger' | 'warn' | 'primary' | 'gray' | 'purple';
  children: ReactNode;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function StatusDot({ online }: { online: boolean }) {
  return (
    <span className="dot" style={{ background: online ? 'var(--c-success)' : 'var(--c-danger)' }} />
  );
}

/* ------------------------------- 图表 Tooltip ----------------------------- */

export interface TooltipPayloadItem {
  name?: string;
  value?: number | string | null;
  color?: string;
  dataKey?: string | number;
  payload?: Record<string, unknown>;
}

export interface ChartTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string | number;
  labelFormatter?: (label: string | number | undefined) => string;
  valueFormatter?: (value: number | null, key: string) => string;
}

export function ChartTooltip({
  active,
  payload,
  label,
  labelFormatter,
  valueFormatter,
}: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="chart-tooltip">
      <div className="t-title">{labelFormatter ? labelFormatter(label) : String(label ?? '')}</div>
      {payload.map((p, i) => {
        const key = String(p.dataKey ?? p.name ?? '');
        const raw = typeof p.value === 'number' ? p.value : null;
        return (
          <div className="t-row" key={`${key}-${i}`}>
            <span>
              <span className="legend-dot" style={{ background: p.color ?? '#2f5be3', marginRight: 6 }} />
              {p.name}
            </span>
            <b>{valueFormatter ? valueFormatter(raw, key) : String(p.value ?? '—')}</b>
          </div>
        );
      })}
    </div>
  );
}

/**
 * 把自定义 Tooltip 渲染函数包装成 Recharts 接受的 content 类型。
 * Recharts 的 Payload 类型是宽联合，这里统一收敛到 TooltipPayloadItem。
 */
export const renderTooltip = (
  fn: (p: { active?: boolean; payload?: TooltipPayloadItem[]; label?: string | number }) => ReactNode,
) => {
  return (props: unknown) =>
    fn((props ?? {}) as { active?: boolean; payload?: TooltipPayloadItem[]; label?: string | number });
};

/* --------------------------------- 进度条 -------------------------------- */

export function RatioBar({ value, color }: { value: number | null; color: string }) {
  if (value === null || !Number.isFinite(value)) {
    return <span style={{ color: 'var(--c-text-weak)', fontSize: 12 }}>—</span>;
  }
  return (
    <div className="ratio-bar" title={`${(value * 100).toFixed(1)}%`}>
      <span style={{ width: `${Math.max(2, Math.min(100, value * 100))}%`, background: color }} />
    </div>
  );
}

/* --------------------------------- 加载 ---------------------------------- */

export function LoadingBlock({ text = '数据加载中…' }: { text?: string }) {
  return (
    <div className="loading-page">
      <div className="spinner" />
      <div>{text}</div>
    </div>
  );
}

export function SkeletonCards({ count = 7 }: { count?: number }) {
  return (
    <div className="kpi-grid">
      {Array.from({ length: count }).map((_, i) => (
        <div className="skeleton" key={i} style={{ height: 108 }} />
      ))}
    </div>
  );
}
