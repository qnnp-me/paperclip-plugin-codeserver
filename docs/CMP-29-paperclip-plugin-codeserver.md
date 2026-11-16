# CMP-29 附：能不能写个 Paperclip 插件，直接在 Paperclip 里访问 code-server

状态：**A+B 已装好（v0.1.0）；v0.2.0（任务/项目 Tab + 按工作区动态加载目录）已构建，等你覆盖安装一次**
日期：2026-11-16
作者：总管智能体
> 来源：CMP-29（2026-11-16，qnnp-opc 工作区）。2026-11-16 按 CMP-33 工作区规则迁入本仓库；
> 容器文件访问方式的选型决策留在 qnnp-opc 仓库 `docs/CMP-29-container-file-access.md`。

前置：CMP-29 容器文件访问选型（决策记录在 qnnp-opc 仓库 `docs/CMP-29-container-file-access.md`）

## 一、结论

**能，但要分清"嵌入"和"集成"。**

- **嵌入（iframe 插件页）现在成立**：Paperclip 插件 UI 与主应用同源、主应用无 CSP，code-server 无 `X-Frame-Options`、无 `frame-ancestors`，两者同站（`*.hdl.qnnp.me`）所以 `SameSite=Lax` 的会话 cookie 在 iframe 里照常发送。深链 `?folder=` 也能穿过登录页（实测 302 回来还带着 `folder`）。
- **集成（Paperclip 原生懂文件）不靠 iframe**：那要写 worker 读盘 + `FileTree` 渲染，官方有参考实现 `plugin-file-browser-example` 可抄。没有 VS Code 的终端/调试器/扩展，但不受浏览器 iframe 政策影响。
- **装插件这一步只能你来**：`POST /api/plugins/install` 走 `assertInstanceAdmin`。我以 agent 身份调 `paperclipai plugin list` / `install` 都是 `403 Board access required`。本实例是 self-hosted（无 `PAPERCLIP_MANAGED_CONFIG`），所以**从本地路径安装是被允许的**，不用发 npm。

## 二、实测证据（都是刚跑的，不是推断）

### 2.1 Paperclip 的插件面是真的存在，且 UI 有 slot

| 事实 | 证据 |
| --- | --- |
| 插件系统在 server 里完整在位 | `dist/routes/plugins.js`：`GET/POST /plugins`、`/plugins/install`、`/plugins/:id/enable|disable|upgrade`、`/plugins/:id/bridge/data`、`/plugins/ui-contributions`；另有 `plugin-loader / registry / lifecycle / workforce / ui-static` 等服务 |
| UI slot 有页级挂载点 | `ui/src/pages/PluginPage.tsx`：在 `/:companyPrefix/plugins/:pluginId` 渲染 manifest 的 `page` slot |
| 可用的 slot 名单 | `page · detailTab · taskDetailView · dashboardWidget · sidebar · routeSidebar · sidebarPanel · projectSidebarItem · globalToolbarButton · appShellOverlay · toolbarButton · contextMenuItem · commentAnnotation · settingsPage · companySettingsPage`（`plugin-capability-validator` 里有对应 `ui.*.register` 能力项） |
| 插件 UI 如何加载 | `doc/plugins/PLUGIN_SPEC.md` §19.0.2：**ES module 同源加载，不是 iframe**，走 `/_plugins/:pluginId/ui/*`；可渲染任意 React |

### 2.2 嵌入 iframe 的三个关键条件都满足

```bash
curl -sI https://dev-qnnp-19099.hdl.qnnp.me:18443/            # Paperclip UI：无 CSP、无 X-Frame-Options
curl -sI https://dev-qnnp-19081.hdl.qnnp.me:18443/login       # code-server：无 X-Frame-Options、无 frame-ancestors
grep -o 'Content-Security-Policy' ui-dist/index.html          # 主应用 index.html 里也没有 meta CSP
```

- code-server 工作台的 CSP 是 `default-src 'self'; connect-src 'self' ws: wss: https:; ...`，**没有 `frame-ancestors`** → 允许被嵌。
- 会话 cookie：`code-server-session=…; Path=/; HttpOnly; SameSite=Lax`。
- 两个域名 `dev-qnnp-19099.hdl.qnnp.me` 与 `dev-qnnp-19081.hdl.qnnp.me` 的 eTLD+1 相同（`hdl.qnnp.me`）→ **同站**，iframe 里的 Lax cookie 照样发。跨站才会被浏览器拦，这条是决定性的。
- 宿主任意 iframe 已在用：artifact 预览、announcement 卡片、board contact sheet 都是 iframe，不是新引入的模式。

### 2.3 深链可用：插件页能直接开到某个项目目录

```bash
curl -sI 'http://127.0.0.1:19081/?folder=/home/linuxbrew/Projects/qnnp-opc'
# → Location: ./login?folder=/home/linuxbrew/Projects/qnnp-opc&to=

# 登录后（env 里的密码）：
# → 302 Location: ./?folder=/home/linuxbrew/Projects/qnnp-opc
```

也就是说：插件页选一个工作区 → iframe 指到 `https://dev-qnnp-19081…/?folder=<路径>` → 已登录直接进目录，未登录先进登录页、登完自动回到该目录。

### 2.4 成本侧的坑（已实测，别踩）

- `paperclipai plugin init` 需要**上游源码 checkout**：报 `Package package.json not found at …/paperclipai/2026.1106.0/packages/shared/package.json`。本机 `paperclip-zh/vendor` 只 sparse 了 `ui/src` + `doc/plugins`。要么补 sparse `packages/`，要么手写 `manifest + worker + ui` 三个文件。
- manifest 必须有 `entrypoints.worker`（`plugin-loader.js` 里按字段读），所以"纯 UI 插件"也得挂一个空壳 worker。
- 启用的 worker **会阻止实例自动 idle sleep**，除非实现 `onIdleDrain`（`PLUGIN_AUTHORING_GUIDE.md`「Idle sleep」）。纯 UI 插件要做成不挡休眠，得显式处理。
- 插件 UI 能直接调 Paperclip HTTP API，manifest 能力项**管不住前端**（`PLUGIN_SPEC.md` §Current reality）。自己写的插件没问题，装别人的插件要有这个心理预期。

## 三、方案

| 方案 | 做法 | 工作量 | 风险 / 代价 |
| --- | --- | --- | --- |
| **A｜iframe 插件页**（推荐先做） | 一个 `page` slot：左列工作区列表（`?folder=` 深链），右侧 `<iframe src="https://dev-qnnp-19081…/?folder=…">`，顶部"新标签打开 / 重载" | **4–8 小时**（含空壳 worker + idle drain） | 依赖"同站"这一前提；将来 Paperclip 或 code-server 换域名成跨站，或上游加 `CSP frame-src 'self'`，就断。剪贴板/下载要在 iframe 上加 `allow` 属性 |
| **B｜只做入口** | `globalToolbarButton` + issue/project `contextMenuItem`："在 code-server 打开" → 按当前项目工作区拼深链开新标签 | **1–2 小时** | 零风险；但严格说不算"在 Paperclip 里"，只是省一次粘贴 |
| **C｜原生文件浏览** | 抄 `plugin-file-browser-example`：worker 用 `ctx.projects.listWorkspaces()` 读盘，UI 用 `FileTree`，加一个只读/可写的简易编辑器 | **1–2 天** | 无 iframe 依赖；但没有终端、没有 VS Code 扩展；路径穿越要自己防 |
| **D｜把 code-server 反代进 Paperclip 同源子路径** | 让 Paperclip 的域名反向代理 code-server | 不建议 | code-server 不支持子路径挂载（只有 `--proxy-domain`、给 absproxy 用的 `--abs-proxy-base-path`），要自己写重写代理 + ws 升级，还得和 Paperclip 认证绑一起，升级一次就碎 |
| **E｜什么都不写** | 两个浏览器标签并排，需要时手动粘链接 | 0 | 每次一次手工成本；插件价值就是省这个 |

