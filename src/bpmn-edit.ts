// src/bpmn-edit.ts
import {
    Cell,
    Client,
    Graph,
    InternalEvent,
    RubberBandHandler,
    UndoManager,
} from '@maxgraph/core';
import { applyGraphStyles } from './graph-styles';
import { RightClickPanningHandler } from './bpmn-panning';
import { downloadSvg, embedFontInSvg, exportGraphToSvg } from "./bpmn-svg";
import { addBPMNAnnotation, addBPMNData, addBPMNGateway, addBPMNLane, addBPMNState, addBPMNTask, centerGraphView } from "./bpmn-helpers";
import { BPMN_FONT_DATA_URI, BPMN_FONT_FAMILY } from './assets';

export interface BpmnEditorContext {
    graph: Graph;
    undoManager: UndoManager;
    /** Removes every listener registered by initBpmnEditor (drop handlers, undo, double-click). */
    dispose(): void;
}

export interface InitBpmnEditorHooks {
    /** Called instead of a global lookup whenever internal code needs the contextual menu hidden. */
    onHideMenu?: () => void;
    /**
     * Root element containing the drag-source palette buttons (`[data-node-type]`).
     * Distinct from `container` — the palette lives in the toolbar, not the canvas.
     * Absent in `ui: 'none'` mode (no built-in palette to wire).
     */
    paletteRoot?: ParentNode | null;
}

// ── Drop helpers ───────────────────────────────────────────────────────────────

type DropInserter = (graph: Graph, parent: Cell, x: number, y: number) => void;

interface DropConfig {
    inserter: DropInserter;
    /** When true, drop into an underlying lane/activities group if one exists */
    useLane: boolean;
}

function insertLane(graph: Graph, parent: Cell, x: number, y: number): void {
    const v = addBPMNLane(graph, parent, { x, y, width: 600, height: 150, value: 'Lane' });
    graph.orderCells(true, [v]);
}

function insertActivities(graph: Graph, parent: Cell, x: number, y: number): void {
    graph.insertVertex({ parent, value: '', position: [x, y], size: [300, 200], style: { baseStyleNames: ['activities'] } });
}

function insertData(graph: Graph, parent: Cell, x: number, y: number): void {
    addBPMNData(graph, parent, x, y);
}

function insertConversation(graph: Graph, parent: Cell, x: number, y: number): void {
    graph.insertVertex({ parent, value: '', position: [x, y], size: [40, 40], style: { baseStyleNames: ['conversation'] } });
}

const DROP_CONFIGS: Record<string, DropConfig> = {
    'task-node':         { inserter: addBPMNTask,        useLane: true  },
    'state-node':        { inserter: addBPMNState,       useLane: true  },
    'gateway-node':      { inserter: addBPMNGateway,     useLane: true  },
    'data-node':         { inserter: insertData,         useLane: true  },
    'activities-node':   { inserter: insertActivities,   useLane: true  },
    'annotation-node':   { inserter: addBPMNAnnotation,  useLane: false },
    'lane-node':         { inserter: insertLane,         useLane: false },
    'conversation-node': { inserter: insertConversation, useLane: false },
};

function isLaneOrActivities(cell: any): boolean {
    const names: string[] = cell?.style?.baseStyleNames ?? [];
    return names.includes('lane') || names.includes('activities');
}

function resolveDropTarget(
    graph: Graph,
    event: DragEvent,
    useLane: boolean
): { parent: Cell; x: number; y: number } {
    const pt            = graph.getPointForEvent(event);
    const defaultParent = graph.getDefaultParent();

    if (!useLane) return { parent: defaultParent, x: pt.x, y: pt.y };

    const dropCell  = graph.getCellAt(event.offsetX, event.offsetY) as any;
    const laneCell  = isLaneOrActivities(dropCell) ? dropCell : null;
    const parent    = laneCell ?? defaultParent;

    let { x, y } = pt;

    if (laneCell) {
        const state = graph.getView()?.getState?.(laneCell) as any;
        if (state?.origin) {
            x -= state.origin.x;
            y -= state.origin.y;
        }
        y = Math.max(y, 30); // empêche le drop dans l'en-tête de lane
    }

    return { parent, x, y };
}

