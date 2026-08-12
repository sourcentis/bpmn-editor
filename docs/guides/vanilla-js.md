# Guide: Vanilla JS / HTML (no backend)

The editor works fully standalone: no server, no build step required to try
it. This guide walks through [`examples/editor.html`](https://github.com/sourcentis/bpmn-editor/blob/main/examples/editor.html)
and [`examples/viewer.html`](https://github.com/sourcentis/bpmn-editor/blob/main/examples/viewer.html)
— see also the [live, runnable versions](../index.md#live-examples) on the Home page.

## Running the examples

From the package root:

```bash
npm install
npm run build      # produces dist/bpmn-editor.js
npm run serve      # start http server at http://localhost:8000
```

Then open `http://localhost:8000/examples/editor.html`. Browsers block ES module
imports from `file://` URLs, so a static server (any will do — the Python
one above needs nothing installed beyond Python itself) is required even
though there's no actual backend involved.

## The editor, from scratch

```html
<div id="editor" style="height: 640px;"></div>

<script type="module">
  import { createBpmnEditor } from '@sourcentis/bpmn-editor';

  const editor = createBpmnEditor(document.getElementById('editor'), {
    ui: 'default',
  });
</script>
```

`ui: 'default'` builds a complete toolbar (drag-and-drop palette,
zoom/undo/redo, save, import, export-to-SVG) and a status bar, entirely
inside the `<div>` — no other markup or CSS needed.

## Resolving `@maxgraph/core` without a bundler

`@maxgraph/core` is a peer dependency (see
["What this is (and isn't)"](../index.md#what-this-is-and-isnt) for why
it isn't bundled). In a real project with a bundler (Vite, webpack, …),
`npm install @maxgraph/core` is enough — your bundler resolves the bare
`import ... from '@maxgraph/core'` from `node_modules` automatically.

Without a bundler, the browser needs to be told where to find it. The
examples use an [import map](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script/type/importmap)
pointing at a CDN:

```html
<script type="importmap">
  {
    "imports": {
      "@maxgraph/core": "https://esm.sh/@maxgraph/core@0.21.0",
      "@sourcentis/bpmn-editor": "../dist/bpmn-editor.js"
    }
  }
</script>
```

## Loading an existing diagram

```js
const editor = createBpmnEditor(container, { ui: 'default' });

fetch('./sample.bpmn')
  .then((res) => res.text())
  .then((xml) => editor.loadXml(xml));
```

See the [API reference's note on XML formats](../api-reference.md#a-note-on-xml-formats)
— `loadXml()` expects the editor's own serialization format (what
`getXml()` produces), not raw BPMN 2.0 XML. The toolbar's **Import** button
is the one that reads actual BPMN 2.0 files from other tools.

## Read-only viewer

```js
const viewer = createBpmnEditor(document.getElementById('viewer'), {
  ui: 'none',
  readOnly: true,
});
viewer.loadXml(xml);
```

`ui: 'none'` + `readOnly: true` renders just the canvas, disables editing,
keeps pan/wheel-zoom, and auto-resizes the container to fit the diagram.
See [`examples/viewer.html`](https://github.com/sourcentis/bpmn-editor/blob/main/examples/viewer.html).

## Next steps

- [Backend integration guide](./backend-integration.md) — implement the
  optional `provider`/`persistence` ports against a real API.
- [`examples/with-simulated-backend.html`](https://github.com/sourcentis/bpmn-editor/blob/main/examples/with-simulated-backend.html) —
  the same ports, implemented in memory, runnable with no server at all.
