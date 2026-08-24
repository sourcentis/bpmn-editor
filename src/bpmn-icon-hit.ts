// src/bpmn-icon-hit.ts
// =============================================
// Empêche les icônes décoratives ("stateIcon"/"bpmnIcon"/"bpmnBadge") de
// capter les clics destinés à l'objet qu'elles recouvrent.

import { Cell, Graph, InternalEvent } from "@maxgraph/core";

const DECORATIVE_ICON_STYLES = ["stateIcon", "bpmnIcon", "bpmnBadge"];

function isDecorativeIcon(cell: Cell): boolean {
    const names = cell.getStyle()?.baseStyleNames;
    return !!names && DECORATIVE_ICON_STYLES.some((n) => names.includes(n));
}

function getAllCellsRecursive(cell: Cell, cells: Cell[] = []): Cell[] {
    for (const child of cell.getChildren() ?? []) {
        cells.push(child);
        getAllCellsRecursive(child, cells);
    }
    return cells;
}

// `pointerEvents: false` (graph-styles.ts) ne désactive les événements
// souris QUE sur la forme (fill/stroke) de la cellule — jamais sur son
// label. maxgraph rend le label en HTML (setHtmlLabels(true)) et
// TextShape fixe inconditionnellement `pointer-events: all` sur le <div>
// le plus interne, quel que soit le style de la cellule (voir
// TextShape.getHtmlValue) : la valeur "none" posée par ailleurs sur le
// <foreignObject> englobant est donc systématiquement recouverte par ce
// <div>, qui redevient la cible de tout clic.
//
// Pour "stateIcon" (state/gateway), cette icône est dimensionnée pour
// COUVRIR TOUT L'OBJET (voir le commentaire sur stateIconStyle) — la
// quasi-totalité des clics dans le cercle/losange tombe donc sur ce label,
// jamais sur la forme. Tant que l'objet n'est pas encore sélectionné,
// SelectionHandler.getInitialCellForEvent (maxgraph) remonte quand même de
// l'icône (non sélectionnable, cf. isCellSelectable dans bpmn-edit.ts)
// jusqu'à son parent déplaçable — mais cette remontée s'arrête net dès que
// ce parent est DÉJÀ sélectionné (la boucle refuse d'entrer dans un
// ancêtre déjà sélectionné). Résultat observé : un premier clic-glissé
// fonctionne, mais recliquer-glisser un state/gateway déjà sélectionné ne
// fait plus rien — le mousedown atterrit sur l'icône, `movable: false`,
// et SelectionHandler l'avale sans déplacer ni retomber sur le parent.
//
// Correctif : forcer `pointer-events: none` sur le DOM du label de ces
// icônes après chaque (re)rendu, pour que le clic retombe naturellement
// sur la forme sous-jacente — jamais sur les badges eux-mêmes, qui n'ont
// aucune raison d'intercepter la souris.
function disableIconLabelHitTesting(graph: Graph): void {
    for (const cell of getAllCellsRecursive(graph.getDefaultParent())) {
        if (!isDecorativeIcon(cell)) continue;

        const node = graph.getView().getState(cell)?.text?.node as HTMLElement | undefined;
        if (!node) continue;

        node.style.pointerEvents = "none";
        node.querySelectorAll<HTMLElement>("div").forEach((div) => {
            div.style.pointerEvents = "none";
        });
    }
}

export function installIconHitTestFix(graph: Graph): () => void {
    let disposed = false;

    // Différé : au moment où CELLS_ADDED/MOVED/RESIZED est notifié (souvent
    // depuis l'intérieur d'un batch model.beginUpdate()/endUpdate() — voir
    // drawDiagram dans bpmn-import.ts), la vue n'a pas forcément encore
    // validé/recréé le CellState (et son DOM de label) des cellules
    // concernées : `graph.getView().getState(cell)` peut y renvoyer
    // `undefined` pour des icônes qui viennent tout juste d'être ajoutées.
    // Un rAF laisse la validation de la vue (toujours synchrone, mais
    // déclenchée après le batch en cours) se terminer avant qu'on lise les
    // CellState.
    const handler = () => {
        requestAnimationFrame(() => {
            if (!disposed) disableIconLabelHitTesting(graph);
        });
    };

    graph.addListener(InternalEvent.CELLS_ADDED, handler);
    graph.addListener(InternalEvent.CELLS_MOVED, handler);
    graph.addListener(InternalEvent.CELLS_RESIZED, handler);

    return () => {
        disposed = true;
        graph.removeListener(handler);
    };
}
