/**
 * 指标计算层
 *
 * 铁律：所有指标都从同一套事件级原始数据派生，任何图表 / 卡片 / 详情页都不写死结果。
 *
 * 归属口径：
 *  - 参与事件、生成任务：按事件自身 ts 的自然日归属。
 *  - 内容、审核、扫码、分享：统一归因到「内容生成日」（content.ts），
 *    保证「生成成功 → 审核通过 → 扫码 → 分享」四步口径一致、可比对。
 */

import type {
  Content,
  Dataset,
  DateRange,
  Device,
  Filters,
  GenerationTask,
  Heartbeats,
  Moderation,
  ParticipationEvent,
  ScanEvent,
  ShareEvent,
  Site,
} from '../types';
import { dayKey, minutesBetween, parseTs } from './time';
import { THRESHOLDS } from './config';

// ---------------------------------------------------------------------------
// 基础工具
// ---------------------------------------------------------------------------

export function inRange(ts: string, range: DateRange): boolean {
  const d = dayKey(ts);
  return d >= range.startDate && d <= range.endDate;
}

const safeDiv = (num: number, den: number): number | null => (den > 0 ? num / den : null);

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

export interface ContentIndex {
  byId: Map<string, Content>;
  /** contentId -> 审核结果（无审核记录视为 pending） */
  modByContent: Map<string, Moderation>;
}

export function buildContentIndex(events: Dataset['events']): ContentIndex {
  const byId = new Map<string, Content>();
  for (const c of events.contents) byId.set(c.contentId, c);
  const modByContent = new Map<string, Moderation>();
  for (const m of events.moderations) modByContent.set(m.contentId, m);
  return { byId, modByContent };
}

// ---------------------------------------------------------------------------
// 聚合结果
// ---------------------------------------------------------------------------

export interface Agg {
  /** 参与事件数（人次） */
  participationEvents: number;
  /** 参与人数（去重 userId） */
  participants: number;
  /** 发起过至少一次生成任务的去重用户数 */
  generatingUsers: number;

  tasksTotal: number;
  tasksSuccess: number;
  tasksFailed: number;
  tasksPending: number;
  /** 成功 + 失败，即已完成生成尝试（成功率分母） */
  completedTasks: number;
  successRate: number | null;

  /** 仅统计成功任务 */
  avgDurationMs: number | null;
  p95DurationMs: number | null;
  slowTaskCount: number;
  slowTaskRatio: number | null;

  contentTotal: number;
  modPass: number;
  modReject: number;
  modPending: number;
  /** 通过 + 拒绝，即已完成审核（审核通过率分母） */
  reviewedContents: number;
  passRate: number | null;
  rejectRate: number | null;

  /** 生成成功且审核通过 = 可扫码 / 可分享的有效内容 */
  validContents: number;
  scannedContents: number;
  sharedContents: number;
  scanRate: number | null;
  shareRate: number | null;

  scanEvents: number;
  shareEvents: number;
  shareFailedEvents: number;
}

export function emptyAgg(): Agg {
  return {
    participationEvents: 0,
    participants: 0,
    generatingUsers: 0,
    tasksTotal: 0,
    tasksSuccess: 0,
    tasksFailed: 0,
    tasksPending: 0,
    completedTasks: 0,
    successRate: null,
    avgDurationMs: null,
    p95DurationMs: null,
    slowTaskCount: 0,
    slowTaskRatio: null,
    contentTotal: 0,
    modPass: 0,
    modReject: 0,
    modPending: 0,
    reviewedContents: 0,
    passRate: null,
    rejectRate: null,
    validContents: 0,
    scannedContents: 0,
    sharedContents: 0,
    scanRate: null,
    shareRate: null,
    scanEvents: 0,
    shareEvents: 0,
    shareFailedEvents: 0,
  };
}

export interface AggInput {
  participations: ParticipationEvent[];
  tasks: GenerationTask[];
  contents: Content[];
  scans: ScanEvent[];
  shares: ShareEvent[];
  index: ContentIndex;
}

/**
 * 核心聚合：给定一组已筛选的事件，输出全部业务指标。
 * 分母为 0 时返回 null（前端展示 "—"），不产生 NaN / Infinity。
 */
