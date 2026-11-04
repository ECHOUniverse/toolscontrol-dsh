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

- [ ] 插件页出现 **Installed / Discover / MCP / Skills** 四个标签，MCP、Skills 位于 Discover 右侧
- [ ] MCP、Skills 标签文字跟随宿主语言（切换 Settings 语言后标签即时变化）

## 2. MCP 标签（rc.5 降级形态）

- [ ] 默认只显示 `enabled=true` 的条目；切换“已禁用 / 全部”筛选行为正确
- [ ] 名称搜索不区分大小写，与状态筛选可组合
- [ ] 每行状态徽标显示“未知”（rc.5 无连接状态观测），无工具数量、无“加载工具列表”按钮
- [ ] 页面可见能力降级说明（“当前 Desktop 版本无法观测 MCP 连接状态与工具数量…”）
- [ ] 手动刷新后“最近刷新”时间更新；断开 Host 后刷新失败时保留旧数据并出现过期提示
- [ ] 行内展开：连接状态“未知”、来源、已配置三项；键盘 Tab 可达、Enter 展开、`aria-expanded` 正确

## 3. Skills 标签

- [ ] 左侧选中某工作区时，顶部显示“工作区：<title/path>”；数据按该 cwd 获取
- [ ] 切换工作区后列表自动刷新为新工作区内容；无打开会话时显示“未选中工作区 — 全局 Skills…”且不猜目录
- [ ] 主列表只出现生效项；展开生效项可见“被遮蔽版本（n）”及被谁遮蔽
- [ ] 搜索被遮蔽版本的独有文本不产生独立主行；来源与调用方式筛选正确
- [ ] 枚举限制警告横幅始终可见（runtime/preset/custom 不可完整枚举）
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
- Skills 被遮蔽版本可能不完整（横幅已声明限制）
