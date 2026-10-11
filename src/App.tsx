import { useCallback, useEffect, useMemo, useState } from 'react';
import { Database, MonitorPlay, RefreshCw, ShieldAlert } from 'lucide-react';
import type { Dataset, DateRange } from './types';
import type { Anomaly } from './lib/anomalies';
import { buildAnomalyDetail, detectAnomalies } from './lib/anomalies';
import { buildDicts, loadDataset } from './lib/data';
import type { RangePresetKey } from './lib/config';
import {
  aggFromSelection,
  buildContentIndex,
  buildFunnel,
  computeDeviceStatuses,
  crossSiteDedupeNote,
  dailySeries,
  deviceBreakdown,
  failureReasonDist,
  onlineSummary,
  rejectReasonDist,
  selectData,
  siteBreakdown,
  styleRejectDist,
} from './lib/metrics';
import { addDays, previousRange } from './lib/time';
import FilterBar from './components/FilterBar';
import KpiCards from './components/KpiCards';
import ActivitySection from './components/ActivitySection';
import QualitySection from './components/QualitySection';
import DeviceSection from './components/DeviceSection';
import AnomalySection from './components/AnomalySection';
import CaseSection from './components/CaseSection';
import MetricsNoteSection from './components/MetricsNoteSection';
import Drawer from './components/Drawer';
import AnomalyDetailPanel from './components/AnomalyDetailPanel';
import DeviceDrawer from './components/DeviceDrawer';
import { Badge, LoadingBlock, SkeletonCards } from './components/ui';

const NAV = [
  { href: '#sec-activity', label: '活动效果' },
  { href: '#sec-quality', label: 'AI 质量与审核' },
  { href: '#sec-device', label: '设备监控' },
  { href: '#sec-anomaly', label: '异常监控' },
  { href: '#sec-cases', label: '演示案例' },
  { href: '#sec-metrics', label: '指标口径' },
];