export function aggregate(input: AggInput): Agg {
  const { participations, tasks, contents, scans, shares, index } = input;
  const agg = emptyAgg();

  // ---- 参与：人次 + 去重人数 ----
  const userSet = new Set<string>();
  for (const p of participations) userSet.add(p.userId);
  agg.participationEvents = participations.length;
  agg.participants = userSet.size;

  // ---- 生成任务 ----
  const durations: number[] = [];
  const taskUserSet = new Set<string>();
  for (const t of tasks) {
    agg.tasksTotal += 1;
    taskUserSet.add(t.userId);
    if (t.status === 'success') {
      agg.tasksSuccess += 1;
      if (t.durationMs !== null) {
        durations.push(t.durationMs);
        if (t.durationMs > THRESHOLDS.avgDurationMaxSec * 1000) agg.slowTaskCount += 1;
      }
    } else if (t.status === 'failed') {
      agg.tasksFailed += 1;
    } else {
      agg.tasksPending += 1;
    }
  }
  agg.generatingUsers = taskUserSet.size;
  agg.completedTasks = agg.tasksSuccess + agg.tasksFailed;
  agg.successRate = safeDiv(agg.tasksSuccess, agg.completedTasks);

  if (durations.length > 0) {
    const sum = durations.reduce((a, b) => a + b, 0);
    agg.avgDurationMs = sum / durations.length;
    const sorted = [...durations].sort((a, b) => a - b);
    agg.p95DurationMs = percentile(sorted, 0.95);
    agg.slowTaskRatio = agg.slowTaskCount / durations.length;
  }

  // ---- 内容 + 审核（统一按 contentId 关联） ----
  const contentIds = new Set<string>();
  for (const c of contents) contentIds.add(c.contentId);
  agg.contentTotal = contentIds.size;

  const validContents = new Set<string>();
  for (const cid of contentIds) {
    const m = index.modByContent.get(cid);
    const status = m ? m.status : 'pending';
    if (status === 'pass') {
      agg.modPass += 1;
      validContents.add(cid);
    } else if (status === 'reject') {
      agg.modReject += 1;
    } else {
      agg.modPending += 1;
    }
  }
  agg.reviewedContents = agg.modPass + agg.modReject;
  agg.passRate = safeDiv(agg.modPass, agg.reviewedContents);
  agg.rejectRate = safeDiv(agg.modReject, agg.reviewedContents);

  // ---- 扫码 / 分享：内容级去重（同一内容多次扫码 / 分享只计一次） ----
  const scannedSet = new Set<string>();
  for (const s of scans) scannedSet.add(s.contentId);
  const sharedSet = new Set<string>();
  for (const s of shares) {
    if (s.status === 'success') sharedSet.add(s.contentId);
    else agg.shareFailedEvents += 1;
  }
  agg.scanEvents = scans.length;
  agg.shareEvents = shares.length;

  for (const cid of validContents) {
    if (scannedSet.has(cid)) agg.scannedContents += 1;
    if (sharedSet.has(cid)) agg.sharedContents += 1;
  }
  agg.validContents = validContents.size;
  agg.scanRate = safeDiv(agg.scannedContents, agg.validContents);
  agg.shareRate = safeDiv(agg.sharedContents, agg.validContents);

  return agg;
}

// ---------------------------------------------------------------------------
// 筛选
// ---------------------------------------------------------------------------

export interface SelectedData {
  participations: ParticipationEvent[];
  tasks: GenerationTask[];
  contents: Content[];
  scans: ScanEvent[];
  shares: ShareEvent[];
  /** 内容归属期内的审核记录（按内容关联，可能超出日期区间，用于详情页展示） */
  moderations: Moderation[];
  hasAnyData: boolean;
}

export function selectData(ds: Dataset, filters: Filters): SelectedData {
  const { range, siteId } = filters;
  const matchSite = (s: string) => siteId === 'ALL' || s === siteId;

  const participations = ds.events.participations.filter(
    (p) => matchSite(p.siteId) && inRange(p.ts, range),
  );
  const tasks = ds.events.generationTasks.filter(
    (t) => matchSite(t.siteId) && inRange(t.ts, range),
  );
  const contents = ds.events.contents.filter((c) => matchSite(c.siteId) && inRange(c.ts, range));
  const scans = ds.events.scans.filter((s) => matchSite(s.siteId) && inRange(s.ts, range));
  const shares = ds.events.shares.filter((s) => matchSite(s.siteId) && inRange(s.ts, range));

  const contentIdSet = new Set(contents.map((c) => c.contentId));
  const moderations = ds.events.moderations.filter((m) => contentIdSet.has(m.contentId));

  return {
    participations,
    tasks,
    contents,
    scans,
    shares,
    moderations,
    hasAnyData:
      participations.length + tasks.length + contents.length + scans.length + shares.length > 0,
  };
}

