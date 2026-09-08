// L3 安全治理：不可绕过的硬约束（独立于用户配置）
// 调度/发送前必须过 canSend()；违规返回带原因码，调用方不得跳过。
import { DEFAULT_SAFETY_LIMITS, type SafetyLimits } from '../types.js';

export type SafetyReason =
  | 'CIRCUIT_OPEN'
  | 'MIN_GAP'
  | 'PER_MIN'
  | 'PER_HOUR'
  | 'PER_DAY'
  | 'TEXT_COOLDOWN';

export interface SafetyVerdict {
  ok: boolean;
  reason?: SafetyReason;
  /** 预计可再发的时间（冷却/熔断），便于 UI 提示 */
  retryAfterMs?: number;
}

/**
 * 分钟级环形计数：1440 槽 = 绝对分钟 % 1440；槽内记录所属绝对分钟 tag，
 * 查询按 tag 新鲜度过滤 → 天然滑动窗口，无需逐槽推进，跨天自动正确。
 */
export class SafetyGovernor {
  private limits: SafetyLimits;
  private now: () => number;
  private tagArr = new Int32Array(1440);
  private cntArr = new Int32Array(1440);
  private lastSentAt = 0;
  private circuitOpenUntil = 0;
  private textCount = new Map<string, { count: number; coolingUntil: number }>();

  constructor(limits: Partial<SafetyLimits> = {}, now?: () => number) {
    this.limits = { ...DEFAULT_SAFETY_LIMITS, ...limits };
    this.now = now ?? (() => Date.now());
  }

  private addCount(atMinute: number, n: number): void {
    const slot = atMinute % 1440;
    if (this.tagArr[slot] === atMinute) {
      this.cntArr[slot]! += n;
    } else {
      this.tagArr[slot] = atMinute;
      this.cntArr[slot] = n;
    }
  }

  /** [now-windowMs, now] 内发送计数 */
  private windowSum(nowMinute: number, windowMs: number): number {
    const winMin = Math.floor(windowMs / 60000);
    let sum = 0;
    for (let m = nowMinute - winMin; m <= nowMinute; m++) {
      const slot = ((m % 1440) + 1440) % 1440;
      if (this.tagArr[slot] === m) sum += this.cntArr[slot]!;
    }
    return sum;
  }

  canSend(text: string, at?: number): SafetyVerdict {
    const now = at ?? this.now();
    const nowMinute = Math.floor(now / 60000);
    if (this.circuitOpenUntil > now) {
      return { ok: false, reason: 'CIRCUIT_OPEN', retryAfterMs: this.circuitOpenUntil - now };
    }
    if (this.lastSentAt > 0 && now - this.lastSentAt < this.limits.minGapMs) {
      return { ok: false, reason: 'MIN_GAP', retryAfterMs: this.limits.minGapMs - (now - this.lastSentAt) };
    }
    const rec = this.textCount.get(text);
    if (rec && rec.coolingUntil > now) {
      return { ok: false, reason: 'TEXT_COOLDOWN', retryAfterMs: rec.coolingUntil - now };
    }
    // perMin 用「当前分钟配额」语义（跨分钟自动重置），避免分钟槽对 60s 窗口的边缘污染
    const curCount = this.tagArr[nowMinute % 1440] === nowMinute ? this.cntArr[nowMinute % 1440]! : 0;
    if (curCount >= this.limits.perMin) return { ok: false, reason: 'PER_MIN' };
    if (this.windowSum(nowMinute, 3_600_000) >= this.limits.perHour) return { ok: false, reason: 'PER_HOUR' };
    if (this.windowSum(nowMinute, 86_400_000) >= this.limits.perDay) return { ok: false, reason: 'PER_DAY' };
    return { ok: true };
  }

  /** 发送成功后登记（必须在 canSend 通过后调用） */
  noteSent(text: string, at?: number): void {
    const now = at ?? this.now();
    const nowMinute = Math.floor(now / 60000);
    this.addCount(nowMinute, 1);
    this.lastSentAt = now;
    const rec = this.textCount.get(text) ?? { count: 0, coolingUntil: 0 };
    rec.count += 1;
    if (rec.count >= this.limits.cooldownAfter) {
      rec.count = 0;
      rec.coolingUntil = now + this.limits.coolDownMs;
    }
    this.textCount.set(text, rec);
  }

  /** 平台风控/警告 → 熔断一段时长（默认 10 分钟） */
  notePlatformWarn(at?: number, openMs = 600_000): void {
    const now = at ?? this.now();
    this.circuitOpenUntil = Math.max(this.circuitOpenUntil, now + openMs);
  }

  reset(): void {
    this.tagArr.fill(0);
    this.cntArr.fill(0);
    this.lastSentAt = 0;
    this.circuitOpenUntil = 0;
    this.textCount.clear();
  }
}
