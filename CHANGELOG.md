# 更新日志 (Changelog)

「烂梗机」多平台自动复读弹幕脚本 · 版本记录

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循语义化版本。变更分类：

- **P0**：会错误地多发弹幕 / 采集完全失效等严重问题
- **P1**：影响使用但可绕过的问题
- **P2 / P3**：体验与边界问题
- **N / L**：新增能力 / 健壮性

---

## [1.2.2] - 2026-09-14

> 版本号说明：1.2.1 为发布线的损坏构建（构建期重命名事故导致 B 站房间号解析断链），
> 此号跳过；本版本曾短暂标记为 1.3.0，应要求定版为 1.2.2（内容不变）。

### 新增（多平台协议源，四平台全覆盖）

- **斗鱼 · 自连路线**：匿名直连 `wss://danmuproxy.douyu.com:8501~8506`（零凭据零签名，
  2026-09-09 真机矩阵验证）。端口 failover、5s 登录超时判定 + **25s 静默看门狗**
  （协议事实：坏 room 服务器 loginres 照回但不发任何房间事件也不主动断开，须客户端判定，
  否则「接管成功」却永久无弹幕）、`joingroup` 入组后**立即** `mrkl` 再 40s 周期心跳、
  多帧串联拆包、STT 转义正确还原（`@S`/`@A` 顺序修复）。
- **斗鱼 · Hook 路线**：被动监听页面已有的 danmuproxy 连接（只读不发，更隐蔽）。
  设置页新增「斗鱼协议路线」：自连优先（Hook 兜底）/ 仅自连 / 仅 Hook 页面。
- **虎牙 · Hook 路线**：被动监听页面 `*-ws.va.huya.com` Tars 弹幕通道；
  内置 Tars-lite 解码器（cmd7 单条 / cmd22 批量，uri1400 MessageNotice → 昵称+弹幕）；
  字节序按文档口径 LE 优先、BE 兜底，解出首条弹幕后锁定（结果写事件日志）；Blob 帧
  经 `arrayBuffer()` 归一化（兼容跨世界 ArrayBuffer 的接口特征兜底）。
- **抖音 · Hook 路线**：被动监听页面 `webcast*-ws-web-*.douyin.com` im 通道（签名每连必换，
  自连判死；页面 SDK 自理 ack/重连）；内置 protobuf-lite 解码器
  （PushFrame → gzip → Response → Message → ChatMessage）；PushFrame.payload 字段号
  双口径（公开 proto field 10 优先、真机文档 field 8 回退），gzip 以魔数判定。
- **页面 WS Hook 基座**：包裹页面 `WebSocket` 构造器按 URL 识别弹幕通道，eval 时即安装
  （不等 boot），只读不发；包裹构造器保留原型链/静态常量并把 `name` 伪装为
  `'WebSocket'`（反检测）；暴露 `window.__lgjPageHook` 诊断句柄；页面断线自愈重连后
  新连接自动被识别。
- **引擎泛化**：`engageProto` 按 `pickProtoRoutes` 路线表依次尝试，任一平台失败自动换下一路线
  或回落 DOM；Hook 源 auth 语义 = 20s 内见到有效协议帧，60s 无帧判通道死亡回落 DOM；
  诊断快照新增 Hook 活跃连接统计与斗鱼路线字段。

### 修复（构建系统，1.2.1 事故驱动）

- **`$&` 替换腐蚀**：`String.replace(锚点, 替换串)` 的替换串中 `$&` 会展开为匹配文本，
  曾把 `readCookie` 的 `'\\$&'` 腐蚀成锚点文本。所有替换值改函数形式 `() => value`，根除。
- **产物 NUL 字节**：legacy `cachedRegex` 的 key 分隔符裸 NUL 在构建期替换为等价
  `\u0000` 转义（运行时值不变，legacy 源文件保持冻结），产物恢复纯文本。
