// Runs one untrusted JavaScript deliverable against a list of test cases.
// It lives in its own worker thread (killed on a hard timeout, memory capped by the parent)
// and inside a fresh vm context with no require, process, fs, network, timers or eval.
// Only primitive strings cross into the context, so no host object can be used to climb out.
// This is a demo sandbox, not a hardened one: production checks belong in a container, a TEE or a zk proof.
import { parentPort, workerData } from "node:worker_threads";
import vm from "node:vm";

const { code, exportName, casesJson, timeoutMs } = workerData;

function finish(payload) {
  parentPort.postMessage(payload);
}

try {
  if (!/^[A-Za-z_$][\w$]*$/.test(exportName)) throw new Error("Bad export name in the check");
  const context = vm.createContext(
    {},
    { name: "arena-entry", codeGeneration: { strings: false, wasm: false }, microtaskMode: "afterEvaluate" },
  );
  vm.runInContext("var module = { exports: {} }; var exports = module.exports;", context, { timeout: timeoutMs });

  // Accept CommonJS, plain declarations, or `export function` / `export const` / `export default`.
  const source = String(code)
    .replace(/^\s*export\s+default\s+/gm, "module.exports.default = ")
    .replace(/^\s*export\s+(?=(async\s+)?function\b|const\b|let\b|var\b|class\b)/gm, "");
  vm.runInContext(source, context, { timeout: timeoutMs, filename: "entry.js" });

  context.__cases = casesJson;
  const harness = `(() => {
    const cases = JSON.parse(__cases);
    let fn = module.exports && module.exports[${JSON.stringify(exportName)}];
    if (typeof fn !== "function" && typeof module.exports === "function") fn = module.exports;
    if (typeof fn !== "function" && typeof module.exports.default === "function") fn = module.exports.default;
    if (typeof fn !== "function") { try { fn = ${exportName}; } catch (e) {} }
    if (typeof fn !== "function") return JSON.stringify({ error: "No function named ${exportName} found in the entry" });
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const clip = (v) => { const s = JSON.stringify(v === undefined ? null : v); return s && s.length > 200 ? s.slice(0, 200) + "..." : s; };
    const results = cases.map((c) => {
      try {
        const got = fn(...c.args);
        return { name: c.name, ok: same(got, c.expect), got: clip(got) };
      } catch (e) {
        return { name: c.name, ok: false, error: String((e && e.message) || e).slice(0, 200) };
      }
    });
    return JSON.stringify({ results });
  })()`;
  const out = vm.runInContext(harness, context, { timeout: timeoutMs, filename: "harness.js" });
  finish(JSON.parse(String(out)));
} catch (e) {
  finish({ error: String((e && e.message) || e).slice(0, 300) });
}
