// ==UserScript==
// @name         烂梗机
// @namespace    http://tampermonkey.net/
// @version      1.1.16
// @description  多平台自动复读弹幕 | 智能去重 | 候选实时刷新(限50) | 模块化重构
// @match        https://www.douyu.com/*
// @match        https://www.huya.com/*
// @match        https://live.bilibili.com/*
// @match        https://live.douyin.com/*
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-end
// ==/UserScript==
// 版本历史：
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

(function () {
    'use strict';

    // ============================================================
    // 防重复加载（跨沙箱可靠版）
    // 问题：Tampermonkey 沙箱模式下 window/document 与页面隔离，
    //       window.dyBotScriptLoaded 防重标记可能失效 → 脚本重复执行
    //       （实测主文档 + 同源 iframe 各注入多次 → 多实例并发发送）。
    // 修复：
    //   1) iframe 内直接退出（@noframes 兜底 + 代码级双保险）
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
    if (document.documentElement && document.documentElement.getAttribute('data-lgj-loaded')) return;
    try { document.documentElement.setAttribute('data-lgj-loaded', '1'); } catch (_) { /* 忽略 */ }
    // 兼容旧标记（部分环境沙箱 window 可写回页面）
    if (window.dyBotScriptLoaded) return;
    try { window.dyBotScriptLoaded = true; } catch (_) { /* 忽略 */ }

    // =========================================================================
    // 模块 1：常量与平台检测
    // =========================================================================
    const SCRIPT_VERSION = '1.1.16';

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
        MAX_HISTORY_SIZE_FALLBACK: 100,
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
        _debug: true,

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
                this._logs.push({ level, content, time: new Date().toLocaleTimeString() });
                if (this._logs.length > this._maxLogs) this._logs.shift();
            } catch (_) { /* 忽略 */ }
        },

        getAll() { return [...this._logs]; },
        getErrors() { return this._logs.filter(l => l.level === 'error'); },
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
        return String(str).replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m] || m));
    }

    function truncate(text, maxLen) {
        return text.length > maxLen ? text.slice(0, maxLen) + '...' : text;
    }

    /** 规范化文本：去数字、标点、符号（用于智能去重合并） */
    function normalizeText(text) {
        return text.replace(/[\d\p{P}\p{S}]/gu, '').trim();
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
        return results;
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
                danmuItem: this.selectors.danmuItem[0] || '',
                danmuText: this.selectors.danmuText[0] || '',
                chatInput: this.selectors.chatInput[0] || '',
                sendButton: this.selectors.sendButton[0] || '',
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
            const result = this.probe.probeOne(BASE_SELECTORS[this.platform].danmuContainer);
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

        getDanmuItemSelector() { return this.selectors.danmuItem; }
    }

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

            this._ensureCacheFresh();
            let input = this.cachedInput;
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
            let remaining = this._getInputValue(input).trim();
            for (let i = 0; remaining !== '' && i < 3; i++) {
                await sleep(250);
                remaining = this._getInputValue(input).trim();
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
            this._pressEnter(input);
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
            this._pressEnter(input);
            return { success: true };
        }

        async _sendBilibili(input) {
            await sleep(50);
            this._pressEnter(input);
            return { success: true };
        }

        async _sendGeneric(input, btn) {
            await sleep(100);
            btn = this._ensureButton(btn);
            if (!btn) return { success: false, errorCode: 'BUTTON_NOT_FOUND', message: '通用发送按钮未找到' };

            this._enableButton(btn);
            this._clickElement(btn);
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

        _pressEnter(input) {
            const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true };
            input.dispatchEvent(new KeyboardEvent('keydown', opts));
            input.dispatchEvent(new KeyboardEvent('keyup', opts));
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
            isSending: false,
            // 屏蔽 / 优先词
            blocklist: [],
            priorityWords: [],
            // 弹幕监听
            danmuObserver: null,
            containerElement: null,
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

    function cachedRegex(pattern) {
        if (regexCache.has(pattern)) return regexCache.get(pattern);
        try {
            const re = new RegExp(pattern, 'i');
            regexCache.set(pattern, re);
            return re;
        } catch (_) {
            regexCache.set(pattern, null);
            return null;
        }
    }

    function clearRegexCache() { regexCache.clear(); }

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
                const re = cachedRegex(rule.value);
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
    function startDanmuObserver(container) {
        // 断开旧监听
        if (state.danmuObserver) {
            try { state.danmuObserver.disconnect(); } catch (_) { /* 忽略 */ }
        }

        // 重置统计与缓存（新直播间重新统计）
        state.timestamps = [];
        state.lastTsCleanup = 0;
        state.freqMap.clear();
        state.weightedMap.clear();
        state.danmuDirty = true;

        /**
         * 处理单个新增节点，返回是否捕获到弹幕。
         * 修复：1) 节点自身是弹幕条目 → 计 1 次；
         *      2) 节点是批量容器（内含多条弹幕）→ 每条子弹幕项各计 1 次，
         *         不再只计第一条（DPM 低估 bug）。
         */
        const handleNode = (node) => {
            if (node.nodeType !== Node.ELEMENT_NODE) return false;

            const itemSelector = parser.getDanmuItemSelector();
            const selectors = itemSelector ? itemSelector.split(',').map(s => s.trim()).filter(Boolean) : [];

            // 1) 节点自身即弹幕条目（如斗鱼 li.Barrage-listItem）→ 按单条弹幕处理
            const isDanmuItem = selectors.some(sel => {
                try { return node.matches && node.matches(sel); } catch (_) { return false; }
            });
            if (isDanmuItem) {
                const text = parser.extractText(node);
                if (text) {
                    Logger.debug('捕获', `"${text}"`);
                    addDanmuToCache(text);
                    recordMessageTimestamp();
                    return true;
                }
                return false;
            }

            // 2) 批量容器节点 → 遍历所有子弹幕项，每条都计数
            if (selectors.length) {
                const items = queryAll(selectors, node);
                let captured = false;
                for (const item of items) {
                    const subText = parser.extractText(item);
                    if (subText) {
                        Logger.debug('捕获(子)', `"${subText}"`);
                        addDanmuToCache(subText);
                        recordMessageTimestamp();
                        captured = true;
                    }
                }
                return captured;
            }

            // 3) 无弹幕条目选择器时的兜底：按节点文本处理
            const text = parser.extractText(node);
            if (text) {
                Logger.debug('捕获', `"${text}"`);
                addDanmuToCache(text);
                recordMessageTimestamp();
                return true;
            }
            return false;
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

        // 按权重随机
        let total = 0;
        for (const c of candidates) total += c.weight;
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

        state.isSending = true;
        try {
            const result = await sender.send(msg);
            if (result.success) {
                updateSentHistory(msg);
                state.pendingMsg = null;
                state.retryCount = 0;
                state.lastRetryTime = 0;
                Logger.send(`发送成功: ${msg}`);
                return { success: true };
            } else {
                state.pendingMsg = msg;
                state.lastRetryTime = Date.now();
                Logger.warn('烂梗机', `发送失败: ${result.message} (${result.errorCode})`);
                return result;
            }
        } catch (e) {
            logError('sendMessage', e);
            state.pendingMsg = msg;
            state.lastRetryTime = Date.now();
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

        // 有待重试消息：检查是否到达重试时间
        if (state.pendingMsg) {
            const now = Date.now();
            const due = now - state.lastRetryTime >= TIMING.RETRY_DELAY_MS;

            if (state.retryCount < TIMING.RETRY_MAX_ATTEMPTS && due) {
                state.retryCount++;
                state.lastRetryTime = now;
                await sendMessage(state.pendingMsg);
            } else if (state.retryCount >= TIMING.RETRY_MAX_ATTEMPTS) {
                Logger.warn('烂梗机', `超过最大重试次数，丢弃: ${state.pendingMsg}`);
                state.pendingMsg = null;
                state.retryCount = 0;
                state.lastRetryTime = 0;
            }
            return;
        }

        // 正常流程：选择并发送
        const candidates = getWeightedCandidates();
        if (!candidates.length) return;

        const selected = weightedRandomSelect(candidates);
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
        state.isSending = false;

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
        if (state.danmuObserver) return; // 已在监听中

        const container = parser.findContainer();
        // 修复：findContainer 现在找不到时返回 null —— 容器未就绪时不启动监听，
        //      由 startContainerPolling 继续轮询接管（避免对 null 启动 observer）
        if (!container) {
            Logger.debug('烂梗机', '容器未就绪，等待轮询接管');
            return;
        }
        state.containerElement = container;
        startDanmuObserver(container);
        Logger.info('烂梗机', '弹幕监听已重新启动');
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
            return { type, value: raw };
        }
        return null;
    }

    function formatFilterRulesForDisplay(rules) {
        return rules.map(r => {
            if (r.type === 'length') return `length${r.op}${r.value}`;
            if (r.type === 'contains') return `contains:${r.value}`;
            if (r.type === 'not_contains') return `not_contains:${r.value}`;
            if (r.type === 'regex') return `regex:${r.value}`;
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
        const matches = String(raw).match(/\/[^/]+\/|[^/,]+/g) || [];
        return matches.map(s => s.trim()).filter(Boolean);
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
    function injectStyles() {
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
#bot-panel.bot-panel-fshidden { display: none !important; }
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
                    // 修复：打开开关时确保 observer 已启动
                    //（stopBot 断开后重启需重新监听弹幕）
                    ensureObserverRunning();
                    switchMode();
                } else {
                    stopBot();
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
                panel.style.left = rect.left + 'px';
                panel.style.top = rect.top + 'px';
                panel.style.right = 'auto';
                panel.style.bottom = 'auto';
                GM_setValue(STORAGE_KEYS.PANEL_POS, { left: rect.left + 'px', top: rect.top + 'px' });
            } else {
                // 未拖动 = 点击 header，折叠/展开
                panel.classList.toggle('bot-panel-collapsed');
            }
        };

        header.addEventListener('pointerdown', onPointerDown);
        header.addEventListener('pointermove', onPointerMove);
        header.addEventListener('pointerup', finishDrag);
        header.addEventListener('pointercancel', finishDrag);
    }

    function loadPanelPosition() {
        try {
            const panel = $('bot-panel');
            if (!panel) return;
            const pos = GM_getValue(STORAGE_KEYS.PANEL_POS, null);
            if (pos && pos.left && pos.top) {
                panel.style.transform = '';   // 清除可能残留的拖动偏移
                panel.style.left = pos.left;
                panel.style.top = pos.top;
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

            const hasError = Logger.getErrors().length > 0;
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
        if (state.countdownTimer) {
            clearInterval(state.countdownTimer);
            state.countdownTimer = null;
        }

        const cdEl = $('bot-status-countdown');
        if (!cdEl) return;

        if (state.isRunning && state.nextSendTimestamp > 0) {
            const tick = () => {
                const remaining = state.nextSendTimestamp - Date.now();
                cdEl.textContent = remaining <= 0 ? '发送中' : (remaining / 1000).toFixed(1) + 's';
            };
            tick();
            state.countdownTimer = setInterval(tick, 100);
        } else {
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
        a.click();
        URL.revokeObjectURL(a.href);
    }

    // =========================================================================
    // 模块 24：UI - 设置页 HTML 构建
    // =========================================================================
    function buildSettingsHTML() {
        const cfg = state.config;
        const theme = cfg.theme || DEFAULT_THEME;
        const blocklist = state.blocklist.join(' / ');
        const priority = state.priorityWords.join(' / ');
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
  ${buildInputRow('s-zenInterval', '佛系间隔(秒)', cfg.zenInterval, 1)}
`)}

${buildSection('🚫 屏蔽词 & 高级筛选', `
  ${buildTextareaRow('s-blocklist', '屏蔽词', blocklist, 2)}
  <div style="font-size:calc(var(--bot-font-size,12px) - 2px);color:#666;margin-top:2px;">用斜杠 / 分隔，支持正则 /广告/</div>
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
  <div style="font-size:calc(var(--bot-font-size,12px) - 2px);color:#666;margin-top:2px;">用斜杠 / 分隔，支持正则</div>
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
        const stepAttr = step ? `step="${step}"` : '';
        return `
<div class="row" style="display:flex;align-items:center;margin-bottom:4px;gap:6px;flex-wrap:wrap;">
  <label style="width:80px;font-size:var(--bot-font-size,12px);color:var(--bot-text,#aaa);flex-shrink:0;">${label}</label>
  <input type="number" id="${id}" value="${value}" ${min ? `min="${min}"` : ''} ${max ? `max="${max}"` : ''} ${stepAttr}
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
    <input type="text" id="s-fontSize" value="${theme.fontSize}" style="background:var(--bot-border,rgba(255,255,255,0.06));border:1px solid var(--bot-border,rgba(255,255,255,0.12));color:var(--bot-text,#eee);border-radius:4px;padding:3px 5px;font-size:var(--bot-font-size,12px);flex:1;min-width:50px;">
  </div>
  <div class="row" style="display:flex;align-items:center;margin-bottom:4px;gap:6px;flex-wrap:wrap;">
    <label style="width:80px;font-size:var(--bot-font-size,12px);color:var(--bot-text,#aaa);flex-shrink:0;">圆角</label>
    <input type="text" id="s-borderRadius" value="${theme.borderRadius}" style="background:var(--bot-border,rgba(255,255,255,0.06));border:1px solid var(--bot-border,rgba(255,255,255,0.12));color:var(--bot-text,#eee);border-radius:4px;padding:3px 5px;font-size:var(--bot-font-size,12px);flex:1;min-width:50px;">
  </div>
`);
    }

    function buildColorRow(id, label, value) {
        return `
<div class="row" style="display:flex;align-items:center;margin-bottom:4px;gap:6px;flex-wrap:wrap;">
  <label style="width:80px;font-size:var(--bot-font-size,12px);color:var(--bot-text,#aaa);flex-shrink:0;">${label}</label>
  <input type="color" id="${id}" value="${value}" style="background:#fff;border:2px solid var(--bot-accent,#ff9800);border-radius:4px;padding:2px;width:40px;height:40px;cursor:pointer;">
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
        const getNum = (id) => parseFloat(getVal(id)) || 0;
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
            zenInterval: 's-zenInterval',
            priorityWeight: 's-priorityWeight',
        };
        for (const [key, id] of Object.entries(numConfig)) {
            saveConfigValue(key, getNum(id));
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
        const theme = {
            bgColor: getVal('s-bgColor'),
            textColor: getVal('s-textColor'),
            accentColor: getVal('s-accentColor'),
            borderColor: getVal('s-borderColor'),
            opacity: getNum('s-opacity'),
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

    function init() {
        Logger.info('烂梗机', `初始化 v${SCRIPT_VERSION} | 平台: ${PLATFORM}`);

        createMainPanel();
        loadConfig();
        loadPanelPosition();

        probe.probeAll();
        parser.refreshSelectors();

        startContainerPolling();
        startPeriodicTasks();
        startFullscreenDetection();
        startVisibilityHandler();
    }

    /** 轮询查找弹幕容器（按设计：找到后不再重连） */
    function startContainerPolling() {
        let poll = 0;
        const tryFind = setInterval(() => {
            poll++;
            try {
                const container = parser.findContainer();
                if (container) {
                    clearInterval(tryFind);
                    state.containerElement = container;
                    // 修复：若用户已提前打开开关（ensureObserverRunning 已启动监听），
                    // 不可重复 startDanmuObserver——它会 freqMap.clear() 清空已采集数据，
                    // 且产生双 observer 导致每条弹幕重复计数（count 翻倍、权重虚高）
                    if (!state.danmuObserver) {
                        startDanmuObserver(container);
                        scheduleWeightUpdate();
                    } else {
                        Logger.debug('烂梗机', 'observer 已运行，跳过容器轮询启动');
                    }
                    return;
                }
                if (poll >= TIMING.CONTAINER_POLL_MAX) {
                    clearInterval(tryFind);
                    Logger.warn('烂梗机', '弹幕容器查找超时，监听整个文档');
                    state.containerElement = document.body;
                    if (!state.danmuObserver) {
                        startDanmuObserver(document.body);
                    }
                }
                // 1.1.16：B 站 blanc 模式兜底——blanc iframe 晚于主文档插入时，
                // 主文档实例主动停轮询让位（不降级 body），由 blanc iframe 实例接管采集
                if (PLATFORM === 'bilibili' && !state.danmuObserver
                    && document.querySelector('iframe[src*="/blanc/"]')) {
                    clearInterval(tryFind);
                    Logger.debug('烂梗机', '检测到 blanc iframe，主文档让位给 iframe 实例');
                }
            } catch (e) {
                logError('容器查找', e);
            }
        }, TIMING.CONTAINER_POLL_INTERVAL);
    }

    /** 启动周期性任务 */
    function startPeriodicTasks() {
        // 候选强制刷新（10s）——只负责权重重算，不重复刷 UI
        setInterval(() => {
            if (!state.isRunning) return;
            state.danmuDirty = true;
            updateWeights();
        }, TIMING.CANDIDATE_REFRESH_INTERVAL);

        // UI 更新与配置同步（2s）
        setInterval(() => {
            checkConfigUpdate();
            if (state.isRunning) switchMode();
            const candidates = getWeightedCandidates();
            state.nextPreviewMsg = candidates[0]?.text || '';
            updateUIDisplay(getMessagesPerMinute());
        }, TIMING.UI_UPDATE_INTERVAL);

        // 发送器缓存刷新（30s）
        setInterval(() => {
            try { sender.refreshCache(); } catch (_) { /* 忽略 */ }
        }, 30000);
    }

    /** 全屏时隐藏面板 */
    function startFullscreenDetection() {
        const updateFullscreen = () => {
            try {
                const panel = $('bot-panel');
                if (!panel) return;
                const isFullscreen = !!document.fullscreenElement
                    || document.body.classList.contains('player-fullscreen')
                    || !!document.querySelector('.layout-Player-barrageStage.fullscreen');
                panel.classList.toggle('bot-panel-fshidden', isFullscreen);
            } catch (_) { /* 忽略 */ }
        };
        document.addEventListener('fullscreenchange', updateFullscreen);
        setInterval(updateFullscreen, 1500);
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
    setTimeout(init, 3000);
})();
