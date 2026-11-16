/**
 * code-server embedding UI.
 *
 * Slots:
 * - `CodeServerToolbarButton` (globalToolbarButton) → the single top-bar
 *   "Code" entry. It resolves the task/project the current page is showing and
 *   opens that entity's own workspace full-screen. Renders nothing on pages
 *   that are not a task or a project.
 * - `CodeServerContextTab` (detailTab on issue) → the same editor as a
 *   borderless, chrome-free side-panel tab: only the editor, filling the tab.
 * - `CodeServerPage` (page) → full-bleed editor for direct plugin-route access.
 *
 * Build constraints: this module is imported by the Paperclip UI as a same-origin
 * ES module. Only `react`, `react-dom`, `react/jsx-runtime` and
 * `@paperclipai/plugin-sdk/ui` may stay as bare imports (the host rewrites them).
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useHostContext, usePluginData } from "@paperclipai/plugin-sdk/ui";
import { buildCodeServerUrl, deriveCodeServerBase } from "../shared/urls.js";

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
  source: "issue_workspace" | "project_workspace";
  name: string | null;
  entityType: "issue" | "project";
};

type EntityType = WorkspaceResult["entityType"];

/** Direct plugin-route access has no entity; show the projects root. */
const PAGE_FOLDER = "/home/linuxbrew/Projects";

/** The editor is theme-neutral: `Canvas` follows the host's light/dark scheme. */
const FRAME_STYLE = {
  width: "100%",
  height: "100%",
  border: "none",
  display: "block",
  background: "Canvas",
} as const;

const STATUS_STYLE = {
  padding: "12px",
  fontSize: "12px",
  lineHeight: 1.6,
  color: "inherit",
  background: "Canvas",
} as const;

const ENTRY_BUTTON_STYLE = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  font: "inherit",
  fontSize: "12px",
  padding: "4px 10px",
  borderRadius: "6px",
  border: "1px solid color-mix(in srgb, currentColor 18%, transparent)",
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
} as const;

const OVERLAY_STYLE = {
  position: "fixed",
  inset: 0,
  zIndex: 2147483000,
  display: "flex",
  flexDirection: "column",
  background: "Canvas",
  color: "CanvasText",
} as const;

const TERMINAL_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" y1="19" x2="20" y2="19" />
  </svg>
);

/**
 * Full-screen overlays escape the page container: the task header can sit in a
 * transformed/scrolled ancestor that would otherwise clip `position: fixed`.
 * The portal is skipped during static rendering (tests).
 */
function PortalLayer({ children }: { children: ReactNode }) {
  if (typeof document === "undefined" || !document.body) return <>{children}</>;
  return createPortal(children, document.body);
}

function useCodeServerBase(): string {
  return useMemo(() => deriveCodeServerBase(window.location), []);
}

/** Parse `/CMP/issues/CMP-29` and `/CMP/projects/<ref>` into an entity. */
function routeEntity(pathname: string | undefined): {
  entityId: string;
  entityType: EntityType;
} | null {
  const segments = (pathname ?? "")
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (segments[index] === "issues") {
      return { entityType: "issue", entityId: segments[index + 1]! };
    }
    if (segments[index] === "projects") {
      return { entityType: "project", entityId: segments[index + 1]! };
    }
  }
  return null;
}

function CodeFrame({ frameUrl, title }: { frameUrl: string; title: string }) {
  return (
    <iframe
      src={frameUrl}
      style={FRAME_STYLE}
      title={title}
      allow="clipboard-read; clipboard-write"
    />
  );
}

/** Resolve the current page's entity, preferring the route over host context. */
function useActiveEntity(): {
  entityId: string;
  entityType: EntityType;
  companyId: string | null;
} | null {
  const host = useHostContext();
  return useMemo(() => {
    const fromRoute = routeEntity(window.location.pathname);
    if (fromRoute) return { ...fromRoute, companyId: host.companyId ?? null };
    if ((host.entityType === "issue" || host.entityType === "project") && host.entityId) {
      return {
        entityId: host.entityId,
        entityType: host.entityType,
        companyId: host.companyId ?? null,
      };
    }
    return null;
  }, [host.companyId, host.entityId, host.entityType]);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Project pages use a url key (`/CMP/projects/opc`), while the plugin bridge
 * only accepts a project UUID. Resolve it through the host's own read API
 * (same-origin session), so the plugin needs no extra project capability.
 */
function ProjectRefEntry({
  projectRef,
  companyId,
}: {
  projectRef: string;
  companyId: string | null;
}) {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId) {
      setResolveError("缺少公司上下文，无法定位项目");
      return;
    }
    let cancelled = false;
    const params = new URLSearchParams({ companyId });
    fetch(`/api/projects/${encodeURIComponent(projectRef)}?${params}`, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = (await response.json()) as { id?: string; project?: { id?: string } };
        const id = body?.project?.id ?? body?.id;
        if (!id) throw new Error("响应里没有项目 id");
        if (!cancelled) setProjectId(id);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setResolveError(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, projectRef]);

  if (projectId) return <CodeEntryButton entityId={projectId} entityType="project" />;
  return (
    <button
      type="button"
      style={ENTRY_BUTTON_STYLE}
      title={resolveError ? `无法定位这个项目：${resolveError}` : "正在定位这个项目…"}
      disabled
    >
      {TERMINAL_ICON}
      <span>Code</span>
    </button>
  );
}

