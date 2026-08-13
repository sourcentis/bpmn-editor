// src/ui/dom.ts
// Builds the editor's own DOM tree inside the host-provided container. Nothing
// here assumes any pre-existing host page markup or IDs — every element the
// editor needs is created here, scoped to `bpmn-editor-*` prefixed classes so
// it can never collide with host page styles, and multiple instances can be
// mounted side by side without interference.

import { BPMN_FONT_DATA_URI, BPMN_FONT_FAMILY } from '../assets';
import { BPMN_ICONS } from '../bpmn-icons';
import { ICONS } from '../icons';

export interface EditorDom {
    root: HTMLElement;
    canvas: HTMLElement;
    toolbar: HTMLElement | null;
    paletteRoot: HTMLElement | null;
    statusEl: HTMLElement | null;
    fileInput: HTMLInputElement | null;
    menuEl: HTMLElement | null;
    /** Detaches everything this function created from `container` and clears injected classes. */
    destroy(): void;
}

export interface RenderEditorDomOptions {
    ui: 'default' | 'none';
    readOnly: boolean;
}

// Same icons as the editor's original Bootstrap-based chrome: the BPMN glyph
// font for palette shapes (matching the on-canvas rendering), and the
// Bootstrap Icons set (bundled — see src/icons.ts) for the rest, with the one
// exception (conversation) that used a Bootstrap icon instead of a font glyph
// there too.
type PaletteItem =
    | { nodeType: string; title: string; glyph: string; icon?: undefined }
    | { nodeType: string; title: string; icon: string; glyph?: undefined };

const PALETTE_ITEMS: ReadonlyArray<PaletteItem> = [
    { nodeType: 'state-node',        title: 'State',        glyph: BPMN_ICONS.START_EVENT },
    { nodeType: 'task-node',         title: 'Task',         glyph: BPMN_ICONS.EMPTY_TASK },
    { nodeType: 'gateway-node',      title: 'Gateway',      glyph: BPMN_ICONS.GATEWAY },
    { nodeType: 'data-node',         title: 'Data',         glyph: BPMN_ICONS.DATA },
    // No named BPMN_ICONS constant for this codepoint, but it's the exact one
    // the original toolbar markup used (&#xE85C;) — kept identical.
    { nodeType: 'lane-node',         title: 'Lane',         glyph: '\uE85C' },
    { nodeType: 'activities-node',   title: 'Activities',   glyph: BPMN_ICONS.ACTIVITIES },
    { nodeType: 'annotation-node',   title: 'Annotation',   glyph: BPMN_ICONS.ANNOTATION },
    { nodeType: 'conversation-node', title: 'Conversation', icon: ICONS.conversation },
];

const ACTION_BUTTONS: ReadonlyArray<{ action: string; icon: string; title: string }> = [
    { action: 'zoom-in',      icon: ICONS.zoomIn,      title: 'Zoom in' },
    { action: 'zoom-out',     icon: ICONS.zoomOut,     title: 'Zoom out' },
    { action: 'fit',          icon: ICONS.fit,         title: 'Fit / center' },
    { action: 'undo',         icon: ICONS.undo,        title: 'Undo' },
    { action: 'redo',         icon: ICONS.redo,        title: 'Redo' },
    { action: 'import',       icon: ICONS.import,      title: 'Import a BPMN/XML file' },
    { action: 'download-svg', icon: ICONS.downloadSvg, title: 'Export as SVG' },
    { action: 'save',         icon: ICONS.save,        title: 'Save' },
];

type MenuButton =
    | { action: string; title: string; glyph: string; icon?: undefined }
    | { action: string; title: string; icon: string; glyph?: undefined };