- **产物守卫升级**：新增锚点串次数校验（=== 1）、`__DEF_PROTECT_` 残留检测、
  NUL 字节检测、关键引擎符号「有定义且被调用」悬空引用检查——
  1.2.1 的 `isBiliPage` 断链事故在新守卫下会直接构建失败。
- **更新地址修正**：GitHub 账号已由 `ankhishtar2-lang` 改名为 `ArimaKana-Akane`
  （旧名已可被他人注册，等于把 Tampermonkey 自动更新通道暴露给抢注者），发布前把
  `@homepageURL/@updateURL/@downloadURL` 全部重建为指向新账号。

### 修复（引擎生命周期）

- **engage 互斥锁**：`__lgjEngaging` 防止 2s tick 在握手期间并发重复连协议。
- **中止不再误判成功**：`BiliSource.start()` 握手期被 stop 时 reject（原为 return，
  会被当成「已接管」并误清退避）；Hook 源 stop 时同样 reject 挂起的 start()。
- **锁占用不再误判失败**：`engageProto` 在锁占用时返回 `null`（区别于失败的 `false`），
  `tick()` 收到 `null` 不退避、不改状态。
- **主动中止不再刷错误状态**：`stopped` 中止安静返回，不再显示「协议不可用」。
- **斗鱼 STT 反转义顺序**：先 `@S`→`/` 再 `@A`→`@`（反序会把原文 `@S` 错解成 `/`）。
- **多标签 leader 的 room key**：虎牙自定义房间名（非数字）不再退化成全站同 key（改用路径区分）。

### 工程

- hybrid-core 新增 17 个导出纯逻辑函数 + 1 个常量表（斗鱼 STT / pb-lite / Tars-lite /
  房间号 / 路线表），Vitest 全套件 64 → 76 例；产物守卫扩到 66 项标记
  + 关键符号悬空检查（19 个符号「有定义且被调用」）。
- 代码审计（双轴子代理 + 作者自查）驱动追加修复：跨世界 ArrayBuffer 帧归一化兜底、
  WebSocket 包裹构造器 `name` 伪装、三平台弹幕结构统一为 `{text, nick, uid}`、
  Hook meta 构造去重、路线配置归一。

## [1.2.1] - 2026-09-09

### 变更

- **UI 精简**：移除面板发送区下方附加状态条，面板回归生产原样（用户反馈）
- **协议收敛**：斗鱼 danmuproxy 帧级直连真机 auth-timeout 不可用 → 下线，协议源仅保留 B 站；
  虎牙/抖音因需页面 hook / Launch 会话维持 DOM
- **引擎加固**：engageProto 加 in-flight 锁（__lgjEngaging，成功/失败/平台不支持三处释放），
  根治真机「每 2s 连接中」并发风暴
- **仓库整理**：精简为发布形态（CHANGELOG / README / LICENSE / dist 产物）

## [1.2.0] - 2026-09-09

### 修复（P0）

- **双源叠加**：协议源与 DOM 源同时写 `freqMap`/`timestamps` → 频次、DPM 翻倍。改为
  双源互斥切换（协议接管时暂停 DOM 并清空旧统计），并对 `ensureObserverRunning`、
  `startContainerPolling` 容器命中分支、body 降级分支三处都加协议守卫。
- **B 站房间号解析**：`/blanc/`、`/h5/`、`?room_id=` 及同源父文档兜底；短号先经
  `room_init` 解析真实房号，协议采集与原生发送都使用真房号。
- **安全阀可被绕过**：残缺配置 / 导入校验层级错误曾让硬上限失效。改为
  `mergeSafetyConfig` 合并默认 + 只可更严 + `enabled` 恒 `true`；
  `validateConfigBundle` 校验到 `config` 内部。
- **安全计数易失**：计数只在内存，刷新 / 多标签即清零。改为持久化 +
  `GM_addValueChangeListener` 跨标签按分钟槽合并。

### 修复（P1）