export function aggFromSelection(sel: SelectedData, index: ContentIndex): Agg {
  return aggregate({
    participations: sel.participations,
    tasks: sel.tasks,
    contents: sel.contents,
    scans: sel.scans,
    shares: sel.shares,
    index,
  });
}

// ---------------------------------------------------------------------------
// 分组序列
// ---------------------------------------------------------------------------

export interface DailyPoint {
  day: string;
  participants: number;
  participationEvents: number;
  tasksSuccess: number;
  tasksFailed: number;
  tasksPending: number;
  successRate: number | null;
  avgDurationMs: number | null;
  p95DurationMs: number | null;
  modPass: number;
  modReject: number;
  modPending: number;
  rejectRate: number | null;
  validContents: number;
  scannedContents: number;
  sharedContents: number;
  scanRate: number | null;
  shareRate: number | null;
  completedTasks: number;
}

export function dailySeries(sel: SelectedData, index: ContentIndex): DailyPoint[] {
  const buckets = new Map<string, SelectedData>();
  const get = (day: string): SelectedData => {
    let b = buckets.get(day);
    if (!b) {
      b = {
        participations: [],
        tasks: [],
        contents: [],
        scans: [],
        shares: [],
        moderations: [],
        hasAnyData: true,
      };
      buckets.set(day, b);
    }
    return b;
  };

  for (const p of sel.participations) get(dayKey(p.ts)).participations.push(p);
  for (const t of sel.tasks) get(dayKey(t.ts)).tasks.push(t);
  for (const c of sel.contents) get(dayKey(c.ts)).contents.push(c);
  for (const s of sel.scans) get(dayKey(s.ts)).scans.push(s);
  for (const s of sel.shares) get(dayKey(s.ts)).shares.push(s);

  return [...buckets.keys()]
    .sort()
    .map((day) => {
      const b = buckets.get(day)!;
      const a = aggFromSelection(b, index);
      return {
        day,
        participants: a.participants,
        participationEvents: a.participationEvents,
        tasksSuccess: a.tasksSuccess,
        tasksFailed: a.tasksFailed,
        tasksPending: a.tasksPending,
        successRate: a.successRate,
        avgDurationMs: a.avgDurationMs,
        p95DurationMs: a.p95DurationMs,
        modPass: a.modPass,
        modReject: a.modReject,
        modPending: a.modPending,
        rejectRate: a.rejectRate,
        validContents: a.validContents,
        scannedContents: a.scannedContents,
        sharedContents: a.sharedContents,
        scanRate: a.scanRate,
        shareRate: a.shareRate,
        completedTasks: a.completedTasks,
      };
    });
}

export interface SiteRow {
  siteId: string;
  siteName: string;
  city: string;
  type: string;
  deviceCount: number;
  agg: Agg;
}

export function siteBreakdown(ds: Dataset, sel: SelectedData, index: ContentIndex): SiteRow[] {
  const siteName = new Map(ds.sites.map((s) => [s.id, s]));
  const groups = new Map<string, SelectedData>();
  const get = (id: string): SelectedData => {
    let b = groups.get(id);
    if (!b) {
      b = {
        participations: [],
        tasks: [],
        contents: [],
        scans: [],
        shares: [],
        moderations: [],
        hasAnyData: true,
      };
      groups.set(id, b);
    }
    return b;
  };
  for (const p of sel.participations) get(p.siteId).participations.push(p);
  for (const t of sel.tasks) get(t.siteId).tasks.push(t);
  for (const c of sel.contents) get(c.siteId).contents.push(c);
  for (const s of sel.scans) get(s.siteId).scans.push(s);
  for (const s of sel.shares) get(s.siteId).shares.push(s);

  return [...groups.keys()]
    .sort()
    .map((id) => {
      const site = siteName.get(id);
      return {
        siteId: id,
        siteName: site ? site.name : id,
        city: site ? site.city : '-',
        type: site ? site.type : '-',
        deviceCount: site ? site.deviceIds.length : 0,
        agg: aggFromSelection(groups.get(id)!, index),
      };
    });
}

export interface DeviceRow {
  deviceId: string;
  siteId: string;
  siteName: string;
  model: string;
  agg: Agg;
}