/**
 * Wires drag sources found under `paletteRoot` (any element carrying a
 * `data-node-type` attribute) instead of assuming fixed host page IDs.
 */
// Firefox is stricter than Chrome about `dataTransfer`: a custom "type"
// string with no "/" (like a plain "node-type") is unreliable there, and
// drops can be refused outright if `effectAllowed`/`dropEffect` aren't set
// explicitly. Use a namespaced MIME-like type as the primary carrier, mirror
// the value into the universally-supported "text/plain" as a fallback, and
// set effectAllowed/dropEffect on both ends.
const DRAG_NODE_TYPE_FORMAT = 'application/x-bpmn-node-type';

function installDropHandlers(graph: Graph, container: HTMLElement, paletteRoot: ParentNode | null): () => void {
    const onDragOver = (e: DragEvent) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    container.addEventListener('dragover', onDragOver);

    const dragStartCleanups: Array<() => void> = [];
    if (paletteRoot) {
        const sources = Array.from(paletteRoot.querySelectorAll<HTMLElement>('[data-node-type]'));
        for (const el of sources) {
            const nodeType = el.dataset.nodeType;
            if (!nodeType) continue;
            const onDragStart = (e: DragEvent) => {
                if (!e.dataTransfer) return;
                e.dataTransfer.effectAllowed = 'copy';
                e.dataTransfer.setData(DRAG_NODE_TYPE_FORMAT, nodeType);
                e.dataTransfer.setData('text/plain', nodeType);
            };
            el.addEventListener('dragstart', onDragStart);
            dragStartCleanups.push(() => el.removeEventListener('dragstart', onDragStart));
        }
    }

    const onDrop = (event: DragEvent) => {
        event.preventDefault();
        const nodeType =
            event.dataTransfer?.getData(DRAG_NODE_TYPE_FORMAT) ||
            event.dataTransfer?.getData('text/plain');
        if (!nodeType) return;

        const config = DROP_CONFIGS[nodeType];
        if (!config) return;

        const { parent, x, y } = resolveDropTarget(graph, event, config.useLane);

        graph.batchUpdate(() => config.inserter(graph, parent, x, y));
    };
    container.addEventListener('drop', onDrop);

    return () => {
        container.removeEventListener('dragover', onDragOver);
        container.removeEventListener('drop', onDrop);
        dragStartCleanups.forEach((fn) => fn());
    };
}

// ── Editor initialisation ──────────────────────────────────────────────────────

/**
 * Note: `Client.imageBasePath` is a static (class-level) MaxGraph setting, shared
 * by every Graph instance on the page. Re-assigning it here is idempotent as long
 * as every editor instance on the page agrees on the same base path.
 */
