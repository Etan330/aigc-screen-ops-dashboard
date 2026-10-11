import { useState } from 'react';
import { BookOpen, ChevronDown, ChevronUp } from 'lucide-react';
import { THRESHOLDS } from '../lib/config';

const ROWS: { name: string; def: string; formula: string; note: string }[] = [
  {
    name: '参与人数',
    def: '统计期内发起参与事件的去重用户数',
    formula: 'count(distinct userId where 参与事件在区间内)',
    note: '跨点位重复用户只计一次；各点位独立去重之和与全局去重的差额为跨点位重复人数',
  },
  {
    name: 'AI 生成成功率',
    def: '成功生成任务占已完成生成尝试的比例',
    formula: '成功任务数 / (成功 + 失败)；生成中(pending)不计入分母',
    note: '失败原因分为超时 / 服务异常 / 参数异常 / 输入图像质量，属于技术链路问题',
  },
  {
    name: '平均生成时长',
    def: '成功任务生成耗时的算术平均值',
    formula: 'mean(durationMs where status = success)',
    note: '同时展示 P95 与超 15s 任务占比，用于识别长尾而非只看均值',
  },
  {
    name: '内容审核通过率',
    def: '审核通过内容占已完成审核内容的比例',
    formula: '通过数 / (通过 + 拒绝)；待审核不计入分母',
    note: '拒绝原因属于内容治理问题，与生成失败分开统计',
  },
  {
    name: '扫码转化率',
    def: '发生至少一次扫码的有效内容占比',
    formula: '去重扫码内容数 / 可扫码有效内容数',
    note: '有效内容 = 生成成功且审核通过；同一内容多次扫码只计一次',
  },
  {
    name: '分享转化率',
    def: '发生至少一次成功分享的有效内容占比',
    formula: '去重成功分享内容数 / 可分享有效内容数',
    note: '分享失败（用户取消 / 平台限制）不计入分子',
  },
  {
    name: '设备在线率',
    def: '最近 5 分钟内有有效心跳的设备占比',
    formula: `心跳距基准时间 ≤ ${THRESHOLDS.heartbeatStaleMinutes} 分钟的设备数 / 设备总数`,
    note: '实时口径，相对模拟数据基准时间计算，不随历史日期筛选变化',
  },
];

export default function MetricsNoteSection() {
  const [open, setOpen] = useState(false);
  return (
    <div className="section" id="sec-metrics">
      <div className="card">
        <div className="card-head">
          <div>
            <h3 className="card-title">
              <BookOpen size={14} /> 指标口径与边界说明
            </h3>
            <p className="card-sub">
              所有指标均从同一套事件级原始数据派生；时间归属：参与与生成按事件自身日期，
              内容 / 审核 / 扫码 / 分享统一归因到内容生成日
            </p>
          </div>
          <button className="btn" onClick={() => setOpen(!open)}>
            {open ? '收起' : '展开明细'}
            {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        </div>
        {open ? (
          <div className="card-body" style={{ padding: 0 }}>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: 140 }}>指标</th>
                    <th style={{ width: 260 }}>业务定义</th>
                    <th style={{ width: 300 }}>计算公式</th>
                    <th>边界与说明</th>
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map((r) => (
                    <tr key={r.name}>
                      <td style={{ fontWeight: 600 }}>{r.name}</td>
                      <td style={{ whiteSpace: 'normal' }}>{r.def}</td>
                      <td style={{ whiteSpace: 'normal' }}>{r.formula}</td>
                      <td style={{ whiteSpace: 'normal', color: 'var(--c-text-sub)' }}>{r.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
