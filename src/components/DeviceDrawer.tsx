import { Activity, Cpu, Wifi, WifiOff } from 'lucide-react';
import type { DeviceStatus } from '../lib/metrics';
import type { Anomaly } from '../lib/anomalies';
import type { Heartbeats } from '../types';
import { THRESHOLDS } from '../lib/config';
import { fmtInt, fmtMinutes, fmtPct, fmtSec } from '../lib/format';
import { fullTs, parseTs } from '../lib/time';
import { Badge } from './ui';

const WINDOW_HOURS = 12;

function HeartbeatStrip({
  beats,
  baseline,
}: {
  beats: string[];
  baseline: string;
}) {
  const beatSet = new Set(beats);
  const end = parseTs(baseline).getTime();
  const start = end - WINDOW_HOURS * 3600_000;
  const slots: { ts: string; state: 'online' | 'missing' | 'idle' }[] = [];
  for (let t = start; t <= end; t += THRESHOLDS.heartbeatStaleMinutes * 60_000) {
    const iso = new Date(t + 8 * 3600_000).toISOString();
    const s = `${iso.slice(0, 10)}T${iso.slice(11, 19)}`;
    const hour = Number(s.slice(11, 13));
    const minute = Number(s.slice(14, 16));
    const inOperating = hour * 60 + minute >= 9 * 60 + 30 && hour * 60 + minute <= 22 * 60;
    slots.push({ ts: s, state: !inOperating ? 'idle' : beatSet.has(s) ? 'online' : 'missing' });
  }
  const startIso = new Date(start + 8 * 3600_000).toISOString();
  return (
    <div>
      <div className="heartbeat-strip">
        {slots.map((s) => (
          <div
            key={s.ts}
            className={`bar ${s.state}`}
            title={`${s.ts} · ${s.state === 'online' ? '有心跳' : s.state === 'idle' ? '非运营时段' : '心跳缺失'}`}
          />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--c-text-weak)', fontSize: 11 }}>
        <span>{`${startIso.slice(5, 10)} ${startIso.slice(11, 16)}`}</span>
        <span>基准时间 {baseline.slice(11, 16)}</span>
      </div>
      <div className="heartbeat-legend">
        <span>
          <span className="dot" style={{ background: 'var(--c-success)' }} />
          有心跳
        </span>
        <span>
          <span className="dot" style={{ background: 'var(--c-danger)' }} />
          心跳缺失
        </span>
        <span>
          <span className="dot" style={{ background: '#e6e9ec' }} />
          非运营时段（09:30-22:00 之外）
        </span>
      </div>
    </div>
  );
}

export interface DeviceDrawerProps {
  status: DeviceStatus;
  heartbeats: Heartbeats;
  anomalies: Anomaly[];
  onOpenAnomaly: (a: Anomaly) => void;
}

export default function DeviceDrawer({
  status,
  heartbeats,
  anomalies,
  onOpenAnomaly,
}: DeviceDrawerProps) {
  const related = anomalies.filter((x) => x.deviceId === status.device.id);
  const beats = heartbeats.byDevice[status.device.id] ?? [];

  return (
    <div>
      <div className="card">
        <div className="card-head">
          <div>
            <h3 className="card-title">
              <Cpu size={14} /> 设备基本信息
            </h3>
          </div>
          {status.online ? (
            <Badge tone="success">
              <Wifi size={12} /> 在线
            </Badge>
          ) : (
            <Badge tone="danger">
              <WifiOff size={12} /> 离线
            </Badge>
          )}
        </div>
        <div className="card-body">
          <div className="facts">
            <span className="k">设备 ID</span>
            <span className="v">{status.device.id}</span>
            <span className="k">所属点位</span>
            <span className="v">{status.siteName}</span>
            <span className="k">型号 / 屏幕</span>
            <span className="v">
              {status.device.model} · {status.device.screenSizeInch} 英寸
            </span>
            <span className="k">安装日期</span>
            <span className="v">{status.device.installDate}</span>
            <span className="k">最后心跳</span>
            <span className="v">
              {status.lastHeartbeat ? fullTs(status.lastHeartbeat) : '无心跳记录'}
              {status.staleMinutes !== null ? `（${fmtMinutes(status.staleMinutes)}）` : ''}
            </span>
            <span className="k">近 7 日心跳在线率</span>
            <span className="v">
              {fmtPct(status.heartbeatRate7d)}（实到 {fmtInt(status.actualBeats7d)} / 应到{' '}
              {fmtInt(status.expectedBeats7d)}）
            </span>
            <span className="k">最近运行异常</span>
            <span className="v">{status.lastIncidentText}</span>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h3 className="card-title">
              <Activity size={14} /> 最近 12 小时心跳时间线
            </h3>
            <p className="card-sub">每格 {THRESHOLDS.heartbeatStaleMinutes} 分钟；红色表示运营时段内心跳缺失</p>
          </div>
        </div>
        <div className="card-body">
          <HeartbeatStrip beats={beats} baseline={heartbeats.baselineTime} />
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h3 className="card-title">业务表现（当前筛选区间）</h3>
            <p className="card-sub">随日期 / 点位筛选变化；在线状态不随日期变化</p>
          </div>
        </div>
        <div className="card-body">
          <div className="facts">
            <span className="k">生成任务数</span>
            <span className="v">{fmtInt(status.tasksInPeriod)} 次（失败 {fmtInt(status.failedInPeriod)} 次）</span>
            <span className="k">生成成功率</span>
            <span className="v" style={{ color: (status.successRateInPeriod ?? 1) < THRESHOLDS.genSuccessRateMin ? 'var(--c-danger)' : undefined }}>
              {fmtPct(status.successRateInPeriod)}
            </span>
            <span className="k">平均生成时长</span>
            <span
              className="v"
              style={{
                color: (status.avgDurationInPeriod ?? 0) / 1000 > THRESHOLDS.avgDurationMaxSec ? 'var(--c-danger)' : undefined,
              }}
            >
              {fmtSec(status.avgDurationInPeriod)}
            </span>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h3 className="card-title">心跳中断记录</h3>
            <p className="card-sub">同一运营日内相邻心跳间隔超过采样间隔，或当前心跳已超时</p>
          </div>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          {status.incidents.length === 0 ? (
            <div className="empty">近 15 日无心跳中断记录</div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>开始</th>
                    <th>结束</th>
                    <th>中断时长</th>
                  </tr>
                </thead>
                <tbody>
                  {status.incidents.slice(0, 8).map((i, k) => (
                    <tr key={k}>
                      <td>{fullTs(i.start)}</td>
                      <td>{fullTs(i.end)}</td>
                      <td className="num">{Math.round(i.minutes)} 分钟</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h3 className="card-title">关联异常</h3>
            <p className="card-sub">由规则引擎基于当前数据动态计算</p>
          </div>
        </div>
        <div className="card-body">
          {related.length === 0 ? (
            <div className="empty">当前筛选条件下该设备未触发异常规则</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {related.map((a) => (
                <div
                  key={a.id}
                  className="anomaly-row"
                  style={{ border: '1px solid var(--c-border)', borderRadius: 8, cursor: 'pointer' }}
                  onClick={() => onOpenAnomaly(a)}
                >
                  <Badge tone={a.severity === '严重' ? 'danger' : a.severity === '高' ? 'warn' : 'primary'}>
                    {a.severity}
                  </Badge>
                  <div className="anomaly-main">{a.ruleName}</div>
                  <div className="anomaly-sub">{a.granularity}</div>
                  <div className="anomaly-metric">
                    <span className="actual">{a.actualText}</span>
                    <span className="thr">阈值 {a.thresholdText}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--c-text-sub)' }}>{a.periodLabel}</div>
                  <span className="link-btn">查看详情</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
