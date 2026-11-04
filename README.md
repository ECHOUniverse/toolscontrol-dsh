# @hanxu131/toolscontrol-dsh

DSH Desktop 内的独立插件：在插件页“发现”右侧新增 **MCP** 与 **Skills** 两个只读标签，总览当前 Desktop 中 MCP 条目与 Skills 的状态、来源与调用策略。**只读总览**——不做任何启用/禁用、写配置或写文件操作。

> English documentation: [README.en.md](./README.en.md)

## 功能

- **MCP 标签**：名称搜索；启用状态筛选（已启用 / 已禁用 / 全部，默认只看已启用）；连接状态筛选；手动刷新与最近刷新时间；行内详情（连接状态、来源、是否已配置）。
- **Skills 标签**：名称/描述/使用时机搜索；来源筛选；调用方式筛选（人工可调用 / 模型可调用 / 均不可）；手动刷新；行内详情（描述、whenToUse、来源、路径、调用策略）；同名**被遮蔽版本**只在该生效项的详情中展示，不作为独立主行。
- **工作区跟踪**：跟随 Desktop 左侧当前选中的工作区（主 Session 的 `retainedBy.mainView`），切换工作区自动按新 `cwd` 重新获取；没有主 Session 时明确显示“未选中工作区 — 全局 Skills”，不猜默认目录。
- **双语**：中英文界面文案注册到宿主 locale，跟随宿主语言；条目名称不翻译；列表按当前语言 `Intl.Collator` 稳定排序。
- **键盘可用**：行内展开使用真实按钮（`aria-expanded` / `aria-controls`），焦点环跟随宿主令牌。

## rc.5 能力边界（Desktop 0.2.1-rc.5）

MCP 数据来自 pluginInventory 配置层（`mode: "config"`）：

| 能力 | rc.5 | 行为 |
| --- | --- | --- |
| 连接状态观测 | 不可用 | 每个条目状态一律显示“**未知**”，绝不以进程/加载状态冒充连接状态 |
| 工具数量 | 不可用 | 不显示 |
| 工具探测（probe） | 不可用 | 不显示“加载工具列表”按钮；页面展示能力降级说明 |

未来官方 `mcpManager` 托管模式可用时（`mode: "managed"`）：显示真实连接状态与工具数量；“加载工具列表”按钮出现在行内详情中，**只有用户点击才发起探测**（POST，按名称，不改任何配置），从不自动探测。

Skills 限制：被遮蔽版本不保证完整——**插件运行时、preset 与自定义目录来源的竞争版本不可完整枚举**，宿主返回的枚举限制警告始终以横幅展示，不会因单来源失败变成整页空态；真正请求失败且无旧数据时才显示错误空态，有旧数据时保留并提示。

## 安全模型

- Host 路由同源挂载在 `/toolscontrol`：仅 `health` 公开（只含插件标识）；`overview` / `mcp/probe` 先过官方 `connection.requestRejection` 信任门（认证 + Host/Origin/`sec-fetch-site`）。
- wire 载荷**永不携带** MCP env / headers / token / 命令 / URL 等敏感字段；Client 只做同源 `fetch`，不读取任何配置文件。
- Client 端不渲染任何敏感配置；无 Switch 等修改控件。

## 安装与卸载

### 通用 CLI（非 desktop profile）

```bash
# 本地开发安装（<profile> 填你自己的 DSH profile 名；路径必须是绝对路径）
dsh plugin --profile <profile> add link:/absolute/path/to/toolscontrol-dsh

# 从 npm 安装
dsh plugin --profile <profile> add @hanxu131/toolscontrol-dsh

# 卸载
dsh plugin --profile <profile> remove @hanxu131/toolscontrol-dsh
```

> **`desktop` 是 Desktop（Electron）应用独占的保留 profile**：通用 `dsh` CLI 对 `--profile desktop` 直接报错（rc.5 实证原文：`error: profile "desktop" is managed exclusively by the Electron application`）。上面的 `<profile>` 不要填 `desktop`；desktop profile 只能由 Desktop 应用自身管理（其自带的 carrier CLI 也要求先完整退出 Desktop 才能操作）。

### Desktop 应用内安装（官方文档实证；本插件未真机验收）

Desktop rc.5 自带的官方插件管理文档表明：插件页 **添加插件 / 安装第三方插件** 对话框接受**包名、Git 地址、压缩包或本地绝对路径**（spec 形式与 `pnpm add` 一致），且只接受声明了 bundle patch 的包——本插件的 `cordis.patch.yml` 满足该要求。因此本地 tarball / 目录理论上可经该对话框安装，但**此 GUI 流程对本插件尚未在真机 Desktop 上人工验收**，逐项确认清单见 [docs/DESKTOP-ACCEPTANCE.md](./docs/DESKTOP-ACCEPTANCE.md)。

安装即同时挂载 Host 半（`cordis.patch.yml` 插入 profile 组合）与 Client 半（`dsh.client` 清单，web 平台立即加载）。卸载后两个插件页标签随包消失。

## 构建与测试

```bash
pnpm install
pnpm build       # tsc 产出 Host lib/ + esbuild 产出 lib/client.js envelope
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest：host 行为 + client controller/视图模型 + 产物契约
pnpm smoke       # 离线产物冒烟：envelope 执行、两个 tab id、React external、不自动 probe
pnpm verify      # clean && build → typecheck → test → smoke
pnpm pack        # 发布包预览
```

要求：Node `^22.19.0 || >=24`，Desktop `>=0.2.1-rc.1 <0.3.0-0`。测试与 smoke 全部离线（注入伪造传输，不访问 Desktop、不访问网络）。

## 包结构

- `lib/index.js` — Host 半：晚绑定挂载 pluginInventory / skills / mcpManager / webServer+connection，注册 `/toolscontrol` 只读路由。
- `lib/client.js` — Client 半：`window.__ModuleLoader__.load({id, factory})` envelope；react / react-dom / cordis 等平台模块全部 external（宿主模块表提供），不捆绑第二份 React。
- `src/client/controller.ts` — 搜索/筛选/详情/工作区跟踪的公共控制器（测试接缝；不做 React 组件交互测试）。

## 真机手动验收

GUI 行为**未做自动化验收**：真机（Desktop 0.2.1-rc.5）手动检查清单见 [docs/DESKTOP-ACCEPTANCE.md](./docs/DESKTOP-ACCEPTANCE.md)。
