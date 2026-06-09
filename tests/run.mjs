// Headless test runner. Usage: `npm test` (or `node tests/run.mjs`).
// Imports each suite (which runs its assertions on import) and prints aggregate totals.
import { T } from './assert.mjs';

await import('./core.test.mjs');
await import('./formation.test.mjs');
await import('./immortal.test.mjs');
await import('./features.test.mjs');
await import('./killer.test.mjs');

console.log(`\n${'='.repeat(40)}\n${T.pass} passed, ${T.fail} failed\n`);
process.exit(T.fail ? 1 : 0);
