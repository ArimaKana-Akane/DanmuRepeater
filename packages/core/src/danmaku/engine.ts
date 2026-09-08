// 候选引擎：频率窗口 / 权重 / 候选生成 / 选择 —— legacy(1.1.20) 纯逻辑迁移
// 冻结基线：算法与 legacy addDanmuToCache/updateWeights/getWeightedCandidates/
//          weightedRandomSelect 逐字一致；仅把副作用（DOM/定时器/全局 state）剔除。
import { DEFAULT_CONFIG, TIMING, type BotConfig } from '../constants.js';
import { cachedRegex, isBlocked, isRegexPattern, type BlockContext } from './rules.js';
import { normalizeText } from './normalize.js';

export interface FreqEntry {
  count: number;
  lastSeen: number;
}
export interface WeightedEntry {
  count: number;
  weight: number;
}
export interface CandidateItem {
  text: string;
  count: number;
  weight: number;
  length: number;
}
export interface SentRecord {
  text: string;
  timestamp: number;
}

export interface EngineOptions {
  config?: BotConfig;
  blocklist?: string[];
  priorityWords?: string[];
  now?: () => number;
}

/** 纯函数候选引擎：外部通过 add()/markSent() 喂事件，flush() 后取 candidates() */
export class CandidateEngine {
  private readonly cfg: BotConfig;
  private readonly block: BlockContext;
  private readonly now: () => number;
  private priorityWords: string[];
  private freqMap = new Map<string, FreqEntry>();
  private weightedMap = new Map<string, WeightedEntry>();
  private recentSent: SentRecord[] = [];
  private sentHistory: string[] = [];
  private dirty = false;
  candidateCount = 0;

  constructor(opts: EngineOptions = {}) {
    this.cfg = { ...DEFAULT_CONFIG, ...(opts.config || {}) };
    this.block = { blocklist: opts.blocklist || [], filterRules: this.cfg.filterRules || [] };
    this.priorityWords = opts.priorityWords || [];
    this.now = opts.now || (() => Date.now());
  }

  setBlocklist(list: string[]): void {
    this.block.blocklist = list;
  }
  setPriorityWords(list: string[]): void {
    this.priorityWords = list;
  }
  setFilterRules(rules: BotConfig['filterRules']): void {
    this.block.filterRules = rules;
    this.cfg.filterRules = rules;
  }
  config(): BotConfig {
    return { ...this.cfg, theme: { ...this.cfg.theme } };
  }
  freqSize(): number {
    return this.freqMap.size;
  }

  /** 入站弹幕（已通过 isSystemDanmaku 的常规弹幕才喂入） */
  add(text: string): void {
    if (!text) return;
    const now = this.now();
    const existing = this.freqMap.get(text);
    if (existing && now - existing.lastSeen < TIMING.FREQ_WINDOW_MS) {
      this.freqMap.set(text, { count: existing.count + 1, lastSeen: now });
    } else {
      this.freqMap.set(text, { count: 1, lastSeen: now });
    }
    if (this.freqMap.size > TIMING.DANMU_CACHE_MAX) {
      const entries = [...this.freqMap.entries()].sort((a, b) => b[1].count - a[1].count);
      this.freqMap = new Map(entries.slice(0, TIMING.DANMU_CACHE_MAX));
    }
    this.dirty = true;
  }

  /** 发送成功后登记历史（供去重） */
  markSent(text: string): void {
    const now = this.now();
    this.recentSent.push({ text, timestamp: now });
    this.sentHistory.push(text);
    // legacy: dedupHistorySize 截断 sentHistory
    const max = this.cfg.dedupHistorySize;
    if (max > 0 && this.sentHistory.length > max) {
      this.sentHistory = this.sentHistory.slice(-max);
    }
    this.dirty = true;
  }

  /** 等价 legacy updateWeights() */
  flush(): void {
    this.dirty = false;
    const now = this.now();
    const windowMs = this.cfg.dedupWindowSec * 1000;
    const cutoff = windowMs > 0 ? now - windowMs : 0;

    const recentTexts = new Set(this.recentSent.filter(m => m.timestamp > cutoff).map(m => m.text));
    const historySet = new Set(this.sentHistory);
    const recentNorms = new Set(
      this.recentSent.filter(m => m.timestamp > cutoff).map(m => normalizeText(m.text)).filter(Boolean),
    );
    const historyNorms = new Set(this.sentHistory.map(normalizeText).filter(Boolean));

    const newMap = new Map<string, WeightedEntry>();
    for (const [text, data] of this.freqMap) {
      if (text.length < this.cfg.minMsgLength) continue;
      if (isBlocked(text, this.block)) continue;
      const norm = normalizeText(text);
      if (recentTexts.has(text) || (norm && recentNorms.has(norm))) continue;
      if (historySet.has(text) || (norm && historyNorms.has(norm))) continue;
      if (now - data.lastSeen > TIMING.FREQ_WINDOW_MS) continue;
      const weight =
        data.count * data.count * this.getLengthMultiplier(text) * this.getPriorityMultiplier(text);
      newMap.set(text, { count: data.count, weight });
    }
    this.weightedMap = newMap;

    for (const [text, data] of this.freqMap) {
      if (now - data.lastSeen > TIMING.FREQ_WINDOW_MS) this.freqMap.delete(text);
    }
  }

  /** 等价 legacy getWeightedCandidates()：脏时同步 flush */
  candidates(): CandidateItem[] {
    if (this.dirty) this.flush();
    let list: CandidateItem[] = [];
    for (const [text, data] of this.weightedMap) {
      list.push({ text, count: data.count, weight: data.weight, length: text.length });
    }
    const normMap = new Map<string, CandidateItem>();
    for (const c of list) {
      const norm = normalizeText(c.text);
      const key = norm || c.text; // 纯数字/符号弹幕回退原文，不淘汰
      const existing = normMap.get(key);
      if (!existing || existing.weight < c.weight) normMap.set(key, c);
    }
    list = [...normMap.values()];
    list.sort((a, b) => b.weight - a.weight);
    if (list.length > TIMING.MAX_CANDIDATES) list = list.slice(0, TIMING.MAX_CANDIDATES);
    this.candidateCount = list.length;
    return list;
  }

  /** 等价 legacy weightedRandomSelect() */
  select(candidates: CandidateItem[]): CandidateItem | null {
    if (!candidates.length) return null;
    const first = candidates[0]!;
    if (this.cfg.trendingThreshold > 0) {
      let top = first;
      for (const c of candidates) if (c.count > top.count) top = c;
      if (top.count >= this.cfg.trendingThreshold) return top;
    }
    let total = 0;
    for (const c of candidates) total += c.weight;
    if (total <= 0) return first;
    let rand = Math.random() * total;
    for (const c of candidates) {
      rand -= c.weight;
      if (rand < 0) return c;
    }
    return candidates[candidates.length - 1]!;
  }

  private getLengthMultiplier(text: string): number {
    return text.length > this.cfg.lengthThreshold ? this.cfg.lengthBonus : 1;
  }

  /** legacy getPriorityMultiplier：优先词命中即乘 priorityWeight */
  private getPriorityMultiplier(text: string): number {
    if (!this.cfg.priorityEnabled || !this.priorityWords.length) return 1;
    for (const word of this.priorityWords) {
      if (!word) continue;
      const matched = isRegexPattern(word)
        ? (() => {
            const re = cachedRegex(word.slice(1, -1));
            return re ? re.test(text) : false;
          })()
        : text.toLowerCase().includes(word.toLowerCase());
      if (matched) return this.cfg.priorityWeight;
    }
    return 1;
  }
}