export function deviceBreakdown(
  ds: Dataset,
  sel: SelectedData,
  index: ContentIndex,
): DeviceRow[] {
  const siteName = new Map(ds.sites.map((s) => [s.id, s.name]));
  const groups = new Map<string, SelectedData>();
  const get = (id: string): SelectedData => {
    let b = groups.get(id);
    if (!b) {
      b = {
        participations: [],
        tasks: [],
        contents: [],
        scans: [],
        shares: [],
        moderations: [],
        hasAnyData: true,
      };
      groups.set(id, b);
    }
    return b;
  };
  for (const p of sel.participations) get(p.deviceId).participations.push(p);
  for (const t of sel.tasks) get(t.deviceId).tasks.push(t);
  for (const c of sel.contents) get(c.deviceId).contents.push(c);
  for (const s of sel.scans) get(s.deviceId).scans.push(s);
  for (const s of sel.shares) get(s.deviceId).shares.push(s);

  return [...groups.keys()]
    .sort()
    .map((id) => {
      const dev = ds.devices.find((d) => d.id === id);
      return {
        deviceId: id,
        siteId: dev ? dev.siteId : '-',
        siteName: dev ? siteName.get(dev.siteId) ?? dev.siteId : '-',
        model: dev ? dev.model : '-',
        agg: aggFromSelection(groups.get(id)!, index),
      };
    });
}

// ---------------------------------------------------------------------------
// 分布
// ---------------------------------------------------------------------------

export interface DistRow {
  key: string;
  label: string;
  value: number;
  percent: number | null;
}

export function failureReasonDist(
  sel: SelectedData,
  dict: Map<string, string>,
): DistRow[] {
  const counts = new Map<string, number>();
  let total = 0;
  for (const t of sel.tasks) {
    if (t.status === 'failed' && t.failureReason) {
      counts.set(t.failureReason, (counts.get(t.failureReason) ?? 0) + 1);
      total += 1;
    }
  }
  return toDistRows(counts, total, dict);
}

export function rejectReasonDist(
  sel: SelectedData,
  dict: Map<string, string>,
  styleDict?: Map<string, string>,
): DistRow[] {
  const counts = new Map<string, number>();
  let total = 0;
  for (const m of sel.moderations) {
    if (m.status === 'reject' && m.rejectReason) {
      counts.set(m.rejectReason, (counts.get(m.rejectReason) ?? 0) + 1);
      total += 1;
    }
  }
  return toDistRows(counts, total, dict, styleDict);
}

export interface StyleRejectRow {
  key: string;
  label: string;
  reviewed: number;
  rejected: number;
  rejectRate: number | null;
  /**
   * 相对「当日大盘」的加权平均偏离（百分点，正数表示比当日整体更容易被拒）。
   * 按 当日大盘 = 该筛选范围内当日全部风格的审核拒绝率 计算，
   * 从而剔除「该点位当天整体审核变严」这类日级效应，只留下风格自身差异。
   * 仅纳入该风格当日已审核内容 ≥ MIN_DAY_SAMPLE 的日期。
   */
  excessRate: number | null;
  /** 参与计算的达标天数 */
  excessDays: number;
}

const MIN_DAY_SAMPLE = 5;

