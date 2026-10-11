import { useState } from 'react';
import { HardDrive } from 'lucide-react';
import type { DeviceStatus } from '../lib/metrics';
import type { Anomaly } from '../lib/anomalies';
import type { Heartbeats } from '../types';
import { THRESHOLDS } from '../lib/config';
import { fmtInt, fmtMinutes, fmtPct, fmtSec } from '../lib/format';
import { fullTs } from '../lib/time';
import { Badge, StatusDot } from './ui';

export interface DeviceSectionProps {
  statuses: DeviceStatus[];
  anomalies: Anomaly[];
  heartbeats: Heartbeats;
  siteId: string;
  onOpenDevice: (deviceId: string) => void;
}

type StatusFilter = 'all' | 'online' | 'offline';

export default function DeviceSection({
  statuses,
  anomalies,
  heartbeats,
  siteId,
  onOpenDevice,
}: DeviceSectionProps) {
  const [filter, setFilter] = useState<StatusFilter>('all');
  const rows = statuses.filter((s) =>
    filter === 'all' ? true : filter === 'online' ? s.online : !s.online,
  );
  const offlineCount = statuses.filter((s) => !s.online).length;

  return (
    <div className="section" id="sec-device">
      <div className="section-head">
        <h2 className="section-title">
          <span className="idx">3</span> 设备运行监控
        </h2>
        <p className="section-desc">
          在线状态为实时口径（相对数据基准时间 {heartbeats.baselineTime.replace('T', ' ')}），
          不随历史日期筛选变化
        </p>
      </div>

      <div className="card">
        <div className="anomaly-filters">
          <span className="filter-label">
            <HardDrive size={14} style={{ verticalAlign: -2, marginRight: 4 }} />
            设备状态
          </span>
          <button className={`chip ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>
            全部 {statuses.length}
          </button>
          <button className={`chip ${filter === 'online' ? 'active' : ''}`} onClick={() => setFilter('online')}>
            在线 {statuses.length - offlineCount}
          </button>
          <button className={`chip ${filter === 'offline' ? 'active' : ''}`} onClick={() => setFilter('offline')}>
            离线 {offlineCount}
          </button>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--c-text-sub)' }}>
            点位范围：{siteId === 'ALL' ? '全部点位' : siteId} · 点击行可查看设备详情
          </span>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          {rows.length === 0 ? (
            <div className="empty">当前筛选条件下没有设备</div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>设备 ID</th>
                    <th>所属点位</th>
                    <th>状态</th>
                    <th>最近心跳</th>
                    <th>离线时长</th>
                    <th>近 7 日心跳在线率</th>
                    <th>最近运行异常</th>
                    <th>区间任务数</th>
                    <th>区间成功率</th>
                    <th>区间平均时长</th>
                    <th>运营动作建议</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => {
                    const hasAnomaly = anomalies.some((a) => a.deviceId === s.device.id);
                    return (
                      <tr key={s.device.id} className="clickable" onClick={() => onOpenDevice(s.device.id)}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{s.device.id}</div>
                          <div style={{ color: 'var(--c-text-weak)', fontSize: 11.5 }}>
                            {s.device.model} · {s.device.screenSizeInch}"
                          </div>
                        </td>
                        <td>{s.siteName}</td>
                        <td>
                          <Badge tone={s.online ? 'success' : 'danger'}>
                            <StatusDot online={s.online} />
                            {s.online ? '在线' : '离线'}
                          </Badge>
                        </td>
                        <td style={{ color: s.online ? undefined : 'var(--c-danger)' }}>
                          {s.lastHeartbeat ? fullTs(s.lastHeartbeat) : '无记录'}
                        </td>
                        <td className="num">
                          {s.staleMinutes === null
                            ? '—'
                            : s.online
                              ? `${Math.round(s.staleMinutes)} 分钟内`
                              : fmtMinutes(s.staleMinutes)}
                        </td>
                        <td className="num">{fmtPct(s.heartbeatRate7d)}</td>
                        <td style={{ whiteSpace: 'normal', minWidth: 160, fontSize: 12 }}>
                          {s.lastIncidentText}
                        </td>
                        <td className="num">{fmtInt(s.tasksInPeriod)}</td>
                        <td
                          className="num"
                          style={{
                            color:
                              (s.successRateInPeriod ?? 1) < THRESHOLDS.genSuccessRateMin
                                ? 'var(--c-danger)'
                                : undefined,
                          }}
                        >
                          {fmtPct(s.successRateInPeriod)}
                        </td>
                        <td
                          className="num"
                          style={{
                            color:
                              (s.avgDurationInPeriod ?? 0) / 1000 > THRESHOLDS.avgDurationMaxSec
                                ? 'var(--c-danger)'
                                : undefined,
                          }}
                        >
                          {fmtSec(s.avgDurationInPeriod)}
                        </td>
                        <td style={{ whiteSpace: 'normal', minWidth: 210, fontSize: 12.5 }}>
                          {s.online ? (
                            hasAnomaly ? (
                              <span style={{ color: 'var(--c-warn)' }}>
                                设备在线但业务指标异常，建议按异常详情排查（模型服务 / 转化链路）
                              </span>
                            ) : (
                              <span style={{ color: 'var(--c-text-sub)' }}>运行正常，保持常规巡检</span>
                            )
                          ) : (
                            <span style={{ color: 'var(--c-danger)' }}>
                              离线超过 {THRESHOLDS.heartbeatStaleMinutes} 分钟，联系现场确认通电与网络；
                              {' '}
                              {s.staleMinutes !== null && s.staleMinutes > 60
                                ? '超过 1 小时，建议派单现场检修'
                                : '短时中断，先远程确认'}
                            </span>
                          )}
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
    </div>
  );
}
