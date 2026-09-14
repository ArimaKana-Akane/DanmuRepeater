# 更新日志 (Changelog)

「烂梗机」多平台自动复读弹幕脚本 · 版本记录

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循语义化版本。变更分类：

- **P0**：会错误地多发弹幕 / 采集完全失效等严重问题
- **P1**：影响使用但可绕过的问题
- **P2 / P3**：体验与边界问题
- **N / L**：新增能力 / 健壮性

---

## [1.2.3] - 2026-09-14

> 真机测试驱动版：在用户真实 Chrome（隔离副本 + 四平台真实登录态 + 真实直播间）上
> 端到端验证 1.2.2，用「真机帧 → 离线喂解码器」定位静态审计与单测都未发现的缺陷。

### 修复（P0 · 真机发现）

- **虎牙弹幕解码全错**：Tars 的 `LIST`/`bytes` 长度字段是「**类型化整数**」（head + 定长值），
  不是裸 u32；且**字节序为大端**（页面权威实现 `Taf.BinBuffer.readInt16` 无 endian 参数 →
  DataView 默认大端）。旧实现按「裸 u32 + 小端」解析：
  - `SIMPLELIST` 长度 `01 05 d5` 被读成 110757121（> 帧长）→ 边界校验失败 → `vData = null`；
  - `LIST` size 被读成 167837697（> 100000）→ 整帧解析中止；
  - 虎牙每一条弹幕帧都解不出，`topProtocolMeta` 恒 0。
  修复：新增 `_tarsTypedSize()`（按 head 类型读定长值，**大端**），`SIMPLELIST`/`LIST`/`MAP`
  三处改用它。真机复测：25/25 帧 BE 解码成功、零 LE 回退，uri 值恢复为正数合理值
  （`6479/6480/7101–7114`；修复前是 `-8425`/`-5094` 等负数）。
- **虎牙字节序试错顺序反了且提前退出**：`__lgjHuyaDecode` 原为 `[LE, BE]` 且「结构自洽即
  return」——用错误的 LE 解出 cmd 后直接返回空结果，**永远试不到 BE**。改为 `[BE, LE]`
  且仅在解出弹幕时返回，否则继续试另一字节序。
- **斗鱼 AI 直播摘要被当弹幕采集并发送**：斗鱼把 `<div class="AiLiveSummaryBarrage
  js-ai-live-summary-barrage">` 直接放在 `#js-barrage-list` 的 `li.Barrage-listItem` 内，
  293 字符营销文案（「看点：…去看看」）被当弹幕入池并选中发送（等效刷广告）。
  两道防线同时失守：结构正则不含 `ai-live-summary`；文本过滤因 `if (t.length > 80) return false`
  把这些超长文案直接放行。修复：
  - `__lgjIsSystemNode` 增加运营/摘要类结构关键词 + 子节点探测（`ai-live-summary` 等）；
  - `isSystemDanmaku` 取消「长文本直接放行」，改为**先模式匹配**，并新增 `MAX_DANMAKU_LEN = 100`
    硬上限（四平台弹幕上限约 50 字，超长必非弹幕）；新增 `看点/亮点/主播标题` 前缀模式。
  真机复测：被选中候选全部为真实弹幕（44–50 字符），零条超长文案。
- **虎牙礼物通告 / 贵族进场被当弹幕采集并发送**（第二轮真机复测新发现，同属 P0）：
  虎牙把 `#chat-room__list` 的直接子节点换成了**无类名**的 `<div data-cmid>` 包裹层
  （内含 `div.msg-bubble` 真弹幕 / `div.tit-h-send` 礼物 / `div.msg-timed` 时间分隔 /
  `div.msg--<hash>` + `div.box-noble-level-*` 贵族进场）。旧 `danmuItem` 选择器
  （`.msg-item`/`.msg-normal`/…）在真机全部失配 → 每个新增节点都落到「按文本兜底」分支；
  而 `__lgjIsSystemNode` 只查自身/父层类名，包裹层两层都无类名 → 判据整体失效。
  后果：真机实测 50 条礼物通告 `44三无楚轩送100`（礼物名**只存在于 `<img alt>`**，
  textContent 里没有）入池，并一度成为「下次发送」——一旦发出即刷屏复读礼物通告；
  另有贵族进场 `44三无楚轩 驾临直播间` 同类入池。修复（两层）：
  - 结构层：`__lgjIsSystemNode` 增「查子节点特征」（包裹层无类名可判），顺序为
    **`.msg-bubble` 先判并放行 → 绝不误杀真弹幕**，再判 `.tit-h-send`/`.send-gift`/
    `box-noble-level`/`msg-pic--` 为系统节点；仅虎牙启用，其它平台不付这次查询开销。
  - 文本层（跨路线兜底）：新增 `^[^，。！？、:：\s]{1,20}[送赠]\d{1,6}$`（昵称 + 送/赠 +
    纯数量）与 `驾临直播间`。权衡：「主播我送100」这类会被一并过滤，故结构层才是主防线。
  真机复测：候选池零条 `送100`/`驾临直播间`，`next` 全部为真实弹幕；离线断言 5/5 通过。

