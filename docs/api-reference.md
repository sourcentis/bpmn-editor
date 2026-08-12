# API reference

Full reference for `@sourcentis/bpmn-editor`. For a quicker orientation, see
the [Home page](index.md); for task-oriented walkthroughs, see the
[guides](guides/vanilla-js.md).

## `createBpmnEditor(container, options?)`

The package's single entry point.

```ts
function createBpmnEditor(
  container: HTMLElement,
  options?: BpmnEditorOptions
): BpmnEditorInstance;
```

- `container` — an element already in the DOM. Its existing children are
  removed; the editor builds its own DOM inside it. Never assumes anything
  about `container`'s id or the surrounding page.
- Nothing runs at import time — creating an instance is the only side
  effect, and it's entirely scoped to `container` (plus one shared,
  idempotently-injected `<style>` tag reused by every instance on the page).
- Safe to call multiple times on different containers: instances don't
  share state, and `destroy()` on one never affects another.

## `BpmnEditorOptions`

```ts
interface BpmnEditorOptions {
  ui?: 'default' | 'none';
  readOnly?: boolean;
  provider?: BpmnObjectProvider;
  persistence?: BpmnPersistence;
  onNavigate?: (url: string) => void;
  paletteRoot?: HTMLElement | null;
  messages?: BpmnEditorMessages;
  fontUrl?: string;
}
```

