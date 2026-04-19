# DayRail · 当前状态 & 后续迭代

> 最后整理：2026-04-19
> 本文档与 `ERD.*.md` 分工：ERD 是设计意图 + 历史决策链（append-only
> 记录），本文档是**当下状态快照** + **待办停车场** + **迭代注记**。
> 每次大迭代开始前读这里拿到起点，结束后更新这里。

---

## 定位

DayRail v0.4 · **单设备 · 自用 MVP**。

不做多设备同步、不做对外发布、不做移动端适配、不做 AI 上线。所有工作
围绕"作者一个人每天用得爽"展开。这个定位会持续，除非作者本人另行决
定。

---

## ✅ 已落地（v0.4 · 可用）

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

3 个 suite · 35 个 case（`pnpm test` 从 repo 根跑）：

```
packages/core/src/__tests__/
├── autoTask.test.ts      · 11 case · §10.3 purge selectors
├── today.test.ts         · 15 case · timeline / check-in / pending
└── materializer.test.ts  ·  9 case · auto-task 生成路径
```

覆盖重点：多任务排序、状态过滤、时间窗口、binding × template × weekdays
三层交集、`binding.createdAt` 日期 floor。

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
