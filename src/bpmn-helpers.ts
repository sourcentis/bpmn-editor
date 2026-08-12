// src/bpmn-helpers.ts
import { Cell, Graph } from "@maxgraph/core";
import { BPMN_ICONS } from "./bpmn-icons";
import { setConversationFlow } from "./bpmn-arrows";

// ── BPMN element factories ─────────────────────────────────────────────────────

export function addBPMNState(graph: Graph, parent: Cell, x: number, y: number): Cell {
    const vertex = graph.insertVertex({
        parent,
        value:    "",
        position: [x, y],
        size:     [40, 40],
        style:    { baseStyleNames: ["state"] },
    });

    const icon = graph.insertVertex({
        parent: vertex,
        value:  BPMN_ICONS.START_EVENT,
        position: [0, 0],
        size:     [40, 40],
        style:    { baseStyleNames: ["stateIcon"] },
    });

    const g = icon.getGeometry();
    if (g) {
        g.relative = true;
        g.x        = 0.5;
        g.y        = 0.5;
        g.offset   = { x: -20, y: -20 } as any;
        icon.setGeometry(g);
    }
    return vertex;
}

export function addBPMNTask(graph: Graph, parent: Cell, x: number, y: number): Cell {
    const vertex = graph.insertVertex({
        parent,
        value:    "",
        position: [x, y],
        size:     [100, 80],
        style:    { baseStyleNames: ["process"] },
    });

    const icon = graph.insertVertex({
        parent: vertex,
        value:  "",
        position: [0, 0],
        size:     [26, 26],
        style:    { baseStyleNames: ["bpmnIcon"] },
    });

    const g = icon.getGeometry();
    if (g) {
        g.relative = true;
        g.x        = 0;
        g.y        = 0;
        g.offset   = { x: 0, y: -2 } as any;
        icon.setGeometry(g);
    }

    return vertex;
}

export function addBPMNGateway(graph: Graph, parent: Cell, x: number, y: number): Cell {
    const vertex = graph.insertVertex({
        parent,
        value:    '',
        position: [x, y],
        size:     [40, 40],
        style:    { baseStyleNames: ['gateway'] },
    });

    const icon = graph.insertVertex({
        parent: vertex,
        value:  BPMN_ICONS.GATEWAY,
        position: [0, 0],
        size:     [45, 45],
        style:    { baseStyleNames: ["stateIcon"] },
    });

    const g = icon.getGeometry();
    if (g) {
        g.relative = true;
        g.x        = 0.5;
        g.y        = 0.5;
        g.offset   = { x: -23, y: -23 } as any;
        icon.setGeometry(g);
    }

    return vertex;
}

export function addBPMNAnnotation(graph: Graph, parent: Cell, x: number, y: number): Cell {
    const vertex = graph.insertVertex({
        parent,
        value:    "",
        position: [x, y],
        size:     [100, 80],
        style:    { baseStyleNames: ["annotation"] },
    });

    graph.setCellStyles("fillColor", "#FFFFFF", [vertex]);

    return vertex;
}

export function addBPMNConnection(graph: Graph, source: Cell, target: Cell): Cell {
    const edge = graph.insertEdge({
        parent: graph.getDefaultParent(),
        source,
        target,
        style:  { baseStyleNames: ["bpmn-edge"] },
    });

    if (isConversationVertex(graph, source) || isConversationVertex(graph, target))
        setConversationFlow(graph, edge);

    return edge;
}

// ── Vertex type predicates ─────────────────────────────────────────────────────

function cellHasBaseStyle(cell: Cell, baseStyle: string): boolean {
    const s = cell?.style;
    if (s && typeof s === "object" && Array.isArray(s.baseStyleNames))
        return s.baseStyleNames.includes(baseStyle);
    return false;
}

export const isProcessVertex      = (_graph: Graph, cell: Cell): boolean => !!cell && cellHasBaseStyle(cell, "process");
export const isStateVertex        = (_graph: Graph, cell: Cell): boolean => !!cell && cellHasBaseStyle(cell, "state");
export const isGatewayVertex      = (_graph: Graph, cell: Cell): boolean => !!cell && cellHasBaseStyle(cell, "gateway");
export const isActivitiesVertex   = (_graph: Graph, cell: Cell): boolean => !!cell && cellHasBaseStyle(cell, "activities");
export const isLaneVertex         = (_graph: Graph, cell: Cell): boolean => !!cell && cellHasBaseStyle(cell, "lane");
export const isConversationVertex = (_graph: Graph, cell: Cell): boolean => !!cell && cellHasBaseStyle(cell, "conversation");
export const isDataVertex         = (_graph: Graph, cell: Cell): boolean =>
    !!cell && (cellHasBaseStyle(cell, "data") || cellHasBaseStyle(cell, "database"));

// ── Icon helpers ───────────────────────────────────────────────────────────────

function findIconChild(cell: Cell): Cell | null {
    const count = cell.getChildCount();
    for (let i = 0; i < count; i++) {
        const child = cell.getChildAt(i);
        if (!child) continue;
        if (cellHasBaseStyle(child, "bpmnIcon") || cellHasBaseStyle(child, "stateIcon"))
            return child;
    }
    return null;
}

export function setIconCellValue(graph: Graph, processVertex: Cell, value: any): void {
    const iconCell = findIconChild(processVertex);
    if (!iconCell) return;
    graph.batchUpdate(() => graph.model.setValue(iconCell, value));
}

export function setDatabaseVertex(graph: Graph, cell: Cell): void {
    const iconCell = findIconChild(cell);
    if (!iconCell) return;
    const style = cell.getClonedStyle();
    style.baseStyleNames = ["database"];
    graph.batchUpdate(() => {
        graph.setCellStyle(style, [cell]);
        graph.model.setValue(iconCell, "");
    });
}

export function setDataVertex(graph: Graph, cell: Cell): void {
    const iconCell = findIconChild(cell);
    if (!iconCell) return;
    const style = cell.getClonedStyle();
    style.baseStyleNames = ["data"];
    graph.batchUpdate(() => {
        graph.setCellStyle(style, [cell]);
        graph.model.setValue(iconCell, "");
    });
}

export function setInputDataVertex(graph: Graph, cell: Cell): void {
    const iconCell = findIconChild(cell);
    if (!iconCell) return;
    const style = cell.getClonedStyle();
    style.baseStyleNames = ["data"];
    graph.batchUpdate(() => {
        graph.setCellStyle(style, [cell]);
        graph.model.setValue(iconCell, BPMN_ICONS.DATA_INPUT);
    });
}

export function setOutputDataVertex(graph: Graph, cell: Cell): void {
    const iconCell = findIconChild(cell);
    if (!iconCell) return;
    const style = cell.getClonedStyle();
    style.baseStyleNames = ["data"];
    graph.batchUpdate(() => {
        graph.setCellStyle(style, [cell]);
        graph.model.setValue(iconCell, BPMN_ICONS.DATA_OUTPUT);
    });
}
