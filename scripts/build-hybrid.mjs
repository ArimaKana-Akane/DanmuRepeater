// 1.2.0 Hybrid 构建：legacy(1.1.20 行为) + 共享纯逻辑核心 + 引擎注入块 + 元数据
// 注入锚点：'    setTimeout(init, 3000);' 之前（legacy IIFE 尾部）
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { spawnSync, execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const LEGACY = join(ROOT, 'legacy', '烂梗机-1.1.20.user.js');
const MD5_SRC = join(HERE, 'hybrid', 'md5.js');
const CORE_SRC = join(HERE, 'hybrid', 'hybrid-core.mjs');
const INJECT_SRC = join(HERE, 'hybrid', 'inject-block.js');
const VERSION = readVersion();
const ANCHOR = '    setTimeout(init, 3000);';
const OUT_DIR = join(ROOT, 'dist');
const OUT_MAIN = join(OUT_DIR, `烂梗机-${VERSION}.user.js`);

/** 版本号唯一来源：package.json（不再硬编码，release 只需 bump 版本） */
function readVersion() {
  try { return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version || '1.2.0'; }
  catch { return '1.2.0'; }
}

/**
 * 自动识别 GitHub owner/repo，**无需 meta.json**：
 *   1) CI：GITHUB_REPOSITORY
 *   2) 本地：git remote get-url origin
 *   3) package.json repository 字段
 * 识别不到才退回 meta.json；都没有则省略 @updateURL（并 WARN）。
 */
function detectRepo() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY.trim();
  const fromUrl = (url) => {
    if (!url) return '';
    const m = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(String(url).trim());
    return m ? `${m[1]}/${m[2]}` : '';
  };
  try {
    const url = execSync('git remote get-url origin', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const repo = fromUrl(url);
    if (repo) return repo;
  } catch { /* 非 git 仓库 */ }
  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    const url = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository && pkg.repository.url;
    const repo = fromUrl(url);
    if (repo) return repo;
  } catch { /* 忽略 */ }
  return '';
}

function loadMeta() {
  let m = {};
  try { m = JSON.parse(readFileSync(join(HERE, 'meta.json'), 'utf8')); } catch { m = {}; }
  const repo = detectRepo() || (m.owner && m.repo ? `${m.owner}/${m.repo}` : '');
  if (repo) {
    const [owner, name] = repo.split('/');
    m.owner = owner;
    m.repo = name;
    m.homepage = `https://github.com/${owner}/${name}`;
    m.updateURL = `https://github.com/${owner}/${name}/releases/latest/download/latest.user.js`;
    m.downloadURL = m.updateURL;
  } else {
    m.homepage = m.updateURL = m.downloadURL = '';
  }
  return m;
}

/** 把 ESM 纯逻辑核心转成可内联进用户脚本的普通声明（去 export，禁止残留 import） */
function inlineCore(src) {
  if (/^\s*import\s/m.test(src)) {
    console.error('FAIL: hybrid-core.mjs 不允许 import（内联后会失去依赖）');
    process.exit(1);
  }
  const out = src.replace(/^export\s+/gm, '');
  if (/^\s*export\s/m.test(out)) {
    console.error('FAIL: hybrid-core.mjs 仍有未剥离的 export');
    process.exit(1);
  }
  return out.trimEnd();
}

