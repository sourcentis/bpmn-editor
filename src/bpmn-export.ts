// src/bpmn-export.ts
// Export du graphe MaxGraph vers du BPMN 2.0 XML standard (<definitions>,
// <process>/<collaboration>, DI complète). Symétrique à src/bpmn-import.ts :
// la seule cible est ce que parseBPMN()/drawDiagram() relisent — voir le
// commentaire de BpmnMeta dans bpmn-import.ts pour ce que le modèle graphe
// seul ne permet pas de reconstruire (ids d'origine, sous-type exact,
// interrupting/attachedToRef, processRef d'un participant).
import type { Cell, Graph } from '@maxgraph/core';
import { getBpmnMeta, type BpmnMeta } from './bpmn-import';
import { DECORATIVE_STYLES, findIconChild, resolveConnectable } from './bpmn-helpers';
import { BPMN_ICONS } from './bpmn-icons';

// ── Échappement / formatage déterministe ────────────────────────────────────────

function escapeXml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

// Arrondi à 2 décimales : nettoie les résidus d'arithmétique flottante
// accumulés en remontant la chaîne des parents (voir absoluteGeometry), tout
// en restant une fonction pure des valeurs stockées — donc déterministe.
function fmt(n: number): string {
    return String(Math.round(n * 100) / 100);
}

// ── Géométrie absolue ────────────────────────────────────────────────────────────
// Inverse exact du calcul fait à l'import (getAbsolutePosition dans
// bpmn-import.ts) : la position BPMN absolue d'une cellule est la somme de sa
// géométrie propre et de celle de tous ses parents jusqu'au defaultParent —
// aucune compensation supplémentaire (bandeau de titre de lane, etc.), comme
// vérifié en Phase 0 sur le code d'import.
function absoluteGeometry(cell: Cell, defaultParent: Cell): { x: number; y: number; width: number; height: number } {
    const geo: any = cell.getGeometry?.();
    let x = geo?.x ?? 0;
    let y = geo?.y ?? 0;
    const width = geo?.width ?? 0;
    const height = geo?.height ?? 0;
    let p = cell.getParent?.();
    while (p && p !== defaultParent) {
        const pg: any = p.getGeometry?.();
        if (pg) {
            x += pg.x ?? 0;
            y += pg.y ?? 0;
        }
        p = p.getParent?.();
    }
    return { x, y, width, height };
}

// maxgraph reparente automatiquement une arête vers le plus proche ancêtre
// commun de ses deux extrémités dès l'insertion (constaté empiriquement :
// une arête entre deux cellules d'une même lane devient enfant de cette
// lane ; une arête qui traverse deux lanes devient enfant de leur pool
// commun — jamais du defaultParent malgré le `parent` passé à
// addBPMNConnection ; voir aussi reparentEdgeToWaypointLane côté import, qui
// rattache explicitement à une lane une arête inter-lanes dont les points
// intermédiaires y tombent tous). C'est ce que l'import compense déjà via
// son calcul d'offsetX/offsetY (en remontant edge.getParent() jusqu'à
// defaultParent) — on l'inverse ici à l'identique pour les points
// intermédiaires de geometry.points. Pur delta, SANS ajustement de largeur de
// bandeau de titre de lane : une cellule enfant d'une lane est positionnée
// par maxgraph relativement à l'origine ABSOLUE de son parent (bandeau de
// titre inclus), exactement comme absoluteGeometry() ci-dessus pour un
// vertex — un ancien "swimlaneCount*20" ici décalait de 20px par niveau de
// lane les positions recalculées, symétrique du même bug côté import.
function edgeParentOffset(edge: Cell, defaultParent: Cell): { offsetX: number; offsetY: number } {
    let offsetX = 0;
    let offsetY = 0;
    let current = edge.getParent?.();
    while (current && current !== defaultParent) {
        const geo: any = current.getGeometry?.();
        if (geo) {
            offsetX += geo.x ?? 0;
            offsetY += geo.y ?? 0;
        }
        current = current.getParent?.();
    }
    return { offsetX, offsetY };
}

// Waypoints absolus d'une arête. Cas normal : sourcePoint/targetPoint sont
// posés par l'import relatifs à la géométrie absolue de leur cellule
// terminale (indépendants du parent de l'arête) ; les points intermédiaires
// (geometry.points) sont eux relatifs au parent réel de l'arête après le
// reparentage automatique ci-dessus — d'où edgeParentOffset. Repli (arête
// sans géométrie statique, ex. créée à la main sans waypoints d'origine) :
// lit les points résolus par la vue et inverse scale/translate pour revenir
// en coordonnées modèle, indépendantes du zoom/pan courant.
function absoluteWaypoints(graph: Graph, edge: Cell, defaultParent: Cell): { x: number; y: number }[] {
    const geo: any = edge.getGeometry?.();
    const source = edge.getTerminal?.(true) as Cell | null;
    const target = edge.getTerminal?.(false) as Cell | null;

    if (geo?.sourcePoint && geo?.targetPoint && source && target) {
        const sAbs = absoluteGeometry(source, defaultParent);
        const tAbs = absoluteGeometry(target, defaultParent);
        const { offsetX, offsetY } = edgeParentOffset(edge, defaultParent);
        const points: { x: number; y: number }[] = [];
        points.push({ x: sAbs.x + geo.sourcePoint.x, y: sAbs.y + geo.sourcePoint.y });
        for (const p of (geo.points ?? []) as Array<{ x: number; y: number }>) {
            points.push({ x: p.x + offsetX, y: p.y + offsetY });
        }
        points.push({ x: tAbs.x + geo.targetPoint.x, y: tAbs.y + geo.targetPoint.y });
        return points;
    }

    const view: any = graph.getView?.();
    const state = view?.getState?.(edge);
    const pts = state?.absolutePoints;
    if (Array.isArray(pts) && pts.length >= 2) {
        const scale = view.scale ?? 1;
        const tx = view.translate?.x ?? 0;
        const ty = view.translate?.y ?? 0;
        return pts
            .filter((p: any) => p && typeof p.x === 'number')
            .map((p: any) => ({ x: p.x / scale - tx, y: p.y / scale - ty }));
    }
    return [];
}