export function initBpmnEditor(
    container: HTMLElement,
    hooks: InitBpmnEditorHooks = {}
): BpmnEditorContext {
    Client.imageBasePath = '/images';

    container.tabIndex = 0;

    const graph = new Graph(container);

    graph.gridSize    = 1;
    graph.gridEnabled = true;

    applyGraphStyles(graph);

    graph.setDropEnabled(true);

    // Panning au clic DROIT (bouton enfoncé), pas au clic gauche : le clic
    // gauche doit rester exclusivement réservé au déplacement de cellule
    // (setCellsMovable) et à la sélection — le brancher aussi sur le panning
    // (même limité au fond, sans cellule sous le curseur) empêchait de facto
    // le drag des éléments du graphe. Le clic droit ne sert à rien d'autre
    // ici (notre menu contextuel, dans bpmn-menu-init.ts, écoute
    // InternalEvent.CLICK — un clic gauche simple sur une cellule — pas
    // "contextmenu"), donc aucun conflit à craindre. Le menu contextuel natif
    // du navigateur est supprimé via preventDefault sur "contextmenu"
    // ci-dessous, ce qui rend le clic droit maintenu fiable pour un glisser
    // continu (auparavant peu fiable tant que ce menu apparaissait par-dessus
    // et interférait avec la diffusion des mousemove, sur Firefox et Chrome).
    // On désactive donc le PanningHandler par défaut de maxGraph et on le
    // remplace par RightClickPanningHandler (bpmn-panning.ts).
    graph.setPanning(false);
    const rightClickPanning = new RightClickPanningHandler(graph);
    rightClickPanning.panningEnabled = true;

    // Pas de `graph.useScrollbarsForPanning = false` ici (essayé puis retiré) :
    // ce drapeau est aussi lu par SelectionHandler après CHAQUE déplacement de
    // cellule (scrollCellToVisible/scrollOnMove) — le désactiver réparait le
    // panning mais translatait alors toute la vue à chaque drag de cellule,
    // rendant le déplacement individuel des éléments impossible. Voir le
    // commentaire dans RightClickPanningHandler.mouseMove (bpmn-panning.ts)
    // pour la façon dont le panning contourne ce drapeau sans y toucher.

    // Filet de sécurité : même écarté comme déclencheur de panning, le clic
    // droit reste le déclencheur par défaut du PopupMenuHandler natif de
    // maxGraph (jamais utilisé — notre propre menu contextuel, dans
    // bpmn-menu-init.ts, écoute InternalEvent.CLICK, pas "contextmenu") et
    // ouvrirait sinon le menu contextuel natif du navigateur par-dessus.
    const onContextMenu = (evt: Event) => evt.preventDefault();
    container.addEventListener('contextmenu', onContextMenu);

    graph.setConnectable(false);
    graph.setCellsEditable(true);
    graph.setCellsResizable(true);
    graph.setCellsMovable(true);
    graph.setAllowDanglingEdges(false);
    graph.setDisconnectOnMove(false);
    graph.setSplitEnabled(false);
    graph.setHtmlLabels(true);

    new RubberBandHandler(graph);

    // Undo
    const undoManager = new UndoManager();
    (undoManager as any).__suspended = false;

    const undoListener = (_sender: any, evt: any) => {
        if ((undoManager as any).__suspended) return;
        undoManager.undoableEditHappened(evt.getProperty('edit'));
    };
    graph.getDataModel().addListener(InternalEvent.UNDO, undoListener);
    graph.getView().addListener(InternalEvent.UNDO, undoListener);

    // Double-clic sur icône d'état → édite le parent
    const onDoubleClick = (_sender: any, evt: any) => {
        const cell = evt.getProperty("cell");
        if (!cell) return;
        hooks.onHideMenu?.();
        if (cell.style?.baseStyleNames?.includes("stateIcon")) {
            const parent = cell.parent;
            if (parent) {
                graph.startEditingAtCell(parent);
                evt.consume();
            }
        }
    };
    graph.addListener(InternalEvent.DOUBLE_CLICK, onDoubleClick);

    // Déplacement du label uniquement pour "state" et "gateway"
    const baseIsLabelMovable = graph.isLabelMovable?.bind(graph);
    graph.isLabelMovable = (cell: any) => {
        const names = cell?.style?.baseStyleNames;
        if (names?.includes('state') || names?.includes('gateway')) return true;
        return baseIsLabelMovable ? baseIsLabelMovable(cell) : false;
    };

    // Pas de sélection pour les icônes internes
    const prevIsCellSelectable = graph.isCellSelectable?.bind(graph);
    (graph as any).isCellSelectable = (cell: any) => {
        if (!cell) return false;
        const names = cell?.style?.baseStyleNames ?? [];
        if (names.includes('stateIcon') || names.includes('bpmnIcon') || names.includes('bpmnBadge')) return false;
        return prevIsCellSelectable ? prevIsCellSelectable(cell) : true;
    };

    // Curseur "déplacer" (4 flèches) au survol d'un "state", comme sur un "process"
    const prevGetCursorForCell = graph.getCursorForCell?.bind(graph);
    (graph as any).getCursorForCell = (cell: any) => {
        const names = cell?.style?.baseStyleNames ?? [];
        if (names.includes('state') || names.includes('stateIcon')) return 'move';
        return prevGetCursorForCell ? prevGetCursorForCell(cell) : null;
    };

    // Autoriser le drop uniquement dans les lanes — jamais une lane DANS une autre
    // lane : sans ce second garde-fou, glisser une lane et survoler une lane
    // voisine (cas courant vu la disposition en bandes empilées) la ferait
    // reparenter nativement sous cette voisine (comportement swimlane par défaut
    // de maxGraph), désynchronisant sa géométrie de ses propres enfants qui, eux,
    // ne bougent pas — la lane et son contenu semblent alors se disloquer au lieu
    // de simplement se déplacer ensemble.
    graph.getDropTarget = function (cells: any[], _evt: MouseEvent, cell: any) {
        if (!cell?.style?.baseStyleNames?.includes?.("lane")) return null;
        if (cells.some((c: any) => c?.style?.baseStyleNames?.includes?.("lane"))) return null;
        return cell;
    };

    // Par défaut, maxGraph refuse une lane comme cible de connexion (ConnectionHandler /
    // EdgeHandler) dès que le point survolé est dans son corps plutôt que son bandeau de
    // titre (hitsSwimlaneContent) — l'idée d'origine étant qu'on cible plutôt un enfant
    // à cet endroit. Mais quand le corps est vide à cet endroit précis, getCellAt ne
    // trouve aucun enfant et le geste "connect" (bpmn-menu-handler.ts) échoue
    // silencieusement, obligeant l'utilisateur à viser le titre — contre-intuitif. En
    // désactivant toujours cette exclusion, le corps de la lane redevient une cible
    // valide ; un enfant présent au point cliqué reste prioritaire car getCellAt le
    // trouve avant même que cette méthode soit consultée.
    graph.hitsSwimlaneContent = () => false;

    const disposeDropHandlers = installDropHandlers(graph, container, hooks.paletteRoot ?? null);

    return {
        graph,
        undoManager,
        dispose(): void {
            disposeDropHandlers();
            container.removeEventListener('contextmenu', onContextMenu);
            // graph.destroy() (appelé par create-bpmn-editor.ts après ces disposers)
            // n'appelle onDestroy() que sur les plugins connus de son constructeur —
            // un handler ajouté ad hoc comme celui-ci (même pattern que
            // `new RubberBandHandler(graph)` ci-dessus) doit se désinscrire lui-même.
            rightClickPanning.onDestroy();
            graph.getDataModel().removeListener(undoListener);
            graph.getView().removeListener(undoListener);
            graph.removeListener(onDoubleClick);
        },
    };
}

