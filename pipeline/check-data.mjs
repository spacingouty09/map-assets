// Check that every area's data/ (plus the generated spot index and loaders) is exactly what the pipeline makes from
// raw/ + sources/ + rules.json (catches hand edits). Works before a commit (right after data:process it passes) and in CI.
// Usage: npm run data:check   Exit 1 lists the files that differed; they are left regenerated, so `git diff` shows the fix.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { at, areaIds } from './config.mjs';

const files = () => [
  ...areaIds().flatMap((id) => (existsSync(at(`areas/${id}/data`)) ? readdirSync(at(`areas/${id}/data`)).filter((f) => f.endsWith('.json')).map((f) => `areas/${id}/data/${f}`) : [])),
  'areas/index.json', 'src/areas.gen.ts',
  ...(existsSync(at('src/areas')) ? readdirSync(at('src/areas')).filter((f) => f.endsWith('.gen.ts')).map((f) => `src/areas/${f}`) : []),
];
const snapshot = () => Object.fromEntries(files().map((f) => [f, existsSync(at(f)) ? readFileSync(at(f), 'utf8') : null]));

const before = snapshot();
execFileSync(process.execPath, [fileURLToPath(at('pipeline/process-osm.mjs'))], { stdio: ['ignore', 'ignore', 'inherit'] });
const after = snapshot();
const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((f) => before[f] !== after[f]);

if (changed.length) {
  console.error(`✗ generated files did not match the pipeline: ${changed.join(', ')}`);
  console.error('  They are now regenerated from raw/ + sources/ + rules.json. Review with `git diff` and commit them with your change.');
  console.error('  (areas/*/data/ and the *.gen.ts loaders are generated: change sources/, rules.json or pipeline/ instead of editing them.)');
  process.exit(1);
}
console.log(`✓ data matches the pipeline (${areaIds().length} areas, ${Object.keys(after).length} files)`);
