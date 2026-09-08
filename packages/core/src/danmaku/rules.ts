// 屏蔽词 / 筛选规则 / 权重加成 —— legacy(1.1.20) 行为逐字迁移
import type { FilterRule } from '../constants.js';

const regexCache = new Map<string, RegExp | null>();

export function cachedRegex(pattern: string, flags?: string): RegExp | null {
  const f = flags || 'i';
  const key = `${f}\u0000${pattern}`;
  if (regexCache.has(key)) return regexCache.get(key)!;
  try {
    const re = new RegExp(pattern, f);
    regexCache.set(key, re);
    return re;
  } catch (_) {
    regexCache.set(key, null);
    return null;
  }
}

/** 判断文本是否为「/xxx/」形式的正则 */
export function isRegexPattern(str: string): boolean {
  return str.startsWith('/') && str.endsWith('/') && str.length > 2;
}

function evaluateLengthRule(len: number, op: string | undefined, value: number): boolean {
  switch (op) {
    case '>': return len > value;
    case '<': return len < value;
    case '>=': return len >= value;
    case '<=': return len <= value;
    case '==': return len === value;
    default: return true;
  }
}

/** 解析单条筛选规则（>= <= == 需在 > < 之前判断；regex 支持 /xxx/ 字面量） */
export function parseFilterRule(line: string): FilterRule | null {
  const patterns: { prefix: string; type: FilterRule['type']; op?: FilterRule['op'] }[] = [
    { prefix: 'length>=', type: 'length', op: '>=' },
    { prefix: 'length<=', type: 'length', op: '<=' },
    { prefix: 'length==', type: 'length', op: '==' },
    { prefix: 'length>', type: 'length', op: '>' },
    { prefix: 'length<', type: 'length', op: '<' },
    { prefix: 'contains:', type: 'contains' },
    { prefix: 'not_contains:', type: 'not_contains' },
    { prefix: 'regex:', type: 'regex' },
  ];
  for (const { prefix, type, op } of patterns) {
    if (!line.startsWith(prefix)) continue;
    const raw = line.slice(prefix.length).trim();
    if (!raw) return null;
    if (type === 'length') {
      const val = parseInt(raw, 10);
      return isNaN(val) ? null : { type, op, value: val };
    }
    if (type === 'regex') {
      const m = /^\/([\s\S]+)\/([gimsuy]*)$/.exec(raw);
      return { type, value: m ? m[1]! : raw, flags: m && m[2] ? m[2] : 'i' };
    }
    return { type, value: raw };
  }
  return null;
}

export function parseFilterRules(text: string): FilterRule[] {
  const rules: FilterRule[] = [];
  for (const line of String(text).split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const rule = parseFilterRule(t);
    if (rule) rules.push(rule);
  }
  return rules;
}

export function formatFilterRuleForDisplay(r: FilterRule): string {
  if (r.type === 'length') return `length${r.op}${r.value}`;
  if (r.type === 'contains') return `contains:${r.value}`;
  if (r.type === 'not_contains') return `not_contains:${r.value}`;
  return `regex:/${r.value}/${r.flags || 'i'}`;
}

export interface BlockContext {
  blocklist: string[];
  filterRules: FilterRule[];
}

/** 命中屏蔽/规则即 true（该弹幕应被排除）。行为冻结自 legacy isBlocked */
export function isBlocked(text: string, ctx: BlockContext): boolean {
  for (const rule of ctx.blocklist) {
    if (!rule) continue;
    if (isRegexPattern(rule)) {
      const re = cachedRegex(rule.slice(1, -1));
      if (re && re.test(text)) return true;
    } else if (text.toLowerCase().includes(rule.toLowerCase())) {
      return true;
    }
  }
  for (const rule of ctx.filterRules) {
    if (rule.type === 'length') {
      if (!evaluateLengthRule(text.length, rule.op, rule.value as number)) return true;
    } else if (rule.type === 'contains') {
      if (!text.includes(String(rule.value))) return true;
    } else if (rule.type === 'not_contains') {
      if (text.includes(String(rule.value))) return true;
    } else if (rule.type === 'regex') {
      const re = cachedRegex(String(rule.value), rule.flags);
      if (re && !re.test(text)) return true;
    }
  }
  return false;
}
