// ==UserScript==
// @name         烂梗机
// @namespace    http://tampermonkey.net/
// @version      1.2.3
// @description  多平台自动复读弹幕 | DOM+协议双引擎 | 智能去重 | L3 安全阀
// @match        https://www.douyu.com/*
// @match        https://www.huya.com/*
// @match        https://live.bilibili.com/*
// @match        https://live.douyin.com/*
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @connect      api.bilibili.com
// @connect      api.live.bilibili.com
// @connect      live.bilibili.com
// @grant        GM_setValue
// @run-at       document-end
// @homepageURL   https://github.com/ArimaKana-Akane/DanmuRepeater
// @updateURL     https://github.com/ArimaKana-Akane/DanmuRepeater/releases/latest/download/latest.user.js
// @downloadURL   https://github.com/ArimaKana-Akane/DanmuRepeater/releases/latest/download/latest.user.js
// @author        LaGenJi contributors
// @license       MIT
// ==/UserScript==
// 版本历史：
// 1.2.3 hybrid：真机测试驱动的修复——虎牙 Tars 解码（类型化 size + 大端）、虎牙礼物/贵族进场/时间分隔误采集、斗鱼 AI 摘要误采集、安全阀设置界面、虎牙 Hook 无弹幕产出时回落 DOM、协议失败指数退避；详见 CHANGELOG.md
// 1.2.2 hybrid：多平台协议源上线（斗鱼自连+Hook / 虎牙 Tars Hook / 抖音 protobuf Hook），四平台全覆盖；修复 1.2.1 构建事故（$& 腐蚀、产物 NUL、B 站房间号断链）；详见 CHANGELOG.md
// 1.2.1 hybrid：UI 精简 + 协议收敛（斗鱼直连下线）+ engage in-flight 锁；⚠️ 该版发布构建损坏（符号重命名事故），请升级到 1.2.2+
// 1.2.0 hybrid：DOM+协议双引擎互斥切换；修复双源叠加/房间号/安全阀持久化/断线重连/开关联动；详见 CHANGELOG.md
// 1.1.8 新增候选强制刷新 / 智能去重 / 全链路日志
// 1.1.9 修复：智能去重不再丢弃纯数字弹幕；单一调度链消除双定时器竞态；
//            正则结果缓存；移除 console 劫持与死代码；模块化重构
// 1.1.10 修复：DPM 批量节点漏计（批量容器内每条弹幕各计一次）；
//             候选词限定最高 50 条并实时刷新（UI 间隔 2s→1s）；
//             修复开关重开后 observer 不恢复
// 1.1.11 修复：频次统计改为滑动时间窗口（2 分钟）——旧弹幕不再霸榜，
//             候选词跟随当前直播话题实时更新，杜绝发送过期弹幕
// 1.1.12 修复：调度器单链守卫——runBot 异步执行期间 mainTimer 为空，
//             UI 循环每秒调用 switchMode 会误判无调度而重复启动调度链，
//             导致双链并存一次发送两条弹幕；新增 schedulerBusy 标志彻底防重入
// 1.1.13 优化：面板拖拽渲染性能——transform: translate3d 替代 left/top
//             （不再每帧强制重排）；requestAnimationFrame 合并高频 move 事件；
//             Pointer Events + setPointerCapture 替代 document 级监听，
//             拖动更跟手流畅
// 1.1.14 修复：多实例并发发送——实测 Tampermonkey 沙箱隔离导致
//             window 防重标记失效，脚本在主文档与同源 iframe 各注入 2 次，
//             多实例各自调度发送（"一次发两条"的又一来源）。
//             新增 @noframes + iframe 排除 + document 属性防重（跨沙箱可靠）
// 1.1.15 修复（真实浏览器端到端实测驱动）：
//             P0 B 站回归——1.1.14 的 @noframes+iframe 排除误杀 B 站：
//             B 站弹幕渲染在同源 iframe（live.bilibili.com/blanc/...）内，
//             脚本在 iframe 退出、主文档又无弹幕 DOM → B 站完全无法采集。
//             改为平台感知帧选择：仅允许 blanc iframe 运行，B 站主文档退出；
//             P0 调度链竞态残余——stopBot 强制 schedulerBusy=false 时旧 runBot
//             仍在飞行，快速关→开会清掉新链标志重复 setTimeout，新增 epoch 令牌；
//             P0 send() 局部 input 在 refreshCache 成功后未重读（_fillInput(null)
//             必抛 FILL_ERROR）；
//             P1 容器轮询失效——findContainer 降级 body 导致轮询 1 秒即停
//             （实测斗鱼/抖音均降级 body），改为找不到返回 null、超时才降级；
//             P1 发送后校验加宽限（平台清空输入框有延迟，误判会 3 秒后重发同一条）；
//             P1 正则屏蔽词被 / 分隔符拆成普通词（设置页永远无法录入正则）；
//             P1 设置页错误日志区打开时不渲染；
//             P1 去重窗口/历史条数设 0 时语义反转（0=关闭去重）；
//             B 站弹幕文本选择器修正（避免回退 textContent 带上用户名）
// 1.1.16 修复（生产环境实测驱动）：
//             P0 B 站双渲染模式——1.1.15 的"B 站主文档一律退出"误杀主文档直挂
//             弹幕的房间（实测 6343442：#chat-items 在主文档，无 blanc iframe），
//             而 856077/814 是 blanc iframe 模式。帧选择修正为：
//             iframe 仅放行 blanc；B 站主文档仅在页面存在 blanc iframe 时让位；
//             轮询循环二次检查兜底 blanc 晚插入场景
// 1.1.17 修复（静态审查清单驱动）：
//             P1 系统弹幕（欢迎语/公告）不再入候选（实测斗鱼"欢迎来到..."被采集）；
//             P1 斗鱼受控 contenteditable 输入同步——补发 InputEvent(inputType=insertText,
//                data)，通用发送补 Enter 兜底（实测按钮 is-gray 不激活的根因）；
//             P1 多版本共存告警——data-lgj-loaded 记录版本号，检测到旧版已运行
//                时 console 警告（升级前必须删除旧版脚本，否则双实例并发发送）；
//             P1 SEND_FAILED（输入框未清空）不再自动重试——可能实际已发出，
//                 重发只会造成重复弹幕，仅"明确未发出"的错误才重试；
//             N 让位净化——B 类房间主文档让位时移除 idle 面板、断开 observer、
//                 周期任务空转（standDown 标志）；
//             N 让位检查提前到 body 降级之前（blanc 晚于 45s 出现时不再失效）；
//             L 选择器失配不再静默失效（批量分支空结果回退按节点文本兜底）；
//             L getSelectors 返回完整选择器数组（多候选不再只有 [0] 生效）；
//             L 设置页空输入保存不再覆盖为 0（保持原值）；
//             L 补 normalIntervalMin/Max 设置项；input min=0 属性不再丢失；
//             L Logger 默认静音 debug 级（洪峰降噪）；面板位置视口 clamp；
//             L 倒计时定时器复用（不再每秒重建）；预览与实发一致；
//             L escapeHtml 转义引号；清理死代码（clearRegexCache、
//                MAX_HISTORY_SIZE_FALLBACK）
// 1.1.18 修复（1.1.17 复核清单驱动）：
//             P0 双发修复——1.1.17 在 _sendDouyin/_sendHuya/_sendGeneric 的按钮点击后
//                「无条件」追加 Enter，而平台清空输入框是异步的 → 点击已生效时
//                Enter 会再发一次（抖音实测严重；斗鱼登录态同样会中招）。
//                改为全平台统一「证据驱动」模型：发送动作后，仅当宽限轮询确认
//                「输入框仍未清空」才补发 Enter（最多一次）。
//                - 按钮有效 → 已清空 → 不补 Enter → 单发（抖音双发根治）
//                - 按钮灰态/无效（实测斗鱼 is-gray）→ 未清空 → 补 Enter →
//                  照常发得出去（斗鱼 Enter 兜底完整保留，只是从无条件变为有条件）
//                - B 站无可靠按钮，Enter 即主发送动作，逻辑不变且更安全
//             P1 设置页「透明度」清空保存写入 NaN（NaN 跳过只覆盖数值循环，
//                未覆盖 theme.opacity）→ 面板 --bot-opacity: NaN
//             P1 面板模式一旦出错永久显示「错误」——改为只统计最近 2 分钟的 error
//             P2 isSystemDanmaku 关键词过宽（「本直播间」会误杀正常弹幕）
//                改为前缀锚定 + 短文本限定
//             P2 standDown 让位检查原本写在容器轮询内，主文档若先命中容器则
//                clearInterval 后永不触发 → 抽成独立 yieldToBlancFrame +
//                1s 周期检查 startBlancYieldWatch（覆盖 45s body 降级后的晚插入）
// 1.1.19 修复（真机反馈驱动）：
//             P0 网页全屏不隐藏面板——「网页全屏」是站点自绘状态（非 Fullscreen
//                API），document.fullscreenElement 恒为 null，而旧检测只认
//                body.player-fullscreen 与 B 站 .layout-Player-barrageStage.fullscreen
//                两个标记 → 斗鱼/虎牙/抖音网页全屏完全漏判。
//                重写为四路综合判定：① 原生全屏（含 webkit/moz/ms 前缀）
//                ② html/body 类名关键字 ③ 各平台已知容器标记（斗鱼/虎牙/B站/抖音）
//                ④ 视频铺满视口几何兜底（仅斗鱼/虎牙/B站；抖音直播常态即满屏，
//                   用几何会永久误判，故排除）；
//                B 站 blanc iframe 实例额外检查同域父文档状态。
//                触发方式：fullscreenchange 三前缀事件 + html/body class
//                MutationObserver（网页全屏无事件，只能观察类名变化）+ 1s 兜底轮询。
//             P1 状态去重（不再每 1.5s 无条件写 class）+ 全屏时同步隐藏设置浮层
//                （浮层 z-index 100000，会盖在网页全屏画面上）
//             P1 standDown（B 站主文档让位）后清理全屏轮询与 observer，不再空转
// 1.1.20 修复（1.1.18/1.1.19 复核遗留项）：
//             P2 queryAll 多选择器重叠导致同一条弹幕被重复 capture → Set 去重；
//             P3 重试成功后「下次」预览停留在刚发出去的消息 → 重试成功立即刷新候选；
//             P3 body 降级后关闭再打开开关无法恢复采集 → ensureObserverRunning
//                支持 degradedToBody 恢复，并在真实容器重新出现时清除降级标志；
//             P0 B 站首发送后增加额外清空宽限（仍不补第二次 Enter），避免
//                「已发出但清空慢」被误判 SEND_FAILED；
//             P3 stopBot 强制清 isSending，快速关→开时旧 send 的 finally 可能清掉
//                新发送的 busy 标志 → 停止时不再强制重置，让飞行中的发送自然结束；
//             让位后容器轮询/observer 的 standDown 兜底补齐；
//             设置页数值/主题输入值统一 escapeHtml；
//             修正 iframe 防重注释：未使用 @noframes，B 站 blanc iframe 需要运行。
//             注：isSystemDanmaku 的「本直播间」前缀过滤为用户确认的产品行为，本次不动。