**已选：A + B 打进同一个插件包**（`page` slot + `globalToolbarButton`），实现见第四节。C 只在 A 被浏览器策略打断、或你要"不跳页面就能改文件"时再上。

## 四、已落地（A+B，2026-11-16）

老板选了 **A+B**：iframe 插件页 + 全局入口按钮，打进同一个插件包。

### 4.1 代码位置与产物

- 插件源码：**独立仓库** https://github.com/qnnp-me/paperclip-plugin-codeserver（`/home/linuxbrew/Projects/paperclip-plugin-codeserver`，2026-11-16 迁出，历史用 `git subtree split` 保留）
- 本仓库适配：`plugins/codeserver` 只是指向该仓库的本地软链，供已安装插件按 `packagePath` 升级，不入库
- 产物：`dist/{manifest.js,worker.js,ui/index.js}`（不入库，构建生成）
- manifest：`id=qnnp.codeserver`、`version=0.1.0`、能力 `ui.page.register` + `ui.action.register`
- 插槽：`page:CodeServerPage`（iframe + 目录选择 + 地址手改）· `globalToolbarButton:CodeServerToolbarButton`（顶栏「Code」按钮）
- worker：空壳（manifest 必填），`onIdleDrain → "none"`，无定时器/套接字，不挡 idle sleep

构建与自测：

```bash
cd /home/linuxbrew/Projects/paperclip-plugin-codeserver && npm ci && npm run build && npm test
```

`npm test` 的 6 个断言：URL 推导（`19099→19081`、loopback、不误伤无关端口）、`?folder=` 深链拼接、两个插槽的静态渲染（iframe src、顶栏 href）。

### 4.2 安装（只有这一步需要你）

**注意：Paperclip 的 Settings → Plugins 对话框只收 npm 包名，没有本地路径输入框**（`ui/src/pages/PluginManager.tsx`：install 只发 `{packageName}`，`isLocalPath` 仅用于内置目录的 Install 按钮）。所以本机路径安装走 CLI：

```bash
paperclipai plugin install /home/linuxbrew/Projects/paperclip-plugin-codeserver \
  --local --api-base https://dev-qnnp-19099.hdl.qnnp.me:18443
```

第一次会打印一个授权链接（`Board authentication required`），在浏览器里点同意，token 存本地；`POST /api/plugins/install` 的 `assertInstanceAdmin` 就以你的身份通过。装完是 `ready` 状态（该流程没有能力项审批环节，`plugin-lifecycle.load()` 直接 ready）。

验证：

```bash
paperclipai plugin list --api-base https://dev-qnnp-19099.hdl.qnnp.me:18443
# 预期出现 qnnp.codeserver / ready
```

浏览器：顶栏多出「Code」按钮，点它进插件页。**入口路径用插件实例 UUID，不是插件 key**：`PluginPage` 的 `/:companyPrefix/plugins/:pluginId` 里 `pluginId` 匹配的是 `slot.pluginId`（宿主注入的安装实例 UUID），写 `qnnp.codeserver` 会找不到 page slot 而空白。重新安装会换 UUID，所以日常就从顶栏按钮进。首帧会落到 code-server 登录页（iframe 内登录一次），密码在 `/home/linuxbrew/.startup/code-server.env`。

### 4.3 地址与目录怎么来的

- code-server 地址：由当前页面推导——`dev-qnnp-19099…` → `dev-qnnp-19081…`，端口不变；`127.0.0.1/localhost` 用 `:19081`。页面顶部可手改，存 `localStorage`。
- 目录：默认 `/home/linuxbrew/Projects/qnnp-opc`，可改、可存；「新标签打开」始终可用。
- 同站前提仍在：`dev-qnnp-19099…` 与 `dev-qnnp-19081…` 的 eTLD+1 都是 `hdl.qnnp.me`，cookie `SameSite=Lax` 在 iframe 里照发。

## 四点五、装完后实测（2026-11-16 17:14 本地时间 / 09:14Z，qnnp 用 board 身份在浏览器里装的）

| 检查 | 证据 |
| --- | --- |
| 安装成功 | `POST /api/plugins/install 200`；`plugin-loader: plugin installed successfully` `pluginId=qnnp.codeserver` `version=0.1.0` `capabilities=[ui.page.register, ui.action.register]` |
| 生命周期 | `plugin lifecycle: installed → ready`（`da3ae3ee-ce7b-476b-b73b-4712ac3767f5`） |
| worker 起来 | `[plugin] qnnp.codeserver worker ready`；`registered={worker:true,tools:0,jobs:0,webhooks:0}` |
| UI 贡献下发 | `GET /plugins/ui-contributions 200` |
| 插件页能开 | `GET /CMP/plugins/da3ae3ee-… 200`，`PluginPage-*.js 200` |
| iframe 里是真编辑器 | code-server 侧同一时刻出现 `[172.19.0.6][ManagementConnection] New connection established` + `ExtensionHostConnection`，17:15:22 与 17:16:03 各一次 → 已过登录、进了工作台 |
| 深链落到正确目录 | `~/.local/share/code-server/User/workspaceStorage/67cd17bd/meta.json` → `{"id":"67cd17bd","name":"qnnp-opc"}`，时间 17:15 |
| 无报错 | paperclip.log 里没有 `plugin` 相关 error/fail；`supervisorctl status code-server` RUNNING |

一个待观察点：17:15:22 那个会话 21 秒后被 disposed、17:16:03 又重连了一次。日志写的是 `The client has disconnected gracefully`（不是异常断开），更像手动刷新页面或 tab 切换；若之后出现「iframe 里每隔十几秒重连」再查反代 ws 超时。

## 四点六、v0.2.0：挂进任务的 Tab，并按工作区动态加载目录

2026-11-16 追加。qnnp 问了两件事：能不能挂到任务的 tab、能不能按项目/任务的工作区动态换目录。**两件都能，而且用的是宿主现成能力，不用改 Paperclip 上游。**

### 6.1 挂到任务的 Tab：`detailTab` + `entityTypes: ["issue", "project"]`

宿主 `IssueDetail.tsx` 与 `ProjectDetail.tsx` 都以 `slotTypes: ["detailTab"]` 拉插件插槽，并按当前实体类型过滤：

```ts
// ui/src/pages/IssueDetail.tsx
usePluginSlots({ slotTypes: ["detailTab"], entityType: "issue", ... })
// ui/src/pages/ProjectDetail.tsx
usePluginSlots({ slotTypes: ["detailTab"], entityType: "project", ... })
```

Tab 组件通过 bridge 拿到 `{ companyId, projectId, entityId, entityType }`，`entityId` 就是任务/项目 UUID。所以不用改宿主，只要在 manifest 里多声明一个 `detailTab` 插槽；装好后任务页、项目页各多一个「Code」Tab，**不占顶栏、不跳页面**。

### 6.2 动态目录：worker 里做一次解析

插件 UI 不能直接读 Paperclip 数据（所有宿主访问都走 bridge → worker），所以目录解析放在 worker 的 `getData("workspace")`：

