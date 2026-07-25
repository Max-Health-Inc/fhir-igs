#!/usr/bin/env node
/**
 * Resolve the babelfhir-ts release this repo should publish with.
 *
 * Not simply "newest on npm". This repo turns one generator release into ~30
 * published packages, and the gate that decides whether a release actually works
 * — the parity suite, 30 IGs against two external validators — lives in the
 * generator's own repo. Publishing straight off `npm view babelfhir-ts version`
 * would propagate a broken release to every IG package before anyone looked.
 *
 * So: take the newest release that has a recorded STABLE PARITY RESULT.
 *
 *   https://max-health-inc.github.io/BabelFHIR-TS/history-stable.json
 *
 * That file is written by the `Pipeline Parity Test` workflow on `main`, one
 * entry per release, carrying the babelfhir-ts version, the package count, the
 * validator versions, and per-validator empty/random/validation percentages.
 *
 * Why an entry's mere presence is a meaningful gate: a hard parity failure (say
 * generated output that will not compile) leaves no parity-data*.json for the
 * deploy job to copy, so no entry is written at all. Absence therefore means
 * "this release did not get through parity", which is exactly what we want to
 * refuse to publish with.
 *
 * Soft regressions — parity ran but scores dropped — are NOT caught by presence.
 * `minParityValidation` in config.json adds an absolute floor for that, and is
 * disabled by default on purpose: at the time of writing a healthy release scores
 * internal 72 / firely 84 / hl7 82, so a plausible-sounding floor of 80 would
 * reject a perfectly good release. Set it once you know your normal band.
 *
 * Fails closed. If nothing qualifies we exit non-zero rather than fall back to
 * the newest npm version, because a silent fallback would defeat the whole point.
 *
 * Usage:
 *   node scripts/resolve-babelfhir.js          # prints the version
 *   node scripts/resolve-babelfhir.js --explain # prints the reasoning to stderr
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));

/**
 * Where the stable parity history lives. Overridable via PARITY_HISTORY_URL so a
 * candidate deployment (or a test double) can be checked without touching the
 * published one — the resolver decides what 30 packages get built with, so being
 * able to dry-run it against a proposed history is worth the small extra surface.
 */
const HISTORY_URL =
  process.env.PARITY_HISTORY_URL?.trim() ||
  'https://max-health-inc.github.io/BabelFHIR-TS/history-stable.json';

/**
 * Oldest release we can publish with at all: parity-matrix.json — the IG list
 * contract `list-igs.js` reads — first shipped in 1.5.18. Older entries in the
 * history (it goes back to 1.2.x) predate the artifact and would fail anyway.
 */
const MIN_SUPPORTED = '1.5.18';

const explain = process.argv.includes('--explain');
const note = (msg) => { if (explain) console.error(msg); };

/** Compare dotted numeric versions. Returns >0 if a is newer. */
function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

const isExact = (v) => /^\d+\.\d+\.\d+$/.test(v);

async function fetchHistory() {
  const res = await fetch(HISTORY_URL, { headers: { 'cache-control': 'no-cache' } });
  if (!res.ok) {
    throw new Error(`Cannot read stable parity history (${res.status} ${res.statusText}): ${HISTORY_URL}`);
  }
  const body = await res.json();
  if (!Array.isArray(body.entries)) {
    throw new Error(`Unexpected history shape at ${HISTORY_URL} — expected { entries: [...] }`);
  }
  return body.entries;
}

/** Lowest `validation` percentage across the validators an entry recorded. */
function lowestValidation(entry) {
  const scores = ['internal', 'firely', 'hl7']
    .map((k) => entry[k]?.validation)
    .filter((n) => typeof n === 'number');
  return scores.length ? Math.min(...scores) : null;
}

function qualifies(entry, floor) {
  if (!isExact(entry.version || '')) return 'no usable version recorded';
  if (compareVersions(entry.version, MIN_SUPPORTED) < 0) {
    return `predates parity-matrix.json (< ${MIN_SUPPORTED})`;
  }
  const lowest = lowestValidation(entry);
  if (lowest === null) return 'parity ran but recorded no validation scores';
  if (floor !== null && lowest < floor) {
    return `lowest validation ${lowest}% is below minParityValidation ${floor}%`;
  }
  return null;
}

/** Published versions of babelfhir-ts, so we never resolve an unpublished one. */
function publishedVersions() {
  const out = execFileSync('npm', ['view', 'babelfhir-ts', 'versions', '--json'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  const parsed = JSON.parse(out);
  return new Set(Array.isArray(parsed) ? parsed : [parsed]);
}

const floor = typeof config.minParityValidation === 'number' ? config.minParityValidation : null;
note(`minParityValidation: ${floor === null ? 'disabled' : `${floor}%`}`);

const entries = await fetchHistory();
note(`stable parity history: ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`);

const candidates = [];
for (const entry of entries) {
  const reason = qualifies(entry, floor);
  if (reason) note(`  skip ${entry.version || '(no version)'}: ${reason}`);
  else candidates.push(entry);
}

if (candidates.length === 0) {
  console.error(
    `No babelfhir-ts release has a usable stable parity result.\n` +
      `Checked ${entries.length} entries at ${HISTORY_URL}.\n` +
      `Refusing to publish rather than falling back to the newest npm release — ` +
      `a release that has not been through parity could break all IG packages at once.\n` +
      `Fix: run the "Pipeline Parity Test" workflow on BabelFHIR-TS main to record a result.`,
  );
  process.exit(1);
}

candidates.sort((a, b) => compareVersions(b.version, a.version));

const published = publishedVersions();
const chosen = candidates.find((c) => published.has(c.version));

if (!chosen) {
  console.error(
    `Parity passed for ${candidates.map((c) => c.version).join(', ')}, but none of those ` +
      `are published on npm. Refusing to guess.`,
  );
  process.exit(1);
}

if (chosen.version !== candidates[0].version) {
  note(`newest parity-passing ${candidates[0].version} is not on npm yet — using ${chosen.version}`);
}

note(
  `chosen ${chosen.version}: ${chosen.packageCount} IGs, lowest validation ` +
    `${lowestValidation(chosen)}% (firely ${chosen.firelyVersion || '?'}, hl7 ${chosen.hl7Version || '?'})`,
);

console.log(chosen.version);
