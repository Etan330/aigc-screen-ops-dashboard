import { AlertTriangle, ArrowDownRight, ArrowUpRight, Info, Minus } from 'lucide-react';
import type { Agg } from '../lib/metrics';
import { THRESHOLDS } from '../lib/config';
import { fmtInt, fmtPct, fmtSec } from '../lib/format';
import type { DateRange } from '../types';

type Tone = 'good' | 'warn' | 'bad' | 'primary';

interface DeltaInfo {
  text: string;
  direction: 'up' | 'down' | 'flat';
  good: boolean;
}

function rateDelta(
  cur: number | null,
  prev: number | null,
  better: 'higher' | 'lower',
): DeltaInfo | null {
  if (cur === null || prev === null) return null;
  const d = cur - prev;
  const direction = Math.abs(d) < 1e-9 ? 'flat' : d > 0 ? 'up' : 'down';
  return {
    text: `${d > 0 ? '+' : ''}${(d * 100).toFixed(1)}pp`,
    direction,
    good: direction === 'flat' ? true : better === 'higher' ? d > 0 : d < 0,
  };
}

function secDelta(cur: number | null, prev: number | null): DeltaInfo | null {
  if (cur === null || prev === null) return null;
  const d = (cur - prev) / 1000;
  const direction = Math.abs(d) < 0.005 ? 'flat' : d > 0 ? 'up' : 'down';
  return {
    text: `${d > 0 ? '+' : ''}${d.toFixed(2)}s`,
    direction,
    good: direction === 'flat' ? true : d < 0,
  };
}

function countDelta(cur: number, prev: number): DeltaInfo | null {
  if (prev === 0) return null;
  const d = (cur - prev) / prev;
  const direction = Math.abs(d) < 0.0005 ? 'flat' : d > 0 ? 'up' : 'down';
  return { text: `${d > 0 ? '+' : ''}${(d * 100).toFixed(1)}%`, direction, good: d >= 0 };
}

function DeltaTag({ info }: { info: DeltaInfo | null }) {
  if (!info) return null;
  const Icon = info.direction === 'up' ? ArrowUpRight : info.direction === 'down' ? ArrowDownRight : Minus;
  return (
    <span className={`delta ${info.good ? 'good' : 'bad'}`}>
      <Icon size={12} />
      {info.text}
    </span>
  );
}

function KpiCard({
  label,
  value,
  unit,
  detail,
  delta,
  deltaNote,
  tone,
  foot,
}: {
  label: string;
  value: string;
  unit?: string;
  detail: string;
  delta?: DeltaInfo | null;
  deltaNote?: string;
  tone: Tone;
  foot?: React.ReactNode;
}) {
  return (
    <div className={`kpi-card tone-${tone}`}>
      <div className="kpi-head">
        {label}
        {tone === 'bad' ? <AlertTriangle size={13} color="var(--c-danger)" /> : null}
      </div>
      <div className="kpi-value">
        {value}
        {unit ? <span className="unit">{unit}</span> : null}
      </div>
      <div className="kpi-detail">{detail}</div>
      <div className="kpi-foot">
        {delta !== undefined ? (
          delta ? (
            <>
              <DeltaTag info={delta} />
              <span className="kpi-note">{deltaNote ?? '较上一可比周期'}</span>
            </>
          ) : (
            <span className="kpi-note">{deltaNote ?? '上一可比周期无可比数据'}</span>
          )
        ) : (
          <span className="kpi-note">{deltaNote}</span>
        )}
        {foot}
      </div>
    </div>
  );
}

export interface KpiCardsProps {
  agg: Agg;
  prev: Agg | null;
  prevRange: DateRange;
  online: { online: number; total: number; rate: number | null };
  dedupeNote: { sumBySite: number; globalUnique: number; overlap: number } | null;
  hasPrevData: boolean;
}

