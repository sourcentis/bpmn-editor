# Guide: backend integration

The editor talks to a backend only through two optional ports —
`BpmnObjectProvider` and `BpmnPersistence` (both plain TypeScript
interfaces, see the [API reference](../api-reference.md#ports) for their
full shape). Nothing in the editor's own code knows about HTTP, CSRF,
routes, or any particular backend framework; all of that lives in your
implementation of these two interfaces.

This guide is framework-agnostic — the fetch calls below are plain
`fetch()`, adapt them to whatever your backend actually expects. **Laravel
is not assumed anywhere in this package**; it just happens to be the
backend Mercator (the reference integration below) uses.

## `BpmnObjectProvider`

Powers the "insert cartography object" search action inside the contextual
menu that appears when you select an element. Implement it against
whatever "catalogue of things a diagram element can link to" means in your
app:

```ts
import type { BpmnObjectProvider } from '@sourcentis/bpmn-editor';

const provider: BpmnObjectProvider = {
  getGraphObjects: () =>
    fetch('/api/applications', { credentials: 'same-origin' })
      .then((res) => res.json()),
  getInformationObjects: () =>
    fetch('/api/information', { credentials: 'same-origin' })
      .then((res) => res.json()),
  getActorObjects: () =>
    fetch('/api/actors', { credentials: 'same-origin' })
      .then((res) => res.json()),
  getProcessObjects: () =>
    fetch('/api/processes', { credentials: 'same-origin' })
      .then((res) => res.json()),
};

createBpmnEditor(container, { provider });
```

Each endpoint should resolve to an array of `{ id, name, glyph, url? }`.
Leave the `provider` option out entirely and this feature is simply hidden
— nothing else about the editor changes.

## `BpmnPersistence`

Powers the built-in `ui: 'default'` toolbar's Save button:

```ts
import type { BpmnPersistence } from '@sourcentis/bpmn-editor';

const persistence: BpmnPersistence = {
  save: ({ id, name, type, content }) =>
    fetch(`/api/diagrams/${id}`, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, type, content }),
    }).then((res) => {
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      return res.json(); // must resolve to { id }
    }),
};

createBpmnEditor(container, { persistence });
```

Leave `persistence` out and Save downloads a local `.maxgraph` file instead —
useful for prototyping before a save endpoint exists.

### If you're using `ui: 'none'`

The built-in Save button doesn't exist in `ui: 'none'` mode (there's no
toolbar at all), so `options.persistence` has no effect there. Call your
`BpmnPersistence` implementation directly from your own Save button
instead:

```ts
const editor = createBpmnEditor(container, { ui: 'none' });

document.getElementById('my-save-button').addEventListener('click', async () => {
  const content = editor.getXml();
  const { id } = await persistence.save({ id: currentId, name, type, content });
  currentId = id;
});
```

This is exactly the pattern Mercator's own adapter uses — see below.

## Mercator: a worked example

[Mercator](https://github.com/dbarzin/mercator) (a Laravel app) is the
project this package was extracted from, and its current BPMN editor is
built on it — mounted with `ui: 'none'` to reuse Mercator's own Bootstrap
sidebar/toolbar. Its two adapter files
(`resources/BPMN/mercator-provider.ts` and `mercator-persistence.ts` in the
Mercator repo — not part of this package) implement exactly the two ports
above against Laravel routes, with the framework-specific details fully
contained there:

```ts
// mercator-provider.ts (excerpt)
async function fetchBpmnObjects(endpoint: string): Promise<BpmnElementDef[]> {
  const res = await fetch(endpoint, {
    method: 'GET',
    headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    credentials: 'same-origin',
  });
  const data = await res.json();
  return data.map((o) => ({ id: o.id, name: o.name, glyph: o.id[0], url: o.url }));
}

export const MercatorBpmnProvider: BpmnObjectProvider = {
  getGraphObjects:       () => fetchBpmnObjects('/admin/bpmn/objects'),
  getInformationObjects: () => fetchBpmnObjects('/admin/bpmn/information'),
  getActorObjects:       () => fetchBpmnObjects('/admin/bpmn/actors'),
  getProcessObjects:     () => fetchBpmnObjects('/admin/bpmn/process'),
};
```

```ts
// mercator-persistence.ts (excerpt)
export const MercatorBpmnPersistence: BpmnPersistence = {
  async save({ id, name, type, content }) {
    if (!name.trim()) throw new Error('Le nom du graphe est obligatoire.');

    const response = await fetch(`/admin/bpmn/${id}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') ?? '',
        'X-Requested-With': 'XMLHttpRequest',
      },
      // Laravel's PUT-via-POST convention — nothing the editor itself needs to know about.
      body: JSON.stringify({ _method: 'PUT', id, name, type, content }),
    });
    if (response.status !== 200) throw new Error('Erreur lors de la sauvegarde du graphe.');

    const { graph_id: graphId } = await response.json();
    // Reflect the newly-assigned id back into the page — Mercator uses a
    // fixed #id input and the URL to track "which diagram is this".
    const idInput = document.getElementById('id');
    if (idInput && graphId) idInput.value = String(graphId);
    if (id === -1 && graphId) window.history.replaceState({}, '', `/admin/bpmn/${graphId}`);

    return { id: graphId };
  },
};
```

And its bootstrap (`resources/BPMN/bpmn.ts` in the Mercator repo) ties it
together, mounting with `ui: 'none'` and driving Mercator's own toolbar
buttons through the editor's instance API:

```ts
const editor = createBpmnEditor(document.getElementById('graph-container'), {
  ui: 'none',
  paletteRoot: document.getElementById('sidebar'), // Mercator's own palette, tagged with data-node-type
  provider: MercatorBpmnProvider,
  persistence: MercatorBpmnPersistence,
  onNavigate: (url) => { window.location.href = url; },
});

document.getElementById('zoom-in-btn').addEventListener('click', () => editor.zoomIn());
document.getElementById('save-btn').addEventListener('click', async () => {
  const content = editor.getXml();
  await MercatorBpmnPersistence.save({ id: currentId(), name: nameField.value, type: typeField.value, content });
});
```

No CSRF handling, no route strings, no `_method: 'PUT'` convention appears
anywhere in the editor package itself — all of it lives in these three
adapter files, on the host side of the port boundary.