// Every button gets a break slot right after it in the DOM (see
// buildVertexMenu), hidden by default; which ones actually show is
// recomputed at runtime by recomputeMenuBreaks() in bpmn-menu-init.ts each
// time per-cell action visibility changes (see applyMenuVisibilityForCell):
// a break is shown after every 4th *visible* button, matching
// `.bpmn-editor-vertex-menu`'s max-width (tuned to a 4-button row) so rows
// never silently overflow into browser-dependent auto-wrap behavior.
const MENU_BUTTONS: ReadonlyArray<MenuButton> = [
    { action: 'add-state',       title: 'State',                        icon: ICONS.addState },
    { action: 'add-task',        title: 'Task',                         icon: ICONS.addTask },
    { action: 'add-gateway',     title: 'Condition',                    icon: ICONS.addGateway },
    { action: 'connect',         title: 'Lier',                         icon: ICONS.connect },
    { action: 'config',          title: 'Configuration',                icon: ICONS.config },
    { action: 'color',           title: 'Couleur',                      icon: ICONS.color },
    { action: 'rotate',          title: 'Rotate',                       icon: ICONS.rotate },
    { action: 'add-annotations', title: 'Annotation',                   glyph: BPMN_ICONS.ANNOTATION },
    { action: 'delete',          title: 'Supprimer',                    icon: ICONS.delete },
    { action: 'search',          title: 'Insert cartography object',    icon: ICONS.search },
];

const SWATCH_COLORS: readonly string[] = [
    '#ffffff', '#fde68a', '#bbf7d0', '#bfdbfe', '#fecaca', '#e9d5ff', '#d1d5db',
];

function appendGlyphOrIcon(btn: HTMLElement, item: { glyph?: string; icon?: string }, alt: string): void {
    if (item.icon !== undefined) {
        const img = document.createElement('img');
        img.src = item.icon;
        img.alt = '';
        img.className = 'bpmn-editor-icon';
        // <img> is draggable by default in every browser; left alone, a
        // native drag started on the icon competes with (and can hijack)
        // the parent button's own `draggable` drag-source wiring.
        img.draggable = false;
        btn.appendChild(img);
    } else if (item.glyph !== undefined) {
        const span = document.createElement('span');
        span.className = 'bpmn-editor-glyph';
        span.textContent = item.glyph;
        btn.appendChild(span);
    }
    btn.setAttribute('aria-label', alt);
}

let stylesInjected = false;

function ensureStylesInjected(): void {
    if (stylesInjected || document.getElementById('bpmn-editor-base-styles')) {
        stylesInjected = true;
        return;
    }
    const style = document.createElement('style');
    style.id = 'bpmn-editor-base-styles';
    style.textContent = CSS_TEXT;
    document.head.appendChild(style);
    stylesInjected = true;
}

export function renderEditorDom(container: HTMLElement, options: RenderEditorDomOptions): EditorDom {
    ensureStylesInjected();

    container.textContent = '';
    container.classList.add('bpmn-editor-container');

    const root = document.createElement('div');
    root.className = 'bpmn-editor-root';
    container.appendChild(root);

    let toolbar: HTMLElement | null = null;
    let paletteRoot: HTMLElement | null = null;
    let fileInput: HTMLInputElement | null = null;

    const showToolbar = options.ui === 'default' && !options.readOnly;
    if (showToolbar) {
        toolbar = document.createElement('div');
        toolbar.className = 'bpmn-editor-toolbar';

        paletteRoot = document.createElement('div');
        paletteRoot.className = 'bpmn-editor-palette';
        for (const item of PALETTE_ITEMS) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'bpmn-editor-palette-btn';
            btn.draggable = true;
            btn.dataset.nodeType = item.nodeType;
            btn.title = item.title;
            appendGlyphOrIcon(btn, item, item.title);
            paletteRoot.appendChild(btn);
        }
        toolbar.appendChild(paletteRoot);

        const actions = document.createElement('div');
        actions.className = 'bpmn-editor-actions';
        for (const def of ACTION_BUTTONS) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'bpmn-editor-action-btn';
            btn.dataset.action = def.action;
            btn.title = def.title;
            appendGlyphOrIcon(btn, def, def.title);
            actions.appendChild(btn);
        }
        toolbar.appendChild(actions);

        root.appendChild(toolbar);

        fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.bpmn,.xml';
        fileInput.className = 'bpmn-editor-file-input';
        root.appendChild(fileInput);

        const triggerInput = fileInput;
        const importBtn = actions.querySelector<HTMLElement>('[data-action="import"]');
        importBtn?.addEventListener('click', () => triggerInput.click());
    }

    const canvas = document.createElement('div');
    canvas.className = 'bpmn-editor-canvas';
    root.appendChild(canvas);

    let statusEl: HTMLElement | null = null;
    if (options.ui === 'default') {
        statusEl = document.createElement('div');
        statusEl.className = 'bpmn-editor-status';
        root.appendChild(statusEl);
    }

    let menuEl: HTMLElement | null = null;
    if (!options.readOnly) {
        menuEl = buildVertexMenu();
        root.appendChild(menuEl);
    }

    return {
        root,
        canvas,
        toolbar,
        paletteRoot,
        statusEl,
        fileInput,
        menuEl,
        destroy(): void {
            container.textContent = '';
            container.classList.remove('bpmn-editor-container');
        },
    };
}

