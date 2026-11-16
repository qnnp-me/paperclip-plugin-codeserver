# Paperclip 插件：Code Server（qnnp.codeserver）

在 Paperclip 里直接打开 code-server。三个插槽：

- `globalToolbarButton`（页面顶栏「Code」）——**唯一入口**，按当前页面是哪个任务/项目解析工作区，点击后整屏打开该目录；非任务/项目页不渲染。
- `detailTab`（只声明 `issue`）——任务页属性侧栏里的「Code」tab：无工具条、无目录选择，编辑器占满 tab。关掉后可从「+ 新建 tab」里重新打开。
- `page`（`/:companyPrefix/plugins/:实例UUID`）——直接访问时的全屏编辑器，无返回按钮等页面装饰。

默认的聊天壳任务页不渲染主 Tab 条，所以 `detailTab` 由宿主属性侧栏复用（见宿主补丁）。

## 结构

```
src/manifest.ts        manifest（id qnnp.codeserver，能力 ui.page.register + ui.action.register）
src/worker.ts          空壳 worker（manifest 必填 entrypoints.worker），onIdleDrain 返回 none，不挡实例休眠
src/ui/index.tsx       三个插槽组件：CodeServerToolbarButton / CodeServerContextTab / CodeServerPage
src/shared/urls.ts     纯函数：推导 code-server 地址、拼 ?folder= 深链
esbuild.config.mjs     manifest+worker（bundle SDK）与 UI（react 外置）三个产物
test/                  URL 单测 + UI 渲染冒烟测试（node:test）
```

产物（`dist/`，不入库）：

- `dist/manifest.js`
- `dist/worker.js`（已打包 `@paperclipai/plugin-sdk`，运行时不需要 node_modules）
- `dist/ui/index.js`（ESM，`react` / `react/jsx-runtime` 保持为裸导入，由 Paperclip UI 在加载时改写）

## 构建与测试

```bash
cd plugins/codeserver
npm install
npm run build
npm test        # 22 个断言：URL 推导、目录解析优先级、能力门禁、插槽静态渲染
```

## 安装（需要实例管理员）

首次安装（实例管理员；第一次会要求板端授权，token 存本地）：

```bash
paperclipai plugin install /home/linuxbrew/Projects/qnnp-opc/plugins/codeserver \
  --local --api-base https://paperclip-19099.example.com:18443
```

已装过则用升级（`install` 会报 `Plugin already installed`）：

```bash
paperclipai plugin upgrade qnnp.codeserver --api-base https://paperclip-19099.example.com:18443
```

确认：

```bash
paperclipai plugin list --api-base https://paperclip-19099.example.com:18443   # 应见 0.4.0 ready
```

浏览器里刷新任意任务页/项目页，顶栏出现「Code」按钮。插件页入口是 `…/CMP/plugins/<实例 UUID>`（不是插件 key）。

## 运行时行为

- code-server 地址由当前页面推导：`paperclip-19099…` → `paperclip-19081…`，端口不变；loopback 时用 `:19081`。
- 顶栏按钮按当前页面解析目录：任务优先执行工作区 `cwd`，否则所属项目主工作区；项目用主工作区。项目 URL 是 `urlKey` 时，插件先用宿主只读 API 换成 UUID，再走 bridge（无需额外能力项）。
- 侧栏 tab 只渲染编辑器；工作区解析失败时显示一行错误，不提供手改目录。
- 插件页目录固定 `/home/linuxbrew/Projects`。
- code-server 与 Paperclip 同站（`*.example.com`），会话 cookie `SameSite=Lax` 在 iframe 里照常发送；首次在 iframe 内登录一次即可。浮层用 Esc 关闭。

## 卸载

```bash
paperclipai plugin uninstall qnnp.codeserver --api-base https://paperclip-19099.example.com:18443
```

## 已知边界

- iframe 依赖「同站」前提。换域名、上游加 `frame-src`、code-server 加 `frame-ancestors` 都会让它退化成「新标签打开」。
- 插件 UI 是 Paperclip 主应用里的同源 ES module，能力项管不住前端，只装自己写的插件。
- worker 常驻进程会跟着实例起；`onIdleDrain` 返回 `none`，没有定时器/套接字，不阻止 idle sleep。

## 0.5.0 — 自动登录（配合 cs-gate 代理）

- 新增 worker 数据方法 `gate`：用共享秘密签 5 分钟票据（`v1.<exp>.<HMAC>`），UI 拼 `&cs_t=` 到 iframe URL
- 拿不到秘密文件时返回 `null`，UI 退回纯 `?folder=` 直链（code-server 登录页），不报错
- 代理与服务端配置见 `/home/linuxbrew/.local/opt/cs-gate/README.md`