- 协议源随机器人开关启停；未启用时不建立 wss 连接。
- 协议断线指数退避重连（2s / 4s / 8s），3 次失败回落 DOM 并更新状态。
- `SAFETY_RANDOM_SKIP` 标记为不可重试，随机跳过真正生效。
- 面板被 SPA 重建后，自动重挂引擎 / 发送 / 工具 UI 与风险确认横幅。
- 持久化环形日志读回内存，设置页导出与诊断可见；写入改为 2s 节流。
- `parseDelimitedList` 改为只按换行分隔，避免 `/a,b/` 这类含逗号的正则被拆坏。

### 新增

- **B 站原生发送（默认关闭，UI 可切）**：`GM_xmlhttpRequest`（绕 CORS、带 cookie）+
  `room_init` + `POST /msg/send`；`mapBiliSendCode()` 归一化返回码。未登录 / CSRF 缺失 /
  非 B 站才回落 DOM；平台明确拒绝或网络异常一律 `SEND_FAILED` 且**不回落**，避免双发。
- **L2 结构化加权**：协议 `uid/nick/ts` 进入 `metaMap`，`__lgjMetaBoost` 按
  「独立发送者数 + 频次 + 新鲜度」给候选加权（上限 1.8，DOM 模式为 1）。
- **L4 多标签 leader 选举**：带过期租约 + 写后回读 + `BroadcastChannel` 心跳；
  `isLeader()` 发送前再校验租约；仅 leader 发送；B 站 blanc 让位时释放租约。
- **发布元数据自动识别**：`GITHUB_REPOSITORY`（CI）→ `git remote get-url origin` →
  `package.json repository` → `meta.json` 兜底；识别到即注入
  `@homepageURL/@updateURL/@downloadURL`。`@version` 从 `package.json` 读取。
- **产物守卫** `scripts/verify-dist.mjs`：22 项修复标记缺一即构建失败；
  `npm run verify` = typecheck + test + build + 产物守卫。

### 工程

- 纯逻辑抽到 `scripts/hybrid/hybrid-core.mjs`（Vitest 直接 import、构建时剥离 `export` 内联），
  解决「测 A 发 B」。
- 新增 `packages/core/test/hybrid-core.test.ts`（19 例：房间号 / 安全配置 / 导出校验 /
  安全阀 / 协议返回码 / leader 选举）。
- CI 兼容两种仓库布局（项目在根目录，或作为 `v2/` 子目录）。

### 数据源生命周期（吸收斗鱼生产实测版）

- **auth 成功才接管**：先连 wss，收到 op8 `{"code":0}` 后才暂停 DOM 并开始 feed；
  握手期间 DOM 继续采集，**没有探测空窗**。
- **掉线立即回 DOM**：`onProtocolDrop()` 立刻恢复 DOM，按模式退避（协议 8s / 自动 30s）
  后再探，不在 DOM 空窗里连续重连。
- **单一 `tick()` 生命周期**：开关 / leader / 模式 / 退避全部收敛；非 leader 标签页
  `standbySources()` 完全不采集。
- **真实房号**：`getInfoByRoom` 优先、`room_init` 兜底，短号也能正确 `getDanmuInfo`。
- **回落保留统计**：`__lgjKeepStats` 让协议掉线回落 DOM 时不 `freqMap.clear()`，
  候选池无需 2 分钟重建。

### 系统弹幕智能识别

- 关键词启发式扩充到多平台：欢迎语 / 系统公告 / 关注 / 礼物 / 进场 / 粉丝团 /
  大航海 / 中奖 / 签到 / 风控（禁言、封号、管理员）等，长文本（>80）不误杀。
- DOM 路径增加**结构判定** `__lgjIsSystemNode`：节点/父节点类名含
  `system/notice/gift/welcome/enter` 等直接排除。
- legacy `isSystemDanmaku` 委托到 `hybrid-core` 的增强实现，协议与 DOM 两路一致。
- 系统过滤计数 `__lgjCountSystemFiltered`：每 20 条记一次样本，60s 摘要里汇总。

### 界面二级化

