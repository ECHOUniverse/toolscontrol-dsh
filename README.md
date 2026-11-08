<div align="center">

# toolscontrol-dsh

**在 DSH Desktop 插件页集中查看 MCP 与 Skills 的只读总览**

`@hanxu131/toolscontrol-dsh` · v0.1.0

[![version](https://img.shields.io/github/package-json/v/ECHOUniverse/toolscontrol-dsh?label=version)](https://github.com/ECHOUniverse/toolscontrol-dsh)
[![node](https://img.shields.io/badge/node-%5E22.19.0%20%7C%7C%20%3E%3D24-339933.svg)](https://nodejs.org/)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![DSH Desktop](https://img.shields.io/badge/DSH%20Desktop-%3E%3D0.2.1--rc.1%20%3C0.3.0--0-blueviolet.svg)](https://github.com/ECHOUniverse/toolscontrol-dsh)

[English](./README.en.md) · [Desktop 验收清单](./docs/DESKTOP-ACCEPTANCE.md)

</div>

## 这是什么

`toolscontrol-dsh` 是 DSH Desktop 的独立只读插件。安装后，插件页「发现 / Discover」右侧会多出 **MCP** 和 **技能 / Skills** 两个标签，把当前 Desktop 里的 MCP 条目与 Skills 汇总到一处。

它主要回答三个问题：

- 当前 DSH profile 根级和各个 agent preset 里配置了哪些 MCP server，哪些在配置层已启用？
- 当前工作区、当前主会话的 preset 范围里能看见哪些 Skills，它们来自哪里，是否允许用户或模型调用？
- 同名条目为什么出现多次，哪个版本生效，哪些版本被覆盖？

**为什么有用**：不需要逐个翻配置文件或凭记忆判断。MCP 条目带作用域与来源标注，Skills 还带调用策略；跨作用域的同名条目分别展示，不会被合并成一个看起来“全局”的条目。

**边界**：只读总览。不启用或禁用 MCP，不安装插件，不改配置，不写文件；也不读取 `~/.cursor`、`~/.kimi-code`、`~/.config/mcp` 等外部 CLI 配置。

> **当前能力基线是 Desktop 0.2.1-rc.5。** MCP 连接状态一律显示「未知」，没有工具数量，也没有工具探测入口；这些能力要等官方托管服务可用后才会出现。详见下文「数据范围与当前限制」。

## 核心功能

| 能力 | MCP 标签 | 技能（Skills）标签 |
| --- | --- | --- |
| 搜索 | 按名称搜索 | 按名称、描述、适用场景搜索 |
| 筛选 | 启用状态（已启用 / 已禁用 / 全部，默认只看已启用）；连接状态（rc.5 下只有「未知」） | 来源（全部来源 + 各来源）；调用方式（全部 / 用户可调用 / 模型可调用 / 不可调用） |
| 条目作用域 | 标注「DSH profile 根级」或「Preset：<名称>」；同名跨作用域分别展示 | 同名被覆盖版本只在生效项详情中展示 |
| 行内详情 | 连接状态（rc.5 恒为「未知」）、作用域、来源、是否已配置 | 描述、适用场景、来源、路径、调用策略、被覆盖版本及覆盖来源 |
| 刷新 | 手动刷新 + 上次刷新时间；失败时保留旧快照并提示过期 | 同左 |
| 上下文 | — | 跟随当前工作区（`cwd`）与主 Session 的 preset scope；切换后自动重新获取 |
| 双语 | 中英文案跟随宿主语言；条目名不翻译 | 同左 |
| 键盘 | 行内展开为真实按钮（`aria-expanded` / `aria-controls`） | 同左 |

- **作用域不合并**：MCP 条目按「DSH profile 根级」或「Preset：<名称>」标注；同名跨作用域时是不同配置项，分别展示。
- **空态诚实**：只有 profile 根级与全部 presets 都被完整读取且没有 MCP server 时，才显示「未配置」；数据不完整时退回通用空态。
- **跟随上下文**：Skills 跟随当前工作区与主 Session 的 preset scope；切换工作区或会话后自动重新获取。

## 快速开始

### 环境要求

| 依赖 | 要求 |
| --- | --- |
| Node.js | `^22.19.0 \|\| >=24` |
| pnpm | 用于安装依赖与构建项目 |
| DSH / Desktop 引擎 | `>=0.2.1-rc.1 <0.3.0-0` |
| 手动验收基线 | Desktop `0.2.1-rc.5` |
| 通用 CLI | 可用的 `dsh` 命令（通过 CLI 安装时） |

### 通过通用 CLI 安装（非 desktop profile）

```bash
# 1. 克隆仓库
git clone https://github.com/ECHOUniverse/toolscontrol-dsh.git
cd toolscontrol-dsh

# 2. 安装依赖并构建
pnpm install
pnpm build

# 3. 用绝对路径把本地目录链接进 <profile>
dsh plugin --profile <profile> add link:/absolute/path/to/toolscontrol-dsh
```

> **`<profile>` 不能填 `desktop`。** `desktop` 是 Desktop（Electron）应用独占的保留 profile，通用 `dsh` CLI 会直接拒绝。desktop profile 只能由 Desktop 应用自身管理。

<details>
<summary>为什么通用 CLI 不能用 desktop profile？</summary>

rc.5 实测报错原文：

```text
error: profile "desktop" is managed exclusively by the Electron application
```

Desktop 自带的 carrier CLI 也要求先完整退出 Desktop 才能操作。

</details>

### 在 Desktop 应用内安装

插件页 →「添加插件 / 安装第三方插件」。Desktop rc.5 自带的官方文档说明：该对话框接受**包名、Git 地址、压缩包或本地绝对路径**（spec 形式与 `pnpm add` 一致），并且只接受声明了 bundle patch 的包；本插件的 `cordis.patch.yml` 满足这一条件。

> **尚未真机人工验收**：此 GUI 安装流程对本插件尚未在真实 Desktop 上逐项验证。逐项确认清单见 [docs/DESKTOP-ACCEPTANCE.md](./docs/DESKTOP-ACCEPTANCE.md)。

<details>
<summary>安装时实际挂载了什么？</summary>

安装会同时挂载两半：

- **Host 半**：`cordis.patch.yml` 把 `toolscontrol` 条目插入 profile 组合，注册 `/toolscontrol` 只读路由。
- **Client 半**：`dsh.client` 清单声明 web 平台并立即加载，向插件页注册 MCP 与 Skills 两个标签。

卸载后两个标签随包消失，`/toolscontrol/*` 路由不再可达。

</details>

### 使用入口

安装后打开插件页（侧栏 Plugins），在「发现 / Discover」右侧看到 **MCP** 与 **技能 / Skills**。标签文案跟随宿主语言。

- 有选中工作区时，Skills 顶部显示「当前工作区：…」，并按该 `cwd` 获取。
- 没有主 Session 时显示「未选中工作区 — 以下为全局技能，项目级目录未知」，只展示全局注册表，不猜默认目录。
- 有主会话但项目目录未知时，明确标注当前会话与 preset 范围，不冒充全局结果。

### 卸载

```bash
dsh plugin --profile <profile> remove @hanxu131/toolscontrol-dsh
```

也可以在 Desktop 插件页移除对应组合包。卸载后 MCP / 技能标签消失，`/toolscontrol/*` 路由不再可达。

## 数据范围与当前限制

### MCP：profile 根级 + presets

MCP 数据来自 `pluginInventory` 配置层（`mode: "config"`），合并两个组装面：

- **profile 根级** `entries`：当前 Desktop profile 根组合里的 Loader 条目，标注「DSH profile 根级」。
- **preset 组合** `agentPresets[].rows`：每个 agent preset 组合内声明的行，标注「Preset：<名称>」。当前 DSH 的会话 preset 层才是模型可见插件真正生效的位置，所以只在 preset 里配置的 MCP server 也必须出现。

处理规则：

- `(作用域, preset id, 条目名)` 相同才去重，被忽略的重复项数量写入页面 warnings；**不同作用域的同名条目不算重复**，分别展示。
- preset 行没有 Loader `entryId` 时回退模块名。
- `disabled` 是表达式时静态无法求值，标注「条件启用」，不宣称已启用或已禁用。
- `enabled` 只接受 boolean 或 `'conditional'`；缺失或其它类型不默认成已启用，该行跳过并给出 warning。
- 畸形清单（`agentPresets` 非数组、preset 缺 id、`rows` 非数组、行无法解析）逐项跳过并给出 warning，快照不整体失败。

### MCP：rc.5 能力边界

| 能力 | Desktop 0.2.1-rc.5 | 界面行为 |
| --- | --- | --- |
| 连接状态观测 | 不可用 | 每个条目一律显示「未知」，不以进程 / 加载状态冒充连接状态 |
| 工具数量 | 不可用 | 不显示 |
| 工具探测（probe） | 不可用 | 不显示「加载工具列表」按钮；页面展示能力降级说明，绝不自动探测 |

rc.5 下 MCP 条目的「来源」无法可靠确认，统一显示「未知」，不会伪造「全局」等具体来源。

只有在未来官方 `mcpManager` 托管模式（`mode: "managed"`）可用时，才会显示真实连接状态与工具数量；「加载工具列表」出现在行内详情中，并且只在用户点击后按名称发起 POST，不修改任何配置。**当前版本不具备这些能力。**

### 诚实空态

当 profile 根级与全部 presets 都被完整读取且确实没有 MCP server 时，空态明确显示：

> 当前 DSH profile / presets 未配置 MCP server（仅统计 DSH 内部数据源，未读取外部 CLI 配置）

这是「完整可读快照」的结论，不等于本机任何外部 CLI 里没有 MCP。任一数据来源不可用、组装面或条目无法解析时，快照带 `canAssertEmpty=false`，界面退化为通用空态并保留 warnings，不断言「未配置」。

### Skills：可见范围与被覆盖版本

- Skills 以当前主 Session 的 live Agent preset scope 作为会话级发现上下文，以左侧当前选中的工作区作为项目级发现上下文；无主会话时才退回全局范围。**可见不等同于已加载。**
- 主列表只展示生效 Skill；同名被覆盖版本只在该生效项的详情中显示，不会成为独立主行。
- **被覆盖版本不保证完整**：插件运行时、preset 与自定义目录来源的竞争版本无法完整枚举。宿主返回的枚举限制说明始终显示在「注意事项」中。
- 单来源失败不会让整页变空：有旧数据时保留并提示过期；真正请求失败且无旧数据时才显示错误空态。

### 明确不做的事

- 不启用或禁用 MCP，不安装或卸载 MCP server，不写配置、不写文件。
- 不读取 `~/.cursor`、`~/.kimi-code`、`~/.config/mcp` 等外部 CLI 配置，也不新增外部 MCP 适配器。
- 不在 wire 载荷中携带 MCP env / headers / token / command / URL。
- 不读取、不显示 Skill 正文内容。

## 安全模型

- Host 路由同源挂载在 `/toolscontrol`：`health` 是唯一公开端点，只含插件标识；`overview` / `mcp/probe` 先过官方 `connection.requestRejection` 信任门（认证 + Host / Origin / `sec-fetch-site`）。
- wire 载荷永不携带 MCP env / headers / token / command / URL 等敏感字段；Client 只做同源 `fetch`，不读取任何配置文件。
- MCP 数据只来自 DSH 自身组合（`pluginInventory`），不读取外部 CLI 配置。
- 客户端不渲染任何敏感配置，也没有 Switch 等修改控件；不存在写配置 / 写文件路由。
- 探测只在未来托管模式、由用户显式点击后按名称发起，不修改配置；rc.5 下没有探测入口。

## 本地开发

```bash
pnpm install
pnpm build       # tsc 产出 Host lib/ + esbuild 产出 lib/client.js envelope
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest：host 行为 + client controller/视图模型 + 产物契约
pnpm smoke       # 离线产物冒烟：envelope 执行、两个 tab id、React external、不自动 probe
pnpm verify      # clean → build → typecheck → test → smoke
pnpm pack        # 发布包预览
```

测试与 smoke 全部离线：注入伪造传输，不访问 Desktop、不访问网络。

## 项目结构

```text
.
├── src/
│   ├── index.ts              # Host 半入口：晚绑定挂载与路由注册
│   ├── host/                 # 聚合、MCP、Skills、路由、警告
│   ├── client/               # React 视图、controller、i18n、workspace 跟踪
│   ├── shared/protocol.ts    # 双端 wire 契约
│   └── client.tsx            # Client 半入口
├── scripts/
│   ├── build-client.mjs      # 构建 browser envelope
│   └── smoke.mjs             # 离线产物冒烟
├── docs/DESKTOP-ACCEPTANCE.md
├── cordis.patch.yml          # bundle patch：把 Host 半插入 profile 组合
├── lib/                      # 构建产物（pnpm build）
├── tests/                    # vitest
└── package.json
```

<details>
<summary>构建产物说明</summary>

- `lib/index.js` — Host 半：晚绑定挂载 pluginInventory / skills / mcpManager / webServer+connection，注册 `/toolscontrol` 只读路由。
- `lib/client.js` — Client 半：`window.__ModuleLoader__.load({id, factory})` envelope；react / react-dom / cordis 等平台模块全部 external（宿主模块表提供），不捆绑第二份 React。
- `src/client/controller.ts` — 搜索 / 筛选 / 详情 / 工作区跟踪的公共控制器（测试接缝；不做 React 组件交互测试）。

</details>

## 手动验收与获取帮助

- **GUI 行为与真实 Desktop 集成未自动验收**：自动化覆盖止于单元 / 行为测试、产物契约测试与离线 smoke。真机手动检查清单见 [docs/DESKTOP-ACCEPTANCE.md](./docs/DESKTOP-ACCEPTANCE.md)。
- **Desktop GUI 安装流程尚未真机人工验收**：该流程对本插件是首次验证项，不要把它当作已验证路径。
- **获取帮助**：在 [GitHub Issues](https://github.com/ECHOUniverse/toolscontrol-dsh/issues) 提问或报告问题。建议附上 Desktop 版本、安装方式、操作系统，以及页面「注意事项」中的 warnings 文案；请勿粘贴敏感配置。

## 维护者与 License

- 维护者：hanxu131
- 仓库：https://github.com/ECHOUniverse/toolscontrol-dsh
- 包名：`@hanxu131/toolscontrol-dsh`
- 当前版本：0.1.0
- License：Apache-2.0（依据 `package.json` 声明）
