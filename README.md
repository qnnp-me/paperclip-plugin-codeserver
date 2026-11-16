# paperclip-plugin-codeserver

在 [Paperclip](https://github.com/paperclipai/paperclip) 里直接打开 [code-server](https://github.com/coder/code-server)（VS Code Web）。插件的所有部署差异（地址、端口、目录、自动登录秘密文件）都是**配置项**，改配置不需要重新构建。

- 顶栏「Code」：按当前页面的任务/项目解析它自己的工作区目录，整屏打开；非任务/项目页不渲染。浮层在 iframe **上方留一条 30px 宿主条**放关闭按钮——按钮不压在 code-server 的标题栏/状态栏控件上；Esc 关闭，浏览器「后退」也是关闭浮层而不是离开页面（打开时压入一条历史记录，关闭时复用它）。
- 任务属性侧栏「Code」tab：只有编辑器，占满 tab；关掉后可从「+ 新建 tab」重新打开。
- 插件页 `/:companyPrefix/plugins/<实例UUID>`：全屏编辑器，默认目录来自配置。
- 可选自动登录：插件 worker 签一张短时票据，容器内 [cs-gate 代理](proxy/) 在服务端换成会话 cookie，浏览器不见登录页。**不配代理也能用**，只是每个浏览器登录一次。

## 目录

```
src/manifest.ts        manifest：三个 UI 槽 + instanceConfigSchema（配置项schema）
src/config.ts          配置默认值、归一化、校验（纯函数，worker 与 UI 共用）
src/plugin.ts          worker 定义：workspace / settings / gate 三个 data 方法
src/worker.ts          worker RPC 入口
src/resolve.ts         任务/项目 → 工作区目录（走宿主 read 能力）
src/gate.ts            cs-gate 票据签名（HMAC-SHA256）
src/shared/urls.ts     地址推导、?folder= 深链、票据拼接（纯函数）
src/shared/workspace.ts 目录选择逻辑（纯函数）
src/shared/overlayHistory.ts 浮层的浏览器历史（Back 关闭而不是离开页面）
src/ui/index.tsx       三个槽组件 + 加载层
proxy/                 可选的 cs-gate 自动登录代理（单文件，仅 Node 内置模块）
test/                  node:test；含 SDK 内存宿主的真能力门禁测试
```

`dist/` 不入库，由 `npm run build` 生成（`manifest.js` / `worker.js` / `ui/index.js`）。

## 环境要求

| 组件 | 版本 / 说明 |
| --- | --- |
| Paperclip | `2026.1106.0`（插件 API v1；manifest 里 `minimumHostVersion` 未钉，按该版本开发） |
| Node.js | ≥ 20（构建与 worker） |
| code-server | 4.x，独立安装包；监听一个端口即可 |
| cs-gate（可选） | 仅用于自动登录，见 [`proxy/`](proxy/) |

Paperclip UI 与 code-server 需要**同站**（同一 eTLD+1），iframe 里的会话 cookie（`SameSite=Lax`）才会发送。跨站会退化成登录页；这是浏览器策略，不是插件能绕的。

## 安装

插件走 Paperclip 的本地路径安装（实例管理员操作；`Settings → Plugins` 的对话框只收 npm 包名，本地路径用 CLI）：

```bash
git clone https://github.com/qnnp-me/paperclip-plugin-codeserver.git
cd paperclip-plugin-codeserver
npm ci && npm run build

paperclipai plugin install "$PWD" --local \
  --api-base https://<your-paperclip-host>
```

首次会打印板端授权链接；装完 `paperclipai plugin list` 里应见 `qnnp.codeserver` / `ready`。升级：

```bash
git pull && npm ci && npm run build
paperclipai plugin upgrade qnnp.codeserver --api-base https://<your-paperclip-host>
```

> 升级读的是数据库里记录的**安装路径**。仓库搬过家时，在该旧路径放一个指向新目录的软链，或先 `plugin uninstall qnnp.codeserver --force` 再从新路径安装。

## 配置

### 设置页（推荐）

`Settings → Plugins → Code Server`（`/settings/plugins/qnnp.codeserver`），按公司保存。表单由 manifest 的 `instanceConfigSchema` 生成；保存时会跑 worker 的 `onValidateConfig`，非法值直接被拒。

### CLI

```bash
paperclipai plugin config:set qnnp.codeserver \
  --company-id <company-uuid> \
  --payload-json @config.example.json \
  --api-base https://<your-paperclip-host>

paperclipai plugin config qnnp.codeserver --company-id <company-uuid>   # 回读
```

配置在每次打开编辑器时由 worker 读取（`ctx.config.get(companyId)`），改完刷新页面/重开 tab 即生效。

### 配置项

| 键 | 类型 | 默认 | 作用 |
| --- | --- | --- | --- |
| `codeServerBaseUrl` | string | `""` | code-server 完整公开地址。留空则按当前页面推导：把 host 里的 `paperclipPort` 换成 `codeServerPort`；loopback 用 `codeServerPort`。 |
| `codeServerPort` | integer | `19081` | 推导地址时使用的 code-server 端口。 |
| `paperclipPort` | integer | `19099` | 推导同主机地址时，从页面 host 里替换掉的端口。 |
| `pageFolder` | string | `/home/linuxbrew/Projects` | 插件页（无任务/项目上下文）显示的目录，绝对路径。 |
| `gateSecretFile` | string | `/home/linuxbrew/.startup/code-server-gate.secret` | 与 cs-gate 共用的 600 秘密文件，绝对路径。读不到时退回登录页（不报错）。 |
| `gateTicketTtlSeconds` | integer | `300` | 自动登录票据有效期（30–3600 秒）。 |

**配置里不放任何秘密值**：只存秘密文件的路径。code-server 口令仍在自己的 600 env 文件里，代理启动时用它换会话。

### 运行时环境（服务侧）

这些是 code-server / cs-gate 自己的环境变量，不是插件配置；默认值与容器内现状一致：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PASSWORD` | — | code-server 登录口令，放在 600 的 env 文件（如 `.startup/code-server.env`）。 |
| `CS_GATE_LISTEN` | `0.0.0.0:19081` | cs-gate 监听地址（替代 code-server 对外端口）。 |
| `CS_GATE_UPSTREAM` | `127.0.0.1:19083` | code-server 真实监听地址。 |
| `CS_GATE_SECRET_FILE` | `/home/linuxbrew/.startup/code-server-gate.secret` | 票据 HMAC 秘密（与 `gateSecretFile` 指向同一文件）。 |
| `CODE_SERVER_ENV_FILE` | `/home/linuxbrew/.startup/code-server.env` | 代理从这里读 `PASSWORD` 自行登录。 |
| `CS_GATE_TICKET_TTL` | `300` | 代理侧接受的票据 TTL（插件签发的 TTL 不应超过它）。 |
| `CS_GATE_COOKIE_TTL` | `43200` | 换发的会话 cookie 有效期（12 小时）。 |

## 自动登录（可选）

1. code-server 改为只监听容器内端口（如 `127.0.0.1:19083`）。
2. 启动 `proxy/proxy.mjs`，它监听原对外端口（如 `19081`）。
3. 生成一个 ≥32 字符的共享秘密，写到 `gateSecretFile` 指向的 600 文件；插件与代理各读一份。
4. 插件为每次打开签 5 分钟票据（`?cs_t=…`）→ 代理验签 → 服务端换发 12 小时 cookie → 302 到干净地址。

不带票据/ cookie 的直链仍落到 code-server 自己的登录页，不回归。代理细节与运维命令见 [`proxy/README.md`](proxy/README.md)。

## 开发

```bash
npm ci
npm run dev     # esbuild watch：manifest / worker / ui
npm run build
npm test        # node:test，43 个断言
```

CI（GitHub Actions）在每次 push / PR 上跑 `npm ci && npm run build && npm test`。

测试覆盖：配置归一化与校验、地址推导（含自定义端口与显式 URL）、票据签名与代理侧验签、目录解析优先级、SDK 内存宿主上的真能力门禁、UI 静态渲染（加载层、配置覆盖、无 iframe 直出）。

### 改动守则

- 新增部署相关的值 → 加到 `src/config.ts` 的默认值与 `instanceConfigSchema`，不要写死进 UI。
- `dist/` 不入库；发布前 `npm run build && npm test` 必须干净。
- 版本按 semver 走；manifest 的 `version` 与 `package.json` 同步。
- 新增能力项（`capabilities`）会让升级停在 `upgrade_pending` 等管理员批准；能不加就不加。

## 安全边界

- 插件 UI 是 Paperclip 主应用内的同源 ES module；能力项管不住前端，只装可信插件。
- cs-gate 换发的会话是**全局共享**的（code-server 本身没有 per-user 概念）。要按人限制，得在代理里带上身份，或在宿主机反代加 `auth_request`。
- 会话 cookie 12 小时；连续开 tab 超过后掉回登录页，重开 tab 会换新票据。

## 从 qnnp-opc 单仓迁出

本仓库由 `qnnp-opc` 的 `plugins/codeserver/` 用 `git subtree split` 提取，保留了原有提交历史。原仓库只留一条指向本仓库的说明；安装路径的兼容软链由部署侧维护，不入库。

## License

MIT，见 [LICENSE](LICENSE)。