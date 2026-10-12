// Check that data/ is exactly what the pipeline makes from raw/ + sources/ (catches hand edits to data/).
// Works before a commit (right after data:process it passes) and in CI (on the committed files).
// Usage: npm run data:check   Exit 1 lists the files that differed; they are left regenerated, so `git diff data/` shows the fix.
import { readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dir = new URL('../data/', import.meta.url);
const snapshot = () => Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => [f, readFileSync(new URL(f, dir), 'utf8')]));

const before = snapshot();
execFileSync(process.execPath, [fileURLToPath(new URL('./process-osm.mjs', import.meta.url))], { stdio: ['ignore', 'ignore', 'inherit'] });
const after = snapshot();
const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((f) => before[f] !== after[f]);

if (changed.length) {
  console.error(`✗ data/ did not match the pipeline: ${changed.join(', ')}`);
  console.error('  They are now regenerated from raw/ + sources/. Review with `git diff data/` and commit them with your sources/ change.');
  console.error('  (data/ is generated: change sources/ or pipeline/ instead of editing it.)');
  process.exit(1);
}
console.log(`✓ data/ matches the pipeline (${Object.keys(after).length} files)`);
