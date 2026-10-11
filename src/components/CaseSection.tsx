import { Crosshair, Filter, SearchCheck } from 'lucide-react';
import type { DateRange } from '../types';

export interface CaseItem {
  id: string;
  title: string;
  tag: string;
  symptom: string;
  evidence: string[];
  hypotheses: string[];
  actions: string[];
  target: { siteId: string; range: DateRange; hint: string };
}

export const DEMO_CASES: CaseItem[] = [
  {
    id: 'CASE-A',
    title: '案例 A：某点位 AI 生成失败率上升',
    tag: '北京·朝阳大悦城 · 2026-10-02 ~ 10-05',
    symptom:
      '该点位「AI 生成成功率」连续多日低于 90% 阈值，失败任务集中在同一台设备；同点位另一台设备同期基本正常。',
    evidence: [
      '异常监控 R1：点位·日粒度触发 4 条成功率告警，实际值 68.8%~79.2%，样本量 64~123 次已完成生成尝试。',
      '异常详情「各设备生成成功率」对比：DEV-03 约 57.6%，同点位 DEV-04 约 97.0%。',
      '异常详情「失败原因分布」：以「模型推理超时」为主（67 次），而不是请求参数异常（5 次）。',
      '设备详情中心跳时间线：DEV-03 在 2026-10-02 14:05-15:20 出现心跳缺失（约 75 分钟）。',
    ],
    hypotheses: [
      '待验证假设：DEV-03 的网络链路不稳定或边缘节点与模型服务之间的往返时延升高，导致批量推理超时。',
      '待验证假设：该点位在国庆客流高峰触发并发限流，请求排队后被服务端超时放弃。',
      '尚未证实：以上均需设备日志与服务端监控交叉验证，不能仅凭看板判定为根因。',
    ],
    actions: [
      '将 DEV-03 置为观察对象，通知技术运维核查该设备的网络质量与边缘节点状态；必要时临时下线并分流到 DEV-04。',
      '同步给服务端：确认该时段模型服务是否有扩容不足或超时配置过短；若是，调整超时阈值或限流策略。',
      '核查该点位国庆期间是否做了参数模板变更，必要时回滚。',
      '处置后复核 10-06 起成功率是否回到 95% 以上，确认措施有效。',
    ],
    target: {
      siteId: 'SITE-02',
      range: { startDate: '2026-10-02', endDate: '2026-10-05' },
      hint: '筛选后查看「AI 生成质量」的成功率趋势、失败原因分布，再到「设备监控」打开 DEV-03。',
    },
  },
  {
    id: 'CASE-B',
    title: '案例 B：某点位参与量高，但扫码 / 分享转化低',
    tag: '深圳·欢乐海岸 · 2026-09-12 ~ 10-11',
    symptom:
      '该点位活动投放后参与人数升至全网点位前列，但扫码转化率显著低于大盘，分享转化率同步偏低。',
    evidence: [
      '点位明细：参与人数排名第 1（1,400+ 人），但扫码转化率 21.4% 明显低于全网点位（30%~38%）。',
      '异常监控 R5：DEV-12 触发「扫码转化率显著低于大盘」告警（7.5%，大盘 31.1%）。',
      '异常详情「各设备扫码转化率」对比：同点位 DEV-11 为 32.3% / 分享 22.6%，DEV-12 为 7.5% / 分享 5.8%，差异集中在设备而非点位。',
      '该点位生成成功率与审核通过率正常，说明问题不在 AI 生成或审核链路。',
    ],
    hypotheses: [
      '待验证假设：DEV-12 屏幕二维码展示异常（尺寸、位置、亮度或被遮挡），用户未看到或未成功扫描。',
      '待验证假设：DEV-12 位于人流快速通过的位置，停留意愿低于 DEV-11。',
      '待验证假设：扫码后落地页在该设备上加载慢或失败（需服务端埋点验证，当前模拟数据无法证实）。',
      '尚未证实：以上均需现场巡检与服务端数据交叉验证。',
    ],
    actions: [
      '现场巡检 DEV-12 的二维码展示与引导文案，与 DEV-11 做 A/B 对照（尺寸、位置、话术、示例图）。',
      '抽取 DEV-12 的生成内容人工查看成图质量，确认是否存在画质或风格偏好问题。',
      '联合服务端核对 DEV-12 扫码后的落地页加载成功率与耗时。',
      '若整改后扫码率仍无提升，考虑调整点位内设备布局或将活动主推位迁移到 DEV-11。',
    ],
    target: {
      siteId: 'SITE-06',
      range: { startDate: '2026-09-12', endDate: '2026-10-11' },
      hint: '筛选后查看「活动效果」的点位明细与设备级扫码率，再到「异常监控」打开 R5 告警详情。',
    },
  },
];

export interface CaseSectionProps {
  onApply: (siteId: string, range: DateRange) => void;
}

export default function CaseSection({ onApply }: CaseSectionProps) {
  return (
    <div className="section" id="sec-cases">
      <div className="section-head">
        <h2 className="section-title">
          <span className="idx">5</span> 运营决策演示案例
        </h2>
        <p className="section-desc">异常现象 → 数据证据 → 可能原因（假设）→ 运营动作；点击按钮一键复现筛选</p>
      </div>

      <div className="grid-2">
        {DEMO_CASES.map((c) => (
          <div className="case-card" key={c.id}>
            <div className="case-head">
              <h3 className="case-title">
                <Crosshair size={15} color="var(--c-primary)" />
                {c.title}
              </h3>
              <span className="badge gray">{c.tag}</span>
            </div>

            <div className="case-steps">
              <div className="case-step">
                <span className="tag">异常现象</span>
                <span>{c.symptom}</span>
              </div>
              <div className="case-step">
                <span className="tag evidence">数据证据</span>
                <ul className="hypo-list" style={{ margin: 0 }}>
                  {c.evidence.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
              <div className="case-step">
                <span className="tag hypo">可能原因</span>
                <ul className="hypo-list" style={{ margin: 0 }}>
                  {c.hypotheses.map((h, i) => (
                    <li key={i}>{h}</li>
                  ))}
                </ul>
              </div>
              <div className="case-step">
                <span className="tag action">运营动作</span>
                <ol className="action-list" style={{ margin: 0 }}>
                  {c.actions.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ol>
              </div>
            </div>

            <div className="case-actions">
              <button className="btn primary" onClick={() => onApply(c.target.siteId, c.target.range)}>
                <Filter size={13} /> 一键复现筛选
              </button>
              <span style={{ fontSize: 12, color: 'var(--c-text-sub)', alignSelf: 'center' }}>
                <SearchCheck size={12} style={{ verticalAlign: -2, marginRight: 4 }} />
                {c.target.hint}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
