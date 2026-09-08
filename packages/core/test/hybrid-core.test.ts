// Hybrid 纯逻辑核心单测（与 scripts/hybrid/hybrid-core.mjs 同源，构建时内联进发布脚本）
import { describe, expect, it } from 'vitest';
import {
  HybridSafety,
  isSystemDanmaku,
  LeaderElection,
  mapBiliSendCode,
  mergeSafetyConfig,
  parseBiliRoomId,
  SAFETY_DEFAULTS,
  validateConfigBundle,
} from '../../../scripts/hybrid/hybrid-core.mjs';

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

function memStore() {
  const map = new Map<string, unknown>();
  return {
    get<T>(key: string, fallback: T): T {
      return map.has(key) ? (map.get(key) as T) : fallback;
    },
    set(key: string, value: unknown) { map.set(key, value); },
    dump() { return Object.fromEntries(map); },
  };
}

describe('parseBiliRoomId（P0-2：blanc/h5 与父文档兜底）', () => {
  it('普通房间 / blanc / h5 / 查询串', () => {
    expect(parseBiliRoomId('https://live.bilibili.com/6343442')).toBe(6343442);
    expect(parseBiliRoomId('https://live.bilibili.com/blanc/856077')).toBe(856077);
    expect(parseBiliRoomId('https://live.bilibili.com/blanc/21452505?from=1')).toBe(21452505);
    expect(parseBiliRoomId('https://live.bilibili.com/h5/12345')).toBe(12345);
    expect(parseBiliRoomId('https://live.bilibili.com/999999/?p=2#a')).toBe(999999);
    expect(parseBiliRoomId('https://live.bilibili.com/p/html/x?room_id=777')).toBe(777);
  });
  it('blanc iframe 用父文档 URL 兜底', () => {
    expect(parseBiliRoomId('https://live.bilibili.com/p/html/x', 'https://live.bilibili.com/blanc/856077')).toBe(856077);
    expect(parseBiliRoomId('https://live.bilibili.com/blanc/1', 'https://live.bilibili.com/2')).toBe(1);
  });
  it('非直播间返回 0', () => {
    expect(parseBiliRoomId('https://www.bilibili.com/video/BV1xx')).toBe(0);
    expect(parseBiliRoomId('')).toBe(0);
    expect(parseBiliRoomId(undefined as unknown as string)).toBe(0);
  });
});

describe('mergeSafetyConfig（P0-3：残缺配置不得丢默认，且不可被放宽）', () => {
  it('空配置 → 完整默认，且 enabled 恒为 true', () => {
    const m = mergeSafetyConfig(null);
    expect(m.perMin).toBe(SAFETY_DEFAULTS.perMin);
    expect(m.minGapMs).toBe(SAFETY_DEFAULTS.minGapMs);
    expect(m.enabled).toBe(true);
  });
  it('部分配置保留其余默认（此前 {minGapMs} 会让 !enabled 使全部失效）', () => {
    const m = mergeSafetyConfig({ minGapMs: 5000 });
    expect(m.minGapMs).toBe(5000);
    expect(m.perMin).toBe(SAFETY_DEFAULTS.perMin);
    expect(m.cooldownMs).toBe(SAFETY_DEFAULTS.cooldownMs);
    expect(m.enabled).toBe(true);
  });
  it('频次上限只可更严（不能放大）', () => {
    expect(mergeSafetyConfig({ perMin: 999 }).perMin).toBe(SAFETY_DEFAULTS.perMin);
    expect(mergeSafetyConfig({ perDay: 1 }).perDay).toBe(1);
  });
  it('间隔/冷却只可更严（不能缩小）', () => {
    expect(mergeSafetyConfig({ minGapMs: 100 }).minGapMs).toBe(SAFETY_DEFAULTS.minGapMs);
    expect(mergeSafetyConfig({ cooldownMs: 1000 }).cooldownMs).toBe(SAFETY_DEFAULTS.cooldownMs);
  });
  it('enabled:false / 坏类型 / 额外键都不能绕过', () => {
    const m = mergeSafetyConfig({ enabled: false, perMin: 'x', extra: 1 });
    expect(m.enabled).toBe(true);
    expect(m.perMin).toBe(SAFETY_DEFAULTS.perMin);
    expect('extra' in m).toBe(false);
  });
});

