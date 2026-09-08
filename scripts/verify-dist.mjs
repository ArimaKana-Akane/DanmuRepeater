// 构建产物守卫：确认 P0/P1 修复真的进了发布脚本（防止「测 A 发 B」回归）
// 在 `npm run build` 末尾运行；任何一项缺失即构建失败。
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const VERSION = (() => {
  try { return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version || '1.2.0'; }
  catch { return '1.2.0'; }
})();
const DIST = join(ROOT, 'dist', `烂梗机-${VERSION}.user.js`);

const MUST = [
  ['版本号', new RegExp(`@version\\s+${VERSION.replace(/\./g, '\\.')}`)],
  ['协议源互斥守卫', /window\.__lgjSourceKind === 'protocol'/],
  ['安全阀 fail-closed', /!window\.__lgjSafety \|\| !window\.__lgjSafety\.allow/],
  ['随机跳过不可重试', /SAFETY_RANDOM_SKIP/],
  ['房间号解析（blanc/h5）', /function parseBiliRoomId/],
  ['系统弹幕增强识别', /SYSTEM_DANMAKU_PATTERNS/],
  ['legacy 系统弹幕委托', /__lgjIsSystemDanmaku/],
  ['DOM 系统节点过滤', /__lgjIsSystemNode/],
  ['安全阀核心内联', /class HybridSafety/],
  ['开关联动钩子', /__lgjEngineOnStart/],
  ['协议 auth 后才暂停 DOM', /function domPause/],
  ['协议 auth 门控', /authOk/],
  ['协议掉线立即回 DOM', /function domResume/],
  ['协议单一生命周期', /function tick\(\)/],
  ['真实房号 getInfoByRoom', /getInfoByRoom/],
  ['断线回落处理', /function onProtocolDrop/],
  ['持久化日志读回', /function restoreRingLog/],
  ['屏蔽词分隔符修复', /split\(\/\\n\/\)/],
  ['协议发送返回码归一', /function mapBiliSendCode/],
  ['原生发送挂点', /__lgjSend/],
  ['设置页发送开关', /s-sendProtocol/],
  ['设置页引擎开关', /s-engineDirect/],
  ['一级引擎快捷开关', /lgj-engine-quick/],
  ['设置页增强挂点', /__lgjEnhanceSettings/],
  ['日志事件', /function logEvent/],
  ['日志筛选', /data-log-filter/],
  ['日志渲染覆盖', /renderLogsNow/],
  ['系统过滤计数', /__lgjCountSystemFiltered/],
  ['采集摘要', /logPeriodicSummary/],
  ['设置页配置管理', /settings-export-btn/],
  ['发送日志上下文', /__lgjSendCtx/],
  ['选择日志钩子', /__lgjOnSelect/],
  ['L2 结构化 boost', /__lgjMetaBoost/],
  ['L4 leader 选举', /class LeaderElection/],
  ['leader 发送守卫', /__lgjIsLeader/],
  ['让位释放 leader 租约', /__lgjEngineOnStandDown/],
  ['容器轮询协议守卫', /容器轮询不启动 DOM observer/],
  ['body 降级协议守卫', /body 降级不启动 DOM observer/],
  ['协议回落保留统计', /__lgjKeepStats/],
  ['GM_xmlhttpRequest 授权', /@grant\s+GM_xmlhttpRequest/],
  ['@connect bilibili', /@connect\s+api\.bilibili\.com/],
];

let src;
try {
  src = readFileSync(DIST, 'utf8');
} catch (e) {
  console.error('FAIL 找不到产物: ' + DIST);
  process.exit(1);
}

let bad = 0;
// CI 里 GITHUB_REPOSITORY 必定存在 → 必须能自动注入更新 URL（不再依赖 meta.json）
if (process.env.GITHUB_REPOSITORY) {
  if (!/@updateURL\s+https:\/\/github\.com\//.test(src)) { console.error('FAIL 产物缺少 @updateURL（CI 应自动注入）'); bad++; }
  if (!/@downloadURL\s+https:\/\/github\.com\//.test(src)) { console.error('FAIL 产物缺少 @downloadURL（CI 应自动注入）'); bad++; }
}

for (const [name, re] of MUST) {
  if (!re.test(src)) {
    console.error(`FAIL 产物缺少：${name}（${re}）`);
    bad++;
  }
}
if (bad) process.exit(1);
console.log(`OK 产物守卫通过（${MUST.length} 项 P0/P1 修复标记均存在）`);