### 修复（P1 / P2 · 真机发现）

- **切到 DOM 模式后引擎状态行不更新**：`tick()` 的 `mode === 'dom'` 分支只 `disengageProto()`
  就 `return`，从不 `setStatus()` → 数据源已回 DOM，面板仍显示「协议：数据流（…）」，用户误判。
  修复：该分支补 `setStatus('DOM 采集', 'ok')`。
- **非直播间页面仍发起协议连接**：`engageProto` 只在「纯自连路线」时检查房间号，含 hook 的
  路线（斗鱼 `auto=[direct,hook]`）会绕过 → 在 `/directory/all` 等页面也建连（真机日志
  「连接中（douyu 房间 ?）」）。修复：房间号缺失时直接不连，状态置「DOM 采集（非直播间页面）」。
- **安全阀全部数值项在 UI 上不可见**：`perMin`/`perHour`/`perDay`/`minGapMs`/`cooldownAfter`/
  `cooldownMs`/`skipChance`/`pauseWhenHidden` 此前均无控件。其中 `pauseWhenHidden` 默认 `true`，
  会让**非前台标签页永不发送**——多平台同时开播时只有当前标签页工作（真机实测四标签场景）。
  修复：设置页新增「🛡️ 安全阀」区，7 个数值项 + 1 个开关（切后台暂停），
  写回经 `safety.setConfig()`，并回填被夹取后的实际生效值。

### 测试（防「自证自洽」）

- **真机帧回归夹具**：`packages/core/test/fixtures/` 存入真机抓取的原始帧
  （`douyu-chat-475.bin`、`huya-cmd22-1507.bin`、`huya-cmd22-649.bin`），
  新增 3 例「真实字节 → 解码器」回归测试。
- **单测辅助函数修正**：旧 `tBytes()`/`tList()` 用「裸 u32 小端」构造帧，与旧解码器
  **共享同一错误假设**——这正是 1.2.2 的 76 个单测全绿而真机虎牙零弹幕的原因。
  改为 `tTypedSize()`（类型化 + BE），单测与真机字节一致。
  第二轮又补：虎牙礼物/贵族进场的文本兜底用例 2 组。全套件 76 → **91 例**。
- 产物守卫：`虎牙 LE 优先口径` 标记改为 `虎牙 BE 优先口径` + 新增 `虎牙类型化 size（BE）`
  标记，防止字节序回归；第二轮再补 4 项（虎牙包裹层结构判据、真弹幕放行优先、
  礼物文本兜底、贵族进场文本兜底）。守卫 66 → **81 项**。

### 更正（撤回上一轮报告的误判）

- **「系统弹幕过滤无限递归」不成立**：真机实测 `__lgjIsSystemDanmaku` 正常
  （`welcome=true`/`notice=true`/`normal=false`，调用深度 1）。原因是两个同名
  `isSystemDanmaku` 处于**同一 IIFE**，函数声明提升使后者覆盖前者，不存在跨层递归。
  上一轮报告基于自建 Node 复现（错误的跨作用域假设）误判，本次更正。
- **「虎牙弹幕走 Worker 内 WS」不成立**：真机探针确认页面 2 个 blob worker 内
  **没有 `new WebSocket`**，8 条弹幕连接全在主线程。据此撤回实验性的 Worker hook 改动
  （保持最小改动原则）。

### 修复（P0 回归 · 代码审查发现）