// ── Couleurs ─────────────────────────────────────────────────────────────────────
// Convention BPMN in Color (color:background-color / color:border-color)
// uniquement — l'import lit les deux conventions (voir readDiagramColors), le
// round-trip visuel est donc garanti même si le fichier d'origine utilisait
// bioc:. On lit le style PROPRE de la cellule (non résolu/fusionné avec le
// style de base), exactement le même objet que applyColors() mute à
// l'import (et que le menu contextuel "Couleur" mute à l'édition) : une
// cellule sans couleur explicite n'a tout simplement pas ces clés, donc pas
// besoin de métadonnée séparée pour savoir si une couleur a été appliquée.
function colorAttrs(cell: Cell): string[] {
    const style: any = cell.style ?? {};
    const attrs: string[] = [];
    if (style.fillColor) attrs.push(`color:background-color="${escapeXml(String(style.fillColor))}"`);
    if (style.strokeColor) attrs.push(`color:border-color="${escapeXml(String(style.strokeColor))}"`);
    return attrs;
}

// ── Repli pour les cellules sans BpmnMeta (dessinées à la main, hors import) ──────
// Hors contrat strict de symétrie avec l'import (bpmn-import.ts ne les a
// jamais vues), mais permet au bouton Export de rester utilisable sur un
// diagramme édité à la main : on retombe sur le baseStyleName pour deviner un
// type plausible, en perdant le sous-type exact (une tâche ajoutée à la main
// s'exporte en "task" générique, un event en "startEvent", etc.).
let fallbackCounter = 0;

// Un id BPMN est un xsd:ID (donc un NCName XML) : il doit commencer par une
// lettre ou un underscore. cell.getId() renvoie l'id interne de maxgraph
// (auto-attribué, purement numérique — "4", "18"...) pour toute cellule
// dessinée à la main plutôt qu'importée, ce qui produit un XML rejeté par
// tout autre outil BPMN ("illegal ID <4>"). On le rend valide en le
// préfixant par son type ; un id déjà valide (import réel) traverse tel
// quel.
function sanitizeId(id: string, prefix: string): string {
    return /^[A-Za-z_]/.test(id) ? id : `${prefix}_${id}`;
}

// ── Sous-type via l'icône (contenu natif sans BpmnMeta) ───────────────────────
// Un schéma chargé via loadXml() (ex. un schéma Mercator, jamais passé par
// drawDiagram donc sans BpmnMeta — voir metaOfVertex) porte déjà le glyphe
// exact posé par CETTE MÊME police d'icônes (bpmn-icons.ts) : pas besoin de
// deviner le sous-type depuis la topologie, juste lire l'enfant bpmnIcon/
// stateIcon (findIconChild) et retrouver quel type/definition bpmn-import.ts
// aurait posé pour arriver à ce glyphe précis. Miroir inversé de :
// eventIcon() pour les events, du switch "Tasks" pour les tâches, de celui
// "Gateways" pour les gateways (tous dans bpmn-import.ts) — à garder en
// synchronisation si l'un de ces trois bouge. Repli sur le comportement
// précédent (startEvent/exclusiveGateway/task générique) quand l'icône est
// absente ou ne correspond à aucune entrée connue (dessiné à la main, ou
// glyphe générique non lié à un sous-type précis — ex. GATEWAY, le losange
// nu sans marqueur, qu'aucun sous-type de gateway standard ne reproduit à
// l'identique).
const EVENT_ICON_TO_META: Partial<Record<string, { kind: string; definition?: string }>> = {
    [BPMN_ICONS.START_EVENT]: { kind: 'startEvent' },
    [BPMN_ICONS.INTER_EVENT]: { kind: 'intermediateThrowEvent' },
    [BPMN_ICONS.END_EVENT]: { kind: 'endEvent' },
    [BPMN_ICONS.MESSAGE_START_EVENT]: { kind: 'startEvent', definition: 'message' },
    [BPMN_ICONS.MESSAGE_CATCH_EVENT]: { kind: 'intermediateCatchEvent', definition: 'message' },
    [BPMN_ICONS.MESSAGE_THROW_EVENT]: { kind: 'intermediateThrowEvent', definition: 'message' },
    [BPMN_ICONS.MESSAGE_END_EVENT]: { kind: 'endEvent', definition: 'message' },
    [BPMN_ICONS.TIMER_START_EVENT]: { kind: 'startEvent', definition: 'timer' },
    [BPMN_ICONS.TIMER_CATCH_EVENT]: { kind: 'intermediateCatchEvent', definition: 'timer' },
    [BPMN_ICONS.SIGNAL_START_EVENT]: { kind: 'startEvent', definition: 'signal' },
    [BPMN_ICONS.SIGNAL_CATCH_EVENT]: { kind: 'intermediateCatchEvent', definition: 'signal' },
    [BPMN_ICONS.SIGNAL_THROW_EVENT]: { kind: 'intermediateThrowEvent', definition: 'signal' },
    [BPMN_ICONS.SIGNAL_END_EVENT]: { kind: 'endEvent', definition: 'signal' },
    [BPMN_ICONS.ERROR_SUB_PROCESS_START_EVENT]: { kind: 'startEvent', definition: 'error' },
    [BPMN_ICONS.ERROR_CATCH_EVENT]: { kind: 'intermediateCatchEvent', definition: 'error' },
    [BPMN_ICONS.ERROR_END_EVENT]: { kind: 'endEvent', definition: 'error' },
    [BPMN_ICONS.ESCALATION_START_EVENT]: { kind: 'startEvent', definition: 'escalation' },
    [BPMN_ICONS.ESCALATION_END_EVENT]: { kind: 'endEvent', definition: 'escalation' },
    [BPMN_ICONS.CONDITIONAL_START_EVENT]: { kind: 'startEvent', definition: 'conditional' },
    [BPMN_ICONS.CONDITIONAL_CATCH_EVENT]: { kind: 'intermediateCatchEvent', definition: 'conditional' },
    [BPMN_ICONS.LINK_CATCH_EVENT]: { kind: 'intermediateCatchEvent', definition: 'link' },
    [BPMN_ICONS.LINK_THROW_EVENT]: { kind: 'intermediateThrowEvent', definition: 'link' },
    [BPMN_ICONS.LINK_END_EVENT]: { kind: 'endEvent', definition: 'link' },
    [BPMN_ICONS.COMPENSATION_SUB_PROCESS_START_EVENT]: { kind: 'startEvent', definition: 'compensate' },
    [BPMN_ICONS.COMPENSATION_THROW_EVENT]: { kind: 'intermediateThrowEvent', definition: 'compensate' },
    [BPMN_ICONS.TERMINATION_EVENT]: { kind: 'endEvent', definition: 'terminate' },
    [BPMN_ICONS.CANCEL_END_EVENT]: { kind: 'endEvent', definition: 'cancel' },
    [BPMN_ICONS.MULTIPLE_PARALLEL_START_EVENT]: { kind: 'startEvent', definition: 'multiple' },
    [BPMN_ICONS.MULTIPLE_THROW_EVENT]: { kind: 'intermediateThrowEvent', definition: 'multiple' },
};