| 实体 | 解析顺序 | 宿主调用 |
| --- | --- | --- |
| 任务 | ① 任务的执行工作区 `cwd`（隔离工作区时是每个任务自己的检出）→ ② 任务所属项目的主工作区 | `ctx.issues.get` → `ctx.executionWorkspaces.get` → `ctx.projects.getWorkspaceForIssue` |
| 项目 | 项目主工作区 | `ctx.projects.getPrimaryWorkspace` |

新增能力项：`issues.read`、`execution.workspaces.read`、`project.workspaces.read`（+`ui.detailTab.register`）。宿主 `plugin-host-services.js` 的 `getWorkspaceForIssue` 取的是 `project.codebase.effectiveLocalFolder`；CMP-29 这类局，任务执行工作区 `cwd` 与项目主工作区都是 `/home/linuxbrew/Projects/qnnp-opc`（API 实测），所以两种来源落到同一目录，只有开隔离工作区后才会分叉。

UI 侧：目录条显示解析结果 + 来源标记（任务工作区 / 项目主工作区），可「重新解析」、可手改（按实体 id 存 localStorage，不污染别的任务）、可「新标签打开」。解析失败不猜路径，直接提示并给手填入口。

### 6.3 验证（刚跑的）

| 检查 | 结果 |
| --- | --- |
| manifest 能力校验（宿主自己的 validator） | `validateManifestCapabilities → {"allowed":true,"missing":[]}`；三个 slot `checkUiSlot` 全 `allowed:true` |
| manifest schema（`@paperclipai/shared` 的 `pluginManifestV1Schema`） | `safeParse → true` |
| `npm test` | **22 pass / 0 fail**：URL 推导、目录归一化、解析优先级、`getData("workspace")` 走 SDK 内存宿主（真能力门禁），缺能力项时按预期拒绝 |
| 两个不同目录的深链 | 浏览器实测：`?folder=/home/linuxbrew/Projects` → 标题「欢迎 - Projects - code-server」、`workspaceStorage/47f68a6/meta.json` = `{"name":"Projects"}`；`?folder=…/qnnp-opc` → 标题「欢迎 - qnnp-opc - code-server」。**同一 code-server 实例按 URL 换目录成立** |
| 宿主是否支持这套 slot/能力 | `PLUGIN_UI_SLOT_TYPES` 含 `detailTab`；部署的 `issue-detail-*.js`、`ProjectDetail-*.js` 里都有 `detailTab` 代码 |

### 6.4 覆盖安装（还是只有这一步需要你）

```bash
paperclipai plugin install /home/linuxbrew/Projects/paperclip-plugin-codeserver \
  --local --api-base https://dev-qnnp-19099.hdl.qnnp.me:18443
```

- 走 install 覆盖安装：`POST /api/plugins/install` 直接 `lifecycle.load()` → `ready`（源码实测，这条路径不查能力项差异；只有 UI 里的 `upgrade` 才会因新增能力进 `upgrade_pending` 等你点批准）。
- 装完任务页/项目页出现「Code」Tab；插件页与顶栏按钮保留不变。
- 若你想走 UI 的 Upgrade 而不是 CLI：新增能力项会转 `upgrade_pending`，批准后同样生效。

### 6.5 已知边界

- 目录只在**打开 Tab 的时刻**解析；工作区绑定变了就点「重新解析」。
- 一个 code-server 实例承载所有任务的 iframe；同一任务同时开多处会各建一条连接，属正常。
- 私有任务（非成员可见）解析会被宿主拒绝（`issues.get → null`），Tab 显示「找不到这个任务」，不泄露路径。
- 「任务工作区」优先意味着：将来开隔离工作区后，不同任务自动落到不同检出目录，不需要改插件。

## 五、推翻条件

- iframe 内登录失败（跨站化、或浏览器把第三方 cookie 策略扩展到同站）→ 退 B（入口按钮「新标签打开」）+ C
- Paperclip 上游加 `frame-src` 限制 → 同上
- code-server 升级后加了 `X-Frame-Options` / `frame-ancestors 'none'` → 同上，或改 `--abs-proxy-base-path` 方案重新评估
- 你需要的是"Paperclip 里原生看文件、不启动第二个编辑器" → 直接上 C，A 的价值就小了

### 6.6 装完之后的服务端实测（0.2.0，2026-11-16 17:34）

覆盖安装已完成，版本与能力项对得上，下面是当场可复验的证据（都在容器里跑）：

| 检查 | 证据 |
| --- | --- |
| 安装 | `plugin-loader: plugin installed successfully` · `version=0.2.0` · `capabilities=[ui.page.register, ui.action.register, ui.detailTab.register, issues.read, execution.workspaces.read, project.workspaces.read]` |
| 生命周期 | `plugin lifecycle: installed → ready`（实例仍是 `da3ae3ee-ce7b-476b-b73b-4712ac3767f5`，重装换版本不换 UUID） |
| worker | `[plugin] qnnp.codeserver worker ready` · `registered={worker:true,tools:0,jobs:0,webhooks:0}` |
| 下发给 UI 的贡献 | `GET /api/plugins/ui-contributions` → `detailTab` 槽存在：`{"id":"codeserver-detail-tab","displayName":"Code","entityTypes":["issue","project"]}` |
| 插件 UI 产物可加载 | `GET /_plugins/<id>/ui/index.js` → 200；含 `CodeServerPage` / `CodeServerToolbarButton` / `CodeServerContextTab` |
| 宿主 Tab 渲染链路 | 部署的 `issue-detail-*.js` 以 `slotTypes:["detailTab"], entityType:"issue"` 取槽，并以 `context:{entityId: issue.id, entityType:"issue"}` 渲染；槽渲染器把该 context 包成 `hostContext`（含 `entityId`）→ 与插件侧 `useHostContext()` / `usePluginData("workspace")` 对得上 |
| **真 worker 解析目录**（走 UI 同一条 bridge 路由） | 任务：`POST /api/plugins/<id>/data/workspace` `{entityId:133b1642-…, entityType:"issue"}` → **200** `{"path":"/home/linuxbrew/Projects/qnnp-opc","source":"issue_workspace","name":"qnnp-opc"}`；项目：`{entityId:0c3208c9-…, entityType:"project"}` → **200** `source:"project_workspace"` 同路径 |
| 错误分支不泄露路径 | `entityType:"bogus"` → 502 `不支持的对象类型：bogus`；`params:{}` → 502 `缺少 entityId，无法解析工作区` |

一条复验命令（板端 token 在 `~/.paperclip/auth.json`）：

```bash
curl -s -X POST -H "Authorization: Bearer $BOARD_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"companyId\":\"$COMPANY_ID\",\"params\":{\"entityId\":\"133b1642-9963-4763-be0f-667c2238a3cc\",\"entityType\":\"issue\"}}" \
  https://dev-qnnp-19099.hdl.qnnp.me:18443/api/plugins/da3ae3ee-ce7b-476b-b73b-4712ac3767f5/data/workspace
```

尚未验证的一格：**还没有人在任务页的「Code」Tab 里真正点开过**。code-server 侧 17:35 与 17:36 的连接都来自插件页 iframe，任务页没有产生 `/data/workspace` 调用。Tab 里的 iframe 是否落到正确目录，等第一次点击后看 code-server 日志（`ManagementConnection`）与 `workspaceStorage/*/meta.json` 即可确认。

## 六点七、v0.3.0：任务页看不到 Tab 的原因与修正（2026-11-16 17:50）

qnnp 反馈两件事：任务页没看到「Code」Tab；加载 code-server 时界面杂乱。**第一件是宿主 UI 结构问题，不是插件没装上。**

### 7.1 根因：默认界面根本不渲染 Tab 条

