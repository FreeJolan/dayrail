# DayRail · 当前状态 & 后续迭代

> 最后整理：2026-05-08（v0.9.0 桌面端首版 ship · 4 平台 unsigned binaries + auto-update + Drive 永久授权）
> 本文档与 `ERD.*.md` 分工：ERD 是设计意图 + 历史决策链（append-only
> 记录），本文档是**当下状态快照** + **待办停车场** + **迭代注记**。
> 每次大迭代开始前读这里拿到起点，结束后更新这里。

---

## 定位

DayRail v0.7 · **单设备自用 + Google Drive 同步（小范围 beta）**；
v0.8 在路上 · 外部事件源（节假日）+ AI 复盘。

不做对外发布、不做移动端适配。多设备同步 v0.7 已开（仅我自己 + 两台
macOS Chrome 的 Drive `appdata`），不扩展到其它用户。AI v0.8 解封（详
见下方"v0.8 计划"），但保持 OpenAI-compat 通用接入 + 默认关闭，不绑
定任何特定 provider，也不引入云端依赖。所有工作围绕"我一个人每天用
得爽 + 跨设备无感 + AI 真有帮助时再开"展开。

---

## 🗺 整条路线图（从 v0.1 到 v0.9+）

> 单页大局观。每个版本一段 + 主题 + 核心交付。已落地的标 ✓，计划中的
> 标 🚧。详细当下状态见下方"✅ 已落地（v0.7）"段；v0.8 详细计划见
> "🚧 v0.8 计划中"段；停车场触发条件见"🅿️ 停车场"段。

### ✓ v0.1 · 静态 UI + 双语 ERD（产品形态拍板）

把所有页面用静态 mock 跑一遍，敲定视觉系统：Terracotta CTA、No-Line
Rule、四档 Surface tonal layering、圆角 token、非对称布局、Noto Sans
SC + Inter + JetBrains Mono 字体三件套、10 色 Rail 调色板、零
glassmorphism。Today Track / Cycle / Template Editor / Calendar /
Tasks / Pending / Review / Settings 八个视图都有 v1 静态形态。

### ✓ v0.2 · 数据层 + 事件流 + 真 check-in

接通真数据：SQLite-WASM + OPFS 存储、HLC 时钟、event-sourced reducer、
snapshot cadence。Today Track 接活 RailInstances，Reason toast（3 chip
+ Undo）上线，Edit Session v1（Template Editor 内批量回滚），React
Router v6 路由结构定型。**§5.5 大重构**：原 Projects view 改名 Tasks
view，Inbox built-in line，软删除 + Trash 全套。Chunk → Task 改名扫尾。

### ✓ v0.3 · Cycle Edit Session + 高级日历规则

Edit Session v2 扩到 Cycle View（CycleDay 切模板 / Slot drag-drop /
quick-create / orphan 守护全挂同 sessionId）。§5.4 CalendarRule 三种
kind（weekday / cycle / date-range）+ resolver + 高级 drawer 上线。
**v0.3.3**：Habits 真实装，HabitPhase 实体（简单 / 进阶两档）。

### ✓ v0.4 · 自用 MVP（每日真用）

心智校正 + 数据一致性大整理。**§5.5.0 锁定 habit 心智**："habit = 一
件反复发生的事"，不是任务桶。**§10 三轴速览 + §10.1**：Task.status
成完成状态单一真源。**§10.2 auto-task on-demand 物化**。**§10.3 配置
变更 purge 流程**（scope 可窄到 rail）。`HabitBinding` 实体取代
`Rail.defaultLineId`。多 task 同 slot 数据到 UI 全打通，TaskDetailDrawer
接入 Today / Cycle。**v0.4.1**：reschedule / unschedule 的 Review 记账
（§5.5.6）。**v0.4.3**：Daily Reflection 每日 Markdown journal（§4.1）。
**v0.4.4**：用户拖拽排序 `Task.slotOrder`。35 vitest cases 上线。

### ✓ v0.5 · effective-from revision 模型（§10.5）

"改 rail 之后过去日期完全不变" 实装。Rail / Template / CalendarRule /
HabitBinding 全部拆**身份壳 + revision 链**，13 个 writer 接受
`effectiveFrom?`，`EffectiveFromPicker` primitive 接到 Template Editor
/ Calendar drawer / Habit binding。所有核心选择器（materializer /
timeline / pending / autoTaskPlannedWindow / Review heatmap）revision-based。

### ✓ v0.6 · Google Drive 同步 · 快照通道（§7.6）

云端兜底落地。GIS token client + FedCM、access token 持久化、JSON
snapshot 推到 Drive `appdata` 隐藏文件夹（每用户自己的 Drive，不是部
署者的）。Push 触发四路：60s debounce / `visibilitychange='hidden'` /
`pagehide` / `beforeunload` keepalive。Pull 触发 v0.6.1 起补上：可见
性 probe + 连接 probe（之前只在冷启动）。**v0.6.2**：access token
持久化 + FedCM 启用 + popup-blocked 分类、dirty work 恢复 + 推送重试、
双向「立即同步」。冲突 surface = forced "diverged" 卡片（保留远端 / 覆盖远端）。

### ✓ v0.7 · Yjs CRDT 字段级合并（§7.7）

v0.6 暴露的两个稳态痛点（后台拉取盲区 + 冲突只能整盘覆盖）促成 wire
format 全量切换。**Yjs Y.Doc 单文档 + IndexedDB persistence + `.dryj`
wire format**（4-byte magic + 容器 version + meta +
`Y.encodeStateAsUpdate` 二进制）。冲突由 Yjs LWW + Lamport clock 自动
消解，**v0.6 那张分叉冲突卡片整段下线**。Pull 不再 reload。新增 5
分钟周期 metadata probe + `online` 事件即时 probe。「立即同步」改双
向。Settings → 同步加「下载本地快照」+「从快照导入」逃生口（同时承担
v0.6→v0.7 一次性迁移落地）。`runForcePush` + `samples-only` flag。
**~4600 行 SQLite-WASM/OPFS/HLC/event-sourced reducer 删除**，Drizzle
/ `@sqlite.org/sqlite-wasm` / `immer` 三个 dep 跟着移除。Edit Session
从 SQL 表改成内存 `Y.UndoManager`。dailyReflections 进同步流。**104
vitest cases**。Cycle UI 一连串打磨（off-rail row、contiguous-run
grouping、SideNav 重排、drag highlight per-section、per-cell insertion-line 清理）。

---

### ✓ v0.8 · 外部事件源 + 日历规则重构 + AI 复盘

> 详细设计：ERD §14（外部事件源）/ §5.4（日历规则）/ §6.6（AI 实施说明）。

