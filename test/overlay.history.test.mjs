/**
 * Back-button handling for the full-screen editor overlay.
 *
 * The overlay is component state, so without a history entry the browser Back
 * button navigates the Paperclip page away. These cases pin the contract:
 * one pushed entry, Back closes instead of leaving, close() reuses the entry.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createOverlayHistory } from "../src/shared/overlayHistory.ts";

function fakeWindow() {
  const calls = { push: [], back: 0 };
  const listeners = new Set();
  const win = {
    history: {
      state: { existing: "router-state" },
      pushState(state, _unused, url) {
        calls.push.push({ state, url });
      },
      back() {
        calls.back += 1;
        // The browser fires popstate asynchronously; tests fire it explicitly.
      },
    },
    location: { href: "https://paperclip-19099.example.com:18443/CMP/issues/CMP-29" },
    addEventListener(type, listener) {
      if (type === "popstate") listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === "popstate") listeners.delete(listener);
    },
    // test helpers
    emitPopState() {
      for (const listener of [...listeners]) listener();
    },
    listeners,
  };
  return { win, calls };
}

test("opening pushes exactly one history entry and keeps the router state", () => {
  const { win, calls } = fakeWindow();
  const seen = [];
  const history = createOverlayHistory({ win, onChange: (open) => seen.push(open) });

  history.open();

  assert.equal(calls.push.length, 1);
  assert.equal(calls.push[0].url, win.location.href);
  assert.deepEqual(calls.push[0].state, { existing: "router-state", csOverlay: true });
  assert.deepEqual(seen, [true]);
});

test("browser Back closes the editor instead of navigating away", () => {
  const { win } = fakeWindow();
  const seen = [];
  createOverlayHistory({ win, onChange: (open) => seen.push(open) }).open();

  win.emitPopState();

  assert.deepEqual(seen, [true, false]);
});

test("the close button reuses our entry, so open/close does not stack history", () => {
  const { win, calls } = fakeWindow();
  const seen = [];
  const history = createOverlayHistory({ win, onChange: (open) => seen.push(open) });

  history.open();
  history.close();
  win.emitPopState(); // the async pop after back()

  assert.equal(calls.back, 1);
  assert.deepEqual(seen, [true, false, false]);

  // A second cycle pushes a new entry rather than consuming a stale one.
  history.open();
  history.close();
  assert.equal(calls.push.length, 2);
  assert.equal(calls.back, 2);
});

test("closing while never opened does not touch browser history", () => {
  const { win, calls } = fakeWindow();
  const seen = [];
  const history = createOverlayHistory({ win, onChange: (open) => seen.push(open) });

  history.close();

  assert.equal(calls.back, 0);
  assert.equal(calls.push.length, 0);
  assert.deepEqual(seen, [false]);
});

test("after browser Back the next close no longer calls back()", () => {
  const { win, calls } = fakeWindow();
  const history = createOverlayHistory({ win, onChange: () => {} });

  history.open();
  win.emitPopState(); // user pressed Back: the entry is gone
  history.close();

  assert.equal(calls.back, 0);
});

test("dispose drops the popstate listener", () => {
  const { win } = fakeWindow();
  let closes = 0;
  const history = createOverlayHistory({ win, onChange: (open) => { if (!open) closes += 1; } });

  history.open();
  history.dispose();
  win.emitPopState();

  assert.equal(closes, 0);
  assert.equal(win.listeners.size, 0);
});