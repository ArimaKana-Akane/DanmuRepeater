// L3 安全阀单测：硬上限 / 最小间隔 / 文本冷却 / 熔断
import { describe, expect, it } from 'vitest';
import { SafetyGovernor } from '../src/safety/governor.js';

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

describe('SafetyGovernor', () => {
  it('perMin 硬上限：达到后拒绝（跨分钟可恢复）', () => {
    const c = clock();
    const g = new SafetyGovernor({ perMin: 3, minGapMs: 1, cooldownAfter: 999, perHour: 100, perDay: 1000 }, c.now);
    for (let i = 0; i < 3; i++) {
      expect(g.canSend('t').ok).toBe(true);
      g.noteSent('t');
      c.advance(10);
    }
    expect(g.canSend('t').reason).toBe('PER_MIN');
    c.advance(61_000); // >60s，上一分钟槽推出窗口
    expect(g.canSend('t').ok).toBe(true); // 跨分钟后恢复
  });

  it('perHour 与 perDay 上限', () => {
    const c = clock();
    const g = new SafetyGovernor({ perMin: 100, perHour: 5, perDay: 1000, minGapMs: 1, cooldownAfter: 999 }, c.now);
    for (let i = 0; i < 5; i++) { g.noteSent('t'); c.advance(1000); }
    expect(g.canSend('t').reason).toBe('PER_HOUR');
  });

  it('minGap 最小间隔', () => {
    const c = clock();
    const g = new SafetyGovernor({ minGapMs: 5000, cooldownAfter: 999, perMin: 100, perHour: 100, perDay: 1000 }, c.now);
    g.noteSent('a');
    expect(g.canSend('b').reason).toBe('MIN_GAP');
    c.advance(5000);
    expect(g.canSend('b').ok).toBe(true);
  });

  it('同一弹幕 N 次后强制冷却（冷却期内该文本被拒，其它文本可发）', () => {
    const c = clock();
    const g = new SafetyGovernor({ cooldownAfter: 3, coolDownMs: 60_000, minGapMs: 1, perMin: 100, perHour: 100, perDay: 1000 }, c.now);
    for (let i = 0; i < 3; i++) { g.noteSent('刷屏句'); c.advance(10); }
    expect(g.canSend('刷屏句').reason).toBe('TEXT_COOLDOWN');
    expect(g.canSend('其它句子').ok).toBe(true);
    c.advance(60_000);
    expect(g.canSend('刷屏句').ok).toBe(true);
  });

  it('平台风控熔断：CIRCUIT_OPEN 直到到期', () => {
    const c = clock();
    const g = new SafetyGovernor({}, c.now);
    g.notePlatformWarn(c.now(), 600_000);
    expect(g.canSend('t').reason).toBe('CIRCUIT_OPEN');
    c.advance(600_001);
    expect(g.canSend('t').ok).toBe(true);
  });

  it('跨天（>1440 分钟）后计数自动正确（旧槽被 tag 过滤）', () => {
    const c = clock();
    const g = new SafetyGovernor({ perMin: 3, minGapMs: 0, cooldownAfter: 999, perHour: 100, perDay: 1000 }, c.now);
    g.noteSent('t');
    c.advance(86_400_000 * 3); // 跳 3 天
    g.noteSent('t');
    expect(g.canSend('t').ok).toBe(true); // 日窗只算最近
  });
});