- 一级面板恢复简洁：只保留状态、上次/下次、开关、风险确认、一行引擎状态。
- **引擎**、**发送**、**导入/导出/诊断** 全部移到二级设置页：
  - 引擎 = 直连开关（关 = DOM，开 = 协议直连）+「切到智能模式」；
  - 发送 = 协议直发开关（默认关 = DOM 模拟）；
  - 配置管理 = 导出 / 导入 / 诊断。
- **智能模式不可用**（非 B 站 / 协议探测失败/退避中）时，一级面板出现
  「直连引擎」快捷开关（关 = DOM，开 = 直连），与发送开关同样的切换样式。

### 日志升级

- 新增 `event` 级别与 `logEvent()`：记录引擎切换、协议连接/接管/掉线/回落、
  数据源切换、智能模式不可用、leader、安全阀拦截、选择决策、配置导入导出等。
- 发送日志带上下文：`模式/DPM/来源/权重/boost/候选`，不再只有「发送成功: xxx」。
- 60s 采集摘要：`DPM / 候选 / freq / 系统过滤 / 来源 / 模式 / 引擎`。
- 设置页日志区：全部 / 事件 / 发送 / 警告 / 错误 / 信息 级别筛选 + 搜索 + 详细开关，
  显示最近 300 条（覆盖 legacy 只显示 error 的实现）。

### 已知风险

- 「复读」本身是风控对抗，硬约束只能降低风险，不能消除。
- 协议直发与页面自身 `/msg/send` 的参数 / Header 并非完全一致，仍可能被单独标记。
- 自连 WS ≠ Hook 页面已有 WS：多一条连接、需要 wbi 签名，隐蔽性较弱。
- 目前只有 B 站有协议源；斗鱼 / 虎牙 / 抖音仍依赖 DOM 选择器。
- 多标签 leader 依赖 GM 存储跨标签共享；隔离存储时存在最多一个心跳周期（5s）的收敛窗口。
- 网络歧义下「宁可不发不可双发」，代价是偶发漏发。

## [1.1.20] - 2026-09-09

### 修复（1.1.18 / 1.1.19 复核遗留项）

- **P0** B 站首条弹幕发送后增加额外清空宽限（仍不补第二次 Enter），避免「已发出但输入框清空慢」被误判为发送失败
- **P2** `queryAll` 多选择器重叠导致同一条弹幕被重复采集 → 引入 `Set` 去重
- **P3** 发送重试成功后立即刷新候选，避免「下次」预览停留在刚发出去的消息
- **P3** body 降级后开关无法恢复采集 → `ensureObserverRunning` 支持 `degradedToBody` 恢复，真实容器重新出现时清除降级标志
- **P3** `stopBot` 不再强制清 `isSending`，快速关→开时旧发送的 `finally` 不会误清新发送的忙标志，让飞行中的发送自然结束
- 让位（standDown）后容器轮询 / observer 的兜底补齐
- 设置页数值与主题输入值统一 `escapeHtml` 转义
- 修正 iframe 防重注释：实际未使用 `@noframes`（B 站 blanc iframe 需要运行），注释与实现保持一致

> 注：`isSystemDanmaku` 对「本直播间」前缀的过滤为用户确认的产品行为，本次不做改动。

## [1.1.19]

### 修复（真机反馈驱动）

- **P0** 网页全屏不隐藏面板 —— 网页全屏是站点自绘状态（非 Fullscreen API），旧检测漏判斗鱼 / 虎牙 / 抖音。重写为**四路综合判定**：
  1. 原生全屏（含 webkit/moz/ms 前缀）
  2. html/body 类名关键字
  3. 各平台已知容器标记（斗鱼 / 虎牙 / B 站 / 抖音）
  4. 视频铺满视口几何兜底（仅斗鱼 / 虎牙 / B 站；抖音直播常态即满屏，几何法会永久误判，故排除）
  - B 站 blanc iframe 实例额外检查同域父文档状态
  - 触发：`fullscreenchange` 三前缀事件 + html/body class MutationObserver（网页全屏无事件）+ 1s 兜底轮询