export default function KpiCards({
  agg,
  prev,
  prevRange,
  online,
  dedupeNote,
  hasPrevData,
}: KpiCardsProps) {
  const prevOrNull = hasPrevData ? prev : null;
  const cmpNote = `较 ${prevRange.startDate} ~ ${prevRange.endDate}`;

  const successTone: Tone =
    agg.successRate === null
      ? 'primary'
      : agg.successRate >= 0.95
        ? 'good'
        : agg.successRate >= THRESHOLDS.genSuccessRateMin
          ? 'warn'
          : 'bad';

  const durTone: Tone =
    agg.avgDurationMs === null
      ? 'primary'
      : agg.avgDurationMs / 1000 <= 8
        ? 'good'
        : agg.avgDurationMs / 1000 <= THRESHOLDS.avgDurationMaxSec
          ? 'warn'
          : 'bad';

  const passTone: Tone =
    agg.passRate === null ? 'primary' : agg.passRate >= 0.95 ? 'good' : agg.passRate >= 0.9 ? 'warn' : 'bad';

  const onlineTone: Tone =
    online.rate === null ? 'primary' : online.rate >= 1 ? 'good' : online.rate >= 0.8 ? 'warn' : 'bad';

  return (
    <div className="kpi-grid">
      <KpiCard
        label="参与人数"
        value={fmtInt(agg.participants)}
        unit="人"
        detail={`参与事件 ${fmtInt(agg.participationEvents)} 人次 · 去重用户 ${fmtInt(agg.participants)} 人`}
        delta={prevOrNull ? countDelta(agg.participants, prevOrNull.participants) : null}
        deltaNote={hasPrevData ? cmpNote : '上一可比周期无数据'}
        tone="primary"
        foot={
          dedupeNote && dedupeNote.overlap > 0 ? (
            <span
              className="kpi-note"
              title={`各点位独立去重合计 ${dedupeNote.sumBySite} 人，全局去重 ${dedupeNote.globalUnique} 人`}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              <Info size={12} />跨点位重复 {dedupeNote.overlap} 人已去重
            </span>
          ) : null
        }
      />

      <KpiCard
        label="AI 生成成功率"
        value={fmtPct(agg.successRate)}
        detail={`成功 ${fmtInt(agg.tasksSuccess)} / 已完成 ${fmtInt(agg.completedTasks)} 次（生成中 ${fmtInt(agg.tasksPending)} 次不计入分母）`}
        delta={
          prevOrNull ? rateDelta(agg.successRate, prevOrNull.successRate, 'higher') : null
        }
        deltaNote={hasPrevData ? cmpNote : '上一可比周期无数据'}
        tone={successTone}
      />

      <KpiCard
        label="扫码转化率"
        value={fmtPct(agg.scanRate)}
        detail={`扫码内容 ${fmtInt(agg.scannedContents)} / 可扫码有效内容 ${fmtInt(agg.validContents)} 条（同一内容多次扫码只计一次）`}
        delta={prevOrNull ? rateDelta(agg.scanRate, prevOrNull.scanRate, 'higher') : null}
        deltaNote={hasPrevData ? cmpNote : '上一可比周期无数据'}
        tone="primary"
      />

      <KpiCard
        label="分享转化率"
        value={fmtPct(agg.shareRate)}
        detail={`分享内容 ${fmtInt(agg.sharedContents)} / 可分享有效内容 ${fmtInt(agg.validContents)} 条（分享失败 ${fmtInt(agg.shareFailedEvents)} 次不计入）`}
        delta={prevOrNull ? rateDelta(agg.shareRate, prevOrNull.shareRate, 'higher') : null}
        deltaNote={hasPrevData ? cmpNote : '上一可比周期无数据'}
        tone="primary"
      />

      <KpiCard
        label="平均生成时长"
        value={fmtSec(agg.avgDurationMs)}
        detail={`成功任务 ${fmtInt(agg.tasksSuccess)} 次 · P95 ${fmtSec(agg.p95DurationMs)} · 超 ${THRESHOLDS.avgDurationMaxSec}s ${fmtInt(agg.slowTaskCount)} 次`}
        delta={prevOrNull ? secDelta(agg.avgDurationMs, prevOrNull.avgDurationMs) : null}
        deltaNote={hasPrevData ? cmpNote : '上一可比周期无数据'}
        tone={durTone}
      />

      <KpiCard
        label="内容审核通过率"
        value={fmtPct(agg.passRate)}
        detail={`通过 ${fmtInt(agg.modPass)} / 已审核 ${fmtInt(agg.reviewedContents)} 条（待审核 ${fmtInt(agg.modPending)} 条不计入分母）`}
        delta={prevOrNull ? rateDelta(agg.passRate, prevOrNull.passRate, 'higher') : null}
        deltaNote={hasPrevData ? cmpNote : '上一可比周期无数据'}
        tone={passTone}
      />

      <KpiCard
        label="设备在线率"
        value={fmtPct(online.rate)}
        detail={`在线 ${fmtInt(online.online)} / 设备总数 ${fmtInt(online.total)} 台（心跳 ${THRESHOLDS.heartbeatStaleMinutes} 分钟内有效）`}
        tone={onlineTone}
        deltaNote="实时口径：相对数据基准时间，不随日期筛选变化"
      />
    </div>
  );
}