const GATEWAY_ICON_TO_KIND: Partial<Record<string, string>> = {
    [BPMN_ICONS.EXCLUSIVE_GATEWAY]: 'exclusiveGateway',
    [BPMN_ICONS.PARALLEL_GATEWAY]: 'parallelGateway',
    [BPMN_ICONS.INCLUSIVE_GATEWAY]: 'inclusiveGateway',
    [BPMN_ICONS.EVENT_GATEWAY]: 'eventBasedGateway',
    [BPMN_ICONS.COMPLEX_GATEWAY]: 'complexGateway',
};

const TASK_ICON_TO_KIND: Partial<Record<string, string>> = {
    [BPMN_ICONS.MANUAL_TASK]: 'manualTask',
    [BPMN_ICONS.SERVICE_TASK]: 'serviceTask',
    [BPMN_ICONS.USER_TASK]: 'userTask',
    [BPMN_ICONS.SCRIPT_TASK]: 'scriptTask',
    [BPMN_ICONS.BUSINESS_TASK]: 'businessRuleTask',
    [BPMN_ICONS.SEND_TASK]: 'sendTask',
    [BPMN_ICONS.RECEIVE_TASK]: 'receiveTask',
};

function iconGlyphOf(cell: Cell): string | undefined {
    const iconCell = findIconChild(cell);
    const value = iconCell?.getValue?.();
    return typeof value === 'string' && value !== '' ? value : undefined;
}

function inferVertexMeta(cell: Cell): BpmnMeta {
    const baseNames: string[] = (cell.style as any)?.baseStyleNames ?? [];
    const rawId = cell.getId() || `${fallbackCounter++}`;
    if (baseNames.includes('lane')) return { bpmnId: sanitizeId(rawId, 'Lane'), kind: 'lane' };
    if (baseNames.includes('state')) {
        const glyph = iconGlyphOf(cell);
        const found = glyph !== undefined ? EVENT_ICON_TO_META[glyph] : undefined;
        return { bpmnId: sanitizeId(rawId, 'Event'), kind: found?.kind ?? 'startEvent', definition: found?.definition };
    }
    if (baseNames.includes('gateway')) {
        const glyph = iconGlyphOf(cell);
        const kind = (glyph !== undefined ? GATEWAY_ICON_TO_KIND[glyph] : undefined) ?? 'exclusiveGateway';
        return { bpmnId: sanitizeId(rawId, 'Gateway'), kind };
    }
    if (baseNames.includes('annotation')) return { bpmnId: sanitizeId(rawId, 'Annotation'), kind: 'textAnnotation' };
    if (baseNames.includes('conversation')) return { bpmnId: sanitizeId(rawId, 'Conversation'), kind: 'conversationNode' };
    if (baseNames.includes('database')) return { bpmnId: sanitizeId(rawId, 'DataStore'), kind: 'dataStoreReference' };
    if (baseNames.includes('data')) {
        const glyph = iconGlyphOf(cell);
        if (glyph === BPMN_ICONS.DATA_INPUT) return { bpmnId: sanitizeId(rawId, 'DataInput'), kind: 'dataInput' };
        if (glyph === BPMN_ICONS.DATA_OUTPUT) return { bpmnId: sanitizeId(rawId, 'DataOutput'), kind: 'dataOutput' };
        return { bpmnId: sanitizeId(rawId, 'DataObject'), kind: 'dataObjectReference' };
    }
    // Call activity / Transaction : pas d'icône dédiée, identifiables uniquement
    // par leur bordure (voir setCallActivityVertex/setTransactionVertex dans
    // bpmn-helpers.ts) — à tester avant le repli générique sur l'icône ci-dessous.
    const style: any = cell.style ?? {};
    if (style.shape === 'bpmnTransactionShape') {
        return { bpmnId: sanitizeId(rawId, 'Transaction'), kind: 'transaction' };
    }
    if (baseNames.includes('process') && Number(style.strokeWidth) === 3) {
        return { bpmnId: sanitizeId(rawId, 'CallActivity'), kind: 'callActivity' };
    }
    const glyph = iconGlyphOf(cell);
    const kind = (glyph !== undefined ? TASK_ICON_TO_KIND[glyph] : undefined) ?? 'task';
    return { bpmnId: sanitizeId(rawId, 'Task'), kind };
}

function inferEdgeMeta(cell: Cell): BpmnMeta {
    const style: any = cell.style ?? {};
    const rawId = cell.getId() || `${fallbackCounter++}`;
    const baseNames: string[] = style.baseStyleNames ?? [];
    if (baseNames.includes('bpmnConversationLink')) return { bpmnId: sanitizeId(rawId, 'ConversationLink'), kind: 'conversationLink' };
    const bpmnId = sanitizeId(rawId, 'Flow');
    if (style.startArrow === 'bpmnMessage') return { bpmnId, kind: 'messageFlow' };
    if (style.dashed === true) return { bpmnId, kind: 'association' };
    return { bpmnId, kind: 'sequenceFlow' };
}

