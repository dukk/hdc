# HDC operator workspace (npm)

This template is a **single private repo** that holds your site data (same layout as
hdc-private) and depends on [`@dukk/hdc-cli`](https://github.com/dukk/hdc/pkgs/npm/hdc-cli)
from GitHub Packages. You do **not** need a full hdc git checkout on the workstation.

Full guide: [npm workspace](https://github.com/dukk/hdc/blob/main/docs/npm-workspace.md)
(in the hdc repo).

## Bootstrap

```bash
# 1. Copy this template to your private site repo
cp -r templates/hdc-private-workspace my-hdc-site
cd my-hdc-site

# 2. Auth to GitHub Packages (PAT with read:packages)
cp .npmrc.example .npmrc
export GITHUB_TOKEN=ghp_…   # or set in the shell / CI secrets

# 3. Install CLI
npm install

# 4. Env
cp .env.example .env
# Edit .env: vault passphrase / secret backend as needed

# 5. Pull package scripts (hdc-clumps cache)
npx hdc clumps init

# 6. Seed configs from package examples (after clumps init)
#    Prefer: clone hdc once and run bootstrap-hdc-private-configs, or copy
#    config.example.json → clumps/<tier>/<id>/config.json by hand.

npx hdc list
```

## Layout

```text
my-hdc-site/
├── package.json          # depends on @dukk/hdc-cli
├── .env                  # HDC_PRIVATE_ROOT=. and vault settings
├── clumps/**/config.json
└── operations/
    ├── inventory/
    ├── tasks/
    └── ip-allocations.md
```

Package **code** lives in `~/.hdc/clump-repos/` after `hdc clumps init` (or set
`HDC_CLUMPS_ROOT`). This repo holds **operator data** only.
