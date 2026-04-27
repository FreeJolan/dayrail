# DayRail · 当前状态 & 后续迭代

> 最后整理：2026-04-27
> 本文档与 `ERD.*.md` 分工：ERD 是设计意图 + 历史决策链（append-only
> 记录），本文档是**当下状态快照** + **待办停车场** + **迭代注记**。
> 每次大迭代开始前读这里拿到起点，结束后更新这里。

---

## 定位

DayRail v0.5 · **单设备 · 自用 MVP**。

不做多设备同步、不做对外发布、不做移动端适配、不做 AI 上线。所有工作
围绕"作者一个人每天用得爽"展开。这个定位会持续，除非作者本人另行决
定。

---

## ✅ 已落地（v0.5 · 可用）

### 数据模型（§10）

- Event-sourced 存储：SQLite-WASM + OPFS + HLC 时钟 + snapshot cadence
- Edit Session 机制（§5.3.1）· 一键回滚整批
- Task.status 是所有完成状态的单一真源（§10.1）
- `HabitBinding` 实体承担 habit ↔ rail 关系
- Line(kind=habit) + HabitPhase 承担 habit 的名称 / 阶段
- Auto-task 幂等物化（`task-auto-{habitId}-{date}`）
- §10.3 配置变更 purge 流程（scope 可窄到 rail）
- `Rail.recurrence` **已移除** —— Template + CalendarRule + Binding.weekdays 三层足够
- `Rail.defaultLineId` **已移除** —— 让位给 HabitBinding
- `RailInstance` 概念在 v0.4 不存在；历史表在 schema 中早已清理

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

未做（v0.5.1+）：
- Power-user 模式 "edit the most recent revision in place" —— 默认
  路径覆盖 99% 用例，留作开放问题。
- 同 session 相邻 revision 合并 —— 实测 revision 表大小后再决定。
- 旧 mutable 字段彻底从身份壳类型上移除 —— 代码层去 v0.6 整理；
  当前 `state.rails`/`state.templates` 等 mirror 仍在维护，作为
  current-state 便利访问 + 历史事件 replay 的兼容层。

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
| Settings（§5.9） | ✓ | 外观 / 同步占位 / AI 占位 / 高级（含备份）/ 关于 |
| Backlog drawer（§5.3 D8） | ✓ | 已升格为全局 · `g b` 快捷键 · SideNav 入口 · Line picker 快速建 |

### Cross-cutting

- 备份：Settings → 高级 → Backup · 下载 JSON / 导入 JSON
- 软删除 / Trash：Line / Task / AdhocEvent 三级
- Reason toast（§5.2）· 3 枚快速 tag chip + Undo
- Shift 标签历史（recordShift + 审计）
- 路由：react-router-dom v6，SPA fallback
- PWA：Service Worker / manifest 已生成（未测"加到主屏"流程）
- 深浅主题：tokens 就绪，设置页能切

### 测试

6 个 suite · 65 个 case（`pnpm test` 从 repo 根跑）：

```
packages/core/src/__tests__/
├── autoTask.test.ts      · 11 case · §10.3 purge selectors
├── materializer.test.ts  · 12 case · auto-task 生成路径 + §10.5 freeze
├── reschedule.test.ts    ·  8 case · §5.5.6 reschedule 触发规则
├── revisions.test.ts     · 12 case · §10.5 atDate 选择器
├── today.test.ts         · 15 case · timeline / check-in / pending
└── unschedule.test.ts    ·  7 case · §5.5.6 unschedule 触发规则
```

覆盖重点：多任务排序、状态过滤、时间窗口、binding × template × weekdays
三层交集、`binding.createdAt` 日期 floor、§10.5 跨 cutover 的 freeze
（rail 改 effectiveFrom='YYYY-MM-DD' 后，物化窗口 < 该日的 task 用旧
revision、>= 该日的用新 revision）、tombstone 截止生效。

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

- **Backup round-trip 集成测**：export → reset → import → 状态对比。
  涉及 OPFS / IndexedDB / `location.reload` 比较难纯单测，需要
  Playwright 或 jsdom + 手搭。
- **Error boundary**：当前崩了白屏。自用可以接受，真要加就
  `react-error-boundary` 包一下主 `<main>` 并给个"重载 / 清空数据"
  逃生口。

### 数据安全 / 弹性 · 对外发布前应当补（按性价比排序）

> 触发条件：从"自用 beta"扩到任何额外用户之前。自用阶段单事件概率
> 低，但月级累积概率不可忽略 —— 真正的兜底是 §7 同步通道（远端副本
> 不依赖 OPFS 完整性），那个上线前下面四项是性价比最高的护栏。
> 现实诱因：多 tab 锁竞态、浏览器/标签崩溃在写中段、强退、OPFS 配额
> 耗尽、Chrome OPFS 自身 bug（2024-2025 期间 Chromium issue tracker
> 有数例）。