function buildVertexMenu(): HTMLElement {
    const menu = document.createElement('div');
    menu.className = 'bpmn-editor-vertex-menu bpmn-editor-hidden';

    for (const def of MENU_BUTTONS) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'bpmn-editor-menu-btn';
        btn.dataset.action = def.action;
        btn.title = def.title;
        appendGlyphOrIcon(btn, def, def.title);
        if (def.action === 'color') btn.setAttribute('aria-expanded', 'false');
        menu.appendChild(btn);

        // One break slot after every button, hidden by default — which ones
        // show is decided at runtime by recomputeMenuBreaks() (bpmn-menu-init.ts)
        // based on which buttons actually end up visible for the clicked cell.
        const menuBreak = document.createElement('span');
        menuBreak.className = 'bpmn-editor-menu-break bpmn-editor-hidden';
        menu.appendChild(menuBreak);
    }

    const palette = document.createElement('div');
    palette.className = 'bpmn-editor-color-palette bpmn-editor-hidden';
    palette.dataset.role = 'color-palette';
    palette.setAttribute('aria-hidden', 'true');
    for (const color of SWATCH_COLORS) {
        const swatch = document.createElement('button');
        swatch.type = 'button';
        swatch.className = 'bpmn-editor-color-swatch';
        swatch.dataset.color = color;
        swatch.style.backgroundColor = color;
        palette.appendChild(swatch);
    }
    menu.appendChild(palette);

    return menu;
}