describe('validateConfigBundle（P0-3：校验必须到 config 内部）', () => {
  it('合法导出包通过', () => {
    expect(validateConfigBundle({ __lgjExport: 1, config: { minMsgLength: 4, crazyInterval: 4 } })).toBeNull();
  });
  it('缺标记 / 坏 config 字段 / 非对象 config 均拒绝', () => {
    expect(validateConfigBundle({ config: {} })).toContain('__lgjExport');
    expect(validateConfigBundle({ __lgjExport: 1, config: { minMsgLength: 'abc' } })).toContain('config.minMsgLength');
    expect(validateConfigBundle({ __lgjExport: 1, config: 42 })).toContain('config');
    expect(validateConfigBundle({ __lgjExport: 1, blocklist: 'x' })).toContain('blocklist');
  });
});

describe('HybridSafety（L3 硬约束 + 持久化）', () => {
  const base = { perMin: 3, perHour: 100, perDay: 1000, minGapMs: 2000, cooldownAfter: 99, skipChance: 0 };

  it('未确认风险声明时 fail-closed（ACK_REQUIRED）', () => {
    const c = clock();
    const s = new HybridSafety({ limits: base, now: c.now, storage: memStore(), isHidden: () => false });
    expect(s.allow('t')).toBe(false);
    expect(s.reason()).toBe('ACK_REQUIRED');
    s.confirmAck();
    expect(s.allow('t')).toBe(true);
  });

  it('perMin 硬上限 + 跨分钟恢复', () => {
    const c = clock();
    const s = new HybridSafety({ limits: base, now: c.now, storage: memStore(), isHidden: () => false });
    s.confirmAck();
    for (let i = 0; i < 3; i++) {
      expect(s.allow('t')).toBe(true);
      s.note('t');
      c.advance(2500);
    }
    expect(s.allow('t')).toBe(false);
    expect(s.reason()).toBe('PER_MIN');
    c.advance(61000);
    expect(s.allow('t')).toBe(true);
  });

  it('最小间隔 / 同句冷却 / 熔断 / 隐藏页', () => {
    const c = clock();
    const s = new HybridSafety({ limits: { ...base, perMin: 10, cooldownAfter: 3 }, now: c.now, storage: memStore(), isHidden: () => false });
    s.confirmAck();
    s.note('same');
    expect(s.allow('same')).toBe(false);
    expect(s.reason()).toBe('MIN_GAP');
    c.advance(2500);
    s.note('same');
    c.advance(2500);
    s.note('same');
    c.advance(2500);
    expect(s.allow('same')).toBe(false);
    expect(s.reason()).toBe('TEXT_COOLDOWN');
    expect(s.allow('other')).toBe(true);
    s.trip(c.now(), 600000);
    expect(s.allow('other')).toBe(false);
    expect(s.reason()).toBe('CIRCUIT');
  });

  it('计数持久化：新实例（模拟刷新）仍受配额约束', () => {
    const c = clock();
    const store = memStore();
    const a = new HybridSafety({ limits: { ...base, perMin: 2 }, now: c.now, storage: store, isHidden: () => false });
    a.confirmAck();
    a.allow('x'); a.note('x');
    c.advance(2500);
    a.allow('x'); a.note('x');
    const b = new HybridSafety({ limits: { ...base, perMin: 2 }, now: c.now, storage: store, isHidden: () => false });
    c.advance(2500);
    expect(b.allow('x')).toBe(false);
    expect(b.reason()).toBe('PER_MIN');
  });

  it('RANDOM_SKIP 由 rand 决定（调用方需按不可重试处理）', () => {
    const c = clock();
    const s = new HybridSafety({
      limits: { ...base, skipChance: 0.05 },
      now: c.now,
      storage: memStore(),
      isHidden: () => false,
      rand: () => 0,
    });
    s.confirmAck();
    expect(s.allow('t')).toBe(false);
    expect(s.reason()).toBe('RANDOM_SKIP');
  });
});

