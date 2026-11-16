/**
 * code-server embedding UI.
 *
 * Slots:
 * - `CodeServerEntityButton` (toolbarButton on issue + project) → the entry
 *   point that is actually visible in the chat-shell task page: one compact
 *   "Code" button opens a full-screen editor overlay for this entity's own
 *   workspace. No path bar, no address bar until you click.
 * - `CodeServerContextTab` (detailTab on issue + project) → same editor as an
 *   inline tab for the classic task interface.
 * - `CodeServerPage` (page) → full height editor + folder picker.
 * - `CodeServerToolbarButton` (globalToolbarButton) → top-bar button to the page.
 *
 * Build constraints: this module is imported by the Paperclip UI as a same-origin
 * ES module. Only `react`, `react-dom`, `react/jsx-runtime` and
 * `@paperclipai/plugin-sdk/ui` may stay as bare imports (the host rewrites them).
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
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

const DEFAULT_FOLDERS = [
  "/home/linuxbrew/Projects/qnnp-opc",
  "/home/linuxbrew/Projects",
  "/home/linuxbrew",
];

/** Per-entity manual override; auto-resolution wins until the user edits. */
function overrideKey(entityType: string | null, entityId: string | null): string | null {
  if (!entityType || !entityId) return null;
  return `paperclip.codeserver.folder.${entityType}.${entityId}`;
}

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

const border = "1px solid color-mix(in srgb, currentColor 18%, transparent)";

