// src/bpmn-helpers.ts
import { Cell, Graph } from "@maxgraph/core";
import { BPMN_ICONS } from "./bpmn-icons";
import { setAnnotationArrow, setConversationFlow } from "./bpmn-arrows";

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
    // Reste connectable (pas de setConnectable(false)) : ConnectionHandlerCellMarker.getCell()
    // (maxgraph) exclut tout cell non-connectable du hit-test SANS jamais retomber sur son
    // parent — son "Uses connectable parent vertex if one exists" lit connectionHandler.cell,
    // une propriété que maxgraph n'assigne jamais nulle part (toujours null), donc mort. Comme
    // cette icône recouvre entièrement l'état (voir DECORATIVE_STYLES), la rendre non-connectable
    // annule silencieusement tout clic dessus pendant un geste "connect" (bpmn-menu-handler.ts) :
    // la prévisualisation d'arête disparaît au lieu de se terminer. resolveConnectable()
    // ci-dessous redirige de toute façon l'arête créée vers le parent, donc la laisser
    // connectable ne fait courir aucun risque de pointer une arête sur l'icône elle-même.
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
        // fontSize explicite : conserve la taille d'origine du glyphe losange, qui n'a
        // pas besoin du même correctif que "stateIcon" (voir son commentaire) puisque le
        // gateway n'est pas concerné par le bug de déplacement rapporté.
        style:    { baseStyleNames: ["stateIcon"], fontSize: 50 },
    });
    // Reste connectable — voir le commentaire équivalent dans addBPMNState ci-dessus,
    // même icône ("stateIcon") et même bug maxgraph.

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

// Data object (BPMN "Data") — Datastore/Data input/Data output sont la même
// cellule, juste avec baseStyleNames/icône différents, voir setDatabaseVertex/
// setInputDataVertex/setOutputDataVertex ci-dessous.
export function addBPMNData(graph: Graph, parent: Cell, x: number, y: number): Cell {
    const vertex = graph.insertVertex({
        parent,
        value:    "",
        position: [x, y],
        size:     [60, 80],
        style:    { baseStyleNames: ["data"] },
    });

    graph.insertVertex({
        parent: vertex,
        value:  "",
        position: [0, 0],
        size:     [26, 26],
        style:    { baseStyleNames: ["bpmnIcon"] },
    });

    return vertex;
}

export function addBPMNConversation(graph: Graph, parent: Cell, x: number, y: number): Cell {
    return graph.insertVertex({
        parent,
        value:    '',
        position: [x, y],
        size:     [40, 40],
        style:    { baseStyleNames: ['conversation'] },
    });
}

export interface AddBPMNLaneOptions {
    id?: string;
    value?: string;
    x: number;
    y: number;
    width: number;
    height: number;
    /**
     * Largeur du bandeau de titre (style "startSize"). À fournir quand la lane contient
     * elle-même des sous-lanes, calculée comme le décalage réel de la première sous-lane
     * par rapport à ce conteneur — sinon un espace vide apparaît entre le titre (dessiné à
     * la largeur par défaut du style "lane") et le début des sous-lanes. Omis : le style
     * par défaut s'applique.
     *
     * `0` doit être posé explicitement (pas juste "omis") : le style "lane" a un
     * startSize par défaut de 40 (voir graph-styles.ts), et laisser ce défaut en place
     * alors que l'appelant a calculé un titleSize de 0 désynchronise la zone de
     * confinement que maxgraph calcule pour les enfants (Graph.getCellContainmentArea,
     * basée sur le startSize RÉEL du parent) de la géométrie qu'on vient de poser — son
     * Graph.constrainChild (déclenché automatiquement par insertVertex) décale et
     * rétrécit alors la lane vers cette zone pour la faire rentrer dedans.
     */
    titleSize?: number;
    /**
     * Orientation BPMN DI du pool/lane (attribut `isHorizontal` de son
     * BPMNShape) — PAS le style maxGraph "horizontal" du style nommé "lane" :
     * les deux ont un sens opposé. Un pool BPMN "isHorizontal" (le cas
     * courant/par défaut, lanes empilées en bandes horizontales) affiche son
     * bandeau de titre à la VERTICALE sur le côté gauche, ce qui correspond à
     * `horizontal: false` côté SwimlaneShape maxGraph (voir laneStyle dans
     * graph-styles.ts) ; `isHorizontal: false` (pool vertical, rare — lanes en
     * colonnes) affiche son titre à l'HORIZONTALE en haut, soit
     * `horizontal: true`. Omis : le style par défaut du style nommé "lane"
     * s'applique (`horizontal: false`, donc équivalent à `isHorizontal: true`).
     */
    isHorizontal?: boolean;
}

