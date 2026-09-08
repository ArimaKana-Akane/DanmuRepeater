// 候选引擎行为冻结测试（legacy 1.1.20 纯逻辑迁移）
import { describe, expect, it } from 'vitest';
import { CandidateEngine } from '../src/danmaku/engine.js';
import { DEFAULT_CONFIG } from '../src/constants.js';

function makeClock() {
  let t = 1000;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

describe('CandidateEngine（滑动窗口频次）', () => {
  it('窗口内同文本 count 递增；超窗口重记为 1', () => {
    const { now, advance } = makeClock();
    const e = new CandidateEngine({ now });
    e.add('测试弹幕ABC');
    advance(5000);
    e.add('测试弹幕ABC');
    expect(e.freqSize()).toBe(1);
    e.flush();
    const c = e.candidates();
    expect(c[0]!.count).toBe(2);
    // 超过 FREQ_WINDOW(120s) 再次出现 → 重记 1，且旧条目被清理
    advance(130000);
    e.add('测试弹幕ABC');
    e.flush();
    const c2 = e.candidates();
    expect(c2[0]!.count).toBe(1);
    expect(e.freqSize()).toBe(1);
  });

  it('短于 minMsgLength / 屏蔽词 不入候选', () => {
    const e = new CandidateEngine({ config: { ...DEFAULT_CONFIG, minMsgLength: 4 }, blocklist: ['广告'] });
    e.add('哈');
    e.add('广告弹幕内容');
    e.add('正常弹幕内容');
    e.flush();
    const texts = e.candidates().map(c => c.text);
    expect(texts).not.toContain('哈');
    expect(texts).not.toContain('广告弹幕内容');
    expect(texts).toContain('正常弹幕内容');
  });

  it('纯数字 "666" 规范化为空时回退原文入候选（1.1.17 P0-1 修复）', () => {
    const e = new CandidateEngine({});
    e.add('666666');
    e.flush();
    const c = e.candidates();
    expect(c.length).toBe(1);
    expect(c[0]!.text).toBe('666666');
  });

  it('发送历史去重含规范化变体（"哈哈哈666" 与 "哈哈哈" 互斥）', () => {
    const { now } = makeClock();
    const e = new CandidateEngine({ now, config: { ...DEFAULT_CONFIG, dedupWindowSec: 120 } });
    e.add('哈哈哈哈哈哈');
    e.flush();
    expect(e.candidates().length).toBe(1);
    e.markSent('哈哈哈哈哈哈'); // 发送后进入 recentSent/sentHistory
    e.flush();
    expect(e.candidates().length).toBe(0);
    // 变体出现在窗口内 → 也被 recentNorms 挡掉
    e.add('哈哈哈哈哈哈666');
    e.flush();
    expect(e.candidates().length).toBe(0);
  });

  it('dedupWindowSec=0 时最近发送去重关闭（历史仍在）', () => {
    const e = new CandidateEngine({ config: { ...DEFAULT_CONFIG, dedupWindowSec: 0 } });
    e.add('测试弹幕abc');
    e.markSent('测试弹幕abc');
    e.flush();
    // window 关闭 → recentTexts 用 cutoff=0，所有 recentSent 都算“不在窗口”？
    // legacy 语义：windowMs=0 → cutoff = now-0 = now → timestamp>now 为假 → 空集合 → 只剩 historySet
    const texts = e.candidates().map(c => c.text);
    expect(texts).not.toContain('测试弹幕abc'); // sentHistory 仍在 → 原文被 historySet 挡
  });

  it('候选按权重降序且 capped 50', () => {
    const e = new CandidateEngine({});
    for (let i = 0; i < 60; i++) e.add('弹幕' + String(i).padStart(2, '0'));
    // 让部分弹幕重复以有权重差
    e.add('弹幕00');
    e.add('弹幕00');
    e.flush();
    const c = e.candidates();
    expect(c.length).toBeLessThanOrEqual(50);
    for (let i = 1; i < c.length; i++) {
      expect(c[i - 1]!.weight).toBeGreaterThanOrEqual(c[i]!.weight);
    }
    expect(c[0]!.text).toBe('弹幕00'); // count=3 权重最高
  });

  it('priorityWords 命中放大权重', () => {
    const e = new CandidateEngine({
      config: { ...DEFAULT_CONFIG, priorityEnabled: true, priorityWeight: 3.0 },
      priorityWords: ['主播'],
    });
    e.add('主播好强啊');
    e.add('随便来一条');
    e.flush();
    const c = e.candidates();
    const w = (t: string) => c.find(x => x.text === t)!.weight;
    expect(w('主播好强啊')).toBeGreaterThan(w('随便来一条'));
  });
});

describe('select（legacy weightedRandomSelect）', () => {
  it('trendingThreshold 命中返回最高 count（趋势置顶）', () => {
    const e = new CandidateEngine({ config: { ...DEFAULT_CONFIG, trendingThreshold: 5 } });
    const list = [
      { text: 'a', count: 1, weight: 100, length: 1 },
      { text: 'b', count: 8, weight: 10, length: 1 },
    ];
    // 即便 b 权重低，count>=5 也置顶返回
    const picked = e.select(list);
    expect(picked!.text).toBe('b');
  });
  it('总权重<=0 回退 candidates[0]', () => {
    const e = new CandidateEngine({ config: { ...DEFAULT_CONFIG, trendingThreshold: 0 } });
    const list = [
      { text: 'a', count: 0, weight: 0, length: 1 },
      { text: 'b', count: 0, weight: 0, length: 1 },
    ];
    expect(e.select(list)!.text).toBe('a');
  });
  it('空候选返回 null', () => {
    const e = new CandidateEngine({});
    expect(e.select([])).toBeNull();
  });
});
