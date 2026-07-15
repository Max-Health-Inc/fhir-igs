#!/usr/bin/env node
/**
 * Emit the IG matrix as a JSON array of { name, spec, fhirVersion } for the
 * GitHub Actions matrix strategy. Reads igs.json (the registry).
 *
 * Usage:
 *   node scripts/list-igs.js            # all IGs
 *   node scripts/list-igs.js ips,us-core # a subset by name
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { igs } = JSON.parse(fs.readFileSync(path.join(root, 'igs.json'), 'utf8'));

const filter = (process.argv[2] || 'all').toLowerCase().split(',').map((s) => s.trim());
const selected = filter.includes('all') ? igs : igs.filter((e) => filter.includes(e.name));
const out = (selected.length ? selected : igs).map((e) => ({
  name: e.name,
  spec: e.spec,
  fhirVersion: e.fhirVersion || 'r4',
}));

console.log(JSON.stringify(out));
