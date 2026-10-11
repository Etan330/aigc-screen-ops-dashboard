/**
 * 异常识别规则引擎
 *
 * 所有异常均由「模拟数据 + 规则阈值」动态计算，不在 UI 层写死。
 * 阈值集中定义在 src/lib/config.ts 的 THRESHOLDS，修改后全站生效。
 *
 * 规则一览：
 *  R1 点位·日  生成成功率 < 90%，且当日已完成生成尝试 >= 20 次
 *  R2 点位·日  平均生成时长 > 15s，且当日成功任务 >= 20 次
 *  R3 点位·日  内容审核拒绝率 > 10%，且当日已审核内容 >= 20 条
 *  R4 设备     最近心跳距基准时间 > 5 分钟（实时口径，不随日期筛选变化）
 *  R5 设备·区间 扫码转化率 < 大盘 50%，且该设备可扫码有效内容 >= 30 条（扩展演示规则）
 */

import type { Dataset, Filters, Heartbeats } from '../types';
import {
  SEVERITY_ESCALATION,
  THRESHOLDS,
} from './config';
import {
  type Agg,
  type ContentIndex,
  type DailyPoint,
  type DeviceRow,
  type DeviceStatus,
  type DistRow,
  type SelectedData,
  aggregate,
  durationHistogram,
  failureReasonDist,
  rejectReasonDist,
  styleRejectDist,
} from './metrics';
import { dayKey, fullTs } from './time';

export type RuleId = 'R1' | 'R2' | 'R3' | 'R4' | 'R5';
export type AnomalyCategory = '生成质量' | '内容审核' | '设备状态' | '活动转化';
export type Severity = '严重' | '高' | '中';

export interface Anomaly {
  id: string;
  ruleId: RuleId;
  ruleName: string;
  category: AnomalyCategory;
  severity: Severity;
  /** 统计粒度，例如「点位·日」「设备·实时」 */
  granularity: string;
  /** 发生日期或统计区间 */
  periodLabel: string;
  day: string | null;
  siteId: string | null;
  siteName: string | null;
  deviceId: string | null;
  metricName: string;
  actualText: string;
  thresholdText: string;
  sampleText: string;
  /** 待验证假设，不是已确认根因 */
  hypotheses: string[];
  actions: string[];
}

export interface AnomalyContext {
  ds: Dataset;
  sel: SelectedData;
  index: ContentIndex;
  filters: Filters;
  statuses: DeviceStatus[];
  deviceRows: DeviceRow[];
  heartbeats: Heartbeats;
  overallScanRate: number | null;
  dicts: {
    styles: Map<string, string>;
    failureReasons: Map<string, string>;
    rejectReasons: Map<string, string>;
  };
}

interface SiteDayAgg {
  day: string;
  siteId: string;
  agg: Agg;
}

function buildSiteDayAggs(sel: SelectedData, index: ContentIndex): SiteDayAgg[] {
  const map = new Map<string, SelectedData>();
  const get = (key: string): SelectedData => {
    let b = map.get(key);
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
      map.set(key, b);
    }
    return b;
  };
  for (const p of sel.participations) get(`${dayKey(p.ts)}|${p.siteId}`).participations.push(p);
  for (const t of sel.tasks) get(`${dayKey(t.ts)}|${t.siteId}`).tasks.push(t);
  for (const c of sel.contents) get(`${dayKey(c.ts)}|${c.siteId}`).contents.push(c);
  for (const s of sel.scans) get(`${dayKey(s.ts)}|${s.siteId}`).scans.push(s);
  for (const s of sel.shares) get(`${dayKey(s.ts)}|${s.siteId}`).shares.push(s);

  return [...map.entries()]
    .map(([key, bucket]) => {
      const [day, siteId] = key.split('|');
      const contentIdSet = new Set(bucket.contents.map((c) => c.contentId));
      bucket.moderations = sel.moderations.filter((m) => contentIdSet.has(m.contentId));
      return { day, siteId, agg: aggregate({ ...bucket, index }) };
    })
    .sort((a, b) => (a.day === b.day ? a.siteId.localeCompare(b.siteId) : a.day.localeCompare(b.day)));
}