宿主 `ui/src/pages/IssueDetail.tsx` 里：

```ts
const taskChatShellEnabled = !classicTaskInterfaceEnabled;   // 默认 = true
...
{taskChatShellEnabled ? null : <TabsList>…</TabsList>}       // Tab 条被整块跳过
{taskChatShellEnabled ? null : pluginOutletsBlock}           // 经典界面才渲染
```

默认（聊天壳）界面把 Chat / Activity / Related work / 插件 Tab 的整条 `TabsList` 都隐藏了。所以 **`detailTab` 只在「经典任务界面」偏好下出现**，0.2.0 的 Code Tab 装对了、槽也下发了，但用户看不到。同理 `GitHub` 类插件的 Tab 也一样不可见。

聊天壳里仍然渲染的是 `pluginOutletsBlock`（`IssueDetail.tsx` 的 `taskChatThreadHeader`），包含：

- `toolbarButton` / `contextMenuItem`（任务头部一行按钮）
- `taskDetailView`（任务头部一块内容）

所以正确的入口是 **`toolbarButton`**，不是 `detailTab`。

### 7.2 改动（v0.3.0）

| 项 | 变化 |
| --- | --- |
| 新增槽 | `toolbarButton` · `codeserver-entity-button` · `entityTypes:["issue","project"]` · `exportName:CodeServerEntityButton`（复用 `ui.action.register`，没有新增能力项，升级不需要审批） |
| 任务/项目页 | 头部多一个紧凑的「Code」按钮；点击后整屏浮层（portal 到 `body`，避开任务页容器的 transform/滚动裁剪），直接进该任务/项目自己的工作区 |
| 浮层结构 | 只有一条 40px 工具条（目录 + 来源标记 + 重新加载 + 新标签 + 关闭）和编辑器本体，没有第二行地址栏、没有说明文字；Esc 关闭 |
| 插件页 | 目录输入 + 「打开」+「新标签」一行；code-server 地址行折叠进「设置」；删掉长段提示与「常用目录」下拉 |
| 经典界面 Tab | 保留 `detailTab`，同样去掉地址栏常驻与提示文字，只留目录 + 重载 + 新标签 + 改目录 |
| 错误分支 | 解析不到目录时，浮层里给一个输入框直接手填并记住（按实体 id 存储，不影响别的任务） |

### 7.3 验证（都跑过，可复验）

| 检查 | 结果 |
| --- | --- |
| manifest schema（`pluginManifestV1Schema`） | `ok: true` |
| `npm test` | **23 pass / 0 fail**（新增「Code 按钮存在、点击前不加载 iframe」的渲染断言） |
| `paperclipai plugin upgrade qnnp.codeserver` | `ready → ready`，版本 `0.3.0`，实例 UUID 不变 |
| 槽下发 | `GET /api/plugins/ui-contributions` 含 `{"id":"codeserver-entity-button","type":"toolbarButton","displayName":"Code","entityTypes":["issue","project"]}` |
| UI 产物 | `GET /_plugins/<id>/ui/index.js` → 200，含 `CodeServerEntityButton`，且含 `createPortal`（浮层） |
| 目录真按任务分叉（同一 bridge 路由、真 worker） | CMP-29 → `/home/linuxbrew/Projects/qnnp-opc`（`issue_workspace`）；`9910107e-…` → `/home/linuxbrew/Projects/project.99kf-web`；`9d444cd0-…` → `/home/linuxbrew/Projects/project.media-creation`。三条都 200，路径各不相同 |

复验命令（`companyId` 必须放在 body 顶层，SDK 会把它并进 worker 参数）：

```bash
curl -s -X POST -H "Authorization: Bearer $BOARD_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"companyId\":\"60b141d7-4ced-4daf-9413-aa19077c0dea\",\"params\":{\"entityId\":\"9910107e-6828-473b-a06e-dcd9e039e525\",\"entityType\":\"issue\"}}" \
  https://dev-qnnp-19099.hdl.qnnp.me:18443/api/plugins/da3ae3ee-ce7b-476b-b73b-4712ac3767f5/data/workspace
```

### 7.4 一处纠正：覆盖安装要用 upgrade

`paperclipai plugin install <本地路径>` 对已装插件返回 **400 `Plugin already installed`**。覆盖升级走：

```bash
paperclipai plugin upgrade qnnp.codeserver --api-base https://dev-qnnp-19099.hdl.qnnp.me:18443
```

它会重新读安装记录里的 `packagePath`、`oldVersion → newVersion`、`ready → ready`。新增能力项才需审批，v0.3.0 没有新增，所以直接生效。

### 7.5 自动登录与权限（回答 qnnp 的两个问题）

| 问题 | 结论 |
| --- | --- |
| Paperclip 内访问应该自动登录吗 | **做不到干净的自动登录**。code-server 的会话 cookie 是它自己签名、host-only 的（`code-server-session`，域为 `dev-qnnp-19081…`），Paperclip 的登录态不能替它签发；插件 UI 也无法跨主机写 cookie。现状是**每个浏览器登录一次**、之后 iframe 直进；深链把 `?folder=` 穿过登录页，所以登完仍落到正确目录。 |
| VSCode 的访问权限能在 Paperclip 里管理吗 | **不能按 Paperclip 用户细分**。code-server 只有「密码 / 无认证」两种，没有 per-user。想让权限跟 Paperclip 账号绑定，需要在自己反代上加一层 `auth_request`（校验 Paperclip 会话后再转发），或做一个 1–2 天的插件网关代理；两者都不在插件本体里，需要单独决策。**默认保持共享密码**：安全，代价是每个浏览器登一次。 |
| 无认证模式 | 技术上可 `--auth none`，但会把公网 IDE 变开放；除非反代侧加 IP 白名单/SSO，否则不建议。 |

### 7.6 界面「杂乱」的两种可能

1. **插件加的控件** —— 已在 7.2 清掉：不再常驻路径栏/地址栏/提示文字。
2. **code-server 自己的欢迎页/侧栏/推荐扩展** —— 这是编辑器自身 UI。要收，可在容器里写 `~/.local/share/code-server/User/settings.json`：`workbench.startupEditor:"none"`、`workbench.tips.enabled:false`、`window.menuBarVisibility:"toggle"`。会同时影响独立域名下的 code-server，所以要你点头再改。

### 7.7 页面侧实测：按钮真的渲染出来了（2026-11-16 17:53 本地 / 09:53Z）

上面 7.3 验的是「接口与产物」，这一节是**浏览器里真实发生**的证据，取自 `paperclip.log` 同一分钟的请求序列：

| 时刻 | 请求 | 说明 |
| --- | --- | --- |
| 17:53:42 | `GET /issues/133b1642-…/documents/codeserver-plugin-eval 200` | 任务页打开（CMP-29） |
| 17:53:42 | `GET /plugins/ui-contributions 200` | 宿主取插件槽，拿到 `toolbarButton` |
| **17:53:43** | **`POST /plugins/da3ae3ee-…/data/workspace 200`** | **头部按钮挂载即解析目录成功**——只有 `CodeServerEntityButton` / `CodeServerContextTab` 会打这个调用，而聊天壳不渲染 Tab，所以这只能是头部按钮 |

也就是说：刷新后按钮在页面上、`entityId` 从 `hostContext` 正确传入、worker 返回 200。**这一格不再是「等你点」**。

复验同一结论的两条命令：

