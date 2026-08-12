import { Cell, Graph, Point } from "@maxgraph/core";
import { BPMN_ICONS } from "./bpmn-icons";

// ── Lookup helpers ─────────────────────────────────────────────────────────────

function findBadge(cell: Cell): Cell | null {
    for (const child of cell.getChildren()) {
        if (child.getStyle?.()?.baseStyleNames?.includes?.("bpmnBadge"))
            return child;
    }
    return null;
}

function getOrCreateBadge(graph: Graph, cell: Cell): Cell {
    const existing = findBadge(cell);
    if (existing) return existing;

    let badge: Cell | null = null;

    graph.batchUpdate(() => {
        badge = graph.insertVertex({
            parent:   cell,
            position: [0, 0],
            size:     [30, 28],
            style:    { baseStyleNames: ["bpmnBadge"] },
        });

        const g = badge.getGeometry();
        if (g) {
            g.relative = true;
            g.x        = 0.5;
            g.y        = 1;
            g.offset   = new Point(-15, -28);
            badge.setGeometry(g);
        }

        badge.setConnectable(false);
    });

    if (!badge) throw new Error("Failed to create badge");
    return badge;
}

// ── Value management ───────────────────────────────────────────────────────────

function buildBadgeValue(current: string, glyph: string): string {
    if (glyph === "") return "";

    const hasSub = current.includes(BPMN_ICONS.SUB_PROCESS_ACTIVITY);
    const isSub  = glyph === BPMN_ICONS.SUB_PROCESS_ACTIVITY;

    if (isSub)  return hasSub ? current : current + glyph;
    return hasSub ? glyph + BPMN_ICONS.SUB_PROCESS_ACTIVITY : glyph;
}

function setBadgeValue(graph: Graph, cell: Cell, glyph: string): void {
    const badge    = getOrCreateBadge(graph, cell);
    const newValue = buildBadgeValue(String(badge.value ?? ""), glyph);

    graph.batchUpdate(() => {
        badge.setValue(newValue);
        graph.refresh(badge);
    });
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function removeBottomCenterBadge(graph: Graph, parentVertex: Cell): void {
    const child = findBadge(parentVertex);
    if (!child) return;
    graph.batchUpdate(() => graph.removeCells([child], true));
}

export function setSubProcessMarker(graph: Graph, cell: Cell): void {
    setBadgeValue(graph, cell, BPMN_ICONS.SUB_PROCESS_ACTIVITY);
}
export function hasSubProcessMarker(_graph: Graph, cell: Cell): boolean {
    return findBadge(cell)?.value?.includes(BPMN_ICONS.SUB_PROCESS_ACTIVITY) ?? false;
}

export function setSequentialMarker(graph: Graph, cell: Cell): void {
    setBadgeValue(graph, cell, BPMN_ICONS.SEQUENTIAL_MARKER);
}
export function hasSequentialMarker(_graph: Graph, cell: Cell): boolean {
    return findBadge(cell)?.value?.includes(BPMN_ICONS.SEQUENTIAL_MARKER) ?? false;
}

export function setParallelMarker(graph: Graph, cell: Cell): void {
    setBadgeValue(graph, cell, BPMN_ICONS.PARALLEL_MARKER);
}
export function hasParallelMarker(_graph: Graph, cell: Cell): boolean {
    return findBadge(cell)?.value?.includes(BPMN_ICONS.PARALLEL_MARKER) ?? false;
}

export function setLoopMarker(graph: Graph, cell: Cell): void {
    setBadgeValue(graph, cell, BPMN_ICONS.LOOP_MARKER);
}
export function hasLoopMarker(_graph: Graph, cell: Cell): boolean {
    return findBadge(cell)?.value?.includes(BPMN_ICONS.LOOP_MARKER) ?? false;
}

export function setAdHocMarker(graph: Graph, cell: Cell): void {
    setBadgeValue(graph, cell, BPMN_ICONS.AD_HOC_MARKER);
}
export function hasAdHocMarker(_graph: Graph, cell: Cell): boolean {
    return findBadge(cell)?.value?.includes(BPMN_ICONS.AD_HOC_MARKER) ?? false;
}

export function setCompensationMarker(graph: Graph, cell: Cell): void {
    setBadgeValue(graph, cell, BPMN_ICONS.COMPENSATION_MARKER);
}
export function hasCompensationMarker(_graph: Graph, cell: Cell): boolean {
    return findBadge(cell)?.value?.includes(BPMN_ICONS.COMPENSATION_MARKER) ?? false;
}