| Option | Type | Default | Notes |
|---|---|---|---|
| `ui` | `'default' \| 'none'` | `'default'` | `'default'` builds a toolbar (drag palette, zoom/undo/redo/save/import/export-SVG) and a status bar inside `container`. `'none'` builds only the canvas — the contextual per-element menu is still built in both modes, since it's core editing UX, not toolbar chrome. |
| `readOnly` | `boolean` | `false` | Disables editing; enables mouse-wheel zoom, cursor-becomes-pointer + click-to-navigate over elements with a `url`, and auto-resizes the container's height to fit the loaded diagram after `loadXml()`. With `ui: 'default'` this suppresses the toolbar/palette/file-input (there's nothing to edit with) but a status bar is still built. |
| `provider` | `BpmnObjectProvider` | — | See [Ports](#ports). Absent → the "insert cartography object" search action in the contextual menu is hidden and disabled; everything else works normally. |
| `persistence` | `BpmnPersistence` | — | See [Ports](#ports). Only consumed by the built-in `ui: 'default'` "Save" toolbar button — absent there, "Save" downloads a local `.bpmn` file instead. Has **no effect at all** in `ui: 'none'` mode (there's no built-in Save button to call it); a `ui: 'none'` host wanting persistence should call its own `BpmnPersistence` implementation directly from its own button. |
| `onNavigate` | `(url: string) => void` | — | Called (alongside the `navigate` event) when an element carrying a `url` is clicked in `readOnly` mode. Absent → clicking such an element is a no-op besides the event still firing (you can rely on `on('navigate', …)` alone if you prefer). |
| `paletteRoot` | `HTMLElement \| null` | — | Only meaningful with `ui: 'none'`. Point it at a container whose descendants carry `data-node-type` attributes to reuse the built-in drag-to-insert mechanism with your own palette markup. Ignored with `ui: 'default'` (the built-in palette is used instead). Valid `data-node-type` values: `task-node`, `state-node`, `gateway-node`, `data-node`, `lane-node`, `activities-node`, `annotation-node`, `conversation-node`. |
| `messages` | `BpmnEditorMessages` | bundled French | See [Messages](#bpmneditormessages-i18n) below and the [i18n guide](guides/i18n.md). |
| `fontUrl` | `string` | bundled font (data URI) | Overrides the font used when embedding the BPMN glyph font into an SVG export (`exportSvg()` / the toolbar's SVG button). Does **not** affect on-canvas rendering, which always uses the bundled `@font-face`. |

## `BpmnEditorInstance`

The object `createBpmnEditor` returns.

```ts
interface BpmnEditorInstance {
  loadXml(xml: string): void;
  getXml(): string;
  importBpmnXml(xml: string): void;
  setEnabled(enabled: boolean): void;
  exportSvg(filename?: string): Promise<void>;
  zoomIn(): void;
  zoomOut(): void;
  fit(): void;
  on<K extends BpmnEditorEventName>(event: K, handler: (payload: BpmnEditorEventMap[K]) => void): void;
  off<K extends BpmnEditorEventName>(event: K, handler: (payload: BpmnEditorEventMap[K]) => void): void;
  destroy(): void;
}
```

### `loadXml(xml: string): void`

Replaces the current graph with the one described by `xml` (the format
`getXml()`/`loadXml()` round-trip — MaxGraph's own model serialization, the
same format Mercator stores diagrams in; **not** raw BPMN 2.0 XML — see the
[assets/format note](#a-note-on-xml-formats) below). Fires `change`. Throws
(and emits `error`) if `xml` can't be parsed — the graph is left unchanged
in that case. In `readOnly` mode, also schedules the container's
auto-resize.

### `getXml(): string`

Serializes the current graph. Never throws in practice (an empty graph
serializes to an empty-but-valid document).

### `importBpmnXml(xml: string): void`

Replaces the current graph by parsing standard BPMN 2.0 XML — the format
real BPMN modeling tools export, distinct from `loadXml()`'s format (see
[the XML formats note](#a-note-on-xml-formats)). This is the same parser
the built-in `ui: 'default'` toolbar's file-input **Import** button uses
internally, exposed so a `ui: 'none'` host (or any other caller — a drag-and-drop
zone, a URL parameter, …) can trigger the same import programmatically.
Fires `change` on success. Throws (and emits `error`) if `xml` can't be
parsed — the graph is left unchanged in that case.

### `setEnabled(enabled: boolean): void`

Toggles editing at runtime — the same switch `readOnly` flips at creation
time, exposed so you can change it after the fact (e.g. an edit/view toggle
button) without re-creating the instance. Note this only touches
editability; it does not add or remove the `readOnly`-mode extras
(wheel-zoom, click-to-navigate, auto-resize) that were wired in based on the
`readOnly` option at creation time.

### `exportSvg(filename?: string): Promise<void>`

Exports the current graph as an SVG file (with the BPMN glyph font embedded
so it renders correctly outside the browser) and triggers a browser
download. `filename` defaults to `"bpmn-export.svg"`. This is exactly what
the built-in `ui: 'default'` toolbar's SVG button calls — use it to wire
your own button when mounting with `ui: 'none'`.

### `zoomIn()` / `zoomOut()` / `fit()`

Viewport controls, usable regardless of `ui` mode. `fit()` centers the
current view on the graph's contents.

### `on(event, handler)` / `off(event, handler)`

Subscribe/unsubscribe. See [Events](#events) below.

### `destroy(): void`

Removes every listener the instance added — including ones on
`window`/`document`, not just inside `container` — and empties `container`.
Idempotent (safe to call more than once). After `destroy()`, the instance
should not be used further.

## Events

```ts
interface BpmnEditorEventMap {
  change: undefined;
  select: Cell | null;
  save: { id: number; name: string; type: string; content: string };
  navigate: string;
  error: Error;
}
```

| Event | Payload | Fires when |
|---|---|---|
| `change` | `undefined` | The graph model changes: an edit, an undo/redo, or a `loadXml()` call. |
| `select` | `Cell \| null` (a `@maxgraph/core` `Cell`) | The selection changes. `null` when nothing, or more than one thing, is selected. |
| `save` | `BpmnPersistencePayload` (`{ id, name, type, content }`) | Right before the built-in `ui: 'default'` Save button calls `persistence.save(payload)` — an observation hook, not a place to short-circuit the save. |
| `navigate` | `url: string` | A `readOnly`-mode click lands on an element carrying a `url` — fires alongside (not instead of) `onNavigate`. |
| `error` | `Error` | An XML parse failure, a rejected `provider`/`persistence` call, or an `exportSvg()` failure. |

```ts
editor.on('select', (cell) => {
  saveButton.disabled = cell === null;
});
```

## Ports

Both ports are plain TypeScript interfaces — implement only what you need.
Neither is required; the editor degrades gracefully without them (see the
`provider`/`persistence` rows in the [options table](#bpmneditoroptions)
above for exactly what's disabled/falls back).

### `BpmnObjectProvider`

```ts
interface BpmnObjectProvider {
  getGraphObjects(): Promise<BpmnElementDef[]>;
  getInformationObjects(): Promise<BpmnElementDef[]>;
  getActorObjects(): Promise<BpmnElementDef[]>;
  getProcessObjects(): Promise<BpmnElementDef[]>;
}

type BpmnElementDef = {
  id: string;
  name: string;
  glyph: string;
  url?: string;
};
```

Each method backs the "insert cartography object" search for a different
selected-element kind (process/task element → `getGraphObjects`, data
object → `getInformationObjects`, lane → `getActorObjects`, conversation →
`getProcessObjects`). `glyph` is a short label rendered next to `name` in
the picker list (Mercator's own provider uses the first character of `id`;
any short string works).

Minimal in-memory example (see
[`examples/with-simulated-backend.html`](https://github.com/sourcentis/bpmn-editor/blob/main/examples/with-simulated-backend.html)
for a runnable version):

```ts
const provider: BpmnObjectProvider = {
  getGraphObjects:       async () => [{ id: 'a1', name: 'Invoicing', glyph: 'A' }],
  getInformationObjects: async () => [{ id: 'i1', name: 'Customer record', glyph: 'I' }],
  getActorObjects:       async () => [{ id: 'b1', name: 'Billing team', glyph: 'B' }],
  getProcessObjects:     async () => [{ id: 'p1', name: 'Order fulfillment', glyph: 'O' }],
};
```

A rejected promise from any of these is caught internally, surfaced via the
`error` event, and logged — it does not crash the editor.

### `BpmnPersistence`

```ts
interface BpmnPersistence {
  save(payload: BpmnPersistencePayload): Promise<BpmnPersistenceResult>;
}

interface BpmnPersistencePayload {
  id: number;
  name: string;
  type: string;
  content: string; // getXml() output
}

interface BpmnPersistenceResult {
  id: number;
}
```

The built-in `ui: 'default'` Save button has no name/type fields of its
own, so it always calls `save()` with `id: -1, name: '', type: ''` — treat
`id === -1` as "not yet saved" the way Mercator's own adapter does. A host
that needs real name/type metadata should mount with `ui: 'none'`, own its
own Save button, and call its `BpmnPersistence` implementation directly
(bypassing `options.persistence` entirely) — see
[Mercator's adapter](./guides/backend-integration.md#mercator-a-worked-example)
for exactly that pattern, including CSRF and reflecting a newly-assigned id
back into the page.

## `BpmnEditorMessages` / i18n

Every key is optional; unset keys fall back to the bundled French defaults.
See the [i18n guide](./guides/i18n.md) for a full English override example.

| Key | Default (French) | Used for |
|---|---|---|
| `welcome` | `👋 Bienvenue ! Charge un fichier BPMN` | Status message shown once, on mount, in `ui: 'default'` non-readOnly mode. |
| `saveSuccess` | `✓ Graphe sauvegardé` | Status message after a successful Save (download fallback or `persistence.save()`). |
| `saveError` | `Erreur lors de la sauvegarde du graphe.` | Status message when `persistence.save()` rejects. |
| `loadSuccess` | `✓ Fichier chargé avec succès` | Status message after successfully importing a file via the toolbar's file input. |
| `loadError` | `✗ Erreur lors du chargement du fichier` | Status message when importing a file fails. |
| `exportError` | `✗ Impossible de générer le BPMN` | Status message when `getXml()` fails or returns empty during Save. |
| `filterPlaceholder` | `Filter...` | Placeholder text of the "insert cartography object" search input. |
| `filterAriaLabel` | `Filter elements` | `aria-label` of that same input. |
| `noMatch` | `No match.` | Shown in the object picker when the filter matches nothing. |
| `saveNameRequired` | `Le nom du graphe est obligatoire.` | *Not consumed by the editor itself* — reserved for a host adapter that has its own name field and wants to reuse this message for its own validation. |
| `xmlParseError` | `Erreur de parsing XML` | *Not consumed by the editor itself* — reserved the same way, for a host with its own raw-XML handling. |

## A note on XML formats

The editor understands two different XML formats, each with its own pair of
methods:

- `loadXml()` / `getXml()` round-trip MaxGraph's own `GraphDataModel`
  serialization — the format Mercator stores diagrams in, and the format
  [`examples/sample.bpmn`](https://github.com/sourcentis/bpmn-editor/blob/main/examples/sample.bpmn) is written in, despite
  the `.bpmn` extension.
- `importBpmnXml()` parses actual BPMN 2.0 XML — `<definitions>`,
  `<process>`, `<startEvent>`, `<sequenceFlow>`, `<bpmndi:BPMNShape>`
  positions, etc. — the format real BPMN modeling tools export, and converts
  it into the editor's own shapes. This is also what the built-in
  `ui: 'default'` toolbar's file-input **Import** button calls internally.
  There is no matching `exportBpmnXml()` — round-trip through
  `getXml()`/`loadXml()` instead, or use `exportSvg()` for a portable
  rendered output.

If you're generating diagrams programmatically to feed to `loadXml()`
(rather than importing an existing BPMN 2.0 file with `importBpmnXml()`),
use `getXml()`'s own output as your reference format — round-trip a diagram
you've built by hand in the editor once, and use that as a template.
