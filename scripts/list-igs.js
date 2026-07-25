#!/usr/bin/env node
/**
 * Emit the IG matrix as a JSON array of { name, spec, fhirVersion } for the
 * GitHub Actions matrix strategy.
 *
 * SINGLE SOURCE OF TRUTH: the IG list is derived from babelfhir-ts's validated
 * parity matrix (src/test/parity/parityConstants.ts → AVAILABLE_PACKAGES),
 * fetched from GitHub at the tag of the babelfhir-ts release this run uses. That
 * release is the LATEST published one, resolved at run time — see babelfhirTag().
 * Reading the matrix at that same tag is what keeps the published set equal to
 * what that exact generator validated. Previously a hand-maintained igs.json
 * duplicated the matrix and drifted (ae-research was marked r5 in parity but
 * defaulted to r4 here).
 *
 * HOW it is read matters as much as WHERE from. This script used to regex the
 * TypeScript source, which made a formatting change in another repository a
 * silent break in IG publishing here. babelfhir-ts emits the matrix as a
 * committed artifact — parity-matrix.json — guarded on its side by a CI drift
 * check and a unit test. We consume that contract, and only that: a missing or
 * unreadable artifact is a hard failure, never a silent guess at the IG set.
 *
 * fhir-igs keeps only its own PUBLISHING config in config.json:
 *   - displayLanguages: --display-language flag passed to the generator
 *   - exclude: IG names present in the parity matrix that should NOT be published
 *
 * Usage:
 *   node scripts/list-igs.js            # all IGs
 *   node scripts/list-igs.js ips,us-core # a subset by name
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));

const PARITY_REPO = 'Max-Health-Inc/BabelFHIR-TS';
const PARITY_MATRIX_PATH = 'parity-matrix.json';

/** Shape of parity-matrix.json we know how to read. */
const SUPPORTED_SCHEMA_VERSION = 1;

/**
 * The babelfhir-ts release this run uses, as a git tag.
 *
 * This repo tracks the latest release rather than pinning one, so the version is
 * resolved rather than read from package.json. CI resolves it ONCE and passes it
 * in via BABELFHIR_VERSION so the matrix and the generator cannot disagree — a
 * second independent lookup could straddle a release. Falling back to a live
 * `npm view` keeps `npm run list` working locally.
 */
function babelfhirTag() {
  const version = (process.env.BABELFHIR_VERSION || '').trim() || latestPublishedVersion();
  if (!/^\d+\.\d+\.\d+/.test(version)) {
    throw new Error(`Unusable babelfhir-ts version "${version}" — expected an exact version.`);
  }
  return `v${version}`;
}

/**
 * Newest babelfhir-ts release that passed stable parity.
 *
 * Delegates to the same resolver CI uses, so a local `npm run list` cannot
 * disagree with a real run about which release is publishable.
 */
function latestPublishedVersion() {
  const resolver = path.join(root, 'scripts', 'resolve-babelfhir.js');
  const out = execFileSync(process.execPath, [resolver], { encoding: 'utf8' });
  return out.trim();
}

/** Fetch a file from the pinned tag. */
async function fetchAtTag(tag, filePath) {
  const url = `https://raw.githubusercontent.com/${PARITY_REPO}/${tag}/${filePath}`;
  const res = await fetch(url);
  if (res.status === 404) {
    throw new Error(
      `${filePath} does not exist at ${tag}. It ships from babelfhir-ts 1.5.18 onward — ` +
        `a pin older than that is no longer supported.`,
    );
  }
  if (!res.ok) {
    throw new Error(`Failed to fetch ${filePath} at ${tag} (${res.status} ${res.statusText}): ${url}`);
  }
  return res.text();
}

/** Read the parity-matrix.json artifact — the supported path. */
function readMatrixArtifact(text) {
  const matrix = JSON.parse(text);
  if (matrix.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    // Refuse rather than guess: publishing the wrong IG set is worse than failing.
    throw new Error(
      `parity-matrix.json declares schemaVersion ${matrix.schemaVersion}, this publisher supports ` +
        `${SUPPORTED_SCHEMA_VERSION}. Update scripts/list-igs.js before bumping the babelfhir-ts pin.`,
    );
  }
  const entries = (matrix.packages || []).map((p) => ({
    name: p.name,
    spec: p.spec,
    fhirVersion: p.fhirVersion,
  }));
  if (!entries.length) throw new Error('parity-matrix.json contains zero IGs');
  return entries;
}

async function fetchParityMatrix() {
  const tag = babelfhirTag();
  return readMatrixArtifact(await fetchAtTag(tag, PARITY_MATRIX_PATH));
}

const exclude = new Set(config.exclude || []);
const all = (await fetchParityMatrix()).filter((e) => !exclude.has(e.name));

const filter = (process.argv[2] || 'all').toLowerCase().split(',').map((s) => s.trim());
const selected = filter.includes('all') ? all : all.filter((e) => filter.includes(e.name));
const out = (selected.length ? selected : all).map((e) => ({
  name: e.name,
  spec: e.spec,
  fhirVersion: e.fhirVersion || 'r4',
}));

console.log(JSON.stringify(out));
