/**
 * code-server embedding UI.
 *
 * Slots:
 * - `CodeServerPage` (page) → full-height iframe into code-server, folder picker.
 * - `CodeServerToolbarButton` (globalToolbarButton) → top-bar button to that page.
 * - `CodeServerContextTab` (detailTab on issue + project) → opens the entity's
 *   own workspace folder automatically; the folder is resolved by the worker
 *   (`workspace` data key), not hardcoded here.
 *
 * Build constraints: this module is imported by the Paperclip UI as a same-origin
 * ES module. Only `react`, `react-dom`, `react/jsx-runtime` and
 * `@paperclipai/plugin-sdk/ui` may stay as bare imports (the host rewrites them).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useHostContext, usePluginData } from "@paperclipai/plugin-sdk/ui";
import { buildCodeServerUrl, deriveCodeServerBase } from "../shared/urls.js";
import { describeSource, type TargetSource } from "../shared/workspace.js";

type SlotContext = {
  companyId?: string | null;
  companyPrefix?: string | null;
};

type SlotProps = {
  slot?: { pluginId?: string; displayName?: string };
  context?: SlotContext;
};

type WorkspaceResult = {
  path: string;
  source: TargetSource;
  name: string | null;
  entityType: "issue" | "project";
};

const BASE_URL_KEY = "paperclip.codeserver.baseUrl";
const FOLDER_KEY = "paperclip.codeserver.folder";

/** Per-entity manual override; auto-resolution wins until the user edits. */
function overrideKey(entityType: string | null, entityId: string | null): string | null {
  if (!entityType || !entityId) return null;
  return `paperclip.codeserver.folder.${entityType}.${entityId}`;
}

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

