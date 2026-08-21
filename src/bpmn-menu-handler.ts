// src/bpmn-menu-handlers.ts
import {Cell, Graph, InternalEvent} from "@maxgraph/core";
import type {AlignMode, VertexActionHandler, VertexActionId} from "./bpmn-menu";
import {startPlaceVertexFollowMouse} from "./bpmn-menu-placement";
import {addBPMNAnnotation, addBPMNConnection, addBPMNGateway, addBPMNState, addBPMNTask, isLaneVertex} from "./bpmn-helpers";

// Décoratifs (icône/badge) : pas de rôle de remplissage propre, à ignorer lors de la
// propagation de couleur.
const DECORATIVE_STYLES = ["stateIcon", "bpmnIcon", "bpmnBadge"];

// Applique une couleur à une cellule unique (edge: trait+flèche, vertex: remplissage,
// avec propagation aux enfants non-colorés pour une lane). Factorisé pour être appelé
// une fois par cellule ciblée par l'action "color", que la sélection soit simple ou
// multiple (voir handlers["color"] ci-dessous).
function applyColorToCell(graph: Graph, cell: Cell, color: string): void {
    if (cell.style?.baseStyleNames?.includes("stateIcon") ||
        cell.style?.baseStyleNames?.includes("bpmnBadge")) {
        // The icon is selected, not the vertex itself.
        if (cell.parent != null) cell = cell.parent;
    }

    if (cell.isEdge()) {
        // Edge → couleur du trait
        graph.setCellStyles("strokeColor", color, [cell]);
        // Couleur des flèches
        graph.setCellStyles("endFill", true, [cell]);
        graph.setCellStyles("endStrokeColor", color, [cell]);
    } else {
        graph.setCellStyles("fillColor", color, [cell]);
        if (isLaneVertex(graph, cell)) {
            // "fillColor" ne peint que le bandeau de titre d'une lane (shape
            // "swimlane" de maxgraph) : il faut aussi "swimlaneFillColor" pour
            // couvrir tout son contenu, et propager aux enfants qui n'ont pas
            // leur propre couleur.
            graph.setCellStyles("swimlaneFillColor", color, [cell]);
            applyFillToUncoloredChildren(graph, cell, color);
        }
    }
}

// Propage une couleur de remplissage aux enfants d'une lane qui n'ont pas leur propre
// couleur définie (cell.style.fillColor absent = jamais coloré explicitement, ni par
// l'import BPMN ni par une action de recoloration précédente). Un enfant qui a déjà sa
// propre couleur la conserve et délimite sa propre portée : on ne descend pas plus bas
// dans ses propres enfants.
function applyFillToUncoloredChildren(graph: Graph, cell: Cell, color: string): void {
    for (const child of cell.getChildren()) {
        const names: string[] = child.style?.baseStyleNames ?? [];
        if (DECORATIVE_STYLES.some((n) => names.includes(n))) continue;
        if (child.style?.fillColor) continue;

        graph.setCellStyles("fillColor", color, [child]);
        if (isLaneVertex(graph, child)) {
            graph.setCellStyles("swimlaneFillColor", color, [child]);
        }
        applyFillToUncoloredChildren(graph, child, color);
    }
}

// Aligne une liste de sommets (les arêtes n'ont pas de position propre à
// aligner — voir le filtre `isVertex()` dans handlers["align"] ci-dessous)
// sur un bord/axe commun, calculé à partir de leur propre boîte englobante
// (min/max, pas la moyenne) — comportement standard "align" des éditeurs
// graphiques. Utilise directement les coordonnées de géométrie (espace
// graphe, indépendant du zoom/pan), comme le fait déjà le déplacement au
// clavier (bpmn-edit.ts) plutôt que graph.view.getState() qui est en
// coordonnées écran.
function applyAlignToCells(graph: Graph, cells: Cell[], align: AlignMode): void {
    const entries = cells
        .filter((c) => c.isVertex())
        .map((c) => ({cell: c, geo: c.getGeometry()}))
        .filter((e): e is { cell: Cell; geo: NonNullable<ReturnType<Cell["getGeometry"]>> } => !!e.geo);

    if (entries.length < 2) return;

    const horizontal = align === "left" || align === "center" || align === "right";
    const edges = entries.map(({geo}) =>
        horizontal ? [geo.x, geo.x + geo.width] : [geo.y, geo.y + geo.height]
    );
    const min = Math.min(...edges.map((e) => e[0]));
    const max = Math.max(...edges.map((e) => e[1]));
    const target = align === "left" || align === "top"
        ? min
        : align === "right" || align === "bottom"
            ? max
            : (min + max) / 2; // center / middle

    graph.model.beginUpdate();
    try {
        for (const {cell, geo} of entries) {
            const next = geo.clone();
            switch (align) {
                case "left": next.x = target; break;
                case "right": next.x = target - geo.width; break;
                case "center": next.x = target - geo.width / 2; break;
                case "top": next.y = target; break;
                case "bottom": next.y = target - geo.height; break;
                case "middle": next.y = target - geo.height / 2; break;
            }
            graph.model.setGeometry(cell, next);
        }
    } finally {
        graph.model.endUpdate();
    }
}

