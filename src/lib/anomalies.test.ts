import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Dataset, Device, Events, Heartbeats, Meta, Site } from '../types';
import { buildDicts } from './data';
import {
  buildContentIndex,
  computeDeviceStatuses,
  deviceBreakdown,
  selectData,
} from './metrics';
import { detectAnomalies, thresholdTextList } from './anomalies';
import type { AnomalyContext } from './anomalies';

const read = <T>(file: string): T =>
  JSON.parse(readFileSync(resolve(process.cwd(), 'public/data', file), 'utf-8')) as T;

const ds: Dataset = {
  sites: read<Site[]>('mock_sites.json'),
  devices: read<Device[]>('mock_devices.json'),
  events: read<Events>('mock_events.json'),
  heartbeats: read<Heartbeats>('mock_heartbeats.json'),
  meta: read<Meta>('mock_meta.json'),
};
const index = buildContentIndex(ds.events);
const dicts = buildDicts(ds.meta);

function ctx(range: { startDate: string; endDate: string }, siteId = 'ALL'): AnomalyContext {
  const filters = { range, siteId };
  const sel = selectData(ds, filters);
  const statuses = computeDeviceStatuses(ds, ds.heartbeats, siteId, sel);
  const deviceRows = deviceBreakdown(ds, sel, index);
  return {
    ds,
    sel,
    index,
    filters,
    statuses,
    deviceRows,
    heartbeats: ds.heartbeats,
    overallScanRate: overallRate(range, siteId),
    dicts,
  };
}

function overallRate(range: { startDate: string; endDate: string }, siteId: string): number | null {
  const sel = selectData(ds, { range, siteId });
  const rows = deviceBreakdown(ds, sel, index);
  const valid = rows.reduce((s, r) => s + r.agg.validContents, 0);
  const scanned = rows.reduce((s, r) => s + r.agg.scannedContents, 0);
  return valid > 0 ? scanned / valid : null;
}

describe('异常识别规则', () => {
  it('阈值说明覆盖全部 5 条规则', () => {
    expect(thresholdTextList().length).toBe(5);
  });

  it('R1：SITE-02 在注入窗口内触发生成成功率异常，且样本量满足下限', () => {
    const list = detectAnomalies(ctx({ startDate: '2026-10-02', endDate: '2026-10-05' }));
    const hits = list.filter((a) => a.ruleId === 'R1' && a.siteId === 'SITE-02');
    expect(hits.length).toBeGreaterThanOrEqual(3);
    const day3 = hits.find((h) => h.day === '2026-10-03');
    expect(day3).toBeTruthy();
    expect(parseFloat(day3!.actualText)).toBeLessThan(90);
    const sample = Number(day3!.sampleText.match(/已完成生成尝试 (\d+) 次/)?.[1] ?? 0);
    expect(sample).toBeGreaterThanOrEqual(20);
    expect(day3!.hypotheses.length).toBeGreaterThan(0);
    expect(day3!.actions.length).toBeGreaterThan(0);
  });

  it('R1：未注入异常的时间窗不产生「严重」级告警，告警条数远少于注入窗口', () => {
    const normal = detectAnomalies(ctx({ startDate: '2026-09-14', endDate: '2026-09-20' }));
    const injected = detectAnomalies(ctx({ startDate: '2026-10-02', endDate: '2026-10-05' }));
    const normalR1 = normal.filter((a) => a.ruleId === 'R1');
    const injectedR1 = injected.filter((a) => a.ruleId === 'R1');
    expect(normalR1.filter((a) => a.severity === '严重').length).toBe(0);
    expect(normalR1.length).toBeLessThanOrEqual(1);
    expect(injectedR1.length).toBeGreaterThan(normalR1.length);
  });

  it('R2：SITE-04 在注入窗口内触发平均生成时长异常', () => {
    const list = detectAnomalies(ctx({ startDate: '2026-10-06', endDate: '2026-10-08' }));
    const hits = list.filter((a) => a.ruleId === 'R2');
    expect(hits.length).toBeGreaterThanOrEqual(3);
    expect(hits.every((h) => h.siteId === 'SITE-04')).toBe(true);
    expect(parseFloat(hits[0].actualText)).toBeGreaterThan(15);
  });

  it('R3：SITE-05 在注入窗口内触发审核拒绝率异常', () => {
    const list = detectAnomalies(ctx({ startDate: '2026-10-07', endDate: '2026-10-10' }));
    const hits = list.filter((a) => a.ruleId === 'R3' && a.siteId === 'SITE-05');
    expect(hits.length).toBeGreaterThanOrEqual(3);
    expect(hits.every((h) => parseFloat(h.actualText) > 10)).toBe(true);
  });

  it('R4：DEV-04 与 DEV-10 判定离线，且不随日期筛选变化', () => {
    const a = detectAnomalies(ctx({ startDate: '2026-09-01', endDate: '2026-09-05' }));
    const b = detectAnomalies(ctx({ startDate: '2026-10-05', endDate: '2026-10-11' }));
    const idsA = a.filter((x) => x.ruleId === 'R4').map((x) => x.deviceId).sort();
    const idsB = b.filter((x) => x.ruleId === 'R4').map((x) => x.deviceId).sort();
    expect(idsA).toEqual(['DEV-04', 'DEV-10']);
    expect(idsB).toEqual(['DEV-04', 'DEV-10']);
  });

  it('R5：DEV-12 触发扫码转化率异常（同点位 DEV-11 正常）', () => {
    const list = detectAnomalies(ctx({ startDate: '2026-09-25', endDate: '2026-10-11' }));
    const hits = list.filter((a) => a.ruleId === 'R5');
    const ids = hits.map((h) => h.deviceId);
    expect(ids).toContain('DEV-12');
    expect(ids).not.toContain('DEV-11');
  });

  it('点位筛选生效：只看 SITE-06 时不会出现 SITE-02 的异常', () => {
    const list = detectAnomalies(ctx({ startDate: '2026-10-02', endDate: '2026-10-05' }, 'SITE-06'));
    expect(list.every((a) => a.siteId === 'SITE-06' || a.siteId === null)).toBe(true);
  });

  it('小样本不触发 R1（样本量下限保护）', () => {
    // 选取一个样本量极小的区间：基准日当天只统计到 20:00，单日点位样本较小
    const list = detectAnomalies(ctx({ startDate: '2026-08-13', endDate: '2026-08-13' }));
    for (const a of list.filter((x) => x.ruleId === 'R1')) {
      const n = Number(a.sampleText.match(/已完成生成尝试 (\d+) 次/)?.[1] ?? 0);
      expect(n).toBeGreaterThanOrEqual(20);
    }
  });
});