- **P1** 状态去重（不再每 1.5s 无条件写 class）；全屏时同步隐藏设置浮层（浮层 z-index 100000 会盖在网页全屏画面上）
- **P1** standDown（B 站主文档让位）后清理全屏轮询与 observer，不再空转

## [1.1.18]

### 修复（1.1.17 复核清单驱动）

- **P0 双发修复** —— 1.1.17 在发送按钮点击后「无条件」追加 Enter，而平台清空输入框是异步的 → 点击已生效时 Enter 会再发一次（抖音实测严重，斗鱼登录态同样中招）。改为全平台统一**「证据驱动」模型**：发送动作后，仅当宽限轮询确认「输入框仍未清空」才补发 Enter（最多一次）：
  - 按钮有效 → 已清空 → 不补 Enter → **单发**（抖音双发根治）
  - 按钮灰态 / 无效（实测斗鱼 `is-gray`）→ 未清空 → 补 Enter → 照常发得出去
  - B 站无可靠按钮，Enter 即主发送动作，逻辑不变且更安全
- **P1** 设置页「透明度」清空保存写入 `NaN` → 面板样式 `--bot-opacity: NaN`
- **P1** 面板模式一旦出错永久显示「错误」→ 只统计最近 2 分钟的 error
- **P2** `isSystemDanmaku` 关键词过宽（「本直播间」误杀正常弹幕）→ 前缀锚定 + 短文本限定
- **P2** standDown 让位检查原写在容器轮询内，主文档先命中容器则 `clearInterval` 后永不触发 → 抽成独立 `yieldToBlancFrame` + 1s 周期 `startBlancYieldWatch`（覆盖 45s body 降级后的晚插入）

## [1.1.17]

### 修复（静态审查清单驱动）

- **P1** 系统弹幕（欢迎语 / 公告）不再进入候选（实测斗鱼「欢迎来到...」被采集）
- **P1** 斗鱼受控 contenteditable 输入同步 —— 补发 `InputEvent(inputType=insertText, data)`；通用发送补 Enter 兜底（实测按钮 `is-gray` 不激活的根因）
- **P1** 多版本共存告警 —— `data-lgj-loaded` 记录版本号，检测到旧版已运行时 console 警告（升级前必须删除旧版脚本，否则多实例并发发送）
- **P1** 发送失败（输入框未清空）不再自动重试 —— 可能实际已发出，重发只会造成重复弹幕；仅「明确未发出」的错误才重试
- **N** 让位净化 —— B 类房间主文档让位时移除 idle 面板、断开 observer、周期任务空转（standDown 标志）
- **N** 让位检查提前到 body 降级之前（blanc 晚于 45s 出现时不再失效）
- **L** 选择器失配不再静默失效（批量分支空结果回退按节点文本兜底）
- **L** `getSelectors` 返回完整选择器数组（多候选不再只有第一个生效）
- **L** 设置页空输入保存不再覆盖为 0；补 `normalIntervalMin/Max` 设置项；`input min=0` 属性不再丢失
- **L** Logger 默认静音 debug 级（洪峰降噪）；面板位置视口 clamp；倒计时定时器复用（不再每秒重建）；预览与实发一致；`escapeHtml` 转义引号
- **🧹 清理**：死代码（`clearRegexCache`、`MAX_HISTORY_SIZE_FALLBACK`）

## [1.1.16]

### 修复（生产环境实测驱动）

- **P0** B 站双渲染模式 —— 1.1.15 的「B 站主文档一律退出」误杀主文档直挂弹幕的房间（实测 6343442：`#chat-items` 在主文档，无 blanc iframe）；而 856077 / 814 是 blanc iframe 模式。帧选择修正为：
  - iframe 仅放行 blanc
  - B 站主文档仅在页面存在 blanc iframe 时让位
  - 轮询循环二次检查兜底 blanc 晚插入场景

## [1.1.15]

### 修复（真实浏览器端到端实测驱动）

