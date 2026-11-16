# Paperclip 插件：Code Server（qnnp.codeserver）

在 Paperclip 里直接打开 code-server：一个 `page` 插槽（全高 iframe + 目录选择）和一个顶栏入口按钮（`globalToolbarButton`）。

## 结构

```
src/manifest.ts        manifest（id qnnp.codeserver，能力 ui.page.register + ui.action.register）
src/worker.ts          空壳 worker（manifest 必填 entrypoints.worker），onIdleDrain 返回 none，不挡实例休眠
src/ui/index.tsx       两个插槽组件：CodeServerPage / CodeServerToolbarButton
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
npm test        # 6 个断言：URL 推导、深链拼接、两个插槽静态渲染
```

## 安装（需要实例管理员）

Paperclip 的 `POST /api/plugins/install` 走 `assertInstanceAdmin`，agent 身份装不了。用 CLI 装，第一次会要求板端授权（浏览器里点同意，token 存本地）：

```bash
paperclipai plugin install /home/linuxbrew/Projects/qnnp-opc/plugins/codeserver \
  --local --api-base https://paperclip-19099.example.com:18443
```

装完确认：

```bash
paperclipai plugin list --api-base https://paperclip-19099.example.com:18443
```

然后用浏览器打开 `https://paperclip-19099.example.com:18443/CMP/plugins/qnnp.codeserver`（顶栏也会出现「Code」按钮）。

## 运行时行为

- code-server 地址默认由当前页面推导：`paperclip-19099…` → `paperclip-19081…`，端口不变；loopback 时用 `:19081`。页面顶部可手改，存 `localStorage`。
- 目录默认 `/home/linuxbrew/Projects/qnnp-opc`，同样可改、可存。
- code-server 与 Paperclip 同站（`*.example.com`），会话 cookie `SameSite=Lax` 在 iframe 里照常发送；首次在 iframe 内登录一次即可。
- 「新标签打开」始终可用，作为 iframe 被浏览器策略打断时的退路。

## 卸载

```bash
paperclipai plugin uninstall qnnp.codeserver --api-base https://paperclip-19099.example.com:18443
```

## 已知边界

- iframe 依赖「同站」前提。换域名、上游加 `frame-src`、code-server 加 `frame-ancestors` 都会让它退化成「新标签打开」。
- 插件 UI 是 Paperclip 主应用里的同源 ES module，能力项管不住前端，只装自己写的插件。
- worker 常驻进程会跟着实例起；`onIdleDrain` 返回 `none`，没有定时器/套接字，不阻止 idle sleep。