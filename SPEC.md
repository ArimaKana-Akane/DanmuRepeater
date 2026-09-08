# 烂梗机 1.2.0 工程规格（L0–L4）

> 来源：用户 2026-09-09 拍板要求（原文归档）｜ 状态：**已确认执行**，逐条映射到任务/ADR
> 红线：不直接改动任何 1.1.x 脚本文件；1.2.0 在独立工程目录 `v2/` 生长，1.1.20 为行为冻结基线。

---

## L0｜工程化地基（不做这个，后面全白搭）

- **Monorepo + TypeScript + Vite/esbuild + vite-plugin-monkey**：源码拆分，构建出 `.user.js` 产物。
- 包结构：
  ```
  packages/
    core/        # 平台无关：候选引擎、策略、安全阀、日志、存储
    adapters/
      douyu/  huya/  bilibili/  douyin/
    ui/          # Shadow DOM 面板
    entry/       # userscript banner + 装配
  ```
- 测试：Vitest + jsdom 单测（候选/去重/配置迁移）；Playwright + 录制的 DOM fixture 做适配层回归。
  **背景事实**：README 声称有 `.test/`，但仓库实际只有 4 个文件、没有测试目录——最该补的债。
- CI/CD：GitHub Actions 跑 lint/typecheck/test/build；release 自动 bump `@version`、生成
  `dist/latest.user.js`；**补脚本缺失的 @updateURL / @downloadURL / @homepageURL / @author / @license**，
  让用户能稳定自动更新。
- 状态管理：typed store + 事件总线替换全局 `state`；平台适配器通过接口注入，可 mock。
- 存储：`GM_getValue` 现在在 1s UI 轮询里被 `checkConfigUpdate()` 每秒同步读一次 →
  改为 `GM_addValueChangeListener` + 内存写穿缓存。

## L1｜数据源革命：从"看 DOM"到"接数据流" ★最关键

- **接收端**：Hook 页面 WebSocket / fetch / XHR（`unsafeWindow` 或页面上下文 patch
  `WebSocket.prototype.send` / `MessageEvent`），直接解析平台协议：
  - 斗鱼/B站：Protobuf 弹幕帧（文本、uid、用户名、时间戳、礼物、表情、粉丝牌）
  - 虎牙/抖音：JSON/自定义帧
- 收益是质变：免疫 CSS/DOM 改版、iframe、渲染模式、全屏；DPM/用户数/趋势精确，不再靠
  MutationObserver 猜；天然没有"同一条弹幕被多个选择器重复采集"。
- **发送端**：优先复用站点自己的发送函数 / 带 session token 的接口调用（fetch 同源、带页面
  已有请求头），DOM 模拟退化为"最后兜底"——从根上消灭 1.1.14–1.1.20 整条双发/漏发 bug 谱系。
- 迁移策略：适配器接口化，`NetworkAdapter` 与 `DomAdapter` 并存，feature flag + 健康检查
  自动降级。**先拿 B站（WS JSON，最好验证）做 PoC**，对齐旧行为后再推其他三平台。

## L2｜决策引擎革命：从"最高频字符串"到"有策略的参与"

- 候选结构升级：`{text, count, velocity, firstSeen, lastSeen, uniqueSenders, emotes, isGift,
  clusterId}`；用**指数衰减 + 速度（趋势）**替代 count²，真正跟随当下话题。
- 语义聚类：SimHash / n-gram + 编辑距离 替代现在粗暴的 `normalizeText`（现会把所有纯数字/
  纯符号弹幕归成一类）。
- 可选 LLM（默认关闭、本地优先）：WebGPU/WASM 小模型或用户自配 API，做 ①梗/广告/垃圾判别
  ②生成短变体而非原样复读 ③毒性过滤。必须显式 opt-in、内容不出本机。
- 评分与选择分离：评分（发什么值得发）× 选择（何时发哪条）解耦；选择器可插拔：
  加权随机 / ε-greedy 探索 / MMR 多样性，避免连续刷同一句。
- 人类化：对数正态间隔、按文本长度模拟输入耗时、随机跳过、页面不可见时不发。

## L3｜安全治理（合规内建，不是免责声明）

- "克制"做成不可绕过的硬约束，独立于用户配置：
  每分钟/每小时/每日硬上限；最小间隔；同话题连续上限；同一弹幕 N 次后强制冷却。
- 检测到平台警告/风控时**自动熔断**。
- 首次运行弹风险确认；不收集、不上传任何弹幕内容。
- 定位转变：从"刷屏脚本"变成"有节制的参与助手"。

## L4｜体验与生态

- 面板迁到 **Shadow DOM**（现在 :root CSS 变量 + `.bot-*` 类名直接注入页面，与站点样式互相污染）。
- 多标签页协调：**BroadcastChannel + leader 选举**，根治多实例双发（现在靠 document 属性 +
  frame 判断打补丁）。
- 配置：JSON 导入/导出、zod schema 校验 + 版本迁移、按房间 profile。
- 可观测性：持久化环形日志（GM 存储、有上限）、一键"诊断快照"（平台、命中的选择器、
  适配器健康、最近发送结果）。

---

## 执行映射

| Spec | 任务/里程碑 | 验收要点 |
|---|---|---|
| L0 全量 | 任务#2/#3/#4 + v2 工程 | dist 产物可安装；构建链跑通；lint/typecheck/test/build 一条龙 |
| L0 0.1 冻结 | 任务#3（本轮） | 1.2.0 产物与 1.1.20 行为等价（Node 桩 diff），元数据补齐 |
| L0 0.2 core | 任务#4 | 决策/去重/过滤/调度 TS 化 + typed store + Vitest |
| L0 0.3 + L1 | 任务#5 | Adapter 接口化 + B站 NetworkAdapter PoC（采集已真机验证） |
| L1 其余平台 | 任务#6 | 斗鱼/虎牙/抖音协议数据流真机矩阵报告 |
| L2–L4 | 0.4+ | 决策引擎/安全阀/Shadow DOM/BroadcastChannel/诊断快照（ADR 另行固化） |

## ADR 待办（首轮需拍板）

1. 仓库形态：`v2/` 独立工程 vs 根目录重构？（倾向 v2/ 独立，与 1.1.x 散文件并存到功能全等）
2. 功能迁移顺序：先 core 纯逻辑（TS 化+单测）还是先 L1 数据流？（建议：core 先行，行为冻结更稳）
3. ~~`@updateURL` 的 GitHub owner/repo 占位待用户填写。~~ **已解决（2026-09-09）**：
   构建改为自动识别仓库——CI 用 `GITHUB_REPOSITORY`，本地用 `git remote get-url origin`，
   再退回 `package.json repository`；识别到即注入 `@updateURL/@downloadURL/@homepageURL`。
   `scripts/meta.json` 仅作最后兜底，不再需要手填。`@version` 也改为从 `package.json` 读取。