function build() {
  const meta = loadMeta();
  let src = readFileSync(LEGACY, 'utf8');
  if (!src.includes(ANCHOR)) { console.error('FAIL: 找不到注入锚点 ' + JSON.stringify(ANCHOR)); process.exit(1); }

  // 1) md5 函数体（去 export）+ 共享核心（去 export）+ 注入块
  const md5Body = readFileSync(MD5_SRC, 'utf8').replace('export function md5', 'function md5').trimEnd();
  const coreBody = inlineCore(readFileSync(CORE_SRC, 'utf8'));
  let inject = readFileSync(INJECT_SRC, 'utf8');
  if (!inject.includes('//__MD5_BODY__')) { console.error('FAIL: 注入块缺 MD5 占位'); process.exit(1); }
  if (!inject.includes('//__HYBRID_CORE__')) { console.error('FAIL: 注入块缺 CORE 占位'); process.exit(1); }
  inject = inject.replace('  //__MD5_BODY__\n',
    '\n' + md5Body.split('\n').map((l) => '  ' + l).join('\n') + '\n');
  inject = inject.replace('  //__HYBRID_CORE__\n',
    '\n' + coreBody.split('\n').map((l) => '  ' + l).join('\n') + '\n');

  // 2) 版本替换
  let diff = [];
  src = src.split('\n').map((line) => {
    if (/^\/\/ @version\s+/.test(line)) {
      const v = line.replace(/1\.1\.\d+/, VERSION); diff.push('@version'); return v;
    }
    if (/INSTALLED_VERSION\s*=\s*'1\.1\.\d+'/.test(line)) {
      const v = line.replace(/1\.1\.\d+/, VERSION); diff.push('INSTALLED_VERSION'); return v;
    }
    if (line.startsWith('// 版本历史：')) {
      return line + '\n// ' + VERSION + ' hybrid（DOM+协议双引擎互斥切换）：修复双源叠加/房间号/安全阀持久化/断线重连/开关联动；详见 v2/SPEC.md';
    }
    return line;
  }).join('\n');

  // 2.5) legacy 行为补丁（精确文本，断言命中次数，命中数不符即构建失败）
  const REPS = [
    {
      in: "        if (!state.isRunning) return { success: false, errorCode: 'STOPPED', message: '机器人已停止' };\n\n        state.isSending = true;",
      out: "        if (!state.isRunning) return { success: false, errorCode: 'STOPPED', message: '机器人已停止' };\n\n"
        + "        // 1.2.0 L3 安全阀（fail-closed）：仅在确实要发送时判定；\n"
        + "        // 未就绪/未确认/被拦截一律拒发，且返回 SAFETY_* 错误码\n"
        + "        if (!window.__lgjSafety || !window.__lgjSafety.allow(msg)) {\n"
        + "            var __svReason = window.__lgjSafety ? window.__lgjSafety.reasonText() : '安全阀未就绪';\n"
        + "            var __svCode = window.__lgjSafety ? window.__lgjSafety.reason() : 'NOT_READY';\n"
        + "            try { console.warn('[烂梗机-安全阀] ', __svReason); if (window.__lgjLog) window.__lgjLog('安全阀', __svReason + ' | ' + __svCode); } catch (__w) { /* 忽略 */ }\n"
        + "            return { success: false, errorCode: 'SAFETY_' + __svCode, message: '安全阀拦截: ' + __svReason };\n"
        + "        }\n"
        + "        state.isSending = true;",
      expect: 1, tag: 'sendMessage-gate-fail-closed',
    },
    {
      in: '            if (result.success) {\n                updateSentHistory(msg);',
      out: '            if (result.success && window.__lgjSafety) { try { window.__lgjSafety.note(msg); } catch (__e) { /* 忽略 */ } }\n            if (result.success) {\n                updateSentHistory(msg);',
      expect: 1, tag: 'sendMessage-note',
    },
    {
      in: "            const retryable = state.lastErrorCode && state.lastErrorCode !== 'SEND_FAILED';",
      out: "            const retryable = state.lastErrorCode && state.lastErrorCode !== 'SEND_FAILED'\n                && state.lastErrorCode !== 'SAFETY_RANDOM_SKIP';",
      expect: 1, tag: 'random-skip-not-retryable',
    },
    {
      in: '    function ensureObserverRunning() {\n        if (state.standDown) return;      // 已让位：不再恢复监听\n        if (state.danmuObserver) return; // 已在监听中',
      out: '    function ensureObserverRunning() {\n        if (state.standDown) return;      // 已让位：不再恢复监听\n'
        + '        // 1.2.0：协议源接管时不得再启动 DOM observer（避免双源叠加）\n'
        + "        if (window.__lgjSourceKind === 'protocol') return;\n"
        + '        if (state.danmuObserver) return; // 已在监听中',
      expect: 1, tag: 'ensure-observer-protocol-guard',
    },
    {
      in: "                state.isRunning = e.target.checked;\n                if (state.isRunning) {\n                    // 修复：打开开关时确保 observer 已启动\n                    //（stopBot 断开后重启需重新监听弹幕）\n                    ensureObserverRunning();\n                    switchMode();\n                } else {\n                    stopBot();\n                }",
      out: "                state.isRunning = e.target.checked;\n                if (state.isRunning) {\n"
        + "                    // 1.2.0：引擎先决定数据源（协议/探测会同步暂停 DOM，避免双源叠加）\n"
        + "                    if (window.__lgjEngineOnStart) { try { window.__lgjEngineOnStart(); } catch (__e) { /* 忽略 */ } }\n"
        + "                    // 修复：打开开关时确保 observer 已启动\n"
        + "                    //（stopBot 断开后重启需重新监听弹幕）\n"
        + "                    ensureObserverRunning();\n                    switchMode();\n                } else {\n                    stopBot();\n"
        + "                    if (window.__lgjEngineOnStop) { try { window.__lgjEngineOnStop(); } catch (__e2) { /* 忽略 */ } }\n                }",
      expect: 1, tag: 'toggle-engine-hooks',
    },
    {
      in: "    function parseDelimitedList(raw) {\n        const matches = String(raw).match(/\\/[^/]+\\/|[^/,]+/g) || [];\n        return matches.map(s => s.trim()).filter(Boolean);\n    }",
      out: "    function parseDelimitedList(raw) {\n"
        + "        // 1.2.0 修复：只按换行分隔——彻底消除 / 与 , 既是分隔符又是正则内容时的歧义。\n"
        + "        // 每行一个词条；/xxx/（含逗号/斜杠）形式仍按正则整体处理。\n"
        + "        return String(raw).split(/\\n/).map(s => s.trim()).filter(Boolean);\n    }",
      expect: 1, tag: 'parse-delimited-list',
    },
    {
      in: "        const blocklist = state.blocklist.join(' / ');",
      out: "        const blocklist = state.blocklist.join('\\n');",
      expect: 1, tag: 'blocklist-join-newline',
    },
    {
      in: "        const priority = state.priorityWords.join(' / ');",
      out: "        const priority = state.priorityWords.join('\\n');",
      expect: 1, tag: 'priority-join-newline',
    },
    {
      in: '用斜杠 / 分隔，支持正则 /广告/',
      out: '每行一个；/xxx/ 为正则',
      expect: 1, tag: 'blocklist-hint',
    },
    {
      in: '用斜杠 / 分隔，支持正则',
      out: '每行一个；/xxx/ 为正则',
      expect: 1, tag: 'priority-hint',
    },
    {
      in: '// @description  多平台自动复读弹幕 | 智能去重 | 候选实时刷新(限50) | 模块化重构',
      out: '// @description  多平台自动复读弹幕 | DOM+协议双引擎 | 智能去重 | L3 安全阀',
      expect: 1, tag: 'description',
    },
    {
      in: '            checkConfigUpdate();',
      out: '            // 1.2.0: checkConfigUpdate 由 GM_addValueChangeListener 事件驱动（见 hybrid 注入）',
      expect: 1, tag: 'drop-secondly-config-poll',
    },
    {
      in: '    function yieldToBlancFrame(reason) {\n        if (state.standDown) return;\n        state.standDown = true;',
      out: '    function yieldToBlancFrame(reason) {\n        if (state.standDown) return;\n        state.standDown = true;\n'
        + '        // 1.2.0：让位时停协议/选举并释放 leader 租约，避免主文档占着 leader 让 iframe 实例待机\n'
        + '        if (window.__lgjEngineOnStandDown) { try { window.__lgjEngineOnStandDown(); } catch (__e) { /* 忽略 */ } }',
      expect: 1, tag: 'standdown-release-leader',
    },
    {
      in: '            const result = await sender.send(msg);',
      out: '            const result = await (window.__lgjSend ? window.__lgjSend(msg) : sender.send(msg));',
      expect: 1, tag: 'native-send-hook',
    },
    {
      in: '    async function runBot() {\n        if (!state.isRunning || state.isSending) return;',
      out: '    async function runBot() {\n        if (!state.isRunning || state.isSending) return;\n'
        + '        // L4：非 leader 标签页不发送（多标签唯一发送者）\n'
        + '        if (window.__lgjIsLeader && !window.__lgjIsLeader()) return;',
      expect: 1, tag: 'leader-send-guard',
    },
    {
      in: '        // 按权重随机\n        let total = 0;\n        for (const c of candidates) total += c.weight;',
      out: '        // 按权重随机（1.2.0：叠加协议结构化数据 boost，DOM 模式为 1）\n        let total = 0;\n'
        + '        for (const c of candidates) {\n'
        + '            if (window.__lgjMetaBoost) { try { c.weight *= window.__lgjMetaBoost(c.text); } catch (__e) { /* 忽略 */ } }\n'
        + '            total += c.weight;\n        }',
      expect: 1, tag: 'l2-meta-boost',
    },
    {
      in: "                    if (!state.danmuObserver) {\n                        startDanmuObserver(container);\n                        scheduleWeightUpdate();\n                    } else {\n                        Logger.debug('烂梗机', 'observer 已运行，跳过容器轮询启动');\n                    }",
      out: "                    if (window.__lgjSourceKind === 'protocol') {\n                        Logger.debug('烂梗机', '协议源接管，容器轮询不启动 DOM observer');\n                    } else if (!state.danmuObserver) {\n                        startDanmuObserver(container);\n                        scheduleWeightUpdate();\n                    } else {\n                        Logger.debug('烂梗机', 'observer 已运行，跳过容器轮询启动');\n                    }",
      expect: 1, tag: 'container-poll-protocol-guard',
    },
    {
      in: "                    if (!state.danmuObserver) {\n                        startDanmuObserver(document.body);\n                    }",
      out: "                    if (window.__lgjSourceKind === 'protocol') {\n                        Logger.debug('烂梗机', '协议源接管，body 降级不启动 DOM observer');\n                    } else if (!state.danmuObserver) {\n                        startDanmuObserver(document.body);\n                    }",
      expect: 1, tag: 'body-degrade-protocol-guard',
    },
    {
      in: "        // 重置统计与缓存（新直播间重新统计）\n        state.timestamps = [];\n        state.lastTsCleanup = 0;\n        state.freqMap.clear();\n        state.weightedMap.clear();\n        state.danmuDirty = true;",
      out: "        // 重置统计与缓存（新直播间重新统计；协议掉线回落 DOM 时保留，避免候选池清零）\n"
        + "        if (!window.__lgjKeepStats) {\n"
        + "            state.timestamps = [];\n            state.lastTsCleanup = 0;\n"
        + "            state.freqMap.clear();\n            state.weightedMap.clear();\n"
        + "            state.danmuDirty = true;\n        }",
      expect: 1, tag: 'keep-stats-on-dom-resume',
    },

    {
      in: "    function isSystemDanmaku(text) {\n        const t = String(text).trim();\n        if (!t) return false;\n        // 前缀型：欢迎语 / 系统消息 / 温馨提示 开头的弹幕（各平台通用特征）\n        if (/^(欢迎来到|系统消息|温馨提示|欢迎.{0,12}进入直播间)/.test(t)) return true;\n        // 修复（1.1.18）：第二条例加前缀锚定 + 短文本限定——旧实现 /(...|本直播间)/\n        //      全文匹配会把「本直播间怎么没声音」这类正常弹幕也过滤掉\n        if (t.length <= 40 && /^(温馨提示|系统公告|直播间提示|本直播间)/.test(t)) return true;\n        return false;\n    }",
      out: "    function isSystemDanmaku(text) {\n        // 1.2.0：优先用 hybrid-core 的增强启发式（系统/公告/礼物/进场/粉丝团/风控等）\n        if (typeof window.__lgjIsSystemDanmaku === 'function') {\n            try { return window.__lgjIsSystemDanmaku(text); } catch (_) { /* 忽略 */ }\n        }\n        const t = String(text).trim();\n        if (!t) return false;\n        if (/^(欢迎来到|系统消息|温馨提示|欢迎.{0,12}进入直播间)/.test(t)) return true;\n        if (t.length <= 40 && /^(温馨提示|系统公告|直播间提示|本直播间)/.test(t)) return true;\n        return false;\n    }",
      expect: 1, tag: 'legacy-system-danmaku-delegate',
    },
    {
      in: "                if (isSystemDanmaku(text)) {",
      out: "                if (isSystemDanmaku(text) || (window.__lgjIsSystemNode && window.__lgjIsSystemNode(el))) {",
      expect: 1, tag: 'dom-system-node-filter',
    },
    {
      in: "                Logger.send(`发送成功: ${msg}`);",
      out: "                Logger.send(`发送成功: ${msg}${window.__lgjSendCtx ? ' | ' + window.__lgjSendCtx() : ''}`);",
      expect: 1, tag: 'send-log-context',
    },
    {
      in: "        const selected = weightedRandomSelect(candidates);",
      out: "        const selected = weightedRandomSelect(candidates);\n        if (window.__lgjOnSelect) { try { window.__lgjOnSelect(selected, candidates); } catch (__e) { /* 忽略 */ } }",
      expect: 1, tag: 'select-log-hook',
    },
    {
      in: "        panel.innerHTML = buildSettingsHTML();\n        overlay.appendChild(panel);",
      out: "        panel.innerHTML = buildSettingsHTML();\n        if (window.__lgjEnhanceSettings) { try { window.__lgjEnhanceSettings(panel); } catch (_) { /* 忽略 */ } }\n        overlay.appendChild(panel);",
      expect: 1, tag: 'settings-enhance-hook',
    },
    {
      in: "                    Logger.debug('过滤', `系统弹幕: \"${text.slice(0, 40)}\"`);",
      out: "                    if (window.__lgjCountSystemFiltered) { try { window.__lgjCountSystemFiltered(text); } catch (_) { /* 忽略 */ } }\n                    Logger.debug('过滤', `系统弹幕: \"${text.slice(0, 40)}\"`);",
      expect: 1, tag: 'dom-system-filter-count',
    },
    {
      in: '// @grant        GM_getValue',
      out: '// @grant        GM_getValue\n// @grant        GM_addValueChangeListener\n// @grant        GM_setClipboard\n'
        + '// @grant        GM_xmlhttpRequest\n'
        + '// @connect      api.bilibili.com\n// @connect      api.live.bilibili.com\n// @connect      live.bilibili.com',
      expect: 1, tag: 'banner-grants-connect',
    },
  ];
  for (const r of REPS) {
    const cnt = src.split(r.in).length - 1;
    if (cnt !== r.expect) { console.error(`FAIL 替换未命中 ${r.tag}: 期望 ${r.expect} 实际 ${cnt}`); process.exit(1); }
    src = src.split(r.in).join(r.out);
    console.log(`     [rep] ${r.tag} ✔`);
  }

  // 3) 注入 hybrid 块（锚点前），元数据补齐
  const injection = '\n// ===== 1.2.0 Hybrid 注入（自动生成，勿手改）=====\n' + inject + '\n// ===== Hybrid 注入结束 =====\n';
  if (src.indexOf(ANCHOR) < 0) { console.error('FAIL: 版本替换后锚点丢失'); process.exit(1); }
  src = src.replace(ANCHOR, injection + '\n' + ANCHOR);
  src = src.replace('// ==/UserScript==', (meta.homepage ? `// @homepageURL   ${meta.homepage}\n` : '')
    + (meta.updateURL ? `// @updateURL     ${meta.updateURL}\n` : '')
    + (meta.downloadURL ? `// @downloadURL   ${meta.downloadURL}\n` : '')
    + `// @author        ${meta.author || 'LaGenJi contributors'}\n`
    + `// @license       ${meta.license || 'MIT'}\n// ==/UserScript==`);

  // 4) 语法校验
  const tmp = join(OUT_DIR, '_hybrid_check.js');
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(tmp, src, 'utf8');
  const chk = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
  rmSync(tmp);
  if (chk.status !== 0) { console.error('FAIL 语法: ' + (chk.stderr || '').slice(0, 500)); process.exit(1); }

  writeFileSync(OUT_MAIN, src, 'utf8');
  copyFileSync(OUT_MAIN, join(OUT_DIR, 'latest.user.js'));
  console.log(`OK  产物: ${OUT_MAIN}`);
  console.log(`     字节: ${Buffer.byteLength(src)}（legacy ~136K + hybrid ~${Math.round(Buffer.byteLength(injection) / 1024)}K）`);
  console.log(`     语法: node --check 通过`);
  console.log(`     版本变更: ${diff.join(', ')}`);
  if (!meta.owner || !meta.repo) console.warn('WARN meta.json 未填 owner/repo：自动更新 URL 未注入。');
}

build();