- **P0** B 站回归 —— 1.1.14 的 `@noframes` + iframe 排除误杀 B 站：B 站弹幕渲染在同源 iframe（`live.bilibili.com/blanc/...`）内，脚本在 iframe 退出、主文档又无弹幕 DOM → B 站完全无法采集。改为平台感知帧选择：仅允许 blanc iframe 运行，B 站主文档退出
- **P0** 调度链竞态残余 —— `stopBot` 强制 `schedulerBusy=false` 时旧 `runBot` 仍在飞行，快速关→开会清掉新链标志重复 setTimeout → 新增 **epoch 令牌**
- **P0** `send()` 局部 `input` 在 `refreshCache` 成功后未重读（`_fillInput(null)` 必抛 `FILL_ERROR`）
- **P1** 容器轮询失效 —— `findContainer` 降级 body 导致轮询 1 秒即停（实测斗鱼 / 抖音均降级 body）→ 找不到返回 null、超时才降级
- **P1** 发送后校验加宽限（平台清空输入框有延迟，误判会 3 秒后重发同一条）
- **P1** 正则屏蔽词被 `/` 分隔符拆成普通词（设置页永远无法录入正则）
- **P1** 设置页错误日志区打开时不渲染
- **P1** 去重窗口 / 历史条数设 0 时语义反转（0 = 关闭去重）
- B 站弹幕文本选择器修正（避免回退 textContent 带上用户名）

## [1.1.14]

### 修复

- **P0** 多实例并发发送 —— 实测 Tampermonkey 沙箱隔离导致 window 防重标记失效，脚本在主文档与同源 iframe 各注入 2 次，多实例各自调度发送（「一次发两条」的又一来源）
- 新增 `@noframes` + iframe 排除 + document 属性防重（跨沙箱可靠）

## [1.1.13]

### 优化

- 面板拖拽渲染性能 —— `transform: translate3d` 替代 `left/top`（不再每帧强制重排）
- `requestAnimationFrame` 合并高频 move 事件
- Pointer Events + `setPointerCapture` 替代 document 级监听，拖动更跟手流畅

## [1.1.12]

### 修复

- 调度器单链守卫 —— `runBot` 异步执行期间 `mainTimer` 为空，UI 循环每秒调用 `switchMode` 会误判无调度而重复启动调度链，导致双链并存、一次发送两条弹幕
- 新增 `schedulerBusy` 标志彻底防重入

## [1.1.11]

### 修复

- 频次统计改为滑动时间窗口（2 分钟）—— 旧弹幕不再霸榜，候选词跟随当前直播话题实时更新，杜绝发送过期弹幕

## [1.1.10]

### 修复

- DPM 批量节点漏计（批量容器内每条弹幕各计一次）
- 开关重开后 MutationObserver 不恢复，导致候选冻结

### 新增 / 优化

- 候选词限定最高 50 条
- 候选 / UI 刷新间隔 2s → 1s，实时刷新

## [1.1.9]

### 修复

- 智能去重不再丢弃纯数字弹幕（`66666` 等可正常复读）
- 单一调度链消除双定时器竞态

### 优化

- 正则结果缓存（避免反复编译）

### 清理

- 移除 console 全局劫持与死代码
- 模块化重构（27 个 SECTION）

## [1.1.8]

### 新增

- 候选强制刷新（10 秒兜底）
- 智能去重（按规范化文本合并近似弹幕）
- 全链路调试日志

---

## 早期版本

- **v1.1.5**：首个公开版本（多平台基础复读功能）。v1.1.6 / v1.1.7 为内部迭代，未留档。
- **归档说明（2026-09-09）**：`dist/` 已按发布顺序补齐全量历史版本文件
  （1.1.5 / 1.1.10 由仓库早期提交内容还原，1.1.15–1.1.20 为当时留档快照），
  v1.1.6–1.1.9 与 v1.1.11–1.1.14 系同文件内部迭代，仅有本文档变更记录、无独立快照。
