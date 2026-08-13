// src/ts/bpmn-arrows.ts
import { Cell, Geometry, Graph, InternalEvent, Point } from "@maxgraph/core";

export function setAnnotationArrow(graph: Graph, edge: Cell): void {
    graph.batchUpdate(() => {
        graph.setCellStyles("dashed",      true,                [edge]);
        // Pointillé fin (1/1) plutôt que le tiret par défaut de maxgraph.
        graph.setCellStyles("dashPattern", "1 1",               [edge]);
        graph.setCellStyles("edgeStyle",   "straightEdgeStyle", [edge]);
        graph.setCellStyles("startArrow",  "none",              [edge]);
        graph.setCellStyles("endArrow",    "none",              [edge]);
    });
}

export function setAnnotationDirectionalArrow(graph: Graph, edge: Cell): void {
    graph.batchUpdate(() => {
        graph.setCellStyles("dashed",      true,                [edge]);
        // Pointillé fin (1/1) plutôt que le tiret par défaut de maxgraph.
        graph.setCellStyles("dashPattern", "1 1",               [edge]);
        graph.setCellStyles("edgeStyle",   "straightEdgeStyle", [edge]);
        graph.setCellStyles("startArrow",  "none",              [edge]);
        graph.setCellStyles("endArrow",    "classic",           [edge]);
    });
}

function setOrthogonalArrow(graph: Graph, edge: Cell): void {
    graph.batchUpdate(() => {
        graph.setCellStyles("dashed",     false,                  [edge]);
        graph.setCellStyles("edgeStyle",  "orthogonalEdgeStyle",  [edge]);
        graph.setCellStyles("startArrow", "none",                 [edge]);
        graph.setCellStyles("endArrow",   "classic",              [edge]);
    });
}

export function setMessageFlow(graph: Graph, edge: Cell): void {
    graph.batchUpdate(() => {
        graph.setCellStyles("startArrow",      "bpmnMessage", [edge]);
        graph.setCellStyles("startFill",       "1",           [edge]);
        graph.setCellStyles("startFillColor",  "#FFFFFF",     [edge]);
        graph.setCellStyles("startStrokeColor","#000000",     [edge]);
        graph.setCellStyles("startSize",       "12",          [edge]);
        graph.setCellStyles("endFillColor",    "#000000",     [edge]);
        graph.setCellStyles("dashed",          true,          [edge]);
    });
}

export function setConversationFlow(graph: Graph, edge: Cell): void {
    graph.batchUpdate(() => {
        edge.style.baseStyleNames = ["bpmnConversationLink"];
    });
}

export function setSequenceFlow(graph: Graph, edge: Cell): void {
    graph.batchUpdate(() => {
        graph.setCellStyles("startArrow",      null,      [edge]);
        graph.setCellStyles("startFill",       "0",       [edge]);
        graph.setCellStyles("startFillColor",  "#FFFFFF", [edge]);
        graph.setCellStyles("startStrokeColor","#000000", [edge]);
        graph.setCellStyles("startSize",       "12",      [edge]);
        graph.setCellStyles("strokeColor",     "black",   [edge]);
        graph.setCellStyles("dashed",          false,     [edge]);
        graph.setCellStyles("endFillColor",    "#000000", [edge]);
    });
}

export function setConditionalFlow(graph: Graph, edge: Cell): void {
    graph.batchUpdate(() => {
        graph.setCellStyles("startArrow",      "diamond", [edge]);
        graph.setCellStyles("startFill",       "1",       [edge]);
        graph.setCellStyles("startFillColor",  "#FFFFFF", [edge]);
        graph.setCellStyles("startStrokeColor","#000000", [edge]);
        graph.setCellStyles("startSize",       "1",       [edge]);
        graph.setCellStyles("dashed",          false,     [edge]);
        graph.setCellStyles("endFillColor",    "#FFFFFF", [edge]);
    });
}

export function setDefaultFlow(graph: Graph, edge: Cell): void {
    graph.batchUpdate(() => {
        graph.setCellStyles("startArrow",   "bpmnSlash", [edge]);
        graph.setCellStyles("startSize",    "12",        [edge]);
        graph.setCellStyles("dashed",       false,       [edge]);
        graph.setCellStyles("endFillColor", "#000000",   [edge]);
    });
}

function findEdgeChild(edge: Cell, styleName: string): Cell | null {
    return edge.children?.find(
        child => child.style?.baseStyleNames?.includes(styleName)
    ) ?? null;
}

export function setEventFlow(graph: Graph, edge: Cell, iconValue?: string): void {
    graph.batchUpdate(() => {
        const model = graph.getDataModel();
        const d     = 40;
        const geomAt = (x: number, y: number) => {
            const g = new Geometry(0, 0, d, d);
            g.relative = true;
            g.x = x;
            g.y = y;
            g.offset = { x: -d / 2, y: -d / 2 } as any;
            return g;
        };

        // Style de l'edge
        model.setStyle(edge, { baseStyleNames: ["bpmnEventFlow"] });

        // Cercle blanc (fond)
        let bgCell = findEdgeChild(edge, "bpmnEventCircleBg");
        if (!bgCell) {
            bgCell = new Cell("", geomAt(-1, 0), { baseStyleNames: ["bpmnEventCircleBg"] });
            bgCell.vertex = true;
            model.add(edge, bgCell);
        }

        // Icône (par-dessus le cercle)
        let iconCell = findEdgeChild(edge, "bpmnEventCircleIcon");
        if (iconValue !== undefined) {
            if (!iconCell) {
                iconCell = new Cell(iconValue, geomAt(-1, 0), { baseStyleNames: ["bpmnEventCircleIcon"] });
                iconCell.vertex = true;
                model.add(edge, iconCell);
            } else {
                model.setValue(iconCell, iconValue);
            }
        } else if (iconCell) {
            model.remove(iconCell);
        }

        graph.orderCells(false, [edge]);
    });
}

function getEdgeTerminal(edge: any, source: boolean): any {
    return source ? edge?.source : edge?.target;
}

function hasStyle(cell: any, ...names: string[]): boolean {
    const baseNames: string[] = cell?.style?.baseStyleNames ?? [];
    return names.some(n => baseNames.includes(n));
}

export function installEdgeRules(graph: Graph): () => void {
    const onCellConnected = (_sender: any, evt: any) => {
        const edge = evt.getProperty?.("edge") ?? evt.getProperty?.("cell");
        if (!edge) return;

        const src  = getEdgeTerminal(edge, true);
        const dest = getEdgeTerminal(edge, false);
        if (!src || !dest) return;

        if (hasStyle(src, "data", "database") || hasStyle(dest, "data", "database")) {
            setAnnotationDirectionalArrow(graph, edge);
        } else if (hasStyle(src, "bpmnDataObject", "annotation") || hasStyle(dest, "bpmnDataObject", "annotation")) {
            setAnnotationArrow(graph, edge);
        } else {
            setOrthogonalArrow(graph, edge);
        }

        graph.orderCells(true, [edge]);
    };

    graph.addListener(InternalEvent.CELL_CONNECTED, onCellConnected);
    return () => graph.removeListener(onCellConnected);
}