- ✅ **v0.8.0 · 外部事件源 · 节假日 + 用户标注**（已 ship）—— 节假日（`data/holidays/{regionCode}.json` bundle + region multi-select，§14.2）+ 用户标注（`UserDayNote`，Calendar 上手动加备注，§14.3）共享 `ExternalEvent` 渲染层；都不进 task pipeline。三个 surface：Calendar / Cycle View / Today Track。详见 ERD §14。
- ✅ **v0.8.1 · §5.4 日历规则重构**（已 ship）—— 优先级从硬编码改为用户控制的全局排序（`UserProfile.calendarRuleOrder` drag-to-reorder）+ 新加 `external-event` rule kind 按属性匹配（节假日 / 调休 / 节庆 / 备注 + region 过滤 + 备注文本 contains/exact 筛选）。CalendarRulesDrawer 重做成单一规则列表 + 条件组形式的属性编辑器（节假日卡片 + 假日/非假日 子选 + 调休 + 我的备注卡 + 备注文本 datalist autocomplete）。drag handler 抬到 container 级别消除死区 + WYSIWYG drop。Calendar 单元格视觉减负（step-4 tint → step-3 + 删左 strip + 删顶 border + 实色 badge → 文字 + 小色点）。详见 ERD §5.4 + History 顶部条目。
- ✅ **v0.8.2 · AI MVP**（已 ship）—— OpenAI-compat 通用接入（Settings → AI · Base URL / API key / Model + 「测试连接」+ 「刷新可选模型」走 `/v1/models` autocomplete）+ 用户背景 Markdown blob（`userProfile.background`）+ Day / Cycle / Month 三 scope 复盘 AI 入口。流式输出走 **Vercel AI SDK**（`ai` + `@ai-sdk/openai-compatible` · 动态 import lazy load）。**输出形态：自由 Markdown + 「verbatim 引用」内联约定**，不再走结构化 JSON schema（dogfood 反转，理由：code-tuned model 持续 schema drift；Markdown + 引用即可达成 grounding）。System prompt 经 5 轮迭代到 **scene-staged「微信里给朋友回消息」persona**，显式承载 DayRail「**允许错过**」哲学（不评判、不下周建议、不 KPI 分析、提议 2-3 个温和小调整 + 把选择权交回）。API key 仅本机 `localStorage` 不入同步流（凭证心智 · 与 §7.1 一致）。AI 输出 ephemeral + 单字段 LWW 缓存最近一次（`DailyReflection.lastAiObservation` / `Cycle.lastAiObservation`，Month 走合成 cycle id `month-${YYYY-MM}`）。Day 反思空时显示 discoverability hint。详见 ERD §6.6 / §6.6.1 / §6.6.2 + History 顶部 v0.8.2 ship-notes 条目。

---

### ✓ v0.9 · 桌面端 + 永久 Drive 授权

> 详细设计：ERD §15（桌面端架构）。本版本反转 v0.7 时期"桌面端不做"
> 的判断 —— 1 个月 dogfood 暴露出 PWA + Google Drive + 无后端架构无法
> 摆脱小时级 OAuth 重新授权 UI，对日常用户不可接受。Tauri 壳让 sync
> 走 OS keychain + auth-code refresh token，物理上消除该问题，同时是
> Cycle View 拖拽 / 通知 / 文件选择器等其它 PWA 限制的总解。

- ✅ **v0.9.0 · Tauri 桌面端 + auto-update + Drive 永久授权**（已 ship · 2026-05-08）—— Tauri 2 壳子复用现有 Vite 产出 webview；同步层 Drive auth 切到 desktop OAuth pattern（authorization-code flow + PKCE + 本进程 loopback `TcpListener`，浏览器走 consent 后 OS keychain via `keyring` crate 存 refresh token；不用 `tauri-plugin-stronghold` 因为 stronghold vault 模型对一个 server-revocable capability 是 overkill）；access token 过期时 Rust 端 `drive_get_token` 静默续期，**用户不感知**。前端 `driveAuth.ts` 通过 `isTauriRuntime()` early-return 桥接到 Rust commands，PWA 路径完全不动。auto-update via `tauri-plugin-updater` + GitHub Releases · 启动时 + 每 30 分钟检查 `latest.json`（无 DayRail 后端 · 与 §7.1 一致）。Windows / Linux unsigned 直接 ship；**macOS 代码签名 + notarization deferred** 等 Apple Developer Program 通过后补（`release.yml` 头部 doc-comment 留了 6 个 `APPLE_*` secret 名 + 注释说明恢复方法）。**PWA 不下线** —— Web 版本继续作为公开演示 / 临时使用入口；推荐日常用户用桌面版。详见 ERD §15 / History 顶部 v0.9.0 ship-notes 条目。

---

### 🚧 v1.0 候选（值得专门讨论，不是停车场级别）

- **重审 sync 模型**（触发：v0.9.0→v0.9.1 数据丢失事故 · 2026-05-08）—— 当前架构是 push 阶段做 full upload（像 server-authoritative）+ pull 阶段做 CRDT 合并（纯 local-first），同一条数据流里既当 server 又当 peer，是这次事故几乎所有混乱的根源。**核心问题**：CRDT 没有"权威"概念，所有 client 的本地写都被视为同等可信，merge 时按 LWW per-key 机械裁决，"收敛到什么"不一定是用户想要的。**讨论入口**：(1) DayRail 的真实并发场景是不是真需要 CRDT —— 单用户跨设备**顺序使用**和 Notion-style 多人并发编辑的需求差很多，可能选了 Y.Doc 这个工具但没用上它的核心收益、只吃了它的复杂度；(2) 不引入后端的中间方案（pull-before-push 时窗 + replace-on-pull 取代 merge-on-pull + Drive `appdata` 多版本快照历史），把 Drive 升级成真权威；(3) 真后端方案（PostgreSQL + 服务端 ground truth），代价是后端运维 / 账户系统 / 隐私边界 / 离线 UX 复杂度，与 §7.1「无 DayRail 后端」立场冲突，需重新评估这个立场。**这件事重要到不能塞进停车场表格**，单独立项 v1.0 候选；触发条件不是某个产品信号，而是**讨论本身已经发生了**。下一步：开一个 doc-only PR 做完整 ERD §7.x 重写 + 三个方向的取舍分析 + 决策。

---

### 🅿️ v0.9+ 停车场（触发条件明确，捡起来不用从头想）

