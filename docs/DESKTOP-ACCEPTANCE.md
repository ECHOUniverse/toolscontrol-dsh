# Desktop 真机手动验收清单（未自动验收）

本插件的自动化覆盖止于：单元/行为测试（vitest）、产物契约测试、离线 envelope smoke（`pnpm smoke`）。**GUI 行为与真实 Desktop 集成未做任何自动化验收**，以下清单需要在真实 Desktop 0.2.1-rc.5 上人工逐项确认。

## 前置条件

- [ ] Desktop `0.2.1-rc.5`（`dsh` 引擎窗口 `>=0.2.1-rc.1 <0.3.0-0` 内）
- [ ] 已构建产物：`pnpm verify` 全绿；或直接使用 `pnpm pack` 产出的 tarball
- [ ] 安装方式二选一（`<profile>` 填自己的 profile 名；**不能填 `desktop`**——该 profile 由 Desktop（Electron）应用独占，通用 `dsh` CLI 会直接拒绝，rc.5 实证原文：`error: profile "desktop" is managed exclusively by the Electron application`）：
  - 通用 CLI：`dsh plugin --profile <profile> add link:/absolute/path/to/toolscontrol-dsh`（或 npm 包名 `@hanxu131/toolscontrol-dsh`）
  - Desktop 插件页 **添加插件 / 安装第三方插件** 对话框：填本地目录绝对路径或压缩包路径（Desktop rc.5 自带官方文档声明接受包名、Git 地址、压缩包或本地绝对路径，且仅接受声明 bundle patch 的包；本插件的 `cordis.patch.yml` 满足）——**此 GUI 安装流程对本插件未真机验收，本次验收即为首次验证**
- [ ] 打开插件页（侧栏 Plugins）

## 1. 标签注册

- [ ] 插件页出现 **Installed / Discover / MCP / 技能** 四个标签，MCP、技能位于 Discover 右侧
- [ ] MCP、技能标签文字跟随宿主语言（切换 Settings 语言后标签即时变化；中文为“技能”，英文为“Skills”）

## 2. MCP 标签（rc.5 降级形态）

- [ ] 默认只显示 `enabled=true` 的条目；切换“已禁用 / 全部”筛选行为正确
- [ ] 名称搜索不区分大小写，与状态筛选可组合
- [ ] 每行状态徽标显示“未知”（rc.5 无连接状态观测），无工具数量、无“加载工具列表”按钮
- [ ] 页面可见能力降级说明（“当前 Desktop 版本无法观测 MCP 连接状态与工具数量…”）
- [ ] **preset-only MCP 不丢失**：仅配置在 agent preset 组合内的 MCP server（profile 根级没有对应行）出现在列表中，并标注“Preset：<名称>”；profile 根级条目标注“DSH profile 根级”
- [ ] **同名跨作用域分别展示**：同一名称同时存在于 profile 根级与 preset 时是两行，行为/详情各自独立，不合并、不冒充全局项
- [ ] **条件启用**：preset 行的 `disabled` 为表达式时显示“条件启用”，不显示为普通“已启用”
- [ ] **诚实空态**：profile 根级与全部 presets 都被完整读取且无 MCP 时显示“当前 DSH profile / presets 未配置 MCP server（…未读取外部 CLI 配置）”，不是泛泛的“当前范围内没有条目”；`pluginInventory` 不可用或读取不完整（组装面/条目无法解析）时显示通用空态 + warning，不断言“未配置”
- [ ] **enabled 不可默认启用**：MCP 行 `enabled` 缺失或非 boolean/`'conditional'` 时该行被跳过、warnings 说明原因，不显示为已启用
- [ ] 存在重复条目或畸形清单（preset 缺 id / rows 非数组）时页面 warnings 给出说明，快照不整体失败
- [ ] 手动刷新后“上次刷新”时间更新；断开 Host 后刷新失败时保留旧数据并出现过期提示
- [ ] 行内展开：连接状态“未知”、作用域、来源、已配置四项；键盘 Tab 可达、Enter 展开、`aria-expanded` 正确

## 3. 技能标签

- [ ] 左侧选中某工作区时，顶部显示“当前工作区：<title/path>”；数据按该 cwd 获取
- [ ] Skills 按该主 Session 的 live Agent preset scope 获取（请求含 `sessionId`；当前 DSH 的 skill-filesystem 在会话 preset 层），会话实际可见的 Skills 数量与列表一致
- [ ] 切换工作区后列表自动刷新为新工作区内容；同一 cwd 下切换主 Session 也自动刷新
- [ ] 无打开会话时显示“未选中工作区 — 以下为全局技能，项目级目录未知”且不猜目录；有主会话但项目目录未知时显示“当前会话：<sessionId> — 已按该会话的 preset 范围读取技能；项目目录未知”，不得显示为“全局技能”；若已请求某会话但它没有 live Agent，页面“注意事项”中出现“仅展示全局注册表”的诚实提示
- [ ] 主列表只出现生效项；展开生效项可见“同名但被覆盖的版本（n）”及被哪个来源覆盖
- [ ] 搜索被覆盖版本的独有文本不产生独立主行；来源与调用方式筛选正确；来源筛选 pill 的悬浮提示保留原始来源 id
- [ ] 枚举限制说明始终显示在“注意事项”中（runtime/preset/custom 不可完整枚举）
- [ ] 不读取、不显示任何 Skill 正文内容

## 4. 探测（手动）

- [ ] rc.5 下**任何位置都不出现**自动探测行为；“加载工具列表”按钮不存在
- [ ] （未来托管模式）按钮仅在展开详情中出现，点击后出现“探测中…”，成功列出工具名，失败显示原因；探测不改任何配置

## 5. 安装 / 卸载回归

- [ ] 安装后无报错日志；profile 组合包含 `toolscontrol` 条目
- [ ] 卸载（CLI：`dsh plugin --profile <profile> remove @hanxu131/toolscontrol-dsh`；或 Desktop 插件页对应组合包的移除操作）后：MCP/Skills 标签消失、`/toolscontrol/*` 路由不再可达、重启无残留错误
- [ ] 卸载重装一次，功能一致

## 6. 已知非目标（不算缺陷）

- 只读总览：无任何启用/禁用、安装、写配置控件
- MCP 条目来源在 rc.5 显示“未知”（无可靠来源依据时不标注具体来源）
- Skills 被覆盖版本可能不完整（“注意事项”已声明限制）
