import { Fragment } from 'react';
import { AlertTriangle, Lightbulb, ListChecks, Table2 } from 'lucide-react';
import type { Anomaly, AnomalyDetail } from '../lib/anomalies';
import { COLORS, SEVERITY_META } from '../lib/config';
import { fmtPct } from '../lib/format';
import { Badge } from './ui';

export interface AnomalyDetailPanelProps {
  anomaly: Anomaly;
  detail: AnomalyDetail;
  onFocusSite: (siteId: string) => void;
  onFocusDevice: (deviceId: string) => void;
}

function ComparisonView({ detail }: { detail: AnomalyDetail }) {
  if (!detail.comparison) return null;
  const max = Math.max(
    1,
    ...detail.comparison.rows.map((r) => (r.value === null ? 0 : Math.abs(r.value))),
  );
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h3 className="card-title">{detail.comparison.title}</h3>
          <p className="card-sub">{detail.comparison.note}</p>
        </div>
      </div>
      <div className="card-body">
        <div className="table-wrap">
          <table className="data-table compare-table">
            <thead>
              <tr>
                <th>对象</th>
                <th>指标值</th>
                <th>对比</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              {detail.comparison.rows.map((r) => (
                <tr key={r.name} style={r.highlight ? { background: 'var(--c-danger-soft)' } : undefined}>
                  <td style={{ fontWeight: r.highlight ? 700 : 400 }}>
                    {r.name}
                    {r.highlight ? ' ← 本条异常' : ''}
                  </td>
                  <td className="num" style={{ fontWeight: 600 }}>
                    {r.valueText}
                  </td>
                  <td>
                    <div className="ratio-bar">
                      <span
                        style={{
                          width: `${Math.max(2, Math.min(100, ((r.value ?? 0) / max) * 100))}%`,
                          background: r.highlight ? COLORS.danger : '#93aaf0',
                        }}
                      />
                    </div>
                  </td>
                  <td style={{ whiteSpace: 'normal', color: 'var(--c-text-sub)', fontSize: 12.5 }}>
                    {r.note ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function DistributionView({ detail }: { detail: AnomalyDetail }) {
  if (!detail.distribution || detail.distribution.rows.length === 0) return null;
  const rows = detail.distribution.rows;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h3 className="card-title">{detail.distribution.title}</h3>
          <p className="card-sub">{detail.distribution.note}</p>
        </div>
      </div>
      <div className="card-body">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {rows.map((r) => (
            <div key={r.key} style={{ display: 'grid', gridTemplateColumns: '190px 1fr 92px', gap: 10, alignItems: 'center' }}>
              <span style={{ fontSize: 12.5, color: 'var(--c-text-sub)' }}>{r.label}</span>
              <div className="ratio-bar">
                <span
                  style={{
                    width: `${Math.max(2, (r.value / max) * 100)}%`,
                    background: COLORS.primary,
                  }}
                />
              </div>
              <span style={{ fontSize: 12.5, textAlign: 'right' }}>
                {r.value} 次
                {r.percent !== null && r.percent !== undefined ? (
                  <span style={{ color: 'var(--c-text-weak)' }}> · {fmtPct(r.percent, 0)}</span>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SamplesView({ detail }: { detail: AnomalyDetail }) {
  if (!detail.samples || detail.samples.rows.length === 0) return null;
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h3 className="card-title">
            <Table2 size={14} /> {detail.samples.title}
          </h3>
          <p className="card-sub">直接取自模拟原始数据，可逐条回溯</p>
        </div>
      </div>
      <div className="card-body" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                {detail.samples.columns.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {detail.samples.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function AnomalyDetailPanel({
  anomaly,
  detail,
  onFocusSite,
  onFocusDevice,
}: AnomalyDetailPanelProps) {
  const sev = SEVERITY_META[anomaly.severity];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="card">
        <div className="card-head">
          <div>
            <h3 className="card-title">
              <AlertTriangle size={14} color={sev.color} /> 异常事实
            </h3>
            <p className="card-sub">全部字段由规则引擎基于模拟数据实时计算</p>
          </div>
          <Badge tone={anomaly.severity === '严重' ? 'danger' : anomaly.severity === '高' ? 'warn' : 'primary'}>
            {anomaly.severity}
          </Badge>
        </div>
        <div className="card-body">
          <div className="facts">
            {detail.facts.map((f) => (
              <Fragment key={f.label}>
                <span className="k">{f.label}</span>
                <span className="v">{f.value}</span>
              </Fragment>
            ))}
          </div>
          <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {anomaly.siteId ? (
              <button className="btn" onClick={() => onFocusSite(anomaly.siteId as string)}>
                筛选到该点位
              </button>
            ) : null}
            {anomaly.deviceId ? (
              <button className="btn" onClick={() => onFocusDevice(anomaly.deviceId as string)}>
                查看该设备详情
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <ComparisonView detail={detail} />
      <DistributionView detail={detail} />
      <SamplesView detail={detail} />

      <div className="card">
        <div className="card-head">
          <div>
            <h3 className="card-title">
              <Lightbulb size={14} /> 可能的原因（待验证假设）
            </h3>
          </div>
        </div>
        <div className="card-body">
          <div className="callout">
            <AlertTriangle size={14} />
            <span>
              以下均为基于现有数据提出的<strong>待验证假设</strong>，不是已确认根因。
              需要结合设备日志、服务端监控或现场巡检结果进一步验证。
            </span>
          </div>
          <ul className="hypo-list" style={{ marginTop: 10 }}>
            {anomaly.hypotheses.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
          <div style={{ marginTop: 6, fontSize: 12, color: 'var(--c-text-weak)' }}>
            {detail.relatedRuleText}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h3 className="card-title">
              <ListChecks size={14} /> 运营建议与下一步排查方向
            </h3>
          </div>
        </div>
        <div className="card-body">
          <ol className="action-list">
            {anomaly.actions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
