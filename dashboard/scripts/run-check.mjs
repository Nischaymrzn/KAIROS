// Minimal browser globals so the render check can execute outside a browser.
global.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] ?? null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
};
global.window = { location: { origin: "http://localhost" } };
global.document = { createElement: () => ({ getContext: () => null, click() {}, toDataURL: () => "" }) };
global.fetch = () => Promise.reject(new Error("offline"));

const err = console.error;
console.error = (...a) => { if (!String(a[0]).includes("useLayoutEffect")) err(...a); };

await import("../.ssrcheck/check.mjs");
