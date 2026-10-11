import { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { MousePointerClick } from 'lucide-react';
import type { DailyPoint, FunnelModel, SiteRow } from '../lib/metrics';
import { COLORS } from '../lib/config';
import { fmtInt, fmtPct, fmtSec } from '../lib/format';
import { shortDay } from '../lib/time';
import { ChartCard, ChartTooltip, RatioBar, renderTooltip } from './ui';

/* ------------------------------- 漏斗组件 -------------------------------- */

function FunnelView({ model }: { model: FunnelModel }) {
  const renderTier = (
    tier: { title: string; unit: string; steps: FunnelModel['contentTier']['steps'] },
    baseColor: string,
  ) => (
    <div className="funnel-tier">
      <div className="funnel-tier-title">
        <span>{tier.title}</span>
        <span>单位：{tier.unit}</span>
      </div>
      {tier.steps.map((s, i) => {
        const ratio = s.rateFromTop ?? 0;
        return (
          <div className="funnel-step" key={s.key}>
            <div className="funnel-step-head">
              <span className="name">{s.label}</span>
              <span className="val">
                {fmtInt(s.value)} {tier.unit}
                {s.rateFromPrev !== null ? (
                  <span style={{ color: 'var(--c-text-weak)', fontWeight: 400, marginLeft: 8 }}>
                    上一步转化 {fmtPct(s.rateFromPrev)}
                  </span>
                ) : null}
              </span>
            </div>
            <div className="funnel-bar-wrap">
              <div
                className="funnel-bar"
                style={{
                  width: `${Math.max(1.5, ratio * 100)}%`,
                  background: baseColor,
                  opacity: 1 - i * 0.13,
                }}
              />
            </div>
            <div className="funnel-note">
              <span style={{ color: 'var(--c-text-sub)', fontWeight: 600 }}>
                占本层首步 {fmtPct(ratio)}
              </span>
              <span style={{ margin: '0 6px', color: 'var(--c-border-strong)' }}>|</span>
              {s.hint}
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div>
      {renderTier(model.userTier, COLORS.primary)}
      <hr className="funnel-divider" />
      {renderTier(model.contentTier, COLORS.purple)}
      <div className="context-row">
        {model.context.map((c) => (
          <span key={c.label}>
            {c.label}：<b>{fmtInt(c.value)}</b>
          </span>
        ))}
      </div>
      <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--c-text-weak)' }}>
        口径说明：用户层统计「去重人数」，内容层统计「内容条数」，两层不混合计算转化率；
        人均生成任务数、单内容扫码次数等过程量单独在上方展示，不进入漏斗。
      </div>
    </div>
  );
}

/* -------------------------------- 主区块 --------------------------------- */

export interface ActivitySectionProps {
  daily: DailyPoint[];
  funnel: FunnelModel;
  siteRows: SiteRow[];
  onSelectSite: (siteId: string) => void;
  activeSiteId: string;
}

type SortKey = 'participants' | 'successRate' | 'scanRate' | 'shareRate' | 'avgDurationMs';

export default function ActivitySection({
  daily,
  funnel,
  siteRows,
  onSelectSite,
  activeSiteId,
}: ActivitySectionProps) {
  const [sortKey, setSortKey] = useState<SortKey>('participants');

  const chartData = useMemo(
    () =>
      daily.map((d) => ({
        day: shortDay(d.day),
        fullDay: d.day,
        participants: d.participants,
        tasksSuccess: d.tasksSuccess,
        tasksFailed: d.tasksFailed,
        tasksPending: d.tasksPending,
        successRate: d.successRate === null ? null : Number((d.successRate * 100).toFixed(2)),
      })),
    [daily],
  );

  const siteChartData = useMemo(
    () =>
      [...siteRows]
        .sort((a, b) => b.agg.participants - a.agg.participants)
        .map((r) => ({
          name: r.siteName.replace(/^.*·/, ''),
          fullName: r.siteName,
          siteId: r.siteId,
          participants: r.agg.participants,
          scanRate: r.agg.scanRate,
          scanRateText: `扫码 ${fmtPct(r.agg.scanRate, 0)}`,
        })),
    [siteRows],
  );

  const sortedRows = useMemo(() => {
    const val = (r: SiteRow): number => {
      if (sortKey === 'participants') return r.agg.participants;
      if (sortKey === 'successRate') return r.agg.successRate ?? -1;
      if (sortKey === 'scanRate') return r.agg.scanRate ?? -1;
      if (sortKey === 'shareRate') return r.agg.shareRate ?? -1;
      return r.agg.avgDurationMs ?? -1;
    };
    return [...siteRows].sort((a, b) => val(b) - val(a));
  }, [siteRows, sortKey]);

  const isEmpty = daily.length === 0;
  const maxParticipants = Math.max(1, ...siteRows.map((r) => r.agg.participants));

  const th = (key: SortKey, label: string) => (
    <th
      style={{ cursor: 'pointer', color: sortKey === key ? COLORS.primary : undefined }}
      onClick={() => setSortKey(key)}
      title="点击按该列排序"
    >
      {label} {sortKey === key ? '↓' : ''}
    </th>
  );

  return (
    <div className="section" id="sec-activity">
      <div className="section-head">
        <h2 className="section-title">
          <span className="idx">1</span> 活动效果分析
        </h2>
        <p className="section-desc">参与规模、生成结果、转化路径与点位横向对比</p>
      </div>

      <div className="grid-2">
        <ChartCard
          title="每日参与人数趋势"
          subtitle="去重用户数（人），按参与事件自然日归属"
          isEmpty={isEmpty}
          height={250}
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
              <defs>
                <linearGradient id="gradPart" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLORS.primary} stopOpacity={0.32} />
                  <stop offset="100%" stopColor={COLORS.primary} stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef0f3" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#8a9099' }} minTickGap={16} />
              <YAxis tick={{ fontSize: 11, fill: '#8a9099' }} width={44} />
              <Tooltip
                content={
                  <ChartTooltip
                    valueFormatter={(v) => (v === null ? '—' : `${Math.round(v)} 人`)}
                    labelFormatter={(l) => {
                      const hit = chartData.find((d) => d.day === l);
                      return hit ? hit.fullDay : String(l ?? '');
                    }}
                  />
                }
              />
              <Area
                type="monotone"
                dataKey="participants"
                name="参与人数"
                stroke={COLORS.primary}
                strokeWidth={2}
                fill="url(#gradPart)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="AI 生成成功 / 失败趋势"
          subtitle="柱：任务次数（生成中不入柱）；线：当日成功率（%）"
          isEmpty={isEmpty}
          height={250}
        >
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef0f3" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#8a9099' }} minTickGap={16} />
              <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#8a9099' }} width={44} />
              <YAxis
                yAxisId="right"
                orientation="right"
                domain={[60, 100]}
                tick={{ fontSize: 11, fill: '#8a9099' }}
                width={48}
                unit="%"
              />
              <Tooltip
                content={
                  <ChartTooltip
                    valueFormatter={(v, k) =>
                      v === null ? '—' : k === 'successRate' ? `${v.toFixed(1)}%` : `${Math.round(v)} 次`
                    }
                    labelFormatter={(l) => {
                      const hit = chartData.find((d) => d.day === l);
                      return hit ? hit.fullDay : String(l ?? '');
                    }}
                  />
                }
              />
              <Bar yAxisId="left" dataKey="tasksSuccess" name="生成成功" stackId="a" fill={COLORS.success} />
              <Bar yAxisId="left" dataKey="tasksFailed" name="生成失败" stackId="a" fill={COLORS.danger} />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="successRate"
                name="成功率"
                stroke={COLORS.primary}
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="grid-2" style={{ marginTop: 12 }}>
        <ChartCard
          title="参与 → 生成 → 审核 → 扫码 / 分享"
          subtitle="分层漏斗：用户层（人数）与内容层（内容数）分开统计"
          isEmpty={funnel.contentTier.steps[0].value === 0}
          height={392}
        >
          <FunnelView model={funnel} />
        </ChartCard>

        <ChartCard
          title="各点位活动效果对比"
          subtitle="条形：参与人数；标签：扫码转化率"
          isEmpty={siteChartData.length === 0}
          height={392}
          note={
            <div style={{ fontSize: 11.5, color: 'var(--c-text-weak)' }}>
              点击条形或下方表格行可下钻到该点位。若某点位参与量高但扫码 / 分享明显偏低，
              可在下方点位明细中对比各设备转化率，异常会在「异常监控」中以 R5 规则给出提示。
            </div>
          }
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={siteChartData}
              layout="vertical"
              margin={{ top: 8, right: 56, left: 8, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#eef0f3" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: '#8a9099' }} />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fontSize: 11, fill: '#646a73' }}
                width={76}
              />
              <Tooltip
                cursor={{ fill: '#f5f7fa' }}
                content={renderTooltip(({ active, payload }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  const d = payload[0].payload as unknown as {
                    fullName: string;
                    participants: number;
                    scanRate: number | null;
                  };
                  return (
                    <div className="chart-tooltip">
                      <div className="t-title">{d.fullName}</div>
                      <div className="t-row">
                        <span>参与人数</span>
                        <b>{fmtInt(d.participants)} 人</b>
                      </div>
                      <div className="t-row">
                        <span>扫码转化率</span>
                        <b>{fmtPct(d.scanRate)}</b>
                      </div>
                    </div>
                  );
                })}
              />
              <Bar
                dataKey="participants"
                name="参与人数"
                radius={[0, 4, 4, 0]}
                onClick={(d: unknown) => {
                  const row = d as { siteId?: string };
                  if (row?.siteId) onSelectSite(row.siteId);
                }}
              >
                {siteChartData.map((d) => (
                  <Cell
                    key={d.siteId}
                    fill={d.siteId === activeSiteId ? COLORS.primary : '#93aaf0'}
                    cursor="pointer"
                  />
                ))}
                <LabelList dataKey="scanRateText" position="right" style={{ fontSize: 11, fill: '#646a73' }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="card-head">
          <div>
            <h3 className="card-title">
              <MousePointerClick size={14} /> 点位明细（点击行下钻该点位）
            </h3>
            <p className="card-sub">按所选统计区间计算；点击表头可切换排序</p>
          </div>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          {sortedRows.length === 0 ? (
            <div className="empty">当前筛选条件下没有数据</div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>点位</th>
                    {th('participants', '参与人数')}
                    {th('successRate', '生成成功率')}
                    {th('avgDurationMs', '平均时长')}
                    <th>有效内容</th>
                    {th('scanRate', '扫码转化率')}
                    {th('shareRate', '分享转化率')}
                    <th>审核拒绝率</th>
                    <th style={{ width: 90 }}>参与量占比</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((r) => (
                    <tr
                      key={r.siteId}
                      className="clickable"
                      onClick={() => onSelectSite(r.siteId)}
                      style={r.siteId === activeSiteId ? { background: 'var(--c-primary-soft)' } : undefined}
                    >
                      <td>
                        <div style={{ fontWeight: 600 }}>{r.siteName}</div>
                        <div style={{ color: 'var(--c-text-weak)', fontSize: 11.5 }}>
                          {r.city} · {r.type} · {r.deviceCount} 台设备
                        </div>
                      </td>
                      <td className="num">{fmtInt(r.agg.participants)}</td>
                      <td className="num">
                        <span
                          style={{
                            color:
                              (r.agg.successRate ?? 1) < 0.9 ? COLORS.danger : undefined,
                            fontWeight: (r.agg.successRate ?? 1) < 0.9 ? 700 : 400,
                          }}
                        >
                          {fmtPct(r.agg.successRate)}
                        </span>
                        <div style={{ color: 'var(--c-text-weak)', fontSize: 11 }}>
                          失败 {fmtInt(r.agg.tasksFailed)} 次
                        </div>
                      </td>
                      <td className="num">
                        <span
                          style={{
                            color:
                              (r.agg.avgDurationMs ?? 0) / 1000 > 15 ? COLORS.danger : undefined,
                          }}
                        >
                          {fmtSec(r.agg.avgDurationMs)}
                        </span>
                      </td>
                      <td className="num">{fmtInt(r.agg.validContents)}</td>
                      <td className="num">
                        {fmtPct(r.agg.scanRate)}
                        <div style={{ color: 'var(--c-text-weak)', fontSize: 11 }}>
                          {fmtInt(r.agg.scannedContents)} / {fmtInt(r.agg.validContents)}
                        </div>
                      </td>
                      <td className="num">
                        {fmtPct(r.agg.shareRate)}
                        <div style={{ color: 'var(--c-text-weak)', fontSize: 11 }}>
                          {fmtInt(r.agg.sharedContents)} / {fmtInt(r.agg.validContents)}
                        </div>
                      </td>
                      <td className="num">
                        <span
                          style={{
                            color: (r.agg.rejectRate ?? 0) > 0.1 ? COLORS.danger : undefined,
                          }}
                        >
                          {fmtPct(r.agg.rejectRate)}
                        </span>
                      </td>
                      <td>
                        <RatioBar value={r.agg.participants / maxParticipants} color={COLORS.primary} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