function metaOfVertex(cell: Cell): BpmnMeta {
    return getBpmnMeta(cell) ?? inferVertexMeta(cell);
}

function metaOfEdge(cell: Cell): BpmnMeta {
    return getBpmnMeta(cell) ?? inferEdgeMeta(cell);
}

// ── Collecte du modèle à exporter ─────────────────────────────────────────────────

interface LaneEntry {
    id: string;
    name: string;
    cell: Cell;
    flowNodeRefs: string[];
}

interface FlowNodeEntry {
    cell: Cell;
    meta: BpmnMeta;
}

interface FlowEntry {
    id: string;
    name: string;
    sourceRef: string;
    targetRef: string;
    direction?: string;
}

interface ProcessEntry {
    id: string;
    poolCell?: Cell;
    participantId?: string;
    participantName?: string;
    lanes: LaneEntry[];
    flowNodes: FlowNodeEntry[];
    sequenceFlows: FlowEntry[];
}

interface AnnotationEntry {
    cell: Cell;
    meta: BpmnMeta;
}

interface ExportModel {
    processes: ProcessEntry[];
    annotations: AnnotationEntry[];
    associations: FlowEntry[];
    messageFlows: FlowEntry[];
    // Diagramme de conversation BPMN (bpmn2:conversationNode/conversationLink,
    // toujours au niveau d'une <collaboration>) : `bands` sont les participants
    // sans laneSet/processRef (une "bande" colorée, dessinée comme une lane —
    // voir inferVertexMeta et le commentaire sur bandCells dans collectModel),
    // distincts de `processes[].participantId` qui référencent un vrai process.
    conversationNodes: FlowNodeEntry[];
    conversationLinks: FlowEntry[];
    bands: LaneEntry[];
    edgeById: Map<string, Cell>;
}

// maxgraph reparente une arête vers le plus proche ancêtre commun de ses deux
// extrémités dès l'insertion (voir edgeParentOffset ci-dessous) — une arête
// n'est donc pas forcément un enfant direct du defaultParent malgré le
// `parent` passé à addBPMNConnection. Il faut la chercher dans tout l'arbre,
// pas seulement graph.getChildEdges(defaultParent).
function collectAllEdges(root: Cell): Cell[] {
    const edges: Cell[] = [];
    const walk = (cell: Cell): void => {
        for (const child of cell.getChildren?.() ?? []) {
            if (child.isEdge?.()) edges.push(child);
            walk(child);
        }
    };
    walk(root);
    return edges;
}

