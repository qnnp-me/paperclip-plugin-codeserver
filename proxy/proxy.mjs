#!/usr/bin/env node
/**
 * cs-gate — code-server 的自动登录门禁代理。
 *
 * 拓扑：浏览器/反代 → 0.0.0.0:19081 (本进程) → 127.0.0.1:19083 (code-server)
 *
 * 两种流量：
 *  1) 带门禁凭证（`cs_t` 查询参数，或 `cs_gate` cookie）→ 代理向上游注入
 *     code-server 会话 cookie，剥掉上游 Set-Cookie，浏览器永远看不到登录页。
 *  2) 不带 → 原样透传，code-server 照旧给登录页。直链访问、独立域名不回归。
 *
 * 凭证格式：v1.<unix 秒过期时间>.<HMAC-SHA256(secret, "v1.<exp>") 前 32 个 base64url 字符>
 *   - 插件 worker 用同一个 secret 签 5 分钟票据（iframe 打开时用）
 *   - 票据首次命中后换成 12 小时 cookie，之后 ws/静态资源都靠 cookie
 *
 * 依赖：上游会话 cookie 是启动时向 /login POST 得到的（口令来自 code-server.env，
 * 600），不硬编码、不落盘、不进日志。上游重启换了哈希会自动重新登录。
 */
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import crypto from "node:crypto";

const LISTEN_ADDR = process.env.CS_GATE_LISTEN ?? "0.0.0.0:19081";
const UPSTREAM = process.env.CS_GATE_UPSTREAM ?? "127.0.0.1:19083";
const SECRET_FILE = process.env.CS_GATE_SECRET_FILE ?? "/home/linuxbrew/.startup/code-server-gate.secret";
const CS_ENV_FILE = process.env.CODE_SERVER_ENV_FILE ?? "/home/linuxbrew/.startup/code-server.env";
const TICKET_TTL = Number(process.env.CS_GATE_TICKET_TTL ?? 300); // 5 分钟
const COOKIE_TTL = Number(process.env.CS_GATE_COOKIE_TTL ?? 43200); // 12 小时
const COOKIE_NAME = "cs_gate";
const SESSION_COOKIE = "code-server-session";

const [upHost, upPort] = splitAddr(UPSTREAM);
const [listenHost, listenPort] = splitAddr(LISTEN_ADDR);

function splitAddr(value) {
  const idx = value.lastIndexOf(":");
  return [value.slice(0, idx), Number(value.slice(idx + 1))];
}

function log(...args) {
  console.log(new Date().toISOString(), "[cs-gate]", ...args);
}

function loadSecret() {
  const raw = fs.readFileSync(SECRET_FILE, "utf8").trim();
  if (raw.length < 32) throw new Error(`${SECRET_FILE} 太短（至少 32 个字符）`);
  return raw;
}

function loadPassword() {
  // 只读一次：与 systemd/supervisord 注入的 PASSWORD 保持一致的是这个 600 文件。
  const text = fs.readFileSync(CS_ENV_FILE, "utf8");
  const line = text.split("\n").find((l) => l.startsWith("PASSWORD="));
  if (!line) throw new Error(`${CS_ENV_FILE} 里没有 PASSWORD`);
  return line.slice("PASSWORD=".length).trim();
}

const SECRET = loadSecret();

function sign(exp) {
  const payload = `v1.${exp}`;
  const mac = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url").slice(0, 32);
  return `${payload}.${mac}`;
}

function verify(token) {
  if (typeof token !== "string") return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;
  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
  const expected = crypto.createHmac("sha256", SECRET).update(`v1.${parts[1]}`).digest("base64url").slice(0, 32);
  const a = Buffer.from(parts[2]);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header ?? "").split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    out[key] = part.slice(idx + 1).trim();
  }
  return out;
}

// ---- 上游会话 ----
let sessionCookie = null; // "code-server-session=<hash>"
let loginInFlight = null;