| 项 | 触发条件 | 设计草稿位置 |
|---|---|---|
| ICS 订阅（外部事件源 v3） | 我或 beta 用户提出非节假日的外源日历需求 | ERD §14.4 草稿 |
| HabitPhase 结构化目标（次数 / 强度 tag → match% 加权） | 真开始做分阶段训练计划 | ROADMAP 停车场 |
| 键盘快捷键扩展（Pending `d` / `.` / `j-k`） | 键盘用得多嫌鼠标慢 | ROADMAP 停车场 |
| Calendar 规则 inline 编辑（✎ 原地改） | 纯体验优化 | ROADMAP 停车场 |
| `Task.subItems` 重新拆 per-element Y.Array op | action 层愿意改成 insert/delete/update on inner Y.Array | ERD §7.7 + ROADMAP |
| Single-tab guard（`BroadcastChannel`） | 撞到第二例多 tab 数据打架 | ROADMAP 数据安全段 |
| IndexedDB 启动 sanity check + Error boundary | 撞到第一例 Y.Doc 反序列化失败 | ROADMAP 数据安全段 |
| AI 全局记忆（"软件记得我"） | **结论未定** —— 看 v0.8.2 ship 后 2-3 周真实使用，AI 反思的实际命中率 / 价值频率，再决定是否做 / 怎么做。当前思路：每次反思 AI 输出末尾可选附"要不要把这个记下"，accept 后入 `aiMemories` 同步流；UI 在 Settings → AI 加「AI 记忆」面板供查 / 编辑 / 归档。设计还没定，包括：是否独立 store 还是 background 扩展、记忆条目的 TTL / 衰减、隐私边界（默认随同步还是仅本机） | 待写到 ERD §6.7 草稿 |
| AI 多场景全开（Decompose / Observe / Habit phase） | v0.8.2 复盘 AI 真实使用频率 + 价值已证伪 / 已稳 | ERD §6 |
| 「AI 优化我的背景」按钮 | v0.8.2 ship 后看用户写的背景文本质量 | ERD §6.6.1 |
| §6.4 首次启动「可关闭 AI 引导卡」 | v0.8.2 ship 后两周看 AI 启用率，普遍未启用再设计 | ERD §6.4 |
| 推荐 model 文档化（opus-via-bridge 偏 structured · sonnet/gpt 更 prose） | v0.8.2 dogfood 已观察到，但样本只有 1 用户；扩 beta 用户后再写入 ERD §6.6 | ERD §6.6 |
| 定时自动备份 · 用户可见可配置 | 扩用户基数前 | ROADMAP 数据安全段 |
| action 层 + syncController 端到端集成测 | 扩用户基数前 | ERD §7.7 round 5/6/7 |
| WebDAV / iCloud / Dropbox 等替代同步后端 | 真实用户提出 Drive 不便 / 想自托管 —— v0.7 设计阶段判定 Drive 够用，v0.8.2 dogfood 后转向桌面端 + Drive refresh token 解决体验问题，多后端进一步停车 | ERD §7.3 |
| **PWA `KEY_CONNECTED` localStorage 在 SW 升级后被清的 bug** | 桌面端 ship 后 PWA 同步问题不再是用户主路径，bug 影响降级；v0.9 实装中如果路过 SW 升级路径顺手修也行 | `apps/web/src/lib/sync/driveAuth.ts:28` |

### ❌ 明确不做（自用 + 小范围 beta scope 内没价值）

- §7.3 多后端（iCloud / WebDAV / Dropbox）· Drive `appdata` 已够用（**注**：v0.8.2 dogfood 后增设了"桌面端 + 永久 Drive 授权"为 v0.9 主线，但这是 Drive 授权方式的升级而不是后端切换，§7.3 多后端依然停车）
- §7.5 端到端加密 / passphrase / 恢复码 / 双写 E2E 迁移
- §7.2.1 三档 `{仅数据 / 仅设置 / 全部}` 同步开关
- 字段级真冲突 UI（Yjs LWW + Lamport 自动决）
- §6 多 provider 适配层（OpenAI-compat 已覆盖 99%，特殊功能走桥接软件）
- AI 调用走 DayRail 自建后端代理（浏览器直连 + 用户 BYOK，没后端这事 v0.8 不变）
- 移动端响应式 / 首次运行引导 / E2E 测试框架（**反转**：原"Tauri 桌面壳不做"已移到 v0.9 主线 —— 见上方 v0.9 段，论据见 ERD History v0.9 方向锁定条目）

---

## ✅ 已落地（v0.7 · 可用）

### 数据模型（§10）

- **Yjs Y.Doc 单文档** + IndexedDB persistence + `.dryj` wire format
  （`packages/db/src/{yjs,dryj,yjsPersistence}.ts`）
- 顶层 `Y.Map` 对应每个 store（templates / rails / lines / tasks /
  signals / shifts / adhocEvents / calendarRules / cycles /
  habitPhases / habitBindings / dailyReflections + revision 表）；
  Zustand 通过 Y.Doc observer 派生 UI state
- Edit Session 机制（§5.3.1）· 改成 **Y.UndoManager 内存级回滚**，按
  `transact origin = sessionId` 收集，不再持久化（单用户 scope 可接受）
- Task.status 是所有完成状态的单一真源（§10.1）
- `HabitBinding` 实体承担 habit ↔ rail 关系
- Line(kind=habit) + HabitPhase 承担 habit 的名称 / 阶段
- Auto-task 幂等物化（`task-auto-{habitId}-{date}`）
- §10.3 配置变更 purge 流程（scope 可窄到 rail）
- `Rail.recurrence` **已移除** —— Template + CalendarRule + Binding.weekdays 三层足够
- `Rail.defaultLineId` **已移除** —— 让位给 HabitBinding
- `RailInstance` 概念在 v0.4 不存在；历史表在 schema 中早已清理
- **v0.7 切换时下线**：SQLite-WASM + OPFS + HLC 时钟 + event-sourced
  reducer + sessions 表 + snapshot 缓存全部删除；Drizzle /
  `@sqlite.org/sqlite-wasm` / `immer` 三个 dep 跟着移除（净 ~4600 行）

### §10.5 effective-from revision 模型（v0.5 ·已落地）

> "改 rail 之后过去日期完全不变" 的实装。设计动机 + schema + 读写
> 语义见 ERD §10.5。

- 每类版本化实体（Rail / Template / CalendarRule / HabitBinding）拆为
  **身份壳 + revision 链**。身份壳保留 `id` / `createdAt` / 可选
  `tombstone`；可变字段（name / time / color / templateKey / value /
  weekdays …）挪到对应的 `*Revision` 行。
- **读路径** —— `railAtDate(state, railId, date)` /
  `templateAtDate` / `calendarRuleAtDate` / `habitBindingAtDate` /
  `*ActiveOn(date)`。每个读路径选 `effectiveFrom <= date` 的最新
  revision；遇到 tombstone 在 `>= effectiveFrom` 上返回 undefined。
- **写路径** —— 每次 mutation 写一条新 revision。同 `(entityId,
  effectiveFrom)` 自动按 id (`rev-{kind}-{entityId}-{effectiveFrom}`)
  替换，不爆 row。删除 = 写 tombstone；新建在 tombstoned 实体上自动
  清 tombstone。
- **首次启动迁移** —— `migration.v05-revision-model` 事件 + 每个旧
  实体一条 `effectiveFrom='1970-01-01'` 的 sentinel revision。所有
  历史 read 命中 sentinel，渲染与 v0.4 完全一致。Idempotent。
- **核心选择器全部 revision-based** —— `resolveTemplateForDate` /
  materializer / `selectActiveTemplateKey` / `selectTodayTimeline` /
  `selectCheckinQueue` / `selectPendingQueue` /
  `autoTaskPlannedWindow` / `findAffectedFutureAutoTasks` 全走
  `*AtDate(slot.date)` —— 过去 task 行的 rail label / time / color
  按 slot 当日 revision 解析。
- **UI surfaces** —— Cycle View（railsByTemplate 按日期 build）/
  Review heatmap（rails 按窗口内出现日 build）/ Tasks list（rail
  label per slot.date）/ Today Track + Pending（per slot.date）/
  Reason toast displayName 全部用 revision 选择器。
- **"应用日期" picker** (§10.5 Phase 4) —— `EffectiveFromPicker`
  primitive (今天起 / 明天起 / 自定义日期…) 接到 Template Editor /
  Calendar Rules drawer / Habit binding。每次写都把选中的
  `effectiveFrom` 透传给对应的 writer；今天 / 过去日期还按旧 revision
  解析，新 revision 从指定日开始生效。
