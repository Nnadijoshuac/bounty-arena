import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import AjvModule from "ajv";

// ajv ships CommonJS with a default export, which NodeNext types as the module object
const Ajv = ((AjvModule as any).default ?? AjvModule) as typeof AjvModule.default;

/**
 * Machine checks for verified bounties. A check is JSON text stored by hash (checkHash onchain).
 *
 *   { "type": "js",   "export": "isValidIban", "timeoutMs": 1000,
 *     "cases": [{ "name": "valid GB", "args": ["GB82 WEST 1234 5698 7654 32"], "expect": true }] }
 *
 *   { "type": "json", "schema": { ...JSON Schema... }, "expect": { ...values that must match... } }
 *
 * A JS entry passes when every case returns exactly the expected value.
 * A JSON entry passes when it parses, matches the schema, and contains every expected value.
 */

export type JsCheck = {
  type: "js";
  export: string;
  timeoutMs?: number;
  cases: { name: string; args: unknown[]; expect: unknown }[];
};
export type JsonCheck = { type: "json"; schema: object; expect?: unknown };
export type Check = JsCheck | JsonCheck;

export type CaseResult = { name: string; ok: boolean; got?: string; error?: string };
export type CheckResult = {
  passed: boolean;
  type: Check["type"] | "invalid";
  summary: string;
  results: CaseResult[];
  error?: string;
  ms: number;
};

const WORKER = fileURLToPath(new URL("./sandbox-worker.mjs", import.meta.url));

export function parseCheck(text: string): Check {
  const c = JSON.parse(text);
  if (c?.type === "js" && typeof c.export === "string" && Array.isArray(c.cases)) return c as JsCheck;
  if (c?.type === "json" && c.schema && typeof c.schema === "object") return c as JsonCheck;
  throw new Error("Unknown check format");
}

export async function runCheck(checkText: string, deliverable: string): Promise<CheckResult> {
  const t0 = Date.now();
  let check: Check;
  try {
    check = parseCheck(checkText);
  } catch (e) {
    return { passed: false, type: "invalid", summary: "The check itself could not be read", results: [], error: String(e), ms: 0 };
  }
  const result = check.type === "js" ? await runJs(check, deliverable) : runJson(check, deliverable);
  return { ...result, ms: Date.now() - t0 };
}

function runJs(check: JsCheck, code: string): Promise<Omit<CheckResult, "ms">> {
  const timeoutMs = Math.min(Math.max(check.timeoutMs ?? 1000, 100), 5000);
  return new Promise((resolve) => {
    const worker = new Worker(WORKER, {
      workerData: { code, exportName: check.export, casesJson: JSON.stringify(check.cases), timeoutMs },
      resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16, codeRangeSizeMb: 16 },
      env: {},
      execArgv: [],
      stdout: true,
      stderr: true,
    });
    let done = false;
    const end = (r: Omit<CheckResult, "ms">) => {
      if (done) return;
      done = true;
      clearTimeout(kill);
      void worker.terminate();
      resolve(r);
    };
    // hard stop for anything the vm timeout cannot catch
    const kill = setTimeout(
      () => end({ passed: false, type: "js", summary: "Timed out", results: [], error: `Killed after ${timeoutMs * 3} ms` }),
      timeoutMs * 3,
    );
    worker.once("message", (m: { results?: CaseResult[]; error?: string }) => {
      if (m.error || !m.results) {
        end({ passed: false, type: "js", summary: "The entry did not run", results: [], error: m.error ?? "no results" });
        return;
      }
      const ok = m.results.filter((r) => r.ok).length;
      end({
        passed: ok === check.cases.length && check.cases.length > 0,
        type: "js",
        summary: `${ok} of ${check.cases.length} tests passed`,
        results: m.results,
      });
    });
    worker.once("error", (e) => end({ passed: false, type: "js", summary: "The entry crashed", results: [], error: String(e.message || e) }));
    worker.once("exit", (code) => {
      if (!done) end({ passed: false, type: "js", summary: "The entry crashed", results: [], error: `worker exited ${code}` });
    });
  });
}

const ajv = new Ajv({ allErrors: true, strict: false });

function runJson(check: JsonCheck, text: string): Omit<CheckResult, "ms"> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { passed: false, type: "json", summary: "Not valid JSON", results: [{ name: "parses as JSON", ok: false }] };
  }
  const results: CaseResult[] = [{ name: "parses as JSON", ok: true }];
  const validate = ajv.compile(check.schema);
  const schemaOk = validate(data) as boolean;
  results.push({
    name: "matches the schema",
    ok: schemaOk,
    error: schemaOk ? undefined : ajv.errorsText(validate.errors, { separator: ", " }).slice(0, 300),
  });
  if (check.expect !== undefined) {
    const mismatches: string[] = [];
    partialMatch(check.expect, data, "$", mismatches);
    results.push({
      name: "contains the expected values",
      ok: mismatches.length === 0,
      error: mismatches.length ? mismatches.slice(0, 5).join(", ") : undefined,
    });
  }
  const ok = results.filter((r) => r.ok).length;
  return { passed: ok === results.length, type: "json", summary: `${ok} of ${results.length} checks passed`, results };
}

/** Every value in `expect` must appear at the same path in `got`. Arrays compare element by element. */
function partialMatch(expect: unknown, got: unknown, path: string, out: string[]) {
  if (Array.isArray(expect)) {
    if (!Array.isArray(got) || got.length < expect.length) {
      out.push(`${path} should have ${expect.length} items`);
      return;
    }
    expect.forEach((e, i) => partialMatch(e, got[i], `${path}[${i}]`, out));
    return;
  }
  if (expect && typeof expect === "object") {
    if (!got || typeof got !== "object") {
      out.push(`${path} should be an object`);
      return;
    }
    for (const [k, v] of Object.entries(expect)) partialMatch(v, (got as Record<string, unknown>)[k], `${path}.${k}`, out);
    return;
  }
  if (expect !== got) out.push(`${path} should be ${JSON.stringify(expect)}`);
}
