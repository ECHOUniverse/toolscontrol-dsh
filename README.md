<div align="center">

# toolscontrol-dsh

**在 DSH Desktop 插件页集中查看 MCP 与 Skills 的配置，并按需手动探测 MCP 工具**

`@hanxu131/toolscontrol-dsh` · v0.1.0

[![version](https://img.shields.io/github/package-json/v/ECHOUniverse/toolscontrol-dsh?label=version)](https://github.com/ECHOUniverse/toolscontrol-dsh)
[![node](https://img.shields.io/badge/node-%5E22.19.0%20%7C%7C%20%3E%3D24-339933.svg)](https://nodejs.org/)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![DSH Desktop](https://img.shields.io/badge/DSH%20Desktop-%3E%3D0.2.1--rc.1%20%3C0.3.0--0-blueviolet.svg)](https://github.com/ECHOUniverse/toolscontrol-dsh)

[English](./README.en.md) · [Desktop 验收清单](./docs/DESKTOP-ACCEPTANCE.md)

</div>

## 这是什么

`toolscontrol-dsh` 是 DSH Desktop 的独立插件。安装后，插件页「发现 / Discover」右侧会多出 **MCP** 和 **技能 / Skills** 两个标签，把当前 Desktop 里的 MCP 条目与 Skills 汇总到一处。配置总览只读；MCP 工具探测只在用户显式操作时建立独立短期连接。

它主要回答四个问题：

- 当前 DSH profile 根级和各个 agent preset 里配置了哪些 MCP server，哪些在配置层已启用？
- 当前工作区、当前主会话的 preset 范围里能看见哪些 Skills，它们来自哪里，是否允许用户或模型调用？
- 同名条目为什么出现多次，哪个版本生效，哪些版本被覆盖？
- 某个已启用的 MCP 条目在声明配置下能否连上、能枚举到哪些工具？（这是手动探测的时点结果，不是实时连接状态。）

**为什么有用**：不需要逐个翻配置文件或凭记忆判断，也不必离开页面去单独试连。MCP 条目带作用域与来源，已启用且可探测的条目另有手动探测入口；Skills 还带调用策略。跨作用域的同名条目分别展示，不会被合并成一个看起来“全局”的条目。

**边界**：配置只读。不启用或禁用 MCP，不安装插件，不改配置，不写文件；也不读取 `~/.cursor`、`~/.kimi-code`、`~/.config/mcp` 等外部 CLI 配置。**连接探测并非零副作用**：用户显式探测时，插件会按条目声明的配置建立独立短期连接，可能发起网络请求；stdio 条目会启动短期子进程。未触发探测时不会发生这些行为。

> **当前能力基线与验收基线是 Desktop 0.2.2-rc.1。** 该版本对静态配置仍无法观测 MCP 真实连接状态，连接状态一律显示「未知」；连接探测只是独立的时点结果，不能替代连接状态。连接探测已实现并通过自动化构建、类型检查、测试与离线 smoke；真机验收进度见 [docs/DESKTOP-ACCEPTANCE.md](./docs/DESKTOP-ACCEPTANCE.md)。

## 核心功能

| 能力 | MCP 标签 | 技能（Skills）标签 |
| --- | --- | --- |
| 搜索 | 按名称搜索 | 按名称、描述、适用场景搜索 |
| 筛选 | 启用状态（已启用 / 已禁用 / 全部，默认只看已启用）；连接状态（rc.1 下只有「未知」） | 来源（全部来源 + 各来源）；调用方式（全部 / 用户可调用 / 模型可调用 / 不可调用） |
| 条目作用域 | 标注「DSH profile 根级」或「Preset：<名称>」；同名跨作用域分别展示 | 同名被覆盖版本只在生效项详情中展示 |
| 行内详情 | 连接状态（rc.1 恒为「未知」）、作用域、来源、是否已配置；仅已启用且可探测条目提供「探测」入口 | 描述、适用场景、来源、路径、调用策略、被覆盖版本及覆盖来源 |
| 连接探测 | 单条手动探测 + 对当前筛选结果「全部探测」；打开页面不自动探测；结果含时间、工具数量、可展开工具名或脱敏错误 | — |
| 探测结果 | 仅当前页面会话（非 DSH 会话）；与连接状态分开展示；不持久化 | — |
| 刷新 | 手动刷新 + 上次刷新时间；失败时保留旧快照并提示过期 | 同左 |
| 上下文 | — | 跟随当前工作区（`cwd`）与主 Session 的 preset scope；切换后自动重新获取 |
| 双语 | 中英文案跟随宿主语言；条目名不翻译 | 同左 |
| 键盘 | 行内展开为真实按钮（`aria-expanded` / `aria-controls`） | 同左 |

- **作用域不合并**：MCP 条目按「DSH profile 根级」或「Preset：<名称>」标注；同名跨作用域时是不同配置项，分别展示。
- **空态诚实**：只有 profile 根级与全部 presets 都被完整读取且没有 MCP server 时，才显示「未配置」；数据不完整时退回通用空态。
- **跟随上下文**：Skills 跟随当前工作区与主 Session 的 preset scope；切换工作区或会话后自动重新获取。
- **探测只由用户触发**：打开页面、刷新、切换筛选或工作区都不会自动探测；单条探测与「全部探测」都只针对已启用且可探测条目，全部探测的范围是当前筛选结果。
- **探测不是连接状态**：探测成功只说明当时按声明配置完成了握手与工具枚举，不代表 DSH 当前实例处于已连接状态；连接状态仍按运行时观测单独显示，rc.1 恒为「未知」。

## 快速开始

### 环境要求

| 依赖 | 要求 |
| --- | --- |
| Node.js | `^22.19.0 \|\| >=24` |
| pnpm | 用于安装依赖与构建项目 |
| DSH / Desktop 引擎（包声明下限） | `>=0.2.1-rc.1 <0.3.0-0` |
| 手动验收基线 | Desktop `0.2.2-rc.1`（非最低运行版本） |
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

此前 rc.5 实测报错原文：

```text
error: profile "desktop" is managed exclusively by the Electron application
```

Desktop 自带的 carrier CLI 也要求先完整退出 Desktop 才能操作。

</details>

### 在 Desktop 应用内安装

插件页 →「添加插件 / 安装第三方插件」。Desktop 自带的官方文档说明（rc.5 时确认）：该对话框接受**包名、Git 地址、压缩包或本地绝对路径**（spec 形式与 `pnpm add` 一致），并且只接受声明了 bundle patch 的包；本插件的 `cordis.patch.yml` 满足这一条件。

> **尚未真机人工验收**：此 GUI 安装流程对本插件尚未在真实 Desktop 上逐项验证。逐项确认清单见 [docs/DESKTOP-ACCEPTANCE.md](./docs/DESKTOP-ACCEPTANCE.md)。

<details>
<summary>安装时实际挂载了什么？</summary>

安装会同时挂载两半：

- **Host 半**：`cordis.patch.yml` 把 `toolscontrol` 条目插入 profile 组合，注册 `/toolscontrol` 路由（无写配置 / 写文件路由）。
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

配置总览的 MCP 数据来自 `pluginInventory` 配置层（`mode: "config"`），合并两个组装面：

- **profile 根级** `entries`：当前 Desktop profile 根组合里的 Loader 条目，标注「DSH profile 根级」。
- **preset 组合** `agentPresets[].rows`：每个 agent preset 组合内声明的行，标注「Preset：<名称>」。当前 DSH 的会话 preset 层才是模型可见插件真正生效的位置，所以只在 preset 里配置的 MCP server 也必须出现。

处理规则：

- `(作用域, preset id, 条目名)` 相同才去重，被忽略的重复项数量写入页面 warnings；**不同作用域的同名条目不算重复**，分别展示。
- preset 行没有 Loader `entryId` 时回退模块名。
- `disabled` 是表达式时静态无法求值，标注「条件启用」，按不可探测处理，不宣称已启用或已禁用。
- `enabled` 只接受 boolean 或 `'conditional'`；缺失或其它类型不默认成已启用，该行跳过并给出 warning。
- 畸形清单（`agentPresets` 非数组、preset 缺 id、`rows` 非数组、行无法解析）逐项跳过并给出 warning，快照不整体失败。

### MCP：rc.1 能力边界

| 能力 | Desktop 0.2.2-rc.1 | 界面行为 |
| --- | --- | --- |
| 连接状态观测 | 静态配置不可观测 | 每个条目一律显示「未知」，不以 fiberPhase、工具是否存在、插件加载状态或探测结果冒充连接状态 |
| 工具数量 | 无实时工具数量 | 只在手动连接探测的结果中显示本次枚举到的数量 |
| 连接探测 | 设计为可用；按声明配置独立建立短期连接 | 仅用户显式触发；打开页面绝不自动探测 |

rc.1 下 MCP 条目的「来源」仍无法可靠确认，统一显示「未知」，不会伪造「全局」等具体来源。连接探测所依赖的 DSH 内部面（loader / agentPresets 等）不是稳定公开 API；接口缺失时只降级探测，不影响配置总览，也不得据其存在推断连接状态。

### MCP：连接探测

**结果含义**：连接探测按条目声明的配置建立一条独立短期连接，完成 MCP 握手与工具枚举后即结束。握手 + 工具枚举成功即判定成功；没有 Tools 能力或工具数为 0 也算成功。结果是时点快照，不是连接状态，也不会随后台运行状态变化自动更新。

**触发方式**：

- 单条探测：在已启用且可探测条目的行内详情中显式点击「探测」。
- 全部探测：对当前筛选结果中的已启用且可探测条目逐个探测；范围随筛选变化，不包含已禁用或不可探测条目。
- 打开页面、刷新、切换筛选 / 工作区 / 会话都不会触发探测；任何位置都不出现自动探测。

**执行约束**：

- 单次探测 10 秒超时。
- 并发上限 2；同一条目已有探测在进行时忽略新的触发，不重复发起并发探测。
- 取消探测、离开页面、插件卸载都必须清理进行中的连接与 stdio 子进程。

**支持范围**：

- 传输：`streamable-http` 与 `stdio`；版本协商（`versionNegotiation`）使用 `auto`。
- `stdio` 条目会启动短期子进程；探测结束、取消、页面离开或插件卸载时必须终止，不留下常驻进程。

**结果展示与生命周期**：

- 结果只保留在当前页面会话（非 DSH 会话），离开页面后不保证保留，不写入配置、不持久化。
- 每条结果包含探测时间、工具数量，以及可展开的工具名；失败时显示脱敏后的错误。
- 探测结果与连接状态分开展示，不能把探测成功显示成「已连接」，也不能把探测失败显示成运行时「失败」。

**凭据与数据边界**：

- MCP 凭据只在 Host 内存中使用，不进入 Client DTO、日志、持久化或错误详情。
- Client 只按条目名称发起探测请求；env / headers / token / command / URL 等配置不进入 wire 载荷。

**实现依赖与降级**：

- 连接探测固定使用 `@modelcontextprotocol/client` 2.2.0，并读取 DSH 的 loader / agentPresets 内部面。
- 所需内部接口缺失、传输或配置不受支持、Preset 动态配置无法可靠求值时，该条目标为「不可探测」并说明原因；探测降级不影响 MCP 配置总览与其他条目。
- 上述内部面不是稳定公开 API；当前也没有稳定公开 API 提供 MCP 运行状态，不得以接口存在或探测成功冒充连接状态。

**不可探测的情形**：

- 已禁用条目。
- 所需内部接口缺失。
- 传输或配置不受支持。
- Preset 动态配置无法可靠求值。

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
- 工具探测仅用户显式点击；打开页面、刷新、切换筛选 / 工作区 / 会话都不发起探测，也没有后台巡检。
- 不持久化探测结果或凭据，也不把探测结果写成连接状态。
- 不读取、不显示 Skill 正文内容。

## 安全模型

- Host 路由同源挂载在 `/toolscontrol`：`health` 是唯一公开端点，只含插件标识；`overview` / `mcp/probe` 先过官方 `connection.requestRejection` 信任门（认证 + Host / Origin / `sec-fetch-site`）。
- wire 载荷永不携带 MCP env / headers / token / command / URL 等敏感字段；Client 只做同源 `fetch`，不读取任何配置文件，探测请求只含条目名称。
- MCP 凭据只在 Host 内存中使用，不进入 Client DTO、日志、持久化或错误详情；错误信息必须脱敏后再返回。
- 主动探测有外部副作用：可能发起网络请求，stdio 条目会启动短期子进程；10 秒超时、并发上限 2，取消 / 页面离开 / 插件卸载都会清理连接与子进程。探测不修改任何配置。
- 连接状态只来自 DSH 运行时观测；rc.1 无法观测时一律「未知」，不以 fiberPhase、工具存在、探测成功或插件加载状态冒充。
- MCP 配置数据只来自 DSH 自身组合（`pluginInventory`、loader / `agentPresets` 等），不读取外部 CLI 配置。
- 客户端不渲染任何敏感配置，也没有 Switch 等修改控件；不存在写配置 / 写文件路由。

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

测试与 smoke 设计为离线：注入伪造传输，不访问 Desktop、不访问网络。

## 项目结构

```text
.
├── src/
│   ├── index.ts              # Host 半入口：晚绑定挂载与路由注册
│   ├── host/                 # 聚合、MCP 配置与探测、Skills、路由、警告
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

- `lib/index.js` — Host 半：晚绑定挂载 pluginInventory / skills / webServer+connection，注册 `/toolscontrol` 路由（无写配置 / 写文件路由）。
- `lib/client.js` — Client 半：`window.__ModuleLoader__.load({id, factory})` envelope；react / react-dom / cordis 等平台模块全部 external（宿主模块表提供），不捆绑第二份 React。
- `src/client/controller.ts` — 搜索 / 筛选 / 详情 / 工作区跟踪的公共控制器（测试接缝；不做 React 组件交互测试）。

</details>

## 手动验收与获取帮助

- **GUI 行为与真实 Desktop 集成未自动验收**：自动化覆盖止于单元 / 行为测试、产物契约测试与离线 smoke。真机手动检查清单见 [docs/DESKTOP-ACCEPTANCE.md](./docs/DESKTOP-ACCEPTANCE.md)，验收基线为 Desktop 0.2.2-rc.1。
- **连接探测已有部分真机证据**：2026-11-11 截图确认 `include:mcp-anysearch` 的 streamable-http 手动探测成功并显示 5 个工具；其余条目类型、失败、取消和清理路径仍按清单逐项验收，未实际执行的验收项不应勾选。
- **Desktop GUI 安装流程尚未真机人工验收**：该流程对本插件是首次验证项，不要把它当作已验证路径。
- **获取帮助**：在 [GitHub Issues](https://github.com/ECHOUniverse/toolscontrol-dsh/issues) 提问或报告问题。建议附上 Desktop 版本、安装方式、操作系统，以及页面「注意事项」中的 warnings 文案；请勿粘贴敏感配置。

## 维护者与 License

- 维护者：hanxu131
- 仓库：https://github.com/ECHOUniverse/toolscontrol-dsh
- 包名：`@hanxu131/toolscontrol-dsh`
- 当前版本：0.1.0
- License：Apache-2.0（依据 `package.json` 声明）
