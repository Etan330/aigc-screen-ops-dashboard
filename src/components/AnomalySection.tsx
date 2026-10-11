import { useMemo, useState } from 'react';
import { AlertTriangle, BellRing, ChevronRight, Settings2 } from 'lucide-react';
import type { Anomaly, RuleId } from '../lib/anomalies';
import { thresholdTextList } from '../lib/anomalies';
import { SEVERITY_META, THRESHOLDS } from '../lib/config';
import { Badge } from './ui';

const RULE_LABELS: Record<RuleId, string> = {
  R1: 'R1 生成成功率',
  R2: 'R2 生成时长',
  R3: 'R3 审核拒绝率',
  R4: 'R4 设备离线',
  R5: 'R5 扫码转化',
};

export interface AnomalySectionProps {
  anomalies: Anomaly[];
  onOpen: (a: Anomaly) => void;
  siteId: string;
  rangeLabel: string;
}

export default function AnomalySection({ anomalies, onOpen, siteId, rangeLabel }: AnomalySectionProps) {
  const [rule, setRule] = useState<RuleId | 'ALL'>('ALL');
  const [severity, setSeverity] = useState<'ALL' | '严重' | '高' | '中'>('ALL');

  const counts = useMemo(() => {
    const c: Record<string, number> = { ALL: anomalies.length, 严重: 0, 高: 0, 中: 0 };
    for (const a of anomalies) c[a.severity] = (c[a.severity] ?? 0) + 1;
    return c;
  }, [anomalies]);

  const ruleCounts = useMemo(() => {
    const c = new Map<RuleId, number>();
    for (const a of anomalies) c.set(a.ruleId, (c.get(a.ruleId) ?? 0) + 1);
    return c;
  }, [anomalies]);

  const rows = anomalies.filter(
    (a) => (rule === 'ALL' || a.ruleId === rule) && (severity === 'ALL' || a.severity === severity),
  );

  return (
    <div className="section" id="sec-anomaly">
      <div className="section-head">
        <h2 className="section-title">
          <span className="idx">4</span> 异常监控与定位
        </h2>
        <p className="section-desc">
          规则基于模拟数据动态计算，点击任意一条可下钻查看证据、假设与行动建议
        </p>
      </div>

      <div className="card">
        <div className="anomaly-filters">
          <span className="filter-label">
            <BellRing size={14} style={{ verticalAlign: -2, marginRight: 4 }} />
            规则
          </span>
          <button className={`chip ${rule === 'ALL' ? 'active' : ''}`} onClick={() => setRule('ALL')}>
            全部 {counts.ALL}
          </button>
          {(Object.keys(RULE_LABELS) as RuleId[]).map((r) => (
            <button
              key={r}
              className={`chip ${rule === r ? 'active' : ''}`}
              onClick={() => setRule(r)}
              disabled={(ruleCounts.get(r) ?? 0) === 0}
              style={(ruleCounts.get(r) ?? 0) === 0 ? { opacity: 0.45 } : undefined}
            >
              {RULE_LABELS[r]} {ruleCounts.get(r) ?? 0}
            </button>
          ))}
          <span style={{ width: 12 }} />
          <span className="filter-label">严重程度</span>
          {(['ALL', '严重', '高', '中'] as const).map((s) => (
            <button
              key={s}
              className={`chip ${severity === s ? 'active' : ''}`}
              onClick={() => setSeverity(s)}
            >
              {s === 'ALL' ? '全部' : s} {counts[s] ?? 0}
            </button>
          ))}
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--c-text-sub)' }}>
            统计区间 {rangeLabel} · 点位 {siteId === 'ALL' ? '全部' : siteId}
          </span>
        </div>

        <div className="card-body" style={{ padding: 0 }}>
          {rows.length === 0 ? (
            <div className="empty">
              <AlertTriangle className="icon" size={24} />
              <div>当前筛选条件下未触发任何异常规则</div>
              <div style={{ fontSize: 12 }}>
                可切换到「近 30 天」或「全部点位」查看已注入的演示异常
              </div>
            </div>
          ) : (
            rows.map((a) => {
              const sev = SEVERITY_META[a.severity];
              return (
                <div className="anomaly-row" key={a.id} onClick={() => onOpen(a)}>
                  <Badge
                    tone={a.severity === '严重' ? 'danger' : a.severity === '高' ? 'warn' : 'primary'}
                  >
                    {a.severity}
                  </Badge>
                  <div>
                    <div className="anomaly-main">{a.ruleName}</div>
                    <div className="anomaly-sub">
                      {a.ruleId} · {a.category} · {a.granularity}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 13 }}>
                      {a.siteName ?? '—'}
                      {a.deviceId ? ` · ${a.deviceId}` : ''}
                    </div>
                    <div className="anomaly-sub">{a.periodLabel}</div>
                  </div>
                  <div className="anomaly-metric">
                    <span className="actual" style={{ color: sev.color }}>
                      {a.actualText}
                    </span>
                    <span className="thr">阈值 {a.thresholdText}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--c-text-sub)' }}>{a.sampleText}</div>
                  <ChevronRight size={16} color="var(--c-text-weak)" />
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="card-head">
          <div>
            <h3 className="card-title">
              <Settings2 size={14} /> 当前生效的阈值（演示规则，可在 src/lib/config.ts 修改）
            </h3>
            <p className="card-sub">
              修改阈值后，本页异常列表与判定结果会自动重算；样本量下限用于避免小样本误报
            </p>
          </div>
        </div>
        <div className="card-body">
          <div className="threshold-list">
            {thresholdTextList().map((t) => (
              <div className="threshold-row" key={t.rule}>
                <span className="name">{t.rule}</span>
                <span>{t.text}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--c-text-weak)' }}>
            严重度升级规则：成功率 &lt; {(THRESHOLDS.genSuccessRateMin * 100 - 10).toFixed(0)}%、
            时长 &gt; 25s、拒绝率 &gt; 20%、离线 &gt; 60 分钟时升级为「严重」。
          </div>
        </div>
      </div>
    </div>
  );
}
