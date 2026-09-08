// 更新 README 至 1.2.0（Badge/安装/结构/版本历史）—— 精确替换，miss 即中止
const fs = require('fs');
const P = 'C:/Users/Magan/DanmuRepeater/README.md';
let r = fs.readFileSync(P, 'utf8');
let failed = null;

function rep(a, b, expect = 1) {
  const n = r.split(a).length - 1;
  if (n !== expect) { failed = `替换未命中(${expect}/${n}): ${String(a).slice(0, 50)}`; return; }
  r = r.split(a).join(b);
  console.log('rep ok');
}

rep('![Version](https://img.shields.io/badge/version-1.1.20-orange.svg)',
  '![Version](https://img.shields.io/badge/version-1.2.0-orange.svg)');

rep('2. 打开 [烂梗机-1.1.20.user.js](./烂梗机-1.1.20.user.js) 原始文件页（Raw 模式）',
  '2. 打开 [latest.user.js](./dist/latest.user.js)（即 dist/烂梗机-1.2.0.user.js）的原始文件页（Raw 模式），Tampermonkey 会检测到版本更新');

const treeRe = /```\n\.\n[\s\S]*?\n```/;
if (!treeRe.test(r)) { failed = 'tree block not found'; }
else {
  const tree = [
    '```', '.',
    '├── dist/',
    '│   ├── 烂梗机-1.2.0.user.js  # 发布产物（1.1.20 基线 + Hybrid 注入，可直接安装）',
    '│   └── latest.user.js        # 最新版别名（自动更新 / CI 产物指向此）',
    '├── legacy/',
    '│   └── 烂梗机-1.1.20.user.js # 行为冻结基线（升级前请删除旧版脚本防双实例）',
    '├── packages/                 # Monorepo：core(引擎/安全阀/存储) + adapters + UI',
    '├── scripts/                  # 构建链（精确补丁 + 内联 + 语法校验）+ hybrid 纯逻辑',
    '├── tests/                    # Vitest（含发布核心单测）',
    '├── CHANGELOG.md              # 更新日志（v1.1.8 → v1.2.0）',
    '├── README.md                 # 本文档',
    '├── LICENSE                   # MIT 许可证',
    '└── 烂梗机-1.1.20.user.js     # 历史版本存档',
    '```',
  ].join('\n');
  r = r.replace(treeRe, () => tree);
  console.log('tree ok');
}

if (!failed) rep('### v1.1.20（当前）',
  '### v1.2.0（当前）\n\n'
  + '- 🚀 **双模式引擎**：DOM（兼容原行为）与**协议数据流**可切换，B站/斗鱼支持协议直连源，其余平台自动回落 DOM\n'
  + '- 🔐 **安全阀**：风险确认、分钟/小时/日硬上限、同句冷却、平台风控熔断，计数持久化跨标签合并\n'
  + '- 📡 **B 站原生发送**（默认关闭）+ L2 结构化加权 + 多标签 leader 选举 + 系统弹幕智能识别\n'
  + '- 🎛 **界面二级化**：一级只留关键状态，引擎/发送/诊断移至设置页；CI 自动注入自动更新元数据\n\n'
  + '> 📜 完整 1.2.0 变更见 [CHANGELOG.md](./CHANGELOG.md#120---2026-09-09)\n\n'
  + '### v1.1.20（上一版）');

if (!failed) rep('- **v1.1.19**：网页全屏隐藏面板重写',
  '- **v1.2.0**：Hybrid 双引擎（DOM+协议切换、B站原生发送、安全阀、多标签、事件日志，详见 CHANGELOG）\n'
  + '- **v1.1.19**：网页全屏隐藏面板重写');

if (failed) { console.error('FAIL ' + failed); process.exit(1); }
fs.writeFileSync(P, r, 'utf8');
console.log('README updated bytes=' + Buffer.byteLength(r));
