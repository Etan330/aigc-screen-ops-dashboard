/**
 * 数据模型定义
 *
 * 全链路关联关系：
 *   siteId（点位） -> deviceId（设备） -> userId（匿名参与用户）
 *   -> eventId（参与事件） -> taskId（生成任务） -> contentId（内容）
 *   -> 审核结果（按 contentId） -> 扫码 / 分享事件（按 contentId）
 */

export interface Site {
  id: string;
  name: string;
  city: string;
  type: string;
  deviceIds: string[];
  openedAt: string;
}

export interface Device {
  id: string;
  siteId: string;
  model: string;
  screenSizeInch: number;
  installDate: string;
}

export type TaskStatus = 'success' | 'failed' | 'pending';
export type ModerationStatus = 'pass' | 'reject' | 'pending';
export type ShareStatus = 'success' | 'failed';

export interface ParticipationEvent {
  eventId: string;
  ts: string;
  siteId: string;
  deviceId: string;
  userId: string;
}

export interface GenerationTask {
  taskId: string;
  ts: string;
  siteId: string;
  deviceId: string;
  userId: string;
  styleId: string;
  status: TaskStatus;
  /** 成功任务的生成耗时（毫秒）；失败 / 生成中为 null */
  durationMs: number | null;
  /** 失败原因编码；仅 status = failed 时有值 */
  failureReason: string | null;
}

export interface Content {
  contentId: string;
  taskId: string;
  ts: string;
  siteId: string;
  deviceId: string;
  styleId: string;
}

export interface Moderation {
  contentId: string;
  ts: string;
  status: ModerationStatus;
  rejectReason: string | null;
}

export interface ScanEvent {
  eventId: string;
  ts: string;
  contentId: string;
  siteId: string;
  deviceId: string;
}

export interface ShareEvent {
  eventId: string;
  ts: string;
  contentId: string;
  siteId: string;
  deviceId: string;
  status: ShareStatus;
  failReason: string | null;
}

export interface Events {
  participations: ParticipationEvent[];
  generationTasks: GenerationTask[];
  contents: Content[];
  moderations: Moderation[];
  scans: ScanEvent[];
  shares: ShareEvent[];
}

export interface Heartbeats {
  baselineTime: string;
  intervalMinutes: number;
  operatingHours: string;
  byDevice: Record<string, string[]>;
}

export interface MetaDictItem {
  id: string;
  name: string;
}

export interface MetaAnomalyScenario {
  id: string;
  name: string;
  siteId: string | null;
  deviceId: string | null;
  window: [string, string];
  evidence: string;
}

export interface Meta {
  datasetName: string;
  seed: number;
  timezone: string;
  baselineTime: string;
  dataUpdateTime: string;
  businessDays: number;
  startDate: string;
  endDate: string;
  heartbeat: {
    retentionDays: number;
    intervalMinutes: number;
    operatingHours: string;
  };
  counts: Record<string, number>;
  dictionaries: {
    styles: MetaDictItem[];
    failureReasons: MetaDictItem[];
    rejectReasons: MetaDictItem[];
    taskStatus: string[];
    moderationStatus: string[];
    shareStatus: string[];
  };
  anomalyScenarios: MetaAnomalyScenario[];
  notes: string[];
}

export interface Dataset {
  sites: Site[];
  devices: Device[];
  events: Events;
  heartbeats: Heartbeats;
  meta: Meta;
}

export interface DateRange {
  /** 含首日，格式 YYYY-MM-DD */
  startDate: string;
  /** 含末日，格式 YYYY-MM-DD */
  endDate: string;
}

export interface Filters {
  range: DateRange;
  /** 'ALL' 表示全部点位 */
  siteId: string;
}