/** 按风格统计审核拒绝率（用于定位「是否集中在某个创作风格」） */
export function styleRejectDist(
  sel: SelectedData,
  index: ContentIndex,
  styleDict: Map<string, string>,
): StyleRejectRow[] {
  const reviewed = new Map<string, number>();
  const rejected = new Map<string, number>();
  const byStyleDay = new Map<string, Map<string, { r: number; j: number }>>();
  const dayOverall = new Map<string, { r: number; j: number }>();

  for (const c of sel.contents) {
    const m = index.modByContent.get(c.contentId);
    if (!m || m.status === 'pending') continue;
    const day = dayKey(c.ts);

    reviewed.set(c.styleId, (reviewed.get(c.styleId) ?? 0) + 1);
    if (m.status === 'reject') rejected.set(c.styleId, (rejected.get(c.styleId) ?? 0) + 1);

    const overall = dayOverall.get(day) ?? { r: 0, j: 0 };
    overall.r += 1;
    if (m.status === 'reject') overall.j += 1;
    dayOverall.set(day, overall);

    let days = byStyleDay.get(c.styleId);
    if (!days) {
      days = new Map();
      byStyleDay.set(c.styleId, days);
    }
    const slot = days.get(day) ?? { r: 0, j: 0 };
    slot.r += 1;
    if (m.status === 'reject') slot.j += 1;
    days.set(day, slot);
  }

  return [...reviewed.keys()]
    .map((k) => {
      const days = byStyleDay.get(k);
      let weightedExcess = 0;
      let weight = 0;
      let excessDays = 0;
      if (days) {
        for (const [day, slot] of days.entries()) {
          if (slot.r < MIN_DAY_SAMPLE) continue;
          const overall = dayOverall.get(day);
          if (!overall || overall.r === 0) continue;
          weightedExcess += slot.r * (slot.j / slot.r - overall.j / overall.r);
          weight += slot.r;
          excessDays += 1;
        }
      }
      return {
        key: k,
        label: styleDict.get(k) ?? k,
        reviewed: reviewed.get(k) ?? 0,
        rejected: rejected.get(k) ?? 0,
        rejectRate: safeDiv(rejected.get(k) ?? 0, reviewed.get(k) ?? 0),
        excessRate: weight > 0 ? weightedExcess / weight : null,
        excessDays,
      };
    })
    .sort((a, b) => (b.excessRate ?? -1) - (a.excessRate ?? -1));
}

function toDistRows(
  counts: Map<string, number>,
  total: number,
  dict: Map<string, string>,
  styleDict?: Map<string, string>,
): DistRow[] {
  return [...counts.entries()]
    .map(([key, value]) => ({
      key,
      label: dict.get(key) ?? (styleDict ? styleDict.get(key) ?? key : key),
      value,
      percent: safeDiv(value, total),
    }))
    .sort((a, b) => b.value - a.value);
}

