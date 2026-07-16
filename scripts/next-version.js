#!/usr/bin/env node
/**
 * Print the next FREE version for a package: the highest of <base> and any
 * existing versions, bumped past any existing version.
 *
 * Usage: node scripts/next-version.js <base> [existingVersion ...]
 *
 * (A committed script rather than `node -e` — `node -e` with argv segfaults on
 * the CI runner's Node.)
 */
const [, , base, ...vers] = process.argv;
const parse = (s) => s.split('.').map(Number);
const cmp = (a, b) => {
  a = parse(a); b = parse(b);
  for (let i = 0; i < 3; i++) { const d = (a[i] || 0) - (b[i] || 0); if (d) return d; }
  return 0;
};

let max = base;
for (const v of vers) {
  if (/^[0-9]+\.[0-9]+\.[0-9]+$/.test(v) && cmp(v, max) > 0) max = v;
}
let ver = max;
const has = (v) => vers.includes(v);
while (has(ver)) { const p = parse(ver); p[2] += 1; ver = p.join('.'); }

process.stdout.write(ver);