1. **Single-tab guard** —— `BroadcastChannel` 心跳，第二个 tab 落地
   时显示"已在另一个标签打开，关闭它再来"软门。**挡掉最大单一原因**
   （OPFS sync access handle 文件级独占锁的竞态），几十行代码。
2. **启动时 `PRAGMA integrity_check`** + 坏库时跳"从备份/snapshot
   恢复"页 —— 让 corruption 不再表现为"白屏 + console 报错"。
   可与上面的 Error boundary 项合并实现。
3. **定时自动备份 · 正式能力**（不只是后台兜底，做成 Settings →
   高级里**用户可见可配置**的功能）：
   - **频率可选**：关闭 / 每天 / 每周 / 每月 / 自定义间隔（最少 1 天）。
     默认开启 = 每周。
   - **目的地两路**：
     - **OPFS 第二个文件**（与主库分开 → 主库坏不连累备份），滚动
       保留最近 N 份（N 可配，默认 4）。
     - 可选的**自动下载到本地 Downloads**（每次生成新备份就触发
       `<a download>`），把"忘了手动导出"那类风险消掉。
   - **Settings UI**：开关 + 频率 picker + retention 数 + 上次备份时间
     戳 + `立即备份一次` 按钮 + 备份列表（OPFS 内的可单点恢复 / 删除）。
   - **触发器**：app 启动后比对 `lastBackupAt` vs 当前频率，过期则
     在 idle callback 里跑一次（避开主写路径，复用现有 Backup 导出
     管线）。
   - **失败处理**：备份失败 toast + 写一条 `backup.failed` 事件，下次
     启动重试；连续 3 次失败弹一条不可忽略的 banner。
4. **同步通道**（ERD §7）—— 真正的远端兜底，但工作量大；上面三项
   是同步上线前的最后一道防线。

实现一项就上一道，不必一次做齐。Issue 触发：作者拿到第二例
SQLITE_CORRUPT 报告。

### 明确不做 · 自用 scope 内没价值

- ❌ §6 AI 集成（OpenRouter 真调用 / 流式 / fallback 链）· 真想要再接
- ❌ §7 Sync（Google Drive / iCloud / WebDAV）· 单设备没必要
- ❌ 移动端响应式
- ❌ 首次运行引导 / 空状态文案 / 新手教程
- ❌ 桌面端 Tauri 壳
- ❌ E2E 测试框架

---

## 🚨 重要注记（给未来的自己）

### 数据安全

- 所有数据在 **OPFS**（`navigator.storage.getDirectory()`）· 清浏览器缓存 /
  换设备 / 浏览器崩都可能丢
- 唯一保险：Settings → 高级 → **定期导出 JSON** 到电脑本地
- 导入是**整体覆盖**，不是合并 —— 用"从备份恢复"的心智用它
- **`SQLITE_CORRUPT` 复盘**：dev 模式撞过一次。我们这边没有破坏性 schema
  改动 —— 诱因在浏览器侧（HMR 撞写、强退、多 tab 锁竞态、OPFS bug）。
  恢复路径：DevTools → Application → OPFS → 删 `dayrail` → 刷新重建。
  对外发布前的护栏方案见上方"数据安全 / 弹性"停车场条目。

### 会炸的边界

- **OPFS 锁定**：同源的另一个 tab 打开过 DayRail 的话，`resetLocalData`
  会失败（sqlite-wasm 的 sync-access handle 冲突）· 报错文案已提示关
  其它 tab。**发生过真事**。
- **事件日志向前兼容**：每次改 event payload 字段都要保证老快照能 replay
  出来。reducer 侧用 `| undefined` 宽容。要彻底断向前兼容就提示用户
  export + reset + import。
- **sessionStorage 承接 import**：`importLocalData` 靠 sessionStorage 暂存
  bundle，调 `resetLocalData` 刷掉 OPFS。如果 sessionStorage 也清了，
  import 会静默失败，页面按默认种子启动。发生概率低但不是零。

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
- **事件 payload 宽容**：reducer 对 payload 字段宽容（`?.` / `??`），
  因为历史事件里字段可能不存在。

---

## 🧭 下一轮起点（如果还有）

如果未来某天又回来迭代，建议按这个顺序摸一遍手感：

1. `pnpm dev` · 打开 Today Track，把今天当一天用一遍（check-in、改期、
   完成、归档）· 验证没有破
2. `pnpm test` · 35 个测试都绿
3. Settings → 高级 → 导出 JSON → 保存一份
4. Settings → 高级 → 清空并重载 → 导入刚导出的 JSON · 验 round-trip
5. 读 `ERD.*.md` 的 Status 行里上一轮 History · 看上一次停在哪

新需求进来时：
- 先问"自用 scope 变没变"· 没变就继续按本文档的"停车场"和"不做"
  分流
- 大改 data model 前读 §10 · 小改 UI 直接下手 + 测试兜底
- ERD 是 append-only 的设计日志，`ROADMAP.md`（本文档）是可以重写的
  状态快照 —— 每轮迭代结束重写一次
