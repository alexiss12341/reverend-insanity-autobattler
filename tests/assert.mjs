// Minimal zero-dependency assertion helper shared by the test suites.
// Suites import { ok, section } and run their assertions on import; run.mjs aggregates the totals.
export const T = { pass: 0, fail: 0 };
export function ok(cond, msg) {
  if (cond) { T.pass++; } else { T.fail++; console.log('  ✗ FAIL:', msg); }
}
export function section(name) { console.log(`\n[${name}]`); }
