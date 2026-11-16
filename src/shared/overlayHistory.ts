/**
 * Browser-Back handling for the full-screen editor overlay.
 *
 * Without this, pressing Back while the editor is open navigates the Paperclip
 * page away (the editor is only component state, so the browser sees the same
 * history entry). Pushing one entry when the overlay opens gives Back something
 * to consume: it closes the editor and leaves the page where it was.
 *
 * Closing with the button or Esc reuses that same entry (`back()`), so repeated
 * open/close cycles do not pile up duplicate history records. `popstate` is the
 * single source of truth: it always closes, whether the pop came from our own
 * `back()` or from the user pressing the browser button.
 */

type HistoryLike = {
  state?: unknown;
  pushState(state: unknown, unused: string, url?: string | URL | null): void;
  back(): void;
};

type WindowLike = {
  history: HistoryLike;
  location: { href: string };
  addEventListener(type: "popstate", listener: () => void): void;
  removeEventListener(type: "popstate", listener: () => void): void;
};

export type OverlayHistory = {
  /** Show the overlay and leave a history entry for Back to consume. */
  open(): void;
  /** Hide the overlay; drops our history entry if it is still on top. */
  close(): void;
  /** Drop the listener without touching history (component unmount). */
  dispose(): void;
};

export function createOverlayHistory({
  win,
  onChange,
}: {
  win: WindowLike;
  onChange: (open: boolean) => void;
}): OverlayHistory {
  let pushed = false;

  const onPopState = () => {
    pushed = false;
    onChange(false);
  };

  win.addEventListener("popstate", onPopState);

  return {
    open() {
      const current = win.history.state;
      const base = current && typeof current === "object" ? (current as Record<string, unknown>) : {};
      win.history.pushState({ ...base, csOverlay: true }, "", win.location.href);
      pushed = true;
      onChange(true);
    },
    close() {
      const hadEntry = pushed;
      pushed = false;
      onChange(false);
      if (hadEntry) win.history.back();
    },
    dispose() {
      pushed = false;
      win.removeEventListener("popstate", onPopState);
    },
  };
}