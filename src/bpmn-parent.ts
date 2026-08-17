// src/bpmn-parent.ts
// =============================================
// Gestion du drop sur un parent activities

import {Graph, InternalEvent, Point} from "@maxgraph/core";

type AnyGraph = any;
type AnyCell = any;

const isGroup = (cell: AnyCell): boolean => {
    if (!cell) return false;

    const st = cell?.style;
    const bs = st?.baseStyleNames;
    return bs?.includes("activities") || bs?.includes("lane");
};

export function findGroupUnderMouse(graph: Graph, pt: Point): AnyCell | null  {
    // Cell sous le pointeur
    let under: AnyCell | null =
        typeof graph.getCellAt === "function" ? graph.getCellAt(pt.x-1, pt.y-1) : null;
    // Important : parfois "under" est un enfant interne / ou même une des cells déplacées
    // -> on remonte la hiérarchie jusqu’à trouver un parent activities
    while (under) {
        if (isGroup(under)) {
            return under;
        }
        under = typeof under.getParent === "function" ? under.getParent() : under.parent;
    }

    return null;
}


export function installDropInActivitiesParent(graph: AnyGraph): () => void {
    let reparenting = false;

    const onMoveCells = (_sender: any, e: any) => {
        if (reparenting) return;

        const evt: MouseEvent | null = e.getProperty?.("event") ?? null;
        const cells: AnyCell[] = e.getProperty?.("cells") ?? [];

        if (!evt || !cells.length) return;

        // Ce reparentage n'a de sens que pour un élément de flux (tâche/event/
        // gateway/...) déposé DANS une lane/activities — jamais pour la lane (ou le
        // groupe activities) elle-même en train d'être déplacée/réordonnée : sans ce
        // garde-fou, glisser une lane dont le pointeur survole une autre lane (ou se
        // retrouve, en fin de glissé, au-dessus d'elle-même) la reparente sous ce
        // groupe, désynchronisant sa géométrie de ses propres enfants (qui, eux, ne
        // bougent pas) — la lane et son contenu semblent alors se disloquer au lieu
        // de se déplacer ensemble.
        if (cells.some(isGroup)) return;

        const target = findGroupUnderMouse(graph, graph.getPointForEvent(evt));
        if (!target) return;

        // Si déjà au bon parent, rien à faire
        const curParent =
            typeof cells[0].getParent === "function" ? cells[0].getParent() : cells[0].parent;
        if (curParent === target) return;

        reparenting = true;
        try {
            graph.batchUpdate(() => {
                // dx=0 dy=0, clone=false, target=activities
                graph.moveCells(cells, 0, 0, false, target, evt);
            });
        } finally {
            reparenting = false;
        }
    };

    graph.addListener(InternalEvent.MOVE_CELLS, onMoveCells);
    return () => graph.removeListener(onMoveCells);
}
