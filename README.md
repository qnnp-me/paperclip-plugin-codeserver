# Paperclip 插件：Code Server（qnnp.codeserver）

在 Paperclip 里直接打开 code-server。四个插槽：

- `toolbarButton`（任务 / 项目头部「Code」）——**主入口**，点击后整屏浮层进该任务/项目自己的工作区
- `detailTab`（任务 / 项目 Tab）——仅经典任务界面可见，作为补充
- `page`（全高 iframe + 目录选择）
- `globalToolbarButton`（顶栏入口）

默认的聊天壳任务页不渲染 Tab 条，所以入口必须用 `toolbarButton`，光做 `detailTab` 用户看不到。

## 结构

```
src/manifest.ts        manifest（id qnnp.codeserver，能力 ui.page.register + ui.action.register）
src/worker.ts          空壳 worker（manifest 必填 entrypoints.worker），onIdleDrain 返回 none，不挡实例休眠
src/ui/index.tsx       四个插槽组件：CodeServerEntityButton / CodeServerContextTab / CodeServerPage / CodeServerToolbarButton
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
npm test        # 23 个断言：URL 推导、目录解析优先级、能力门禁、插槽静态渲染
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
paperclipai plugin list --api-base https://paperclip-19099.example.com:18443   # 应见 0.3.0 ready
```

浏览器里刷新任意任务页，头部出现「Code」按钮。插件页入口是 `…/CMP/plugins/<实例 UUID>`（不是插件 key）。

## 运行时行为

- code-server 地址默认由当前页面推导：`paperclip-19099…` → `paperclip-19081…`，端口不变；loopback 时用 `:19081`。页面顶部可手改，存 `localStorage`。
- 任务/项目按钮按实体解析目录：任务优先执行工作区 `cwd`，否则所属项目主工作区；项目用主工作区。
- 插件页目录默认 `/home/linuxbrew/Projects/qnnp-opc`，可改、可存。
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