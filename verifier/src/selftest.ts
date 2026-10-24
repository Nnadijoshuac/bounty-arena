// Self-test for the check runner: real fixtures pass or fail as expected, and hostile entries are contained.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runCheck } from "./checks.js";

const fx = (f: string) => readFileSync(fileURLToPath(new URL(`../../fixtures/${f}`, import.meta.url)), "utf8");

const iban = fx("iban.check.json");
const cases: [string, string, string, boolean][] = [
  ["iban reference solution passes", iban, fx("iban.solution.js"), true],
  ["iban buggy entry fails", iban, fx("iban.buggy.js"), false],
  ["slugify solution passes", fx("slugify.check.json"), fx("slugify.solution.js"), true],
  ["pools JSON passes", fx("pools.check.json"), fx("pools.solution.json"), true],
  ["pools JSON in the wrong order fails", fx("pools.check.json"), fx("pools.solution.json").replace('"p07"', '"p03"'), false],
  ["pools not JSON fails", fx("pools.check.json"), "top five: p07, p02", false],
  ["infinite loop is stopped", iban, "function isValidIban(){ while(true){} }", false],
  ["top-level infinite loop is stopped", iban, "while(true){}", false],
  ["require is not available", iban, "const fs = require('fs'); function isValidIban(){ return fs.readFileSync('x') }", false],
  ["process is not available", iban, "function isValidIban(){ return process.env.HOME.length > 0 }", false],
  ["constructor escape finds no process", iban, "function isValidIban(){ return typeof this.constructor.constructor('return process')() === 'object' }", false],
  ["eval is blocked", iban, "function isValidIban(s){ return eval('true') }", false],
  ["fetch is not available", iban, "function isValidIban(){ fetch('http://example.com'); return true }", false],
  ["memory bomb is contained", iban, "function isValidIban(){ const a=[]; for(;;) a.push(new Array(1e6).fill(1)) }", false],
];

let failed = 0;
for (const [name, check, entry, want] of cases) {
  const r = await runCheck(check, entry);
  const ok = r.passed === want;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name} (${r.summary}${r.error ? `, ${r.error.slice(0, 60)}` : ""}, ${r.ms} ms)`);
}
console.log(failed ? `${failed} failed` : `all ${cases.length} passed`);
process.exit(failed ? 1 : 0);