const pct = (v: number | null, digits = 1): string =>
  v === null ? '—' : `${(v * 100).toFixed(digits)}%`;
const sec = (ms: number | null): string => (ms === null ? '—' : `${(ms / 1000).toFixed(2)}s`);

export function detectAnomalies(ctx: AnomalyContext): Anomaly[] {
  const { ds, sel, index, filters, statuses, deviceRows, overallScanRate } = ctx;
  const siteName = new Map(ds.sites.map((s) => [s.id, s.name]));
  const siteDays = buildSiteDayAggs(sel, index);
  const out: Anomaly[] = [];

  // ---------------- R1 / R2 / R3：点位·日 ----------------
  for (const sd of siteDays) {
    const name = siteName.get(sd.siteId) ?? sd.siteId;

    // R1 生成成功率
    if (
      sd.agg.completedTasks >= THRESHOLDS.genSuccessRateMinSamples &&
      sd.agg.successRate !== null &&
      sd.agg.successRate < THRESHOLDS.genSuccessRateMin
    ) {
      const critical = sd.agg.successRate < SEVERITY_ESCALATION.genSuccessRateCritical;
      out.push({
        id: `R1-${sd.siteId}-${sd.day}`,
        ruleId: 'R1',
        ruleName: 'AI 生成成功率低于阈值',
        category: '生成质量',
        severity: critical ? '严重' : '高',
        granularity: '点位·日',
        periodLabel: sd.day,
        day: sd.day,
        siteId: sd.siteId,
        siteName: name,
        deviceId: null,
        metricName: 'AI 生成成功率',
        actualText: pct(sd.agg.successRate),
        thresholdText: `≥ ${pct(THRESHOLDS.genSuccessRateMin, 0)}`,
        sampleText: `已完成生成尝试 ${sd.agg.completedTasks} 次（成功 ${sd.agg.tasksSuccess} / 失败 ${sd.agg.tasksFailed}）`,
        hypotheses: [
          '待验证假设 A：该点位某台设备的模型服务或网络链路异常，导致批量推理超时。',
          '待验证假设 B：该点位客流高峰触发并发限流，请求排队后被服务端超时放弃。',
          '待验证假设 C：该点位近期升级过模型版本或参数模板，与部分输入不兼容。',
        ],
        actions: [
          `在「设备监控」中筛选 ${name}，对比各设备成功率，锁定异常设备。`,
          '查看该日失败原因分布：若以「模型推理超时」为主，优先排查服务端算力与网络；若以「请求参数异常」为主，优先排查前端模板与参数下发。',
          '若集中在单台设备：通知技术运维现场排查（网络、边缘节点、服务版本），必要时临时下线该设备分流。',
          '在异常窗口结束后复核成功率是否回到基线，确认处置有效。',
        ],
      });
    }

    // R2 平均生成时长
    if (
      sd.agg.tasksSuccess >= THRESHOLDS.avgDurationMinSamples &&
      sd.agg.avgDurationMs !== null &&
      sd.agg.avgDurationMs / 1000 > THRESHOLDS.avgDurationMaxSec
    ) {
      const critical = sd.agg.avgDurationMs / 1000 > SEVERITY_ESCALATION.avgDurationCriticalSec;
      out.push({
        id: `R2-${sd.siteId}-${sd.day}`,
        ruleId: 'R2',
        ruleName: '平均生成时长超过阈值',
        category: '生成质量',
        severity: critical ? '严重' : '高',
        granularity: '点位·日',
        periodLabel: sd.day,
        day: sd.day,
        siteId: sd.siteId,
        siteName: name,
        deviceId: null,
        metricName: '平均生成时长',
        actualText: sec(sd.agg.avgDurationMs),
        thresholdText: `≤ ${THRESHOLDS.avgDurationMaxSec}s`,
        sampleText: `成功任务 ${sd.agg.tasksSuccess} 次，其中超 ${THRESHOLDS.avgDurationMaxSec}s 的高延迟任务 ${sd.agg.slowTaskCount} 次（P95 ${sec(sd.agg.p95DurationMs)}）`,
        hypotheses: [
          '待验证假设 A：整点位共用网络出口 / 边缘节点拥塞，导致所有设备同时变慢（若各设备耗时同步抬升）。',
          '待验证假设 B：仅个别设备硬件或本地缓存异常（若耗时集中在单台设备）。',
          '待验证假设 C：上游模型服务在该时段扩容不足或排队，与点位无关（若全网点位同步抬升）。',
        ],
        actions: [
          '对比该点位各设备平均耗时：全部抬升 → 查点位网络/边缘节点；单台抬升 → 查该设备硬件与本地服务。',
          '对比同期全网平均耗时：若全网同步抬升，应升级为服务端容量问题并同步研发。',
          '查看耗时分桶：若长尾（P95）远高于均值，优先优化排队策略而非平均性能。',
          '在高延迟时段考虑对该点位做生成排队提示或并发限流，避免用户空等流失。',
        ],
      });
    }

    // R3 审核拒绝率
    if (
      sd.agg.reviewedContents >= THRESHOLDS.rejectRateMinSamples &&
      sd.agg.rejectRate !== null &&
      sd.agg.rejectRate > THRESHOLDS.rejectRateMax
    ) {
      const critical = sd.agg.rejectRate > SEVERITY_ESCALATION.rejectRateCritical;
      out.push({
        id: `R3-${sd.siteId}-${sd.day}`,
        ruleId: 'R3',
        ruleName: '内容审核拒绝率超过阈值',
        category: '内容审核',
        severity: critical ? '严重' : '高',
        granularity: '点位·日',
        periodLabel: sd.day,
        day: sd.day,
        siteId: sd.siteId,
        siteName: name,
        deviceId: null,
        metricName: '内容审核拒绝率',
        actualText: pct(sd.agg.rejectRate),
        thresholdText: `≤ ${pct(THRESHOLDS.rejectRateMax, 0)}`,
        sampleText: `已审核 ${sd.agg.reviewedContents} 条（通过 ${sd.agg.modPass} / 拒绝 ${sd.agg.modReject}）`,
        hypotheses: [
          '待验证假设 A：某个创作风格的出图更容易触发审核规则（需按风格维度验证）。',
          '待验证假设 B：点位现场引导话术或默认提示词引导用户输入了敏感内容。',
          '待验证假设 C：审核策略/模型近期有更新，误杀率上升。',
        ],
        actions: [
          '查看拒绝原因分布与「按风格」的拒绝率：若集中在某个风格，先下线或调整该风格模板与提示词。',
          '抽取被拒内容样例人工复核，判断是真实违规还是误杀，反馈给审核策略侧。',
          '优化前端引导与示例图，减少用户触发敏感内容的概率。',
          '注意：审核拒绝属于内容治理问题，与生成失败（技术链路）分开跟踪，不要混为一谈。',
        ],
      });
    }
  }

  // ---------------- R4：设备离线（实时口径） ----------------
  for (const st of statuses) {
    if (st.online) continue;
    const minutes = st.staleMinutes ?? 0;
    const critical = minutes > SEVERITY_ESCALATION.heartbeatStaleCriticalMinutes;
    out.push({
      id: `R4-${st.device.id}`,
      ruleId: 'R4',
      ruleName: '设备心跳超时（离线）',
      category: '设备状态',
      severity: critical ? '严重' : '高',
      granularity: '设备·实时',
      periodLabel: st.lastHeartbeat ? fullTs(st.lastHeartbeat) : '无心跳记录',
      day: st.lastHeartbeat ? dayKey(st.lastHeartbeat) : null,
      siteId: st.device.siteId,
      siteName: st.siteName,
      deviceId: st.device.id,
      metricName: '心跳距基准时间',
      actualText: `${Math.round(minutes)} 分钟`,
      thresholdText: `≤ ${THRESHOLDS.heartbeatStaleMinutes} 分钟`,
      sampleText: `近 7 日心跳在线率 ${pct(st.heartbeatRate7d)}（实到 ${st.actualBeats7d} / 应到 ${st.expectedBeats7d}）`,
      hypotheses: [
        '待验证假设 A：设备断电、网络断开或被人为关机。',
        '待验证假设 B：设备端上报服务崩溃，屏幕仍在运行但不上报心跳。',
        '待验证假设 C：商场/景区侧网络维护或专线故障，导致整点位中断。',
      ],
      actions: [
        '联系点位现场工作人员确认设备通电与屏幕状态，优先恢复营业可用性。',
        '若同点位多台设备同时离线，按「点位网络故障」上报网络服务商。',
        '若仅单台离线且心跳在线率长期偏低，安排技术人员现场检修或更换设备。',
        '恢复后复核心跳连续性与该点位当日生成成功率是否同步回稳。',
      ],
    });
  }

  // ---------------- R5：设备扫码转化异常（扩展演示规则） ----------------
  if (overallScanRate !== null) {
    const threshold = overallScanRate * THRESHOLDS.scanRateDropRatio;
    for (const row of deviceRows) {
      if (row.agg.validContents < THRESHOLDS.scanRateMinSamples) continue;
      if (row.agg.scanRate === null) continue;
      if (row.agg.scanRate >= threshold) continue;
      const dev = ds.devices.find((d) => d.id === row.deviceId);
      out.push({
        id: `R5-${row.deviceId}`,
        ruleId: 'R5',
        ruleName: '设备扫码转化率显著低于大盘',
        category: '活动转化',
        severity: '中',
        granularity: '设备·区间',
        periodLabel: `${filters.range.startDate} ~ ${filters.range.endDate}`,
        day: null,
        siteId: dev?.siteId ?? null,
        siteName: row.siteName,
        deviceId: row.deviceId,
        metricName: '扫码转化率',
        actualText: pct(row.agg.scanRate),
        thresholdText: `< 大盘 50%（${pct(threshold)}）`,
        sampleText: `可扫码有效内容 ${row.agg.validContents} 条，扫码 ${row.agg.scannedContents} 条；分享转化率 ${pct(row.agg.shareRate)}`,
        hypotheses: [
          '待验证假设 A：该设备屏幕二维码展示异常（尺寸过小、位置被遮挡、亮度不足）。',
          '待验证假设 B：该设备成图质量或生成风格不受欢迎，用户放弃保存。',
          '待验证假设 C：该设备所处位置人流以过路客为主，停留意愿低于同点位其他设备。',
          '待验证假设 D：该设备扫码后的落地页加载慢或失败，用户中途流失（需服务端埋点验证）。',
        ],
        actions: [
          '对比同点位其他设备的扫码率与分享率：若仅该设备偏低，按设备侧问题处理。',
          '现场巡检该设备的二维码展示与引导文案，做一次 A/B 对照（尺寸、位置、话术）。',
          '抽取该设备的生成内容人工查看成图质量，确认是否存在画质或风格问题。',
          '若扫码后链路有问题，联合服务端排查落地页加载成功率。',
        ],
      });
    }
  }

  // 排序：严重度 -> 日期倒序
  const order: Record<Severity, number> = { 严重: 0, 高: 1, 中: 2 };
  return out.sort((a, b) => {
    if (order[a.severity] !== order[b.severity]) return order[a.severity] - order[b.severity];
    return (b.periodLabel ?? '').localeCompare(a.periodLabel ?? '');
  });
}