function collectModel(graph: Graph): ExportModel {
    const defaultParent = graph.getDefaultParent();
    const topVertices = graph.getChildVertices(defaultParent) as Cell[];
    const allEdges = collectAllEdges(defaultParent);

    const processes: ProcessEntry[] = [];
    const annotations: AnnotationEntry[] = [];
    const cellToPool = new Map<Cell, ProcessEntry>();

    let defaultProcess: ProcessEntry | null = null;
    const getDefaultProcess = (): ProcessEntry => {
        if (!defaultProcess) {
            defaultProcess = { id: 'Process_1', lanes: [], flowNodes: [], sequenceFlows: [] };
            processes.push(defaultProcess);
        }
        return defaultProcess;
    };

    // Descend normalement dans les lanes (une tâche/event/gateway dessinée par
    // CET éditeur n'est jamais l'enfant direct d'une cellule process/
    // participant — voir getParentAndPosition dans bpmn-import.ts — seules
    // les lanes le sont). Mais du contenu natif étranger (ex. un schéma
    // Mercator chargé via loadXml) peut nester des cellules sous un
    // conteneur qui n'est PAS reconnu comme une lane — cas vu en pratique :
    // un style de swimlane posé en chaîne CSS brute ("style=\"swimlane;
    // startSize=30;...\"") plutôt que via baseStyleNames, que maxgraph
    // n'interprète plus (isSwimlane() renvoie false, aucune clé exploitable
    // dans cell.style) — inferVertexMeta le classe alors en tâche générique.
    // Sans le repli ci-dessous, TOUT son sous-arbre (lanes réelles, tâches,
    // events…) disparaîtrait silencieusement de l'export au lieu de la seule
    // icône/du seul type de ce conteneur. On replie donc systématiquement
    // les enfants d'une cellule non reconnue comme lane sur le lane/process
    // englobant, pour ne jamais perdre de contenu structurel.
    const collectUnder = (container: Cell, proc: ProcessEntry, laneId: string | undefined): void => {
        for (const child of container.getChildren?.() ?? []) {
            if (!child.isVertex?.()) continue;
            // Icône/badge décoratif (voir DECORATIVE_STYLES dans bpmn-helpers.ts) :
            // jamais un élément BPMN à part entière, seulement inspecté via
            // findIconChild par inferVertexMeta sur son PARENT — sans ce garde,
            // le repli de recursion ci-dessous (pour le contenu natif étranger,
            // voir le commentaire au-dessus) le collecterait comme une tâche
            // orpheline supplémentaire, y compris sur du contenu dessiné par
            // cet éditeur (toute tâche/event avec icône a un enfant bpmnIcon/
            // stateIcon).
            const childBaseNames: string[] = (child.style as any)?.baseStyleNames ?? [];
            if (DECORATIVE_STYLES.some((n) => childBaseNames.includes(n))) continue;
            const meta = metaOfVertex(child);
            if (meta.kind === 'lane') {
                const lane: LaneEntry = { id: meta.bpmnId, name: String(child.getValue?.() ?? ''), cell: child, flowNodeRefs: [] };
                proc.lanes.push(lane);
                cellToPool.set(child, proc);
                collectUnder(child, proc, lane.id);
                continue;
            }
            if (meta.kind === 'textAnnotation') {
                annotations.push({ cell: child, meta });
                cellToPool.set(child, proc);
                continue;
            }
            proc.flowNodes.push({ cell: child, meta });
            cellToPool.set(child, proc);
            if (laneId) {
                const lane = proc.lanes.find(l => l.id === laneId);
                lane?.flowNodeRefs.push(meta.bpmnId);
            }
            if (child.getChildCount?.() > 0) collectUnder(child, proc, laneId);
        }
    };

    // Détecte les cellules qui sont en réalité des bandes de participant d'un
    // diagramme de conversation BPMN : rien dans leur PROPRE style ne les
    // distingue d'une lane autonome au premier export (même style "lane",
    // même absence de laneSet — voir m10-bpmn-conversation.maxgraph) — seule
    // leur connexion à un bpmnConversationLink les trahit. N'exclut que
    // l'autre bout conversationNode, PAS une valeur de kind précise (lane) :
    // au second aller-retour, la bande réimportée porte un vrai BpmnMeta
    // kind:'participant' (posé par drawDiagram, voir la branche "Participant
    // sans processRef" de bpmn-import.ts) et non plus 'lane' — se limiter à
    // 'lane' la manquerait alors, cassant la stabilité au second passage
    // (bandCells vide -> classée participant+process synthétique -> ses
    // conversationLink deviennent orphelins et disparaissent silencieusement).
    // Calculé avant la boucle top-level ci-dessous, qui en a besoin pour
    // choisir entre lane autonome / participant classique et bande de
    // participant (collaboration, aucun process).
    const bandCells = new Set<Cell>();
    for (const e of allEdges) {
        if (metaOfEdge(e).kind !== 'conversationLink') continue;
        for (const raw of [e.getTerminal?.(true), e.getTerminal?.(false)]) {
            if (!raw) continue;
            const resolved = resolveConnectable(raw as Cell);
            if (metaOfVertex(resolved).kind !== 'conversationNode') bandCells.add(resolved);
        }
    }

    const conversationNodes: FlowNodeEntry[] = [];
    const bands: LaneEntry[] = [];

    for (const v of topVertices) {
        const meta = metaOfVertex(v);
        if (bandCells.has(v)) {
            bands.push({ id: meta.bpmnId, name: String(v.getValue?.() ?? ''), cell: v, flowNodeRefs: [] });
        } else if (meta.kind === 'process') {
            const proc: ProcessEntry = { id: meta.bpmnId, poolCell: v, lanes: [], flowNodes: [], sequenceFlows: [] };
            processes.push(proc);
            cellToPool.set(v, proc);
            collectUnder(v, proc, undefined);
        } else if (meta.kind === 'participant') {
            const processId = meta.processRef || `Process_of_${meta.bpmnId}`;
            const proc: ProcessEntry = {
                id: processId,
                poolCell: v,
                participantId: meta.bpmnId,
                participantName: String(v.getValue?.() ?? ''),
                lanes: [],
                flowNodes: [],
                sequenceFlows: [],
            };
            processes.push(proc);
            cellToPool.set(v, proc);
            collectUnder(v, proc, undefined);
        } else if (meta.kind === 'conversationNode') {
            conversationNodes.push({ cell: v, meta });
        } else if (meta.kind === 'lane') {
            // Lane autonome (hors laneSet, hors participant) : rattachée au
            // process synthétique par défaut, qui n'a pas de cellule propre.
            const proc = getDefaultProcess();
            const lane: LaneEntry = { id: meta.bpmnId, name: String(v.getValue?.() ?? ''), cell: v, flowNodeRefs: [] };
            proc.lanes.push(lane);
            cellToPool.set(v, proc);
            collectUnder(v, proc, lane.id);
        } else if (meta.kind === 'textAnnotation') {
            annotations.push({ cell: v, meta });
        } else {
            const proc = getDefaultProcess();
            proc.flowNodes.push({ cell: v, meta });
            cellToPool.set(v, proc);
            if (v.getChildCount?.() > 0) collectUnder(v, proc, undefined);
        }
    }

    // ids de tout ce qui a effectivement été retenu comme noeud du modèle
    // (flowNode ou annotation) — sert de garde-fou ci-dessous : une arête
    // dont l'extrémité est une cellule orpheline (détachée de l'arbre du
    // defaultParent, ex. reliquat de copier/coller, mais toujours référencée
    // comme terminal par maxgraph) obtiendrait sinon un sourceRef/targetRef
    // qui ne correspond à aucun élément émis, ce qu'aucun parseur BPMN
    // n'accepte ("unresolved reference").
    const knownNodeIds = new Set<string>();
    for (const p of processes) {
        for (const n of p.flowNodes) knownNodeIds.add(n.meta.bpmnId);
    }
    for (const a of annotations) knownNodeIds.add(a.meta.bpmnId);
    for (const n of conversationNodes) knownNodeIds.add(n.meta.bpmnId);
    for (const b of bands) knownNodeIds.add(b.id);

    const associations: FlowEntry[] = [];
    const messageFlows: FlowEntry[] = [];
    const conversationLinks: FlowEntry[] = [];
    const edgeById = new Map<string, Cell>();

    // Une arête stylée "message" (voir inferEdgeMeta) n'a de sens en tant que
    // <bpmn2:messageFlow> que si le diagramme a une <collaboration> pour
    // l'accueillir (BPMN l'exige entre deux participants) — déterminé une
    // fois ici, avant la boucle, puisque `processes` est déjà complet à ce
    // stade. Sans collaboration (diagramme à process nu, ex. un décor
    // "message" posé sur un flux Mercator sans pool), la classifier quand
    // même en messageFlow la rendrait orpheline : rien n'émettrait plus le
    // <messageFlow> (pas de <collaboration> à défaut de participant), alors
    // que son BPMNEdge de diagramme, lui, continuerait à sortir sans arrêt —
    // périmant sa cible bpmnElement et la faisant disparaître silencieusement
    // à la réimportation. On la traite alors comme un flux interne normal.
    const hasCollaboration = processes.some(p => p.participantId);

    for (const e of allEdges) {
        const meta = metaOfEdge(e);
        // Filet de sécurité pour les diagrammes déjà enregistrés avec une arête
        // ancrée sur l'icône décorative (state/gateway) plutôt que sur son
        // parent — voir DECORATIVE_STYLES/resolveConnectable dans bpmn-helpers.ts.
        const rawSource = e.getTerminal?.(true) as Cell | null;
        const rawTarget = e.getTerminal?.(false) as Cell | null;
        if (!rawSource || !rawTarget) continue;
        const source = resolveConnectable(rawSource);
        const target = resolveConnectable(rawTarget);

        const sourceMeta = metaOfVertex(source);
        const targetMeta = metaOfVertex(target);
        if (!knownNodeIds.has(sourceMeta.bpmnId) || !knownNodeIds.has(targetMeta.bpmnId)) {
            console.warn(`⚠️ Export BPMN : arête ${meta.bpmnId} ignorée (extrémité orpheline hors du modèle)`);
            continue;
        }
        // Filet de sécurité pour les arêtes sans BpmnMeta (contenu natif
        // Mercator, jamais passé par drawDiagram) : inferEdgeMeta() ne repère
        // une association qu'au style `dashed` de l'arête elle-même, qui peut
        // être absent sur un lien annotation<->objet dessiné sans ce style
        // précis. BPMN interdit à un sequenceFlow/messageFlow de toucher un
        // textAnnotation (ce n'est pas un flow node) : dès qu'une extrémité
        // est une annotation, l'arête ne peut structurellement être qu'une
        // <bpmn2:association>, quel que soit son style de trait.
        if (!getBpmnMeta(e) && meta.kind !== 'messageFlow' && meta.kind !== 'conversationLink' &&
            (sourceMeta.kind === 'textAnnotation' || targetMeta.kind === 'textAnnotation')) {
            meta.kind = 'association';
        }
        edgeById.set(meta.bpmnId, e);

        const entry: FlowEntry = {
            id: meta.bpmnId,
            name: String(e.getValue?.() ?? ''),
            sourceRef: sourceMeta.bpmnId,
            targetRef: targetMeta.bpmnId,
            direction: meta.direction,
        };

        if (meta.kind === 'messageFlow' && hasCollaboration) {
            messageFlows.push(entry);
        } else if (meta.kind === 'conversationLink') {
            conversationLinks.push(entry);
        } else if (meta.kind === 'association') {
            associations.push(entry);
        } else {
            const pool = cellToPool.get(source) ?? processes[0] ?? getDefaultProcess();
            pool.sequenceFlows.push(entry);
        }
    }

    return { processes, annotations, associations, messageFlows, conversationNodes, conversationLinks, bands, edgeById };
}

