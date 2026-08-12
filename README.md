# @sourcentis/bpmn-editor

A BPMN diagram editor you can drop into any page — agnostic of UI framework and backend, built on [`@maxgraph/core`](https://www.npmjs.com/package/@maxgraph/core).

[![npm version](https://img.shields.io/npm/v/@sourcentis/bpmn-editor)](https://www.npmjs.com/package/@sourcentis/bpmn-editor)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](LICENSE)

---

## What this is (and isn't)

`@sourcentis/bpmn-editor` is agnostic of UI framework and backend — it doesn't
assume React/Vue/Angular, and it doesn't assume a server. But it is **not**
dependency-free: it's built on `@maxgraph/core`, its rendering engine, which
is a peer dependency you install alongside it. Think of the distinction as:

- **Not swappable** — `@maxgraph/core` does all the actual drawing. The
  editor is built on it, the same way a chart library is "built on" Canvas.
- **Swappable (and optional)** — everything backend-shaped (loading a
  catalogue of objects to link to, saving to a server, what happens when you
  click a linked object) is expressed as small, optional TypeScript
  interfaces ("ports") that *you* implement. Provide none of them and the
  editor still works fully standalone: draw, import a `.bpmn`/XML file,
  export it back out.

[<img src="https://raw.githubusercontent.com/sourcentis/bpmn-editor/main/docs/images/sample1.png" width="800">](https://raw.githubusercontent.com/sourcentis/bpmn-editor/main/docs/images/sample1.png)

## Features

- **Full BPMN-ish drawing surface**: tasks, states/events, gateways, data
  objects/stores, lanes, activities groups, annotations, conversations,
  sequence/message/conditional/default flows — drag-and-drop from a palette,
  connect, recolor, rotate, undo/redo.
- **Import / export** `.bpmn`/XML files — works with zero backend.
- **Export to SVG**, with the BPMN icon font embedded so the file renders
  correctly outside the browser.
- **Read-only "viewer" mode** (`readOnly: true`): disables editing, keeps
  pan/zoom, and turns clicks on linked elements into a `navigate` event.
- **Two integration levels**: a batteries-included default toolbar
  (`ui: 'default'`), or canvas-only (`ui: 'none'`) so a host application can
  drive everything through the instance API with its own UI.
- **Optional backend ports**: `BpmnObjectProvider` (catalogue of external
  objects to link elements to) and `BpmnPersistence` (save/load against your
  own API). Both are entirely optional — see [Ports](#ports-optional-backend-integration) below.
- **i18n-ready**: every user-facing string is overridable via `messages`
  (default: French).
- **Self-contained**: the BPMN icon font and all toolbar/menu icons are
  bundled and inlined at build time — no extra `<link>`, no icon font
  dependency, no separate CSS file to import.
- **Multi-instance safe**: mount as many editors as you want on one page;
  each is fully isolated and `destroy()` removes every listener it added
  (including any on `window`/`document`).
- **CSP-safe**: no inline event handlers, no `eval`.

## Installation

```bash
npm install @sourcentis/bpmn-editor @maxgraph/core
```

`@maxgraph/core` is a peer dependency — install it explicitly alongside the
editor (see [What this is](#what-this-is-and-isnt) above for why it isn't
bundled).

## Quick start (standalone, no backend)

```html
<div id="editor" style="height: 640px;"></div>

<script type="module">
  import { createBpmnEditor } from '@sourcentis/bpmn-editor';

  const editor = createBpmnEditor(document.getElementById('editor'), {
    ui: 'default',
  });
</script>
```

That's it — a complete BPMN editor with a toolbar, drag-and-drop palette,
undo/redo, and import/export, with no server and no other setup. Try it now:
open [`examples/editor.html`](examples/editor.html) in a browser (see the
comment at the top of that file for the one-line static server command —
browsers block `type="module"` imports from `file://`).

## `ui: 'default'` vs `ui: 'none'`

```ts
createBpmnEditor(container, { ui: 'default' }); // builds its own toolbar, palette, status bar
createBpmnEditor(container, { ui: 'none' });     // canvas only — you own the chrome
```

With `ui: 'none'`, mount just the drawing surface and drive it entirely
through the [instance API](#instance-api):

```ts
const editor = createBpmnEditor(document.getElementById('canvas'), {
  ui: 'none',
  readOnly: false,
});

document.getElementById('my-zoom-in-button')
  .addEventListener('click', () => editor.zoomIn());
```

The contextual menu that appears when you click an element (change type,
connect, recolor, delete, …) is still built and managed by the editor in
both modes — only the surrounding toolbar chrome is what `ui: 'none'` opts
out of.

To reuse your own palette buttons as drag sources for inserting shapes, point
`paletteRoot` at the container that holds them and tag each button with a
`data-node-type` attribute:

```ts
createBpmnEditor(container, {
  ui: 'none',
  paletteRoot: document.getElementById('my-toolbar'),
});
```

```html
<button data-node-type="task-node">Task</button>
<button data-node-type="state-node">State</button>
```

Valid `data-node-type` values: `task-node`, `state-node`, `gateway-node`,
`data-node`, `lane-node`, `activities-node`, `annotation-node`,
`conversation-node`.

## Read-only viewer mode

```ts
const viewer = createBpmnEditor(document.getElementById('canvas'), {
  ui: 'none',
  readOnly: true,
  onNavigate: (url) => { window.location.href = url; },
});

viewer.loadXml(xmlString);
```

Editing is disabled, mouse-wheel zoom still works, the container
auto-resizes to fit the loaded diagram, and clicking an element that carries
a URL fires `navigate` (and calls `onNavigate` if provided) instead of doing
nothing.

## Ports (optional backend integration)

Two small interfaces let the editor talk to a backend without knowing
anything about it. Both are entirely optional.

### `BpmnObjectProvider`

Powers the "insert cartography object" search inside the contextual menu.
Without it, that action is simply hidden — the editor otherwise works
normally.

```ts
import type { BpmnObjectProvider } from '@sourcentis/bpmn-editor';

const provider: BpmnObjectProvider = {
  getGraphObjects:       () => fetch('/api/objects').then(r => r.json()),
  getInformationObjects: () => fetch('/api/information').then(r => r.json()),
  getActorObjects:       () => fetch('/api/actors').then(r => r.json()),
  getProcessObjects:     () => fetch('/api/process').then(r => r.json()),
};

createBpmnEditor(container, { provider });
```

Each method resolves an array of `{ id, name, glyph, url? }`.

### `BpmnPersistence`

Powers the `ui: 'default'` toolbar's "Save" action. Without it, "Save"
downloads a local `.bpmn` file instead — the same fallback a Markdown editor
uses for "Download .md" when there's nowhere to save to.

```ts
import type { BpmnPersistence } from '@sourcentis/bpmn-editor';

const persistence: BpmnPersistence = {
  save: ({ id, name, type, content }) =>
    fetch(`/api/diagrams/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, type, content }),
    }).then(r => r.json()), // must resolve to { id }
};

createBpmnEditor(container, { persistence });
```

If you're mounting with `ui: 'none'` and own your own "Save" button, you can
also just call `persistence.save(...)` directly from your own click handler
instead of passing it through `options.persistence` — see
[Mercator's adapter](#mercator-a-real-integration) for exactly that pattern
(CSRF token, `_method: PUT`, reflecting the saved id back into the page).

## Instance API

```ts
const editor = createBpmnEditor(container, options);
```

| Method | Description |
|---|---|
| `loadXml(xml: string)` | Replaces the current graph with the given BPMN/XML. |
| `getXml(): string` | Serializes the current graph to BPMN/XML. |
| `setEnabled(enabled: boolean)` | Toggles editing on/off at runtime. |
| `exportSvg(filename?: string): Promise<void>` | Exports to SVG and triggers a download — the same action the built-in toolbar's SVG button uses. |
| `zoomIn()` / `zoomOut()` / `fit()` | Viewport controls. |
| `on(event, handler)` / `off(event, handler)` | Subscribe/unsubscribe (see [Events](#events)). |
| `destroy()` | Tears down the instance: removes every listener (including any on `window`/`document`), clears the container. Idempotent. |

### Events

| Event | Payload | Fires when |
|---|---|---|
| `change` | — | The graph model changes (edit, undo/redo, `loadXml`). |
| `select` | `Cell \| null` | Selection changes; `null` when nothing/multiple things are selected. |
| `save` | `{ id, name, type, content }` | Right before `persistence.save()` is called. |
| `navigate` | `url: string` | A linked element is clicked in `readOnly` mode. |
| `error` | `Error` | Something failed (XML parse error, provider/persistence rejection, …). |

```ts
editor.on('change', () => console.log('modified'));
editor.on('error', (err) => console.error(err));
```

### Options reference

| Option | Type | Default | Description |
|---|---|---|---|
| `ui` | `'default' \| 'none'` | `'default'` | Built-in chrome or canvas-only. |
| `readOnly` | `boolean` | `false` | Viewer mode — see [above](#read-only-viewer-mode). |
| `provider` | `BpmnObjectProvider` | — | See [Ports](#ports-optional-backend-integration). |
| `persistence` | `BpmnPersistence` | — | See [Ports](#ports-optional-backend-integration). |
| `onNavigate` | `(url: string) => void` | — | Called (alongside the `navigate` event) when a linked element is clicked in `readOnly` mode. |
| `paletteRoot` | `HTMLElement \| null` | — | Drag-source container for `ui: 'none'` — see [above](#ui-default-vs-ui-none). |
| `messages` | `BpmnEditorMessages` | French | Overrides for user-facing strings — see [i18n](#i18n). |
| `fontUrl` | `string` | bundled font | Overrides the BPMN icon font used when embedding fonts into SVG exports. |

## i18n

Every user-facing string (status messages, the object-search filter's
placeholder, …) can be overridden. Unset keys fall back to the bundled
French defaults:

```ts
createBpmnEditor(container, {
  messages: {
    welcome: 'Load a BPMN file to get started',
    saveSuccess: 'Diagram saved',
    saveError: 'Could not save the diagram.',
    loadSuccess: 'File loaded successfully',
    loadError: 'Could not load this file.',
    filterPlaceholder: 'Filter...',
    noMatch: 'No match.',
  },
});
```

See `BpmnEditorMessages` in the type definitions for the full list of keys.
Two keys — `saveNameRequired` and `xmlParseError` — aren't consumed by the
editor itself (it has no name field or raw XML upload of its own to validate)
but are exposed for a host adapter that wants to reuse the same message set
for its own validation, the way Mercator's does.

## Assets

The BPMN glyph font (OFL-1.1 licensed — see `assets/fonts/OFL-1.1.txt`) and
every toolbar/menu icon (Bootstrap Icons, MIT licensed — see
`assets/icons/LICENSE-bootstrap-icons.txt`) are inlined into the built
JavaScript at compile time. There is nothing to copy, host, or link
separately — importing the package is enough. `fontUrl` remains overridable
if you need the SVG-export font to come from elsewhere.

## Mercator: a real integration

[Mercator](https://github.com/dbarzin/mercator) (Laravel) uses this package
as its BPMN editor, mounted with `ui: 'none'` to reuse its own Bootstrap
toolbar. Its adapter — `resources/BPMN/mercator-provider.ts` and
`mercator-persistence.ts` — is a small, concrete example of implementing
both ports against a real backend (CSRF token, `_method: PUT`, credentials,
reflecting a newly-assigned id back into the page).

## Development

```bash
npm install
npm run build     # tsc --noEmit + vite build -> dist/
npm run typecheck # tsc --noEmit only
npm run dev       # vite dev server
```

## License

GPL-3.0 — see [LICENSE](./LICENSE).
