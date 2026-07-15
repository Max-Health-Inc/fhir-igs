# fhir-igs

Publishes the org's shared FHIR Implementation Guide packages — `@max-health-inc/fhir-*` — to GitHub Packages, generated with [`babelfhir-ts`](https://www.npmjs.com/package/babelfhir-ts).

**Decoupled from the babelfhir-ts tool release cycle.** This repo pins a `babelfhir-ts` version (in `package.json`) and republishes an IG only when the registry (`igs.json`), the generation flags, or that pinned generator version changes — or on the weekly schedule / a manual dispatch. babelfhir-ts releasing a new version does **not** churn these packages; picking up a generator improvement is a deliberate dependency bump here.

## Registry

`igs.json` is the canonical list of IGs the org publishes. Each entry → `@max-health-inc/fhir-<name>` at the IG's upstream version. This is intentionally separate from babelfhir-ts's *test* matrix (`parityConstants`): that repo decides what's validated, this repo decides what's published.

Generation flags (shared): `--tx-server https://tx.fhir.org/<fhirVersion>` and `--display-language en,de,fr,es,it` (the `displayLanguages` field in `igs.json`).

## Publishing

The `Publish IG Packages` workflow runs on:
- **push to `main`** touching `igs.json` / `package.json` / `scripts/**` / the workflow — publishes changed IGs
- **weekly `schedule`** — picks up upstream terminology (tx.fhir.org) refreshes
- **`workflow_dispatch`** — `packages` input: a comma-separated subset or `all`

Publishing is input-driven via a per-package `_igBuildKey = "<spec>|babelfhir@<pinned>|<flags>"`; a package whose key matches the last published version is skipped (no regenerate). Version tracks the upstream IG version, with an auto patch-bump when the key changes.

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

Add an entry to `igs.json` and push to `main`. To bump the generator for all IGs, bump `babelfhir-ts` in `package.json`.