// ── Émission des éléments sémantiques ─────────────────────────────────────────────

function eventDefinitionTags(definition: string | undefined): string[] {
    if (!definition || definition === 'none') return [];
    if (definition === 'multiple') {
        // "multiple" est une nature synthétique déduite par l'import du
        // nombre d'*EventDefinition (>=2), pas un nom de balise réel — quelle
        // que soit la paire réémise ici, l'import ne fait que compter les
        // enfants *EventDefinition pour retomber sur "multiple" (aucune des
        // natures individuelles n'est relue), donc un couple générique
        // suffit à un round-trip fidèle.
        return ['<bpmn2:messageEventDefinition/>', '<bpmn2:timerEventDefinition/>'];
    }
    return [`<bpmn2:${definition}EventDefinition/>`];
}

function emitFlowNode(meta: BpmnMeta, name: string): string {
    const tag = `bpmn2:${meta.kind}`;
    const nameAttr = name ? ` name="${escapeXml(name)}"` : '';
    const extra: string[] = [];

    if (meta.kind === 'boundaryEvent') {
        if (meta.attachedToRef) extra.push(`attachedToRef="${escapeXml(meta.attachedToRef)}"`);
        if (meta.interrupting === false) extra.push('cancelActivity="false"');
        if (meta.parallelMultiple) extra.push('parallelMultiple="true"');
    } else if (meta.kind === 'startEvent') {
        if (meta.interrupting === false) extra.push('isInterrupting="false"');
    }

    const attrsStr = extra.length ? ' ' + extra.join(' ') : '';
    const defs = /Event$/.test(meta.kind) ? eventDefinitionTags(meta.definition) : [];

    if (defs.length === 0) {
        return `<${tag} id="${escapeXml(meta.bpmnId)}"${nameAttr}${attrsStr}/>`;
    }
    return `<${tag} id="${escapeXml(meta.bpmnId)}"${nameAttr}${attrsStr}>${defs.join('')}</${tag}>`;
}

function emitLane(lane: LaneEntry): string {
    const refs = lane.flowNodeRefs.map(id => `<bpmn2:flowNodeRef>${escapeXml(id)}</bpmn2:flowNodeRef>`).join('');
    const nameAttr = lane.name ? ` name="${escapeXml(lane.name)}"` : '';
    return `<bpmn2:lane id="${escapeXml(lane.id)}"${nameAttr}>${refs}</bpmn2:lane>`;
}

function emitSequenceFlow(f: FlowEntry): string {
    const nameAttr = f.name ? ` name="${escapeXml(f.name)}"` : '';
    return `<bpmn2:sequenceFlow id="${escapeXml(f.id)}"${nameAttr} sourceRef="${escapeXml(f.sourceRef)}" targetRef="${escapeXml(f.targetRef)}"/>`;
}

function emitAnnotation(entry: AnnotationEntry): string {
    const text = String(entry.cell.getValue?.() ?? '');
    return `<bpmn2:textAnnotation id="${escapeXml(entry.meta.bpmnId)}"><bpmn2:text>${escapeXml(text)}</bpmn2:text></bpmn2:textAnnotation>`;
}

function emitAssociation(a: FlowEntry): string {
    const dir = a.direction && a.direction !== 'None' ? ` associationDirection="${escapeXml(a.direction)}"` : '';
    return `<bpmn2:association id="${escapeXml(a.id)}" sourceRef="${escapeXml(a.sourceRef)}" targetRef="${escapeXml(a.targetRef)}"${dir}/>`;
}

function emitMessageFlow(f: FlowEntry): string {
    const nameAttr = f.name ? ` name="${escapeXml(f.name)}"` : '';
    return `<bpmn2:messageFlow id="${escapeXml(f.id)}"${nameAttr} sourceRef="${escapeXml(f.sourceRef)}" targetRef="${escapeXml(f.targetRef)}"/>`;
}

