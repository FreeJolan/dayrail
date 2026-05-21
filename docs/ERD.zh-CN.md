# DayRail 产品设计文档（ERD）

> **状态**：活文档 —— 这里的任何决策都可以被推翻。最近更新 2026-05-18（v0.12 设计讨论锁定 · 同步信任模型 · §7.10）。本轮锁定一件事：sync 不只是机制正确性的问题，更是用户信任问题。§7.9 修完元数据漂移后 dogfood 暴露的是"用户能不能信任系统已经做对了"，不再是"数据安不安全"。新增 §7.10 引入两层模型 —— (a) **用户模式分层**：本地党 / 保险党 / 同步党 · 由活跃设备数自动推断 · **不在 connect 时让用户做"长期 / 临时"分类**（早期草案设计过三档选择，被讨论中拒掉，详见 §7.10.1 末尾"为什么不区分临时设备"）· mode 前进可推断、后退必显式；(b) **信任护栏五件套**：identity pinning（含 `lastKnownMode` 不变量字段）/ 离场 gate（强版同步党阻塞 + 弱版保险党软提示）/ heartbeat + 启动 reconcile（仅同步党）/ 时间维度感（失败持续时长 + pending 堆积主动警示）/ mode regression 守卫（数据层不一致不静默降级）。**讨论中固化的三条 UX 原则**：(1) 不替用户假设场景 —— modal 必须留 "稍后再说" / "我先看看" 这类逃生口，用户的实际处境优先于系统的猜测；(2) 主界面文案不放技术细节 —— "push failed 401 Unauthorized" 折叠到"详情 ⌄"，主界面保持人话；(3) **加功能点前先反思"不做会怎么样"**，避免堆积冷门冗余功能（本轮 §7.10 设计中三次中招"加分支处理新场景"：强制升级 modal / 临时模式只读 24h / connect-time 三档选择 —— 每次都该问"能不能干脆不区分"，工程师本能加分支，产品本能去分支）。三条原则已存进 `feedback_design_principles.md`。详细设计 + 5 个用户故事 + worst case A/B/C/D/E + 6 期 PR 计划见 §7.10。最近更新 2026-05-14（v0.11 设计锁定 · Task occurrences · 把"调度原子"从 Task 上拆出来）。本轮锁定一件事：原 `Task` 同时背着身份单元 / 完成态真源（§10.1）/ 调度原子三件事，"一件事多次坐下来做"被迫拆成 N 个兄弟 Task。新增 §10.6 引入 `TaskOccurrence`：一个 Task 下挂 0..N 条可独立排 slot / 完成 / reschedule 的 occurrence。**关键决策**：(1) `occurrence.percent` 沿用现有 `Task.milestonePercent` 语义（**主 Task 的里程碑标记位**，max-of-done 聚合），不是分摊权重也不是自身进度条；(2) Task 关联 occurrences 时 `Task.status` 完全派生（§10.1 例外段），manage 单位下沉；(3) `Task.slot` 单数字段保留为 0-occurrence 时的简易路径，加第一条 occurrence 时同 transaction 自动转换、零数据丢失；(4) 旧 `Task.subItems` 一次性迁移成 occurrence（label = title、done = done、id 派生 `occ-{taskId}-{subItemId}` 保证幂等），字段保留可读供老版本继续写、新版本双路读不写回；(5) 顶层 `Y.Map<id, TaskOccurrence>` 新 store，per-element CRDT 自动并 —— **顺手关掉** ROADMAP 停车场原本的「`Task.subItems` 重新拆 per-element Y.Array op」条目；(6) `.dryj` 容器版本不升 · 跨版本只需新版本启动 GC 孤儿 + subItems 兼容读两件事 · 不需要顶部冲突卡片 / readonly mode / 转换确认对话；(7) habit auto-task 管线本次明确不动（保持 `task-auto-{habitId}-{date}`）。**真数据验证**：跑 `tools/migrate/dump-tasks.ts` 在用户 5/11 / 5/13 / 5/14 三份本机 `.dryj` backup 上，128 task 中只有 1 条带 subItems（标题"（看子任务）"暴露是测试数据），`milestonePercent` user 数 = 0，所有 edge case bucket 全 = 0 —— 跨版本焦虑实测无对应数据形态。讨论纪要：D1 抽象、D2 字段集、D3 percent = 里程碑、D4 label = 步骤名、D5 status 派生、D6 slot↔occurrence 转换、D7 archive 级联、D8 subItems 收编 (a)、D9 CRDT per-element、D10 跨版本纯加法、D11 habit 不动、D12 §10.5 不参与，全部 12 条决策与 ERD 对齐。详见 §10.6（含 §10.1 / §10.4 / §5.5.6 / §7.7 同步增补）。最近更新 2026-05-08（v0.9.0 桌面端首版 ship 后 · 9 个 PR + 3 次 tag 重打的实装纪要）。本轮主要记录的是从设计锁定（同日先 ship 的 PR #12）到 v0.9.0 published GitHub Release 之间的实装偏离 + 教训：(1) **§15.2 stack 三处偏离**。原计划写的是 `tauri-plugin-stronghold` 存 refresh token + `tauri-plugin-http` 调 Drive API + deep link 接 OAuth callback。实装全部换了：`keyring` crate 替 stronghold（refresh token 是 server-revocable capability，stronghold 的 vault + master-password 模型对这种短命凭证 overkill；`keyring` 一个 `Entry::set_password` 直接落 OS keychain）；`oauth2` + `reqwest` crate 直接在 Rust 进程跑 authorization-code flow（不需要 webview，所以"绕 webview CORS"这个 `tauri-plugin-http` 的存在论据不成立 —— 本来就不在 webview 里跑）；`tokio::TcpListener::bind("127.0.0.1:0")` 让 OS 选随机端口替 deep link（deep link 要逐 OS 注册 LaunchServices / Windows registry / `.desktop` 文件，loopback 是 RFC 8252 推荐的 native-app pattern · 零注册成本 · Google OAuth 直接支持）。§15.2 / §15.3 已同步更新。(2) **图标三轮迭代 + macOS HIG 学习**。第一轮：原 PWA 沿用的 `icon-512.svg` 数学算错 —— 内层 `<g>` 上挂 `transform="scale(11.43)"` 但 `stroke-width="20"` 在外层定义，被缩放后实际成 ~228px 描边，三条铁轨弧线粗到糊成一坨黑色血滴形（用户在 dock 截图里看到了，叫"黑屁股"）。重写消除嵌套 transform 后铁轨设计可识别。第二轮：图标顶满 dock cell，看起来比邻居每个 app 都大 ~1.2x。**macOS 应用图标的 SVG 画布≠图标本体** —— Apple HIG 模板规定 1024 画布里图标本体只占 824（每边留 100px = 9.77% 透明 margin），让 OS 给所有 app 一个统一的 squircle "落点"。我们的 rounded rect 直接铺满整个画布等于自己绕开了系统统一感。第三轮：按 Apple 模板内缩到 `x=50 y=50 w=412 h=412 rx=93`（512 viewBox 下的等比映射），加暖底 `#FBF4EA` 让品牌温度落在视觉里，铁轨本体从 62% 涨到 75% body 占比让 dock 里有"claim"感。教训：调外观时**rsvg-convert 渲 PNG 看 256/64/32 三尺寸**比改 SVG 然后等 cargo 重 build 快一个量级，整个 iteration loop 缩短到秒级。(3) **Release 三次 tag 重打**。第一次 push `v0.9.0` 后 4 个 platform 的 `pnpm install --frozen-lockfile` 全炸 `ERR_PNPM_LOCKFILE_BREAKING_CHANGE` —— `release.yml` 把 `pnpm/action-setup` 钉在了 v10 但 `pnpm-lock.yaml` 是 `lockfileVersion: 5.4`（pnpm 7 时代格式）+ `package.json#engines` 钉的是 `pnpm >= 7`，CI 是 outlier。修：CI pnpm pin 7（PR #19）。第二次：Linux + Windows 通过，macOS 两个 target 都挂在 `failed to import keychain certificate`。原因是 `release.yml` 的 env 块把 `${{ secrets.APPLE_CERTIFICATE }}` 这种没设 secret 的 reference 渲染成**空字符串**而不是 unset env var，tauri-action 把空 `APPLE_CERTIFICATE` 当成"用户提供了 cert，请 base64 解码 + 导入 keychain" → 导入空载荷失败。**`${{ ... || '' }}` 这种 default 也救不了**因为它仍然 emit set-but-empty。唯一干净的 skip 是从 yaml 里**整个删掉**那 6 个 `APPLE_*` env 行（PR #20）。第三次：4/4 全绿 → 草稿 release 自动生成 → 13 件 platform binary + 7 件 `.sig` + `latest.json` 全到位 → `gh release edit v0.9.0 --draft=false --latest` published。这三次 fail 都是 CI hygiene 问题 —— 代码层 / 设计层 0 改动，但暴露了发布流程很多平台间的 cohabitation 假设。(4) **Apple 签名 deferred 的具体回归入口**。`release.yml` 头部的 doc-comment 块保留了 6 个 secret 名（`APPLE_CERTIFICATE / APPLE_CERTIFICATE_PASSWORD / APPLE_SIGNING_IDENTITY / APPLE_ID / APPLE_PASSWORD / APPLE_TEAM_ID`），enrollment 通过后只需把这 6 行 env 一次性粘回去 + 在 GitHub Secrets 设值，下个 v0.9.x tag 自动签 + notarize。**unsigned → signed 切换那次更新的 quarantine 行为没真实测过** —— 但 v0.9.0 当下用户只有我自己，不强测，等 v0.9.1 实际遇到再说。(5) **测试基线不动**：203 个 vitest case 全绿；Tauri 端 Rust 测试**没加**（`drive_auth.rs` 4 个 command 当前没有 unit test，loopback OAuth flow 涉及 OS 浏览器 + Google API + keychain 副作用，单测构造代价高于价值）—— 这是已知 debt，扩 beta 用户前要不要补再说。下方 "v0.9 桌面端方向锁定" 条目保留作为最初设计意图档案；本 ship-notes 段是这之后的真实实装路径。最近更新 2026-05-07（v0.9 桌面端方向锁定 · 反转 v0.7「Tauri 不做」决策）。本轮锁定一件事：(1) **桌面端 Tauri 壳从「❌ 明确不做」反转为 v0.9 主线**，理由：v0.7 ship 后 1 个月真实 dogfood 暴露出 PWA + Google Drive + 无后端三件事联立产生一个**结构性 UX 缺陷** —— Google OAuth implicit flow（PWA 唯一能用的）不发 refresh token，access token 1 小时过期，每个 ~1 小时窗口必须走 GIS 续 token 流程。即使配 `use_fedcm_for_prompt: true` 把 popup 降到 FedCM 底部小条，对日常用户也是不可接受的打扰节奏。日常用户预期"首次授权后零打扰"，这个体验在 PWA 架构里不可达 —— 是协议天花板，不是任何 prompt / 缓存策略能解决的事。Tauri shell 把 sync 走 desktop OAuth pattern（authorization code flow + PKCE → 拿 refresh token → 存 OS keychain via `tauri-plugin-stronghold`）+ access token 后台续期 = 物理上消除该 UI。同时是其它一些 PWA 限制（系统通知 / 文件选择器 / 全局快捷键 / 后台 sync）的总解。**auto-update 必须就位**（用户硬约束）—— 用 `tauri-plugin-updater` + 静态 manifest JSON 托管在 GitHub Pages / Vercel（无 DayRail 后端，与 §7.1 立场一致）。详细架构见新增 §15 桌面端章节。**WebDAV 等替代后端继续停车**（v0.7 时代列入 §7.3 "进阶选项"，现在已无明确用户诉求 —— 桌面端 + Drive refresh token 解决了原本 WebDAV 想解决的"零打扰"问题）。**`KEY_CONNECTED` localStorage 在 SW 升级后被清的 PWA bug 暂搁** —— 桌面端 ship 后 PWA 不再是日用主路径，影响降级；v0.9 实装中如果路过 SW 升级路径顺手修也行。**对齐失误反思**：之前 ROADMAP「❌ 明确不做」段把"Tauri 桌面壳"和"移动端响应式 / E2E 测试框架"列在一行，论据是 v0.7 时期"自用 + 小范围 beta scope 内 PWA 已够用"。1 个月真实 dogfood 后这个论据失效。教训：长期不做的决策应该周期性 challenge，不该长期挂着。最近更新 2026-05-07（v0.8.2 ship 后 · AI MVP 实装纪要）。本轮设计锁定（同日先 ship 的 PR #9）后，代码 PR #10 在 dogfood 中经历了多次反转，最终 ship 形态与原设计有几处实质性偏离。按时间顺序：(1) **JSON schema → free Markdown 整体反转**。设计锁定时定的 `{ headline, observations: [{ claim, from_data }], questions_to_sit_with }` 在第一次 dogfood 就被 code-tuned model（`claude-opus-4-7` via `claude-bridge`）持续 schema drift（返回 `finding / severity` 等 lint-style 字段）打穿。补的 alias map + lenient validator + 反 schema-drift 的 few-shot example 越加越多，复杂度跑过价值。整体反转：删 `validateObservationJson`（~150 行）+ alias map + 17 个测试 + `extractJsonFromResponse` 主用路径，改为自由 Markdown 散文 + 内联 「verbatim 引用」 中文方括号约定 —— 用户扫一眼引用就能判断 AI 是否 fabricated。`AiObservation` 类型从 `{ json: AiObservationJson }` 改为 `{ markdown: string }`。(2) **Vercel AI SDK（`ai` + `@ai-sdk/openai-compatible`）替代手卷 SSE**。原本手卷的 `consumeSse` + `parseSseBuffer` + `extractContentDelta` + 错误分类（~120 行 + ~30 个测试）被 AI SDK 的 `streamText({ model: provider(modelId), messages })` 替代。错误分类映射到 SDK 的 `APICallError` 类型，保留 `bodyExcerpt` 字段。SDK 通过**动态 import lazy load** —— 不开启 AI 的用户冷启动 bundle 不变（主 chunk 973KB / 291KB gzipped 不动；AI SDK 占用 ~380KB / ~100KB gzipped 的独立 async chunk，第一次 AI 调用时下载，session 内复用浏览器缓存）。(3) **System prompt 经过 5 轮 dogfood 迭代到 scene-staged「微信里给朋友回消息」persona**。每一轮都因为 model 总是输出"季度复盘"风格的 KPI 报告。Round 1：禁词（黑洞/拖低/必须/下周期建议）—— 模型用「严重欠账」绕。Round 2：禁 markdown bold label（`**主线**` / `**观察**`）—— 模型用独立短句 label 绕（「主线 / 我看到的」）。Round 3：加 anti-example 演示反面写法 —— 用户反馈这是反向投毒（"don't think about a pink elephant"），删掉。Round 4：persona-driven（"warm friend / counselor / kind elder"）+ 显式承载 DayRail「**允许错过**」哲学 —— substance 大幅改善但结构仍偏 dashboard。Round 5：scene-staging —— 从"你是谁"升级为"你身处哪个具体场景"：「几分钟前你朋友在微信里给你发了消息，你正在打字回 ta」+ ABOUT THE MEDIUM 显式段对比 chat reply vs report。medium 的社交常识压住了 dashboard 形态先验。最终 system prompt 显式承载「不评判 / 不下周建议 / 不 KPI 分析 / 提议 2-3 个温和小调整 + 把选择权交回」的形态指令。(4) **三个 Review scope 都接 AI 入口**。原 spec 锁定 Day + Cycle 双场景，dogfood 中发现 Review 还有 Month scope 没接 AI 是 UX 不一致 —— 加了 `MonthReflectionAi`，复用 Cycle 数据切片 + 缓存合成 cycle id `month-${YYYY-MM}`（v0.8.2 顺手实现 ERD §10 `Cycle.endDate` "v0.4 custom-length cycles" 的 reservation —— `upsertCycle` 接受可选 `id` + `endDate` 参数）。Day 反思空时不再 `return null`，改成显示斜体 hint「✨ 写完反思后，可以让 AI 帮你看看」 —— 之前 return null 的写法对用户完全没有 discoverability。(5) **Settings UI 加「刷新可选模型」+ 错误展示加 body excerpt 抽屉**。dogfood 中用户撞到 503 时 `[provider-error] Provider returned 503.` 太 opaque（看不到 bridge 真实回的 body）—— 加 `<details>` 抽屉显示 `bodyExcerpt`（前 500 字）。Model 字段加「刷新可选模型」按钮 + `<datalist>` autocomplete（走 OpenAI-compat `/v1/models` · `parseModelList` 容忍 `{data:[]}` / `{models:[]}` / 裸数组 / 裸字符串数组等多种 envelope）。Confirm panel 「发送」按钮原本写的 `bg-bronze-9` 是不存在的 Tailwind class（项目用语义 token `bg-cta`），导致按钮看起来像被禁用 —— 也在这一轮修了。(6) **model-tone 兼容性观察**。`claude-opus-4-7 via claude-bridge` 即使经过 5 轮 prompt iteration 仍偏向 structured 输出（独立短句 label 始终绕不掉）。这是 RLHF 训练的天花板，不是 prompt 能继续解决的。换 OpenRouter 的 `claude-3-5-sonnet` / `gpt-4o` 通常 prose 更流畅。当前样本只有 1 用户，扩 beta 用户后再决定是否把"推荐 model 默认值"文档化进 ERD §6.6。(7) **AI 全局记忆（"软件记得我"）未纳入 v0.8.2，停车 v0.9 candidate · 结论未定**。dogfood 中冒出"AI 应该有跨调用的记忆，能记得用户身体不好 / 在备考 / 最近压力大等长期事实"的产品想法。当前结论：先用 v0.8.2 跑 2-3 周真实使用，等有具体的"我希望 AI 记住 X 而不忘 Y"用例再设计；当前思路是 `aiMemories` 同步流 + 反思后可选「记下这个」accept/reject UI，但数据模型（独立 store 还是 background 扩展）/ TTL 衰减 / 隐私边界（默认随同步还是仅本机）都未定。详见 `docs/ROADMAP.md` v0.9+ 停车场表。(8) **测试基线**：147 → 203 / 13 → 15 suites（+56 case · +2 suite）。新增主要在 `aiClient.test.ts`（14 case · `parseModelList` 各种 envelope + `listModels` 错误分类）+ `aiPrompts.test.ts`（42 case · scene-staging / 「允许错过」哲学 / 「微信里」medium framing / persona / 引用约定 / 数据切片字段）。`aiValidate.test.ts`（17 case）随 JSON schema 反转一起删掉。下方"v0.8.2 设计锁定 · AI MVP"条目保留作为最初设计意图档案；本 ship-notes 段是这之后的真实实装路径。最近更新 2026-05-07（v0.8.2 设计锁定 · AI MVP）。本轮锁定四件事：(1) **首发场景从『Day 还是 Cycle 实施时再选』收敛为 Day + Cycle 双场景同时上**。两个场景共享 §6.6.1 用户背景注入路径 + §6.2 内置英文 system prompt + JSON 结构化输出 schema；差异只在 scenario-specific framing block + 数据切片 selector + UI 入口位置 + 缓存字段挂哪个实体。Day 入口接 §4.1 DailyReflection 块底部 + Review · Day；Cycle 入口接 Review · Cycle 视图 picker chip 旁。Decompose / Observe 继续停车 v0.8.3+。staged ship（先 Day 后 Cycle）讨论中拒掉 —— 客户端 + system prompt + 输出 schema + UI 卡片渲染全共用，分两轮反而要写两遍 ERD + 两个 PR + 两轮回归 checklist。(2) **API key 存储位置反转**：v0.8 设计锁定时 §6.6 表格写『浏览器内存 + Y.Doc `userProfile.aiApiKey` 持久化（同步流的一部分）』，本轮改为 **仅本机 localStorage（key: `dayrail.aiApiKey`），不入同步流** —— 与 §7.1 凭证心智一致，与 Drive OAuth token / WebDAV 密码同档。Base URL / Model name / Background / aiEnabled 四个『通道里的设置』继续走 Y.Doc 同步流（与主题色 / `enabledHolidayRegions` / `calendarRuleOrder` 同档）。新增 §6.6『userProfile 字段分流原则』段把这条二分写明，二分判别：『这台设备上没了等价于失去对外服务访问权 → 凭证 → 仅本机；丢了只是设置回到默认 → 设置 → 同步流』。`userProfile` Y.Map 因此**只放可同步设置**，AI key 不进 Y.Doc。(3) **AI 输出持久化策略**：选 ephemeral + 单字段 LWW 缓存最近一次。Day 复盘缓存 → `DailyReflection.lastAiObservation: { generatedAt, model, json } | undefined`；Cycle 复盘缓存 → `Cycle.lastAiObservation` 同形态。再点一次直接覆盖；不留历史 array（与 §6.1『AI 输出只是初稿、不保留 AI 原版』心智一致，避免单日反复点 N 次塞 N 条进同步流）。用户想留就『复制 markdown 贴回 reflection』显式动作。挂在 reflection / cycle 实体而不是单独 store 的理由：reflection 已经是『该日的 user 自由文本』实体，AI observation 与之同步增删（reflection 删了 AI observation 跟着没意义）；cycle 同理。(4) **§6.4 首次启动『可关闭 AI 引导卡』UI 停车**到 v0.8.3+（§6.4『默认关闭』toggle 策略本身保留）。理由：v0.8.2 已塞三件事；用户从 SideNav → Settings → AI 自然找得到；引导卡先做容易让用户觉得『必须配 AI 才完整』，与『工具应该安静』价值冲突。触发条件：v0.8.2 ship 后两周看 AI 启用率，如果普遍未启用再设计 surface。本轮测试基线预期：147 → ~160（新增 ~13 case：客户端 SSE / JSON 解析 / error 分类 + prompt builder 三背景 × locale + Settings 字段 round-trip）。设计实装路径详见 §6.6 / §6.6.2 重写。最近更新 2026-05-06（v0.8.1 ship 后 · §5.4 实装纪要）。v0.8.1 ship 后实测 + 多轮迭代捕获到的 deltas（设计层面的而不是单纯实施细节）：(1) **CalendarRulesDrawer 收敛成单一规则列表 + 条件组属性表单**。原计划是「顶部新加优先级 section + 保留 4 个 kind-specific section」的渐进路线，实测用户希望排序 / 新增 / 编辑全在同一处；遂把 4 个 kind-specific section 删掉（function 仍留在 file 内做 reference），所有 CRUD 收到顶部「规则列表」内 inline 完成。属性匹配的子表单也从「4 kind 平铺 toggle + region/note filter 飘在外面」重构为「条件组卡片，narrowing 选项 nest 在所属 kind 卡内」—— 节假日卡（含 假日/非假日 子选）/ 调休 / 我的备注（含 contains/exact toggle + datalist autocomplete 拉用户已写的 label）。schema 不动，UI 只是 derive。(2) **「观察日」UI 文案改「节庆」**。`ExternalEvent.kind = 'observance'` 不动，UI 层把"母亲节 / 七夕 / 教师节 / 圣诞"等归类为「节庆」更贴近中文使用习惯；表单 picker 把「节假日 (holiday)」+「节庆 (observance)」合并成单一「节假日」 toggle，激活后展开 假日 / 非假日 二级 multi-select。schema 仍是两元素 kinds，UI 层 derive。(3) **`CalendarRuleExternalEvent.noteLabelFilter`**：`{ mode: 'contains' | 'exact', query }`，仅对 user-note kind 生效；空 query 降级"匹配任意备注"；exact 模式接 `<datalist>` 拉所有 distinct 用户备注 label 做 autocomplete（O(N) 一次扫描，typical N 几十条可忽略）。(4) **drag handler 抬到 container 级别**：原 per-row dragOver/drop 在第一行上方 / 末行下方有 deadzone 触发不到；改成 container-only 后用光标 Y vs 各 row midpoint 算 dropIdx（0..N），死区为 0；drop 时不读 React state（async 可能滞后），从 drop 事件 `clientY` + `currentTarget.getBoundingClientRect()` 重新算落点 — WYSIWYG 双保险（视觉指示器与最终落点永远对得上光标当时位置）。(5) **resolver caller 漏传 `userProfile`** 的 bug 修复：`pickTemplateForDate` 的 state Pick 之前不含 `userDayNotes` / `userProfile`，导致 resolver 拿不到 `calendarRuleOrder`，"拖了不生效"——widen 类型签名后 typecheck 自动揪出 6 个 caller（Calendar / CycleView / Review / SchedulePopover / cycleFromStore / reviewFromStore）。这是 `Pick<DayRailState, ...>` 类型契约的反面教训：依赖项漏在签名里只能被 typecheck 暴露，运行时 silent。(6) **Calendar 单元格视觉减负**：cell tint step-4 → step-3，删左 5px strip + 删顶 2px border + 实色 step-9 模板 badge 改 dot + ink-secondary 文字。原本三层颜色叠（tint + strip + border + 实色 pill）reinforcing 同一信息，看起来像 90s 电子表格热力图；现在只剩淡 tint + 一颗小色点 + 文字，扫读保留但 saturation 大幅下降。(7) **off-rail row label 列宽溢出修复**：原本「未归属 / off-rail · 拖回任意 rail 即可恢复」是 2 行 stack + dashed border 框，宽度超过 220px 列把日期格全部挤偏移；副标题降级到 `title=` tooltip，仅保留主标题"未归属"，加 `max-w-full overflow-hidden` 防将来再溢出。本轮 ship 测试数 147 / 13 suites（v0.8.0 是 129 / 12，v0.8.1 +18 case）。下方 v0.8.1 design-lock 条目（"§5.4 CalendarRule 重构"）保留作为最初设计意图；本 ship-notes 段是这之后的真实实装路径。最近更新 2026-05-06（v0.8.1 · §5.4 CalendarRule 重构）。本轮锁定两件事：(1) §5.4 优先级模型从硬编码（`single-date 100 > date-range 50 > cycle 30 > weekday 10`）改为**用户控制的全局排序**：`UserProfile.calendarRuleOrder: string[]` 持久化用户拖拽出的优先级链；resolver 先按 order list 走，order list 里没有的 rule 退回到 legacy 数字 priority + createdAt 兜底。`CalendarRule.priority` / `CalendarRuleRevision.priority` 从必填改为可选，新写不再设；老 rule 直到用户碰一下规则抽屉才被纳入 order list（隐式迁移）。(2) §5.4 新增 **`external-event` 第五种 rule kind**：按 §14 ExternalEvent 属性匹配（`match.kinds: ('holiday' | 'observance' | 'makeup-workday' | 'user-note')[]` + 可选 `match.regions: string[]`），命中即应用 `templateKey`。例如「所有节假日 → restday」一条规则，无需逐日列举；将来 ICS 订阅（§14.4）一旦 ship，自动也能被这条规则匹配，不用重做 resolver。新 action `upsertExternalEventRule` / `setCalendarRuleOrder` · 既有 5 个 upsert action 都接入 order list 维护（新 rule prepend 到顶部）· 既有 remove action filter 出 order list。CalendarRulesDrawer 顶部新增「整体优先级」section（drag-to-reorder 全 kind 的 rule），底部新增「属性匹配」section（external-event 编辑器）。最近更新 2026-05-06（v0.8.0 加 §14.3 用户标注）。本轮单点扩展：v0.8.0 在节假日数据集之外再加一类**用户标注**（user-defined day notes），共享 §14.1 `ExternalEvent` 渲染层。新增 §14.3「v0.8.0 实施 — 用户标注」（`UserDayNote { id, date, label, color?, createdAt, updatedAt }`，Y.Doc top-level `userDayNotes` Y.Map keyed by id；UX 三个 surface：Calendar 月视图编辑入口 / Cycle View 日期单元格 chip 叠加 / Today Track 顶栏 metadata 行 · Review Day 顺手挂）。`ExternalEvent.kind` 加一档 `'user-note'`（描线 + 用户色，与节假日 chip 形态一致但视觉区分）。§14.0 动机段重写：把"外部"重新定义为"外部于 task pipeline"（不进物化 / purge / revision），而非"外部于用户"——两类 source（外源节假日 + 内源用户标注）都满足这个意义上的"外部"，共享渲染路径。原 §14.3 ICS 订阅停车场草稿顺序后挪到 §14.4。最近更新 2026-05-06（v0.8 设计锁定 · 外部事件源 + AI 复盘）。当前状态快照 + 后续待办见 `docs/ROADMAP.md`。本轮锁定四件事：(1) 新增 §14 **外部事件源**：抽象 `ExternalEvent` 接口，v0.8.0 ship 内置节假日数据集（bundle 仓库内 JSON · region multi-select），ICS 订阅留 §14.3 v0.9+ 停车场草稿。(2) §6 AI 辅助从「明确不做」解封：新增 §6.6 **v0.8 实施说明**，§6.3 的 OpenRouter-only 接入扩为 **OpenAI-compatible 通用客户端**（Settings 三字段：base URL / API key / model name），覆盖 OpenRouter / Groq / Anthropic-via-proxy / Ollama / LM Studio / `claude-code-router` / `claude-bridge` 等所有兼容端点；显式承认用户已有 Claude Code / Cursor 套餐 + CLI 桥接的存量生态。(3) 新增 §6.6.1 **用户背景 `userProfile.background`**：单 Markdown blob，Y.Doc 同步流，AI 调用前 prepend 到 system prompt；心智对标 Claude Code 的 `CLAUDE.md`。「AI 优化我的背景」按钮停车，等 v0.8.0 ship 后看真实背景文本质量再决定。(4) §6.6.2 v0.8.0 复盘场景 v1 选 Day 还是 Cycle 留实施时拍板；Decompose / Observe 继续停车。§9.3 AI 选型表对齐：网关从 "OpenRouter" 改为 "OpenAI-compatible 协议（默认接入 OpenRouter，可改任意端点）"；fallback chain UI / 远端免费模型清单 / 多 provider 适配层全部明确不做。下方 History 节保留历史决策链。最近更新 2026-04-19（v0.4 实装推进一轮 · 自用 MVP 就绪）。本轮主要落地（habit-binding 重构之后）：(1) `rail.recurrence` **整段删掉** —— Template + CalendarRule + `HabitBinding.weekdays` 三层过滤够了；rail 级 weekday 过滤只制造空交集 trap。(2) 多 task 同 slot 从数据到 UI 彻底打通 —— CycleCell 堆叠 pill、Today Track 每 task 独立行 + 独立操作、Pending 逐条操作，§4.1 的 one-to-many 不变量在界面上看得见。(3) §5.5.0 B 节奏带点击回填接上。(4) §10.3 配置变更 purge 流程上线，HabitDetail 改 binding + Template Editor 删 rail 都带确认 + Edit Session 批量回滚。(5) Backlog drawer 从 Cycle View 提升到 App shell —— `g b` 快捷键、SideNav 入口、drawer 内 quick-create 带 Line picker。(6) `scheduleTaskToRail` / `scheduleTaskFreeTime` 在 deferred 任务被重排期时自动翻回 pending —— "改期 = 反悔 defer" 语义。(7) Review 加周期对比 match% delta + 每行 stats + 每 phase 段内 match%；HabitDetail 节奏带同步加 phase-band 叠加 + 每段 match%。(8) Cycle 格子任务 pill 可拖拽换日期 / rail。(9) Backup 导出/导入完成 · JSON 经 snapshot write + OPFS reset 完成回灌（Settings → 高级）。(10) 35 个 vitest case 分 3 个 suite 覆盖 materializer + §10.3 purge + timeline/check-in/pending 选择器。下方 History 节保留历史决策链。最近更新 2026-04-19（v0.4 habit 绑定收敛 + Task 编辑面铺开）。四件事一起定：(1) 新增 `HabitBinding` 实体（habitId + railId + 可选 weekdays 过滤器），取代原来 `Rail.defaultLineId === habit.id` 的绑定方式；修掉"两个 habit 同一时段不同 weekday 会在同一 template 里挤两条 rail"的结构性扭曲。(2) `Rail.defaultLineId` 字段彻底删除，曾承担的两个职责分别交给 `HabitBinding` 和"以后真需要再加"。Cycle quick-create 默认落 Inbox。(3) Today Track RailCard + Cycle View slot popover 都接入 TaskDetailDrawer，可以就地改备注 / 子任务 / 里程碑 / 排期。(4) Auto-task 的编辑权限表定稿：title / schedule / milestone 只读（它们是 habit 属性），note / subItems 可改（这是"本次上下文"）；habit 改名只影响未来新物化的 auto-task，老的因 materializer 幂等不会被回写。§5.5.0 / §10.2 / §10.3 / §10.4 / §5.2 / §5.3 一并更新。历史：2026-04-19（数据模型一致性大整理 · v0.4 基石）。合并发布六件事：(1) §10 新增"**三轴速览**" + "**完成状态归属规则**"——Line / Rail × Template × Time / Task 三轴正交，`Task.status` 成为所有完成语义的单一真源，RailInstance 收窄为"墙钟日志"（actualStart/End + Shift 标签），不再和 Task.status 并列承担"做没做"的问题。修掉 v0.3 遗留的"Tasks 页勾完成但 Today Track 仍显 pending"这类一致性裂缝。(2) habit 的"每次发生"改为一条 **auto-task**（幂等 id = `task-auto-{habitId}-{date}`，`lineId = habitId`，`title = habit.name`）。habit Line 硬约束"下不持有手工 Task"；NewTaskInput 永不暴露给 habit 详情页。habit 和 project 完全对齐完成路径 —— Today Track / Pending / Review 全部查 Task.status。(3) §10.2 定下 Auto-task 物化策略 Ⅱ · **按需 on-demand**，触发点：Today Track boot / Cycle View 切换 / 节奏带打开 / Calendar 翻月 / Review 切 scope / 节奏带点回填。每个 `(habitId, cycleId)` 物化一次就打标记，后续不重算；幂等 id 兜底。(4) §10.3 定下 Habit 配置变更规则：改 Rail 的 recurrence / 时间 / templateKey / defaultLineId 之一时，扫 `[今天, 最远已物化 cycle 末尾]`，**只影响** `status='pending' AND plannedStart > now` 的 auto-task（purge + 按新配置补齐），已完成 / 跳过 / 归档的保留。三类事件（task.purged + task.created + rail.updated）在同一个 Edit Session 下，一键回滚。保存前 confirm。(5) §5.5.0 加 **A+B 节奏带交互**：A 只读 + B 点击回填（done / skipped / shifted / clear），点未物化格子现场 upsert。主路（今天）在 Today Track，兜底（忘标 / 漏开 app / 事后补打）在节奏带原地。(6) §5.5.0 **明确关闭** "habit 和 Rail 合并为单一实体"的开放问题 —— 当前三轴分离是特性不是债：Template = 结构不同的一天，habit 是"安排*进*一天的活动"不是"凌驾*于*日历的 cron"，新建模板时重新安排 habit 本来就是 Template 的题中之义。原"跨模板抄很多 rail"、"请病假 habit 不 fire"、"新模板要手动迁移"三个 framing 统一翻转：这些都不是痛点，是设计。§5.6 / §5.7 / §5.8 写路径全部改为读写 Task.status，RailInstance.status 字段在 v0.4 进入 deprecated 状态（保留到 v0.5 清理）。历史：2026-04-18（§5.5.0 Habits 视图心智校正（v0.4 锚点）：用户视角 **habit = 一件反复发生的事**，不是"一堆 Task 的桶"。Project 是 N 个 Task 聚成一个目标；Habit 是 1 件带 recurrence 的事。Habit Line 增加硬约束"不持有 Task"；habit 详情页去 Project 化——去掉 NewTaskInput / FilterBar / GroupedTaskList，改为"名 + 色 + 当前 phase" → 近 14 天节奏带 → 绑定 Rail 列表 → Phase 时间线 → 备注 → Danger。曾讨论过的"habit 下折叠 Task 小抽屉"（B 方案）明确放弃，方向不一致的心智代价 > 杂事便利。`Line.kind='habit'` 最终是否并入 Rail 族合并为单实体留作 schema 级开放问题，本次不碰。历史：2026-04-18（§5.5.0 Habits 真实装（v0.3.3）：habit 分两档——"简单 habit"（默认，为保持固定强度而做，不暴露 phase 概念）和"进阶 habit"（opt-in，手动启用 phase 追踪后可加任意多个时间段标签）。HabitPhase 是纯用户定义的时间段 label（`{ name, description?, startDate }`），没有 endDate、没有预设枚举、没有自动升降、没有 streak / 完成率派生——这些都延到 v0.4 Review 集成。"启用 / 未启用"完全从关联 HabitPhase 记录数派生，不加 `Line.phaseEnabled` 冗余字段。§10 原先 over-engineered 的 `type Phase`（带 advanceRule / railOverrides）下架，换成 `type HabitPhase`；`type Line` 的 phases/currentPhaseId/tasks 内嵌字段拿掉，`kind` 作为 union discriminator，关联数据走独立实体；`Line.createdAt` / `archivedAt` / `deletedAt` 统一到 `number` (epoch ms) 对齐实装。新事件 `habit-phase.upserted` / `habit-phase.removed`。历史：2026-04-18（§5.3.1 Edit Session v0.3 扩到 Cycle View：进入 `/cycle` 开隐式会话；CycleDay 模板切换、Slot drag-drop 排 / 撤排、slot popover "移除排期" / "标记完成"、空格 quick-create、orphan 守护批量 unschedule 全部挂同一 `sessionId`；顶栏常驻"⤺ 撤销本次编辑 · N"按钮一键回滚整批，离开或 15 min idle 自动关。Core 侧对 `overrideCycleDay` / `clearCycleDayOverride` / `scheduleTaskToRail` / `unscheduleTask` / `createTask` / `updateTask` 全部加 optional `sessionId` 参数，appendEvent 带上后 `undoEditSession` 的 drop-session-events 直接一并回滚。单条撤销路径（slot popover 移除 / CycleDay 恢复默认）保留。历史：2026-04-18（§5.4 CalendarRule v0.3 高级规则开动：weekday / cycle / date-range 三种 kind 的 typed `value` + resolver + UI 全部上线。Resolver 按 priority desc 遍历所有规则（single-date 100 > date-range 50 > cycle 30 > weekday 10），miss 才回退内置启发。weekday 规则首次启动自动 seed（workday 覆盖周一-五 / restday 覆盖周末），行为与旧硬编码启发等价、无 breaking change、OPFS 不用清。"高级日历规则" drawer 重新挂上：四段（single-date / date-range / cycle / weekday），每段列表 + 新建 form + 删除；v0.3 采"删 + 重建"，真 in-place edit 留 v0.3.1；drawer **不**走 §5.3.1 Edit Session（即时持久化，与 Cycle View 同策略）。§10 CalendarRule 类型块补 typed value variants + v0.3 实装规矩；§5.4 drawer 小节同步细化。历史：2026-04-18（路由库 + URL 结构拍板：v0.2 用 `react-router-dom` v6，不上 `@tanstack/router`——类型化 params 的卖点对当前复杂度溢价过高；URL 结构 `/` / `/cycle` / `/tasks` + `/tasks/inbox` / `/tasks/line/:lineId` / `/tasks/archived` / `/tasks/trash` / `/review` / `/pending` / `/calendar` / `/templates` / `/templates/:key` / `/settings` / `/settings/:section`。进 URL 的状态：Tasks selection、Settings section、Template tab；搜索 / 过滤 chip / Cycle anchorDate 留本地 state 不入 URL。详见 `docs/v0.2-plan.md §3`。历史：2026-04-18（§5.3 Cycle View 顶部 DAYS 区块合并：原"顶部大 header（跨所有 section、唯一）"取消；section mini-header 从只读升级为**唯一**模板切换入口——每个日期格本身就是触发器，点开同一套 popover（模板列表 + 覆盖态时多一条"恢复默认"），overridden 指示点从顶部 DayButton 挪进 mini-header 的日期格。理由：两处 DAYS 行信息重复、顶部区块和 sticky summary strip 挤占纵向空间；保留"一件事一个入口"——只是入口从"顶部唯一 master"挪成"每个 section 的 mini-header 里自己那几天"。历史：2026-04-18（§5.3 Cycle View 切换模板时的 orphan-task 守护：旧模板下的 Rail 被新模板"切走"时，已排到这些 Rail 的 task 会被静默孤立；现在加一层确认——N=0 静默切，N>0 弹 `将移出 N 个已排任务 · 继续 / 取消`，continue 后批量 `task.unscheduled` 再写规则；"恢复默认"同规则。§5.5 Tasks 视图列表形态调整：状态 chip 从顶部移除，列表主体改为"未完成 / 已完成"两段折叠——未完成展开、已完成默认折叠、未完成空时已完成自动展开并在位置放"都搞定了 ✓"；Archived / Trash 仍只在左栏有入口；搜索命中时两段都展开。历史：2026-04-18（Cycle View CalendarRule 持久化：§5.3 的 CycleDay 模板切换从"本地 state"改为即时写 `calendar-rule.upserted` / `calendar-rule.removed` 事件；`cr-single-{date}` 去重 id；§5.3.1 Edit Session v0.2 范围收窄到只剩 Template Editor，Cycle View 会话级 undo 推迟到 v0.3，面内的误触回退由 Slot popover 的"移除排期" + CycleDay 的"恢复默认"两条单条动作承担；§10 CalendarRule 补 v0.2 实装细则——只 single-date 生效、id 规则、priority=100、事件形态）。历史：2026-04-18（§5.5 从 `Projects / Lines View` 重构为 `Tasks 视图`，定位为"任务管理主入口"—— 侧栏导航树（随手记 + Projects + Habits + 回收站）+ 跨 Project 的 task 列表 / 搜索 / 过滤 + 排期 popover 两种模式（绑 Rail · 默认 / 自由时间 · 逃生口）；新增内置 Inbox Line（`isDefault: true`、不可删）作为"不挑 Project"的 task 默认容器；全面可逆性 + 软删除模型（Task / Line / AdhocEvent 状态加 `'deleted'`，回收站入口 + 二次确认的硬删 `*.purged`）；`AdhocEvent` 加 `taskId` 字段承接自由时间模式排期；Project 进度条改为条件渲染（仅有 milestone task 时显示），任务数永远显示；开放式 Project（无 plannedEnd）明确不计为风险；§10 Task/Line/AdhocEvent 类型定义同步更新；术语精简：`Chunk` 统一改 `Task`（types + events + schema + UI + ERD 全路径改名），降低 jargon 负担；`Line` 作为内部容器类型保留（`kind: 'project' \| 'habit' \| 'group'` 的 union 父类），但**UI 里永远展示具体形态 Project / Habit / Group / Tag**，不再出现"Line"这个字；`Pending` view 改名 `待决定 / Unresolved` 和 `status='pending'` 解耦；§5.7 Pending 不做 24h 老化，成为"等待决定"全集，check-in 条是其"近 24h"的子集）。历史：2026-04-17（check-in 动作集简化：旧的 `完成/跳过/Shift/忽略` 四按钮 + 四子动作 sheet 合并为三按钮 `完成 / 以后再说 / 归档`；`RailInstance.status` 改为 `pending / done / deferred / archived`（`active / skipped` 弃用，"当前进行中"纯墙钟派生）；Shift sheet 替换为 6 秒 Reason toast（3 枚快速 tag chip + undo，无强制 reason）；Postpone / Replace / Swap / Resize 从 Shift 类型里下架，Postpone 交给 Cycle View 拖拽，其余留 v0.3 重评；Pending 队列重命名并收编 `deferred` 条目 + 超 24h stale 的 pending —— 两个来源一个出口；§5.8 Review 热力图三分语义改绑 `deferred / archived / pending-stale`）。历史：2026-04-16（A 组 UI 底线：同步状态徽章、Now View 节奏条、Ad-hoc 叠层、编辑会话通用化、Cycle 记号改 C1、日期格式表落地；B 组 Now View 结构：多 Task pill 行、Slot 三形态、Next Rail 视觉、去掉铁轨副视图、`CURRENT RAIL` chip、Now 顶栏 `Now` + Mono 副标；C 组 Today Track Shift 交互：Skipped 态改 hatching、桌面 hover 出动作栏、Active 主 CTA 改 tonal `Done`、统一 Shift 标签 sheet、去 bento 保留单条时间线；D 组 Cycle View 骨架：按 Template 堆叠 section、顶部 day header 唯一模板切换入口、Cycle pager picker、summary strip 聚合、`⤺ 撤销本次编辑` 按钮、hatching 三分语义、Backlog 变 split drawer；E 组 Template Editor：删 Save 按钮 / 首次进入 inline 引导、Radix 10 色 popover、顶栏 tab + 2px 色条 + dashed `+ 新建模板`、summary strip 聚合、card 式 Rail 行 + time pill popover picker、行间 gap chip `+ 填充 Rail`、`⋯` 行菜单放 Line 绑定 / check-in toggle；通知重审：删 OS push / Capacitor 通知 / 通知权限链路，Signal 塌缩为 `showInCheckin` 布尔，§5.6 / §5.7 合成一条主线 —— check-in 条 + Pending 队列是同一机制前后两个时态；F 组 缺失页面：Projects / Settings 共用 master-detail 形态，Review 单尺度瀑布 + 节奏匹配度热力图（状态染色 + hatching 三分语义），Pending 队列按日期反序 + 每行 4 动作 + 侧栏 `·` 小点不显数字，Calendar 月历网格 + 点日弹 popover + 高级规则 drawer 四 section，新增 §5.9 Settings 定 5 section + 主题三档默认跟随系统 + i18n 语言在外观 / 时间制 + AI locale 在高级；G 组 设计语言：Terracotta CTA 用 `orange-9/10/11` 三档纯色不用渐变；No-Line Rule 明文白名单（装饰色条 + sticky hairline + focus ring）；Surface 四档 `sand-1..4` 取代 `border` 表达层级；圆角 token `sharp / sm / md / lg` = `0 / 6 / 10 / 16`；整站零 glassmorphism；非对称为默认布局。视觉实装阶段调整：Rail 色板从原 10 色剔除 `olive / mauve / gray`（与 sage / slate 近乎同色、或失去色相识别度），换入 `grass / indigo / plum` 覆盖饱和绿 / 冷静蓝 / 创作紫空位，保持 10 色不变但辨识度拉满；CN 主字体从 PingFang 改为 Noto Sans SC（思源黑体）以获得跨平台一致渲染。Terracotta CTA 从 `orange-9` 实测过于鲜亮，改绑 `bronze-9` 以贴合 ERD 原意的 #C97B4A 暖赭石基调）。
>
> 本文档描述 DayRail 的产品逻辑、交互设计与技术选型。它不是最终蓝图，而是设计意图与取舍的记录（包括我们考虑过又否决掉的方案），方便贡献者理解代码**为什么**长成这样。
>
> **想提异议、想参与讨论？** §11 列的是仍然开放的问题，每一条都欢迎开 issue / discussion。"这条规则不对劲"和"你没想到的情况"都可以聊。

***

## 1. 核心理念

> **对自己好一点，让节奏继续走。**

苛责自己不会让明天更好，只会让心累。环境因素和偶发扰动是不可避免的，我们可以像对待呼吸一样接受它 —— 这不是放弃对自己的要求，而是承认："允许偏离"才是节奏得以延续的真正前提。

在此之下，**规律是默认值，而非枷锁。** DayRail 相信好的生活节奏不是靠严格执行计划表，而是靠建立一条舒适的轨道 —— 每天在差不多的时间做差不多的事。这条轨道给你方向感和确定性，但你随时可以变道、减速、跳过，不需要解释，不会被标记为"失败"。

三层内核：

1. **秩序是起点，不是目标**。偏离（Shift）和执行一样是一等操作。
2. **重复产生节奏，节奏产生自由**。模板化的 Track 消除每日决策疲劳。
3. **工具应该安静**。不做排行榜、不做成就、不发催促通知。只在时间块边界轻问一句：继续、调整，还是跳过？

类比：大多数日程工具是**教练**（告诉你该做什么，没做就批评你）；DayRail 是**铁轨**（默默铺着，踩上去就走，下车随时，下次还在）。

如果你的日常行为没法遵循某条规律，DayRail 不会评判，那可能只是规律本身不适合你 —— 换个时间、换件事就好。

***

## 2. 产品定位与差异点

### 2.1 为谁而做

DayRail 面向这样一类人：

- **习惯提前安排**（周日晚规划下周，而不是临时起意）
- **每天有相似节奏**（起床、工作、运动、阅读大致在固定时间）
- **但需要灵活调整**（不希望一次偏离就前功尽弃）

他们不缺计划能力，缺的是**能吸收偏离的计划容器**。

### 2.2 与常见工具的差异

| 场景     | 普通 TODO / 日历应用         | DayRail                       |
| ------ | ---------------------- | ----------------------------- |
| 长期目标拆解 | 用户手动拆成多个 TODO，逐个设置时间   | Line 原生描述长期事务，可由 AI 协助拆成 Rail |
| 任务延期   | 手动一个个调整 TODO 时间，甚至全部推后 | 一次 Shift 操作，后续 Rail 自动处理      |
| 每日重复   | 每天重复创建或用"循环任务"粗略应付     | Template + Track，修改当天不污染模板    |
| 偏离反馈   | 过期红字、未完成堆积、成就断档        | Shift 是中性记录，无失败语义             |
| 整周规划   | 按天复制、重复粘贴              | Cycle View 一次铺设一个周期，一键撤销本次规划  |

### 2.3 产品边界

| 维度    | DayRail 是              | DayRail 不是      |
| ----- | ---------------------- | --------------- |
| 时间观   | 软结构时间轴                 | 刚性日历 / 会议调度     |
| 目标用户  | 想建立可持续日常节奏的个人          | 团队协作、项目管理用户     |
| 核心动作  | 规划"理想的一天/一周" + 当天微调    | 记录 / 任务清单 / GTD |
| 反馈机制  | 轻触式 Signal + 温和的 AI 回顾 | 打卡、连续天数、激励徽章    |
| 数据所有权 | 本地优先，用户完全掌控            | 云端中心化、账号绑定      |

**刻意不做的事**：连续打卡计数、失败提示、社交排行、强提醒、复杂优先级系统。

> "复杂优先级系统" 指评分引擎、按权重自动重排、由优先级触发提醒升级这一类机制。Task（§5.5）上单值的 `P0 / P1 / P2` 提示**不在此列** —— 它是用户手动打上的被动视觉标签，不驱动任何调度器、check-in 加权或通知。

***

## 3. 用户故事（示例场景）

以下故事展示 DayRail 在不同人群中的典型使用形态。它们用作设计决策的试金石 —— 任何新功能都应当能自然嵌入至少一个故事。

### 故事 A：提前安排的研究生 · 梅雨

> 研二，习惯周日晚铺下一周。
>
> 周日 21:00，她打开 DayRail，切到 Cycle View 开始规划下一个 Cycle。把每天 19:00–21:00 的"休闲 Rail"替换为"复习 Rail"，一次拖拽跨五天应用。周三发现要交论文初稿，她把周四早上的"晨跑"左滑跳过。周五临时被导师约谈，她在 Calendar 上加一个 14:00 的 Ad-hoc Event，没有污染任何模板。这个 Cycle 结束后她在回顾页看到本期规划的完成情况 —— 87%。如果她周一改主意，只需按一下"撤销本次规划"就能一次回退那五条替换。下一个 Cycle 又是默认节奏。

### 故事 B：断断续续的跑步者 · 老杨

> 程序员，晨跑习惯常被会议冲掉。
>
> 他创建 Habit Line "晨跑"，两个 Phase：前两周 30min、之后 40min。周一至周三都跑了，周四没起床 —— 用 Shift 打个"没状态"标签，不自责。周五左滑跳过，"会议太早"。一个月后 AI Review 告诉他："你的周四晨跑四周内跳过 3 次，要不要把周四换成 20:00 夜跑？"他接受建议，Template 微调，本 Line 第 2 个 Phase 里周四关联 Rail 也跟着变。

### 故事 C：小组作业 · 阿倩

> 大三，三周内完成小组报告。
>
> 她建一个 Project "市场调研报告"（计划时间窗 2026-04-20 → 2026-05-10），拆出几个 Task："确定选题 20%"、"发问卷 50%"、"分析数据 80%"、"写报告初稿 100%"，另外还有几个没标里程碑百分比的附加事项（"整理参考文献"、"检查格式"）。她把 Task 逐个拖到周期视图对应天的某个时段 Slot 里（"分析数据"这个 Task 放在下周三 14:00–16:00 那格）。队友拖延导致"发问卷"晚了两天，她在那条 RailInstance 上点"以后再说"（`status → deferred`），进入 Pending 队列，再在 Cycle View 里把它拖到周五 → plannedStart/End 重置、回到 `pending`；其它 Task 不受干扰。最后标记 100% 的 Task 完成 → Project 自动归档。

### 故事 D：不用 AI 的极简用户 · 小林

> 对 AI 无感，但喜欢铁轨的比喻。
>
> 首次启动看到 AI 引导卡，点"稍后"。之后一切本地运行，没有账号、没有联网、没有 AI 回复。她只用 Template + Track + Shift 三个概念，永远够用。

### 故事 E：跨设备的重度用户 · Kai

> 前端工程师，在家用 macOS，通勤用 iPhone，公司用 Windows。
>
> 他在 Web 端（Windows）建好 Template 和两条 Line，切到设置里启用同步，选 Google Drive、OAuth 授权完成。回家开 macOS 桌面端：启用同步、授权同一个 Google Drive 账号、加密短语输入一次 —— Rail 数据和他的设置（OpenRouter Key、主题、Fallback 链）都从同一个 Drive 目录流入。一条同步通道，没有别的要配。

***

## 4. 核心概念模型

### 4.1 实体定义

- **Rail（轨）**：一个可重复的时间块。属性：名称、起止时间、颜色 / 图标、重复规则、默认动作描述、是否允许 Signal 打扰、可选关联的 Line。
- **Template（模板）**：Track / CycleDay 的"理想版本"，一个用户可有多个模板。MVP 内置两份：`workday` 与 `restday`，用户可自由增删。模板通过 **Calendar** 按日期规则应用。
- **Cycle（周期）**：一段连续的规划期。默认长度 7 天（周一到周日），**支持因长节假日等场景延长 / 缩短**；结束后下一个 Cycle 自动顺延从次日开始、生成到下一个 Sunday（或用户手动改）。Cycle 是规划视图的组织单位（见 §5.3）。
- **CycleDay**：Cycle 中的一天，绑定一个 `templateKey`（MVP 默认在 `workday` / `restday` 间切换，用户也可选其它模板），并容纳若干 Slot。
- **Slot（槽位）**：某个 CycleDay 中某个 Rail 位置上的**规划内容容器**。可同时承载：
  - 可选的 `taskName`（纯文本）—— 用于一次性小事（"给妈妈打电话"）不走 Project。
  - 有序的 `taskIds` —— 属于某个 Project 的 Task 分配位置。
  Slot 是规划态（设计当天这个位置要做什么）；当日到达时由 Slot 材料化出 **RailInstance**（执行态）。
- **Track（轨道）**：某一天的时间线，由若干 RailInstance 组成。Track 根据当日所在 Cycle 的 CycleDay + 模板生成；用户在 Today Track 上对单天实例做的修改不污染模板或模板关联的 CycleDay。
- **RailInstance**：某天某个 Rail 的执行态实例，携带 `status`（pending / done / deferred / archived）、`plannedStart` / `plannedEnd`、可选的 `actualStart` / `actualEnd`、当天 override、(若有) 所属规划会话的 `sessionId`。"正在进行中"（current rail）不是独立 status —— 纯由墙钟位置派生（`plannedStart ≤ now ≤ plannedEnd` 且 `status='pending'`）。
- **Shift（变道）**：对当天 Rail 实例 `pending` → 终态转移的附加记录。v0.2 保留两类：`defer`（以后再说，落 Pending）和 `archive`（归档，不再排期）。可选附带原因标签（全局共享标签库，详见 §5.7）。"时内推移"由 Cycle View 拖拽承担；`swap / resize / replace` 留到 v0.3 重评。
- **Signal（信号）**：Rail 边界的轻量级提醒。名字取自铁路边的信号灯 —— 到点亮一下，不命令你做什么。三个选项：`继续` / `调整` / `跳过`。
- **Ad-hoc Event（临时事件）**：不属于任何模板的一次性时间块。优先级高于任何 Template 解析结果。可选关联 Line。
- **DailyReflection（每日复盘 · v0.4.3 起）**：一天一条的手写 Markdown，用户在当天写完日志、复盘、心情等任意自由文本。
  - **键 = 日期**：`date` 是主键（`YYYY-MM-DD`，自然日 = `Track.tz` 当日），一天最多一条；空字符串视同"未写"（事件流上是 `reflection.cleared`）。
  - **正交于 Rail / Task / Habit**：不参与 heatmap、不参与 Project 进度、不触发任何调度副作用 —— 纯粹是"今天我想说点什么"的容器。Mermaid 概念图不画它（避免噪音）。
  - **任何日期都可写**：不限"今天"。过去日（治愈"昨天忘了写"）、未来日（提前给某天留计划备注）都允许。
  - **入口两处共享一份数据**：(1) Today Track 页底部的"今日复盘"卡，hard-wired 到当天；(2) `/review/day/:anchor` 底部折叠区，可回看/编辑任意日期。两处通过事件流同步，实时一致。
  - **存储**：事件流 + 物化表（`reflection.upserted { date, content }` / `reflection.cleared { date }`，aggregateId = date）。Snapshot 增加 `reflections: Record<date, DailyReflection>`，参与 session-level undo 与跨设备 replay，与 Habit / Task 一致。
  - **不做**：版本历史（事件流即历史）、AI 总结、模板/提示词、跨日搜索（v0.5+ 再评估）、字数限制。
- **Line（内部容器类型 · UI 永远不用这个词）**：DayRail 唯一的"多 Rail / Task 分组"概念，呈现为一个连续谱。`Line` 只出现在 types / schema / event log 里 —— UI 视图 / 菜单 / 文案始终按 `kind` 展示具体形态：`Project` / `Habit` / `Tag（原 Group）`。
  - **状态三分**：`status: 'active' | 'archived' | 'deleted'`。`archived` 是用户手动归档的终态（可恢复）；`deleted` 是软删除（进回收站，可恢复；二次确认才能硬删）
  - **Inbox 是内置单例 Line**：`id = 'line-inbox'`、`kind = 'project'`、`isDefault: true`、不可删不可改色。所有"用户没挑 Project 的 task"默认落在这里（详见 §5.5.1）
  - 无 Phase 无 Task → **纯分组（标签化）**，仅用于归类（给若干 Rail、Ad-hoc Event 打上"工作""就医"等归属）。
  - 有 Phase → **Habit Line（习惯型 / UI 称 "Habit"）**，开放结束，按 Phase 演进（时长、目标参数、切换规则：按天数 / 按完成次数 / 手动）。适合"每天一次"的重复性事务（晨跑、英语阅读）—— **高频重复本身不是 Project，是 Habit**。
  - 有 Task → **Project Line（项目型 / UI 称 "Project"）**，有限但可追加步骤。见下条 Task 详述。
  - **Line 与 Rail 一对多**：一个 Line 可驱动多个 Rail（小组作业拆成 5 个可独立 Shift 的 Rail）。
  - Phase / Task 可指向全部关联 Rail（整体演进）或特定 Rail（局部推进）。
  - Line 的拆解可手动或由 AI 协助（§6）。
- **Task（工作块）**：Project Line 的基本执行单位。属性：
  - `title`、`subItems`（内部 checklist，不单独排程）、`status`（pending / in\_progress / done）、`order`（可拖拽）。
  - **可选的** `milestonePercent`（0–100）：带百分比即"里程碑"，不带则是"附加事项"。Project 支持**无限追加** Task（含追加新的 milestonePercent）直至归档。
  - **Task 的完成是全局的**：一个 Task 最多排入一个 Slot（Task ↔ Slot 一对一；一个 Slot 可容纳多个 Task）。Slot 只是"我打算在这里推进"，在任一位置标记完成即 Task 全局 `done`，所有视图同步反映。
  - **Project 进度**：已完成 Tasks 中 `milestonePercent` 的**最大值**（不做加权总和；无 `milestonePercent` 的 Task 不参与进度计算，但计入"已完成事项数"）。
  - **归档触发**：`milestonePercent === 100` 的 Task 转为 `done` 时 Project 自动归档；也允许用户随时手动归档。归档后不支持解档；若想做"v2"，通过"复制新建"生成新 Project。
  - **计划时间窗**（Project Line 级）：可选 `plannedStart` / `plannedEnd`，作为软提示 —— 把 Task 排入窗口外的日期会警示但不阻止。
  - **优先级（轻量提示）**：可选 `priority: 'P0' | 'P1' | 'P2'`（不填 = 无优先级）。**被动**：不驱动任何调度器、check-in 加权、通知升级、或自动重排 —— §2 刻意拒绝的"复杂优先级系统"指的就是这些。**主动**仅作为 Cycle View 任务清单及未来任意列表视图的**排序 / 分组 / 筛选**维度（支持"只看 P0"、"按 P0 → P2 排"、"按优先级分组"）。UI 上在每个 Cycle View task pill 上以小 chip 体现（`P0` 红 / `P1` 琥珀 / `P2` 灰）；通过 pill 级 popover 和 `TaskDetailDrawer` 修改。Habit auto-task 也可以带优先级（默认为无；用户可在详情抽屉里逐次设置）。
- **规划会话**（内部概念）：一次在 Cycle View（周期视图）里集中编辑的过程。其中产生的 RailInstance override 共享一个内部 `sessionId`，用于"撤销本次规划"的原子回退。**不是用户可见的名词** —— 没有 Plan 页面、不用命名、没有升格流程。对于会反复出现的多周安排（考试周、出差周），请走专门的 Template + Calendar 日期范围规则。

### 4.2 概念总览（Mermaid）

```mermaid
flowchart LR
  subgraph Design["设计层：用户如何描述理想"]
    Template["Template<br/>理想的一天"]
    Rail["Rail<br/>时间块"]
    Line["Line<br/>分组 / 长线 / Project / Habit"]
    Task["Task<br/>Project 工作块"]
    Calendar["Calendar<br/>日期 → 模板"]
  end

  subgraph Plan["规划层：这段时间打算做什么"]
    Cycle["Cycle<br/>规划周期（≈ 周）"]
    CycleDay["CycleDay<br/>一天 + 模板"]
    Slot["Slot<br/>Rail 位置上的规划内容"]
  end

  subgraph Execution["执行层：每天实际发生的"]
    Track["Track<br/>某一天的时间线"]
    RailInstance["RailInstance<br/>某天的时间块实例"]
    Shift["Shift<br/>偏离记录"]
    Signal["Signal<br/>边界询问"]
    Adhoc["Ad-hoc Event<br/>临时事件"]
  end

  Template -- 包含 --> Rail
  Calendar -- 决定日期用哪个 --> Template
  Line -- 驱动 (1..N) --> Rail
  Line -- 含有 (Project) --> Task
  Line -.可选归属.- Adhoc

  Cycle -- 由若干组成 --> CycleDay
  CycleDay -- 绑定 --> Template
  CycleDay -- 每 Rail 一个 --> Slot
  Slot -- 承载 (0..N) --> Task
  Task -- 最多排入 1 --> Slot

  Slot -- 当日材料化 --> RailInstance
  Rail -- 实例化 --> RailInstance
  Track -- 包含 --> RailInstance
  Adhoc -- 出现在 --> Track
  RailInstance -- 产生 --> Shift
  RailInstance -- 触发 --> Signal
```

> Cycle View 里一次集中编辑视为内部"规划会话"，其 override 共享 `sessionId` 用于原子撤销，但不作为命名实体暴露给用户。

### 4.3 关系（文字版）

```
Template    ──materializes──▶ CycleDay.templateKey
Cycle       ──contains ─────▶ CycleDay[]
CycleDay    ──has ──────────▶ Slot[]（每 Rail 一个）
Slot        ──holds ────────▶ Task[]（0..N，一对多）
Task       ──assignedTo ───▶ Slot（0..1，最多一个）
Task       ──belongsTo ────▶ Line（Project 变体）
Line        ──drives ───────▶ Rail[]（1..N）
Line(Project)──progress ────▶ max(milestonePercent of done Tasks)

CycleDay    ──generates ────▶ Track（每日一份）
Track       ──contains ─────▶ RailInstance
RailInstance──reflects ─────▶ Slot 内容（taskName + tasks）
RailInstance──produces ─────▶ Shift（零到多个）
RailInstance──triggers ─────▶ Signal（零到多个）
Calendar    ──resolves ─────▶ 某日期应使用哪个 Template（或 Ad-hoc Event）
sessionId   ──groups ───────▶ 一次规划会话中的 override（内部）
```

### 4.4 状态机（RailInstance）

```
               ┌── 完成 ──────────▶ done       (终态)
               │
   pending ────┼── 归档 ──────────▶ archived   (终态)
               │
               └── 以后再说 ──────▶ deferred   (半终态 · 落入 §5.7 Pending)
                                       │
                                       └── Cycle View 拖回某天 ──▶ pending
                                                       (plannedStart/End 重置)
```

- **`pending`** 是初始态 + 可恢复态；未来 / current / 过期未标记三种墙钟情形都在其下，不拆成独立 status。
- **`deferred`** 是半终态：进入 Pending 队列，**可通过 Cycle View 重新排到某天**（拖拽给一个新的 `plannedStart/End`），回到 `pending`。
- **`done`** / **`archived`** 是终态，不再回转。Review 通过 event log 追溯历史而非当前 status。

任何 `pending → *` 的转移都会生成一条 Shift 记录（可携带 tags + 可选 reason）。Shift 是历史，不影响后续天数。

***

## 5. 关键交互设计

### 5.0 应用外壳（App Shell）

所有视图共用一层固定的外壳：左侧导航（桌面）/ 底部 Tab（移动）+ 顶部标题栏。外壳本身不承载业务逻辑，只是"app 常在之物"的载体。

**桌面端 · 左侧固定导航**（约 64–72px 宽）：

- **顶部**：自绘 inline SVG `<DayRailMark />` + 副标题 `STAY ON THE RAIL`（全大写、不随 locale 翻译，详见 §9.6 Logo 与标识）。
- **中部**（垂直列表，icon + 短标）：`Now` / `Today` / `Cycle` / `Projects` / `Review` / `Calendar` / `Settings`。当前视图左侧贴一条 2px primary 色条。
- **底部**：**同步状态徽章**（见下）。**刻意不展示头像 / 姓名 / 套餐** —— DayRail 没有账号，展示这些只会制造"我有账号吗？"的误解。
- 外壳没有全局 `Save` / `New…` CTA —— 每个视图自己决定要不要露主动作按钮。

**移动端**：底部 Tab 保留 5 个常用入口（`Now` / `Today` / `Cycle` / `Projects` / `Review`）；`Calendar` 与 `Settings` 收到顶部右上的 `⋯` 菜单。Logo 不出现在移动端主屏（让位给内容）。

**顶部标题栏**：左侧是当前视图标题，具体格式由各视图自行约定（Today / Cycle 走 `今天 · 4月 C1 · 周四` 的单行 context 模式；Now View 走 `Now` 主标 + Mono 副标时间的"此刻"模式，详见 §5.1）；右侧是与视图相关的次级操作（Cycle View 的 `下个 Cycle ▶`、Today 的 `重置为模板`、Template Editor 的 `⋯` 菜单…）。

**同步状态徽章**（左栏底部 / 移动端 `⋯` 菜单内第一项）：

| 状态              | 视觉                                        | 含义                                                          |
| --------------- | ----------------------------------------- | ----------------------------------------------------------- |
| `◉ 仅本机`         | slate step 9 圆点 + 小号浅色文字                  | 用户从未开启同步。这是默认值，**不是错误状态**。                                  |
| `⟳ 已同步 · 2m 前`  | teal step 9 圆点 + 相对时间                     | 最近一次成功同步的相对时间；悬停展示精确 timestamp + 后端（Drive/iCloud/WebDAV …）。 |
| `⚠ 同步暂停`        | amber step 9 圆点 + 简短原因（离线 / 认证失效 / 密钥冲突）  | 同步临时不可用。点击打开详细状态页；**绝不中断当前视图、不弹 modal**。                    |

徽章永远可见、永远克制。**从不使用红色** —— 本地数据始终完整，同步只是可选通道，不存在"失败"语义。

### 5.1 首屏：Now View

打开 App < 1 秒内看到三件事：

1. **当前 Rail 的 Slot 内容**（大字号，占主内容列）。大标题上方固定挂一枚 Mono 9px 大写 wide-letter-spacing 的小 chip —— 标签永远是 **`CURRENT RAIL`**（不写 `CURRENT TASK`，因为焦点的语义单位是 Rail；Task 是 Rail 里的具体动作）。大标题下方的呈现按 Slot 形态分三种：

   - **有 Task**：首个未完成 Task 的 title 作为**大标题**。多 Task 时大标题下方加一行小号副文 `第 1 / 共 3 个 task`；再下方是**紧凑 pill 行**，把其余 Task 按 `order` 列出 —— 每个 pill = 4px Project 色条 + Task title + 可选 `milestonePercent` 徽标；已完成的 Task 加**删除线**；点击 pill 跳到该 Task 详情（Project Line 详情内定位）。pill **不承载"标记完成"操作** —— 主动作按钮的"完成"永远作用于首个未完成 Task，一次点一条，避免"挑着完成"的操作陷阱。
   - **只有 `taskName`**：`taskName` 作为大标题；标题下挂一枚小 chip `Quick task`（JetBrains Mono 9px 大写 wide letter-spacing，和 ADHOC chip 同风格；色板用 slate step 3 底 + step 11 文字），明确"这不是 Project Task、不会在 Project 进度里留痕"。
   - **都没有**：大标题位显示巨大 `—`；下方一行克制副文 `这段时间空着。休息、思考，或随手做点什么。` **不**露"+ 添加"按钮 —— 当下添加内容不是 Now View 的职责，走 Today Track（§5.2）或 Cycle View（§5.3）。

   大标题旁（或下方，取决于视口宽度）展示**剩余时间**（Mono 大字 `45m`）+ 结束时钟（小号 Mono `ends 16:30`）+ 一条时间进度条（按 Rail 时长推进，**不是 Task 进度**）。

2. **下一个 Rail 卡片**：视觉和 Today Track 单条 Rail 行一致 —— 4px 左色条取该 Rail 自身 Radix step 9 色；**刻意不使用三等色（terracotta）** 作为"Next"强调色，三等色只给当前 Rail 和主动作按钮（§9.6）。卡内内容：
   - 左上 Mono 小号 chip `COMING UP NEXT`（和 `CURRENT RAIL` 一个风格）+ Mono 倒计时 `32m 后`（倒计时随分钟级刷新）。
   - Rail 名称（中号字）。
   - Slot 预览摘要（小号副文，按 order 列出前 2 个 Task 的 title + 百分比，如 `热身 20%、有氧 50%`）。若 Slot 是 `taskName`-only，副文 = `taskName` + `Quick task` chip；若全空，副文显示 `—`。

3. **一对主动作按钮**：`完成 / 跳过`。点"完成"会把当前 Slot 里首个未完成的 Task 标为 done（Task 是全局状态，在任一 Slot 完成即全局完成）。若 Slot 只有 `taskName` 无 Task，"完成"对应 RailInstance → `done`。首页刻意不放"调整"入口 —— 需要改时间 / 换内容走 Today Track 的行级交互（§5.2），避免当下决策又多一步。

**顶栏（§5.0 约定的 Now-View 变体）**：主标 `Now`（Inter font-bold）+ 下方小号 Mono 副标 `14:28 · 4月 16日 周四`。时钟走 Intl，按分钟级刷新（秒级会让视觉噪声过高，且对 Now 场景没有价值）；副标**不带 Cycle 记号** —— Now View 聚焦"此刻"，周期上下文不在这里。

**右侧栏只承载 `Goal Context`**：当前 Slot 下挂的 Task 所属 Project / Line 的背景信息（进度、计划窗口、最近一次 Shift 摘要）。**刻意不放**：装饰性图片、激励引语、"今日士气 65%"式的进度数字、成就 / 连续天数计量。装饰与激励与 §1 的核心理念直接冲突。若 Slot 是 `taskName`-only 或全空，右侧栏显示一段中性提示（如 `这段没有长目标需要展开。慢下来没问题。`），不留空白压迫用户找事情填。

**主内容区刻意不设左侧"铁轨可视化"**（竖向圆点 / 竖轴图形等"今日形状"副视图）。今天的形状由下方节奏条统一承担 —— 同屏两套时间轴只会稀释注意力，且竖轴形态天然无法像节奏条那样按状态着色呈现节奏密度。

**底部节奏条**（rhythm bar）：今天的 Rail 轴线横贴在首屏底部，每段按 RailInstance 状态着色 —— `pending·未来` slate step 6 / `pending·current` primary step 9 / `done` sage step 9 / `deferred` slate step 4 斜纹 / `archived` slate step 4 斜纹 + line-through。**不展示数字、不展示百分比**，即便今天全部完成也没有"圆满完成"提示 —— 中性的回顾留给专门的"**今日复盘**"（§5.8 中 Review 的日尺度）。节奏条的作用只是"一眼看到今天的形状"，不是打卡墙。

**首屏保留两个克制的 slot**：

- 顶部（条件出现）：Pending 队列条（§5.7）—— 可忽略、不阻塞。
- 底部（一次性）：AI 引导卡（§6.4）—— 首次启动出现一次，可关闭。

首次启动时，用户直接落地到一份**预设的默认工作日模板**，可原地编辑（不是空白画布，也不是向导）。这样新人第一眼就有可反应的东西 —— 调时间、改名、删掉不适用的 Rail —— 而不是看着"然后呢？"发呆，或在建立信任前就被要求做决定。无登录、无 splash、无每日摘要弹窗。

### 5.2 Today Track

垂直时间轴展示当天所有 Rail 实例。**单条 Rail 的视觉规则**：

- **行高按时长比例**给出（1h 与 2h 不一样高），一眼能感知节奏密度。
- **左侧 4px 色条**取该 Rail 的 Radix step 9 颜色（若 RailInstance 有 override，按 override 色）。
- **五态着色**（四态 status + 一个纯派生的 current）：
  - `pending` · 未来 —— 正常底（surface-1）+ step 11 文字 + step 9 色条。
  - `pending` · **current**（墙钟落在 plannedStart / End 之间）—— primary step 3 底 + step 12 文字 + 左色条加粗到 6px（详见下文"Current Rail 的特殊形态"）。
  - `pending` · **过期未标记** —— 进 §5.6 check-in 条，不在主时间线单独渲染。
  - `done` —— 色条 fade 到 step 6 + title line-through + 内容 `opacity-70` + 小号 check 圆点。
  - `deferred` —— 色条保留 step 9 + Rail step 6 的 2px 对角斜线 hatching + 右上 `以后再说` pill（Mono 2xs）；**仍在时间线上可见**，这样用户能一眼看到"当天本来该做但被推走的事"。
  - `archived` —— 色条 fade 到 step 7 + Rail step 7 的 2px 对角斜线 hatching + title line-through + `opacity-60` + 右上 `已归档` pill。**刻意不使用 tertiary terracotta** —— 按 §9.6，三等色只给 current rail 和主动作按钮；archived 用"纹理 + 降饱和"传达，避免"标红 = 失败"的审判感。
- **Shift 痕迹**：若该实例今天做过一次 Shift（defer / archive），行底部贴一条 inline 小字 `· <首个 tag>`（例：`· 天气` / `· 会议冲突`）；点击**就地展开**该 Shift 的 tag 集合 + 可选 reason，**不弹 modal**。

**Current Rail 的特殊形态**：

- 底色、文字、色条按 current 态放大一档（primary step 3 / step 12 / 6px 色条）；右上角一枚 Mono `CURRENT RAIL` 小 pill（pulse 一个 cta-soft 小圆点）。
- **主 CTA = `✓ 完成`**，tonal 样式：`bg-ink-primary` + `text-surface-0`，**不使用 gradient**。gradient 按 §9.6 仅保留给更稀有的庆祝态（例："今日全部 Rail 完成"），而不是日常按钮。
- **次按钮**并排 = `以后再说` / `归档` 两个。悬停行或键盘 focus 时露出，与非 current 行的 hover 动作栏一致。
- **"提前完成"不是新概念**：点 `✓ 完成` = `RailInstance.status → 'done'` + `actualEnd = now()`；若 `actualEnd < plannedEnd` 说明提前结束。Review 直接按差值聚合，**无需新增 `earlyFinish` 字段**。

**三动作交互（check-in 条与时间线 hover 动作栏共用）**：

- **`✓ 完成`** —— 主动作。`status → done`，立即生效。
- **`以后再说 (defer)`** —— `status → deferred`，rail 从今日剩余的渲染里撤出（或沉为 hatching），落进 §5.7 Pending 队列。时间轴上原占位**保留虚线轮廓**作为"这里本来有什么"的痕迹。
- **`归档 (archive)`** —— `status → archived`，终态。对循环 Rail（recurrence ≠ `one-shot`）额外弹一个 3s toast：`已归档今日的晨跑；明天的晨跑仍会生成`。避免用户误以为"归档 = 关掉这条 Rail 本身"。

三个动作都走下文的 **Reason toast**（不开 sheet）。

**Reason toast —— 轻量 undo-toast，替代旧 Shift 标签 sheet**：

点完任一动作 → 页面底部（或行内）滑入一个 6 秒计时的窄 toast：

```
已以后再说「晨跑」 · 加个标签？  [🌧️ 天气]  [😴 太累]  [🤝 会议]  [撤销]
```

- **三枚快速原因 chip**：取该 Rail 历史上 tag 频次 top-3；冷启动回落到静态 `天气 / 太累 / 会议`。点 chip 即附加 tag 到刚才那条 Shift，并**保持 toast 可见到倒计时结束**（给用户加第二个 tag 的机会）。
- **撤销**：把 `status` 回退到 `pending`，同时删除刚写入的 Shift + Signal 事件（session-scoped undo 的小号版，仅作用于最近一次 action）。
- **6 秒后自动消失**，若用户没点 chip 也没点撤销，Shift 就不带 tag 保存。
- **没有备注字段**：500 字备注在 ERD 早期版本里，实测高频场景（晨跑没跑）几乎不会用到；tag 已经足够统计。真需要写点什么的用户去 §5.7 Pending 队列详情页补（v0.3）。
- **空 toast 直接消失完全允许** —— 没有强制原因，保持 §1 / §9 "No guilt design"。

键盘：`1` / `2` / `3` 快速选中对应 chip，`u` = 撤销，`Esc` = 立即关闭 toast。

**顶部工具栏**：`[重置为模板]` + `[+ 今天临时事件]` 两个按钮。"重置为模板"仅作用于今天、不影响其它日期；点击弹出确认（列出将被丢弃的 override 数量）。

**Ad-hoc Event 的视觉叠层**：Ad-hoc Event 与 Rail 同处一条时间轴，但**视觉语义不同 —— 它是 Track 的"叠加层"，不是 Rail 替代品**。

- **默认外观**：1.5px **虚线**外框 + slate step 2–3 极浅填色 + 默认中性灰（slate step 9）色条。**刻意不默认使用三等色（tertiary terracotta）** —— 三等色只给 current rail 和主行动按钮。
- **Line 着色继承**：若 `lineId` 指向某条带 `color` 的 Line，**外框继承 Line 色（仍然虚线）**，填色保持中性灰 —— Ad-hoc 不抢 Rail 的视觉位。
- **`ADHOC` chip**：行内右上贴一枚小号 pill `临时 / ADHOC`（JetBrains Mono 9px 大写、letter-spacing 宽），强调"这不是来自模板"。
- **Rail vs Rail 永远不并排**：同一时段不允许两条 Rail 共存（Template 层已是互斥）。Ad-hoc 与 Rail 也不并排 —— Ad-hoc 是覆盖，不是拼接。

> v0.2 early 阶段里的 "Replace Shift" 叠层语义（原 Rail 变虚线 + 替换内容以 Ad-hoc 渲染）已从 §5.2 动作集里下架；对应的用户意图由"归档今日 Rail + 新建 Ad-hoc"两步组合完成，Replace 的再引入留到 v0.3 重评。

**不做"Bento 未来块"**：Today Track 从头到尾是单一时间线，未来 Rail 以 pending 态延续在主轨上；**不**为下午时段或"远处"Rail 另开卡片网格。原因：DayRail 数据模型没有"参与者头像 / 专注强度"这类字段，另开 bento 只能拼装视觉噪声；时间线形态也和 Now View §5.1、Cycle View §5.3 保持统一视觉系统。

**任务详情编辑**（v0.4 新增）：RailCard 上点击对应 rail 行 → 打开 TaskDetailDrawer（沿用 §5.5 那一个组件），可就地改备注 / 子任务 / 里程碑 / 排期。**对 habit 的 auto-task**，编辑权限按 §5.5.0 "Auto-task 的编辑性" 表 —— title / schedule / milestone 只读，note / subItems 可改。rail 上无承载 Task 时（空 rail）点击无响应。RailCard 还在行内展示「N/M 子任务」「有备注」这些小徽标，不用开抽屉就能一眼扫到。

**今日复盘卡**（v0.4.3 新增 · 见 §4.1 DailyReflection）：页面**最底部**单卡，标题 `今日复盘`，副标题日期。卡内复用 `MarkdownField`（与 Project / Habit 备注同款），auto-grow、Markdown 渲染、blur 即写入事件流；空内容触发 `reflection.cleared`。**位置刻意压在最底**：复盘是 Today Track 看完今天后才做的事，不抢主时间线注意力。**hard-wired 到当天**（不带日期切换 UI）；想编辑别的日期请去 `/review/day/:anchor`。和 Review · Day 的同一字段共享真值，写完任意一处另一处实时刷新。

### 5.3 Cycle View（周期视图 / 规划模式）

用于**提前规划**和**整体考察**。以 **Cycle** 为单位 —— 默认一个 Cycle 是 7 天，但在长节假日等场景可以延长（下一个 Cycle 自动从次日起算、默认延展到下一个 Sunday）。

**顶栏布局（从左到右）**：

- 应用标题 `Cycle View`（Inter bold，与其它视图一致）。
- **Cycle picker（pager 形态）**：`< 4月 C1 · 04/07–04/13 · 当前 >`。`<` / `>` 独立按钮翻页；中间 Inter 月份 + Mono 日期段 + 包含今天的 Cycle 右侧挂一枚 `当前` pill（Mono 9px）。**`C` 而非 `W`**，刻意避开 ISO 周号歧义（见 §9.7 Cycle 记号规则）。点击中间标签 → popover：按月分组的 Cycle 列表（可滚）+ 起止日期编辑器（直接输入 YYYY-MM-DD，保存后按"次日 → 下一 Sunday"规则级联重算未来 Cycles）+ `回到当前 Cycle` 按钮。
- 右端：settings / account 图标（与其它视图顶栏一致）。

（**v0.3 起 Cycle View 走 §5.3.1 Edit Session**：进入页面时开启隐式会话，本次页面浏览内的所有规划 mutation（CycleDay 模板切换、Slot 拖拽排 / 撤排期、空格 quick-create task、slot popover 标记完成、orphan 守护的批量 unschedule）都挂同一 `sessionId`；顶栏右侧常驻"⤺ 撤销本次编辑 · N"按钮，点一下回滚全部；15 min idle 或离开视图自动关会话。单条撤销（Slot popover 的"移除排期" / CycleDay 的"恢复默认"）继续存在，作为更细粒度的回退入口。）

**顶栏下方 summary strip（约 16px 高，`surface-container-low` 底，左右 6px padding）**：

- 左端：`本 Cycle: N 项目`（Inter 小字 + 数字 Mono）。
- 中段：**Top 3 Project inline 进度条**（8px rounded-full bar，每条左端 Project 色条 + Project 名小字 + 右端 Mono `12/20` 或百分比；选"最多 task 已排"的前 3）；超过 3 个收到 `+N 更多` → 点击弹 popover 列出全部 Project + 进度。
- 右端：`backlog N →` 按钮，N = 未排入 Slot 的 Task 总数；点击唤起下文的 Backlog 侧栏。

**主体：按 Template 分段的堆叠 mini-grid**（每段一个 Template）：

核心原则：**一个 Cycle 里用了几个模板，就显示几段**。例：5 天 workday + 2 天 restday → 堆叠两个 section；纯 workday 周 → 只显示一段；三模板 Cycle（workday / restday / travel-day）→ 三段。单段结构如下：

- **Section 左侧 8px 标签条**：纵向贯穿整段；标签文字 `workday · sand`（Template 名 + Radix scale 名），Mono 9px 大写 letter-spacing 宽；底色 = Template step 2、文字 = Template step 11。
- **Section mini-day-header**（24px 高）：
  - 左端一格 `[色条] TEMPLATE · N days`（Template 名 + 天数）。
  - 右侧每一"当前 Template 命中的天"各占一格，显示星期缩写 + 日期数字（`Mon 12` / `Tue 13` / …）；今天那一格底色 primary step 2 + 顶部 2px primary step 9 标识条；被覆盖的天（`calendar-rule.upserted`）在日期右侧挂一枚小点。**一个 Cycle 里用了几个模板就堆几段，每段只画自己命中的天**；不命中的天属于另一段，不在本 section 重复。
  - 这一排**就是** CycleDay 模板切换入口（唯一入口 —— 顶部不再单独挂 DAYS 区块）：点任意日期格 → popover 列出所有已创建模板，每项 `radio + Template 色条 + 名称`，末尾 `+ 新建模板`。选中 → 写 `calendar-rule.upserted`（`kind: 'single-date'`、id 按 `cr-single-{date}` 去重，同一日反复切换就是 `update`）；当前已有覆盖时 popover 末尾多一条 `恢复默认` → 写 `calendar-rule.removed`，回到 §5.4 CalendarRule 的 weekday 启发。切换后各 section 的 mini-header / cell 立即重绘（旧 section 该列消失、新 section 多出该列）。
  - **每个日期格右侧贴一枚 reflection chip**（v0.4.3+，§4.1 DailyReflection 入口）：`NotebookPen` 小图标，**该日已写复盘** → 实色 ink-secondary；**未写** → 描线 ink-tertiary。点击 → `navigate('/review/day/<date>')`，由 Review · Day 卡承担读写（Cycle View 不内嵌编辑器，避免"同一份内容三处可写"的真值污染）。chip 与日期格按钮**并排**（不嵌套），不抢模板切换的 popover 触发区。
  - **周末不再特别着色** —— 是不是 restday 完全由用户给那一天选的 Template 决定；Stitch 的 Sat/Sun tertiary 染色明确废弃。
- **Section 主体 grid**：行 = 该 Template 的每条 Rail；列 = section mini-header 上已经定下来的"本 Template 命中的那几天"。左栏独立列（≈ 160px 宽）：`[4px Rail 自色条] Mono 时段 08:00–12:00 + 小号 Rail 名`。Cell 对齐该 Rail 在该日的 Slot 内容。
- **切换模板时处理 orphan task**：如果当天的旧模板下已有 N 个 task 被排到具体 Rail 上（`task.slot.date === 该日`），而新模板里没有这些 Rail，直接切会让它们"隐身"（slot 还指着旧 Rail，但 cell 不再渲染）。所以切换前拦一层：N = 0 时直接切；N > 0 时弹一个小 confirm —— `切换到 restday 会把这一天的 N 个已排任务移出，可以随时从 Backlog 拖回来 · 继续 / 取消`。Continue 后一次性把这 N 个 task 走 `task.unscheduled`（slot → undefined），它们自动回到 Backlog drawer；然后才写 `calendar-rule.upserted`。"恢复默认"同理——如果当前 override 下的 template 里有已排 task 而默认启发的 template 没有对应 rail，也走这个确认流程。

**单元格（Slot）可编辑性**：

单元格不再用"整 cell 一个 popover"统摄 `(date, rail)` 下的所有 task。每个 task pill 自己挂一个 popover；cell 自己另外挂一个轻量"再加一个"入口 —— 同一格出现多个 task（例如 habit auto-task + 手动排的一个）时点击才不会串。

- **空 Slot**（Template 生效 + 无 task）：虚线 border；hover 转实线。点击 cell 任意处弹 popover，内置 `QuickCreate` 输入框（Enter = 追加一个 pending Task 到当前 `(date, rail)`；指针移出取消）。不再有 `[新建到 Project]` / `[从已有挑选]` 子菜单 —— 对 ~95% 场景过度设计。"从已有挑选"走 Backlog 抽屉；"新建到 Project" 走 Tasks 页。
- **非空 Slot**（≥ 1 个 task）：
  - 多个 task 垂直堆叠为 pill 列。排序：state rank (`pending < done < deferred < archived`) → priority rank (`P0 < P1 < P2 < 无`) → 稳定插入序。
  - **用户拖拽排序（v0.4.4）**：在 pill 之间出现 2px 高亮**插入线**，drop 即固定位置。落地为 `Task.slotOrder?: number`：slot 中**任一** task 带 `slotOrder` 时，整 slot 按 `slotOrder` asc 排（未填 = +∞ 落底），完全覆盖上面的派生排序——一旦用户排过，就不再二次猜。无 `slotOrder` 的 slot 仍走派生排序，所以老数据零迁移。同 slot 拖拽 → `reorderTaskInSlot`（不写 schedule 事件）；跨 slot drop 到具体位置 → `scheduleTaskToRail` 顺带 reseat 目的 slot。两者都在 Cycle View Edit Session 下，⤺ 一键回退整批。
  - **每个 pill 自己独立点击** 打开自己的 popover。这个 popover 只承载**"该排期此刻的状态"**操作，动作集合随 task 当前状态变化：
    - `pending` → `[标记完成] · [归档] · [子任务清单（逐项可点击切换）] · [详情] · [打开项目] · [移除排期]`
    - `done` → `[撤销完成] · [详情] · [打开项目] · [移除排期]`（撤销 = `status` 翻回 pending + 清 `doneAt`，走 Edit Session 的 ⤺ 批量撤销路径）
    - `deferred` / `archived` → `[详情] · [打开项目] · [移除排期]`
  - **任务配置类编辑（标题 · 优先级 · note · milestone · 子任务增删改名）不在此 popover 出现** —— 它们归共享的 `TaskDetailDrawer`。Popover 只回答"这条排期现在是什么状态"。早期草案曾把优先级 picker 塞进来，后来撤掉：把配置和状态混在一起会让误点成本变高。
  - **Popover 里的子任务**：如果 task 带 sub-items，列表内联带勾选框；点击切换会写一条带 sessionId 的 `task.updated`（新 `subItems` 数组）。对 auto-habit task 的每日分解（拉伸 / 跑 / 放松）勾起来特别顺手，不用开 detail drawer。
  - **Pill 色方案**（另见 §9.6 调色板）：
    - `pending` → 背景 = Rail 色 step 3（柔色调），文字 ink-primary，左侧 1px step-9 色条做 accent。去掉小色块。
    - `done` → 背景 = **中性色** `surface-2`，文字 ink-tertiary，标题**加粗 strike-through**，整个 pill `opacity ≈ 0.7`。左侧 step-6 细色条保留 rail 识别。理由：用户反馈 step-9 实色版本读起来像"Rail 颜色的庆祝态"，不够"已完成、可以忽略"；改为中性灰底 + 强删除线后一眼就是"划掉了"。
    - `deferred` → 背景 = Rail 色 step 7。
    - `archived` → step 6 hatch + 标题 strike-through。
  - **每个 pill 的 hover 预览**（自适应 tooltip / popover，200ms 开启延时）：完整标题 · 所属 Line · 优先级（如有） · milestone % · 子任务进度 + 内联子任务列表（最多 6 行，溢出显 `… +N more`，每行带完成态字形）。原本内联的 `·备` / `·N/M` 徽标全部下沉到 hover 层 —— cell 本身保持视觉克制，稠密信息按需显示。
    - **无备注 → Radix tooltip**（窄幅、只读）：承担上述所有 meta。
    - **有备注 → Radix popover（hover 触发）**：除上述 meta 外追加一段 Markdown 渲染的备注正文（`prose` 样式、max-width ≈ 360px、max-height ≈ 280px、溢出滚动）。popover 与 tooltip 相比允许鼠标进入内容滚动/选中；关闭延时 200ms（移出 pill 再移入 popover 不会闪退）。实现细节见 §5.5.4。**为什么要拆**：120 字截断的原始 Markdown 源码塞在 tooltip 里读不出层次（列表、标题、代码都还原成一坨纯字符），popover 能真渲染才不丢信息。
  - **hover 才显的"+ 添加"行**：只在 cell（或其中某 pill）被 hover 时才浮现在 pill 栈底部，虚线、全 cell 宽、同一 step-3 色调。点击 → 同空 slot 的 inline `QuickCreate` 输入框。视觉语汇统一：虚线那行读作"还空着的一格 slot"。
  - **拖拽源**：每个 pill 都 draggable，`TASK_DRAG_MIME` 载荷 = taskId。跨 cell 拖拽 → `scheduleTaskToRail` 原地改写 `slot`；拖回自己的 `(date, rail)` 为 no-op（短路掉避免无意义事件）；`deferred` task 被拖重新排期 → 自动翻回 `pending`（与 backlog → cycle 一致）。
  - **Drop 视觉反馈**：拖拽时同时给两层提示，让"要丢到哪"无歧义。(1) 被 hover 的 **目标 cell** 加 `cta-soft/30` 的 ring；(2) 整条 **目标 Rail 行** 加 `cta-soft/25` 背景（该行未被 hover 的 cell 是更淡的 `cta-soft/15`），rail 左侧彩条从 1px × 24px 放大到 1.5px × 28px 并在行标签右侧出现一个 `→` 字形。两层反馈是用户反馈"单靠 cell 的 ring 在长列上分辨不清到底是哪条 rail"后加的。
- **"Rail 不适用"cell**（该列 Template 不生效 → 整列所有 cell）：**Rail step 4** 色 2px 间距对角斜线 hatching + 中心 Mono `—` + `cursor: not-allowed`。使用 step 4（而非 Skipped 的 step 6）让"不适用"比"被跳过"更淡，传达"这格根本没这条 Rail"而非"你曾经要在这里做事"。
- **视觉语义三分**（全 app 统一）：**实线 = 正常内容** / **虚线 = 可添加 or Ad-hoc 叠层** / **hatching = 降格状态（Skipped / 不适用）**。任何新交互必须落到这三类之一，不新增第四类。

**其他规划操作**：

- 批量操作：跨天复制 Task 分配、拖拽改期、整段跳过某 Rail。
- 从 Line 直接"撒"到未来若干天（AI 可给拆解建议）。

**Backlog 侧栏（split drawer 形态）**：

- **默认折叠**：点 summary strip 的 `backlog N →` 唤出右侧抽屉（320px 宽，从右滑入覆盖主 grid 的最右一两列）；ESC / 点蒙层 / 再点按钮关闭。
- **钉住（pin）**：抽屉内右上角一枚 📌 按钮 → 切换为**常驻侧栏**（主 grid 自动让出 320px，不再被覆盖）；再点一次 📌 解除。钉住状态持久化到本地 UI 设置（**不参与同步** —— 是设备个人偏好，不是规划数据）。
- **响应式降级**：lg 及以下屏幕强制走抽屉形态、忽略钉住标记；xl 以上尊重用户钉住状态。
- **抽屉内容**：Project / Task 列表（按 Project 分组、Task 可拖到 Slot），与 §5.5 的 Projects 独立视图互为补充（tab + 侧栏双入口）。
- **分组开关**（搜索框旁）：三档 segmented `None / Priority / Project`。`None` = 扁平列表（deferred 优先 · priority rank · order）。`Priority` = 分段为 `P0 / P1 / P2 / 未设`，空分段自动隐藏。`Project` = 按 Line 分段，Inbox 固定置顶，其余按名字。状态设备本地、不参与同步。加这个开关是为了让 §5.5 的 Task.priority hint 真正派上用场 —— 没有它，priority 就只是一个视觉 chip，不会影响用户的视线落点。

#### 5.3.1 编辑会话（Edit Session）：通用的批量撤销机制

我们**刻意不引入"Plan"或"EditMode"这类用户可见的名词**。取而代之是一个**对用户不可见的内部机制**，叫"编辑会话"（Edit Session）。理由：为了支持"批量撤销"而多立一个用户需要命名、管理的概念，增加的心智负担大于它带来的便利。

**会话模型**：

- 进入任何一个"深度编辑"视图（v0.3 范围：Template Editor、Cycle View；未来同机制可扩展到 Line 编辑、Calendar 规则编辑等）就开启一次**隐式会话**。
- 此期间产生的每条持久化 mutation（RailInstance override、Template Rail 增删改、Slot 绑定变化、Template 元信息修改…）共用一个 `sessionId`（内部字段，从不命名、也不在 UI 中暴露）。
- 视图顶部或 `⋯` 菜单内固定露一个按钮：**"撤销本次编辑"** —— 一次性回退当前会话中的所有 mutation。
- 离开视图（或空闲超时 15 分钟）会话关闭，这组改动不再能作为一批撤销；个别 mutation 仍可按日常方式单独编辑。

**范围与边界**：

- **Cycle View**（v0.3 起实装）：规划会话覆盖该视图内的所有 CalendarRule 写入（CycleDay 模板切换）+ Slot 内容变化（drag-drop 排期、slot popover 的移除排期 / 标记完成、空格 quick-create、orphan 守护批量 unschedule）。进入视图即开、离开或 15 min idle 即关；顶栏常驻"⤺ 撤销本次编辑 · N"按钮一键回滚会话。单条撤销入口（slot popover 的"移除排期" / CycleDay 的"恢复默认"）保留，和 session-undo 并存作为更细粒度的 safety net。
- **Template Editor**：编辑会话，覆盖当前 Template 的所有 Rail 增删改 + 元信息（color、name、description）变更。"撤销本次编辑"让用户放心大胆地试 —— 删错 Rail、拖错时段，一按还原。
- 规划后在 Today Track 做的微调产生独立 mutation，不属于任何会话。
- **重复出现的规划模式**（考试周、出差周、假期周）请走 **Template**：新建一份专门的模板，通过 Calendar 的日期范围规则挂上去 —— 这才是可复用多周安排的合适去处。没有"把这次规划保存下来"的流程。

**Template Editor 的特殊性**：由于 local-first 实时持久化（没有"保存"按钮，见 §5.4），编辑会话是 Template Editor 的安全网 —— 用户不用担心"改到一半退出会不会丢"（不会）、"改坏了怎么回退"（按撤销本次编辑）。

**不绑 Cmd+Z**（v0.2 决策）：会话级 undo 会一次擦掉 N 处改动，绑 Cmd+Z 误触风险过高。绑单步 undo 违反本节的 atomic-batch 语义，且带两套 undo 基础设施。所以入口只有 `⤺ 撤销本次编辑` 这一个显式按钮 —— 学习曲线略陡，零误触；未来若用户反馈强，可在 v0.3+ 把单步 undo 提到 §11 的开放议题里再议。

结果：用户面对的名词仍然只有 Template / Track / Rail / Shift / Line / Signal / Project / Task / Slot，没有管理页、没有升格流程，多了一个"后悔药"按钮。

### 5.4 Template Editor + Calendar

**Template Editor** 是 DayRail 里最密集的编辑界面 —— 专门给桌面端优化，两栏主体 + 顶栏 tab 条 + 顶栏下 summary strip。**不存在"保存"按钮 —— 所有修改实时落库（local-first）**。安全网是 §5.3.1 定义的"编辑会话"：顶栏右侧常驻编辑会话指示器（`N 处改动 · ⤺ 撤销本次编辑`）；`⋯` 菜单兜住低频动作。**首次进入 Template Editor** 时在内容区顶部出现一条可 `✕` 永久关闭的 inline 引导横幅："*改动即时保存。想反悔？点 ⤺ 撤销本次编辑。*"

- **顶栏 tab 条（sticky）**：横跨编辑器整宽。每个 tab = 模板名 + 底部 2px `Template.color` 色条（与 Cycle View 列头、D 组 mini-grid section label strip 同色 token），激活态色条加粗到 3px + 文字 weight 500。MVP 内置 `workday`（默认 `slate`）与 `restday`（默认 `sage`），用户可增删自定义模板。末尾固定一颗 dashed `+ 新建模板` tab。模板数超宽 → tab 条横滚（渐变遮罩提示可滚），不折行。键盘 ←/→ 切换 / Esc 跳出交给 shadcn Tabs + Radix Primitives。
- **Tab 条下 summary strip（36px，sticky）**：Mono 字体实时派生：`5 Rails · 合计 10.5h · 08:00 → 18:30 · 3 处空隙 (1.5h)`。编辑任一 Rail 时数字即时跳动（JetBrains Mono 固宽，不飘）。无交互入口，纯汇总；与 Cycle View D5 的 Top-3 Line 进度 strip 共享"每个主视图顶部默认呈现当前视图状态切片"的设计语法。
- **左栏（sticky，约 120px）**：纵向时间轴 06:00–24:00 线性映射，每条 Rail 渲染为按其 `color` (step 9) 着色的色块，带首行名称缩略。轴上另有**焦点箭头 `▶`**：跟随主轴聚焦的 Rail 同步 —— 滚动 / 点击主轴 Rail 行 → 左栏箭头移至对应色块；反向亦成立（点左栏色块 → 主轴滚到对应行）。时间轴下方列一份**空隙摘要**（`10:00–11:00 · 11:30–12:00 · 14:00–14:15`），纯展示、不可点，供一眼扫读"哪些时间段没安排"。
- **右栏（主轴）**：Rail 列表，时间升序自动排序。每张 Rail 卡片 = `border-l-4` 描边（取 `Rail.color` step 9）+ 左 4px 色条 + inline-edit 标题 + 可选 subtitle + 右侧 **time pill**（`08:00 → 10:00`, Mono）+ 色点 + `⋯` 行菜单。
  - **time pill 点击 → popover 双字段 picker**（start / end）：输入时实时查冲突，Esc 取消，回车 commit；检测到重叠 → pill 染警示色 + tooltip 告知撞上哪条 Rail。
  - **色点点击 → popover 2×5 Radix 色盘网格**（10 色 step 9，直径 28px，间距 12px），悬浮显示色名（`Sand` / `Sage` / `Slate` / `Clay` / `Apricot` / `Seafoam` / `Dusty Rose` / `Grass` / `Indigo` / `Plum`），当前色带环状描边；选中即 commit，popover 关闭。
  - **`⋯` 行菜单**：`删除 Rail` / `复制 Rail` / `设置默认 Line...`（点开弹带搜索的 Line picker popover；可空 = 不预设绑定）/ `在 check-in 条显示`（勾选式菜单项，就地切换 —— 见重写后的 §5.6）。
  - **重排**：Rail 的"位置"由时间定义，想把 10:00–12:00 的块挪到 14:00，改数字即可。MVP 不提供拖拽重排。**拖 pill 沿左栏时间轴平移**（保时长、挤 gap、阻塞冲突）记为 v1.x 纯增强手势，不作为唯一入口。
  - **行间 gap chip**：相邻两条 Rail 之间若有空隙 → 行间插入一条 `10:00–11:00 · 1h · + 填充 Rail` 的 inline chip（Mono）。点 `填充 Rail` → 自动新建一条时长 = gap 长度的 Rail，自动挑一个与相邻 Rail 不同的色（复用 §9.6 色板规则）。
  - **列表末尾固定一行 dashed `+ 添加 Rail`** —— 手动新建时自动在最大时间缝隙中选一个位置 + 自动取色。
- **顶栏右侧 `⋯` 菜单**（刻意没有"Save" / "New Template" 这类主 CTA）：
  - `撤销本次编辑` —— 回退本次编辑会话，见 §5.3.1。
  - `重置到默认` —— **仅内置模板**（`workday` / `restday`）可用；自定义模板禁用。
  - `复制新建` —— 以当前模板为底复制一份新模板，自动命名 `{name} 副本`，跳转到新 tab。
  - `删除此模板` —— **内置模板禁用**；自定义模板点击后二次确认；当前有 CycleDay 引用该模板时提示"将有 N 天落回默认工作日模板"。
- **Calendar**：独立视图，**标准月历网格形态**，标注每个日期当前生效的模板。
  - **顶栏**：`Mar 2026 ← →` 月份切换（或 popover year-month picker）+ 右上 `高级日历规则` 按钮 → 从右滑出 drawer。
  - **日期单元格**：背景色 = 当日生效 `Template.color` step 2；日期数字 + 周几缩写 (Mono, step 11)。今日用 step 11 色 2px 边框（**不用 terracotta** —— 锁在 Current Rail / primary CTA / Replace）；右上角小圆点表示有 Ad-hoc Event（用 Event 自身的色 token，也不用 terracotta）；左上角小 `●` 表示已被覆盖（色 = 覆盖模板的色）+ tooltip `已覆盖为 restday`。
  - **点单元格 → popover**：`应用模板: [tonal button group，当前生效的加 ring]` + `+ 今日添加 Ad-hoc Event` + `清除此日覆盖`（仅在已覆盖时可见）。
  - **拖选 / shift + click**：进入范围覆盖快捷入口 —— 自动跳到 drawer 的"日期范围覆盖"表单，起止日期已填好。
  - 默认规则：按星期几（工作日 / 周末）
  - **任意循环规则** *（折叠在"高级日历规则"抽屉里，对 99% 用星期几排日程的用户默认隐藏）*：不以 7 天为节奏的用户（4 天班 + 3 天休的倒班工人、10 天一轮的艺术家），可以新建循环规则 —— 指定 `cycleLength`（N 天）+ 起点 anchor 日期 + 每个循环位置对应的 Template。例：`{cycleLength: 7, anchor: "2026-01-05", mapping: ["work", "work", "work", "work", "off", "off", "off"]}`。**固定优先级**：当循环规则和星期规则同时命中某一天时，循环规则胜出（不暴露"规则排序"UI —— 少一个需要解释的旋钮）。日期范围 / 单日覆盖优先级仍高于循环。
  - 覆盖规则：日期范围 / 单日，优先级更高
  - 冲突解析："最小作用域优先"（Ad-hoc Event > 单日覆盖 > 范围覆盖 > 循环 > 星期规则 > 默认）
- **高级日历规则 drawer**：从右滑出，约 420 px。顶部提示 `规则按 Ad-hoc > 单日覆盖 > 范围覆盖 > 循环规则 > 星期规则 > 默认 的优先级生效`。分 4 section，每块带 `+ 新建` 入口：
  - **星期规则**（首次启动自动 seed：workday 覆盖周一-五 / restday 覆盖周末 —— 行为等价于旧的硬编码启发，但从此走事件）。
  - **循环规则**（默认无；新建表单：`cycleLength` / `anchor 日期` / `mapping[]`）。
  - **日期范围覆盖**（列出已有 range，可编辑 / 删除）。
  - **单日覆盖**（同上，高频场景；从月历单元格拖选也会走这条）。
  - drawer 关闭即 commit —— 无 Save 按钮（drawer **不**走 §5.3.1 Edit Session；规则改动属于 settings-tier，回退走单条 Remove / Edit 即可）。
  - **编辑策略**：v0.3.1 起每条规则右侧挂 ✎ 图标 → 原地打开表单、prefill 当前值、保存走 upsert-by-id；date-range / cycle rule 的 id 保持稳定（ULID），weekday rule 的 id 本来就是 `cr-weekday-{templateKey}`；single-date 的 edit 价值最低（直接在 Calendar / CycleDay 点日期重覆盖即可），不在 drawer 里露 ✎。
- **CalendarRule v0.3 实装细则**（与 §10 的 `type CalendarRule` 对齐）：
  - **Typed `value` variants**：`weekday` → `{ weekdays: number[], templateKey }` | `date-range` → `{ from, to, templateKey, label? }` | `cycle` → `{ cycleLength, anchor, mapping: TemplateKey[] }` | `single-date` → `{ date, templateKey }`
  - **ID 规则**：`weekday` id = `cr-weekday-{templateKey}`（一个模板一条 rule，weekdays 数组内覆盖）；`single-date` id = `cr-single-{date}`（已存在）；`date-range` / `cycle` 用 ULID（用户一次性手动创建）
  - **Priority**：single-date 100 · date-range 50 · cycle 30 · weekday 10（全部 miss 才回退内置启发）
  - **Resolver**：按 priority desc 遍历 rules，第一条匹配即返回；不暴露"规则排序"UI（priority 字段是内部稳定量）
  - **事件**：`calendar-rule.upserted`（payload = 完整 CalendarRule）/ `calendar-rule.removed`（payload = `{ id }`）—— v0.2 已上线的两条事件类型继续承载 v0.3 的所有 kind
- **Ad-hoc Event**：在 Calendar 上直接添加一次性时间块，独立于任何模板。

### 5.5 Tasks 视图

> v0.2.1 重构：原 `Projects / Lines View` 更名 `Tasks`。"Projects" 过于窄化，实际用户需要的是一个**任务管理主入口** —— 既包含 TODO 工具该有的基础能力（新建 / 删除 / 完成 / 恢复 / 搜索 / 过滤），也保留 DayRail 的排期语义（Rail / Cycle / Slot）。Project 作为**归属维度**仍然是核心概念，但不再是顶层视图名。

**哲学站位**：Tasks 是"底层 TODO 管理"，Rail / Cycle / Template 是叠在它上面的"调度哲学"。两者**不互斥** —— 大多数 task 会被排到某个 Rail（吃日程节奏的红利），少数一次性事件（医院预约、差旅）走自由时间（由 Ad-hoc Event 承接）。两种模式都是合法路径，默认推荐 Rail 模式。

**布局（桌面）**：

- **左栏（256 px · 导航树）**：
  - 📥 **`随手记`** —— 未归属任何 Project 的 task 的默认容器（见 §5.5.1 Inbox）
  - **`Projects`** 分组：按 `createdAt` 倒序列出；每项显示色条 + 名称 + 未完成数
  - **`Habits`** 分组：v0.4 交付；MVP 占位
  - 末尾 `+ 新建 Project / Habit`
  - 底部 `📦 已归档` / `🗑 回收站` —— 默认折叠
- **主体（右侧）**：
  - 顶部：搜索框 + filter chip 行 + 常驻 `+ 新任务` 输入框（Enter 直接落当前选中位置；无选中落随手记）
  - 主列表：按当前左栏选中项过滤，**按"未完成" / "已完成"两段折叠展示**（`未完成 (12) ▾` 展开、`已完成 (47) ▸` 默认折叠）。未完成为空时已完成**自动展开**、同时未完成 group 位置展示一句"都搞定了 ✓"。搜索命中时两段都展开。Archived / Trash 不进列表，走左栏"已归档 / 回收站"入口。
- **移动端**：折叠为两级（导航 → 列表）。

**Task 行的视觉规则**：

```
[●] 数据层接 store   📅 周三 · 工作 · 编码   [DayRail 开发]  ⋯
 ↑                  ↑ 排期信息（一等公民）  ↑ 所属 Project
 status icon                                 （跨 Project 列表时显示）
```

- **status 图标**：`○` pending / `◎` in-progress / `✓` done / `🗑` deleted。单击切换 pending ↔ done
- **title**：单行 truncate；hover / click 展开详情抽屉
- **排期信息（居中，一等公民，不是 metadata）**：
  - 已绑 Rail：`📅 周三 · 工作 · 编码`（日期 + Rail 名；过期未做加 ⚠）
  - 自由时间 Ad-hoc：`🕒 周三 14:30–16:00`
  - 未排：`— 未安排`（视觉最淡）
  - 点击 → 打开"排期 popover"（见 §5.5.2）
- **所属 Project pill**：随手记 / "所有 task" / 搜索结果中显示；已进入某个 Project 详情则隐藏（冗余）
- **hover 动作组**：完成 · 归档 · 排期… · 删除 · ⋯

**Filter chip（顶部一排）**：

- **状态**不再作为 chip 行出现 —— 改由列表里"未完成 / 已完成"两段折叠分组承担。Archived / Trash 依然只在左栏有入口。
- **排期**（mutex）：`任意` / `已排期` / `未排期` / `今日` / `本周` / `过期未做`
- **所属**：Project pill 多选（和左栏导航选中项取交集）
- **搜索框**：对 `title` + `note` 做文本子串匹配；搜索命中时两个折叠段都展开

**Project header（选中某 Project 时在列表上方）**：

- 色条 + 名称 + 状态徽章（active / archived）
- **任务数永远显示**：`7 / 15 任务`
- **进度条有条件渲染**：**仅当** Project 内至少一个 task 带 `milestonePercent` → 画一条（宽度 = done tasks 中 `milestonePercent` 的最大值）；无里程碑 Project 不渲染进度条，避免"进度永远 0%"的误读
- 时间窗：有 `plannedStart` / `plannedEnd` 才显示；**无 `plannedEnd` 不视为风险**（开放式 Project 合法，不贬成二等）
- `⋯` 菜单：重命名 / 改色 / 改时间窗 / 归档 / 删除（软）
- **Project 描述（Markdown）**：紧贴 header 下方、FilterBar 上方渲染 `Line.note`（见 §5.5.4）。可选字段，空则显示一行淡色占位"+ 添加描述"；点击进入编辑态。Inbox（`isDefault`）不渲染此区块。
- **标题 inline 改名**（Project / Habit 共用，Inbox 除外）：`<h2>{title}</h2>` 对可编辑 Line 响应 hover —— 右侧浮现一枚 `Pencil` 小图标；点图标或**双击标题**原地切成 `<input>`（抢焦点 + 全选），Enter 提交、Esc 放弃、失焦提交；trim 非空且与原名不同才发事件。不拦截重名（id 才是主键）。`⋯` 菜单的"重命名"项保留作为兜底入口（键盘 / 触控场景），行为改为切入 header 的编辑态。**不再使用 `window.prompt()`**。

#### 5.5.0 Habits（v0.3.3 起真实装，v0.4 深化）

**用户心智**（v0.4 锚定）：**habit = 一件反复发生的事**，不是"一堆事的桶"。Project 是 N 个 Task 聚成一个目标；Habit 是 1 件带 recurrence 的事。晨跑就是晨跑这一件事，它每天发生 —— 不应该在"晨跑"下面再看到"买跑鞋 / 查心率"这种 task 列表。

##### 硬约束与数据形态

- `Line.kind='habit'` 下**不持有手工 Task**。NewTaskInput 对 habit 详情页永不暴露。用户的临时任务（买跑鞋 / 查心率）自行决定 —— 丢 Inbox 或建 Project，habit 下不作为挂靠点。
- habit 的"每次发生"在数据上体现为一条 **auto-task**（`id = task-auto-{habitId}-{date}`、`lineId = habitId`、`title = habit.name`）。auto-task 和手工 Task 共用同一套 `Task.status` 生命周期 —— `pending / in-progress / done / archived / deleted` 语义一致。
- habit 的节奏由 **独立实体 `HabitBinding`** 决定（v0.4 更正）：每条 binding = habit + 已有 Rail + 可选的 `weekdays` 过滤器。一个 habit 可以有多条 binding，对应"跨模板 / 跨时段"的复合节奏（工作日 06:30 晨跑 + 周末 07:30 晨跑）。见 §10.4 HabitBinding 定义、§10.2 物化算法。
- **旧的 `Rail.defaultLineId` 字段在 v0.4 中完全移除**。它原本承担"habit 绑定"+"Project 快速排期默认 Line"两个职责，前者交给 `HabitBinding`，后者在没有真正 Line picker 的前提下从未可用 —— 一并删干净。Cycle View 的 quick-create 默认落 Inbox。未来如果需要"Rail → Project 默认"，另开一个独立字段 + 真正的 picker。
- **完成状态唯一真源** = `Task.status`（见 §10.1）。Today Track check-in / habit 详情节奏带 / Pending 队列 / Review 全部读写 auto-task 的 status，不再读 RailInstance.status。

##### Auto-task 的编辑性

auto-task 在 UI 层和手工 Task 绝大部分行为一致，唯一差异在**哪些字段可改**：

| 字段 | 手工 Task | Auto-task |
|---|---|---|
| `title` | 可改 | **只读** —— 始终等于 habit.name；habit 改名仅影响未来物化出的新 auto-task，旧的保持当时的名字（materializer 幂等，不回写） |
| `note` | 可改 | **可改** —— "今天状态不太好" 这类一次性上下文 |
| `subItems` | 可改 | **可改** —— "拉伸 5 分钟 / 跑 20 分钟 / 冷却 5 分钟" 这类一次性子项 |
| `slot` (排期) | 可改 | **只读** —— 排期本质是 HabitBinding 的规则；想改节奏去改 HabitBinding |
| `milestonePercent` | 可改 | **隐藏** —— habit 没有里程碑概念 |
| `status` | 可改 | 可改（走 check-in / Pending 路径） |
| 删除 / 归档 | 可 | 可（但当日 auto-task 归档了不影响明天再生） |

##### Habit 排期随 Template 走是特性，不是债

habit 被绑在具体 Rail 上、进而"每建一个新模板都要重新安排位置"，这是 DayRail 核心理念的直接后果，不是紧耦合：

- Template = 这一天长什么样；workday 和 restday 不是"一天的标签"而是**结构不同的两天**
- habit 是"安排*进*一天的一个活动"，不是"凌驾*于*日历之上的 cron"
- 新建模板 = 重新考虑"晨跑 / 早饭 / 英语阅读怎么嵌入" —— 本来就是建模板的意义
- 临时切模板（周三生病改成 restday）= 用户主动说"今天不是常规工作日"→ habit 不 fire 是对的

这条立场让一些过去担心的"痛点"被重新定位：

| 旧 framing | v0.4 立场 |
|---|---|
| 跨模板 habit 要建多条 rail，抄很多遍 | 这是规划多种日子，本来就是工作量所在 |
| 请病假导致 habit 不 fire | 用户已经把当天改结构了，不 fire 是对的 |
| 新模板后所有 habit 要手动迁移 | 新模板 = 新结构，迁移是 Template 的题中之义 |

##### Auto-task 物化策略 · Ⅱ（on-demand）

详见 §10.2。要点：

- 物化触发点：Today Track boot / Cycle View 切换 / 节奏带打开 / Calendar 翻月 / Review 切 scope / 节奏带点回填
- **物化过的 (habitId, cycleId) 打标记，后续不重算** —— 避免配置变更后过去又多出一堆 auto-task
- 幂等 id 确保重复触发不产生重复

##### Habit 配置变更规则

详见 §10.3。**核心规则一句**：改 Rail 的 recurrence / 时间 / templateKey / defaultLineId 之一时，只影响**尚未开始**的 auto-task（`status='pending' AND plannedStart > now`），已完成 / 跳过 / 归档的保留不动。保存前弹 confirm。

##### 产品分层

- **简单型 habit**（默认）：固定强度（每天跑 30 分钟保持心情），没有阶段性目标。**默认不暴露 phase 概念**，详情页只显示：名 / 色 / 节奏热力带 / 绑定 Rail / 备注。
- **进阶型 habit**（opt-in）：用户在详情里 "+ 启用 phase 追踪" 之后新增第一条 phase 记录，页面开始出 phase 时间线。

##### Habit 详情页布局（v0.4 固化）

```
┌───────────────────────────────────────┐
│  ● <habit 名>                         │  ← 名 + 色 strip + 当前 phase 副标
├───────────────────────────────────────┤
│  Rhythm                               │  ← 近 14 天小热力带（复用 RhythmHeatmap 单行）
│  ▣▣▢▣░▢▣▣▣ ...                     │     状态由 auto-task.status 映射
├───────────────────────────────────────┤
│  Schedule                             │  ← 绑定 Rail 列表
│  每工作日 · 06:30-07:00 (workday)     │
│  周末 · 07:30-08:00 (restday)         │
│  [+ 添加节奏 → Template Editor]       │
├───────────────────────────────────────┤
│  Phases（已启用才渲染）               │  ← v0.3.3 的 PhaseForm / 列表原封不动
├───────────────────────────────────────┤
│  备注（Markdown）                     │  ← Line.note 长文字段；v0.4 附加，Markdown 渲染（§5.5.4）
├───────────────────────────────────────┤
│  Danger: 归档 / 删除                  │
└───────────────────────────────────────┘
```

**不出现**：NewTaskInput、FilterBar（schedule chips）、GroupedTaskList —— 这些属于 Project 视图。

##### 节奏带交互（A+B · 读 + 点击回填）

节奏带格子映射：

| 视觉 | 条件 |
|---|---|
| 绿实填 · done | auto-task.status = 'done' |
| 斜纹 · shifted | auto-task 有关联 Shift 且 status ≠ 'pending' |
| 斜纹 · skipped | auto-task.status = 'archived'（跳过当次） |
| 空白 · unmarked | auto-task.status = 'pending' 且 plannedStart ≤ now（该发生但没标） |
| 灰 · empty | 该日 Rail 不 fire（recurrence 不覆盖 / 模板不匹配 / rail 当时不存在） |

**A · 只读节奏带**（v0.4 必装）：以上状态纯读。今天要打卡 → 走 Today Track 的 check-in 条。

**B · 点击回填**（v0.4 必装）：点任意非 empty 格子 → 小菜单 `done / skipped / shifted / clear`，选后 upsert auto-task（如未物化则现场创建，id 幂等）+ 改 status。点 empty 格子无响应（那天 rail 不 fire，没有意义）。

**为什么两者都要**：A 是主路（今天的事在 Today Track 打卡）；B 是兜底（忘标 / 漏开 app / 事后补打）。把 B 做成节奏带原生交互（而非另开一个"编辑记录"入口）是因为用户查看节奏时才会意识到"那天忘了"，在看见的地方直接改最自然。

##### HabitPhase 数据

（见 §10）：纯时间段 label，不引入 streak / 完成率派生。一条 phase = `{ name, description?, startDate }`；没有 endDate —— 下一个 phase 的 startDate 就是上一个的隐式截止。"当前 phase" = `startDate <= today` 里 startDate 最大的那条。

**"启用 / 未启用"派生**：和 `Line.phaseEnabled` 之类的冗余字段无关。**关联 HabitPhase 记录数 ≥ 1 = 已启用；= 0 = 未启用**。删到一条不剩就自动回到"未启用"。

##### SideNav 中 Habits 分组（每个 habit 一行）

| 场景 | 列表行显示 |
|---|---|
| 未启用 phase | habit 名 |
| 已启用 phase | habit 名 + 副标显示当前 phase 名 |

##### 事件

- `habit-phase.upserted`（payload = 完整 HabitPhase）/ `habit-phase.removed`（payload = `{ id }`）。id 用 ULID
- auto-task 复用 `task.created` / `task.updated` / `task.purged`；payload 里加 `source: 'auto-habit'` 辅助审计（不影响 reducer 语义）

##### 非目标 (v0.4)

- **不做自动升降 / 推荐**。 phase 何时切换完全由用户决定；没有"你 14 天没 miss，建议升期"这种 magic。
- **不派生 streak / 完成率**。 Review 视图的 habit 节奏展示已经单独覆盖（§5.8）；habit 详情页只做近期小带，不重复造。
- **不预设 phase 枚举**。 用户自由命名（"热身期" / "基础期" / "冲刺期" / "恢复期" 都合法）。
- **不做 habit-下-Task 的折叠小抽屉**。前期讨论过的 B 方案（保留折叠 Task 区），方向不一致 → 放弃。
- **habit 和 Rail 合并成单一实体**（把 `Line.kind='habit'` 移除、让 habit = Rail 族）—— **拒绝**。当前的三轴分离是特性不是债（见上"Habit 排期随 Template 走是特性"段）；合并只是过早 abstraction，不解决真问题。此前开放问题关闭。

#### 5.5.1 Inbox

- **系统内置、全局单例、不可删**。id 固定 `line-inbox`；`Line.isDefault: true`；UI 上无重命名 / 改色 / 删除入口
- **首次启动自动 seed**：和 sample templates 同一批次；即使用户清空其它 Line，随手记始终在
- **落点规则**：新建 task 时不挑 Project → `lineId = 'line-inbox'`，进随手记
- **出口**：用户把随手记 task 拖到某个 Project → `lineId` 变更，task 随之归位
- 随手记 task 的排期 / 完成 / 归档 / 删除动作与普通 Project task **完全一致**（心智零迁移）

#### 5.5.2 排期模式（两种并存，Rail 优先）

点任一 task 行的"排期…" → 打开 popover：

```
┌──────────────────────────────────────┐
│  排到某天：[📅 2026-04-22]           │
│                                      │
│  时段：                              │
│  ◉ 绑定 Rail              ← 默认     │
│     [⏳ 工作 · 编码  14:00-16:00 ▾] │
│  ○ 自由时间                         │
│     [14:30] → [16:00]                │
│                                      │
│               [取消]  [确认排期]     │
└──────────────────────────────────────┘
```

**模式 A · 绑定 Rail**（默认）：
- 下拉**默认只展开**所选日期对应 Template 下的 Rail（按 CalendarRule + weekday heuristic 解析）。
- 列表底部有一个**折叠组「其它模板的 Rail」**（默认收起），点击展开后能看到其它模板下的 Rail —— 跨模板钉一条 Rail 的逃生口（避免用户为了排一次跨模板就先去 Calendar 改 CalendarRule）。
- 确认 → 写 / 更新 Slot（`cycleId, date, railId`），把 task 的 `slot` 指向它；多 task 可共用同一 Slot（`taskIds` 是数组）。
- 若当天没模板（或模板无 Rail）→ 当天分组为空 + 折叠组直接展开 + 提示"这天没有模板 Rail，请用自由时间或先去 Cycle View 设模板"。
- v0.11.4 修正：v0.11 实装时 RailPicker 把所有模板的 Rail 一股脑显示、只把当天模板组打高亮，跟本节描述的「narrow + fallback」不一致。本次修正恢复 ERD 原意。

**模式 B · 自由时间**：
- 用户直接指定起止时间
- 确认 → 创建 `AdhocEvent`（`date, startMinutes, durationMinutes, taskId`），task 自身 `slot` 为空
- Ad-hoc 以 1.5px 虚线外框渲染在 Today Track / Cycle View 的对应时段（§5.2 叠层规则）
- 适合：医院预约、跨行程一次性事件、差旅时段

**取消排期**（从已排状态回到未排）：
- 模式 A：删 Slot 的 `taskIds` 里那一项（同一格无其它 task 时整行 Slot 删除）
- 模式 B：软删对应 AdhocEvent
- **均无副作用** —— 不记 Shift、不改 task 状态

**为什么默认 A**：Rail 节奏是 DayRail 的独特价值。A 保持日程有型；B 是逃生口不是推荐路径。两条都在、默认偏 A，能覆盖 95% 场景而不让 5% 的人卡住。

#### 5.5.3 可逆性 & 软删除

所有破坏性操作默认**软删除**，入口"回收站" filter 找回。唯一硬删口是软删之后再手动点"永久删除"（二次确认）。

| 动作 | 类型 | 撤销路径 |
|---|---|---|
| Complete task | 状态切换 | 再点一下 status 图标 / "恢复为未完成"按钮 |
| Archive task | 状态切换 | "恢复为 Active" |
| Delete task | 软删（`Task.status = 'deleted'`）| 回收站 filter → 恢复（回到 pre-delete 的 status） |
| Purge task | 硬删（触发 `task.purged` 事件，DB 行删除） | **无** —— 二次确认框明说 |
| Delete Project（Line）| 软删（`Line.status = 'deleted'`）| 同上 |
| Delete AdhocEvent | 软删 | 同上 |
| Delete Rail（template）| v0.2.1 仍然只能归档 | 解除归档 |

**已删除 task 的级联**：自动解除排期（清 `slot` 或软删关联 Ad-hoc），已完成的 subItems 保留。**恢复不自动重建排期** —— 用户重新点"排期…"即可。

**事件日志**：`task.deleted` / `task.restored` / `task.purged` 三条；`line.deleted` / `line.restored`；`adhoc.deleted` / `adhoc.restored`。Edit Session 级 undo 可以撤回 `*.deleted`；`*.purged` 明确不进 session。

---

**Projects 在 Cycle View 里的入口**：原 Cycle View 的 Projects 侧栏继续存在（§5.3 Backlog drawer），MVP 功能是"从 backlog 拖 task 到 slot"。Tasks 视图和它互为补充 —— 一个是"管理 task"，一个是"规划时间"。

**Habit / Phase 过渡标记**：仍按原设计挂在 Habit Line 上（见 §4.1），v0.4 交付。Tasks 视图里 Habit 分组的 UI 行为与 Project 并列但单独规则（习惯不是任务堆，而是节奏追踪）—— 详见 §5.5.0 v0.4 Habit 详情页布局。

#### 5.5.4 Markdown 长文字段（备注 / 描述）

DayRail 里承载 Markdown 的长文字段共 **两个**：

| 字段 | 存储位置 | UI 入口 |
|---|---|---|
| `Line.note` | 所有 Line（`project` / `habit` 均启用；Inbox / 归档桶 / 回收站不编辑） | Project 详情页 header 下方；Habit 详情页 Notes 段（§5.5.0 v0.4 布局） |
| `Task.note` | 手工 Task + auto-task | TaskDetailDrawer 的"备注"区 |

**非 Markdown 字段**：`HabitPhase.description` 属于单行"目标"，保持**纯文本**不做 Markdown 渲染（一个样式带来的噪声大于价值）。

##### 渲染（共享组件 `MarkdownField`）

- **展示态**：`react-markdown` + `remark-gfm` 渲染 GFM 子集 —— 标题 / 有序 & 无序列表 / 任务列表 / 链接 / 代码块 / 行内代码 / 引用 / 表格 / 删除线 / 水平分割线。**不开启原生 HTML**（安全 + 视觉一致）。
- **空态**：淡色一行占位 `+ 添加描述` / `+ 添加备注`，点击直接进入编辑态。
- **切编辑态**：点击展示态或占位 → textarea 抢焦点。
- **保存**：失焦自动保存（trim 后写入；空串统一写 `undefined`）。`Cmd/Ctrl + Enter` 立即保存并退出。
- **Esc = 提交并退出**（和失焦一致，不放弃改动）。destructive "放弃" 入口只在大屏 Dialog 的 `↶ 放弃` 按钮 —— 避免单键误触把长文清空的 footgun。
- **大屏编辑入口**：编辑态右上角有一枚 `Maximize2` 图标按钮，点击打开大屏 Dialog（下详）。

##### 编辑器键位（Markdown-aware `<textarea>`，不引入重型编辑器）

| 键位 | 行为 |
|---|---|
| `Tab`（无选区） | 光标处插入两个空格 |
| `Tab`（有选区） | 所选行整体缩进 2 空格 |
| `Shift + Tab` | 所选行（或当前行）去缩进 2 空格；行首不足 2 空格则全清 |
| `Enter`（在 `- ` / `* ` / `1. ` / `> ` / `- [ ] ` 等行尾） | 换行并延续同样前缀；有序列表递增序号 |
| `Enter`（空列表 / 引用行） | 擦除当前行的列表 / 引用前缀并退出延续（第二次 Enter 的直觉） |
| `Cmd/Ctrl + B` | `**…**` 包裹选区（无选区则插入占位符并光标定位在中间） |
| `Cmd/Ctrl + I` | `*…*` 包裹选区 |
| `Cmd/Ctrl + Enter` | 立即保存并退出 |
| `Cmd/Ctrl + Shift + E` | 切换大屏 Dialog（in-place 编辑态 → 打开；Dialog 内部 → 关闭并回到 in-place） |
| `Cmd/Ctrl + P` | 大屏 Dialog 内：切换**分栏预览**的开 / 关 |
| `Esc`（in-place） | 提交并退出（和失焦一致，不放弃改动） |
| `Esc`（大屏 Dialog） | 关闭 Dialog（未保存改动按提交处理，和 backdrop click / X 一致） |

**为什么不上 CodeMirror / Milkdown / TipTap**：体积（CM 6 加 markdown lang ≥ 120KB gzip）和交互学习成本都超出"一个单人工具的备注框"的收益；smart textarea 已覆盖 95% 的日常写作需要。

##### 大屏编辑 Dialog（分栏版）

in-place 编辑区适合短备注，长文（Project 描述常常几百到上千字）需要更大画布 + 渲染参考。`MarkdownField` 内置一个 "大屏模式"：

- **触发**：编辑态右上角 `Maximize2` 图标 or `Cmd/Ctrl + Shift + E`
- **容器**：Radix Dialog，modal，居中；宽 `min(1040px, 94vw)`，高 `88vh`
- **布局（默认分栏开）**：左右 50/50 两栏，中间一条 1px 可拖拽 divider（拖拽范围 20%–80%）
  - **左栏**：`MarkdownEditorTextarea`（和 in-place 同一个实例，键位完全一致）
  - **右栏**：`MarkdownView`，实时跟随左栏输入渲染（`prose-sm` 样式，溢出独立滚动）
  - 预览与编辑的滚动**不强行同步**（单人工具不值得实现；想对齐的用户手动滚就够了）
- **Header**：标题（`Project 描述` / `备注` 等 context-aware 文案）+ 预览开关（`👁 分栏` / `✎ 只编辑`，对应 `Cmd/Ctrl + P`）+ 关闭 `X`
- **Footer**：一行 subtle 快捷键提示（`⌘+Enter` 保存 · `Esc` 关闭 · `⌘+P` 切预览）
- **保存语义**（和 in-place 完全一致，不引入第二套状态机）：
  - `Cmd/Ctrl + Enter`：保存并关闭 Dialog（回到 in-place 展示态）
  - 点击 backdrop / `Esc` / `X`：关闭 Dialog；**未保存改动按"保存"处理**（与 in-place 失焦一致的乐观写入）。避免"改一堆 → 点外面关掉 → 全丢"这种常见误操作
  - 显式放弃：Dialog 右上 `↶ 放弃` 小按钮（只在 dirty 时浮现；点击 = 恢复原值并关闭）
- **与 in-place 的关系**：Dialog 打开时 in-place 区块进入"mirror 态"（不可交互的静态展示），避免两处同时编辑；Dialog 关闭即回原状

**只编辑（单栏）模式**：`Cmd/Ctrl + P` 或 header 切换按钮隐藏右栏，让编辑区占满 Dialog 宽度。适合先写、后看效果。

**为什么分栏而不是 "Tab 切编辑/预览"**：DayRail 已经有足够多的 "tab 切来切去" 面板（Pending / Review / Calendar drawer）。长文编辑当下最希望看到"写的同时看到结构变化"，分栏一次到位。

##### 备注 hover popover（CycleCell / RailCard 共用）

Cycle View pill 和 Today Track 的 RailCard 徽标在 hover 时都可能展示 note 预览。**非 tooltip**（tooltip 不能容纳 Markdown）而是一个独立的 `NoteHoverPopover` 组件：

- **触发**：有 note 的 pill（CycleCell pill 的 note-分支）/ RailCard 的 `· 备注` 徽标 → hover 200ms 开启、移出 200ms 关闭；鼠标进入 popover 内部时暂停关闭（允许滚动 / 选中）
- **内容**：顶部一行紧凑 meta（CycleCell 场景与当前 tooltip 一致；RailCard 场景仅 Markdown 正文，meta 主体上已展示）+ Markdown 正文（`prose-sm` 最大 360 × 280px，溢出滚动）+ 底部可选的 sub-items 列表（CycleCell 场景保留）
- **无 note 的 pill 仍走 Radix tooltip**（窄 + 只读）；RailCard 上没有 note 时 `· 备注` 徽标本就不渲染，无影响
- **样式**：浅 surface 底 + hairline 边，阴影弱于 TaskDetailDrawer（不喧宾夺主）

实现上 popover 用已安装的 `@radix-ui/react-popover`；hover 触发需要手搓 `onMouseEnter` / `onMouseLeave` 控制 `open`（Radix popover 默认是 click-trigger）。

##### 搜索与兼容

- `§5.5` 搜索框对 `title` + `note` 做**子串**匹配 —— 直接对原始 Markdown 源码匹配即可；不额外剥离语法（`**重要**` 的检索命中 `**重要**` 是期望行为）。
- v0.3 之前写进 `note` 的纯文本在 Markdown 语义下完全等价，不需要迁移。

#### 5.5.6 过期 task 变更的 Review 记账（v0.4.1 起）

**问题背景**：v0.4 之前，`Shift` 只在 check-in 条 / Pending 队列点 `defer` / `archive` 时产生。**已过期 task** 上还有两种变更也被静默丢掉：

- **挪到另一天**走 `scheduleTaskToRail` / `scheduleTaskFreeTime`（v0.4.1 修）。
- **直接取消排期**走 `unscheduleTask`，即 Schedule popover 上的「取消排期」按钮（v0.4.2 修）。

两条路径都只发各自的事件（`task.scheduled` / `task.unscheduled`）、**不产生 Shift**；Review 的热力图由 `Task.slot.date` 派生，变更后旧日期的格子从"过期未做（`unmarked`）"悄悄退回"rail 空着（`empty`）"。Review 不但没统计到动作本身，连"曾经过期过"的灰迹也被抹掉了。

这正好是 Review 最该统计的信号（"这周有多少事被推走 / 被拿掉 / 哪些事一直在被推"），不能丢。

##### 触发规则

两个触发点共享一套 gate：

```text
priorDate   = task.slot?.date ?? activeAdhoc(task.id)?.date
todayIso    = toIsoDate(new Date())
isAutoHabit = task.source === 'auto-habit'

共享 gate（两种类型都要过）：
  !isAutoHabit
  priorDate != null
  priorDate <= todayIso    // 今天或过期都算
```

> **v0.10.x（2026-05-14）gate 放宽**：v0.4.1 原始 gate 是
> `priorDate < todayIso`，今天的 task 被沉默处理（视作"还没过期 ·
> 是规划不是 slippage"）。半年使用回看，**今天的改期 / 取消排期既
> 可能是日历调整，也可能就是当天的拖延**（"我今天搞不完"），沉默
> 处理等于丢掉了一半的真实 defer 信号。v0.10.x 把 gate 放宽到
> `priorDate <= todayIso`，今天的动作也弹 toast 让用户挑边。严格
> 未来日期（`priorDate > todayIso`）仍然沉默 —— 还没到那天，自然
> 谈不上 slippage。

- **`reschedule`** —— 由 `maybeEmitReschedule` 在 `scheduleTaskToRail` / `scheduleTaskFreeTime` 的绑定 mutation 提交后发出。额外条件：`nextDate != priorDate`（同日切换 rail 不算）。
- **`unschedule`** —— 由 `maybeEmitUnschedule` 在 `unscheduleTask` 清掉 slot / adhoc 后发出。没有 `next*`，task 去向是"没有"。

**明确不触发**的场景（写出来避免实现时边界漂）：
- **严格未来**日期的 task 上做这两个动作（`priorDate > todayIso`）—— 这是规划，不是 slippage。v0.10.x 前包括 today；现在 today 触发。
- 首次排期（`priorDate == null`）。
- 当天内切换 rail（仅 reschedule，`nextDate == priorDate`）—— 跟改期到今天哪条 rail 无关，今天 → 今天 swap 也走这条 filter。
- auto-habit task —— `slot` 在 habit 详情页是 read-only（§5.5.0），两条路径都不打开。
- `deleteTask`（软删有自己的 Trash 事件语义，Review 不走 heatmap；见下文"暂不做"）。

##### Shift 的形状

```text
{
  id:      ulid-like,
  taskId:  <task>,
  type:    'reschedule' | 'unschedule',
  at:      ISO now,
  payload: {
    // 两种类型都有：
    fromDate,
    fromRailId?,   // prior 是 rail 模式时
    fromAdhocId?,  // prior 是 ad-hoc 模式时
    // 仅 reschedule：
    toDate?,
    toRailId?,     // new 是 rail 模式时
    toAdhocId?,    // new 是 ad-hoc 模式时
  },
  tags: [],        // 先以空数组持久化；Reason toast 再通过 shift.tags_updated 追加
}
```

`ReschedulePayload` 带 `from*` + `to*`；`UnschedulePayload` 只带 `from*`。

**v0.11 修订（§10.6）**：当源 Task 关联了 occurrences 时，`Shift` 顶层
新增 optional `occurrenceId` 字段；写路径优先填该 occurrence 的 id（落到
具体被改的那条 occurrence 上），同时 `taskId` 兜底保留。occurrences 为空
的老 Task 行为不变（只填 `taskId`）。Review heatmap 的 cell upgrade 路径
也优先按 occurrence 聚合，再 fallback 到 Task。多日工作首次有"周一那块
被推走、周三那块还没动"这种细粒度记账。

##### Reason toast

共用 §5.2 的 `ReasonToast`：

- `action='reschedule'` → 文案"已改期 · {taskTitle} → {toDate}"
- `action='unschedule'` → 文案"已取消排期 · {taskTitle}"

两种路径共走同一个流程：

- 触发：store 写完 Shift 后，把 shift 对象塞进 `pendingShiftPrompt`（由 v0.4.1 的 `pendingReschedulePrompt` 更名）；App Shell 上挂的 `useShiftPrompt` hook 订阅到、弹 toast。
- Tag pick 后：`setShiftTags(shiftId, tags)` —— `shift.tags_updated` 事件（payload `{id, tags}`），reducer 以集合并入（多次 update 可交换）。
- 关闭路径（点 X、Esc、或自动 6s 超时）：若有 tag 则写入，然后 `ackShiftPrompt(shiftId)` 清队列。
- **不提供撤销按钮**（`showUndo === false`）—— mutation 已提交，反向操作是通过 Schedule popover / 拖拽重排，直接操作比 toast 按钮快。

##### Review 消费

`reviewFromStore.ts` 在 heatmap 派生阶段多一步（一套集合覆盖两种类型）：

- 遍历 `state.shifts`，对每个 `type` ∈ `{'reschedule', 'unschedule'}` 且 `payload.fromRailId` / `payload.fromDate` 都存在、且 `fromDate` 落在 review 窗口内的，加入集合 `shiftedFromKey = '{fromRailId}|{fromDate}'`（由 v0.4.1 的 `rescheduledFromKey` 更名）。
- 原有判断：如果 cell 既不 done / deferred / archived 也无 task，且 `date < today` 就标 `unmarked`。**升级**：`unmarked` 且 `shiftedFromKey.has('{rail.id}|{date}')` → 升级为 `shifted`。
- `ShiftTagBars` 不用改 —— `aggregateShiftTags` 天然把 `reschedule` 和 `unschedule` 的 tags 一起纳入计数。视觉上暂不分段（"弃用/顺延" vs "改期/取消排期"），v0.4.2 先合并展示。

##### 与其他系统的关系

- **Event log 兼容**：`shift.recorded` payload 现在覆盖 `type='reschedule'`（v0.4.1）和 `type='unschedule'`（v0.4.2）两种。旧行全部 `defer/archive`，不受影响。`shift.tags_updated` 是 v0.4.1 引入的事件类型，v0.4.2 原样复用。
- **事件 replay 幂等**：`shift.tags_updated` 的 reducer 以 `Set` 合并 tags，多次 replay 得到相同结果。
- **数据库 schema 零改动**：`shifts.type` 已是 TEXT，`shifts.payload_json` 已是 JSON TEXT。
- **先取消排期、后重新排期 的链路**：用户如果先取消一个过期 task 的排期、之后从 Inbox 再排期，只会产生一条 `unschedule` shift —— 因为这时 reschedule 的 gate 会看到 `priorDate == null`（绑定已被 unschedule 清空）不触发。`unschedule` 已保住"曾经过期过"的灰迹；后续重排相当于"在已决定的状态上重新开工"，不是第二次 slip。

##### 暂不做

- **撤销 shift**：两种类型都不支持一键反向，用户通过拖拽 / Schedule popover 手动重排即可。
- **拆分 ShiftTagBars**：把"弃用 / 改期 / 取消排期"分段展示，视觉复杂度增加但信息密度未必提升；先看真实数据。
- **auto-habit 记账**：auto-task `slot` 是 read-only（§5.5.0），两条路径都不打开。
- **软删记账**：删除过期 task 是更决绝的动作，已有自己的 Trash / purge 事件语义。是否也发 Shift 留开 —— 当前倾向是 Trash 服务的是另一个 Review 面（"我决定这事不值得做"），不走 heatmap。

### 5.6 Signal：打开 App 时的 check-in 条

**设计立场**：OS 级 push 会把 DayRail 拉向 Todoist / TickTick 这类"被 App 追着跑"的形态，与"工具应该安静"的核心理念冲突。吃药、晨跑这类"不提醒就错过"的硬闹钟场景，交给系统闹钟 / 日历推送更可靠；DayRail 不去和它们竞争。

- **没有系统通知、没有原生推送、没有通知权限申请链路**。不集成 Capacitor 通知模块，不调用 Web Notification API。
- **Signal 的唯一表现形式 = check-in 条**：用户**打开 App**（或 App 已在前台、新的 Rail 在当下结束）时，Today Track 顶部自动浮出：
  `☕ 《专注工作》09:00–11:00 已结束 · 完成 / 以后再说 / 归档`
  - **命中条件**（v0.4 起按 §10.1 单一真源重写）：对每条当天已结束的 Rail，看它承载的 Task（手工 task 或 habit 的 auto-task）；`Task.status = 'pending'` 且 `plannedEnd < now` 且 `plannedEnd > now - 24h` 且 `Rail.showInCheckin = true` 的出现在 check-in 条。裸 Rail（没 Task 承载）不再出 check-in 条 —— "要标记完成"这件事本来就附着在具体 Task 上。
  - **多条同时命中** → 折叠为一行 `3 条已结束的 Rail 待标记 ▾`，展开显示列表；单条处理后不自动折叠，列表保持连续可操作。
  - **按钮语义（与 §5.2 hover 动作栏完全一致，v0.4 起写 `Task.status`）**：
    - `完成` → `Task.status → done`
    - `以后再说` → `Task.status → deferred`（新加枚举值），落入 §5.7 Pending 队列
    - `归档` → `Task.status → archived`，终态；循环 Rail 的 auto-task 额外弹 3s toast `已归档今日的 <name>；明天仍会物化新的 auto-task`
  - **Signal 事件仍然记录**（`signal.acted` payload 里带 railInstanceId + response），作为审计轨迹；同时 Task.status 被改写。RailInstance 不再承载 status 语义。
  - **Reason toast**：每次点动作后在条目下方浮出（§5.2 定义的 6 秒 undo-toast），可选 3 枚快速原因 chip 附 tag。
- **per-Rail 开关 `showInCheckin`**（默认 `true`）：Template Editor 行 `⋯` 菜单中勾选切换（见 §5.4）。关闭 = 这条 Rail 静默走完，不进 check-in 条也不进 Pending 队列（适合纯结构性 Rail，如"午休"—— 没什么要追踪的）。
- **不自动降级**：连续多天 `完成` / `归档` 不会自动关掉 check-in；用户可以主动在 Rail 设置里关。静默替用户决定"不再 check-in"会从"安静"滑向"缺席"。

### 5.7 待决定（Unresolved）队列

§5.6 的 check-in 条覆盖的是"刚结束"的时态。**更久以前还没决定的 Rail**、以及**显式点了"以后再说"的 Rail**，都汇入 Pending 队列。入口两个，出口一个。

**来源**（v0.4 起查 Task，不查 RailInstance）：

1. **显式 defer** —— 用户在 check-in 条 / Today Track 里点"以后再说"。`Task.status → deferred`。
2. **结束未标记** —— 所有 `Task.status = 'pending'` 且 `Task.slot.date + Rail.endMinutes ≤ now` 的 Task（含 auto-task）。**任意年龄**，不再做"超 24h 才沉降"的老化过滤。

Pending 是"等待决定"的**全集**；§5.6 check-in 条是它"近 24h 这一段"的子集展示 —— 同一条 task 会同时出现在两处，点任一处的按钮两边都会同步消失。刻意让 Pending 列表无隐藏项，避免出现"东西找不到在哪里"的状态。

**刻意不采用的设计：** "昨天的 Rail 没标记，今天不让操作"。这违背核心理念（偏离是一等操作，归档无后果）。

**采用的设计：**

- 队列永远不阻塞任何当前操作；Today Track / Cycle View / Template Editor 的流程互不干涉。
- 系统**不会自动**把未标记条目改写为 `archived`。长期未决定就一直在队列里，这是用户的选择。
- 若某个 Rail 被连续多天漏标记，AI Observe（如已启用）温柔提示是否调整 / 归档。
- **重新排期**：用户在 **Cycle View 里把 Pending 项拖到某天的某个 Slot 位置** → `Task.status` 回到 `pending` + `Task.slot` 指到新 (cycleId, date, railId)。拖拽是主要的"后悔药"入口，不在 §5.7 页面内做。
- **批量归档较旧事项**：队列堆得很多时，用户可一键归档超过 N 天的条目（默认阈值 **7 天**；可在 设置 → 高级 调整）。近期（≤ N 天）的 Rail 仍留在队列里，值得用户决定一下。**按钮文案就说清楚要做什么**：`归档超过 7 天的事项`（不是修辞式的"让它们都过去吧"）。确认弹窗直接说明影响与代价：*"归档超过 7 天仍未决定的 N 条事项？它们在历史里仍可检索，但不再出现在此队列。"* 历史不被改写；只是队列被缩短。

**页面形态**：

- **顶栏**：标题 `Pending` + 合计行 `47 条 · 最早 Mar 12`；右上 `归档超过 7 天的事项` tonal 按钮（灰态；右侧附 `(影响 31 条)` 计数，仅对 > 7 天项生效）。
- **主体**：按日期**反序**分组（最新在上），组标签 `Mar 14 (Fri) · 3 条`，组内逐行展示该日未决定的 Task。`deferred` 与 `pending(stale)` 在行上除了左侧图标略不同外视觉一致。
- **每行**：4px 左色条（`Rail.color` step 9）+ Task 标题（手工 task 用用户写的，auto-task 用 habit 名）+ 原计划时间 `09:00–11:00` (Mono) + 3 个 inline 小按钮 `完成 / 归档 / 拖到 Cycle →`。前两个就地写 `Task.status`；第三个以 ghost 态提示"去 Cycle View 重新排期"，点击跳转。
- **无多选 / 无批量栏**：每条独立决定；批量操作只留"归档超过 7 天"一个通道。（设计意图：避免"一键全部完成"式的不假思索判定 —— 那会让 Review 数据失真。）
- **空状态**：`队列为空 · 未决定的 Rail 超过 24 小时后会出现在这里`。
- **侧栏导航入口**：App 左侧 nav 的 `Pending` 项仅在队列 `> 0` 时露出一个 `·` 小点（**不显示数字**，避免"我有 47 件事没做"的焦虑数字）；鼠标悬浮 tooltip 给出具体条数。

### 5.8 回顾：Timeline + AI Review

- **外层布局**：日 / 周 / 月是同一份复盘的三个尺度。**桌面端**三者并排；**移动端**在页面顶部放一个 **sticky 分段控件**切换尺度，下方一次只渲染一个尺度。这样页面不会 3 倍高度，又不丢上下文（当前尺度始终在控件上可见）。Tab 方案被放弃 —— 窄屏下可发现性不如分段控件。
- **单个尺度的内部结构（从上到下的瀑布）**：标题（例 `本周 Mar 03 – Mar 09`）→ **节奏匹配度热力图** → Top-5 Shift 标签频次条 → Ad-hoc → Template 建议（若有）→ AI Observe 卡（若启用）→ AI Review 卡（若启用）。AI 未启用时这两张卡**整个不渲染**，不留空白。梯度自然：事实在前、解读在后、建议夹中间，符合人读复盘的阅读路径。
- **节奏匹配度热力图**（v0.4 起查 Task.status，不查 RailInstance.status）：行 = 本尺度出现过的 Rails（按出现频次倒序），列 = 本尺度的日期（日尺度时列 = 一整天的 Rails 时段；周 = 7 列；月 = 5–6 列周次）。每格按"承载该 (rail, date) 的 Task.status（手工 task 或 habit auto-task）"染色：
  - `done` —— Rail 自身 `color` step 9 实色
  - `deferred` —— step 6 hatching（解锁了 C 组约定的三分语义之一）
  - `archived` —— step 7 hatching + 格内叠一条 line-through（"主动放弃"态，比 deferred 视觉更克制）
  - `pending(stale)` —— step 4 hatching（过了很久都没决定的 pending，视觉上最淡；区别于 deferred 的"已知未来不做今日"）
  - 格子悬浮 → tooltip 显示 `{Rail 名} · {日期} · 状态 + 首个 tag（若有）`
  - Rails 多于 10 条时横向超宽 —— 移动端允许横滚（容器内滚，不整页抖）。
- **标签统计**：复盘页展示本周期最常用的 Shift 标签 Top-5（横向条形：标签 + 次数 + 占比条）。供自我观察（例："这周 `会议冲突` 出现 7 次"），纯事实呈现。
- **归档 Line**：默认计入长期统计（开关在 设置 → 高级，详见 §8）。理由：多数用户希望过去的努力仍然可见；重度用户若想看更聚焦的当前视图，可以关掉。
- **Ad-hoc → Template 建议**：**仅在复盘里**出现 —— 如果某个 Ad-hoc Event 在相同星期几连续出现几周，复盘卡片可能提示"要不要把它放进模板？" 永远不会在 Calendar 或 Today Track 当下打扰用户。
- **AI Review**（详见 §6）：
  - 观察（Observe）：本周出现的模式
  - 复盘（Review）：结构化周报 / 月报
  - 所有 AI 分析必须由用户主动触发或已显式启用
- **每日复盘文本块**（v0.4.3 起 · 见 §4.1 DailyReflection）：**仅 day scope** 显示，瀑布最末尾一节，标题 `今日复盘 / Daily Reflection`。卡内复用 `MarkdownField`，与 Today Track 底部那张卡读写同一字段；这里的关键差别是 **anchor 跟随 URL**（`/review/day/:anchor`），因此可直接回看/补写**任意日期**（过去/今天/未来）。
- **复盘记录段（Cycle / Month scope · v0.4.3 起）**：当 scope ≠ day 时，瀑布末尾改渲染 `复盘记录 / Reflection log` —— 一个**纯导航段**：列出本 scope 范围内已写复盘的日期，每行 = `YYYY-MM-DD · Wd · 首行预览`，点击跳转 `/review/day/<date>`。空 scope 显示一行 muted "本周期未写复盘"。**不展开内容、不做摘要**（聚合范式留到 v0.5+），这里只承担"哪些天写过、点进去看/写"的入口职责。

### 5.9 Settings

**形态**：与 §5.5 Projects 共用**同一套 master-detail 语法** —— 左侧 nav + 右侧内容区，移动端折叠为单栏 push。Settings 和 Projects 是 DayRail 里"密集多 section 页面"的两个代表，共用一套视觉语言减少新语法。

- **左 nav 栏（240 px）**：section 列表，每项带一个 Lucide 小图标 + 文案 + 选中态（step 2 底色 + 左侧 step 7 accent，**不用 terracotta**，锁死给 Current Rail / primary CTA / Replace）。
- **右内容区**：当前 section 详情。默认进入时选中 `外观`（内容最轻）。
- **移动端**：单栏 push，与 §5.5 / §5.7 / §5.4 drawer 风格一致。
- **无 Save 按钮**：所有设置即改即存，与全站一致。

**5 个 section**：

1. **外观（Appearance）**
   - `主题`：三档 segmented `跟随系统 / 总是浅色 / 总是深色`，默认 `跟随系统`（CSS `prefers-color-scheme: dark` + manual override class；Radix Colors 已带配对的 `*Dark` scale，零手工派生）。
   - `界面语言`：`跟随系统 / 简体中文 / English`（默认 `跟随系统`，见 §9.7）。
   - `时间制`：`跟随 locale / 24 小时 / AM-PM`，默认 `跟随 locale`（v0.12.x 从「高级」搬过来，跟主题 / 语言同属"显示偏好"家族）。
   - `节假日 region`：multi-select chips，决定 Cycle View / Calendar / Today Track 显示哪些区域的节假日。

2. **同步（Sync）** · v0.12.x 起切 5 个二级 tab（见下方专门段落）。

3. **AI 辅助**
   - 顶部主开关：**默认关闭**（与 §6.4 一致）。关闭状态下隐藏其余控件。
   - `Base URL` / `API key` / `Model` / `测试连接` / `刷新可选模型`（OpenAI-compatible 通用客户端，见 §6.6）。
   - `AI 输出语言`：`跟随界面 / 简体中文 / English`，默认 `跟随界面`（v0.12.x 从「高级」搬过来，所有 AI 旋钮聚拢，只在 AI 启用时显示）。
   - `我的背景`：Markdown blob，AI 调用前 prepend 到 system prompt（见 §6.6.1）。

4. **高级（Advanced）**
   - `Pending 队列 · 批量忽略阈值`：默认 `7 天`，数字输入。
   - `归档 Line 计入长期统计`：默认开。
   - `日期格式表`：列出各视图当前的日期格式（见 §A 组落地的 per-view 日期格式表），只读或可覆盖。
   - `升级前备份偏好`：（v0.12.x 从「关于」搬过来 · 它是 preference 不是 info）。
   - **桌面端**子段（仅 Tauri 显示，v0.12.x 加）：`开机自启动` toggle。开启时通过 `tauri-plugin-autostart` 写入 OS 自启动入口（macOS Launch Agents / Windows Registry Run / Linux .desktop）。自启动 app 在后台启动（dock / menubar 显示图标但不弹窗），用户主动点击图标才显示窗口 —— 避免开机时跟 Slack / Mail / 浏览器抢焦点。跟 §15 「升级 relaunch 走前台」的规则同源。Tauri-only · PWA 不显示此 toggle。**v0.12.x 之前** autostart 错放在「同步」节，code 注释自己都承认 "independent from sync with Drive"，本轮归位。
   - `导出 JSON（仅人读）`：legacy 检查工具；完整 round-trip 仍走 .dryj。
   - `重置本地数据`（DangerZone）。
   - 其余高频低频交叉的旋钮都在此集中。

5. **关于（About）**
   - 纯 identity + diagnostic + 链接 · 不放 preference（v0.12.x 把 `升级前备份偏好` 搬到「高级」就是这条原则的体现）。
   - DayRailMark logo + 副标题 `STAY ON THE RAIL`。
   - 版本号 / 构建 / 环境 / 许可证 / 维护者（read-only KeyValue）。
   - 存储用量 / 持久化状态（read-only diagnostic · PWA 显示，Tauri 隐藏）。
   - `检查更新`：one-click 触发 + 最近检查时间（OS app convention，跟 macOS About → check updates 同款心智）。
   - 源码仓库 / Issue / 贡献链接（外链）。
   - 无"登录 / 账号"入口 —— DayRail 无账号。

**v0.12.x · 「同步」二级 tab**：v0.12 把五件套护栏全上线后，「同步」一节膨胀到 ~15 行（`SyncStatusCard` + `RemoteStatePanel` + 8 个 sync row + 桌面端 autostart + 本地数据 3 row + 可读格式导出 3 row + dev tools）—— 即便用 `hairline-t` + 小灰字 overline 切子段，视觉同质，滚屏才能找到目标。dogfood 一两天后改用 `Segmented` 切 5 个 tab，按"用户来这里要做什么"分而不是按"功能归属哪一类"分：**概览 / 连接 / 设备 / 备份 / 导出**。默认 `概览`（status + 立即同步 + 安全退出，最高频）；`连接` 装首次授权 / 设备名 / boot choice / 断开（一次性配置）；`设备` 是 §7.10.1 P5 设备列表的独立家；`备份` 收 `.dryj` in/out + Drive 历史；`导出` 收 markdown/csv/ical。URL `?tab=...` deep-link 让 banner / boot reconcile 等可以直接把用户带到正确 tab。原 `ConnectedSyncControls` 容器一起删掉。其它 4 个 section（外观 / AI / 高级 / 关于）保持单页 · 现在还没密到需要二级 tab。

**v0.12.x · 跨 section 归位（同步 doc-only 的同伴重构）**：trail of breadcrumbs after audit of every Settings row · 把放错位置的搬回正确的家。4 处移动：(1) `开机自启动` 同步 → 高级（OS lifecycle ≠ sync）；(2) `升级前备份偏好` 关于 → 高级（preference ≠ info）；(3) `AI 输出语言` 高级 → AI 辅助（AI 旋钮聚拢）；(4) `时间制` 高级 → 外观（显示格式同主题 / 语言一类）。原则：**section 心智一致** —— 关于装 identity / diagnostic 不装 preference · 同步装 Drive-related 不装 OS-level lifecycle · 外观装"显示如何呈现" · AI 装所有 AI 旋钮 · 高级是兜底（低频 / 跨语义 / 诊断 / 危险）。保留三处不动：节假日 region 留外观（显示过滤而非数据配置）· 检查更新留关于（OS app 惯例）· 日期格式表留高级（只读诊断 · 低频）。

***

## 6. AI 辅助

### 6.1 三类 AI 场景

1. **Decompose（拆解）**：把一个 Line 拆成 Phases（Habit）/ Tasks（Project，可带 milestonePercent）及关联 Rail 配置。
   - 采用**多步问答向导**：AI 依次询问目标、时长、每日可用时段、关键约束，再生成草稿给用户确认。
   - 用户可随时跳过问答、直接编辑草稿。
   - AI 输出**只是初稿**，没有任何特殊地位 —— 一旦生成，与用户自己编辑的版本没有本质区别。我们不保留"AI 原版"用于回滚；如果用户想要一份新的拆解，重新跑 Decompose 即可。这样避免引入"AI vs. 我"的版本层，免得 schema 变重却换不到清晰的好处。
2. **Observe（观察）**：从 Shift / RailInstance 历史中发现模式，以建议形式呈现，绝不评判。
3. **Review（复盘）**：周 / 月结构化回顾，识别 Line 进度、节奏变化、可能的模板调整方向。

### 6.2 内置 Prompt（对用户完全不可见）

- 内置 system prompt 随应用版本发布，**只维护一份正本（英文）**，对终端用户完全不可见。UI 语言与 AI 输出语言**解耦**：prompt 中嵌入显式的"请用 `{outputLocale}` 回答"指令，`outputLocale` **默认跟随 UI locale** —— 我们不按模型去猜。希望 UI 中文 + AI 英文回答（或反之）的用户，自己在 设置 → 高级 里改。避免"我们替你决定这个模型用英文更好"这种难以解释的隐式行为。暴露 prompt 会给用户带来额外使用压力（"我是不是该自己写一个？"），与"工具应该安静"的核心价值冲突。
- 开源仓库中 prompt 文件可审计、贡献者可 PR 修改，产品界面不提供编辑入口。
- 所有 prompt 强制约束语气："观察而非评判""提议而非命令""少用感叹号"等。
- 结构化输出（JSON schema）确保 AI 回复直接渲染为 UI，无自由文本进入数据库。

### 6.3 接入方式：OpenRouter

- 统一接入 **OpenRouter** 作为 LLM 网关。
- **默认选择免费模型**（OpenRouter 上带 `:free` 标签的开源模型），用户自备 OpenRouter API Key 即可零花费使用。
- 用户可在设置中自由切换付费模型（GPT-4.x / Claude / Gemini / …），费用走用户自己的 OpenRouter 额度。
- 不自建推理服务，不内置任何默认 API Key（避免开源项目承担不可预期费用）。
- 不做本地推理（web-llm / llama.cpp 曾被考虑，维护成本高、效果参差，放弃）。
- **模型选择与 Fallback 链**：
  - 呈现方式：**一张卡片**，不是多面板配置。文案类似"按顺序尝试，可在任意位置插入付费模型"，每行是一个 pill（模型名 + 免费/付费徽标 + 可选的费用提示）。拖拽排序，点 `+` 插入付费模型。高级开关（temperature、max tokens、单模型覆盖）折叠在"高级"里，默认收起。
  - 免费模型清单是**远端配置**：一份纯静态 JSON 清单，由 CDN / GitHub Pages 直接托管（无后端、无鉴权）。App 启动时拉取（stale-while-revalidate 缓存），并内置一份兜底清单，保证离线 / 首次启动可用。这样新增或剔除免费模型都不用发版。清单**由人工维护** —— 维护者审查 OpenRouter 的 `:free` 列表、以 PR 更新 JSON。拒绝自动探测：宁可反应略慢，也不要意外把劣化的端点推送给所有用户。
  - 用户从精选清单里**多选**免费模型，并可在链条任意位置插入**付费模型**（付费位有明显标记）。典型配置："免费 A → 免费 B → 付费 Claude（兜底）"。
  - 调用时按顺序尝试，任一失败（限流 / 报错 / 超时）自动切到下一个。全部失败才提示用户。

### 6.4 默认关闭 + 一次性引导

- AI 全量功能在**设置中默认关闭**。
- 首次启动时，首页以一张**可关闭的引导卡**呈现："DayRail 的 AI 辅助可以帮你拆解目标、回顾节奏。你需要一个 OpenRouter API Key；默认使用免费模型。点这里了解与启用。"
- 该卡**只出现一次**。用户选择"稍后"或关闭时，卡片消失前最后一句话告知："你随时可以在 设置 → AI 辅助 里开启。" 之后再也不会自动弹出。

### 6.5 隐私与数据边界

- 所有 AI 调用在发送前展示即将发送的摘要，用户确认后才发出。
- 只传输最小必要字段（Rail 名称可选脱敏，时间数据保留）。
- 不上传原始数据库。所选 provider 的数据留存策略由用户自行选择。

### 6.6 v0.8 实施说明 — OpenAI-compatible 通用客户端 + 用户背景

> 状态：2026-05-06 设计锁定，v0.8 ship。承接 §6.1 的三类场景框架、§6.2 内置 prompt 心智、§6.4 默认关闭策略、§6.5 隐私边界 —— 这些继续生效。**§6.3 OpenRouter-only 接入方式在 v0.8 解锁，扩为 OpenAI-compatible 通用客户端**。其它停车项（多 provider 适配层 / fallback 链 UI / 三档同步开关下的 AI 设置子集）继续停车，详见本节末尾。

**v0.8 触发因素**

§6 在 v0.4 设计后一直停在「明确不做」上，原因是"同步 / 数据模型 / 体验稳态"三件事更优先。到 v0.7 后这三件事都落了，Review 视图想再往上走只有 AI 一条路 —— 人工写的总结再丰富也触不到"按你这个人的背景给我一段有意义的解读"这一层。同时这半年里另一件事浮上来：很多用户已经为 Claude Code / Cursor 等 IDE 套餐付了月费，不希望为了用 DayRail 的 AI 再单买一份 OpenRouter token。OpenAI-compat 协议加上社区里成熟的 CLI 桥接软件（`claude-code-router` / `claude-bridge` / 各种本地 LLM 后端）等于"用户把已有的 AI 能力转嫁给 DayRail"——这是 v0.4 设计 §6.3 时还不存在的生态，v0.8 重做接入层正好踩上这个窗口。

**接入方式 · 替换 §6.3**

Settings → AI → 三个字段，覆盖所有 provider：

| 字段 | 默认值 | 说明 |
|---|---|---|
| Base URL | `https://openrouter.ai/api/v1` | 任何兼容 OpenAI `/chat/completions` 的端点。placeholder 给几个常见值（OpenRouter / Groq / 本地 Ollama 11434 / Anthropic-via-proxy）|
| API key | （空）| **仅本机 `localStorage`（key: `dayrail.aiApiKey`），不入同步流**（v0.8.2 设计锁定 · 凭证心智 · 与 §7.1 一致 · 与 Drive OAuth token / WebDAV 密码同档；详见下方『userProfile 字段分流原则』段）|
| Model name | `meta-llama/llama-3.1-8b-instruct:free`（OpenRouter 默认免费款）| 自由文本，不做下拉 —— 各 provider 模型 ID 命名空间不同，硬编码会很快过时 |

代码侧一份 `fetch` + SSE 解析覆盖所有：OpenRouter / Groq / Together / Mistral / Anthropic-via-proxy / Ollama / LM Studio / vLLM / `claude-code-router` / `claude-bridge`。**比锁定 OpenRouter 还简单** —— 不用维护 OpenRouter 特有的 fallback chain 那套元数据，也不用根据 provider 切代码路径。

**显式承认 CLI 桥接路径**：用户可以在本机跑 `claude-code-router` 把 Claude Code subscription 包装成 `localhost:8001/v1/chat/completions`，或跑 Ollama 把本地模型暴露为 `localhost:11434/v1`。Settings 里直接填那个 URL 即可，DayRail 不感知。文档里写一句"如果你用本地 CLI 桥接，请确认它对 PWA 的 origin 开了 CORS"——这是用户那边的运维事项，不归我们承担。

**Fallback chain 策略明确不做** —— v0.4 §6.3 设计里"用户从精选清单多选 + 拖拽排序"那套 UI 在 v0.8 不上。理由：(1) 接 OpenAI-compat 后用户想要 fallback 自己在 endpoint 那一层做（`claude-code-router` 自带，OpenRouter 自带），无须 DayRail 重做一层；(2) UI 复杂度对自用 scope 不划算；(3) 真要 fallback 时单失败已经能让用户察觉，不需要三档兜底。

**`userProfile` 字段分流原则**（v0.8.2 设计锁定）

v0.8.2 实施前暴露出 §6.6 与 §7.1 的内部分歧 —— §6.6 上方接入方式表此前把 `userProfile.aiApiKey` 写入 Y.Doc 同步流，但 §7.1「同步后端的凭证本身（Drive OAuth token / WebDAV 密码）和加密短语**仅在本机保留、永不进入同步流**」。AI key 是凭证还是设置？v0.8.2 拍板把它**归到凭证侧**，按下面二分原则把 `userProfile` 相关字段分流：

| 同步通道 | 心智 | 字段 |
|---|---|---|
| **Y.Doc `userProfile` Y.Map（同步流）** | 「通道里的设置」· 丢了重填影响小，跨设备一致省事 | `enabledHolidayRegions` / `calendarRuleOrder` / `aiEnabled` / `aiBaseUrl` / `aiModel` / `background` |
| **本机 `localStorage`** | 「打开外部 service 的钥匙」· 凭证心智 · 与 §7.1 一致 | `aiApiKey`（key: `dayrail.aiApiKey`）|

二分判别：**「这台设备上没了，等价于该设备失去对外服务的访问权」** → 凭证 → 仅本机；**「这台设备上没了，只是设置回到默认值」** → 设置 → 同步流。AI key 是凭证（没了就调不通 provider），主题色 / Background / Base URL / Model name 都是设置（丢了重填）。Drive OAuth token / WebDAV 密码与 AI key 同档；将来若加新的 AI 后端凭证（OAuth token、refresh token 等），按同样二分原则归到本机侧。

实装含义：`AISection` UI 上区分两类字段的视觉提示 —— API key 字段下加一行小字「仅本设备保存，不随同步流上传」；其它三字段沉默地走 Y.Doc。`packages/core/src/ai/settings.ts` 暴露 `getAiApiKey() / setAiApiKey()` 走 `localStorage`，其余字段走 `userProfile` Y.Map writer。

#### 6.6.1 用户背景 · `userProfile.background`（v0.8 新增）

> 心智模型对标 Claude Code 的 `CLAUDE.md`：单 Markdown blob，由用户维护，AI 调用前 prepend 到 system prompt。

**为什么需要**

§6.1 定的三类场景（Decompose / Observe / Review）有一个共同的天花板：没有用户上下文时，prompt 只能用"通用工作-生活节奏"的常识做 framing。用户是研究生 / 全职妈妈 / 跑步爱好者 / 备考者还是程序员，这些信息会决定"完成度低"该被理解成"安排过满"还是"缺乏动力"。强行让 AI 从 task / habit 名字反推背景是高方差且容易冒犯的——直接让用户自己告诉它，是最便宜最准的做法。

**形态**

- Settings → AI → 「我的背景」section · 上半 textarea（Markdown），下半 preview（react-markdown，与 §5.5.4 同款 MarkdownField）
- 默认空。空时 AI 调用走"无背景"路径（prompt 模板里那块占位符不渲染）
- 单个 `userProfile.background: string` 字段，存 Y.Doc top-level `userProfile` Y.Map（与 `aiEnabled` / `aiBaseUrl` / `aiModel` 同 map；**`aiApiKey` 不在 map 内、走本机 `localStorage`**，详见 §6.6『userProfile 字段分流原则』），自动随同步流到所有设备
- 没有 history / 多版本 / per-context override —— 一条全局背景覆盖所有 §6.1 场景；将来真需要场景级覆盖时再分

**注入点**

每次 AI 调用前，prompt builder 按以下顺序拼接 system message：

```
[built-in §6.2 system prompt（语气约束、JSON schema 约束、locale 约束）]
[{outputLocale} 翻译指令]
---
USER BACKGROUND（如果非空）:
{userProfile.background}
---
[scenario-specific framing：Decompose / Observe / Review]
```

`userProfile.background` 进 prompt 前不做 sanitization 或截断 —— 这是用户自己写的，对内容负责；同时长度不限（让 provider 自己处理 token limit，超了 provider 会报错给用户看）。

**「AI 优化我的背景」按钮 · 停车**

讨论过的"用户随手写'我是研究生 / 周末跑步 / 备考'，按一下让 AI 扩成结构化版本"。设计上明确**不在 v0.8.0 ship**：(1) 这是 §6 在跑通基本闭环之后的**优化**，不是基础能力；(2) 提前做容易让用户觉得"必须用 AI 优化才能获得好结果"，与"工具应该安静"的核心价值冲突；(3) 优化产物的隐私性（被 AI 看过的版本 vs 没被看过的版本是否要分两份）值得专门设计，不该在 v0.8.0 仓促上。**触发条件**：v0.8.0 ship 后看真实用户写的背景文本质量，如果普遍很短 / 很模糊 / 效果差，再设计这个 surface。

#### 6.6.2 v0.8.2 复盘场景 v1 · Day + Cycle + Month 三 scope（ship 后实装纪要）

> **状态**：v0.8.2 已 ship。本节顶部「ship 后实装纪要」覆盖 dogfood 反转后的最终形态；下方原"设计锁定"内容保留作为最初设计意图档案。完整反转纪要见 ERD History 顶部 v0.8.2 ship-notes 条目。

**实装现状（与设计锁定的偏离）**

- **输出形态**：散文 Markdown（不再走 JSON schema）。设计锁定时定的 `{ headline, observations: [{ claim, from_data }], questions_to_sit_with }` 在第一次 dogfood 就被 code-tuned model schema-drift 打穿，整体反转。新形态：自由 Markdown 段落 + 内联「verbatim 引用」中文方括号约定。`AiObservation` 类型从 `{ json: AiObservationJson }` 改为 `{ markdown: string }`。
- **流式输出走 Vercel AI SDK**（`ai` + `@ai-sdk/openai-compatible`），动态 import lazy load —— 替代了原本设计的手卷 SSE 解析（~120 行 + 30 测试），SSE / chunk buffering / 错误分类的边界条件交给成熟库。
- **System prompt 形态：scene-staged「微信里给朋友回消息」persona**，承载 DayRail「**允许错过**」哲学。从原设计的"observation tone, not judgmental"语气约束扩展为 5 段结构：SCENE staging + ABOUT THE MEDIUM（chat reply vs report 对比）+ DayRail philosophy（NOT a productivity tracker）+ WHAT TO DO（notice warmly · offer 2-3 small possibilities · hand back the choice）+ CITATION CONVENTION + 一个 worked example。详细演化见 ERD History 顶部 v0.8.2 ship-notes Round 1-5 记录。
- **三个 scope 都有 AI 入口**：Day（Today Track / Review · Day 的 reflection 块底部 + 反思空时的 discoverability hint）/ Cycle（Review · Cycle）/ **Month**（Review · Month · 比设计 spec 多加的，原 spec 只锁了 Day + Cycle，dogfood 中发现 Review 三 scope 不一致 是 UX bug）。
- **Month 缓存**：合成 `Cycle` 实体（id `month-${YYYY-MM}`），借用 `upsertCycle` 的 `id` + `endDate` 可选参数（v0.8.2 顺手实现 ERD §10 `Cycle.endDate` "v0.4 custom-length" 的 reservation）。
- **Day discoverability hint**：当 `aiEnabled === true` AND reflection 为空时，显示斜体提示行「✨ 写完反思后，可以让 AI 帮你看看（基于你的反思和这天的数据）」 —— 之前 `return null` 的写法对用户完全没有 discoverability。
- **Settings 加「刷新可选模型」按钮**：走 OpenAI-compat `/v1/models` autocomplete，`<datalist>` 浏览器原生下拉，自由文本输入仍保留。
- **错误展示加 body excerpt 抽屉**：dogfood 中撞到 503 时之前只能看到 `[provider-error] Provider returned 503.` 不知道 bridge 真实回了什么；加了 `<details>` 抽屉显示 `bodyExcerpt`（前 500 字）后，凡 HTTP 错误 / SDK 错误都能看到 provider 真实 body。

**model-tone 兼容性观察（dogfood 1 用户样本）**

`claude-opus-4-7 via claude-bridge` 即使经过 5 轮 system prompt iteration 仍偏向 structured 输出（"周期回顾 / 用户的声音 / 我看到的 / 一句话给下周"这种独立短句 label 始终绕不掉）。这是 RLHF 训练的天花板。OpenRouter 的 `claude-3-5-sonnet` / `gpt-4o` 通常 prose 更流畅。当前样本只有 1 用户，扩 beta 用户后再决定是否在本节文档化"推荐 model 默认值"。

**未纳入 v0.8.2，停车 v0.9 candidate · 结论未定**

- **AI 全局记忆**（"软件记得我"）—— dogfood 中冒出"AI 应该有跨调用的记忆，能记得用户身体不好 / 在备考 / 最近压力大等长期事实"。当前只有思路（`aiMemories` 同步流 + 反思后可选 accept/reject UI），但数据模型 / TTL 衰减 / 隐私边界都未定。等 v0.8.2 真实使用 2-3 周看 AI 反思的实际命中率 / 价值频率，再决定是否 / 怎么做。详见 `docs/ROADMAP.md` v0.9+ 停车场表。

**测试基线**：147 → 203 / 13 → 15 suites（+56 case · +2 suite）。

***

**以下内容是设计锁定时（同日先 ship 的 PR #9）的最初设计意图，保留作为档案 —— 上方「ship 后实装纪要」是经过 dogfood 反转后的最终形态。**

§6.1 列了三类场景（Decompose / Observe / Review）。v0.8.2 只动 Review · 一次 ship 两个场景跑通完整闭环。

**两场景共用基础**

- 内置英文 system prompt（`buildSystemPrompt(outputLocale)`）—— 含 §6.2 语气约束、JSON schema 约束、`Reply in {outputLocale}` 翻译指令、「Return ONLY a JSON object matching the schema, no other text」结构化输出指令
- §6.6.1 用户背景注入（`USER BACKGROUND:` 块；空时不渲染）
- 输出 JSON schema（v0.8.2 通用形态）：

  ```json
  {
    "observation": "string · 一段 2-4 句的观察口吻总结",
    "patterns": ["string · 0-3 条节奏 / 完成度模式"],
    "suggestions": ["string · 0-3 条非命令式建议"]
  }
  ```

  渲染成 3 段卡片（observation 块 + patterns bullet + suggestions bullet），每段下方一行『· 供参考』
- 客户端**不依赖** provider-specific `response_format: json_object`（OpenRouter / Groq / Anthropic-via-proxy / Ollama 行为不一致），改为 prompt 强制 + 客户端用 `extractJsonFromResponse(text)` 兜底（剥 ` ```json ... ``` ` 围栏 + 容忍前后散文）
- 调用前 §6.5 隐私 confirm modal：显示「即将发送 ~X 千 token · 含背景 + 数据切片 + reflection」摘要 → 发送 / 取消

**Day 复盘**

- **入口**：(1) Today Track DailyReflection 块底部「让 AI 帮我看看」按钮（§4.1 同 surface · 用户写完当天日志后顺手按）；(2) Review · Day 视图 reflection 块旁同款按钮。两个入口共用同一调用路径
- **数据切片**：当天 timeline（completed / deferred / pending tasks · 每条带 title / line / time）+ 当天 ExternalEvent（§14 节假日 + 用户标注，进 metadata 块）+ DailyReflection 文本
- **数据切片 selector**：复用 `selectTodayTimeline` / `selectPendingQueue` / `selectExternalEventsOn(date)` / `selectDailyReflection(date)`，**不写新 selector**（这些都已 revision-aware）
- **缓存字段**：`DailyReflection.lastAiObservation: { generatedAt: number; model: string; json: object } | undefined` —— Y.Doc LWW，再点一次直接覆盖；挂在 reflection 而不是单独 store 的理由：reflection 已经是「该日的 user 自由文本」实体，AI observation 与之同步增删（reflection 删了 AI observation 跟着没意义）

**Cycle 复盘**

- **入口**：Review · Cycle 视图 Cycle picker chip 旁同款按钮（与 Day 视觉一致）
- **数据切片**：整个 cycle 的 timeline 聚合（**不要每日每 task 列出**，按 rail 聚合 · 关键事件 · 完成度统计）+ match% per rail / per phase + 串起来的多日 reflection 文本（按日期顺序拼接，每日一节）+ cycle 内的 ExternalEvent 摘要
- **prompt 长度心智**：Cycle 数据切片可能很长，超过 8k token 时 §6.5 confirm modal 加一行「数据较多 · 部分 provider 可能拒绝（context limit）」提示，但仍允许用户发；token 估算用粗略 `chars / 4` 启发，不引入 tokenizer dep
- **缓存字段**：`Cycle.lastAiObservation: { generatedAt: number; model: string; json: object } | undefined` —— 与 Day 同形态、同 LWW 心智

**为什么 Day + Cycle 同时上而不再 staged**

讨论时考虑过先 ship Day（与 reflection 闭环最短）再 ship Cycle，但实测两者的差异只在 (a) 数据切片整形函数 + (b) 入口按钮位置 + (c) 缓存字段挂哪个实体；客户端 + system prompt + 输出 schema + UI 卡片渲染全共用。staged 反而要写两遍 ERD + 两个 PR + 两轮回归 checklist；一次 ship 两个反而省事。同时也避免「先 ship Day 后用户写日志习惯了反而不再去 Review · Cycle」这种自我设限。

**v0.8.2 显式不做（继续停车）**

- §6.1 Decompose / Observe 场景 —— 两者价值未证伪，但 v0.8.2 ship 后真实使用 6 周再开
- v0.4 §6.3 的 fallback chain UI（多模型多选 + 拖拽排序 + 远端 JSON 清单）
- AI 多 provider 专属 client（hardcoded Anthropic SDK / OpenAI SDK 区分）—— OpenAI-compat 一份 fetch 已覆盖 99%
- §6.4 首次启动『可关闭 AI 引导卡』UI —— v0.8.2 ship 后两周看 AI 启用率再决定是否 v0.8.3 上（§6.4『默认关闭』toggle 策略本身保留）
- AI 输出存 Y.Doc 历史 array —— 选 ephemeral + 单字段 LWW 缓存最近一次（详见上方「缓存字段」段）
- §7.2.1 三档同步开关下『AI 设置子集』的隔离同步 —— AI 字段已按 §6.6『字段分流原则』天然分流（key 本机 / 设置同步），不需要再开第二档
- AI 调用走 DayRail 自建后端代理 —— 浏览器直连 + 用户 BYOK，没后端这事 v0.8 不变
- 「AI 优化我的背景」按钮（详见 §6.6.1 末尾）—— 触发条件不变：v0.8.2 ship 后看真实背景文本质量

**v0.4 设计在 v0.8.2 仍然有效**

- §6.1 三类场景框架 —— v0.8.2 只做 Review 双场景不代表 Decompose / Observe 被否
- §6.2 内置 prompt 心智 —— 一份英文正本、随版本走、用户不可见、JSON schema 约束、语气约束
- §6.4 默认关闭策略 —— AI toggle 在 Settings 默认关闭；只有引导卡 UI 停车到 v0.8.3+
- §6.5 隐私边界 —— 调用前展示摘要 / 最小必要字段 / 不上传原始 DB / `userProfile.background` 也按这个标准对待

***

## 7. 同步与存储

### 7.1 没有账号系统 — 一条同步通道承载所有

DayRail **不运营账号后端**。没有 DayRail 登录、没有托管的用户记录，我们服务器上什么都没有。此前的方案把存储分成两朵云（DayRail 自建的轻量账号存设置 + 用户选的第三方存数据）；现在把它合成一条，因为账号这一层只增加维护负担、没有不可替代的职责 —— 它之前装的东西（OpenRouter Key、主题、Fallback 链、通知偏好）都可以走与 Rail 数据同一条同步通道。

- **默认**：一切纯本地。不同步、不联网，完整产品。
- **可选同步**：用户选一个第三方后端（Google Drive / iCloud / WebDAV）。**用户数据**（Rail / Track / Shift / Line / Template）和 **同步设置**（OpenRouter Key 密文、Fallback 链、主题、UI 偏好、通知偏好、Signal 配置）都存在同一个用户选定的目录里，同一份加密事件日志。
- **仅在本机保留、永不进入同步流**：同步后端的凭证本身（Drive OAuth token、WebDAV 密码）和加密短语。这些是设备加入同步流的"钥匙"，而不是同步流要携带的内容。
- 这让"本地优先"落到字面意义：没有服务可以被切断、没有账号会丢失、DayRail 这家公司关停也不影响用户。

### 7.2 第二台设备接入已有同步

第二台设备启用同步的流程：选后端 → 授权访问同一个目录 → 输入相同的加密短语 → **设备自动和目录里已有的数据合并**（拉取最新快照、回放事件、由 Yjs + HLC 负责调和）。没有 DayRail 登录步骤，没有"发现已有数据 — 替换 / 合并 / 取消"的弹窗。自动合并是合理的默认值，因为这里的门已经由加密短语把着 —— 能输入正确密码的人，就是同一个用户。

### 7.2.1 同步内容 — 用户可选

内部模型很简单：**一切都走同一份加密流**。但面向用户的同步开关提供三档，让用户自己决定把多少自己放上云：

- **仅数据**：Rail / Track / Shift / Line / Template 事件。设置留在本机。
- **仅设置**：OpenRouter Key 密文、主题、Fallback 链、通知偏好。适合"我想在几台设备上有一致的环境，但节奏数据只留在这台"的情况。
- **全部**（默认）：以上两者在同一条流里。

我们刻意不提供逐项级别的细调（UI locale 同步、通知偏好不同步…… 这类组合）—— 三档切换足够覆盖真实用法，避免陷入一大片开关矩阵。

### 7.3 同步后端（第三方）

按"普通用户接入成本"由低到高排：

1. **Google Drive**：一次 OAuth 完成；全平台可用；覆盖面最广。**首发选择**。
2. **iCloud**：Apple 设备零配置（登录 Apple ID 即可），但跨 Windows / Android 难。**次选**。
3. **WebDAV**：需要 URL / 用户名 / 密码，对普通人陌生；但对自托管用户（Nextcloud / 坚果云等）价值极高。**进阶选项**。
4. **Dropbox**：OAuth 简单，但当前用户基数已不占优势。**可不做**。

**切换同步后端**（例如从 Google Drive 切到 WebDAV）：MVP 阶段**不提供内建迁移流程**。用户切换的路径是：导出一份本地明文快照（§7.5）→ 关闭旧后端 → 启用新后端 → 重新导入。一键跨后端迁移需要改动每个适配器，MVP 场景下不值得。

### 7.4 冲突合并

> **v1.0 推翻**：本节描述的"Yjs 作 cross-device merge 引擎 + HLC 字段级 LWW"在 v1.0 重审中被 §7.8 取代。Yjs 保留作本地存储 + undo 引擎；跨设备合并改为 snapshot 粒度 + 应用层 smart diff（同向 fast-forward / 正交 union / 真冲突弹卡）。本节作为历史记录保留，**不再代表当前设计**。

- 采用 **Yjs** 在设备之间无中心合并 Shift / Template / Line 等操作。选 Yjs 的理由：生态最成熟、文档齐、与 React 状态整合方案多。
- Yjs 包体 \~60 KB gzip，作为**按需加载模块**（仅开启同步的用户下载），不影响默认 PWA 冷启动体积。
- CRDT 的代价是运行时事件稍重，但换来可预测的多设备行为：偏离不会因合并冲突"被丢"，与"Shift 永远是一等操作"的承诺一致。
- **HLC（混合逻辑时钟）打点**：每个事件携带 `(physical_ms, logical_counter, nodeId)` 三元组。Yjs 负责结构化合并，但 RailInstance "属于哪一天"依赖 wall-clock 日期 —— 设备时区错乱或手动改时间会造成重叠或缝隙的 Track。通过 HLC，合并时的同步序是确定的；显示层做"归属日期"时使用一份 HLC 调和后的视图，而非原始设备 wall-clock，避免幻影缝隙。
- **每条 Track 锁定时区**：每个 `Track` 在当天开始时记录设备所在时区（`Track.tz`）。如果用户当天中途跨越时区（例如东向西飞行），这一天的时间轴**不会漂移** —— 已过去的 Rail 视觉位置保持不变。新建的 Track 使用新时区。代价是每条 Track 多一个 tz 字段，换来"看着看着 Rail 自己跑了"这种诡异 bug 的彻底消除。
- **历史 Track**（这份设计上线前、或在错误时区下生成的）保持原样。刻意不做"用 HLC 重算"的修复工具 —— 额外复杂度不值当这种罕见边界场景。

### 7.5 存储形态与加密

- 同步文件形态：**按事件追加的日志**（append-only event log）+ 定期快照。
- **快照阈值**：每 **500 个事件** 或 **14 天**（任一先到）生成一次加密快照，保留最近 3 个快照。新设备首次同步 = 下载最新快照 + 之后的事件段（通常 < 200 KB）。
- **可选的本地明文导出**（默认关闭）：因为滚动 3 份快照意味着"密码几周后才发现丢失 = 无法找回"，用户可在设置中开启**按计划本地明文导出**（每周 / 每月，指定本地目录）。**格式可选**：JSON（保真往返、可重新导入）或 Markdown（可读、不保证能重新导入）—— 选择器旁直接注明两者的取舍。开关旁还明确说明存储权衡："以明文存于本地，请自行保管"。这是纯本地的逃生舱口，导出文件永远不会上传。
- 日志天然匹配 Yjs 合并，离线多天后合并仍简单。
- 端到端加密**默认开启**，用户可在设置中显式关闭（不推荐）。加密采用**严格零知识**：
  - 用户设置一个密码短语（passphrase），**永不上传**。
  - 服务端 / 第三方存储只见密文。
  - 忘记 passphrase **数据无法找回**。首次开启加密时会强制用户确认理解此风险，并建议导出恢复码。
  - 恢复码格式：**6 组 4 位字母数字**（如 `A3F9-K2M7-R8X4-W5P1-B6N2-T9Q3`），比 BIP-39 助记词轻量、易抄写。
- DayRail 自身在任何服务器上都不持有用户数据和设置 —— 传输中的一切，都只是用户把自己的东西上传到自己选的后端，我们从头到尾看不到。

**E2E 启用后的历史数据迁移**：

用户最初关闭 E2E、后来又想开启时，所有历史事件都需要重新加密上传。流程**非阻塞、可续传、对弱网移动场景友好**：

1. 启用时本地派生密钥（永不离开设备）。服务端在现有明文流之外开一条**新的加密流**，进入"双写阶段"。
2. 从此刻起，新事件**同时写入两条流**。
3. 后台任务按 **每批约 100 个事件** 处理历史明文日志：加密 → 上传 → 后端 ack → 推进**持久化游标**（本地保存，并镜像到同步设置流中以密文形式存一份）。中断后下次启动 / 联网时自动从游标续传。
4. 默认值：**仅 Wi-Fi**、显式进度条、可暂停。重度用户可覆盖以允许蜂窝 —— **仅在这种情况下**，迁移开始前展示一次**体积预估**。预估使用**原始明文字节总数**（相对实际加密上传略偏高，但诚实 —— 不做抽样外推这种可能骗人的估算）。Wi-Fi 用户不展示，没必要给他们多一层摩擦。
5. 当游标追上写头时，服务端切换主指针为加密流，明文流进入 **7 天宽限期** 后删除。
6. 如果用户中途又关闭 E2E，加密流直接丢弃，明文流仍是主流 —— 不丢数据。

**修改密码短语** 复用同一套机制：用新密钥开一条新的加密流；旧密钥流在双写期间仍是主流；后台任务按批用新密钥重新加密历史、带持久化游标；默认 Wi-Fi；游标到头后指针切换，旧密钥流进入 7 天宽限期。我们**刻意不提供**更简单的"只换密钥壳"捷径 —— 所有涉及密钥材料变更的路径走同一套代码，换来的是清晰和前向保密（一旦宽限期结束，被泄露的旧密钥无法解密新流）。

### 7.6 v0.6 实施说明 — Google Drive · "云快照冗余"层

> 状态：2026-04-28 设计已锁定，v0.6 ship。沿用 §7.1 / §7.3（Drive 入口）；§7.2 因不引入 passphrase 而简化；§7.4 Yjs / §7.5 加密事件日志 / §7.5 恢复码 / §7.2.1 三档同步开关 **显式停车**——这些机制是为多用户、多账号、并发编辑设计的，DayRail 当前还没有那种压力。v0.6 ship 的是"快照冗余"层，足以支撑 1 个用户、2 台设备、错时切换的场景（白天工作电脑 → 晚上个人电脑，同一个 Google 账号）。

**同步单元 · `ExportBundle`**

直接复用 `apps/web/src/lib/exportData.ts` 现有的 snapshot bundle 作为传输单元。**Data layer 零改动；`schemaVersion` 不升级**。现有的 `importLocalData` 路径（`sessionStorage` 暂存 → OPFS reset → reload）就是规范的"应用远端"路径。Bundle 顶层新增三个**可选**字段（read 时全部 `?`，v0.4 / v0.5 老 bundle 仍能往返）：

- `deviceId` —— 单浏览器单 OPFS 实例的稳定 ID，首次启用同步时生成。
- `deviceLabel` —— UA 推断默认值（`"Chrome on macOS"` / `"Edge on Windows"` 等），用户可在 Settings → 同步 改名。
- `parentSnapshotId` —— 这份 bundle 是基于哪个 `snapshotId` 写出来的。冲突检测的核心字段（见下方"启动闸门"）。

第四个字段 `snapshotId`（UUID，上传时生成）让消费者无需 diff 整个 bundle 即可比较 lineage。

**后端 · Google Drive `appdata`**

- Scope：`https://www.googleapis.com/auth/drive.appdata` —— 用户自己 Google 账号下、仅本应用可见的隐藏空间。其他应用看不到这些文件，用户在 Drive UI 里也看不到。
- 认证：Google Identity Services token client（`google.accounts.oauth2.initTokenClient`）。**纯浏览器 OAuth，无 DayRail 服务端**（与 §7.1 "无账号后端"原则一致）。Access token 会话级（约 1h），通过静默续期（`prompt: ''`）刷新；**永不**把 refresh token 落盘。

**Auth 生命周期**（用于回答"每次同步都要 OAuth 吗？"这个高频问题）：

| 层级 | 频率 | UX |
| --- | --- | --- |
| **首次连接** | 每台设备一次 | 完整的 Google 同意页（选账号 + 授权 appData scope）。Settings → 同步 → `连接 Google Drive` 触发。 |
| **Access token 续期** | 使用中约每 1h 一次 | `tokenClient.requestAccessToken({ prompt: '' })` 在隐藏 iframe 里走用户已有的 Google 会话 —— **静默，无 UI**。controller 懒触发：只在某次同步发现内存里的 token 过期或临期（< 5 min 剩余）时才换一次。 |
| **每次同步**（push / pull / 启动闸门探测） | 每次调用 | 直接用内存里的 access token；遇到 `401` 或临期就静默续一次再重试。**不弹同意页**，不打断用户。 |

静默续期的前提：浏览器在该 Google 账号下仍有有效会话（用户登过 Gmail / 任何 Google 服务即可，会话期通常很长），且浏览器没有阻断 GIS 的 iframe（Safari ITP 边界 —— DayRail 自己不是被嵌入的 iframe，走标准流程不受影响）。静默续期失败时，controller 会让其落到**启动闸门的"离线分支"**（splash → `离线 · 使用本地数据` + `重新连接 Google`）；用户点一次按钮、走一遍完整 OAuth 同意页、然后又回到静默续期节奏。

会强制重新走同意页的情形（罕见、非稳态）：
1. 用户在该浏览器主动登出了 Google 账号。
2. 用户在 Google 账号权限页主动 revoke 了 DayRail 的授权。
3. Google 会话真的过期（浏览器长期不用 / 隐身窗口结束）。

稳态体感：**连接一次，之后该浏览器-账号会话存续期间，永远不会再看到 Google 登录页**。

**为什么不存 refresh_token**（v0.6.2 · 2026-04-28）

Google 给纯前端 SPA 提供的 GIS Token Client 走的是 **OAuth 2.0 implicit flow**。implicit flow 只会返回 `access_token + expires_in`，**根本不发 refresh_token**。这是设计选择 —— RFC 8252 §8.6 + Google 的实现刻意不让浏览器持有 refresh token，因为浏览器对刚执行的代码毫无防御能力（XSS、恶意扩展、DevTools、Service Worker）；refresh token 是无限期凭证，落到浏览器里就是"一次 XSS 永久失守"。

refresh token 只有 **Authorization Code flow + client secret**（Web app 类型）或 **PKCE without secret**（Native / Desktop 类型）才会发 —— 这两条路对"纯前端、零后端"PWA 都不可用。所以"为什么不持久化 refresh token"的答案是：**我们根本拿不到** —— 想拿到要么加后端（refresh token 留在后端、永不上 wire），要么做原生壳（refresh token 留在 OS 钥匙串）。

这条限制划出了纯前端架构能做到的"零打扰"上限：

**v0.6.2 缓存 + FedCM 之后的冷启动覆盖**

| 场景 | Chrome / Edge / Chromium 系 PWA | Safari PWA | Firefox PWA |
| --- | --- | --- | --- |
| 距上次 < 1h，cached access token 还有效 | ✅ 静默（命中缓存） | ✅ 静默（命中缓存） | ✅ 静默（命中缓存） |
| 距上次 > 1h，但浏览器里 Google 会话还在 | ✅ 静默（FedCM 续 token） | ❌ 弹"重新连接"（FedCM 还没上） | ❌ 弹"重新连接"（FedCM 还没上） |
| Google 会话本身过期 / 用户登出 / 在 Google 后台 revoke 了授权 | ❌ 弹"重新连接" | ❌ 弹"重新连接" | ❌ 弹"重新连接" |

**v0.6.2 叠两层优化把第一行变成日常、把第二行在 Chromium 上救回来**：

- **A · access token 跨刷新存活** —— 每次 `requestToken` 成功 resolve 后把 `{ token, expiresAt }` 写到 `localStorage`；下次冷启动后第一次 `ensureAccessToken` 会先尝试从 `localStorage` 还原 `cachedToken`（前提是仍在 1h 有效期内）。1 小时内的二次冷启 = 直接用，跳过整个 GIS 往返。Access token 寿命短（最多 1h）+ scope 限于 `drive.appdata`，落盘的额外风险面与"页面开着时驻留内存"等价；带来的体感收益显著。
- **B · FedCM** —— `initTokenClient` 加 `use_fedcm_for_prompt: true`。GIS 优先走 FedCM（浏览器原生 UI、不需弹窗、不依赖第三方 cookie），不走 Chrome 第三方 cookie 阶段性下线后越来越脆的旧 iframe 路径。Chrome 117+ 上 cached token 过期后的续期能恢复静默；Safari / Firefox 没 ship FedCM（Safari 立场 "Position: Support" 无具体日程；Firefox "Worth prototyping"），这条优化对它们零作用。

**绕过这条结构上限的两条路**（不在 v0.6.x 范围内，留给未来的维护者）：

- **方案 C · serverless function** —— 加一个 Vercel function（`apps/web/api/google-token.ts`）由后端持有 refresh token。OAuth 从 implicit 升级到 Authorization Code + PKCE；refresh token 永远不进浏览器；**对所有浏览器都生效**，包括 Safari / Firefox。代价：破例 ERD §7.1 "no DayRail backend" + ~80 行 + 一个 Vercel KV（免费档无限够用）。
- **原生壳（Tauri / Capacitor / Native SDK）** —— 在原生运行时里走 OAuth，refresh token 存在 OS 钥匙串（macOS Keychain / Windows Credential Manager / iOS Keychain / Android Keystore）。完全绕开浏览器，零冷启提示。ROADMAP 已经把 Tauri 留作 `apps/desktop` 槽位 park 着；如果哪天重启那条线，认证问题作为副产品自然解决。

对 DayRail 当前的自用范围（一个用户、两台 macOS Chrome）来说，A + B 已经够用 —— A+B 没法救的两行都坍缩成"基本不会触发，除非用户自己做了点啥让 Google 会话失效"。
- `appdata` 内文件结构：
  - `dayrail-snapshot.json` —— 规范的"最新"文件，每次推送覆盖。
  - `history/dayrail-snapshot-{yyyymmdd-hhmmss}-{deviceLabel}.json` —— 滚动历史，**保留最近 14 份**（按 `modifiedTime` 最旧者淘汰）。
- 两个 surface 都进 Settings → 同步 → 备份历史，每行一键 恢复 / 删除 / 下载。

**推送触发**

1. 任何事件日志写入后 **debounce 60 秒**（idle 窗口，让上传避开主交互路径）。
2. `visibilitychange === 'hidden'` 与 `pagehide`（best-effort）。
3. `beforeunload` 期间 `fetch(..., { keepalive: true })`（best-effort；正确性兜底不靠这条 —— 真正的正确性保证在**另一台设备**的启动闸门）。
4. Settings → 同步 里的 **立即同步** 按钮（手动）。

**拉取触发**（v0.6.1 · 2026-04-28 补）

仅靠启动闸门有两类场景兜不住：① 用户开着 tab 一整天，期间另一台设备推过新版本；② 用户首次在新设备 Connect Google Drive，而 Drive 上已经有别的设备写过数据。两个补充触发器分别对应这两个洞，复用启动闸门的四分支决策表，但 UI 改成**非阻塞 modal 浮层**而不是全屏 splash。

1. **可见性探测**（visibility probe）—— `visibilitychange === 'visible'`（tab 切回前台 / 解锁屏幕）。**5 秒节流**，避免快速切 tab 抖动时反复打 Drive。只在已连接同步的设备上触发；尊重你设的 `启动时同步` 选择（"自动拉取最新"在这里同样生效）。结果分支：
   - `equal` / `no-remote` → 静默，无 UI。
   - `linear-lead` + 记住的选择是 `自动拉取` → 短暂浮层 `正在拉取最新数据…`，随后 OPFS reset + reload（与启动闸门的自动拉路径完全一致）。
   - `linear-lead` + 记住的选择是 `每次问我` → modal 确认卡（沿用启动闸门的 LinearConfirmPanel）。
   - `diverged` → modal 冲突卡（沿用启动闸门的 DivergedPanel）。
   - `offline` → 顶栏 `⚠ 同步离线` 指示灯闪一下；不弹 modal。

2. **连接探测**（connect probe）—— 在 Settings → Connect Google Drive 流程里，`connectDrive()` resolve 之后**立即**触发。补的洞是："新设备启用同步前还没经过 BootGate，首次 push 会在不知远端有数据的情况下覆盖远端"。两分支：
   - **远端没有 canonical 主文件**（这个 Google 账号下第一台设备）→ 静默推一次本地当前 state 作初始 snapshot，把 `lastPulledSnapshotId` 设为这次新生成的 snapshotId，之后的 lineage 才有 baseline。
   - **远端已有 canonical**（你正在接入第二/更后的设备）→ 弹 modal 三选一对话框：`拉取云端（推荐）` / `用本地覆盖云端` / `取消连接`。"取消"会调 `disconnectDrive()` revoke 刚发的 token、不动数据。"覆盖"在 push 之前先把远端 bundle 下载到 Downloads（`dayrail-remote-conflict-{ts}.json`），与启动闸门冲突卡的可反悔语义一致。**对话框是 modal，用户必须在三个里挑一个才能进主界面** —— 否则正好回到这个触发器要避免的那个失败模式。

两个 probe 的 modal 浮层 UI 集中在一个新组件 `<RuntimeSyncDialog />`，与 `<App />` 同级挂载。启动闸门保留 splash 形态因为它必须**在** React 路由挂载之前跑；运行时 probe 是**之后**触发，因此用非阻塞浮层即可、视觉打断也更轻。

**启动闸门**（load-bearing UX）

React 主路由（`App.tsx`）在闸门 resolve 之前**不挂载**。闸门期间屏幕上只有一个极简 splash（`DayRail` logo + `正在同步…` + spinner）。这是抵御"我已经在旧数据上操作了，事后才被告知"这一失败模式的核心保证。

每次冷启动的时序：

1. 拉远端 `appdata/dayrail-snapshot.json` 元数据，**软超时 1.5 s**（超过则 splash 切到 `正在拉取最新数据…`），**硬超时 3.5 s**（超过则进入"离线分支"）。
2. 比较远端 `snapshotId` vs 本地 `lastPulledSnapshotId`，分四个分支：

| 远端 vs 本地 | 行为 |
| --- | --- |
| 相等 | 立即挂载，无 UI 中断。 |
| 远端较新 **且** 本地无未同步改动（线性领先） | 按"记住的启动同步选择"执行；默认是**静默 pull-and-replace 后挂载**。如果用户曾经选过 `每次问我`，则在 splash 上叠一张非阻塞确认卡：`拉取最新`（默认聚焦）/ `优先用本地（仅本次）`。 |
| 远端较新 **且** 本地有未同步改动（`parentSnapshotId` ≠ 远端 `snapshotId`，已分叉） | **强制弹冲突卡片**，无视记住的选择。详见下方"冲突 UX"。 |
| 远端不可达（离线 / OAuth 失效 / Drive 5xx） | splash 切到 `离线 · 使用本地数据`，提供 `重试` / `继续使用本地` 两个按钮。继续后挂载主 UI，并在顶栏挂一条红色 `⚠ 未同步` 条，直到下一次成功往返。 |

**"记住我的选择" UX**（仅出现在线性领先分支）

闸门确认卡里的三选一 radio：

- ◉ **每次都拉取最新**（推荐 · 默认）
- ○ **每次问我**
- ○ **优先用本地（仅本次）** —— **故意不可记忆**。选这个会让本地 fork 留在原地，于是**下次**冷启动会落到分叉分支、强制冲突卡片。我们**刻意不让**"优先用本地"被持久化 —— 持久化它就等于无限期静默覆盖远端，正好就是用户自己点出来要避开的那种失败模式（"不想在旧数据上操作完才被告知"）。

只有前两个 radio 配 `[✓] 记住我的选择` 复选框。持久化的值会反映在 Settings → 同步 → **启动时同步**，可以随时改回 `每次问我`。

**冲突 UX**（分叉分支）

卡片左右并排展示 `本地 (最近编辑 HH:mm:ss · 当前设备)` 与 `云端 (最近编辑 HH:mm:ss · {远端 deviceLabel})`。三个动作：

- **保留远端、把本地导出留底** —— 先调 `exportLocalData()` 把本地下载到 Downloads（文件名 `dayrail-local-conflict-{ts}.json`），再拉远端覆盖。
- **覆盖远端** —— **强制**先把远端 bundle 下载到 `dayrail-remote-conflict-{ts}.json`，再 push。一键反悔，几乎零成本。2026-04-28 用户确认。
- **取消** —— splash 留着；用户可以想想；不动数据；关掉 tab 即可。

冲突卡片**永远不会**被记住的选择吞掉；这是 load-bearing 的安全属性。

**顶栏同步指示**——复用现有顶栏外壳的非阻塞条：

- `⟳ 同步中`
- `✓ 已同步 · 2m ago · 工作 Mac`
- `⚠ 未同步 · 3 改动`（启动闸门走了"离线分支"时也展示这条）

点击进入 Settings → 同步。

**Settings → 同步 接线**（替换 v0.4 占位 UI）

- 连接 / 断开 Google 账号（GIS authorize）。
- 设备名行 —— UA 推断默认值，可编辑。
- 启动时同步 —— radio：拉取最新 / 每次问我。
- 最近一次同步时间 + **立即同步** 按钮。
- 设备列表 —— 从历史 snapshot 元数据读取（最近 14 份历史文件里出现过的所有不同 `deviceLabel`）。
- 备份历史 —— 14 行，一键 恢复 / 删除 / 下载。

**v0.6 显式不做加密**

`appdata` scope 在用户自己 Google 账号下、对 OAuth client（DayRail）私有 —— 其他应用看不到这些文件。再加一层 passphrase 就要带上恢复码 UX、忘了 passphrase 的逃生口、多设备 prompt 协调 —— 所有这些都是为了抵御一个边际威胁模型（"Google Drive 运营方读取 appdata"），对自用 beta 来说性价比极低。等用户范围扩出"单一用户"再重开。

**v0.6 不上 Yjs 的理由**

用户的真实工作流是**错时切换**（白天工作机、晚上个人机），不是并发编辑。`parentSnapshotId` + 强制冲突卡片足以显式、可见地处理"忘了关另一台 tab"那种边界情形 —— 卡片里会写明肇事设备的 `deviceLabel`。CRDT 的红利只有在并发编辑成为稳态时才兑现，DayRail 还没到那一步。Yjs / HLC merge / 加密事件日志依然挂在 §7.4 / §7.5 路线上；等 DayRail 扩出"单一用户"时再重开。

**v0.6 重新确认停车（不实现）**

- §7.2.1 三档 `{仅数据 / 仅设置 / 全部}` 开关 —— v0.6 把 `ExportBundle` 携带的所有内容都同步。
- §7.3 Google Drive 之外的后端（iCloud / WebDAV / Dropbox）。
- §7.4 Yjs CRDT + HLC 合并（用于运行时事件）。
- §7.5 加密 append-only 事件日志 + "500 个事件 或 14 天" 快照节奏 + 零知识 passphrase + 恢复码 UX + 双写 E2E 迁移。

### 7.7 v0.7 实施说明 — Yjs CRDT · 字段级合并

> **v1.0 部分推翻**：本节描述的 sync 路径（用 `Y.applyUpdate` 在两端做 cross-device CRDT merge · HLC 嵌事件 · 字段级沉默 LWW 收敛）在 v1.0 重审中被 §7.8 取代。**保留**部分：Yjs 作本地存储格式 + UndoManager + Y.encodeStateAsUpdate 作 sync 传输格式（snapshot 字节 · 不再做 cross-device merge）。**推翻**部分：`Y.applyUpdate(localDoc, remoteUpdate)` 这条合并路径 · HLC 时钟 · 沉默 LWW 收敛。本节作为 v0.7 实装的历史快照保留。

> 状态：2026-04-30 设计已锁定，v0.7 ship。承接 §7.6 已落地的 Drive 通道、auth 生命周期、推送/拉取触发器骨架、Settings 同步页布局。**§7.4 / §7.6 footer 中关于 Yjs CRDT 的"停车"在 v0.7 解冻**；其它停车项（§7.5 加密事件日志 / §7.5 passphrase + 恢复码 + 双写 E2E 迁移 / §7.2.1 三档同步开关 / §7.3 多后端）继续停车。v0.7 的边界是"修 v0.6 暴露的两个 UX 痛点"，不扩大其它维度。

**v0.7 触发因素**

v0.6 在自用半年中暴露两个稳态痛点：

1. **后台拉取盲区** —— 设备 B 的 tab 一直可见（笔记本不关机、副屏挂着），可见性 probe 永不 fire。设备 A 改完 push、设备 B 看到顶栏 `⚠ 远端有更新` 后**只能等下一次冷启动才会应用**。手动「立即同步」按钮在 v0.6 是 push-only，反而误导用户。
2. **冲突只能整盘覆盖** —— `parentSnapshotId` 分叉时弹的冲突卡片是"保留远端 / 覆盖远端"二选一。最频繁的实际场景是"我在设备 A 标完任务 X，回设备 B 看到没标，又点了一次完成"——技术上属分叉冲突，语义上是同向修改，本应零打扰自动消解。

两个痛点指向同一上限：snapshot 级 LWW + parent 比对不足以承载多设备稳态。Yjs CRDT 是 §7.4 已经选定的方向，v0.7 把它从 v0.7+ 路线提前到 v0.7 ship。

**同步单元 · Yjs document**

- 顶层 `Y.Doc` 下挂多个 `Y.Map`，每个对应现有的一个 store：`templates` / `rails` / `lines` / `tasks` / `signals` / `shifts` / `adhocEvents` / `calendarRules` / `cycles` / `habitPhases` / `habitBindings`，以及 v0.5+ 的 revision 表 / tombstone 表 · v0.11+ 的 `taskOccurrences`（与 `tasks` 同级；详见 §10.6 ——新版本启动时 filter 掉 `taskId` 不存在的 occurrence 即可，纯加法 schema 演进、`.dryj` 容器版本不升）。
- 每个 entity 是一个 `Y.Map`：标量字段（string / number / boolean / 日期 ISO 字符串）作为普通 value，数组字段（如 `Task.tags`）用 `Y.Array`，嵌套对象（如配置块）用嵌套 `Y.Map`。
- **理由**：字段级合并面最大化——两端改同一 entity 的不同字段时无冲突；改同一字段且新值相等时同向自动消解（即上面"再点一次完成"场景）；只有"两端改同一字段且新值不等"才是真冲突，由 Yjs 内部的 LWW + Lamport clock 决定胜者，不弹 UI。
- v0.5+ 的 entity ID 已经是 UUID，**Yjs 不需要额外 ID 改造**。

**为什么直接全量 Yjs（不走渐进路线）**

考虑过两个折中方案：①"快照级三路 LWW + 实体级冲突列表"自己写合并算法；②先把 Task 一个实体迁到 Yjs、其它继续 snapshot。两条都被否：
- 自己写三路合并撞 corner case（嵌套数组顺序、tombstone vs edit、ID 复用），成本不低、质量没把握，且半年后体验需求只会进一步推向 CRDT，等于做一份必扔的中间态。
- 单实体先行能降低风险但要付出"双数据模型共存"的认知与持久化复杂度，对当前用户范围（作者本人）收益不成正比。

Yjs 的代价是数据模型必须改造成 CRDT 文档（持久化层 + store 层），但**UI 不用动**。Zustand 订阅 Yjs `observe` 触发 UI 更新是社区现成 pattern。

**Wire format · `.dryj` 容器**

替换 v0.6 的 `dayrail-snapshot.json`。Drive `appdata` 上规范文件名：`dayrail-snapshot.dryj`（**.dryj** = DayRail Yjs）。文件结构：

```
[ 4 bytes ] magic       —— ASCII "DRYJ"
[ 2 bytes ] version     —— uint16 BE，从 1 开始（容器版本，不是用户数据 schemaVersion）
[ 4 bytes ] metaLen     —— uint32 BE，meta JSON 字节数
[ N bytes ] meta JSON   —— UTF-8：{ snapshotId, parentSnapshotId?, deviceId, deviceLabel, createdAt, schemaVersion: 2 }
[ 剩余    ] yjs update  —— Y.encodeStateAsUpdate(doc) 的二进制结果
```

设计点：
- **magic + 容器 version**：以后改容器结构（加 zstd 压缩、加签名等）不会读崩老文件；老 reader 看到不认识的 version 直接报错并指引升级，而不是误读。
- **meta 不进 Yjs document**：这是关于"这份文件是什么"的元信息，不是用户数据。混进 Yjs 会引入跨文件 `snapshotId` 该谁覆盖谁这种悖论。meta 走 LWW（每次 push 整体替换，不合并），与 v0.6 行为一致。
- **不走 JSON-with-base64 envelope**：那是 Yjs 圈更"现成"的 pattern，但有 ~33% 体积膨胀，与你"单文件 / 越紧凑越好"的偏好相反。`.dryj` 容器读写各 ~20 行无依赖代码，归类为"文件框架"而非"自研算法"。
- **不预先加 gzip / zstd**：Yjs `encodeStateAsUpdate` 输出已经是 lib0 紧凑编码，DayRail 数据规模（实测几百 KB 量级）压不出多少。再加一层只增加排查面，不值。等数据膨胀到 MB 级再升 version 加压缩。
- **History 文件**：`history/dayrail-snapshot-{ts}-{deviceLabel}.dryj`。保留 14 份策略不变。

**冲突合并 · CRDT 全程自动**

`parentSnapshotId` 不再用于决定弹窗；它仅作为可观测信号写入 meta，便于排障与历史界面显示设备链路。Pull 路径：

1. 下载 `dayrail-snapshot.dryj`，解析容器，读出远端 update bytes。
2. 本地有 `Y.Doc` 的情况下，`Y.applyUpdate(localDoc, remoteUpdate)`——Yjs 内部 LWW + Lamport clock 自动消解。所有"非冲突"和"同向冲突"的修改都收敛，无 UI 中断。
3. 应用后**立即触发一次 push**（合并产物作为新 `snapshotId` 写回），让其它设备下次 pull 时拿到的是已合并版本，避免合并状态长期挂在单一设备上。

**v0.6 那张冲突卡片在 v0.7 不复存在**。Yjs 本身不会产出"两个互斥版本"——任何状态都是确定性合并结果。

**安全网保留**：Settings → 同步 永远保留两个逃生口：
- **下载当前 snapshot** —— 一键导出本地 `Y.Doc` 为 `.dryj`，同时导出一份扁平化 JSON（与 v0.6 `exportData()` 等价的可读格式）双格式留底。
- **从快照导入** —— 上传一个 `.dryj` 覆盖本地 `Y.Doc`。这条路径**同时承担三个职责**：① v0.6 → v0.7 一次性迁移落地；② 用户主动从 Drive history 中恢复某个版本；③ 万一 Yjs 自动合并出意外结果，从最近备份回滚。是真冲突 UI 的兜底——如果未来 Yjs LWW 选错胜者影响体感，用户始终有"导出留底 → 改完 → 重新导入覆盖"的回旋空间。

**拉取触发 · v0.7 新增**

承接 §7.6 v0.6.1 已落地的可见性 probe + 连接 probe，v0.7 补一个**周期性 probe** 关掉后台盲区：

- **周期性 probe** —— `setInterval` 5 分钟，仅在 `document.visibilityState === 'visible'` 且 `navigator.onLine === true` 时执行。只读 Drive metadata（`files.get?fields=appProperties,modifiedTime` 量级 ~1KB），不下载 `.dryj` 主体。判断 `remote.snapshotId` 是否领先于 `lastPulledSnapshotId`；领先则触发完整 pull（同 RuntimeSyncDialog 的 linear-lead 路径）。
  - **5 分钟节奏的取舍**：低于 1 分钟会让 Drive metadata 调用累积成可观测成本（也可能撞 Drive API quota）；高于 10 分钟用户能感觉到肉眼可见的滞后。5 分钟在"我刚切到这台设备"和"另一台设备半小时前 push 过"之间提供清晰的连续性。
  - **`document.hidden` 时不跑**：tab 真切走时由可见性 probe 接管，无需双触发。
  - **`navigator.onLine === false` 时不跑**：避免离线时累积 401/网络错误日志。

- **联网恢复 probe**（online-restoration probe）—— `window.addEventListener('online', ...)`，触发时立即跑一次 metadata 探测（与周期性 probe 同一判定逻辑），5 秒节流防抖。补的洞是："设备断网 N 分钟后恢复"——周期性 probe 在 `navigator.onLine === false` 时跳过 tick，恢复后最坏要等接近 5 分钟才会下一次 tick。`online` 事件让恢复瞬间就触发，不再被 setInterval 节奏吞掉。可见性 probe 与周期性 probe 都是"轮询/状态轮转"模型；这条是"边缘事件"模型，与可见性 probe 并列，对应网络状态翻转的瞬间。
  - 仅在 `document.visibilityState === 'visible'` 时执行：tab 真在后台时由后续可见性 probe 接管。
  - 5 秒节流与可见性 probe 共享同一节流窗：网络抖动场景下不会因 `online` / `offline` 反复翻转打爆 Drive。

**立即同步 · 双向语义**

v0.6 的「立即同步」按钮 = `runManualPush`（只推），与"立即同步"字面期望不符，导致用户在"远端有更新"时反而不敢点（正是痛点 1 的副作用）。v0.7 重塑：

- 按钮点击 → 先做一次轻量 metadata 探测（同周期性 probe）：
  - 远端 ≤ 本地：执行 push（与 v0.6 manual push 一致）。
  - 远端 > 本地：先 pull（Yjs 自动合并）；完成后若本地有未推送修改，再执行一次 push。
- 状态条上的 `⚠ 远端有更新` 与「立即同步」按钮**链接同一动作**——用户点哪里都触发完整双向流程。

**v0.6 → v0.7 一次性迁移**

用户范围当前只有作者本人 + 两台 macOS Chrome，所以**不在产品代码里实现自动迁移**——避免 dual-write / 新旧格式共存的复杂度。流程：

1. 作者在 v0.6 末次启动时手动导出本地 JSON 备份（Settings → 导出 JSON），存盘外。
2. 跑一次性脚本 `tools/migrate/migrate-json-to-yjs.ts`（`tsx` 直接执行）：
   - 输入：`dayrail-snapshot.json`（v0.6 格式，`schemaVersion: 1`）。
   - 处理：按 v0.7 schema 把 JSON 字段逐个 wrap 成 `Y.Doc`——标量字段直接写、数组写 `Y.Array`、嵌套对象写嵌套 `Y.Map`。所有 `updatedAt` / `createdAt` / `id` 等字段直接保留。
   - 输出：`dayrail-snapshot.dryj`（容器 version 1，meta `schemaVersion: 2`，新生成的 `snapshotId`，`createdAt: now`，`deviceLabel: "migration"` 占位）。
3. 浏览器装 v0.7，Settings → 同步 → 「从快照导入」上传 `.dryj`。本地 IndexedDB 写入新 schema → reload。
4. 连 Drive → 第一次推送即新格式 canonical 上线。Drive 上 v0.6 的 `dayrail-snapshot.json` 与 `history/*.json` **保留不动**作为兜底；v0.7 之后只读写 `.dryj`、忽略旧 JSON。
5. 跑通后，作者删本地 v0.6 备份的时机由作者决定（脚本不强制；v0.7 也不会再读 v0.6 格式）。

**作用域：脚本只跑一次**。代码层面：
- `tools/migrate/`（仓库内）保留脚本作为升级流程的可复现记录。
- `apps/web/` 产品代码**不**带"检测旧 schema → 自动转换"逻辑。新版本启动时遇到旧 IndexedDB store 直接抛初始化错误，提示用户走"从快照导入"路径（这条路径常驻，是上面安全网的一部分）。
- Drive 端不实现"远端旧格式自动转新格式"——首次 push 后远端 canonical 即新格式，旧文件被 history 滚动淘汰。

**与 beta 兼容策略的关系**：标准的"数据层不做破坏性 migration"约束（v0.6 期间确立）在 v0.7 因用户基数 = 1 + 显式手动备份双兜底而**有意例外**。"用户只有我，可以提前先备份好 JSON"是作者明确给出的授权。这是 v0.7 独有的窗口；v0.8 起若用户范围扩大，类似破坏性升级必须改回 §7.6 时代的 dual-write / 在产品里自动迁移路径。

**v0.7 显式不做（继续停车）**

- §7.5 加密 append-only 事件日志：v0.7 的 wire format 是整 `Y.Doc` snapshot，不是 update log。Yjs 本身可演进到增量 update 协议，留给 v0.8+ 在带宽真成问题时再开。
- §7.5 passphrase / 端到端加密 / 恢复码 / 双写 E2E 迁移：`appdata` scope 隔离仍然成立，单用户场景威胁模型未变。
- §7.2.1 三档 `{仅数据 / 仅设置 / 全部}` 同步开关。
- §7.3 多后端（iCloud / WebDAV / Dropbox）。
- 字段级真冲突 UI（"两端改同一字段且新值不等"）—— Yjs LWW + Lamport clock 决定胜者，不弹 UI。如果未来发现真冲突影响体感，再独立设计冲突 surface；当前由"下载当前 snapshot + 从快照导入"安全网兜底。

**v0.7 仍然有效的 v0.6 机制**

- §7.6 整段 Auth 生命周期（GIS token client、access token cache、FedCM、不持久化 refresh token）继续生效——v0.7 只换 wire format，认证层零改动。
- §7.6 推送触发的全部四条（debounce 60s / `visibilitychange === 'hidden'` / `pagehide` / `beforeunload` keepalive）继续生效。
- §7.6 拉取触发的可见性 probe / 连接 probe 继续生效；v0.7 补的是周期性 probe。
- §7.6 RuntimeSyncDialog 组件保留，但内部分支简化：`linear-lead` 仍然存在；`diverged` 分支整段移除（CRDT 不会产生分叉）；`offline` 分支不变；`equal` 不变。
- §7.6 顶栏同步指示灯 / Settings 同步页布局 / 备份历史 14 行保留不变。
- §7.6 启动闸门 splash + "记住启动同步选择" radio 保留不变（只是分叉分支永不触发）。

**v0.7 落地纪要（2026-04-30 实际 ship 校对）**

实施完成后回看,把"设计意图"和"实际代码"对齐。下面是几个值得记一笔的 delta:

- **pull 真的不 reload 了** —— `applyRemoteDryj` 在内存里跑 `Y.applyUpdate`,Y.Doc observer 重新派生 zustand state。用户保留 scroll 位置、打开的弹窗、in-flight 表单输入。BootGate 的 linear-lead 分支也走同一路径,启动期"应用远端"不再触发刷新。
- **dailyReflections 进了同步流** —— 单 Y.Doc + 单 wire 的简洁性优先于"私密日记"那点边际隐私顾虑;单用户 appdata scope 的威胁模型未变。如果 v0.8 用户基数扩大,再用 Yjs sub-document 做局部过滤。
- **Sessions 改成内存-only + Y.UndoManager** —— 没有 SQL `sessions` 表了。`openEditSession` 创建一个 trackedOrigins = `{sessionId}` 的 UndoManager;每个 session-aware action 用 `doc.transact(..., sessionId ?? actionLabel)` 让操作落入跟踪范围。`undoEditSession` 循环 `um.undo()` 直到栈空,然后销毁 UndoManager。等价于 v0.6 的"按 sessionId 回滚整批事件",但 reload 不持久化——单用户场景这是可接受的缩减。
- **`runManualSync.diverged` outcome 移除** —— CRDT 不会分叉,所以"立即同步"不再产生 diverged 分支。状态条上的 `dayrail-sync:show-diverged` CustomEvent 监听器一并删掉。
- **§7.6 conflict card 整段删除** —— `BootGate.DivergedPanel` / `RuntimeSyncDialog.DivergedPanel` / `forcePushOverridingRemote` / `downloadLocalAsBackup` / `downloadRemoteAsBackup` 全部从代码库消失。"冲突"在 v0.7 的语义里是"两端改了同一字段不同值",这个 Yjs LWW + Lamport 自动决,不弹 UI。
- **§5.5.6 reschedule/unschedule Shift 在 v0.7 仍然由 store 自己 emit**——`detectReschedule` / `detectUnschedule` 不变,`persistShiftAndQueuePromptY` 在 transact 之后写入 `shifts` 这张同步 map + 设置本地 `pendingShiftPrompt`(UI ephemeral,不进 Y.Doc)。
- **Settings 同步页新增两行**:
  - 「下载本地快照」—— 把当前 Y.Doc 编码成 `.dryj` 二进制下载到本地,作为 Drive 14 份滚动历史之外的额外留底。
  - 「从快照导入」—— 用 `.dryj` 替换本地数据,通过现有 `importLocalData` 路径走 stash + reset + reload。**这条路径仍然 reload**(用现有 OPFS 重置基础设施最稳),与 sync pull 的"无 reload"区分:replace-everything 用 reload、merge-from-remote 用内存合并。
- **删除的代码量** —— net 约 4600 行(`SQLite over OPFS` 整层 + event-source reducer + HLC 时钟 + sessions 表 + snapshot 缓存全部下线)。Drizzle、`@sqlite.org/sqlite-wasm`、`immer` 三个 dep 也跟着移除。
- **保留作为"未来 hook"的 API**:`saveYDocBytes` 在 Settings 里 `void`-pin 着——下次想做"无 reload import"时这是入口。

**v0.7 ship 后外部 review 修复(2026-04-30)**

外部独立 review 后修了几条:

- **push 前先 pull-merge** —— `runPush` 上传前先 `getRemoteMeta()`,如果远端 `snapshotId` 不等于 `lastPulledSnapshotId`,先把远端 `.dryj` 拉下来 `applyRemoteUpdate` 再编码上传。Drive 不是 Yjs server,不做这步的话 A 推 → B 不拉就推 → Drive 上看不到 A 的修改(虽然 A 本地下次 pull 还能合回来,但 Drive 那一刻的 canonical 是 lying)。`keepalive` push 跳过此步(pagehide 时间预算紧),其它路径全开。失败时 fallback 到无前置 pull 的纯 push,降级为旧行为。
- **`Task.subItems` 改回原子 LWW** —— 原本的 `Y.Array` 在 action 层"整列重写"语义下退化成"删空再 push",并发 tick 不同 subitem 会产生 dup / interleave / loss——比 LWW 更糟。先回退到 plain JS array(原子 LWW),等 action 层改成 per-element op(insert/delete/update on inner Y.Array)再开。
- **§5.5.6 Shift 进入 session 跟踪范围** —— `persistShiftAndQueuePromptY` 现在用 `sessionId ?? 'persistShiftAndQueuePrompt'` 作为 transact origin。之前固定字符串,session 里 emit 的 reschedule/unschedule shift 不被 UndoManager 跟踪,`undoEditSession` 回滚 slot 但留下 orphan shift。
- **pull 时不必取消 pending pushTimer** —— round-3 早期试过 `clearTimeout(pushTimer)` 但放错了位置(在 applyRemoteUpdate 触发 observer 之前清,然后 observer 又重新 schedule)。round-3 后期换了 transact origin 过滤(REMOTE_ORIGIN / OPFS_ORIGIN 永不 bump dirty),从根上避免了 echo 推。round-4 进一步把 syncController 的 dirty 跟踪直接挂到 `doc.on('afterTransaction', tr)` 上,origin 在闭包里,完全消除了 echo 风险。`pushTimer` 不需要在 pull 时清。
- **revision 并发 dedup** —— `appendRevision` 的"找同 id 删除再 push"对本地视图幂等,但两端并发推同一 `rev-{kind}-{id}-{effectiveFrom}` 后 Y.Array 会有两份(authoredAt 不同)。`readFlatStateFromDoc` 的 revision 读路径加了 `dedupRevisions`:按 id 分组,保留 authoredAt 最大的。同 id revision 的内容一致(确定性 id schema),collapse 安全。
- **删 dead code** —— `replaceYDoc` 删了(hydrate 直接用 `getYDoc()` lazy-create);Settings 里那一堆 helper 的 `void`-pin block 删了(每个 helper 现在都被引用)。`packages/db/src/migrations/` 空目录删了。

**Round 5-7 round外部 review 补强(2026-04-30 续)**

后续 3 轮 review 集中在数据流的边角 case,几个真正的 bug 修了:

- **首次连接 Drive 的 replace-vs-merge 门** —— round 5 引入 `replaceFromRemote` / `replaceLocalFromRemote`(清空所有 top-level Y.Map 后 applyUpdate),为"全新设备装机用一会儿样本数据然后连 Drive"场景避免污染。但 round 5 用 `lastPulledSnapshotId === null` 当判断条件——这条件**也**对刚跑完迁移脚本的用户成立,导致 ConnectDrivePanel 上的推荐按钮静默删掉用户刚导入的 v0.6 数据。round 6 改用 `dayrail.sync.samplesOnly` 正信号 flag(`identity.ts`):
  - `boot.ts.seedFromSamples` 完成后 set。
  - `importLocalData` 入口 clear(用户刚导入了真数据)。
  - `syncController.startSyncBackgroundLoop` 的 afterTransaction listener 在第一次 non-REMOTE / non-OPFS origin 的 transact 上 clear(用户写了任何东西,本地不再是 samples-only)。
  - 成功的 `replaceLocalFromRemote` 完成后 clear(本地已经镜像 Drive canonical,不再是 samples-only)。
- **三个 pull surface 都看 flag** —— `ConnectDrivePanel.onPullRemote` / `BootGate.pullAndMount` / `RuntimeSyncDialog.doPull` 都 branch on `isLocalSamplesOnly()`:flag 为真用 replace,为假用 merge。round 7 抓出 `RuntimeSyncDialog.doPull` 漏了这个门——visibility / 周期 / online probe 在 boot canonical-peek timeout + BootGate hard-timeout + 用户点"继续使用本地"的链路上能进入 samples-only 状态,然后任何运行时 probe 还会污染 Drive。
- **`runForcePush`(用本地覆盖云端按钮)** —— round 5 加了它。runPush 的 preflight pull-merge 不能用于 rollback 场景(用户刚 import .dryj 想让 Drive 镜像它);force-push 直接上传本地 Y.Doc,不带 parentSnapshotId,挑明"detached lineage"。round 6 补:进入 force-push 时 `clearTimeout(pushTimer)` + `clearTimeout(retryTimer)` + `wantsPushFollowUp = false`,否则 60s 后旧 timer fire 会把 force-push 后的 canonical 跟另一台设备的推送 merge 回来,把 rollback 抹掉。round 7 进一步:`runPush` 加 `getDirtyCount() === 0` 时 early-return(避免 force-push 后残留的 mid-flight timer 浪费一个 Drive history slot 上传重复 state)。
- **`runManualSync` `'pulled'` → `'pushed'`** —— round 5 已经在 pulled 之后 inline await runPush(if dirty>0)。round 6 把返回值也改成 `'pushed'`,Settings 「立即同步」的 hint 反映"本地改动也推上去了"而不是只显示"已合并云端改动"。
- **boot getRemoteMeta 1500ms timeout** —— round 5 加的,避免慢网卡死首屏。round 6 注意到 `Promise.race` 不会真正中止 fetch,但这个限制在"timeout 时 fallback 到 seed"的语义下可接受——后果是 boot 后 BootGate 的 probe 会再跑一次,经由 round 6 的 samples-only 门避免污染。
- **`saveYDocBytes` 串行化** —— round 4 加的 `inFlightSave`。round 5 修了 round-4 的 cleanup bug:`task.finally(...)` 返回新 promise,与 `task` 比对永远 false,清理永不执行 → 内存里的 prev 链长度无界。改成 `wrapped` 引用比对。
- **dedupRevisions caveat 诚实** —— round 2 就标了 same-id revision 的内容**未必**等价(两端并发 update 同一个 entity 不同字段),只是合并语义在 live state 上是对的;revision-history fidelity 在多用户场景下需要重做 id schema(加 deviceId)。
- **测试覆盖率仍是 0** —— action 层 + 同步控制器 + samples-only flag 生命周期。单用户 beta 阶段接受,作者手动验证。round 5/6/7 都 flag 了这件事;数据破坏类 bug 6 轮间出现 2 次("round 3 修了但没修对" + "round 5 引入新 bug"),整体应当评估等用户基数扩大时尽快补集成测试。

### 7.8 v1.0 实施说明 — sync 重审 · 弃 CRDT merge / 启用 snapshot smart diff

> 状态：2026-05-11 决策已锁定（doc-only PR · 实施分阶段独立 PR）。本节**取代** §7.4 关于 Yjs 作 cross-device merge 引擎的设计 + §7.7 v0.7 实装中 CRDT-merge 的 sync 路径；§7.6（Drive 通道 / auth 生命周期 / Settings 同步页骨架）+ §7.5 加密 / 恢复码部分继续停车，与本节无冲突。

**触发因素**

v0.9.0→v0.9.1 数据丢失事故（PR #24 修浅因）暴露的**深因**：push 路径像 server-authoritative（全量上传本地状态），pull 路径像 peer-to-peer（CRDT 合并），同一条数据流里既当 server 又当 peer。事故的根因不是"`samplesOnly` flag 与 seed 数据 out-of-band 容易丢"（那是浅因，已经修），而是**push 在"本地状态不可信窗口"内仍能上传**，没有数据层 firewall —— BootGate 那种 app-layer convention 不够。

叠加 v0.7 ship 半年后 dogfood 的两点观察：

1. **CRDT 的核心红利在单用户场景没兑现**。Yjs 是 §7.4 选定的"无中心合并"方案，核心红利是并发编辑自动合并。但 DayRail 现阶段（单用户 + 极小 beta）真实并发编辑**几乎零频次**——所谓"冲突"99% 是 push 时序滞后（设备 A 改完 60s debounce 还没 push，设备 B 又改，A 后续 push 撞分叉），不是真同时刻并发。

2. **Yjs 沉默 LWW 在单用户场景是 anti-feature**。两端改同字段不同值，Yjs 按 Lamport 时钟挑一边赢，另一边沉默丢弃 —— 用户无感。**在多用户协作里这是 feature**（自动收敛、零打扰），**在单用户里是 bug**（"我刚在 B 上故意覆盖 A 的旧值，被 Yjs 时钟吞了，我看不到")。dogfood 实际撞到过几次。

**决策 · B-revised**

保留 Yjs 作本地存储格式（移除代价远高于收益），sync 层抛弃 CRDT merge 语义，回到 **snapshot 粒度 + 应用层 smart diff**：

1. **Push firewall · HEAD check**（解事故根因）

   任何 push 前先打一次 Drive metadata API 拿远端 `snapshotId`：

   | 状态 | 行为 |
   |---|---|
   | 远端 `snapshotId == lastPulledSnapshotId` | lineage 干净 · 直接 push |
   | 远端动了 | push 拦截 · 强制走 pull-then-smart-diff |
   | 远端不可达 | push 拦截 · 留 dirty 等下次 |

   这条门**结构性消除**"本地不可信窗口里也能 push 出去"的可能。`samplesOnly` flag 不再 load-bearing（不依赖 app-layer convention），保留作 dead-man-switch。

2. **Pull-then-smart-diff**（解 push 时序冲突 + 沉默 LWW）

   拉远端 Y.Doc 字节后，**不调** `Y.applyUpdate(localDoc, remoteUpdate)`（这是 v0.7 LWW 的来源）。改为：

   ```
   remoteDoc = applyUpdate(new Y.Doc(), remoteBytes)
   localDiff  = diff(localDoc,  lastPulledDoc)   // 自上次同步起本地的修改
   remoteDiff = diff(remoteDoc, lastPulledDoc)   // 自上次同步起远端的修改
   ```

   按 entity-id 比对两个 diff 的并集，三档分类：

   | 情况 | 判定 | 行为 |
   |---|---|---|
   | **同向** | `localDiff` ⊆ `remoteDiff`（按字段值 deep-equal） | 静默 fast-forward · 用 `remoteDoc` 替换本地 · 无 UI |
   | **正交** | entity-id 集合无交集 · 或同 entity 但字段不重合 | 自动 union 合并 · push 合并后 snapshot · 无 UI |
   | **真冲突** | 同 entity 同字段且新值不等 | 弹冲突卡 · **字段级**展示左右差异 · 用户逐字段挑边 · 其它字段自动 union |

   "同向"档解 push 时序冲突（A 慢、B 已经把同样的改动写进远端，A 拉回来发现自己的本地改动已经在远端里了 → 静默 fast-forward，不弹卡）。

   "真冲突"档解沉默 LWW（同字段不同值 → 用户**看见**并选 · 不再被时钟沉默裁决）。

3. **Push / Pull 触发器收紧**（与 sync 模型正交 · 同 milestone 一起做）

   - **Push debounce**：60s → 5-10s（桌面端永久 OAuth + Drive 免费配额充足，无需重 throttle）
   - **Tauri window blur**：监听桌面应用失焦 · blur 即触发 push（"用户切到别的应用 = 自然 commit 点"）
   - **Pull 触发器**：现有 visibility-probe + 启动闸门保留 + 加 5 分钟周期 background pull
   - **BroadcastChannel cross-tab**：一个 tab pull 到新远端 → 通知其它 tab refresh（避免多 tab 间陈旧态）

4. **Drive multi-version history · 强化 + 暴露**

   v0.6 已有 `appdata/history/dayrail-snapshot-{ts}-{device}.json` 滚 14 份。v1.0 在 Settings → 同步 → 备份历史 升级到首屏可见，每行支持：预览（diff vs current）+ 一键回滚（自动先 dump 当前到 Downloads 再覆盖）。冲突卡片"覆盖远端"分支保留 v0.6 的 "强制先 dump 远端再 push" 语义，且 dump 同时写一份到 Drive history（一键反悔走 Settings 回滚）。

**为什么不走方向 A · "保 CRDT + Drive 权威化"**

方向 A（继续用 Yjs CRDT merge 但让 Drive 成真权威：pull-before-push + push Yjs delta + Drive 多版本 update log）能解决事故根因（pull-before-push 的 firewall 效果跟 B-revised 一样），但**不解沉默 LWW**——CRDT 沉默 merge 还在。复杂度上还得维护 delta 协议 + Drive 多版本 update log。**性价比不够**。

**为什么不走方向 C · "真后端 (PostgreSQL + DayRail 账号)"**

方向 C（破例 §7.1，加 PostgreSQL ground truth + 账号系统）能彻底解决 auth refresh、sync 模型、未来多用户协作三个问题，但**当前阶段不具备实施条件**（个人精力 / 托管成本 / 自托管运维 / 与"本地优先"立场相容性）。**显式停车**，重启信号：(1) 用户基数扩大到运维成本可摊销 · (2) 真有多用户并发编辑需求 · (3) §7.1 立场被显式重审。

**Yjs 角色再定位**

| 用途 | v0.7 设计 | v1.0 设计 |
|---|---|---|
| 本地存储格式（IndexedDB + Y.Map / Y.Array） | ✅ | ✅ 保留 |
| 本地 undo / redo（UndoManager） | ✅ | ✅ 保留 |
| 跨设备 sync merge 引擎（`Y.applyUpdate` on localDoc） | ✅ load-bearing | ❌ **不再使用** |
| HLC（混合逻辑时钟）嵌在事件里 | ✅ | ❌ 移除（snapshot 粒度无需 HLC · `lastPulledSnapshotId` lineage 替代） |

Y.Doc 序列化字节仍是 sync 传输格式（`Y.encodeStateAsUpdate(doc)`），但接收端把远端 update apply 到一个**独立的 remote Y.Doc**，再对 local vs remote 走 smart diff。结果 snapshot 作为**新本地 Y.Doc 完整替换**原本地（不是 merge）。

**实施分阶段 PR 计划**

| Phase | PR 范围 | 风险 |
|---|---|---|
| P1 · Push firewall | 加 HEAD check + pull-before-push gate · syncController 内 | 低（纯加 gate） |
| P2 · Smart diff 引擎 | 实现 entity-级 snapshot diff + 三档分类器 + 单元测试 | 中（diff 算法是新代码 · 需 well-tested） |
| P3 · 接入 sync 路径 | 替换 `runPush` 内的 CRDT merge 调用为 smart diff · 同向/正交分支静默 · 真冲突走新版 ConflictPanel | 中（替换关键路径） |
| P4 · 触发器收紧 | debounce 5-10s · Tauri blur listener · 周期 pull · BroadcastChannel | 低（独立改动） |
| P5 · History UI | Settings → 同步 → 备份历史 升级 · 预览 / 回滚 / 反悔 | 低（纯 UI） |

每 phase 独立 PR · 每 PR 跑现有 203 测试 + 加新单测 + 手工 dogfood。**P1 单独可 ship**（不依赖其它），作为"先把事故根因架构性堵死"的最小步。

**v1.0 显式停车**（不在本轮范围）

- §7.5 端到端加密 + passphrase + 恢复码（appdata scope 已 user-private · scope 扩大前不重启）
- §7.2.1 三档同步开关（一律全量同步够用）
- §7.3 Google Drive 之外的后端（同 v0.6 / v0.7 立场）
- 多用户协作（方向 C 附带 · 至少要先重审 §7.1 才能开始讨论）

### 7.9 v0.11.x 实施说明 — 持久化层重构 · 元数据生命周期对齐

> 状态：2026-05-15 决策已锁定（doc-only PR · 实施单 PR · 计划 v0.11.x milestone 内完成）。本节延续 §7.8 的修复路径，**取代** §7.8 P1 / P3 中"`lastPulled` 等同步元数据存 localStorage"的隐含假设；其余 §7.8 决策（push firewall / smart diff / Drive history UI）继续生效。

**触发因素**

§7.8 P1-P5 上线后，dogfood 中观察到一个新症状（一台桌面安装在升级到 v0.10.x 后）：UI 显示空 + 顶栏显示"已同步" + Drive 远端数据完好。Push firewall 守住了 push 方向（远端没被覆盖），但 pull 方向有漏洞 —— `runBootProbe` 比较本地 `lastPulled` 与远端 `snapshotId`，发现相等就跳过 pull · 导致空 UI 自我封闭。

跟踪根因：

- Y.Doc 数据存 OPFS（macOS：`~/Library/WebKit/<bundle-id>/.../FileSystem/dayrail-state.dryj`）
- `lastPulled` snapshot id 存 localStorage（同 WebKit 容器下另一个 SQLite 文件）
- 两者**理论上同 WebKit 容器同生命周期**，但 `apps/web/src/lib/sync/identity.ts:2-4` 注释明说"故意分开 · 让 `resetLocalData()` 抹 OPFS 时元数据不会被一起抹"
- 触发情境：unsigned → signed macOS 二进制升级（2026-05-13 加签上线导致 bundle 身份跳变） → WKWebView 把新版当成"另一个 app" → 新沙箱路径重开 store · OPFS 看起来"被抹"，但 localStorage 残留。已在桌面端实测复现一次。

**这是 §7.8 P1 firewall 没覆盖的方向**：firewall 守 push（"看不见远端时不写"），pull-side 没有"local 实质为空但 lastPulled 非空"的 sanity 闸门。

**根因 · 与 v0.9.0→v0.9.1 同家族**

跟 sample seed 事故同源 —— **out-of-band metadata 与它守护的数据生命周期不一致**。当时是 `samplesOnly` flag（localStorage） vs seeded data（OPFS）漂移，错把真数据当 sample 重新 push 覆盖远端；这次是 `lastPulled`（localStorage）vs Y.Doc（OPFS）漂移，错判"已同步"导致空 UI 自我封闭。无论修哪一个症状，都不能只在漂移结果上加 gate · 必须从源头消除漂移可能性。

**决策**

1. **抽象 `YDocStore` 接口 + 后端二选一**

   抽出 store 接口，把 Y.Doc 主体 + last-pulled snapshot + 所有"跟数据共生死"的元数据放进**同一个 store**：

   ```typescript
   interface YDocStore {
     loadYDoc(): Promise<Uint8Array | null>;
     saveYDoc(bytes: Uint8Array): Promise<void>;
     deleteYDoc(): Promise<void>;
     loadLastPulled(): Promise<Uint8Array | null>;
     saveLastPulled(bytes: Uint8Array): Promise<void>;
     deleteLastPulled(): Promise<void>;
     loadSyncMeta(): Promise<SyncMeta | null>;
     saveSyncMeta(meta: SyncMeta): Promise<void>;
     reset(): Promise<void>;
   }
   ```

   两个实现：

   | Backend | 触发条件 | 文件位置 |
   |---|---|---|
   | `OpfsYDocStore` | `!isTauri()` —— 浏览器 / 调试 | OPFS · `dayrail-state.dryj` / `dayrail-last-pulled.dryj` / `dayrail-sync-meta.json` |
   | `TauriFsYDocStore` | `isTauri()` —— 桌面 | `app_data_dir()/ydoc/{state.dryj, last-pulled.dryj, sync-meta.json}` |

   关键：**两个实现都把 metadata 跟 Y.Doc 放在同一个介质**。OPFS 被 evict 时两者一起没；Tauri FS 被外力清除时两者也一起没。**结构上消除漂移可能。**

2. **元数据生命周期切分**

   不是所有 localStorage 键都搬。按"是否绑数据 lineage"二分：

   | 键 | 切分 | 理由 |
   |---|---|---|
   | `lastPulledSnapshotId` / `lastSyncAt` / `lastSyncLabel` / `samplesOnly` / `dirtyCount` / `lastPushedCounts` / `bootSyncChoice` | → co-resident store | 数据 lineage 游标 |
   | `deviceId` / `deviceLabel` / `deviceAutoLabel` | 留 localStorage | 设备身份 · 不绑数据 · reset 后保留"还是同一设备"是合理语义 |
   | `driveConnected` / `cachedAccessToken` | 留 localStorage | OAuth 状态缓存 |
   | `bootProbeSuppressed` | 留 sessionStorage | 会话级 |

3. **In-memory cache · 保 sync API 不变**

   `identity.ts` 对外 API 全部保持现签名（同步 getter/setter），底层从直接读 localStorage 换成读 in-memory cache。Cache 在 boot 时一次性 `await store.loadSyncMeta()`，setter 同步更新 cache + fire-and-forget 异步落盘（写入串行化，沿用 Y.Doc 的 `inFlightSave` 模式）。Tauri blur / pagehide / pre-push 触发器之前 flush。

   后果：`syncController.ts` 那 20+ 个 getter/setter 调用点全部不变。

4. **Sanity check · pull-side firewall**

   `runBootProbe` 加守卫：

   ```
   if (remote.snapshotId === lastPulled) {
     if (lastPulled !== null && localLooksEmpty()) {
       return { kind: 'lost-local' };  // 强制 pull
     }
     return { kind: 'equal' };
   }
   ```

   架构修复后这条几乎不会触发（lastPulled 跟 Y.Doc 一起没 → 不进相等分支 → 直接 `linear-lead` 走 pull），保留作 belt-and-suspenders（用户主动 reset 数据 / 极端 OS-level eviction 等场景）。

5. **"已同步" UI 改语义**

   `SideNav.describeSyncStatus` 增加 in-memory "本会话有过 round-trip" 标志位，冷启动后第一次显示中性"未确认"直到本会话内有 push/pull 成功。`lastSync` 时间仍显示作参考信息但不再作"已同步"判定 —— 避免用户面对空 UI 还看到"已同步"误信号。

6. **localStorage 一次性迁移**

   新版第一次启动 · 若 store 中 sync-meta 不存在 · 从 localStorage 读取被搬迁的键 · 写入 store · 删除 localStorage 中已搬键。`deviceId` 等不搬的键不动。**迁移代码寿命**：v0.11 引入 · v0.14 删除（设备数 = 2 · 用户保证及时升级）。

7. **`resetLocalData()` 改抹 store · 元数据不再特殊豁免**

   `identity.ts:2-4` 那条"故意 localStorage 让元数据 survive OPFS reset"注释删除。`resetLocalData()` 改为调 `store.reset()`，抹掉所有 co-resident 数据 + 元数据；device/auth localStorage 不动。

**为什么不只做防御网（决策 4 + 5）**

只做 sanity check + UI 改语义能修当下症状（另一台机器下次启动会自动恢复），但留下了**家族 bug 第二次复发的可能**：未来任何路径再次让元数据跟数据漂移（比如新加一个 sync cursor 不小心放了 localStorage）就会再开新症状。`out-of-band metadata` 这个模式本身不消除，下一个 bug 只是时间问题。

跟 v0.9.0→v0.9.1 砍 sample seed 一样的取舍：架构修复 + 防御网捆 PR · 不接受"只做防御网"。

**为什么不为浏览器版做单独的 fallback**

浏览器端是同步代码 —— `OpfsYDocStore` 是同一接口的另一实现，跟桌面对称。OPFS 被 evict 时，由于元数据跟 Y.Doc 都在 OPFS · 两者一起没 → boot probe 自然走 first-connect → 从 Drive 拉。**浏览器版本身就被这个修复覆盖** · 不需要额外 fallback。

**为什么不做 OPFS → Tauri FS 数据迁移代码**

设备数 = 2 · 用户已经明确接受"以 Drive 为准"的覆盖。当前桌面安装升级后 store 里没 Y.Doc · boot 走 first-connect 路径 · 从 Drive 拉。另一台机器本来就处于"空"状态，行为一致。**写迁移代码会增加 ~150 行短寿命代码且没收益**。

**不在范围内**

- ❌ Dual-write / OPFS 与 Tauri FS 镜像（避免 source of truth 二义性）
- ❌ Y.Doc 写入策略改造（保留现 debounce 8s + 整 doc rewrite · 性能不在本节范围）
- ❌ §7.5 加密层（继续停车）
- ❌ Drive 端协议改动（snapshot 上传不变 · 与 §7.8 一致）

**实施 · 单 PR · 内部分阶段（review-friendly）**

| 阶段 | 内容 | 主要文件 |
|---|---|---|
| A | `YDocStore` 接口 + `OpfsYDocStore`（重构现有 OPFS 代码 + 元数据搬入 store） | `packages/db/src/yDocStore.ts` · `packages/db/src/opfsYDocStore.ts` |
| B | `TauriFsYDocStore` + Rust commands | `packages/db/src/tauriFsYDocStore.ts` · `apps/desktop/src-tauri/src/ydoc.rs` |
| C | `identity.ts` 重写：API 不变 · 底层走 in-memory cache + store flush | `apps/web/src/lib/sync/identity.ts` |
| D | `boot.ts` / `lastPulledDoc.ts` / `resetLocalData.ts` 改走 store factory | 多文件 |
| E | localStorage → store 一次性迁移（v0.11 引入 · v0.14 删） | `boot.ts` 早期 |
| F | Sanity check + UI 改语义 | `BootGate.tsx` · `syncController.ts` · `SideNav.tsx` |

预估 ~400 行 source · 一节 ERD · 跑现有 203 测试 + 加针对 store 的单测 + 双端 dogfood（桌面 + 浏览器各一轮）。

### 7.10 v0.12 实施说明 — 同步信任模型 · 三种用户模式 + 五件套护栏

> 状态：2026-05-18 决策讨论锁定（doc-only PR · 实施分阶段独立 PR）。本节延续 §7.6 → §7.7 → §7.8 → §7.9 的修复路径：前面几节解的是"sync 机制本身的正确性"，本节解的是"用户在 sync 出问题（或没出问题）时的体感与信任"。**取代** §7.6 / §7.8 中"sync = 单一模式 · UI 状态 = 单一状态点"的隐含假设；其余决策（push firewall / smart diff / co-resident store / Drive history UI）继续生效。

**触发因素 · 用户故事**

§7.9 修完元数据漂移之后，dogfood 中暴露的不再是"数据安不安全"，而是 **"用户能不能信任系统已经做对了"**。讨论中浮现的几个具体故事（归档摘要）：

- **故事 1 · Identity 错连**（最隐蔽）：重连 Drive 时账号选择器分神点错（默认选中浏览器当前登录的另一账号），系统沉默接受。从此 push 进了错账号的 appdata，几个月后才发现真账号备份停在某个旧时点。
- **故事 2 · 关电脑前未检查**：18:30 合上工作 Mac 回家，pagehide push silently fail。下次到家打开个人 Mac 看到的是早上版本 —— 不是误读信号，是**根本没有信号触达用户**（用户不会主动 verify）。
- **worst case A · 跨周末分歧**：周五 push 失败，周末家 Mac 基于"周五早上视角"调整下周计划，周一开工作 Mac → 12 条字段级冲突。**冲突数量线性于时间，认知成本指数于时间**。
- **worst case B · 假期分歧**：工作 Mac 节前 push 失败，假期只用家 Mac，节后回办公室 → 2 周累积冲突，记忆完全失效。
- **worst case C · 长期 identity 漂移**：故事 1 持续几个月 → 两台 Mac 各自在不同账号上"同步成功" → 触发条件是某台机器坏了去拉数据，发现少了大量内容。**成本 = 数月数据不可逆丢失**（不是冲突 · 是直接没了，因为另一台设备已经在错误状态上被反复覆盖）。

共同根因：**当前 UI 把"失败状态"表达为瞬时 boolean，缺时间维度、缺用户意图分层、缺接收端可见性、缺源头预防**。

叠加一个之前没认真分类的观察：**不是所有用户都需要 sync**。当前 DayRail 把 backup 与 multi-device sync 揉成同一个 mode（连了 Drive → 全套机制开），导致：
- 单设备保险党觉得 ConflictPanel / pull reconcile / "同步策略"等概念多余
- 多设备同步党觉得绿点不足以承担 worst case 信任

**决策概览**

引入两层模型 ——

1. **用户模式分层**（前进可推断 · 后退必显式）：本地党 / 保险党 / 同步党。Mode 由当前活跃设备数自动推断 · 不让用户在 connect 时做"长期 / 临时"分类 · mode 不会被系统静默回退（见 §7.10.1）。
2. **信任护栏五件套**（按 mode 启用子集）：
   - Identity pinning · 账号身份基线（含 `lastKnownMode` 不变量）
   - 离场 gate · 强版（同步党）+ 弱版（保险党软提示）
   - Heartbeat + 启动 reconcile · 仅同步党
   - 时间维度感 · 失败持续时长 + pending 堆积主动警示
   - Mode regression 守卫 · 数据层不一致时不静默降级

**为什么不让用户在 Settings 显式选 mode（拒绝方案 X）**

显式三档「不连云 / 仅备份 / 多设备同步」UX 边界清楚，但要求用户**自我分类**并理解三档语义差异。DayRail 的 §8 No-guilt design + Silent by default 一直是"让系统懂用户"而不是"让用户教系统" —— v0.11 occurrence adoption gate、samples-only flag、§7.9 metadata 推断都是这条路径。隐式推断方案 Y 与之一致。代价：mode 切换的时机和告知必须做对（见 §7.10.1 的"mode 上升"和"mode 下降"两段）。

**为什么 mode 不能静默回退**

mode 上升可以由"检测到新活跃设备"自动触发，但**回退路径必须由用户显式触发**（Settings → 主动断开 Drive · 或主动从设备列表移除某台设备）。如果允许 mode 在用户不知情下自动回到本地党或保险党，下面这类事故就会再次发生：

- 软件 bug 清掉 `driveConnected` localStorage → UI 切本地党 → 同步子系统对用户隐藏 → 用户继续编辑、改动累积本地、心跳不写、push 不发 → 其它设备看不到这台
- 用户**完全不知道刚才发生了什么**，因为四件套护栏都依赖 mode = sync/backup 才工作

§7.10.6 Mode regression 守卫专门处理这条 —— "运行时推断的 mode 比 IdentityPin 里上次确认过的 mode 低 → 弹阻塞 banner 让用户选择，不静默降级"。这条与 §7.9 精神一致：out-of-band 漂移要架构层阻止，不只是写防御网。

**为什么不依赖单一"绿点 / 黄点 / 红点"做所有 surface**

事故 dogfood 反复证明：单 binary 状态点既不能区分"瞬时失败"和"持续多日失败"，也不能区分"发送端"和"接收端"。五件套是同一信任问题的多个 cut：
- **源头预防**：离场 gate
- **身份校验**：identity pinning
- **接收端可见**：reconcile + banner
- **时间维度**：失败持续时长 + pending 堆积
- **数据层不一致守卫**：mode regression guard

**任何单一机制不能替代其它**。

**关于文案风格的原则**

本节所有 UI 文案草稿遵循两条原则：

1. **不替用户假设场景**：用户的实际情境可能超出我们的设想，决策按钮要给用户灵活变通的空间（"稍后再说" / "临时使用" / "我先看看"），不要把用户的头按下去服从我们的某一种判断
2. **不暴露技术细节到主界面**：用户不需要在主界面读到 "push 失败 401 Unauthorized" 这种东西。技术细节若有必要呈现，折叠到"详情 ⌄"或 hover tooltip 里，主界面保持温和的人话

***

#### 7.10.1 用户模式分层 · 显式前进 · 不静默后退

**三种模式**

| 模式 | 触发条件 | UI 表现 | 启用机制 |
|---|---|---|---|
| **本地党** | 未连接 Drive | 同步子系统对 UI 完全隐藏 · Settings → 同步只露"连接 Drive"入口 | — |
| **保险党** | 已连 Drive · 唯一在线设备 | "备份"心智 · 顶部时间感粗版 · 不弹 reconcile banner · 不弹 ConflictPanel | identity pinning · 时间感粗版 · 离场 gate 弱版 |
| **同步党** | 已连 Drive · ≥ 2 台活跃设备 | "同步"心智 · 启动 reconcile banner · ConflictPanel · 时间感细版 | 全套 |

**Connect 流程 · 不区分设备类型**

> 设计决策：**不让用户在 connect 时回答"这是长期还是临时设备"**。早期草案曾设计三档选择（长期 / 临时主用 / 临时只读），实测各档要解的边界场景（朋友借笔记本 / 电脑送修 / 公用电脑 / dev Drive）都已被其它机制兜底，三档反而强迫用户回答一个**他不需要在 connect 时回答的问题**。详见本节末尾"为什么不区分临时设备"。

连接 Drive 是一步走完：

```
Settings → 同步 → 「连接 Drive」
→ Google OAuth（标准流程）
→ 完成 · 顶部温和 toast：

  ✓ 已连接到 meowjolan@gmail.com · 数据会自动同步
    [多设备同步是怎么回事 ⌄]
```

折叠区只一句话："你在多台设备登录同一个 Drive，DayRail 会自动把它们的数据合在一起。某台设备 30 天没活动会从列表移除。"

**Mode 推断时机**

- 启动 reconcile 拉所有设备心跳后立即决定 mode（仅看 ≤30 天有活动的设备）
- 每次 push 成功后重新评估
- 状态存 §7.9 co-resident store 的 `syncMeta.detectedMode = 'local' | 'backup' | 'sync'`
- 同时把当前 mode 写入 `IdentityPin.lastKnownMode`（§7.10.2）· 供 §7.10.6 守卫比对

**Mode 上升 · 温和告知 · 不阻塞**

主设备发现第二台新设备的心跳时（用户在新设备上完成了 connect），意图已通过 connect 行为表达 · 主设备**不弹阻塞 modal**：

```
顶部温和一行（24h 内只显示一次 · 可一键关掉）：

ℹ 另一台设备加入了同步 · 看看会有什么变化 ⌄ · [关掉]
```

点开折叠区是简短说明（用户想读再读），不强迫接受。

**Mode 下降 · 自然 + 用户可控 · 永不静默**

- **自然路径**：某设备 30 天未写心跳 → 系统视作"久未上线"，自动从设备列表灰显 · mode 可能从 sync 退回 backup（如果剩 1 台活跃设备）· 顶部一次性温和 toast 告知，**不阻塞**
- **用户主动**：Settings → 同步 → 设备列表 → "移除这台"（比如电脑卖了 / 修好回来不再用 substitute）· 不删任何数据
- **不自动**：软件 bug / 网络问题 / OAuth 失效**不会**让 mode 静默回退到更低档 —— 这种情况由 §7.10.6 不变量守卫拦截，要求用户显式做选择

**为什么不区分"临时设备"**

> 设计早期为"朋友借笔记本临时登一下" / "电脑送修临时主用"这类场景设计过 connect-time 三档选择，最终拒掉。原因：试图防的几类场景，要么本来无害，要么有其它机制兜底。

| 想防的场景 | 不区分 = 普通连接 后果 | 兜底机制 |
|---|---|---|
| 电脑送修 / 临时主用几天 | 当普通设备连 · 双向同步 · 修好后用户从设备列表移除 / 30 天自动归档 | **这本来就是正确行为**，无需特殊态 |
| 朋友借笔记本查一眼 | 当普通设备连 · 写一次心跳 · 主设备 mode 短暂升级到同步 · 30 天后自动归档退回 | 短期 mild UI 噪声 · 无数据风险 · 用户随时可在 Settings 主动移除 |
| 公用电脑 / kiosk 临时登录 | 同上 · 加上"用完登出 OAuth"的常规 web 卫生 | 安全靠 OAuth 退出 · 不是 mode flag |
| 意外登错账号 | 与"临时 vs 长期"维度无关 | §7.10.2 Identity pinning |
| Dev / staging Drive | 主 Drive 看不到 dev Drive 活动 · 不同账号天然隔离 | OAuth 账号天然边界 |

**这里取消的不只是一个 modal，是一类工程师本能：**每次撞到反例，倾向"加分支处理新场景"而不是"问能不能干脆不区分"。Connect-time 三档相当于把"这台机器以后会怎样"的判断压到用户身上，但 30 天自动归档 + 设备列表手动移除已经把"以后"的善后做完。区分给出的额外控制力，**用户在 connect 那一刻还判断不了**（电脑送修两周还是两个月？连接的时候真不知道），不区分反而把决策延后到事情发生时（"修好了 → 设备列表移除"）—— 决策时机更接近真实信息。

***

#### 7.10.2 Identity pinning · 同步 + 备份共享身份基线

治 故事 1 + worst case C 的根因。

**Schema**

存 §7.9 co-resident store：

```typescript
interface IdentityPin {
  accountEmail: string;             // 首次连接时记下的 Drive 账号邮箱
  appdataFileId?: string;           // 首次拿到的 .dryj 文件 id（已有时）
  lastKnownMode: 'backup' | 'sync'; // 上次成功运行时确认过的 mode · 供 §7.10.6 不变量守卫比对
  pinnedAt: string;                 // ISO timestamp
}
```

**比较时机**

| 时机 | 调用 |
|---|---|
| 每次 token refresh 完成 | `oauth2/v3/userinfo` 拿 email · 对比 `pin.accountEmail` |
| 每次 push 前（与 §7.8 HEAD check 同次调用） | Drive metadata `owners[0].emailAddress` · 对比 pin |
| 重连 Drive 完成 OAuth | 立即对比 |

**不一致 UX · 阻塞模态（用户友好版）**

```
登录的账号不太对吗？

之前用的是 meowjolan@gmail.com
现在登录的是 guojunnan@bytedance.com

[让我重选账号]
[确实要换到这个账号]
[稍后再说 · 暂不同步]

──
不确定？看看会发生什么 ⌄
（折叠详情：之前的备份留在原账号 · 这台设备从此连到新账号 · 两边账号的数据不会自动合并）
```

三个按钮：
- **"让我重选账号"**：返回到 OAuth 账号选择器（最可能的真实意图 · 误点 / 浏览器自动登错账号的逃生口）
- **"确实要换到这个账号"**：写入新 `IdentityPin` 覆盖旧 pin · `syncMeta` 重置为 first-connect 态（走 §7.6 + §7.8 的 first-connect 路径）· UI 上立刻进入新账号的同步流
- **"稍后再说 · 暂不同步"**：本会话内同步整段挂起（数据层照常运行 · 本地编辑正常 · 但不 push / 不写心跳）· 下次启动再问

文案选择上避免技术化词汇（删 "destructive action"、"我知道我在做什么"、"账号变化"等系统消息口吻）· 详情折叠 · 主界面读起来是问句不是警告。

**保险党 vs 同步党的差别**

| 阶段 | 保险党 | 同步党 |
|---|---|---|
| 触发面 | 仅在"备份目标"切换 | 同步主账号切换 + 任何 token refresh |
| 文案重点 | "备份历史会断成两段" | "另一台设备的同步会找不到这台" |

***

#### 7.10.3 离场 gate

治 故事 2 + worst case A/B 的源头。

**强版（同步党）· 阻塞模态**

触发时机：
- **Tauri**：`app.on_close_requested` 监听用户主动关窗 → pending > 0 时阻塞窗口关闭 → 弹模态
- **PWA**：`beforeunload` 是 fire-and-forget · 无法真正阻塞 · 改为 **离场前的"显式 quit 流程"** —— 用户主动点 Settings → "安全退出" 才走 gate · 浏览器关 tab 仍是软兜底 · 兜底失败时下次启动通过 §7.10.4 reconcile banner 告知 + 标记 `pending-departure`

模态状态机：

```
[初始]
   │ push 尚未完成
   ▼
[正在上传你最近的改动 3/5...] ──── 成功 ────► [自动关闭]
   │
   │ 失败（网络 / 凭证 / 服务端错误）
   ▼
[温和提示 · 不红不黑]
   "还有 5 个改动没传上去 · 网络好像有点问题"
   [再试一次]  [先这样，下次开机继续传]
```

"先这样"分支：写一条 `pending-departure` 标记到 co-resident store · 下次启动时 reconcile banner 优先显示"上次还有几个改动没传 · 现在试一下吗？"。语言上不是责备而是接续 —— 用户不会觉得"软件在催我"，更像"软件记着这事，下次帮我做"。

技术错误细节（401 / 5xx / 具体 body）折叠到提示下方的 "看看详情 ⌄"，主界面只露"网络好像有点问题"这一句人话。

**弱版（保险党）· 软 toast**

触发时机：用户主动 quit / window close · 检测「距上次成功备份 > 3 天 且 当前有未备份改动」→ 右下角 toast：
```
📦 5 天没备份了，要不要现在传一下? [备份 · ~10s] [明天再说]
```
不阻塞 · 用户点"明天再说"或直接忽略都直接关。"明天再说" 写 `skipBackupReminderUntil = today + 1d`，24 小时内不再提醒。

***

#### 7.10.4 Heartbeat + 启动 reconcile · 仅同步党

治 故事 2 + worst case A/B 的接收端可见性。

**Heartbeat schema**

每台设备 push 成功后追写一条 `device-heartbeat-{deviceId}.json` 到 Drive appdata（与主 `.dryj` 同 folder · 旁路文件 · 不进 Y.Doc）：

```typescript
interface DeviceHeartbeat {
  deviceId: string;              // §7.9 中已有 · localStorage 持久
  deviceName: string;            // 用户可改 · Settings → 同步 → 设备名
  lastActivityAt: string;        // 最近一次用户编辑 Y.Doc 的时间
  lastPushedAt: string;          // 这条心跳的写入时间 = 最近一次成功 push
  lastPushedSnapshotId: string;  // 推上去的 .dryj 文件版本（Drive etag / revision id）
  pendingCount: number;          // 写心跳时 pending 数 · 此次成功推送的话 0
  schemaVersion: 1;
}
```

文件名带 deviceId · 多设备天然不冲突。心跳是"最近一次成功 push"的产物 · 不另起独立写入触发器 · 简化设计（push 失败时心跳不更新 · 与"上次成功推送时点"语义自然一致）。

**启动 reconcile 流程**

`runBootProbe`（§7.8 / §7.9 已有）之后增加 reconcile 阶段（仅同步党 mode）：

1. 列出 `device-heartbeat-*.json` 全部文件 · 过滤掉自己 deviceId
2. 对比每条心跳的 `lastActivityAt` 与 `lastPushedAt`
3. 综合三态 banner：

   | 状态 | 条件 | 主界面文案 |
   |---|---|---|
   | ✓ 一切就绪 | 所有其它长期设备心跳健康 + 本机 reconcile 拉完 | `✓ 一切就绪 · {对方设备名} 也是 {时间} 的版本` |
   | ⚠ 可能不是最新 | 至少一台对方心跳显示 `lastActivityAt > lastPushedAt + 1h` | `⚠ {对方设备名} 今天有用，但最新内容可能还没传过来` |
   | ✕ 现在连不上 | 本机无法连 Drive | `✕ 现在连不上 Drive · 显示的是这台机器上保存的版本（最后同步 {时间}）` |

   banner 在主界面顶部 · ✓ 状态持续 5 秒淡出 · ⚠ / ✕ 持续显示直到状态变化或用户主动关闭。详细技术信息（具体时间戳 / push id / 错误码）折叠到 banner 旁的 "详情 ⌄"，主文案只露人话。

**性能 / 配额**

每次 boot 多一次 list + 几次 GET 心跳文件 · Drive API 配额日均 < 50 次（每用户每天开应用次数 × 设备数）· 远低于免费额度。心跳文件 < 1KB · 不影响 `.dryj` 主体传输。

**长尾不可达设备**

某台设备 30 天未更新心跳:
- Settings → 同步 → 已连接设备列表显示"已离线 30 天" · 系统自动归档
- reconcile 不再纳入归档设备的 banner 判定
- 归档设备某天又写心跳 → 自动复活 · 弹 §7.10.1 升级 modal

***

#### 7.10.5 时间维度感 · 失败的持续时长可见

治 worst case A/B/C 中"warn 点亮 3 分钟 vs 3 天看起来一样"的盲区。

**Failure history schema**

存 §7.9 co-resident store:

```typescript
interface SyncAttempt {
  at: string;                    // ISO timestamp
  direction: 'push' | 'pull';
  result: 'ok' | 'fail';
  errorCode?: string;            // 'network' | '401' | '5xx' | 'identity-mismatch' | ...
  errorBody?: string;            // 前 500 字 · 仅 fail 时
}

interface SyncMeta {
  // ... §7.9 已有字段 ...
  recentAttempts: SyncAttempt[];        // 最近 100 条 · 环形队列
  lastSuccessAt: {                      // 永久 · 不参与窗口淘汰
    push: string | null;
    pull: string | null;
  };
}
```

**同步党细版 · SideNav 状态点 hover tooltip**

状态正常时（主界面只有一个安静的小绿点 · hover 才看到信息）：
```
✓ 一切就绪
刚刚同步过 · 3 分钟前
```

状态告警时（主界面是温和的黄点 / 红点 · hover 看到时间维度）：
```
⚠ 已经 3 天多没传上去
上次成功传是 上周五 17:14
[再试一次]  [看看具体怎么了 ⌄]
```

"看看具体怎么了 ⌄" 折叠展开后显示技术细节（具体尝试次数 / 最近错误代码 / Settings → 同步 → 故障历史 链接）。**主提示永远是"已经几天没传上去"这一句人话**，技术细节不进 hover 主体。

**同步党 · 长期 silent 失败升级阶梯**

> 原则：失败时间越长越要让用户看到 · 但**永远不阻塞主界面进入**。用户的判断可能比我们的猜测更准（比如他知道自己在飞机上 / 在出差），不要替他做"不允许编辑"的决定。

| 失败持续 | UI 升级 | 阻塞？ |
|---|---|---|
| < 1 小时 | SideNav 状态点变 warn · 无主动提醒 | 否 |
| 1-24 小时 | 顶部温和提示条："传不上去 N 小时了 · [再试] [先关掉]" | 否（可一键关掉，会话内不再出现） |
| 1-3 天 | 顶部明显提示条："已经 N 天没传上去 · 这台机器看到的可能不是最新版本 · [再试] [先关掉]" | 否 |
| > 3 天 | 同上 · 颜色更深 + 第一次进入时附一个温和 toast："要不要先 [重连一下 Drive] 再继续？" | 否 |

不阻塞的原因：用户可能完全知道发生了什么（"我自己关了网" / "我在改一个我不打算同步的设备"），强制阻塞主界面 = 替用户假设场景，违反**用户的实际处境优先于系统的猜测**。

**同步党 · pending 堆积主动警示（v0.11 改动后扩展）**

只有失败的持续时长还不够 —— 如果用户长会话中没主动 hover SideNav，会在不知情中工作在"以为传上去了但其实没"。补一条：

| 触发条件 | UI |
|---|---|
| pending 数 > 20 且 距上次成功 push > 1 小时 | 顶部温和提示："你最近改的内容有 20 个还在本机 · 大约 1 小时没传上去 · [再试一下] [先关掉]" |

- "先关掉"按钮写 `dismissPendingPileUntil = now + 24h`，24h 内不再提醒
- 阈值（20 / 1h）后续根据 dogfood 调
- pending 数怎么界定：以 Y.Doc state vector 对比"上次成功 push 时的 vector"为准 · 用户语言上表达为"改的内容"而不是"事务" / "事件"等技术词

**保险党粗版 · 主界面顶部一行**

```
📦 距上次备份：14 天
```

颜色阈值：
- 绿（< 3 天）：不显示 banner（避免噪声）· 仅在 Settings 内可见
- 黄（3-14 天）：温和黄色顶部条
- 红（> 14 天）：红色顶部条 + 进入 DayRail 后第 5 秒弹一次温和 toast："要不要现在备份一下 ([10s])"（一天最多一次）
- 灰（> 30 天）：进入 DayRail 时一次性温和卡片提醒（**不阻塞**，可一键关掉，但下次启动还会出现，直到用户主动备份过一次）

灰档的设计原则：不强制用户立刻备份，但每次启动都温和地"问一下"，直到事情被解决。

***

#### 7.10.6 Mode regression 守卫 · 数据层不一致不静默降级

治 Q2a 类事故 —— 软件 bug / OS-level eviction / 缓存清除等让 mode 在用户不知情下回到更低档。这是 §7.10.1 "mode 后退必显式" 的落地机制。

**触发条件**

boot 时：
- 读 `IdentityPin.lastKnownMode`（§7.10.2 schema 字段）
- 读当前运行时推断出的 mode（按 §7.10.1 推断逻辑）
- 若 `pin.lastKnownMode ∈ {backup, sync}` 且 `runtime.mode == 'local'` → **数据层不一致** · 进入 regression 守卫流程

**UX · 阻塞 banner（用户必须做选择，但选项灵活）**

```
🔌 跟 Drive 的连接好像断了

这台设备之前在和 meowjolan@gmail.com 同步，
现在看起来连接掉了。
你的本地数据完好，可以随时继续用。

[重新连一下 Drive]
[先不连了，本地用就好]
[稍后再说 · 这次先用着，下次启动再问]

──
为什么会这样？看看 ⌄
（折叠详情：常见原因是 OS 缓存被清 / 软件升级重置了一些设置 / OAuth 凭证过期 · 数据本身没问题）
```

三个分支：
- **"重新连一下 Drive"**：走标准重连流程（§7.6）· 成功后 `IdentityPin` 保留 · runtime mode 恢复到 pin.lastKnownMode 或更高
- **"先不连了，本地用就好"**：显式降级 · 清掉 `IdentityPin` · `syncMeta` 重置为 first-connect 态 · UI 变成本地党模式
- **"稍后再说"**：本次启动跳过 · 主界面正常进入 · 不写 / 不同步 · 下次启动再问

**为什么不静默自动重连**

试图自动重连听起来更"无感"，但如果重连失败（token 真的失效了），结果是 mode 仍然在 local 但 pin 未清 → 下次启动再次撞同样的 banner。从用户角度看像 "软件一直在跟我抱怨同步问题"。让用户**显式知情**这件事更尊重他的意图 —— 他可能本来就想暂时离线工作，这种情况下"先不连了"是合理选择。

**保险党也用同一守卫**

如果 `pin.lastKnownMode == 'backup'` · `runtime.mode == 'local'`，弹同款 banner（只是文案里的"同步"换成"备份"）。保险党也需要"我以为有备份但其实没有"的护栏，本质和同步党一致。

***

**实施分阶段 PR 计划**

| Phase | PR 范围 | 风险 | 用户价值 |
|---|---|---|---|
| P1 · Identity pinning（含 `lastKnownMode`） | localStorage pin · OAuth 后比较 · 不一致弹模态 | 低（纯加 gate） | 防 worst case C 数据损失 |
| P2 · 时间维度感 · 失败历史 + pending 堆积警示 | Co-resident store 加 `recentAttempts` · SideNav tooltip · 顶部 pending 警示 · Settings 故障历史 | 低（纯加 UI + 记录） | 长期 silent 失败 + 长会话堆积都能显形 |
| P3 · Mode regression 守卫 | boot 时比较 `pin.lastKnownMode` vs runtime · 阻塞 banner | 低（纯加判断 + UI） | 防 Q2a 类"以为还在同步但其实没了" |
| P4 · Heartbeat 写入 + 启动 reconcile | Drive 旁路文件 schema · boot probe 拉心跳 · banner 三态 | 中（新 Drive 文件 + 启动流程） | 同步党"我能放心动了"体感 |
| P5 · Mode 推断 + 设备列表 UI | 心跳数 → backup/sync 自动切换 · Settings 设备列表 · 主设备发现新设备的温和 toast | 中（包装层 · 决定其它机制可见性） | 保险党不被多设备复杂度污染 · 用户能管理设备 |
| P6 · 离场 gate · 强版 + 弱版 | Tauri close listener · 模态状态机 · 弱版 toast | 中（Tauri 端 + cross-platform 行为差异） | 源头预防 worst case A/B |

每 phase 独立 PR · 每 PR 跑现有 244+ 测试 + 加新单测 + 双端 dogfood。**P1 + P2 + P3 单独可 ship**（互不依赖）作为"先让失败可见 + 防数据损失 + 防 mode 静默降级"的最小步；P4-P6 互有依赖按顺序。

**v0.12 显式停车**（不在本轮范围）

- ❌ 设备数 > 2 的同步党体验（banner 文案在 N 台设备下会爆 · 简化用"还有 {N-1} 台设备活跃"代替逐台列出 · 留到第三台设备真出现再设计）
- ❌ 心跳数据进 Y.Doc / CRDT（保持旁路文件 · 避免 sync 路径复杂化）
- ❌ 失败历史的云端持久化（仅本机 · 跨设备故障关联留 v1.x）
- ❌ §7.5 加密层（继续停车）
- ❌ Mode 显式选择 UI（按方案 Y 推断 · 不让用户手动切 backup ↔ sync）
- ❌ "上次离开时有 M 条改动没传上去" 的具体内容回放（schema 上只标 count · 想展开见 Drive history）
- ❌ "临时设备" / 只读连接 / 24h 自动断 等特殊连接模式（早期草案设计过 · 拒掉 · 见 §7.10.1 "为什么不区分临时设备"）

***

## 8. 设计原则（工程层）

1. **Local-first，无账号**：所有数据、所有核心功能本地运行；没有 DayRail 账号、没有服务器 —— 从第一次启动开始，这个产品就完整属于你。
2. **AI 与同步是可选插件**：默认关闭，收在设置页；首次启动有一次性 AI 引导。
3. **Offline-capable**：离线可用是默认，不是降级。
4. **Cross-platform**：Web（PWA）→ 桌面 → 移动，统一代码库。
5. **Minimal friction**：冷启动到"看到下一步"< 1 秒。
6. **No guilt design**：跳过 / 偏离是一等操作，不设置失败语义；永不以"阻塞当前操作"的方式惩罚过去的遗漏。
7. **Silent by default**：通知、动画、弹窗、联网默认最小。
8. **概念少、文案白话**：不强推"渐进显露"式关卡；用户可见的文案必须用"今天""模板""目标""规划"这类常识词；**内部实体名只在文档和代码里出现**。UI 任一屏都应该"看一眼就知道在做什么"。
9. **一条同步通道**：用户数据与用户设置都走同一个用户选定的第三方后端（Google Drive / iCloud / WebDAV）。DayRail 这家公司不在关键路径上。
10. **MVP 优先，复杂留到后面**：当面前有一条"正确但代价很大"的路（迁移流程、自适应启发式、精细预算、多账号状态…），默认选最简单能跑通的方案；等真实使用数据证明必要性再重做。只能换到边际收益的"更完整方案"，就延后，而不是提前解决。
11. **设置分层为 基础 / 高级**：主设置页只出现轻度用户真正会碰到的几个开关（主题、通知、同步开关、AI 开关）。小众开关 ——"归档 Line 计入统计"、"按计划明文导出"、"仅 Wi-Fi 同步"、单条 Rail 的 Signal 覆盖 —— 都收在 **设置 → 高级** 里，默认折叠。这样新用户看到的表面足够小，重度用户又不失控制。

***

## 9. 技术选型

### 9.1 前端

| 领域 | 选型                 | 理由                            |
| -- | ------------------ | ----------------------------- |
| 框架 | React + TypeScript | 生态成熟，跨平台复用性最高                 |
| 构建 | Vite               | 启动快、PWA 插件完善                  |
| 样式 | Tailwind CSS       | 快速迭代，内置设计令牌                   |
| 状态 | Zustand + Immer    | 轻量、无样板、易本地持久化                 |
| 路由 | React Router       | 标准方案                          |
| 动画 | Framer Motion      | 克制动画所需的低成本方案                  |
| 拖拽 | dnd-kit            | Today / Week / Template 编辑器共用 |

### 9.2 存储

| 层            | 选型                                        | 说明                                                                                                         |
| ------------ | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 本地存储         | SQLite（Web：`wa-sqlite` + OPFS；桌面 / 移动：原生） | 结构化查询，便于时间序列。**Web 基线：最近版本 Safari + 常青 Chromium / Firefox**；不再维护 IndexedDB 兜底路径（持久化层双份维护的代价不值得，且该边界会自然缩窄）。 |
| ORM / Schema | Drizzle ORM                               | 类型安全、迁移清晰                                                                                                  |
| 本地加密         | SQLCipher（移动 / 桌面可选启用）                    | 保护敏感数据                                                                                                     |

### 9.3 AI

| 项        | 选型                                            |
| -------- | --------------------------------------------- |
| 协议       | OpenAI-compatible `/v1/chat/completions` + SSE 流式（详见 §6.6） |
| 默认接入     | OpenRouter（用户 BYOK）；Settings → AI 里 base URL 可改任意端点 |
| 兼容范围     | OpenRouter / Groq / Together / Mistral / Anthropic-via-proxy / Ollama / LM Studio / `claude-code-router` / `claude-bridge` 等所有兼容端点 |
| 用户背景     | `userProfile.background` Markdown blob（v0.8 起，§6.6.1）—— AI 调用前 prepend 到 system prompt |
| Prompt 层 | 自建薄封装，稳定输入输出 schema，对用户不可见                    |

> v0.8 之前曾选 OpenRouter-only + 远端免费模型清单 + fallback chain UI，v0.8 在 §6.6 里改为通用 OpenAI-compat 协议；fallback 改由 endpoint 层（`claude-code-router` / OpenRouter 自身）承担，DayRail 不再做适配层。

### 9.4 同步

| 项     | 选型                                                                                                      |
| ----- | ------------------------------------------------------------------------------------------------------- |
| 账号后端  | **无** —— DayRail 没有任何服务器，所有同步都走用户选定的第三方后端                                                               |
| 同步后端  | Google Drive（首发） → iCloud → WebDAV                                                                      |
| 同步内容  | 用户数据（Rail / Track / Shift / Line / Template）**与**同步设置（OpenRouter Key 密文、主题、Fallback 链、通知偏好）—— 同一份加密事件日志 |
| 仅本机保留 | 后端凭证（OAuth token / WebDAV 密码）与加密短语                                                                      |
| 加密    | 端到端加密（用户持密码短语）                                                                                          |

### 9.5 跨平台

- **\`Web（PWA）**：首发平台，可安装、可离线。
- **Desktop**：Tauri（Rust 后端，包体小，系统集成好）。
- **Mobile**：Capacitor（复用 Web 代码；后台任务用于同步拉取等，**不做原生通知**，见 §5.6）。

### 9.6 视觉设计系统

#### 组件库

- **shadcn/ui**（基于 Radix Primitives）+ **Radix Colors**（色板 token）+ Tailwind CSS + Lucide Icons。整体停留在 Radix 生态里，组件、颜色、可访问性行为保持一致。
- shadcn/ui 是"复制源码到仓库"的形态而非 npm 依赖，允许无痕改造 —— 适合 DayRail 这种有独特气质的产品。
- Radix 提供键盘导航、ARIA、焦点管理等可访问性能力，这对长期使用的陪伴型工具很重要。
- 避免使用 MUI / Chakra / Mantine 等强风格库，它们的"产品后台感"与 DayRail 气质不合。

#### Logo 与标识

- **主标识**：inline SVG 组件 `<DayRailMark />`（位于 `packages/ui/logo.tsx`）。两条等距弯曲铁轨线条 + 地平线。**刻意不使用位图或第三方字体 logo** —— 自绘保证任何缩放、任何 locale、任何主题下都清晰，也不引入版权 / 字体包袱。
- **副标题**：`STAY ON THE RAIL`，全大写、letter-spacing 宽、JetBrains Mono。**不随 UI locale 翻译**（中英文档都保留英文原文）。理由：副标题是视觉符号而非功能文字，翻译会削弱品牌辨识；"stay on the rail" 是铁轨隐喻的核心，任何翻译都会变味。
- **出现位置**：桌面侧栏顶部、登陆页 / onboarding / About。**移动端主屏不出现 logo**（让位给内容，仅在 Settings 的"关于"里露脸）。

#### 色板

| 角色                 | Radix token（浅 / 暗一致同阶） | 用法                                                                 |
| ------------------ | ---------------------- | ------------------------------------------------------------------ |
| Surface 0 / 1 / 2 / 3 | `sand` / `sandDark` 的 step 1–4 | 页面底 → 卡片 → 嵌套 / hover → drop-target，四档 surface 层级，详见下方"Surface 层级" |
| 主要前景               | `slate-12` / `slateDark-12` | 标题、正文                                                              |
| 次要前景               | `slate-11` / `slateDark-11` | 副标题、图标、time pill Mono 字                                            |
| 辅助文字               | `slate-10` / `slateDark-10` | 注释、placeholder、hairline 色                                          |
| 强调色 Terracotta       | `orange-9` / `orangeDark-9` | **仅**用于 Current Rail 标识、主行动按钮。三档状态详见下方"Terracotta CTA"  |
| 中性警示               | `amber-9` / `amberDark-9` | 未标记 / 待决定（不用红）                                                     |

**关键约束**：

- **不使用红色**表达"未完成 / 过期"。红色会唤起失败感，违背 No guilt design。
- **Rail 用户色板** —— 采用 **[Radix Colors](https://www.radix-ui.com/colors)** 现成色板，不再手选 hex：

  Radix Colors 自带成对的日/夜两套 scale，且每阶的对比度都做过 WCAG 校准，我们直接复用，省去手工派生暗色的工作，也接入了一个持续维护的开放色彩体系。

  10 个 Rail 颜色统一取下列 Radix scale 的 **step 9**（step 9 是 Radix 标注的"solid"纯色档，正好适合时间块填色）。初稿曾包含 `olive / mauve / gray`，视觉测试后替换掉 —— olive 与 sage 在 step-9 上近乎相同、mauve 与 slate 都是"冷灰紫"读不出差异、gray 失去色相导致像被 skipped。换入 `grass / indigo / plum` 三个饱和色，覆盖原本缺席的"活力绿 / 冷静蓝 / 创作紫"空位：

  | 角色         | Radix scale | 角色             | Radix scale |
  | ---------- | ----------- | -------------- | ----------- |
  | Sand 沙     | `sand`      | Apricot 杏      | `amber`     |
  | Sage 鼠尾草   | `sage`      | Seafoam 海沫     | `teal`      |
  | Slate 石青   | `slate`     | Dusty Rose 绛粉  | `pink`      |
  | Clay 陶土    | `brown`     | Grass 草绿       | `grass`     |
  |            |             | Indigo 靛蓝      | `indigo`    |
  |            |             | Plum 梅紫        | `plum`      |

  4 个自然色系（`sand / sage / slate / brown`）+ 6 个饱和色系（`amber / teal / pink / grass / indigo / plum`）。"能走自然色系就走"的核心仍在，但饱和侧的缺席已补齐，Cycle View 多 Rail 并排时不再糊成一片。

  暗色版本直接用对应的 `…Dark` scale（如 `sandDark`）取同一阶，不用手动派生。用户侧的「跟随系统 / 浅色 / 深色」三档切换控件位于 §5.9 外观 section。
- **Template 色** —— `Template.color`（可选字段，见 §10）复用上述 10 色 Rail 色板的同一个 token 名。同一色板在 UI 里的出现位包括：Template Editor tab 下方 2px 色条、Cycle View 每日列头 tint（step 2 底 + step 11 文字）、Calendar 日期格子底色、模板切换时的动画着色。`workday` 默认 `slate`，`restday` 默认 `sage` —— 两色在 Radix 自然系下相邻而不相撞。Rail 与 Template 共用同一色板，因为它们的视觉语义同源（都是"当前这段是什么性质的时间"），不应分裂成两套 token。
- **对比度**达到 WCAG AA。

#### Surface 层级（Tonal Layering）

四档 surface token，全部基于 Radix `sand` / `sandDark` 同 scale，暗色零手工派生：

| token         | 浅色         | 暗色              | 用途                                                                     |
| ------------- | ---------- | --------------- | ---------------------------------------------------------------------- |
| `--surface-0` | `sand-1`   | `sandDark-1`    | 页面底色（Today Track / Cycle View / Review / Settings / Calendar / Template Editor 的 page bg） |
| `--surface-1` | `sand-2`   | `sandDark-2`    | 默认卡片（Rail 卡、Line 卡、Cycle 单元格、popover / drawer 内部块）                      |
| `--surface-2` | `sand-3`   | `sandDark-3`    | Sticky strip 底（Template Editor summary strip、Cycle View 顶栏）、hover cell、Review 节奏热力图的 hover tip |
| `--surface-3` | `sand-4`   | `sandDark-4`    | 拖拽 drop-target 高亮、按钮 active 态底、当前选中 nav 项底                              |

**规则**：卡片 / 容器不用 `border: 1px` 表达层级，**靠 surface-0 → 1 → 2 → 3 的 tonal 对比代替**（见下方"No-Line Rule"）。四层足以覆盖所有场景；超过四层的嵌套不存在于 DayRail 的视图结构里，真出现了先考虑拆视图。

#### No-Line Rule（无分隔线原则）

DayRail 优先用**留白 + Surface 层级**表达层级，不用 `border` / `divider-y` 做结构分隔。

**白名单（允许的线条）**：

- **装饰色条**：Rail 卡左侧 4px 色条、Template Editor tab 下方 2px `Template.color` 色条、Cycle View 每日列头 tint —— 它们承载色彩语义，**不是**结构分隔。
- **Sticky 层与滚动内容之间的 0.5 px hairline**：`slate-10` 色，用于 sticky 栏（Template Editor summary strip 下缘、Cycle View 顶栏底缘）与下方滚动内容的立体界面。
- **Focus / active ring**：无障碍必需，不受此规则约束。

**禁止**：

- 列表行之间、卡片之间、section 之间的 `divider` 实线。
- 卡片整体 `border: 1px`（用 surface-1 vs surface-0 的 tonal 对比即可）。
- 任何纯装饰性的 horizontal rule。

#### Terracotta CTA 的状态规则

强调色 Terracotta 的三档状态（**纯色、无渐变**）：

| 状态    | 浅色            | 暗色                  |
| ----- | ------------- | ------------------- |
| 默认    | `orange-9`    | `orangeDark-9`      |
| hover | `orange-10`   | `orangeDark-10`     |
| active | `orange-11`   | `orangeDark-11`     |

**为什么不用渐变**：渐变是"我很重要请看我"的 SaaS 营销语法，DayRail 是"安静的工具"——不喊话。纯色 step 9/10/11 三段反馈已经够清晰，且与 Rail / Template 色块的 step 9 纯色上色哲学一致。

#### 圆角 token

| token             | px   | 用途                                                             |
| ----------------- | ---- | -------------------------------------------------------------- |
| `--radius-sharp`  | 0    | 时间块（Rail block）、色 swatch、颜色 dot。**刻意尖角**，"一段被切下来的时间"的印刷日程感  |
| `--radius-sm`     | 6    | 按钮、chip、pill、time pill、input、prompt chip                         |
| `--radius-md`     | 10   | 卡片（Rail 卡、Line 卡）、drawer 内部块、popover                            |
| `--radius-lg`     | 16   | Modal / bottom sheet 容器（罕用）                                    |

**不走 Stitch 默认的 2 / 4 / 8 / 12**：2 px 与 0 px 视觉难分，白给一档；且 Rail 时间块应该是尖角（印刷日程感），让"sharp"成为一等 token 而非数字 0。

#### 不使用 Glassmorphism

整站**零** `backdrop-filter` / 玻璃模糊。理由：

- Glass 是"数字发光"感，与"印刷纸面"气质直接对撞。
- `backdrop-filter` 在移动端有真实性能成本。
- G2 的 0.5 px hairline + G3 的 surface 层级对比已经把"这是一层漂浮的 sticky / popover" 表达清楚了，glass 想解决的问题已被更克制的方式覆盖。
- 零例外 = 规则最简单。

#### 非对称为默认（Intentional Asymmetry）

master-detail（左列表 + 右详情）、单栏列表、左 sticky sidebar + 主轴 是 DayRail 的惯用布局；**不做屏幕级居中对称**。左对齐文字 / 左侧 accent / 左侧 sticky 是一组贯穿全站的节奏，视觉重心落在左半，模仿阅读铅字的视线路径。Modal / onboarding 等极少数"中断主流程"的场景例外，允许居中。


#### 字体

- UI：Web / 桌面端使用 **Inter**；**移动端回退到系统字体**（iOS 用 SF Pro、Android 用 Roboto），避免打包 Inter 带来的约 300 KB 成本，也改善蜂窝网络下的冷启动。
- 时间数字：**JetBrains Mono**（固定宽度，避免"8:00"与"11:59"跳动）。子集化后约 40 KB，全平台都打包。
- 中文回退：苹方 / PingFang SC → 思源黑体。

#### 动效

- 默认 `prefers-reduced-motion` 尊重系统。
- 过渡时长 ≤ 200ms，缓动以 `ease-out` 为主。
- 永不使用弹跳 / 回弹 / 气球等"欢快"动效。

### 9.7 国际化（i18n）

从第一天就支持中英双语（zh-CN + en），架构假设后续会由社区贡献更多语言。

| 项       | 选择                                                                               |
| ------- | -------------------------------------------------------------------------------- |
| 库       | **react-i18next** + `i18next-icu`（ICU MessageFormat 处理复数 / 日期 / 性别）              |
| 打包      | JSON 资源文件，按 namespace 分（`common`、`rail`、`line`、`settings`、`ai`、`review`…），按路由懒加载 |
| 目录      | `packages/locales/{zh-CN,en}/{namespace}.json`                                   |
| 日期 / 数字 | 原生 `Intl.DateTimeFormat` / `Intl.NumberFormat`，无额外依赖                             |
| 时区      | `Temporal` polyfill（或 `date-fns-tz` 过渡）                                          |
| 语言检测    | 首次启动用 `navigator.language`；设置中可覆盖                                                |
| 回退链     | `zh-CN` 缺 key → 回退 `en` → 开发环境回退为 key 本身（告警）                                     |

**约定**：

- **内部实体名保持英文**（代码 / 文档 / DB 列 / 事件 payload 中的 `Rail`、`Track`、`Shift`…）。只翻译面向用户的字符串，保证 schema 与语言解耦。
- **AI 只维护一份正本 prompt**（英文），输出语言作为参数传入。UI locale 与 AI 输出 locale 解耦（详见 §6.2）。
- **RTL（阿拉伯语 / 希伯来语）延后到 v1.0 之后**，但 CSS 从第一天就使用**逻辑属性**（`margin-inline-start`、`padding-block-end` 等）—— 未来加 RTL 只需一次样式扫荡，不必重写。
- **复数**统一用 ICU（`{count, plural, one {# 个 Rail} other {# 个 Rail}}`），禁止字符串拼接。
- **时间制**：`zh-CN` 默认 24 小时，其他语言跟随 locale 默认（`en-US` 为 AM/PM），高级设置中可覆盖。
- **社区贡献**：新增语言 = 在 `packages/locales/<tag>/` 下加一个目录 + PR。AI prompt 的 locale 扩展走同一份包。

#### 日期 / 时间显示对照表

不同视图对日期信息的密度要求不同。这张表把每个视图 × 每个 locale 的显示形式写清楚，避免临场拼接字符串。

| 视图             | zh-CN 示例                 | en 示例                    | 实现（`Intl.DateTimeFormat` 配置）                                                                |
| -------------- | ------------------------ | ------------------------ | ------------------------------------------------------------------------------------------- |
| Now View 顶部    | `4月 16日 周四 · 14:28`      | `Thu · Apr 16 · 14:28`   | `{month, day, weekday, hour, minute}`（hourCycle 由用户设置决定）                                    |
| Today Track 列头 | `今天 · 4月 16日 周四`         | `Today · Thu, Apr 16`    | 同上去掉 `hour/minute`；"今天 / Today" 由应用层根据 `Track.tz` 判断后拼入                                     |
| Cycle 选择器      | `4月 C1 (04/07~04/13)`    | `Apr C1 (04/07–04/13)`   | 月份（zh 用 `numeric`，en 用 `short`）+ 自定义 `C{n}` 序号 + 区间用短日期 `MM/dd`                             |
| Cycle View 列头  | `4/7 周一` / `4/13 周日`     | `Mon 4/7` / `Sun 4/13`   | `{month: 'numeric', day: 'numeric', weekday: 'short'}`                                      |
| Review 时间段     | `2026年4月 · 第 1 周期`       | `Apr 2026 · Cycle 1`     | 年 + 月 + Cycle 序号，**不使用 ISO week**                                                           |
| Calendar 日期格   | `16`（仅数字）                | `16`                     | 只渲染 `day: 'numeric'`，月份靠视图上下文                                                               |
| Shift 时间戳      | `14:28 · 已以后再说`          | `14:28 · Deferred`       | `{hour, minute}` + i18n 模板字符串                                                                 |

#### Cycle 记号规则（C1 方案）

- 使用 `C1 / C2 / C3 …` 序号，**`C` 而非 `W`** —— 故意避开 ISO 周号（`W`）的歧义：用户的 Cycle 边界不一定和 ISO 周对齐（节假日延长、个人调整、自定义 7 天以外的 cycleLength）。用 `W` 会让"第几周"这件事在 DayRail 和操作系统日历之间产生错位。
- **序号归属的月份以 Cycle 的 `startDate` 为准**。跨月 Cycle（如 3月30日–4月5日）显示为"3月 C5"，不因为大部分天在 4 月就跳到"4月 C1"。理由：规划视图里 Cycle 的编号要和规划当下的月份心理感知对齐 —— 用户在 3月30日打开这个 Cycle 时，它就该是"3 月的最后一个 Cycle"。
- 月内 Cycle 序号从当月第一个 Cycle 的 `startDate` 起累加（C1, C2, …）；跨年时不清零（按 startDate 的月累加即可，年份靠视图上下文，如 `2026年4月 C1`）。

#### 字体启发式（Inter vs JetBrains Mono）

- **文本里的数字**（"4月 16日" 的 `16`、"30 min" 的 `30`）→ **Inter**，随上下文呼吸，视觉一致。
- **需要纵向对齐 / 频繁变动 / 要求"不跳"的数字**（时钟 `14:28`、倒计时、时长 `02:15:00`、Cycle View 列头右上的小日期 `4/7`、Shift 时间戳）→ **JetBrains Mono**。
- 经验法则：**"这个数字会不会在用户盯着看的时候变动？" 会 → Mono；不会 → Inter。** 这条规则覆盖新增场景时不用再逐个讨论。

#### Intl 强约束（硬性编码规则）

以下是 review 时会直接打回的红线：

- **禁止**字符串拼接日期 / 时间（如 `${month}月${day}日`、`${hour}:${minute}`）。一律通过 `Intl.DateTimeFormat` 或 `Temporal.PlainDate.toLocaleString`。
- 星期缩写一律从 `Intl` 取（`formatToParts` → `weekday` part），**不维护**自己的 `['周一', '周二', ...]` 表 —— locale 扩展时不必再找这种字典。
- **"这个 RailInstance 属于哪一天"永远以 `Track.tz` 为准**，不用浏览器当前时区 —— 跨时区飞行时的视图稳定性依赖这一点（见 §7.4）。
- `Intl.DateTimeFormat` 实例 memoize 到 `(locale, options)` 作为 key 的 cache 里，避免每次 render 都重新构造（老机型上 format 构造是可感知成本）。

### 9.8 仓库结构

- Monorepo：pnpm workspaces
- 结构：
  - `apps/web`、`apps/desktop`、`apps/mobile`
  - `packages/core`（领域模型：Rail/Track/Shift/Signal/Line/Template）
  - `packages/ui`（共享组件 + Tailwind 预设）
  - `packages/db`（Drizzle schema + 迁移）
  - `packages/ai`（OpenRouter 客户端 + prompt）
  - `packages/sync`（同步抽象 + 第三方适配器）
  - `packages/locales`（i18n 资源文件，每种语言一个子目录）
- License：MIT
- CI：GitHub Actions

***

## 10. 数据模型草稿（初版）

### 10.0 三轴速览（先看这个再看类型）

DayRail 的 30+ interface 看起来多，但概念层只有**三根正交的轴**。所有 UI 都是这三根轴的组合投影。

**轴 1 · 分组（Line）— "谁在拥有这件事"**

- `Line` 是内部容器，UI 永远展示为 Project / Habit / Tag（按 `kind` 区分）
- 字段：id / name / color / status（active/archived/deleted）/ kind / 可选 plannedStart-End
- 内置 Inbox Line（`id='line-inbox'`、`isDefault=true`、不可删），新建 Task 不挑 Project 时的默认落点

**轴 2 · 时间（Template → Rail → auto-materialize → RailInstance）— "什么时候发生"**

```
Template ──(包含)──► Rail ──(recurrence + CalendarRule 决定触发日)──► RailInstance(per date)
                      │
                      └── defaultLineId?（可选把这条 Rail 默认归属给某个 Line）
```

- `Template`：日型。"这一天该长什么样"（workday / restday / travel / …）
- `Rail`：模板里的一条时间带。所有带都拴在一个 templateKey 上
- `CalendarRule`：决定某一天套哪个模板（single-date > date-range > cycle > weekday 优先级）
- `RailInstance`：某个 Rail 在某一天的物化实例。**v0.4 起职能收窄为"墙钟日志"**（actualStart / actualEnd / Shift 标签），不再是完成状态的真源

**轴 3 · 工作单元（Task）— "具体做什么 + 做没做"**

- `Task` 属于一个 Line（`lineId`），`status` 是**完成状态的唯一真源**
- 字段：title / note / order / status / milestonePercent / priority / subItems
- **排期两种互斥模式**：
  - Mode A：`task.slot = { cycleId, date, railId }` —— 占用某个 Rail 某天的格子
  - Mode B：`task.slot = undefined`，对应一条 `AdhocEvent.taskId = task.id`
- Task 的两种来源：
  - **手工建**：Project / Inbox 场景，用户自己写标题
  - **自动建**（v0.4 起）：Habit 场景，由 recurrence 按需生成，id 规则 `task-auto-{lineId}-{date}`

### 10.1 完成状态归属（非常重要）

v0.4 起 DayRail 对"这一次做了吗"有**单一真源原则**：

> **Task.status 是所有"完成 / 跳过 / 归档"语义的唯一真源。**
> RailInstance 只承载墙钟数据（actualStart / actualEnd）和 Shift 标签。

具体规则：

| 场景 | 完成状态写在哪 | 产生 Task 的方式 |
|---|---|---|
| Project 的排期 task | `Task.status` | 用户手工建 |
| Habit 的每日 occurrence | `Task.status`（auto-task） | recurrence 自动生成（§5.5.0 / §10.2） |
| Inbox 里未排期的 wish | `Task.status`（但没 slot） | 用户手工建 |

**为什么要这条规则**：v0.4 以前 `Task.status` 和 `RailInstance.status` 同时存在且独立写入，出现过"Tasks 页勾完成但 Today Track 仍显示 pending"这类一致性裂缝。合并之后 Today Track / Tasks 页 / Pending 队列 / Review 全部从 Task 出发，裂缝消失。

**RailInstance 还留着干嘛**：
- 墙钟事实（`actualStart` / `actualEnd`）—— "这件事实际上发生在几点"是独立于 status 的维度，用于 Review 的节奏分析
- Shift 的归属对象 —— "为什么偏离"挂在 RailInstance 上

**Habit 借 auto-task 走这条路**：见 §5.5.0 + §10.2。一个 habit 每次发生都体现为一条 `lineId=habitId` 的 auto-task；habit 详情页节奏带、Review 热力图全部查 auto-task。

**v0.11 例外（§10.6 / TaskOccurrence）**：当 Task 关联了 occurrences（`taskOccurrences[*].taskId == this`）时，**`Task.status` 完全派生**于 occurrences 状态聚合 —— 全 done = `done` · 有 done 有 pending = `in-progress` · 全 pending = `pending` · 全 archived = `archived`；`archived` / `deleted` 状态的 occurrence 不参与 rollup。manage 单位下沉到 occurrence；Task.status 在这个分支上不再可显式编辑。Project 进度（用户可见的百分比）相应改为 `max(occurrence.percent for done occurrences)`，与现有 milestone 取 max 算法同形。详见 §10.6。

### 10.2 Auto-task 物化策略（Ⅱ · on-demand）

Habit 下的 auto-task 不预先一次性生成、也不事件日志里手动塞，而是**按视图按需物化**。

**幂等 id**：`task-auto-{habitId}-{date}`。保证多次触发同一 (habit, date) 只产生一条。

**物化触发点**：
- Today Track boot → 物化 today
- Cycle View 打开 / 切换 cycle → 物化 [startDate, endDate]
- Habit 详情页节奏带打开 → 物化节奏带窗口
- Calendar 月视图翻月 → 物化该月
- Review 切 scope → 物化 scope 窗口
- Pending / Tasks 页 → **不触发**物化（只读活跃数据）
- A+B 节奏带点回填（§5.5.0）→ 点击即触发单个 (habit, date) 的物化

**"已物化过"标记**：对每个 `(habitId, cycleId)` 记录一次物化标记（字段待定，可能挂在 Line 上或独立实体），**物化过的 cycle 不再重算**，避免 habit 配置变更后历史又多出一堆 auto-task。

**算法（单次物化 `[startDate, endDate]`）· v0.4 · 以 HabitBinding 为主**：
```
for binding in habitBindings:
  rail = rails[binding.railId]
  habit = lines[binding.habitId]
  if !habit or habit.status != 'active' or !rail: continue

  for date in [startDate .. endDate]:
    if activeTemplate(date) !== rail.templateKey: continue
    if binding.weekdays && !binding.weekdays.includes(dayOfWeek(date)): continue
    if date < dateOf(binding.createdAt): continue  // 不回填 binding 创建前的历史日期

    upsert Task {
      id: `task-auto-${habit.id}-${date}`,
      lineId: habit.id,
      title: habit.name,
      slot: { cycleId: cycleIdOf(date), date, railId: rail.id },
      status: 'pending',
      source: 'auto-habit',
    }
  mark (habit.id, cycleId) as materialized for cycles fully inside [startDate, endDate]
```

说明：`upsert` 在 id 已存在时是 no-op —— 这是 habit 改名后老 auto-task 不会被回写的底线（§5.5.0 Auto-task 编辑性表的 title 只读行依赖这条不变式）。

**从未物化的过去 cycle**（用户回看漏开 app 的历史）：打开时照常物化一次。用户事后在节奏带回填状态 = 当前判断的记录，不是"伪造历史"—— 真实发生过的事由 Signal 日志保真。

### 10.3 Habit 配置变更规则（影响 auto-task 生成的改动）

可能改变 "哪些 (habit, date) 该有 auto-task" 的变更面有两类：

- **Rail 级**：改 `startMinutes` / `durationMinutes` / `templateKey`
  （`recurrence` 字段已在 v0.4 移除，不再是 trigger）
- **HabitBinding 级**：新增 / 删除 binding、改 `weekdays` 过滤器

两类都走同一条规则处理。

> **v0.5 起这里说的"改"指的是写入一条新 revision**（§10.5）。Rail / HabitBinding 不再原地 mutate；
> 写路径产生 `rail-revision.upserted` / `habit-binding-revision.upserted`（旧的 `rail.updated`
> 仅在 v0.4 数据上过渡期保留）。purge 窗口的下界改为 `max(today, effectiveFrom)` ——
> 早于新 revision 生效日的"过去 + 今天部分"读旧 revision，自然不被波及。

**0. 保存前 confirm**（仅当改动会影响某个 habit 的未来 auto-task 时）：

```
这个改动会影响 habit「<habit 名>」的排期。
  · 未开始的自动任务 N 条会按新配置重新生成
  · 已完成 / 跳过 / 归档的保留不动
  继续？
```

**1. 确认后，在同一个 Edit Session（§5.3.1）下**：
- 扫描窗口：`[今天, 最远已物化 cycle 的末尾]`
- 符合 `source = 'auto-habit' AND status = 'pending' AND plannedStart > now` 的 auto-task → **硬删**（`task.purged`，非软删 —— 这些 occurrence "从未发生过"）
- 按新配置补齐同窗口里缺的 auto-task

**2. 不动的范围**：
- `status !== 'pending'` 的 auto-task（已经是事实，不能追溯）
- `plannedStart <= now` 的 auto-task（"今天这个时段已过"，即使 pending 也视为事实）
- 未物化的过去 cycle（从未算过的时段不因配置变更而补）
- 用户在未来 auto-task 上写过的 note / subItems —— 会随 purge 一并失去（它们属于"未发生的未来事件"的临时内容，失去可接受）

**3. 事件日志**：
- 若干 `task.purged`
- 若干 `task.created`
- 一个 `rail.updated` **或** `habit-binding.upserted` / `habit-binding.removed`

三者在同一个 sessionId 下 → 用户误改配置时一次 undo 回到原样。

**边界情况**：
- 删除 HabitBinding = 该 binding 生成的未来 auto-task 按规则 purge，不补新的
- HabitBinding 改 weekdays = 不再命中的未来日期 purge，新命中的日期补齐
- habit Line 归档 / 删除 = 跟随 Line 生命周期，其所有 binding 失效，未来 auto-task 停止生成（过去的保留）

### 10.4 类型定义

```ts
// 仅作讨论基线，字段会迭代

type TemplateKey = string; // MVP 内置 'workday' | 'restday'，可扩展

// v0.5 起 Rail / Template / CalendarRule / HabitBinding 拆成"身份 + 一串 effective-from
// revision"。下方的 Rail / Template / CalendarRule / HabitBinding 类型只保留**身份字段**
// （id、createdAt、tombstone），所有可变字段挪到对应的 *Revision 类型上。完整 revision schema
// + 读写 / 物化 / 迁移规则见 §10.5。

type Rail = {
  id: string;
  createdAt: number;
  // v0.5: 删除 = tombstone（不直接从 store 移除），过去仍能读到末次 revision。
  tombstone?: { effectiveFrom: string; at: number; sessionId?: string };
};

// v0.4 新增: habit 与 rail 的关系实体(见 §5.5.0 / §10.2)
// v0.5: 改名为身份壳 —— `habitId` / `railId` 也下沉到 revision，因为用户可能想让
// "同一个 binding"在某个时间点改换绑定的 rail。完整字段在 HabitBindingRevision（§10.5）。
type HabitBinding = {
  id: string;
  habitId: string;   // 指向 Line.id (kind='habit') —— v0.5 起视为冗余索引（与 latest revision 同步），
                     // 真值以 latest HabitBindingRevision.habitId 为准。
  createdAt: number;
  tombstone?: { effectiveFrom: string; at: number; sessionId?: string };
};

// v0.5: Template 拆为身份壳 + TemplateRevision（§10.5）。`key` / `isDefault` 留在身份壳，
// 因为 key 是稳定标识、isDefault 决定是否可删（语义不变）；name / color 是用户可改的展示属性，
// 挪到 revision。
type Template = {
  key: TemplateKey;
  isDefault: boolean;
  createdAt: number;
  // 内置模板（workday / restday）的 createdAt 设为 sentinel，用户自定义模板取实际创建时间。
  // 内置模板不允许 tombstone（§5.4 已约定"内置模板禁用删除"）。
  tombstone?: { effectiveFrom: string; at: number; sessionId?: string };
};

type Cycle = {
  id: string;
  startDate: string;  // YYYY-MM-DD
  endDate: string;    // YYYY-MM-DD；默认 startDate 起至下一个 Sunday（含）
  days: CycleDay[];
  // v0.8.2 起：单字段 LWW 缓存最近一次 Cycle 复盘 AI 输出（§6.6.2）。
  // 形态与 DailyReflection.lastAiObservation 一致；挂在 cycle 实体上保证
  // cycle 删除时 AI 缓存跟着没。再点一次直接覆盖，不留历史 array。
  lastAiObservation?: {
    generatedAt: number;        // 调用完成的 wall-clock（epoch ms）
    model: string;              // 调用时选的 model name（事后看来源用）
    json: object;               // §6.6.2 通用 JSON schema 输出：{ observation, patterns, suggestions }
  };
};

type CycleDay = {
  date: string;             // YYYY-MM-DD
  templateKey: TemplateKey; // 该日套用哪个模板
};

type Slot = {
  // 复合键：cycleId + date + railId 唯一
  cycleId: string;
  date: string;       // YYYY-MM-DD
  railId: string;
  taskName?: string;  // 一次性小事（不走 Project）；可为空
  taskIds: string[]; // 按 order 展示，0..N
};

type Track = {
  id: string;
  date: string;     // YYYY-MM-DD，按下方 tz 计
  tz: string;       // 当天开始时锁定的 IANA 时区，例如 "Asia/Shanghai"
  templateKey?: TemplateKey;
};

// v0.5: CalendarRule 拆为身份壳 + CalendarRuleRevision（§10.5）。`id` / `kind` 是稳定身份，
// `value` / `priority` 挪到 revision —— 用户在抽屉里 in-place 编辑 weekday 规则的 weekdays 数组、
// 调 cycle 规则的 mapping，不再原地覆盖，而是写一条新 revision。
type CalendarRule = {
  id: string;
  kind: 'weekday' | 'cycle' | 'date-range' | 'single-date';
  createdAt: number;
  tombstone?: { effectiveFrom: string; at: number; sessionId?: string };
};

// v0.4 留作参考：原 CalendarRule 的"扁平形态"（v0.5 拆字段后保持兼容读路径用）
type CalendarRuleFlatV04 = {
  id: string;
  kind: 'weekday' | 'cycle' | 'date-range' | 'single-date';
  // Typed `value` per kind (v0.3 全部生效)：
  //   weekday:    { weekdays: number[], templateKey }          // 0 = 周日；一条 rule 用 weekdays 数组覆盖多个星期
  //   cycle:      { cycleLength: number, anchor: 'YYYY-MM-DD', mapping: TemplateKey[] }  // mapping[i] = 第 i 天位置对应的 template
  //   date-range: { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', templateKey, label?: string }
  //   single-date:{ date: 'YYYY-MM-DD', templateKey }
  value: unknown;
  priority: number; // 数值大者优先
  createdAt: number; // epoch ms
  // v0.3 实装规矩：
  //   - ID：`weekday` id = `cr-weekday-{templateKey}`（一个模板一条 rule）· `single-date` id = `cr-single-{date}`（一日一条）· `date-range` / `cycle` 用 ULID
  //   - Priority：single-date 100 · date-range 50 · cycle 30 · weekday 10（全 miss → 内置启发 fallback）
  //   - Resolver 按 priority desc 遍历，第一条匹配即返回
  //   - 事件：`calendar-rule.upserted`（payload = 完整 CalendarRule）/ `calendar-rule.removed`（payload = { id }）
  //   - 首次启动 seed：workday 覆盖周一-五 / restday 覆盖周末（仅当模板已存在 + 无 weekday 规则时播种）—— 行为与 v0.2 硬编码启发等价，无 breaking change
  //   - Calendar drawer 从 v0.3.1 起支持 in-place edit：date-range / cycle 的 upsert action 带 optional `id`，传就是更新（保留 `createdAt`）、不传就是新建（ULID id）；weekday 本来就 upsert-by-templateKey；single-date 在 drawer 里只有删除入口，编辑通过 Calendar / CycleDay popover 重新覆盖即可
};

type RailInstance = {
  id: string;
  railId: string;
  date: string; // YYYY-MM-DD
  plannedStart: string;
  plannedEnd: string;
  actualStart?: string;
  actualEnd?: string;
  status: 'pending' | 'done' | 'deferred' | 'archived';
  //                 pending   —— 初始态；未来 / current / 过期未标记都是它。
  //                 done      —— 完成（终态）。
  //                 deferred  —— "以后再说" · 半终态，落入 §5.7 Pending 队列。
  //                              在 Cycle View 拖到某天会回到 pending（plannedStart/End 重置）。
  //                 archived  —— "归档" · 终态，不再排期。循环 Rail 的次日模板生成不受影响。
  // （注：v0.2 early 阶段的 'active' / 'skipped' 已弃用；"正在进行"由墙钟派生。）
  overrides?: Partial<Pick<Rail, 'name' | 'color' | 'icon' | 'durationMinutes'>>;
  sessionId?: string; // 内部字段：当前处于某个编辑会话（§5.3.1）期间产生的 mutation 共享该 id，用于原子撤销。
                      // 不限于 Cycle View —— Template Editor 等任何深度编辑视图同样使用；
                      // 会话结束 / 离开视图 / 空闲超时后，新产生的 mutation 不再带 sessionId。
};

type Shift = {
  id: string;
  taskId: string;                              // v0.4: anchored to Task（之前是 railInstanceId）。
  type: 'defer' | 'archive' | 'reschedule' | 'unschedule';
  //        defer       —— 伴随 status = deferred 的那次动作（§5.2 / §5.6）。
  //        archive     —— 伴随 status = archived 的那次动作。
  //        reschedule  —— v0.4.1 新增。用户把**已过期**的 Task 拖 / 改期到
  //                       **另一天**时自动生成。见 §5.5.6。
  //                       仅当 (原 slot.date || 原 adhoc.date) < 今天 且 nextDate != priorDate 时触发。
  //                       当天内拖拽 / 未来 task 改期 / 首次排期 → 不触发。
  //                       auto-habit task 暂不在触发范围内。
  //        unschedule  —— v0.4.2 新增。用户对**已过期**的 Task 点 Schedule popover 的
  //                       「取消排期」时自动生成。见 §5.5.6。
  //                       仅当 (原 slot.date || 原 adhoc.date) < 今天 时触发。
  //                       未来 task 取消排期 / auto-habit / deleteTask → 不触发。
  // （v0.2 early 的 'postpone' / 'swap' / 'skip' / 'resize' / 'replace' / 'note' 已弃用；
  //  "时内推移" 依旧交给 Cycle View 拖拽，不产生 Shift。）
  at: string;
  payload: Record<string, unknown>;
  // reschedule 的 payload 形如（ReschedulePayload）：
  //   { fromDate, fromRailId?, fromAdhocId?, toDate, toRailId?, toAdhocId? }
  // unschedule 的 payload 形如（UnschedulePayload）：
  //   { fromDate, fromRailId?, fromAdhocId? }   // 没有 to* 字段
  // Review 用 fromRailId + fromDate 把旧 heatmap cell 从 `unmarked` 升级为 `shifted`（§5.5.6）；
  // 两种类型共享同一个升级路径。
  tags?: string[]; // 全局共享标签，由 §5.2 Reason toast 的快速原因 chip 写入；
                   // chip 内容取自该 Rail 的历史 tag 频次 top 3，冷启动回落到静态集。
                   // reschedule / unschedule 的 shift 先以空 tags 持久化；tag pick 后通过
                   // `shift.tags_updated` 事件追加（追加式并集合并）。
  reason?: string; // v0.2 不采集 —— Reason toast 只给 tag，reason 留到 v0.3 Pending 详情页再加。
};

type Signal = {
  // 用户在 check-in 条或 Pending 队列上对某条 RailInstance 做出的显式响应（§5.6 / §5.7）。
  // 没有"触发但未响应"这种事件 —— 因为没有 OS 推送，Signal 在用户看到条目前不存在。
  id: string;
  railInstanceId: string;
  actedAt: string;
  response: 'done' | 'defer' | 'archive';
  surface: 'check-in-strip' | 'pending-queue';
};

type PhaseTransition = {
  id: string;
  lineId: string;
  fromPhaseId: string | null; // 进入第一个 Phase 时为 null
  toPhaseId: string;
  at: string;                 // 过渡触发的时间
  reason: 'days' | 'completions' | 'manual';
};

type Line = {
  id: string;
  name: string;
  color?: string;             // Radix scale token（与 Rail 共用调色盘）
  kind: 'project' | 'habit' | 'group';
  createdAt: number;          // epoch ms
  archivedAt?: number;
  deletedAt?: number;         // 软删除时间戳
  status: 'active' | 'archived' | 'deleted';
  isDefault?: boolean;        // true 的 Line 不能被删 / 改色 / 重命名（保留给 Inbox: id='line-inbox'）
  plannedStart?: string;      // YYYY-MM-DD，Project / Habit 的软时间窗
  plannedEnd?: string;        // YYYY-MM-DD；无此字段的开放式 Line 不算风险
  note?: string;              // 可选长文。按 Markdown 渲染（见 §5.5.4）——
                              //   Project 详情页 = "描述"，Habit 详情页 = "备注"。
                              //   纯文本也是合法 Markdown；不强制语法。搜索按原始源码子串匹配。
  // kind='habit' 的 Line 可选关联多个 HabitPhase（独立实体，见下）——
  // 关联数 ≥ 1 表示该 habit 启用了 phase 追踪；= 0 表示简单 habit。
  // kind='group' 的 Line 是纯标签分组，没有 task / habit 语义。
};

type AdhocEvent = {
  id: string;
  date: string;
  startMinutes: number;
  durationMinutes: number;
  name: string;
  color?: string;     // 可选：外框色（Radix scale token）。未指定时继承 lineId 对应 Line.color；都没有时用中性灰 slate。
                      // 视觉规则恒定：1.5px 虚线外框 + slate step 2–3 极浅填色；外框色可变，填色不变（见 §5.2）。
  lineId?: string;    // 可选归属：决定右上 ADHOC chip 旁是否显示 Line 名，以及默认外框色。
  taskId?: string;    // §5.5.2 "自由时间"排期模式：task 用该字段回指本 Ad-hoc。取消排期时软删本行。
  status: 'active' | 'deleted';   // 软删除
  deletedAt?: string;
};

// HabitPhase（v0.3.3 起）：habit-kind Line 的阶段性时间段标签。
// 纯手动创建；没有枚举预设、没有自动升降、没有 streak / 完成率派生。
// "当前 phase" = 关联到该 Line 的 phase 里 startDate <= today 的那条
// 里 startDate 最大者。没有 endDate —— 下一 phase 的 startDate 就是
// 上一 phase 的隐式结束。

// DailyReflection（v0.4.3+）：每天一条手写 Markdown，详见 §4.1。
// 主键 = date，自然天 = `Track.tz` 当日。空 content 视同未写
// （事件流上是 reflection.cleared，物化层不存这一行）。
// 事件：
//   reflection.upserted  payload = { date: 'YYYY-MM-DD', content: string }
//   reflection.cleared   payload = { date: 'YYYY-MM-DD' }
//   两类事件 aggregateId = date。HLC 决定后写者胜，与其它实体一致。
type DailyReflection = {
  date: string;       // YYYY-MM-DD，主键
  content: string;    // 用户原文，按 Markdown 渲染；不做 sanitize 之外的转换
  updatedAt: number;  // 末次写入的事件 wall-clock（epoch ms）
  // v0.8.2 起：单字段 LWW 缓存最近一次 Day 复盘 AI 输出（§6.6.2）。
  // 再点一次直接覆盖；不留历史 array。挂在 reflection 实体上保证 reflection
  // 删了 AI observation 跟着没（reflection 是「该日的 user 自由文本」实体，
  // AI observation 只是它的派生解读）。用户想留请「复制 markdown 贴回 content」显式动作。
  lastAiObservation?: {
    generatedAt: number;        // 调用完成的 wall-clock（epoch ms）
    model: string;              // 调用时选的 model name（事后看来源用）
    json: object;               // §6.6.2 通用 JSON schema 输出：{ observation, patterns, suggestions }
  };
};

type HabitPhase = {
  id: string;        // ULID
  lineId: string;    // 所属 habit-kind Line
  name: string;      // 用户自由填："热身期" / "基础期" / "冲刺期"...
  description?: string;  // 可选更详细的目标描述（单行纯文本，不做 Markdown 渲染；见 §5.5.4）
  startDate: string; // YYYY-MM-DD
  createdAt: number;
};

type Task = {
  id: string;
  lineId: string;              // 所属 Line；没挑 Project 的 task 落 'line-inbox'（随手记）
  title: string;
  note?: string;               // Markdown 备注（见 §5.5.4）。搜索对原始源码子串匹配。
  // v0.11+: 当 Task 关联了 TaskOccurrence 时，下面三个"调度 / 进度"字段进入
  // legacy 兼容模式：milestonePercent 退化为 occurrences=空 时的整 Task 里程
  // 碑标签；slot / slotOrder 被忽略（occurrences 是排程真源，详见 §10.6）。
  // 老 Task（occurrences=空）行为与 v0.10 完全一致。
  milestonePercent?: number;   // 0–100，带百分比即里程碑；缺省为"附加事项"
  priority?: 'P0' | 'P1' | 'P2'; // 可选的轻量提示（§5.5）。不驱动调度 / check-in / 通知 —— 仅作为清单视图的 排序 / 分组 / 筛选 维度。
  // v0.11+: subItems 在 v0.11 升级时一次性迁移成 TaskOccurrence（label = title，
  // done = done，无 slot / percent）。字段保留可读 + 老版本仍可写；新版本读取
  // 时把 subItems 与 occurrences 合并显示（subItems 项作为虚拟 occurrence，
  // 不写回 occurrence store）。详见 §10.6 跨版本段。
  subItems: SubItem[];         // legacy checklist · v0.11 起新写入路径走 TaskOccurrence
  status:
    | 'pending'
    | 'in_progress'
    | 'done'
    | 'archived'      // §5.5.3 归档 —— 用户手动放一边，可恢复
    | 'deleted';      // §5.5.3 软删除 —— 默认列表隐藏，回收站可见
  // v0.11+: 当 Task 关联了 TaskOccurrence 时，status 完全派生（§10.1 / §10.6）：
  // 全 done = done · 有 done 有 pending = in-progress · 全 pending = pending ·
  // 全 archived = archived。occurrences=空 时 status 仍是显式字段。
  doneAt?: string;
  archivedAt?: string;
  deletedAt?: string;
  order: number;               // Line 内排序（拖拽可调）
  targetRailIds?: string[];    // 可选：限定仅可排入这些 Rail 的 Slot（v0.3+）
  railOverrides?: Partial<Rail>;
  // §5.5.2 排期：两种模式二选一
  //   模式 A 绑 Rail ─▶ slot = { cycleId, date, railId }
  //   模式 B 自由时间 ─▶ slot = 空，改为 AdhocEvent.taskId 回指
  //   未排 ─▶ slot = 空 且 没有 AdhocEvent 回指
  // v0.11+: 当 Task 关联了 TaskOccurrence 时，slot 字段被忽略（occurrences 承担
  // 排程）。从 0 occurrence 加第一条 occurrence 时，已存在的 Task.slot 在同一
  // transaction 里 silently 转成第一条无 label / 无 percent 的 occurrence。详见 §10.6。
  slot?: { cycleId: string; date: string; railId: string };
  // v0.4.4 · slot 内用户拖拽排序。某 slot 中任一 task 带 slotOrder 时，
  // 整 slot 按 slotOrder asc 排（未填 = +∞ 落底）；全部未填则用 §5.3
  // 描述的派生排序（state → priority → 插入序）。新建 task 不预填 →
  // 老数据零迁移。
  // v0.11+: occurrences 非空时改在 occurrence 上排 order（见 TaskOccurrence.order）。
  slotOrder?: number;
};

type SubItem = {
  id: string;
  title: string;
  done: boolean;
};

// v0.11+: 排程原子。一个 Task 下挂 0..N 条 TaskOccurrence；occurrences 非空时
// Task 的"调度 / 进度 / 完成态"语义全部下沉到这里。详细动机 + 派生规则 +
// 跨版本数据形态见 §10.6。存储形态：顶层 `Y.Map<id, TaskOccurrence>` 新 store
// （与 `tasks` 同级），per-element CRDT 自动并。
type TaskOccurrence = {
  id: string;                  // ULID 或 ('occ-' + taskId + '-' + subItemId) 派生（迁移幂等）
  taskId: string;              // 所属 Task；Task 删除时新版本启动 GC 清孤儿
  // 与 Task.slot 同形态。空 = 未排（Task 详情的 checklist 区块里能看到）。
  slot?: { cycleId: string; date: string; railId: string };
  label?: string;              // 离散步骤模式："拟提纲" / "正文" / "校对" 等；
                               // 渲染时 fallback：occurrence.label ?? task.title
  percent?: number;            // 0–100 · 主 Task 的**里程碑标记位**——完成这条 occurrence
                               // 时主 Task 推进到 N% 这个 milestone。与现有 Task.milestonePercent
                               // 同语义、同聚合规则（取 max(done occurrence 的 percent)）。
  status: 'pending' | 'done' | 'archived';
                               // 'deleted' 走宿主 Task 的删除路径（occurrence 自身不软删）
  order?: number;              // 离散步骤模式下的相对次序（Task 详情 / Pending 内排序）；
                               // percent 模式下不重要。新建不预填，老 subItems 迁移时取 array index。
  doneAt?: string;             // ISO 时间戳
  archivedAt?: string;
  note?: string;               // v0.12.2+ · 该切分自己的 Markdown 备注（按 §5.5.4 渲染，与 Task.note
                               // 同款 MarkdownField）。与 Task.note **完全独立**：occurrence pill / 行
                               // 只看这条、不回退到 task.note（见 §10.6 v0.12.2 节）。
};

// ============= 设置 =============
// 不再有账号实体。设置分为本机专属（永不同步）
// 与可同步设置（与用户数据共享同一份加密事件日志）。

type DeviceSettings = {
  deviceId: string;                // 每次安装稳定
  syncBackend?: 'google-drive' | 'icloud' | 'webdav' | null;
  syncCredentials?: unknown;        // OAuth token / WebDAV 凭证 —— 仅本机
  passphraseCached?: boolean;       // 实际短语永不存储
  uiLocale?: string;                // 可按设备覆盖
  updatedAt: string;
};

type SyncedSettings = {
  theme?: string;
  openrouterKeyCiphertext?: string;
  fallbackChain?: Array<{ model: string; paid: boolean }>; // 有序：自上而下尝试
  encryptionEnabled: boolean;       // 默认 true
  aiOutputLocale?: string;          // 与 UI locale 解耦
  notificationPrefs?: Record<string, unknown>;
  signalDefaults?: Record<string, unknown>;
  updatedAt: string;
};
```

### 10.5 Effective-from revision 模型（v0.5 起）

#### 动机

v0.4 之前，Rail / Template / CalendarRule / HabitBinding 都是**当前态实体**。
用户在 Template Editor 里改一条 rail 的时段、颜色、归属模板，或在日历规则
抽屉里调一条循环规则，会立即覆盖单一一份字段值。任何读路径在求解
"日期 D 的 day-shape"时拿到的都是当下的字段值 —— 后果是已经过去的日期
在历史 Cycle View 中会**跟随当前配置回溯重绘**。

beta 的实测反馈是这条行为违反直觉：用户调整 rail 是为了"以后这样过"，不是
"以前其实是这样过的"。已经物化的 `Task` 因为带着冻结的 `slot` 字段不会被
改写（参见 §10.3 / `purgeFutureAutoTasks`），但其周围的画面（rail 行的颜色 /
时段 / 名字 / 是否存在；day chip 的 Workday/Restday 类型）仍随当前态漂移。

§10.5 引入 **effective-from revision 模型**：把以上四类实体拆成"身份壳 +
一串带生效起始日的 revision"，所有读路径按目标日期求解 active revision。
"过去 = 冻结"由数据层保证，不依赖任何 UI 兜底。

#### 适用范围

| 实体 | 身份字段 | 移到 revision 的字段 |
|---|---|---|
| `Rail` | `id` / `createdAt` / `tombstone?` | `name` / `startMinutes` / `durationMinutes` / `color` / `icon` / `showInCheckin` / `templateKey` |
| `Template` | `key` / `isDefault` / `createdAt` / `tombstone?` | `name` / `color` |
| `CalendarRule` | `id` / `kind` / `createdAt` / `tombstone?` | `value`（typed per kind）/ `priority` |
| `HabitBinding` | `id` / `createdAt` / `tombstone?` | `habitId` / `railId` / `weekdays` |

**不进入版本化**（已具备别的冻结手段或语义上不需要）：
- `Slot` —— 复合键含 `date`，本身就按日期分桶
- `RailInstance` —— 同上，按 `date` + `railId` 分桶
- `Task` —— `slot` 字段冻结排期决策；其余字段（title / status / note）属于工作单元
  的可变内容，按 §10.1 走单一真源
- `Line`（Project / Habit / Tag）—— 重命名 / 改色 默认即时生效。需要"按日 line label"
  的回溯展示先列入 §11.2 待评，不在 §10.5 范围
- `HabitPhase` —— 已是按 `startDate` 锚定的"自版本化"实体
- `AdhocEvent` —— 一次性，按 `date` 已自冻结

#### Revision 类型定义

```ts
type EffectiveDate = string; // 'YYYY-MM-DD'，按当地日切；不带时区。
                             //  Sentinel `'1970-01-01'` 表示"自远古生效"，迁移时使用。

type RailRevision = {
  id: string;            // ULID
  railId: string;        // 指向身份壳 Rail.id
  effectiveFrom: EffectiveDate;
  // mutable fields（与 v0.4 Rail 的可变字段一一对应）
  name: string;
  startMinutes: number;
  durationMinutes: number;
  color: string;
  icon?: string;
  showInCheckin: boolean;
  templateKey: TemplateKey;
  // 簿记
  authoredAt: number;    // epoch ms，写入时刻
  sessionId?: string;    // 编辑会话归属（§5.3.1）
};

type TemplateRevision = {
  id: string;
  templateKey: TemplateKey;
  effectiveFrom: EffectiveDate;
  name: string;
  color?: string;
  authoredAt: number;
  sessionId?: string;
};

type CalendarRuleRevision = {
  id: string;
  ruleId: string;        // 指向身份壳 CalendarRule.id
  effectiveFrom: EffectiveDate;
  // typed per kind —— 与 §10.4 CalendarRuleFlatV04.value 同形
  value: unknown;
  priority: number;      // 多数情况下同 kind 内固定（single-date 100 / date-range 50 /
                         //  cycle 30 / weekday 10），revision 仍带这个字段以兼容未来
                         //  按日期改优先级的需求。
  authoredAt: number;
  sessionId?: string;
};

type HabitBindingRevision = {
  id: string;
  bindingId: string;     // 指向身份壳 HabitBinding.id
  effectiveFrom: EffectiveDate;
  habitId: string;       // 指向 Line.id（kind='habit'）
  railId: string;        // 指向 Rail.id
  weekdays?: number[];   // 0=日 ... 6=六；undefined = 不窄化
  authoredAt: number;
  sessionId?: string;
};
```

每类 revision 在 store 里是一份 `Record<entityId, Revision[]>`（按
`effectiveFrom asc` 维持有序），或者一份扁平表 + entityId 索引；
具体实现细节交给 store 层。

#### 读语义：`atDate`

```ts
function railAtDate(state, railId, date): RailRevision | undefined {
  const rail = state.rails[railId];
  if (!rail) return undefined;
  if (rail.tombstone && date >= rail.tombstone.effectiveFrom) return undefined;
  const revs = state.railRevisions[railId] ?? [];
  // 找最大的 r.effectiveFrom <= date
  let pick;
  for (const r of revs) {
    if (r.effectiveFrom <= date) pick = r;
    else break;
  }
  return pick;
}
```

四类实体共享同一形 selector：`templateAtDate(key, date)` /
`calendarRuleRevisionsActiveOn(date)` / `habitBindingsActiveOn(date)`。
`activeOn(date)` 返回当日所有处于"已生效且未 tombstone"状态的实体的最新 revision。

**对 caller 的统一约定**：

- 任何"按日期渲染"的组件读 `atDate(date)`；返回 `undefined` 当作"该实体当日不存在"。
- "今天 / 未来"的 caller 一律传 `today` 或目标日期，绝不直接读身份壳上的字段。
- "rail 当前态"这种全局概念不再存在。最接近的是
  `railAtDate(today)` —— 表达的是"今天这条 rail 的样子"。

#### 写语义：`upsertRevision`

每次用户编辑都走"封档旧 rev + 开新 rev"路径：

1. **默认 `effectiveFrom = today`**（local-day）—— 用户编辑后立即生效给
   今天和未来；过去日期读不到这条新 revision，因此渲染不变。
2. 若已有同 `(entityId, effectiveFrom)` 的 revision，**原地替换**（不新增一行）。
   这覆盖"用户在 Edit Session 里来回拖时段"的高频场景，避免 revision 数量爆炸。
3. 否则**追加**新 revision，旧 revision 不动 —— 它仍承担
   `[oldFrom, newFrom)` 的历史读路径。
4. 写入事件：`rail-revision.upserted` / `template-revision.upserted` /
   `calendar-rule-revision.upserted` / `habit-binding-revision.upserted`，
   payload = 完整新 revision。

**`effectiveFrom` 的可选项（UI 层）**：

- 默认：今天起
- 备选：明天起 / 自定义未来日期
- 高级（power-user，默认隐藏）："修改最近一条 revision"路径 —— 直接编辑
  当前已激活的那条 revision（同 id 替换），等价于"我就是想改过去也一起改"。
  Template Editor / 日历抽屉里以折叠的 inline 选项呈现，不进默认按钮。

#### 删除语义：tombstone

身份壳上的 `tombstone: { effectiveFrom, at, sessionId? }` 表示"自该日起该实体不再存在"。
- 过去日期 (`date < tombstone.effectiveFrom`) 仍按 `atDate` 找到末次 revision，正常渲染。
- 当日及未来 (`date >= tombstone.effectiveFrom`) `atDate` 返回 `undefined`，
  render 视为"不存在"。
- 撤销 = 清掉 `tombstone`。
- 内置模板 (`isDefault: true`) 不允许 tombstone（沿用 §5.4 既有约束）。

#### 新建语义

新建 = 写身份壳 + 第一条 revision（`effectiveFrom = today` 或用户选定起始日）。
过去日期上 `atDate` 自然返回 `undefined` —— 实体在过去**不存在**，过去 Cycle View
不会出现一条空 rail 行。

#### 物化算法（更新 §10.2）

```
materialize(startDate, endDate):
  for date in [startDate .. endDate]:
    templateKeyForDate = resolveActiveTemplate(date)
      // 内部走 calendarRuleRevisionsActiveOn(date) → priority desc → 第一匹配

    for binding in habitBindingsActiveOn(date):
      bRev = bindingAtDate(binding.id, date)
      rRev = railAtDate(bRev.railId, date)
      habit = lines[bRev.habitId]
      if !habit or habit.status != 'active' or !rRev: continue
      if rRev.templateKey != templateKeyForDate: continue
      if bRev.weekdays && !bRev.weekdays.includes(dayOfWeek(date)): continue
      if date < dateOf(binding.createdAt): continue

      upsert Task {
        id: `task-auto-${habit.id}-${date}`,
        lineId: habit.id,
        title: habit.name,
        slot: { cycleId: cycleIdOf(date), date, railId: bRev.railId },
        status: 'pending',
        source: 'auto-habit',
      }
    mark (habit.id, cycleId) as materialized for cycles fully inside [startDate, endDate]
```

要点：
- `templateKeyForDate` / `rRev.templateKey` 都是按日期求出来的；过去日期自然走旧 revision。
- 已物化标记 `(habitId, cycleId)` 仍由身份级 `habitId` 索引，跨 binding revision 共享。
- `binding.createdAt` 仍是身份壳上的时间戳，用于"不回填 binding 创建前的历史日期"
  这条不变式（即使 binding 后来切换过 `railId` 也不破坏）。

#### §10.3 在 v0.5 下的扩展

§10.3 的 purge 规则在 revision 模型下保持形状不变，但触发面拓宽：

| 触发改动 | 等价 revision 操作 | purge 范围 |
|---|---|---|
| 改 rail 时段 / 模板 / 颜色 | `rail-revision.upserted` (effectiveFrom = D) | 该 rail 上 `plannedStart >= D 且 status='pending'` 的 auto-task |
| 删除 rail | `rail.tombstone` (effectiveFrom = D) | 该 rail 上 `date >= D` 的所有 future pending auto-task **和** 手工 task 的 `slot` 解绑 |
| 改 / 删 calendar rule | `calendar-rule-revision.upserted` 或 `tombstone` | 受影响日期窗口内 templateKey 切换导致命中状态变化的 auto-task |
| 改 habit binding（railId / weekdays） | `habit-binding-revision.upserted` | 该 binding 上不再命中的未来日期 purge；新命中的日期补齐 |

**关键差异**：purge 下界从 v0.4 的 `now()` 改为 `max(now, effectiveFrom)`。
若用户选了"明天起" / "下周一起"，今天剩下的 auto-task 也不会被惊动 ——
今天读旧 revision，仍命中旧配置。

**手工 task 的解绑**（v0.5 新增）：删除 rail（tombstone）后，所有
`slot.railId === railId 且 slot.date >= effectiveFrom` 的手工 task 把 `slot` 清空，
转为"未排期"。task 内容（title / note / subItems）保留。事件：`task.unscheduled`，
带相同 sessionId。Reschedule shift（§5.5.6）按一次"已过期前的取消排期"判断 ——
仅当 `slot.date < today` 时不触发（因为该 slot.date 必 >= effectiveFrom >= today，
不会落入"已过期解绑"）。

#### 事件日志

新增一组事件类型（兼容 §7 同步）：

- `rail-revision.upserted` / `rail-revision.removed`
- `template-revision.upserted` / `template-revision.removed`
- `calendar-rule-revision.upserted` / `calendar-rule-revision.removed`
- `habit-binding-revision.upserted` / `habit-binding-revision.removed`
- `rail.tombstoned` / `rail.tombstone-cleared`
- `template.tombstoned` / `template.tombstone-cleared`
- `calendar-rule.tombstoned` / `calendar-rule.tombstone-cleared`
- `habit-binding.tombstoned` / `habit-binding.tombstone-cleared`

旧的 `rail.updated` / `calendar-rule.upserted` / `calendar-rule.removed` /
`habit-binding.upserted` / `habit-binding.removed` 等事件**仍允许在事件日志里
出现**，对应迁移期 / 旧设备同步进来的数据。读端按下方迁移规则 normalize 成
身份壳 + 单 revision。

#### 数据迁移（首次启动 v0.5）

按 beta 兼容政策（不做破坏性迁移、不静默改写语义）执行 idempotent 迁移：

1. 对每个 `Rail`（v0.4 形态）：
   - 创建身份壳 `Rail` 保留 `id`，`createdAt = now() if missing`。
   - 创建一条 `RailRevision`：
     - `effectiveFrom = '1970-01-01'`（sentinel "自远古"，保证所有历史日期都能命中）
     - 全部可变字段从旧 Rail 复制
     - `authoredAt = createdAt ?? now()`
     - `sessionId = undefined`
2. 同样规则迁移 `Template` / `CalendarRule` / `HabitBinding`。
3. 触发一条 `migration.v05-revision-model` 事件供同步端识别。

迁移结果：所有过去日期上的渲染输出与 v0.4 完全一致（因为 `'1970-01-01' <= 任何 date`，
所有 `atDate` 都命中那唯一一条 revision）。后续编辑才开始产生新的 revision。

跨设备：第一台设备执行迁移并把新事件推到同步通道；尚未升级到 v0.5 的设备
会忽略未知事件类型（同步层既有规则），不会丢数据；升级后再 replay。

#### Cycle View / Calendar / Tasks 渲染影响

- **Cycle View**：列头 templateKey + day chip 颜色、rail 行的名字 / 颜色 /
  时段 / 是否出现 —— 全部按 `atDate(date)` 求解。同一窗口 7 天里可能出现
  "前三天某 rail 不存在 / 后四天该 rail 已新增"的混合形态，渲染层需要把"该日不存在"
  的 rail 行收掉而不是渲染空行。
- **Calendar 月视图**：日期格底色 = `templateAtDate(resolveActiveTemplate(date), date).color`，
  同一月内可能出现配色断点（用户在月中改了模板色），符合预期。
- **Tasks 视图**：task 行右侧 `📅 周三 · 工作 · 编码` 的"工作 / 编码"两段标签由
  `railAtDate(slot.railId, slot.date)` + `templateAtDate(railRev.templateKey, slot.date)`
  解出 —— 即任意 task 行展示的 rail / template 标签是它**当时**的样子，不会因为
  rail 后来改名而错位。
- **Now View / Today Track**：永远读 `today` 的 revision，行为与 v0.4 一致。
- **Review 热力图**：cell 上的 rail 标签 / 颜色按 cell 日期解，与 task 行一致。

#### 与 §5.3.1 Edit Session 的关系

Template Editor / 日历规则抽屉的一次集中编辑共享同一个 sessionId；产生的
若干 revision upsert + 由此触发的 §10.3 purge / topup 全部带上同一个 id。
"撤销本次编辑"的实现：

- revision upsert（追加型） → 删除该 revision
- revision upsert（同 effectiveFrom 替换型） → 还原前一份内容（事件 payload 自带 prev snapshot）
- tombstone → 清掉
- task purge / topup → 走 §10.3 既有反向流程

撤销是一次性的、原子的；不允许"撤销一半"。

#### 开放问题（落到 §11.1）

- `Line`（Project / Habit）的重命名 / 改色是否需要 revision？当前不做 ——
  Project 名称变更直观属于"这件事换了称呼"，过去仍叫旧名是反直觉的。但需要
  实测一段时间后再确认是否要扩展到 §10.5 范围。
- `effectiveFrom` 的 UI 默认值：v0.5.0 先按"今天起"硬编码，下沉到 settings 下一版再考虑暴露。
- 高频编辑场景（用户在 Edit Session 里来回调 30 次时段）的 revision 表大小：
  同 effectiveFrom 替换策略已减压；如果实测仍臃肿，可以引入 "session 收尾合并"
  把同一 session 的相邻 revision 合并成一条。

```

### 10.6 Task occurrences（v0.11 起 · 排程原子的拆分）

#### 动机

v0.10 之前，`Task` 同时承担三件事：**身份单元**（"写第二章"）、**完成态真源**（§10.1）、**调度原子**（slot 上的最小放置单位）。当一件事天然要分多次坐下来做时，三件事被绑在一起膨胀——用户唯一的出路是建 N 个兄弟 Task，导致 Project 列表噪声、"这件事"被切碎、§10.1 的 milestone 取 max 进度聚合（`Tasks.tsx:978-980`）失真。

v0.11 把"调度原子"从 `Task` 上剥离成独立实体 `TaskOccurrence`：一个 Task 下挂 0..N 条 occurrence，每条独立排进 slot、独立完成、独立 reschedule。Task 仍然是身份单元，状态变成派生（§10.1 例外段）。

#### 实体定义

完整 schema 在 §10.4 `TaskOccurrence`。关键字段：`taskId`（外键）/ `slot?`（与 Task.slot 同形）/ `label?`（步骤名）/ `percent?`（主 Task 的里程碑标记）/ `status` / `order?` / `note?`（该切分自己的 Markdown 备注 · v0.12.2 起 · 见本节末「v0.12.2」节）。

#### 两种使用形态（彼此不互斥，可混搭）

| 形态 | 字段填法 | 用户故事示例 |
|---|---|---|
| **量化里程碑** | `percent` | "做完它推进主 Task 到 50%" |
| **离散步骤** | `label` + `order` | "拟提纲 / 正文 / 校对，按序做" |
| **混搭** | `label` + `percent` | "做完 PPT 这一步达到 70% 里程碑" |
| **占位** | 都不填 | "今天就推一下这件事，没具体目标" |

`percent` 字段语义**严格对齐现有 `Task.milestonePercent`**：是**主 Task 的里程碑位置**（不是 occurrence 自身的进度条、也不是分摊权重）。完成这条 occurrence ⇒ 主 Task 推进到 N% 这个 milestone。多条 occurrence 用同一个 percent 合法（"两条路径都走到 50%"）；不强制单调；用户写了 50% 与 100% 两条而不写中间档完全 ok。

主 Task 的 user-visible 进度 = `max(occurrence.percent for done occurrences, 0)`，与 `Tasks.tsx` 现有 max-milestone 算法同形。

#### 主 Task 状态派生（§10.1 修订）

`Task.status` 在 `occurrences` 为空时仍然是显式字段（v0.10 行为不变）。**`occurrences` 非空时完全派生**：

| Occurrences 状态聚合 | 派生 Task.status | 派生 doneAt |
|---|---|---|
| 全 `done` | `done` | `max(occurrence.doneAt)` |
| 有 `done` 有 `pending` | `in-progress` | undefined |
| 全 `pending` | `pending` | undefined |
| 全 `archived` | `archived` | undefined |

**percent 与 status 完全解耦**。`percent` 只是"完成这条 occurrence 时主 Task 推进到 N%"的**标记位**——填了 100 ≠ 自动完成；done = `status === 'done'`，仅此一条由用户显式勾选触发。"我把 100% 那一段留到最后做"是合法的、长期的 pending 状态。

`archived` / `deleted` 状态的 occurrence 不参与 rollup。

**用户决定"这件事我不做了"** → 在 Task 详情 archive 整个 Task → 级联把所有 pending occurrence 也置 `archived`（不是 `done`，保留"我没做"事实）。**不**提供"绕开 occurrence 强制把 Task 标 done"的入口——这种状态不一致只会在 Pending / Review 制造长尾 bug。

#### 与 `Task.slot` 单数字段的关系

`Task.slot` 字段保留作为 occurrences 为空时的简易路径；**occurrences 非空时被忽略**。

边界规则（"先有 slot 再加 occurrence"）：用户先排了 `Task.slot = X`，再加第一条 occurrence 时 —— 写入第一条 occurrence 的同一 transaction 里把 `Task.slot` 转成一条**无 label / 无 percent** 的 occurrence + 清空 `Task.slot` 字段。意图保留 100%、零数据丢失、无确认对话（这就是显然对的事）。

反向（occurrence 全删回到 0 条）→ `Task.slot` 维持空值，用户需要手动重新排期。**不做**反向自动转换（避免"删 occurrence 时 slot 神奇出现"的惊讶）。

#### 与 `subItems` 的关系（v0.11 升级时一次性收编）

`Task.subItems` 字段在 v0.11 升级时一次性映射到 occurrences：

```text
Task.subItems[i] → TaskOccurrence{
  id:     'occ-' + task.id + '-' + subItem.id,   // 派生 id 保证迁移幂等
  taskId: task.id,
  label:  subItem.title,
  status: subItem.done ? 'done' : 'pending',
  order:  i,
  // slot / percent / doneAt 都不填
}
```

迁移完毕后 `Task.subItems` schema 中保留可读（用于跨版本兼容），但**新版本写入路径全部走 TaskOccurrence**，不再写 `Task.subItems`。Task 详情抽屉的"子任务"区块改成"渲染所有 occurrences"——未排程的 occurrence 视觉上仍然是一列 checklist，体感零差异；多出的能力是右侧拖拽 handle（拖到 Cycle 的某个 slot 即排期）。

迁移幂等：`occ-{taskId}-{subItemId}` id 派生方案保证重跑不重复建。

#### 物化 / 查询路径

- **Slot 渲染** —— `Slot.taskIds` 不动；slot 的 occurrence 列表通过查询 `taskOccurrences` 中 `slot.cycleId / date / railId` 全等 + `taskOccurrences[].taskId ∈ slot.taskIds` 拿到。Today Track / Cycle View 渲染时 label fallback 链：`occurrence.label ?? task.title`，percent 作为后缀徽标（沿用 `RailCard.tsx` 现有视觉）。
- **Pending 队列**（§5.7）—— 行级单位从 Task 改为 occurrence；多日工作首次出现"Mon 那块 overdue · Tue/Wed 还没到"这种细粒度 surface。
- **Task 详情** —— 列出该 Task 所有 occurrence + 排序（先未排在前按 `order`；其次已排按 `slot.date`）。每条可加 percent / label、改 slot、勾完成。
- **Tasks 视图列表 / 进度** —— Tasks 视图保持以 Task 为聚合单位；Project 进度的 max-milestone 算法输入源从 `tasks[].milestonePercent` 扩到 `tasks[].milestonePercent ?? max(task.occurrences[done].percent)`。
- **Habit auto-task 不动** —— `task-auto-{habitId}-{date}` 物化管线维持原样，不引入 occurrence。理论上未来可以收敛成"一个 Habit-Task + N 条 occurrence"，但本次明确 out of scope。
- **§10.5 revision 不参与** —— occurrences 是调度状态（变了就变了），不属于"过去要冻住"的配置类。

#### CRDT / 同步

- **顶层 `Y.Map<id, TaskOccurrence>` 新 store** —— 与 `tasks` 同级；per-element CRDT 自动并，并发添加 / 修改不冲突。
- **附带成果** —— ROADMAP 停车场原本的「`Task.subItems` 重新拆 per-element Y.Array op」此条被本次设计**绕开**：occurrence 从一开始就是 per-element CRDT，旧 `Task.subItems` 字段在迁移之后不再是新写入路径，原先 atomic LWW 那个坑不复存在。该停车场条目应在本设计 ship 时关掉。
- **`.dryj` 容器版本不升** —— 新 store 是纯加法 schema 演进，与 v0.10.0 dryj 容器同 version 兼容。

#### 跨版本数据形态

不升 `.dryj` 容器版本。新版本与老版本可同时读写同一份 Y.Doc，行为如下：

| 场景 | 老版本表现 | 新版本表现 | 风险 |
|---|---|---|---|
| 新版本写 occurrence | 看不到 occurrence；Task 显示成"无子项" + Task.slot 为空（已被新版本清空） | 正常 | 低（用户体感是"老版本上这个 task 没排期"，**不是**数据破坏） |
| 老版本编辑 Task title / note / priority | 通过 Yjs 字段级合并 | 看到改动 | 无 |
| 老版本删 Task | Task 没了，`taskOccurrences` 中挂 `taskId` 的 occurrence 成孤儿 | 启动时 GC 孤儿 occurrence（filter 掉 `taskId` 不存在的），不写回 doc | 低（GC 自愈） |
| 老版本对一个**已有 occurrences 的 Task** 设 `Task.slot` | 觉得自己排上了 | 新版本读到时 silently 转成一条无 label / 无 percent 的 occurrence —— 等同"老版本就是用单数 slot 表达了一条 occurrence" | 低（语义保留） |
| 老版本编辑 `subItems` | 走老 checklist 路径 | 新版本读取时同时读 `subItems` + `taskOccurrences` 合并显示（subItems 项作为虚拟 occurrence，不写回 occurrence store） | 低（双路读 6 个月迁移期；用户全部升级后可移除 subItems 兼容读） |

**新版本启动时的"GC 孤儿 + 兼容读 subItems"两件事**就是跨版本协议的全部。不需要顶部冲突卡片、不需要 readonly mode、不需要弹"是否转换"对话。

实际数据观察（2026-05-14 跑 `tools/migrate/dump-tasks.ts` 在用户本机三份 backup）：用户 128 个 task 中只有 1 个带 subItems（标题里"（看子任务）"暴露是测试数据），`milestonePercent` 用户数 = 0，所有 edge case（done-but-pending-subItems / archived-with-subItems / 重复 subItem id …）count 全 = 0。"老版本对 occurrence-Task 设 slot" 这种竞争场景在升级之前不可能发生（occurrence 不存在）；升级之后只发生在用户某台机器没升级 + 主动调度同一 task 两次的极少数路径——数据不破坏，用户感知是"老机器上看不到我在新机器上分的子项"，提示用户升级即可。

#### 现有交互 surface 改动一览

- **Today Track**（§5.2）—— RailCard 行内的 Task 行改成展示 `occurrence.label ?? task.title`，percent 改读 occurrence。完成按钮作用于 occurrence。
- **Cycle View**（§5.3）—— Slot 上的 task pill 改 occurrence pill；拖拽对象是 occurrence。Task 详情抽屉的"切分"区块同时管理已排 / 未排 occurrence。
- **Tasks 视图**（§5.5）—— Task 列表沿用 Task 聚合；进度显示读 occurrence 的 max(percent)。Task 详情抽屉的旧"子任务"区块改名"切分"，统一管理 occurrence。
- **Pending 队列**（§5.7）—— 行级单位从 Task 改为 occurrence。
- **Review**（§5.8）—— heatmap cell 的 "shifted" / "completed" 计数源从 task 改为 occurrence；day-level 完成数同步细化。
- **Reschedule 审计**（§5.5.6）—— `Shift.taskId` 字段保留兼容；新增 optional `Shift.occurrenceId`；写路径优先填 occurrence id（occurrences 非空时），fallback 填 task id。

#### 不变量

- Task 的 status 派生**仅受同 Task 下 occurrences 的影响**——不会因为别的 Task 联动变化。
- occurrence 的 doneAt 永远晚于其 slot.date 是**用户行为预期**而非 schema 约束（用户可以"补打"过去日期的 occurrence）。
- occurrence 的 percent 与 status 完全解耦：填了 100 不自动完成，pending 时不计入 Task 进度高水位（`max(occurrence.percent for done occurrences)`）。

#### v0.11.4 修正纪要 · 取消隐性「采用门」

v0.11 实装时在 `isOccurrenceManaged` 里加了一道**本节没有定义的隐性门**：要求 occurrence 数组里至少一个有 `slot` 或 `percent` 才进入 managed 模式，否则 task 继续走 legacy 路径（backlog 显示 parent task、occurrence 退化成不可见 checklist）。

这条门偏离本节明文的「`occurrences` 非空时完全派生」语义，引起两个用户可见的 bug：(1) 在新版本切分 task 之后 backlog 看不到拆分结果 —— 用户视角"拆了个寂寞"；(2) adoption gate 在 UI 上零反馈，用户不知道还需要给 occurrence 设个 percent 或排期才能"激活"派生模式。

v0.11.4 把 `isOccurrenceManaged` 简化为 `occurrences.length > 0`，恢复本节原意。当时引入门的兼容性顾虑（保护 v0.11 hydrate-time 的 `subItems → occurrence` 迁移用户）在实测数据上不成立（实际用户 = 1 + subItems 数 = 1 测试数据），是过度设计。

#### v0.11.5 修正纪要 · OccurrenceSlotPicker 收编 + 切分后 task-level 排期入口禁用

v0.11.4 修了 `RailPicker` 的 narrow + fallback 行为（§5.5.2 B 方案），但 **occurrence 的排期 UI 走的是另一条独立代码路径**，没被覆盖到：

- **OccurrenceSlotPicker**（`apps/web/src/pages/Tasks.tsx` 内）当时为了"简化 v0.11 occurrence 排期"自己写了个原生 `<select>`，列出 `Object.values(railsMap)` —— 所有模板的 Rail 一股脑显示，跟 §5.5.2 narrow + fallback 设计完全不挂钩。
- 切分（occurrence-managed）之后，task 详情抽屉里 task-level 的"排期…"入口**仍然显示**，没有 `isOccurrenceManaged` 守卫。点了会写入 `task.slot`，但本节明确"occurrences 非空时被忽略"——用户操作后看不到任何效果，**静默死路**。store 的 `scheduleTaskToRail` 也不做这个判断，任何其它入口绕过 UI 检查也会触发同样的死路。

v0.11.5 两件并修：

1. **OccurrenceSlotPicker 改用 `RailPicker`**，传入 `pickTemplateForDate(state, date)` 作为 `activeTemplateKey` —— occurrence 排期下拉也享受 narrow + fallback 折叠组，跟 SchedulePopover 行为对齐。
2. **切分后 task-level 排期入口隐藏**：task 详情抽屉 / Tasks 列表行的"排期…"按钮在 `isOccurrenceManaged(occs)` 为真时不渲染，替换成中性提示「已切分 · 请在下方 occurrence 列表逐条排期」。store 层 `scheduleTaskToRail` 加防御守卫：若 task 已有 occurrences 直接 throw（防止后续新增的入口忘加 UI 守卫又重蹈静默死路）。

这两件的共同模式 —— "实装 surface 偏离同一节的 spec" —— 跟 v0.11.4 修的两件同源。本节的核心不变量「occurrences 非空时 Task.slot 被忽略」终于在 UI 层 + 数据层都强制起来。

#### v0.12.2 · 切分备注（per-occurrence note）

**动机**：`Task` 一直有 `note`（§5.5.4 Markdown 备注），但切出来的 occurrence 只有 `label` / `percent` / `slot` / `status`，没法单独记东西。当一件事拆成多步（"组装电脑" → "调查价格 / 下单 / 装机"），每一步往往有它**自己的**上下文（"这家店周三前有券" / "等显卡到货"），塞进父 Task 的整体备注里既不贴切也会互相污染。给 occurrence 加一个跟 Task 同款的备注字段。

**字段**：`TaskOccurrence.note?: string`（§10.4）。Markdown，复用 `Task.note` / `Line.note` 同一个渲染器（§5.5.4 `MarkdownView`）。纯增量可选字段。

**展示语义 —— 只显示切分备注，不回退**：当某个 pill / 行代表一个 occurrence 时，该 surface **只**展示 `occurrence.note`，**绝不回退到 `task.note`**。两层备注彻底独立。

> 这条刻意**不同于** label → title 的回退链（occurrence 没 label 时显示 task.title）。备注不回退的理由：把"整件事的备注"挂到某个具体切分步骤上会制造**误导性上下文**——用户看"调查价格"这一步的备注时，期待看到的是这一步的事，而不是整件"组装电脑"的总说明。没有 occurrence 备注就显示空，是诚实的。

非 occurrence 的旧 Task（`occurrences` 为空）pill 维持显示 `task.note` 不变。

**编辑入口 —— 行内折叠展开**：Task 详情抽屉的「切分」区块（`Tasks.tsx` 的 `OccurrenceRow`），每行加一个备注小图标 —— 有备注时点亮、无备注时弱化。点击在该行**下方就地展开**一个 `MarkdownField`（与 Task 备注同款组件，支持全屏 dialog），默认收起，不挤占本就密集的切分行（勾选框 + label + % + 排期 chip + 删除）。

**展示入口（三处统一）**：occurrence 备注出现在 occurrence 会现身的三处 surface，全部复用 `NoteHoverPopover`（`· 备注` 角标 + hover 卡片），无需新组件 —
- **Today Track**（`TodayTrack.buildTimelineTask`）：occurrence 分支的 `note` 源从 `task.note` 改为 `occurrence.note`。
- **Cycle View**（`cycleFromStore.buildOccurrenceSummary`）：同上。
- **Pending 队列**（§5.7）：occurrence 行展示 `occurrence.note`。

> **关于 Pending 的取舍**（一度想"显式不做"，讨论后纳入）：Pending 是**重新决策** defer / overdue 切分的地方，per-step 备注（"等显卡到货"）恰是此刻决定要不要继续 defer 的关键上下文——论价值不低于 Today/Cycle 的 hover。成本上 Pending 行的数据结构里已带 `row.occurrence`，套同一个 hover 即可，不是新造 UI。原先"不做"的理由（Pending 此前不展示任何备注、单独加会割裂）被这条价值论压过；§7.10 原则 #3 是用来挡冷门冗余分支的，这条不冷门。

**Pending 一并对齐三 surface 的 note 模型**：为避免在 Pending 内部造出"切分行有备注、整任务行没有"的新割裂，Pending 完整对齐 Today/Cycle 的展示规则——occurrence 行显示 `occurrence.note`，**非 occurrence 的整任务行显示 `task.note`**。这等于让 Pending 顺带开始展示 task 备注（此前没有）；数据 `row.task` / `row.occurrence` 均现成，仍是同一个 `NoteHoverPopover`。三处 surface 自此共享同一句话的 note 规则：「occurrence 行 → occurrence.note；整任务行 → task.note；两层互不回退」。

**数据层 / 兼容**：`note` 是 per-element CRDT 的 `TaskOccurrence` 上的纯加法可选字段，`.dryj` 容器版本不升；老版本读到带 note 的 occurrence 直接忽略该字段（不破坏）；写路径 `updateTaskOccurrence` 已走通用 `patchEntityYMap`，零 store 改动即可写入 / 清空。符合 beta「数据层只增不毁」策略。

***

## 11. 开放问题（待讨论）

开放问题分为两类。**现在需要讨论** 影响 MVP 设计 / 数据模型，要在 v0.x 编码前拍板；**后续再考虑** 是有意延后的 —— 等真实使用数据证明其必要性后再重开（遵循原则 #10，MVP 优先）。

### 11.1 需要现在讨论

*（本轮已全部拍板，暂无开放项。后续实现中遇到新问题会重新出现在这里。）*

### 11.2 后续再考虑（延后到 MVP 之后）

1. **AI 费用上限**：设置 → 高级 里的每日 token 预算 + 软警告。等看到真实的费用抱怨再做。
2. **自适应的"让它们都过去吧"阈值**：跟着用户标记频率变化，而不是固定 7 天。
3. **历史 Track 时区修复工具**：用 HLC 重算这份设计之前生成的 Track。
4. **跨后端同步迁移流程**：一键 Google Drive → WebDAV（等等）。MVP 路径是手动导出 + 重导入。
5. **标签库排序 / 归档**：按使用频率排序、归档长期未用的标签。
6. **同一设备多 Profile**：在同一台设备上并列跑个人 / 工作两份 DayRail 数据（不同同步目录），切换时不用重新 onboarding。
7. **分享 / 社区功能**：当前不在路线图上。真要做的话，没有账号系统的前提下更可能从"导出为链接"这种原语开始，而不是托管 Profile。无限期搁置，直到有具体的用户需求出现。
8. **RTL 语言支持**：阿拉伯语 / 希伯来语。CSS 从第一天就用逻辑属性，加 RTL 是增量工作。
9. **超宽桌面的 Review 布局**：当前"三尺度并排"在超宽屏上可能留太多水平空白；有真实数据后再重看。
10. **AI 输出语言的自动建议**：当所选模型在 UI locale 下较弱时，悄悄建议英文。当前我们固定默认 UI locale。

***

## 12. 版本路线（草案）

- **v0.1（Web MVP）**：Template（workday / restday）、Rail CRUD（含时段互斥校验、时间轴左栏 + 焦点箭头）、Cycle / CycleDay / Slot、Now View、Cycle View（周期视图，含今日列高亮 + 单元格可编辑性设计）、Project / Task 最小集（Projects tab + Cycle View 侧栏双入口，手动增删 Task，里程碑自动归档）、Shift 基础（skip / postpone）、本地 localStorage（SQLite 后挪）、**第一天就有 i18n 脚手架（zh-CN + en）**。
- **v0.2**：Signal、Timeline 回顾、PWA 安装、Cycle View 只读复盘模式、标签库、SQLite 替换 localStorage。
- **v0.3**：Cycle View 规划模式（会话级撤销）、Template Calendar、Ad-hoc Event、Pending 队列。
- **v0.4**：Habit Line（Phase 演进 + PhaseTransition 标记）、纯分组 Line、归档 + 复制新建、Task sub-item 完整化。
- **v0.5**：AI 辅助（OpenRouter，默认关闭，一次性引导） —— 拆解 + 观察 + 复盘。
- **v0.6**：桌面端（Tauri）。
- **v0.7**：移动端（Capacitor）。通知依旧只走 App 内 check-in 条（§5.6），不引入 OS 推送。
- **v0.8**：同步基础设施 —— Google Drive 适配器、加密事件日志、快照 / 压缩、密码短语流程。**设置走同一条通道**（没有独立账号后端）。
- **v1.0**：同步加固 —— 第二台设备接入、E2E 迁移、恢复码、按计划本地明文导出。
- **v1.x**：补齐同步后端（iCloud、WebDAV）。

***

## 13. 版本发布与更新机制（v0.4.1 起）

**问题背景**：DayRail 是 PWA，Service Worker 缓存很激进。v0.4 之前用户反馈"重启了好多次才更新"、"不知道自己在哪个版本"。这一章钉下机制。

### 13.1 版本号来源

构建时 Vite 经 `define` 注入三个常量（已在 `apps/web/vite.config.ts`）：

| 常量 | 来源 | 示例 |
|---|---|---|
| `__APP_VERSION__` | `apps/web/package.json` 的 `version` | `"0.4.1"` |
| `__APP_GIT_SHA__` | `git rev-parse --short HEAD` | `"badd560"` |
| `__APP_BUILD_DATE__` | 构建时 `new Date().toISOString().slice(0,10)` | `"2026-04-22"` |

用户看到的 human-readable 版本 = `v{version} · {gitSha} · {buildDate}`。semver 给"这是什么里程碑"，git SHA 给"这是哪一次构建"（主要识别标识）。

### 13.2 SW 生命周期立场

**`vite-plugin-pwa` 的 `registerType` 选 `'prompt'`**（不用 `'autoUpdate'`）。原因：

- `'autoUpdate'` 会在后台 `skipWaiting` + 把控制权交给新 SW。当前 tab 内存里依旧是旧 JS —— 用户要再次打开 tab 才看到新版本，期间毫无提示
- `'prompt'` 把"何时激活新版本"交给 app 层 —— 我们负责显式提示 + 一键更新 + `location.reload()`。**1 次点击完事**，不用多次重启

### 13.3 顶栏更新浮条 `UpdateBanner`

- **触发**：`registerSW({ onNeedRefresh })` 回调中设 `needsRefresh = true`
- **外观**：全宽浮条，吸附在 app 顶部（所有视图之上），`surface-2` 底 + `cta` 色 accent
- **文案**：
  ```
  ⭡ 新版本可用：{currentSha} → {newSha}   [立即更新]  [稍后]
  ```
  注：`newSha` 在 `prompt` 模式下拿不到（SW 不会告诉我们"新版是什么 SHA"）。**退化方案**：显示 `[立即更新]  [稍后]` + "新版本已下载"，去掉 SHA 箭头。未来真想拿到可以让 SW 自己读取一个 `/__version__.json` 广播给 client —— 当前 MVP 不做。
- **立即更新**：**不**直接调 `updateSW(true)`，而是进入 §13.8 描述的「升级前备份」二次确认流；偏好为 `'always'` / `'never'` 时跳过弹窗直接执行；偏好为 `'ask'`（默认）时弹出 `BackupPromptDialog`。最终都走 `updateSW(true)` → SW `skipWaiting` → `controllerchange` → `location.reload()`。
- **稍后**：
  - 隐藏 banner
  - **本次 session 内不再提醒**（保存到 React 组件级 state，不落 localStorage / sessionStorage）
  - 关闭 tab 再开 = 自然重新提示（因为 state 重置）
  - 本 session 里若又有 v3 waiting 出现（新的 `SKIP_WAITING` 事件、waiting SW 的引用换了）= 再次提示（新版本值得再问一次）

### 13.4 自动检查触发点

| 触发点 | 行为 |
|---|---|
| tab 启动 | vite-plugin-pwa 默认会注册一次 |
| `setInterval(5 min)` | 周期 `updateSW()`（无 arg，静默轮询） |
| `visibilitychange → visible` | 立即 `updateSW()`（用户回到页面） |
| `online` 事件 | 立即 `updateSW()`（刚从离线恢复） |
| Settings "检查更新" 按钮 | 手动 `updateSW()`；已是最新 → toast "已是最新版本"；有新版 → banner 浮出 |

**成本**：`updateSW()` 内部调 `ServiceWorkerRegistration.update()` → 一次 conditional GET `/sw.js`（带 `If-Modified-Since` / `ETag`）。未变 → HTTP 304 + 零 body。变了 → 几 KB 下载。5 分钟粒度完全负担得起；常见场景下一天内网络开销 << 100 KB。

### 13.5 Settings "关于" 区块

在 `SettingsSections.tsx` 下新增（非单独文件）：

```
┌─ 关于 ──────────────────────────────────────┐
│  DayRail  v0.4.1                            │
│  构建      badd560 · 2026-04-22              │
│  Repo      github.com/FreeJolan/dayrail       │
│                                              │
│  [ 检查更新 ]  [ 升级 ]   上次检查：2 分钟前  │
│  升级前备份   ◉ 询问  ○ 总是  ○ 从不           │
└──────────────────────────────────────────────┘
```

- 版本 / SHA / date 直接从 Vite 注入的常量读
- "检查更新" 按钮点一下立刻触发 `updateSW()`，旁边显示"上次检查：XX 前"相对时间
- 检查完如果没更新 → 行内提示"已是最新版本"，2 秒淡出
- **「升级」按钮**：仅当 `status === 'needs-update'` 时渲染（CTA 色，与顶栏 banner 视觉一致）；点击进入 §13.8 的备份前确认流。这条入口和顶栏 banner 二选一都能升级，互不冲突。
- **「升级前备份」偏好行**：三选一 radio（`询问 / 总是 / 从不`），对应 §13.8 的 `'ask' | 'always' | 'never'`。从这里手动改回 `'询问'` 可重置弹窗行为（覆盖之前在弹窗里勾选「记住我的选择」写入的偏好）。

### 13.6 首次离线可用提示

`registerSW({ onOfflineReady })` → 一次性右下角 toast "已可离线使用"，5 秒自动消失。首次 SW 装好时触发，后续启动不再出现。

### 13.7 暂不做

- **强制更新通道**（安全漏洞级别"必须马上升级"）：暂无业务驱动。真遇到，单独方案 —— SW 读 `/__force_version__.json`，返回 `{minVersion: "0.5.2"}` 时 app 强制 `updateSW(true)` 绕过 banner。v0.4.1 不做。
- **增量更新 / delta patch**：完整 bundle gzip 后 ~240KB，delta 系统复杂度 > 收益。
- **版本日志 / CHANGELOG inline 展示**：Settings 里的 "Repo" 链接先承担查更新日志的职责，直到 CHANGELOG 机制单独落地。

### 13.8 升级前本地备份（v0.4.4 起）

**问题背景**：升级 = SW skipWaiting + 整页 reload。绝大多数情况下不会丢数据（数据在 IndexedDB / Zustand persist 里），但用户的心智模型是「升级 = 风险」。给一条「升级前先把数据导一份到本地」的低成本退路，比反复解释「升级是安全的」更有用，也是 §13.7「强制更新」之外唯一与升级耦合的数据保护机制。

**偏好模型**：`localStorage` 键 `dayrail:upgrade-backup-pref`，取值：

| 值 | 含义 | 弹窗行为 |
|---|---|---|
| `'ask'`（**默认**） | 每次升级前问一下 | 显示 `BackupPromptDialog` |
| `'always'` | 总是先备份再升级 | 跳过弹窗，自动调 `exportLocalData()` 然后 `update()` |
| `'never'` | 从不备份直接升级 | 跳过弹窗，直接 `update()` |

读写通过一个轻薄的 `lib/upgradePref.ts`（`getUpgradePref()` / `setUpgradePref()`），与现有 `lib/theme.ts` 同样的 localStorage 风格。**不**进 zustand 核心 store —— UI 偏好不属于域数据，也避免污染备份 bundle。

**触发器**：新 hook `useUpgradeFlow()` 封装入口逻辑：

```ts
const { requestUpgrade, dialog } = useUpgradeFlow();
// requestUpgrade(): 读偏好 → 'ask' 开 dialog / 'always' 备份后升级 / 'never' 直接升级
// dialog: 渲染 <BackupPromptDialog /> 所需的状态（open + handlers）
```

两个调用点共用：
- §13.3 顶栏 banner 的「立即更新」
- §13.5 Settings About 的「升级」按钮

**`BackupPromptDialog` 组件**（仓库目前没有 Dialog primitive，新建一个一次性的小内联 modal —— `fixed inset-0` 半透明 overlay + 居中 panel + `role="dialog"` + `aria-modal="true"` + `Escape` 关闭 + 焦点陷阱在三个按钮和 checkbox 之间）：

```
┌─ 升级前备份？ ───────────────────────────────┐
│                                              │
│  你即将升级到新版本。是否在升级前先把当前      │
│  数据导出一份到本地？                          │
│                                              │
│  ☐ 记住我的选择                              │
│                                              │
│             [ 取消 ] [ 直接升级 ] [ 备份并升级 ] │
└────────────────────────────────────────────────┘
```

- **「备份并升级」**（CTA 主按钮）：调 `exportLocalData()` 触发浏览器下载 → `setTimeout(250ms)` → `update()`。250ms 是给 download stream 落盘的微小窗口，避免 SW reload 中断下载流（`exportLocalData` 内部已经用了 `setTimeout(1000)` 才 `URL.revokeObjectURL`，但触发下载的 `a.click()` 是同步的；250ms 已足够把 navigation 让给 download）。
- **「直接升级」**（次按钮）：直接调 `update()`。
- **「取消」**：关弹窗，不升级。`UpdateBanner` 仍在原位（`needsRefresh` 没动）。
- **「记住我的选择」checkbox**（**默认不勾选**，避免第一次误点把偏好写死）：勾选时把按下的主/次按钮映射成偏好持久化：「备份并升级」→ `'always'`，「直接升级」→ `'never'`，「取消」永远不写偏好。

**`'always'` 路径的可见性 toast**：偏好为 `'always'` 时整条路径是「无弹窗 → 静默触发下载 → 250ms 后 reload」，用户可能完全察觉不到自己刚下载了文件。所以在 `exportLocalData()` 成功之后、`update()` 之前插一个简短 toast：

```
✓ 已备份到 dayrail-backup-{timestamp}.json · 即将升级…
```

- 文案就放在 `BackupPromptDialog` 同色系的 toast 区（沿用 §13.6 离线提示用过的右下角 toast 模式）。
- toast 不阻塞 reload —— 250ms 后照常 `update()`，toast 随页面 reload 自然消失（用户能看到的是「toast 闪了一下 → 页面刷新进入新版本」，足够形成感知）。
- 仅 `'always'` 路径需要这个 toast；`'ask'` 路径用户已经在弹窗里主动选了「备份并升级」，不需要再提示一次；`'never'` 路径没有备份动作。

**回退路径**：
- 用户在 Settings 把偏好手动改回「询问」 → 下次升级再次出现弹窗，覆盖之前 `'always'` / `'never'` 的写入。
- localStorage 失效 / 私密浏览模式：`getUpgradePref()` fallback 到 `'ask'`，等同默认行为。
- `exportLocalData()` 抛错：catch 后 toast 「备份失败，已取消升级」，**不**继续 update —— 用户既然选了备份就是把升级和备份绑成原子，备份失败时不能背刺。`'always'` 路径同样适用：失败 toast 取代成功 toast，update 不发生。

**为什么不做：**
- **不**把备份偏好做成 zustand store 字段：UI 偏好，与域数据解耦；备份 bundle 里也不应该出现「我下次升级是否要备份」这种递归元数据。
- **不**复用 `window.confirm()`：满足不了三按钮 + checkbox 的结构。
- **不**用 Radix Dialog：仓库目前没有这个依赖，单点新增一个一次性 modal 不值得；走简单 `fixed inset-0` 就够。
- **不**做「自动定时备份」：和升级耦合的备份是窄场景；常态备份属于另一个产品决策，不在本节范围。

***

## 14. 外部事件源（v0.8 起）

> 状态：2026-05-06 设计锁定，v0.8.0 ship **两个 source**（共用一套渲染层）：节假日数据集（§14.2）+ 用户标注（§14.3）；ICS 订阅留 v0.9+ 停车场（草稿见 §14.4）。

### 14.0 动机

DayRail v0.7 之前的所有日历语义（Template / CalendarRule / Cycle / DailyReflection）都是**进 task pipeline 的数据** —— 它们影响 Task 物化、completion 计算、Review 统计。v0.8 引入一类**不进 task pipeline 的日期标注**：日历这天上有什么"事"，但不是"要做的事"。这一类下面有三个 source：

- **节假日**（§14.2 · v0.8.0 ship · 外源）—— 用户在 Cycle View / Calendar 里看到日期时，需要知道哪天是节假日（影响"任务为什么没做"的语义 —— 节假日完成度低不该被算成"我状态差"）。AI 复盘（§6.6.2）拿到节假日上下文后能给出更准确的解读（"这天是中秋节，你完成度低很正常"）。
- **用户标注**（§14.3 · v0.8.0 ship · 内源）—— "下周二是我生日"、"去看牙医"、"妈妈生日" —— 用户希望在日历上看到提示，但这些事不该作为 Task 进 Today Track（不需要 check-in / done / 完成度）。
- **ICS 订阅**（§14.4 · v0.9+ 停车场 · 外源）—— 用户想订阅外源日历（学校学期表 / 球队赛程 / 单位会议室占用），等真有非节假日的导入诉求再做。

设计上把这三类统一抽象为 `ExternalEvent` 接口（§14.1），渲染层只认这个接口，所有 source 共享 Cycle View / Calendar / Today Track / Review 的 chip 渲染路径。**"外部"在这里指外部于 task pipeline**，而非外部于用户 —— 这是 v0.8.0 加 §14.3 用户标注时校准的语义。

### 14.1 `ExternalEvent` 抽象

```ts
type ExternalEvent = {
  sourceId: string;           // e.g. 'holidays:zh-CN' / 'user:note:<id>' / 'ics:user-defined-1'
  date: string;               // ISO YYYY-MM-DD（事件归属日，按用户当地日期）
  label: string;              // 显示文本，UI locale-aware（参见各 source 的 label 规则）
  kind: 'holiday' | 'observance' | 'event' | 'user-note';
  // 影响渲染：holiday 实色 / observance 描线 / event 中性 / user-note 描线 + 用户色
  regionCode?: string;        // 仅 holidays source 用，区分国家
  meta?: Record<string, unknown>;  // 各 source 自留扩展槽（user-note 走这里携带 color / createdAt）
};
```

**渲染层只认这个接口** —— Cycle View 日期单元格 / Calendar 月视图日期格子从一个 `selectExternalEventsOn(date)` selector 拿当天所有 events，叠 chip 渲染。selector 内部按 source 顺序聚合（先 holidays、再 user-notes、再 future ICS）。

**不进 task 物化 pipeline** —— ExternalEvent **不**生成 Task / RailInstance / auto-task；不参与 §10.2 物化、§10.3 purge、§10.5 revision。它就是"日历这天的标签"，纯展示，不影响任何 status / 完成度 / Review 统计的计算路径（除了 AI 复盘 prompt 的上下文注入）。

### 14.2 v0.8.0 实施 — 节假日内置数据集（bundle 路线）

> 设计选择：**bundle 仓库内 JSON 数据集** + **region multi-select**，**不**走 ICS 订阅。

**为什么选 bundle 不选 ICS**

讨论过两种：A · 用户填 ICS URL，运行时 fetch + 解析 + 缓存；B · 仓库内 bundle 区域数据集，用户多选 region。

| 维度 | A · ICS 订阅 | B · bundle JSON |
|---|---|---|
| 数据更新频率 | 节假日数据一年改一次 | 一年改一次（每年 12 月开 PR 加明年的） |
| 网络依赖 | 是（需要刷新调度 + 错误恢复） | 否（数据是代码的一部分） |
| CORS 风险 | 高（公共 ICS 大多没开 CORS，要自建反代） | 无 |
| 解析复杂度 | 中（需要 ical.js，处理 RRULE / VTIMEZONE） | 无（直接 JSON） |
| 数据可信度 | 取决于上游维护者 | 仓库 PR 审查 |
| 灵活性 | 高（任意外源） | 低（只能用我们打包的） |

ICS 订阅的复杂度对**节假日这个具体诉求**完全是浪费：节假日数据一年改一次，配置化刷新 + ETag + CORS 反代 + ical.js 解析全都用不上。bundle 路线在数据更新频率与产品节奏（一年至少发一次新版）天然对齐。

ICS 订阅的真正价值（用户订外源日历）留到 §14.4 v0.9+ 停车场。

**数据形态**

```
data/holidays/
  zh-CN.json    # 中国大陆法定节假日 + 部分传统节日
  en-US.json    # 美国联邦假日
  ja-JP.json    # 日本祝日
  zh-HK.json    # 香港公众假期
  zh-TW.json    # 台湾节日
  …（按需扩展）
```

每份 JSON：

```json
{
  "regionCode": "zh-CN",
  "displayName": {
    "zh-CN": "中国大陆",
    "en": "Mainland China"
  },
  "events": [
    { "date": "2026-01-01", "label": { "zh-CN": "元旦", "en": "New Year's Day" }, "kind": "holiday" },
    { "date": "2026-02-17", "label": { "zh-CN": "春节", "en": "Spring Festival" }, "kind": "holiday" }
  ]
}
```

label 是 locale 字典（key 至少包含当前 UI locale 的两档），renderer 读 `label[uiLocale] ?? label['en']` 兜底。

**首批覆盖**：`zh-CN`（自用核心）+ `en-US` / `ja-JP` / `zh-HK` / `zh-TW`（高概率次需求）。其它按 issue / PR 添加。

**region multi-select**

Settings → 外观 → 节假日（新分组，与"主题 / 字号"同 section）：

```
┌─ 节假日 ──────────────────────────────┐
│  在 Cycle View 和 Calendar 上显示节假日：│
│   ☑ 中国大陆                           │
│   ☐ 美国                               │
│   ☐ 日本                               │
│   ☐ 香港                               │
│   ☐ 台湾                               │
│  [ 关闭全部 ]  [ 跟随系统 region ]       │
└────────────────────────────────────────┘
```

**「跟随系统 region」按钮**：读 `Intl.DateTimeFormat().resolvedOptions().locale` 推断；推不准则提示用户手选（不强制覆盖现有选择）。

存 `userProfile.enabledHolidayRegions: string[]`（Y.Doc 同步流）。空数组 = 不显示节假日。

**渲染集成**

- **Cycle View** —— 日期单元格右上角小色点（实色 = `holiday`，描线 = `observance`），hover label 显示完整中文名 + region。多 region 同日时 chip 横向排列，最多 3 个；超出折叠为 `…+N`。
- **Calendar** —— 月视图格子里日期数字下方一行节假日 label（多 region 用 `·` 分隔），不抢 CalendarRule template 名色块的位置。
- **Today Track** —— 顶栏 `今天 · 2026-05-01 · 周五 · 劳动节` 带上节假日 label；只显示当前 region 集中**首个匹配的**（多 region 撞同一天的概率极低，UI 简洁优先）。
- **Review** —— Day / Cycle 视图右上角 metadata 行带节假日 label，多 region 用 `·` 分隔；进 AI 复盘 prompt 的 `metadata` 字段（§6.6.2）。

**不影响的路径**

- §10.2 auto-task 物化 —— 不读 ExternalEvent
- §10.3 purge / §10.5 revision —— 节假日不进版本系统
- §5.4 CalendarRule —— 用户自定义"国庆这周用 restday template"仍然走 CalendarRule，与 ExternalEvent 并存
- check-in / Pending / completion stats —— 都不感知节假日，纯按 task / habit 的 status 算

**数据更新策略**

每年 12 月，我（或 contributor）开 PR 加明年的 JSON，版本号小升（例如 0.8.x → 0.8.{x+1}）。运行时不做网络刷新。用户更新 PWA 即拿到新数据。

**测试**

- `data/holidays/*.json` 的 JSON schema 校验（lint / typecheck 时跑）
- `selectExternalEventsOn(date)` selector 单测，覆盖 region 选择 / 多 region 聚合 / 空选择路径
- 不需要为每个节假日数据集写 unit test —— 数据 = 代码，靠 PR review

### 14.3 v0.8.0 实施 — 用户标注（user-defined day notes）

> 状态：2026-05-06 设计锁定，与 §14.2 节假日数据集**同 v0.8.0 ship**，共享 §14.1 `ExternalEvent` 渲染层。

**动机**

§14.0 把"外部"定义为"外部于 task pipeline"（不进物化、不进 purge、不进 revision），而非"外部于用户"。节假日和用户标注都满足这个意义上的"外部" —— 前者数据来源在仓库、后者数据来源在用户自己的笔，但都不影响 task / habit / completion 这条主链。

具体场景：

- "下周二是我生日"
- "去看牙医"
- "妈妈生日"
- "结婚纪念日"
- "公司团建"

这些事不该作为 Task 进 Today Track（不需要 check-in / done / 完成度），但用户希望在 Calendar / Cycle View 上看到提示，**用户标注**这条路就是为它们准备的。

**与 §5.4 CalendarRule 的边界**

CalendarRule 决定"这天用哪个 template"（workday / restday / cycle 推断）；UserDayNote 只是 label，不影响 template、不影响 task、不影响 completion。两者完全正交，可以叠加：

> 例：`国庆这周用 restday template`（CalendarRule date-range）+ `10/1 是国庆节`（节假日 ExternalEvent）+ `10/1 公司团建`（UserDayNote）—— 三者在 Calendar 同一天上同时存在，互不干扰。

**数据形态**

```ts
type UserDayNote = {
  id: string;        // ULID
  date: string;      // ISO YYYY-MM-DD
  label: string;     // 用户文本（单行，建议 < 30 字）
  color?: string;    // chip 颜色（Radix 10 色之一）；undefined = 默认中性灰
  createdAt: number; // epoch ms
  updatedAt: number; // epoch ms
};
```

存 Y.Doc top-level `userDayNotes` Y.Map，`id` 作为 key。多 note 同日时不需要顺序保证（按 `createdAt` 升序渲染即可）。

**为什么 keyed by id，不 keyed by date**

两台设备同一天分别新建一条 note：

- keyed by date：Yjs `Y.Map.set('2026-05-12', note)` 在两端会冲突，LWW 决胜，**另一条静默丢失**。
- keyed by id（ULID）：两条 note 各有 unique id，自然共存，CRDT 合并零工作量。

后者的副产品：**多 note 同日**变成自然结果，UI 只要按 `date` 索引查询即可。

**映射进 `ExternalEvent`**

```ts
function userNoteToExternal(note: UserDayNote): ExternalEvent {
  return {
    sourceId: `user:note:${note.id}`,
    date: note.date,
    label: note.label,
    kind: 'user-note',
    meta: { color: note.color, createdAt: note.createdAt },
  };
}
```

`selectExternalEventsOn(date)` 内部调用上面这个 mapper，把 user notes 与 holidays 一起聚合。

**渲染样式**

`§14.1` 定义的 `kind` 加一档 `'user-note'`，渲染层：

- `holiday`：实色填充 → 不变
- `observance`：描线 → 不变
- `event`：中性 → 不变
- **`user-note`**：描线 + 用户色（`meta.color` 或默认中性灰） —— 视觉上与节假日有区分（描线而非实色），但 chip 形态一致

**UX 入口（v0.8.0 三个 surface）**

1. **Calendar 月视图**——点日期 → 现有 popover 在 CalendarRule 区域上方加一段「备注」：
   - 已有 note 列表：每条一个 chip（user-note 样式），点 chip 进编辑模式（label textarea + color picker + 删除）
   - 列表下方一个「+ 添加备注」按钮，点开输入 label（必填）+ color（可选，默认中性）+ 保存
   - 保存 / 删除即时生效（不进 §5.3.1 Edit Session，与 CalendarRule drawer 同策略）

2. **Cycle View 日期单元格**——节假日色点旁叠用户标注色点：
   - 多个 note 时按 `createdAt` 升序排列，与节假日 chip 共用「最多 3 + `…+N` 折叠」规则
   - hover 时显完整列表（节假日 + 用户标注，按 source 分组）
   - 点击 chip → 跳到 Calendar 月视图聚焦该日（重用现有"打开 Calendar"路由）；不直接在 Cycle View 编辑（避免编辑模态在 Cycle 里增加复杂度）

3. **Today Track 顶栏**——metadata 行带今天的 user notes：
   - `今天 · 2026-05-12 · 周二 · 妈妈生日 · 看牙医`
   - 节假日（如有）排在 user notes 前
   - 多个 user notes 用 `·` 分隔；超过 3 条折叠 `…+N`

附加（**不在 v0.8.0 ship 边界**，但渲染层会预留接口）：

- **Review · Day metadata 行**：与 Today Track 同形态，进 AI 复盘 prompt 的 `metadata` 块（§6.6.2）。**这一条也在 v0.8.0 顺手做**，因为 selector 已经写了，渲染层多挂一个使用点不增加成本。

**不做（v0.8.0 边界）**

- **长描述 / Markdown body** —— 单行 label 够用；真要写长内容用 §4.1 DailyReflection（绑定到 reflection 的日期上，与 user note 的"日历标签"语义不同）。留 v0.8.x 看真实使用。
- **提醒 / 倒计时 / N 天前提示** —— "10 天后是生日"这种主动提醒不做。理由：DayRail 整体不做 OS 推送（§5.6 既定边界），run-time 提醒只能塞进 Today Track 顶栏，价值低于实现成本。留 v0.8.x。
- **跨年重复（"每年这天的生日"）** —— 当前每条 note 单日。复制即可（点旧 note → 「复制到下一年同日」按钮，这个按钮也留 v0.8.x）；真痛点了再做 RRULE-style 重复。
- **AI 自动从 task / habit 名提取候选标注** —— 不主动猜。
- **批量编辑 / 多日同标注** —— "国庆 7 天连续假期" 用法上是 7 条独立 note，不做"一次创建跨 7 天" surface。

**与 §10.5 revision 模型的关系**

UserDayNote **不进** revision 系统。Note 本身可以 update（改 label / color / date），改完直接覆盖 Y.Map 那条记录。理由：note 没有"过去日期不变"的语义（它就是用户写的标签，不是规划数据），§10.5 revision 链是为了"改 rail 不破坏过去任务"，note 不存在这个问题。

**测试**

- `userNoteToExternal` mapping 单测
- `selectExternalEventsOn(date)` 在多 source（holidays + user-notes）共存时的聚合 + 排序
- Y.Doc CRUD：create / update / delete 各 1 case
- 多设备并发新建同日 note 的 CRDT 合并（两条都保留，不丢） —— 这条直接走现有 `yjs.test.ts` 的扩展

### 14.4 ICS 订阅 · 停车场草稿（v0.9+）

> 不在 v0.8 范围。这里只记**触发条件**和**已经想清楚的设计点**，等真要做时这一节直接升级到 v0.9 实施说明。

**触发条件**：我自己或某个 beta 用户提了一个**非节假日**的外源日历需求（学校学期表 / 球队赛程 / 单位会议室占用 / 周期性会议等）。在那之前，节假日 bundle 数据集已经覆盖 90% 实际诉求。

**已想清楚的设计点**

- **数据形态**：用户在 Settings → 同步（或新建"外部日历"分组）→ 添加 ICS 订阅 → 填 URL → 起个标签 + 选 chip 颜色 → 保存。Y.Doc 里：

  ```ts
  type IcsSubscription = {
    id: string;                    // ULID
    url: string;                   // ICS feed URL
    label: string;                 // 用户起的名字
    color: string;                 // chip 颜色（Radix 10 色之一）
    refreshIntervalSec: number;    // 默认 86400（1 天）
    lastFetchedAt: number;         // epoch ms
    etag?: string;                 // HTTP ETag，下次 If-None-Match
    lastModified?: string;         // HTTP Last-Modified
    cachedEvents: ExternalEvent[]; // 解析后的事件，cache 在 Y.Doc 里
  };
  ```

- **刷新策略**：`lastFetchedAt + refreshIntervalSec < now` 时尝试刷新；HTTP 请求带 `If-None-Match: <etag>` / `If-Modified-Since: <lastModified>`；304 直接 noop；200 解析新 events 替换 cachedEvents。失败（离线 / CORS / 5xx）继续用 cache，banner 提示"上次刷新 N 天前"。
- **CORS**：公共 ICS 大多不开 CORS，需要 Vercel serverless 反代 `/api/ics-proxy?url=<encoded>`。反代不缓存（缓存交给浏览器 ETag），不持久化（zero PII）。如果用户用自己的反代，提供"自定义反代 URL"输入框。
- **解析库**：`ical.js`（Mozilla 维护），处理 RRULE / VTIMEZONE / DST。包大小 ~80KB gzip，按需 lazy-load 仅在用户开第一个订阅时下载。
- **`ExternalEvent` 接口适配**：每条 ICS event 转 `{ sourceId: 'ics:<subId>', date: <YYYY-MM-DD>, label: <SUMMARY>, kind: 'event' }`，多日 event 展开为多条 single-day events（按 ICS 标准每天 fire 一次）。
- **Y.Doc 占用注意**：如果某订阅的 cachedEvents 巨大（几千条 / 几年的会议历史），会让单 Y.Doc 大小膨胀。设计 cap：每订阅最多保留 `[今天-30天, 今天+365天]` 窗口的 event，刷新时按窗口裁剪。
- **「立即刷新」按钮**：每条订阅旁边一个，强制 fetch（忽略 refreshIntervalSec）。
- **失败可观察**：连续 3 次刷新失败时，订阅条目高亮 + Settings 抽屉里突出标红 + 暂停自动刷新（防止账户被 IP-blocked），用户手动点「重试」恢复。

**显式不做**（即便 v0.9 上 ICS）

- 双向 ICS（写回到 Google Calendar 等）—— DayRail 是只读消费者
- ICS 订阅的字段级 CRDT —— `cachedEvents` 是远端派生数据，Y.Doc 里走 LWW 即可（每次刷新整列覆盖）
- 复杂的 RRULE 修改 surface —— 用户改不动外源日历，只能取消订阅重订

***

## 15. 桌面端架构（v0.9 起）

> 状态：v0.9 设计锁定 2026-05-07。本节是初步架构 sketch；具体子模块在 v0.9 实装阶段会有 ship-notes 章节做实装纪要（同 §6.6 / §7.6 / §7.7 模式）。

### 15.0 动机 · 为什么 v0.7 的"Tauri 不做"被反转

v0.7 ship 后 1 个月真实 dogfood 累积出一个结构性 UX 缺陷：

- Google OAuth implicit flow（**PWA 唯一能用的**）不发 refresh token —— 协议规定 refresh token 由后端 client 持有
- access token 1 小时过期 → 每个 ~1 小时窗口下次 sync 必须走 GIS 续 token 流程
- 即使 `use_fedcm_for_prompt: true` 把 popup 降到 FedCM 底部小条，对日常用户也是**不可接受的打扰节奏**
- 日常用户预期"首次授权后零打扰" —— 在 PWA + 无后端架构里**不可达**，是 OAuth 协议天花板

短期是否可绕：

| 方案 | 评估 |
|---|---|
| 自建后端代理 refresh token | 违反 §7.1「无 DayRail 后端」核心承诺；新增运维 + 安全面 |
| 切到 WebDAV 静态凭证 | 需要用户会配 WebDAV，扩 beta 用户时门槛高（v0.8.2 dogfood 后判定）|
| 桌面壳 + desktop OAuth pattern | 一次性架构投入，物理上消除该问题，同时解锁其它 PWA 限制 |

桌面壳是唯一**保留 §7.1 立场 + 不增加用户配置成本**的解。Tauri 2 (2024+ 稳定) 是该方向的成熟选项。

### 15.1 范围 · PWA 不下线

桌面端**不替代** PWA：

- **PWA**：继续作为公开 Web 入口（任何人浏览器打开 `dayrail.example` 就能用）。同步路径继续走 GIS implicit flow + FedCM —— 接受其打扰节奏，不再为它做 UX 优化。
- **桌面端**：日常用户的**推荐路径**。装一次 → 系统级体验 → Drive 永久授权 → auto-update。

两条路径**共享 Y.Doc 同步流**（同账号 Drive `appdata` 同份 `.dryj`）。用户可以同时在 web + 桌面端用，Yjs CRDT 自动合并（与 v0.7 多设备 CRDT 心智一致）。

### 15.2 技术栈

- **Tauri 2** —— Rust 后端进程 + 系统 webview（macOS WKWebView / Windows WebView2 / Linux WebKitGTK）。
- **前端复用 Vite 产出** —— `apps/web/` 不动，Tauri 配置 `frontendDist = "../web/dist"`。React / Zustand / Y.Doc 同代码。
- **Tauri plugins** + 直接 crate：
  - `tauri-plugin-updater` + `tauri-plugin-process` —— auto-update + relaunch（详见 §15.4 / §15.8）
  - `tauri-plugin-shell` —— 打开浏览器走 OAuth consent
  - `tauri-plugin-autostart`（v0.11.6 加）—— 跨平台开机自启动入口（macOS Launch Agents / Windows Registry / Linux .desktop），详见 §15.8
  - `keyring` crate（不走 plugin）—— OS keychain（macOS Keychain / Windows Credential Manager / Linux Secret Service via libsecret）存 refresh token。比 `tauri-plugin-stronghold` 轻量，不需要 master-password ceremony；refresh token 是 Google 端可随时撤销的 capability，不是用户长期密码材料，与 stronghold 的 vault 模型不匹配。
  - `oauth2` + `reqwest` crate —— Rust 进程内跑 authorization-code flow + token exchange + refresh，不走 webview，所以不需要 `tauri-plugin-http` 绕 CORS。
  - `tauri-plugin-notification` —— 系统通知（v0.9.x 可选）

### 15.3 同步层适配（核心改动）

PWA 路径（保留）：

```
Browser → GIS implicit flow → access token (1h, no refresh) → Drive API
```

桌面路径（新）：

```
Tauri Rust 后端（drive_connect 命令）
  1. 生成 PKCE challenge
  2. tokio::TcpListener::bind("127.0.0.1:0") → OS 选个空闲端口
  3. 用上面这个端口拼 redirect_uri，构造 authorize URL（access_type=offline, prompt=consent, PKCE）
  4. open::that(authorize URL) → 用户默认浏览器打开 Google 同意页
  5. 用户在浏览器里同意 → Google 重定向到 http://127.0.0.1:<port>/callback?code=...
  6. listener.accept() 收到 HTTP 请求，解析 query 拿 code（5 分钟超时）
  7. exchange_code(code, pkce_verifier) → { access_token, refresh_token, expires_in }
  8. keyring.set_password(refresh_token) → OS keychain
  9. 返回 { access_token, expires_at } 给前端
后续 Drive API 调用：
  前端缓存 access_token；过期时调 drive_get_token →
    keyring.get_password() → exchange_refresh_token() → 返新 access_token（无 UI）
```

关键决策：

- **OAuth client 类型**：用 Google "Desktop app" credential（区别于 Web app 的 implicit flow）。可发 refresh token；按 RFC 8252，desktop client 的 "client_secret" 不属于真正机密（嵌进每个分发的二进制），PKCE 才是 auth-code 交换的实际保护。
- **refresh token 存哪**：OS keychain via `keyring` crate，**不在 Y.Doc 同步流**（与 §6.6 字段分流原则一致 —— 凭证仅本机）。每台桌面设备各自首次授权一次。`KEYCHAIN_SERVICE = "app.dayrail.desktop" / KEYCHAIN_USERNAME = "google-drive-refresh-token"`。
- **frontend 直接用 fetch**：Drive API 调用走 webview 内的 `fetch()`，与 PWA 同路径——`drive.appdata` 端点支持 CORS，不需要 `tauri-plugin-http` 绕。Rust 那侧只负责 OAuth（认证 endpoint 不支持 CORS / 但本来就要在 Rust 跑因为要碰 keychain）。
- **redirect_uri 用 loopback 不用 deep link**：deep link（`dayrail://` scheme）需要操作系统注册 + macOS 的 LaunchServices / Windows registry / Linux .desktop 协议绑定逐平台 plumbing；loopback 是 RFC 8252 推荐的 native-app pattern，OS 选随机端口、零注册成本、Google OAuth 直接支持。
- **frontend 怎么知道当前在 Tauri**：`isTauriRuntime()`（`apps/web/src/lib/versionUpdateContext.ts`）检测 `__TAURI_INTERNALS__` 全局，PR-B auto-update 已经用过同一函数。`apps/web/src/lib/sync/driveAuth.ts` 在 4 个公开函数（`connectDrive` / `disconnectDrive` / `ensureAccessToken` / `isDriveConnected`）头部 early-return 到 desktop 路径，PWA 路径完全不动。
- **`KEY_CONNECTED` localStorage hint 仍保留**：keychain 是真源，但前端需要一个同步可读的 "已连接" flag 来 gate UI。`drive_connect` 成功时写 `'1'`，`drive_disconnect` 清掉，`drive_get_token` 失败（refresh token 被撤销）时也清掉。
- **PWA `aiApiKey` 等本机字段**：桌面端**没换**，仍走 `localStorage`。`aiApiKey` 是 OpenAI-compatible 端点的密码，泄露代价比 `drive.appdata` token 低（后者能写 DayRail 自己的 appdata，前者能扣别家 LLM 余额但不能动 DayRail 数据）。如果将来要给桌面用户额外保护，再迁。

### 15.4 auto-update 基础设施

用户硬约束："桌面端**一定要支持**自动更新"。Tauri 2 标准方案：

- **Manifest**：静态 JSON 文件托管在 GitHub Pages / Vercel / Cloudflare Pages，URL 写死在 Tauri config。结构：
  ```json
  {
    "version": "0.9.0",
    "notes": "...",
    "pub_date": "2026-05-07T00:00:00Z",
    "platforms": {
      "darwin-aarch64": { "signature": "...", "url": "https://github.com/.../dayrail-0.9.0.app.tar.gz" },
      "darwin-x86_64":  { ... },
      "windows-x86_64": { ... },
      "linux-x86_64":   { ... }
    }
  }
  ```
- **GitHub Releases pipeline**：每次 release 上传签名后的 dmg / msi / AppImage + 更新 manifest JSON
- **客户端检查频率**：app 启动时 + 每隔 N 小时（同 PWA SW 现在的 5 分钟周期，改成更长）
- **更新 UX**：发现新版本 → 弹 toast「立即更新 / 稍后」→ 用户接受时下载 + 重启 → 下次打开是新版。心智沿用 PWA `useUpgradeFlow` 的形态，只是底层从 Service Worker 换成 Tauri updater。

**无 DayRail 后端**：manifest 是静态 JSON + 二进制托管在 GitHub Releases，与 §7.1 立场一致。

### 15.5 代码签名 + notarization

| 平台 | 必要性 | 来源 |
|---|---|---|
| macOS | **必须** | Apple Developer Program ($99/年) → Developer ID Application 证书 + notarization via `notarytool`；否则 Gatekeeper 警告"未识别的开发者" |
| Windows | 推荐 | EV Code Signing certificate（贵，$200-400/年）；不签发布时 SmartScreen 警告，用户点"仍然运行"可绕开 |
| Linux | 不需要 | AppImage 直接分发；包管理路径（deb / rpm / AUR）走各自签名 |

v0.9 ship 路径：

1. **先发不签名版本**（macOS / Windows / Linux 都不签）—— 用户首次安装在 macOS 上需 right-click → "打开" 一次绕开 Gatekeeper。代价是首次摩擦，可接受。
2. **Apple Developer 证书到位后** 补 macOS 签名 + notarization，从下一个版本起自动签发。
3. **Windows EV cert 暂不投入** —— 评估真实分发量后再决定。

### 15.6 Migration · 用户路径

**已有 PWA 用户切到桌面端**：

1. 用户下载 dmg / msi / AppImage 安装
2. 首次启动桌面端 → 引导授权 Google Drive（auth-code flow）→ refresh token 写 keychain
3. 桌面端启动时拉远端 `.dryj` snapshot → applyUpdate 到本地 Y.Doc
4. 之后桌面端 + Web PWA 共用同一 Drive `appdata` snapshot；Yjs CRDT 自动合并双向编辑

**v0.9 不做的迁移**：

- 不强制 PWA 用户卸载 PWA / 不在 PWA 弹"建议安装桌面版"通知 —— 用户自己决定
- 不做"PWA → 桌面端" 一键迁移工具 —— Drive 同步流天然解决

### 15.7 显式不做（v0.9 范围内）

- 移动端原生壳（iOS / Android）—— 移动端响应式仍 ❌；原生 mobile 是 v1.0+ 才考虑的事
- DayRail 自建账号系统 —— §7.1 立场不变
- 桌面端独立的本地数据格式 —— 与 web 共用 Y.Doc + `.dryj`
- ~~自动启动 / 后台 daemon —— 桌面端是被动启动的 app，不是 daemon~~ **v0.11.6 反转**：开机自启动加入,详见 §15.8。"daemon" 立场仍不变(autostart 启动的还是普通桌面 app · 不在 menubar 跑常驻服务)。

### 15.8 启动 / relaunch 行为（v0.11.6）

两条独立但语义同源的桌面端 UX 规则:**只在用户主动触发或上下文明确期望前台时**才把 app foreground,其它情况一律后台 / 不抢焦点。

**开机自启动（autostart at login）**

- Settings → 同步 → 「开机自启动」toggle 控制(默认关)。Tauri only · PWA 不显示。
- 开启时 `tauri-plugin-autostart` 写入 OS 入口:
  - macOS: `~/Library/LaunchAgents/app.dayrail.desktop.plist`
  - Windows: `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
  - Linux: `~/.config/autostart/app.dayrail.desktop.desktop`
- **启动行为 = hidden**:autostart 触发时 app 进程启动,但**主窗口不显示**,只在 dock / menubar / 任务栏出现图标。用户主动点击图标才把窗口拉出来。
  - 实现:`tauri-plugin-autostart` 把 `--autostart` 作为启动参数注入到 OS 注册的启动入口(plist `ProgramArguments` / Registry Run 值 / .desktop `Exec=`)。Rust `setup()` 检测 `std::env::args()` 里有 `--autostart` → 跳过默认 `window.show()`。
- **理由**:开机时用户在打开 Slack / Mail / 浏览器,DayRail 抢焦点是 anti-pattern。autostart 的价值是"后台进程就绪 → 用户想看时一点即开 + sync 已经在背后跑了",不是"开机就强制看到"。

**升级 relaunch foreground**

- `tauri-plugin-updater.downloadAndInstall()` 完成 → `tauri-plugin-process.relaunch()` 启动新进程。macOS 不会自动把 relaunch 出来的进程 promote 到 foreground(macOS 反"app 偷焦点"机制)。
- v0.11.6 之前用户体感:点"立即更新" → app 退出 → 新版进程跑起来但隐藏在其它窗口后面 → 用户 alt-tab 找半天。
- 修法:`relaunch()` 前设 env var `DAYRAIL_RESTART_REASON=update` → 新进程 boot 时 Rust 端检测该 env var → 调 macOS `NSRunningApplication.current.activate(options: .activateIgnoringOtherApps)` + `window.set_focus()` → 强制 foreground 一次。
- 跟 autostart 的 hidden 行为不冲突:autostart 没有这个 env var,正常走 hidden 路径;update relaunch 有 env var,走 foreground 路径。

**总规则表**

| 启动来源 | 信号 | 行为 |
|---|---|---|
| 用户点 dock / Finder / Spotlight | (none) | macOS 默认 foreground ✓ |
| `pnpm desktop:dev` | (none) | dev 行为不变 ✓ |
| autostart at login | argv 里有 `--autostart`(由 autostart plugin 注入) | hidden(只在 dock 显示) |
| post-update relaunch | env var `DAYRAIL_RESTART_REASON=update`(由 `relaunch_for_update` 命令在 `app.restart()` 前设) | 强制 foreground |
| autostart + update relaunch(理论交叉) | 两个都有 | foreground 胜出(update 明确意图) |

***

> 本文档是 DayRail 设计讨论的起点，不是终点。所有决策都可以被推翻。