// ---------------------------------------------------------------------------
// 异常详情（证据下钻）
// ---------------------------------------------------------------------------

export interface ComparisonRow {
  name: string;
  valueText: string;
  value: number | null;
  highlight: boolean;
  note?: string;
}

export interface SampleTable {
  title: string;
  columns: string[];
  rows: string[][];
}

export interface AnomalyDetail {
  facts: { label: string; value: string }[];
  comparison: { title: string; note: string; rows: ComparisonRow[] } | null;
  distribution: { title: string; note: string; rows: DistRow[] } | null;
  samples: SampleTable | null;
  relatedRuleText: string;
}

export function buildAnomalyDetail(a: Anomaly, ctx: AnomalyContext): AnomalyDetail {
  const { ds, sel, index, statuses, deviceRows, dicts, filters } = ctx;
  const facts: { label: string; value: string }[] = [
    { label: '异常类型', value: `${a.ruleId} ${a.ruleName}` },
    { label: '严重程度', value: a.severity },
    { label: '统计粒度', value: a.granularity },
    { label: '发生日期 / 区间', value: a.periodLabel },
    { label: '涉及点位', value: a.siteName ?? '—' },
    { label: '涉及设备', value: a.deviceId ?? '（点位级）' },
    { label: a.metricName, value: `${a.actualText}（阈值 ${a.thresholdText}）` },
    { label: '样本量', value: a.sampleText },
  ];

  const empty: AnomalyDetail = {
    facts,
    comparison: null,
    distribution: null,
    samples: null,
    relatedRuleText: '',
  };

  const siteId = a.siteId;
  const day = a.day;
  if (!siteId) return empty;

  const siteDevices = ds.devices.filter((d) => d.siteId === siteId).map((d) => d.id);
  const dayTasks =
    day === null
      ? sel.tasks.filter((t) => t.siteId === siteId)
      : sel.tasks.filter((t) => t.siteId === siteId && dayKey(t.ts) === day);
  const dayContents =
    day === null
      ? sel.contents.filter((c) => c.siteId === siteId)
      : sel.contents.filter((c) => c.siteId === siteId && dayKey(c.ts) === day);
  const dayContentIds = new Set(dayContents.map((c) => c.contentId));
  const dayMods = sel.moderations.filter((m) => dayContentIds.has(m.contentId));

  // 设备级聚合（当日 / 当期）
  const deviceAgg = (deviceId: string) => {
    const bucket: SelectedData = {
      participations: sel.participations.filter(
        (p) => p.deviceId === deviceId && (day === null || dayKey(p.ts) === day),
      ),
      tasks: dayTasks.filter((t) => t.deviceId === deviceId),
      contents: dayContents.filter((c) => c.deviceId === deviceId),
      scans: sel.scans.filter((s) => s.deviceId === deviceId && (day === null || dayKey(s.ts) === day)),
      shares: sel.shares.filter((s) => s.deviceId === deviceId && (day === null || dayKey(s.ts) === day)),
      moderations: [],
      hasAnyData: true,
    };
    bucket.moderations = sel.moderations.filter((m) =>
      bucket.contents.some((c) => c.contentId === m.contentId),
    );
    return aggregate({ ...bucket, index });
  };

  if (a.ruleId === 'R1') {
    const rows: ComparisonRow[] = siteDevices.map((id) => {
      const g = deviceAgg(id);
      return {
        name: id,
        valueText: pct(g.successRate),
        value: g.successRate,
        highlight: id === a.deviceId,
        note: `完成 ${g.completedTasks} 次 / 失败 ${g.tasksFailed} 次`,
      };
    });
    const dist = failureReasonDist(
      { ...sel, tasks: dayTasks, contents: dayContents, moderations: dayMods },
      dicts.failureReasons,
    );
    const failed = dayTasks
      .filter((t) => t.status === 'failed')
      .slice(0, 8)
      .map((t) => [
        t.taskId,
        fullTs(t.ts),
        t.deviceId,
        dicts.styles.get(t.styleId) ?? t.styleId,
        dicts.failureReasons.get(t.failureReason ?? '') ?? '—',
      ]);
    return {
      facts,
      comparison: {
        title: `${a.siteName} · ${a.periodLabel} 各设备生成成功率`,
        note: '若失败集中在单台设备，优先按设备故障处理；若全点位均匀下降，优先按服务端或网络问题处理。',
        rows: rows.sort((x, y) => (x.value ?? 1) - (y.value ?? 1)),
      },
      distribution: { title: '该点位当日生成失败原因分布', note: '失败原因直接来自原始任务记录', rows: dist },
      samples: {
        title: '失败任务原始样例（最多 8 条）',
        columns: ['任务 ID', '发生时间', '设备', '风格', '失败原因'],
        rows: failed,
      },
      relatedRuleText: `规则 R1：生成成功率 < ${pct(THRESHOLDS.genSuccessRateMin, 0)} 且当日已完成生成尝试 ≥ ${THRESHOLDS.genSuccessRateMinSamples} 次。`,
    };
  }

  if (a.ruleId === 'R2') {
    const rows: ComparisonRow[] = siteDevices.map((id) => {
      const g = deviceAgg(id);
      return {
        name: id,
        valueText: sec(g.avgDurationMs),
        value: g.avgDurationMs === null ? null : g.avgDurationMs / 1000,
        highlight: id === a.deviceId,
        note: `成功 ${g.tasksSuccess} 次 / P95 ${sec(g.p95DurationMs)}`,
      };
    });
    const hist = durationHistogram(dayTasks).map((h) => ({
      key: h.bucket,
      label: h.bucket,
      value: h.count,
      percent: null,
    }));
    const slowest = dayTasks
      .filter((t) => t.status === 'success' && t.durationMs !== null)
      .sort((x, y) => (y.durationMs ?? 0) - (x.durationMs ?? 0))
      .slice(0, 8)
      .map((t) => [
        t.taskId,
        fullTs(t.ts),
        t.deviceId,
        dicts.styles.get(t.styleId) ?? t.styleId,
        sec(t.durationMs),
      ]);
    return {
      facts,
      comparison: {
        title: `${a.siteName} · ${a.periodLabel} 各设备平均生成时长`,
        note: '全部设备同步抬升指向点位网络/边缘节点；单台抬升指向该设备硬件或本地服务。',
        rows: rows.sort((x, y) => (y.value ?? 0) - (x.value ?? 0)),
      },
      distribution: { title: '该点位当日成功任务耗时分桶', note: '用于判断是整体变慢还是长尾变慢', rows: hist },
      samples: { title: '耗时最长的成功任务样例', columns: ['任务 ID', '发生时间', '设备', '风格', '耗时'], rows: slowest },
      relatedRuleText: `规则 R2：平均生成时长 > ${THRESHOLDS.avgDurationMaxSec}s 且当日成功任务 ≥ ${THRESHOLDS.avgDurationMinSamples} 次。`,
    };
  }

  if (a.ruleId === 'R3') {
    const styleRows = styleRejectDist(
      { ...sel, contents: dayContents, moderations: dayMods },
      index,
      dicts.styles,
    ).map((s) => ({
      key: s.key,
      label: s.label,
      value: s.rejected,
      percent: s.rejectRate,
    }));
    const dist = rejectReasonDist(
      { ...sel, contents: dayContents, moderations: dayMods },
      dicts.rejectReasons,
    );
    const rejected = dayMods
      .filter((m) => m.status === 'reject')
      .slice(0, 8)
      .map((m) => {
        const c = index.byId.get(m.contentId);
        return [
          m.contentId,
          fullTs(m.ts),
          c ? c.deviceId : '—',
          c ? dicts.styles.get(c.styleId) ?? c.styleId : '—',
          dicts.rejectReasons.get(m.rejectReason ?? '') ?? '—',
        ];
      });
    return {
      facts,
      comparison: {
        title: `${a.siteName} · ${a.periodLabel} 按创作风格的审核拒绝率`,
        note: '若拒绝集中在单一风格，优先排查该风格的模板、提示词与示例图；否则按审核策略误杀排查。',
        rows: styleRows.map((s) => ({
          name: s.label,
          valueText: pct(s.percent),
          value: s.percent,
          highlight: (s.percent ?? 0) > THRESHOLDS.rejectRateMax,
          note: `已审核内容中拒绝 ${s.value} 条`,
        })),
      },
      distribution: { title: '该点位当日审核拒绝原因分布', note: '审核拒绝属于内容治理问题，与生成失败分开跟踪', rows: dist },
      samples: { title: '被拒内容原始样例', columns: ['内容 ID', '审核时间', '设备', '风格', '拒绝原因'], rows: rejected },
      relatedRuleText: `规则 R3：审核拒绝率 > ${pct(THRESHOLDS.rejectRateMax, 0)} 且当日已审核内容 ≥ ${THRESHOLDS.rejectRateMinSamples} 条。`,
    };
  }

  if (a.ruleId === 'R4') {
    const st = statuses.find((s) => s.device.id === a.deviceId);
    const peers = statuses.filter((s) => s.device.siteId === siteId);
    return {
      facts: [
        ...facts,
        {
          label: '最近心跳',
          value: st?.lastHeartbeat ? fullTs(st.lastHeartbeat) : '无记录',
        },
        {
          label: '近 7 日心跳在线率',
          value: `${pct(st?.heartbeatRate7d ?? null)}（实到 ${st?.actualBeats7d ?? 0} / 应到 ${st?.expectedBeats7d ?? 0}）`,
        },
        { label: '最近运行异常', value: st?.lastIncidentText ?? '—' },
      ],
      comparison: {
        title: `${a.siteName} 各设备在线状态`,
        note: '设备在线状态为实时口径（相对模拟数据基准时间），不随历史日期筛选变化。',
        rows: peers.map((p) => ({
          name: p.device.id,
          valueText: p.online ? '在线' : `离线 ${Math.round(p.staleMinutes ?? 0)} 分钟`,
          value: p.staleMinutes,
          highlight: p.device.id === a.deviceId,
          note: p.lastHeartbeat ? `最近心跳 ${fullTs(p.lastHeartbeat)}` : '无心跳记录',
        })),
      },
      distribution: {
        title: '近 15 日心跳中断记录',
        note: '中断 = 同一运营日内相邻心跳间隔超过采样间隔，或当前心跳已超时',
        rows: (st?.incidents ?? []).slice(0, 8).map((i, k) => ({
          key: `${k}`,
          label: `${fullTs(i.start)} → ${fullTs(i.end)}`,
          value: Math.round(i.minutes),
          percent: null,
        })),
      },
      samples: {
        title: '该设备最近 8 条心跳',
        columns: ['#', '心跳时间'],
        rows: (ctx.heartbeats.byDevice[a.deviceId ?? ''] ?? [])
          .slice(-8)
          .map((b, i) => [`${(ctx.heartbeats.byDevice[a.deviceId ?? ''] ?? []).length - 8 + i + 1}`, fullTs(b)]),
      },
      relatedRuleText: `规则 R4：最近心跳距基准时间 > ${THRESHOLDS.heartbeatStaleMinutes} 分钟判定为离线。`,
    };
  }

  if (a.ruleId === 'R5') {
    const peers = deviceRows.filter((r) => r.siteId === siteId);
    const rows: ComparisonRow[] = peers.map((r) => ({
      name: r.deviceId,
      valueText: pct(r.agg.scanRate),
      value: r.agg.scanRate,
      highlight: r.deviceId === a.deviceId,
      note: `有效内容 ${r.agg.validContents} 条 / 分享率 ${pct(r.agg.shareRate)}`,
    }));
    const unscanned = sel.contents
      .filter((c) => c.deviceId === a.deviceId)
      .filter((c) => index.modByContent.get(c.contentId)?.status === 'pass')
      .slice(0, 8)
      .map((c) => {
        const scanned = sel.scans.some((s) => s.contentId === c.contentId);
        const shared = sel.shares.some((s) => s.contentId === c.contentId && s.status === 'success');
        return [
          c.contentId,
          fullTs(c.ts),
          dicts.styles.get(c.styleId) ?? c.styleId,
          scanned ? '已扫码' : '未扫码',
          shared ? '已分享' : '未分享',
        ];
      });
    return {
      facts,
      comparison: {
        title: `${a.siteName} · ${filters.range.startDate} ~ ${filters.range.endDate} 各设备扫码转化率`,
        note: '若同点位其他设备正常，问题定位在该设备本身（展示、成图质量或所处位置）。',
        rows: rows.sort((x, y) => (x.value ?? 1) - (y.value ?? 1)),
      },
      distribution: {
        title: '该设备有效内容的扫码 / 分享结果分布',
        note: '内容级去重，同一内容多次扫码或分享只计一次',
        rows: [
          {
            key: 'scanned',
            label: '至少扫码一次',
            value: deviceRows.find((r) => r.deviceId === a.deviceId)?.agg.scannedContents ?? 0,
            percent: deviceRows.find((r) => r.deviceId === a.deviceId)?.agg.scanRate ?? null,
          },
          {
            key: 'shared',
            label: '至少成功分享一次',
            value: deviceRows.find((r) => r.deviceId === a.deviceId)?.agg.sharedContents ?? 0,
            percent: deviceRows.find((r) => r.deviceId === a.deviceId)?.agg.shareRate ?? null,
          },
          {
            key: 'notScanned',
            label: '未发生扫码',
            value:
              (deviceRows.find((r) => r.deviceId === a.deviceId)?.agg.validContents ?? 0) -
              (deviceRows.find((r) => r.deviceId === a.deviceId)?.agg.scannedContents ?? 0),
            percent: null,
          },
        ],
      },
      samples: { title: '该设备有效内容样例（是否扫码 / 分享）', columns: ['内容 ID', '生成时间', '风格', '扫码', '分享'], rows: unscanned },
      relatedRuleText: `规则 R5（扩展演示规则）：扫码转化率 < 大盘 50% 且可扫码有效内容 ≥ ${THRESHOLDS.scanRateMinSamples} 条。`,
    };
  }

  return empty;
}