export function makeDefaultHandlers(): Record<VertexActionId, VertexActionHandler> {
    return {
        "delete": ({graph, cell, cells}) => {
            const targets = cells && cells.length > 0 ? cells : [cell];
            graph.model.beginUpdate();
            try {
                graph.removeCells(targets, true);
            } finally {
                graph.model.endUpdate();
            }
        },
        "align": ({graph, cell, cells, menuEl}) => {
            const btn = menuEl.closest<HTMLElement>("[data-align]");
            const align = btn?.dataset.align as AlignMode | undefined;
            if (!align) return;

            const targets = cells && cells.length > 0 ? cells : [cell];
            applyAlignToCells(graph, targets, align);
        },
        "connect": ({graph, cell, menuEl}) => {
            menuEl.classList.add("bpmn-editor-hidden");
            graph.setConnectable(true);

            const ch = ((graph as any).connectionHandler ?? graph.getPlugin("ConnectionHandler")) as any;

            // ✅ on définit le factoryMethod (c’est LUI qui est utilisé pour créer l’edge)
            const prevFactory = ch.factoryMethod;

            ch.factoryMethod = (source: any, target: any, _styleFromPreview?: any) => {
                const edge = addBPMNConnection(graph, source, target);
                return edge;
            };

            // Restore après UNE connexion : sans ce reset, graph.setConnectable(true) reste
            // actif pour le reste de la session et permet un glisser-connecter natif qui ne
            // passe pas par addBPMNConnection/resolveConnectable (voir bpmn-helpers.ts).
            const restore = () => {
                ch.factoryMethod = prevFactory;
                graph.setConnectable(false);
                ch.removeListener?.(restoreListener);
            };
            const restoreListener = () => restore();
            ch.addListener?.(InternalEvent.CONNECT, restoreListener);
            ch.addListener?.(InternalEvent.RESET, restoreListener); // reset si annulation

            const state = graph.view.getState(cell as any);
            if (!state) return;

            ch.start(state, state.x + state.width, state.y + state.height / 2);
        },


        "color": ({graph, cell, cells, menuEl}) => {
            const swatch = menuEl.closest<HTMLElement>("[data-color]");
            const color = swatch?.dataset.color;
            const targets = cells && cells.length > 0 ? cells : [cell];
            if (!color || targets.length === 0) return;

            const model = graph.model;

            model.beginUpdate();
            try {
                for (const target of targets) {
                    applyColorToCell(graph, target, color);
                }
            } finally {
                model.endUpdate();
            }

        },
        "add-task": ({graph, undoManager, parent, cell, menuEl, event}) => {

            if (!event) return;

            const model = graph.getDataModel ? graph.getDataModel() : graph.model;
            model.beginUpdate();
            try {
                // disable selection
                graph.clearSelection();

                const p = graph.getPointForEvent(event);

                const vertex = addBPMNTask(graph, parent, p.x, p.y);

                addBPMNConnection(graph, cell, vertex);

                startPlaceVertexFollowMouse({graph, undoManager, cell: vertex, container: graph.container});

                menuEl.classList.add("bpmn-editor-hidden");
            } finally {
                model.endUpdate();
            }
        },

        "add-state": ({graph, undoManager, parent, cell, menuEl, event}) => {
            if (!event) return;

            const model = graph.getDataModel ? graph.getDataModel() : graph.model;
            model.beginUpdate();
            try {
                // disable selection
                graph.clearSelection();

                const p = graph.getPointForEvent(event);

                const vertex = addBPMNState(graph, parent, p.x, p.y);

                addBPMNConnection(graph, cell, vertex);

                startPlaceVertexFollowMouse(
                    {graph, undoManager, cell: vertex, container: graph.container});
                menuEl.classList.add("bpmn-editor-hidden");
            } finally {
                model.endUpdate();
            }
        },

        "add-gateway": ({graph, undoManager, parent, cell, menuEl, event}) => {
            if (!event) return;

            const model = graph.getDataModel ? graph.getDataModel() : graph.model;
            model.beginUpdate();
            try {
                const p = graph.getPointForEvent(event);

                // disable selection
                graph.clearSelection();

                const vertex = addBPMNGateway(graph, parent, p.x, p.y)

                addBPMNConnection(graph, cell, vertex);

                startPlaceVertexFollowMouse(
                    {graph, undoManager, cell: vertex, container: graph.container});
                menuEl.classList.add("bpmn-editor-hidden");
            } finally {
                model.endUpdate();
            }
        },
        "add-annotations": ({graph, undoManager, parent, cell, menuEl, event}) => {
            if (!event) return;

            const model = graph.getDataModel ? graph.getDataModel() : graph.model;
            model.beginUpdate();
            try {
                const pt = graph.getPointForEvent(event);

                // disable selection
                graph.clearSelection();

                const vertex = addBPMNAnnotation(graph, parent, pt.x, pt.y);

                const edge = addBPMNConnection(graph, cell, vertex);
                edge.style.baseStyleNames = ["bpmn-edge"];

                startPlaceVertexFollowMouse(
                    {graph, undoManager, cell: vertex, container: graph.container});
                menuEl.classList.add("bpmn-editor-hidden");
            } finally {
                model.endUpdate();
            }
        },
        "search": () => { /* noop — feature not implemented */
        },
        "rotate": ({graph, cell, menuEl}) => {
            graph.model.beginUpdate();
            try {
                if (cell.style.horizontal)
                    graph.setCellStyles("horizontal", false, [cell]);
                else
                    graph.setCellStyles("horizontal", true, [cell]);
            } finally {
                graph.model.endUpdate();
            }

            menuEl.classList.add("bpmn-editor-hidden");
        },
    };
}