function clearStored(key: string): void {
  try {
    window.localStorage.removeItem(key);
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
  tabRoot: {
    display: "flex",
    flexDirection: "column" as const,
    height: "calc(100vh - 16rem)",
    minHeight: "460px",
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
  path: {
    fontFamily:
      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace",
    fontSize: "12px",
    wordBreak: "break-all" as const,
  },
  chip: {
    fontSize: "11px",
    padding: "2px 6px",
    borderRadius: "999px",
    border: "1px solid color-mix(in srgb, currentColor 25%, transparent)",
    opacity: 0.8,
  },
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
  notice: {
    fontSize: "12px",
    padding: "10px 12px",
    borderRadius: "8px",
    border: "1px solid color-mix(in srgb, currentColor 18%, transparent)",
    lineHeight: 1.6,
  },
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

function useCodeServerBase(): [string, (next: string) => void] {
  const defaultBase = useMemo(() => deriveCodeServerBase(window.location), []);
  const [baseUrl, setBaseUrl] = useState<string>(() => readStored(BASE_URL_KEY) ?? defaultBase);
  useEffect(() => {
    writeStored(BASE_URL_KEY, baseUrl);
  }, [baseUrl]);
  return [baseUrl, setBaseUrl];
}

function CodeServerFrame({
  frameUrl,
  reloadKey,
}: {
  frameUrl: string;
  reloadKey: number;
}) {
  return (
    <div style={styles.frameWrap}>
      {frameUrl ? (
        <iframe
          key={reloadKey}
          src={frameUrl}
          style={styles.frame}
          title="code-server"
          allow="clipboard-read; clipboard-write"
        />
      ) : (
        <div style={{ ...styles.notice, border: "none", height: "100%" }}>
          没有可用的目录。
        </div>
      )}
    </div>
  );
}

export function CodeServerPage({ context }: SlotProps) {
  const [baseUrl, setBaseUrl] = useCodeServerBase();
  const defaultBase = useMemo(() => deriveCodeServerBase(window.location), []);
  const [folder, setFolder] = useState<string>(() => readStored(FOLDER_KEY) ?? DEFAULT_FOLDERS[0]);
  const [reloadKey, setReloadKey] = useState(0);

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
      <CodeServerFrame frameUrl={frameUrl} reloadKey={reloadKey} />
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

/**
 * Task/project tab: the folder comes from the entity's workspace, resolved by
 * the worker. Opening this tab on CMP-29 lands in CMP-29's own folder instead
 * of a global default.
 */
export function CodeServerContextTab() {
  const host = useHostContext();
  const entityId = host.entityId ?? null;
  const entityType = host.entityType ?? null;
  const entityKey = overrideKey(entityType, entityId);
  const { data, loading, error, refresh } = usePluginData<WorkspaceResult>("workspace", {
    entityId,
    entityType,
  });

  const [baseUrl, setBaseUrl] = useCodeServerBase();
  const defaultBase = useMemo(() => deriveCodeServerBase(window.location), []);
  const [customFolder, setCustomFolder] = useState<string | null>(() => {
    const stored = entityKey ? readStored(entityKey) : null;
    return stored && stored.trim() ? stored : null;
  });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const resolvedPath = data?.path ?? "";
  const folder = (customFolder ?? resolvedPath).trim();
  const frameUrl = useMemo(
    () => (folder ? buildCodeServerUrl(baseUrl, folder) : ""),
    [baseUrl, folder],
  );

  const applyDraft = useCallback(() => {
    const next = draft.trim();
    if (!next) return;
    setCustomFolder(next);
    if (entityKey) writeStored(entityKey, next);
    setEditing(false);
    setReloadKey((value) => value + 1);
  }, [draft, entityKey]);

  const resetToResolved = useCallback(() => {
    setCustomFolder(null);
    if (entityKey) clearStored(entityKey);
    setEditing(false);
    setReloadKey((value) => value + 1);
  }, [entityKey]);

  const errorMessage = error?.message ?? null;
  const showFrame = !loading && Boolean(frameUrl);

  return (
    <div style={styles.tabRoot}>
      <div style={styles.bar}>
        <span style={styles.label}>目录</span>
        <span style={styles.path}>{loading ? "解析中…" : folder || "（未解析到目录）"}</span>
        {data ? <span style={styles.chip}>{describeSource(data.source)}</span> : null}
        {customFolder ? <span style={styles.chip}>手改</span> : null}
        <button type="button" style={styles.button} onClick={() => setReloadKey((value) => value + 1)}>
          重新加载
        </button>
        <button
          type="button"
          style={styles.button}
          onClick={() => {
            refresh();
            setReloadKey((value) => value + 1);
          }}
        >
          重新解析
        </button>
        <button
          type="button"
          style={styles.button}
          onClick={() => {
            setDraft(folder);
            setEditing((value) => !value);
          }}
        >
          {editing ? "收起" : "改目录"}
        </button>
        {customFolder ? (
          <button type="button" style={styles.button} onClick={resetToResolved}>恢复工作区目录</button>
        ) : null}
        {frameUrl ? (
          <a style={styles.link} href={frameUrl} target="_blank" rel="noreferrer">新标签打开</a>
        ) : null}
      </div>

      {editing ? (
        <div style={styles.bar}>
          <input
            style={{ ...styles.input, flex: "1 1 320px" }}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") applyDraft();
            }}
            placeholder="/home/linuxbrew/Projects/qnnp-opc"
            spellCheck={false}
            autoFocus
          />
          <button type="button" style={styles.button} onClick={applyDraft}>应用</button>
        </div>
      ) : null}

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

      {loading ? (
        <div style={styles.notice}>正在解析这个{entityType === "project" ? "项目" : "任务"}的工作区目录…</div>
      ) : null}

      {!loading && (errorMessage || !folder) ? (
        <div style={styles.notice}>
          <div>
            {errorMessage
              ? `解析工作区失败：${errorMessage}`
              : `这个${entityType === "project" ? "项目" : "任务"}没有可用的工作区目录。`}
          </div>
          <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              style={{ ...styles.input, flex: "1 1 320px" }}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") applyDraft();
              }}
              placeholder="手动填一个绝对路径，例如 /home/linuxbrew/Projects/qnnp-opc"
              spellCheck={false}
            />
            <button type="button" style={styles.button} onClick={applyDraft}>用这个目录</button>
            <button type="button" style={styles.button} onClick={() => refresh()}>重试</button>
          </div>
        </div>
      ) : null}

      {showFrame ? <CodeServerFrame frameUrl={frameUrl} reloadKey={reloadKey} /> : null}

      {showFrame ? (
        <div style={styles.hint}>
          目录随当前{entityType === "project" ? "项目" : "任务"}的工作区变化；首次使用需在 iframe 里登录一次
          code-server（密码：<code>grep '^PASSWORD=' /home/linuxbrew/.startup/code-server.env</code>）。
        </div>
      ) : null}
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