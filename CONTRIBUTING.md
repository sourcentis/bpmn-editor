# Contributing

## Setup

```bash
npm install
```

## Common tasks

```bash
npm run build      # tsc --noEmit + vite build -> dist/ (ESM + CJS/UMD + rolled-up .d.ts)
npm run typecheck   # tsc --noEmit only
npm run dev         # vite dev server
```

## Trying your changes

```bash
npm run build
cd examples
python3 -m http.server 8000
```

Open `http://localhost:8000/editor.html`, `viewer.html`, or
`with-simulated-backend.html`. Each `examples/*.html` file is self-contained
and reads `../dist/bpmn-editor.js` directly — no separate dev build step
beyond `npm run build`.

### Trying your changes from a consumer project (e.g. Mercator)

Link the package locally instead of publishing:

```json
// consumer's package.json
{ "dependencies": { "@sourcentis/bpmn-editor": "file:../bpmn-editor" } }
```

```bash
npm install   # in the consumer project — creates a symlink
```

Any rebuild (`npm run build` in this package) is picked up by the consumer
immediately, no re-`npm install` needed, since `file:` dependencies are
symlinked. One gotcha: if the consumer also depends on `@maxgraph/core`
directly, add it to the consumer's Vite/webpack `resolve.dedupe` (or
equivalent) — otherwise a locally-linked `file:` dependency's own
`node_modules/@maxgraph/core` (needed here for local dev/build) and the
consumer's own copy can both get bundled, resulting in two separate
MaxGraph module instances in one page. This only happens with local `file:`
links; a normal registry install doesn't have this issue.

## Principles when changing the core

- **No Laravel/Mercator/any-specific-backend reference in `src/`.** Grep
  before you commit: `/admin`, `X-CSRF-TOKEN`, `_method`, `window.location`,
  `history.replaceState`, `meta[name="csrf-token"]`, `window.loadGraph`,
  `window.getXMLGraph`. All of that belongs in a *consumer's* adapter, not
  here.
- **No effects at module import time.** Everything happens inside
  `createBpmnEditor(...)` or the functions it calls. Verify with: nothing
  in `src/` should run just from `import '...'`.
- **No globals.** No `window.*` assignment from this package.
- **`destroy()` must remove everything it added** — including anything
  registered on `window`/`document`, not just inside the container.
- **Multi-instance safety.** Two editors on the same page must not
  interfere with each other. Any `document.getElementById`-style global
  lookup, or singleton DOM node reused across instances, is a bug.
- **Don't reinvent the MaxGraph drawing logic.** Behavior changes to how
  shapes are drawn/connected are almost always out of scope for this
  package — file an issue against `@maxgraph/core` instead, or check
  whether it's actually a styling (`graph-styles.ts`) concern here.

## Publishing a demo to GitHub Pages

Not automated by this repo — here's the manual process:

```bash
npm run build
# Then publish these as a static site (any static host works, e.g. GitHub
# Pages via a gh-pages branch or the repo's Pages settings):
#   dist/            (the built package, referenced by the examples via ../dist/…)
#   examples/         (editor.html, viewer.html, with-simulated-backend.html, sample.bpmn)
```

The examples resolve `@maxgraph/core` via a CDN import map (see the comment
at the top of any `examples/*.html` file) specifically so they work without
a bundler — that's what makes them deployable as plain static files.

## License

By contributing, you agree your contribution is licensed under this
project's [GPL-3.0 license](./LICENSE).
