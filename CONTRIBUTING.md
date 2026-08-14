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

## Tests

Non-regression tests live under `tests/` (never under `src/`) and run on
[Playwright Test](https://playwright.dev/). They cover BPMN import
(`importBpmnXml` / `parseBPMN`) from three angles:

- **Visual** (`tests/visual/`): imports each `tests/visual/fixtures/tNN-*.bpmn`
  file into a UI-less, read-only editor instance and compares the rendered
  canvas against a reference PNG in `tests/visual/__baselines__/`.
- **Structural** (`tests/structural/`): asserts on `parseBPMN`'s output
  directly (participants, lanes, event definitions, colors…) — insensitive
  to fonts/antialiasing, so it pinpoints a parser regression that a visual
  diff would only report as "the image changed".
- **Console guard** (`tests/helpers/console-guard.ts`): applied to every
  visual and structural test — fails if the page logs a `console.error` or
  an unhandled `pageerror` during the test, even if the primary assertion
  passed.

There is also an optional, coarse **perf budget** (`tests/perf/`) on
importing the largest fixtures — a non-regression guard with a deliberately
generous threshold, not a benchmark.

### Prerequisites

```bash
npm install
npx playwright install chromium   # once — downloads the browser binary
```

### Commands

```bash
npm test                    # every test family
npm run test:visual         # visual non-regression (screenshots)
npm run test:structural     # assertions on parseBPMN's output
npm run test:visual:update  # regenerate the visual baselines
```

### How baselines work

The **first run** for a fixture with no existing baseline **creates**
`tests/visual/__baselines__/tNN-….png` and **fails that run on purpose** —
review the generated image before committing it. On **later runs**, the
render is compared against that baseline; a mismatch produces a visual diff
under `test-results/`.

After a legitimate rendering change, regenerate with
`npm run test:visual:update`, then **review the changed PNGs** before
committing.

### Reproducibility

Screenshots are sensitive to the OS/font environment. Baselines committed to
this repo should be (re)generated in a fixed environment — the official
Playwright Docker image (`mcr.microsoft.com/playwright:v1.62.1-jammy`,
matching the `@playwright/test` version pinned in `package.json`) or CI —
rather than on an arbitrary local machine with different fonts.

### Adding a test case

- **Visual/structural**: add `tests/visual/fixtures/tNN-description.bpmn`
  (`tNN-description.bpmn` ⇄ `tNN-description.png`, see the naming convention
  used by existing fixtures), run `npm run test:visual` to generate its
  baseline, review the PNG, then commit the fixture and the baseline
  together. For a structural assertion, add the corresponding case in
  `tests/structural/bpmn-parse.spec.ts`.

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
#   examples/         (editor.html, viewer.html, with-simulated-backend.html,
#                      sample.bpmn, sample.maxgraph)
```

The examples resolve `@maxgraph/core` via a CDN import map (see the comment
at the top of any `examples/*.html` file) specifically so they work without
a bundler — that's what makes them deployable as plain static files.

## License

By contributing, you agree your contribution is licensed under this
project's [GPL-3.0 license](./LICENSE).