(function () {
    'use strict';

    // ============================================================
    // 防重复加载（跨沙箱可靠版）
    // 问题：Tampermonkey 沙箱模式下 window/document 与页面隔离，
    //       window.dyBotScriptLoaded 防重标记可能失效 → 脚本重复执行
    //       （实测主文档 + 同源 iframe 各注入多次 → 多实例并发发送）。
    // 修复：
    //   1) iframe 内直接退出（代码级排除；未使用 @noframes，
    //      因为 B 站 blanc iframe 需要运行）
    //   2) 用 document 元素属性做防重标记——同一沙箱内可靠
    // ============================================================
    // 平台感知帧选择（1.1.16 修正，替代 1.1.15 的"B 站主文档一律退出"）：
    // 实测发现 B 站存在两种渲染模式：
    //   A) 弹幕直挂主文档（如房间 6343442：#chat-items 在主文档）
    //   B) 弹幕在同源 iframe live.bilibili.com/blanc/<room> 内（如 856077/814）
    // 1.1.15 的"主文档一律退出"会误杀 A 类房间 → 修正为：
    //   - iframe：仅 blanc 弹幕渲染 iframe 允许运行，其余（含跨域）退出
    //   - B 站主文档：仅当页面存在 blanc iframe（B 类房间）时让位给 iframe 实例；
    //     A 类房间主文档正常运行。blanc iframe 晚于主文档插入的间隙由
    //     startContainerPolling 中的二次检查兜底（见容器轮询）。
    // - 其他平台的 iframe 一律退出（保留 1.1.14 防多实例语义）
    const IS_TOP_FRAME = (window.top === window.self);
    const IS_BLANC_FRAME = location.hostname.includes('bilibili.com')
        && location.pathname.startsWith('/blanc/');
    if (!IS_TOP_FRAME && !IS_BLANC_FRAME) {
        return; // 非 blanc 的 iframe（含跨域）退出
    }
    if (IS_TOP_FRAME && location.hostname.includes('bilibili.com')
        && document.querySelector('iframe[src*="/blanc/"]')) {
        return; // B 类房间（blanc 模式）：主文档让位给 iframe 实例
    }
    // 防重标记带版本号：检测到其他版本已运行（多版本共存）时醒目告警。
    // 注意：1.1.12 及更早版本不设置此标记，无法拦截，升级前务必删除旧版脚本，
    // 否则同页面多实例并发发送（README/发布说明中需强调）。
    const INSTALLED_VERSION = '1.2.3';
    if (document.documentElement) {
        const marker = document.documentElement.getAttribute('data-lgj-loaded');
        if (marker) {
            if (marker !== INSTALLED_VERSION) {
                console.warn(`[烂梗机] 检测到已运行 v${marker}，多版本共存可能重复发送，请删除旧版脚本（当前 v${INSTALLED_VERSION}）`);
            }
            return;
        }
        try { document.documentElement.setAttribute('data-lgj-loaded', INSTALLED_VERSION); } catch (_) { /* 忽略 */ }
    }
    // 兼容旧标记（部分环境沙箱 window 可写回页面）
    if (window.dyBotScriptLoaded) return;
    try { window.dyBotScriptLoaded = true; } catch (_) { /* 忽略 */ }

    // =========================================================================
    // 模块 1：常量与平台检测
    // =========================================================================
    // 与顶层 INSTALLED_VERSION 保持同值（防重标记版本号）
    const SCRIPT_VERSION = INSTALLED_VERSION;

    const PLATFORM = detectPlatform();

    const TIMING = {
        DANMU_CACHE_MAX: 500,
        UI_UPDATE_INTERVAL: 1000,        // 候选/UI 刷新间隔（1 秒，保证实时）
        CONTAINER_POLL_INTERVAL: 1000,
        CONTAINER_POLL_MAX: 45,
        DPM_WINDOW_MS: 60000,
        MAX_TIMESTAMPS: 500,
        MAX_TS_AGE_MS: 120000,
        TS_CLEANUP_INTERVAL: 5000,
        RETRY_MAX_ATTEMPTS: 3,
        MIN_SEND_INTERVAL_MS: 2000,
        RETRY_DELAY_MS: 3000,
        SELECTOR_REPROBE_INTERVAL: 300000,
        CANDIDATE_REFRESH_INTERVAL: 10000,  // 候选强制刷新周期
        MAX_CANDIDATES: 50,              // 候选词数量上限（实时刷新但限制数量）
        FREQ_WINDOW_MS: 120000,          // 频次统计窗口（2 分钟）：只统计窗口内的出现次数
    };

    const STORAGE_KEYS = {
        CONFIG: `${PLATFORM}_config_v5`,
        BLOCKLIST: `${PLATFORM}_blocklist_v5`,
        PRIORITY: `${PLATFORM}_priority_v5`,
        PANEL_POS: `${PLATFORM}_panel_v5`,
        FILTER_RULES: `${PLATFORM}_filter_rules_v5`,
        THEME: `${PLATFORM}_theme_v5`,
        CONFIG_VERSION: `${PLATFORM}_config_version_v5`,
    };

    const MODE = {
        OFF: '关闭',
        CRAZY: '疯狂',
        NORMAL: '正常',
        ZEN: '佛系',
    };

    // =========================================================================
    // 模块 2：默认配置
    // =========================================================================
    const DEFAULT_THEME = {
        bgColor: '#1a1a2e',
        textColor: '#e0e0e0',
        accentColor: '#ff9800',
        borderColor: 'rgba(255,255,255,0.06)',
        opacity: 0.95,
        fontSize: '12px',
        borderRadius: '10px',
    };

    const DEFAULT_CONFIG = {
        minMsgLength: 4,
        lengthThreshold: 15,
        lengthBonus: 2.5,
        trendingThreshold: 5,
        priorityEnabled: true,
        priorityWeight: 3.0,
        crazyModeDPM: 180,
        normalModeDPM: 80,
        crazyInterval: 4,
        normalIntervalMin: 6,
        normalIntervalMax: 8,
        zenInterval: 10,
        dedupWindowSec: 120,
        dedupHistorySize: 25,
        filterRules: [],
        theme: { ...DEFAULT_THEME },
    };

    // =========================================================================
    // 模块 3：日志（单一体系，不劫持 console）
    // =========================================================================
    const Logger = {
        _logs: [],
        _maxLogs: 500,
        _debug: false,   // 默认静音 debug 级（[捕获]/[权重更新] 等洪峰噪音），info/warn/error 不受影响

        setDebug(on) { this._debug = !!on; },

        /** 调试级日志（受 debug 开关控制，不进内存列表） */
        debug(tag, ...args) {
            if (!this._debug) return;
            console.log(`[${tag}] ${new Date().toLocaleTimeString()}`, ...args);
        },

        /** 普通日志（进内存列表，可导出） */
        info(tag, content) {
            console.log(`[${tag}] ${content}`);
            this._push('info', content);
        },

        warn(tag, content) {
            console.warn(`[${tag}] ${content}`);
            this._push('warn', content);
        },

        error(tag, content) {
            console.error(`[${tag}] ${content}`);
            this._push('error', content);
        },

        send(content) {
            console.log(`[发送] ${content}`);
            this._push('send', content);
        },

        _push(level, content) {
            try {
                this._logs.push({ level, content, time: new Date().toLocaleTimeString(), ts: Date.now() });
                if (this._logs.length > this._maxLogs) this._logs.shift();
            } catch (_) { /* 忽略 */ }
        },

        getAll() { return [...this._logs]; },
        getErrors() { return this._logs.filter(l => l.level === 'error'); },
        /** 最近 windowMs 内的 error（1.1.18：模式显示用，历史错误不永久霸屏） */
        getRecentErrors(windowMs = 120000) {
            const cutoff = Date.now() - windowMs;
            return this._logs.filter(l => l.level === 'error' && (l.ts || 0) >= cutoff);
        },
        clear() { this._logs = []; },
    };

    function logError(source, err) {
        const msg = err?.message || String(err);
        Logger.error(`烂梗机`, `错误 [${source}]: ${msg}`);
    }

    // =========================================================================
    // 模块 4：工具函数
    // =========================================================================
    function detectPlatform() {
        const host = location.hostname;
        if (host.includes('douyu.com')) return 'douyu';
        if (host.includes('bilibili.com')) return 'bilibili';
        if (host.includes('douyin.com')) return 'douyin';
        if (host.includes('huya.com')) return 'huya';
        return 'unknown';
    }

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    function $(id) { return document.getElementById(id); }

    function escapeHtml(str) {
        return String(str).replace(/[&<>'"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[m] || m));
    }

    function truncate(text, maxLen) {
        return text.length > maxLen ? text.slice(0, maxLen) + '...' : text;
    }

    /** 规范化文本：去数字、标点、符号（用于智能去重合并） */
    function normalizeText(text) {
        return text.replace(/[\d\p{P}\p{S}]/gu, '').trim();
    }

    /**
     * 系统弹幕过滤（1.1.17）：欢迎语/公告/提示类弹幕不入候选。
     * 实测斗鱼把"欢迎来到yyfyyf的直播间。斗鱼严..."渲染为普通弹幕条目被采集。
     * 各平台系统消息文本特征不一，此处用启发式前缀/关键词匹配，命中即丢弃。
     */
    function isSystemDanmaku(text) {
        // 1.2.0：优先用 hybrid-core 的增强启发式（系统/公告/礼物/进场/粉丝团/风控等）
        if (typeof window.__lgjIsSystemDanmaku === 'function') {
            try { return window.__lgjIsSystemDanmaku(text); } catch (_) { /* 忽略 */ }
        }
        const t = String(text).trim();
        if (!t) return false;
        if (/^(欢迎来到|系统消息|温馨提示|欢迎.{0,12}进入直播间)/.test(t)) return true;
        if (t.length <= 40 && /^(温馨提示|系统公告|直播间提示|本直播间)/.test(t)) return true;
        return false;
    }

    // =========================================================================
    // 模块 5：DOM 查询工具
    // =========================================================================
    function queryFirst(selectors, root = document) {
        if (!selectors) return null;
        const list = Array.isArray(selectors) ? selectors : [selectors];
        for (const sel of list) {
            if (!sel || typeof sel !== 'string' || !sel.trim()) continue;
            try {
                const el = root.querySelector(sel);
                if (el) return el;
            } catch (_) { /* 无效选择器 */ }
        }
        return null;
    }

    function queryAll(selectors, root = document) {
        if (!selectors) return [];
        const list = Array.isArray(selectors) ? selectors : [selectors];
        const results = [];
        for (const sel of list) {
            if (!sel || typeof sel !== 'string' || !sel.trim()) continue;
            try {
                const els = root.querySelectorAll(sel);
                if (els.length) results.push(...els);
            } catch (_) { /* 无效选择器 */ }
        }
        return [...new Set(results)];
    }

    /** 选择器失败时按类型回退查找（input/button/generic） */
    function querySmart(selectors, root = document, type = 'generic') {
        const bySelector = queryFirst(selectors, root);
        if (bySelector) return bySelector;

        const queryMap = {
            input: 'textarea, input, [contenteditable="true"], [role="textbox"], [role="combobox"], [aria-label*="输入"], [aria-label*="发言"], [placeholder]',
            button: 'button, input[type="submit"], input[type="button"], [role="button"], [aria-label*="发送"], [aria-label*="send"], [aria-label*="提交"], [class*="send"], [class*="submit"]',
            generic: 'button, input, textarea, [contenteditable], [role="button"], [role="textbox"]',
        };
        const query = queryMap[type] || queryMap.generic;

        try {
            const visible = [...root.querySelectorAll(query)].filter(el => {
                try {
                    const rect = el.getBoundingClientRect();
                    if (rect.width === 0 && rect.height === 0) return false;
                } catch (_) { return false; }
                return el.offsetParent !== null || el.isContentEditable;
            });
            if (!visible.length) return null;
            // 取页面下方（更接近底部操作区）的元素
            visible.sort((a, b) => {
                const ra = a.getBoundingClientRect();
                const rb = b.getBoundingClientRect();
                return (rb.top + rb.bottom) - (ra.top + ra.bottom);
            });
            return visible[0];
        } catch (_) { return null; }
    }

    // =========================================================================
    // 模块 6：基础选择器（多平台）
    // =========================================================================
    const BASE_SELECTORS = {
        douyu: {
            danmuContainer: ['#js-barrage-list', '.Barrage-list', '.Barrage-main', '[class*="Barrage-list"]', '.chat-history', '.danmu-list'],
            danmuItem: ['li.Barrage-listItem', '.Barrage-listItem', '[class*="barrage-item"]'],
            danmuText: ['span.Barrage-content:not(.Barrage-pointer)', '.barrage-text', '[class*="barrage-content"]'],
            chatInput: ['div.ChatSend-txt', '.ChatSend-txt', '[contenteditable="true"]', 'textarea.chat-input', 'input.chat-input'],
            sendButton: ['.ChatSend-button', 'div.ChatSend-button', 'button[class*="send"]', '.send-btn'],
        },
        bilibili: {
            danmuContainer: ['#chat-items', '#chat-history-list', '.chat-list', '.danmaku-list'],
            danmuItem: ['.chat-item.danmaku-item', '.danmaku-item', '[class*="danmaku-item"]'],
            // 修复：'.chat-item.danmaku-item' 是条目自身，queryFirst 只查后代永远
            //      匹配不到 → data-danmaku 缺失时会回退到整条 textContent（含用户名）
            //      污染候选。'.danmaku-text' 前置为真正的文本节点选择器。
            danmuText: ['.danmaku-text', '.chat-item.danmaku-item'],
            chatInput: ['textarea.chat-input', 'textarea#chat-input', 'input[type="text"].chat-input'],
            sendButton: ['button.send-btn', '.bl-button.send-btn', 'button[class*="send"]'],
            textSource: 'data-danmaku',
        },
        douyin: {
            danmuContainer: ['.gOr3NRD4', '[class*="webcast-chatroom"]', '#chat-room', '.chat-container', '.danmu-container'],
            danmuItem: ['.webcast-chatroom___item', '.chat-item', '[class*="chat-item"]'],
            danmuText: ['.webcast-chatroom___content-with-emoji-text', '.chat-content', '.danmu-text'],
            chatInput: ['[data-slate-editor="true"]', 'div[contenteditable="true"]', '.chat-input', 'textarea.chat-input', 'input.chat-input'],
            sendButton: ['svg.webcast-chatroom___send-btn', '.webcast-chatroom___send-btn', 'button.webcast-chatroom___send-btn', 'button[class*="send"]', 'div[class*="send"]'],
        },
        huya: {
            danmuContainer: ['#chat-room__list', '#chat-room__wrap', '.chat-room__list', '#msg-list', '.chat-room-list', '.chat-messages', '.chat-history', '.danmu-list'],
            danmuItem: ['.msg-item', '.msg-normal', '.js-chat-item', '.chat-item', '[class*="chat-item"]'],
            danmuText: ['.msg-text', '.msg-content', '.J_msg', '.chat-text', '.danmu-text'],
            chatInput: ['#pub_msg_input', '#chat-input', 'textarea.input-msg', '.chat-textarea', 'textarea[placeholder*="发言"]', '#chatTextarea', 'div[contenteditable="true"]', 'input[type="text"]'],
            sendButton: ['#msg_send_bt', '.js-send-msg', '.send-btn', '.btn-sendMsg', 'button[aria-label="发送"]', 'span.send-btn', 'button[class*="send"]', 'div[class*="send"]'],
        },
    };

    // =========================================================================
    // 模块 7：选择器探测器
    // =========================================================================
    class SelectorProbe {
        constructor(platform) {
            this.platform = platform;
            this.selectors = BASE_SELECTORS[platform] || BASE_SELECTORS.douyu;
            this.cache = { danmuContainer: null, danmuContainerSelector: null };
            this.lastProbe = 0;
        }

        probeOne(selectorArray, root = document) {
            const list = Array.isArray(selectorArray) ? selectorArray : [selectorArray];
            for (const sel of list) {
                if (!sel || typeof sel !== 'string' || !sel.trim()) continue;
                try {
                    const el = root.querySelector(sel);
                    if (el) return { selector: sel, element: el };
                } catch (_) { /* 忽略 */ }
            }
            return null;
        }

        probeAll() {
            const now = Date.now();
            const cacheValid = now - this.lastProbe < TIMING.SELECTOR_REPROBE_INTERVAL
                && this.cache.danmuContainer
                && document.contains(this.cache.danmuContainer);
            if (cacheValid) return this.cache;

            this.lastProbe = now;
            const containerResult = this.probeOne(this.selectors.danmuContainer);
            if (containerResult) {
                this.cache.danmuContainer = containerResult.element;
                this.cache.danmuContainerSelector = containerResult.selector;
            } else {
                this.cache.danmuContainer = null;
            }
            return this.cache;
        }

        getSelectors() {
            const cache = this.probeAll();
            return {
                danmuContainer: cache.danmuContainer ? cache.danmuContainerSelector : null,
                // 修复：返回完整选择器数组（多候选不再只取 [0]，queryFirst/queryAll 支持数组）
                danmuItem: this.selectors.danmuItem || [],
                danmuText: this.selectors.danmuText || [],
                chatInput: this.selectors.chatInput || [],
                sendButton: this.selectors.sendButton || [],
                containerElement: cache.danmuContainer,
            };
        }

        refresh() {
            this.lastProbe = 0;
            return this.probeAll();
        }
    }

    // =========================================================================
    // 模块 8：平台解析器（弹幕文本提取 + 元素查找）
    // =========================================================================
    class PlatformParser {
        constructor(platform, probe) {
            this.platform = platform;
            this.probe = probe;
            this.selectors = probe.getSelectors();
        }

        refreshSelectors() { this.selectors = this.probe.getSelectors(); }

        extractText(danmuNode) {
            if (!danmuNode) return '';
            const sel = this.selectors;

            // B 站：优先取 data-danmaku 属性
            if (this.platform === 'bilibili' && BASE_SELECTORS.bilibili.textSource) {
                const attr = danmuNode.getAttribute('data-danmaku');
                if (attr) return attr.replace(/\s+/g, ' ').trim();
            }

            if (sel.danmuText) {
                const textEl = queryFirst(sel.danmuText, danmuNode);
                if (textEl) {
                    const text = (textEl.textContent || '').replace(/\s+/g, ' ').trim();
                    if (text) return text;
                }
            }

            return (danmuNode.textContent || '').replace(/\s+/g, ' ').trim();
        }

        /**
         * 查找弹幕容器。
         * 修复：找不到时返回 null（而非降级 document.body）——旧实现让
         *      startContainerPolling 首次轮询（1 秒）就"成功"停止，
         *      CONTAINER_POLL_MAX=45 的轮询机制形同虚设，容器晚于 1 秒渲染时
         *      observer 永久绑在 body 上（实测斗鱼/抖音均触发降级）。
         *      body 降级只应在轮询超时后由 startContainerPolling 决定。
         */
        findContainer() {
            const sel = this.selectors;
            if (sel.containerElement && document.contains(sel.containerElement)) {
                return sel.containerElement;
            }
            // 1.1.19：未知平台兜底——旧代码 BASE_SELECTORS[platform].danmuContainer
            //         在平台识别失败时会抛 TypeError，整个采集链路挂掉
            const base = BASE_SELECTORS[this.platform] || BASE_SELECTORS.douyu;
            const result = this.probe.probeOne(base.danmuContainer);
            if (result) {
                this.selectors.containerElement = result.element;
                this.selectors.danmuContainer = result.selector;
                return result.element;
            }
            return null;
        }

        findChatInput() {
            return queryFirst(this.selectors.chatInput) || querySmart(this.selectors.chatInput, document, 'input');
        }

        findSendButton() {
            return queryFirst(this.selectors.sendButton) || querySmart(this.selectors.sendButton, document, 'button');
        }

        getDanmuItemSelector() { return this.selectors.danmuItem; }    }

    /**
     * Enter 兜底策略（1.1.18 P0 双发修复，全平台统一「证据驱动」模型）
     * 背景：1.1.17 在按钮点击后「无条件」补发 Enter。平台清空输入框是异步的，
     *       click 返回时内容通常仍在 → 按钮点击其实已生效时再补 Enter 就是双发
     *       （抖音实测严重；斗鱼登录态按钮有效时同样会中招）。
     *       Enter 真正被需要的是按钮灰态/点击无效的场景（实测斗鱼 is-gray）。
     * 统一规则：发送动作（click 或 Enter）后，仅当宽限轮询确认「输入框仍未清空」
     *       这一明确失败证据时，才补发 Enter（最多一次）——两种平台行为都覆盖：
     *       - 按钮有效：清空 → 不补 Enter → 单发
     *       - 按钮灰态/无效：未清空 → 750ms 后补 Enter → 仍能发出去（斗鱼保留）
     * B 站例外：无可靠按钮，Enter 本身就是主发送动作，直接在点击路径发送；
     *       1.1.19 起 send() 用 IS_ENTER_PRIMARY 拦掉它的兜底补发（补发必双发）。
     */
    const IS_ENTER_PRIMARY = { bilibili: true };   // 其余平台 Enter 一律作兜底

    // =========================================================================
    // 模块 9：平台发送器
    // =========================================================================
    class PlatformSender {
        constructor(platform, parser) {
            this.platform = platform;
            this.parser = parser;
            this.cachedInput = null;
            this.cachedButton = null;
            this.lastCacheTime = 0;
            this._enterFallbackDone = false; // 本次发送是否已用过 Enter 兜底
        }

        refreshCache() {
            this.cachedInput = this.parser.findChatInput();
            this.cachedButton = this.parser.findSendButton();
            this.lastCacheTime = Date.now();
            if (!this.cachedInput) Logger.warn('烂梗机', '未找到输入框');
            if (!this.cachedButton) Logger.warn('烂梗机', '未找到发送按钮');
        }

        /**
         * 发送消息主入口
         * @returns {{success:boolean, errorCode:string|null, message:string}}
         */
        async send(msg) {
            if (!msg) return { success: false, errorCode: 'EMPTY_MSG', message: '消息为空' };
            if (!state.isRunning) return { success: false, errorCode: 'STOPPED', message: '机器人已停止' };

            this._enterFallbackDone = false;   // 每次发送独立判定，不跨次继承
            this._ensureCacheFresh();
            let input = this._resolveInput(this.cachedInput);
            let button = this.cachedButton;

            if (!input) {
                this.refreshCache();
                // 修复：refreshCache 成功后必须重读缓存——旧代码继续用 null 的
                // 局部 input 调 _fillInput 必抛 TypeError，首发必失败靠重试兜底
                input = this.cachedInput;
                button = this.cachedButton;
                if (!input) return { success: false, errorCode: 'INPUT_NOT_FOUND', message: '输入框未找到' };
            }

            try {
                this._fillInput(input, msg);
            } catch (e) {
                Logger.error('烂梗机', `填充输入框失败: ${e.message}`);
                return { success: false, errorCode: 'FILL_ERROR', message: e.message };
            }

            const result = await this._sendByPlatform(input, button);
            if (!result.success) return result;

            // 发送后校验输入框是否清空。
            // 修复：平台清空输入框有 100-300ms 延迟（B 站 Enter 发送尤甚），
            //      立即校验会误判 SEND_FAILED → 3 秒后重发同一条 → 弹幕重复。
            //      改为宽限轮询：最多 3 次 × 250ms 确认清空。
            // 1.1.19：每次读取都重新解析输入框——站点重渲染替换节点后，
            //         读 detached 旧节点会永远「未清空」，既误判又让兜底 Enter 打空
            const readRemaining = () => {
                input = this._resolveInput(input) || input;
                return this._getInputValue(input).trim();
            };
            let remaining = readRemaining();
            for (let i = 0; remaining !== '' && i < 3; i++) {
                await sleep(250);
                remaining = readRemaining();
            }
            // 1.1.20：B 站 Enter 是唯一发送手段，不能靠补 Enter 纠错；这里只给首次
            //         Enter 更长的清空宽限，避免「已发出但清空慢」被误判 SEND_FAILED
            //         （仍不补第二次 Enter，因此不会双发）。
            if (IS_ENTER_PRIMARY[this.platform] && remaining !== '') {
                for (let i = 0; i < 6; i++) {
                    await sleep(250);
                    remaining = readRemaining();
                    if (remaining === '') break;
                }
            }
            // 1.1.18：证据驱动 Enter 兜底——只在「按钮点击/首次 Enter 都没能清空输入框」
            // 这一明确失败证据下才补发，杜绝按钮点击已生效时的重复发送（全平台统一）
            // 1.1.19：Enter 已是主发送动作的平台（B 站）不再补第二次 Enter——
            //         首发的 Enter 若已生效只是清空慢，再补一次就是双发。
            if (remaining !== '' && !this._enterFallbackDone && !IS_ENTER_PRIMARY[this.platform]) {
                this._enterFallbackDone = true;
                Logger.warn('烂梗机', '发送按钮未生效，补发 Enter 兜底');
                this._pressEnter(input);
                for (let i = 0; i < 4; i++) {
                    await sleep(250);
                    remaining = readRemaining();
                    if (remaining === '') break;
                }
            }
            return remaining === ''
                ? { success: true, errorCode: null, message: '发送成功' }
                : { success: false, errorCode: 'SEND_FAILED', message: '发送后输入框未清空' };
        }

        // ---- 私有方法 ----

        _ensureCacheFresh() {
            const age = Date.now() - this.lastCacheTime;
            if (!this.cachedInput || !this.cachedButton || age > 30000) {
                this.refreshCache();
            }
        }

        /**
         * 输入框活性解析（1.1.19）。
         * 问题：React/Vue 重渲染会直接替换 input 节点，缓存里留的是 detached 旧节点——
         *   读取它的 value 永远是「未清空」，既误判 SEND_FAILED，也让 Enter 兜底
         *   派发到游离节点上（发不出去，斗鱼灰态兜底失效）。
         * 修复：每次读取前确认节点仍在文档中，不在则重新查找。
         */
        _resolveInput(input) {
            const alive = (el) => {
                try {
                    if (!el) return false;
                    if (typeof document.contains === 'function') return document.contains(el);
                    return document.body.contains(el);
                } catch (_) { return false; }
            };
            if (alive(input)) return input;
            this.refreshCache();
            return this.cachedInput;
        }

        _getInputValue(input) {
            try { return input.value || input.innerText || ''; } catch (_) { return ''; }
        }

        _fillInput(input, msg) {
            try { input.focus(); } catch (_) { /* 忽略 */ }

            if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
                input.value = msg;
            } else if (input.isContentEditable) {
                input.innerText = '';
                try {
                    const sel = window.getSelection();
                    const range = document.createRange();
                    range.selectNodeContents(input);
                    sel.removeAllRanges();
                    sel.addRange(range);
                    document.execCommand('insertText', false, msg);
                } catch (_) {
                    input.innerText = msg;
                }
                if (input.innerText !== msg) input.innerText = msg;
            } else {
                input.value = msg;
            }

            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            // 修复：斗鱼等受控 contenteditable（React/slate）只响应带 data 的
            //      InputEvent——实测仅派发 Event('input') 时发送按钮保持灰色未激活。
            //      补发 InputEvent(inputType=insertText, data=msg) 让框架状态同步。
            try {
                input.dispatchEvent(new InputEvent('input', {
                    bubbles: true, data: msg, inputType: 'insertText', isComposing: false,
                }));
            } catch (_) { /* 忽略 */ }
            try {
                input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
                input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: msg }));
            } catch (_) { /* 忽略 */ }
        }

        async _sendByPlatform(input, btn) {
            switch (this.platform) {
                case 'douyin': return this._sendDouyin(input, btn);
                case 'huya': return this._sendHuya(input, btn);
                case 'bilibili': return this._sendBilibili(input);
                default: return this._sendGeneric(input, btn);
            }
        }

        async _sendDouyin(input, btn) {
            input.dispatchEvent(new Event('beforeinput', { bubbles: true }));
            await sleep(100);

            btn = this._ensureButton(btn);
            if (!btn) return { success: false, errorCode: 'BUTTON_NOT_FOUND', message: '发送按钮未找到' };

            this._enableButton(btn);
            this._clickElement(btn);
            // 1.1.18：不再点完立即补 Enter——抖音按钮点击通常有效，立即补发会双发
            //         （实测严重）。失败场景由 send() 宽限轮询后的证据驱动兜底接管。
            return { success: true };
        }

        async _sendHuya(input, btn) {
            input.focus();
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', bubbles: true }));
            input.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', code: 'KeyA', bubbles: true }));
            await sleep(50);

            btn = this._ensureButton(btn);
            if (!btn) return { success: false, errorCode: 'BUTTON_NOT_FOUND', message: '虎牙发送按钮未找到' };

            this._enableButton(btn);
            this._clickElement(btn);
            this._triggerReactHandlers(btn);
            // 1.1.18：同抖音，点完不立即补 Enter，失败由证据驱动兜底
            return { success: true };
        }

        async _sendBilibili(input) {
            await sleep(50);
            // B 站：Enter 是主发送动作（无可靠按钮），直接发送。
            // 1.1.19：发送后即使输入框未清空也不再补第二次 Enter——首发 Enter
            //         很可能已生效只是清空慢，补发即双发（IS_ENTER_PRIMARY 在
            //         send() 中拦截兜底分支）。
            this._pressEnter(input);
            return { success: true };
        }

        async _sendGeneric(input, btn) {
            await sleep(100);
            btn = this._ensureButton(btn);
            if (!btn) return { success: false, errorCode: 'BUTTON_NOT_FOUND', message: '通用发送按钮未找到' };

            this._enableButton(btn);
            this._clickElement(btn);
            // 1.1.18：不再点完立即补 Enter（登录态按钮有效时会双发）。
            // 斗鱼灰态/点击无效时，send() 的宽限轮询后凭「输入框未清空」证据补发
            // Enter —— Enter 兜底能力完整保留，只是从「无条件」变成「有条件」
            return { success: true };
        }

        _ensureButton(btn) {
            if (!btn || !document.body.contains(btn)) {
                this.refreshCache();
                return this.cachedButton;
            }
            return btn;
        }

        _enableButton(btn) {
            try {
                btn.classList.remove('disable', 'disabled', 'is-disabled');
                btn.removeAttribute('disabled');
                btn.disabled = false;
            } catch (_) { /* 忽略 */ }
        }

        _clickElement(el) {
            for (const type of ['mousedown', 'mouseup', 'click']) {
                try { el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true })); } catch (_) { /* 忽略 */ }
            }
            try {
                el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true }));
                el.dispatchEvent(new TouchEvent('touchend', { bubbles: true }));
            } catch (_) { /* 忽略 */ }
        }

        /**
         * 派发 Enter。
         * 修复（1.1.19）：keyCode/which 写在 KeyboardEvent 构造参数里在部分内核会被
         *   丢弃（二者是 legacy 只读属性），站点/jQuery 处理器判断 e.keyCode === 13
         *   或 e.which === 13 时收到 0/undefined → Enter 兜底形同虚设（斗鱼灰态
         *   按钮场景正是靠这条路径发得出去）。改为构造后用 defineProperty 强制
         *   覆盖实例属性，保证任何读取方式都拿到 13。
         * 注意：不派发 keypress——站点可能同时监听 keydown/keypress，会导致双发。
         */
        _pressEnter(input) {
            for (const type of ['keydown', 'keyup']) {
                try {
                    const ev = new KeyboardEvent(type, {
                        key: 'Enter', code: 'Enter', bubbles: true, cancelable: true,
                        keyCode: 13, which: 13,   // 部分内核支持构造参数，先给上
                    });
                    Object.defineProperty(ev, 'keyCode', { get: () => 13, configurable: true });
                    Object.defineProperty(ev, 'which', { get: () => 13, configurable: true });
                    input.dispatchEvent(ev);
                } catch (_) { /* 忽略 */ }
            }
        }

        _triggerReactHandlers(el) {
            try {
                const reactKeys = Object.keys(el).filter(k =>
                    k.startsWith('__reactEventHandlers') || k.startsWith('_reactListeners') || k.startsWith('__reactProps')
                );
                for (const key of reactKeys) {
                    const props = el[key];
                    if (!props) continue;
                    for (const handler of ['onClick', 'onMouseDown', 'onTouchEnd', 'onPress']) {
                        if (typeof props[handler] === 'function') {
                            try { props[handler](new MouseEvent('click', { bubbles: true })); } catch (_) { /* 忽略 */ }
                        }
                    }
                }
            } catch (_) { /* 忽略 */ }
        }
    }

    // =========================================================================
    // 模块 10：状态管理
    // =========================================================================
    function createInitialState() {
        return {
            config: { ...DEFAULT_CONFIG },
            // 定时器
            mainTimer: null,
            countdownTimer: null,
            schedulerBusy: false,   // 单链守卫：runBot 异步执行期间禁止重复启动调度链
            epoch: 0,               // 调度代际令牌：stopBot 时 +1，旧链回调凭此自毁
            standDown: false,       // B 类房间主文档让位标志：让位后本实例空转（无面板/无采集）
            nextSendTimestamp: 0,
            // 运行状态
            currentMode: MODE.OFF,
            isRunning: false,
            // 弹幕数据
            freqMap: new Map(),
            weightedMap: new Map(),
            candidateCount: 0,
            danmuDirty: false,
            // 发送历史
            recentSent: [],
            sentHistory: [],
            lastSentMsg: '',
            nextPreviewMsg: '',
            pendingMsg: null,
            retryCount: 0,
            lastRetryTime: 0,
            lastErrorCode: null,    // 最近一次发送失败的错误码（SEND_FAILED 不重试）
            isSending: false,
            // 屏蔽 / 优先词
            blocklist: [],
            priorityWords: [],
            // 弹幕监听
            danmuObserver: null,
            containerElement: null,
            degradedToBody: false,  // 容器查找超时降级到 body：此后只认「像弹幕」的节点
            // 1.1.19：让位/降级时可清理的周期定时器句柄
            containerPollTimer: null,
            blancWatchTimer: null,
            // DPM 统计
            timestamps: [],
            lastTsCleanup: 0,
            // 配置同步
            configVersion: 0,
            weightUpdateScheduled: false,
        };
    }

    const state = createInitialState();

    // =========================================================================
    // 模块 11：屏蔽词 / 筛选规则 / 权重计算
    // =========================================================================
    // 正则缓存：避免每次调用都重新编译 RegExp（P1-1 修复）
    const regexCache = new Map();

    function cachedRegex(pattern, flags) {
        const f = flags || 'i';
        const key = `${f}\u0000${pattern}`;
        if (regexCache.has(key)) return regexCache.get(key);
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
    function isRegexPattern(str) {
        return str.startsWith('/') && str.endsWith('/') && str.length > 2;
    }

    function evaluateLengthRule(len, op, value) {
        switch (op) {
            case '>': return len > value;
            case '<': return len < value;
            case '>=': return len >= value;
            case '<=': return len <= value;
            case '==': return len === value;
            default: return true;
        }
    }

    function isBlocked(text) {
        // 屏蔽词
        for (const rule of state.blocklist) {
            if (!rule) continue;
            if (isRegexPattern(rule)) {
                const re = cachedRegex(rule.slice(1, -1));
                if (re && re.test(text)) return true;
            } else {
                if (text.toLowerCase().includes(rule.toLowerCase())) return true;
            }
        }

        // 筛选规则（length / contains / not_contains / regex）
        const rules = state.config.filterRules || [];
        for (const rule of rules) {
            if (rule.type === 'length') {
                if (!evaluateLengthRule(text.length, rule.op, rule.value)) return true;
            } else if (rule.type === 'contains') {
                if (!text.includes(rule.value)) return true;
            } else if (rule.type === 'not_contains') {
                if (text.includes(rule.value)) return true;
            } else if (rule.type === 'regex') {
                const re = cachedRegex(rule.value, rule.flags);
                if (re && !re.test(text)) return true;
            }
        }
        return false;
    }

    function getPriorityMultiplier(text) {
        if (!state.config.priorityEnabled || !state.priorityWords.length) return 1;
        for (const word of state.priorityWords) {
            if (!word) continue;
            const matched = isRegexPattern(word)
                ? (() => { const re = cachedRegex(word.slice(1, -1)); return re ? re.test(text) : false; })()
                : text.toLowerCase().includes(word.toLowerCase());
            if (matched) return state.config.priorityWeight;
        }
        return 1;
    }

    function getLengthMultiplier(text) {
        return text.length > state.config.lengthThreshold ? state.config.lengthBonus : 1;
    }

    // =========================================================================
    // 模块 12：DPM 统计
    // =========================================================================
    function recordMessageTimestamp() {
        const now = Date.now();
        state.timestamps.push(now);

        if (state.timestamps.length > TIMING.MAX_TIMESTAMPS) {
            state.timestamps = state.timestamps.slice(-TIMING.MAX_TIMESTAMPS);
        }

        if (now - state.lastTsCleanup > TIMING.TS_CLEANUP_INTERVAL) {
            const cutoff = now - TIMING.MAX_TS_AGE_MS;
            state.timestamps = state.timestamps.filter(ts => ts > cutoff);
            state.lastTsCleanup = now;
        }
    }

    function getMessagesPerMinute() {
        const cutoff = Date.now() - TIMING.DPM_WINDOW_MS;
        if (state.timestamps.length > 0 && state.timestamps[0] < cutoff) {
            state.timestamps = state.timestamps.filter(ts => ts > cutoff);
        }
        return state.timestamps.length;
    }

    // =========================================================================
    // 模块 13：弹幕采集（MutationObserver）
    // =========================================================================
    /**
     * 降级模式下的「像弹幕」判定（1.1.19）。
     * 容器查找超时后 observer 绑在 document.body 上，此时必须靠类名关键词
     * 把弹幕节点从页面海量新增节点里筛出来，否则 DPM 会被无关节点灌满。
     */
    const DANMU_LIKE_SELECTOR = [
        '[class*="danm"]', '[class*="danmu"]', '[class*="barrage"]', '[class*="chat"]',
        '[class*="msg"]', '[class*="message"]', '[class*="comment"]', '[class*="bullet"]',
    ].join(',');

    function isDanmuLikeNode(node) {
        try {
            if (!node || node.nodeType !== 1 || !node.matches) return false;
            if (node.matches(DANMU_LIKE_SELECTOR)) return true;
            const p = node.parentElement || (node.parentNode && node.parentNode.nodeType === 1 ? node.parentNode : null);
            return !!(p && p.matches && p.matches(DANMU_LIKE_SELECTOR));
        } catch (_) {
            return false;
        }
    }

    function startDanmuObserver(container) {
        // 1.1.20：让位后禁止任何路径重新启动 observer
        if (state.standDown) return;
        // 断开旧监听
        if (state.danmuObserver) {
            try { state.danmuObserver.disconnect(); } catch (_) { /* 忽略 */ }
        }

        // 重置统计与缓存（新直播间重新统计；协议掉线回落 DOM 时保留，避免候选池清零）
        if (!window.__lgjKeepStats) {
            state.timestamps = [];
            state.lastTsCleanup = 0;
            state.freqMap.clear();
            state.weightedMap.clear();
            state.danmuDirty = true;
        }

        /**
         * 处理单个新增节点，返回是否捕获到弹幕。
         * 修复：1) 节点自身是弹幕条目 → 计 1 次；
         *      2) 节点是批量容器（内含多条弹幕）→ 每条子弹幕项各计 1 次，
         *         不再只计第一条（DPM 低估 bug）。
         */
        const handleNode = (node) => {
            if (node.nodeType !== Node.ELEMENT_NODE) return false;

            const selectors = parser.getDanmuItemSelector() || [];
            // 单条弹幕处理：提取 → 系统弹幕过滤 → 入池
            const captureOne = (el, tag) => {
                const text = parser.extractText(el);
                if (!text) return false;
                if (isSystemDanmaku(text) || (window.__lgjIsSystemNode && window.__lgjIsSystemNode(el))) {
                    if (window.__lgjCountSystemFiltered) { try { window.__lgjCountSystemFiltered(text); } catch (_) { /* 忽略 */ } }
                    Logger.debug('过滤', `系统弹幕: "${text.slice(0, 40)}"`);
                    return false;
                }
                Logger.debug(tag, `"${text}"`);
                addDanmuToCache(text);
                recordMessageTimestamp();
                return true;
            };

            // 1) 节点自身即弹幕条目（如斗鱼 li.Barrage-listItem）→ 按单条弹幕处理
            const isDanmuItem = selectors.some(sel => {
                try { return node.matches && node.matches(sel); } catch (_) { return false; }
            });
            if (isDanmuItem) return captureOne(node, '捕获');

            // 2) 批量容器节点 → 遍历所有子弹幕项，每条都计数
            if (selectors.length) {
                const items = queryAll(selectors, node);
                let captured = false;
                for (const item of items) {
                    if (captureOne(item, '捕获(子)')) captured = true;
                }
                // 修复：批量选择器失配（items 为空）时不再静默失效，落入分支 3 按文本兜底
                if (captured) return true;
            }

            // 3) 无弹幕条目选择器/批量选择器失配时的兜底：按节点文本处理
            //    1.1.19：降级到 body 时，页面任何新增节点（按钮文案、时间戳、
            //    礼物条……）都会走到这里被当成弹幕 → 垃圾入池 + DPM 虚高（误判
            //    疯狂模式）。降级模式只接受「像弹幕」的节点（类名/父级类名含
            //    danmu/chat/msg/barrage 等关键词）。
            if (state.degradedToBody && !isDanmuLikeNode(node)) return false;
            return captureOne(node, '捕获');
        };

        state.danmuObserver = new MutationObserver(mutations => {
            let hasNew = false;
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (handleNode(node)) hasNew = true;
                }
            }
            if (hasNew) scheduleWeightUpdate();
        });

        state.danmuObserver.observe(container, { childList: true, subtree: true });
        Logger.info('烂梗机', '弹幕监听已启动');
    }

    function addDanmuToCache(text) {
        if (!text) return;
        const now = Date.now();
        const existing = state.freqMap.get(text);

        // 修复：滑动时间窗口统计
        // - 若该弹幕在窗口期内再次出现 → count 递增
        // - 若超过窗口（旧弹幕，很久没刷了）→ 重置 count=1，重新计
        // - 杜绝「历史累计计数」导致旧弹幕权重永久霸榜、发送过期弹幕
        if (existing && now - existing.lastSeen < TIMING.FREQ_WINDOW_MS) {
            state.freqMap.set(text, { count: existing.count + 1, lastSeen: now });
        } else {
            state.freqMap.set(text, { count: 1, lastSeen: now });
        }

        // 容量限制：保留频次最高的
        if (state.freqMap.size > TIMING.DANMU_CACHE_MAX) {
            const entries = [...state.freqMap.entries()].sort((a, b) => b[1].count - a[1].count);
            state.freqMap = new Map(entries.slice(0, TIMING.DANMU_CACHE_MAX));
        }

        state.danmuDirty = true;
        scheduleWeightUpdate();
    }

    // =========================================================================
    // 模块 14：权重更新与候选生成
    // =========================================================================
    function scheduleWeightUpdate() {
        if (state.weightUpdateScheduled) return;
        state.weightUpdateScheduled = true;

        const doUpdate = () => updateWeights();
        if (window.requestIdleCallback) {
            requestIdleCallback(doUpdate, { timeout: 200 });
        } else {
            setTimeout(doUpdate, 50);
        }
    }

    function updateWeights() {
        state.weightUpdateScheduled = false;
        state.danmuDirty = false;

        const now = Date.now();
        const windowMs = state.config.dedupWindowSec * 1000;
        const cutoff = windowMs > 0 ? now - windowMs : 0;

        const recentTexts = new Set(state.recentSent.filter(m => m.timestamp > cutoff).map(m => m.text));
        const historySet = new Set(state.sentHistory);
        // 修复：发送去重覆盖规范化变体（如 "哈哈哈666" 与 "哈哈哈"），
        //      避免近似弹幕在原文排除后重新进入候选造成重复
        const recentNorms = new Set(
            state.recentSent.filter(m => m.timestamp > cutoff).map(m => normalizeText(m.text)).filter(Boolean)
        );
        const historyNorms = new Set(state.sentHistory.map(normalizeText).filter(Boolean));

        const newMap = new Map();
        for (const [text, data] of state.freqMap.entries()) {
            if (text.length < state.config.minMsgLength) continue;
            if (isBlocked(text)) continue;
            const norm = normalizeText(text);
            if (recentTexts.has(text) || (norm && recentNorms.has(norm))) continue;
            if (historySet.has(text) || (norm && historyNorms.has(norm))) continue;

            // 修复：freqMap 现在存 {count, lastSeen}
            // - 距上次出现超过窗口的弹幕视为过期，不再进入候选
            // - 确保发送的是「当前正在刷」的弹幕，而非很久之前的旧弹幕
            if (now - data.lastSeen > TIMING.FREQ_WINDOW_MS) continue;

            const weight = data.count * data.count * getLengthMultiplier(text) * getPriorityMultiplier(text);
            newMap.set(text, { count: data.count, weight });
        }
        state.weightedMap = newMap;

        // 清理 freqMap 中的过期条目（避免旧弹幕残留占内存）
        for (const [text, data] of state.freqMap.entries()) {
            if (now - data.lastSeen > TIMING.FREQ_WINDOW_MS) {
                state.freqMap.delete(text);
            }
        }
        Logger.debug('权重更新', `freqMap=${state.freqMap.size} -> 候选=${newMap.size}`);
    }

    /**
     * 获取候选列表（含智能去重）
     * P0-1 修复：规范化后为空的文本（如纯数字"666"）回退为原文参与候选，
     *           不再被直接丢弃
     */
    function getWeightedCandidates() {
        if (state.danmuDirty) {
            Logger.debug('候选列表', '缓存脏，同步更新权重');
            updateWeights();
        }

        let candidates = [];
        for (const [text, data] of state.weightedMap) {
            candidates.push({ text, count: data.count, weight: data.weight, length: text.length });
        }

        // 智能去重：按规范化文本合并，保留权重最高者
        const normMap = new Map();
        for (const c of candidates) {
            const norm = normalizeText(c.text);
            // 修复点：规范化后为空（纯数字/符号弹幕）直接保留原文，不淘汰
            const key = norm || c.text;
            const existing = normMap.get(key);
            if (!existing || existing.weight < c.weight) {
                normMap.set(key, c);
            }
        }
        candidates = [...normMap.values()];

        // 按权重降序（保证预览取最高权重）
        candidates.sort((a, b) => b.weight - a.weight);

        // 候选词数量上限（实时刷新但限制最多 50 条，避免候选池过大）
        if (candidates.length > TIMING.MAX_CANDIDATES) {
            candidates = candidates.slice(0, TIMING.MAX_CANDIDATES);
        }

        state.candidateCount = candidates.length;
        return candidates;
    }

    /** 加权随机选择（O(n) 一次遍历） */
    function weightedRandomSelect(candidates) {
        if (!candidates.length) return null;

        // 趋势置顶：频次达阈值直接返回
        if (state.config.trendingThreshold > 0) {
            let top = candidates[0];
            for (const c of candidates) {
                if (c.count > top.count) top = c;
            }
            if (top.count >= state.config.trendingThreshold) return top;
        }

        // 按权重随机（1.2.0：叠加协议结构化数据 boost，DOM 模式为 1）
        let total = 0;
        for (const c of candidates) {
            if (window.__lgjMetaBoost) { try { c.weight *= window.__lgjMetaBoost(c.text); } catch (__e) { /* 忽略 */ } }
            total += c.weight;
        }
        if (total <= 0) return candidates[0];

        let rand = Math.random() * total;
        for (const c of candidates) {
            rand -= c.weight;
            if (rand < 0) return c;
        }
        return candidates[candidates.length - 1];
    }

    // =========================================================================
    // 模块 15：消息发送与历史
    // =========================================================================
    async function sendMessage(msg) {
        if (!msg || state.isSending) return { success: false, errorCode: 'BUSY', message: '正在发送中' };
        if (!state.isRunning) return { success: false, errorCode: 'STOPPED', message: '机器人已停止' };

        // 1.2.0 L3 安全阀（fail-closed）：仅在确实要发送时判定；
        // 未就绪/未确认/被拦截一律拒发，且返回 SAFETY_* 错误码
        if (!window.__lgjSafety || !window.__lgjSafety.allow(msg)) {
            var __svReason = window.__lgjSafety ? window.__lgjSafety.reasonText() : '安全阀未就绪';
            var __svCode = window.__lgjSafety ? window.__lgjSafety.reason() : 'NOT_READY';
            try { console.warn('[烂梗机-安全阀] ', __svReason); if (window.__lgjLog) window.__lgjLog('安全阀', __svReason + ' | ' + __svCode); } catch (__w) { /* 忽略 */ }
            return { success: false, errorCode: 'SAFETY_' + __svCode, message: '安全阀拦截: ' + __svReason };
        }
        state.isSending = true;
        try {
            const result = await (window.__lgjSend ? window.__lgjSend(msg) : sender.send(msg));
            if (result.success && window.__lgjSafety) { try { window.__lgjSafety.note(msg); } catch (__e) { /* 忽略 */ } }
            if (result.success) {
                updateSentHistory(msg);
                state.pendingMsg = null;
                state.retryCount = 0;
                state.lastRetryTime = 0;
                state.lastErrorCode = null;
                Logger.send(`发送成功: ${msg}${window.__lgjSendCtx ? ' | ' + window.__lgjSendCtx() : ''}`);
                return { success: true };
            } else {
                state.pendingMsg = msg;
                state.lastRetryTime = Date.now();
                state.lastErrorCode = result.errorCode || 'UNKNOWN';
                Logger.warn('烂梗机', `发送失败: ${result.message} (${result.errorCode})`);
                return result;
            }
        } catch (e) {
            logError('sendMessage', e);
            state.pendingMsg = msg;
            state.lastRetryTime = Date.now();
            state.lastErrorCode = 'EXCEPTION';
            return { success: false, errorCode: 'EXCEPTION', message: e.message };
        } finally {
            state.isSending = false;
        }
    }

    function updateSentHistory(msg) {
        const now = Date.now();

        // 短时去重窗口。
        // 修复：dedupWindowSec=0 语义为「关闭窗口去重」——旧实现此时停止清理
        //      recentSent（数组无限增长且永久参与去重），语义反转。
        const windowMs = state.config.dedupWindowSec * 1000;
        if (windowMs > 0) {
            state.recentSent.push({ text: msg, timestamp: now });
            state.recentSent = state.recentSent.filter(m => m.timestamp > now - windowMs);
        } else {
            state.recentSent = [];
        }

        // 历史队列。
        // 修复：dedupHistorySize=0 语义为「关闭历史去重」——旧实现回退到 100 条。
        const maxHistory = Math.max(0, state.config.dedupHistorySize || 0);
        if (maxHistory > 0) {
            state.sentHistory.push(msg);
            while (state.sentHistory.length > maxHistory) state.sentHistory.shift();
        } else {
            state.sentHistory = [];
        }

        state.lastSentMsg = msg;
        // 修复：发送后清空候选池中的近似变体（数据源 freqMap + 候选池 weightedMap），
        //      防止变体在下轮 updateWeights 重建时重新入选造成重复刷屏
        purgeSentVariants(msg);
        state.danmuDirty = true;
        // P1-5 修复：发送后走惰性更新，不做同步全量重算
        scheduleWeightUpdate();
    }

    /**
     * 发送后清理近似变体候选。
     * - 精确原文：从 freqMap 与 weightedMap 中删除
     * - 规范化变体（如 "66666"→"666666"、"哈哈哈666"→"哈哈哈"）：
     *   中文/文字变体按规范化文本删除；纯数字/符号弹幕（规范化为空）
     *   删除所有同类候选，防止数字刷屏变体重复
     * - 注意：直播间若继续刷同类弹幕，addDanmuToCache 会重新采集入库，可正常复读
     */
    function purgeSentVariants(msg) {
        const msgNorm = normalizeText(msg);
        const isPureSymbols = msgNorm === ''; // 纯数字/符号弹幕

        // 精确原文删除
        state.freqMap.delete(msg);
        state.weightedMap.delete(msg);

        // 变体删除：遍历所有候选，规范化后与已发送消息相同的全部移除
        for (const key of [...state.freqMap.keys()]) {
            const norm = normalizeText(key);
            if (isPureSymbols ? norm === '' : (norm && norm === msgNorm)) {
                state.freqMap.delete(key);
            }
        }
        for (const key of [...state.weightedMap.keys()]) {
            const norm = normalizeText(key);
            if (isPureSymbols ? norm === '' : (norm && norm === msgNorm)) {
                state.weightedMap.delete(key);
            }
        }
    }

    // =========================================================================
    // 模块 16：调度器（单一调度链，P0-3 修复）
    // =========================================================================
    /**
     * P0-3 修复：移除 retryTimer，所有调度统一走 mainTimer 单链。
     * pendingMsg 重试通过「时间检查」嵌入同一调度链，避免双定时器竞态。
     */
    async function runBot() {
        if (!state.isRunning || state.isSending) return;
        // L4：非 leader 标签页不发送（多标签唯一发送者）
        if (window.__lgjIsLeader && !window.__lgjIsLeader()) return;

        // 有待重试消息：检查是否到达重试时间
        if (state.pendingMsg) {
            const now = Date.now();
            const due = now - state.lastRetryTime >= TIMING.RETRY_DELAY_MS;
            // 修复：SEND_FAILED（输入框未清空）不重试——可能实际已发出，
            //      重发只会造成重复弹幕；仅"明确未发出"的错误才重试
            const retryable = state.lastErrorCode && state.lastErrorCode !== 'SEND_FAILED'
                && state.lastErrorCode !== 'SAFETY_RANDOM_SKIP';

            if (state.retryCount < TIMING.RETRY_MAX_ATTEMPTS && due && retryable) {
                state.retryCount++;
                state.lastRetryTime = now;
                await sendMessage(state.pendingMsg);
                // 1.1.20：重试成功后立即刷新「下次」预览，避免继续显示刚发出的 pending
                if (!state.pendingMsg) {
                    const nextCandidates = getWeightedCandidates();
                    state.nextPreviewMsg = nextCandidates[0]?.text || '';
                }
            } else if (state.retryCount >= TIMING.RETRY_MAX_ATTEMPTS || !retryable) {
                if (!retryable) {
                    Logger.warn('烂梗机', `SEND_FAILED 不重试（可能已发出），丢弃: ${state.pendingMsg}`);
                } else {
                    Logger.warn('烂梗机', `超过最大重试次数，丢弃: ${state.pendingMsg}`);
                }
                state.pendingMsg = null;
                state.retryCount = 0;
                state.lastRetryTime = 0;
                state.lastErrorCode = null;
            }
            return;
        }

        // 正常流程：选择并发送
        const candidates = getWeightedCandidates();
        if (!candidates.length) return;

        const selected = weightedRandomSelect(candidates);
        if (window.__lgjOnSelect) { try { window.__lgjOnSelect(selected, candidates); } catch (__e) { /* 忽略 */ } }
        if (!selected || !state.isRunning) return;

        state.nextPreviewMsg = selected.text;
        const result = await sendMessage(selected.text);
        if (result.success) {
            const nextCandidates = getWeightedCandidates();
            state.nextPreviewMsg = nextCandidates[0]?.text || '';
        }
    }

    /** 计算下次发送间隔（按模式 + 随机抖动） */
    function calculateSendInterval() {
        let base;
        switch (state.currentMode) {
            case MODE.CRAZY: base = state.config.crazyInterval * 1000; break;
            case MODE.NORMAL:
                base = (Math.random() * (state.config.normalIntervalMax - state.config.normalIntervalMin)
                    + state.config.normalIntervalMin) * 1000;
                break;
            default: base = state.config.zenInterval * 1000; break;
        }
        // 抖动 ±1 秒，降低检测风险
        base += Math.random() * 2000 - 1000;
        return Math.max(base, TIMING.MIN_SEND_INTERVAL_MS);
    }

    /** 单一调度链：runBot → 计算间隔 → 设置 mainTimer */
    function scheduleNext() {
        if (!state.isRunning) return;
        // 单链守卫：runBot 是异步的，在 await 期间 mainTimer 尚未指向新定时器，
        // switchMode()（被 UI 循环每秒调用）会误判「无调度」而再次启动一条链，
        // 导致双链并存 → 一次发送两条弹幕。busy 标志彻底堵住该重入窗口。
        if (state.schedulerBusy) return;

        state.schedulerBusy = true;
        const epoch = state.epoch; // 捕获当前代际：停止后旧链回调不得再动调度状态
        runBot().catch(e => logError('scheduleNext.runBot', e)).then(() => {
            // 修复：stopBot 会把 schedulerBusy 强制复位，若旧 runBot 仍在飞行，
            //      快速关→开时旧链回调会清掉新链的 busy 标志并重复 setTimeout
            //      → 双链复活。epoch 不一致说明本链已被 stopBot 作废，直接丢弃。
            if (epoch !== state.epoch) return;
            state.schedulerBusy = false;
            if (!state.isRunning) return;

            const interval = state.pendingMsg
                ? TIMING.RETRY_DELAY_MS          // 有待重试消息：按重试间隔
                : calculateSendInterval();

            state.nextSendTimestamp = Date.now() + interval;
            state.mainTimer = setTimeout(scheduleNext, interval);
        });
    }

    /** 根据 DPM 切换发送模式 */
    function switchMode() {
        if (!state.isRunning) return;

        const dpm = getMessagesPerMinute();
        const oldMode = state.currentMode;

        if (dpm > state.config.crazyModeDPM) state.currentMode = MODE.CRAZY;
        else if (dpm > state.config.normalModeDPM) state.currentMode = MODE.NORMAL;
        else state.currentMode = MODE.ZEN;

        if (oldMode !== state.currentMode) {
            Logger.debug('模式切换', `${oldMode} -> ${state.currentMode} (DPM=${dpm})`);
        }
        // 仅当既无已排定定时器、也无正在执行的调度链时才启动新链，防止双链竞态
        if (!state.mainTimer && !state.schedulerBusy) scheduleNext();
    }

    function stopBot() {
        state.epoch++; // 作废旧调度链：飞行中的 runBot 回调凭 epoch 自毁
        if (state.mainTimer) { clearTimeout(state.mainTimer); state.mainTimer = null; }
        state.schedulerBusy = false; // 中断可能正在执行的调度链
        if (state.countdownTimer) { clearInterval(state.countdownTimer); state.countdownTimer = null; }
        if (state.danmuObserver) {
            try { state.danmuObserver.disconnect(); } catch (_) { /* 忽略 */ }
            state.danmuObserver = null;
        }

        state.currentMode = MODE.OFF;
        state.candidateCount = 0;
        state.nextPreviewMsg = '';
        state.pendingMsg = null;
        state.retryCount = 0;
        state.lastRetryTime = 0;
        // 1.1.20：不要在这里强制清 isSending。飞行中的 sendMessage 结束时会再清一次，
        // 快速关→开会把新发送的 busy 标志误清掉，造成并发发送；保留该标志让旧发送
        // 自然结束后再恢复调度即可。
        // state.isSending = false;

        updateUIDisplay(getMessagesPerMinute());
        Logger.info('烂梗机', '机器人已停止');
    }

    /**
     * 确保弹幕监听器在运行。
     * 修复：stopBot() 会断开 observer，但重新打开开关时 switchMode()
     *      只重启调度器、不恢复 observer → 弹幕采集永久停止，
     *      候选数冻结在关闭前的值。打开开关时必须重新启动监听。
     */
    function ensureObserverRunning() {
        if (state.standDown) return;      // 已让位：不再恢复监听
        // 1.2.0：协议源接管时不得再启动 DOM observer（避免双源叠加）
        if (window.__lgjSourceKind === 'protocol') return;
        if (state.danmuObserver) return; // 已在监听中

        // 1.1.20：优先重新探测真实容器；若此前已经降级到 body，则恢复 body 监听。
        // 旧实现只调用 parser.findContainer()，body 降级后轮询已经结束，
        // 用户关掉再打开开关时 findContainer() 返回 null → 永久不再采集。
        let container = null;
        try {
            container = parser.findContainer();
        } catch (e) {
            logError('ensureObserverRunning.findContainer', e);
        }
        if (container) {
            state.degradedToBody = false;
            state.containerElement = container;
            startDanmuObserver(container);
            Logger.info('烂梗机', '弹幕监听已重新启动');
            return;
        }
        if (state.degradedToBody && document.body) {
            state.containerElement = document.body;
            startDanmuObserver(document.body);
            Logger.info('烂梗机', '弹幕监听已重新启动（body 降级模式）');
            return;
        }
        Logger.debug('烂梗机', '容器未就绪，等待轮询接管');
    }

    // =========================================================================
    // 模块 17：配置管理
    // =========================================================================
    function loadConfig() {
        try {
            const saved = GM_getValue(STORAGE_KEYS.CONFIG, {});
            state.config = { ...DEFAULT_CONFIG, ...saved };

            const theme = GM_getValue(STORAGE_KEYS.THEME, null);
            if (theme) state.config.theme = { ...DEFAULT_THEME, ...theme };

            state.configVersion = GM_getValue(STORAGE_KEYS.CONFIG_VERSION, 0);
        } catch (_) {
            state.config = { ...DEFAULT_CONFIG };
            state.configVersion = 0;
        }

        state.blocklist = safeGetValue(STORAGE_KEYS.BLOCKLIST, []);
        state.priorityWords = safeGetValue(STORAGE_KEYS.PRIORITY, []);
        state.config.filterRules = safeGetValue(STORAGE_KEYS.FILTER_RULES, []);

        applyTheme(state.config.theme);
        Logger.info('烂梗机', '配置加载完成');
    }

    function safeGetValue(key, fallback) {
        try { return GM_getValue(key, fallback); } catch (_) { return fallback; }
    }

    function saveConfigValue(key, value) {
        state.config[key] = value;
        GM_setValue(STORAGE_KEYS.CONFIG, state.config);
        if (key === 'filterRules') GM_setValue(STORAGE_KEYS.FILTER_RULES, value);
        bumpConfigVersion();
    }

    function saveTheme(theme) {
        state.config.theme = { ...state.config.theme, ...theme };
        GM_setValue(STORAGE_KEYS.THEME, state.config.theme);
        applyTheme(state.config.theme);
        bumpConfigVersion();
    }

    function bumpConfigVersion() {
        state.configVersion = (state.configVersion || 0) + 1;
        GM_setValue(STORAGE_KEYS.CONFIG_VERSION, state.configVersion);
    }

    /** 跨页面配置同步检测 */
    function checkConfigUpdate() {
        try {
            const newVer = GM_getValue(STORAGE_KEYS.CONFIG_VERSION, 0);
            if (newVer !== state.configVersion) {
                state.configVersion = newVer;
                loadConfig();
                applyTheme(state.config.theme);
                updateUIDisplay(getMessagesPerMinute());
                Logger.info('烂梗机', '配置已跨页面同步');
            }
        } catch (_) { /* 忽略 */ }
    }

    function parseFilterRules(text) {
        const rules = [];
        const lines = String(text).split('\n').map(s => s.trim()).filter(Boolean);
        for (const line of lines) {
            const rule = parseFilterRule(line);
            if (rule) rules.push(rule);
        }
        return rules;
    }

    /** 解析单条筛选规则（注意 >= <= == 需在 > < 之前判断） */
    function parseFilterRule(line) {
        const patterns = [
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
            // 1.1.19：regex 支持 /xxx/ 字面量写法——设置页提示就是 regex:/^\d+$/，
            //         旧实现把斜杠当成正则内容，永远匹配不上 → 规则「过滤一切」，
            //         用户按提示填完后机器人直接不再发弹幕
            if (type === 'regex') {
                const m = /^\/([\s\S]+)\/([gimsuy]*)$/.exec(raw);
                return { type, value: m ? m[1] : raw, flags: m && m[2] ? m[2] : 'i' };
            }
            return { type, value: raw };
        }
        return null;
    }

    function formatFilterRulesForDisplay(rules) {
        return rules.map(r => {
            if (r.type === 'length') return `length${r.op}${r.value}`;
            if (r.type === 'contains') return `contains:${r.value}`;
            if (r.type === 'not_contains') return `not_contains:${r.value}`;
            // 1.1.19：统一以 /xxx/flags 字面量回显，保证「显示→保存」可往返
            if (r.type === 'regex') return `regex:/${r.value}/${r.flags || 'i'}`;
            return '';
        }).filter(Boolean).join('\n');
    }

    /**
     * 解析屏蔽词/优先词列表（/ 或 , 分隔）。
     * 修复：旧实现以 / 为分隔符会把正则条目 /广告/ 的斜杠拆没，
     *      isRegexPattern 永远匹配不到 → 设置页无法录入正则。
     *      改为正则切分：保留 /.../ 段为独立词条，其余按 / 或 , 分隔。
     */
    function parseDelimitedList(raw) {
        // 1.2.0 修复：只按换行分隔——彻底消除 / 与 , 既是分隔符又是正则内容时的歧义。
        // 每行一个词条；/xxx/（含逗号/斜杠）形式仍按正则整体处理。
        return String(raw).split(/\n/).map(s => s.trim()).filter(Boolean);
    }

    // =========================================================================
    // 模块 18：主题应用
    // =========================================================================
    function applyTheme(theme) {
        if (!theme) return;
        const root = document.documentElement;
        const varMap = [
            ['--bot-bg', theme.bgColor],
            ['--bot-text', theme.textColor],
            ['--bot-accent', theme.accentColor],
            ['--bot-border', theme.borderColor],
            ['--bot-opacity', theme.opacity],
            ['--bot-font-size', theme.fontSize],
            ['--bot-radius', theme.borderRadius],
        ];
        for (const [prop, val] of varMap) {
            if (val !== undefined) root.style.setProperty(prop, val);
        }
    }

    // =========================================================================
    // 模块 19：UI - 样式注入
    // =========================================================================
    let stylesInjected = false;   // 1.1.19：面板可能重建，样式只注入一次

    function injectStyles() {
        if (stylesInjected) return;
        stylesInjected = true;
        GM_addStyle(`
:root {
    --bot-bg: #1a1a2e;
    --bot-text: #e0e0e0;
    --bot-accent: #ff9800;
    --bot-border: rgba(255,255,255,0.06);
    --bot-opacity: 0.95;
    --bot-font-size: 12px;
    --bot-radius: 10px;
}
#bot-panel {
    position: fixed; bottom: 80px; right: 20px; z-index: 99999;
    background: var(--bot-bg);
    color: var(--bot-text);
    border-radius: var(--bot-radius);
    box-shadow: 0 6px 24px rgba(0,0,0,0.7), 0 0 0 1px var(--bot-border);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: var(--bot-font-size);
    width: 240px;
    user-select: none;
    opacity: var(--bot-opacity);
    transition: opacity 0.3s;
}
#bot-panel:hover { opacity: 1; }
/* 拖动中：提升合成层 + 禁用过渡，保证跟手（配合 transform 拖动） */
#bot-panel.bot-dragging {
    transition: none !important;
    will-change: transform;
}
#bot-panel.bot-dragging:hover { opacity: 1; }
#bot-panel-header {
    padding: 8px 12px;
    background: var(--bot-border);
    cursor: grab;
    border-radius: var(--bot-radius) var(--bot-radius) 0 0;
    text-align: center;
    font-weight: 600;
    font-size: 13px;
    color: var(--bot-accent);
    border-bottom: 1px solid var(--bot-border);
    display: flex;
    justify-content: space-between;
    align-items: center;
}
#bot-panel-header:active { cursor: grabbing; }
#bot-settings-btn { background: transparent; border: none; color: var(--bot-accent); cursor: pointer; font-size: 14px; }
#bot-settings-btn:hover { color: #fff; }
.bot-header-icon { font-size: 14px; }
#bot-panel.bot-panel-collapsed #bot-panel-content { display: none; }
#bot-panel.bot-panel-collapsed #bot-panel-header { border-radius: var(--bot-radius); border-bottom: none; }
#bot-panel-content { padding: 8px 10px 10px; display: flex; flex-direction: column; gap: 2px; }
.bot-status-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 0; margin-bottom: 6px; }
.bot-status-item { display: flex; flex-direction: column; align-items: center; padding: 4px 2px; background: rgba(255,255,255,0.03); border-radius: 4px; }
.bot-status-label { font-size: 9px; color: #888; text-transform: uppercase; letter-spacing: 0.3px; }
.bot-status-value { font-size: 13px; font-weight: 700; }
.bot-mono { font-family: "SF Mono", "Fira Code", monospace; }
.bot-status-value.mode-off { color: #666; }
.bot-status-value.mode-zen { color: #4caf50; }
.bot-status-value.mode-normal { color: var(--bot-accent); }
.bot-status-value.mode-crazy { color: #f44336; }
.bot-last-sent, .bot-next-preview {
    background: rgba(255,255,255,0.04);
    border-radius: 4px;
    padding: 4px 6px;
    font-size: 10px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    border-left: 3px solid #555;
    margin-top: 2px;
}
.bot-last-sent.has-content { border-left-color: var(--bot-accent); }
.bot-next-preview.has-content { border-left-color: #4caf50; }
.bot-last-sent-prefix { color: #777; margin-right: 4px; }
.bot-last-sent-text { color: #ccc; }
.bot-row { display: flex; align-items: center; margin-bottom: 4px; }
.bot-center { justify-content: center; margin: 4px 0 2px; }
.bot-switch { position: relative; display: inline-block; width: 44px; height: 24px; }
.bot-switch input { opacity: 0; width: 0; height: 0; }
.bot-slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #444; transition: .3s; border-radius: 24px; }
.bot-slider:before { position: absolute; content: ""; height: 18px; width: 18px; left: 3px; bottom: 3px; background-color: #ccc; transition: .3s; border-radius: 50%; }
input:checked + .bot-slider { background-color: var(--bot-accent); }
input:checked + .bot-slider:before { transform: translateX(20px); background-color: #fff; }
/* 全屏隐藏：类名通用化，设置浮层（#bot-settings-overlay）同样适用 */
.bot-panel-fshidden { display: none !important; }
`);
    }

    // =========================================================================
    // 模块 20：UI - 主面板
    // =========================================================================
    function createMainPanel() {
        document.body.insertAdjacentHTML('beforeend', `
<div id="bot-panel" class="bot-panel-collapsed">
  <div id="bot-panel-header">
    <span class="bot-header-icon">🤖</span> 烂梗机
    <button id="bot-settings-btn">⚙️</button>
  </div>
  <div id="bot-panel-content">
    <div class="bot-section">
      <div class="bot-status-grid">
        <div class="bot-status-item"><div class="bot-status-label">模式</div><div class="bot-status-value" id="bot-status-mode">关闭</div></div>
        <div class="bot-status-item"><div class="bot-status-label">DPM</div><div class="bot-status-value bot-mono" id="bot-status-dpm">0</div></div>
        <div class="bot-status-item"><div class="bot-status-label">候选</div><div class="bot-status-value bot-mono" id="bot-status-candidates">0</div></div>
        <div class="bot-status-item"><div class="bot-status-label">倒计时</div><div class="bot-status-value bot-mono" id="bot-status-countdown">--</div></div>
      </div>
      <div class="bot-last-sent" id="bot-last-sent">
        <span class="bot-last-sent-prefix">上次:</span>
        <span class="bot-last-sent-text" id="bot-last-sent-text">--</span>
      </div>
      <div class="bot-next-preview" id="bot-next-preview">
        <span class="bot-last-sent-prefix">下次:</span>
        <span class="bot-last-sent-text" id="bot-next-preview-text">--</span>
      </div>
    </div>
    <div class="bot-row bot-center">
      <label class="bot-switch">
        <input type="checkbox" id="bot-toggle-switch">
        <span class="bot-slider"></span>
      </label>
    </div>
    <div id="bot-error-summary" style="font-size:10px;color:#f44336;text-align:center;margin-top:4px;display:none;">⚠️ 有错误，请查看日志</div>
  </div>
</div>`);
        injectStyles();
        bindPanelEvents();
    }

    function bindPanelEvents() {
        const toggle = $('bot-toggle-switch');
        if (toggle) {
            toggle.addEventListener('change', e => {
                state.isRunning = e.target.checked;
                if (state.isRunning) {
                    // 1.2.0：引擎先决定数据源（协议/探测会同步暂停 DOM，避免双源叠加）
                    if (window.__lgjEngineOnStart) { try { window.__lgjEngineOnStart(); } catch (__e) { /* 忽略 */ } }
                    // 修复：打开开关时确保 observer 已启动
                    //（stopBot 断开后重启需重新监听弹幕）
                    ensureObserverRunning();
                    switchMode();
                } else {
                    stopBot();
                    if (window.__lgjEngineOnStop) { try { window.__lgjEngineOnStop(); } catch (__e2) { /* 忽略 */ } }
                }
            });
        }

        const settingsBtn = $('bot-settings-btn');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', e => {
                e.stopPropagation();
                openSettingsPage();
            });
        }

        setupPanelDrag();
    }

    // =========================================================================
    // 模块 21：UI - 面板拖拽（性能优化版）
    // =========================================================================
    /**
     * 性能优化：1) 用 transform: translate3d 替代 left/top —— 只触发合成
     *              不触发 layout（reflow），拖动不跟手的主因是 left/top
     *              每帧强制重排整个文档布局；
     *            2) requestAnimationFrame 合并高频 pointermove，每帧只应用一次；
     *            3) Pointer Events + setPointerCapture 替代 document 级
     *              mousemove/mouseup 监听，事件不丢失、无监听器泄漏。
     */
    /** 面板位置视口 clamp：确保 left/top 不超出可视区域（分辨率/窗口变化后不会跑出屏幕外） */
    function clampPanelPos(panel, left, top) {
        const margin = 8;
        // 1.1.19：折叠态量到的高度只有 header 高，按它 clamp 后一展开面板就顶出
        //         视口下沿（开关点不到）。按「展开后」的高度预留。
        const estH = Math.max(panel.offsetHeight || 0, 240);
        const estW = panel.offsetWidth || 240;
        const maxLeft = Math.max(margin, window.innerWidth - estW - margin);
        const maxTop = Math.max(margin, window.innerHeight - estH - margin);
        const cl = Math.min(Math.max(margin, left), maxLeft);
        const ct = Math.min(Math.max(margin, top), maxTop);
        return { left: cl + 'px', top: ct + 'px' };
    }

    function setupPanelDrag() {
        const panel = $('bot-panel');
        const header = $('bot-panel-header');
        if (!panel || !header) return;

        let pointerId = null;   // 当前拖动的指针 ID
        let rafId = null;       // RAF 句柄
        let startX = 0, startY = 0;
        let deltaX = 0, deltaY = 0;   // 目标偏移（mousemove 只更新这里）
        let isDragging = false;

        // RAF 单帧应用 transform（合并高频 move 事件）
        const applyTransform = () => {
            rafId = null;
            panel.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0)`;
        };
        const scheduleRender = () => {
            if (rafId === null) rafId = requestAnimationFrame(applyTransform);
        };

        const onPointerDown = (e) => {
            if (e.button !== 0) return;
            // 设置按钮不参与拖动（保留点击打开设置的行为）
            if (e.target.closest && e.target.closest('#bot-settings-btn')) return;
            e.preventDefault();

            const rect = panel.getBoundingClientRect();
            pointerId = e.pointerId;
            startX = e.clientX;
            startY = e.clientY;
            deltaX = 0;
            deltaY = 0;
            isDragging = false;

            panel.classList.add('bot-dragging');
            try { header.setPointerCapture(pointerId); } catch (_) { /* 忽略 */ }
        };

        const onPointerMove = (e) => {
            if (pointerId === null || e.pointerId !== pointerId) return;
            // 1.1.19：setPointerCapture 失败时收不到 pointerup → 按键松开后仍在
            //         拖动状态（「幽灵拖动」）。仅在已判定为拖动时收尾，避免
            //         把一次普通点击误判成折叠切换
            if (isDragging && e.buttons === 0) { finishDrag(e); return; }
            deltaX = e.clientX - startX;
            deltaY = e.clientY - startY;
            if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) isDragging = true;
            if (!isDragging) return;
            scheduleRender();  // 只更新偏移，由 RAF 统一应用
        };

        const finishDrag = (e) => {
            if (pointerId === null) return;
            if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
            try { header.releasePointerCapture(pointerId); } catch (_) { /* 忽略 */ }
            pointerId = null;
            panel.classList.remove('bot-dragging');

            if (isDragging) {
                // 以最终位置（含 transform）固化为 left/top 并保存（兼容原存储格式）
                const rect = panel.getBoundingClientRect();
                panel.style.transform = '';
                // 修复：保存前视口 clamp，防止面板被拖出屏幕外
                const pos = clampPanelPos(panel, rect.left, rect.top);
                panel.style.left = pos.left;
                panel.style.top = pos.top;
                panel.style.right = 'auto';
                panel.style.bottom = 'auto';
                GM_setValue(STORAGE_KEYS.PANEL_POS, pos);
            } else {
                // 未拖动 = 点击 header，折叠/展开
                panel.classList.toggle('bot-panel-collapsed');
            }
        };

        header.addEventListener('pointerdown', onPointerDown);
        header.addEventListener('pointermove', onPointerMove);
        header.addEventListener('pointerup', finishDrag);
        header.addEventListener('pointercancel', finishDrag);
        // 1.1.19：捕获被系统收回（元素移除/隐藏/浏览器中断）时同样收尾
        header.addEventListener('lostpointercapture', finishDrag);
    }

    function loadPanelPosition() {
        try {
            const panel = $('bot-panel');
            if (!panel) return;
            const pos = GM_getValue(STORAGE_KEYS.PANEL_POS, null);
            if (pos && pos.left && pos.top) {
                panel.style.transform = '';   // 清除可能残留的拖动偏移
                // 修复：加载时同样 clamp（旧存档可能在当前视口外）
                const saved = clampPanelPos(panel, parseFloat(pos.left) || 0, parseFloat(pos.top) || 0);
                panel.style.left = saved.left;
                panel.style.top = saved.top;
                panel.style.bottom = 'auto';
                panel.style.right = 'auto';
            }
        } catch (_) { /* 忽略 */ }
    }

    // =========================================================================
    // 模块 22：UI - 主面板状态更新
    // =========================================================================
    function updateUIDisplay(dpm) {
        try {
            const modeEl = $('bot-status-mode');
            if (!modeEl) return;

            // 修复：只统计最近 2 分钟的错误——旧实现用 Logger.getErrors() 全量，
            //      一条历史 error 会让面板模式永久显示「错误」
            const hasError = Logger.getRecentErrors().length > 0;
            const displayMode = hasError ? '错误' : state.currentMode;

            modeEl.textContent = displayMode;
            modeEl.className = 'bot-status-value';

            const modeClassMap = {
                '错误': 'mode-crazy',
                [MODE.CRAZY]: 'mode-crazy',
                [MODE.NORMAL]: 'mode-normal',
                [MODE.ZEN]: 'mode-zen',
                [MODE.OFF]: 'mode-off',
            };
            modeEl.classList.add(modeClassMap[displayMode] || 'mode-off');

            $('bot-status-dpm').textContent = dpm;
            $('bot-status-candidates').textContent = state.candidateCount;

            updateLastSentDisplay();
            updateNextPreviewDisplay();
            updateCountdownDisplay();

            const errSummary = $('bot-error-summary');
            if (errSummary) errSummary.style.display = hasError ? 'block' : 'none';
        } catch (e) {
            logError('updateUIDisplay', e);
        }
    }

    function updateLastSentDisplay() {
        const wrap = $('bot-last-sent');
        const textEl = $('bot-last-sent-text');
        if (!wrap || !textEl) return;

        if (state.lastSentMsg) {
            wrap.classList.add('has-content');
            textEl.textContent = truncate(state.lastSentMsg, 18);
            wrap.title = state.lastSentMsg;
        } else {
            wrap.classList.remove('has-content');
            textEl.textContent = '--';
            wrap.title = '';
        }
    }

    function updateNextPreviewDisplay() {
        const wrap = $('bot-next-preview');
        const textEl = $('bot-next-preview-text');
        if (!wrap || !textEl) return;

        if (state.nextPreviewMsg && state.isRunning) {
            wrap.classList.add('has-content');
            textEl.textContent = truncate(state.nextPreviewMsg, 18);
            wrap.title = state.nextPreviewMsg;
        } else {
            wrap.classList.remove('has-content');
            textEl.textContent = '--';
            wrap.title = '';
        }
    }

    function updateCountdownDisplay() {
        const cdEl = $('bot-status-countdown');
        if (!cdEl) return;

        if (state.isRunning && state.nextSendTimestamp > 0) {
            const tick = () => {
                const remaining = state.nextSendTimestamp - Date.now();
                cdEl.textContent = remaining <= 0 ? '发送中' : (remaining / 1000).toFixed(1) + 's';
            };
            // 修复：复用已存在的 interval——旧实现每秒销毁重建 100ms 定时器
            if (!state.countdownTimer) {
                tick();
                state.countdownTimer = setInterval(tick, 100);
            }
        } else {
            if (state.countdownTimer) {
                clearInterval(state.countdownTimer);
                state.countdownTimer = null;
            }
            cdEl.textContent = '--';
        }
    }

    // =========================================================================
    // 模块 23：UI - 设置页
    // =========================================================================
    function openSettingsPage() {
        const existing = document.getElementById('bot-settings-overlay');
        if (existing) { existing.remove(); return; }

        const overlay = createElement('div', {
            id: 'bot-settings-overlay',
            style: 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:100000;display:flex;justify-content:center;align-items:center;overflow-y:auto;padding:20px;box-sizing:border-box;',
        });

        const panel = createElement('div', {
            style: `background:var(--bot-bg,#1a1a2e);color:var(--bot-text,#e0e0e0);max-width:600px;width:100%;border-radius:var(--bot-radius,12px);padding:20px;max-height:90vh;overflow-y:auto;border:1px solid var(--bot-border,rgba(255,255,255,0.1));font-size:var(--bot-font-size,12px);`,
        });

        panel.innerHTML = buildSettingsHTML();
        if (window.__lgjEnhanceSettings) { try { window.__lgjEnhanceSettings(panel); } catch (_) { /* 忽略 */ } }
        overlay.appendChild(panel);
        document.body.appendChild(overlay);

        overlay.addEventListener('click', e => {
            if (e.target === overlay) overlay.remove();
        });

        overlay.addEventListener('click', e => handleSettingsClick(e, overlay));

        // 修复：打开设置页时主动渲染错误日志——旧代码只在点「清空日志」时才
        //      调用 renderDebugLogs，日志区与角标永远空白、形同虚设
        renderDebugLogs();
    }

    function createElement(tag, attrs = {}) {
        const el = document.createElement(tag);
        for (const [key, val] of Object.entries(attrs)) {
            if (key === 'style') el.style.cssText = val;
            else el[key] = val;
        }
        return el;
    }

    function handleSettingsClick(e, overlay) {
        const { id } = e.target;
        switch (id) {
            case 'settings-save-btn':
                saveSettingsFromUI(overlay);
                break;
            case 'settings-reset-btn':
                resetSettingsUI(overlay);
                break;
            case 'settings-close-btn':
                overlay.remove();
                break;
            case 'settings-debug-clear':
                Logger.clear();
                renderDebugLogs();
                break;
            case 'settings-debug-export':
                exportDebugLogs();
                break;
        }
    }

    function exportDebugLogs() {
        const content = Logger.getAll().map(l => `[${l.time}] ${l.level.toUpperCase()}: ${l.content}`).join('\n');
        const blob = new Blob([content], { type: 'text/plain' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `bot_log_${Date.now()}.log`;
        // 1.1.19：游离 <a> 在部分浏览器（Firefox 及部分 Chromium 版本）不触发下载，
        //         且 click 后立即 revoke 会抢在下载开始前撤销 URL → 导出空文件/无反应。
        //         改为挂到文档再点击，延迟撤销并移除节点。
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            try { URL.revokeObjectURL(a.href); } catch (_) { /* 忽略 */ }
            try { a.remove(); } catch (_) { /* 忽略 */ }
        }, 1000);
    }

    // =========================================================================
    // 模块 24：UI - 设置页 HTML 构建
    // =========================================================================
    function buildSettingsHTML() {
        const cfg = state.config;
        const theme = cfg.theme || DEFAULT_THEME;
        const blocklist = state.blocklist.join('\n');
        const priority = state.priorityWords.join('\n');
        const rules = formatFilterRulesForDisplay(cfg.filterRules || []);

        return `
${buildSettingsHeader()}

${buildSection('📝 弹幕设置', `
  ${buildInputRow('s-minLen', '最短长度', cfg.minMsgLength, 1, 50)}
  ${buildInputRow('s-lenThres', '长弹幕阈值', cfg.lengthThreshold, 5, 100)}
  ${buildInputRow('s-lenBonus', '长度加成', cfg.lengthBonus, 1, 10, '0.5')}
  ${buildInputRow('s-trending', '趋势置顶', cfg.trendingThreshold, 2, 50)}
  ${buildInputRow('s-dedupWindow', '去重窗口(秒)', cfg.dedupWindowSec, 0, 600, '5')}
  ${buildInputRow('s-dedupHistory', '历史去重(条)', cfg.dedupHistorySize, 0, 100)}
`)}

${buildSection('⚡ 模式设置', `
  ${buildInputRow('s-crazyDpm', '疯狂阈值 DPM', cfg.crazyModeDPM, 10)}
  ${buildInputRow('s-crazyInterval', '疯狂间隔(秒)', cfg.crazyInterval, 1)}
  ${buildInputRow('s-normalDpm', '正常阈值 DPM', cfg.normalModeDPM, 10)}
  ${buildInputRow('s-normalIntervalMin', '正常间隔最小(秒)', cfg.normalIntervalMin, 1)}
  ${buildInputRow('s-normalIntervalMax', '正常间隔最大(秒)', cfg.normalIntervalMax, 1)}
  ${buildInputRow('s-zenInterval', '佛系间隔(秒)', cfg.zenInterval, 1)}
`)}

${buildSection('🚫 屏蔽词 & 高级筛选', `
  ${buildTextareaRow('s-blocklist', '屏蔽词', blocklist, 2)}
  <div style="font-size:calc(var(--bot-font-size,12px) - 2px);color:#666;margin-top:2px;">每行一个；/xxx/ 为正则</div>
  ${buildTextareaRow('s-filterRules', '筛选规则', rules, 3)}
  <div style="font-size:calc(var(--bot-font-size,12px) - 2px);color:#666;margin-top:2px;">每行一条，如 length>10, contains:哈哈, regex:/^\\d+$/</div>
`)}

${buildSection('⭐ 优先词', `
  <div class="row" style="display:flex;align-items:center;margin-bottom:4px;gap:6px;">
    <label style="width:80px;font-size:var(--bot-font-size,12px);color:var(--bot-text,#aaa);flex-shrink:0;">启用</label>
    <input type="checkbox" id="s-priorityEnabled" ${cfg.priorityEnabled ? 'checked' : ''} style="width:auto;">
  </div>
  ${buildTextareaRow('s-priorityWords', '优先词', priority, 2)}
  ${buildInputRow('s-priorityWeight', '权重加成', cfg.priorityWeight, 1, 20, '0.5')}
  <div style="font-size:calc(var(--bot-font-size,12px) - 2px);color:#666;margin-top:2px;">每行一个；/xxx/ 为正则</div>
`)}

${buildThemeSection(theme)}

${buildDebugSection()}

<div style="display:flex;gap:10px;justify-content:center;margin-top:16px;">
  <button id="settings-save-btn" style="background:var(--bot-accent,#ff9800);color:var(--bot-bg,#1a1a2e);border:none;padding:8px 24px;border-radius:4px;font-weight:bold;cursor:pointer;font-size:var(--bot-font-size,12px);">💾 保存</button>
  <button id="settings-reset-btn" style="background:var(--bot-border,#333);color:var(--bot-text,#fff);border:none;padding:8px 24px;border-radius:4px;cursor:pointer;font-size:var(--bot-font-size,12px);">↩️ 重置</button>
</div>`;
    }

    function buildSettingsHeader() {
        return `
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
  <h2 style="margin:0;color:var(--bot-accent,#ff9800);font-size:calc(var(--bot-font-size,12px) + 4px);">🤖 烂梗机设置</h2>
  <button id="settings-close-btn" style="background:transparent;border:none;color:#aaa;font-size:20px;cursor:pointer;">✕</button>
</div>
<div id="settings-save-msg" style="color:#4caf50;text-align:center;display:none;margin-bottom:8px;">✅ 已保存，将自动应用。</div>`;
    }

    function buildSection(title, content) {
        return `
<div class="settings-section" style="background:var(--bot-border,rgba(255,255,255,0.03));border-radius:6px;padding:10px 12px;margin-bottom:12px;border:1px solid var(--bot-border,rgba(255,255,255,0.08));">
  <h3 style="font-size:calc(var(--bot-font-size,12px) + 1px);color:var(--bot-accent,#ff9800);margin:0 0 6px 0;">${title}</h3>
  ${content}
</div>`;
    }

    function buildInputRow(id, label, value, min, max, step) {
        const stepAttr = step !== undefined ? `step="${step}"` : '';
        // 修复：min=0 时 `min ? ...` 会丢失属性（如去重窗口允许 0），改用 undefined 判断
        const minAttr = min !== undefined ? `min="${min}"` : '';
        const maxAttr = max !== undefined ? `max="${max}"` : '';
        return `
<div class="row" style="display:flex;align-items:center;margin-bottom:4px;gap:6px;flex-wrap:wrap;">
  <label style="width:80px;font-size:var(--bot-font-size,12px);color:var(--bot-text,#aaa);flex-shrink:0;">${label}</label>
  <input type="number" id="${id}" value="${escapeHtml(value ?? '')}" ${minAttr} ${maxAttr} ${stepAttr}
    style="background:var(--bot-border,rgba(255,255,255,0.06));border:1px solid var(--bot-border,rgba(255,255,255,0.12));color:var(--bot-text,#eee);border-radius:4px;padding:3px 5px;font-size:var(--bot-font-size,12px);flex:1;min-width:50px;">
</div>`;
    }

    function buildTextareaRow(id, label, value, rows) {
        return `
<div class="row" style="display:flex;align-items:flex-start;margin-bottom:4px;gap:6px;flex-wrap:wrap;">
  <label style="width:80px;font-size:var(--bot-font-size,12px);color:var(--bot-text,#aaa);flex-shrink:0;padding-top:4px;">${label}</label>
  <textarea id="${id}" rows="${rows}" style="width:100%;background:var(--bot-border,rgba(255,255,255,0.06));border:1px solid var(--bot-border,rgba(255,255,255,0.12));color:var(--bot-text,#eee);border-radius:4px;padding:4px;font-size:var(--bot-font-size,12px);resize:vertical;box-sizing:border-box;">${escapeHtml(value)}</textarea>
</div>`;
    }

    function buildThemeSection(theme) {
        return buildSection('🎨 外观设置', `
  ${buildColorRow('s-bgColor', '背景色', theme.bgColor)}
  ${buildColorRow('s-textColor', '文字颜色', theme.textColor)}
  ${buildColorRow('s-accentColor', '强调色', theme.accentColor)}
  ${buildColorRow('s-borderColor', '边框颜色', theme.borderColor)}
  ${buildInputRow('s-opacity', '透明度', theme.opacity, 0.5, 1, '0.05')}
  <div class="row" style="display:flex;align-items:center;margin-bottom:4px;gap:6px;flex-wrap:wrap;">
    <label style="width:80px;font-size:var(--bot-font-size,12px);color:var(--bot-text,#aaa);flex-shrink:0;">字体大小</label>
    <input type="text" id="s-fontSize" value="${escapeHtml(theme.fontSize ?? '')}" style="background:var(--bot-border,rgba(255,255,255,0.06));border:1px solid var(--bot-border,rgba(255,255,255,0.12));color:var(--bot-text,#eee);border-radius:4px;padding:3px 5px;font-size:var(--bot-font-size,12px);flex:1;min-width:50px;">
  </div>
  <div class="row" style="display:flex;align-items:center;margin-bottom:4px;gap:6px;flex-wrap:wrap;">
    <label style="width:80px;font-size:var(--bot-font-size,12px);color:var(--bot-text,#aaa);flex-shrink:0;">圆角</label>
    <input type="text" id="s-borderRadius" value="${escapeHtml(theme.borderRadius ?? '')}" style="background:var(--bot-border,rgba(255,255,255,0.06));border:1px solid var(--bot-border,rgba(255,255,255,0.12));color:var(--bot-text,#eee);border-radius:4px;padding:3px 5px;font-size:var(--bot-font-size,12px);flex:1;min-width:50px;">
  </div>
`);
    }

    function buildColorRow(id, label, value) {
        return `
<div class="row" style="display:flex;align-items:center;margin-bottom:4px;gap:6px;flex-wrap:wrap;">
  <label style="width:80px;font-size:var(--bot-font-size,12px);color:var(--bot-text,#aaa);flex-shrink:0;">${label}</label>
  <input type="color" id="${id}" value="${escapeHtml(value ?? '')}" style="background:#fff;border:2px solid var(--bot-accent,#ff9800);border-radius:4px;padding:2px;width:40px;height:40px;cursor:pointer;">
</div>`;
    }

    function buildDebugSection() {
        return buildSection('🐛 错误日志', `
  <div style="display:flex;gap:8px;margin-bottom:8px;">
    <button id="settings-debug-clear" style="background:var(--bot-border,#2c2c3a);border:none;color:var(--bot-text,#ccc);padding:4px 10px;border-radius:4px;cursor:pointer;font-size:calc(var(--bot-font-size,12px) - 1px);">清空日志</button>
    <button id="settings-debug-export" style="background:var(--bot-border,#2c2c3a);border:none;color:var(--bot-text,#ccc);padding:4px 10px;border-radius:4px;cursor:pointer;font-size:calc(var(--bot-font-size,12px) - 1px);">导出日志</button>
    <span id="settings-debug-count" style="background:var(--bot-accent,#ff9800);color:var(--bot-bg,#1a1a2e);border-radius:10px;padding:0 8px;font-size:calc(var(--bot-font-size,12px) - 2px);display:none;">0</span>
  </div>
  <div id="settings-debug-list" style="background:var(--bot-border,rgba(255,255,255,0.03));border-radius:6px;padding:6px;max-height:200px;overflow-y:auto;font-family:monospace;font-size:calc(var(--bot-font-size,12px) - 1px);"></div>
  <div style="font-size:calc(var(--bot-font-size,12px) - 2px);color:#666;margin-top:2px;">仅显示错误，完整日志可导出</div>
`);
    }

    // =========================================================================
    // 模块 25：UI - 设置页读写
    // =========================================================================
    function saveSettingsFromUI(overlay) {
        const getVal = (id) => { const el = overlay.querySelector('#' + id); return el ? el.value : ''; };
        // 修复：空输入返回 NaN（循环内跳过，保持原值）——旧实现 parseFloat('')||0
        //      把清空的字段保存成 0（如最短长度清空 → 单字符弹幕全入候选）
        const getNum = (id) => {
            const v = getVal(id);
            if (v.trim() === '') return NaN;
            return parseFloat(v);
        };
        const getBool = (id) => { const el = overlay.querySelector('#' + id); return el ? el.checked : false; };
        const getText = (id) => getVal(id);

        // 数值配置（key → 输入框 id）
        const numConfig = {
            minMsgLength: 's-minLen',
            lengthThreshold: 's-lenThres',
            lengthBonus: 's-lenBonus',
            trendingThreshold: 's-trending',
            dedupWindowSec: 's-dedupWindow',
            dedupHistorySize: 's-dedupHistory',
            crazyModeDPM: 's-crazyDpm',
            crazyInterval: 's-crazyInterval',
            normalModeDPM: 's-normalDpm',
            normalIntervalMin: 's-normalIntervalMin',
            normalIntervalMax: 's-normalIntervalMax',
            zenInterval: 's-zenInterval',
            priorityWeight: 's-priorityWeight',
        };
        for (const [key, id] of Object.entries(numConfig)) {
            const num = getNum(id);
            if (Number.isNaN(num)) continue; // 空输入保持原值
            saveConfigValue(key, num);
        }

        saveConfigValue('priorityEnabled', getBool('s-priorityEnabled'));
        saveConfigValue('filterRules', parseFilterRules(getText('s-filterRules')));

        // 屏蔽词 / 优先词
        const blocklist = parseDelimitedList(getText('s-blocklist'));
        GM_setValue(STORAGE_KEYS.BLOCKLIST, blocklist);
        state.blocklist = blocklist;

        const priorityWords = parseDelimitedList(getText('s-priorityWords'));
        GM_setValue(STORAGE_KEYS.PRIORITY, priorityWords);
        state.priorityWords = priorityWords;

        // 主题
        // 修复：opacity 清空时保持原值——旧实现 getNum 直接落盘，NaN 未被
        //      numConfig 循环的跳过覆盖，导致 --bot-opacity: NaN 面板透明
        const prevTheme = state.config.theme || DEFAULT_THEME;
        const rawOpacity = getNum('s-opacity');
        const theme = {
            bgColor: getVal('s-bgColor'),
            textColor: getVal('s-textColor'),
            accentColor: getVal('s-accentColor'),
            borderColor: getVal('s-borderColor'),
            opacity: Number.isNaN(rawOpacity) ? (prevTheme.opacity ?? DEFAULT_THEME.opacity) : rawOpacity,
            fontSize: getVal('s-fontSize') || '12px',
            borderRadius: getVal('s-borderRadius') || '10px',
        };
        saveTheme(theme);

        updateUIDisplay(getMessagesPerMinute());

        const msg = overlay.querySelector('#settings-save-msg');
        if (msg) {
            msg.style.display = 'block';
            setTimeout(() => { msg.style.display = 'none'; }, 3000);
        }
    }

    function resetSettingsUI(overlay) {
        const def = DEFAULT_CONFIG;
        const defTheme = DEFAULT_THEME;
        const setVal = (id, val) => { const el = overlay.querySelector('#' + id); if (el) el.value = val; };
        const setBool = (id, val) => { const el = overlay.querySelector('#' + id); if (el) el.checked = val; };

        const resetMap = {
            's-minLen': def.minMsgLength,
            's-lenThres': def.lengthThreshold,
            's-lenBonus': def.lengthBonus,
            's-trending': def.trendingThreshold,
            's-dedupWindow': def.dedupWindowSec,
            's-dedupHistory': def.dedupHistorySize,
            's-crazyDpm': def.crazyModeDPM,
            's-crazyInterval': def.crazyInterval,
            's-normalDpm': def.normalModeDPM,
            's-normalIntervalMin': def.normalIntervalMin,
            's-normalIntervalMax': def.normalIntervalMax,
            's-zenInterval': def.zenInterval,
            's-priorityWeight': def.priorityWeight,
            's-blocklist': '',
            's-priorityWords': '',
            's-filterRules': '',
            's-bgColor': defTheme.bgColor,
            's-textColor': defTheme.textColor,
            's-accentColor': defTheme.accentColor,
            's-borderColor': defTheme.borderColor,
            's-opacity': defTheme.opacity,
            's-fontSize': defTheme.fontSize,
            's-borderRadius': defTheme.borderRadius,
        };
        for (const [id, val] of Object.entries(resetMap)) {
            setVal(id, val);
        }
        setBool('s-priorityEnabled', def.priorityEnabled);
    }

    // =========================================================================
    // 模块 26：UI - 调试日志渲染
    // =========================================================================
    let debugRenderPending = false;

    function renderDebugLogs() {
        if (debugRenderPending) return;
        debugRenderPending = true;

        requestAnimationFrame(() => {
            debugRenderPending = false;
            const container = document.querySelector('#settings-debug-list');
            if (!container) return;

            const errors = Logger.getErrors().slice(-100);
            container.innerHTML = errors.map(log =>
                `<div style="border-bottom:1px solid var(--bot-border,rgba(255,255,255,0.06));padding:4px 0;display:flex;flex-wrap:wrap;gap:6px;font-size:11px;color:var(--bot-text,#e0e0e0);">
                    <span style="color:#888;">[${log.time}]</span>
                    <span style="color:#f44336;font-weight:bold;">ERROR</span>
                    <span style="color:var(--bot-text,#e0e0e0);word-break:break-all;flex:1;">${escapeHtml(log.content)}</span>
                </div>`
            ).join('');

            if (container.scrollHeight > container.clientHeight) {
                container.scrollTop = container.scrollHeight;
            }

            const badge = document.querySelector('#settings-debug-count');
            if (badge) {
                const count = errors.length;
                badge.textContent = count;
                badge.style.display = count > 0 ? 'inline-block' : 'none';
            }
        });
    }

    // =========================================================================
    // 模块 27：初始化
    // =========================================================================
    const probe = new SelectorProbe(PLATFORM);
    const parser = new PlatformParser(PLATFORM, probe);
    const sender = new PlatformSender(PLATFORM, parser);

    /**
     * 面板存活保障（1.1.19）。
     * 问题：直播页 SPA 路由/整块 DOM 重写会把 #bot-panel 直接抹掉，旧实现此后
     *      只是静默空转——机器人仍在发弹幕，但用户没有任何 UI 可以关掉它。
     * 修复：1s 周期任务里检查面板是否存在，缺失则重建并同步开关/位置/全屏态。
     */
    function ensurePanelAlive() {
        if (state.standDown) return;
        if ($('bot-panel')) return;
        try {
            createMainPanel();
            loadPanelPosition();
            const toggle = $('bot-toggle-switch');
            if (toggle) toggle.checked = !!state.isRunning;
            if (fullscreenController) fullscreenController.reset();
            Logger.info('烂梗机', '面板被页面移除，已重建');
        } catch (e) {
            logError('面板重建', e);
        }
    }

    function init() {
        Logger.info('烂梗机', `初始化 v${SCRIPT_VERSION} | 平台: ${PLATFORM}`);

        createMainPanel();
        loadConfig();
        loadPanelPosition();

        probe.probeAll();
        parser.refreshSelectors();

        startContainerPolling();
        startBlancYieldWatch();
        startPeriodicTasks();
        startFullscreenDetection();
        startVisibilityHandler();
    }

    /**
     * 主文档让位给 blanc iframe 实例（净化退出，1.1.18 独立成函数）。
     * 让位后本实例彻底空转：面板移除、observer 断开、调度/倒计时清空，
     * 周期任务凭 standDown 短路，不再尝试任何恢复（P0-2 by design：不重连）。
     */
    function yieldToBlancFrame(reason) {
        if (state.standDown) return;
        state.standDown = true;
        // 1.2.0：让位时停协议/选举并释放 leader 租约，避免主文档占着 leader 让 iframe 实例待机
        if (window.__lgjEngineOnStandDown) { try { window.__lgjEngineOnStandDown(); } catch (__e) { /* 忽略 */ } }
        state.isRunning = false;
        if (state.danmuObserver) {
            try { state.danmuObserver.disconnect(); } catch (_) { /* 忽略 */ }
            state.danmuObserver = null;
        }
        if (state.mainTimer) { clearTimeout(state.mainTimer); state.mainTimer = null; }
        if (state.countdownTimer) { clearInterval(state.countdownTimer); state.countdownTimer = null; }
        // 1.1.19：让位后容器轮询与 blanc 监听也要停——它们原本只靠 standDown
        //         短路空转，定时器永久存活（每页面两个常驻 interval）
        if (state.containerPollTimer) { clearInterval(state.containerPollTimer); state.containerPollTimer = null; }
        if (state.blancWatchTimer) { clearInterval(state.blancWatchTimer); state.blancWatchTimer = null; }
        const idlePanel = document.getElementById('bot-panel');
        if (idlePanel) idlePanel.remove();
        Logger.info('烂梗机', `检测到 blanc iframe（${reason}），主文档让位给 iframe 实例`);
    }

    /**
     * B 站 blanc 让位独立周期检查（1.1.18）。
     * 修复：1.1.17 的让位检查写在容器轮询内——若主文档先命中容器（A 类房间之外
     *       的主文档恰有可匹配容器），clearInterval 后让位检查永不触发。
     *       改为独立 1s 检查，覆盖任意时刻（含 45s body 降级后）晚插入的 blanc。
     */
    function startBlancYieldWatch() {
        if (PLATFORM !== 'bilibili' || !IS_TOP_FRAME) return;
        state.blancWatchTimer = setInterval(() => {
            try {
                if (state.standDown) return;
                if (document.querySelector('iframe[src*="/blanc/"]')) {
                    yieldToBlancFrame('周期检查');
                }
            } catch (_) { /* 忽略 */ }
        }, TIMING.UI_UPDATE_INTERVAL);
    }

    /** 轮询查找弹幕容器（按设计：找到后不再重连） */
    function startContainerPolling() {
        let poll = 0;
        const tryFind = setInterval(() => {
            // 1.1.20：让位后立即停止轮询，避免晚到容器重新启动 observer
            if (state.standDown) {
                clearInterval(tryFind);
                state.containerPollTimer = null;
                return;
            }
            poll++;
            try {
                const container = parser.findContainer();
                if (container) {
                    clearInterval(tryFind);
                    state.containerPollTimer = null;
                    state.degradedToBody = false;
                    state.containerElement = container;
                    // 修复：若用户已提前打开开关（ensureObserverRunning 已启动监听），
                    // 不可重复 startDanmuObserver——它会 freqMap.clear() 清空已采集数据，
                    // 且产生双 observer 导致每条弹幕重复计数（count 翻倍、权重虚高）
                    if (window.__lgjSourceKind === 'protocol') {
                        Logger.debug('烂梗机', '协议源接管，容器轮询不启动 DOM observer');
                    } else if (!state.danmuObserver) {
                        startDanmuObserver(container);
                        scheduleWeightUpdate();
                    } else {
                        Logger.debug('烂梗机', 'observer 已运行，跳过容器轮询启动');
                    }
                    return;
                }
                // 1.1.17 遗留的轮询内让位检查由独立 startBlancYieldWatch 接管
                // （1.1.18：此处仅做一处快速兜底，防止 watch 启动前的窗口期）
                if (PLATFORM === 'bilibili'
                    && document.querySelector('iframe[src*="/blanc/"]')) {
                    clearInterval(tryFind);
                    state.containerPollTimer = null;
                    yieldToBlancFrame('容器轮询');
                    return;
                }
                if (poll >= TIMING.CONTAINER_POLL_MAX) {
                    clearInterval(tryFind);
                    state.containerPollTimer = null;
                    Logger.warn('烂梗机', '弹幕容器查找超时，监听整个文档（仅采集类弹幕节点）');
                    state.degradedToBody = true;   // 1.1.19：降级标志，供 handleNode 过滤
                    state.containerElement = document.body;
                    if (window.__lgjSourceKind === 'protocol') {
                        Logger.debug('烂梗机', '协议源接管，body 降级不启动 DOM observer');
                    } else if (!state.danmuObserver) {
                        startDanmuObserver(document.body);
                    }
                }
            } catch (e) {
                logError('容器查找', e);
            }
        }, TIMING.CONTAINER_POLL_INTERVAL);
        state.containerPollTimer = tryFind;   // 1.1.19：让位时可清理
    }

    /** 启动周期性任务 */
    function startPeriodicTasks() {
        // 候选强制刷新（10s）——只负责权重重算，不重复刷 UI
        setInterval(() => {
            if (state.standDown || !state.isRunning) return;
            state.danmuDirty = true;
            updateWeights();
        }, TIMING.CANDIDATE_REFRESH_INTERVAL);

        // UI 更新与配置同步（1s）
        setInterval(() => {
            if (state.standDown) return; // 让位后空转：不刷新面板/不重启调度
            ensurePanelAlive();          // 1.1.19：面板被页面抹掉后重建
            // 1.2.0: checkConfigUpdate 由 GM_addValueChangeListener 事件驱动（见 hybrid 注入）
            if (state.isRunning) switchMode();
            const candidates = getWeightedCandidates();
            // 修复：预览只在空时填充——runBot 发送后已把 nextPreviewMsg 设为
            //      实际选中的候选，UI 循环再覆盖为 top1 会导致预览与实发不一致
            if (!state.nextPreviewMsg) state.nextPreviewMsg = candidates[0]?.text || '';
            updateUIDisplay(getMessagesPerMinute());
        }, TIMING.UI_UPDATE_INTERVAL);

        // 发送器缓存刷新（30s）
        setInterval(() => {
            if (state.standDown) return;
            try { sender.refreshCache(); } catch (_) { /* 忽略 */ }
        }, 30000);
    }

    // =========================================================================
    // 模块 28：全屏检测（1.1.19 重写）
    //
    // 背景（真机反馈）：「网页全屏」是站点自绘状态，不走 Fullscreen API，
    //   document.fullscreenElement 恒为 null；1.1.18 只认 body.player-fullscreen
    //   与 B 站 .layout-Player-barrageStage.fullscreen 两个标记 → 斗鱼/虎牙/抖音
    //   网页全屏全都漏判，面板不隐藏。
    // 策略：四路信号取或，宁可多判也不能漏判；但几何兜底按平台开关，避免
    //   抖音直播（常态即满屏视频）被永久误判而丢面板。
    // =========================================================================

    /** ① html/body 上的全屏类名关键字 */
    const FS_CLASS_RE = /full-?screen|web-?full|cssfullscreen|player-?full|(\b|-)wfs(\b|-)/i;

    /** ② 各平台「网页全屏」已知 DOM 标记 */
    const FS_SELECTORS = [
        '.layout-Player-barrageStage.fullscreen',      // B 站直播（旧版）
        '.layout-Player-videoWrap.fullscreen',         // B 站直播
        '.web-player-fullscreen',                      // 斗鱼 / B 站
        '.player-fullscreen',                          // 斗鱼
        '.huya-player-fullscreen',                     // 虎牙
        '#J_videoWrap.fullscreen',                     // 虎牙
        '.webcast-fullscreen',                         // 抖音
        '.video-fullscreen',                           // 通用
        '.xgplayer.is-fullscreen',                     // 西瓜/xgplayer 真全屏
        '.xgplayer.is-cssfullscreen',                  // xgplayer 网页全屏
        '.bilibili-player-video-wrap.fullscreen',      // B 站播放器
        '.live-player-ctnr.fullscreen',                // B 站直播新版
        '[data-fullscreen="true"]',                    // 属性型标记
    ];

    /** ③ 几何兜底适用平台（抖音直播常态即满屏 → 排除，否则面板永久消失） */
    const FS_GEOMETRY_PLATFORMS = { douyu: true, huya: true, bilibili: true };

    /** 原生全屏元素（兼容 webkit / moz / ms 前缀） */
    function getNativeFullscreenElement(doc) {
        return doc.fullscreenElement || doc.webkitFullscreenElement
            || doc.webkitCurrentFullScreenElement || doc.mozFullScreenElement
            || doc.msFullscreenElement || null;
    }

    /** html/body 类名命中全屏关键字 */
    function hasFullscreenClass(doc) {
        const roots = [doc.documentElement, doc.body];
        for (let i = 0; i < roots.length; i++) {
            const el = roots[i];
            if (!el) continue;
            const cls = typeof el.className === 'string' ? el.className : '';
            if (cls && FS_CLASS_RE.test(cls)) return true;
        }
        return false;
    }

    /** 已知平台容器标记命中 */
    function hasFullscreenMarker(doc) {
        for (let i = 0; i < FS_SELECTORS.length; i++) {
            try { if (doc.querySelector(FS_SELECTORS[i])) return true; }
            catch (_) { /* 选择器异常忽略 */ }
        }
        return false;
    }

    /** 视频铺满视口（网页全屏的通用几何特征） */
    function isVideoCoveringViewport(win, doc) {
        if (!FS_GEOMETRY_PLATFORMS[PLATFORM]) return false;
        const vw = win.innerWidth, vh = win.innerHeight;
        if (!vw || !vh) return false;
        let videos;
        try { videos = doc.querySelectorAll('video'); } catch (_) { return false; }
        for (let i = 0; i < videos.length; i++) {
            let r = null;
            try { r = videos[i].getBoundingClientRect(); } catch (_) { continue; }
            if (!r || r.width <= 0 || r.height <= 0) continue;
            if (r.width >= vw * 0.92 && r.height >= vh * 0.92) return true;
        }
        return false;
    }

    /**
     * 综合判定当前是否全屏（真全屏或网页全屏）。
     * @returns {string|null} 命中原因（可直接写进日志排查误判），未全屏返回 null
     * B 站 blanc iframe 实例：iframe 自身不含播放器，需检查同域父文档。
     */
    function detectFullscreen() {
        try {
            if (getNativeFullscreenElement(document)) return '原生全屏';
            if (hasFullscreenClass(document)) return 'html/body 全屏类名';
            if (hasFullscreenMarker(document)) return '平台全屏容器标记';
            if (isVideoCoveringViewport(window, document)) return '视频铺满视口';
            if (!IS_TOP_FRAME) {
                try {
                    const pwin = window.parent;
                    const pdoc = pwin && pwin.document;
                    if (pdoc) {
                        if (getNativeFullscreenElement(pdoc)) return '父文档原生全屏';
                        if (hasFullscreenClass(pdoc)) return '父文档全屏类名';
                        if (hasFullscreenMarker(pdoc)) return '父文档全屏容器标记';
                        if (isVideoCoveringViewport(pwin, pdoc)) return '父文档视频铺满视口';
                    }
                } catch (_) { /* 跨域父文档忽略 */ }
            }
        } catch (_) { /* 忽略 */ }
        return null;
    }

    /** 全屏控制器句柄：面板重建后需要强制重算一次（新建的面板不带隐藏类） */
    let fullscreenController = null;

    /** 全屏时隐藏面板（含设置浮层） */
    function startFullscreenDetection() {
        let lastState = null;
        let lastRun = 0;

        const apply = () => {
            try {
                const panel = $('bot-panel');
                if (!panel) return;
                const reason = detectFullscreen();
                const isFs = !!reason;
                if (isFs === lastState) return;   // 状态未变：不重复写 DOM
                lastState = isFs;
                // 记录命中原因：万一某站点误判（面板莫名消失），控制台可直接定位
                if (isFs) Logger.info('烂梗机', `检测到全屏（${reason}），已隐藏面板`);
                panel.classList.toggle('bot-panel-fshidden', isFs);
                // 设置浮层 z-index 100000，不隐藏会盖在网页全屏画面上
                const overlay = $('bot-settings-overlay');
                if (overlay) overlay.classList.toggle('bot-panel-fshidden', isFs);
            } catch (_) { /* 忽略 */ }
        };

        // 高频源（class 变更/全屏事件）做 300ms 节流，避免站点频繁改 body 类名时
        // 反复跑 13 条选择器 + 几何计算；漏掉的最终由 1s 兜底轮询补齐
        const throttled = () => {
            const now = Date.now();
            if (now - lastRun < 300) return;
            lastRun = now;
            apply();
        };

        // 真全屏：标准 + 前缀事件
        ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange']
            .forEach(ev => document.addEventListener(ev, throttled, true));

        // 网页全屏：无事件，只能观察 html/body class 变化（各平台都是加类名实现）
        const mo = new MutationObserver(throttled);
        try {
            mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
            if (document.body) mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
        } catch (_) { /* 忽略 */ }

        fullscreenController = {
            apply,
            // 面板被重建后调用：清掉去重状态，强制把当前全屏态写回新面板
            reset: () => { lastState = null; apply(); },
        };

        // 兜底轮询：覆盖不触发 class 变更的实现（如只改 style / 换容器）
        const timer = setInterval(() => {
            if (state.standDown) {          // 让位后不再空转
                clearInterval(timer);
                try { mo.disconnect(); } catch (_) { /* 忽略 */ }
                return;
            }
            apply();
        }, TIMING.UI_UPDATE_INTERVAL);

        apply();
    }

    /** 页面恢复可见时刷新数据 */
    function startVisibilityHandler() {
        document.addEventListener('visibilitychange', () => {
            if (document.hidden || !state.isRunning) return;
            state.timestamps = state.timestamps.filter(ts => ts > Date.now() - TIMING.DPM_WINDOW_MS);
            scheduleWeightUpdate();
        });
    }

    // =========================================================================
    // 启动
    // =========================================================================

