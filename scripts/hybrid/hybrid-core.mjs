// ============================================================================
// 1.2.0 Hybrid 纯逻辑核心（可单测）
// ----------------------------------------------------------------------------
// 本文件同时被两处使用：
//   1) Vitest 直接 import（packages/core/test/hybrid-core.test.ts）
//   2) scripts/build-hybrid.mjs 在构建时剥掉 `export ` 后内联进用户脚本
// 因此这里只放「平台无关、无 GM_/DOM 副作用」的纯函数与可注入依赖的类。
// ============================================================================

/** L3 安全阀默认硬顶（与 SPEC L3 对齐；这些值是「可调上限」的基准，不是建议值） */
export const SAFETY_DEFAULTS = Object.freeze({
  enabled: true,
  minGapMs: 2000,
  perMin: 30,
  perHour: 200,
  perDay: 1000,
  cooldownAfter: 20,
  cooldownMs: 600000,
  pauseWhenHidden: true,
  skipChance: 0.05,
});

/**
 * 硬边界：频次上限只可「更严」（≤默认），间隔/冷却只可「更严」（≥默认）。
 * enabled 不在此列——它恒为 true，用户/导入都无法关闭安全阀（L3 不可绕过）。
 */
export const SAFETY_CAPS = Object.freeze({
  perMin: SAFETY_DEFAULTS.perMin,
  perHour: SAFETY_DEFAULTS.perHour,
  perDay: SAFETY_DEFAULTS.perDay,
  minGapMsFloor: SAFETY_DEFAULTS.minGapMs,
  cooldownAfter: SAFETY_DEFAULTS.cooldownAfter,
  cooldownMsFloor: SAFETY_DEFAULTS.cooldownMs,
  skipChance: 0.5,
});

/**
 * 把任意（可能残缺/被篡改的）配置合并成完整、合法、带上限的配置。
 * 这是 P0-3 的根治点：部分配置不得让任何硬约束变成 undefined 而被跳过。
 */
export function mergeSafetyConfig(raw, defaults = SAFETY_DEFAULTS) {
  const base = { ...defaults };
  const out = { ...base };
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const key of Object.keys(base)) {
      const def = base[key];
      const val = raw[key];
      if (typeof def === 'boolean') {
        if (typeof val === 'boolean') out[key] = val;
      } else if (typeof def === 'number') {
        if (typeof val === 'number' && Number.isFinite(val)) out[key] = val;
      }
    }
  }
  // 类型安全后再夹到硬边界内
  out.perMin = clampInt(out.perMin, 1, SAFETY_CAPS.perMin);
  out.perHour = clampInt(out.perHour, 1, SAFETY_CAPS.perHour);
  out.perDay = clampInt(out.perDay, 1, SAFETY_CAPS.perDay);
  out.cooldownAfter = clampInt(out.cooldownAfter, 1, SAFETY_CAPS.cooldownAfter);
  out.minGapMs = clampInt(out.minGapMs, SAFETY_CAPS.minGapMsFloor, 3600000);
  out.cooldownMs = clampInt(out.cooldownMs, SAFETY_CAPS.cooldownMsFloor, 86400000);
  out.skipChance = Math.min(SAFETY_CAPS.skipChance, Math.max(0, Number(out.skipChance) || 0));
  // L3 不可绕过：安全阀恒启用，配置/导入都无法关闭
  out.enabled = true;
  out.pauseWhenHidden = out.pauseWhenHidden !== false;
  return out;
}

function clampInt(v, min, max) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

/**
 * B 站房间号解析（P0-2）。
 * 支持：/12345、/blanc/12345、/h5/12345、?room_id=12345，以及 blanc iframe 用父文档 URL 兜底。
 * @param {string} href 当前文档 URL
 * @param {string} [topHref] 同源父文档 URL（跨域时调用方传空）
 * @returns {number} 房间号；解析失败返回 0
 */
export function parseBiliRoomId(href, topHref) {
  return pickRoomId(href) || pickRoomId(topHref) || 0;
}