export function addBPMNLane(graph: Graph, parent: Cell, options: AddBPMNLaneOptions): Cell {
    const { id, value, x, y, width, height, titleSize, isHorizontal } = options;
    const vertex = graph.insertVertex({
        parent,
        value: value ?? '',
        id,
        position: [x, y],
        size:     [width, height],
        style:    { baseStyleNames: ["lane"] },
    });

    if (titleSize !== undefined) {
        graph.setCellStyles("startSize", titleSize, [vertex]);
    }

    if (isHorizontal !== undefined) {
        graph.setCellStyles("horizontal", !isHorizontal, [vertex]);
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

// Icône/badge interne (voir addBPMNState/bpmn-badge.ts) : recouvre entièrement
// son sommet parent, donc le hit-test de ConnectionHandler lors d'un
// glisser-déposer l'attrape aussi bien comme source que comme cible — sans ce
// recentrage, l'arête créée pointerait sur une cellule sans BpmnMeta propre,
// que bpmn-export.ts rejette ensuite comme orpheline hors du modèle (même
// correctif que resolveMenuCell dans bpmn-menu-init.ts, mais nécessaire ici
// aussi car ConnectionHandler résout sa cible indépendamment du menu).
export const DECORATIVE_STYLES = ["stateIcon", "bpmnIcon", "bpmnBadge"];

export function resolveConnectable(cell: Cell): Cell {
    const names: string[] = (cell?.style as any)?.baseStyleNames ?? [];
    if (DECORATIVE_STYLES.some((n) => names.includes(n)) && cell.parent) {
        return cell.parent as Cell;
    }
    return cell;
}

export function addBPMNConnection(graph: Graph, source: Cell, target: Cell): Cell {
    source = resolveConnectable(source);
    target = resolveConnectable(target);

    const edge = graph.insertEdge({
        parent: graph.getDefaultParent(),
        source,
        target,
        style:  { baseStyleNames: ["bpmn-edge"] },
    });

    // Un lien touchant une annotation reste en pointillé même quand l'autre
    // extrémité est une conversation — ce cas prime sur le double-trait
    // habituel des liens de conversation (voir setConversationFlow).
    if (isAnnotationVertex(graph, source) || isAnnotationVertex(graph, target))
        setAnnotationArrow(graph, edge);
    else if (isConversationVertex(graph, source) || isConversationVertex(graph, target))
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
export const isAnnotationVertex   = (_graph: Graph, cell: Cell): boolean => !!cell && cellHasBaseStyle(cell, "annotation");
export const isDataVertex         = (_graph: Graph, cell: Cell): boolean =>
    !!cell && (cellHasBaseStyle(cell, "data") || cellHasBaseStyle(cell, "database"));

// ── Icon helpers ───────────────────────────────────────────────────────────────

export function findIconChild(cell: Cell): Cell | null {
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

// Call activity / Transaction : variantes de bordure d'un "process" normal,
// pas d'icône ni de baseStyleNames dédiés (elle reste un isProcessVertex, au
// contraire de setDatabaseVertex/setDataVertex ci-dessus qui changent de
// famille de style). "call-activity" = bordure 4px ; "transaction" = double
// bordure (voir BpmnDoubleBorderRectangleShape dans bpmn-shapes.ts), chacune
// avec un trait fin de 1px. resetActivityBorder ramène un cell à la bordure
// simple par défaut (2px) avant d'appliquer un autre type — nécessaire
// puisque ces deux styles écrivent des overrides par-cellule qui, sinon,
// survivraient à un changement de type depuis le menu contextuel.
export function setCallActivityVertex(graph: Graph, cell: Cell): void {
    graph.batchUpdate(() => {
        graph.setCellStyles("shape", "rectangle", [cell]);
        graph.setCellStyles("strokeWidth", "4", [cell]);
    });
}

export function setTransactionVertex(graph: Graph, cell: Cell): void {
    graph.batchUpdate(() => {
        graph.setCellStyles("shape", "bpmnTransactionShape", [cell]);
        graph.setCellStyles("strokeWidth", "1", [cell]);
    });
}

export function resetActivityBorder(graph: Graph, cell: Cell): void {
    graph.batchUpdate(() => {
        graph.setCellStyles("shape", "rectangle", [cell]);
        graph.setCellStyles("strokeWidth", "2", [cell]);
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

// ── Vue ──────────────────────────────────────────────────────────────────────

/**
 * Centre le contenu de `graph` dans son conteneur — remplace Graph.center()
 * de maxgraph, qui décentre au lieu de centrer dès que le conteneur a
 * `overflow: auto` (le cas de .bpmn-editor-canvas, voir ui/dom.ts — requis
 * pour le pan/scroll interactif) ET que le contenu dépasse, même de
 * quelques pixels, la taille du conteneur : sa branche "hasScrollbars" met
 * alors le delta de centrage à zéro et compte sur container.scrollLeft/Top à
 * la place, qui ne déplace quasiment rien pour un dépassement de l'ordre du
 * pixel — vérifié empiriquement contre le source de
 * AbstractGraph.center() (constaté sur un diagramme Mercator réel dont le
 * rendu se retrouvait plaqué contre le bord gauche/haut au lieu d'être
 * centré). Reproduit sans condition la branche "pas de scrollbars" de
 * center(), la seule des deux qui centre proportionnellement.
 */
export function centerGraphView(graph: Graph): void {
    const bounds = graph.getGraphBounds();
    if (!bounds) return;

    const container = graph.container;
    const scale = graph.view.scale || 1;
    const padding = 2 * graph.getBorder();
    const dx = container.clientWidth - padding - bounds.width;
    const dy = container.clientHeight - padding - bounds.height;
    const t = graph.view.translate;

    graph.view.setTranslate(
        Math.floor(t.x - bounds.x / scale + dx / (2 * scale)),
        Math.floor(t.y - bounds.y / scale + dy / (2 * scale))
    );
}
