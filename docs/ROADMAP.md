# DayRail · 当前状态 & 后续迭代

> 最后整理：2026-05-06
> 本文档与 `ERD.*.md` 分工：ERD 是设计意图 + 历史决策链（append-only
> 记录），本文档是**当下状态快照** + **待办停车场** + **迭代注记**。
> 每次大迭代开始前读这里拿到起点，结束后更新这里。

---

## 定位

DayRail v0.7 · **单设备自用 + Google Drive 同步（小范围 beta）**。

不做对外发布、不做移动端适配、不做 AI 上线。多设备同步 v0.7 已开（仅
作者本人 + 两台 macOS Chrome 的 Drive `appdata`），不扩展到其它用户。
所有工作围绕"作者一个人每天用得爽 + 跨设备无感"展开。这个定位会持续，
除非作者本人另行决定。

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
端集成测。单用户 beta 阶段接受作者手动验证；ERD §7.7 round 5/6/7 review
都 flag 了这件事，扩用户基数前补。

---

## 🅿️ 停车场（随时可以捡起来）

### 值得做 · 自用体验提升

- **HabitPhase 结构化目标**：当前 Phase 只有 name + description + startDate。
  可加"目标次数 / 周"、"目标强度 tag"等 → Review 的 match% 可以按
  phase 目标加权。触发条件：作者真开始做分阶段训练计划类。
- **键盘快捷键扩展**：Pending 行 `d`=完成、`.`=归档、`j/k` 上下移动；
  Today Track 行级操作同理。触发条件：键盘派作者用得多嫌鼠标慢。
- **Calendar 规则 inline 编辑**：当前 delete + recreate，高级 drawer 里
  加 ✎ 按钮原地改。纯体验优化，非阻塞。

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
   作者手动验证没接住。Playwright 或 jsdom + 手搭，覆盖 first-connect /
   replace-vs-merge / force-push / undoEditSession 几个高风险路径。
4. **Single-tab guard**（影响降级，仍可做）—— v0.6 时代的 OPFS
   sync-access handle 锁竞态在 v0.7 不存在了（IndexedDB 不持文件锁），
   但多 tab 同时编辑还是会让 Yjs observer 在两个 tab 之间打架（同源
   IndexedDB 共享但 Y.Doc 实例独立）。`BroadcastChannel` 心跳 + 软门
   仍然是最便宜的解。

> 触发条件：从"作者本人 + 两台 Chrome"扩到任何额外用户之前。

### 明确不做 · 自用 scope 内没价值

- ❌ §6 AI 集成（OpenRouter 真调用 / 流式 / fallback 链）· 真想要再接
- ❌ §7.3 多后端（iCloud / WebDAV / Dropbox）· Drive `appdata` 已够用
- ❌ §7.5 端到端加密 / passphrase / 恢复码 / 双写 E2E 迁移 · 单用户威
  胁模型未变
- ❌ §7.2.1 三档 `{仅数据 / 仅设置 / 全部}` 同步开关
- ❌ 字段级真冲突 UI（"两端改同一字段且新值不等"）· Yjs LWW + Lamport
  自动决，体感出问题再独立设计 surface
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

如果未来某天又回来迭代，建议按这个顺序摸一遍手感：

1. `pnpm dev` · 打开 Today Track，把今天当一天用一遍（check-in、改期、
   完成、归档）· 验证没有破
2. `pnpm test` · 104 个测试都绿
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