- 13 个 writer 接受 `effectiveFrom?: string`：upsertTemplate /
  deleteTemplate / createRail / updateRail / deleteRail /
  overrideCycleDay / clearCycleDayOverride / upsertWeekdayRule /
  upsertDateRangeRule / upsertCycleRule / removeCalendarRule /
  upsertHabitBinding / removeHabitBinding。

未做（v0.7.1+）：
- Power-user 模式 "edit the most recent revision in place" —— 默认
  路径覆盖 99% 用例，留作开放问题。
- 同 session 相邻 revision 合并 —— 实测 revision 表大小后再决定。
- `Task.subItems` 重新拆 per-element Y.Array op —— v0.7 切换期暂时回退
  到原子 LWW（详见 §7.7 落地纪要），等 action 层改成 insert/delete/update
  on inner Y.Array 再开 CRDT 字段级合并。

### 同步（§7.6 / §7.7）

- **v0.6 · Google Drive `appdata` 快照通道** —— GIS token client + FedCM、
  access token 持久化、debounce 60s push、`visibilitychange='hidden'` /
  `pagehide` / `beforeunload` keepalive 三路推送触发器、cold-start
  BootGate splash + "记住启动同步选择" radio
- **v0.7 · Yjs CRDT 字段级合并（全量切换）** —— wire format 从
  `dayrail-snapshot.json` 升级到 `dayrail-snapshot.dryj`（DRYJ magic +
  容器 version + meta + `Y.encodeStateAsUpdate` 二进制）；冲突由 Yjs
  LWW + Lamport clock 自动消解，**v0.6 那张分叉冲突卡片整段下线**
- **拉取触发器**（§7.7 新增）—— 5 分钟周期 metadata probe（仅
  visible + online 时跑） + `online` 事件即时 probe；承接 v0.6 已有的
  `visibilitychange='visible'` + 连接 probe
- **「立即同步」改双向** —— 先轻量 metadata 探测，远端领先则先 pull
  自动合并、再按本地 dirty 决定是否 push；状态条上 `⚠ 远端有更新` 与
  按钮链接同一动作
- **Pull 不再 reload** —— `applyRemoteDryj` 在内存里 `Y.applyUpdate`，
  保留 scroll 位置 / 弹窗 / in-flight 表单输入；BootGate linear-lead 同路径
- **逃生口（Settings → 同步）** —— 「下载本地快照」(`.dryj` 二进制) +
  「从快照导入」（替换本地 Y.Doc，走 stash + reset + reload）；同时承担
  v0.6→v0.7 一次性迁移落地、用户主动从 Drive history 回滚、Yjs 自动合并
  意外结果的兜底
- **`runForcePush`** —— "用本地覆盖云端" 按钮，跳过 preflight pull-merge，
  detached lineage 上传；进入时清掉所有 mid-flight push timer 防止 60s
  后旧 timer 把 rollback 抹掉
- **`samples-only` flag**（`identity.ts`）—— 区分"刚装样本数据"与"刚导
  入真数据"两个空快照场景，决定首次 connect Drive 走 replace 还是 merge；
  三个 pull surface（ConnectDrivePanel / BootGate / RuntimeSyncDialog）
  都走这个门
- **dailyReflections 进同步流** —— 单 Y.Doc + 单 wire 简洁性优先，
  appdata scope 隔离仍然成立；多用户场景再用 Yjs sub-document 做局部过滤
- 同步指示灯（SideNav 状态点：idle / syncing / warn / ok）+ Settings 同步页
  连接面板 + 备份历史 14 行滚动保留

### 核心界面

| 视图 | 状态 | 备注 |
|---|---|---|
| Today Track（§5.6） | ✓ | 每 task 独立行 / 独立操作 / check-in 条保留 |
| Cycle View（§5.3） | ✓ | 多任务 slot、cell 间拖拽、§5.3.1 Edit Session、orphan 守护 |
| Tasks（§5.5） | ✓ | 左栏树 + 过滤 + 搜索 + 详情抽屉 + Soft-delete / Trash |
| Habit detail（§5.5.0） | ✓ | 14 天节奏带 + 点击回填 + phase bands + 每 phase match% + schedule |
| Pending（§5.7） | ✓ | 行点击开详情、改期 popover、reason toast |
| Review（§5.8） | ✓ | Day/Cycle/Month 切换、period-over-period delta、per-row + per-phase stats |
| Calendar（§5.4） | ✓ | 月视图 + 4 种 rule CRUD（delete+recreate） |
| Template Editor（§5.4） | ✓ | Tab + 时间轴 + Gap chip + §5.3.1 会话回滚 |
| Settings（§5.9） | ✓ | 外观 / 同步（v0.6 Drive · v0.7 Yjs CRDT）/ AI 占位 / 高级（含备份 + 升级备份对话）/ 关于 |
| Backlog drawer（§5.3 D8） | ✓ | 已升格为全局 · `g b` 快捷键 · SideNav 入口 · Line picker 快速建 |
| Daily Reflection | ✓ | 每日 Markdown journal · Today Track + Cycle View 内联 + Review（Cycle / Month）展开 |

### Cross-cutting

- 备份：Settings → 高级 → Backup · 下载 JSON / 导入 JSON
- 软删除 / Trash：Line / Task / AdhocEvent 三级
- Reason toast（§5.2）· 3 枚快速 tag chip + Undo
- Shift 标签历史（recordShift + 审计）
- 路由：react-router-dom v6，SPA fallback
- PWA：Service Worker / manifest 已生成（未测"加到主屏"流程）
- 深浅主题：tokens 就绪，设置页能切

### 测试

10 个 suite · 104 个 case（`pnpm test` 从 repo 根跑）：

```
packages/core/src/__tests__/
├── autoTask.test.ts          · 11 case · §10.3 purge selectors
├── dryj.test.ts              · 10 case · §7.7 .dryj 容器 codec round-trip
├── materializer.test.ts      · 12 case · auto-task 生成路径 + §10.5 freeze
├── reflection.test.ts        ·  2 case · 每日 Markdown journal CRUD
├── reschedule.test.ts        ·  8 case · §5.5.6 reschedule 触发规则
├── revisions.test.ts         · 12 case · §10.5 atDate 选择器
├── samplesOnlyFlag.test.ts   · 11 case · §7.7 samples-only 生命周期
├── today.test.ts             · 15 case · timeline / check-in / pending
├── unschedule.test.ts        ·  7 case · §5.5.6 unschedule 触发规则
└── yjs.test.ts               · 16 case · Y.Doc ↔ flat state hydrate / dedupRevisions
```

覆盖重点：多任务排序、状态过滤、时间窗口、binding × template × weekdays
三层交集、`binding.createdAt` 日期 floor、§10.5 跨 cutover 的 freeze
（rail 改 effectiveFrom='YYYY-MM-DD' 后，物化窗口 < 该日的 task 用旧
revision、>= 该日的用新 revision）、tombstone 截止生效；§7.7 `.dryj`
容器编解码一致性、Y.Doc 与 flat state 双向 hydrate、samples-only flag 在
seed / import / first-write / replace 四个生命周期点的开关。

未覆盖（已知缺口）：action 层 + syncController + samples-only flag 端到
端集成测。单用户 beta 阶段接受我自己手动验证；ERD §7.7 round 5/6/7 review
都 flag 了这件事，扩用户基数前补。

