# fhir-igs

Publishes the org's shared FHIR Implementation Guide packages — `@max-health-inc/fhir-*` — to GitHub Packages, generated with [`babelfhir-ts`](https://www.npmjs.com/package/babelfhir-ts).

**Decoupled from the babelfhir-ts tool release cycle.** This repo pins a `babelfhir-ts` version (in `package.json`) and republishes an IG only when the IG list, the generation flags, or that pinned generator version changes — or on the weekly schedule / a manual dispatch. babelfhir-ts releasing a new version does **not** churn these packages; picking up a generator improvement is a deliberate dependency bump here.

## Registry (single source of truth)

The IG list is **derived from babelfhir-ts's validated parity matrix** (`src/test/parity/parityConstants.ts` → `AVAILABLE_PACKAGES`), fetched at the tag matching the pinned `babelfhir-ts` version. `scripts/list-igs.js` does this at CI time. Each entry → `@max-health-inc/fhir-<name>` at the IG's upstream version, generated for the FHIR version babelfhir validated it against.

This deliberately has **no hand-maintained IG list** — a duplicated list drifts (e.g. an IG marked R5 in parity but defaulted to R4 here). babelfhir decides what's validated *and* what's published; bumping the `babelfhir-ts` pin picks up matrix changes.

`config.json` holds only this repo's **publishing** config:
- `displayLanguages` — the `--display-language` flag value
- `exclude` — IG names in the parity matrix to *not* publish (normally empty)

Generation flags (shared): `--tx-server https://tx.fhir.org/<fhirVersion>` and `--display-language <displayLanguages>`.

## Publishing

The `Publish IG Packages` workflow runs on:
- **push to `main`** touching `config.json` / `package.json` / `scripts/**` / the workflow — publishes changed IGs
- **weekly `schedule`** — picks up upstream terminology (tx.fhir.org) refreshes
- **`workflow_dispatch`** — `packages` input: a comma-separated subset or `all`

Publishing is input-driven via a per-package build key `"<spec>|babelfhir@<pinned>|<flags>"`, recorded as a `bk-<sha1>` **dist-tag** on the published version (GitHub Packages does not preserve custom `package.json` fields, but dist-tags survive). A package whose build-key dist-tag already exists is skipped (no regenerate). Version tracks the upstream IG version, with an auto patch-bump when the key changes.

## Consuming

```bash
npm i @max-health-inc/fhir-us-core
```

The packages are **public**, so any GitHub token with `read:packages` resolves them — in GitHub Actions, the built-in `GITHUB_TOKEN` (with `permissions: packages: read`) is enough; no PAT needed. Add an `.npmrc`:

```
@max-health-inc:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

## Adding an IG

Add it to babelfhir-ts's parity matrix (`parityConstants.ts` → `AVAILABLE_PACKAGES`) so it's validated, release babelfhir-ts, then bump the `babelfhir-ts` pin in `package.json` here — the new IG is picked up automatically. To bump the generator for all IGs, bump the pin. To publish everything with the *current* pin (e.g. after a parity matrix change at the same version), run the workflow via `workflow_dispatch`.