async function loginUpstream() {
  if (loginInFlight) return loginInFlight;
  loginInFlight = (async () => {
    const password = loadPassword();
    const body = `password=${encodeURIComponent(password)}`;
    const res = await fetch(`http://${upHost}:${upPort}/login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      redirect: "manual",
    });
    const setCookie = res.headers.get("set-cookie") ?? "";
    const match = setCookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
    if (!match) throw new Error(`上游登录失败（HTTP ${res.status}），没有 ${SESSION_COOKIE}`);
    sessionCookie = `${SESSION_COOKIE}=${match[1]}`;
    log("上游登录成功");
    return sessionCookie;
  })().finally(() => {
    loginInFlight = null;
  });
  return loginInFlight;
}

async function ensureSession() {
  if (sessionCookie) return sessionCookie;
  return loginUpstream();
}

// ---- 过滤 ----
function isHealth(path) {
  return path === "/healthz" || path.startsWith("/healthz/") || path.startsWith("/healthz?");
}

function gateOf(req, url) {
  if (verify(url.searchParams.get("cs_t"))) return "ticket";
  if (verify(parseCookies(req.headers.cookie)[COOKIE_NAME])) return "cookie";
  return null;
}

function stripTicket(pathname, search) {
  const params = new URLSearchParams(search);
  params.delete("cs_t");
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

// ---- HTTP ----
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://placehold.in");
  const gate = isHealth(url.pathname) ? null : gateOf(req, url);

  if (!gate) {
    // 透传：登录页、独立使用、健康检查都照旧
    proxy(req, res, { injectSession: false, stripSetCookie: false });
    return;
  }

  if (gate === "ticket") {
    // 首次带票据：换成 12 小时 cookie，再 302 到去掉 cs_t 的干净地址
    const exp = Math.floor(Date.now() / 1000) + COOKIE_TTL;
    const cookie = `${COOKIE_NAME}=${sign(exp)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_TTL}`;
    const secure = req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
    const location = stripTicket(url.pathname, url.search);
    res.writeHead(302, {
      Location: location,
      "Set-Cookie": cookie + secure,
      "Cache-Control": "no-store",
    });
    res.end();
    return;
  }

  proxy(req, res, { injectSession: true, stripSetCookie: true });
});

async function proxy(req, res, { injectSession, stripSetCookie }, retried = false) {
  let cookieHeader;
  if (injectSession) {
    try {
      cookieHeader = await ensureSession();
    } catch (error) {
      res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      res.end(`code-server 会话不可用：${error instanceof Error ? error.message : String(error)}\n`);
      return;
    }
  }

  const headers = { ...req.headers, host: `${upHost}:${upPort}` };
  if (injectSession) headers.cookie = cookieHeader;

  const upstream = http.request(
    { host: upHost, port: upPort, method: req.method, path: req.url, headers },
    (up) => {
      const expired = injectSession && up.statusCode >= 300 && up.statusCode < 400 &&
        String(up.headers.location ?? "").includes("/login");
      if (expired && !retried) {
        up.resume();
        sessionCookie = null; // 口令变了 / 上游重启 → 重新登录一次再重放
        log("上游会话失效，重新登录后重试");
        proxy(req, res, { injectSession, stripSetCookie }, true);
        return;
      }

      const out = { ...up.headers };
      if (stripSetCookie) delete out["set-cookie"];
      res.writeHead(up.statusCode ?? 502, out);
      up.pipe(res);
    },
  );
  upstream.on("error", (error) => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    res.end(`上游不可达：${error.message}\n`);
  });
  req.pipe(upstream);
}

// ---- WebSocket / 其它 Upgrade ----
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, "http://placehold.in");
  const gate = gateOf(req, url);

  const open = (cookieHeader) => {
    const up = net.connect(upPort, upHost, () => {
      const lines = [`${req.method} ${req.url} HTTP/1.1`];
      for (const [key, value] of Object.entries(req.headers)) {
        if (key.toLowerCase() === "cookie") continue;
        lines.push(`${key}: ${value}`);
      }
      if (cookieHeader) lines.push(`cookie: ${cookieHeader}`);
      up.write(lines.join("\r\n") + "\r\n\r\n");
      if (head?.length) up.write(head);
      up.pipe(socket);
      socket.pipe(up);
    });
    up.on("error", () => socket.destroy());
    socket.on("error", () => up.destroy());
  };

  if (!gate) {
    open(req.headers.cookie); // 未登录时让上游回 302/403，行为和直连一致
    return;
  }
  ensureSession()
    .then(open)
    .catch(() => socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"));
});

function listen(attempt = 1) {
  server.once("error", (error) => {
    if (error.code === "EADDRINUSE" && attempt <= 30) {
      // 容器重启时 code-server 的旧监听还没释放；等它退干净再绑，不炸。
      log(`端口占用（第 ${attempt} 次），2 秒后重试`);
      setTimeout(() => listen(attempt + 1), 2000);
      return;
    }
    log("监听失败:", error.message);
    process.exit(1);
  });
  server.listen(listenPort, listenHost, () => {
    log(`listening ${listenHost}:${listenPort} → ${upHost}:${upPort}`);
    ensureSession().catch((error) => log("启动时登录失败（上游可能还没起来）:", error.message));
  });
}

listen();

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    log(`收到 ${signal}，退出`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}