function pickRoomId(href) {
  if (!href || typeof href !== 'string') return 0;
  const pathMatch = /live\.bilibili\.com\/(?:blanc\/|h5\/)?(\d+)/.exec(href);
  if (pathMatch) return parseInt(pathMatch[1], 10) || 0;
  const queryMatch = /[?&]room_?id=(\d+)/i.exec(href);
  if (queryMatch) return parseInt(queryMatch[1], 10) || 0;
  return 0;
}

/** 导出包结构校验（P0-3 的第二半：旧实现校验错了对象层级，等于没校验） */
export function validateConfigBundle(bundle) {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) return '不是有效 JSON 对象';
  if (bundle.__lgjExport !== 1) return '缺少 __lgjExport=1 标记（非烂梗机导出文件）';

  const cfg = bundle.config;
  if (cfg !== undefined) {
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return 'config 应为对象';
    const numKeys = ['minMsgLength', 'lengthThreshold', 'lengthBonus', 'trendingThreshold',
      'dedupWindowSec', 'dedupHistorySize', 'crazyModeDPM', 'crazyInterval',
      'normalModeDPM', 'normalIntervalMin', 'normalIntervalMax', 'zenInterval', 'priorityWeight'];
    for (const key of numKeys) {
      if (key in cfg && (typeof cfg[key] !== 'number' || !Number.isFinite(cfg[key]))) {
        return `config.${key} 应为有限数字`;
      }
    }
  }
  if (bundle.theme !== undefined && (!bundle.theme || typeof bundle.theme !== 'object' || Array.isArray(bundle.theme))) {
    return 'theme 应为对象';
  }
  for (const key of ['blocklist', 'priority', 'filterRules']) {
    if (bundle[key] !== undefined && !Array.isArray(bundle[key])) return `${key} 应为数组`;
  }
  if (bundle.engine !== undefined && (!bundle.engine || typeof bundle.engine !== 'object' || Array.isArray(bundle.engine))) {
    return 'engine 应为对象';
  }
  if (bundle.safety !== undefined && (!bundle.safety || typeof bundle.safety !== 'object' || Array.isArray(bundle.safety))) {
    return 'safety 应为对象';
  }
  return null;
}

/**
 * 系统弹幕/公告/礼物/进场/粉丝团等「非正常弹幕」启发式识别。
 * 目标：把平台自己发的欢迎语、公告、礼物、进场、关注、粉丝团、风控提示等排除出候选池，
 * 同时尽量不误杀正常玩家弹幕。长文本（>80）交给屏蔽词规则，不在此误杀。
 */
export const SYSTEM_DANMAKU_PATTERNS = [
  /^(欢迎来到|欢迎.{0,12}(进入|来到)直播间)/,
  /^(系统消息|系统公告|温馨提示|直播间提示|本直播间|公告|通知|提醒)/,
  /(关注了主播|关注了直播间|点关注|关注主播|点击关注|求关注|没点关注的)/,
  /^(感谢|谢谢).{0,8}(关注|礼物|打赏|投喂|支持)/,
  /(送出了|赠送了|投喂了|打赏了|送出了礼物|开通了|续费了|送出了.{0,6}(火箭|飞机|礼物))/,
  /(加入了粉丝团|加入粉丝团|粉丝团|粉丝牌|点亮了|勋章|大航海|舰长|提督|总督|守护)/,
  /^.{1,16}(进入了直播间|来到了直播间|进入直播间|离开了直播间)$/,
  /^(恭喜.{0,8}(中奖|获奖|获得|抽中)|中奖|获奖|抽奖|打卡|签到|领取)/,
  /(禁言|封禁|违规|警告|举报|管理员|房管|超管)/,
  /^(主播|直播|房间)(已|即将|正在)?(开播|下播|上播|关闭)/,
  /^(当前|本场|今日|今晚).{0,10}(人气|热度|排名|榜单)/,
];

export function isSystemDanmaku(text) {
  const t = String(text).trim();
  if (!t) return false;
  if (t.length > 80) return false; // 长文本更可能是正常弹幕/广告，交给屏蔽词
  for (const re of SYSTEM_DANMAKU_PATTERNS) if (re.test(t)) return true;
  return false;
}