---

## v0.8 详情

> v0.8 把"自用 scope"从"任务调度 + 同步"扩到"任务调度 + 同步 + 外部
> 事件源 + 日历规则重构 + AI 复盘"。设计动机见 ERD §14（外部事件源）
> / §5.4（日历规则 v0.8.1 重构）/ §6.6（AI v0.8.2 实施说明）。
>
> v0.8.0 + v0.8.1 已 ship · v0.8.2 在路上。下面三个子段保留各自的实
> 施细节作为档案。

### ✅ v0.8.0 · 外部事件源 · 节假日 + 用户标注（已 ship）

> ERD §14 设计：v0.8.0 引入"日历这天上有什么事，但不是要做的事"这一
> 类标注。两个 source 共上 —— **节假日**（§14.2，外源 bundle 数据集，
> region multi-select）+ **用户标注**（§14.3 新，内源用户在 Calendar
> 手动加备注）。共享 §14.1 `ExternalEvent` 抽象 + 渲染层；不进 task
> pipeline。ICS 订阅留 v0.9+ 停车场（§14.4 草稿存档，避免将来再翻一遍）。

**通用基础设施**

- **`ExternalEvent` 抽象**（ERD §14.1）—— `{ sourceId, date, label, kind, regionCode?, meta? }`，渲染层只认这个接口；`kind` enum 加 `'user-note'`（除了 `holiday | observance | event`）
- **`selectExternalEventsOn(date)` selector** —— 聚合所有 source（holidays + user-notes，将来 + ICS）
- **三个渲染 surface**（共用）：
  - **Calendar 月视图**：节假日 label / 用户标注 chip 同日同时显
  - **Cycle View 日期单元格**：节假日色点 + 用户标注色点叠加（多个折叠 `…+N`），hover 显完整列表
  - **Today Track 顶栏**：metadata 行带今天的节假日 + 用户标注
- **bonus**（v0.8.0 顺手做）：Review · Day metadata 行 + 进 AI 复盘 prompt context
- **不参与**：task 物化 / §10.3 purge / §10.5 revision / completion stats / Auto-task pipeline

**Source 1 · 节假日（§14.2）**

- **内置数据集** —— `data/holidays/{regionCode}.json`，首批 `zh-CN`（先把我自己用的覆盖了），按需扩 `en-US` / `ja-JP` / `zh-HK` / `zh-TW` 等
- **region multi-select** —— Settings → 外观 → 节假日 multi-select；「跟随系统 region」按钮按 `Intl.DateTimeFormat().resolvedOptions().locale` 推断；选中的 region 进 Y.Doc `userProfile.enabledHolidayRegions`
- **数据更新策略** —— 每年 12 月开 PR 加明年 JSON，版本号小升。运行时不做网络刷新

**Source 2 · 用户标注（§14.3 新）**

- **`UserDayNote` 实体** —— `{ id (ULID), date, label, color?, createdAt, updatedAt }` 存 Y.Doc top-level `userDayNotes` Y.Map（**key = id，多 note 同日自然 CRDT 合并** —— 避免 keyed-by-date 撞 LWW 静默丢失）
- **编辑入口** —— Calendar 月视图点日期 → 现有 popover 在 CalendarRule 区域上方加「备注」段：已有 chip 列表（点 chip 可改 / 删）+「+ 添加备注」按钮（label 必填 + color 可选，默认中性灰）
- **chip 样式** —— 描线 + 用户色（`meta.color` 或默认中性），与节假日实色 chip 视觉区分但 chip 形态一致
- **Cycle View 上点 chip** —— 跳到 Calendar 月视图聚焦该日（不在 Cycle 内编辑，避免模态复杂度）

未覆盖（v0.8.x+）：
- ICS 订阅（详见 ERD §14.4 v0.9+ 停车场草稿）
- 自定义节假日（用户加自己单位放假日）—— 当前 §5.4 CalendarRule 已能表达"指定日期改 template"，先用那个；真撞到痛点再独立做
- 用户标注的长描述 / Markdown body —— 用 §4.1 DailyReflection 替代
- 用户标注的提醒 / 倒计时 / 跨年重复 / 跨多日同标注 —— 留 v0.8.x

### ✅ v0.8.1 · §5.4 日历规则重构（已 ship）

> ERD §5.4 重构 + §10 类型变更。设计动机：硬编码 priority（single-date
> 100 > date-range 50 > cycle 30 > weekday 10）无法表达用户的实际偏好；
> 同时缺少"按属性匹配"的规则形式来表达"所有节假日 → restday"这种
> 跨多日的约束。

**优先级模型重写**

- `CalendarRule.priority` / `CalendarRuleRevision.priority` 改可选（弃用）
- 新增 `UserProfile.calendarRuleOrder: string[]` —— 用户拖拽出的全局优先级链
- Resolver：先按 order list 走，未在 list 中的退回 legacy `priority` + `createdAt`（隐式迁移，老 rule 直到用户碰一下规则抽屉才被纳入）
- 5 个 upsert action（overrideCycleDay / upsertWeekdayRule / upsertDateRangeRule / upsertCycleRule / upsertExternalEventRule）自动 `prependToCalendarRuleOrderY`（idempotent）；2 个 remove action（removeCalendarRule / clearCycleDayOverride）自动 filter 出 order list

**`external-event` 第五种 rule kind**

- `CalendarRuleExternalEvent` value：`{ kinds: ExternalEventMatchKind[], regions?, noteLabelFilter?, templateKey, label? }`
- `ExternalEventMatchKind = 'holiday' | 'observance' | 'makeup-workday' | 'user-note'`
- 命中条件：当天 ExternalEvent 至少一条匹配 `kinds` + 可选 region 过滤 + 可选 note label 过滤（`{ mode: 'contains' | 'exact', query }`，仅对 user-note kind 生效；空 query 降级"匹配任意备注"）
- 即"所有节假日 → restday"一条规则覆盖所有日期，将来 §14.4 ICS 订阅 ship 也自动可被这条规则匹配（resolver 不用改）

**CalendarRulesDrawer · 全单一规则列表 + 条件组**

- 顶部仅一个「规则列表」section · 全 CRUD：drag-to-reorder + ✎ inline edit + ✕ delete + + 添加规则 picker
- 5 个 form 都接受 `initial?` props 支持原地编辑（id-stable upsert，不删了重建）
- 拖拽 handler 抬到 container 级别：消除原来 per-row handler 的死区（光标飘出第一行上方 / 末行下方就触发不到 dragOver）；上 / 下半区检测决定插到 target **之前**或**之后**
- WYSIWYG drop：drop 时不读 React state（async），从事件 `clientY` + `currentTarget.getBoundingClientRect()` 重新算落点；视觉指示器可能短暂滞后但落点永远跟光标一致
- ExternalEventForm 改条件组：节假日卡片（含 假日 / 非假日 二级 multi-select，对应 holiday / observance kinds 拆分）/ 调休 / 我的备注卡（含 contains / exact toggle + 输入框 + datalist autocomplete 拉用户已写的备注 label）+ 区域过滤共用段（仅在节假日 / 调休 卡存在时显示）
- ruleSummary 跟分组对齐：`节假日`（含两子）/ `节假日(假日)` / `节假日(非假日)` / `调休` / `备注⊇「query」` 等