- **虎牙 Hook 接管后用户彻底收不到弹幕（比 1.2.2 更差）**：`PageHookSource._touch()`
  在**任何帧**到达时就 auth（心跳/榜单事件也算）→ `onProtoAuth` → `domPause()` **断开 DOM 采集**。
  而虎牙连接持续推送心跳但**不含 uri1400 弹幕** → 结果「DOM 已停 + 协议无弹幕」，
  且因心跳持续到达、60s 静默看门狗永不触发，无法自救。
  真机实测：DOM 容器 55 条真实弹幕，而 `dpm=0 / cand=0 / top=0` 恒定。
  修复：auth 语义改为**必须等首条弹幕**（新增 `PageHookSource.markDanmu()`）；
  超时错误改为 `hook-no-danmu-timeout`，据此**回落 DOM**（真机复测：`src=dom`、
  `cand=41`、DOM 采集恢复；斗鱼 Hook 仍能正常接管——它确实能解出弹幕）。

### 修复（审查发现的其他问题 · 第二轮）

- **容器内时间分隔节点被当弹幕**：真机实测虎牙弹幕容器内有
  `<div class="msg-timed">05:28</div>`，被采集为普通条目（日志出现 `选择 | "06:22"`）。
  修复：`__lgjIsSystemNode` 增加分隔节点关键词（`msg-timed`/`chat-timed`/`time-divider`
  等）；`SYSTEM_DANMAKU_PATTERNS` 增加「整串即时间/日期」模式
  （`^\d{1,2}:\d{2}(:\d{2})?$`、`^\d{4}[-/]\d{1,2}[-/]\d{1,2}$`），
  限定整串匹配以免误杀含时间的正常弹幕（`我们6:30见` 不误杀）。
- **协议失败退避无阶梯，导致无限循环**：当平台协议路线**结构性**无数据时
  （虎牙 Hook 持续推心跳但无 uri1400），固定 60s 退避会「连接中… → 回落 DOM」
  无限循环——用户每分钟看到状态抖动、每轮白建一条 wss。
  新增 `protoFailStreak` 连续失败计数 + `_protoBackoffMs()` 指数退避：
  auto 模式 `60s → 60s → 120s → 300s`（上限 600s）；
  用户切换模式（`switchMode`）时清零阶梯，立刻按新模式重试。
  真机复测确认阶梯生效：`已回落 DOM（15s 后重试）` → `（30s 后重试）`。

### 修复（审查发现的其他问题）

- **注册重试会随重连重复发送**：`_registerHuyaWildcard` 的 `sent` 原为**函数局部变量**，
  每次 `start()`（静默看门狗 60s 重连循环）都会重新注册。改为**实例级 `_regSent`**。
- **注册重试计时器未随 stop 清理**：两个 `setTimeout` 句柄原为裸调用，源已停止仍可能在
  1.2s/4s 后发帧。改为记入 `_regTimers` 并在 `stop()` 中 `clearTimeout`。
- **`__lgjHookNet` 裁剪策略**：原按长度 `splice` 只保最近 8 条，**关闭的连接会长期占名额**
  （诊断与注册选路都会扫到死连接）。改为优先淘汰 `readyState !== 1` 的记录。

### 代码审查结论（性能 / 安全 / 可行性 / 内存）

> 第二轮复审（2026-09-14 晚）重测了性能与内存，**更正上一轮的两个数字**，
> 并新增 2 项真实发现（见下）。

| 维度 | 结论 |
|---|---|
| 性能 | ✅ 解码热路径重测 **27 µs/帧**（1.5KB 虎牙帧全链路，中位数；15KB/s 级流量下约 **0.27 ms/s** CPU）——上一轮写的 `0.0044 ms/帧` 是**只算 `huyaExtractDanmu` 内部早退的偏差值**，已更正。`tarsFields` 有 `depth > 24` 上限；列表 size 有 `> 100000` 与越界校验 |
| 安全 | ✅ Hook 层**零 `ws.send`**（只读，复核 `inject-block.js` 全部 `.send(` 调用点确认）；唯一主动发送点是 `live:0` 注册（最多 3 次，非循环，句柄随 `stop()` 清理）；构造器 `name` 伪装 + 原型链/静态常量保留（反检测）；未新增任何凭据外发；设置页 HTML 插值处 `escapeHtml` 覆盖日志渲染路径 |
| 可行性 | ✅ 注册帧与页面真实上行帧**逐字节一致**（26B/53B，重跑夹具断言通过）；注册失败静默不影响被动监听；斗鱼双路线 fallback 真机复测正常 |
| 内存 | ✅ `__lgjHookNet` ≤8 条（优先淘汰死连接）；`seenMsgIds` ≤2000；`metaMap` 超 600 裁剪到 500；`freqMap` 受 `DANMU_CACHE_MAX` 限制；监听器闭包随 ws 回收。<br>⚠️ **发现并修复一处无界增长**：`metaMap[text].senders` 原无上限——同一条弹幕被大量不同用户复读时字典持续增长（实测 100 万发送者 → 91.6 MiB heap）。而评分侧 `Math.min(0.5, senders / 20)` 在 20 个发送者即饱和，**超出部分零贡献**。现加 `META_SENDER_CAP = 32`，复测 100 万发送者下字典恒为 32 项 |

