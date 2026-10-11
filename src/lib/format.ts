/** 展示层格式化：统一处理 null（分母为 0）的展示 */

export function fmtPct(v: number | null, digits = 1): string {
  if (v === null || !Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(digits)}%`;
}

export function fmtSec(ms: number | null, digits = 2): string {
  if (ms === null || !Number.isFinite(ms)) return '—';
  return `${(ms / 1000).toFixed(digits)}s`;
}

export function fmtInt(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '—';
  return v.toLocaleString('zh-CN');
}

export function fmtDelta(v: number | null, unit: 'pct' | 'sec' | 'int'): string {
  if (v === null || !Number.isFinite(v)) return '—';
  const sign = v > 0 ? '+' : '';
  if (unit === 'pct') return `${sign}${(v * 100).toFixed(1)}pp`;
  if (unit === 'sec') return `${sign}${(v / 1000).toFixed(2)}s`;
  return `${sign}${Math.round(v)}`;
}

export function fmtMinutes(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '—';
  if (v < 1) return '刚刚';
  if (v < 60) return `${Math.round(v)} 分钟前`;
  const h = Math.floor(v / 60);
  const m = Math.round(v % 60);
  return `${h} 小时 ${m} 分钟前`;
}