**Calendar 视觉减负**

- cell tint step-4 → step-3（更淡），删左 5px strip + 删顶 2px border + 实色 step-9 badge
- 模板 badge 改 dot + ink-secondary 文字，去掉热力图感
- 删 stale Footer（"优先级 · 单日覆盖 → 星期启发"已过时；"ERD §5.4 · v0.2 live"是 dev-internal）

**测试**：`calendarRulePriority.test.ts` 14 case，覆盖：
- external-event 各 kind 匹配 + 区域过滤 + noteLabelFilter contains/exact
- resolver 在 calendarRuleOrder / legacy priority / 缺 userProfile / 任意 fallback 各分支
- 总数 147 / 13 suites（v0.8.0 是 129 / 12 → +14 case + 2 个其它 suite 调整）

未覆盖（v0.8.x+）：
- 同一 rule 用不同条件做不同 narrowing（per-condition regions 等）—— 当前数据模型 regions / noteLabelFilter 是 rule 级共用
- AI 多 provider 适配层 / fallback chain UI

### ✅ v0.8.2 · AI MVP（已 ship）

> 设计锁定 2026-05-07（PR #9 doc-only），代码 PR #10 同日 ship。
> 设计经历多轮 dogfood 反转 —— 详细设计 + 反转纪要见 ERD §6.6 / §6.6.1 / §6.6.2 + History 顶部 v0.8.2 ship-notes 条目。

**最终交付的形态**（与原设计锁定有几处实质性反转，详见下方）：

- **用户背景 Markdown**（`userProfile.background`）—— Settings → AI → 「我的背景」 MarkdownField · 心智对标 Claude Code `CLAUDE.md` · AI 调用前 prepend 到 system prompt
- **OpenAI-compatible 通用接入** —— Settings → AI 三字段（Base URL / API key / Model）+ 「测试连接」+ 「刷新可选模型」（走 OpenAI-compat `/v1/models` autocomplete · 容忍 `{data:[]}` / `{models:[]}` / 裸数组等多种 envelope）
- **流式输出走 Vercel AI SDK**（`ai` + `@ai-sdk/openai-compatible`）· 动态 import 让 SDK chunk lazy load · 不开启 AI 的用户冷启动 bundle 不变
- **三个 scope 都有 AI 入口**：
  - **Day**：Today Track / Review · Day 的 reflection 块底部「让 AI 帮我看看」按钮（UX gate：aiEnabled + reflection 非空）+ 反思为空时显示 discoverability hint
  - **Cycle**：Review · Cycle 视图 reflection log 上方
  - **Month**：Review · Month 视图 reflection log 上方（合成 cycle id `month-${YYYY-MM}` 作为缓存 key）
- **错误展示带 body excerpt 抽屉** —— 503 / 401 / parse-error 等都能看到 provider 真实回的 body（前 500 字）
- **§6.5 隐私 confirm modal** —— 显示 token 估算 + payload summary + 数据较多时警告

**输出形态最终决定：自由 Markdown + 内联「verbatim 引用」约定**

设计锁定时定的 `{ headline, observations: [{ claim, from_data }], questions_to_sit_with }` 结构化 JSON schema，dogfood 第一次后**整体反转**。理由：
- Code-tuned model（如 `claude-opus-4-7` via `claude-bridge`）持续 schema drift（返回 `finding / severity` 等 lint-style 字段而非 canonical schema）
- alias map + 容忍 validator 越加越多，复杂度跑过价值
- prose 是 model 的强项，让它走自然写作 + 引用约定，反而更稳

新形态：散文段落 + 关键 claim 后跟 `「verbatim quote from input」` 中文方括号引用 —— 用户扫一眼引用就能判断 AI 是否 fabricated。删掉了 `validateObservationJson`（~150 行）+ alias map + 17 个测试。

**System prompt 经 5 轮迭代到「微信里给朋友回消息」 scene-staged persona**

dogfood 撞了多轮"输出读起来像 PM 周报"的问题。最终路径：
1. Round 1：禁词（黑洞 / 拖低 / 必须 / 下周期建议）—— 模型走绕路用「严重欠账」等
2. Round 2：禁 markdown bold label —— 模型用独立短句 label 绕（「主线 / 我看到的」）
3. Round 3：加 anti-example —— 用户反馈这是反向投毒（"don't think about a pink elephant"）
4. Round 4：删所有 anti-example，换成 persona-driven（"warm friend / counselor / kind elder"）—— 仍偏 structured
5. Round 5：scene-staging —— 把 persona 升级为具体场景「几分钟前你朋友在微信里给你发了消息，你正在打字回 ta」+ 显式 ABOUT THE MEDIUM 段对比 chat reply vs report。 medium 的社交常识压住了 dashboard 形态先验

最终 system prompt 显式承载 DayRail「**允许错过**」哲学：不评判、不下周建议、不 KPI 分析、提议 2-3 个温和小调整（也许 / 可以试试）+ 把选择权交回（"你比我更了解自己"）。

**API key 仅本机 `localStorage` 不入同步流** —— 与 ERD §7.1 凭证心智一致，与 Drive OAuth token / WebDAV 密码同档。Base URL / Model / Background 等"通道里的设置"继续走 Y.Doc 同步流。详见 ERD §6.6『userProfile 字段分流原则』。

**AI 输出 ephemeral + 单字段 LWW 缓存最近一次**：
- Day → `DailyReflection.lastAiObservation`
- Cycle → `Cycle.lastAiObservation`
- Month → 合成 `Cycle` 实体（id `month-${YYYY-MM}` · `upsertCycle` v0.8.2 接受可选 id + endDate）

形态：`{ generatedAt, model, markdown }` —— 直接缓存模型返回的 markdown 字符串。

**model-tone 兼容性观察**

dogfood 发现 `claude-opus-4-7 via claude-bridge` 即使经过 5 轮 prompt iteration 仍偏向 structured 输出（独立短句 label）。换 OpenRouter 的 `claude-3-5-sonnet` / `gpt-4o` 通常 prose 更流畅。这是 RLHF 训练的天花板，不是 prompt 能继续解决的。当前样本只有 1 用户，扩 beta 用户后再决定是否文档化默认 model 推荐。

**测试基线**：147 → 203 / 13 → 15 suites（+56 case · +2 suite · `aiClient.test.ts` 14 case + `aiPrompts.test.ts` 42 case）。

未做 / 留 v0.8.3+：
- AI 多场景全开（Decompose / Observe）—— 触发条件：v0.8.2 ship 后真实使用 6 周看 Review AI 价值
- §6.4 一次性引导卡 UI —— 触发条件：ship 后两周看 AI 启用率
- 「AI 优化我的背景」按钮 —— 触发条件：ship 后看真实背景文本质量
- AI 全局记忆（"软件记得我"）—— **结论未定**，先停车到 v0.9 candidate 等真实使用 2-3 周 + dogfood 出有具体的"我希望 AI 记住 X 而不忘 Y"用例。当前思路：每次反思 AI 输出末尾可选附"要不要把这个记下"，accept 后入 `aiMemories` 同步流。详见上方 v0.9+ 停车场表
- Provider 特有功能（OpenRouter fallback chain / Anthropic prompt caching）—— 用户要的话自己在 endpoint 那一层做（`claude-code-router` 自带）

