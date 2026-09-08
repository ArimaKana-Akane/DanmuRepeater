// 文本归一化与系统弹幕判定 —— legacy(1.1.20) 行为逐字迁移

/** 规范化文本：去数字、标点、符号（用于智能去重合并） */
export function normalizeText(text: string): string {
  return text.replace(/[\d\p{P}\p{S}]/gu, '').trim();
}

/**
 * 系统弹幕过滤：欢迎语/公告/提示类弹幕不入候选。
 * 行为冻结自 legacy(1.1.20)。注意「本直播间」前缀+短文本(<=40)会命中——
 * 这是用户确认过的产品行为（1.1.20 changelog 注记），不得静默修改。
 */
export function isSystemDanmaku(text: string): boolean {
  const t = String(text).trim();
  if (!t) return false;
  if (/^(欢迎来到|系统消息|温馨提示|欢迎.{0,12}进入直播间)/.test(t)) return true;
  if (t.length <= 40 && /^(温馨提示|系统公告|直播间提示|本直播间)/.test(t)) return true;
  return false;
}
