# @sourcentis/bpmn-editor

A BPMN diagram editor you can drop into any page — agnostic of UI framework and backend, built on [`@maxgraph/core`](https://www.npmjs.com/package/@maxgraph/core).

[![npm version](https://img.shields.io/npm/v/@sourcentis/bpmn-editor)](https://www.npmjs.com/package/@sourcentis/bpmn-editor)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](LICENSE)
[![Documentation](https://img.shields.io/badge/docs-sourcentis.github.io-blue)](https://sourcentis.github.io/bpmn-editor/)

[<img src="https://raw.githubusercontent.com/sourcentis/bpmn-editor/main/docs/images/sample1.png" width="800">](https://raw.githubusercontent.com/sourcentis/bpmn-editor/main/docs/images/sample1.png)

---

## What this is (and isn't)

`@sourcentis/bpmn-editor` is agnostic of UI framework and backend — it
doesn't assume React/Vue/Angular, and it doesn't assume a server. But it is
**not** dependency-free: it's built on `@maxgraph/core`, its rendering
engine, which is a peer dependency you install alongside it.

Everything backend-shaped (loading a catalogue of objects to link to,
saving to a server) is expressed as small, optional TypeScript interfaces
("ports") that *you* implement. Provide none of them and the editor still
works fully standalone: draw, import a `.bpmn`/XML file, export it back
out.

## Features

- **Full BPMN-ish drawing surface**: tasks, states/events, gateways, data
  objects/stores, lanes, activities groups, annotations, conversations,
  sequence/message/conditional/default flows — drag-and-drop from a
  palette, connect, recolor, rotate, undo/redo.
- **Import / export** `.bpmn`/XML files — works with zero backend.
- **Export to SVG**, with the BPMN icon font embedded.
- **Read-only "viewer" mode** for embedding diagrams without editing.
- **Two integration levels**: a batteries-included default toolbar, or
  canvas-only so a host application can drive everything with its own UI.
- **Optional backend ports** for linking to external objects and
  saving/loading against your own API.
- **i18n-ready**: every user-facing string is overridable.
- **Self-contained and CSP-safe**: no extra assets to host, no inline
  event handlers, no `eval`.

## Installation

```bash
npm install @sourcentis/bpmn-editor @maxgraph/core
```

`@maxgraph/core` is a peer dependency — install it explicitly alongside the
editor.

## Quick start

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
undo/redo, and import/export, with no server and no other setup.

## Documentation

📖 **[sourcentis.github.io/bpmn-editor](https://sourcentis.github.io/bpmn-editor/)**
— usage guide, two live/runnable examples (editor and read-only viewer),
backend integration (`BpmnObjectProvider` / `BpmnPersistence`), i18n, and
the full API reference.

🚀 **[Try it live](https://www.sourcentis.com/bpmn-editor)** — the editor
running full-screen in your browser, no install needed.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for build commands and the
principles to follow when changing the core.

## License

GPL-3.0 — see [LICENSE](./LICENSE).