---

## 🅿️ 停车场（随时可以捡起来）

### 值得做 · 自用体验提升

- **HabitPhase 结构化目标**：当前 Phase 只有 name + description + startDate。
  可加"目标次数 / 周"、"目标强度 tag"等 → Review 的 match% 可以按
  phase 目标加权。触发条件：我真开始做分阶段训练计划类。
- **键盘快捷键扩展**：Pending 行 `d`=完成、`.`=归档、`j/k` 上下移动；
  Today Track 行级操作同理。触发条件：键盘用得多嫌鼠标慢时。
- **Calendar 规则 inline 编辑**：当前 delete + recreate，高级 drawer 里
  加 ✎ 按钮原地改。纯体验优化，非阻塞。
- **ICS 订阅 · 外部事件源 v2**（v0.9+）：用户填 `webcal://` 或
  `https://...ics` URL，`ical.js` 解析，ETag / If-Modified-Since 缓存，
  刷新间隔可配（默认 1 天）。CORS 走 Vercel serverless 反代
  `/api/ics-proxy`。设计草稿见 ERD §14.4。触发条件：我或某个 beta 用
  户提了一个**非节假日**的外源日历需求（学校学期 / 球队赛程 / 单位
  会议室占用 / 周期性会议）—— 在那之前，节假日 bundle 已经覆盖 90%
  实际诉求。
- **「AI 优化我的背景」按钮**（v0.8.1+）：用户随手写"我是研究生 / 周
  末跑步 / 备考"，按一下让 AI 扩成结构化版本。设计草稿见 ERD §6.6.1。
  触发条件：v0.8.2 ship 后看真实用户写的背景文本质量。
- **AI 多场景全开（Day / Cycle / Habit phase）**（v0.8.1+）：v0.8.1 只
  做一个，剩下的两个等第一个跑通后体验真有用再开。设计骨架在 ERD
  §6.1 / §6.6.2。

### 防回归 · 可做可不做

- **Backup round-trip 集成测**：「下载本地快照」`.dryj` → 「从快照导入」
  → 状态对比。涉及 IndexedDB / `location.reload` 比较难纯单测，需要
  Playwright 或 jsdom + 手搭。这条与上一节"数据安全 / 弹性"第 3 项
  集成测覆盖范围有交集。
- **Error boundary**：当前崩了白屏。自用可以接受，真要加就
  `react-error-boundary` 包一下主 `<main>` 并给个"重载 / 清空数据 /
  从快照导入"逃生口。

### 数据安全 / 弹性 · 对外发布前应当补

> v0.7 切到 Yjs + IndexedDB + Drive `.dryj` 之后，原本的几条 SQLite/OPFS
> 专属护栏（`PRAGMA integrity_check`、OPFS sync-access handle 锁竞态、
> SQLITE_CORRUPT 兜底）都不再适用。**真正的远端兜底（§7 同步）已经在
> v0.7 上线**，所以这一节从"上线同步前的护栏"改成"扩用户基数前补的
> 边角"。剩下值得做的：

1. **`PRAGMA integrity_check` 的 IndexedDB 等价物** —— 启动时对 Y.Doc
   反序列化做一次 sanity check（top-level Y.Map 都在 / 关键 store 不为
   空 / `dedupRevisions` 跑得通）。失败时跳"从 Drive / `.dryj` 恢复"页，
   而不是白屏。
2. **Error boundary** —— 当前崩了白屏。自用可以接受，真要加就
   `react-error-boundary` 包一下主 `<main>`，给个"重载 / 从快照导入 /
   连 Drive 拉远端"三个逃生口；与上一项合并实现。
3. **action 层 + syncController + samples-only flag 端到端集成测**
   —— ERD §7.7 round 5/6/7 review 都 flag 了这件事。Yjs 切换以来出过
   2 例数据破坏 bug（"round 3 修了但没修对" + "round 5 引入新 bug"），
   手动验证没接住。Playwright 或 jsdom + 手搭，覆盖 first-connect /
   replace-vs-merge / force-push / undoEditSession 几个高风险路径。
4. **Single-tab guard**（影响降级，仍可做）—— v0.6 时代的 OPFS
   sync-access handle 锁竞态在 v0.7 不存在了（IndexedDB 不持文件锁），
   但多 tab 同时编辑还是会让 Yjs observer 在两个 tab 之间打架（同源
   IndexedDB 共享但 Y.Doc 实例独立）。`BroadcastChannel` 心跳 + 软门
   仍然是最便宜的解。

> 触发条件：从"我自己 + 两台 Chrome"扩到任何额外用户之前。

### 明确不做 · 自用 scope 内没价值

- ❌ §7.3 多后端（iCloud / WebDAV / Dropbox）· Drive `appdata` 已够用
- ❌ §7.5 端到端加密 / passphrase / 恢复码 / 双写 E2E 迁移 · 单用户威
  胁模型未变
- ❌ §7.2.1 三档 `{仅数据 / 仅设置 / 全部}` 同步开关
- ❌ 字段级真冲突 UI（"两端改同一字段且新值不等"）· Yjs LWW + Lamport
  自动决，体感出问题再独立设计 surface
- ❌ §6 多 provider 适配层（hardcoded Anthropic SDK / OpenAI SDK 区分）·
  OpenAI-compat 一份 fetch 已覆盖 99%，特殊功能走桥接软件
- ❌ AI 调用走 DayRail 自建后端代理 · 浏览器直连 + 用户 BYOK，没后端
  这事 v0.8 不变
- ❌ §6 v0.4 §6.3 的 fallback chain UI（多模型多选 + 拖拽排序 + 远端 JSON
  清单）· fallback 改由 endpoint 层（`claude-code-router` / OpenRouter
  自身）承担，不在 DayRail 重做
- ❌ 移动端响应式
- ❌ 首次运行引导 / 空状态文案 / 新手教程
- ❌ 桌面端 Tauri 壳
- ❌ E2E 测试框架

---

## 🚨 重要注记（给未来的自己）

### 数据安全

- v0.7 起本地存 **IndexedDB**（`yjsPersistence.ts` 把 Y.Doc 序列化到
  IndexedDB），Drive `appdata` 里同步一份 `.dryj`。两边都丢才丢数据。
- 单设备保险：Settings → 同步 → **「下载本地快照」**（`.dryj` 二进制）；
  v0.6 那个 Settings → 高级 → JSON 导出仍然在，作为可读格式留底
- 「从快照导入」是**整体覆盖**，不是合并 —— 用"从备份恢复"的心智用它；
  pull-from-Drive 走的是 `Y.applyUpdate` 自动合并，不会覆盖
- **`.dryj` 容器版本兼容**：reader 看到不认识的容器 version 直接报错并
  指引升级，而不是误读（`packages/db/src/dryj.ts`）。Y.Doc 内部 schema
  改动靠 Yjs 自身的 LWW + 字段宽容兜底
- **v0.6 → v0.7 迁移路径**：一次性脚本 `tools/migrate/migrate-json-to-yjs.ts`
  + Settings 「从快照导入」上传产物 `.dryj`。产品代码**不**带"检测旧
  schema → 自动转换"逻辑（详见 ERD §7.7）
