# Guide: assets

The editor is self-contained by design — importing the package is enough,
with no separate `<link>`, icon font, or asset file to host and serve
yourself.

## What's bundled

| Asset | License | Where it's used | How it's bundled |
|---|---|---|---|
| BPMN glyph font (`bpmn.ttf`) | OFL-1.1 (`assets/fonts/OFL-1.1.txt` in this repo) | On-canvas shape icons (tasks, events, gateways, …) via a bundled `@font-face`; also embedded into SVG exports. | Inlined as a base64 data URI at build time (Vite's `?inline` asset import). |
| Toolbar/menu icons (Bootstrap Icons) | MIT (`assets/icons/LICENSE-bootstrap-icons.txt` in this repo) | The `ui: 'default'` toolbar and the contextual per-element menu. | Each SVG inlined as a data URI at build time — Vite chooses base64 or URL-encoding per asset (URL-encoding is smaller for text/SVG; either way, no separate file or network request). |

Both are pulled into `dist/bpmn-editor.js`/`dist/bpmn-editor.umd.cjs`
themselves — there is nothing under `dist/` besides the JS bundles and the
type declarations.

## Overriding the font

`fontUrl` only affects **SVG export** — where the font gets embedded into
the exported file so it renders correctly in tools that open the SVG
outside a browser. It does not affect on-canvas rendering, which always
uses the bundled font (on-canvas icons need the font available synchronously
via CSS `@font-face`, not a URL fetched at export time).

```ts
createBpmnEditor(container, {
  fontUrl: 'https://example.com/fonts/my-bpmn-font.ttf',
});
```

```ts
editor.exportSvg('diagram.svg'); // uses fontUrl if provided, the bundled font otherwise
```

## Why not bundle the maxgraph stock UI images too?

`@maxgraph/core` ships a small set of stock GIFs (window chrome,
collapsed/expanded tree icons, …) used by features like `MaxWindow`,
`Outline`, and tree controls. This editor doesn't use any of those features
— it builds its own toolbar and contextual menu from scratch — so
`Client.imageBasePath` is left pointing at a plain relative default
(`/images`) rather than bundling ~17 icons that nothing in this package
actually renders. If you use `@maxgraph/core` features beyond what this
editor wires up and need those stock images, set
`Client.imageBasePath` yourself before creating an editor instance.
