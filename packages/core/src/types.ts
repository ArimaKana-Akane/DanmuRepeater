// @lgj/core · 平台无关核心的边界类型（蓝图 v2.0 §4 落地）
// 设计铁律：core 只认 DanmuMessage（入）与 SendIntent（出），不 import 任何 DOM/平台 API。
// 来源：docs/革命蓝图-v2.0-双模引擎.md（1.2.0 执行规格见 v2/SPEC.md L0/L1/L2）

/** 平台标识 */
export type Platform = 'douyu' | 'huya' | 'bilibili' | 'douyin';

/** 入站弹幕事件（统一形态，页面 hook / 协议 / DOM 三源归一） */
export interface DanmuMessage {
  id: string;
  platform: Platform;
  roomId: number | string;
  type: 'danmaku' | 'gift' | 'enter' | 'system' | 'rank' | 'other';
  uid: string | number | null; // null = 匿名/脱敏
  nick: string;
  text: string;
  /** 原始负载（协议原文 / DOM 节点快照），诊断快照用 */
  raw?: unknown;
  ts: number;
}

/** 发送意图（决策器输出；风控/调度永远在 core，决策器无权绕过） */
export interface SendIntent {
  text: string;
  source: 'frequency' | 'strategy' | 'llm' | 'manual';
  priority?: number;
}

/** 归一化发送回执码（协议直发收益的载体） */
export type SendReceiptCode =
  | 'OK'
  | 'FILTERED' // 内容被平台过滤
  | 'RATE_LIMITED'
  | 'NEED_CAPTCHA'
  | 'MUTED'
  | 'EXPIRED' // 登录/凭据失效
  | 'UNKNOWN';

export interface SendResult {
  ok: boolean;
  code: SendReceiptCode;
  message?: string;
}

/** 采集源生命周期（双模公共形状：ProtocolSource / PageSource / DomSource） */
export interface DanmuSource {
  readonly kind: 'protocol' | 'page' | 'dom';
  static?: { supports(platform: Platform): boolean };
  start(ctx: DanmuSourceContext): Promise<void>;
  stop(): Promise<void>;
}

export interface DanmuSourceContext {
  platform: Platform;
  roomId: number | string;
  onMessage(msg: DanmuMessage): void;
  /** 切换代际：旧实例回调携带旧 epoch，消息一律丢弃（防双源并流重发） */
  epoch: number;
  /** 凭据访问器：同源 cookie / 页面 SDK 由 Host 注入，core 不直接碰 window */
  credentials: CredentialsAccess;
}

/** 发送器（双模：DomSender=1.1.20 链路原样搬迁；ProtocolSender=接口直发） */
export interface DanmuSender {
  readonly kind: 'protocol' | 'dom';
  probe(): Promise<{ ok: boolean; reason?: string }>;
  send(text: string, ctx: SenderContext): Promise<SendResult>;
}

export interface SenderContext {
  platform: Platform;
  roomId: number | string;
}

/** 平台凭据/页面资源访问器（油猴宿主实现：读 cookie、调 window.byted_acrawler 等） */
export interface CredentialsAccess {
  getCookie(name: string): string | null;
  /** 在页面世界执行（hook 用），跨世界桥接由 Host 实现 */
  evalPageWorld?<T>(code: string): Promise<T>;
}

/** 双模工作引擎配置（蓝图 §3.2，新 GM key，与 1.1.20 配置零冲突） */
export interface EngineConfig {
  mode: 'page' | 'protocol' | 'auto';
  source: 'auto' | 'dom' | 'hook' | 'protocol';
  sender: 'auto' | 'dom' | 'protocol';
  overrides: Partial<Record<Platform, { mode?: 'page' | 'protocol' }>>;
  fallbackOnError: boolean;
  /** 每平台风控纪律（调研数值，真机校准后固化） */
  maxSendGapMs: Partial<Record<Platform, number>>;
  maxSendPerMin: Partial<Record<Platform, number>>;
}

/** L2 升级后的候选（从 {text,count} 到带趋势/发送者/聚类的结构化候选） */
export interface Candidate {
  text: string;
  count: number;
  /** 指数平滑速度（趋势），替代 count² */
  velocity: number;
  firstSeen: number;
  lastSeen: number;
  uniqueSenders: number;
  emotes: number;
  isGift: boolean;
  clusterId: string;
}

/** 安全阀硬约束（L3，独立于用户配置、不可绕过） */
export interface SafetyLimits {
  perMin: number;
  perHour: number;
  perDay: number;
  minGapMs: number;
  /** 同话题连续上限（L2 聚类后启用；当前由 perText 冷却近似表达） */
  sameTopicMax: number;
  /** 同一弹幕连续发送 N 次后强制冷却 */
  cooldownAfter: number;
  /** 强制冷却时长 ms */
  coolDownMs: number;
  /** 平台警告触发熔断 */
  circuitBreakerOnPlatformWarn: boolean;
}

/** 默认硬顶：给正常观看使用留余量；平台风控策略（maxSendPerMin 等）另行收紧 */
export const DEFAULT_SAFETY_LIMITS: SafetyLimits = {
  perMin: 30,
  perHour: 200,
  perDay: 1000,
  minGapMs: 2000,
  sameTopicMax: 10,
  cooldownAfter: 20,
  coolDownMs: 600_000,
  circuitBreakerOnPlatformWarn: true,
};