/**
 * 可持久化、跨标签近似同步的 L3 安全阀。
 * 依赖注入（storage / now / isHidden / rand），因此可在 Node 中完整单测。
 *
 * 设计要点：
 * - 配置与计数分离存储：配置 LGJ_SAFETY_v1，计数 LGJ_SAFETY_STATE_v1；
 * - 计数落盘（节流）+ 跨标签按槽取 max 合并 → 刷新页面不再清零（P0-4）；
 * - allow() 只做判定，note() 才计数；RANDOM_SKIP 由调用方按「不可重试」处理（P1-7）；
 * - 任何配置残缺都先 mergeSafetyConfig，硬上限不可被 undefined 绕过（P0-3）。
 */
export class HybridSafety {
  constructor(opts = {}) {
    this.now = opts.now || (() => Date.now());
    this.isHidden = opts.isHidden || (() => false);
    this.rand = opts.rand || Math.random;
    this.storage = opts.storage || null;
    this.limitsKey = opts.limitsKey || 'LGJ_SAFETY_v1';
    this.stateKey = opts.stateKey || 'LGJ_SAFETY_STATE_v1';
    this.ackKey = opts.ackKey || 'LGJ_ACK_v1';

    this.limits = mergeSafetyConfig(opts.limits);
    this.ring = Object.create(null);
    this.textCnt = Object.create(null);
    this.lastSentAt = 0;
    this.circuitUntil = 0;
    this.lastReason = '';
    this.lastReasonText = '';
    this._lastPersist = 0;
    this._lastLoad = 0;
    this._dirty = false;
    this._load();
  }

  // ---- 风险确认（fail-closed：未确认一律拒发） ----
  ackConfirmed() {
    if (!this.storage) return false;
    try {
      const v = this.storage.get(this.ackKey, null);
      return v === 1 || v === true || v === '1' || !!(v && v.ok === 1);
    } catch (_) {
      return false;
    }
  }

  confirmAck() {
    if (!this.storage) return;
    try { this.storage.set(this.ackKey, { ok: 1 }); } catch (_) { /* 忽略 */ }
  }

  // ---- 配置 ----
  getConfig() {
    return { ...this.limits };
  }

  setConfig(patch) {
    this.limits = mergeSafetyConfig({ ...this.limits, ...(patch || {}) }, this.limits);
    if (this.storage) {
      try { this.storage.set(this.limitsKey, this.limits); } catch (_) { /* 忽略 */ }
    }
  }

  // ---- 判定 ----
  allow(text, at) {
    const now = at ?? this.now();
    this.lastReason = '';
    this.lastReasonText = '';

    // 每 3s 与其它标签页/上次会话合并一次计数（避免频繁读存储）
    if (this.storage && now - this._lastLoad > 3000) this._load();

    if (!this.ackConfirmed()) return this._deny('ACK_REQUIRED', '请先阅读并在面板确认风险声明');
    // 注意：没有 enabled 开关——安全阀恒启用，任何配置都无法绕过
    if (this.limits.pauseWhenHidden && this.isHidden()) return this._deny('HIDDEN', '页面不可见（切后台）不发');
    if (this.circuitUntil > now) return this._deny('CIRCUIT', '平台风控熔断中');

    if (this.limits.minGapMs > 0 && this.lastSentAt > 0
      && now - this.lastSentAt < this.limits.minGapMs) {
      return this._deny('MIN_GAP', '发送过密（最小间隔）');
    }

    const rec = this.textCnt[text];
    if (rec && rec.until > now) return this._deny('TEXT_COOLDOWN', '同一句冷却中');

    const minute = Math.floor(now / 60000);
    if (this._windowSum(minute, 0) >= this.limits.perMin) return this._deny('PER_MIN', '每分钟上限');
    if (this._windowSum(minute, 60) >= this.limits.perHour) return this._deny('PER_HOUR', '每小时上限');
    if (this._windowSum(minute, 1440) >= this.limits.perDay) return this._deny('PER_DAY', '每日上限');

    if (this.limits.skipChance > 0 && this.rand() < this.limits.skipChance) {
      return this._deny('RANDOM_SKIP', '人类化随机跳过');
    }
    return true;
  }

  _deny(reason, text) {
    this.lastReason = reason;
    this.lastReasonText = text;
    return false;
  }