/** 设备 / 点位维度的耗时分桶（用于「高延迟」展示） */
export function durationHistogram(tasks: GenerationTask[]): Array<{ bucket: string; count: number }> {
  const buckets = [
    { label: '0-3s', min: 0, max: 3000 },
    { label: '3-6s', min: 3000, max: 6000 },
    { label: '6-10s', min: 6000, max: 10_000 },
    { label: '10-15s', min: 10_000, max: 15_000 },
    { label: '15-25s', min: 15_000, max: 25_000 },
    { label: '>25s', min: 25_000, max: Number.MAX_SAFE_INTEGER },
  ];
  const out = buckets.map((b) => ({ bucket: b.label, count: 0 }));
  for (const t of tasks) {
    if (t.status !== 'success' || t.durationMs === null) continue;
    const i = buckets.findIndex((b) => t.durationMs! >= b.min && t.durationMs! < b.max);
    if (i >= 0) out[i].count += 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 设备状态（实时口径：相对 mock 数据基准时间，不随日期筛选变化）
// ---------------------------------------------------------------------------

export interface DeviceIncident {
  start: string;
  end: string;
  minutes: number;
}

export interface DeviceStatus {
  device: Device;
  siteName: string;
  lastHeartbeat: string | null;
  staleMinutes: number | null;
  online: boolean;
  /** 近 7 日应到心跳数 / 实到心跳数 */
  expectedBeats7d: number;
  actualBeats7d: number;
  heartbeatRate7d: number | null;
  incidents: DeviceIncident[];
  /** 最近一次运行异常描述 */
  lastIncidentText: string;
  /** 业务量（受日期筛选影响） */
  tasksInPeriod: number;
  failedInPeriod: number;
  successRateInPeriod: number | null;
  avgDurationInPeriod: number | null;
}

/**
 * 单日「应到心跳」时间点列表：运营时段 09:30-22:00（Asia/Shanghai），
 * 按固定间隔切片，并裁剪到 [fromTs, toTs] 区间内。
 *
 * 注意：这里必须直接构造带 +08:00 的时刻，不能用
 * `new Date(day+'T00:00:00+08:00').setUTCHours(9-8, 30)` 这类写法——
 * 那样会把 09:30 落到前一天，导致应到心跳数为 0。
 */
function operatingSlots(day: string, fromTs: string, toTs: string | null, intervalMin: number): string[] {
  const dayStart = new Date(`${day}T09:30:00+08:00`).getTime();
  const dayEnd = new Date(`${day}T22:00:00+08:00`).getTime();
  const from = parseTs(fromTs).getTime();
  const to = toTs ? parseTs(toTs).getTime() : Number.MAX_SAFE_INTEGER;
  const out: string[] = [];
  for (let cur = dayStart; cur <= dayEnd; cur += intervalMin * 60_000) {
    if (cur < from || cur > to) continue;
    const s = new Date(cur + 8 * 3600_000).toISOString();
    out.push(`${s.slice(0, 10)}T${s.slice(11, 19)}`);
  }
  return out;
}

export function computeDeviceStatuses(
  ds: Dataset,
  hb: Heartbeats,
  siteId: string,
  sel: SelectedData,
): DeviceStatus[] {
  const baseline = hb.baselineTime;
  const interval = hb.intervalMinutes;
  const siteName = new Map(ds.sites.map((s) => [s.id, s.name]));
  const window7dStart = (() => {
    const d = parseTs(baseline);
    const s = new Date(d.getTime() - 7 * 86_400_000);
    const iso = new Date(s.getTime() + 8 * 3600_000).toISOString();
    return `${iso.slice(0, 10)}T${iso.slice(11, 19)}`;
  })();

  const perDeviceTasks = new Map<string, { total: number; failed: number; success: number; dur: number[] }>();
  for (const t of sel.tasks) {
    let g = perDeviceTasks.get(t.deviceId);
    if (!g) {
      g = { total: 0, failed: 0, success: 0, dur: [] };
      perDeviceTasks.set(t.deviceId, g);
    }
    g.total += 1;
    if (t.status === 'success') {
      g.success += 1;
      if (t.durationMs !== null) g.dur.push(t.durationMs);
    } else if (t.status === 'failed') g.failed += 1;
  }

  return ds.devices
    .filter((d) => siteId === 'ALL' || d.siteId === siteId)
    .map((device) => {
      const beats = (hb.byDevice[device.id] ?? []).slice().sort();
      const last = beats.length > 0 ? beats[beats.length - 1] : null;
      const staleMinutes = last ? minutesBetween(last, baseline) : null;
      const online = staleMinutes !== null && staleMinutes <= THRESHOLDS.heartbeatStaleMinutes;

      // 近 7 日心跳在线率
      const days = new Set<string>();
      const cur = parseTs(window7dStart);
      const endD = parseTs(baseline);
      for (let t = cur.getTime(); t <= endD.getTime(); t += 86_400_000) {
        const iso = new Date(t + 8 * 3600_000).toISOString().slice(0, 10);
        days.add(iso);
      }
      // 应到与实到必须用同一个时间窗（window7dStart ~ baseline），否则比率会被高估/低估
      let expected = 0;
      for (const day of days) {
        expected += operatingSlots(day, window7dStart, baseline, interval).length;
      }
      const actual = beats.filter((b) => b >= window7dStart).length;

      // 心跳中断事件：同一运营日内相邻心跳间隔超过采样间隔
      const incidents: DeviceIncident[] = [];
      for (let i = 1; i < beats.length; i += 1) {
        const prev = parseTs(beats[i - 1]);
        const next = parseTs(beats[i]);
        if (dayKey(beats[i - 1]) !== dayKey(beats[i])) continue;
        const gapMin = (next.getTime() - prev.getTime()) / 60_000;
        if (gapMin > interval) {
          incidents.push({ start: beats[i - 1], end: beats[i], minutes: gapMin });
        }
      }
      if (!online && last) {
        incidents.push({ start: last, end: baseline, minutes: staleMinutes ?? 0 });
      }
      incidents.sort((a, b) => (a.start < b.start ? 1 : -1));

      const g = perDeviceTasks.get(device.id);
      const dur = g?.dur ?? [];
      const lastInc = incidents[0];

      return {
        device,
        siteName: siteName.get(device.siteId) ?? device.siteId,
        lastHeartbeat: last,
        staleMinutes,
        online,
        expectedBeats7d: expected,
        actualBeats7d: actual,
        heartbeatRate7d: safeDiv(actual, expected),
        incidents,
        lastIncidentText: lastInc
          ? `${lastInc.start.slice(5, 10)} ${lastInc.start.slice(11, 16)} 起中断 ${Math.round(lastInc.minutes)} 分钟`
          : '近 15 日无心跳中断',
        tasksInPeriod: g?.total ?? 0,
        failedInPeriod: g?.failed ?? 0,
        successRateInPeriod: safeDiv(g?.success ?? 0, (g?.success ?? 0) + (g?.failed ?? 0)),
        avgDurationInPeriod: dur.length > 0 ? dur.reduce((a, b) => a + b, 0) / dur.length : null,
      };
    });
}

export function onlineSummary(statuses: DeviceStatus[]): { online: number; total: number; rate: number | null } {
  const total = statuses.length;
  const online = statuses.filter((s) => s.online).length;
  return { online, total, rate: safeDiv(online, total) };
}

// ---------------------------------------------------------------------------
// 漏斗（分层，避免人数 / 任务数 / 内容数混算）
// ---------------------------------------------------------------------------

export interface FunnelStep {
  key: string;
  label: string;
  value: number;
  /** 相对本层首步骤的转化率 */
  rateFromTop: number | null;
  /** 相对上一步骤的转化率 */
  rateFromPrev: number | null;
  hint: string;
}

export interface FunnelModel {
  userTier: { title: string; unit: string; steps: FunnelStep[] };
  contentTier: { title: string; unit: string; steps: FunnelStep[] };
  context: { label: string; value: number }[];
}

export function buildFunnel(agg: Agg): FunnelModel {
  const userStepsRaw: Array<Omit<FunnelStep, 'rateFromTop' | 'rateFromPrev'>> = [
    {
      key: 'participants',
      label: '参与用户',
      value: agg.participants,
      hint: '统计期内发起参与事件的去重用户 ID 数',
    },
    {
      key: 'generatingUsers',
      label: '发起 AI 生成的用户',
      value: agg.generatingUsers,
      hint: '至少提交过一次生成任务的去重用户数（含仅失败的用户）',
    },
  ];
  const contentStepsRaw: Array<Omit<FunnelStep, 'rateFromTop' | 'rateFromPrev'>> = [
    {
      key: 'contents',
      label: '生成成功内容',
      value: agg.contentTotal,
      hint: '生成成功任务产出的内容数',
    },
    {
      key: 'valid',
      label: '审核通过（可扫码/可分享）',
      value: agg.validContents,
      hint: '生成成功且审核通过的内容；审核中与已拒绝不进入后续分母',
    },
    {
      key: 'scanned',
      label: '至少扫码一次',
      value: agg.scannedContents,
      hint: '同一内容多次扫码只计一次',
    },
    {
      key: 'shared',
      label: '至少成功分享一次',
      value: agg.sharedContents,
      hint: '同一内容多次分享只计一次；分享失败不计入',
    },
  ];

  const decorate = (rows: Array<Omit<FunnelStep, 'rateFromTop' | 'rateFromPrev'>>): FunnelStep[] => {
    const top = rows.length > 0 ? rows[0].value : 0;
    return rows.map((r, i) => ({
      ...r,
      rateFromTop: safeDiv(r.value, top),
      rateFromPrev: i === 0 ? null : safeDiv(r.value, rows[i - 1].value),
    }));
  };

  return {
    userTier: {
      title: '用户层（去重人数）',
      unit: '人',
      steps: decorate(userStepsRaw),
    },
    contentTier: {
      title: '内容层（内容数）',
      unit: '条',
      steps: decorate(contentStepsRaw),
    },
    context: [
      { label: '参与事件数（人次）', value: agg.participationEvents },
      { label: '生成任务数（次）', value: agg.tasksTotal },
      { label: '扫码事件数（次）', value: agg.scanEvents },
      { label: '分享事件数（次）', value: agg.shareEvents },
    ],
  };
}

/**
 * 跨点位去重提示：各点位独立去重后的合计数 vs 全局去重数，
 * 差额即「到访过多个点位的重复用户」。
 */
export function crossSiteDedupeNote(sel: SelectedData): {
  sumBySite: number;
  globalUnique: number;
  overlap: number;
} | null {
  const bySite = new Map<string, Set<string>>();
  const global = new Set<string>();
  for (const p of sel.participations) {
    let s = bySite.get(p.siteId);
    if (!s) {
      s = new Set<string>();
      bySite.set(p.siteId, s);
    }
    s.add(p.userId);
    global.add(p.userId);
  }
  let sumBySite = 0;
  for (const s of bySite.values()) sumBySite += s.size;
  if (bySite.size < 2) return null;
  return { sumBySite, globalUnique: global.size, overlap: sumBySite - global.size };
}

export type { Content, Dataset, DateRange, Device, Filters, GenerationTask, Moderation, ParticipationEvent, ScanEvent, ShareEvent, Site };
