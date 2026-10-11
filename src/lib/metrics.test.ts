import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
  Content,
  Dataset,
  Device,
  Events,
  GenerationTask,
  Heartbeats,
  Meta,
  Moderation,
  ParticipationEvent,
  ScanEvent,
  ShareEvent,
  Site,
} from '../types';
import {
  aggregate,
  buildContentIndex,
  buildFunnel,
  computeDeviceStatuses,
  crossSiteDedupeNote,
  dailySeries,
  deviceBreakdown,
  onlineSummary,
  selectData,
  siteBreakdown,
  styleRejectDist,
} from './metrics';
import { previousRange } from './time';

const read = <T>(file: string): T =>
  JSON.parse(readFileSync(resolve(process.cwd(), 'public/data', file), 'utf-8')) as T;

function loadDataset(): Dataset {
  return {
    sites: read<Site[]>('mock_sites.json'),
    devices: read<Device[]>('mock_devices.json'),
    events: read<Events>('mock_events.json'),
    heartbeats: read<Heartbeats>('mock_heartbeats.json'),
    meta: read<Meta>('mock_meta.json'),
  };
}

const ds = loadDataset();
const index = buildContentIndex(ds.events);

/** 构造最小数据集，用于验证口径边界 */
function makeDs(parts: {
  participations?: ParticipationEvent[];
  tasks?: GenerationTask[];
  contents?: Content[];
  moderations?: Moderation[];
  scans?: ScanEvent[];
  shares?: ShareEvent[];
}) {
  return {
    sites: [],
    devices: [],
    events: {
      participations: parts.participations ?? [],
      generationTasks: parts.tasks ?? [],
      contents: parts.contents ?? [],
      moderations: parts.moderations ?? [],
      scans: parts.scans ?? [],
      shares: parts.shares ?? [],
    },
    heartbeats: { baselineTime: '2026-10-11T20:00:00', intervalMinutes: 5, operatingHours: '', byDevice: {} },
    meta: {} as Meta,
  } as Dataset;
}

// ---------------------------------------------------------------------------