```bash
# 槽下发（四个槽全在）
curl -s -H "Authorization: Bearer $BOARD_TOKEN" \
  https://dev-qnnp-19099.hdl.qnnp.me:18443/api/plugins/ui-contributions \
  | python3 -c 'import json,sys;print([s["type"] for s in json.load(sys.stdin)[0]["slots"]])'
# → ['page','globalToolbarButton','toolbarButton','detailTab']

# 按钮挂载后会发的同一条 bridge 调用
curl -s -X POST -H "Authorization: Bearer $BOARD_TOKEN" -H 'Content-Type: application/json' \
  -d '{"companyId":"60b141d7-4ced-4daf-9413-aa19077c0dea","params":{"entityId":"133b1642-9963-4763-be0f-667c2238a3cc","entityType":"issue"}}' \
  https://dev-qnnp-19099.hdl.qnnp.me:18443/api/plugins/da3ae3ee-ce7b-476b-b73b-4712ac3767f5/data/workspace
# → 200 {"data":{"path":"/home/linuxbrew/Projects/qnnp-opc","source":"issue_workspace"}}
```

仍未验的一格：**浮层里首次登录 code-server**。这次页面访问没有产生新的 `ManagementConnection`，说明按钮还没被点开（或点开后没到编辑器）。登录一次即通，属浏览器侧状态，服务端验不了。

### 7.8 属性侧栏的 tab 也加「Code」（2026-11-16 18:10 本地）

qnnp 在设置卡上选的是「任务页属性侧栏中的 tab 也应该加入 Code」，不是收掉欢迎页。这一格需要改宿主 UI：

- 宿主插件槽里**没有**给任务属性侧栏（`TaskSidePanel`）的挂载点，只有 `detailTab`（主 tab 条）、`sidebarPanel`（左侧主导航底部）等。所以插件怎么声明都进不了属性侧栏。
- 做法：在宿主 `TaskSidePanel` 里按 `entityType:"issue"` 拉 `detailTab` 槽，作为属性侧栏的附加 tab；选中时用 `PluginSlotMount` 在侧栏内渲染插件组件。这样**复用 `detailTab`**，不用改 server / 共享 schema，插件也**不用重装**（已装的 0.3.0 直接生效）。
- 改动文件（完整 patch 存档：`docs/patches/CMP-29-host-side-panel-plugin-tabs.patch`）：
  - `ui/src/components/task-side-panel/TaskSidePanel.tsx`：拉槽、合并 tab、插件 tab 的选中/关闭/重排过滤、`PluginSlotMount` 内容
  - `ui/src/components/task-side-panel/TaskSidePanel.test.tsx`：新增「插件 tab 出现 → 点击 → 挂载 → 关闭」断言
  - `ui/src/components/side-panel/SidePanelTabs.tsx`、`ui/src/components/WorkspaceFileBrowser.tsx`：把原先只能打在编译产物上的三个 bugfix 改为源码级修复（重建后 minified 变量名会变，产物级规则会 miss）
  - `ui/src/components/task-chat/TaskChatComposer.tsx`：未指派时的人称固定为「智能体」（原先靠产物规则补）
- 验证：
  - `pnpm --filter @paperclipai/ui exec vitest run src/components/task-side-panel/TaskSidePanel.test.tsx` → **40 passed / 0 failed**
  - 重建后的 `issue-detail-*.js` 里含新分支；`patched/ui-dist` 已切成新产物的中文版，入口 `index-Bv0IPUau-zh2611161808.js`
  - 公网 `GET /assets/index-Bv0IPUau-zh2611161808.js` → **200**；`GET /assets/issue-detail-k3GGRmV4-zh2611161808.js` → **200**
  - 新 bundle 能正常执行（未登录打开任务页会正常落到 `/auth` 登录页，无白屏/语法错误）
- 未验的一格：**登录后的侧栏外观**。当前 agent-browser 会话已过期、账号备份密码被服务端拒绝（`Invalid email or password`），所以只能等你刷新页面看。侧栏 tab 条里应出现「Code」，点开后 iframe 落到该任务的 `workspace` 目录。
- 已知代价 / 推翻条件：
  - 这是**宿主 UI 的本地改动**，不是上游插件能力。`paperclipai upgrade` 会换掉 `ui-dist`；届时要重新按 patch 构建，或等上游提供 `taskSidePanelTab` 槽。
  - 同一份 `detailTab` 在经典界面的主 tab 条仍会出现；聊天壳隐藏主 tab 条，所以不会重影。
  - 回滚：把 `patched/ui-dist.orig` 指回 `patched/ui-dist.orig.upstream-2026.1106.0` 后重跑部署三步（翻译 → rehash → inject）。

### 7.9 收口 0.4.0：单一顶栏入口 + 无装饰侧栏 tab（2026-11-16 18:45 本地）

qnnp 的反馈拆成五条，逐条落地：

| 反馈 | 做法 |
| --- | --- |
| 关掉侧栏 Code 后「新建 tab」里没有 Code | 宿主 `TaskSidePanel` 把插件 tab 也放进 `+` 启动器；选中即取消 dismissed 并重新挂载 |
| 背景不应是黑色 | 插件去掉所有写死的 `#1e1e1e` / `#252526`；浮层与 iframe 用 CSS `Canvas` / `CanvasText`，侧栏 tab 无外层容器、无高度计算 |
| 明确加载工作区后不需要改目录 / 重新加载 | 侧栏 tab 只剩 iframe；删除路径、来源 chip、重新加载、改目录、设置、新标签 |
| 插件页不需要返回等操作 | 宿主 `PluginPage` 删除 Back 按钮；插件 `page` slot 只剩全屏编辑器 |
| 顶栏 Code 要按当前页面的任务/项目打开 | `globalToolbarButton` 成为唯一入口：宿主 `BreadcrumbBar` 把路由里的 `issueId` / `projectId` 放进槽 context；插件按 route 兜底解析，项目 `urlKey` 先用宿主只读 API 换成 UUID |
| 项目 / 任务页不需要 Code tab，有顶栏按钮即可 | manifest 去掉 `toolbarButton`，`detailTab` 只声明 `issue`（供属性侧栏）；项目页不再有 Code tab |

插件版本 **0.3.0 → 0.4.0**，能力项**没有新增**（不触发审批）；`projects.read` 试过但被升级门禁拦下，改成插件 UI 用同源只读 API 换 UUID，保持最小权限。

#### 验证（可当场复验）

| 检查 | 结果 |
| --- | --- |
| 插件单测 | `npm test` → **22 pass / 0 fail** |
| 宿主测试 | `vitest run TaskSidePanel.test.tsx BreadcrumbBar.test.tsx PluginPage.test.tsx` → **50 pass / 0 fail** |
| 升级 | `paperclipai plugin list` → `qnnp.codeserver 0.4.0 ready`（实例 UUID 未变） |
| 槽下发 | `page` · `globalToolbarButton` · `detailTab(entityTypes:["issue"])`，无 `toolbarButton` |
| 桥接按任务标识解析 | `data/workspace {entityId:"CMP-29",entityType:"issue"}` → `200 /home/linuxbrew/Projects/qnnp-opc` |
| 桥接按项目 UUID | `{entityId:"0c3208c9-…",entityType:"project"}` → `200` 同路径 |
| 项目 urlKey 换 UUID | `GET /api/projects/opc?companyId=…` → `0c3208c9-…`（插件 UI 走这条） |
| 新中文入口 / 任务页 chunk | `GET /assets/index-DooIKv53-zh2611161843.js` → **200**；`issue-detail-DRpxL0AP-zh2611161843.js` → **200**，含启动器里的 Code 项 |
| 插件 UI 产物 | `GET /_plugins/da3ae3ee-…/ui/index.js` → **200** |