export default function App() {
  const [ds, setDs] = useState<Dataset | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [preset, setPreset] = useState<RangePresetKey | 'custom'>('30d');
  const [range, setRange] = useState<DateRange>({ startDate: '2026-09-12', endDate: '2026-10-11' });
  const [siteId, setSiteId] = useState('ALL');
  const [openAnomaly, setOpenAnomaly] = useState<Anomaly | null>(null);
  const [openDeviceId, setOpenDeviceId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadDataset()
      .then((data) => {
        if (cancelled) return;
        setDs(data);
        const end = data.meta.endDate;
        setRange({ startDate: addDays(end, -29), endDate: end });
        setLoadState('ready');
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setErrorMsg(e instanceof Error ? e.message : String(e));
        setLoadState('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handlePreset = useCallback(
    (p: RangePresetKey | 'custom') => {
      setPreset(p);
      if (p === 'custom' || !ds) return;
      const end = ds.meta.endDate;
      const days = p === 'today' ? 1 : p === '7d' ? 7 : 30;
      setRange({ startDate: addDays(end, -(days - 1)), endDate: end });
    },
    [ds],
  );

  const handleRangeChange = useCallback((r: DateRange) => {
    setRange(r);
    setPreset('custom');
  }, []);

  const handleReset = useCallback(() => {
    if (!ds) return;
    setSiteId('ALL');
    setPreset('30d');
    setRange({ startDate: addDays(ds.meta.endDate, -29), endDate: ds.meta.endDate });
  }, [ds]);

  const computed = useMemo(() => {
    if (!ds) return null;
    const index = buildContentIndex(ds.events);
    const filters = { range, siteId };
    const sel = selectData(ds, filters);
    const agg = aggFromSelection(sel, index);

    const prevRange = previousRange(range);
    const prevSel = selectData(ds, { range: prevRange, siteId });
    const prevAgg = aggFromSelection(prevSel, index);
    const hasPrevData = prevSel.participations.length + prevSel.tasks.length > 0;

    const daily = dailySeries(sel, index);
    const siteRows = siteBreakdown(ds, sel, index);
    const deviceRows = deviceBreakdown(ds, sel, index);
    const statuses = computeDeviceStatuses(ds, ds.heartbeats, siteId, sel);
    const online = onlineSummary(statuses);
    const dicts = buildDicts(ds.meta);
    const funnel = buildFunnel(agg);
    const failureRows = failureReasonDist(sel, dicts.failureReasons);
    const rejectRows = rejectReasonDist(sel, dicts.rejectReasons);
    const styleRows = styleRejectDist(sel, index, dicts.styles);
    const dedupeNote = crossSiteDedupeNote(sel);

    const ctx = {
      ds,
      sel,
      index,
      filters,
      statuses,
      deviceRows,
      heartbeats: ds.heartbeats,
      overallScanRate: agg.scanRate,
      dicts,
    };
    const anomalies = detectAnomalies(ctx);

    const hitRecords =
      sel.participations.length +
      sel.tasks.length +
      sel.contents.length +
      sel.scans.length +
      sel.shares.length;

    return {
      index,
      sel,
      agg,
      prevAgg,
      prevRange,
      hasPrevData,
      daily,
      siteRows,
      deviceRows,
      statuses,
      online,
      dicts,
      funnel,
      failureRows,
      rejectRows,
      styleRows,
      dedupeNote,
      ctx,
      anomalies,
      hitRecords,
    };
  }, [ds, range, siteId]);

  const deviceStatus = useMemo(
    () => (computed && openDeviceId ? computed.statuses.find((s) => s.device.id === openDeviceId) ?? null : null),
    [computed, openDeviceId],
  );

  const anomalyDetail = useMemo(
    () => (computed && openAnomaly ? buildAnomalyDetail(openAnomaly, computed.ctx) : null),
    [computed, openAnomaly],
  );

  if (loadState === 'loading') {
    return <LoadingBlock text="正在加载模拟数据（约 10MB 事件级数据，首次加载约 1-2 秒）…" />;
  }

  if (loadState === 'error' || !ds || !computed) {
    return (
      <div className="error-box">
        <h3 style={{ marginTop: 0 }}>数据加载失败</h3>
        <p style={{ color: 'var(--c-text-sub)', fontSize: 13 }}>{errorMsg}</p>
        <p style={{ fontSize: 13 }}>
          请先确认 <code>public/data/</code> 下存在模拟数据文件；若缺失，在项目根目录执行：
        </p>
        <pre style={{ background: '#f5f6f8', padding: 10, borderRadius: 6, fontSize: 12 }}>
          python3 scripts/generate_mock_data.py
        </pre>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <div className="container">
          <div className="header-main">
            <div className="brand">
              <div className="brand-logo">
                <MonitorPlay size={19} />
              </div>
              <div>
                <div className="brand-title">AIGC 互动大屏 · 运营数据看板</div>
                <div className="brand-sub">
                  {ds.sites.length} 个点位 · {ds.devices.length} 台设备 ·{' '}
                  {ds.meta.businessDays} 天模拟数据
                </div>
              </div>
            </div>
            <div className="header-meta">
              <span className="meta-chip mock">
                <ShieldAlert size={13} /> 模拟数据 · 非真实业务数据
              </span>
              <span className="meta-chip">
                <Database size={13} /> 事件记录{' '}
                {(
                  ds.meta.counts.participations +
                  ds.meta.counts.generationTasks +
                  ds.meta.counts.contents +
                  ds.meta.counts.scanEvents +
                  ds.meta.counts.shareEvents
                ).toLocaleString('zh-CN')}{' '}
                条
              </span>
              <span className="meta-chip">数据更新时间 {ds.meta.dataUpdateTime.replace('T', ' ')}</span>
              <span className="meta-chip">随机种子 {ds.meta.seed}</span>
            </div>
          </div>
          <nav className="nav">
            {NAV.map((n) => (
              <a key={n.href} href={n.href}>
                {n.label}
              </a>
            ))}
            <a href="#top" onClick={handleReset} style={{ color: 'var(--c-primary)' }}>
              <RefreshCw size={12} style={{ verticalAlign: -1 }} /> 重置
            </a>
          </nav>
        </div>
      </header>

      <main className="container" id="top">
        <FilterBar
          meta={ds.meta}
          preset={preset}
          onPreset={handlePreset}
          range={range}
          onRangeChange={handleRangeChange}
          siteId={siteId}
          onSiteChange={setSiteId}
          sites={ds.sites}
          onReset={handleReset}
          hitRecords={computed.hitRecords}
        />

        <div className="section">
          <div className="section-head">
            <h2 className="section-title">核心指标概览</h2>
            <p className="section-desc">
              对比上一可比周期：{computed.prevRange.startDate} ~ {computed.prevRange.endDate}
              {computed.hasPrevData ? '' : '（无可比数据）'}
            </p>
          </div>
          <KpiCards
            agg={computed.agg}
            prev={computed.prevAgg}
            prevRange={computed.prevRange}
            online={computed.online}
            dedupeNote={computed.dedupeNote}
            hasPrevData={computed.hasPrevData}
          />
        </div>

        <ActivitySection
          daily={computed.daily}
          funnel={computed.funnel}
          siteRows={computed.siteRows}
          onSelectSite={setSiteId}
          activeSiteId={siteId}
        />

        <QualitySection
          daily={computed.daily}
          failureRows={computed.failureRows}
          rejectRows={computed.rejectRows}
          styleRows={computed.styleRows}
          modStats={{
            pass: computed.agg.modPass,
            reject: computed.agg.modReject,
            pending: computed.agg.modPending,
          }}
          slowTaskRatio={computed.agg.slowTaskRatio}
          slowTaskCount={computed.agg.slowTaskCount}
          scopeLabel={ds.sites.find((s) => s.id === siteId)?.name ?? siteId}
          scopeIsAllSites={siteId === 'ALL'}
        />

        <DeviceSection
          statuses={computed.statuses}
          anomalies={computed.anomalies}
          heartbeats={ds.heartbeats}
          siteId={siteId}
          onOpenDevice={setOpenDeviceId}
        />

        <AnomalySection
          anomalies={computed.anomalies}
          onOpen={setOpenAnomaly}
          siteId={siteId}
          rangeLabel={`${range.startDate} ~ ${range.endDate}`}
        />

        <CaseSection
          onApply={(sid, r) => {
            setSiteId(sid);
            setRange(r);
            setPreset('custom');
          }}
        />

        <MetricsNoteSection />

        <div className="footer-note">
          本看板为招聘测评演示项目，全部数据由 <code>scripts/generate_mock_data.py</code> 以固定种子
          {ds.meta.seed} 生成，不含任何真实用户隐私信息。指标口径见 METRICS.md，AI 使用说明见 AI_USAGE.md。
        </div>
      </main>

      <Drawer
        open={openAnomaly !== null}
        title={openAnomaly ? `${openAnomaly.ruleId} ${openAnomaly.ruleName}` : ''}
        subtitle={openAnomaly ? `${openAnomaly.siteName ?? '—'} · ${openAnomaly.periodLabel}` : ''}
        badge={
          openAnomaly ? (
            <Badge
              tone={
                openAnomaly.severity === '严重' ? 'danger' : openAnomaly.severity === '高' ? 'warn' : 'primary'
              }
            >
              {openAnomaly.severity}
            </Badge>
          ) : null
        }
        onClose={() => setOpenAnomaly(null)}
      >
        {openAnomaly && anomalyDetail ? (
          <AnomalyDetailPanel
            anomaly={openAnomaly}
            detail={anomalyDetail}
            onFocusSite={(sid) => {
              setSiteId(sid);
              setOpenAnomaly(null);
            }}
            onFocusDevice={(did) => {
              setOpenAnomaly(null);
              setOpenDeviceId(did);
            }}
          />
        ) : (
          <SkeletonCards count={1} />
        )}
      </Drawer>

      <Drawer
        open={deviceStatus !== null}
        title={deviceStatus ? `设备详情 ${deviceStatus.device.id}` : ''}
        subtitle={deviceStatus ? `${deviceStatus.siteName} · ${deviceStatus.device.model}` : ''}
        badge={
          deviceStatus ? (
            <Badge tone={deviceStatus.online ? 'success' : 'danger'}>
              {deviceStatus.online ? '在线' : '离线'}
            </Badge>
          ) : null
        }
        onClose={() => setOpenDeviceId(null)}
      >
        {deviceStatus ? (
          <DeviceDrawer
            status={deviceStatus}
            heartbeats={ds.heartbeats}
            anomalies={computed.anomalies}
            onOpenAnomaly={(a) => {
              setOpenDeviceId(null);
              setOpenAnomaly(a);
            }}
          />
        ) : null}
      </Drawer>
    </div>
  );
}
