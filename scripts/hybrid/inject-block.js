(function () {
  'use strict';
  // ================= 1.2.0 Hybrid 引擎（构建时注入 legacy 尾部）=================
  // 设计：不重构 legacy；本块在 legacy 同一作用域追加——
  //  1) 协议源（B 站自连 wss）与 DOM 源互斥切换，绝不同时写 freqMap/timestamps（P0-1）
  //  2) 房间号解析支持 /blanc//h5/ 与父文档兜底（P0-2）
  //  3) L3 安全阀：配置合并 + 硬上限夹取 + 计数持久化 + 跨标签近似同步（P0-3/P0-4）
  //  4) 协议断线指数退避重连，多次失败回落 DOM（P1-6）
  //  5) 协议源随机器人开关启停；关闭时不连 wss（P1-5）
  //  6) 面板被 SPA 重建后自动重挂引擎 UI（P1-8）
  //  7) 持久化环形日志读回内存，导出/诊断可见（P1-9）
  // 纯逻辑（安全阀/房间号/导出校验）在 scripts/hybrid/hybrid-core.mjs，构建时内联，
  // 同一份代码由 Vitest 单测覆盖（不再出现「测 A 发 B」）。

  //__MD5_BODY__

  //__HYBRID_CORE__

  var CFG_KEY = 'LGJ_ENGINE_v1';
  var SAFETY_KEY = 'LGJ_SAFETY_v1';
  var SAFETY_STATE_KEY = 'LGJ_SAFETY_STATE_v1';
  var ACK_KEY = 'LGJ_ACK_v1';
  var MIXIN = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52];

  // ---------------- 存储 / 日志 ----------------
  function gmGet(key, fallback) {
    try {
      var raw = GM_getValue(key, null);
      if (raw === null || raw === undefined) return fallback;
      if (typeof raw === 'string') { try { return JSON.parse(raw); } catch (_e) { return raw; } }
      return raw;
    } catch (_e) { return fallback; }
  }
  function gmSet(key, value) {
    try { GM_setValue(key, JSON.stringify(value)); } catch (_e) { /* 忽略 */ }
  }
  function loadCfg() {
    var c = gmGet(CFG_KEY, {});
    return (c && typeof c === 'object' && !Array.isArray(c)) ? c : {};
  }
  function saveCfg(patch) {
    var c = loadCfg();
    for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) c[k] = patch[k];
    gmSet(CFG_KEY, c);
  }
  function loadJson(key, def) {
    var v = gmGet(key, def);
    return (v && typeof v === 'object' && !Array.isArray(v)) ? v : def;
  }
  function loadJsonArr(key) {
    var v = gmGet(key, []);
    return Array.isArray(v) ? v : [];
  }
  function _plat() {
    var h = location.hostname;
    if (h.indexOf('douyu.com') >= 0) return 'douyu';
    if (h.indexOf('huya.com') >= 0) return 'huya';
    if (h.indexOf('bilibili.com') >= 0) return 'bilibili';
    if (h.indexOf('douyin.com') >= 0) return 'douyin';
    return 'unknown';
  }
  function _ringKey() { return _plat() + '_lgj_ringlog'; }

  var _ringBuffer = null;
  var _ringFlushTimer = null;
  function ringLog(level, content) {
    try {
      if (!_ringBuffer) _ringBuffer = loadJsonArr(_ringKey());
      _ringBuffer.push({ level: level, content: content, ts: Date.now() });
      if (_ringBuffer.length > 200) _ringBuffer = _ringBuffer.slice(-200);
      if (!_ringFlushTimer) {
        _ringFlushTimer = setTimeout(function () { _ringFlushTimer = null; flushRingLog(); }, 2000);
      }
    } catch (_e) { /* 忽略 */ }
  }
  function flushRingLog() {
    if (!_ringBuffer) return;
    try { GM_setValue(_ringKey(), JSON.stringify(_ringBuffer)); } catch (_e) { /* 忽略 */ }
  }
  /** P1-9：把上次会话的持久化日志读回内存 Logger，使设置页导出/诊断可见 */
  function restoreRingLog() {
    try {
      var persisted = loadJsonArr(_ringKey());
      if (!persisted.length) return;
      var merged = persisted.concat(Logger.getAll());
      var seen = Object.create(null);
      var out = [];
      for (var i = merged.length - 1; i >= 0; i--) {
        var l = merged[i];
        if (!l || typeof l !== 'object') continue;
        var k = (l.ts || 0) + '|' + (l.level || '') + '|' + (l.content || '');
        if (seen[k]) continue;
        seen[k] = 1;
        out.unshift(l);
      }
      Logger._logs = out.slice(-Logger._maxLogs || -500);
    } catch (_e) { /* 忽略 */ }
  }
  function hookRingLog() {
    try {
      var orig = Logger._push;
      Logger._push = function (level, content) {
        orig.call(Logger, level, content);
        ringLog(level, content);
      };
    } catch (_e) { /* 忽略 */ }
  }

  // ---------------- 事件日志（升级版日志：引擎/协议/安全阀/选择等，不只发送内容） ----------------
  var _autoWarned = false;
  function logEvent(tag, content) {
    try { console.log('[' + tag + '] ' + content); } catch (_e) { /* 忽略 */ }
    try { Logger._push('event', (tag ? tag + ' | ' : '') + content); } catch (_e2) { /* 忽略 */ }
  }
  window.__lgjLog = logEvent;
  window.__lgjSendCtx = function () {
    try {
      var d = window.__lgjLastDecision;
      if (!d) return '';
      return '模式=' + (state.currentMode || '-')
        + ' DPM=' + getMessagesPerMinute()
        + ' 来源=' + (window.__lgjSourceKind === 'protocol' ? '协议' : 'DOM')
        + ' 权重=' + (d.weight ? Number(d.weight).toFixed(1) : '-')
        + ' boost=' + (d.boost ? Number(d.boost).toFixed(2) : '1.00')
        + ' 候选=' + (state.candidateCount || 0);
    } catch (_e) { return ''; }
  };
  window.__lgjOnSelect = function (selected, candidates) {
    try {
      if (!selected) return;
      var boost = window.__lgjMetaBoost ? window.__lgjMetaBoost(selected.text) : 1;
      window.__lgjLastDecision = {
        text: selected.text, count: selected.count, weight: selected.weight,
        boost: boost, total: candidates ? candidates.length : 0,
      };
      logEvent('选择', '"' + String(selected.text).slice(0, 30) + '" 权重=' + Number(selected.weight || 0).toFixed(1)
        + ' boost=' + Number(boost || 1).toFixed(2)
        + ' 频次=' + (selected.count || 0)
        + ' 候选=' + (candidates ? candidates.length : 0)
        + ' DPM=' + getMessagesPerMinute()
        + ' 来源=' + (window.__lgjSourceKind === 'protocol' ? '协议' : 'DOM'));
    } catch (_e) { /* 忽略 */ }
  };
  // 系统弹幕过滤计数 + 60s 采集摘要（让日志有内容，不再只有“发送成功”）
  var _sysFiltered = 0;
  window.__lgjCountSystemFiltered = function (text) {
    try {
      _sysFiltered++;
      if (_sysFiltered % 20 === 0) {
        logEvent('过滤', '已排除 ' + _sysFiltered + ' 条系统弹幕（最近：' + String(text || '').slice(0, 30) + '）');
      }
    } catch (_e) { /* 忽略 */ }
  };
  function logPeriodicSummary() {
    try {
      if (!state.isRunning) return;
      logEvent('采集', '近60s DPM=' + getMessagesPerMinute()
        + ' 候选=' + (state.candidateCount || 0)
        + ' freq=' + (state.freqMap ? state.freqMap.size : 0)
        + ' 系统过滤=' + _sysFiltered
        + ' 来源=' + (window.__lgjSourceKind === 'protocol' ? '协议' : 'DOM')
        + ' 模式=' + (state.currentMode || '-')
        + ' 引擎=' + mode);
      _sysFiltered = 0;
    } catch (_e) { /* 忽略 */ }
  }


  // ---------------- 跨域 HTTP（GM_xmlhttpRequest 优先，绕过 CORS；否则 fetch） ----------------
  function readCookie(name) {
    try {
      var safe = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      var m = document.cookie.match(new RegExp('(?:^|;\\s*)' + safe + '=([^;]*)'));
      return m && m[1] ? decodeURIComponent(m[1]) : '';
    } catch (_e) { return ''; }
  }
  function httpJson(url, opts) {
    opts = opts || {};
    var method = opts.method || 'GET';
    var headers = opts.headers || {};
    if (typeof GM_xmlhttpRequest === 'function') {
      return new Promise(function (resolve, reject) {
        try {
          GM_xmlhttpRequest({
            method: method, url: url, headers: headers, data: opts.data,
            timeout: opts.timeout || 15000,
            onload: function (res) {
              try { resolve(JSON.parse(res.responseText)); } catch (_e2) { reject(new Error('bad-json')); }
            },
            onerror: function () { reject(new Error('xhr-error')); },
            ontimeout: function () { reject(new Error('xhr-timeout')); },
          });
        } catch (e) { reject(e); }
      });
    }
    return fetch(url, {
      method: method, headers: headers, body: opts.data, credentials: 'include',
    }).then(function (r) { return r.json(); });
  }
  var _realRoomCache = Object.create(null);
  function resolveRealRoomId(room) {
    if (_realRoomCache[room]) return Promise.resolve(_realRoomCache[room]);
    return httpJson('https://api.live.bilibili.com/room/v1/Room/room_init?id=' + encodeURIComponent(room))
      .then(function (j) {
        var real = j && j.data && (j.data.room_id || j.data.roomid);
        if (real) _realRoomCache[room] = real;
        return real || 0;
      })
      .catch(function () { return 0; });
  }



  // ---------------- L3 安全阀 ----------------
  var safetyStore = { get: gmGet, set: gmSet };
  var safety = new HybridSafety({
    limits: loadJson(SAFETY_KEY, {}),
    storage: safetyStore,
    limitsKey: SAFETY_KEY,
    stateKey: SAFETY_STATE_KEY,
    ackKey: ACK_KEY,
    isHidden: function () { return typeof document !== 'undefined' && !!document.hidden; },
  });

  window.__lgjSafety = {
    allow: function (text) { return safety.allow(text); },
    note: function (text) { safety.note(text); },
    reason: function () { return safety.reason(); },
    reasonText: function () { return safety.reasonText(); },
    trip: function (openMs) { safety.trip(undefined, openMs); ringLog('warn', '安全阀：收到平台风控信号，熔断 ' + Math.round((openMs || 600000) / 60000) + ' 分钟'); },
    cfg: function () { return safety.getConfig(); },
    setCfg: function (patch) { safety.setConfig(patch); },
    confirmAck: function () { safety.confirmAck(); },
    ackConfirmed: function () { return safety.ackConfirmed(); },
    refresh: function () { safety.refresh(); },
    flush: function () { safety.flush(); },
  };

  // 跨标签/跨页面：另一实例改计数或配置时刷新（P0-4）
  try {
    if (typeof GM_addValueChangeListener === 'function') {
      GM_addValueChangeListener(SAFETY_STATE_KEY, function () { safety.refresh(); });
      GM_addValueChangeListener(SAFETY_KEY, function () {
        try { safety.limits = mergeSafetyConfig(loadJson(SAFETY_KEY, {}), safety.limits); } catch (_e2) { /* 忽略 */ }
      });
    }
  } catch (_e) { /* 忽略 */ }
  try { window.addEventListener('pagehide', function () { safety.flush(); flushRingLog(); }); } catch (_e) { /* 忽略 */ }

  // 系统弹幕过滤（委托 hybrid-core 的增强启发式；legacy DOM 路径也走这里）
  function isSysDanmaku(text) {
    try { return isSystemDanmaku(text); } catch (_e) { return false; }
  }
  window.__lgjIsSystemDanmaku = function (text) { return isSysDanmaku(text); };
  /** 结构型系统消息：节点/父节点类名含 system/notice/gift/welcome/enter 等 */
  window.__lgjIsSystemNode = function (el) {
    try {
      if (!el) return false;
      var cls = (el.className && typeof el.className === 'string') ? el.className.toLowerCase() : '';
      var p = el.parentElement;
      var pcls = (p && p.className && typeof p.className === 'string') ? p.className.toLowerCase() : '';
      return /(system|notice|announce|welcome|gift|enter-msg|msg-system|barrage-system|chat-system|danmaku-system|--sys)/.test(cls + ' ' + pcls);
    } catch (_e) { return false; }
  };

  // ---------------- B站协议采集源（自连，同源 fetch + wss） ----------------
  function mixinKey(orig) {
    var s = '';
    for (var i = 0; i < MIXIN.length; i++) s += orig[MIXIN[i]];
    return s.slice(0, 32);
  }
  function wbiSignQuery(params, imgKey, subKey) {
    var mixin = mixinKey(imgKey + subKey);
    var all = {}; for (var k in params) if (Object.prototype.hasOwnProperty.call(params, k)) all[k] = params[k];
    all.wts = Math.floor(Date.now() / 1000);
    var keys = Object.keys(all).sort();
    var q = '';
    for (var i = 0; i < keys.length; i++) { if (i) q += '&'; q += keys[i] + '=' + encodeURIComponent(all[keys[i]]); }
    return q + '&w_rid=' + md5(q + mixin);
  }
  function safeTopHref() {
    try { return (window.top && window.top.location && window.top.location.href) || ''; } catch (_e) { /* 跨域 */ }
    try { return document.referrer || ''; } catch (_e2) { return ''; }
  }
  function biliRoom() { return parseBiliRoomId(location.href, safeTopHref()); }
  function isBiliPage() { return location.hostname.indexOf('bilibili.com') >= 0 && biliRoom() > 0; }
  /** 多标签选举的 key：同房间的不同文档（含 blanc iframe）必须一致 */
  function roomKey() { return biliRoom() || location.pathname.replace(/[^0-9]/g, '') || location.hostname; }

  function BiliSource(roomId, onDanmu, onDrop, onAuth) {
    this.roomId = roomId;          // URL 里的房间号（可能是短号）
    this.realRoomId = 0;           // 解析后的真实房间号
    this.onDanmu = onDanmu;
    this.onDrop = onDrop;
    this.onAuth = onAuth;          // auth 成功瞬间回调（用于同步 domPause/engaged，避免丢首帧）
    this.ws = null;
    this.hb = null;
    this.stopped = false;
    this.alive = false;            // 只有 auth 成功后才为 true
    this.lastMsgAt = 0;
  }
  BiliSource.prototype.stop = function () {
    this.stopped = true;
    this.alive = false;
    if (this.hb) { clearInterval(this.hb); this.hb = null; }
    if (this.ws) { try { this.ws.close(); } catch (_e) { /* 忽略 */ } this.ws = null; }
  };
  BiliSource.prototype.keyOf = function (url) { return url.split('/').pop().split('.')[0]; };
  BiliSource.prototype.inflate = async function (buf, format) {
    var ds = new DecompressionStream(format || 'deflate');
    var stream = new Blob([buf]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  };
  BiliSource.prototype.start = function () {
    var self = this;
    // 1) 真实房间号（getInfoByRoom → room_init → 原值兜底）
    return resolveRealRoomId(self.roomId).then(function (realRoom) {
      if (self.stopped) throw new Error('stopped');
      self.realRoomId = realRoom || self.roomId;
      // 2) wbi keys + getDanmuInfo（用真实房号）
      return httpJson('https://api.bilibili.com/x/web-interface/nav').then(function (nav) {
        var img = nav.data && nav.data.wbi_img && nav.data.wbi_img.img_url;
        var sub = nav.data && nav.data.wbi_img && nav.data.wbi_img.sub_url;
        if (!img || !sub) throw new Error('nav-no-keys');
        var q = wbiSignQuery({ id: self.realRoomId, type: 0 }, self.keyOf(img), self.keyOf(sub));
        return httpJson('https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?' + q);
      });
    }).then(function (dm) {
      if (self.stopped) return;
      if (dm.code !== 0 || !dm.data || !dm.data.token) throw new Error('danmuinfo-' + dm.code);
      var host = dm.data.host_list && dm.data.host_list[0];
      if (!host) throw new Error('no-host');
      return self.connect(host.host, host.wss_port || 2245, dm.data.token, readCookie('buvid3'));
    }).catch(function (e) { self.stop(); throw e; });
  };
  BiliSource.prototype.connect = function (host, port, token, buvid) {
    var self = this;
    return new Promise(function (resolve, reject) {
      var ws;
      try { ws = new WebSocket('wss://' + host + ':' + port + '/sub'); } catch (e) { reject(e); return; }
      ws.binaryType = 'arraybuffer';
      var authOk = false;
      var to = setTimeout(function () {
        if (!authOk) { try { ws.close(); } catch (_e) { /* 忽略 */ } reject(new Error('auth-timeout')); }
      }, 10000);
      ws.onopen = function () {
        self.ws = ws;
        var body = JSON.stringify({ uid: 0, roomid: self.realRoomId || self.roomId, protover: 2, platform: 'web', type: 2, key: token, buvid: buvid });
        try { ws.send(self.pkt(7, body)); } catch (e) { clearTimeout(to); reject(e); }
      };
      ws.onmessage = function (ev) {
        if (!authOk) {
          try {
            var raw0 = new Uint8Array(ev.data);
            if (raw0.length >= 16) {
              var dv0 = new DataView(raw0.buffer, raw0.byteOffset, raw0.byteLength);
              if (dv0.getUint32(8) === 8) {
                var txt = new TextDecoder().decode(raw0.slice(dv0.getUint16(4), Math.min(dv0.getUint32(0), raw0.length)));
                if (txt.indexOf('"code":0') >= 0) {
                  authOk = true;
                  self.alive = true;
                  clearTimeout(to);
                  self.hb = setInterval(function () {
                    if (self.alive && self.ws && self.ws.readyState === 1) {
                      try { self.ws.send(self.pkt(2, null)); } catch (_e) { /* 忽略 */ }
                    }
                  }, 30000);
                  if (self.onAuth) { try { self.onAuth(); } catch (_e) { /* 忽略 */ } }
                  resolve();
                } else {
                  clearTimeout(to);
                  try { ws.close(); } catch (_e) { /* 忽略 */ }
                  reject(new Error('auth-rejected'));
                }
              }
            }
          } catch (_e) { /* 忽略 */ }
        } else {
          self.handle(ev.data);
        }
      };
      ws.onerror = function () {
        if (!authOk) { clearTimeout(to); reject(new Error('ws-error')); }
        else if (self.alive && typeof self.onDrop === 'function') self.onDrop();
      };
      ws.onclose = function () {
        var wasActive = self.alive;
        self.alive = false;
        if (self.hb) { clearInterval(self.hb); self.hb = null; }
        self.ws = null;
        if (self.stopped) return;
        // 只有 auth 成功过（真正接管过数据流）的掉线才触发回落；握手期失败由 start() reject 处理
        if (wasActive && typeof self.onDrop === 'function') self.onDrop();
      };
    });
  };
  BiliSource.prototype.pkt = function (op, bodyStr) {
    var b = bodyStr ? new TextEncoder().encode(bodyStr) : new Uint8Array(0);
    var buf = new Uint8Array(16 + b.length);
    var v = new DataView(buf.buffer);
    v.setUint32(0, 16 + b.length); v.setUint16(4, 16); v.setUint16(6, 1); v.setUint32(8, op); v.setUint32(12, 1);
    buf.set(b, 16);
    return buf;
  };
  BiliSource.prototype.handle = async function (data) {
    var self = this;
    if (!self.alive || self.stopped) return;
    try {
      var raw = new Uint8Array(data);
      if (raw.length < 16) return;
      var dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
      var total = dv.getUint32(0), hlen = dv.getUint16(4), protover = dv.getUint16(6), op = dv.getUint32(8);
      if (op !== 5) return;
      var body = raw.slice(hlen, Math.min(total, raw.length));
      var payload = body;
      var framed = false;
      if (protover === 2) { payload = await self.inflate(body, 'deflate'); framed = true; }
      else if (protover === 3) {
        // brotli（部分房间）；DecompressionStream('brotli') 不可用时直接放弃，由上层回落 DOM
        payload = await self.inflate(body, 'brotli');
        framed = true;
      } else if (protover !== 0) return;
      self.lastMsgAt = Date.now();
      var off = 0;
      var decoder = new TextDecoder();
      while (framed && off + 16 <= payload.length) {
        var pv = new DataView(payload.buffer, payload.byteOffset + off, payload.length - off);
        var pt = pv.getUint32(0);
        if (pt < 16 || off + pt > payload.length) break;
        var ph = pv.getUint16(4);
        self.consumeJson(decoder.decode(payload.slice(off + ph, off + pt)));
        off += pt;
      }
      if (!framed) self.consumeJson(decoder.decode(payload));
    } catch (_e) { /* 单帧忽略 */ }
  };
  /** 兼容 info[0][3]（秒）与 info[0][4]（毫秒）两种时间戳布局 */
  function pickTsMs(info0) {
    var vals = [];
    if (Array.isArray(info0)) {
      if (typeof info0[4] === 'number') vals.push(info0[4]);
      if (typeof info0[3] === 'number') vals.push(info0[3]);
    }
    for (var i = 0; i < vals.length; i++) {
      var v = vals[i];
      if (v > 1e12) return v;       // 毫秒
      if (v > 1e9) return v * 1000; // 秒
    }
    return Date.now();
  }
  BiliSource.prototype.consumeJson = function (txt) {
    var self = this;
    var t = txt.trim();
    if (!t || (t.charCodeAt(0) !== 123 && t.charCodeAt(0) !== 91)) return;
    var arr;
    try { arr = JSON.parse(t); } catch (_e) { return; }
    if (!Array.isArray(arr)) arr = [arr];
    for (var i = 0; i < arr.length; i++) {
      var m = arr[i];
      if (!m || typeof m !== 'object' || String(m.cmd).split(':')[0] !== 'DANMU_MSG') continue;
      var info = m.info;
      if (!Array.isArray(info) || !info[1]) continue;
      var text = String(info[1]);
      if (!text) continue;
      if (isSysDanmaku(text)) {
        if (window.__lgjCountSystemFiltered) { try { window.__lgjCountSystemFiltered(text); } catch (_e) { /* 忽略 */ } }
        continue;
      }
      var user = Array.isArray(info[2]) ? info[2] : [];
      var uid = typeof user[0] === 'number' ? user[0] : null;
      var nick = typeof user[1] === 'string' ? user[1] : '?';
      var tsMs = pickTsMs(info[0]);
      self.onDanmu(text, {
        id: 'bl_' + (self.realRoomId || self.roomId) + '_' + tsMs + '_' + (uid || 0) + '_' + text.length,
        uid: uid, nick: nick, ts: tsMs,
      });
    }
  };

  // ---------------- L1 原生发送（协议直发，默认关闭） ----------------
  // 只做 B 站；返回 null 表示「不适用 / 未登录」→ 由 __lgjSend 回落 DOM。
  // 平台明确拒绝或网络异常时绝不回落，避免「请求已到达但响应异常」时双发。
  function protocolSend(text) {
    if (!isBiliPage()) return Promise.resolve(null);
    var csrf = readCookie('bili_jct');
    if (!csrf) return Promise.resolve(null);
    var room = biliRoom();
    return resolveRealRoomId(room).then(function (realRoom) {
      if (!realRoom) return null;
      var body = 'bubble=0&msg=' + encodeURIComponent(text)
        + '&color=16777215&mode=1&fontsize=25&rnd=' + Date.now()
        + '&roomid=' + encodeURIComponent(realRoom)
        + '&csrf=' + encodeURIComponent(csrf)
        + '&csrf_token=' + encodeURIComponent(csrf)
        + '&platform=web&web_location=444.8';
      return httpJson('https://api.live.bilibili.com/msg/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          // 尽力模拟页面来源；GM_xmlhttpRequest 可能忽略受限头，fetch 由浏览器补
          'Referer': 'https://live.bilibili.com/',
          'Origin': 'https://live.bilibili.com',
        },
        data: body,
      });
    }).then(function (res) {
      if (res === null) return null;
      var m = mapBiliSendCode(res && res.code);
      if (m.ok) return { success: true, errorCode: null, message: '协议发送成功' };
      if (m.fallback) return null; // 未登录 / csrf 失效 → DOM 兜底
      if (m.code === 'RATE_LIMITED') { try { window.__lgjSafety.trip(600000); } catch (_e) { /* 忽略 */ } }
      // 明确失败：不回落 DOM（避免双发）；SEND_FAILED 在 legacy 中不重试
      return { success: false, errorCode: 'SEND_FAILED', message: '协议发送失败: ' + m.code };
    }).catch(function (e) {
      return { success: false, errorCode: 'SEND_FAILED', message: '协议发送网络异常: ' + (e && e.message || e) };
    });
  }
  window.__lgjSend = function (msg) {
    if (sendMode !== 'protocol') return sender.send(msg);
    return protocolSend(msg).then(function (r) {
      if (r) return r;
      return sender.send(msg); // 不适用 / 未登录 → DOM 兜底
    }).catch(function (e) {
      try { logError('__lgjSend', e); } catch (_e2) { /* 忽略 */ }
      return { success: false, errorCode: 'SEND_FAILED', message: '协议发送异常' };
    });
  };



  // ---------------- 引擎状态与 UI ----------------
  var src = null;
  var started = false;
  var mode = 'auto';          // dom | protocol | auto
  var sendMode = 'dom';
  var engaged = false;        // 协议是否已 auth 成功并接管数据流
  var protoFailUntil = 0;     // 协议失败/掉线后的退避再探时间
  var autoUnavailable = false; // 智能模式是否不可用（一级界面显示手动开关）
  var statusEl = null;
  var selectEl = null;        // 设置页引擎开关（兼容旧引用）
  var sendSelectEl = null;    // 设置页发送开关（兼容旧引用）
  var election = null;
  var electionChannel = null;
  var metaMap = Object.create(null);
  var seenMsgIds = Object.create(null);
  var seenMsgOrder = [];
  var logFilter = 'all';
  var logSearch = '';

  function setStatus(txt, cls) {
    var color = cls === 'err' ? '#f66' : cls === 'ok' ? '#6c6' : '#aaa';
    if (statusEl) { statusEl.textContent = txt; statusEl.style.color = color; }
    var s = document.getElementById('s-engine-status');
    if (s) { s.textContent = txt; s.style.color = color; }
    var q = document.getElementById('lgj-engine-quick-status');
    if (q && autoUnavailable) { q.textContent = txt.slice(0, 8); q.style.color = color; }
  }

  function feedProtocol(text, meta) {
    if (!engaged || !text) return; // 互斥铁律：协议未接管绝不喂（P0-1）
    if (meta && meta.id) {
      if (seenMsgIds[meta.id]) return;
      seenMsgIds[meta.id] = 1;
      seenMsgOrder.push(meta.id);
      if (seenMsgOrder.length > 2000) { var old = seenMsgOrder.shift(); delete seenMsgIds[old]; }
    }
    if (isSysDanmaku(text)) return;
    addDanmuToCache(text);
    recordMessageTimestamp();
    if (meta) {
      var rec = metaMap[text];
      if (!rec) { rec = metaMap[text] = { count: 0, senders: Object.create(null), firstSeen: meta.ts || Date.now(), lastSeen: 0 }; }
      rec.count++; rec.lastSeen = meta.ts || Date.now();
      if (meta.uid !== null && meta.uid !== undefined) rec.senders[String(meta.uid)] = 1;
      // 容量保护：超过 600 条时一次性裁剪到 500（避免每条新文本都排序）
      if (!rec._bounded) {
        rec._bounded = 1;
        var keys = Object.keys(metaMap);
        if (keys.length > 600) {
          keys.sort(function (a, b) { return (metaMap[a].lastSeen || 0) - (metaMap[b].lastSeen || 0); });
          for (var di = 0; di < keys.length - 500; di++) delete metaMap[keys[di]];
        }
      }
    }
  }

  /**
   * L2：协议结构化数据 → 候选权重乘子（DOM 模式无 meta，返回 1）。
   * 综合「独立发送者数」「出现次数」「新鲜度」，上限 1.8，避免完全压过 legacy 频次模型。
   */
  window.__lgjMetaBoost = function (text) {
    try {
      var r = metaMap[text];
      if (!r) return 1;
      var senders = Object.keys(r.senders).length;
      var age = Date.now() - (r.lastSeen || 0);
      var recency = age < 30000 ? 1.2 : age < 120000 ? 1.0 : 0.8;
      var boost = 1 + Math.min(0.5, senders / 20) + Math.min(0.3, (r.count || 0) / 50);
      return Math.min(1.8, boost * recency);
    } catch (_e) { return 1; }
  };

  // ---------------- 数据源互斥（P0-1） ----------------
  /** 协议 auth 成功后才调用：暂停 DOM；不清空 freqMap，保持话题连续 */
  function domPause() {
    if (window.__lgjSourceKind === 'protocol') return;
    window.__lgjSourceKind = 'protocol';
    if (state.danmuObserver) {
      try { state.danmuObserver.disconnect(); } catch (_e) { /* 忽略 */ }
      state.danmuObserver = null;
    }
    logEvent('数据源', 'DOM → 协议（已暂停 DOM 采集）');
  }
  /** 协议停/掉线时恢复 DOM（仅机器人运行中；开关本身由 legacy toggle 负责） */
  function domResume() {
    if (window.__lgjSourceKind !== 'protocol') return;
    window.__lgjSourceKind = 'dom';
    if (state.standDown || !state.isRunning) return;
    // 回落 DOM 时保留已采集的频次统计，避免协议掉线后候选池清零、需要 2 分钟重建
    window.__lgjKeepStats = true;
    try { ensureObserverRunning(); } catch (_e) { /* 忽略 */ }
    finally { window.__lgjKeepStats = false; }
    logEvent('数据源', '协议 → DOM（保留已采集统计）');
  }
  function stopProtocol() {
    if (src) { try { src.stop(); } catch (_e) { /* 忽略 */ } src = null; }
  }
  /** 连接协议；auth 成功才 domPause + engaged，失败/掉线立即回 DOM（无数据空窗） */
  function engageProto() {
    var room = biliRoom();
    if (!room || !isBiliPage()) { setStatus('协议：仅 B 站直播间可用', 'err'); return Promise.resolve(false); }
    stopProtocol();
    setStatus('协议：连接中…', '');
    logEvent('协议', '连接中（房间 ' + room + '）');
    src = new BiliSource(room, function (text, meta) {
      feedProtocol(text, meta);
    }, function () { onProtocolDrop(); }, function () {
      // auth 成功瞬间同步接管，避免首帧被 engaged 守卫丢弃
      domPause();
      engaged = true;
    });
    return src.start().then(function () {
      protoFailUntil = 0;
      setStatus('协议：数据流', 'ok');
      logEvent('协议', '已接管（真实房号 ' + ((src && src.realRoomId) || room) + '）');
      return true;
    }).catch(function (e) {
      engaged = false;
      stopProtocol();
      domResume();
      var reason = String((e && e.message) || e).slice(0, 24);
      setStatus('协议不可用：' + reason, 'err');
      logEvent('协议', '失败：' + reason + '，回落 DOM');
      return false;
    });
  }
  /** 协议掉线：立刻回 DOM，按模式退避后再探（不在 DOM 空窗里反复重连） */
  function onProtocolDrop() {
    engaged = false;
    stopProtocol();
    domResume();
    if (mode === 'protocol') { setStatus('协议掉线→DOM（稍后重试）', 'err'); protoFailUntil = Date.now() + 8000; logEvent('协议', '掉线，回落 DOM（8s 后重试直连）'); }
    else { setStatus('自动：协议掉线→DOM', 'err'); protoFailUntil = Date.now() + 30000; logEvent('协议', '掉线，回落 DOM（自动模式 30s 后再探）'); }
  }
  function disengageProto() {
    if (!engaged && !src) return;
    engaged = false;
    stopProtocol();
    domResume();
  }
  /** 非 leader 待机：停协议并断开 DOM，完全不采集（避免多标签重复监听） */
  function standbySources() {
    engaged = false;
    stopProtocol();
    window.__lgjSourceKind = 'dom';
    if (state.danmuObserver) {
      try { state.danmuObserver.disconnect(); } catch (_e) { /* 忽略 */ }
      state.danmuObserver = null;
    }
  }
  /** 单一生命周期：开关 / leader / 模式 / 退避都收敛到这里（2s 周期调用） */
  function tick() {
    if (!started) return;
    var running = !!(state && state.isRunning);
    // 计算「智能模式是否不可用」：非 B 站 / 探测失败退避中 → 一级界面显示手动开关
    autoUnavailable = (mode === 'auto') && (!isBiliPage() || Date.now() < protoFailUntil);
    if (autoUnavailable && !_autoWarned) {
      _autoWarned = true;
      logEvent('引擎', '智能模式不可用（' + (!isBiliPage() ? '该平台暂无协议源' : '协议探测失败/退避中') + '），一级界面已显示手动开关');
    }
    if (!autoUnavailable) _autoWarned = false;
    refreshEngineControls();
    // L4：非 leader 只待机，不启动数据源、不发送
    if (election && !election.isLeader()) {
      if (engaged || src) disengageProto();
      setStatus('待机（其它标签页为发送者）', 'err');
      return;
    }
    if (!running) {
      if (engaged || src) disengageProto();
      else if (mode !== 'dom' && isBiliPage()) setStatus('待机：请打开机器人开关', '');
      return;
    }
    if (mode === 'dom') {
      if (engaged || src) disengageProto();
      else if (state.isRunning && !state.danmuObserver) { try { ensureObserverRunning(); } catch (_e) { /* 忽略 */ } }
      return;
    }
    if (engaged) return;
    if (!isBiliPage()) {
      setStatus('DOM 采集（该平台暂无协议源）', 'ok');
      protoFailUntil = Date.now() + 60000;
      return;
    }
    if (Date.now() < protoFailUntil) return;
    engageProto().then(function (ok) {
      if (!ok && mode === 'auto') {
        protoFailUntil = Date.now() + 60000;
        setStatus('自动：DOM 采集（1 分钟后再探协议）', 'ok');
      } else if (!ok) {
        protoFailUntil = Date.now() + 15000;
        setStatus('协议：不可用，已回落 DOM', 'err');
      }
    });
  }
  function applyMode() { tick(); } // 兼容旧调用名
  function switchMode(m) {
    if (m !== 'protocol' && m !== 'dom' && m !== 'auto') return;
    var old = mode;
    mode = m;
    saveCfg({ mode: m });
    if (m === 'dom' && (engaged || src)) disengageProto();
    if (old !== m) logEvent('引擎', old + ' → ' + m);
    refreshEngineControls();
    tick();
  }

  /** 刷新一级界面引擎快捷开关 + 设置页引擎/发送控件 */
  function refreshEngineControls() {
    try {
      var quick = document.getElementById('lgj-engine-quick');
      var qInput = document.getElementById('lgj-engine-quick-toggle');
      var qStatus = document.getElementById('lgj-engine-quick-status');
      // 开关反映「当前实际数据源」：协议 / 智能且已接管 = 打开；其余 = 关闭（DOM）
      var effProtocol = (mode === 'protocol') || (mode === 'auto' && engaged);
      if (quick) quick.style.display = autoUnavailable ? 'flex' : 'none';
      if (qInput) qInput.checked = effProtocol;
      if (qStatus) qStatus.textContent = effProtocol ? '直连中' : 'DOM';
      var sEng = document.getElementById('s-engineDirect');
      if (sEng) { sEng.checked = effProtocol; sEng.disabled = false; }
      var sSmart = document.getElementById('s-engineSmart');
      if (sSmart) sSmart.textContent = mode === 'auto' ? '智能模式（当前）' : '切到智能模式';
      var sStatus = document.getElementById('s-engine-status');
      if (sStatus) sStatus.textContent = mode === 'protocol' ? '直连（协议）' : mode === 'dom' ? 'DOM 采集' : (autoUnavailable ? '智能不可用，请手动选择' : (engaged ? '智能：协议' : '智能：DOM'));
      var sSend = document.getElementById('s-sendProtocol');
      if (sSend) sSend.checked = (sendMode === 'protocol');
    } catch (_e) { /* 忽略 */ }
  }
  function setSendMode(m) {
    sendMode = m === 'protocol' ? 'protocol' : 'dom';
    saveCfg({ sendMode: sendMode });
    refreshEngineControls();
  }

  function buildUI() {
    var content = document.getElementById('bot-panel-content');
    if (!content) return false;
    // 一级界面保持简洁：只在「智能模式不可用」时出现一个引擎直连开关
    if (!document.getElementById('lgj-engine-quick')) {
      var quick = document.createElement('div');
      quick.id = 'lgj-engine-quick';
      quick.style.cssText = 'display:none;align-items:center;gap:6px;margin:6px 0 2px;font-size:calc(var(--bot-font-size,12px) - 1px);color:var(--bot-text,#ccc);';
      var qLabel = document.createElement('span');
      qLabel.textContent = '直连引擎';
      qLabel.style.cssText = 'flex:1;color:var(--bot-text,#aaa);';
      var qSwitch = document.createElement('label');
      qSwitch.className = 'bot-switch';
      qSwitch.style.cssText = 'transform:scale(.85);transform-origin:center;';
      var qInput = document.createElement('input');
      qInput.type = 'checkbox'; qInput.id = 'lgj-engine-quick-toggle';
      var qSlider = document.createElement('span'); qSlider.className = 'bot-slider';
      qSwitch.appendChild(qInput); qSwitch.appendChild(qSlider);
      var qStatus = document.createElement('span');
      qStatus.id = 'lgj-engine-quick-status';
      qStatus.style.cssText = 'color:#888;font-size:calc(var(--bot-font-size,12px) - 2px);min-width:44px;text-align:right;';
      quick.appendChild(qLabel); quick.appendChild(qSwitch); quick.appendChild(qStatus);
      content.appendChild(quick);
      qInput.addEventListener('change', function () {
        switchMode(qInput.checked ? 'protocol' : 'dom');
      });
    }
    if (!document.getElementById('lgj-engine-status-main')) {
      var st = document.createElement('div');
      st.id = 'lgj-engine-status-main';
      st.style.cssText = 'font-size:calc(var(--bot-font-size,12px) - 2px);color:#888;margin:2px 0 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
      content.appendChild(st);
    }
    statusEl = document.getElementById('lgj-engine-status-main');
    refreshEngineControls();
    return true;
  }

  function buildExtraUI() {
    var content = document.getElementById('bot-panel-content');
    if (!content) return false;
    if (!safety.ackConfirmed() && !document.getElementById('lgj-ack-row')) {
      var ack = document.createElement('div');
      ack.id = 'lgj-ack-row';
      ack.style.cssText = 'margin:4px 0;padding:6px 8px;border:1px solid #f44336;border-radius:6px;font-size:calc(var(--bot-font-size,12px) - 1px);color:#f66;line-height:1.5;background:rgba(244,67,54,0.08);';
      ack.innerHTML = '自动发送存在违反平台规则/封禁风险，仅用于有节制参与。<button id="lgj-ack-btn" style="margin-top:4px;background:#f44336;border:none;color:#fff;border-radius:4px;padding:3px 10px;cursor:pointer;">已知晓并启用</button>';
      content.appendChild(ack);
      var ackBtn = ack.querySelector('#lgj-ack-btn');
      if (ackBtn) ackBtn.addEventListener('click', function () {
        safety.confirmAck();
        ack.remove();
        applyMode();
      });
    }
    return true;
  }

  function startConfigListener() {
    try {
      if (typeof GM_addValueChangeListener === 'function') {
        GM_addValueChangeListener(STORAGE_KEYS.CONFIG_VERSION, function () {
          try { checkConfigUpdate(); } catch (_e) { /* 忽略 */ }
        });
      }
    } catch (_e) { /* 忽略 */ }
    // 兜底：低频比对（替代 legacy 每秒轮询；listener 不可用时保底）
    try {
      setInterval(function () {
        try {
          var v = GM_getValue(STORAGE_KEYS.CONFIG_VERSION, 0);
          if (v !== state.configVersion) checkConfigUpdate();
        } catch (_e) { /* 忽略 */ }
      }, 30000);
    } catch (_e) { /* 忽略 */ }
  }

  function diagnose() {
    var topMeta = [];
    for (var k in metaMap) {
      if (!Object.prototype.hasOwnProperty.call(metaMap, k)) continue;
      var r = metaMap[k];
      topMeta.push({ text: k.slice(0, 40), count: r.count, senders: Object.keys(r.senders).length, firstSeen: r.firstSeen, lastSeen: r.lastSeen });
    }
    topMeta.sort(function (a, b) { return b.count - a.count; });
    return {
      platform: _plat(), room: biliRoom() || location.pathname.replace(/[^0-9]/g, ''),
      engine: mode, sendMode: sendMode, engineStatus: statusEl ? statusEl.textContent : '',
      sourceKind: window.__lgjSourceKind || '', engaged: engaged, protoFailUntil: protoFailUntil,
      leader: election ? (election.isLeader() ? 'leader' : 'follower') : 'solo',
      safety: { enabled: safety.getConfig().enabled, limits: safety.getConfig(), lastReason: safety.reason(), circuit: safety.circuitUntil > Date.now() },
      configVersion: state.configVersion,
      recentErrors: Logger.getRecentErrors(600000).slice(-5),
      topProtocolMeta: topMeta.slice(0, 5),
      lastLogs: Logger.getAll().slice(-10),
    };
  }

  function exportConfig() {
    var bundle = { __lgjExport: 1 };
    try { bundle.config = GM_getValue(STORAGE_KEYS.CONFIG, null); } catch (_e) { bundle.config = null; }
    try { bundle.theme = GM_getValue(STORAGE_KEYS.THEME, null); } catch (_e) { bundle.theme = null; }
    try { bundle.blocklist = GM_getValue(STORAGE_KEYS.BLOCKLIST, []); } catch (_e) { bundle.blocklist = []; }
    try { bundle.priority = GM_getValue(STORAGE_KEYS.PRIORITY, []); } catch (_e) { bundle.priority = []; }
    try { bundle.filterRules = GM_getValue(STORAGE_KEYS.FILTER_RULES, []); } catch (_e) { bundle.filterRules = []; }
    bundle.engine = loadCfg();
    bundle.safety = safety.getConfig();
    return bundle;
  }
  function importConfig(jsonStr) {
    var obj;
    try { obj = JSON.parse(jsonStr); } catch (_e) { return 'JSON 解析失败'; }
    var err = validateConfigBundle(obj);
    if (err) return '校验失败：' + err;
    var applied = [];
    if (obj.config && typeof obj.config === 'object') { GM_setValue(STORAGE_KEYS.CONFIG, obj.config); applied.push('配置'); }
    if (obj.theme && typeof obj.theme === 'object') { GM_setValue(STORAGE_KEYS.THEME, obj.theme); applied.push('主题'); }
    if (Array.isArray(obj.blocklist)) { GM_setValue(STORAGE_KEYS.BLOCKLIST, obj.blocklist); applied.push('屏蔽词'); }
    if (Array.isArray(obj.priority)) { GM_setValue(STORAGE_KEYS.PRIORITY, obj.priority); applied.push('优先词'); }
    if (Array.isArray(obj.filterRules)) { GM_setValue(STORAGE_KEYS.FILTER_RULES, obj.filterRules); applied.push('筛选规则'); }
    if (obj.engine && typeof obj.engine === 'object') { saveCfg(obj.engine); applied.push('引擎'); }
    if (obj.safety && typeof obj.safety === 'object') { safety.setConfig(obj.safety); applied.push('安全阀'); }
    try { bumpConfigVersion(); } catch (_e) { /* 忽略 */ }
    try { loadConfig(); applyTheme(state.config.theme); updateUIDisplay(getMessagesPerMinute()); } catch (_e) { /* 忽略 */ }
    return '已导入：' + applied.join('、');
  }

  // ---------------- 设置页增强：引擎/发送/配置管理/日志筛选（二级界面） ----------------
  function settingsSectionHtml(title, content) {
    return '<div class="settings-section" style="background:var(--bot-border,rgba(255,255,255,0.03));border-radius:6px;padding:10px 12px;margin-bottom:12px;border:1px solid var(--bot-border,rgba(255,255,255,0.08));">'
      + '<h3 style="font-size:calc(var(--bot-font-size,12px) + 1px);color:var(--bot-accent,#ff9800);margin:0 0 6px 0;">' + title + '</h3>'
      + content + '</div>';
  }
  function settingsToggleRow(id, label, checked, hint) {
    return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">'
      + '<label style="flex:1;color:var(--bot-text,#aaa);font-size:var(--bot-font-size,12px);">' + label + '</label>'
      + '<input type="checkbox" id="' + id + '" ' + (checked ? 'checked' : '') + ' style="width:auto;">'
      + '</div>'
      + (hint ? '<div style="font-size:calc(var(--bot-font-size,12px) - 2px);color:#666;margin-top:2px;">' + hint + '</div>' : '');
  }
  function settingsBtnHtml(id, label) {
    return '<button id="' + id + '" style="background:var(--bot-border,#2c2c3a);border:none;color:var(--bot-text,#ccc);padding:4px 10px;border-radius:4px;cursor:pointer;font-size:calc(var(--bot-font-size,12px) - 1px);">' + label + '</button>';
  }
  /** 日志渲染：全部级别 + 级别筛选 + 搜索（覆盖 legacy 只显示 error 的实现） */
  function renderLogsNow() {
    try {
      var container = document.querySelector('#settings-debug-list');
      if (!container) return;
      var items = Logger.getAll();
      if (logFilter && logFilter !== 'all') items = items.filter(function (l) { return l.level === logFilter; });
      if (logSearch) {
        var q = String(logSearch).toLowerCase();
        items = items.filter(function (l) { return String(l.content || '').toLowerCase().indexOf(q) >= 0; });
      }
      items = items.slice(-300);
      var colors = { error: '#f44336', warn: '#ff9800', send: '#4caf50', event: '#2196f3', info: '#9e9e9e' };
      var html = '';
      for (var i = items.length - 1; i >= 0; i--) {
        var l = items[i];
        var color = colors[l.level] || '#9e9e9e';
        html += '<div style="border-bottom:1px solid var(--bot-border,rgba(255,255,255,0.06));padding:3px 0;font-size:11px;word-break:break-all;">'
          + '<span style="color:#888;">[' + escapeHtml(l.time || '') + ']</span> '
          + '<span style="color:' + color + ';font-weight:bold;">' + escapeHtml(String(l.level || '').toUpperCase()) + '</span> '
          + '<span style="color:var(--bot-text,#e0e0e0);">' + escapeHtml(String(l.content || '')) + '</span></div>';
      }
      container.innerHTML = html || '<div style="color:#666;padding:6px;">暂无日志</div>';
      var badge = document.querySelector('#settings-debug-count');
      if (badge) { badge.textContent = items.length; badge.style.display = items.length ? 'inline-block' : 'none'; }
    } catch (_e) { /* 忽略 */ }
  }
  try { renderDebugLogs = renderLogsNow; } catch (_e) { /* 忽略 */ }
  window.__lgjRenderLogs = renderLogsNow;

  function doExportSettings(panel) {
    try {
      var txt = JSON.stringify(exportConfig());
      if (typeof GM_setClipboard === 'function') { try { GM_setClipboard(txt); } catch (_e) { /* 忽略 */ } }
      var area = panel && panel.querySelector('#settings-import-area');
      if (area) { area.value = txt; area.style.display = 'block'; }
      setStatus('已导出（复制或见文本框）', 'ok');
    } catch (_e) { setStatus('导出失败', 'err'); }
  }
  function doImportSettings(panel) {
    try {
      var area = panel && panel.querySelector('#settings-import-area');
      if (!area) return;
      if (area.style.display === 'none') { area.style.display = 'block'; area.focus(); return; }
      var msg = importConfig(area.value);
      area.style.display = 'none';
      setStatus(msg, msg.indexOf('已导入') === 0 ? 'ok' : 'err');
      logEvent('配置', msg);
      refreshEngineControls();
    } catch (_e) { setStatus('导入失败', 'err'); }
  }
  window.__lgjEnhanceSettings = function (panel) {
    try {
      if (!panel) return;
      var engineHtml = settingsSectionHtml('⚙️ 引擎',
        settingsToggleRow('s-engineDirect', '直连引擎（协议）', mode === 'protocol', '关闭 = DOM 采集；打开 = 协议直连。默认 DOM。')
        + '<div style="display:flex;align-items:center;gap:8px;margin-top:6px;">'
        + settingsBtnHtml('s-engineSmart', '切到智能模式')
        + '<span id="s-engine-status" style="font-size:calc(var(--bot-font-size,12px) - 2px);color:#888;"></span></div>');
      var sendHtml = settingsSectionHtml('📤 发送',
        settingsToggleRow('s-sendProtocol', '协议直发（实验）', sendMode === 'protocol', '关闭 = DOM 模拟（默认）；打开 = 调用 B 站发送接口。平台明确拒绝 / 网络异常不会回落，避免双发。'));
      var configHtml = settingsSectionHtml('💾 配置管理',
        '<div style="display:flex;gap:8px;margin-bottom:8px;">'
        + settingsBtnHtml('settings-export-btn', '导出配置')
        + settingsBtnHtml('settings-import-btn', '导入配置')
        + settingsBtnHtml('settings-diag-btn', '诊断')
        + '</div>'
        + '<textarea id="settings-import-area" placeholder="粘贴导出的 JSON…" style="display:none;width:100%;height:70px;box-sizing:border-box;font-family:monospace;font-size:11px;background:var(--bot-border,#222);color:var(--bot-text,#ddd);border:1px solid #555;border-radius:4px;"></textarea>');
      var firstSection = panel.querySelector('.settings-section');
      if (firstSection) firstSection.insertAdjacentHTML('beforebegin', engineHtml + sendHtml + configHtml);
      else panel.insertAdjacentHTML('beforeend', engineHtml + sendHtml + configHtml);

      var list = panel.querySelector('#settings-debug-list');
      if (list) {
        var section = list.closest('.settings-section');
        if (section) {
          var h3 = section.querySelector('h3');
          if (h3) h3.textContent = '📋 日志';
          var filterLabels = [['all', '全部'], ['event', '事件'], ['send', '发送'], ['warn', '警告'], ['error', '错误'], ['info', '信息']];
          var filters = '<div id="lgj-log-filters" style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px;">';
          for (var fi = 0; fi < filterLabels.length; fi++) {
            var active = filterLabels[fi][0] === logFilter ? ';background:var(--bot-accent,#ff9800);color:var(--bot-bg,#1a1a2e);' : '';
            filters += '<button data-log-filter="' + filterLabels[fi][0] + '" style="background:var(--bot-border,#2c2c3a);border:none;color:var(--bot-text,#ccc);padding:2px 8px;border-radius:10px;cursor:pointer;font-size:calc(var(--bot-font-size,12px) - 2px)' + active + '">' + filterLabels[fi][1] + '</button>';
          }
          filters += '</div>'
            + '<div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;">'
            + '<input id="settings-log-search" placeholder="搜索日志…" style="flex:1;background:var(--bot-border,rgba(255,255,255,0.06));border:1px solid var(--bot-border,rgba(255,255,255,0.12));color:var(--bot-text,#eee);border-radius:4px;padding:3px 6px;font-size:calc(var(--bot-font-size,12px) - 1px);">'
            + '<label style="font-size:calc(var(--bot-font-size,12px) - 2px);color:#888;white-space:nowrap;"><input type="checkbox" id="settings-log-verbose" style="width:auto;">详细</label>'
            + '</div>';
          var clearBtn = section.querySelector('#settings-debug-clear');
          if (clearBtn) clearBtn.insertAdjacentHTML('beforebegin', filters);
          else section.insertAdjacentHTML('afterbegin', filters);
          var divs = section.querySelectorAll('div');
          for (var hi = 0; hi < divs.length; hi++) {
            if (String(divs[hi].textContent).indexOf('仅显示错误') >= 0) {
              divs[hi].textContent = '显示最近 300 条；「事件」含引擎/协议/安全阀/选择等。';
              break;
            }
          }
        }
      }

      var eng = panel.querySelector('#s-engineDirect');
      if (eng) eng.addEventListener('change', function () { switchMode(eng.checked ? 'protocol' : 'dom'); });
      var smart = panel.querySelector('#s-engineSmart');
      if (smart) smart.addEventListener('click', function () { switchMode('auto'); });
      var send = panel.querySelector('#s-sendProtocol');
      if (send) send.addEventListener('change', function () {
        if (send.checked) {
          var ok = true;
          try { ok = window.confirm('协议直发为实验功能：直接调用 B 站发送接口，可能触发风控，且需要登录态。是否启用？'); } catch (_e) { ok = true; }
          if (!ok) { send.checked = false; return; }
          setSendMode('protocol');
        } else { setSendMode('dom'); }
        logEvent('发送', send.checked ? '切换：协议直发（实验）' : '切换：DOM 模拟');
      });
      var exp = panel.querySelector('#settings-export-btn');
      if (exp) exp.addEventListener('click', function () { doExportSettings(panel); });
      var imp = panel.querySelector('#settings-import-btn');
      if (imp) imp.addEventListener('click', function () { doImportSettings(panel); });
      var diag = panel.querySelector('#settings-diag-btn');
      if (diag) diag.addEventListener('click', function () {
        try { console.log('[烂梗机诊断]', JSON.stringify(diagnose(), null, 2)); } catch (_e) { /* 忽略 */ }
        setStatus('诊断已输出到控制台(F12)', 'ok');
      });
      var filterBtns = panel.querySelectorAll('[data-log-filter]');
      for (var bi = 0; bi < filterBtns.length; bi++) {
        filterBtns[bi].addEventListener('click', function () {
          logFilter = this.getAttribute('data-log-filter') || 'all';
          var all = panel.querySelectorAll('[data-log-filter]');
          for (var aj = 0; aj < all.length; aj++) {
            if (all[aj] === this) { all[aj].style.background = 'var(--bot-accent,#ff9800)'; all[aj].style.color = 'var(--bot-bg,#1a1a2e)'; }
            else { all[aj].style.background = 'var(--bot-border,#2c2c3a)'; all[aj].style.color = 'var(--bot-text,#ccc)'; }
          }
          renderLogsNow();
        });
      }
      var search = panel.querySelector('#settings-log-search');
      if (search) search.addEventListener('input', function () { logSearch = search.value.trim(); renderLogsNow(); });
      var verbose = panel.querySelector('#settings-log-verbose');
      if (verbose) {
        verbose.checked = !!Logger._debug;
        verbose.addEventListener('change', function () { Logger.setDebug(verbose.checked); });
      }

      refreshEngineControls();
      renderLogsNow();
    } catch (_e) { /* 忽略 */ }
  };


  // ---------------- L4：多标签 leader 选举（唯一发送者） ----------------
  function startCrossTabWatch() {
    try {
      var room = roomKey();
      var bc = null;
      if (typeof BroadcastChannel === 'function') {
        try { bc = new BroadcastChannel('lgj120_' + _plat() + '_' + room); } catch (_e) { bc = null; }
      }
      electionChannel = bc;
      election = new LeaderElection({
        storage: safetyStore,
        key: 'LGJ_LEADER_' + _plat() + '_' + room,
        onChange: function (isLeader) {
          if (isLeader) {
            if (started) tick();
            else setStatus('启动中…', '');
          } else {
            setStatus('待机（其它标签页为发送者）', 'err');
            standbySources();
          }
        },
        post: bc ? function (m) { try { bc.postMessage(m); } catch (_e) { /* 忽略 */ } } : null,
      });
      if (bc) {
        bc.onmessage = function (ev) {
          var d = ev.data;
          if (d && (d.t === 'hb' || d.t === 'leader')) {
            try { election.onMessage(d); } catch (_e) { /* 忽略 */ }
          }
        };
      }
      election.start();
    } catch (_e) { /* 忽略 */ }
  }

  /** 面板被 SPA 重建后重挂注入 UI；让位后停协议并释放 leader 租约（P1-8） */
  function ensureHybridUI() {
    if (state.standDown) {
      if (window.__lgjEngineOnStandDown) window.__lgjEngineOnStandDown();
      return;
    }
    if (!document.getElementById('bot-panel')) return;
    buildUI();
    buildExtraUI();
    tick();
  }

  function boot() {
    restoreRingLog();
    hookRingLog();
    startConfigListener();
    var c = loadCfg();
    mode = (c.mode === 'protocol' || c.mode === 'dom') ? c.mode : 'auto';
    sendMode = c.sendMode === 'protocol' ? 'protocol' : 'dom';
    started = true;
    // leader 选举首次 tick 会通过 onChange 触发 leader 的 tick()，follower 保持待机
    startCrossTabWatch();
    // 常驻 watchdog：面板被 SPA 重建后重挂 UI，同时驱动数据源生命周期
    setInterval(ensureHybridUI, 2000);
    // 60s 采集摘要：DPM/候选/freq/系统过滤/来源/模式，让日志有内容
    setInterval(logPeriodicSummary, 60000);
    ensureHybridUI();
  }

  // 桥：协议文本 → legacy 引擎（带 id 去重；meta 用于诊断/后续 L2）
  window.__lgjFeed = function (text, meta) {
    try { feedProtocol(text, meta); } catch (_e) { /* 忽略 */ }
  };
  window.__lgjEngine = {
    switchMode: function (m) { switchMode(m); },
    setSendMode: function (m) { setSendMode(m); },
    apply: function () { tick(); },
    stop: function () { disengageProto(); },
    diagnose: function () { return diagnose(); },
  };
  window.__lgjEngineOnStart = function () { tick(); };
  window.__lgjEngineOnStop = function () { disengageProto(); };
  window.__lgjIsLeader = function () { return election ? election.isLeader() : true; };
  // B 站 blanc 让位：必须停选举并释放租约，否则主文档会一直占着 leader 让 iframe 实例待机
  window.__lgjEngineOnStandDown = function () {
    engaged = false;
    stopProtocol();
    if (election) { try { election.stop(); } catch (_e) { /* 忽略 */ } }
    try { safetyStore.set('LGJ_LEADER_' + _plat() + '_' + roomKey(), { tabId: '', expiresAt: 0 }); } catch (_e2) { /* 忽略 */ }
  };
  window.__lgjSourceKind = 'dom';

  setTimeout(boot, 1500);
})();