  /** 发送成功后登记（必须在 allow() 通过后调用） */
  note(text, at) {
    const now = at ?? this.now();
    this.lastSentAt = now;
    const minute = Math.floor(now / 60000);
    this.ring[minute] = (this.ring[minute] || 0) + 1;

    const rec = this.textCnt[text] || { n: 0, until: 0 };
    rec.n += 1;
    if (rec.n >= this.limits.cooldownAfter) {
      rec.n = 0;
      rec.until = now + this.limits.cooldownMs;
    }
    this.textCnt[text] = rec;

    this._prune(now);
    this._persist(false);
  }

  /** 平台风控信号 → 熔断 */
  trip(at, openMs = 600000) {
    const now = at ?? this.now();
    this.circuitUntil = Math.max(this.circuitUntil, now + Math.max(1000, Number(openMs) || 600000));
    this._persist(true);
  }

  refresh() {
    this._load();
  }

  flush() {
    if (this._dirty) this._persist(true);
  }

  reason() { return this.lastReason; }
  reasonText() { return this.lastReasonText; }

  // ---- 内部 ----
  _windowSum(nowMinute, winMin) {
    let sum = 0;
    for (let m = nowMinute - winMin; m <= nowMinute; m++) {
      sum += this.ring[m] || 0;
    }
    return sum;
  }

  _load() {
    this._lastLoad = this.now();
    if (!this.storage) return;
    let s = null;
    try { s = this.storage.get(this.stateKey, null); } catch (_) { s = null; }
    if (!s || typeof s !== 'object') return;

    if (s.ring && typeof s.ring === 'object') {
      for (const key of Object.keys(s.ring)) {
        const v = Number(s.ring[key]) || 0;
        this.ring[key] = Math.max(this.ring[key] || 0, v);
      }
    }
    if (s.textCnt && typeof s.textCnt === 'object') {
      for (const key of Object.keys(s.textCnt)) {
        const r = s.textCnt[key];
        if (!r || typeof r !== 'object') continue;
        const cur = this.textCnt[key] || { n: 0, until: 0 };
        this.textCnt[key] = {
          n: Math.max(cur.n, Number(r.n) || 0),
          until: Math.max(cur.until, Number(r.until) || 0),
        };
      }
    }
    if (typeof s.lastSentAt === 'number') this.lastSentAt = Math.max(this.lastSentAt, s.lastSentAt);
    if (typeof s.circuitUntil === 'number') this.circuitUntil = Math.max(this.circuitUntil, s.circuitUntil);
  }

  _persist(force) {
    if (!this.storage) return;
    const now = this.now();
    if (!force && now - this._lastPersist < 1000) { this._dirty = true; return; }
    this._lastPersist = now;
    this._dirty = false;
    try {
      this.storage.set(this.stateKey, {
        ring: this.ring,
        textCnt: this.textCnt,
        lastSentAt: this.lastSentAt,
        circuitUntil: this.circuitUntil,
        ts: now,
      });
    } catch (_) { /* 忽略 */ }
  }

  _prune(now) {
    const keys = Object.keys(this.ring);
    if (keys.length > 2000) {
      const cutoff = Math.floor(now / 60000) - 1500;
      const next = Object.create(null);
      for (const key of keys) {
        if (parseInt(key, 10) > cutoff) next[key] = this.ring[key];
      }
      this.ring = next;
    }
    const stale = now - 86400000;
    for (const key of Object.keys(this.textCnt)) {
      const rec = this.textCnt[key];
      if (rec && rec.n === 0 && rec.until < stale) delete this.textCnt[key];
    }
  }
}

/**
 * B 站弹幕发送接口返回码 → 归一化结果。
 * fallback=true 表示「本次协议发送不可用，可安全回落 DOM」（请求未被平台受理）；
 * 其余失败一律不回落，避免「请求已到达但响应异常」时双发。
 */