function emitProcess(p: ProcessEntry, artifactsXml: string): string {
    const laneSetXml = p.lanes.length
        ? `<bpmn2:laneSet id="LaneSet_${escapeXml(p.id)}">${p.lanes.map(emitLane).join('')}</bpmn2:laneSet>`
        : '';
    const nodesXml = p.flowNodes.map(n => emitFlowNode(n.meta, String(n.cell.getValue?.() ?? ''))).join('');
    const flowsXml = p.sequenceFlows.map(emitSequenceFlow).join('');
    // Le nom du process n'est capturé que pour un process "nu" (sans
    // participant) : quand un participant référence un process, l'import ne
    // conserve jamais le nom propre du process (voir Phase 0) — l'émettre
    // sans nom est cohérent avec ce que l'import a réellement lu.
    const nameAttr = !p.participantId && p.poolCell ? (() => {
        const name = String(p.poolCell!.getValue?.() ?? '');
        return name ? ` name="${escapeXml(name)}"` : '';
    })() : '';
    return `<bpmn2:process id="${escapeXml(p.id)}"${nameAttr} isExecutable="false">${laneSetXml}${nodesXml}${flowsXml}${artifactsXml}</bpmn2:process>`;
}

// ── Émission DI ────────────────────────────────────────────────────────────────

// Style maxGraph "horizontal" du style nommé "lane" (graph-styles.ts) -> attribut
// BPMN DI isHorizontal d'un pool/lane, sens INVERSE — voir le commentaire de
// AddBPMNLaneOptions.isHorizontal dans bpmn-helpers.ts pour la correspondance
// complète. cell.style.horizontal absent (cas courant : aucun override posé par
// addBPMNLane) vaut le défaut du style nommé "lane", horizontal:false, donc
// isHorizontal BPMN true — d'où le `!` direct sans valeur par défaut explicite.
function poolIsHorizontal(cell: Cell): boolean {
    return !(cell.style as any)?.horizontal;
}

function emitShapeDI(
    cell: Cell,
    bpmnId: string,
    defaultParent: Cell,
    extra: { isHorizontal?: boolean; isExpanded?: boolean } = {}
): string {
    const abs = absoluteGeometry(cell, defaultParent);
    const attrs = [`id="Shape_${escapeXml(bpmnId)}"`, `bpmnElement="${escapeXml(bpmnId)}"`];
    if (extra.isHorizontal !== undefined) attrs.push(`isHorizontal="${extra.isHorizontal ? 'true' : 'false'}"`);
    if (extra.isExpanded !== undefined) attrs.push(`isExpanded="${extra.isExpanded ? 'true' : 'false'}"`);
    attrs.push(...colorAttrs(cell));

    const meta = getBpmnMeta(cell);
    const labelXml = meta?.labelBounds
        ? `<bpmndi:BPMNLabel><dc:Bounds x="${fmt(meta.labelBounds.x)}" y="${fmt(meta.labelBounds.y)}" width="${fmt(meta.labelBounds.width)}" height="${fmt(meta.labelBounds.height)}"/></bpmndi:BPMNLabel>`
        : '';

    return `<bpmndi:BPMNShape ${attrs.join(' ')}><dc:Bounds x="${fmt(abs.x)}" y="${fmt(abs.y)}" width="${fmt(abs.width)}" height="${fmt(abs.height)}"/>${labelXml}</bpmndi:BPMNShape>`;
}

function emitEdgeDI(graph: Graph, edge: Cell, bpmnId: string, defaultParent: Cell): string {
    const points = absoluteWaypoints(graph, edge, defaultParent);
    const waypointsXml = points.map(p => `<di:waypoint x="${fmt(p.x)}" y="${fmt(p.y)}"/>`).join('');
    const attrs = [`id="Edge_${escapeXml(bpmnId)}"`, `bpmnElement="${escapeXml(bpmnId)}"`, ...colorAttrs(edge)];

    const meta = getBpmnMeta(edge);
    const labelXml = meta?.labelBounds
        ? `<bpmndi:BPMNLabel><dc:Bounds x="${fmt(meta.labelBounds.x)}" y="${fmt(meta.labelBounds.y)}" width="${fmt(meta.labelBounds.width)}" height="${fmt(meta.labelBounds.height)}"/></bpmndi:BPMNLabel>`
        : '';

    return `<bpmndi:BPMNEdge ${attrs.join(' ')}>${waypointsXml}${labelXml}</bpmndi:BPMNEdge>`;
}

// ── Point d'entrée ─────────────────────────────────────────────────────────────

/**
 * Sérialise le graphe courant en BPMN 2.0 XML standard (definitions/process
 * ou collaboration + DI complète). Symétrique à parseBPMN()/drawDiagram() de
 * bpmn-import.ts — voir le commentaire d'en-tête de ce fichier.
 */
