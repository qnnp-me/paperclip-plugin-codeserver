# cs-gate — code-server 自动登录门禁代理

`0.0.0.0:19081` → `127.0.0.1:19083`（code-server 本体）

## 为什么存在

code-server 的会话 cookie 是 `code-server-session=<argon2id 哈希>`，无 `Max-Age`（关浏览器即失效），
且值就是密码哈希、全局一份。跨主机又不能由 Paperclip 插件替它为浏览器种 cookie。
所以在同机加一层代理：**服务端注入会话**，浏览器不必知道密码。

## 两种流量

| 请求 | 行为 |
| --- | --- |
| 带 `?cs_t=<票据>` | 校验 HMAC → `Set-Cookie: cs_gate=…`（HttpOnly、Lax、12h）→ 302 到去掉 `cs_t` 的干净地址 |
| 带 `cs_gate` cookie | 向上游注入 `code-server-session`，剥掉上游 `Set-Cookie`，浏览器看不到登录页 |
| 都没有（直链、独立域名） | 原样透传 → code-server 自己的登录页（不回归） |
| `/healthz` | 不鉴权透传 |

## 票据

```
v1.<unix 秒到期>.<HMAC-SHA256(secret, "v1.<exp>")[:32] base64url>
```

- 插件 worker 每次打开 tab 用 `ctx.data("gate")` 签一张 **5 分钟** 票据，拼成 `&cs_t=`
- 代理换发 **12 小时** `cs_gate` cookie；之后静态资源、WebSocket 都靠它还活着
- 秘密文件 `/home/linuxbrew/.startup/code-server-gate.secret`（600，32 字节 hex），插件与代理共用；
  插件侧可用 `CODESERVER_GATE_SECRET_FILE` 覆盖
- 上游口令只从 `/home/linuxbrew/.startup/code-server.env`（600）读，代理启动时 `POST /login` 换会话，
  **不硬编码、不落盘、不进日志**；上游重启换哈希时，遇到 `→ /login` 会自动重登一次再重放

## 运维

```bash
supervisorctl -c /home/linuxbrew/.startup/supervisord.conf status cs-gate code-server
tail -f /home/linuxbrew/.startup/logs/cs-gate.log
```

- supervisord `[program:cs-gate]`：`autostart=true`、`autorestart=true`，容器重启自动拉起；
  端口被旧进程占用时会每 2 秒重试最多 30 次，不和 code-server 抢启动
- 换口令：只改 `code-server.env` 的 `PASSWORD=` 一行，两个进程都重启即可（代理会重新登录）
- 回滚自动登录：把 `code-server.sh` 的 `--bind-addr` 改回 `0.0.0.0:19081`、停掉 `cs-gate`；
  插件 0.5.0 在拿不到票据时自动退回纯 `?folder=` 直链（登录页），不会坏
- 代理代码：`proxy.mjs`（单文件、仅 Node 内置模块，无 npm 依赖）