export function mapBiliSendCode(code) {
  switch (Number(code)) {
    case 0: return { ok: true, code: 'OK', fallback: false };
    case -101: return { ok: false, code: 'NOT_LOGGED_IN', fallback: true };
    case -111: return { ok: false, code: 'CSRF_MISSING', fallback: true };
    case -400: return { ok: false, code: 'BAD_REQUEST', fallback: false };
    case -403: return { ok: false, code: 'FORBIDDEN', fallback: false };
    case -412: return { ok: false, code: 'RATE_LIMITED', fallback: false };
    case 10030: return { ok: false, code: 'RATE_LIMITED', fallback: false };
    case 1003212: return { ok: false, code: 'REJECTED', fallback: false };
    default: return { ok: false, code: 'UNKNOWN', fallback: false };
  }
}

/**
 * 多标签 leader 选举（L4）。
 * - 共享 KV 的带过期租约保证「同一时刻只有一个标签页发送」；
 * - 写后回读：并发写时只有最后写入者认为自己是 leader，其余立即转 follower；
 * - storage 不可用时退化为「总是 leader」（单标签场景）。
 */
export class LeaderElection {
  constructor(opts = {}) {
    this.tabId = opts.tabId || ('t' + Math.random().toString(36).slice(2, 10));
    this.key = opts.key || 'LGJ_LEADER_v1';
    this.leaseMs = Math.max(3000, Number(opts.leaseMs) || 15000);
    this.storage = opts.storage || null;
    this.now = opts.now || (() => Date.now());
    this.post = typeof opts.post === 'function' ? opts.post : null;
    this.onChange = typeof opts.onChange === 'function' ? opts.onChange : (() => {});
    this.leaderId = '';
    this._timer = null;
  }
  isLeader() {
    if (!this.storage) return true;
    if (this.leaderId !== this.tabId) return false;
    // 发送前校验租约：缩小「旧 leader 租约已过期、但还没到下个 tick」的双发窗口
    try {
      const lease = this.storage.get(this.key, null);
      const now = this.now();
      if (lease && lease.tabId && lease.tabId !== this.tabId && (Number(lease.expiresAt) || 0) > now) {
        this._setLeader(lease.tabId);
        return false;
      }
    } catch (_) { /* 忽略 */ }
    return true;
  }
  start() {
    this.tick();
    if (!this._timer) this._timer = setInterval(() => this.tick(), 5000);
  }
  stop() { if (this._timer) { clearInterval(this._timer); this._timer = null; } }
  tick() {
    const now = this.now();
    let lease = null;
    try { lease = this.storage ? this.storage.get(this.key, null) : null; } catch (_) { lease = null; }
    const active = lease && typeof lease === 'object' && lease.tabId && (Number(lease.expiresAt) || 0) > now;
    if (active && lease.tabId !== this.tabId) {
      this._setLeader(lease.tabId);
      return;
    }
    try {
      if (this.storage) this.storage.set(this.key, { tabId: this.tabId, expiresAt: now + this.leaseMs });
    } catch (_) { /* 忽略 */ }
    let after = null;
    try { after = this.storage ? this.storage.get(this.key, null) : null; } catch (_) { after = null; }
    if (!after || after.tabId === this.tabId) {
      this._setLeader(this.tabId);
      if (this.post) { try { this.post({ t: 'hb', tabId: this.tabId, ts: now }); } catch (_) { /* 忽略 */ } }
    } else {
      this._setLeader(after.tabId);
    }
  }
  onMessage(msg) {
    if (!msg || msg.tabId === this.tabId) return;
    if (msg.t === 'hb' || msg.t === 'leader') {
      const now = this.now();
      let lease = null;
      try { lease = this.storage ? this.storage.get(this.key, null) : null; } catch (_) { lease = null; }
      // 只在对方租约确实有效时才让位，避免伪造 hb 抢主
      if (lease && lease.tabId === msg.tabId && (Number(lease.expiresAt) || 0) > now) {
        this._setLeader(msg.tabId);
      } else if (!lease && String(msg.tabId) < String(this.tabId)) {
        // 兜底：某些管理器 GM 存储按标签页隔离（租约不可见）→ 用 tabId 字典序收敛
        this._setLeader(msg.tabId);
      }
    }
  }
  _setLeader(id) {
    if (this.leaderId === id) return;
    this.leaderId = id;
    this.onChange(id === this.tabId);
  }
}