/** Full-screen editor for one entity, opened from the top-bar button. */
function CodeEntryButton({
  entityId,
  entityType,
}: {
  entityId: string;
  entityType: EntityType;
}) {
  const { data, loading, error } = usePluginData<WorkspaceResult>("workspace", {
    entityId,
    entityType,
  });
  const baseUrl = useCodeServerBase();
  const [open, setOpen] = useState(false);

  const folder = data?.path ?? "";
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

  const title = loading
    ? "正在解析工作区目录"
    : folder
      ? `在 Paperclip 里打开 ${folder}`
      : "没有解析到工作区目录";

  return (
    <>
      <button
        type="button"
        style={ENTRY_BUTTON_STYLE}
        title={title}
        onClick={() => setOpen(true)}
      >
        {TERMINAL_ICON}
        <span>Code</span>
      </button>
      {open ? (
        <PortalLayer>
          <div style={OVERLAY_STYLE} role="dialog" aria-label="code-server">
            {frameUrl ? (
              <CodeFrame frameUrl={frameUrl} title="code-server" />
            ) : (
              <div style={STATUS_STYLE}>
                {loading
                  ? "正在解析这个页面的工作区目录…"
                  : error?.message ?? "这个页面没有可用的工作区目录。"}
              </div>
            )}
          </div>
        </PortalLayer>
      ) : null}
    </>
  );
}

/**
 * Top-bar entry. One "Code" button, scoped to the task/project of the page
 * currently on screen; hidden everywhere else.
 */
export function CodeServerToolbarButton(_props: SlotProps) {
  const entity = useActiveEntity();
  if (!entity) return null;
  if (entity.entityType === "project" && !UUID_RE.test(entity.entityId)) {
    return <ProjectRefEntry projectRef={entity.entityId} companyId={entity.companyId} />;
  }
  return <CodeEntryButton entityId={entity.entityId} entityType={entity.entityType} />;
}

/**
 * Side-panel tab on a task: chrome-free. The workspace is resolved by the
 * worker; the editor fills the tab. No folder picker, no reload controls.
 */
export function CodeServerContextTab(_props: SlotProps) {
  const host = useHostContext();
  const entityId = host.entityId ?? null;
  const entityType = (host.entityType === "issue" || host.entityType === "project")
    ? host.entityType
    : null;
  const { data, loading, error } = usePluginData<WorkspaceResult>("workspace", {
    entityId,
    entityType,
  });
  const baseUrl = useCodeServerBase();

  const folder = data?.path ?? "";
  const frameUrl = useMemo(
    () => (folder ? buildCodeServerUrl(baseUrl, folder) : ""),
    [baseUrl, folder],
  );

  if (frameUrl) return <CodeFrame frameUrl={frameUrl} title="code-server" />;
  return (
    <div style={STATUS_STYLE}>
      {loading
        ? "正在解析这个任务的工作区目录…"
        : error?.message ?? "这个任务没有可用的工作区目录。"}
    </div>
  );
}

/**
 * Direct plugin route (`/:companyPrefix/plugins/:pluginId`): full-bleed editor,
 * no page chrome or navigation controls.
 */
export function CodeServerPage(_props: SlotProps) {
  const baseUrl = useCodeServerBase();
  const frameUrl = useMemo(
    () => buildCodeServerUrl(baseUrl, PAGE_FOLDER),
    [baseUrl],
  );
  return (
    <div style={{ height: "calc(100vh - 8rem)", minHeight: "400px" }}>
      <CodeFrame frameUrl={frameUrl} title="code-server" />
    </div>
  );
}