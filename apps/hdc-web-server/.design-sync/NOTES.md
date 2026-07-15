# design-sync notes — hdc-web-server

## What this design system is

The `hdc-web-server` app had no component library — it was one 592-line `App.jsx`
with inline JSX. This DS was **extracted** from that app (see git history): the
reusable UI patterns were pulled into `web/src/ui/` (16 components + `styles.css`),
and `App.jsx` was rewritten to consume them, so the library is exactly what the app
runs on. The design (9 color tokens, dark theme, spacing/radii) is unchanged from the
original app CSS.

## Build setup (package shape)

- **No TypeScript, no `.d.ts`, no Storybook.** Components are plain `.jsx` with JSDoc.
- The converter needs a built ESM entry that re-exports all components. Produce it with:
  ```sh
  npx esbuild web/src/ui/index.js --bundle --format=esm --jsx=automatic \
    --external:react --external:react-dom --external:react/jsx-runtime \
    --outfile=dist-ui/index.es.js
  ```
  `dist-ui/` is gitignored — rebuild it before every converter run. `cfg.buildCmd` is
  not set because this one-liner isn't a package script; run it by hand on re-sync.
- `--node-modules ./node_modules` (the app's — it has `react`/`react-dom`). `@types/react`
  was copied into `./node_modules/@types` from `.ds-sync/node_modules` so the converter
  resolves `React.ReactNode` in the emitted `.d.ts`. On a fresh clone that copy is gone
  (node_modules isn't committed) — re-copy it, or `npm i -D @types/react` in the app,
  before rebuilding, or the `.d.ts` React types resolve to `any`.
- `componentSrcMap` pins all 16 `.jsx` paths explicitly — the converter's `.tsx`
  heuristic misses `.jsx`, so without the pins JSDoc/src binding is lost.
- `dtsPropsFor` hand-writes every component's prop interface (there are no TS types to
  extract). **These are the API contract the design agent codes against — keep them in
  sync with the JSDoc `@param` blocks in `web/src/ui/<Name>.jsx` whenever a prop changes.**

## Run commands

```sh
npx esbuild web/src/ui/index.js --bundle --format=esm --jsx=automatic \
  --external:react --external:react-dom --external:react/jsx-runtime --outfile=dist-ui/index.es.js
node .ds-sync/package-build.mjs --config .design-sync/config.json \
  --node-modules ./node_modules --entry ./dist-ui/index.es.js --out ./ds-bundle
node .ds-sync/package-validate.mjs ./ds-bundle --no-render-check
```

## Known render warns

- `[RENDER_SKIPPED]` — the render check was intentionally skipped (no Playwright/Chromium
  in this environment; user chose the floor-card fast path). Previews were **not** machine
  render-checked; they were eyeballed once via `.review.html` in the in-app browser and
  looked correct (real tokens applied). Install Playwright + Chromium to enable the check.

## This import (2026-07-14)

- Scope: **floor cards for all 16** (no authored rich previews). All components upload
  fully functional (bundle + `.d.ts` + `.prompt.md`); previews are the honest typographic
  floor card.
- Project: `HDC Design System` (`projectId` in config.json).
- Components: Banner, Button, CardGrid, Field, ListRow, LogView, Message, Panel,
  SearchInput, SelectInput, Spinner, StatCard, StatusText, Table, Tabs, TextInput.

## Re-sync risks / what can go stale

- **`dtsPropsFor` is hand-maintained.** It does not auto-track `web/src/ui/*.jsx`. If a
  component's props change, edit both the JSDoc and `dtsPropsFor` or the `.d.ts` lies.
- **`dist-ui/` and the `@types/react` node_modules copy are not committed** — both must be
  recreated before a re-sync build (see Build setup).
- **No conventions header yet** (`readmeHeader` unset). High-value follow-up: author
  `.design-sync/conventions.md` (token vocabulary, the `styles.css` root wrapper, one
  build snippet) so the design agent styles on-brand, then re-sync.
- **Rich previews not authored.** Every component is floor-card; any of them can get an
  authored `.design-sync/previews/<Name>.tsx` on a later re-sync without re-doing the rest.
- **Render check never ran.** A re-sync that installs Playwright should do a full render
  pass and remove the `[RENDER_SKIPPED]` note above.