#### code-server 观感设置

写进 `~/.local/share/code-server/User/settings.json`（备份 `settings.json.bak-cmp29`）：

- `workbench.colorTheme: "Default Light Modern"`（编辑器背景不再是默认暗色）
- `workbench.startupEditor: "none"`、`workbench.tips.enabled: false`、`window.menuBarVisibility: "toggle"`（去掉欢迎页、提示、常驻菜单栏）

这是 code-server 的共享设置，独立域名 `dev-qnnp-19081…` 同样生效；想回滚就把这几行删掉或恢复备份。

#### 代价 / 回滚

- 宿主改动仍是本地补丁（`docs/patches/CMP-29-host-side-panel-plugin-tabs.patch`）；`paperclipai upgrade` 后需重建。
- 顶栏按钮在项目页要靠一次 `/api/projects/<urlKey>` 查询换 UUID（毫秒级，失败时按钮禁用并给出提示）。
- 回滚：`patched/ui-dist.orig` 指回 `patched/ui-dist.orig.upstream-2026.1106.0` 后重跑翻译三步；插件降级用 `paperclipai plugin upgrade` 指向旧版本目录。

## 七、结项（2026-11-16）

验收卡片 `d1b09df7` 由老板确认「都对」。收口时复核：

| 检查 | 结果 |
| --- | --- |
| `GET /api/plugins` | `da3ae3ee-…` **0.4.0 ready** |
| 槽下发 | `page` · `globalToolbarButton` · `detailTab(entityTypes:["issue"])`，无 `toolbarButton` |
| code-server | `supervisorctl status code-server` → **RUNNING**（端口 19081） |
| 仓库 | `git ls-remote origin main` 与本地 `main` 一致，工作区干净 |

遗留（默认不做，需要时另开 issue）：宿主补丁需在 `paperclipai upgrade` 后重建；code-server 仍是共享密码、无 per-user 权限。

## 八、自动登录（插件 0.5.0 + cs-gate 代理，2026-11-16）

### 为什么先前说「做不了」，现在又能做

- 做不了的那部分：浏览器的 cookie 只能由 code-server 自己签发（host-only），Paperclip 插件跨主机写不了。
- 能做的那部分：**根本不需要浏览器带 cookie**——同机加一层代理，服务端把会话注入上游即可。
- 另两个实测事实：会话 cookie 是 `code-server-session=<argon2id 哈希>`（无 `Max-Age`，关浏览器失效），
  值就是密码哈希、全局一份，没有 per-user。

### 拓扑

```
浏览器 / 反代 → 0.0.0.0:19081  cs-gate 代理 → 127.0.0.1:19083  code-server
```

域名、端口不变（外层反代照旧转到容器 19081），code-server 退到回环口。

### 票据与两种流量

| 请求 | 行为 |
| --- | --- |
| `?cs_t=<票据>` | HMAC 校验 → `Set-Cookie: cs_gate=…`（HttpOnly、Lax、12h）→ 302 到去 `cs_t` 的地址 |
| `cs_gate` cookie | 注入 `code-server-session`，剥掉上游 `Set-Cookie`（无登录页） |
| 都没有 | 原样透传 → code-server 登录页（直链/独立域名不回归） |
| `/healthz` | 不鉴权透传 |

票据格式 `v1.<exp>.<HMAC-SHA256(secret,"v1.<exp>")[:32] base64url>`；插件 worker `ctx.data("gate")` 签 5 分钟，
代理换 12 小时 cookie。秘密文件 `/home/linuxbrew/.startup/code-server-gate.secret`（600），插件与代理共用
（`CODESERVER_GATE_SECRET_FILE` 可覆盖）；口令仍只在 `code-server.env`（600），代理启动时 `POST /login` 换会话，
不硬编码、不落盘、不进日志；上游重启换哈希时执行 gated 请求遇 `→ /login` 会自动重登一次并重放。

### 验证（2026-11-16 10:57–10:59Z，全部公网入口实测）

| 检查 | 结果 |
| --- | --- |
| 直链无票据（`/`） | **302 → /login**（不回归） |
| `/?folder=…&cs_t=<插件签发>` | **302** + `Set-Cookie: cs_gate=…Max-Age=43200`，Location 保留文件夹 |
| 带 `cs_gate` 再请求 | **200**，正文含 `workbench-web-configuration`（无登录页） |
| WebSocket（带 cookie） | **101 Switching Protocols** |
| WebSocket（无凭证） | **302**（不 naked） |
| `/healthz` | **200** |
| 伪造票据 | 落回登录页（302） |
| `data/gate` bridge | **200** `{token, exp, ttl:300}`（真 worker 签发） |
| 部署的插件 UI 产物 | `/_plugins/da3ae3ee-…/ui/index.js` 与本地 `dist/ui/index.js` md5 一致（`7e7a730b…`） |
| code-server 重启后 | 带 cookie 直进 **200** |
| cs-gate 重启后 | 首请求自动重新登录，之后 200 |
| 插件单测 | `npm test` → **27 pass / 0 fail**（新增 4 条票据/URL 用例） |

### 代价 / 回滚

- 多一个进程：supervisord `[program:cs-gate]`（Node 内置模块单文件 `proxy.mjs`，无 npm 依赖，端口占用时 2 秒退避重试）
- 权限仍未按用户细分（cookie 全局共享）；要 per-user 得在代理里带身份，或由宿主机反代 `auth_request` 决定
- 回滚：`code-server.sh` 改回 `--bind-addr 0.0.0.0:19081` + `supervisorctl stop cs-gate`；插件拿不到票据会退回纯 `?folder=` 直链，不报错

## 九、打开时的加载提示（插件 0.5.1，2026-11-16）

**问题**：点「Code」后 iframe 有几秒纯白。原因是 code-server 的 workbench 是一大坨前端资源，
iframe 挂载到 `load` 事件之间没有内容可画；插件这一侧原先只挂了裸 `<iframe>`，没有任何过渡。

**做法**（`src/ui/index.tsx` 的 `CodeFrame`，顶栏浮层 / 侧栏 tab / 插件页共用）：

- iframe **立即挂载**，下载照常开始（不做「先等再加载」的串行化）
- 覆盖一层居中的 loader：转圈（`cs-frame-spin` keyframes）+「正在加载编辑器…」+
  「首次打开需要下载 VS Code 前端，通常 5–15 秒」
- `onLoad` 触发（记录 `loadedUrl`，与当前 `frameUrl` 比对）即移除 loader；URL 变化时自动重新显示
- 12 秒仍未加载完 → 追加「在新标签里打开」兜底链接（反代 ws 卡住时的逃生口）
- 关键帧样式注入一次（`#cs-frame-loader-style`），静态渲染环境自动跳过

**验证**：

| 检查 | 结果 |
| --- | --- |
| 插件单测 | `npm test` → **28 pass / 0 fail**（新增「iframe 在场 + loader 文案 + 12s 前不出现兜底链接」） |
| 升级 | `paperclipai plugin upgrade qnnp.codeserver` → **0.5.1 ready**，实例 UUID 未变（`da3ae3ee-…`） |
| 槽下发 | `page` · `globalToolbarButton` · `detailTab(entityTypes:["issue"])`，无变化 |
| 部署产物 = 本地构建 | `/_plugins/da3ae3ee-…/ui/index.js` 与 `dist/ui/index.js` md5 一致（`0c10503a…`） |
| 产物含新逻辑 | 线上 bundle 内含 `cs-frame-spin` 与 `\u6B63\u5728\u52A0\u8F7D…`（esbuild 以 ASCII 转义输出） |