// ── UI wiring ──────────────────────────────────────────────────────────────────

export interface WireEditorUiOptions {
    /** Root element containing `[data-action]` toolbar buttons. Absent in `ui: 'none'` mode. */
    toolbarRoot?: ParentNode | null;
    /** Overrides the bundled BPMN icon font URL used when embedding fonts in SVG export. */
    fontUrl?: string;
}

/**
 * Exports the graph to an SVG file and triggers a download. Shared by the
 * built-in `ui: 'default'` toolbar's "download-svg" action and the public
 * `BpmnEditorInstance.exportSvg()` method, so `ui: 'none'` hosts get the same
 * behavior from their own button.
 */
export async function exportGraphAsSvgFile(
    graph: Graph,
    fontUrl?: string,
    filename = 'bpmn-export.svg'
): Promise<void> {
    const svg = exportGraphToSvg(graph);
    await embedFontInSvg(svg, {
        fontUrl:    fontUrl ?? BPMN_FONT_DATA_URI,
        fontFamily: BPMN_FONT_FAMILY,
        mime:       "font/ttf",
    });
    downloadSvg(svg, filename);
}

export function wireEditorUi(
    graph: Graph,
    undoManager: UndoManager,
    options: WireEditorUiOptions = {}
): () => void {
    const cleanups: Array<() => void> = [];
    const on = <K extends keyof HTMLElementEventMap>(
        target: EventTarget,
        type: K,
        handler: (ev: HTMLElementEventMap[K]) => void
    ) => {
        target.addEventListener(type, handler as EventListener);
        cleanups.push(() => target.removeEventListener(type, handler as EventListener));
    };

    on(graph.container, 'pointerdown', () => {
        (graph.container as HTMLElement).focus();
    });

    on(graph.container, 'keydown', (event: KeyboardEvent) => {
        if (event.ctrlKey && event.key.toLowerCase() === 'z') {
            event.preventDefault();
            event.stopPropagation();
            if (undoManager.canUndo()) undoManager.undo();
            return;
        }
        if (event.ctrlKey && event.key.toLowerCase() === 'y') {
            event.preventDefault();
            event.stopPropagation();
            if (undoManager.canRedo()) undoManager.redo();
            return;
        }
        if (event.ctrlKey && event.key.toLowerCase() === 'a') {
            event.preventDefault();
            event.stopPropagation();
            graph.selectAll();
            return;
        }
        if (event.key === 'Delete' || event.key === 'Backspace') {
            if (graph.isEditing()) return;
            event.preventDefault();
            event.stopPropagation();
            const cells = graph.getSelectionCells();
            if (!cells?.length) return;
            graph.getDataModel().beginUpdate();
            try {
                graph.removeCells(cells, true);
            } finally {
                graph.getDataModel().endUpdate();
            }
        }
    });

    const toolbarRoot = options.toolbarRoot;
    if (toolbarRoot) {
        const bind = (action: string, handler: (ev: MouseEvent) => void) => {
            const btn = toolbarRoot.querySelector<HTMLElement>(`[data-action="${action}"]`);
            if (btn) on(btn, 'click', handler);
        };

        bind('download-svg', () => {
            void exportGraphAsSvgFile(graph, options.fontUrl);
        });

        bind('zoom-in',  () => graph.zoomIn());
        bind('zoom-out', () => graph.zoomOut());
        bind('fit',      () => centerGraphView(graph));
        bind('undo',     () => { if (undoManager.canUndo()) undoManager.undo(); });
        bind('redo',     () => { if (undoManager.canRedo()) undoManager.redo(); });
    }

    return () => cleanups.forEach((fn) => fn());
}