describe('指标口径', () => {
  it('生成成功率：分母只含成功 + 失败，生成中(pending)不计入', () => {
    const d = makeDs({
      tasks: [
        { taskId: 'T1', ts: '2026-10-01T10:00:00', siteId: 'S1', deviceId: 'D1', userId: 'U1', styleId: 'ST', status: 'success', durationMs: 5000, failureReason: null },
        { taskId: 'T2', ts: '2026-10-01T10:01:00', siteId: 'S1', deviceId: 'D1', userId: 'U1', styleId: 'ST', status: 'failed', durationMs: null, failureReason: 'MODEL_TIMEOUT' },
        { taskId: 'T3', ts: '2026-10-01T10:02:00', siteId: 'S1', deviceId: 'D1', userId: 'U1', styleId: 'ST', status: 'pending', durationMs: null, failureReason: null },
      ],
    });
    const agg = aggregate({
      participations: [],
      tasks: d.events.generationTasks,
      contents: [],
      scans: [],
      shares: [],
      index: buildContentIndex(d.events),
    });
    expect(agg.completedTasks).toBe(2);
    expect(agg.tasksPending).toBe(1);
    expect(agg.successRate).toBeCloseTo(0.5, 6);
  });

  it('平均生成时长：只统计成功任务，失败任务无耗时不污染均值', () => {
    const d = makeDs({
      tasks: [
        { taskId: 'T1', ts: '2026-10-01T10:00:00', siteId: 'S1', deviceId: 'D1', userId: 'U1', styleId: 'ST', status: 'success', durationMs: 4000, failureReason: null },
        { taskId: 'T2', ts: '2026-10-01T10:01:00', siteId: 'S1', deviceId: 'D1', userId: 'U1', styleId: 'ST', status: 'success', durationMs: 6000, failureReason: null },
        { taskId: 'T3', ts: '2026-10-01T10:02:00', siteId: 'S1', deviceId: 'D1', userId: 'U1', styleId: 'ST', status: 'failed', durationMs: null, failureReason: 'MODEL_TIMEOUT' },
      ],
    });
    const agg = aggregate({
      participations: [],
      tasks: d.events.generationTasks,
      contents: [],
      scans: [],
      shares: [],
      index: buildContentIndex(d.events),
    });
    expect(agg.avgDurationMs).toBe(5000);
  });

  it('审核通过率：待审核(pending)不计入分母；分母为 0 时返回 null 而不是 NaN', () => {
    const empty = aggregate({
      participations: [],
      tasks: [],
      contents: [],
      scans: [],
      shares: [],
      index: buildContentIndex(makeDs({}).events),
    });
    expect(empty.passRate).toBeNull();
    expect(empty.successRate).toBeNull();
    expect(empty.scanRate).toBeNull();
    expect(empty.shareRate).toBeNull();
    expect(Number.isNaN(empty.avgDurationMs as number)).toBe(false);

    const d = makeDs({
      contents: [
        { contentId: 'C1', taskId: 'T1', ts: '2026-10-01T10:00:00', siteId: 'S1', deviceId: 'D1', styleId: 'ST' },
        { contentId: 'C2', taskId: 'T2', ts: '2026-10-01T10:00:00', siteId: 'S1', deviceId: 'D1', styleId: 'ST' },
        { contentId: 'C3', taskId: 'T3', ts: '2026-10-01T10:00:00', siteId: 'S1', deviceId: 'D1', styleId: 'ST' },
      ],
      moderations: [
        { contentId: 'C1', ts: '2026-10-01T10:00:02', status: 'pass', rejectReason: null },
        { contentId: 'C2', ts: '2026-10-01T10:00:02', status: 'reject', rejectReason: 'ILLEGAL_IMAGE' },
        { contentId: 'C3', ts: '2026-10-01T10:00:02', status: 'pending', rejectReason: null },
      ],
    });
    const agg = aggregate({
      participations: [],
      tasks: [],
      contents: d.events.contents,
      scans: [],
      shares: [],
      index: buildContentIndex(d.events),
    });
    expect(agg.reviewedContents).toBe(2);
    expect(agg.passRate).toBeCloseTo(0.5, 6);
    expect(agg.validContents).toBe(1);
  });

  it('扫码 / 分享转化率：同一内容多次扫码或分享只计一次；分享失败不计入', () => {
    const d = makeDs({
      contents: [
        { contentId: 'C1', taskId: 'T1', ts: '2026-10-01T10:00:00', siteId: 'S1', deviceId: 'D1', styleId: 'ST' },
        { contentId: 'C2', taskId: 'T2', ts: '2026-10-01T10:00:00', siteId: 'S1', deviceId: 'D1', styleId: 'ST' },
      ],
      moderations: [
        { contentId: 'C1', ts: '2026-10-01T10:00:02', status: 'pass', rejectReason: null },
        { contentId: 'C2', ts: '2026-10-01T10:00:02', status: 'pass', rejectReason: null },
      ],
      scans: [
        { eventId: 'S1', ts: '2026-10-01T10:01:00', contentId: 'C1', siteId: 'S1', deviceId: 'D1' },
        { eventId: 'S2', ts: '2026-10-01T10:02:00', contentId: 'C1', siteId: 'S1', deviceId: 'D1' },
        { eventId: 'S3', ts: '2026-10-01T10:03:00', contentId: 'C1', siteId: 'S1', deviceId: 'D1' },
      ],
      shares: [
        { eventId: 'H1', ts: '2026-10-01T10:01:00', contentId: 'C1', siteId: 'S1', deviceId: 'D1', status: 'success', failReason: null },
        { eventId: 'H2', ts: '2026-10-01T10:02:00', contentId: 'C1', siteId: 'S1', deviceId: 'D1', status: 'failed', failReason: 'USER_CANCEL' },
        { eventId: 'H3', ts: '2026-10-01T10:02:00', contentId: 'C2', siteId: 'S1', deviceId: 'D1', status: 'failed', failReason: 'USER_CANCEL' },
      ],
    });
    const agg = aggregate({
      participations: [],
      tasks: [],
      contents: d.events.contents,
      scans: d.events.scans,
      shares: d.events.shares,
      index: buildContentIndex(d.events),
    });
    expect(agg.validContents).toBe(2);
    expect(agg.scanEvents).toBe(3);
    expect(agg.scannedContents).toBe(1);
    expect(agg.scanRate).toBeCloseTo(0.5, 6);
    expect(agg.sharedContents).toBe(1);
    expect(agg.shareFailedEvents).toBe(2);
  });

  it('参与人数：跨点位重复用户只计一次', () => {
    const d = makeDs({
      participations: [
        { eventId: 'P1', ts: '2026-10-01T10:00:00', siteId: 'S1', deviceId: 'D1', userId: 'U1' },
        { eventId: 'P2', ts: '2026-10-01T11:00:00', siteId: 'S2', deviceId: 'D2', userId: 'U1' },
        { eventId: 'P3', ts: '2026-10-01T11:00:00', siteId: 'S1', deviceId: 'D1', userId: 'U2' },
      ],
    });
    const sel = selectData(d, { range: { startDate: '2026-10-01', endDate: '2026-10-01' }, siteId: 'ALL' });
    const agg = aggregate({ ...sel, index: buildContentIndex(d.events) });
    expect(agg.participationEvents).toBe(3);
    expect(agg.participants).toBe(2);
    const note = crossSiteDedupeNote(sel);
    expect(note?.sumBySite).toBe(3);
    expect(note?.globalUnique).toBe(2);
    expect(note?.overlap).toBe(1);
  });

  it('漏斗：用户层与内容层分开统计，不混合人数与内容数', () => {
    const agg = aggregate({ ...selectData(ds, { range: { startDate: '2026-10-01', endDate: '2026-10-11' }, siteId: 'ALL' }), index });
    const funnel = buildFunnel(agg);
    expect(funnel.userTier.steps[0].value).toBe(agg.participants);
    expect(funnel.contentTier.steps[0].value).toBe(agg.contentTotal);
    // 每层首步相对自身为 100%
    expect(funnel.userTier.steps[0].rateFromTop).toBe(1);
    expect(funnel.contentTier.steps[0].rateFromTop).toBe(1);
    // 有效内容 <= 生成成功内容
    expect(funnel.contentTier.steps[1].value).toBeLessThanOrEqual(funnel.contentTier.steps[0].value);
    expect(funnel.contentTier.steps[2].value).toBeLessThanOrEqual(funnel.contentTier.steps[1].value);
  });
});