export function exportBPMN(graph: Graph): string {
    const defaultParent = graph.getDefaultParent();
    const model = collectModel(graph);

    // Un diagramme de conversation (bandes de participant + conversationNode)
    // n'a pas forcément de process participant classique, mais a tout autant
    // besoin d'une <collaboration> pour accueillir ses éléments — voir le
    // commentaire sur `bands` dans ExportModel.
    const hasConversation = model.conversationNodes.length > 0 || model.bands.length > 0;
    const hasCollaboration = model.processes.some(p => p.participantId) || hasConversation;

    const annotationsXml = model.annotations.map(emitAnnotation).join('');
    const associationsXml = model.associations.map(emitAssociation).join('');
    // Les artefacts (textAnnotation/association) sont globaux dans le
    // document du point de vue du parseur (sélection par nom local sur tout
    // xmlDoc, indépendante de leur élément englobant — voir Phase 0) : les
    // regrouper dans le premier <process> émis suffit à un round-trip fidèle,
    // sans avoir à leur assigner un process "propriétaire" précis.
    const artifactsForFirstProcess = annotationsXml + associationsXml;

    const processesXml = model.processes
        .map((p, i) => emitProcess(p, i === 0 ? artifactsForFirstProcess : ''))
        .join('');

    let collaborationXml = '';
    if (hasCollaboration) {
        const participantsXml = model.processes
            .filter(p => p.participantId)
            .map(p => {
                const nameAttr = p.participantName ? ` name="${escapeXml(p.participantName)}"` : '';
                return `<bpmn2:participant id="${escapeXml(p.participantId!)}"${nameAttr} processRef="${escapeXml(p.id)}"/>`;
            })
            .join('');
        // Bandes de participant sans process (diagramme de conversation) : même
        // élément <bpmn2:participant>, juste sans processRef.
        const bandsXml = model.bands
            .map(b => {
                const nameAttr = b.name ? ` name="${escapeXml(b.name)}"` : '';
                return `<bpmn2:participant id="${escapeXml(b.id)}"${nameAttr}/>`;
            })
            .join('');
        const conversationNodesXml = model.conversationNodes
            .map(n => {
                const name = String(n.cell.getValue?.() ?? '');
                const nameAttr = name ? ` name="${escapeXml(name)}"` : '';
                return `<bpmn2:conversation id="${escapeXml(n.meta.bpmnId)}"${nameAttr}/>`;
            })
            .join('');
        const conversationLinksXml = model.conversationLinks
            .map(f => {
                const nameAttr = f.name ? ` name="${escapeXml(f.name)}"` : '';
                return `<bpmn2:conversationLink id="${escapeXml(f.id)}"${nameAttr} sourceRef="${escapeXml(f.sourceRef)}" targetRef="${escapeXml(f.targetRef)}"/>`;
            })
            .join('');
        const messageFlowsXml = model.messageFlows.map(emitMessageFlow).join('');
        // Ordre imposé par la xsd:sequence de tCollaboration : participant,
        // messageFlow, conversationNode, conversationLink (bandsXml émet aussi
        // des <bpmn2:participant>, donc groupé avec participantsXml en tête).
        collaborationXml = `<bpmn2:collaboration id="Collaboration_1">${participantsXml}${bandsXml}${messageFlowsXml}${conversationNodesXml}${conversationLinksXml}</bpmn2:collaboration>`;
    }

    // DI : pools, puis lanes, puis noeuds, puis arêtes (l'ordre n'a aucune
    // incidence sur le rendu réimporté — drawDiagram traite les catégories
    // dans un ordre qui lui est propre, indépendant de l'ordre du XML — mais
    // reste suivi ici pour la lisibilité du fichier généré).
    const poolShapes: string[] = [];
    const laneShapes: string[] = [];
    const nodeShapes: string[] = [];
    const edgeDI: string[] = [];

    for (const p of model.processes) {
        if (p.poolCell) {
            poolShapes.push(emitShapeDI(p.poolCell, p.participantId ?? p.id, defaultParent, { isHorizontal: poolIsHorizontal(p.poolCell) }));
        }
        for (const lane of p.lanes) {
            laneShapes.push(emitShapeDI(lane.cell, lane.id, defaultParent, { isHorizontal: poolIsHorizontal(lane.cell) }));
        }
        for (const n of p.flowNodes) {
            const isSubProcessFamily = n.meta.kind === 'subProcess' || n.meta.kind === 'transaction' || n.meta.kind === 'adHocSubProcess';
            nodeShapes.push(
                emitShapeDI(n.cell, n.meta.bpmnId, defaultParent, isSubProcessFamily ? { isExpanded: !n.meta.collapsed } : {})
            );
        }
        for (const f of p.sequenceFlows) {
            const cell = model.edgeById.get(f.id);
            if (cell) edgeDI.push(emitEdgeDI(graph, cell, f.id, defaultParent));
        }
    }
    for (const a of model.annotations) {
        nodeShapes.push(emitShapeDI(a.cell, a.meta.bpmnId, defaultParent));
    }
    for (const a of model.associations) {
        const cell = model.edgeById.get(a.id);
        if (cell) edgeDI.push(emitEdgeDI(graph, cell, a.id, defaultParent));
    }
    for (const f of model.messageFlows) {
        const cell = model.edgeById.get(f.id);
        if (cell) edgeDI.push(emitEdgeDI(graph, cell, f.id, defaultParent));
    }
    for (const b of model.bands) {
        laneShapes.push(emitShapeDI(b.cell, b.id, defaultParent, { isHorizontal: true }));
    }
    for (const n of model.conversationNodes) {
        nodeShapes.push(emitShapeDI(n.cell, n.meta.bpmnId, defaultParent));
    }
    for (const f of model.conversationLinks) {
        const cell = model.edgeById.get(f.id);
        if (cell) edgeDI.push(emitEdgeDI(graph, cell, f.id, defaultParent));
    }

    const anyColor = [...poolShapes, ...laneShapes, ...nodeShapes, ...edgeDI].some(s => s.includes('color:'));
    const colorNs = anyColor ? ' xmlns:color="http://www.omg.org/spec/BPMN/non-normative/color/1.0"' : '';

    const diagramXml = `<bpmndi:BPMNDiagram id="BPMNDiagram_1"><bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="${hasCollaboration ? 'Collaboration_1' : escapeXml(model.processes[0]?.id ?? 'Process_1')}">${poolShapes.join('')}${laneShapes.join('')}${nodeShapes.join('')}${edgeDI.join('')}</bpmndi:BPMNPlane></bpmndi:BPMNDiagram>`;

    const totalNodes = model.processes.reduce((sum, p) => sum + p.flowNodes.length, 0);
    const totalFlows = model.processes.reduce((sum, p) => sum + p.sequenceFlows.length, 0) + model.messageFlows.length;
    console.log(
        `📤 Export BPMN : ${model.processes.filter(p => p.participantId).length} pool(s), ${totalNodes} élément(s), ${totalFlows} flux, ${model.annotations.length} annotation(s)`
    );

    return `<?xml version="1.0" encoding="UTF-8"?>` +
        `<bpmn2:definitions xmlns:bpmn2="http://www.omg.org/spec/BPMN/20100524/MODEL" ` +
        `xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" ` +
        `xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" ` +
        `xmlns:di="http://www.omg.org/spec/DD/20100524/DI"${colorNs} ` +
        `id="Definitions_1" targetNamespace="http://sourcentis.com/bpmn">` +
        `${collaborationXml}${processesXml}${diagramXml}` +
        `</bpmn2:definitions>`;
}
