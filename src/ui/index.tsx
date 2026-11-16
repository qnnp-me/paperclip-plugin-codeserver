/**
 * code-server embedding UI.
 *
 * Slots:
 * - `CodeServerPage` (page)  → full-height iframe into code-server, folder picker.
 * - `CodeServerToolbarButton` (globalToolbarButton) → top-bar button linking to that page.
 *
 * Build constraints: this module is imported by the Paperclip UI as a same-origin
 * ES module. Only `react`, `react-dom`, `react/jsx-runtime` and
 * `@paperclipai/plugin-sdk/ui` may stay as bare imports (the host rewrites them).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { buildCodeServerUrl, deriveCodeServerBase } from "../shared/urls.js";

type SlotContext = {
  companyId?: string | null;
  companyPrefix?: string | null;
};

type SlotProps = {
  slot?: { pluginId?: string; displayName?: string };
  context?: SlotContext;
};

const BASE_URL_KEY = "paperclip.codeserver.baseUrl";
const FOLDER_KEY = "paperclip.codeserver.folder";

const DEFAULT_FOLDERS = [
  "/home/linuxbrew/Projects/qnnp-opc",
  "/home/linuxbrew/Projects",
  "/home/linuxbrew",
];

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage may be unavailable; the in-memory state still works */
  }
}

const styles = {
  root: {
    display: "flex",
    flexDirection: "column" as const,
    height: "calc(100vh - 7.5rem)",
    minHeight: "420px",
    gap: "8px",
  },
  bar: {
    display: "flex",
    flexWrap: "wrap" as const,
    alignItems: "center",
    gap: "8px",
    fontSize: "12px",
  },
  label: { opacity: 0.7 },
  input: {
    font: "inherit",
    fontSize: "12px",
    padding: "6px 8px",
    borderRadius: "6px",
    border: "1px solid color-mix(in srgb, currentColor 25%, transparent)",
    background: "transparent",
    color: "inherit",
    minWidth: "0",
  },
  baseInput: { flex: "1 1 260px" },
  button: {
    font: "inherit",
    fontSize: "12px",
    padding: "6px 10px",
    borderRadius: "6px",
    border: "1px solid color-mix(in srgb, currentColor 25%, transparent)",
    background: "transparent",
    color: "inherit",
    cursor: "pointer",
  },
  link: { fontSize: "12px", textDecoration: "underline" },
  frameWrap: {
    flex: "1 1 auto",
    minHeight: "0",
    border: "1px solid color-mix(in srgb, currentColor 18%, transparent)",
    borderRadius: "8px",
    overflow: "hidden",
    background: "#1e1e1e",
  },
  frame: { width: "100%", height: "100%", border: "none", display: "block" },
  hint: { fontSize: "11px", opacity: 0.65, lineHeight: 1.5 },
  toolbarButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    font: "inherit",
    fontSize: "12px",
    padding: "4px 10px",
    borderRadius: "6px",
    border: "1px solid color-mix(in srgb, currentColor 22%, transparent)",
    background: "transparent",
    color: "inherit",
    textDecoration: "none",
    cursor: "pointer",
  },
};

const TERMINAL_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" y1="19" x2="20" y2="19" />
  </svg>
);

export function CodeServerPage({ context }: SlotProps) {
  const defaultBase = useMemo(
    () => deriveCodeServerBase(window.location),
    [],
  );
  const [baseUrl, setBaseUrl] = useState<string>(() => readStored(BASE_URL_KEY) ?? defaultBase);
  const [folder, setFolder] = useState<string>(() => readStored(FOLDER_KEY) ?? DEFAULT_FOLDERS[0]);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    writeStored(BASE_URL_KEY, baseUrl);
  }, [baseUrl]);

  useEffect(() => {
    writeStored(FOLDER_KEY, folder);
  }, [folder]);

  const frameUrl = useMemo(() => buildCodeServerUrl(baseUrl, folder), [baseUrl, folder]);
  const reload = useCallback(() => setReloadKey((value) => value + 1), []);

  return (
    <div style={styles.root}>
      <div style={styles.bar}>
        <span style={styles.label}>目录</span>
        <input
          style={{ ...styles.input, flex: "1 1 240px" }}
          value={folder}
          onChange={(event) => setFolder(event.target.value)}
          placeholder="/home/linuxbrew/Projects/qnnp-opc"
          spellCheck={false}
        />
        <select
          style={styles.input}
          value=""
          onChange={(event) => {
            if (event.target.value) setFolder(event.target.value);
          }}
          title="常用目录"
        >
          <option value="">常用目录…</option>
          {DEFAULT_FOLDERS.map((entry) => (
            <option key={entry} value={entry}>{entry}</option>
          ))}
        </select>
        <button type="button" style={styles.button} onClick={reload}>重新加载</button>
        <a style={styles.link} href={frameUrl} target="_blank" rel="noreferrer">新标签打开</a>
      </div>
      <div style={styles.bar}>
        <span style={styles.label}>code-server</span>
        <input
          style={{ ...styles.input, ...styles.baseInput }}
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          placeholder={defaultBase}
          spellCheck={false}
        />
        {baseUrl !== defaultBase ? (
          <button type="button" style={styles.button} onClick={() => setBaseUrl(defaultBase)}>恢复默认</button>
        ) : null}
      </div>
      <div style={styles.frameWrap}>
        <iframe
          key={reloadKey}
          src={frameUrl}
          style={styles.frame}
          title="code-server"
          allow="clipboard-read; clipboard-write"
        />
      </div>
      <div style={styles.hint}>
        首次使用会看到 code-server 登录页，密码在容器里：
        <code> grep '^PASSWORD=' /home/linuxbrew/.startup/code-server.env</code>
        。登录后 cookie 与 Paperclip 同站共享，后续直接进编辑器。若长时间空白，检查 code-server 是否在跑
        （<code>supervisorctl -c /home/linuxbrew/.startup/supervisord.conf status code-server</code>）以及反代是否转发 WebSocket。
        {context?.companyId ? "" : null}
      </div>
    </div>
  );
}

export function CodeServerToolbarButton({ slot, context }: SlotProps) {
  const prefix = context?.companyPrefix ?? "";
  const pluginId = slot?.pluginId ?? "qnnp.codeserver";
  const href = prefix ? `/${prefix}/plugins/${encodeURIComponent(pluginId)}` : `/plugins/${encodeURIComponent(pluginId)}`;
  return (
    <a style={styles.toolbarButton} href={href} title="在 Paperclip 里打开 code-server">
      {TERMINAL_ICON}
      <span>Code</span>
    </a>
  );
}

export default CodeServerPage;