// ---------------------------------------------------------------------------

describe('真实模拟数据的一致性', () => {
  const range = { startDate: ds.meta.startDate, endDate: ds.meta.endDate };
  const sel = selectData(ds, { range, siteId: 'ALL' });
  const agg = aggregate({ ...sel, index });

  it('日序列求和 = 汇总值（人次与任务数）', () => {
    const daily = dailySeries(sel, index);
    expect(daily.length).toBe(ds.meta.businessDays);
    expect(daily.reduce((s, d) => s + d.participationEvents, 0)).toBe(agg.participationEvents);
    expect(daily.reduce((s, d) => s + d.tasksSuccess, 0)).toBe(agg.tasksSuccess);
    expect(daily.reduce((s, d) => s + d.tasksFailed, 0)).toBe(agg.tasksFailed);
  });

  it('点位拆分求和 = 汇总值；各点位去重人数之和 >= 全局去重人数（存在跨点位重复用户）', () => {
    const rows = siteBreakdown(ds, sel, index);
    expect(rows.length).toBe(6);
    expect(rows.reduce((s, r) => s + r.agg.participationEvents, 0)).toBe(agg.participationEvents);
    const sumUnique = rows.reduce((s, r) => s + r.agg.participants, 0);
    expect(sumUnique).toBeGreaterThanOrEqual(agg.participants);
    expect(crossSiteDedupeNote(sel)?.overlap).toBe(sumUnique - agg.participants);
  });

  it('设备拆分求和 = 汇总值', () => {
    const rows = deviceBreakdown(ds, sel, index);
    expect(rows.length).toBe(12);
    expect(rows.reduce((s, r) => s + r.agg.contentTotal, 0)).toBe(agg.contentTotal);
  });

  it('按风格拒绝率：剔除日级效应后，长区间仍能暴露「集中在单一风格」', () => {
    const dict = new Map(ds.meta.dictionaries.styles.map((s) => [s.id, s.name]));

    const long = styleRejectDist(
      selectData(ds, { range: { startDate: '2026-09-12', endDate: '2026-10-11' }, siteId: 'SITE-05' }),
      index,
      dict,
    );
    const fantasyLong = long.find((r) => r.key === 'STYLE_FANTASY');
    expect(fantasyLong).toBeTruthy();
    expect(long[0].key).toBe('STYLE_FANTASY');
    // 30 天窗口下仍高于 10% 阈值，且相对当日大盘的偏离显著为正
    expect(fantasyLong!.rejectRate).toBeGreaterThan(0.1);
    expect(fantasyLong!.excessRate).toBeGreaterThan(0.05);
    // 其余风格的偏离应接近 0（未超出日级整体水平）
    for (const row of long.slice(1)) {
      expect(Math.abs(row.excessRate ?? 1)).toBeLessThan(0.05);
      expect(row.rejectRate).toBeLessThan(0.05);
    }

    const narrow = styleRejectDist(
      selectData(ds, { range: { startDate: '2026-10-07', endDate: '2026-10-10' }, siteId: 'SITE-05' }),
      index,
      dict,
    );
    const fantasyNarrow = narrow.find((r) => r.key === 'STYLE_FANTASY');
    expect(narrow[0].key).toBe('STYLE_FANTASY');
    // 收窄到注入窗口后，集中度应当非常明确：该风格 > 50%，其余风格 < 10%
    expect(fantasyNarrow!.rejectRate).toBeGreaterThan(0.5);
    expect(fantasyNarrow!.excessRate).toBeGreaterThan(0.2);
    for (const row of narrow.slice(1)) {
      expect(row.rejectRate).toBeLessThan(0.1);
    }
  });

  it('上一可比周期为等长紧邻区间', () => {
    const prev = previousRange({ startDate: '2026-10-05', endDate: '2026-10-11' });
    expect(prev).toEqual({ startDate: '2026-09-28', endDate: '2026-10-04' });
  });
});

