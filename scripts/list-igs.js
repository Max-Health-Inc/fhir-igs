#!/usr/bin/env node
/**
 * Emit the IG matrix as a JSON array of { name, spec, fhirVersion } for the
 * GitHub Actions matrix strategy.
 *
 * SINGLE SOURCE OF TRUTH: the IG list is derived from babelfhir-ts's validated
 * parity matrix (src/test/parity/parityConstants.ts → AVAILABLE_PACKAGES),
 * fetched from GitHub at the tag matching the PINNED babelfhir-ts version
 * (package.json → devDependencies). This makes drift impossible: an IG (or its
 * fhirVersion) is published here exactly as babelfhir validates it. Previously a
 * hand-maintained igs.json duplicated the matrix and drifted (ae-research was
 * marked r5 in parity but defaulted to r4 here).
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

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));

const PARITY_REPO = 'Max-Health-Inc/BabelFHIR-TS';
const PARITY_PATH = 'src/test/parity/parityConstants.ts';

/** Pinned babelfhir-ts version → git tag (fhir-igs pins an exact version). */
function pinnedTag() {
  const pin = (pkg.devDependencies && pkg.devDependencies['babelfhir-ts']) || '';
  const version = pin.replace(/^[^0-9]*/, '');
  if (!/^\d+\.\d+\.\d+/.test(version)) {
    throw new Error(`Cannot derive a babelfhir-ts version tag from pin "${pin}" — expected an exact version.`);
  }
  return `v${version}`;
}

/** Parse AVAILABLE_PACKAGES entries out of parityConstants.ts source. */
function parseParityMatrix(src) {
  const block = src.match(/AVAILABLE_PACKAGES\s*:\s*PackageConfig\[\]\s*=\s*\[([\s\S]*?)\n\];/);
  if (!block) throw new Error('Could not locate AVAILABLE_PACKAGES in parityConstants.ts');
  const entries = [];
  // Entries are flat object literals ({ name, spec, category, fhirVersion? }),
  // one per package; comment lines sit between the {...} blocks and are ignored.
  for (const m of block[1].matchAll(/\{([^}]*)\}/g)) {
    const obj = m[1];
    const name = obj.match(/name\s*:\s*'([^']+)'/)?.[1];
    const spec = obj.match(/spec\s*:\s*'([^']+)'/)?.[1];
    const fhirVersion = obj.match(/fhirVersion\s*:\s*'([^']+)'/)?.[1] || 'r4';
    if (name && spec) entries.push({ name, spec, fhirVersion });
  }
  if (!entries.length) throw new Error('Parsed zero IGs from the parity matrix');
  return entries;
}

async function fetchParityMatrix() {
  const tag = pinnedTag();
  const url = `https://raw.githubusercontent.com/${PARITY_REPO}/${tag}/${PARITY_PATH}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch parity matrix at ${tag} (${res.status} ${res.statusText}): ${url}`);
  }
  return parseParityMatrix(await res.text());
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
