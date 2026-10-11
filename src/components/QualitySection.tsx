import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ShieldAlert, Zap } from 'lucide-react';
import type { DailyPoint, DistRow, StyleRejectRow } from '../lib/metrics';
import { COLORS, THRESHOLDS } from '../lib/config';
import { fmtInt, fmtPct } from '../lib/format';
import { shortDay } from '../lib/time';
import { ChartCard, ChartTooltip, RatioBar } from './ui';

export interface QualitySectionProps {
  daily: DailyPoint[];
  failureRows: DistRow[];
  rejectRows: DistRow[];
  styleRows: StyleRejectRow[];
  modStats: { pass: number; reject: number; pending: number };
  slowTaskRatio: number | null;
  slowTaskCount: number;
  /** 当前筛选的点位范围文案，用于提示是否需要下钻 */
  scopeLabel: string;
  scopeIsAllSites: boolean;
}

export default function QualitySection({
  daily,
  failureRows,
  rejectRows,
  styleRows,
  modStats,
  slowTaskRatio,
  slowTaskCount,
  scopeLabel,
  scopeIsAllSites,
}: QualitySectionProps) {
  const isEmpty = daily.length === 0;

  const rateData = useMemo(
    () =>
      daily.map((d) => ({
        day: shortDay(d.day),
        fullDay: d.day,
        successRate: d.successRate === null ? null : Number((d.successRate * 100).toFixed(2)),
        completed: d.completedTasks,
      })),
    [daily],
  );

  const durData = useMemo(
    () =>
      daily.map((d) => ({
        day: shortDay(d.day),
        fullDay: d.day,
        avg: d.avgDurationMs === null ? null : Number((d.avgDurationMs / 1000).toFixed(2)),
        p95: d.p95DurationMs === null ? null : Number((d.p95DurationMs / 1000).toFixed(2)),
      })),
    [daily],
  );

  const pieData = [
    { key: 'pass', name: '审核通过', value: modStats.pass, color: COLORS.success },
    { key: 'pending', name: '待审核', value: modStats.pending, color: COLORS.gray },
    { key: 'reject', name: '审核拒绝', value: modStats.reject, color: COLORS.danger },
  ].filter((d) => d.value > 0);
  const pieTotal = modStats.pass + modStats.reject + modStats.pending;

  return (
    <div className="section" id="sec-quality">
      <div className="section-head">
        <h2 className="section-title">
          <span className="idx">2</span> AI 生成质量与内容审核
        </h2>
        <p className="section-desc">
          生成失败属于技术链路问题；审核拒绝属于内容治理问题，两者分开跟踪
        </p>
      </div>

      <div className="grid-2">
        <ChartCard
          title="生成成功率趋势"
          subtitle={`红线为 ${(THRESHOLDS.genSuccessRateMin * 100).toFixed(0)}% 告警阈值；生成中任务不计入分母`}
          isEmpty={isEmpty}
          height={250}
        >
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rateData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef0f3" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#8a9099' }} minTickGap={16} />
              <YAxis domain={[50, 100]} unit="%" tick={{ fontSize: 11, fill: '#8a9099' }} width={54} />
              <Tooltip
                content={
                  <ChartTooltip
                    valueFormatter={(v) => (v === null ? '—' : `${v.toFixed(1)}%`)}
                    labelFormatter={(l) => {
                      const hit = rateData.find((d) => d.day === l);
                      return hit ? `${hit.fullDay}（完成 ${hit.completed} 次）` : String(l ?? '');
                    }}
                  />
                }
              />
              <ReferenceLine
                y={THRESHOLDS.genSuccessRateMin * 100}
                stroke={COLORS.danger}
                strokeDasharray="4 3"
                label={{ value: '阈值 90%', position: 'insideTopRight', fontSize: 11, fill: COLORS.danger }}
              />
              <Line
                type="monotone"
                dataKey="successRate"
                name="生成成功率"
                stroke={COLORS.primary}
                strokeWidth={2}
                dot={{ r: 1.6 }}
                connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="平均生成时长与 P95"
          subtitle={`红线为 ${THRESHOLDS.avgDurationMaxSec}s 告警阈值；仅统计成功任务`}
          isEmpty={isEmpty}
          height={250}
          note={
            <div style={{ fontSize: 11.5, color: 'var(--c-text-weak)' }}>
              超 {THRESHOLDS.avgDurationMaxSec}s 高延迟任务 {fmtInt(slowTaskCount)} 次，占成功任务{' '}
              {fmtPct(slowTaskRatio)}。P95 明显高于均值时，优先优化排队与长尾，而非只看平均耗时。
            </div>
          }
        >
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={durData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef0f3" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#8a9099' }} minTickGap={16} />
              <YAxis unit="s" tick={{ fontSize: 11, fill: '#8a9099' }} width={54} />
              <Tooltip
                content={
                  <ChartTooltip
                    valueFormatter={(v) => (v === null ? '—' : `${v.toFixed(2)}s`)}
                    labelFormatter={(l) => {
                      const hit = durData.find((d) => d.day === l);
                      return hit ? hit.fullDay : String(l ?? '');
                    }}
                  />
                }
              />
              <ReferenceLine
                y={THRESHOLDS.avgDurationMaxSec}
                stroke={COLORS.danger}
                strokeDasharray="4 3"
                label={{ value: `阈值 ${THRESHOLDS.avgDurationMaxSec}s`, position: 'insideTopRight', fontSize: 11, fill: COLORS.danger }}
              />
              <Bar dataKey="avg" name="平均时长" fill="#93aaf0" radius={[3, 3, 0, 0]} />
              <Line type="monotone" dataKey="p95" name="P95 时长" stroke={COLORS.warn} strokeWidth={2} dot={false} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="grid-3" style={{ marginTop: 12 }}>
        <ChartCard
          title="生成失败原因分布"
          subtitle="技术链路问题：失败任务按原因归类"
          isEmpty={failureRows.length === 0}
          emptyText="当前区间没有生成失败任务"
          height={240}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={failureRows}
              layout="vertical"
              margin={{ top: 4, right: 16, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#eef0f3" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: '#8a9099' }} />
              <YAxis type="category" dataKey="label" tick={{ fontSize: 11, fill: '#646a73' }} width={112} />
              <Tooltip content={<ChartTooltip valueFormatter={(v) => (v === null ? '—' : `${Math.round(v)} 次`)} />} />
              <Bar dataKey="value" name="失败次数" radius={[0, 4, 4, 0]} fill={COLORS.danger}>
                {failureRows.map((r, i) => (
                  <Cell key={r.key} fill={i === 0 ? COLORS.danger : '#f09289'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="内容审核状态分布"
          subtitle={`内容治理口径：待审核 ${fmtInt(modStats.pending)} 条不计入通过率分母`}
          isEmpty={pieTotal === 0}
          height={240}
        >
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={pieData}
                dataKey="value"
                nameKey="name"
                innerRadius={52}
                outerRadius={82}
                paddingAngle={2}
                stroke="#fff"
                strokeWidth={2}
              >
                {pieData.map((d) => (
                  <Cell key={d.key} fill={d.color} />
                ))}
              </Pie>
              <Tooltip content={<ChartTooltip valueFormatter={(v) => (v === null ? '—' : `${Math.round(v)} 条`)} />} />
              <Legend
                verticalAlign="bottom"
                height={28}
                formatter={(value: string) => <span style={{ fontSize: 12, color: '#646a73' }}>{value}</span>}
              />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="内容拒绝原因分布"
          subtitle="仅统计审核拒绝内容（模拟分类）"
          isEmpty={rejectRows.length === 0}
          emptyText="当前区间没有被拒绝的内容"
          height={240}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rejectRows} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef0f3" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: '#8a9099' }} />
              <YAxis type="category" dataKey="label" tick={{ fontSize: 11, fill: '#646a73' }} width={112} />
              <Tooltip content={<ChartTooltip valueFormatter={(v) => (v === null ? '—' : `${Math.round(v)} 条`)} />} />
              <Bar dataKey="value" name="拒绝条数" radius={[0, 4, 4, 0]}>
                {rejectRows.map((r, i) => (
                  <Cell key={r.key} fill={i === 0 ? COLORS.warn : '#f3c68c'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="card-head">
          <div>
            <h3 className="card-title">
              <ShieldAlert size={14} /> 按创作风格的审核拒绝率
            </h3>
            <p className="card-sub">
              用于判断拒绝是集中在某个风格（模板 / 提示词问题）还是全域误杀；阈值 {fmtPct(THRESHOLDS.rejectRateMax, 0)}。
              「相对当日大盘偏离」已剔除「该点位当天整体审核变严」这类日级效应，只保留风格自身差异，因此长区间被平均后仍能看出集中度。
            </p>
          </div>
          <span className="badge gray">
            <Zap size={12} /> 仅统计已完成审核内容
          </span>
        </div>
        {scopeIsAllSites ? (
          <div style={{ padding: '0 16px 8px' }}>
            <div className="callout info">
              <Zap size={13} />
              <span>
                <div>当前点位范围为「全部点位」，单个点位某个风格的集中拒绝会被其他点位稀释。</div>
                <div>若某条 R3 异常提示拒绝集中在某风格，请把点位切换到该点位后再看本表，差异会更明显。</div>
              </span>
            </div>
          </div>
        ) : (
          <div style={{ padding: '0 16px 8px', fontSize: 12, color: 'var(--c-text-sub)' }}>
            当前点位范围：{scopeLabel}
          </div>
        )}
        <div className="card-body" style={{ padding: 0 }}>
          {styleRows.length === 0 ? (
            <div className="empty">当前筛选条件下没有已审核内容</div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>创作风格</th>
                    <th>已审核内容</th>
                    <th>拒绝条数</th>
                    <th>区间拒绝率</th>
                    <th>相对当日大盘偏离</th>
                    <th style={{ width: 160 }}>偏离强度</th>
                  </tr>
                </thead>
                <tbody>
                  {styleRows.map((s) => {
                    const overRange = (s.rejectRate ?? 0) > THRESHOLDS.rejectRateMax;
                    const overExcess = (s.excessRate ?? 0) > 0.1;
                    return (
                      <tr key={s.key}>
                        <td style={{ fontWeight: overExcess ? 700 : 400 }}>{s.label}</td>
                        <td className="num">{fmtInt(s.reviewed)}</td>
                        <td className="num">{fmtInt(s.rejected)}</td>
                        <td className="num" style={{ color: overRange ? COLORS.danger : undefined, fontWeight: overRange ? 700 : 400 }}>
                          {fmtPct(s.rejectRate)}
                        </td>
                        <td className="num" style={{ color: overExcess ? COLORS.danger : undefined, fontWeight: overExcess ? 700 : 400 }}>
                          {s.excessRate === null
                            ? '—'
                            : `${s.excessRate > 0 ? '+' : ''}${(s.excessRate * 100).toFixed(1)}pp`}
                          <span style={{ color: 'var(--c-text-weak)', fontWeight: 400, marginLeft: 6, fontSize: 11.5 }}>
                            达标天数 {s.excessDays}
                          </span>
                        </td>
                        <td>
                          <RatioBar
                            value={s.excessRate === null ? null : Math.max(0, s.excessRate) * 3}
                            color={overExcess ? COLORS.danger : COLORS.primary}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="card-body" style={{ fontSize: 12.5, color: 'var(--c-text-sub)' }}>
          <strong>口径边界提醒：</strong>生成失败（模型超时、服务异常、参数异常、输入图像质量）由技术链路决定，应派单给技术运维；审核拒绝（违规图像、敏感内容、肖像版权风险）由内容治理策略决定，应反馈给审核策略与运营选品。两者的分母、归因与责任人不同，不应合并为「内容没出来」这一类口径。
        </div>
      </div>
    </div>
  );
}
