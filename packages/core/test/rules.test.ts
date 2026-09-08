// 行为冻结测试：normalize / isSystemDanmaku / 筛选规则（legacy 1.1.20 语义）
import { describe, expect, it } from 'vitest';
import { isSystemDanmaku, normalizeText } from '../src/danmaku/normalize.js';
import {
  formatFilterRuleForDisplay,
  isBlocked,
  parseFilterRules,
} from '../src/danmaku/rules.js';

describe('normalizeText', () => {
  it('去数字/标点/符号，保留中文', () => {
    expect(normalizeText('哈哈哈666!!!!')).toBe('哈哈哈');
    // 只去数字/标点/符号 + 首尾 trim；中间空格保留（legacy 行为）
    expect(normalizeText(' 这个 操作 太秀了 ')).toBe('这个 操作 太秀了');
    expect(normalizeText('233333')).toBe('');
    expect(normalizeText('!!!')).toBe('');
  });
  it('trim 首尾空白', () => {
    expect(normalizeText('  主播牛   ')).toBe('主播牛');
  });
});

describe('isSystemDanmaku（legacy 1.1.20 行为）', () => {
  it('欢迎语/系统前缀命中', () => {
    expect(isSystemDanmaku('欢迎来到yyfyyf的直播间。斗鱼严禁低俗内容')).toBe(true);
    expect(isSystemDanmaku('系统消息：xxx')).toBe(true);
    expect(isSystemDanmaku('温馨提示：文明发言')).toBe(true);
    expect(isSystemDanmaku('欢迎主播进入直播间')).toBe(true); // 欢迎.{0,12}进入直播间
  });
  it('短文本「本直播间」前缀命中（用户确认的产品行为）', () => {
    expect(isSystemDanmaku('本直播间开启自动回复')).toBe(true);
  });
  it('长文本/普通弹幕不误杀', () => {
    expect(isSystemDanmaku('这个操作太秀了哈哈哈')).toBe(false);
    expect(isSystemDanmaku('')).toBe(false);
    expect(isSystemDanmaku('666666')).toBe(false);
  });
});

describe('filterRules（legacy 1.1.20 语义）', () => {
  it('解析 length 规则（>= 在 > 之前）', () => {
    const rules = parseFilterRules('length>=10\nlength<5');
    expect(rules).toHaveLength(2);
    expect(rules[0]).toEqual({ type: 'length', op: '>=', value: 10 });
    expect(rules[1]).toEqual({ type: 'length', op: '<', value: 5 });
  });
  it('regex 支持 /xxx/ 字面量并剥除', () => {
    const rules = parseFilterRules('regex:/^\\d+$/');
    expect(rules[0]).toEqual({ type: 'regex', value: '^\\d+$', flags: 'i' });
  });
  it('isBlocked: contains/not_contains/length/regex 语义', () => {
    // contains 规则 = 文本必须包含 → 不含即过滤
    const ctxA = { blocklist: [], filterRules: parseFilterRules('contains:哈哈') };
    expect(isBlocked('666', ctxA)).toBe(true);
    expect(isBlocked('哈哈哈哈', ctxA)).toBe(false);
    // regex 规则 = 必须匹配 → 不匹配即过滤（与 contains 叠加时 AND）
    const ctxB = { blocklist: [], filterRules: parseFilterRules('regex:/^\\d+$/') };
    expect(isBlocked('12345', ctxB)).toBe(false);
    expect(isBlocked('哈哈哈', ctxB)).toBe(true);
    // not_contains
    const ctxC = { blocklist: [], filterRules: parseFilterRules('not_contains:垃圾') };
    expect(isBlocked('这是垃圾话', ctxC)).toBe(true);
    expect(isBlocked('正常弹幕', ctxC)).toBe(false);
    // 屏蔽词
    const ctx2 = { blocklist: ['广告'], filterRules: [] as never[] };
    expect(isBlocked('加微信看广告', ctx2)).toBe(true);
    expect(isBlocked('正常弹幕', ctx2)).toBe(false);
    // 屏蔽词支持正则 /.../
    const ctx3 = { blocklist: ['/^\\d+$/'], filterRules: [] as never[] };
    expect(isBlocked('12345', ctx3)).toBe(true);
    expect(isBlocked('abc', ctx3)).toBe(false);
  });
  it('format 可往返', () => {
    const rules = parseFilterRules('regex:/^\\d+$/');
    const text = formatFilterRuleForDisplay(rules[0]!);
    expect(text).toBe('regex:/^\\d+$/i');
    expect(parseFilterRules(text)[0]).toEqual(rules[0]);
  });
});