// ===== 1.2.0 Hybrid 注入（自动生成，勿手改）=====
(function () {
  'use strict';
  // ============================================================================
  // 烂梗机 Hybrid 引擎（1.2.x）—— 构建时注入 legacy IIFE 尾部
  //
  // 分区导航（按文件内出现顺序；S11 位于 S10 之前，因 UI 增强块依赖 S9 的状态钩子）：
  //   S1  常量与配置键            S7  页面 WS Hook 基座（虎牙/抖音/斗鱼-Hook）
  //   S2  存储与日志              S8  原生发送（B 站协议直发，默认关）
  //   S3  跨域 HTTP               S9  引擎状态机与生命周期
  //   S4  安全阀与系统弹幕过滤    S11 UI（设置页增强）
  //   S5  平台识别与房间号        S10 多标签 leader 选举 + boot/对外钩子
  //   S6  B 站 / 斗鱼 协议源
  //
  // 硬约束：legacy 区（本块之前）行为冻结，本块只叠加能力；
  //        两套数据源（DOM / 协议）严格互斥，见 S9。
  // ============================================================================
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


  // 运行时 MD5（RFC 1321 紧凑实现，无依赖）——供 wbi 签名在注入脚本内使用
  // 正确性由 build 前向量校验（scripts/check-md5.mjs）保证。
  
  function md5(input) {
    const utf8 = typeof TextEncoder !== 'undefined'
      ? new TextEncoder().encode(String(input))
      : (() => { const s = String(input); const b = []; for (let i = 0; i < s.length; i++) b.push(s.charCodeAt(i) & 0xff); return new Uint8Array(b); })();
  
    // 填充
    const bitLen = utf8.length * 8;
    const padded = new Uint8Array(((utf8.length + 8) >> 6 << 6) + 64);
    padded.set(utf8);
    padded[utf8.length] = 0x80;
    const dv = new DataView(padded.buffer);
    dv.setUint32(padded.length - 8, bitLen >>> 0, true);
    dv.setUint32(padded.length - 4, Math.floor(bitLen / 0x100000000), true);
  
    let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  
    const rotl = (x, c) => (x << c) | (x >>> (32 - c));
    const add = (x, y) => (x + y) | 0;
  
    const K = new Int32Array([
      0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
      0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
      0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
      0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
      0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
      0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
      0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
      0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
    ]);
    const S = new Uint8Array([
      7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
      5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
      4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
      6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
    ]);
  
    const M = new Int32Array(16);
    for (let off = 0; off < padded.length; off += 64) {
      for (let i = 0; i < 16; i++) M[i] = dv.getInt32(off + i * 4, true);
      let A = a0, B = b0, C = c0, D = d0;
      for (let i = 0; i < 64; i++) {
        let F, g;
        if (i < 16) { F = (B & C) | (~B & D); g = i; }
        else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
        else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
        else { F = C ^ (B | ~D); g = (7 * i) % 16; }
        F = add(add(add(F, A), K[i]), M[g]);
        A = D; D = C; C = B;
        B = add(B, rotl(F, S[i]));
      }
      a0 = add(a0, A); b0 = add(b0, B); c0 = add(c0, C); d0 = add(d0, D);
    }
  
    const out = new Uint8Array(16);
    const odv = new DataView(out.buffer);
    odv.setInt32(0, a0, true); odv.setInt32(4, b0, true); odv.setInt32(8, c0, true); odv.setInt32(12, d0, true);
    let hex = '';
    for (let i = 0; i < 16; i++) hex += out[i].toString(16).padStart(2, '0');
    return hex;
  }


  // ============================================================================
  // Hybrid 纯逻辑核心（可单测）
  // ----------------------------------------------------------------------------
  // 本文件同时被两处使用：
  //   1) Vitest 直接 import（packages/core/test/hybrid-core.test.ts）
  //   2) scripts/build-hybrid.mjs 在构建时剥掉 `export ` 后内联进用户脚本
  // 因此这里只放「平台无关、无 GM_/DOM 副作用」的纯函数与可注入依赖的类；
  // **禁止 import**（内联后会失去依赖），构建脚本对此有硬校验。
  //
  // 分区导航（C1–C7，按文件内顺序）：
  //   C1  安全阀配置与校验        mergeSafetyConfig / validateConfigBundle
  //   C2  平台无关工具            parseBiliRoomId / mapBiliSendCode
  //   C3  系统弹幕识别            SYSTEM_DANMAKU_PATTERNS / isSystemDanmaku
  //   C4  安全阀实现              HybridSafety
  //   C5  多标签 leader 选举      LeaderElection
  //   C6  三平台协议解码          斗鱼 STT · 抖音 protobuf-lite · 虎牙 Tars-lite
  //   C7  平台路由                platRoomId / pickProtoRoutes
  //
  // 真机帧回归：解码器正确性以 test/fixtures/*.bin（真机抓包）为准；
  //             禁止用「自造帧」单独验证解码器——曾因此掩盖虎牙零弹幕缺陷
  //             （单测辅助函数与解码器共享同一错误假设，自证自洽）。
  // ============================================================================
  
  /** L3 安全阀默认硬顶（与 SPEC L3 对齐；这些值是「可调上限」的基准，不是建议值） */
  const SAFETY_DEFAULTS = Object.freeze({
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
  const SAFETY_CAPS = Object.freeze({
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
  function mergeSafetyConfig(raw, defaults = SAFETY_DEFAULTS) {
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
  function parseBiliRoomId(href, topHref) {
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
  function validateConfigBundle(bundle) {
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
  const SYSTEM_DANMAKU_PATTERNS = [
    /^(欢迎来到|欢迎.{0,12}(进入|来到)直播间)/,
    /^(系统消息|系统公告|温馨提示|直播间提示|本直播间|公告|通知|提醒)/,
    /(关注了主播|关注了直播间|点关注|关注主播|点击关注|求关注|没点关注的)/,
    /^(感谢|谢谢).{0,8}(关注|礼物|打赏|投喂|支持)/,
    // 1.2.3：原模式里的裸「打赏了」会误杀正常弹幕（"主播别打赏了快下播"）。
    // 礼物/打赏类系统消息的真实特征是「礼物名词 + 数量/单位」或「人名 + 送出」，
    // 因此要求紧跟金额/数量/礼物名词，不能只凭「打赏了」三字。
    /(送出了|赠送了|投喂了|打赏了|开通了|续费了)[^，。！？]{0,10}(火箭|飞机|礼物|舰长|提督|总督|礼物榜|元|币|个|份|×|\d)/,
    /(加入了粉丝团|加入粉丝团|粉丝团|粉丝牌|点亮了|勋章|大航海|舰长|提督|总督|守护)/,
    /^.{1,16}(进入了直播间|来到了直播间|进入直播间|进直播间了|离开了直播间)$/,
    // 1.2.3：抖音进场消息（真机实测 2026-09-14）。
    // 抖音把进场提示渲染成独立条目「<昵称> 来了」/「<昵称>等<N>人来」，文本干净、
    // 长度正常、无任何系统关键词 → 原过滤全部漏过，真机实测已被选为「下次发送」。
    //
    // 误杀风险与判据设计（这是本条最需要小心的地方）：
    //   · 「我来了」「他来了」这类**是玩家弹幕**，不能过滤 → 标准「等N人来」变体单独成条，
    //     它带人数量词，正常弹幕几乎不会这样写；
    //   · 无「等N人」时，要求昵称段**至少 2 字符且不是单一人称/指示代词开头**
    //     （我/你/他/她/它/咱/俺/这/那/又/才/刚/快/就/可/真/原来…）——真机进场昵称都是
    //     2 字符以上的用户 ID（`FourMinuteMile` / `有馬佳奈`），日常弹幕则是短口语。
    //   · 含冒号的是「昵称：内容」格式的真弹幕（真机样例
    //     「别逗笑Eternal.：@我真的没有学」），用负向先行断言排除。
    /^(?![我你他她它咱俺这那又才刚快就可真原来][^，。！？、\n]{0,26}(了|来))[^，。！？、\n：:]{2,28}(等\d{1,4}人)?来了$/,
    /^[^，。！？、\n：:]{1,28}等\d{1,4}人来$/,
    /^(恭喜.{0,8}(中奖|获奖|获得|抽中)|中奖|获奖|抽奖|打卡|签到|领取)/,
    /(禁言|封禁|违规|警告|举报|管理员|房管|超管)/,
    // 1.2.3：平台合规/风控宣导文案（真机实测虎牙把「禁止未成年人直播及消费」渲染进弹幕区，
    // 被当正常弹幕选中并尝试发送）。
    //
    // 设计要点（避免误杀）：这类文案的特征是「**祈使句 + 平台治理客体**」，
    // 因此要求两个条件同时满足（用 lookahead 表达），而不是只看开头的词：
    //   ① 以禁止/请勿/拒绝/理性 等祈使词开头；
    //   ② 文中出现治理客体（直播/打赏/消费/未成年/诈骗…）。
    // 反例：「禁止太秀了吧」「主播别打赏了快下播」只有①或只有② → 不判系统。
    /^(禁止|严禁|请勿|切勿|不得|杜绝|抵制|远离|拒绝|提倡|倡导)(?=[^，。！？]{0,24}(直播|打赏|消费|充值|交易|广告|诈骗|赌博|引流|色情|低俗|违规|未成年|青少年|招聘|征婚|代练|刷钻))/,
    /^(请)?(理性|适度|合理)(?=[^，。！？]{0,12}(消费|打赏|充值|观看|直播))/,
    // 平台风控长的宣导句：以「依法/24小时/全天候 + 巡查/监管」起头
    /^(依法|24\s?小时|全天候)[^，。！？]{0,16}(巡查|监管|治理|规范|打击|处罚)/,
    // 未成年人保护类宣导：要求「未成年 + 治理性动词」，且排除「保护法/保护条例」这类名词
    //（否则「未成年人保护法了解下」会被误杀）。
    /^(未成年|青少年)(?![^，。！？]{0,6}(法|条例|规定|政策|制度))[^，。！？]{0,16}(禁止|严禁|不得|避免|健康|不宜|谨慎)/,
    /(轻信|谨防|当心|警惕)[^，。！？]{0,16}(广告|诈骗|招聘|征婚|代练|交易|私下)/,
    /^(主播|直播|房间)(已|即将|正在)?(开播|下播|上播|关闭)/,
    /^(当前|本场|今日|今晚).{0,10}(人气|热度|排名|榜单)/,
    // 1.2.3：平台运营/摘要文案（真机实测斗鱼把 AI 直播摘要塞进弹幕容器：
    //   "看点：…去看看"，158~293 字符，会进候选并被发送 → 等效刷广告）
    /^(看点|亮点|精彩看点)\s*[:：]/,
    /^(主播|标题|直播间公告)\s*[:：]/,
    // 1.2.3：虎牙礼物消息（真机实测 2026-09-14）。
    // 虎牙礼物条目文本形如「44三无楚轩送100」（消费等级 + 昵称 + 「送」 + 数量），
    // 礼物名**只存在于 `<img alt>`**，textContent 里根本没有 → 关键词过滤无锚点可依，
    // 且该串长度正常、不含标点，会一路进候选并被选中发送（等效复读礼物通告刷屏）。
    // 判据：昵称段（不含空格/标点）+ 送|赠 + 纯数量，且整串以数字收尾。
    // 权衡：「主播我送100」这类正常弹幕会被一并过滤——结构层（__lgjIsSystemNode 的
    // tit-h-send/send-gift）才是主防线，此处仅作跨路线的文本兜底，宁可少采集。
    /^[^，。！？、:：\s]{1,20}[送赠]\d{1,6}$/,
    // 1.2.3：虎牙贵族/守护进场（真机实测：`44三无楚轩 驾临直播间`）。
    // 原进场模式只认「进入了直播间/来到了直播间」，漏了虎牙的「驾临直播间」说法。
    /驾临直播间/,
    // 1.2.3：纯时间/日期分隔串（真机实测虎牙弹幕容器内的 <div class="msg-timed">06:22</div>
    // 被当弹幕采集）。限定「整串就是时间」才过滤，避免误杀含时间的正常弹幕。
    /^\d{1,2}:\d{2}(:\d{2})?$/,
    /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/,
  ];
  
  /**
   * 弹幕文本长度上限：**所有平台都限制弹幕长度**（斗鱼/虎牙/抖音 50 字、B 站 20 字），
   * 所以远超此值的文本不可能是弹幕，必然是页面插入的运营/摘要/广告节点。
   *
   * 真机依据（2026-09-14）：斗鱼 `AiLiveSummaryBarrage` 摘要 293 字符被当弹幕采集并选中、
   * 即将发送；该类节点不含系统关键词、也不在原有结构正则内，长度是可靠的兜底判据。
   */
  const MAX_DANMAKU_LEN = 100;
  
  /**
   * 系统/运营弹幕判定。
   *
   * 1.2.3 修复：长文本不再直接放行。原实现 `if (t.length > 80) return false;` 会让
   * 超长系统/运营文案（如斗鱼 AI 摘要 293 字符，以「看点：」开头）绕过全部关键词判定。
   * 改为：**先跑模式匹配**（命中即判系统），仅在全部未命中时才用长度兜底放行。
   */
  function isSystemDanmaku(text) {
    const t = String(text).trim();
    if (!t) return false;
    if (t.length > MAX_DANMAKU_LEN) return true; // 超长必非弹幕（页面运营/摘要节点）
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
  class HybridSafety {
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
  function mapBiliSendCode(code) {
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
  class LeaderElection {
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
  
  
  
  // ============================================================================
  // 1.2.2 多平台协议源：纯逻辑帧解析（斗鱼 STT / 抖音 protobuf-lite / 虎牙 Tars-lite）
  // 全部平台无关、无副作用，可直接 Vitest 单测；构建时随本文件内联。
  // 协议事实来源（2026-09-09 真机矩阵）：
  //   docs/斗鱼协议采集-全量测试.md / 虎牙协议采集-全量测试.md / 抖音协议采集-全量测试.md
  // ============================================================================
  
  function _toU8(x) {
    if (x instanceof Uint8Array) return x;
    if (x instanceof ArrayBuffer) return new Uint8Array(x);
    if (ArrayBuffer.isView(x)) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
    return new Uint8Array(0);
  }
  
  /**
   * 共享 UTF-8 解码器（模块级复用）。
   * 动机：Tars/protobuf 解码里每条字符串都 `new TextDecoder()`——真机帧实测每次构造
   * 约 0.16µs 纯开销，而 1.5KB 虎牙帧含数十个字段，属白付。TextDecoder 无状态、
   * 跨 decode 调用可安全复用（不传 {stream:true} 即非流式）。
   */
  const _UTF8 = new TextDecoder();
  
  // ----------------------------------------------------------------------------
  // C6a. 斗鱼 STT（danmuproxy 自连 / 页面 Hook 共用）
  //   STT 转义：`@` → `@A`、`/` → `@S`；**反转义顺序必须先 @S 再 @A**
  //   （先解 @A 会把原文里的 `@S` 错解成 `/`）。
  // ----------------------------------------------------------------------------
  
  /** 值转义：'@'→'@A'、'/'→'@S'（上行帧用） */
  function douyuEscape(v) {
    return String(v).replace(/@/g, '@A').replace(/\//g, '@S');
  }
  /** 值反转义：先 '@S'→'/' 再 '@A'→'@'（顺序不可换——编码是先转 '@' 后转 '/'，
   *  原文 '@S' 编码为 '@AS'，先解 '@A' 会把 '@AS' 错解成 '/'） */
  function douyuUnescape(v) {
    return String(v).replace(/@S/g, '/').replace(/@A/g, '@');
  }
  
  /** 组帧：[u32LE len][u32LE len][u32LE type][body + '\0']；len = 8 + body(含\0) */
  function douyuBuildFrame(text) {
    const enc = new TextEncoder().encode(String(text) + '\0');
    const len = 8 + enc.length;
    const buf = new Uint8Array(4 + len);
    const v = new DataView(buf.buffer);
    v.setUint32(0, len, true);
    v.setUint32(4, len, true);
    v.setUint32(8, 0x02b1, true); // 客户端 → 服务器
    buf.set(enc, 12);
    return buf;
  }
  
  /** 登录帧文本（匿名，无需凭据；模板照抄官方页面实测） */
  function douyuLoginReq(rid, rand) {
    const r = typeof rand === 'function' ? rand : Math.random;
    const u = String(Math.floor(r() * 900000000) + 100000000);
    const uid = String(Math.floor(r() * 9000000000) + 1000000000);
    return 'type@=loginreq/roomid@=' + String(rid)
      + '/dfl@=sn@AA=106@ASss@AA=1@Ssn@AA=107@ASss@AA=1@Ssn@AA=108@ASss@AA=1@Ssn@AA=105@ASss@AA=1'
      + '/username@=visitor' + u + '/uid@=' + uid
      + '/ver@=20220825/aver@=218101901/ct@=0/';
  }
  
  /**
   * 拆帧：一个 ws 消息可串联多帧。返回 [{type, text}]（type 0x02b2 = 服务器→客户端）。
   * 容错：长度不自洽 / 截断即停止，不抛异常。
   */
  function douyuParseFrames(data) {
    const raw = _toU8(data);
    const out = [];
    const dec = _UTF8;
    let off = 0;
    while (off + 12 <= raw.length) {
      const dv = new DataView(raw.buffer, raw.byteOffset + off, raw.length - off);
      const lenA = dv.getUint32(0, true);
      const lenB = dv.getUint32(4, true);
      const type = dv.getUint32(8, true);
      if (lenA < 9 || lenA > 1048576 || lenA !== lenB) break;
      const msgEnd = off + 4 + lenA;
      if (msgEnd > raw.length) break;
      const body = raw.slice(off + 12, msgEnd);
      let end = body.length;
      for (let i = 0; i < body.length; i++) { if (body[i] === 0) { end = i; break; } }
      const text = dec.decode(body.subarray(0, end));
      if (text) out.push({ type, text });
      off = msgEnd;
    }
    return out;
  }
  
  /** STT 文本 → {type, kv}（值已反转义）。无 type@= 的帧（容错项）type 为空串。 */
  function douyuParseKv(text) {
    const kv = Object.create(null);
    let type = '';
    const parts = String(text).split('/');
    for (const seg of parts) {
      if (!seg) continue;
      const eq = seg.indexOf('@=');
      if (eq < 0) continue;
      const k = seg.slice(0, eq);
      const val = douyuUnescape(seg.slice(eq + 2));
      if (k === 'type') type = val;
      else kv[k] = val;
    }
    return { type, kv };
  }
  
  /** chatmsg 帧 → {text, nick, uid}；非弹幕/空文本返回 null */
  function douyuExtractChat(text) {
    const { type, kv } = douyuParseKv(text);
    if (type !== 'chatmsg' || !kv.txt) return null;
    return { text: String(kv.txt), nick: String(kv.nn || '?'), uid: kv.uid !== undefined ? String(kv.uid) : null };
  }
  
  // ----------------------------------------------------------------------------
  // C6b. protobuf-lite（抖音 PushFrame 系列）
  //   链路：PushFrame → (gzip?) → Response → Message → 'WebcastChatMessage' → ChatMessage
  //   payload 字段号双口径：公开 proto field 10 优先、真机文档 field 8 回退。
  // ----------------------------------------------------------------------------
  
  function _pbVarint(u8, pos) {
    let v = 0n;
    let shift = 0n;
    let p = pos;
    while (p < u8.length) {
      const b = u8[p++];
      v |= BigInt(b & 0x7f) << shift;
      if (!(b & 0x80)) return { big: v, next: p };
      shift += 7n;
      if (shift > 70n) break;
    }
    return null;
  }
  
  /**
   * 最小 protobuf 字段遍历：返回 [{field, wire, num, bytes}]
   * （wire 0=varint→num；1=64bit→bytes；2=length-delimited→bytes；5=32bit→bytes）
   * 容错：非法 wire / 截断即停止。
   */
  function pbFields(data) {
    const u8 = _toU8(data);
    const out = [];
    let pos = 0;
    while (pos < u8.length) {
      const key = _pbVarint(u8, pos);
      if (!key) break;
      const field = Number(key.big >> 3n);
      const wire = Number(key.big & 7n);
      pos = key.next;
      if (wire === 0) {
        const v = _pbVarint(u8, pos);
        if (!v) break;
        pos = v.next;
        out.push({ field, wire, num: v.big <= 9007199254740991n ? Number(v.big) : v.big, bytes: null });
      } else if (wire === 1) {
        if (pos + 8 > u8.length) break;
        out.push({ field, wire, num: null, bytes: u8.slice(pos, pos + 8) });
        pos += 8;
      } else if (wire === 2) {
        const len = _pbVarint(u8, pos);
        if (!len) break;
        const n = Number(len.big);
        pos = len.next;
        if (n < 0 || pos + n > u8.length) break;
        out.push({ field, wire, num: null, bytes: u8.slice(pos, pos + n) });
        pos += n;
      } else if (wire === 5) {
        if (pos + 4 > u8.length) break;
        out.push({ field, wire, num: null, bytes: u8.slice(pos, pos + 4) });
        pos += 4;
      } else break; // 3/4（group，已废弃）等：不识别即停
    }
    return out;
  }
  
  function _pbAll(fields, n, wire) {
    return fields.filter((f) => f.field === n && (wire === undefined || f.wire === wire));
  }
  function _pbFirst(fields, n, wire) {
    const a = _pbAll(fields, n, wire);
    return a.length ? a[0] : null;
  }
  function _pbStr(f) {
    if (!f || !f.bytes) return '';
    try { return _UTF8.decode(f.bytes); } catch (_) { return ''; }
  }
  
  /**
   * PushFrame 解析：payload 口径双轨——公开 douyin.proto 记 field 10，本仓库真机文档记
   * field 8（两文档不一致，故 10 优先、8 回退，双口径通吃）；gzip 判定以魔数 1f8b 为准
   * （field 8 为 payloadEncoding='gzip' 字符串时同样命中，不依赖字段号）。
   */
  function douyinParsePushFrame(data) {
    const f = pbFields(data);
    let payload = null;
    const p10 = _pbFirst(f, 10, 2);
    const p8 = _pbFirst(f, 8, 2);
    if (p10 && p10.bytes) payload = p10.bytes;
    else if (p8 && p8.bytes) payload = p8.bytes;
    const enc = _pbStr(_pbFirst(f, 8, 2));
    const isGzip = enc === 'gzip' || !!(payload && payload.length > 2 && payload[0] === 0x1f && payload[1] === 0x8b);
    return { payload, isGzip };
  }
  
  /** Response：messagesList=1（repeated bytes）、internalExt=5、needAck=9 */
  function douyinParseResponse(data) {
    const f = pbFields(data);
    const messages = _pbAll(f, 1, 2).map((m) => m.bytes).filter(Boolean);
    const ack = _pbFirst(f, 9, 0);
    const ext = _pbFirst(f, 5, 2);
    return { messages, needAck: !!(ack && Number(ack.num)), internalExt: ext ? ext.bytes : null };
  }
  
  /** Message：method=1（string）、payload=2（bytes） */
  function douyinParseMessage(data) {
    const f = pbFields(data);
    return { method: _pbStr(_pbFirst(f, 1, 2)), payload: (_pbFirst(f, 2, 2) || {}).bytes || null };
  }
  
  /** ChatMessage：user=2（User{nickName=3, id=1}）、content=3 → {nick, uid, text} */
  function douyinParseChat(data) {
    const f = pbFields(data);
    const content = _pbStr(_pbFirst(f, 3, 2));
    let nick = '';
    let uid = null;
    const uf = _pbFirst(f, 2, 2);
    if (uf && uf.bytes) {
      const u = pbFields(uf.bytes);
      nick = _pbStr(_pbFirst(u, 3, 2));
      const idf = _pbFirst(u, 1, 0);
      if (idf && idf.num !== null && idf.num !== undefined) uid = String(idf.num);
    }
    if (!content) return null;
    return { nick: nick || '?', uid, text: content };
  }
  
  // ----------------------------------------------------------------------------
  // C6c. Tars-lite（虎牙 WSPushMessage 系列）
  //   字节序：**大端**（真机字节验证；页面 Taf.BinBuffer.readInt16 无 endian 参数）。
  //   长度字段是「类型化整数」（head + 定长值），非裸 u32。
  //   入口：cmd7 单条 / cmd22 批量；uri=1400 为弹幕。
  // ----------------------------------------------------------------------------
  // head = (tag<<4)|type；tag≥15 扩展双字节。类型常量见下。
  // 注意字节序：真机矩阵文档口径为 little-endian（唯一权威）→ 调用方应 LE 优先；
  // 标准桌面 Tars/JCE 生态多为 BE，故 BE 作兜底，由调用方试错并在解出首条弹幕后锁定。
  
  const TARS = { INT8: 0, INT16: 1, INT32: 2, INT64: 3, FLOAT: 4, DOUBLE: 5, STRING1: 6, STRING4: 7, MAP: 8, LIST: 9, STRUCT: 10, END: 11, ZERO: 12, SIMPLELIST: 13 };
  
  function _tarsHead(u8, pos) {
    if (pos >= u8.length) return null;
    const b = u8[pos];
    const type = b & 0x0f;
    let tag = b >> 4;
    let next = pos + 1;
    if (tag === 15) {
      if (next >= u8.length) return null;
      tag = u8[next];
      next++;
    }
    return { tag, type, next };
  }
  
  function _tarsInt(bytes, le) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length === 1) return dv.getInt8(0);
    if (bytes.length === 2) return dv.getInt16(0, le);
    if (bytes.length === 4) return dv.getInt32(0, le);
    if (bytes.length === 8) {
      // int64：两个 32 位字。高位字在前（每字内按 le 读）；超出安全整数返回字符串
      const hi = dv.getUint32(0, le);
      const lo = dv.getUint32(4, le);
      const v = (BigInt(hi) << 32n) | BigInt(lo);
      return v <= 9007199254740991n ? Number(v) : String(v);
    }
    return 0;
  }
  
  /**
   * 读取「类型化整数」——head(tag, 整数类型) + 定长值。
   *
   * 用途：JCE 的 LIST / MAP / bytes(STINGLELIST) 长度字段本身是一个带 head 的字段，
   * 而不是裸 u32。页面权威实现（Taf.JceInputStream.readVector）用 `readInt32(0, true)`
   * 读 size 即此语义；`Taf.BinBuffer.readInt16/readInt32` 不带 endian 参数（默认大端）。
   *
   * 真机实测（fr-huya-*.bin，虎牙 ws.va 下行帧）：
   *   1d 00 01 05 d5  →  head(tag1,SIMPLELIST) + head(tag0,INT8) + head(tag0,INT16) + BE(1493)
   *   size 字段的字节序为 **大端**（1493 = vData 实际长度）。
   *
   * @returns {{value:number, next:number}|null}
   */
  function _tarsTypedSize(u8, pos) {
    const h = _tarsHead(u8, pos);
    if (!h) return null;
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    switch (h.type) {
      case TARS.ZERO: return { value: 0, next: h.next };
      case TARS.INT8: {
        if (h.next + 1 > u8.length) return null;
        return { value: dv.getInt8(h.next), next: h.next + 1 };
      }
      case TARS.INT16: {
        if (h.next + 2 > u8.length) return null;
        return { value: dv.getInt16(h.next, false), next: h.next + 2 }; // BE
      }
      case TARS.INT32: {
        if (h.next + 4 > u8.length) return null;
        return { value: dv.getInt32(h.next, false), next: h.next + 4 }; // BE
      }
      case TARS.INT64: {
        if (h.next + 8 > u8.length) return null;
        const hi = dv.getUint32(h.next, false);
        const lo = dv.getUint32(h.next + 4, false);
        const v = (BigInt(hi) << 32n) | BigInt(lo);
        return { value: v <= 9007199254740991n ? Number(v) : Number.MAX_SAFE_INTEGER, next: h.next + 8 };
      }
      default: return null; // 非整数类型：不是合法 size
    }
  }
  
  /** 递归解析一个 Tars 值（pos 指向 head 之前）；返回 {tag,type,num,str,bytes,items,fields,next} */
  function _tarsValue(u8, pos, le, depth) {
    if (depth > 24) return null; // 防畸形数据深递归
    const h = _tarsHead(u8, pos);
    if (!h) return null;
    const node = { tag: h.tag, type: h.type, num: null, str: null, bytes: null, items: null, fields: null, next: h.next };
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    switch (h.type) {
      case TARS.INT8: case TARS.INT16: case TARS.INT32: case TARS.INT64: {
        const size = [1, 2, 4, 8][h.type];
        if (h.next + size > u8.length) return null;
        node.num = _tarsInt(u8.slice(h.next, h.next + size), le);
        node.next = h.next + size;
        return node;
      }
      case TARS.ZERO:
        node.num = 0;
        return node;
      case TARS.FLOAT:
        if (h.next + 4 > u8.length) return null;
        node.num = dv.getFloat32(h.next, le); node.next = h.next + 4; return node;
      case TARS.DOUBLE:
        if (h.next + 8 > u8.length) return null;
        node.num = dv.getFloat64(h.next, le); node.next = h.next + 8; return node;
      case TARS.STRING1: {
        if (h.next >= u8.length) return null;
        const n = u8[h.next];
        if (h.next + 1 + n > u8.length) return null;
        node.str = _UTF8.decode(u8.slice(h.next + 1, h.next + 1 + n));
        node.next = h.next + 1 + n;
        return node;
      }
      case TARS.STRING4: {
        if (h.next + 4 > u8.length) return null;
        const n = dv.getUint32(h.next, le);
        if (n > u8.length || h.next + 4 + n > u8.length) return null;
        node.str = _UTF8.decode(u8.slice(h.next + 4, h.next + 4 + n));
        node.next = h.next + 4 + n;
        return node;
      }
      case TARS.SIMPLELIST: {
        // 1.2.3 修复：长度字段是「类型化整数」（head + 定长值），不是裸 u32。
        // 真机帧（fr-huya-*.bin）实测：1d 00 01 05 d5 06 3a…
        //   1d       = head(tag1, SIMPLELIST)
        //   00       = 内层 head(tag0, INT8)
        //   01 05 d5 = head(tag0, INT16) + BE 值 1493 = vData 长度
        // 页面权威实现 Taf.BinBuffer.readInt16 = vew.getInt16(pos)（无 endian 参数 → 大端），
        // 且 Taf.JceInputStream.readVector 亦用 readInt32(0,true) 读 size。故 size 一律按 BE 读。
        const ih = _tarsHead(u8, h.next);
        if (!ih || ih.type !== TARS.INT8) return null;
        const sz = _tarsTypedSize(u8, ih.next);
        if (!sz) return null;
        const n = sz.value;
        if (n < 0 || n > u8.length || sz.next + n > u8.length) return null;
        node.bytes = u8.slice(sz.next, sz.next + n);
        node.next = sz.next + n;
        return node;
      }
      case TARS.LIST: {
        // 1.2.3 修复：size 同样是类型化整数（页面 readVector 用 readInt32(0,true) 读）。
        // 真机帧实测：62 字节处 19 00 01 0a… → 19=head(tag1,LIST)、00 01=head(tag0,INT8)+值 1。
        // 旧实现按裸 u32 读出 0x0a010001=167837697 → >100000 → return null，整帧解析中止。
        const sz = _tarsTypedSize(u8, h.next);
        if (!sz) return null;
        const n = sz.value;
        if (n < 0 || n > 100000) return null;
        let p = sz.next;
        node.items = [];
        for (let i = 0; i < n; i++) {
          const it = _tarsValue(u8, p, le, depth + 1);
          if (!it) return null;
          node.items.push(it);
          p = it.next;
        }
        node.next = p;
        return node;
      }
      case TARS.MAP: {
        const sz = _tarsTypedSize(u8, h.next);
        if (!sz) return null;
        const n = sz.value;
        if (n < 0 || n > 100000) return null;
        let p = sz.next;
        node.items = [];
        for (let i = 0; i < n * 2; i++) {
          const it = _tarsValue(u8, p, le, depth + 1);
          if (!it) return null;
          node.items.push(it);
          p = it.next;
        }
        node.next = p;
        return node;
      }
      case TARS.STRUCT: {
        let p = h.next;
        node.fields = [];
        while (p < u8.length) {
          const fh = _tarsHead(u8, p);
          if (!fh) return null;
          if (fh.type === TARS.END) { p = fh.next; break; }
          const f = _tarsValue(u8, p, le, depth + 1);
          if (!f) return null;
          node.fields.push(f);
          p = f.next;
        }
        node.next = p;
        return node;
      }
      default:
        return null;
    }
  }
  
  /** 顶层消息 → 字段数组。Tars 结构体编码即「裸字段流」（head+value 序列，可带 END 尾），
   *  因此恒按裸字段流逐字段解析；首字段恰好是 STRUCT 也不能当成整体（MessageNotice 就是这种）。 */
  function tarsFields(data, le) {
    const u8 = _toU8(data);
    const out = [];
    let p = 0;
    while (p < u8.length) {
      const f = _tarsValue(u8, p, !!le, 0);
      if (!f) break;
      if (f.type === TARS.END) break;
      out.push(f);
      p = f.next;
    }
    return out;
  }
  
  function _tf(fields, tag) {
    return (fields || []).find((f) => f.tag === tag) || null;
  }
  function _tfInt(fields, tag) {
    const f = _tf(fields, tag);
    return f && f.num !== null && f.num !== undefined ? f.num : null;
  }
  function _tfStr(fields, tag) {
    const f = _tf(fields, tag);
    return f && f.str !== null ? f.str : null;
  }
  function _tfBytes(fields, tag) {
    const f = _tf(fields, tag);
    return f && f.bytes ? f.bytes : null;
  }
  
  /** WebSocketCommand：iCmdType int32@0、vData bytes@1 */
  function huyaParseCommand(data, le) {
    const f = tarsFields(data, le);
    return { cmd: _tfInt(f, 0), vData: _tfBytes(f, 1) };
  }
  
  // ============================================================================
  // 虎牙 Tars 编码（主动注册 live:0 用）
  // ============================================================================
  
  const HUYA_CMD_REGISTER_GROUP = 16;
  
  /** head 字节 = (tag<<4)|type；tag>=15 走扩展双字节 */
  function _encHead(tag, type) {
    if (tag < 15) return [(tag << 4) | type];
    return [0xf0 | type, tag];
  }
  /** 类型化整数：按值域选最紧类型，全部**大端**（与解码侧 _tarsTypedSize 对称） */
  function _encInt(tag, v, type) {
    const t = (type !== undefined) ? type : (v === 0 ? TARS.ZERO : (v >= -128 && v <= 127 ? TARS.INT8 : (v >= -32768 && v <= 32767 ? TARS.INT16 : TARS.INT32)));
    if (t === TARS.ZERO) return _encHead(tag, TARS.ZERO);
    const bytes = t === TARS.INT8 ? 1 : t === TARS.INT16 ? 2 : t === TARS.INT32 ? 4 : 8;
    const b = new Uint8Array(bytes);
    const dv = new DataView(b.buffer);
    if (bytes === 1) dv.setInt8(0, v);
    else if (bytes === 2) dv.setInt16(0, v, false);
    else if (bytes === 4) dv.setInt32(0, v, false);
    else {
      const big = BigInt(v);
      dv.setUint32(0, Number(big >> 32n), false);
      dv.setUint32(4, Number(big & 0xffffffffn), false);
    }
    return [..._encHead(tag, t), ...Array.from(b)];
  }
  /** 字符串：<=255 用 STRING1，否则 STRING4 */
  function _encStr(tag, s) {
    const b = Array.from(new TextEncoder().encode(String(s == null ? '' : s)));
    if (b.length < 256) return [..._encHead(tag, TARS.STRING1), b.length, ...b];
    const sz = new Uint8Array(4);
    new DataView(sz.buffer).setUint32(0, b.length, false);
    return [..._encHead(tag, TARS.STRING4), ...Array.from(sz), ...b];
  }
  /** bytes/列表长度：类型化 + 大端，与解码侧一致 */
  function _encLen(n) {
    if (n === 0) return _encInt(0, 0, TARS.ZERO);
    if (n < 128) return _encInt(0, n, TARS.INT8);
    if (n < 32768) return _encInt(0, n, TARS.INT16);
    return _encInt(0, n, TARS.INT32);
  }
  /** vGroupId 字符串列表（LIST of STRING1） */
  function _encStrList(tag, items) {
    return [..._encHead(tag, TARS.LIST), ..._encLen(items.length), ...items.flatMap((s) => _encStr(0, s))];
  }
  
  /**
   * 组装一个上行 WebSocketCommand 帧（与页面下行同构，无长度前缀）。
   *
   * 完整字段（协议文档 §1，真机逐字节核对 `lgj-huya-register-dump.mjs`）：
   *   `iCmdType(int32@0) + vData(bytes@1) + lRequestId(int64@2) + traceId(str@3)
   *    + iEncryptType(int32@4) + lTime(int64@5) + sMD5(str@6)`
   * 除 cmd/vData 外其余字段页面恒发默认值（0 / 空串），此处保持一致。
   * 注意：**不要**把尾部当固定常量——真机双组注册帧的 tag2 为 `20 05`（非 ZERO），
   * 说明该字段可变，按字段规范编码才是稳的。
   */
  function huyaBuildCommand(cmd, vDataFields, requestId) {
    const vData = vDataFields || [];
    const body = [
      ..._encInt(0, cmd, TARS.INT8),                                             // iCmdType
      ..._encHead(1, TARS.SIMPLELIST), ..._encHead(0, TARS.INT8), ..._encLen(vData.length), ...vData, // vData
      ..._encInt(2, (requestId === undefined ? 0 : requestId)),   // lRequestId（按值域自动选型，真机恒 INT8/ZERO）
      ..._encStr(3, ''),                                                         // traceId
      ..._encInt(4, 0, TARS.ZERO),                                               // iEncryptType
      ..._encInt(5, 0, TARS.ZERO),                                               // lTime
      ..._encStr(6, ''),                                                         // sMD5
    ];
    return new Uint8Array(body);
  }
  
  /**
   * 主动注册组请求（cmd16 RegisterGroupReq）。
   *
   * 动机（真机 + 协议文档）：**仅被动 Hook 页面既有连接收不到弹幕**——页面注册的是
   * `live:<rid>` / `chat:<rid>` 组，真机 150s/69 帧内 uri 全为事件类，未捕获 uri1400。
   * 协议文档口径：注册 `live:0`（web 端固定通配组）即可收到该房间 live 组推送。
   *
   * 字节模板取自页面真实上行帧（`lgj-huya-register-dump.mjs` 抓包，逐字节对齐）：
   *   `00 10 | 1d 00 00 0d | [09 00 01 06 06 "live:0"] [16 00] | 2c 36 00 4c 5c 66 00`
   *   cmd=16  vData=13B      vGroupId=LIST[1]        sToken=""（ZERO/空串）  7B 尾
   *
   * vData 结构：`RegisterGroupReq{vGroupId list<string>@0, sToken string@1}`，
   * 第二字段 sToken 必须存在（页面恒发空串）——真机帧实测 13 字节，缺它会少 2 字节。
   */
  function huyaBuildRegisterGroups(groups, requestId) {
    const gs = (groups && groups.length) ? groups : [HUYA_WILDCARD_GROUP];
    const vData = [
      ..._encStrList(0, gs),        // vGroupId
      ..._encStr(1, ''),            // sToken（空串：head 0x16 + len 0x00）
    ];
    return huyaBuildCommand(HUYA_CMD_REGISTER_GROUP, vData, requestId);
  }
  
  /** 是否是需要主动注册的虎牙组（用于日志/判定） */
  const HUYA_WILDCARD_GROUP = 'live:0';
  
  /** MessageNotice：tUserInfo struct@0（SenderInfo{lUid@0, sNickName@2}）、sContent string@3 → {nick, uid, text} */
  function _huyaNotice(buf, le) {
    const f = tarsFields(buf, le);
    const content = _tfStr(f, 3);
    if (!content) return null;
    let nick = '?';
    let uid = null;
    const user = _tf(f, 0);
    if (user && user.fields) {
      nick = _tfStr(user.fields, 2) || '?';
      const u = _tfInt(user.fields, 0);
      if (u !== null) uid = String(u);
    }
    return { nick, uid, text: content };
  }
  
  /** cmd7（v1 单条）/ cmd22（v2 批量）→ [{nick, uid, text}]（仅 uri1400 弹幕） */
  function huyaExtractDanmu(cmd, vData, le) {
    const out = [];
    if (!vData) return out;
    if (cmd === 7) {
      const f = tarsFields(vData, le);
      if (_tfInt(f, 1) === 1400) {
        const s = _tfBytes(f, 2);
        const d = s && _huyaNotice(s, le);
        if (d) out.push(d);
      }
    } else if (cmd === 22) {
      const f = tarsFields(vData, le);
      const list = _tf(f, 1);
      if (list && list.items) {
        for (const it of list.items) {
          if (!it || !it.fields) continue;
          if (_tfInt(it.fields, 0) !== 1400) continue;
          const s = _tfBytes(it.fields, 1);
          const d = s && _huyaNotice(s, le);
          if (d) out.push(d);
        }
      }
    }
    return out;
  }
  
  // ----------------------------------------------------------------------------
  // C7. 平台房间号与协议路线
  //   C7a 房间号解析（platRoomId）——非直播间返回 0
  //   C7b 路线表（pickProtoRoutes）——bilibili[direct] / douyu[direct,hook] / huya·douyin[hook]
  // ----------------------------------------------------------------------------
  
  /** 各平台房间号解析（纯函数；hook 路线不依赖它连接，仅用于 leader key / 日志 / 诊断） */
  function platRoomId(plat, href, topHref) {
    if (plat === 'bilibili') return parseBiliRoomId(href, topHref);
    const u = String(href || '');
    if (plat === 'douyu') {
      const m = /douyu\.com\/(?:[^/?#]*\/)*(\d{2,10})(?:[/?#]|$)/.exec(u) || /[?&]rid=(\d+)/.exec(u);
      return m ? parseInt(m[1], 10) || 0 : 0;
    }
    if (plat === 'huya') {
      const m = /huya\.com\/(\d{5,12})(?:[/?#]|$)/.exec(u);
      return m ? parseInt(m[1], 10) || 0 : 0;
    }
    if (plat === 'douyin') {
      const m = /live\.douyin\.com\/(\d{5,20})(?:[/?#]|$)/.exec(u);
      return m ? parseInt(m[1], 10) || 0 : 0;
    }
    return 0;
  }
  
  /**
   * 协议路线表（有序，前者优先）：
   * - bilibili：自连（已验证）；douyu：自连 + Hook 双路线（douyuRoute=auto/direct/hook）；
   * - huya/douyin：仅 Hook 页面既有连接（自建分别卡在 ws.Launch / signature 漂移）。
   */
  function pickProtoRoutes(plat, douyuRoute) {
    if (plat === 'bilibili') return ['direct'];
    if (plat === 'douyu') {
      if (douyuRoute === 'direct') return ['direct'];
      if (douyuRoute === 'hook') return ['hook'];
      return ['direct', 'hook']; // auto：自连优先，Hook 兜底
    }
    if (plat === 'huya' || plat === 'douyin') return ['hook'];
    return [];
  }

  var CFG_KEY = 'LGJ_ENGINE_v1';
  var SAFETY_KEY = 'LGJ_SAFETY_v1';
  var SAFETY_STATE_KEY = 'LGJ_SAFETY_STATE_v1';
  var ACK_KEY = 'LGJ_ACK_v1';
  var MIXIN = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52];

  // ---------------------------------------------------------------------------
  // S1. 常量与配置键
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // S2. 存储与日志
  //   S2a 配置读写（gmGet/gmSet/loadCfg/saveCfg）
  //   S2b 环形日志缓冲（ringLog/flushRingLog/restoreRingLog）
  //   S2c 事件日志（logEvent 及 __lgj* 桥接，供设置页筛选与诊断快照）
  // ---------------------------------------------------------------------------

  // ---- S2a 配置读写 ----
  var _autoWarned = false;
  // ---- S2c 事件日志 ----
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


  // ---------------------------------------------------------------------------
  // S3. 跨域 HTTP 与房间号解析
  // ---------------------------------------------------------------------------
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



  // ---------------------------------------------------------------------------
  // S4. 安全阀与系统弹幕过滤
  //   S4a 安全阀实例（HybridSafety：硬上限/冷却/熔断，计数持久化跨标签合并）
  //   S4b 系统/运营弹幕过滤（关键词 + 结构判定，协议与 DOM 两路共用）
  // 注：标题原为「L3 安全阀」，但该段实际还包含弹幕过滤，易误读，故更正。
  // ---------------------------------------------------------------------------
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

  // ---- S4b 系统/运营弹幕过滤 ----
  // 委托 hybrid-core 的增强启发式；legacy DOM 路径也走这里
  function isSysDanmaku(text) {
    try { return isSystemDanmaku(text); } catch (_e) { return false; }
  }
  window.__lgjIsSystemDanmaku = function (text) { return isSysDanmaku(text); };
  /**
   * 结构型非弹幕节点判定：节点/父节点类名命中即丢弃。
   *
   * 覆盖两类（1.2.3 扩充）：
   *  1) 系统/公告/礼物/进场类（原有）；
   *  2) 平台在弹幕容器内插入的「运营/摘要」节点——真机实测斗鱼把 AI 直播摘要
   *     `<div class="AiLiveSummaryBarrage js-ai-live-summary-barrage">` 直接放在
   *     `#js-barrage-list` 的 `li.Barrage-listItem` 里，293 字符营销文案被当弹幕采集
   *     并选中发送（等效刷广告）。文本过滤拦不住（不含系统关键词、且 >80 字符会被
   *     isSystemDanmaku 直接放行），必须在结构层排除。
   */
  window.__lgjIsSystemNode = function (el) {
    try {
      if (!el) return false;
      var cls = (el.className && typeof el.className === 'string') ? el.className.toLowerCase() : '';
      var p = el.parentElement;
      var pcls = (p && p.className && typeof p.className === 'string') ? p.className.toLowerCase() : '';
      var all = cls + ' ' + pcls;
      if (/(system|notice|announce|welcome|gift|enter-msg|msg-system|barrage-system|chat-system|danmaku-system|--sys)/.test(all)) return true;
      // 平台分隔/时间戳节点（真机实测：虎牙 <div class="msg-timed">05:28</div> 在弹幕容器内，
      // 被当普通条目采集 → "06:22" 这类时间串进入候选）
      if (/(msg-timed|chat-timed|timed-sep|time-divider|date-divider|msg-divider|chat-divider)/.test(all)) return true;
      // 运营/摘要类节点（斗鱼 AiLiveSummaryBarrage 等）：关键词 + 子节点探测双保险
      if (/(ai-live-summary|ai-summary|live-summary|summary-barrage|hotspot|recommend-card|ad-card|promo-)/.test(all)) return true;
      try {
        if (el.querySelector && el.querySelector('[class*="ai-live-summary"],[class*="ai-summary"],[class*="summary-barrage"],[class*="SummaryBarrage"]')) return true;
      } catch (_e2) { /* 忽略 */ }
      // 1.2.3 真机修复：虎牙弹幕容器改为**无类名**的 `<div data-cmid>` 包裹层
      // （`#chat-room__list > div[data-cmid] > div.msg-bubble|div.tit-h-send|div.msg-timed`），
      // legacy 的 `danmuItem` 选择器（.msg-item/.msg-normal/…）全部失配 → 每个新增节点
      // 都落到「按文本兜底」分支；而包裹层与父层都没有类名，上面基于自身/父类名的判据
      // 全部失效，于是礼物与贵族进场被当弹幕采集（真机实测 50 条「44三无楚轩送100」
      // 一度成为「下次发送」）。
      // 包裹层无类名可判，只能查**子节点结构特征**：
      //   · 真弹幕 → 必含 `.msg-bubble`（先判并放行，绝不误杀正常弹幕）
      //   · 礼物     → 含 `.tit-h-send` / `.send-gift`（礼物名只在 img alt，文本无锚点）
      //   · 贵族/守护进场 → 含 `.box-noble-level-*` / `.msg-pic--*`
      // 顺序关键：`.msg-bubble` 判定必须在最前，避免任何结构判据把真弹幕一起收走。
      // 仅虎牙启用（其它平台的包裹层结构与类名不同，多查一次只会白付开销）；
      // 性能：真弹幕走第 1 次 querySelector 即 return（热路径 1 次/条）；其余 2 次。
      if (_plat() === 'huya') {
        try {
          if (el.querySelector) {
            if (el.querySelector('.msg-bubble')) return false;
            if (el.querySelector('.tit-h-send,.send-gift,[class*="box-noble-level"],[class*="msg-pic--"]')) return true;
          }
        } catch (_e3) { /* 忽略 */ }
        return false;
      }
      // 1.2.3 真机修复（抖音）：进场提示「<昵称> 来了」/「<昵称>等<N>人来」与平台合规宣导
      // 都渲染在 `.webcast-chatroom___item` 里，但它们**没有**真弹幕的文本节点
      // `.webcast-chatroom___content-with-emoji-text`；而 legacy 的 danmuText 选择器
      // 从中抽不到文本 → 回退整条 textContent → 进场文案入池（真机实测已被选为「下次发送」）。
      //
      // 判据分两层，**刻意做成 fail-safe**：
      //   1) 有真弹幕文本节点 → 直接放行（不做任何文本判断）；
      //   2) 没有该节点时，**不**一律判系统，而是仅在文本也**明确像进场/系统**时才判系统。
      //      理由：若页面改名了 `content-with-emoji-text`，「一律判系统」会把**全部弹幕**
      //      误杀（比漏过滤更严重）；而绝大多数真弹幕文本不会以「来了」结尾、也不以
      //      系统前缀开头，因此这一层的误杀面极小。
      if (_plat() === 'douyin') {
        try {
          if (el.querySelector) {
            if (el.querySelector('.webcast-chatroom___content-with-emoji-text')) return false;
            var t = (el.textContent || '').replace(/\s+/g, ' ').trim();
            if (!t) return true;
            if (/(等\d{1,4}人)?来了$/.test(t)) return true;
            if (/^(欢迎来到|系统消息|系统公告|温馨提示|直播间公告)/.test(t)) return true;
          }
        } catch (_e4) { /* 忽略 */ }
        return false;
      }
      return false;
    } catch (_e) { return false; }
  };

  // ---------------------------------------------------------------------------
  // S5. 平台识别与房间号解析
  // S6. 协议采集源
  //   S6a B 站（自连 wss，WBI 签名 + 匿名 token）
  // ---------------------------------------------------------------------------
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
  /** 多标签选举的 key：同房间的不同文档（含 blanc iframe）必须一致；非数字房间名（虎牙）用路径 */
  function roomKey() {
    var r = platRoomId(_plat(), location.href, safeTopHref());
    if (r) return String(r);
    var p = String(location.pathname || '').replace(/\/+$/, '');
    return p || location.hostname;
  }

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
      // 1.2.2：中止必须 reject——return 会让 engageProto 把「已被 stop」误判为连接成功
      if (self.stopped) throw new Error('stopped');
      /**
       * getDanmuInfo 失败的原因要**可读**（1.2.3 真机补）。
       *
       * 真机观察（2026-09-14，B 站 261095，已登录）：`getDanmuInfo` **间歇性**返回
       * `code=-352`。在页面里手工复现时，**不带任何签名/参数**的裸请求同样返回 `-352`
       * （而同页 `nav` / `room_init` 均 `code=0`），说明 `-352` 是**平台侧**对弹幕服务器
       * 接入的风控拒绝，不是本脚本 WBI 实现的缺陷——但这条对照实验**不足以**排除签名问题：
       * 脚本自身也曾走到 `auth-timeout`（即已拿到 token、卡在 wss 握手），
       * 说明两条失败路径都会出现，取决于当时的平台状态。
       *
       * 因此这里只做「如实标注原因」：把 -352 与其它错误码区分开，便于用户/日志判断
       * 是「换 IP/登录态可解」的风控，还是脚本侧的协议问题。不重试、不换凭据。
       */
      if (dm.code === -352) throw new Error('danmuinfo-风控拒绝(-352)');
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

  //   S6b 斗鱼（自连 danmuproxy，匿名零凭据，端口 failover + 坏房间静默看门狗）
  // ---------------------------------------------------------------------------
  // 协议事实来源：docs/斗鱼协议采集-全量测试.md（2026-09-09 真机矩阵验证：
  // 连接/认证/解码/长稳/断线重连全部通过；坏 room 服务器不主动断开 → 客户端 5s 登录超时判定）
  function DouyuDirectSource(roomId, onDanmu, onDrop, onAuth) {
    this.roomId = roomId;
    this.onDanmu = onDanmu;
    this.onDrop = onDrop;
    this.onAuth = onAuth;
    this.ws = null;
    this.hb = null;
    this.stopped = false;
    this.alive = false; // loginres 到达后才为 true
    this.lastMsgAt = 0;   // 最近一条弹幕时刻（诊断用）
    this._silenceTimer = null; // 坏房间静默看门狗（协议事实：坏 room loginres 照回但无任何房间事件且不断开）
  }
  DouyuDirectSource.prototype.stop = function () {
    this.stopped = true;
    this.alive = false;
    if (this.hb) { clearInterval(this.hb); this.hb = null; }
    if (this._silenceTimer) { clearTimeout(this._silenceTimer); this._silenceTimer = null; }
    if (this.ws) { try { this.ws.close(); } catch (_e) { /* 忽略 */ } this.ws = null; }
  };
  /** 静默看门狗：auth 后 25s 无任何服务器帧（连 activity 周期广播都没有）→ 判坏房间/死通道，
   *  主动断开并触发回落（否则坏 room 会「接管成功」却永久无弹幕、不回落 DOM）。
   *  每收到一帧重置；真实低人气房实测 ~3s/帧（type_tooltips/fces/广播），25s 足够安全。 */
  DouyuDirectSource.prototype._armSilence = function () {
    var self = this;
    if (self._silenceTimer) clearTimeout(self._silenceTimer);
    self._silenceTimer = setTimeout(function () {
      if (self.stopped || !self.alive) return;
      self.stop();
      if (self.onDrop) { try { self.onDrop(); } catch (_e) { /* 忽略 */ } }
    }, 25000);
  };
  DouyuDirectSource.prototype._connect = function (port) {
    var self = this;
    return new Promise(function (resolve, reject) {
      var ws;
      try { ws = new WebSocket('wss://danmuproxy.douyu.com:' + port + '/'); } catch (e) { reject(e); return; }
      ws.binaryType = 'arraybuffer';
      var opened = false;
      var authed = false;
      var openTimer = setTimeout(function () {
        if (!opened) { try { ws.close(); } catch (_e) { /* 忽略 */ } reject(new Error('open-timeout')); }
      }, 6000);
      var loginTimer = null;
      ws.onopen = function () {
        opened = true;
        clearTimeout(openTimer);
        self.ws = ws;
        try { ws.send(douyuBuildFrame(douyuLoginReq(self.roomId))); } catch (e) { reject(e); return; }
        // 斗鱼对缺 loginreq/坏 room 不主动断开 → 客户端 5s 登录超时判定
        loginTimer = setTimeout(function () {
          if (!authed) { try { ws.close(); } catch (_e) { /* 忽略 */ } reject(new Error('auth-timeout')); }
        }, 5000);
      };
      ws.onmessage = function (ev) {
        var frames = douyuParseFrames(ev.data);
        for (var i = 0; i < frames.length; i++) {
          if (frames[i].type !== 0x02b2) continue;
          var t = frames[i].text;
          if (!authed) {
            if (douyuParseKv(t).type === 'loginres') {
              authed = true;
              if (loginTimer) { clearTimeout(loginTimer); loginTimer = null; }
              self.alive = true;
              if (self.onAuth) { try { self.onAuth(); } catch (_e) { /* 忽略 */ } }
              self._armSilence(); // 坏房间判定从 loginres 起算
              resolve();
            }
            continue;
          }
          if (self.stopped || !self.alive) continue;
          self._armSilence(); // 任何服务器帧都证明房间活着（广播/uenter/oun/弹幕）
          var c = douyuExtractChat(t);
          if (c) {
            self.lastMsgAt = Date.now();
            self.onDanmu(c.text, {
              id: 'dy_' + self.roomId + '_' + Date.now() + '_' + (c.uid || 0) + '_' + c.text.length,
              uid: c.uid, nick: c.nick, ts: Date.now(),
            });
          }
        }
      };
      ws.onerror = function () { if (!opened) { clearTimeout(openTimer); reject(new Error('ws-error')); } };
      ws.onclose = function () {
        var wasActive = self.alive;
        self.alive = false;
        if (self.hb) { clearInterval(self.hb); self.hb = null; }
        self.ws = null;
        if (self.stopped) return;
        // 只有 loginres 后（真正接管过）的掉线才触发回落；握手期失败由 reject 处理
        if (wasActive && self.onDrop) self.onDrop();
      };
    });
  };
  DouyuDirectSource.prototype.start = function () {
    var self = this;
    if (self.stopped) return Promise.reject(new Error('stopped'));
    // 端口 failover：实测 8501–8506 全通，官方页面也是随机连其中一台
    var ports = [8501, 8502, 8503, 8504, 8505, 8506];
    var lastErr = null;
    var attempt = function (i) {
      if (self.stopped) return Promise.reject(new Error('stopped'));
      return self._connect(ports[i]).catch(function (e) {
        lastErr = e;
        if (i < ports.length - 1) return attempt(i + 1);
        throw lastErr;
      });
    };
    return attempt(0).then(function () {
      if (self.stopped) throw new Error('stopped');
      // loginres 已到（onAuth 已触发接管）：入组 + 心跳。
      // 文档时序：joingroup → 立即 mrkl，之后每 ~40–45s 一次
      try { self.ws.send(douyuBuildFrame('type@=joingroup/rid@=' + self.roomId + '/gid@=1/')); } catch (_e) { /* 忽略 */ }
      try { self.ws.send(douyuBuildFrame('type@=mrkl/')); } catch (_e) { /* 忽略 */ }
      self.hb = setInterval(function () {
        if (self.alive && self.ws && self.ws.readyState === 1) {
          try { self.ws.send(douyuBuildFrame('type@=mrkl/')); } catch (_e) { /* 忽略 */ }
        }
      }, 40000);
    });
  };

  // ---------------------------------------------------------------------------
  // S7. 页面 WS Hook 基座（虎牙 / 抖音 / 斗鱼-Hook 路线共用）
  //   S7a 通道识别与帧归一化（__lgjHookPlat / __lgjHookNorm / __lgjGunzip）
  //   S7b 三平台解码（虎牙 Tars-lite / 抖音 protobuf-lite / 斗鱼 STT 调度）
  //   S7c 连接挂载与构造器包裹（__lgjHookAttach / installPageWsHook）
  //   S7d Hook 数据源（PageHookSource：首条弹幕才 auth、live:0 补注册、静默看门狗）
  // 铁律：只读不发——本区不调用任何 ws.send（唯一主动发送在 S7d 的 live:0 注册）。
  // ---------------------------------------------------------------------------
  // 原理：包裹页面自身的 WebSocket 构造器，按 URL 识别弹幕通道并【被动】监听帧。
  // 心跳/ack/重连全部由页面 SDK 自理（抖音 ≤7s ack、虎牙 cmd 心跳都在页面侧闭环）；
  // 页面断线自愈重连后，新连接自动被识别挂载。
  var __lgjHookNet = { douyu: [], huya: [], douyin: [] }; // {ws, alive, lastFrame}
  var __lgjHookSubs = { douyu: null, huya: null, douyin: null }; // 活跃订阅（引擎接管时注册）
  var __lgjWsHookInstalled = false;
  window.__lgjPageHook = { net: __lgjHookNet };

  function __lgjHookPlat(url) {
    var u = String(url || '');
    if (u.indexOf('danmuproxy.douyu.com') >= 0) return 'douyu';
    if (/-ws\.va\.huya\.com/.test(u)) return 'huya'; // 弹幕主通道（*-server.va.huya.com 是信令通道，不匹配）
    if (u.indexOf('douyin.com') >= 0 && (u.indexOf('-ws-web-') >= 0 || u.indexOf('/push/') >= 0)) return 'douyin';
    return '';
  }
  /** Blob/ArrayBuffer/TypedArray/string 归一化（虎牙页面未设 binaryType → 帧是 Blob；
   *  另注意跨世界陷阱：页面上下文的 ArrayBuffer 在隔离世界 instanceof/isView 都可能判否，
   *  用 byteLength 接口特征兜底，避免帧被静默丢弃） */
  function __lgjHookNorm(data, cb) {
    try {
      if (typeof data === 'string') { cb(null, data); return; }
      if (data instanceof ArrayBuffer) { cb(new Uint8Array(data), null); return; }
      if (ArrayBuffer.isView(data)) { cb(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), null); return; }
      if (data && typeof data.byteLength === 'number' && typeof data.arrayBuffer !== 'function') {
        // 跨世界 ArrayBuffer（无 .arrayBuffer 方法但有 byteLength）或 TypedArray 视图
        try {
          var u8 = (data.buffer && typeof data.byteOffset === 'number')
            ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
            : new Uint8Array(data);
          cb(u8, null);
          return;
        } catch (_e) { /* 落到 Blob 分支 */ }
      }
      if (data && typeof data.arrayBuffer === 'function') {
        data.arrayBuffer().then(function (ab) { cb(new Uint8Array(ab), null); }, function () { /* 忽略 */ });
      }
    } catch (_e) { /* 忽略 */ }
  }
  function __lgjGunzip(bytes) {
    if (typeof DecompressionStream !== 'function') return Promise.reject(new Error('no-gzip'));
    var ds = new DecompressionStream('gzip');
    var stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Response(stream).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
  }
  // 虎牙 Tars 字节序：**大端优先**（1.2.3 真机修正）。
  // 文档原写「多字节数值为 little-endian」，但真机字节级验证为 **大端**：
  //   item 的 iUri 字节 `01 17 df`（head=INT16）→ BE=0x17df=6111（榜单类 uri，合理）；
  //   SIMPLELIST 长度 `01 05 d5` → BE=1493 = vData 实际长度（LE 会得 54533，越界）。
  // 页面权威实现 Taf.BinBuffer.readInt16/readInt32 均无 endian 参数 → DataView 默认大端。
  // BE 兜底保留 LE（防个别帧/版本差异），但**只有 BE 无法解出弹幕时才尝试 LE**。
  var __lgjHuyaLE = null;
  function __lgjHuyaDecode(u8) {
    var tries = __lgjHuyaLE === null ? [false, true] : [__lgjHuyaLE]; // false = BE 优先
    var anyFrame = false;
    for (var i = 0; i < tries.length; i++) {
      try {
        var le = tries[i];
        var pc = huyaParseCommand(u8, le);
        if (pc.cmd === null || pc.cmd === undefined) continue;
        if ((pc.cmd === 7 || pc.cmd === 22) && !pc.vData) continue; // 结构不自洽，换字节序
        anyFrame = true;
        var d = huyaExtractDanmu(pc.cmd, pc.vData, le);
        if (d.length) {
          if (__lgjHuyaLE === null) { __lgjHuyaLE = le; logEvent('协议', '虎牙 Tars 字节序锁定：' + (le ? 'LE' : 'BE')); }
          return { anyFrame: true, danmus: d };
        }
        // 1.2.3 修复：结构自洽但本帧无弹幕（心跳/回执/其它 uri）时**继续尝试另一种字节序**，
        // 不再立即 return——旧实现用错误的 LE 解出 cmd 后即返回空，永远试不到正确的 BE，
        // 导致「接管成功却零弹幕」。
      } catch (_e) { /* 忽略 */ }
    }
    return { anyFrame: anyFrame, danmus: [] };
  }
  /** 统一弹幕 meta 构造：三平台 Hook 派发共用（id 前缀区分来源平台） */
  function __lgjHookMeta(prefix, d, now) {
    return { id: prefix + now + '_' + (d.uid || 0) + '_' + d.text.length, uid: d.uid, nick: d.nick, ts: now };
  }
  function __lgjHookDispatch(plat, u8, text) {
    var sub = __lgjHookSubs[plat];
    var now = Date.now();
    if (plat === 'douyu') {
      var frames = text ? [{ type: 0x02b2, text: text }] : douyuParseFrames(u8);
      if (!frames.length) return;
      if (sub) sub.onFrame();
      if (!sub) return;
      for (var i = 0; i < frames.length; i++) {
        if (frames[i].type !== 0x02b2) continue;
        var c = douyuExtractChat(frames[i].text);
        if (c) sub.onDanmu(c.text, __lgjHookMeta('dyh_', c, now));
      }
    } else if (plat === 'huya') {
      if (!u8) return;
      var r = __lgjHuyaDecode(u8);
      if (!r.anyFrame) return;
      if (sub) sub.onFrame();
      if (!sub) return;
      for (var j = 0; j < r.danmus.length; j++) {
        sub.onDanmu(r.danmus[j].text, __lgjHookMeta('hy_', r.danmus[j], now));
      }
    } else if (plat === 'douyin') {
      if (!u8) return;
      try {
        var pf = douyinParsePushFrame(u8);
        if (!pf.payload) return;
        var finish = function (bytes) {
          var resp = douyinParseResponse(bytes);
          if (sub) sub.onFrame();
          if (!sub) return;
          for (var k = 0; k < resp.messages.length; k++) {
            var m = douyinParseMessage(resp.messages[k]);
            if (m.method !== 'WebcastChatMessage' || !m.payload) continue;
            var cc = douyinParseChat(m.payload);
            if (cc) sub.onDanmu(cc.text, __lgjHookMeta('dyin_', cc, now));
          }
        };
        if (pf.isGzip) __lgjGunzip(pf.payload).then(finish, function () { /* 单帧容错 */ });
        else finish(pf.payload);
      } catch (_e) { /* 单帧容错 */ }
    }
  }
  function __lgjHookAttach(ws, plat) {
    var rec = { ws: ws, alive: true, lastFrame: 0 };
    var list = __lgjHookNet[plat];
    list.push(rec);
    // 1.2.3 审查：仅保留最近的活跃记录，且**上限内优先淘汰已关闭的**——
    // 原来只按长度裁剪，关闭连接会长期占据名额（诊断与注册选路都会扫到死连接）。
    if (list.length > 8) {
      var pruned = [];
      for (var pi = list.length - 1; pi >= 0 && pruned.length < 8; pi--) {
        var rr = list[pi];
        if (rr.alive && rr.ws && rr.ws.readyState === 1) pruned.unshift(rr);
      }
      if (pruned.length < list.length) {
        // 还有空位则用最近的已关闭记录补齐（保留诊断可见性）
        for (var pj = list.length - 1; pj >= 0 && pruned.length < 8; pj--) {
          if (pruned.indexOf(list[pj]) < 0) pruned.unshift(list[pj]);
        }
        list.length = 0;
        for (var pk = 0; pk < pruned.length; pk++) list.push(pruned[pk]);
      }
    }
    var onMsg = function (ev) {
      rec.lastFrame = Date.now();
      __lgjHookNorm(ev.data, function (u8, text) { __lgjHookDispatch(plat, u8, text); });
    };
    var onEnd = function () { rec.alive = false; };
    try {
      ws.addEventListener('message', onMsg);
      ws.addEventListener('close', onEnd);
      ws.addEventListener('error', onEnd);
    } catch (_e) { /* 忽略 */ }
  }
  function installPageWsHook() {
    if (__lgjWsHookInstalled) return;
    __lgjWsHookInstalled = true;
    try {
      var pw = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
      if (!pw || pw.__lgjWsHooked) return;
      var Orig = pw.WebSocket;
      if (typeof Orig !== 'function') return;
      var wrapped = function (url, protocols) {
        var ws = (protocols !== undefined) ? new Orig(url, protocols) : new Orig(url);
        var plat = __lgjHookPlat(url);
        if (plat) { try { __lgjHookAttach(ws, plat); } catch (_e) { /* 忽略 */ } }
        return ws;
      };
      wrapped.prototype = Orig.prototype;
      try { Object.setPrototypeOf(wrapped, Orig); } catch (_e) { /* 忽略 */ }
      try { Object.defineProperty(wrapped, 'name', { value: 'WebSocket' }); } catch (_e) { /* 忽略 */ }
      try { wrapped.CONNECTING = Orig.CONNECTING; wrapped.OPEN = Orig.OPEN; wrapped.CLOSING = Orig.CLOSING; wrapped.CLOSED = Orig.CLOSED; } catch (_e) { /* 忽略 */ }
      pw.WebSocket = wrapped;
      pw.__lgjWsHooked = true;
      logEvent('协议', '页面 WS Hook 已安装（虎牙/抖音/斗鱼-Hook 被动监听就绪）');
    } catch (_e) { /* 忽略 */ }
  }

  /** Hook 路线协议源：订阅页面既有弹幕连接；首帧=auth，60s 无帧=掉线 */
  function PageHookSource(plat, onDanmu, onDrop, onAuth) {
    this.plat = plat;
    this.onDanmu = onDanmu;
    this.onDrop = onDrop;
    this.onAuth = onAuth;
    this.stopped = false;
    this.alive = false;
    this._sub = null;
    this._resolve = null;
    this._reject = null;
    this._authTimer = null;
    this._silenceTimer = null;
    this._danmuCount = 0;      // 累计解出的弹幕条数（诊断）
    this._regSent = false;     // 虎牙 live:0 注册是否已发送（实例级，防重连重复注册）
    this._regTimers = [];      // 注册重试计时器句柄（stop 时清理）
  }
  /**
   * 帧到达（心跳/事件/弹幕都算「通道活着」）。
   *
   * 1.2.3 修复（真机回归）：auth **不能只看「收到帧」**。
   * 虎牙页面连接持续推送心跳/榜单事件（7101-7114 等），但**不含 uri1400 弹幕**；
   * 旧实现任何帧即 auth → `onProtoAuth` → `domPause()` 断开 DOM →
   * 结果是「DOM 已停 + 协议无弹幕」= 用户完全收不到弹幕，比纯 DOM 更差。
   * 真机实测：DOM 容器 55 条真实弹幕，而 dpm/cand/top 恒 0，且因心跳持续到达
   * 60s 静默看门狗永不触发，无法自救。
   *
   * 新语义：`_touch()` 只保活（重置静默计时），**auth 必须等首条弹幕**（`markDanmu()`）。
   * 这样在「通道活着但无弹幕」时，引擎会走到 auth 超时并回落 DOM，用户仍有弹幕。
   */
  PageHookSource.prototype._touch = function () {
    var self = this;
    if (self.stopped) return;
    // 静默看门狗：60s 无任何协议帧（虎牙心跳 5-10s、抖音推送流、斗鱼 mrkl 回显都在流）→ 判通道死亡
    if (self._silenceTimer) clearTimeout(self._silenceTimer);
    self._silenceTimer = setTimeout(function () {
      if (self.stopped) return;
      self.stop();
      if (self.onDrop) { try { self.onDrop(); } catch (_e) { /* 忽略 */ } }
    }, 60000);
  };
  /** 解出首条弹幕 → 此时才算 auth 成功、允许接管 DOM */
  PageHookSource.prototype.markDanmu = function () {
    var self = this;
    if (self.stopped || self.alive) return;
    self.alive = true;
    if (self._authTimer) { clearTimeout(self._authTimer); self._authTimer = null; }
    if (self.onAuth) { try { self.onAuth(); } catch (_e) { /* 忽略 */ } }
    if (self._resolve) { var r = self._resolve; self._resolve = null; self._reject = null; r(); }
  };
  PageHookSource.prototype.start = function () {
    var self = this;
    installPageWsHook();
    return new Promise(function (resolve, reject) {
      if (self.stopped) { reject(new Error('stopped')); return; }
      self._resolve = resolve;
      self._reject = reject;
      self._sub = {
        onFrame: function () { self._touch(); },
        onDanmu: function (text, meta) {
          self._touch();
          if (self.stopped) return;
          self._danmuCount++;
          // 1.2.3：首条弹幕才算 auth（此时才允许接管 DOM）
          self.markDanmu();
          try { self.onDanmu(text, meta); } catch (_e) { /* 忽略 */ }
        },
      };
      __lgjHookSubs[self.plat] = self._sub;
      /**
       * auth 超时：等待**首条弹幕**（而非任意帧）。
       * 虎牙页面连接只有心跳/榜单事件时，旧语义会在 20s 内「成功接管」并停掉 DOM，
       * 而永远解不出弹幕 → 用户彻底无弹幕。新语义下本计时器按期触发 → 回落 DOM。
       * 窗口沿用 20s（页面弹幕通常秒级到达；虎牙弹幕稀疏时宁可回落 DOM 保可用）。
       */
      self._authTimer = setTimeout(function () {
        if (self.stopped) return;
        self._resolve = null; self._reject = null;
        reject(new Error('hook-no-danmu-timeout'));
      }, 20000);
      // 页面已连接且刚有帧 → 仅保活（不再据此 auth）
      var net = __lgjHookNet[self.plat] || [];
      for (var i = 0; i < net.length; i++) {
        if (net[i].alive && net[i].lastFrame && Date.now() - net[i].lastFrame < 15000) { self._touch(); break; }
      }
      // 1.2.3：虎牙主动补注册 live:0 通配组。
      // 真机事实：页面自身注册的是 live:<rid> / chat:<rid>，150s/69 帧内 uri 全为事件类
      // （6291/6479/7101-7114），未捕获 uri1400（弹幕）。协议文档口径：注册 live:0
      // 通配组即可收到该房间 live 组推送。注册帧字节与页面真实上行帧逐字节一致
      // （huyaBuildRegisterGroups 的模板来自真机抓包）。仅补发注册帧，不改页面其它行为。
      if (self.plat === 'huya') { try { self._registerHuyaWildcard(); } catch (_e) { /* 忽略 */ } }
    });
  };
  /**
   * 在页面已有虎牙连接上补发 live:0 注册（cmd16）。
   * 选「最近收帧最活跃」的活连接发送（真机统计该连接收发帧最多，注册最可能被受理）。
   * 首次立即尝试，无活连接时 1.2s / 4s 各重试一次；失败静默（不影响被动监听）。
   */
  /**
   * 在页面已有虎牙连接上补发 live:0 注册（cmd16）。
   *
   * 选「最近收帧最活跃」的活连接发送（真机统计其收发帧最多，注册最可能被受理）。
   * 首次立即尝试，无活连接时 1.2s / 4s 各重试一次。
   *
   * 1.2.3 审查修正两点：
   *  1) `_regSent` 挂在**实例**上（原为函数局部 `sent`）——同一实例的 `start()` 重试
   *     （静默看门狗 60s 重连循环）不再重复注册，避免无谓上行帧；
   *  2) 两个 `setTimeout` 句柄记入 `_regTimers` 并在 `stop()` 清理——否则已停止的源
   *     仍可能在 1.2s/4s 后发帧（生命周期泄漏）。
   */
  PageHookSource.prototype._registerHuyaWildcard = function () {
    var self = this;
    if (self._regSent) return;
    var sendOnce = function () {
      if (self.stopped || self._regSent) return self._regSent;
      var net = __lgjHookNet.huya || [];
      var best = null;
      for (var i = 0; i < net.length; i++) {
        var r = net[i];
        if (!r.alive || !r.ws || r.ws.readyState !== 1) continue;
        if (!best || (r.lastFrame || 0) > (best.lastFrame || 0)) best = r;
      }
      if (!best) return false;
      try {
        best.ws.send(huyaBuildRegisterGroups([HUYA_WILDCARD_GROUP]));
        self._regSent = true;
        logEvent('协议', '虎牙已补注册 ' + HUYA_WILDCARD_GROUP + ' 通配组（争取 uri1400 弹幕）');
      } catch (_e) { /* 忽略：注册失败不影响被动监听 */ }
      return self._regSent;
    };
    if (sendOnce()) return;
    self._regTimers.push(setTimeout(function () { sendOnce(); }, 1200));
    self._regTimers.push(setTimeout(function () { sendOnce(); }, 4000));
  };
  PageHookSource.prototype.stop = function () {
    this.stopped = true;
    this.alive = false;
    if (__lgjHookSubs[this.plat] === this._sub) __lgjHookSubs[this.plat] = null;
    if (this._authTimer) { clearTimeout(this._authTimer); this._authTimer = null; }
    if (this._silenceTimer) { clearTimeout(this._silenceTimer); this._silenceTimer = null; }
    // 清理注册重试计时器（否则停止后仍可能发帧）
    for (var t = 0; t < this._regTimers.length; t++) { clearTimeout(this._regTimers[t]); }
    this._regTimers = [];
    // 等待中的 start() 以中止收尾（否则 engage 锁会悬挂到 20s 超时）
    if (this._reject) { var rj = this._reject; this._reject = null; this._resolve = null; rj(new Error('stopped')); }
    this._resolve = null;
  };


  // ---------------------------------------------------------------------------
  // S8. 原生发送（B 站协议直发，默认关闭）
  // ---------------------------------------------------------------------------
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



  // ---------------------------------------------------------------------------
  // S9. 引擎状态机与生命周期
  //   S9a 状态与就绪判定（mode/sendMode/src/engaged、protoCapable、退避阶梯）
  //   S9b 协议喂数（feedProtocol + L2 元数据加权桥接）
  //   S9c 双源互斥（domPause/domResume/standbySources）
  //   S9d 接管与回落（engageProto/engageRoute/onProtoAuth/onProtocolDrop）
  //   S9e 单一 tick 生命周期（开关/leader/模式/退避全部收敛于此）
  //   S9f 诊断与配置导入导出（diagnose/exportConfig/importConfig）
  // ---------------------------------------------------------------------------
  var src = null;
  var started = false;
  var mode = 'auto';          // dom | protocol | auto
  var sendMode = 'dom';
  var engaged = false;        // 协议是否已 auth 成功并接管数据流
  var protoFailUntil = 0;     // 协议失败/掉线后的退避再探时间
  /**
   * 连续失败次数（1.2.3 审查新增）。
   * 动机：当某平台的协议路线**结构性地**拿不到数据时（真机案例：虎牙 Hook 连接持续推送
   * 心跳但无 uri1400 弹幕），固定 60s 退避会导致「连接中… → 回落 DOM」**无限循环**，
   * 用户每隔一分钟看到状态行抖动一次、且每轮都白建一条 wss。
   * 策略：失败次数每增加一次，退避指数放大（60s → 120s → 300s → 封顶 600s）；
   * 任一次成功（或用户切换平台/模式）即清零。
   */
  var protoFailStreak = 0;
  var PROTO_BACKOFF_MAX = 600000; // 上限 10 分钟
  /**
   * 会话级「协议路线停用」（1.2.3 审查新增）。
   *
   * 动机：指数退避只是把无限重试**拉长**，并不能消除它。对「协议路线结构性无数据」的
   * 平台（真机案例：虎牙 Hook 连接持续推送心跳/榜单事件，但从不含 uri1400 弹幕），
   * 即便退避到 10 分钟，每轮仍会：建一条 wss → 等 20s auth 超时 → 回落，
   * 既浪费连接与电量，也让状态行周期性抖动。
   *
   * 策略：连续失败达到阈值（`PROTO_DISABLE_AFTER`）后，**本页会话内不再尝试该平台的协议路线**，
   * 状态行明确显示「已停用（本会话）」，把数据源稳定在 DOM。
   * 恢复条件（任一即可）：用户显式切换模式 / 切换平台（SPA 导航）/ 刷新页面。
   */
  var PROTO_DISABLE_AFTER = 3;
  var protoDisabledThisSession = false;
  function _protoBackoffMs(base) {
    var mult = protoFailStreak <= 0 ? 1 : (protoFailStreak === 1 ? 1 : (protoFailStreak === 2 ? 2 : 5));
    return Math.min(PROTO_BACKOFF_MAX, base * mult);
  }
  /** 协议路线是否已被本会话停用（供 tick / UI 判断，避免无谓建连） */
  function protoSuspended() { return protoDisabledThisSession; }
  var autoUnavailable = false; // 智能模式是否不可用（一级界面显示手动开关）
  var statusEl = null;
  var selectEl = null;        // 设置页引擎开关（兼容旧引用）
  var sendSelectEl = null;    // 设置页发送开关（兼容旧引用）
  var election = null;
  var electionChannel = null;
  var __lgjEngaging = false; // engage 进行中互斥锁（防 2s tick 并发连协议；1.2.2 吸收真机教训）
  var douyuRoute = 'auto';   // 斗鱼协议路线：auto(自连优先/Hook兜底) | direct | hook
  /** 配置值归一：只认 direct/hook，其余一律 auto（boot 与设置页两处共用） */
  function normDouyuRoute(v) { return (v === 'direct' || v === 'hook') ? v : 'auto'; }
  /** 该平台是否有可用协议路线（1.2.2：四平台都有了——B站/斗鱼自连，斗鱼/虎牙/抖音 Hook） */
  function protoCapable() { return pickProtoRoutes(_plat(), douyuRoute).length > 0; }
  var metaMap = Object.create(null);
  var seenMsgIds = Object.create(null);
  var seenMsgOrder = [];
  /**
   * 单条弹幕保留的独立发送者上限（1.2.3 审查新增）。
   * 评分侧的发送者贡献在 20 个时即饱和（`Math.min(0.5, senders / 20)`），
   * 保留 32 个留出余量即可，换来 senders 字典的硬上限（防长直播刷屏撑爆内存）。
   */
  var META_SENDER_CAP = 32;
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
      if (meta.uid !== null && meta.uid !== undefined) {
        // 容量保护（1.2.3 审查新增）：`senders` 原为**无上限**字典——同一条弹幕被大量
        // 不同用户复读时会持续增长（实测 100 万发送者 → 91.6 MiB heap）。而
        // `__lgjMetaBoost` 的发送者贡献 `Math.min(0.5, senders / 20)` 在 20 个时即饱和，
        // 超出部分对评分**零贡献**。故记到 `META_SENDER_CAP` 即停：字典与计数同时封顶，
        // 诊断里输出的发送者数因此上限为 CAP（评分侧本就饱和，不影响选词质量）。
        if (rec.senderCount === undefined) rec.senderCount = 0;
        if (rec.senderCount < META_SENDER_CAP) {
          var uidKey = String(meta.uid);
          if (rec.senders[uidKey] === undefined) { rec.senders[uidKey] = 1; rec.senderCount++; }
        }
      }
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

  //   （续 S9c/S9d：双源互斥与接管回落，见上）
  // ---------------------------------------------------------------------------
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
  /** 连接协议；auth 成功才 domPause + engaged，失败/掉线立即回 DOM（无数据空窗）
   *  1.2.2：按平台路线表依次尝试（斗鱼 auto = 自连→Hook；虎牙/抖音 = Hook）。
   *  返回值语义：true=接管成功；false=全部路线失败（调用方应退避）；null=已有一次连接进行中（非失败，勿退避） */
  function engageProto() {
    if (__lgjEngaging) return Promise.resolve(null);
    __lgjEngaging = true;
    var plat = _plat();
    var routes = pickProtoRoutes(plat, douyuRoute);
    var room = platRoomId(plat, location.href, safeTopHref());
    if (!routes.length) { __lgjEngaging = false; setStatus('协议：该平台暂无协议源', 'err'); return Promise.resolve(false); }
    // 1.2.3 修复：非直播间页面（房间号=0）不发起任何协议连接。
    // 原实现只在「纯自连路线」时检查房间号，含 hook 的路线（如斗鱼 auto=[direct,hook]）
    // 会绕过检查 → 在 /directory/all 等页面也发起协议连接（真机实测日志「连接中（douyu 房间 ?）」）。
    // 非房间页既无弹幕可采，也会多占一条匿名连接，直接不连。
    if (!room) { __lgjEngaging = false; setStatus('DOM 采集（非直播间页面）', 'ok'); return Promise.resolve(false); }
    stopProtocol();
    setStatus('协议：连接中…', '');
    logEvent('协议', '连接中（' + plat + ' 房间 ' + (room || '?') + '，路线 ' + routes.join('→') + '）');
    var idx = 0;
    var tryNext = function () {
      if (idx >= routes.length) { __lgjEngaging = false; return false; }
      var route = routes[idx++];
      return engageRoute(plat, route, room).then(function (ok) {
        if (ok) { __lgjEngaging = false; return true; }
        return tryNext();
      });
    };
    return Promise.resolve().then(tryNext);
  }
  /** 单路线尝试；resolve(true/false)，绝不 reject（路线失败只是换下一条） */
  function engageRoute(plat, route, room) {
    return new Promise(function (resolve) {
      var s = null;
      if (route === 'direct') {
        if (!room) { resolve(false); return; }
        if (plat === 'bilibili') s = new BiliSource(room, feedProtocol, function () { onProtocolDrop(); }, onProtoAuth);
        else if (plat === 'douyu') s = new DouyuDirectSource(room, feedProtocol, function () { onProtocolDrop(); }, onProtoAuth);
      } else if (route === 'hook') {
        s = new PageHookSource(plat, feedProtocol, function () { onProtocolDrop(); }, onProtoAuth);
      }
      if (!s) { resolve(false); return; }
      src = s;
      s.start().then(function () {
        protoFailUntil = 0;
        setStatus('协议：数据流（' + (route === 'direct' ? '自连' : 'Hook') + '）', 'ok');
        logEvent('协议', '已接管（' + plat + ' / ' + route + '）');
        resolve(true);
      }, function (e) {
        if (src === s) src = null;
        try { s.stop(); } catch (_e) { /* 忽略 */ }
        var msg = String((e && e.message) || e);
        if (msg !== 'stopped') logEvent('协议', route + ' 路线失败：' + msg.slice(0, 24) + '，换下一路线/回落');
        resolve(false);
      });
    });
  }
  /** auth 成功瞬间同步接管，避免首帧被 engaged 守卫丢弃 */
  function onProtoAuth() {
    domPause();
    engaged = true;
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
    autoUnavailable = (mode === 'auto') && (!protoCapable() || Date.now() < protoFailUntil);
    if (autoUnavailable && !_autoWarned) {
      _autoWarned = true;
      logEvent('引擎', '智能模式不可用（' + (!protoCapable() ? '该平台暂无协议源' : '协议探测失败/退避中') + '），一级界面已显示手动开关');
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
      else if (mode !== 'dom' && protoCapable()) setStatus('待机：请打开机器人开关', '');
      return;
    }
    if (mode === 'dom') {
      if (engaged || src) disengageProto();
      else if (state.isRunning && !state.danmuObserver) { try { ensureObserverRunning(); } catch (_e) { /* 忽略 */ } }
      // 1.2.3 修复：DOM 模式必须刷新状态行。原实现只 disengageProto() 就 return，
      // 状态行会保留切换前的「协议：数据流（…）」——数据源已回 DOM 却仍显示协议在跑，
      // 真机模式矩阵实测复现（src=dom/engaged=false 时 engine 文案仍是协议）。
      setStatus('DOM 采集', 'ok');
      return;
    }
    if (engaged) return;
    if (!protoCapable()) {
      setStatus('DOM 采集（该平台暂无协议源）', 'ok');
      protoFailUntil = Date.now() + 60000;
      return;
    }
    // 本会话已停用该平台协议路线：不再建连，稳定停在 DOM（恢复需切模式/换房/刷新）
    if (protoSuspended()) {
      setStatus('DOM 采集（协议路线本会话已停用）', 'ok');
      return;
    }
    if (Date.now() < protoFailUntil) return;
    engageProto().then(function (ok) {
      if (ok === null) return; // 已有一次连接进行中：不是失败，不退避、不改状态
      if (ok) { protoFailStreak = 0; return; }   // 成功即清零连续失败计数
      protoFailStreak++;
      // 连续失败达阈值 → 本会话停用协议路线，避免无限建连/抖动
      if (protoFailStreak >= PROTO_DISABLE_AFTER) {
        protoDisabledThisSession = true;
        setStatus('DOM 采集（协议路线本会话已停用）', 'ok');
        logEvent('协议', '连续 ' + protoFailStreak + ' 次无产出，本会话停用协议路线（切模式或刷新可重试）');
        return;
      }
      if (mode === 'auto') {
        var wait = _protoBackoffMs(60000);
        protoFailUntil = Date.now() + wait;
        setStatus('自动：DOM 采集（' + Math.round(wait / 60000) + ' 分钟后再探协议）', 'ok');
      } else {
        var wait2 = _protoBackoffMs(15000);
        protoFailUntil = Date.now() + wait2;
        setStatus('协议：不可用，已回落 DOM（' + Math.round(wait2 / 1000) + 's 后重试）', 'err');
      }
    });
  }
  function applyMode() { tick(); } // 兼容旧调用名
  function switchMode(m) {
    if (m !== 'protocol' && m !== 'dom' && m !== 'auto') return;
    var old = mode;
    mode = m;
    protoFailStreak = 0;        // 用户显式切模式 → 重置退避阶梯，立刻按新模式重试
    protoFailUntil = 0;
    protoDisabledThisSession = false; // 同时解除「本会话停用」，尊重用户显式意图
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
      platform: _plat(), room: platRoomId(_plat(), location.href, safeTopHref()) || location.pathname.replace(/[^0-9]/g, '') || location.pathname,
      engine: mode, sendMode: sendMode, engineStatus: statusEl ? statusEl.textContent : '',
      douyuRoute: douyuRoute,
      hook: (function () {
        try {
          var o = {};
          for (var p in __lgjHookNet) {
            if (!Object.prototype.hasOwnProperty.call(__lgjHookNet, p)) continue;
            o[p] = __lgjHookNet[p].filter(function (r) { return r.alive; }).length + '活/' + __lgjHookNet[p].length;
          }
          return o;
        } catch (_e) { return {}; }
      })(),
      sourceKind: window.__lgjSourceKind || '', engaged: engaged, protoFailUntil: protoFailUntil,
      protoFailStreak: protoFailStreak, protoSuspended: protoDisabledThisSession,
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

  // ---------------------------------------------------------------------------
  // S11. UI —— 设置页增强（引擎 / 发送 / 安全阀 / 配置管理 / 日志筛选）
  // ---------------------------------------------------------------------------
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
      var douyuRouteHtml = '';
      if (_plat() === 'douyu') {
        douyuRouteHtml = '<div style="display:flex;align-items:center;gap:8px;margin-top:6px;">'
          + '<label style="flex:1;color:var(--bot-text,#aaa);font-size:var(--bot-font-size,12px);">斗鱼协议路线</label>'
          + '<select id="s-douyuRoute" style="background:var(--bot-border,#2c2c3a);color:var(--bot-text,#ccc);border:none;border-radius:4px;padding:2px 6px;font-size:calc(var(--bot-font-size,12px) - 1px);">'
          + '<option value="auto"' + (douyuRoute === 'auto' ? ' selected' : '') + '>自连优先（Hook 兜底）</option>'
          + '<option value="direct"' + (douyuRoute === 'direct' ? ' selected' : '') + '>仅自连</option>'
          + '<option value="hook"' + (douyuRoute === 'hook' ? ' selected' : '') + '>仅 Hook 页面</option>'
          + '</select></div>'
          + '<div style="font-size:calc(var(--bot-font-size,12px) - 2px);color:#666;margin-top:2px;">自连 = 匿名直连 danmuproxy；Hook = 被动监听页面已有连接（更隐蔽）</div>';
      }
      var engineHtml = settingsSectionHtml('⚙️ 引擎',
        settingsToggleRow('s-engineDirect', '直连引擎（协议）', mode === 'protocol', '关闭 = DOM 采集；打开 = 协议直连。默认 DOM。')
        + douyuRouteHtml
        + '<div style="display:flex;align-items:center;gap:8px;margin-top:6px;">'
        + settingsBtnHtml('s-engineSmart', '切到智能模式')
        + '<span id="s-engine-status" style="font-size:calc(var(--bot-font-size,12px) - 2px);color:#888;"></span></div>');
      var sendHtml = settingsSectionHtml('📤 发送',
        settingsToggleRow('s-sendProtocol', '协议直发（实验）', sendMode === 'protocol', '关闭 = DOM 模拟（默认）；打开 = 调用 B 站发送接口。平台明确拒绝 / 网络异常不会回落，避免双发。'));
      // 1.2.3 新增：安全阀设置区。
      // 动机：safety 的 perMin/perHour/perDay/minGap/cooldown/skipChance/pauseWhenHidden
      // 之前**全部没有 UI 控件**，用户无法按自身风险偏好调整；其中 pauseWhenHidden 默认 true，
      // 会让「非前台标签页」永不发送——多平台同时开播时只有当前标签页能工作（真机实测），
      // 属于最需要可调的一项。数值项走 input，开关项走 toggle。
      var sc = (function () { try { return safety.getConfig(); } catch (_e) { return {}; } })();
      var safetyHtml = settingsSectionHtml('🛡️ 安全阀',
        '<div style="font-size:calc(var(--bot-font-size,12px) - 2px);color:#888;margin-bottom:6px;">硬上限只能调得更严：超过上限的输入会被夹到平台安全范围。计数持久化、跨标签合并。</div>'
        + buildInputRow('s-safetyPerMin', '每分钟上限', sc.perMin, 1, 600)
        + buildInputRow('s-safetyPerHour', '每小时上限', sc.perHour, 1, 6000)
        + buildInputRow('s-safetyPerDay', '每日上限', sc.perDay, 1, 50000)
        + buildInputRow('s-safetyMinGap', '最小间隔(秒)', Math.round((sc.minGapMs || 2000) / 1000), 1, 600)
        + buildInputRow('s-safetyCooldownN', '冷却触发条数', sc.cooldownAfter, 1, 500)
        + buildInputRow('s-safetyCooldownMin', '冷却时长(分)', Math.round((sc.cooldownMs || 600000) / 60000), 1, 1440)
        + buildInputRow('s-safetySkip', '随机跳过(%)', Math.round((sc.skipChance || 0) * 100), 0, 100)
        + settingsToggleRow('s-safetyPauseHidden', '切后台暂停发送', sc.pauseWhenHidden !== false,
          '打开 = 非前台标签页不发送（多平台同时开播时只有当前标签页工作）；关闭 = 后台标签页也发送。'));

      var configHtml = settingsSectionHtml('💾 配置管理',
        '<div style="display:flex;gap:8px;margin-bottom:8px;">'
        + settingsBtnHtml('settings-export-btn', '导出配置')
        + settingsBtnHtml('settings-import-btn', '导入配置')
        + settingsBtnHtml('settings-diag-btn', '诊断')
        + '</div>'
        + '<textarea id="settings-import-area" placeholder="粘贴导出的 JSON…" style="display:none;width:100%;height:70px;box-sizing:border-box;font-family:monospace;font-size:11px;background:var(--bot-border,#222);color:var(--bot-text,#ddd);border:1px solid #555;border-radius:4px;"></textarea>');
      var firstSection = panel.querySelector('.settings-section');
      if (firstSection) firstSection.insertAdjacentHTML('beforebegin', engineHtml + sendHtml + safetyHtml + configHtml);
      else panel.insertAdjacentHTML('beforeend', engineHtml + sendHtml + safetyHtml + configHtml);

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
      var droute = panel.querySelector('#s-douyuRoute');
      if (droute) droute.addEventListener('change', function () {
        douyuRoute = normDouyuRoute(droute.value);
        saveCfg({ douyuRoute: douyuRoute });
        logEvent('引擎', '斗鱼协议路线 → ' + douyuRoute);
        if (engaged || src) disengageProto();
        tick();
      });
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
      // 1.2.3：安全阀设置绑定（数值项 input + 开关 toggle）
      // 数值项单位换算：minGap 秒→ms、cooldown 分→ms、skip %→0..1
      var safetyInputs = [
        ['s-safetyPerMin', 'perMin', 1],
        ['s-safetyPerHour', 'perHour', 1],
        ['s-safetyPerDay', 'perDay', 1],
        ['s-safetyMinGap', 'minGapMs', 1000],
        ['s-safetyCooldownN', 'cooldownAfter', 1],
        ['s-safetyCooldownMin', 'cooldownMs', 60000],
        ['s-safetySkip', 'skipChance', 0],  // 百分比，特殊处理
      ];
      for (var si = 0; si < safetyInputs.length; si++) {
        (function (id, key, mult) {
          var el = panel.querySelector('#' + id);
          if (!el) return;
          el.addEventListener('change', function () {
            var raw = Number(el.value);
            if (!isFinite(raw)) return;
            var patch = {};
            if (key === 'skipChance') patch[key] = Math.max(0, Math.min(1, raw / 100));
            else patch[key] = Math.round(raw * mult);
            try { safety.setConfig(patch); } catch (_e) { /* 忽略 */ }
            var cur = safety.getConfig();
            // 回填被夹取后的实际值，让用户看到真实生效值
            if (key === 'skipChance') el.value = Math.round((cur.skipChance || 0) * 100);
            else if (key === 'minGapMs') el.value = Math.round((cur.minGapMs || 0) / 1000);
            else if (key === 'cooldownMs') el.value = Math.round((cur.cooldownMs || 0) / 60000);
            else el.value = cur[key];
            logEvent('安全阀', '更新 ' + key + ' = ' + JSON.stringify(patch[key]) + '（生效 ' + JSON.stringify(cur[key]) + '）');
          });
        })(safetyInputs[si][0], safetyInputs[si][1], safetyInputs[si][2]);
      }
      var pauseHidden = panel.querySelector('#s-safetyPauseHidden');
      if (pauseHidden) pauseHidden.addEventListener('change', function () {
        try { safety.setConfig({ pauseWhenHidden: !!pauseHidden.checked }); } catch (_e) { /* 忽略 */ }
        logEvent('安全阀', '切后台暂停发送 → ' + (pauseHidden.checked ? '开（推荐）' : '关（后台标签页也发送）'));
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


  // ---------------------------------------------------------------------------
  // S10. 多标签 leader 选举（L4：唯一发送者，带过期租约 + 广播心跳）
  //   （内含 boot 入口与 __lgjEngine* 对外钩子）
  // ---------------------------------------------------------------------------
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
    douyuRoute = normDouyuRoute(c.douyuRoute);
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
  // 页面 WS Hook 尽早安装（不等 boot 的 1.5s）：抢在页面弹幕连接建立之前包裹构造器。
  // hook 一旦装上即永久有效，页面后续每次连接/重连都会被识别。
  try { installPageWsHook(); } catch (_e) { /* 忽略 */ }
})();

// ===== Hybrid 注入结束 =====

    setTimeout(init, 3000);
})();