/** Pure DOM toggle — callers own the element reference (no global lookup). */
export function hideMenu(menuEl: HTMLElement | null | undefined): void {
    menuEl?.classList.add("bpmn-editor-hidden");
}

export function enableArrowKeyMovement(
    graph: Graph,
    hooks: InitBpmnEditorHooks = {},
    step = 1
): () => void {
    const onKeyDown = (event: KeyboardEvent) => {
        if (graph.isEditing()) return;

        let dx = 0;
        let dy = 0;
        switch (event.key) {
            case 'ArrowUp':    dy = -step; break;
            case 'ArrowDown':  dy =  step; break;
            case 'ArrowLeft':  dx = -step; break;
            case 'ArrowRight': dx =  step; break;
            default: return;
        }

        hooks.onHideMenu?.();
        event.preventDefault();

        const cells = graph.getSelectionCells();
        if (!cells?.length) return;

        graph.batchUpdate(() => {
            for (const cell of cells) {
                if (!cell?.isVertex?.()) continue;
                const geo = cell.getGeometry();
                if (!geo) continue;
                const newGeo = geo.clone();
                newGeo.translate(dx, dy);
                graph.model.setGeometry(cell, newGeo);
            }
        });
    };

    graph.container.addEventListener('keydown', onKeyDown);
    return () => graph.container.removeEventListener('keydown', onKeyDown);
}

export function showStatus(statusEl: HTMLElement | null | undefined, message: string, duration = 2000): void {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.classList.add('bpmn-editor-status--show');
    setTimeout(() => statusEl.classList.remove('bpmn-editor-status--show'), duration);
}
