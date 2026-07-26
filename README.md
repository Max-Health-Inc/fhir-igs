# fhir-igs

Publishes the org's shared FHIR Implementation Guide packages — `@max-health-inc/fhir-*` — to GitHub Packages, generated with [`babelfhir-ts`](https://www.npmjs.com/package/babelfhir-ts).

**Always publishes with the latest `babelfhir-ts` that passed parity.** There is no pin. Each run resolves the version **once**, in the workflow's `setup` job, and hands that exact version to both the matrix builder and the generator — so a run can never key a package to one generator and build it with another.

"Latest that passed parity", not simply latest on npm. One generator release becomes ~30 published packages here, while the gate that decides whether a release actually works — 30 IGs against two external validators — runs in the generator's repo. `scripts/resolve-babelfhir.js` therefore picks the newest release with a recorded **stable parity result**:

```
https://max-health-inc.github.io/BabelFHIR-TS/history-stable.json
```

A hard parity failure leaves no parity data to publish, so no entry is written — absence *is* the "did not pass" signal. **It fails closed:** if nothing qualifies, the run stops rather than falling back to the newest npm release, because a silent fallback would defeat the point. `config.json → minParityValidation` adds an optional score floor for soft regressions; it is off by default (see the note in that file).

Consequences, by design:

- A new passing release changes every package's build key, so the next run republishes every IG once with a patch bump. That is the point — packages track generator improvements automatically. Nothing republishes *between* releases, because the key is unchanged.
- A commit of this repo no longer determines its output: the generator version is resolved at run time rather than recorded here.
- A release that never gets a parity result never gets published with, and this repo will refuse to run until one does.

## Registry (single source of truth)

The IG list is **derived from babelfhir-ts's validated parity matrix** (`src/test/parity/parityConstants.ts` → `AVAILABLE_PACKAGES`), read from the `parity-matrix.json` artifact babelfhir-ts commits and ships, fetched at the git tag of the release this run resolved. `scripts/list-igs.js` does this at CI time. Reading the matrix at that same tag is what keeps the published set equal to what that exact generator validated. Each entry → `@max-health-inc/fhir-<name>` at the IG's upstream version, generated for the FHIR version babelfhir validated it against.

`parity-matrix.json` is a **contract, not scraped source**. This script used to regex `parityConstants.ts` directly, which made a formatting change in another repository a silent break in publishing here. babelfhir-ts guards the artifact with a CI drift check and a unit test, and declares a `schemaVersion` — this publisher refuses to run on a version it does not understand rather than guess an IG set. The artifact ships from `babelfhir-ts` **1.5.18** onward, so tracking latest always finds it.

This deliberately has **no hand-maintained IG list** — a duplicated list drifts (e.g. an IG marked R5 in parity but defaulted to R4 here). babelfhir decides what's validated *and* what's published, and matrix changes are picked up as soon as they are released.

`config.json` holds only this repo's **publishing** config:
- `displayLanguages` — the `--display-language` flag value
- `exclude` — IG names in the parity matrix to *not* publish (normally empty)

Generation flags (shared): `--tx-server https://tx.fhir.org/<fhirVersion>` and `--display-language <displayLanguages>`.

## Publishing

The `Publish IG Packages` workflow runs on:
- **push to `main`** touching `config.json` / `package.json` / `scripts/**` / the workflow — publishes changed IGs
- **weekly `schedule`** — picks up upstream terminology (tx.fhir.org) refreshes
- **`workflow_dispatch`** — `packages` input: a comma-separated subset or `all`

Publishing is input-driven via a per-package build key `"<spec>|babelfhir@<resolved>|<flags>"` — the concrete resolved version, never the string `latest`, since a key containing `latest` would never change and no IG would ever pick up a generator improvement. It is recorded as a `bk-<sha1>` **dist-tag** on the published version (GitHub Packages does not preserve custom `package.json` fields, but dist-tags survive). A package whose build-key dist-tag already exists is skipped (no regenerate). Version tracks the upstream IG version, with an auto patch-bump when the key changes.

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
