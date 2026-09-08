# 🤖 烂梗机

> 多平台直播弹幕自动复读助手 · Tampermonkey 用户脚本

[![Tampermonkey](https://img.shields.io/badge/Tampermonkey-✓-green.svg)](https://www.tampermonkey.net/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Version](https://img.shields.io/badge/version-1.2.1-orange.svg)

监听 **斗鱼 / 虎牙 / Bilibili / 抖音** 直播间弹幕流，识别高频/热门弹幕并自动复读。
自 1.2.0 起提供「DOM（兼容）与协议数据流」双引擎与内置安全阀。

> ⚠️ **免责声明**：本项目仅用于学习与个人娱乐。请遵守各平台服务条款与社区规范，
> 合理控制使用频率，勿用于刷屏/引流/广告。使用者自行承担一切后果。

---

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/)；
2. 打开 [latest.user.js](./dist/latest.user.js) 的 **Raw 原始文件页**（或直接安装
   [烂梗机-1.2.1.user.js](./dist/烂梗机-1.2.1.user.js)），Tampermonkey 会自动弹出安装；
3. 升级前请先删除旧版本脚本，防止同一页面双实例并发发送；
4. 打开直播间，右下角出现 🤖 悬浮面板即成功——首次使用请在面板点一次红色
   「已知晓并启用」风险确认，然后拨动开关开始运行（旧版设置会自动继承）。

## 使用

- 面板开关 = 启动/停止自动复读；面板可折叠、拖动位置会记忆；
- 引擎：`自动`（智能选择）／`协议直连`（B站）／`DOM（兼容原行为）`；非 B 站平台自动使用 DOM；
- 设置页：候选/去重/屏蔽词/优先词/模式阈值/主题/日志，导入导出配置；
- 安全阀：分钟/小时/日硬上限、最小间隔、同句冷却、平台风控熔断——计数持久化，刷新不丢。

## 发布物

```
dist/
├── 烂梗机-1.2.1.user.js   # 最新版（可直接安装）
├── latest.user.js         # 最新版别名（自动更新指向）
└── 烂梗机-1.2.0.user.js   # 上一版
CHANGELOG.md               # 更新日志（v1.1.8 → v1.2.1）
LICENSE                    # MIT
```

## 更新日志

完整变更历史见 [CHANGELOG.md](./CHANGELOG.md)（含 P0/P1 分级与每一版的修复说明）。

## 许可证

[MIT License](LICENSE)

Copyright (c) 2026 烂梗机 contributors

---

> 💡 适度玩梗，快乐冲浪 🌊
