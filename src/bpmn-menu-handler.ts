// src/bpmn-menu-handlers.ts
import {Cell, Graph, InternalEvent} from "@maxgraph/core";
import type {VertexActionHandler, VertexActionId} from "./bpmn-menu";
import {startPlaceVertexFollowMouse} from "./bpmn-menu-placement";
import {addBPMNAnnotation, addBPMNConnection, addBPMNGateway, addBPMNState, addBPMNTask, isLaneVertex} from "./bpmn-helpers";

// Décoratifs (icône/badge) : pas de rôle de remplissage propre, à ignorer lors de la
// propagation de couleur.
const DECORATIVE_STYLES = ["stateIcon", "bpmnIcon", "bpmnBadge"];

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

export function makeDefaultHandlers(): Record<VertexActionId, VertexActionHandler> {
    return {
        "delete": ({graph, cell}) => {
            graph.model.beginUpdate();
            try {
                graph.removeCells([cell], true);
            } finally {
                graph.model.endUpdate();
            }
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

            // (optionnel mais conseillé) restore après UNE connexion
            const restore = () => {
                ch.factoryMethod = prevFactory;
                ch.removeListener?.(restoreListener);
            };
            const restoreListener = () => restore();
            ch.addListener?.(InternalEvent.CONNECT, restoreListener);
            ch.addListener?.(InternalEvent.RESET, restoreListener); // reset si annulation

            const state = graph.view.getState(cell as any);
            if (!state) return;

            ch.start(state, state.x + state.width, state.y + state.height / 2);
        },


        "color": ({graph, cell, menuEl}) => {
            const swatch = menuEl.closest<HTMLElement>("[data-color]");
            const color = swatch?.dataset.color;
            if (!color || !cell) return;

            const model = graph.model;

            model.beginUpdate();
            try {
                if (cell.isEdge()) {
                    // Edge → couleur du trait
                    graph.setCellStyles("strokeColor", color, [cell]);
                    // Couleur des flèches
                    graph.setCellStyles("endFill", true, [cell]);
                    graph.setCellStyles("endStrokeColor", color, [cell]);
                } else {
                    // console.log("Colorize ",cell, color)
                    if (cell.style.baseStyleNames?.includes("stateIcon") ||
                        cell.style.baseStyleNames?.includes("bpmnBadge")) {
                        // The icon is selected, not the vertex itself.
                        if (cell.parent != null)
                            cell = cell.parent;
                    }
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
