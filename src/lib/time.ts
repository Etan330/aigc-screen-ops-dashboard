import type { DateRange } from '../types';

/**
 * 模拟数据中的时间戳均为 "YYYY-MM-DDTHH:MM:SS"（Asia/Shanghai，UTC+8，无时区后缀）。
 * 统一在此处处理，避免浏览器本地时区造成的日期漂移。
 */

export function parseTs(ts: string): Date {
  return new Date(`${ts}+08:00`);
}

/** 取事件的自然日 key：YYYY-MM-DD */
export function dayKey(ts: string): string {
  return ts.slice(0, 10);
}

export function dayKeyOf(date: Date): string {
  // date 由 parseTs 产生（携带 +08:00），加上 8 小时后取 UTC 日期即为上海日期
  return new Date(date.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}

export function addDays(dayStr: string, days: number): string {
  const d = new Date(`${dayStr}T00:00:00+08:00`);
  d.setUTCDate(d.getUTCDate() + days);
  return dayKeyOf(d);
}

export function diffDays(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00+08:00`).getTime();
  const db = new Date(`${b}T00:00:00+08:00`).getTime();
  return Math.round((db - da) / 86_400_000);
}

/** 生成 [startDate, endDate] 之间的全部日期（含两端） */
export function enumerateDays(range: DateRange): string[] {
  const out: string[] = [];
  let cur = range.startDate;
  // 防御：异常入参导致死循环
  let guard = 0;
  while (cur <= range.endDate && guard < 400) {
    out.push(cur);
    cur = addDays(cur, 1);
    guard += 1;
  }
  return out;
}

/** 区间天数（含两端） */
export function rangeLength(range: DateRange): number {
  return Math.max(0, diffDays(range.startDate, range.endDate)) + 1;
}

/** 紧邻当前区间之前的等长可比周期 */
export function previousRange(range: DateRange): DateRange {
  const len = rangeLength(range);
  return { startDate: addDays(range.startDate, -len), endDate: addDays(range.startDate, -1) };
}

export function minutesBetween(fromTs: string, toTs: string): number {
  return (parseTs(toTs).getTime() - parseTs(fromTs).getTime()) / 60_000;
}

/** 2026-10-11 -> 10-11 */
export function shortDay(day: string): string {
  return day.slice(5);
}

/** 2026-10-11T20:00:00 -> 10-11 20:00 */
export function shortTs(ts: string): string {
  return `${ts.slice(5, 10)} ${ts.slice(11, 16)}`;
}

/** 2026-10-11T20:00:00 -> 2026-10-11 20:00 */
export function fullTs(ts: string): string {
  return `${ts.slice(0, 10)} ${ts.slice(11, 16)}`;
}