/** 供自检面板使用：把当前生效的阈值渲染成文本 */
export function thresholdTextList(): { rule: string; text: string }[] {
  return [
    {
      rule: 'R1 生成成功率',
      text: `< ${(THRESHOLDS.genSuccessRateMin * 100).toFixed(0)}%，且当日已完成生成尝试 ≥ ${THRESHOLDS.genSuccessRateMinSamples} 次（点位·日）`,
    },
    {
      rule: 'R2 平均生成时长',
      text: `> ${THRESHOLDS.avgDurationMaxSec}s，且当日成功任务 ≥ ${THRESHOLDS.avgDurationMinSamples} 次（点位·日）`,
    },
    {
      rule: 'R3 审核拒绝率',
      text: `> ${(THRESHOLDS.rejectRateMax * 100).toFixed(0)}%，且当日已审核内容 ≥ ${THRESHOLDS.rejectRateMinSamples} 条（点位·日）`,
    },
    {
      rule: 'R4 设备离线',
      text: `最近心跳距基准时间 > ${THRESHOLDS.heartbeatStaleMinutes} 分钟（设备·实时，不随日期筛选变化）`,
    },
    {
      rule: 'R5 扫码转化异常（扩展）',
      text: `< 大盘 50%，且该设备可扫码有效内容 ≥ ${THRESHOLDS.scanRateMinSamples} 条（设备·区间）`,
    },
  ];
}

export type { DailyPoint };
