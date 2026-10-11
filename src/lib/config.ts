/**
 * 演示用异常阈值与展示配置
 *
 * ⚠️ 这里的阈值是「演示规则」，不是业务铁律。
 * 调整下面的常量即可改变异常识别结果，前端「阈值说明」区域会同步展示这里的取值。
 */

export const THRESHOLDS = {
  /** 规则 R1：点位·日 生成成功率下限 */
  genSuccessRateMin: 0.9,
  /** 规则 R1：最小样本量（当日已完成生成尝试次数） */
  genSuccessRateMinSamples: 20,

  /** 规则 R2：点位·日 平均生成时长上限（秒） */
  avgDurationMaxSec: 15,
  /** 规则 R2：最小样本量（当日成功任务数） */
  avgDurationMinSamples: 20,

  /** 规则 R3：点位·日 内容审核拒绝率上限 */
  rejectRateMax: 0.1,
  /** 规则 R3：最小样本量（当日已审核内容数） */
  rejectRateMinSamples: 20,

  /** 规则 R4：设备心跳超时判定（分钟），以 mock 数据基准时间为参照 */
  heartbeatStaleMinutes: 5,

  /** 规则 R5（扩展）：设备扫码转化率低于大盘的倍率 */
  scanRateDropRatio: 0.5,
  /** 规则 R5：最小样本量（该设备可扫码有效内容数） */
  scanRateMinSamples: 30,
} as const;

/** 严重度分档（超过该值升级为「严重」） */
export const SEVERITY_ESCALATION = {
  genSuccessRateCritical: 0.8,
  avgDurationCriticalSec: 25,
  rejectRateCritical: 0.2,
  heartbeatStaleCriticalMinutes: 60,
} as const;

export const COLORS = {
  primary: '#2F5BE3',
  primarySoft: '#E8EEFD',
  success: '#17A673',
  successSoft: '#E3F6EE',
  danger: '#E0483C',
  dangerSoft: '#FDECEA',
  warn: '#E08A1E',
  warnSoft: '#FDF3E3',
  purple: '#7A5AF8',
  purpleSoft: '#EEEBFE',
  gray: '#8A9099',
  graySoft: '#F1F3F5',
  text: '#1F2329',
  textSub: '#646A73',
  border: '#E5E8EC',
  bg: '#F5F6F8',
  card: '#FFFFFF',
} as const;

/** 图表配色序列 */
export const CHART_COLORS = [
  '#2F5BE3',
  '#17A673',
  '#E0483C',
  '#E08A1E',
  '#7A5AF8',
  '#0FA3B1',
  '#B5569E',
  '#5B6673',
];

/** 状态 / 原因到配色的映射 */
export const STATUS_COLORS: Record<string, string> = {
  success: COLORS.success,
  failed: COLORS.danger,
  pending: COLORS.gray,
  pass: COLORS.success,
  reject: COLORS.danger,
  online: COLORS.success,
  offline: COLORS.danger,
};

export const SEVERITY_META: Record<
  string,
  { label: string; color: string; bg: string; order: number }
> = {
  严重: { label: '严重', color: COLORS.danger, bg: COLORS.dangerSoft, order: 0 },
  高: { label: '高', color: COLORS.warn, bg: COLORS.warnSoft, order: 1 },
  中: { label: '中', color: COLORS.primary, bg: COLORS.primarySoft, order: 2 },
};

/** 日期快捷选项 */
export const RANGE_PRESETS = [
  { key: 'today', label: '今日', days: 1 },
  { key: '7d', label: '近 7 天', days: 7 },
  { key: '30d', label: '近 30 天', days: 30 },
] as const;

export type RangePresetKey = (typeof RANGE_PRESETS)[number]['key'];
