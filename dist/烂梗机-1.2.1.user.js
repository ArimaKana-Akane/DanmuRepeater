// ==UserScript==
// @name         烂梗机
// @namespace    http://tampermonkey.net/
// @version      1.2.1
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
// @author        LaGenJi contributors
// @license       MIT
// ==/UserScript==
// 版本历史：
// 1.2.0 hybrid（DOM+协议双引擎互斥切换）：修复双源叠加/房间号/安全阀持久化/断线重连/开关联动；详见 v2/SPEC.md
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
    const INSTALLED_VERSION = '1.2.1';
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
        const key = `${f} ${pattern}`;
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
  // 1.2.0 Hybrid 纯逻辑核心（可单测）
  // ----------------------------------------------------------------------------
  // 本文件同时被两处使用：
  //   1) Vitest 直接 import（packages/core/test/hybrid-core.test.ts）
  //   2) scripts/build-hybrid.mjs 在构建时剥掉 `export ` 后内联进用户脚本
  // 因此这里只放「平台无关、无 GM_/DOM 副作用」的纯函数与可注入依赖的类。
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
    /(送出了|赠送了|投喂了|打赏了|送出了礼物|开通了|续费了|送出了.{0,6}(火箭|飞机|礼物))/,
    /(加入了粉丝团|加入粉丝团|粉丝团|粉丝牌|点亮了|勋章|大航海|舰长|提督|总督|守护)/,
    /^.{1,16}(进入了直播间|来到了直播间|进入直播间|离开了直播间)$/,
    /^(恭喜.{0,8}(中奖|获奖|获得|抽中)|中奖|获奖|抽奖|打卡|签到|领取)/,
    /(禁言|封禁|违规|警告|举报|管理员|房管|超管)/,
    /^(主播|直播|房间)(已|即将|正在)?(开播|下播|上播|关闭)/,
    /^(当前|本场|今日|今晚).{0,10}(人气|热度|排名|榜单)/,
  ];
  
  function isSystemDanmaku(text) {
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
      var safe = name.replace(/[.*+?^${}()|[\]\\]/g, '\\    setTimeout(init, 3000);');
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
  function __DEF_PROTECT___lgjResolveRoom() { return parseBiliRoomId(location.href, safeTopHref()); }
  function __DEF_PROTECT___lgjProtoPlatform() { return location.hostname.indexOf('bilibili.com') >= 0 && __lgjResolveRoom() > 0; }
  /** 多标签选举的 key：同房间的不同文档（含 blanc iframe）必须一致 */
  function roomKey() { return __lgjResolveRoom() || location.pathname.replace(/[^0-9]/g, '') || location.hostname; }

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
    if (!__lgjProtoPlatform()) return Promise.resolve(null);
    var csrf = readCookie('bili_jct');
    if (!csrf) return Promise.resolve(null);
    var room = __lgjResolveRoom();
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
    if (__lgjEngaging) return Promise.resolve(false);
    __lgjEngaging = true;
    var room = __lgjResolveRoom();
    if (!room || !__lgjProtoPlatform()) { __lgjEngaging = false; setStatus('协议：仅 B 站直播间可用', 'err'); return Promise.resolve(false); }
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
      __lgjEngaging = false;
      protoFailUntil = 0;
      setStatus('协议：数据流', 'ok');
      logEvent('协议', '已接管（真实房号 ' + ((src && src.realRoomId) || room) + '）');
      return true;
    }).catch(function (e) {
      __lgjEngaging = false;
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
    autoUnavailable = (mode === 'auto') && (!__lgjProtoPlatform() || Date.now() < protoFailUntil);
    if (autoUnavailable && !_autoWarned) {
      _autoWarned = true;
      logEvent('引擎', '智能模式不可用（' + (!__lgjProtoPlatform() ? '该平台暂无协议源' : '协议探测失败/退避中') + '），一级界面已显示手动开关');
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
      else if (mode !== 'dom' && __lgjProtoPlatform()) setStatus('待机：请打开机器人开关', '');
      return;
    }
    if (mode === 'dom') {
      if (engaged || src) disengageProto();
      else if (state.isRunning && !state.danmuObserver) { try { ensureObserverRunning(); } catch (_e) { /* 忽略 */ } }
      return;
    }
    if (engaged) return;
    if (!__lgjProtoPlatform()) {
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
      platform: _plat(), room: __lgjResolveRoom() || location.pathname.replace(/[^0-9]/g, ''),
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


    // ============ 1.2.0-P2 平台协议扩展 + UI 增强（追加于生产 hybrid IIFE 内）============
    // 与生产 hybrid 同作用域：复用 mode/engaged/feedProtocol/onProtocolDrop/domPause/
    // isBiliPage/biliRoom/state/safety 等符号。
    // 平台协议能力（2026-09-09 真机校准后收敛）：
    //   B站：自连 comet wss —— 保留（真机验证可用）
    //   斗鱼：danmuproxy 帧级实现 auth-timeout（真机不可用）→ 禁用，走 DOM
    //   虎牙：需 ws.Launch 会话（真机遗留未闭环）→ DOM
    //   抖音：im 签名仅页面 SDK 可产（沙箱不可行）→ DOM
    // 任何失败/不可用平台均由 engageProto catch 回落 DOM（安全兜底）。
  
    function __lgjHost() {
      try {
        var h = location.hostname;
        if (h.indexOf('douyu.com') >= 0) return 'douyu';
        if (h.indexOf('huya.com') >= 0) return 'huya';
        if (h.indexOf('bilibili.com') >= 0) return 'bilibili';
        if (h.indexOf('douyin.com') >= 0) return 'douyin';
      } catch (_e) { /* 忽略 */ }
      return '';
    }
    function __lgjIsBili() { try { return isBiliPage(); } catch (_e) { return false; } }
    /** 该平台是否有沙箱可直连的协议源（斗鱼帧级实现真机 auth-timeout 已下线；虎牙/抖音需页面 hook） */
    var __lgjEngaging = false; // engage 进行中互斥锁（防每 2s 重复并发连协议）
    function __lgjProtoPlatform() {
      var h = __lgjHost();
      return h === 'bilibili';
    }
    function __lgjPlatformName() {
      var names = { bilibili: 'B站', douyu: '斗鱼', huya: '虎牙', douyin: '抖音' };
      return names[__lgjHost()] || __lgjHost() || '未知';
    }
    function __lgjResolveRoom() {
      if (__lgjIsBili()) { try { return biliRoom() || 0; } catch (_e) { return 0; } }
      try {
        var m = /^\/(\d+)/.exec(location.pathname);
        if (m) return parseInt(m[1], 10);
        m = /[?&]rid=(\d+)/.exec(location.search);
        if (m) return parseInt(m[1], 10);
      } catch (_e) { /* 忽略 */ }
      return 0;
    }
    function __lgjBuildSource(room, onDanmu, onDrop, onAuth) {
      var h = __lgjHost();
      if (h === 'bilibili') return new BiliSource(room, onDanmu, onDrop, onAuth);
      if (h === 'douyu') return new DouyuSource(room, onDanmu, onDrop, onAuth);
      var err = new Error('该平台暂无沙箱协议源（' + __lgjPlatformName() + '）');
      return { start: function () { return Promise.reject(err); }, stop: function () { /* 忽略 */ } };
    }
  
    // ---------------- 斗鱼协议源（真机协议验证：docs/斗鱼协议采集-全量测试.md） ----------------
    function DouyuSource(roomId, onDanmu, onDrop, onAuth) {
      this.roomId = roomId;
      this.onDanmu = onDanmu;
      this.onDrop = onDrop;
      this.onAuth = onAuth;
      this.ws = null;
      this.hb = null;
      this.stopped = false;
      this.alive = false;
    }
    DouyuSource.prototype.stop = function () {
      this.stopped = true; this.alive = false;
      if (this.hb) { clearInterval(this.hb); this.hb = null; }
      if (this.ws) { try { this.ws.close(); } catch (_e) { /* 忽略 */ } this.ws = null; }
    };
    DouyuSource.prototype._frame = function (typeStr) {
      var enc = new TextEncoder().encode(typeStr + '\x00');
      var len = 8 + enc.length;          // len = 双 u32 + type + body（含 \0）
      var buf = new Uint8Array(4 + len);
      var v = new DataView(buf.buffer);
      v.setUint32(0, len, true);
      v.setUint32(4, len, true);
      v.setUint32(8, 0x02b1, true);      // 客户端 → 服务器
      buf.set(enc, 12);
      return buf;
    };
    DouyuSource.prototype.start = function () {
      var self = this;
      var hosts = [8501, 8502, 8503, 8504, 8505, 8506];
      var lastErr = null;
      var attempt = function (i) {
        if (self.stopped) return Promise.reject(new Error('stopped'));
        return new Promise(function (resolve, reject) {
          var ws;
          try { ws = new WebSocket('wss://danmuproxy.douyu.com:' + hosts[i] + '/'); } catch (e) { reject(e); return; }
          ws.binaryType = 'arraybuffer';
          var opened = false;
          var loginResolve = resolve;
          var to = setTimeout(function () { if (!opened) { try { ws.close(); } catch (_e) { /* 忽略 */ } reject(new Error('open-timeout')); } }, 6000);
          ws.onopen = function () {
            opened = true;
            self.ws = ws;
            self.alive = true;
            var rid = self.roomId;
            var login = 'type@=loginreq/roomid@=' + rid
              + '/dfl@=sn@AA=106@ASss@AA=1@Ssn@AA=107@ASss@AA=1@Ssn@AA=108@ASss@AA=1@Ssn@AA=105@ASss@AA=1'
              + '/username@=visitor' + String(Math.floor(Math.random() * 900000000) + 100000000)
              + '/uid@=' + String(Math.floor(Math.random() * 9000000000) + 1000000000)
              + '/ver@=20220825/aver@=218101901/ct@=0/';
            try { ws.send(self._frame(login)); } catch (_e) { /* 忽略 */ }
            // 斗鱼对缺 loginreq/坏 room 不主动断开 → 客户端 5s 登录超时判定
            setTimeout(function () {
              if (!self.stopped && !self.alive) return;
              if (!loginResolve) return;
              loginResolve(false); // 超时仍 resolve(false)，由上层按失败处理
            }, 5000);
          };
          ws.onmessage = function (ev) { self._handle(ev.data, loginResolve, ws); };
          ws.onerror = function () { clearTimeout(to); if (!opened) reject(new Error('ws-error')); };
          ws.onclose = function () {
            var wasActive = self.alive;
            self.alive = false;
            if (self.hb) { clearInterval(self.hb); self.hb = null; }
            if (self.stopped) return;
            if (wasActive && self.onDrop) self.onDrop();
          };
        }).catch(function (e) {
          lastErr = e;
          if (i < hosts.length - 1) return attempt(i + 1);
          return Promise.reject(lastErr);
        });
      };
      return attempt(0).then(function (ok) {
        if (!ok || self.stopped) { if (self.ws) { try { self.ws.close(); } catch (_e) { /* 忽略 */ } } throw new Error('douyu-login-timeout'); }
        try { self.ws.send(self._frame('joingroup/rid@=' + self.roomId + '/gid@=1/')); } catch (_e) { /* 忽略 */ }
        self.hb = setInterval(function () {
          if (self.alive && self.ws && self.ws.readyState === 1) {
            try { self.ws.send(self._frame('mrkl/')); } catch (_e) { /* 忽略 */ }
          }
        }, 40000);
        if (self.onAuth) { try { self.onAuth(); } catch (_e) { /* 忽略 */ } }
      });
    };
    DouyuSource.prototype._handle = function (data, loginResolve, wsRef) {
      var self = this;
      if (self.stopped) return;
      var now = Date.now();
      try {
        var raw = new Uint8Array(data);
        var dec = new TextDecoder();
        var off = 0;
        while (off + 12 <= raw.length) {
          var dv = new DataView(raw.buffer, raw.byteOffset + off, raw.length - off);
          var lenA = dv.getUint32(0, true);
          var lenB = dv.getUint32(4, true);
          var type = dv.getUint32(8, true);
          if (lenA < 9 || lenA > 65536 || lenA !== lenB) break;
          var msgEnd = off + 4 + lenA;
          if (msgEnd > raw.length) break;
          var bodyBytes = raw.slice(off + 12, msgEnd);
          var end = bodyBytes.length;
          for (var zi = 0; zi < bodyBytes.length; zi++) { if (bodyBytes[zi] === 0) { end = zi; break; } }
          var text = dec.decode(bodyBytes.subarray(0, end));
          if (type === 0x02b2 && text) self._consume(text, loginResolve, now);
          off = msgEnd;
        }
      } catch (_e) { /* 单帧容错 */ }
    };
    DouyuSource.prototype._consume = function (text, loginResolve, now) {
      var self = this;
      var type = '';
      var kv = {};
      var parts = text.split('/');
      for (var i = 0; i < parts.length; i++) {
        var seg = parts[i];
        if (!seg) continue;
        var eq = seg.indexOf('@=');
        if (eq < 0) continue;
        var k = seg.slice(0, eq);
        var val = seg.slice(eq + 2);
        if (k === 'type') type = val;
        else kv[k] = val;
      }
      if (type === 'loginres') {
        if (loginResolve) { loginResolve(true); loginResolve = null; } // 匿名负 userid 也成功
        return;
      }
      if (type === 'chatmsg' && kv.txt) {
        var uid = kv.uid !== undefined ? kv.uid : null;
        self.onDanmu(String(kv.txt), { id: String(uid) + ':' + String(kv.txt).length, uid: uid, nick: String(kv.nn || '?'), ts: now });
      }
    }
  
  setTimeout(boot, 1500);
})();

// ===== Hybrid 注入结束 =====

    setTimeout(init, 3000);
})();