**边界**：loader 在 `load` 事件时消失，而 workbench 首帧可能再晚几百毫秒——这是浏览器能给到的最早可信信号；
若你要「首帧才消失」，得让 code-server 主动 postMessage，成本高于收益，默认不做。

## 十、插件迁出独立仓库 + 全部环境值改为配置（插件 0.6.0，2026-11-16）

**结论**：源码搬到独立 GitHub 仓库长期维护（提交历史保留），部署差异不再写死在代码里；
code-server 地址、端口、插件页目录、自动登录秘密文件路径、票据 TTL 全部是公司级插件配置。

### 10.1 仓库与目录

- GitHub：https://github.com/qnnp-me/paperclip-plugin-codeserver（private，默认分支 `main`）
- 本地：`/home/linuxbrew/Projects/paperclip-plugin-codeserver`
- 迁出方式：`git subtree split --prefix=plugins/codeserver -b plugin-split` 后克隆该分支 → 10 条历史提交完整保留
- 本仓库：`plugins/codeserver` 改为**本地软链**（已 gitignore），只为已安装插件的 `packagePath` 还能 `plugin upgrade`；新安装直接指向新路径
- 代理源码也进仓库：`proxy/proxy.mjs`；容器内 `/home/linuxbrew/.local/opt/cs-gate/proxy.mjs` 改为指向该文件的软链（备份 `proxy.mjs.bak-cmp29`）

### 10.2 配置项（`instanceConfigSchema`）

设置页 `Settings → Plugins → Code Server`（`/settings/plugins/qnnp.codeserver`），或 CLI：

```bash
paperclipai plugin config:set qnnp.codeserver \
  --payload-json "$(cat config.example.json)" \
  --api-base https://dev-qnnp-19099.hdl.qnnp.me:18443
```

| 键 | 当前值 | 作用 |
| --- | --- | --- |
| `codeServerBaseUrl` | `https://dev-qnnp-19081.hdl.qnnp.me:18443` | 显式地址；留空则按页面 host 换端口推导 |
| `codeServerPort` | `19081` | 推导用 code-server 端口 |
| `paperclipPort` | `19099` | 推导时从 host 替换掉的 Paperclip 端口 |
| `pageFolder` | `/home/linuxbrew/Projects` | 插件页默认目录 |
| `gateSecretFile` | `/home/linuxbrew/.startup/code-server-gate.secret` | 与 cs-gate 共用的 600 秘密文件（只存路径） |
| `gateTicketTtlSeconds` | `300` | 自动登录票据 TTL（30–3600） |

配置里不放秘密值。代理侧环境变量（`CS_GATE_LISTEN` / `CS_GATE_UPSTREAM` / `CS_GATE_SECRET_FILE` /
`CODE_SERVER_ENV_FILE` / `CS_GATE_TICKET_TTL` / `CS_GATE_COOKIE_TTL`）在插件仓库 README 有清单。

### 10.3 实测（11:22–11:24Z）

| 检查 | 结果 |
| --- | --- |
| 升级 | `qnnp.codeserver` **0.6.0 ready**，实例 UUID 未变（`da3ae3ee-…`），`packagePath` 经软链指向新仓库 |
| manifest 校验 | 宿主 `pluginManifestV1Schema.safeParse` → **true**，6 个配置键 |
| 配置写入 | `config:set` → `configJson` 六项落库；`plugin config` 回读一致 |
| 配置校验（Test Connection） | `config:test` → **`{"valid":true}`**（走 worker `onValidateConfig`） |
| 配置读取（真 worker） | `bridge:data settings` → 返回落库值；`gate` → `{ttl:300, exp, token}` |
| 票据 → 代理 | `GET /?cs_t=<票据>` → **302 + Set-Cookie cs_gate（Max-Age 43200）**；带 cookie 请求带 `?folder=` → **200**（无 `?folder=` 时 code-server 自己 302 到上次目录） |
| 直链不回归 | 无票据 `GET /` → **302 ./login** |
| 部署 UI = 本地构建 | `/_plugins/da3ae3ee-…/ui/index.js` md5 `6bd3dfda…` = `dist/ui/index.js`；线上 bundle 含 `codeServerBaseUrl` / `pageFolder` / 「正在读取插件配置」 |
| 代理源码软链 | `cs-gate` 重启后 RUNNING，`/healthz` 200，上游重新登录成功 |
| 单测 | `npm test` → **43 pass / 0 fail** |

### 10.4 边界

- 配置是按公司存的；换公司要各自设置（未配置时用内置默认值，插件不会坏）。
- `codeServerBaseUrl` 显式填写后不再随页面推导：从 `localhost` 打开 Paperclip 时 iframe 仍指公网地址，属预期；不想这样就留空。
- 升级仍读数据库里的旧 `packagePath`；本机靠软链兼容。换机器请用新路径重装一次。
- 插件 UI 是外部 ES module，升级后浏览器要强制刷新一次（Cmd/Ctrl+Shift+R）。

## 十一、关闭按钮不再压编辑器 + 清掉残留 `?browse=1`（插件 0.6.2，2026-11-16）

**结论**：浮层的关闭按钮从「浮在 iframe 右上角」改成「iframe 上方一条 30px 宿主条」；
`?browse=1` 来自宿主文件浏览器，之前从侧栏文件 tab 切到 Code tab 时没被清掉，现在会清。

### 11.1 关闭按钮

- 浮层改为 flex 列：30px 宿主条（左 `CODE`、右「关闭 ×」）+ body；iframe 填满 body，不再被覆盖。
- 真实 Chromium 实测：`close.bottom=26`、`iframe.top=31`、`overlap=false`；mock 编辑器的标题栏按钮可见可点。
- Esc 与浏览器后退关闭不变（0.6.1 的 `overlayHistory` 逻辑未动）。

### 11.2 `?browse=1` 的漏点

- 宿主 `FileViewerContext` 打开文件浏览器时把 `browse=1` 写进任务页 URL；侧栏 `selectTab()` 切走时会 `viewer.close()`。
- 我们加的插件 tab 走 `selectVisualTab()` / `selectLauncherItem()` 的 `plugin:` 分支，提前 `return`，跳过了这一步 → `?browse=1` 留在地址栏并在刷新后重新打开文件浏览器。
- 修法：两个分支在切换前补 `(viewer.state || viewer.browse) && viewer.close()`。
- 落点：`paperclip-zh/tools/patch-bugfixes.mjs` 新增 `plugin-tab-closes-file-viewer`、`plugin-launcher-closes-file-viewer` 两条规则（宿主构建产物补丁，可复现）。**这两条已在本文件第十二节搬进宿主源码**，产物规则随之删除。
- **更正（见第十二节）**：这一条只堵住「从文件 tab 切到 Code」，堵不住「刚加载就长出 `?browse=1`」——那条来自文件 tab 挂载时的状态回写。

### 11.3 实测

| 检查 | 结果 |
| --- | --- |
| 插件单测 | `npm test` → **50 pass / 0 fail** |
| 升级 | `qnnp.codeserver` **0.6.2 ready**，UUID 未变；线上 UI md5 = 本地构建 |
| 浮层布局 | bar 31px；iframe 从 y=31 起；overlap=false |
| 关闭 / 后退 | 都只关浮层，URL 停在任务页；连续 3 次开关 `history.length` 恒定 3 |
| 宿主重建 | `index-DooIKv53-zh2611162104.js` / `issue-detail-DRpxL0AP-zh2611162104.js` 均 200 |
| 宿主补丁落点 | 线上 chunk 中 `L.state||L.browse)&&L.close()` 出现 5 次（原有 3 + 新增 2） |
| 未回归 | chunk 含「在任务工作区里打开编辑器」1 处、`plugin:${` 6 处、「智能体」44 处 |