const styles = {
  page: {
    display: "flex",
    flexDirection: "column" as const,
    height: "calc(100vh - 7.5rem)",
    minHeight: "420px",
    gap: "8px",
  },
  tab: {
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
  label: { opacity: 0.65 },
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
    border,
    opacity: 0.75,
  },
  input: {
    font: "inherit",
    fontSize: "12px",
    padding: "6px 8px",
    borderRadius: "6px",
    border,
    background: "transparent",
    color: "inherit",
    minWidth: "0",
  },
  button: {
    font: "inherit",
    fontSize: "12px",
    padding: "6px 10px",
    borderRadius: "6px",
    border,
    background: "transparent",
    color: "inherit",
    cursor: "pointer",
  },
  entryButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    font: "inherit",
    fontSize: "12px",
    padding: "4px 10px",
    borderRadius: "6px",
    border,
    background: "transparent",
    color: "inherit",
    cursor: "pointer",
  },
  link: { fontSize: "12px", textDecoration: "underline" },
  frameWrap: {
    flex: "1 1 auto",
    minHeight: "0",
    border,
    borderRadius: "8px",
    overflow: "hidden",
    background: "#1e1e1e",
  },
  frame: { width: "100%", height: "100%", border: "none", display: "block" },
  notice: {
    fontSize: "12px",
    padding: "10px 12px",
    borderRadius: "8px",
    border,
    lineHeight: 1.6,
  },
  settings: { fontSize: "12px" },
  settingsBody: {
    display: "flex",
    flexWrap: "wrap" as const,
    alignItems: "center",
    gap: "8px",
    paddingTop: "6px",
  },
  overlay: {
    position: "fixed" as const,
    inset: 0,
    zIndex: 2147483000,
    display: "flex",
    flexDirection: "column" as const,
    background: "#1e1e1e",
    color: "#e6e6e6",
  },
  overlayBar: {
    display: "flex",
    flexWrap: "wrap" as const,
    alignItems: "center",
    gap: "10px",
    padding: "8px 12px",
    fontSize: "12px",
    background: "#252526",
    borderBottom: "1px solid #3c3c3c",
    color: "#cccccc",
  },
  overlaySpacer: { flex: "1 1 auto" },
  overlayButton: {
    font: "inherit",
    fontSize: "12px",
    padding: "4px 10px",
    borderRadius: "6px",
    border: "1px solid #3c3c3c",
    background: "transparent",
    color: "#cccccc",
    cursor: "pointer",
  },
  overlayFrame: { flex: "1 1 auto", width: "100%", border: "none", display: "block" },
  overlayNotice: {
    padding: "24px",
    fontSize: "13px",
    lineHeight: 1.7,
    color: "#cccccc",
    display: "flex",
    flexDirection: "column" as const,
    gap: "12px",
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

/**
 * Full-screen overlays escape the page container: the task header can sit in a
 * transformed/scrolled ancestor that would otherwise clip `position: fixed`.
 * The portal is skipped during static rendering (tests).
 */
function PortalLayer({ children }: { children: ReactNode }) {
  if (typeof document === "undefined" || !document.body) return <>{children}</>;
  return createPortal(children, document.body);
}

function CodeServerFrame({ frameUrl, reloadKey }: { frameUrl: string; reloadKey: number }) {
  if (!frameUrl) {
    return (
      <div style={{ ...styles.notice, border: "none" }}>没有可用的目录。</div>
    );
  }
  return (
    <div style={styles.frameWrap}>
      <iframe
        key={reloadKey}
        src={frameUrl}
        style={styles.frame}
        title="code-server"
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
}

/** Collapsed server-address field; hidden until someone actually needs it. */
function BaseUrlSettings({
  baseUrl,
  defaultBase,
  onChange,
  onReset,
}: {
  baseUrl: string;
  defaultBase: string;
  onChange: (next: string) => void;
  onReset: () => void;
}) {
  return (
    <details style={styles.settings}>
      <summary style={{ cursor: "pointer", opacity: 0.6 }}>设置</summary>
      <div style={styles.settingsBody}>
        <span style={styles.label}>code-server 地址</span>
        <input
          style={{ ...styles.input, flex: "1 1 260px" }}
          value={baseUrl}
          onChange={(event) => onChange(event.target.value)}
          placeholder={defaultBase}
          spellCheck={false}
        />
        {baseUrl !== defaultBase ? (
          <button type="button" style={styles.button} onClick={onReset}>恢复默认</button>
        ) : null}
      </div>
    </details>
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

  return (
    <div style={styles.page}>
      <div style={styles.bar}>
        <input
          style={{ ...styles.input, flex: "1 1 280px" }}
          value={folder}
          onChange={(event) => setFolder(event.target.value)}
          placeholder={DEFAULT_FOLDERS[0]}
          spellCheck={false}
          aria-label="目录"
        />
        <button type="button" style={styles.button} onClick={() => setReloadKey((value) => value + 1)}>
          打开
        </button>
        {frameUrl ? (
          <a style={styles.link} href={frameUrl} target="_blank" rel="noreferrer">新标签</a>
        ) : null}
        {context?.companyId ? null : null}
      </div>
      <CodeServerFrame frameUrl={frameUrl} reloadKey={reloadKey} />
      <BaseUrlSettings
        baseUrl={baseUrl}
        defaultBase={defaultBase}
        onChange={setBaseUrl}
        onReset={() => setBaseUrl(defaultBase)}
      />
    </div>
  );
}

/**
 * Task/project tab (classic interface): the folder comes from the entity's
 * workspace, resolved by the worker.
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
    <div style={styles.tab}>
      <div style={styles.bar}>
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
          <a style={styles.link} href={frameUrl} target="_blank" rel="noreferrer">新标签</a>
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
            placeholder={DEFAULT_FOLDERS[0]}
            spellCheck={false}
            autoFocus
          />
          <button type="button" style={styles.button} onClick={applyDraft}>应用</button>
        </div>
      ) : null}

      {loading ? <div style={styles.notice}>正在解析这个{entityType === "project" ? "项目" : "任务"}的工作区目录…</div> : null}

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

      <BaseUrlSettings
        baseUrl={baseUrl}
        defaultBase={defaultBase}
        onChange={setBaseUrl}
        onReset={() => setBaseUrl(defaultBase)}
      />
    </div>
  );
}

/**
 * Task/project toolbar entry (visible in the default chat-shell UI, where the
 * detail tab strip is hidden). One click opens the entity's workspace in a
 * full-screen editor; the page itself stays untouched until then.
 */
export function CodeServerEntityButton() {
  const host = useHostContext();
  const entityId = host.entityId ?? null;
  const entityType = host.entityType ?? null;
  const entityKey = overrideKey(entityType, entityId);
  const { data, loading, error } = usePluginData<WorkspaceResult>("workspace", {
    entityId,
    entityType,
  });

  const [baseUrl] = useCodeServerBase();
  const [open, setOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [draft, setDraft] = useState("");
  const [customFolder, setCustomFolder] = useState<string | null>(() => {
    const stored = entityKey ? readStored(entityKey) : null;
    return stored && stored.trim() ? stored : null;
  });

  const resolvedPath = data?.path ?? "";
  const folder = (customFolder ?? resolvedPath).trim();
  const frameUrl = useMemo(
    () => (folder ? buildCodeServerUrl(baseUrl, folder) : ""),
    [baseUrl, folder],
  );

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const applyDraft = useCallback(() => {
    const next = draft.trim();
    if (!next) return;
    setCustomFolder(next);
    if (entityKey) writeStored(entityKey, next);
    setReloadKey((value) => value + 1);
  }, [draft, entityKey]);

  const title = loading
    ? "正在解析工作区目录"
    : folder
    ? `在 Paperclip 里打开 ${folder}`
    : "没有解析到工作区目录，点击手动指定";

  return (
    <>
      <button type="button" style={styles.entryButton} title={title} onClick={() => setOpen((value) => !value)}>
        {TERMINAL_ICON}
        <span>Code</span>
      </button>
      {open ? (
        <PortalLayer>
        <div style={styles.overlay} role="dialog" aria-label="code-server">
          <div style={styles.overlayBar}>
            <span style={styles.path}>{loading ? "解析中…" : folder || "（未解析到目录）"}</span>
            {data ? <span style={styles.chip}>{describeSource(data.source)}</span> : null}
            {customFolder ? <span style={styles.chip}>手改</span> : null}
            <span style={styles.overlaySpacer} />
            {frameUrl ? (
              <button
                type="button"
                style={styles.overlayButton}
                onClick={() => setReloadKey((value) => value + 1)}
              >
                重新加载
              </button>
            ) : null}
            {frameUrl ? (
              <a style={{ ...styles.link, color: "#cccccc" }} href={frameUrl} target="_blank" rel="noreferrer">新标签</a>
            ) : null}
            <button type="button" style={styles.overlayButton} onClick={() => setOpen(false)}>关闭</button>
          </div>
          {frameUrl ? (
            <iframe
              key={reloadKey}
              src={frameUrl}
              style={styles.overlayFrame}
              title="code-server"
              allow="clipboard-read; clipboard-write"
            />
          ) : (
            <div style={styles.overlayNotice}>
              <div>
                {loading
                  ? `正在解析这个${entityType === "project" ? "项目" : "任务"}的工作区目录…`
                  : error?.message
                  ? `解析工作区失败：${error.message}`
                  : `这个${entityType === "project" ? "项目" : "任务"}没有可用的工作区目录。`}
              </div>
              {loading ? null : (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <input
                    style={{ ...styles.input, flex: "1 1 320px", color: "#e6e6e6", borderColor: "#3c3c3c" }}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") applyDraft();
                    }}
                    placeholder="手动填一个绝对路径，例如 /home/linuxbrew/Projects/qnnp-opc"
                    spellCheck={false}
                  />
                  <button type="button" style={styles.overlayButton} onClick={applyDraft}>用这个目录</button>
                </div>
              )}
            </div>
          )}
        </div>
        </PortalLayer>
      ) : null}
    </>
  );
}

export function CodeServerToolbarButton({ slot, context }: SlotProps) {
  const prefix = context?.companyPrefix ?? "";
  const pluginId = slot?.pluginId ?? "qnnp.codeserver";
  const href = prefix ? `/${prefix}/plugins/${encodeURIComponent(pluginId)}` : `/plugins/${encodeURIComponent(pluginId)}`;
  return (
    <a style={styles.entryButton} href={href} title="在 Paperclip 里打开 code-server">
      {TERMINAL_ICON}
      <span>Code</span>
    </a>
  );
}

export default CodeServerPage;