const CSS_TEXT = `
@font-face {
  font-family: "${BPMN_FONT_FAMILY}";
  src: url("${BPMN_FONT_DATA_URI}") format("truetype");
  font-display: block;
}
.bpmn-editor-container {
  box-sizing: border-box;
}
.bpmn-editor-container *,
.bpmn-editor-container *::before,
.bpmn-editor-container *::after {
  box-sizing: border-box;
}
/* Neutral baseline so a host page's own global element selectors (a common
   pattern: "button { padding: 8px 16px; background: blue; color: white }")
   can't bleed into the editor's own buttons/inputs — this is deliberately
   low-specificity so every button/input rule below still wins. */
.bpmn-editor-container button,
.bpmn-editor-container input {
  margin: 0;
  padding: 0;
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  line-height: normal;
}
/* Firefox gives every <button> its own internal focus-ring box
   (::-moz-focus-inner) with a default padding/border that live outside the
   button's own box model — the padding:0/border:none reset above doesn't
   touch it. Chrome/WebKit have no equivalent, so left unreset this widens
   buttons only in Firefox, enough to throw off .bpmn-editor-vertex-menu's
   width-tuned row wrapping (see max-width comment below). */
.bpmn-editor-container button::-moz-focus-inner {
  padding: 0;
  border: 0;
}
.bpmn-editor-root {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 320px;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 13px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  overflow: hidden;
  position: relative;
}
.bpmn-editor-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border-bottom: 1px solid #d1d5db;
  background: #f9fafb;
}
.bpmn-editor-palette,
.bpmn-editor-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.bpmn-editor-palette-btn,
.bpmn-editor-action-btn {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #d1d5db;
  background: #ffffff;
  border-radius: 4px;
  padding: 4px 8px;
  min-width: 28px;
  min-height: 28px;
  cursor: pointer;
  color: #1f2937;
}
.bpmn-editor-palette-btn:hover,
.bpmn-editor-action-btn:hover {
  background: #f3f4f6;
}
.bpmn-editor-palette-btn {
  cursor: grab;
  /* Firefox can treat a text-selection drag as taking priority over an HTML5
     DnD drag on elements it considers selectable; belt-and-suspenders. */
  user-select: none;
  -webkit-user-select: none;
  -moz-user-select: none;
}
.bpmn-editor-icon {
  width: 16px;
  height: 16px;
  display: block;
  /* No pointer-events:none here: Firefox does not reliably fall through a
     pointer-events:none child to find the nearest draggable ancestor when
     starting a drag (unlike Chrome), which silently prevented dragstart
     from firing at all. img.draggable = false (set in JS) already stops
     the <img> itself from being picked as a competing native drag source,
     so this is safe without pointer-events:none. */
}
.bpmn-editor-glyph {
  font-family: "${BPMN_FONT_FAMILY}";
  font-size: 20px;
  line-height: 1;
  font-style: normal;
  font-weight: normal;
  font-variant: normal;
}
.bpmn-editor-file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
}
.bpmn-editor-canvas {
  position: relative;
  flex: 1 1 auto;
  min-height: 240px;
  overflow: auto;
  background: #ffffff;
  outline: none;
}
.bpmn-editor-status {
  padding: 4px 8px;
  font-size: 12px;
  color: #374151;
  background: #f9fafb;
  border-top: 1px solid #e5e7eb;
  opacity: 0;
  transition: opacity 0.15s ease;
  min-height: 1.6em;
}
.bpmn-editor-status--show {
  opacity: 1;
}
.bpmn-editor-vertex-menu {
  position: absolute;
  z-index: 20;
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  /* Without an explicit width, a flex-wrap container sizes itself to fit
     ALL items on one line (shrink-to-fit against max-content), then just
     clips that width down to max-width — it does NOT shrink to the actual
     widest wrapped row. Sized to a 4-button row (4 × 28px buttons + 3 × 2px
     gaps + padding + border). Row breaks are forced explicitly via
     .bpmn-editor-menu-break slots, toggled at runtime by
     recomputeMenuBreaks() (bpmn-menu-init.ts) against the buttons actually
     visible for the clicked cell — this max-width is kept only as a
     fallback ceiling for narrow hosts. Recompute if button size/gap/padding
     changes. */
  max-width: 128px;
  padding: 4px;
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
}
.bpmn-editor-menu-break {
  flex-basis: 100%;
  height: 0;
}
.bpmn-editor-menu-btn {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  background: transparent;
  border-radius: 4px;
  width: 28px;
  height: 28px;
  cursor: pointer;
  line-height: 1;
}
.bpmn-editor-menu-btn:hover {
  background: rgba(0, 0, 0, 0.06);
}
.bpmn-editor-color-palette {
  position: absolute;
  top: 100%;
  left: 0;
  margin-top: 4px;
  display: flex;
  gap: 4px;
  padding: 6px;
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
}
.bpmn-editor-color-swatch {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  border: 1px solid rgba(0, 0, 0, 0.15);
  cursor: pointer;
  padding: 0;
}
.bpmn-editor-hidden {
  display: none !important;
}

/* MaxGraph's own internal handlers (RubberBandHandler, CellEditorHandler)
   only set bare, unprefixed class names on the elements they create —
   mxRubberband / mxCellEditor / mxPlainTextEditor — with no inline colors
   or (for the cell editor) even position:absolute. They're built to expect
   the host page to supply this CSS globally, which the original app's own
   page-level stylesheet did; a standalone embed has no such stylesheet, so
   the editor bundles the same rules itself. These are MaxGraph's global
   class names, not bpmn-editor-* — intentionally unprefixed to match what
   MaxGraph actually renders. */
div.mxRubberband {
  position: absolute;
  overflow: hidden;
  border-style: solid;
  border-width: 2px;
  border-color: #0000ff;
  background: #0077ff;
}
.mxCellEditor {
  border-color: transparent;
  border-style: solid;
  border-width: 0;
  display: inline-block;
  position: absolute;
  overflow: visible;
  word-wrap: normal;
  min-width: 1px;
  resize: none;
  padding: 0;
  margin: 0;
}
.mxPlainTextEditor * {
  padding: 0;
  margin: 0;
}
`;
