// src/bpmn-export.ts
// Export du graphe MaxGraph vers du BPMN 2.0 XML standard (<definitions>,
// <process>/<collaboration>, DI complète). Symétrique à src/bpmn-import.ts :
// la seule cible est ce que parseBPMN()/drawDiagram() relisent — voir le
// commentaire de BpmnMeta dans bpmn-import.ts pour ce que le modèle graphe
// seul ne permet pas de reconstruire (ids d'origine, sous-type exact,
// interrupting/attachedToRef, processRef d'un participant).
import type { Cell, Graph } from '@maxgraph/core';
import { getBpmnMeta, type BpmnMeta } from './bpmn-import';

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
// addBPMNConnection). C'est ce que l'import compense déjà via son calcul
// d'offsetX/offsetY (en remontant edge.getParent() jusqu'à defaultParent) et
// son décompte swimlaneCount*20 — on l'inverse ici à l'identique pour les
// points intermédiaires de geometry.points.
function edgeParentOffset(edge: Cell, defaultParent: Cell): { offsetX: number; offsetY: number } {
    let offsetX = 0;
    let offsetY = 0;
    let swimlaneCount = 0;
    let current = edge.getParent?.();
    while (current && current !== defaultParent) {
        const geo: any = current.getGeometry?.();
        if (geo) {
            offsetX += geo.x ?? 0;
            offsetY += geo.y ?? 0;
        }
        const baseNames: string[] = (current.style as any)?.baseStyleNames ?? [];
        if (baseNames.includes('lane')) swimlaneCount++;
        current = current.getParent?.();
    }
    offsetX -= swimlaneCount * 20;
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

function inferVertexMeta(cell: Cell): BpmnMeta {
    const baseNames: string[] = (cell.style as any)?.baseStyleNames ?? [];
    const bpmnId = cell.getId() || `Node_${fallbackCounter++}`;
    if (baseNames.includes('lane')) return { bpmnId, kind: 'lane' };
    if (baseNames.includes('state')) return { bpmnId, kind: 'startEvent' };
    if (baseNames.includes('gateway')) return { bpmnId, kind: 'exclusiveGateway' };
    if (baseNames.includes('annotation')) return { bpmnId, kind: 'textAnnotation' };
    return { bpmnId, kind: 'task' };
}

function inferEdgeMeta(cell: Cell): BpmnMeta {
    const style: any = cell.style ?? {};
    const bpmnId = cell.getId() || `Flow_${fallbackCounter++}`;
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

    // Ne descend que dans les lanes : une tâche/event/gateway n'est jamais
    // l'enfant direct d'une cellule process/participant (voir
    // getParentAndPosition dans bpmn-import.ts — le parent est toujours soit
    // une lane, soit le defaultParent), seules les lanes le sont.
    const collectUnder = (container: Cell, proc: ProcessEntry, laneId: string | undefined): void => {
        for (const child of container.getChildren?.() ?? []) {
            if (!child.isVertex?.()) continue;
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
        }
    };

    for (const v of topVertices) {
        const meta = metaOfVertex(v);
        if (meta.kind === 'process') {
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
        }
    }

    const associations: FlowEntry[] = [];
    const messageFlows: FlowEntry[] = [];
    const edgeById = new Map<string, Cell>();

    for (const e of allEdges) {
        const meta = metaOfEdge(e);
        edgeById.set(meta.bpmnId, e);
        const source = e.getTerminal?.(true) as Cell | null;
        const target = e.getTerminal?.(false) as Cell | null;
        if (!source || !target) continue;

        const sourceMeta = metaOfVertex(source);
        const targetMeta = metaOfVertex(target);
        const entry: FlowEntry = {
            id: meta.bpmnId,
            name: String(e.getValue?.() ?? ''),
            sourceRef: sourceMeta.bpmnId,
            targetRef: targetMeta.bpmnId,
            direction: meta.direction,
        };

        if (meta.kind === 'messageFlow') {
            messageFlows.push(entry);
        } else if (meta.kind === 'association') {
            associations.push(entry);
        } else {
            const pool = cellToPool.get(source) ?? processes[0] ?? getDefaultProcess();
            pool.sequenceFlows.push(entry);
        }
    }

    return { processes, annotations, associations, messageFlows, edgeById };
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

function emitShapeDI(
    cell: Cell,
    bpmnId: string,
    defaultParent: Cell,
    extra: { isHorizontal?: boolean; isExpanded?: boolean } = {}
): string {
    const abs = absoluteGeometry(cell, defaultParent);
    const attrs = [`id="Shape_${escapeXml(bpmnId)}"`, `bpmnElement="${escapeXml(bpmnId)}"`];
    if (extra.isHorizontal) attrs.push('isHorizontal="true"');
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

    const hasCollaboration = model.processes.some(p => p.participantId);

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
        const messageFlowsXml = model.messageFlows.map(emitMessageFlow).join('');
        collaborationXml = `<bpmn2:collaboration id="Collaboration_1">${participantsXml}${messageFlowsXml}</bpmn2:collaboration>`;
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
            poolShapes.push(emitShapeDI(p.poolCell, p.participantId ?? p.id, defaultParent, { isHorizontal: true }));
        }
        for (const lane of p.lanes) {
            laneShapes.push(emitShapeDI(lane.cell, lane.id, defaultParent, { isHorizontal: true }));
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
