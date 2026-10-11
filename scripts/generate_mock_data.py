#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AIGC 互动大屏运营看板 —— 模拟数据生成脚本

设计原则
--------
1. 固定随机种子（SEED），同一份脚本多次运行产出完全一致，可复现。
2. 事件级数据，ID 全链路可关联：
   点位 siteId -> 设备 deviceId -> 参与用户 userId -> 参与事件 eventId
                -> 生成任务 taskId -> 内容 contentId -> 审核结果 -> 扫码/分享事件
3. 内置异常在原始数据中存在真实证据（失败原因耗时、拒绝原因、心跳中断），
   不在 UI 层编造；异常场景登记在 meta.anomalyScenarios 中便于核验。
4. 不使用任何真实用户隐私信息，用户 ID 仅为匿名编号。
5. 所有时间戳为 Asia/Shanghai（UTC+8）本地时间，写入格式 YYYY-MM-DDTHH:MM:SS。

产出（写入 public/data/）
------------------------
mock_sites.json      点位维度表
mock_devices.json    设备维度表
mock_events.json     事件事实表（参与 / 生成任务 / 内容 / 审核 / 扫码 / 分享）
mock_heartbeats.json 设备心跳（按设备分组的时间戳数组）
mock_meta.json       数据元信息：基准时间、种子、口径、注入的异常场景
"""

import json
import math
import os
import random
from datetime import datetime, timedelta

# ----------------------------------------------------------------------------
# 全局参数
# ----------------------------------------------------------------------------
SEED = 20261011
BASELINE = datetime(2026, 10, 11, 20, 0, 0)   # 模拟数据基准时间（"当前时刻"）
DAYS = 60                                     # 业务数据天数（含基准日）
HEARTBEAT_DAYS = 15                           # 心跳保留天数
HEARTBEAT_INTERVAL_MIN = 5                    # 心跳间隔（分钟）
OP_START, OP_END = 9, 30                      # 运营时段 09:30
OP_END_H, OP_END_M = 22, 0                    # 运营时段 22:00

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(os.path.dirname(SCRIPT_DIR), "public", "data")

rng = random.Random(SEED)

# ----------------------------------------------------------------------------
# 维度数据
# ----------------------------------------------------------------------------
SITES = [
    # id, 名称, 城市, 类型, 日均参与基数, 扫码率, 分享率
    ("SITE-01", "上海·静安嘉里中心", "上海", "商场", 32, 0.38, 0.22),
    ("SITE-02", "北京·朝阳大悦城", "北京", "商场", 30, 0.35, 0.20),
    ("SITE-03", "成都·远洋太古里", "成都", "商场", 27, 0.33, 0.19),
    ("SITE-04", "杭州·西湖断桥",   "杭州", "景区", 25, 0.30, 0.24),
    ("SITE-05", "广州·正佳广场",   "广州", "商场", 29, 0.36, 0.21),
    ("SITE-06", "深圳·欢乐海岸",   "深圳", "景区", 28, 0.34, 0.23),
]

DEVICES = [
    # id, siteId, 型号, 屏幕尺寸, 安装日期
    ("DEV-01", "SITE-01", "AIGC-PRO-55", 55, "2026-03-12"),
    ("DEV-02", "SITE-01", "AIGC-PRO-55", 55, "2026-03-12"),
    ("DEV-03", "SITE-02", "AIGC-PRO-65", 65, "2026-04-08"),
    ("DEV-04", "SITE-02", "AIGC-LITE-43", 43, "2026-04-08"),
    ("DEV-05", "SITE-03", "AIGC-PRO-55", 55, "2026-05-20"),
    ("DEV-06", "SITE-03", "AIGC-LITE-43", 43, "2026-05-20"),
    ("DEV-07", "SITE-04", "AIGC-OUT-75", 75, "2026-06-01"),
    ("DEV-08", "SITE-04", "AIGC-OUT-75", 75, "2026-06-01"),
    ("DEV-09", "SITE-05", "AIGC-PRO-65", 65, "2026-06-18"),
    ("DEV-10", "SITE-05", "AIGC-PRO-55", 55, "2026-06-18"),
    ("DEV-11", "SITE-06", "AIGC-OUT-75", 75, "2026-07-03"),
    ("DEV-12", "SITE-06", "AIGC-LITE-43", 43, "2026-07-03"),
]

STYLES = [
    ("STYLE_INK", "水墨国风"),
    ("STYLE_CYBER", "赛博朋克"),
    ("STYLE_ANIME", "日系动漫"),
    ("STYLE_FANTASY", "奇幻光影"),
    ("STYLE_PORTRAIT", "质感肖像"),
    ("STYLE_TRAVEL", "旅行海报"),
]
# 各点位风格偏好权重（顺序与 STYLES 一致）
STYLE_WEIGHTS = {
    "SITE-01": [16, 18, 14, 10, 22, 20],
    "SITE-02": [14, 20, 16, 12, 20, 18],
    "SITE-03": [20, 14, 18, 12, 18, 18],
    "SITE-04": [26, 8, 10, 10, 12, 34],
    "SITE-05": [14, 16, 20, 14, 18, 18],
    "SITE-06": [12, 18, 18, 18, 14, 20],
}

FAILURE_REASONS = [
    ("MODEL_TIMEOUT", "模型推理超时", 0.36),
    ("MODEL_SERVICE_ERROR", "模型服务异常", 0.30),
    ("INVALID_PARAM", "请求参数异常", 0.19),
    ("INPUT_IMAGE_QUALITY", "输入图像质量不合格", 0.15),
]
# 生成失败时的原因权重：正常情况下 vs 注入的"模型推理超时"场景
FAILURE_WEIGHTS_NORMAL = [0.36, 0.30, 0.19, 0.15]
FAILURE_WEIGHTS_TIMEOUT = [0.78, 0.12, 0.05, 0.05]

REJECT_REASONS = [
    ("ILLEGAL_IMAGE", "违规图像", 0.44),
    ("SENSITIVE_TEXT", "敏感内容", 0.30),
    ("PORTRAIT_RIGHTS", "肖像/版权风险", 0.16),
    ("OTHER", "其他", 0.10),
]
REJECT_WEIGHTS_NORMAL = [0.44, 0.30, 0.16, 0.10]
REJECT_WEIGHTS_FANTASY = [0.52, 0.26, 0.14, 0.08]

# ----------------------------------------------------------------------------
# 注入的异常场景（在原始数据中留下证据）
# ----------------------------------------------------------------------------
ANOMALY_SCENARIOS = [
    {
        "id": "SCEN-01",
        "name": "某点位生成失败率上升（模型推理超时）",
        "siteId": "SITE-02",
        "deviceId": "DEV-03",
        "window": ["2026-10-02", "2026-10-05"],
        "evidence": "该窗口内 DEV-03 任务失败率约 42%（198 次已完成尝试中失败 84 次，同点位 DEV-04 成功率 97%）；点位日均成功率降到 69%~79%；失败原因以 MODEL_TIMEOUT 为主；同期 DEV-03 心跳在 14:05-15:20 中断。",
    },
    {
        "id": "SCEN-02",
        "name": "某点位平均生成时长显著变慢",
        "siteId": "SITE-04",
        "deviceId": "DEV-07 / DEV-08",
        "window": ["2026-10-06", "2026-10-08"],
        "evidence": "该窗口内 SITE-04 两台户外机成功任务耗时中位数由 ~5.2s 抬升至 ~16s，点位日均值超过 15s（原始数据 durationMs 直接可见）。",
    },
    {
        "id": "SCEN-03",
        "name": "某点位内容审核拒绝率上升（集中在单一风格）",
        "siteId": "SITE-05",
        "deviceId": None,
        "window": ["2026-10-07", "2026-10-10"],
        "evidence": "该窗口内 SITE-05 审核拒绝率显著高于基线，且几乎全部集中在 STYLE_FANTASY 风格（该风格拒绝率约 55%，同点位其他风格约 7%）；活动期间该点位主推该风格，曝光权重 ×3，样本量足以支撑对比。",
    },
    {
        "id": "SCEN-04",
        "name": "设备离线（心跳超时）",
        "siteId": None,
        "deviceId": "DEV-04 / DEV-10",
        "window": ["2026-10-11", "2026-10-11"],
        "evidence": "DEV-04 最后心跳距基准时间约 45 分钟，DEV-10 距基准时间约 3 小时 15 分钟；心跳数组在对应时点后无任何记录。",
    },
    {
        "id": "SCEN-05",
        "name": "点位参与量高但扫码/分享转化低",
        "siteId": "SITE-06",
        "deviceId": "DEV-12",
        "window": ["2026-09-12", "2026-10-11"],
        "evidence": "SITE-06 自 09-12 起投放活动，参与量升至全网点位第 1；但 DEV-12 的扫码率仅约 7%、分享率约 5%，同点位 DEV-11 分别为 ~33% / ~22%。",
    },
]

# 便于查询的注入参数
GEN_FAIL_WINDOW = {  # 生成失败率上升
    "site": "SITE-02", "device": "DEV-03",
    "start": datetime(2026, 10, 2), "end": datetime(2026, 10, 5),
    "fail_rate": 0.48,
}
SLOW_WINDOW = {  # 生成变慢：景区点位户外机共用边缘节点/网络出口，全点位抬升
    "site": "SITE-04", "device": None,
    "start": datetime(2026, 10, 6), "end": datetime(2026, 10, 8),
    "dur_mult": 3.2,
}
REJECT_WINDOW = {  # 审核拒绝率上升
    "site": "SITE-05",
    "start": datetime(2026, 10, 7), "end": datetime(2026, 10, 10),
    # 活动期间该点位主推「奇幻光影」风格（曝光权重 ×3），因此该风格样本量足够大
    "base_reject": 0.07, "fantasy_reject": 0.55, "style": "STYLE_FANTASY",
    "style_weight_mult": 3,
}
CAMPAIGN = {  # SITE-06 活动投放（参与量抬升）
    "site": "SITE-06", "start": datetime(2026, 9, 12), "mult": 1.7,
}
LOW_CONVERT_DEVICE = {  # 扫码/分享转化异常低的设备
    "device": "DEV-12", "start": datetime(2026, 9, 5),
    "scan_mult": 0.21, "share_mult": 0.26,
}
NATIONAL_DAY = (datetime(2026, 10, 1), datetime(2026, 10, 7))  # 国庆假期流量抬升

# 设备心跳停止时间（None 表示正常在线）
DEVICE_LAST_HEARTBEAT = {
    "DEV-04": BASELINE - timedelta(minutes=42),
    "DEV-10": BASELINE - timedelta(hours=3, minutes=12),
}
# DEV-03 在 2026-10-02 14:05-15:20 心跳中断（配合 SCEN-01 的网络/服务假设）
HEARTBEAT_GAPS = [
    ("DEV-03", datetime(2026, 10, 2, 14, 5), datetime(2026, 10, 2, 15, 20)),
]

# ----------------------------------------------------------------------------
# 工具函数
# ----------------------------------------------------------------------------
TS_FMT = "%Y-%m-%dT%H:%M:%S"


def ts(dt_obj: datetime) -> str:
    return dt_obj.strftime(TS_FMT)


def weighted_pick(options, weights):
    return rng.choices(options, weights=weights, k=1)[0]


def clamp_dt(dt_obj: datetime) -> datetime:
    if dt_obj > BASELINE:
        return BASELINE - timedelta(seconds=1)
    return dt_obj


HOURS = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]
HOUR_WEIGHTS = [0.55, 0.80, 1.00, 1.05, 1.15, 1.25, 1.30, 1.45, 1.55, 1.50, 1.15, 0.60]


def sample_participation_time(date: datetime, is_last_day: bool) -> datetime:
    """按营业时段与客流高峰采样参与时间"""
    hours, weights = HOURS, HOUR_WEIGHTS
    if is_last_day:
        # 基准日为 20:00，只保留 10:00-19:59 的时段
        hours, weights = HOURS[:10], HOUR_WEIGHTS[:10]
    hour = weighted_pick(hours, weights)
    minute = rng.randint(0, 59)
    second = rng.randint(0, 59)
    return datetime(date.year, date.month, date.day, hour, minute, second)


def sample_duration(mult: float = 1.0, retry: int = 0) -> int:
    """生成耗时（毫秒）。对数正态，中位约 5.2s；重试略慢"""
    base = rng.lognormvariate(math.log(5200), 0.32)
    value = base * mult * (1.0 + 0.18 * retry)
    return int(min(60000, max(1100, value)))


# ----------------------------------------------------------------------------
# ID 序列
# ----------------------------------------------------------------------------
seq = {"p": 0, "t": 0, "c": 0, "s": 0, "sh": 0}


def next_id(kind: str) -> str:
    seq[kind] += 1
    prefix = {"p": "P", "t": "T", "c": "C", "s": "SC", "sh": "SH"}[kind]
    width = {"p": 7, "t": 7, "c": 7, "s": 7, "sh": 7}[kind]
    return f"{prefix}{seq[kind]:0{width}d}"


# 用户池：每个点位本地池 + 全网点位共享的"流动游客池"，用于产生跨点位重复用户
LOCAL_POOL_SIZE = 2400
TOURIST_POOL_SIZE = 900


def sample_user(site_idx: int) -> str:
    if rng.random() < 0.25:
        return f"T-{rng.randint(1, TOURIST_POOL_SIZE):04d}"   # 跨点位重复用户
    return f"U{site_idx + 1}-{rng.randint(1, LOCAL_POOL_SIZE):05d}"


def device_of_site(site_id: str):
    return [d for d in DEVICES if d[1] == site_id]


# ----------------------------------------------------------------------------
# 生成业务事件
# ----------------------------------------------------------------------------
participations = []
tasks = []
contents = []
moderations = []
scans = []
shares = []

start_date = (BASELINE - timedelta(days=DAYS - 1)).replace(hour=0, minute=0, second=0, microsecond=0)

for day_offset in range(DAYS):
    date = start_date + timedelta(days=day_offset)
    is_last_day = date.date() == BASELINE.date()
    is_weekend = date.weekday() >= 5

    for site_idx, (site_id, site_name, city, site_type, base_traffic, scan_p, share_p) in enumerate(SITES):
        devices = device_of_site(site_id)
        traffic = float(base_traffic)

        if is_weekend:
            traffic *= 1.70
        if NATIONAL_DAY[0] <= date <= NATIONAL_DAY[1]:
            traffic *= 1.60
        if site_id == CAMPAIGN["site"] and date >= CAMPAIGN["start"]:
            traffic *= CAMPAIGN["mult"]
        if site_id == "SITE-03":
            traffic *= 0.92          # 该点位客流自然回落
        traffic *= rng.uniform(0.85, 1.15)
        if is_last_day:
            traffic *= 0.55          # 基准日只统计到 20:00

        n_participants = max(4, int(round(traffic)))

        for _ in range(n_participants):
            p_time = sample_participation_time(date, is_last_day)
            if p_time >= BASELINE:
                continue
            user_id = sample_user(site_idx)
            dev_id = weighted_pick([d[0] for d in devices], [1.0] * len(devices))
            participation_id = next_id("p")
            participations.append({
                "eventId": participation_id,
                "ts": ts(p_time),
                "siteId": site_id,
                "deviceId": dev_id,
                "userId": user_id,
            })

            # ---------------- 生成任务（1~3 次尝试，含重试） ----------------
            n_attempts = weighted_pick([1, 2, 3], [0.70, 0.21, 0.09])
            task_time = p_time
            for attempt in range(n_attempts):
                task_time = clamp_dt(task_time + timedelta(seconds=rng.randint(8, 45)))
                task_id = next_id("t")
                style_weights = STYLE_WEIGHTS[site_id]
                if (
                    site_id == REJECT_WINDOW["site"]
                    and REJECT_WINDOW["start"] <= date <= REJECT_WINDOW["end"]
                ):
                    # 活动期间主推该风格，曝光权重抬升
                    style_ids = [s[0] for s in STYLES]
                    w = list(style_weights)
                    w[style_ids.index(REJECT_WINDOW["style"])] *= REJECT_WINDOW["style_weight_mult"]
                    style_weights = w
                style_id = weighted_pick([s[0] for s in STYLES], style_weights)
                in_fail_window = (
                    site_id == GEN_FAIL_WINDOW["site"]
                    and dev_id == GEN_FAIL_WINDOW["device"]
                    and GEN_FAIL_WINDOW["start"] <= date <= GEN_FAIL_WINDOW["end"]
                )
                in_slow_window = (
                    site_id == SLOW_WINDOW["site"]
                    and (SLOW_WINDOW["device"] is None or dev_id == SLOW_WINDOW["device"])
                    and SLOW_WINDOW["start"] <= date <= SLOW_WINDOW["end"]
                )

                # 生成中（pending）：只在基准日最近 30 分钟内出现，无耗时、不计入成功率分母
                if is_last_day and (BASELINE - task_time) < timedelta(minutes=30) and rng.random() < 0.09:
                    tasks.append({
                        "taskId": task_id,
                        "ts": ts(task_time),
                        "siteId": site_id,
                        "deviceId": dev_id,
                        "userId": user_id,
                        "styleId": style_id,
                        "status": "pending",
                        "durationMs": None,
                        "failureReason": None,
                    })
                    break

                fail_p = 0.025
                if in_fail_window:
                    fail_p = GEN_FAIL_WINDOW["fail_rate"]
                elif dev_id in ("DEV-06", "DEV-08"):
                    fail_p = 0.04      # 两台设备基线略差

                is_success = rng.random() > fail_p
                duration_mult = SLOW_WINDOW["dur_mult"] if in_slow_window else 1.0

                if is_success:
                    duration_ms = sample_duration(duration_mult, attempt)
                    tasks.append({
                        "taskId": task_id,
                        "ts": ts(task_time),
                        "siteId": site_id,
                        "deviceId": dev_id,
                        "userId": user_id,
                        "styleId": style_id,
                        "status": "success",
                        "durationMs": duration_ms,
                        "failureReason": None,
                    })

                    # ---------------- 内容 + 审核 ----------------
                    content_id = next_id("c")
                    create_time = clamp_dt(task_time + timedelta(milliseconds=duration_ms))
                    contents.append({
                        "contentId": content_id,
                        "taskId": task_id,
                        "ts": ts(create_time),
                        "siteId": site_id,
                        "deviceId": dev_id,
                        "styleId": style_id,
                    })

                    in_reject_window = (
                        site_id == REJECT_WINDOW["site"]
                        and REJECT_WINDOW["start"] <= date <= REJECT_WINDOW["end"]
                    )
                    reject_p = 0.022
                    if in_reject_window:
                        reject_p = (
                            REJECT_WINDOW["fantasy_reject"]
                            if style_id == REJECT_WINDOW["style"]
                            else REJECT_WINDOW["base_reject"]
                        )

                    # 待审核：仅基准日最后 40 分钟内产生的内容
                    just_created = (BASELINE - create_time) < timedelta(minutes=40)
                    review_time = clamp_dt(create_time + timedelta(seconds=rng.randint(1, 6)))
                    if is_last_day and just_created and rng.random() < 0.55:
                        moderations.append({
                            "contentId": content_id,
                            "ts": ts(review_time),
                            "status": "pending",
                            "rejectReason": None,
                        })
                        continue   # 待审核内容不可扫码/分享，不进入后续行为

                    if rng.random() < reject_p:
                        weights = (
                            REJECT_WEIGHTS_FANTASY
                            if (in_reject_window and style_id == REJECT_WINDOW["style"])
                            else REJECT_WEIGHTS_NORMAL
                        )
                        reason = weighted_pick([r[0] for r in REJECT_REASONS], weights)
                        moderations.append({
                            "contentId": content_id,
                            "ts": ts(review_time),
                            "status": "reject",
                            "rejectReason": reason,
                        })
                        continue   # 审核拒绝内容不可扫码/分享

                    moderations.append({
                        "contentId": content_id,
                        "ts": ts(review_time),
                        "status": "pass",
                        "rejectReason": None,
                    })

                    # ---------------- 扫码 ----------------
                    dev_scan_mult = 1.0
                    dev_share_mult = 1.0
                    if dev_id == LOW_CONVERT_DEVICE["device"] and date >= LOW_CONVERT_DEVICE["start"]:
                        dev_scan_mult = LOW_CONVERT_DEVICE["scan_mult"]
                        dev_share_mult = LOW_CONVERT_DEVICE["share_mult"]

                    if rng.random() < scan_p * dev_scan_mult:
                        n_scans = weighted_pick([1, 2, 3], [0.80, 0.15, 0.05])
                        for k in range(n_scans):
                            scan_time = clamp_dt(
                                create_time + timedelta(seconds=rng.randint(15, 260) + k * rng.randint(20, 120))
                            )
                            if scan_time >= BASELINE:
                                break
                            scans.append({
                                "eventId": next_id("s"),
                                "ts": ts(scan_time),
                                "contentId": content_id,
                                "siteId": site_id,
                                "deviceId": dev_id,
                            })

                    # ---------------- 分享 ----------------
                    if rng.random() < share_p * dev_share_mult:
                        share_time = clamp_dt(create_time + timedelta(seconds=rng.randint(20, 300)))
                        if share_time < BASELINE:
                            ok = rng.random() < 0.90   # 约 10% 分享失败（用户取消/平台限制）
                            shares.append({
                                "eventId": next_id("sh"),
                                "ts": ts(share_time),
                                "contentId": content_id,
                                "siteId": site_id,
                                "deviceId": dev_id,
                                "status": "success" if ok else "failed",
                                "failReason": None if ok else weighted_pick(
                                    ["USER_CANCEL", "PLATFORM_LIMIT"], [0.7, 0.3]
                                ),
                            })
                else:
                    weights = (
                        FAILURE_WEIGHTS_TIMEOUT if in_fail_window else FAILURE_WEIGHTS_NORMAL
                    )
                    reason = weighted_pick([r[0] for r in FAILURE_REASONS], weights)
                    tasks.append({
                        "taskId": task_id,
                        "ts": ts(task_time),
                        "siteId": site_id,
                        "deviceId": dev_id,
                        "userId": user_id,
                        "styleId": style_id,
                        "status": "failed",
                        "durationMs": None,
                        "failureReason": reason,
                    })

# ----------------------------------------------------------------------------
# 设备心跳
# ----------------------------------------------------------------------------
heartbeat_start = (BASELINE - timedelta(days=HEARTBEAT_DAYS - 1)).replace(
    hour=0, minute=0, second=0, microsecond=0
)
by_device = {d[0]: [] for d in DEVICES}

for day_offset in range(HEARTBEAT_DAYS):
    date = heartbeat_start + timedelta(days=day_offset)
    cursor = datetime(date.year, date.month, date.day, OP_START, OP_END)
    end_dt = datetime(date.year, date.month, date.day, OP_END_H, OP_END_M)
    slots = []
    while cursor <= end_dt:
        slots.append(cursor)
        cursor += timedelta(minutes=HEARTBEAT_INTERVAL_MIN)

    for dev_id, _, _, _, _ in DEVICES:
        stop_at = DEVICE_LAST_HEARTBEAT.get(dev_id)
        for slot in slots:
            if slot > BASELINE:
                continue
            if stop_at is not None and slot > stop_at:
                continue
            skip = False
            for gap_dev, gap_start, gap_end in HEARTBEAT_GAPS:
                if dev_id == gap_dev and gap_start <= slot <= gap_end:
                    skip = True
                    break
            if skip:
                continue
            by_device[dev_id].append(ts(slot))

for dev_id in by_device:
    by_device[dev_id].sort()

# ----------------------------------------------------------------------------
# 写出文件
# ----------------------------------------------------------------------------
os.makedirs(OUT_DIR, exist_ok=True)

sites_json = [
    {
        "id": s[0], "name": s[1], "city": s[2], "type": s[3],
        "deviceIds": [d[0] for d in device_of_site(s[0])],
        "openedAt": min(d[4] for d in device_of_site(s[0])),
    }
    for s in SITES
]

devices_json = [
    {"id": d[0], "siteId": d[1], "model": d[2], "screenSizeInch": d[3], "installDate": d[4]}
    for d in DEVICES
]

meta = {
    "datasetName": "AIGC 互动大屏运营模拟数据",
    "seed": SEED,
    "timezone": "Asia/Shanghai (UTC+8)",
    "baselineTime": ts(BASELINE),
    "dataUpdateTime": ts(BASELINE),
    "businessDays": DAYS,
    "startDate": start_date.strftime("%Y-%m-%d"),
    "endDate": BASELINE.strftime("%Y-%m-%d"),
    "heartbeat": {
        "retentionDays": HEARTBEAT_DAYS,
        "intervalMinutes": HEARTBEAT_INTERVAL_MIN,
        "operatingHours": "09:30-22:00",
    },
    "counts": {
        "sites": len(sites_json),
        "devices": len(devices_json),
        "participations": len(participations),
        "generationTasks": len(tasks),
        "contents": len(contents),
        "moderations": len(moderations),
        "scanEvents": len(scans),
        "shareEvents": len(shares),
        "heartbeats": sum(len(v) for v in by_device.values()),
    },
    "dictionaries": {
        "styles": [{"id": s[0], "name": s[1]} for s in STYLES],
        "failureReasons": [{"id": r[0], "name": r[1]} for r in FAILURE_REASONS],
        "rejectReasons": [{"id": r[0], "name": r[1]} for r in REJECT_REASONS],
        "taskStatus": ["success", "failed", "pending"],
        "moderationStatus": ["pass", "reject", "pending"],
        "shareStatus": ["success", "failed"],
    },
    "anomalyScenarios": ANOMALY_SCENARIOS,
    "notes": [
        "全部为模拟数据，不含任何真实用户隐私信息。",
        "设备在线状态相对 baselineTime 判断，不随历史日期筛选变化。",
        "生成中(pending)任务不计入成功率分母；待审核(pending)内容不计入审核通过率分母。",
        "审核拒绝的内容不可扫码/分享，因此不进入扫码与分享转化率分母。",
    ],
}

events = {
    "participations": participations,
    "generationTasks": tasks,
    "contents": contents,
    "moderations": moderations,
    "scans": scans,
    "shares": shares,
}

heartbeats = {
    "baselineTime": ts(BASELINE),
    "intervalMinutes": HEARTBEAT_INTERVAL_MIN,
    "operatingHours": "09:30-22:00",
    "byDevice": by_device,
}

for name, payload in [
    ("mock_sites.json", sites_json),
    ("mock_devices.json", devices_json),
    ("mock_events.json", events),
    ("mock_heartbeats.json", heartbeats),
    ("mock_meta.json", meta),
]:
    path = os.path.join(OUT_DIR, name)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    print(f"written: {path}  ({os.path.getsize(path) / 1024 / 1024:.2f} MB)")

print("\n=== 汇总 ===")
print(json.dumps(meta["counts"], ensure_ascii=False, indent=2))