- **历史 `SQLITE_CORRUPT` 事件已不复发生**（v0.7 没有 SQLite 也没有
  OPFS sync-access handle）。新的 corruption 表面会是 IndexedDB 读出
  的 Y.Doc 反序列化失败 —— 暂未撞到，护栏见上方停车场第 1 项

### 会炸的边界

- **多 tab 同源**：v0.7 没有 OPFS 锁了，`importLocalData` 不会因为另
  一个 tab 在用而 reset 失败；但两个 tab 同时编辑会让 Yjs observer 在
  两个独立 Y.Doc 实例间打架（同源 IndexedDB 共享、Y.Doc 不共享），
  最后一次 persist 赢。Single-tab guard 还没做（停车场第 4 项）
- **`Task.subItems` 是原子 LWW，不是 CRDT**：v0.7 切换期回退，并发改
  同一 task 的 subItems 会按 Yjs LWW 选一边，另一边丢。详见 ERD §7.7
  落地纪要 + 上文"未做（v0.7.1+）"
- **Y.Doc payload 宽容**：每次给 `Y.Map` 加新字段时确保 `readFlatStateFromDoc`
  能容忍老 doc 没这个字段。v0.5+ 的 reducer "字段 `?.` / `??` 兜底"
  心智在 Y.Doc 读路径继续生效
- **sessionStorage 承接 import**：`importLocalData` 靠 sessionStorage
  暂存 bundle，刷掉 IndexedDB 后再读。如果 sessionStorage 也清了，
  import 会静默失败，页面按默认种子启动。发生概率低但不是零

### 不该重蹈的坑

- **`Rail.recurrence` vs Template 的空交集**（已修）：过滤器层数 >
  必要时只会制造 trap。新加任何"第二把过滤刀"前先问"这和现有层能
  不能交集为空、用户能看出来吗"。
- **`binding.createdAt` 毫秒级 vs 日期级比较**（已修）：时间戳是毫秒，
  日期比较必须先 floor 到本地日期，否则"15:00 建的 binding 不覆盖
  同天 9:00 的 rail"。
- **"改期"不应该保留 deferred 状态**：`scheduleTaskToRail`/
  `scheduleTaskFreeTime` 现在会自动 flip `deferred → pending`。这是
  全局核心语义，任何 reschedule 入口都受影响。

### 代码味道

- **Zustand selector 规则**：`useStore((s) => s.rails)` 订阅 raw map，
  派生过的 array / object 走 `useMemo`。否则每次 render 都返回新引用，
  React 18 下会无限 rerender。踩过两次，memory 里记着。
- **Y.Doc 字段宽容**：`readFlatStateFromDoc` 对 Y.Map 字段宽容（`?.` /
  `??`），因为老 doc / 多设备 partial state 上字段可能不存在。这取代
  了 v0.6 之前 reducer 对历史 event payload 的宽容心智，原则不变。

---

## 🧭 下一轮起点（如果还有）

### v0.8 主线（已收官）

- ✅ **v0.8.0 · 外部事件源 · 节假日 + 用户标注** —— PR #5 已 ship
- ✅ **v0.8.1 · §5.4 日历规则重构** —— PR #6 已 ship；后续 PR #7 修了 off-rail label 列宽溢出
- ✅ **v0.8.2 · AI MVP** —— PR #9 doc-only 设计锁定 → PR #10 代码 ship → PR #11 doc-only ship-notes 收尾。3 个 PR 闭环。完整反转纪要见 ERD §6.6 / History 顶部 v0.8.2 ship-notes 条目。

### v0.9 主线（已收官）

- ✅ **v0.9 桌面端方向锁定** —— PR #12 doc-only ship；ROADMAP 桌面端从❌反转到 v0.9 主线 / ERD 加 §15 桌面端架构。
- ✅ **PR-A · Tauri 2 scaffold** —— PR #13 已 ship。
- ✅ **PR-B · auto-update infrastructure** —— PR #14 已 ship；`tauri-plugin-updater` + GitHub Release pipeline + minisign 签 updater bundle（不是 Apple cert）。
- ✅ **PR-C · Drive 授权切到 desktop OAuth pattern** —— PR #15 已 ship；authorization-code flow + PKCE + `keyring` crate 存 refresh token 到 OS keychain。
- ✅ **桌面图标 × 2** —— PR #16 修原 SVG 嵌套 transform 数学 bug（黑屁股根因）→ PR #17 加 macOS HIG 标准 ~10% 透明 safe-area + 暖底 + 75% 画布填充。
- ✅ **v0.9.0 release** —— PR #18 bump 三处 desktop 版本号到 0.9.0 → 第一次 tag push 失败（PR #19 修 CI pnpm 10 → 7 匹配 lockfile v5.4；PR #20 整个删掉 `APPLE_*` env 块因 tauri-action 把 set-but-empty 当 "请导入 cert" 处理）→ 第三次 tag push 4/4 平台全绿 → 草稿 release 自动生成 → CLI publish。完整 ship-notes 见 ERD History 顶部 v0.9.0 条目。
- 🟡 **PR-D 平台抛光**（菜单栏 / dock / 文件选择器 / 系统通知）—— 可选，dogfood 攒到信号再做。
- 🟡 **macOS 代码签名 + notarization** —— Apple Developer Program enrollment 进行中，下个 v0.9.x 补。`release.yml` 头部已留 doc-comment 块说明恢复哪 6 个 `APPLE_*` env 字段。

### 接下来可能做（v0.9 ship 后的候选 · 触发条件未到）

- v0.9.1 候选：通知 API / 文件选择器 / 全局快捷键等 PWA 限制项的桌面端补全（dogfood 攒到信号再做）
- v0.9.x 候选：**AI 全局记忆**（结论未定）/ AI 多场景全开（Decompose / Observe）—— 等 v0.8.2 累积更多反思数据再决定
- v0.8.3 小修候选：§6.4 AI 引导卡 UI / 「AI 优化我的背景」按钮 / 推荐 model 文档化 —— 桌面端 ship 优先；这些慢慢来

### 通用回归 checklist（每轮迭代结束都跑一遍）

1. `pnpm dev` · 打开 Today Track，把今天当一天用一遍（check-in、改期、
   完成、归档）· 验证没有破
2. `pnpm test` · 203 个测试都绿（v0.8.2 ship 后基线，比 v0.8.1 的 147 多 56 个 AI 相关 case）
3. Settings → 同步 → 「下载本地快照」保存一份 `.dryj`（v0.7 起的兜底
   口径；v0.6 那个 JSON 导出在 Settings → 高级仍然在）
4. Settings → 同步 → 「从快照导入」用刚保存的 `.dryj` 走一遍 round-trip
   （`importLocalData` → reset + reload）
5. 读 `ERD.*.md` 的 Status 行里上一轮 History · 看上一次停在哪

新需求进来时：
- 先问"自用 scope 变没变"· 没变就继续按本文档的"停车场"和"不做"
  分流
- 大改 data model 前读 §10 · 小改 UI 直接下手 + 测试兜底
- ERD 是 append-only 的设计日志，`ROADMAP.md`（本文档）是可以重写的
  状态快照 —— 每轮迭代结束重写一次