### 其他修复（审查发现）

- **每次字符串解码都新建 `TextDecoder`**：`_tarsValue` 的两个 STRING 分支与 `_pbStr`
  各自 `new TextDecoder().decode(...)`，而 1.5KB 虎牙帧含数十个字段。改为模块级
  共享 `_UTF8`（TextDecoder 无状态、非流式调用间可安全复用）。行为不变，纯开销削减。

### 新增（虎牙主动注册 live:0）

- **`huyaBuildRegisterGroups()`**：构造 `cmd16 RegisterGroupReq` 帧。字节模板来自**真机抓包**
  （`lgj-huya-register-dump.mjs`），与页面真实上行帧**逐字节一致**：
  - 单组 `live:0` → 26 字节；
  - 双组 `['live:<uid>','chat:<uid>']` + `lRequestId=5` → 53 字节。
  - 帧体按协议文档完整字段编码：`iCmdType@0 + vData@1 + lRequestId@2 + traceId@3
    + iEncryptType@4 + lTime@5 + sMD5@6`（除 cmd/vData 外页面恒发默认值）。
    **注意尾部不是固定常量**——真机双组帧 tag2 为 `20 05`（非 ZERO），必须按字段规范编码。
- **`PageHookSource._registerHuyaWildcard()`**：引擎接管虎牙时，在页面「最近收帧最活跃」的
  活连接上补发 `live:0` 注册（立即 + 1.2s + 4s 三次机会），仅发注册帧、不改页面其它行为。
- 新增 3 项守卫标记（`虎牙主动注册 live:0`、`虎牙注册帧发送`、`虎牙类型化 size`）。
  最终守卫总数 66 → **83 项**（含第二轮虎牙包裹层 4 项 + 审查 2 项：发送者字典上限、共享 UTF-8 解码器）。

### 已知边界（如实标注）

- **虎牙 uri1400 仍未捕获（重要）**：`live:0` 补注册**已实现且确认生效**——
  真机抓到我们发出的注册帧（字节与页面模板一致）、服务器回 `cmd17` 应答、
  注册后开始出现新的 uri 类型（`10042`）。但**在累计约 250 秒 / 约 160 帧的观察窗口内，
  仍未捕获 uri1400（弹幕）帧**，而同期 DOM 有大量真实弹幕（"超澜.要收费"、"好听" 等）。
- 已排除的假设（均有真机证据）：
  - ❌ 解码器问题——帧结构/字节序/列表解析已全部按真机修正并验证（25/25 帧 BE 成功）；
  - ❌ Worker 内 WS——document-start 完整监控确认页面只建 8 条 WS（全在 `-ws.va.huya.com`），
    2 个 blob worker 内**无 `new WebSocket`**；
  - ❌ 遗漏连接——document-start 起监控，WS 创建总数就是 8 条。
- 尚待验证的方向（协议文档 §4/§6 提示）：文档称**独立连接**必须先完成 `ws.Launch`
  （Wup `cmd3`，servant `ws`/func `Launch`）建立信令会话，否则只回 `cmd17` 而无数据推送；
  复用页面连接虽已具备会话，但弹幕可能绑定在页面的 `chat:<uid>` 组订阅上下文上。
  下一步方向：完整复刻页面的上行序列（`ws.Launch` → 注册 → 心跳），或接受
  「虎牙弹幕走 DOM」并如实标注为协议路线的能力边界。

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
