#!/usr/bin/env node
/**
 * Emit the IG matrix as a JSON array of { name, spec, fhirVersion } for the
 * GitHub Actions matrix strategy.
 *
 * SINGLE SOURCE OF TRUTH: the IG list is derived from babelfhir-ts's validated
 * parity matrix (src/test/parity/parityConstants.ts → AVAILABLE_PACKAGES),
 * read from the published tarball of the babelfhir-ts release this run uses. That
 * release is the newest that passed parity, resolved at run time — see babelfhirVersion().
 * Reading the matrix from that same release is what keeps the published set equal to
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
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));

const PARITY_MATRIX_PATH = 'parity-matrix.json';
const GENERATOR = config.generatorPackage;
if (typeof GENERATOR !== 'string' || !GENERATOR) throw new Error('config.json names no generatorPackage');

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
function babelfhirVersion() {
  const version = (process.env.BABELFHIR_VERSION || '').trim() || latestPublishedVersion();
  if (!/^\d+\.\d+\.\d+/.test(version)) {
    throw new Error(`Unusable babelfhir-ts version "${version}" — expected an exact version.`);
  }
  return version;
}

/** Same shared resolver and config CI uses, so a local `npm run list` agrees with a real run. */
function latestPublishedVersion() {
  const floor = typeof config.minParityValidation === 'number' ? ['--min-validation', String(config.minParityValidation)] : [];
  const args = ['--yes', config.igTools, 'resolve-babelfhir', '--package', GENERATOR, '--min-supported', config.minSupportedGenerator, ...floor];
  return execFileSync('npx', args, { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' }).trim();
}

/**
 * Read the matrix out of the PUBLISHED babelfhir-ts tarball.
 *
 * Not from the repo: BabelFHIR-TS moved org and is private, so raw.githubusercontent 404s at every
 * tag, for everyone. The tarball is the artifact this run generates with anyway.
 */
async function readMatrixFromPackage(version, filePath) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'babelfhir-matrix-'));
  try {
    // npm pack, not a bare fetch: the generator lives on an authenticated registry and .npmrc carries that.
    const packed = execFileSync('npm', ['pack', `${GENERATOR}@${version}`, '--pack-destination', dir, '--json'], {
      cwd: root,
      encoding: 'utf8',
      shell: process.platform === 'win32',
    });
    // npm <12 reports an array, npm 12 an object keyed by package name.
    const report = JSON.parse(packed);
    const tgz = (Array.isArray(report) ? report[0] : Object.values(report)[0])?.filename;
    if (typeof tgz !== 'string') throw new Error('npm pack reported no tarball');
    // Relative name + cwd: GNU tar reads an absolute C:\... path as a remote host.
    return execFileSync('tar', ['-xzOf', tgz, `package/${filePath}`], { cwd: dir, encoding: 'utf8' });
  } catch (err) {
    throw new Error(`Could not read ${filePath} from ${GENERATOR}@${version}: ${err.message}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Read the parity-matrix.json artifact — the supported path. */
function readMatrixArtifact(text) {
  const matrix = JSON.parse(text);
  if (matrix.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    // Refuse rather than guess: publishing the wrong IG set is worse than failing.
    throw new Error(
      `parity-matrix.json declares schemaVersion ${matrix.schemaVersion}, this publisher supports ` +
        `${SUPPORTED_SCHEMA_VERSION}. Update scripts/list-igs.js to read it.`,
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
  return readMatrixArtifact(await readMatrixFromPackage(babelfhirVersion(), PARITY_MATRIX_PATH));
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