describe('mapBiliSendCode（P1-11：协议发送返回码归一化）', () => {
  it('成功 / 未登录 / CSRF / 风控 / 审核拒绝', () => {
    expect(mapBiliSendCode(0).ok).toBe(true);
    expect(mapBiliSendCode(-101)).toMatchObject({ ok: false, code: 'NOT_LOGGED_IN', fallback: true });
    expect(mapBiliSendCode(-111)).toMatchObject({ ok: false, code: 'CSRF_MISSING', fallback: true });
    expect(mapBiliSendCode(-412)).toMatchObject({ ok: false, code: 'RATE_LIMITED', fallback: false });
    expect(mapBiliSendCode(10030)).toMatchObject({ ok: false, code: 'RATE_LIMITED', fallback: false });
    expect(mapBiliSendCode(1003212)).toMatchObject({ ok: false, code: 'REJECTED', fallback: false });
    expect(mapBiliSendCode(12345)).toMatchObject({ ok: false, code: 'UNKNOWN', fallback: false });
  });
});

describe('LeaderElection（L4：多标签唯一发送者）', () => {
  it('两个标签页只有一个 leader；leader 租约过期后另一个接管', () => {
    const c = clock();
    const store = memStore();
    const a = new LeaderElection({ tabId: 'A', key: 'k', storage: store, now: c.now, leaseMs: 15000 });
    const b = new LeaderElection({ tabId: 'B', key: 'k', storage: store, now: c.now, leaseMs: 15000 });
    a.tick();
    b.tick();
    expect(a.isLeader()).toBe(true);
    expect(b.isLeader()).toBe(false);
    // A 停止续约，租约过期后 B 接管
    c.advance(16000);
    b.tick();
    expect(b.isLeader()).toBe(true);
    expect(a.isLeader()).toBe(false);
  });

  it('无 storage 时退化为总是 leader（单标签）', () => {
    const e = new LeaderElection({ tabId: 'solo' });
    expect(e.isLeader()).toBe(true);
    e.tick();
    expect(e.isLeader()).toBe(true);
  });

  it('onChange 只在 leader 身份变化时回调', () => {
    const c = clock();
    const store = memStore();
    const seen: boolean[] = [];
    const a = new LeaderElection({ tabId: 'A', key: 'k2', storage: store, now: c.now, onChange: (v) => seen.push(v) });
    a.tick();
    a.tick();
    expect(seen).toEqual([true]);
  });
});

describe('isSystemDanmaku（系统弹幕智能识别）', () => {
  it('各平台欢迎/公告/系统前缀', () => {
    expect(isSystemDanmaku('欢迎来到yyfyyf的直播间。斗鱼严禁低俗内容')).toBe(true);
    expect(isSystemDanmaku('系统消息：xxx')).toBe(true);
    expect(isSystemDanmaku('温馨提示：文明发言')).toBe(true);
    expect(isSystemDanmaku('欢迎主播进入直播间')).toBe(true);
    expect(isSystemDanmaku('本直播间开启自动回复')).toBe(true);
    expect(isSystemDanmaku('系统公告：今晚八点开播')).toBe(true);
  });
  it('进场/关注/礼物/粉丝团/风控', () => {
    expect(isSystemDanmaku('小明进入了直播间')).toBe(true);
    expect(isSystemDanmaku('小红来到了直播间')).toBe(true);
    expect(isSystemDanmaku('张三关注了主播')).toBe(true);
    expect(isSystemDanmaku('李四送出了火箭')).toBe(true);
    expect(isSystemDanmaku('王五加入了粉丝团')).toBe(true);
    expect(isSystemDanmaku('管理员：请勿刷屏')).toBe(true);
    expect(isSystemDanmaku('恭喜你中奖了')).toBe(true);
  });
  it('正常弹幕不误杀', () => {
    expect(isSystemDanmaku('这个操作太秀了哈哈哈')).toBe(false);
    expect(isSystemDanmaku('主播牛逼')).toBe(false);
    expect(isSystemDanmaku('666666')).toBe(false);
    expect(isSystemDanmaku('')).toBe(false);
    expect(isSystemDanmaku('今晚打什么图')).toBe(false);
  });
  it('超长文本不按系统弹幕误杀（交给屏蔽词）', () => {
    expect(isSystemDanmaku('系统消息'.padEnd(100, '啊'))).toBe(false);
  });
});