// ---------------------------------------------------------------------------

describe('设备在线状态', () => {
  const range = { startDate: '2026-09-12', endDate: '2026-10-11' };
  const sel = selectData(ds, { range, siteId: 'ALL' });
  const statuses = computeDeviceStatuses(ds, ds.heartbeats, 'ALL', sel);

  it('DEV-04 / DEV-10 心跳超时判定为离线，其余设备在线', () => {
    const byId = new Map(statuses.map((s) => [s.device.id, s]));
    expect(byId.get('DEV-04')?.online).toBe(false);
    expect(byId.get('DEV-10')?.online).toBe(false);
    expect(byId.get('DEV-01')?.online).toBe(true);
    expect(byId.get('DEV-03')?.online).toBe(true);
    const summary = onlineSummary(statuses);
    expect(summary.total).toBe(12);
    expect(summary.online).toBe(10);
    expect(summary.rate).toBeCloseTo(10 / 12, 6);
  });

  it('设备在线状态不随历史日期筛选变化', () => {
    const selOld = selectData(ds, { range: { startDate: '2026-09-01', endDate: '2026-09-05' }, siteId: 'ALL' });
    const oldStatuses = computeDeviceStatuses(ds, ds.heartbeats, 'ALL', selOld);
    expect(onlineSummary(oldStatuses).online).toBe(onlineSummary(statuses).online);
    expect(oldStatuses.find((s) => s.device.id === 'DEV-10')?.online).toBe(false);
  });

  it('DEV-03 存在心跳中断记录（2026-10-02 下午）', () => {
    const st = statuses.find((s) => s.device.id === 'DEV-03');
    expect(st).toBeTruthy();
    const hasGap = (st?.incidents ?? []).some((i) => i.start.startsWith('2026-10-02') && i.minutes > 30);
    expect(hasGap).toBe(true);
  });

  it('无心跳记录的设备 online 为 false 且不抛错', () => {
    const d = makeDs({});
    const st = computeDeviceStatuses(
      { ...d, devices: [{ id: 'D9', siteId: 'S1', model: 'M', screenSizeInch: 55, installDate: '2026-01-01' }] },
      { baselineTime: '2026-10-11T20:00:00', intervalMinutes: 5, operatingHours: '', byDevice: {} },
      'ALL',
      selectData(d, { range, siteId: 'ALL' }),
    );
    expect(st[0].online).toBe(false);
    expect(st[0].lastHeartbeat).toBeNull();
    expect(st[0].staleMinutes).toBeNull();
  });
});