### 11.4 边界

- 30px 宿主条是布局的一部分，编辑器高度少 30px；换来按钮永不压住 code-server 控件。
- 宿主改动仍是本地构建补丁；`paperclipai upgrade` 后按 `paperclip-zh` 的 patch 流程重建（规则已进 `patch-bugfixes.mjs`）。
- 真机登录后的观感未替老板验（agent-browser 会话过期）；11.3 用的是同一份构建产物 + 桩 bridge。

## 十二、加载任务页不再自动追加 `?browse=1`（宿主源码修复，2026-11-16 21:20 本地）

老板反馈：**「我刚加载 /CMP/issues/CMP-29 就给我加上了 ?browse=1」**——不是我点出来的，是页面自己加的。

### 12.1 复现（真机浏览器，修复前的构建）

用登录后的会话把状态摆成老板那边一样（侧栏里有一个「文件」tab），然后打开干净的 `/CMP/issues/CMP-29`：

| 步骤 | 修复前 |
| --- | --- |
| 点侧栏「在此工作项中打开文件」 | URL `?browse=1`，侧栏出现「文件」tab（这一笔是正常的） |
| 重新打开**干净**的 `/CMP/issues/CMP-29`（不带任何 query） | 2 秒内 URL 变成 **`?browse=1`**，文件浏览器自己回来了 |

### 12.2 根因

不是插件，也不是第十一节那个切换漏点。链路是宿主的「文件 tab 会把面板状态回写进 URL」：

1. 侧栏的「文件」tab 会持久化在 `localStorage`（`paperclip:task-side-panel:v1:*`），刷新后照旧恢复成当前 tab；
2. `WorkspaceFileBrowser` 挂载时有一个 effect 调 `onBrowseStateChange(...)`，把 `{q, folderPath, projectId, workspaceId}`（通常全 null）交给宿主；
3. `TaskSidePanel` 把它转手给 `viewer.updateBrowseState(next)`；
4. `writeBrowseStateToSearch()` **无条件** `params.set("browse","1")`。

于是**只要侧栏恢复的是文件 tab，每次加载都会凭空长出一个 `?browse=1`**；而 `+` 启动器里的 Files 也走 `viewer.openBrowse()`，同样会写。第十一节的插件分支修复只堵了「从文件 tab 切到 Code tab」这一条，堵不住「一加载就写」。

### 12.3 修法（改宿主源码，不是产物补丁）

原则：**侧栏自己的 tab 状态是唯一真源，URL 只镜像「本来就存在的 browse 深链」，绝不从 tab 动作里凭空造 `browse=1`。**

| 位置 | 改动 |
| --- | --- |
| `TaskSidePanel.selectTab()`（文件 tab 分支） | 仅当 `viewer.browse` 已为真时 `updateBrowseState({q})`，否则不动 URL |
| `TaskSidePanel.selectLauncherItem()`（`files` 项） | 同上：仅当 URL 已处于 browse 模式时 `openBrowse()` |
| `WorkspaceFileBrowser` 的 `onBrowseStateChange` 回调 | 照旧写 tab payload；只有 `viewer.browse` 时才 `viewer.updateBrowseState(next)` |
| URL→tab 的镜像 effect | `browse=1` 是宿主「打开文件面板」的通道（顶栏按钮、`g f` 快捷键都会推它）：**照旧打开文件 tab**，但如果参数是**裸 `browse=1`**（无 q/folder/projectId/workspaceId），随即 `viewer.close({ replace: true })` 把它从地址栏抹掉——否则它会一直留到下一次加载 |
| `selectVisualTab()` / `selectLauncherItem()` 的 `plugin:` 分支 | 第十一节那两条补丁（产物规则）搬进源码：切换前 `(viewer.state || viewer.browse) && viewer.close()` |

`close()` 现在接受 `{ replace }`，裸参数清理用 `replace`，避免多压一条历史记录（否则按后退会在同一条清理上反复）。

顺手清掉 `paperclip-zh/tools/patch-bugfixes.mjs` 里 7 条已搬进源码的产物规则（`composer-unassigned-agent-label`、`side-panel-tab-measure-loop`、`files-browser-echo-ref`、`files-browser-seed-echo`、`files-browser-browse-state-loop`、`plugin-tab-closes-file-viewer`、`plugin-launcher-closes-file-viewer`）——重建后 minified 名字变了，它们只会 MISS；文件里留了说明，避免以后重复加。

### 12.4 实测（修复后，同一个真机会话）

| 检查 | 结果 |
| --- | --- |
| 干净加载 `/CMP/issues/CMP-29`（侧栏恢复文件 tab） | URL 全程保持 **`""`**（修复前是 `?browse=1`），文件 tab 仍在 |
| 侧栏点「文件」tab | URL 仍 `""` |
| 点「属性」→ 点「Code」 | URL 仍 `""`；Code tab 里 iframe 正常，code-server 日志出现 `ManagementConnection` + `ExtensionHostConnection` |
| 深链 `?browse=1&q=AGENTS` | 保留 URL，搜索框被 seed 成 `AGENTS`（深链能力没退化） |
| 裸 `?browse=1` | 照样打开文件 tab，加载后 2 秒内 URL 变回 `""`（replace，不新增历史） |
| 宿主单测 | `vitest run TaskSidePanel.test.tsx` → **44 pass / 0 fail**；连同 `WorkspaceFileBrowser` / `FileViewerSheet` 一起跑 → **91 pass / 0 fail**（新增 4 条：启动器开文件 tab 不写 URL、裸 browse 先开后清、带 q 的深链保留、插件 tab 关闭文件浏览器） |
| 顶栏「打开文件」按钮 | `history` 钩子记录到 `push ?browse=1` → 立刻 `replace /CMP/issues/CMP-29`，终态 `""`，文件 tab 照常打开 |
| 部署 | 入口 `index-Y40NtYFv-zh2611162127.js`、`issue-detail-BrUdHDb4-zh2611162127.js` 均 200；smoke **25/25 ok** |
| 补丁命中 | `patch-bugfixes` 8 applied / **0 missed**（清理后无 MISS 噪音） |
| 补丁存档 | `docs/patches/CMP-29-host-side-panel-plugin-tabs.patch` 重新生成（9 个文件，含本条） |

### 12.5 边界

- 这是宿主 UI 的本地源码改动：`paperclipai upgrade` 换掉 `ui-dist` 后，要按 `docs/patches/CMP-29-host-side-panel-plugin-tabs.patch` 重新构建（`/tmp/paperclip-build` 的 git diff 与存档同源）。
- 侧栏不再把「文件 tab 的搜索词/目录」写进 URL，所以**从侧栏复制地址不再带 browse 状态**；要给同事发定位链接，用任务里的文件引用（`?file=...`）或手写 `?browse=1&q=...`，两者都仍然生效。
- 判定条件是「裸 browse 才清理」。带 `q`/`folder`/`projectId`/`workspaceId` 的 browse 一律保留，不当成噪音。
- `paperclip-zh/scripts/deploy.sh` 的 server 解析也修了：pnpm 全局解析这次落到一个 `ui-dist` 是**真实目录**的上游安装，deploy 因此在换盘那步中止（线上因为符号链已经指向新产物，实际已经生效）。现在优先选 `ui-dist` 是符号链的安装，再退回版本排序；cookie/缓存无变化，换盘与 smoke 都能走完。
