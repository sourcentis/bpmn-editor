// src/bpmn-menu.ts

import type {Graph, Cell, UndoManager} from "@maxgraph/core";

export type VertexActionId =
    | "delete"
    | "connect"
    | "color"
    | "align"
    | "add-state"
    | "add-task"
    | "add-gateway"
    | "add-annotations"
    | "search"
    | "rotate"
;

// The six alignment directions offered by the "align" submenu — two rows of
// three (left/center/right, then top/middle/bottom), each applied to every
// vertex among ActionContext.cells (edges are skipped, see
// handlers["align"] in bpmn-menu-handler.ts).
export type AlignMode = "left" | "center" | "right" | "top" | "middle" | "bottom";

export interface ActionContext {
    graph: Graph;
    undoManager: UndoManager;
    cell: Cell;
    /**
     * All resolved cells targeted by this action, when more than one cell is
     * selected (multi-selection). Only "color" and "delete" are reachable
     * with more than one cell — every other action requires a single
     * selection. Absent (or a single-element array) outside multi-selection;
     * handlers that don't special-case it can safely keep using `cell`.
     */
    cells?: Cell[];
    parent: Cell;
    menuEl: HTMLElement;
    event?: MouseEvent;
}

export type VertexActionHandler = (ctx: ActionContext) => void;

export interface VertexMenuController {
    destroy(): void;
    getCurrentCell(): Cell | null;
    showForCell(cell: Cell): void;
    hide(): void;
}
