# npm workspace (operator repo + `@dukk/hdc-cli`)

You can run HDC from a **single private operator repository** that depends on the CLI as an
npm package, without cloning the full [hdc](https://github.com/dukk/hdc) git tree on every
workstation.

| Layer | Where it lives |
| --- | --- |
| CLI + package runtime | npm: `@dukk/hdc-cli` ([GitHub Packages](https://github.com/dukk/hdc/pkgs/npm/hdc-cli)) |
| Package scripts (clumps) | `~/.hdc/clump-repos/` after `hdc clumps init` (or `HDC_CLUMPS_ROOT`) |
| Your site data | **This repo** — same layout as hdc-private |

The classic three-git-repo layout (hdc + hdc-private sibling + hdc-clumps) still works.
See [Three repositories](three-repos.md).

## Prerequisites

- Node.js 18+
- A GitHub personal access token (or fine-grained token) with **`read:packages`**
- A private git repo for your site (or use [templates/hdc-private-workspace](../templates/hdc-private-workspace/))

## Install

```bash
# From the hdc repo (or copy the template):
cp -r templates/hdc-private-workspace ~/my-hdc-site
cd ~/my-hdc-site

cp .npmrc.example .npmrc
export GITHUB_TOKEN=ghp_…   # read:packages

npm install
cp .env.example .env
# Ensure: HDC_PRIVATE_ROOT=.

npx hdc clumps init
npx hdc list
```

`.npmrc` must scope `@dukk` to GitHub Packages:

```
@dukk:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Do not commit a `.npmrc` that embeds a live token; keep tokens in the environment or a
gitignored local file.

## How roots resolve

| Concept | Env / default | Role |
| --- | --- | --- |
| **Platform root** | `HDC_ROOT` or package `share/` | Public examples, default `.hdc/clumps-repos.json` |
| **Workspace root** | `HDC_PRIVATE_ROOT` (set to `.`), sibling `../hdc-private`, or cwd auto-detect | Live `config.json`, inventory, tasks, `.env` |
| **CLI app dir** | npm package install path | `hdc/package/*` runtime, schemas |

When you run `npx hdc` from the operator repo with `HDC_PRIVATE_ROOT=.`:

1. Global `.env` loads from the platform (usually empty), then **your** `.env` overrides.
2. Configs and inventory resolve public (package share) first, then your workspace.
3. Package scripts run from the clump cache; spawn env sets `HDC_ROOT` / `HDC_PRIVATE_ROOT` for children.

## Migrating from a sibling hdc-private checkout

1. Add `package.json` + `.npmrc` as in the template (depend on `@dukk/hdc-cli`).
2. Set `HDC_PRIVATE_ROOT=.` in `.env` (you can keep running from this directory).
3. `npm install` and prefer `npx hdc` over the hdc git wrappers.
4. Keep using `hdc clumps init` / `sync` for package code.
5. Optionally stop cloning hdc on machines that only need to operate the site.

Developers contributing to the CLI still clone **hdc** and use `./hdc` / `hdc.cmd`.

## Publishing `@dukk/hdc-cli` (maintainers)

- Package live under [`apps/hdc-cli/`](../apps/hdc-cli/).
- Version is `apps/hdc-cli/package.json` `version`.
- CI: [`.github/workflows/publish-hdc-cli.yml`](../.github/workflows/publish-hdc-cli.yml) publishes to GitHub Packages on release / `workflow_dispatch`.
- Before publish, `scripts/sync-share-assets.mjs` copies `.env.example`, `.hdc/clumps-repos.json`, and inventory `_example.json` into `share/`.

Local smoke:

```bash
cd /path/to/hdc
npm run sync-hdc-cli-share
npm pack -w @dukk/hdc-cli
# Install the tarball into a temp operator dir and run npx hdc list
```

## Related

- [Three repositories](three-repos.md)
- [Getting started](getting-started.md)
- [hdc-private README](../../hdc-private/README.md) (sibling checkout when present)
