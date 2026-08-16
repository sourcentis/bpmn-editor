// src/bpmn-import.ts
import {Cell, EdgeParameters, Graph, Point, VertexParameters} from '@maxgraph/core';
import {showStatus} from './bpmn-edit';
import {
    addBPMNAnnotation,
    addBPMNConnection,
    addBPMNConversation,
    addBPMNGateway,
    addBPMNLane,
    addBPMNState,
    addBPMNData,
    addBPMNTask,
    centerGraphView,
    isLaneVertex,
    setCallActivityVertex,
    setDatabaseVertex,
    setIconCellValue,
    setInputDataVertex,
    setOutputDataVertex,
    setTransactionVertex
} from "./bpmn-helpers";
import {setAnnotationArrow, setAnnotationDirectionalArrow, setMessageFlow} from "./bpmn-arrows";
import {BPMN_ICONS} from "./bpmn-icons";
import {setAdHocMarker, setSubProcessMarker} from "./bpmn-badge";

// Sélection insensible au préfixe de namespace : matche par nom local.
function selectByLocalName(root: Document | Element, ...localNames: string[]): Element[] {
    const out: Element[] = [];
    for (const name of localNames) {
        const nodes = (root as Element).getElementsByTagNameNS
            ? (root as Element).getElementsByTagNameNS('*', name)
            : (root as Document).getElementsByTagNameNS('*', name);
        out.push(...Array.from(nodes));
    }
    return out;
}

// Lit les couleurs portées par un élément de diagramme (BPMNShape/BPMNEdge). Deux
// conventions coexistent : "BPMN in Color" (attributs background-color/border-color,
// préfixe usuel color:) et bpmn.io/Camunda bioc (fill/stroke, préfixe bioc:). On balaie
// les attributs par nom local plutôt que d'utiliser getAttributeNS('*', ...), qui n'est
// pas fiable pour cet usage selon les parseurs — ça reste ainsi insensible au préfixe.
function readDiagramColors(element: Element): { fill?: string; stroke?: string } {
    const byLocalName: Record<string, string> = {};
    for (const attr of Array.from(element.attributes)) {
        if (attr.value && !(attr.localName in byLocalName)) {
            byLocalName[attr.localName] = attr.value;
        }
    }
    const result: { fill?: string; stroke?: string } = {};
    const fill = byLocalName['background-color'] || byLocalName['fill'];
    const stroke = byLocalName['border-color'] || byLocalName['stroke'];
    if (fill) result.fill = fill;
    if (stroke) result.stroke = stroke;
    return result;
}

// Un sous-processus (subProcess/transaction/adHocSubProcess) est replié ou étendu selon
// l'attribut isExpanded du BPMNShape correspondant — porté par le diagramme, pas par
// l'élément sémantique. Absent : replié par défaut (valeur par défaut BPMN de isExpanded
// est "false").
function isCollapsedSubProcess(xmlDoc: Document, id: string | null): boolean {
    if (!id) return true;
    const shapes = xmlDoc.getElementsByTagNameNS('*', 'BPMNShape');
    for (const shape of Array.from(shapes)) {
        if (shape.getAttribute('bpmnElement') === id) {
            return shape.getAttribute('isExpanded') !== 'true';
        }
    }
    return true;
}

// Icône BPMN_ICONS pour un boundaryEvent, à partir de sa nature et de son caractère
// interruptif. Cette police n'a pas de glyphe "double cercle" dédié pour toutes les
// combinaisons (ex. message/timer/signal/error/conditional interruptifs) : on retombe
// alors sur l'icône catch équivalente, en avertissant.
function boundaryEventIcon(
    definition: string,
    interrupting: boolean,
    parallelMultiple: boolean
): keyof typeof BPMN_ICONS {
    if (!interrupting) {
        const nonInterrupt: Partial<Record<string, keyof typeof BPMN_ICONS>> = {
            message: 'MESSAGE_BOUND_NON_INTERRUPT_EVENT',
            timer: 'TIMER_BOUND_NON_INTERRUPT_EVENT',
            escalation: 'ESCALATION_BOUND_NON_INTERRUPT_EVENT',
            signal: 'SIGNAL_BOUND_NON_INTERRUPT_EVENT',
            multiple: 'MULTIPLE_BOUND_NON_INTERRUPT_EVENT',
        };
        const icon = nonInterrupt[definition];
        if (icon) return icon;
        console.log(`boundaryEventIcon: pas de variante non-interruptive pour "${definition}" — repli sur la variante interruptive`);
        // Pas de repli dédié : on continue sur la branche interruptive ci-dessous.
    }

    const interrupt: Partial<Record<string, keyof typeof BPMN_ICONS>> = {
        cancel: 'CANCEL_BOUND_EVENT',
        compensate: 'COMPENSATION_BOUND_EVENT',
        escalation: 'ESCALATION_BOUND_EVENT',
        multiple: parallelMultiple ? 'MULTIPLE_PARALLEL_BOUND_EVENT' : 'MULTIPLE_BOUND_EVENT',
    };
    const interruptIcon = interrupt[definition];
    if (interruptIcon) return interruptIcon;

    const catchFallback: Partial<Record<string, keyof typeof BPMN_ICONS>> = {
        message: 'MESSAGE_CATCH_EVENT',
        timer: 'TIMER_CATCH_EVENT',
        signal: 'SIGNAL_CATCH_EVENT',
        error: 'ERROR_CATCH_EVENT',
        conditional: 'CONDITIONAL_CATCH_EVENT',
    };
    console.log(`boundaryEventIcon: pas d'icône dédiée pour "${definition}" (interrupting=${interrupting}) — repli sur l'icône catch`);
    return catchFallback[definition] ?? 'INTER_EVENT';
}

// Icône BPMN_ICONS pour un event non-boundary, à partir de sa position (nom local du
// tag) et de sa nature (EventDefinition). Priorité : (1) combinaison exacte documentée,
// (2) icône générique de la nature la plus proche disponible, (3) icône générique de la
// position — jamais de constante inventée (cf. avertissements loggés).
function eventIcon(
    position: string,
    definition: string,
    interrupting: boolean,
    parallelMultiple: boolean
): keyof typeof BPMN_ICONS {
    if (position === 'boundaryEvent') {
        return boundaryEventIcon(definition, interrupting, parallelMultiple);
    }

    const exact: Partial<Record<string, keyof typeof BPMN_ICONS>> = {
        'none:startEvent': 'START_EVENT',
        'none:intermediateCatchEvent': 'INTER_EVENT',
        'none:intermediateThrowEvent': 'INTER_EVENT',
        'none:endEvent': 'END_EVENT',
        'message:startEvent': 'MESSAGE_START_EVENT',
        'message:intermediateCatchEvent': 'MESSAGE_CATCH_EVENT',
        'message:intermediateThrowEvent': 'MESSAGE_THROW_EVENT',
        'message:endEvent': 'MESSAGE_END_EVENT',
        'timer:startEvent': 'TIMER_START_EVENT',
        'timer:intermediateCatchEvent': 'TIMER_CATCH_EVENT',
        'signal:startEvent': 'SIGNAL_START_EVENT',
        'signal:intermediateCatchEvent': 'SIGNAL_CATCH_EVENT',
        'signal:intermediateThrowEvent': 'SIGNAL_THROW_EVENT',
        'signal:endEvent': 'SIGNAL_END_EVENT',
        'error:startEvent': 'ERROR_SUB_PROCESS_START_EVENT',
        'error:intermediateCatchEvent': 'ERROR_CATCH_EVENT',
        'error:endEvent': 'ERROR_END_EVENT',
        'escalation:startEvent': 'ESCALATION_START_EVENT',
        'escalation:endEvent': 'ESCALATION_END_EVENT',
        'conditional:startEvent': 'CONDITIONAL_START_EVENT',
        'conditional:intermediateCatchEvent': 'CONDITIONAL_CATCH_EVENT',
        'link:intermediateCatchEvent': 'LINK_CATCH_EVENT',
        'link:intermediateThrowEvent': 'LINK_THROW_EVENT',
        'link:endEvent': 'LINK_END_EVENT',
        'compensate:startEvent': 'COMPENSATION_SUB_PROCESS_START_EVENT',
        'compensate:intermediateThrowEvent': 'COMPENSATION_THROW_EVENT',
        'terminate:endEvent': 'TERMINATION_EVENT',
        'cancel:endEvent': 'CANCEL_END_EVENT',
        'multiple:startEvent': 'MULTIPLE_PARALLEL_START_EVENT',
        'multiple:intermediateThrowEvent': 'MULTIPLE_THROW_EVENT',
    };

    const key = `${definition}:${position}`;
    if (key === 'escalation:intermediateThrowEvent') {
        // Pas de constante d'escalade dédiée au throw : on réutilise celle de fin, la
        // plus proche visuellement disponible.
        console.log('eventIcon: pas d\'icône ESCALATION_THROW_EVENT dédiée — repli sur ESCALATION_END_EVENT');
        return 'ESCALATION_END_EVENT';
    }
    const exactIcon = exact[key];
    if (exactIcon) return exactIcon;

    // Repli niveau 2 : icône générique de la même nature (aucune combinaison dédiée pour
    // cette position — ex. timer en throw/end, multiple en catch/end).
    const natureFallback: Partial<Record<string, keyof typeof BPMN_ICONS>> = {
        message: 'MESSAGE_CATCH_EVENT',
        timer: 'TIMER_CATCH_EVENT',
        signal: 'SIGNAL_CATCH_EVENT',
        error: 'ERROR_CATCH_EVENT',
        escalation: 'ESCALATION_START_EVENT',
        conditional: 'CONDITIONAL_CATCH_EVENT',
        link: 'LINK_CATCH_EVENT',
        compensate: 'COMPENSATION_THROW_EVENT',
        terminate: 'TERMINATION_EVENT',
        cancel: 'CANCEL_END_EVENT',
        multiple: 'MULTIPLE_THROW_EVENT',
    };
    const natureIcon = definition !== 'none' ? natureFallback[definition] : undefined;
    if (natureIcon) {
        console.log(`eventIcon: pas d'icône dédiée pour (${definition}, ${position}) — repli sur ${natureIcon}`);
        return natureIcon;
    }

    // Repli niveau 3 : icône générique de la position.
    const positionFallback: Partial<Record<string, keyof typeof BPMN_ICONS>> = {
        startEvent: 'START_EVENT',
        intermediateCatchEvent: 'INTER_EVENT',
        intermediateThrowEvent: 'INTER_EVENT',
        endEvent: 'END_EVENT',
    };
    console.log(`eventIcon: aucune icône pour (${definition}, ${position}) — repli générique`);
    return positionFallback[position] ?? 'INTER_EVENT';
}

export interface BpmnElements {
    lanes: any[];
    laneSets: any[];
    processes: any[];
    events: any[];
    tasks: any[];
    gateways: any[];
    data: any[];
    flows: any[];
    messageFlow: any[];
    participants: any[];
    annotations: any[];
    associations: any[];
    conversationNodes: any[];
    conversationLinks: any[];
}

export interface BpmnPositions {
    [id: string]: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
}

export interface BpmnColors {
    [id: string]: {
        fill?: string;
        stroke?: string;
    };
}

export interface BpmnData {
    elements: BpmnElements;
    positions: BpmnPositions;
    labelPositions: Record<string, { x: number, y: number, width: number, height: number }>;
    colors: BpmnColors;
    laneOrientations: Record<string, boolean>;
    xmlDoc: Document;
}

// Descripteur BPMN posé sur chaque Cell créée par drawDiagram() — additif, ne modifie
// aucun comportement d'import existant (rien ne le lit ici). Porte ce que le modèle
// graphe/style ne permet pas de reconstruire sans perte ou ambiguïté à l'export : id
// BPMN d'origine (perdu par défaut pour tout ce qui n'est pas lane/process/participant,
// seul addBPMNLane reçoit un id explicite), sous-type exact (le distingo task/userTask/
// serviceTask/... ou startEvent/boundaryEvent/... ne survit pas à la seule icône posée,
// dont le mapping type -> icône est plusieurs-vers-un via les replis de eventIcon()),
// nature d'event, caractère interruptif, rattachement d'un boundaryEvent (perdu — un
// boundaryEvent est dessiné comme une cellule autonome dans sa lane, sans lien structurel
// vers l'activité attachedToRef), repli/expansion d'un sous-processus, et le processRef
// d'un participant (le process référencé n'a pas sa propre cellule).
export interface BpmnMeta {
    bpmnId: string;
    kind: string;
    definition?: string;
    interrupting?: boolean;
    attachedToRef?: string;
    parallelMultiple?: boolean;
    collapsed?: boolean;
    processRef?: string;
    direction?: string;
    // Bounds BPMNLabel d'origine (coordonnées absolues), capturées telles
    // quelles plutôt que reconstruites par inversion de la formule d'offset
    // de applyLabelPosition : cette formule dépend de résolutions de style
    // (verticalLabelPosition, spacing…) et surtout perd labelPos.height en
    // route pour certaines branches (vlp='bottom'/'middle' ne le réutilisent
    // jamais) — la capture directe est sans perte et beaucoup plus simple.
    labelBounds?: { x: number; y: number; width: number; height: number };
}

type CellWithMeta = Cell & { bpmnMeta?: BpmnMeta };

export function getBpmnMeta(cell: Cell): BpmnMeta | undefined {
    return (cell as CellWithMeta).bpmnMeta;
}

function setBpmnMeta(cell: Cell, meta: BpmnMeta): void {
    (cell as CellWithMeta).bpmnMeta = meta;
}

let currentBpmnData: BpmnData | null = null;

export function getCurrentBpmnData(): BpmnData | null {
    return currentBpmnData;
}

// Sanitize XML (défense en profondeur)
export function sanitizeXml(xml: string): string {
    return xml
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
        .trim();
}

// Parser BPMN
export function parseBPMN(xmlText: string): BpmnData {
    console.log('🔧 Début du parsing BPMN');
    const parser = new DOMParser();
    const sanitizedXmlText = sanitizeXml(xmlText);
    const xmlDoc = parser.parseFromString(sanitizedXmlText, 'application/xml');

    const parserError = xmlDoc.getElementsByTagName('parsererror')[0];
    if (parserError) {
        console.error('Erreur XML :', parserError.textContent);
        throw new Error(parserError.textContent || 'Erreur de parsing XML');
    }

    console.log('📦 Document XML parsé');

    const elements: BpmnElements = {
        lanes: [],
        laneSets: [],
        processes: [],
        events: [],
        tasks: [],
        gateways: [],
        data: [],
        flows: [],
        participants: [],
        annotations: [],
        associations: [],
        messageFlow: [],
        conversationNodes: [],
        conversationLinks: []
    };

    //---------------------
    // Processes
    const processes = selectByLocalName(xmlDoc, 'process');
    console.log(`📋 Processes trouvés: ${processes.length}`);

    for (const process of Array.from(processes)) {
        const processId = process.getAttribute('id');
        const processName = process.getAttribute('name') || '';

        console.log(`  📋 Process: ${processName} (${processId})`);

        elements.processes.push({
            id: processId,
            name: processName
        });
    }

    //---------------------
    // LaneSets et Lanes
    const laneSets = selectByLocalName(xmlDoc, 'laneSet');
    console.log(`🏊 LaneSets trouvés: ${laneSets.length}`);

    for (const laneSet of Array.from(laneSets)) {
        const laneSetId = laneSet.getAttribute('id');

        // Récupérer le process parent
        const processParent = laneSet.parentElement;
        const processId = processParent?.getAttribute('id') || '';
        const laneSetName = processParent?.getAttribute('name') || '';

        console.log(`  📋 LaneSet: ${laneSetId}, Process parent: ${laneSetName} (${processId})`);

        const lanes: any[] = [];

        // Récupérer toutes les lanes du laneSet
        const laneElements = selectByLocalName(laneSet, 'lane').filter(el => el.parentElement === laneSet);
        console.log(`  └─ Lanes dans ${laneSetId}: ${laneElements.length}`);

        for (const lane of Array.from(laneElements)) {
            const laneData = {
                id: lane.getAttribute('id'),
                name: lane.getAttribute('name'),
                flowNodeRefs: selectByLocalName(lane, 'flowNodeRef').map(
                    ref => ref.textContent?.trim()
                ).filter(Boolean)
            };
            lanes.push(laneData);
            console.log(`    • Lane: ${laneData.name} (${laneData.id})`);
        }

        if (lanes.length > 0) {
            elements.laneSets.push({
                id: laneSetId,
                name: laneSetName,
                processId: processId,
                lanes: lanes
            });
        }
    }

    // Parser également les lanes qui ne sont pas dans un laneSet
    const standaloneLanes = selectByLocalName(xmlDoc, 'lane').filter(el => {
        const parentLocalName = el.parentElement?.localName;
        return parentLocalName === 'process' || parentLocalName === 'collaboration';
    });
    console.log(`🏊 Lanes standalone trouvées: ${standaloneLanes.length}`);
    for (const lane of Array.from(standaloneLanes)) {
        elements.lanes.push({
            id: lane.getAttribute('id'),
            name: lane.getAttribute('name'),
            flowNodeRefs: selectByLocalName(lane, 'flowNodeRef').map(
                ref => ref.textContent?.trim()
            ).filter(Boolean)
        });
    }


    //---------------------
    // Participants
    const participants = selectByLocalName(xmlDoc, 'participant');
    console.log(`🏊 Participants trouvés: ${participants.length}`);
    for (const p of Array.from(participants)) {
        elements.participants.push({
            id: p.getAttribute('id'),
            name: p.getAttribute('name'),
            processRef: p.getAttribute('processRef'),
        });
    }

    //---------------------
    // Events
    const events = selectByLocalName(
        xmlDoc,
        'startEvent', 'endEvent', 'intermediateCatchEvent', 'intermediateThrowEvent', 'boundaryEvent'
    );
    console.log(`▶️ Events trouvés: ${events.length}`);
    for (const event of Array.from(events)) {
        // Nature de l'event = nom local du premier enfant *EventDefinition, réduit à sa
        // nature ("messageEventDefinition" -> "message") ; "multiple" si ≥2 définitions
        // (ou "none" en leur absence).
        const definitionEls = Array.from(event.children).filter(
            child => child.localName?.endsWith('EventDefinition')
        );
        let definition = 'none';
        if (definitionEls.length >= 2) {
            definition = 'multiple';
        } else if (definitionEls.length === 1) {
            definition = definitionEls[0].localName.replace(/EventDefinition$/, '');
        }

        // Interruptif par défaut (valeur par défaut BPMN) ; explicitement non-interruptif
        // seulement si cancelActivity="false" (boundary) ou isInterrupting="false" (start).
        const cancelActivity = event.getAttribute('cancelActivity');
        const isInterrupting = event.getAttribute('isInterrupting');
        const interrupting = !(cancelActivity === 'false' || isInterrupting === 'false');

        elements.events.push({
            id: event.getAttribute('id'),
            name: event.getAttribute('name'),
            // Nom local uniquement : insensible au préfixe (bpmn:, bpmn2:, model:, ...).
            type: event.localName,
            definition,
            interrupting,
            attachedToRef: event.localName === 'boundaryEvent' ? event.getAttribute('attachedToRef') : undefined,
            parallelMultiple: event.getAttribute('parallelMultiple') === 'true',
        });
    }

    //---------------------
    // Tasks / activités
    const tasks = selectByLocalName(
        xmlDoc,
        'task', 'userTask', 'manualTask', 'serviceTask', 'scriptTask', 'businessRuleTask',
        'sendTask', 'receiveTask', 'callActivity', 'subProcess', 'transaction', 'adHocSubProcess'
    );
    console.log(`📋 Tasks trouvées: ${tasks.length}`);
    for (const t of tasks) {
        const id = t.getAttribute('id');
        // Nom local uniquement : insensible au préfixe (bpmn:, bpmn2:, model:, ...).
        const type = t.localName;
        const entry: any = {
            id,
            name: t.getAttribute('name'),
            type,
        };
        if (type === 'subProcess' || type === 'transaction' || type === 'adHocSubProcess') {
            // Replié (marqueur "+") vs étendu : porté par isExpanded sur le BPMNShape, pas
            // sur l'élément sémantique. Par défaut BPMN (isExpanded absent) = replié.
            entry.collapsed = isCollapsedSubProcess(xmlDoc, id);
        }
        elements.tasks.push(entry);
    }

    //--------------------
    // Gateways
    const gateways = selectByLocalName(
        xmlDoc,
        'exclusiveGateway', 'parallelGateway', 'inclusiveGateway', 'eventBasedGateway', 'complexGateway'
    );
    console.log(`🔀 Gateways trouvés: ${gateways.length}`);
    gateways.forEach((g) => {
        elements.gateways.push({
            id: g.getAttribute('id'),
            name: g.getAttribute('name'),
            // Nom local uniquement : insensible au préfixe (bpmn:, bpmn2:, model:, ...).
            type: g.localName,
        });
    });

    //--------------------
    // Data (Data object / Datastore / Data input / Data output — voir DATA_ELEMENTS
    // dans bpmn-menu-select.ts, les 4 types que le menu contextuel sait poser).
    // dataObject/dataStore (sans "Reference") acceptés en repli : certains outils les
    // émettent directement au lieu de la paire définition+référence du schéma BPMN.
    const dataElements = selectByLocalName(
        xmlDoc,
        'dataObjectReference', 'dataObject', 'dataStoreReference', 'dataStore', 'dataInput', 'dataOutput'
    );
    console.log(`🗄️ Data trouvés: ${dataElements.length}`);
    dataElements.forEach((d) => {
        elements.data.push({
            id: d.getAttribute('id'),
            name: d.getAttribute('name'),
            // Nom local uniquement : insensible au préfixe (bpmn:, bpmn2:, model:, ...).
            type: d.localName,
        });
    });

    //---------------------
    // Flows
    const flows = xmlDoc.getElementsByTagNameNS('*', 'sequenceFlow');
    console.log(`➡️ Flows trouvés: ${flows.length}`);

    for (const f of Array.from(flows)) {
        const flowId = f.getAttribute('id');

        // Chercher l'élément BPMNEdge correspondant dans le diagramme
        const bpmnEdges = xmlDoc.getElementsByTagNameNS('*', 'BPMNEdge');
        let waypoints: Array<{x: number, y: number}> = [];

        for (const edge of Array.from(bpmnEdges)) {
            if (edge.getAttribute('bpmnElement') === flowId) {
                // Récupérer tous les waypoints
                const waypointElements = edge.getElementsByTagNameNS('*', 'waypoint');
                waypoints = Array.from(waypointElements).map(wp => ({
                    x: parseFloat(wp.getAttribute('x') || '0'),
                    y: parseFloat(wp.getAttribute('y') || '0')
                }));
                break;
            }
        }

        elements.flows.push({
            id: flowId,
            name: f.getAttribute('name'),
            source: f.getAttribute('sourceRef'),
            target: f.getAttribute('targetRef'),
            waypoints: waypoints
        });
    }

    //---------------------
    // messageFlow
    const messageFlows = xmlDoc.getElementsByTagNameNS('*', 'messageFlow');
    console.log(`➡️ messageFlow trouvés: ${messageFlows.length}`);

    for (const f of Array.from(messageFlows)) {
        const flowId = f.getAttribute('id');

        // Chercher l'élément BPMNEdge correspondant dans le diagramme
        const bpmnEdges = xmlDoc.getElementsByTagNameNS('*', 'BPMNEdge');
        let waypoints: Array<{x: number, y: number}> = [];

        for (const edge of Array.from(bpmnEdges)) {
            if (edge.getAttribute('bpmnElement') === flowId) {
                // Récupérer tous les waypoints
                const waypointElements = edge.getElementsByTagNameNS('*', 'waypoint');
                waypoints = Array.from(waypointElements).map(wp => ({
                    x: parseFloat(wp.getAttribute('x') || '0'),
                    y: parseFloat(wp.getAttribute('y') || '0')
                }));
                break;
            }
        }

        elements.messageFlow.push({
            id: flowId,
            source: f.getAttribute('sourceRef'),
            target: f.getAttribute('targetRef'),
            waypoints: waypoints
        });
    }

    //---------------------
    // Conversation diagrams (bpmn2:conversation / bpmn2:conversationLink,
    // toujours au niveau d'une <collaboration> — voir aussi elements.participants,
    // qui accueille déjà les "bandes" de participant sans processRef d'un diagramme
    // de conversation, sans distinction particulière). subConversation/
    // callConversation sont traités comme des conversation ordinaires : le
    // round-trip ne conserve que la forme (hexagone), pas la distinction structurelle.
    // 'conversationNode' est conservé pour relire les fichiers déjà exportés avec
    // l'ancien tag non standard (tête de substitution abstraite du XSD BPMN 2.0) —
    // selectByLocalName matche par nom local exact, donc aucun chevauchement possible
    // entre 'conversation' et 'conversationNode'.
    const conversationNodes = selectByLocalName(xmlDoc, 'conversation', 'conversationNode', 'subConversation', 'callConversation');
    console.log(`💬 ConversationNodes trouvés: ${conversationNodes.length}`);
    for (const cn of Array.from(conversationNodes)) {
        elements.conversationNodes.push({
            id: cn.getAttribute('id'),
            name: cn.getAttribute('name'),
        });
    }

    const conversationLinks = selectByLocalName(xmlDoc, 'conversationLink');
    console.log(`💬 ConversationLinks trouvés: ${conversationLinks.length}`);
    for (const link of Array.from(conversationLinks)) {
        const linkId = link.getAttribute('id');

        const bpmnEdges = xmlDoc.getElementsByTagNameNS('*', 'BPMNEdge');
        let waypoints: Array<{ x: number; y: number }> = [];
        for (const edge of Array.from(bpmnEdges)) {
            if (edge.getAttribute('bpmnElement') === linkId) {
                const waypointElements = edge.getElementsByTagNameNS('*', 'waypoint');
                waypoints = Array.from(waypointElements).map(wp => ({
                    x: parseFloat(wp.getAttribute('x') || '0'),
                    y: parseFloat(wp.getAttribute('y') || '0')
                }));
                break;
            }
        }

        elements.conversationLinks.push({
            id: linkId,
            name: link.getAttribute('name'),
            source: link.getAttribute('sourceRef'),
            target: link.getAttribute('targetRef'),
            waypoints: waypoints
        });
    }

    //---------------------
    // Annotations
    const annotations = selectByLocalName(xmlDoc, 'textAnnotation');
    console.log(`🏊 Annotations trouvées: ${annotations.length}`);
    for (const a of Array.from(annotations)) {
        console.log("annotation: ", selectByLocalName(a, 'text')[0]?.textContent);
        elements.annotations.push({
            id: a.getAttribute('id'),
            text: selectByLocalName(a, 'text')[0]?.textContent,
        });
    }

    //---------------------
    // Associations (trait pointillé reliant une annotation — ou plus généralement deux
    // éléments — via <association>). Porte les mêmes waypoints/BPMNEdge que les flows.
    const associations = selectByLocalName(xmlDoc, 'association');
    console.log(`🔗 Associations trouvées: ${associations.length}`);
    for (const assoc of Array.from(associations)) {
        const assocId = assoc.getAttribute('id');

        const bpmnEdges = xmlDoc.getElementsByTagNameNS('*', 'BPMNEdge');
        let waypoints: Array<{ x: number; y: number }> = [];
        for (const edge of Array.from(bpmnEdges)) {
            if (edge.getAttribute('bpmnElement') === assocId) {
                const waypointElements = edge.getElementsByTagNameNS('*', 'waypoint');
                waypoints = Array.from(waypointElements).map(wp => ({
                    x: parseFloat(wp.getAttribute('x') || '0'),
                    y: parseFloat(wp.getAttribute('y') || '0')
                }));
                break;
            }
        }

        elements.associations.push({
            id: assocId,
            source: assoc.getAttribute('sourceRef'),
            target: assoc.getAttribute('targetRef'),
            // "None" (par défaut) : pas de flèche. "One" : flèche vers targetRef.
            // "Both" : flèche aux deux extrémités.
            direction: assoc.getAttribute('associationDirection') || 'None',
            waypoints,
        });
    }

    //---------------------
    // Positions
    const shapes = xmlDoc.getElementsByTagNameNS('*', 'BPMNShape');
    console.log(`📐 Shapes trouvés: ${shapes.length}`);
    const positions: BpmnPositions = {};
    const labelPositions: Record<string, { x: number, y: number, width: number, height: number }> = {};
    const colors: BpmnColors = {};
    // Orientation DI (attribut isHorizontal du BPMNShape) d'un pool/lane/participant —
    // seuls ces éléments en tiennent compte (voir addBPMNLane / AddBPMNLaneOptions.
    // isHorizontal), mais capturée pour tous les shapes ici, au même endroit que le
    // reste de leur DI. Par défaut BPMN (attribut absent) = true.
    const laneOrientations: Record<string, boolean> = {};

    for (const shape of Array.from(shapes)) {
        const id = shape.getAttribute('bpmnElement');
        const bounds = shape.getElementsByTagNameNS('*', 'Bounds')[0];

        if (id && bounds) {
            positions[id] = {
                x: parseFloat(bounds.getAttribute('x') || '0'),
                y: parseFloat(bounds.getAttribute('y') || '0'),
                width: parseFloat(bounds.getAttribute('width') || '0'),
                height: parseFloat(bounds.getAttribute('height') || '0'),
            };
            laneOrientations[id] = shape.getAttribute('isHorizontal') !== 'false';

            // Couleurs de remplissage/bordure (BPMN in Color ou bioc), si présentes
            const shapeColors = readDiagramColors(shape);
            if (shapeColors.fill || shapeColors.stroke) {
                colors[id] = shapeColors;
            }

            // Parser la position du label si elle existe
            const label = shape.getElementsByTagNameNS('*', 'BPMNLabel')[0];
            if (label) {
                const labelBounds = label.getElementsByTagNameNS('*', 'Bounds')[0];
                if (labelBounds) {
                    labelPositions[id] = {
                        x: parseFloat(labelBounds.getAttribute('x') || '0'),
                        y: parseFloat(labelBounds.getAttribute('y') || '0'),
                        width: parseFloat(labelBounds.getAttribute('width') || '0'),
                        height: parseFloat(labelBounds.getAttribute('height') || '0'),
                    };
                    console.log(`📝 Label pour ${id}: (${labelPositions[id].x}, ${labelPositions[id].y})`);
                }
            }
        }
    }

    console.log('📍 Positions récupérées:', Object.keys(positions).length);

    // Parser les positions des labels sur les BPMNEdge (sequenceFlow, messageFlow)
    const bpmnEdgeElements = xmlDoc.getElementsByTagNameNS('*', 'BPMNEdge');
    for (const edge of Array.from(bpmnEdgeElements)) {
        const flowId = edge.getAttribute('bpmnElement');
        if (flowId) {
            const label = edge.getElementsByTagNameNS('*', 'BPMNLabel')[0];
            if (label) {
                const labelBounds = label.getElementsByTagNameNS('*', 'Bounds')[0];
                if (labelBounds) {
                    labelPositions[flowId] = {
                        x: parseFloat(labelBounds.getAttribute('x') || '0'),
                        y: parseFloat(labelBounds.getAttribute('y') || '0'),
                        width: parseFloat(labelBounds.getAttribute('width') || '0'),
                        height: parseFloat(labelBounds.getAttribute('height') || '0'),
                    };
                }
            }

            // Couleur de trait (un flow n'a pas de remplissage)
            const edgeColors = readDiagramColors(edge);
            if (edgeColors.stroke) {
                colors[flowId] = { stroke: edgeColors.stroke };
            }
        }
    }

    console.log('📝 Labels récupérés:', Object.keys(labelPositions).length);
    console.log('✅ Parsing terminé avec succès');

    const data: BpmnData = { elements, positions, labelPositions, colors, laneOrientations, xmlDoc };
    currentBpmnData = data;

    return data;
}

//=============================================
// Changes swimlane orientation while collapsed
const getStyle = function (this: Cell) {
    if (!this.isCollapsed()) {
        return this.style;
    }
    // Need to create a copy the original style as we don't want to change the original style stored in the Cell
    // Otherwise, when expanding the cell, the style will be incorrect
    const style = { ...this.style };
    style.horizontal = true;
    style.align = 'left';
    style.spacingLeft = 14;
    return style;
};

const insertVertex = (graph: Graph, options: VertexParameters) => {
    const v = graph.insertVertex(options);
    v.getStyle = getStyle;
    return v;
};

const insertEdge = (graph: Graph, options: EdgeParameters) => {
    const e = graph.insertEdge(options);
    e.getStyle = getStyle;
    return e;
};
//=============================================

// Dessiner le diagramme
export function drawDiagram(graph: Graph, data: BpmnData): void {
    console.log('🎨 Début du dessin du diagramme');
    const { elements, positions, labelPositions, colors, laneOrientations } = data;
    const parent = graph.getDefaultParent();
    const vertexMap: Record<string, Cell> = {};

    // Couleur de remplissage effective déjà résolue (propre ou héritée) par id — permet à
    // l'héritage de se propager en cascade entre lanes (process/participant -> lane ->
    // sous-lane), pas seulement sur un niveau. Les events/tasks/gateways n'héritent PAS
    // de leur lane : sans couleur propre dans le fichier importé, ils gardent le blanc
    // par défaut du style.
    const effectiveFill: Record<string, string> = {};

    // Applique, de façon gardée, la couleur de remplissage/bordure lue dans le diagramme
    // (BPMN in Color ou bioc) — n'écrase jamais le style par défaut quand la couleur est
    // absente. Pour une lane, "fillColor" ne peint que le bandeau de titre (shape
    // "swimlane" de maxgraph) : il faut aussi poser "swimlaneFillColor" pour que le
    // remplissage couvre toute la lane. `inheritFillFrom` permet à une lane sans couleur
    // propre de reprendre le remplissage effectif de son process/participant parent (déjà
    // résolu à cet instant, puisque les parents sont toujours dessinés avant leurs
    // enfants) — réservé aux lanes, jamais passé pour un event/task/gateway.
    const applyColors = (cell: Cell, id: string, inheritFillFrom?: string) => {
        const c = colors[id];
        const fill = c?.fill ?? (inheritFillFrom ? effectiveFill[inheritFillFrom] : undefined);
        if (fill) {
            effectiveFill[id] = fill;
            graph.setCellStyles('fillColor', fill, [cell]);
            if (isLaneVertex(graph, cell)) {
                graph.setCellStyles('swimlaneFillColor', fill, [cell]);
            }
        }
        if (c?.stroke) graph.setCellStyles('strokeColor', c.stroke, [cell]);
    };

    // Largeur de bandeau de titre (startSize) de repli, utilisée pour un participant/process
    // qui n'a pas ses propres lanes : on aligne son titre sur celui des autres pools du même
    // diagramme (déduit de n'importe quel laneSet existant) plutôt que de retomber sur la
    // valeur par défaut du style — sinon les colonnes de titre ne s'alignent pas visuellement
    // entre pools d'une même collaboration.
    // Orientation d'un pool/process/lane conteneur : son propre BPMNShape s'il en a
    // un (un pool/participant en a toujours un ; un process nu, sans collaboration,
    // n'en a AUCUN), sinon celle de sa première lane (censées toutes partager la
    // même orientation — voir AddBPMNLaneOptions.isHorizontal dans bpmn-helpers.ts),
    // sinon le défaut BPMN true.
    const resolveContainerIsHorizontal = (containerId: string, lanes: any[]): boolean =>
        laneOrientations[containerId] ?? laneOrientations[lanes[0]?.id] ?? true;

    // Décalage entre une lane et son conteneur, projeté sur l'axe pertinent pour son
    // bandeau de titre — X pour un pool "isHorizontal" (titre vertical à gauche, le
    // cas courant), Y pour un pool vertical (titre horizontal en haut). Voir
    // AddBPMNLaneOptions.isHorizontal dans bpmn-helpers.ts pour la correspondance
    // avec le style maxGraph "horizontal" (sens inverse).
    const laneTitleOffset = (isHorizontal: boolean, containerPos: { x: number; y: number }, lanePos: { x: number; y: number }): number =>
        isHorizontal ? lanePos.x - containerPos.x : lanePos.y - containerPos.y;

    const defaultLaneTitleSize = ((): number | undefined => {
        const offsets: number[] = [];
        elements.laneSets.forEach(ls => {
            const owningParticipant = elements.participants.find(p => p.processRef === ls.processId);
            const containerId = owningParticipant ? owningParticipant.id : ls.processId;
            const containerPos = positions[containerId];
            if (!containerPos) return;
            const isHorizontal = resolveContainerIsHorizontal(containerId, ls.lanes);
            ls.lanes.forEach((lane: any) => {
                const lanePos = positions[lane.id];
                if (lanePos) offsets.push(laneTitleOffset(isHorizontal, containerPos, lanePos));
            });
        });
        return offsets.length > 0 ? Math.min(...offsets) : undefined;
    })();

    graph.model.beginUpdate();
    try {
        // Clear graph
        graph.removeCells(graph.getChildCells(parent));
        console.log('🧹 Cellules précédentes supprimées');

        //---------------------
        // Processes (créer des lanes pour les process non référencés par des participants)
        elements.processes.forEach((process) => {
            // Vérifier si ce process est référencé par un participant
            const isReferencedByParticipant = elements.participants.some(p => p.processRef === process.id);

            if (isReferencedByParticipant) {
                console.log(`📋 Process ${process.name} (${process.id}) déjà géré par un participant - skip`);
                return;
            }

            console.log(`📋 Traitement Process: ${process.name} (${process.id})`);

            // Trouver les laneSets qui appartiennent à ce process
            const processLaneSets = elements.laneSets.filter(ls => ls.processId === process.id);

            if (processLaneSets.length === 0) {
                // Process sans laneSet - ne pas créer de lane pour le process
                console.log(`  ℹ️ Process ${process.id} sans laneSet`);
                return;
            }

            // Collecter toutes les lanes de tous les laneSets de ce process
            const allProcessLanes: any[] = [];
            processLaneSets.forEach(ls => {
                allProcessLanes.push(...ls.lanes);
            });

            if (allProcessLanes.length === 0) {
                console.warn(`⚠️ Pas de lanes pour le process ${process.id}`);
                return;
            }

            // Calculer la position du process à partir des lanes
            const allLanePositions = allProcessLanes
                .map(lane => positions[lane.id])
                .filter(Boolean);

            if (allLanePositions.length === 0) {
                console.warn(`⚠️ Pas de position pour le process ${process.id}`);
                return;
            }

            const minX = Math.min(...allLanePositions.map(p => p.x));
            const minY = Math.min(...allLanePositions.map(p => p.y));
            const maxX = Math.max(...allLanePositions.map(p => p.x + p.width));
            const maxY = Math.max(...allLanePositions.map(p => p.y + p.height));

            const processPos = {
                x: minX,
                y: minY,
                width: maxX - minX,
                height: maxY - minY
            };

            // Le process lui-même n'a de BPMNShape propre que s'il est référencé par un
            // participant (cas géré séparément, voir plus bas) — un process nu (pas de
            // pool/collaboration) n'a AUCUN shape pour lire son isHorizontal, d'où le
            // repli sur ses lanes dans resolveContainerIsHorizontal.
            const processIsHorizontal = resolveContainerIsHorizontal(process.id, allProcessLanes);

            // Largeur du bandeau de titre (startSize) calée sur le début réel des lanes —
            // voir addBPMNLane / AddBPMNLaneOptions.titleSize.
            const processLaneOffsets = allProcessLanes
                .map((lane: any) => positions[lane.id])
                .filter(Boolean)
                .map((lp: any) => laneTitleOffset(processIsHorizontal, processPos, lp));
            const processTitleSize = processLaneOffsets.length > 0 ? Math.min(...processLaneOffsets) : defaultLaneTitleSize;

            // Créer la lane pour le process
            const processVertex = addBPMNLane(graph, parent, {
                id: process.id,
                value: process.name || process.id || 'Process',
                x: processPos.x,
                y: processPos.y,
                width: processPos.width,
                height: processPos.height,
                titleSize: processTitleSize,
                isHorizontal: processIsHorizontal,
            });

            vertexMap[process.id] = processVertex;
            applyColors(processVertex, process.id);
            setBpmnMeta(processVertex, { bpmnId: process.id, kind: 'process' });

            // Créer les lanes directement dans le process (sans niveau laneSet)
            allProcessLanes.forEach((lane: any) => {
                const lanePos = positions[lane.id];
                if (!lanePos) {
                    console.warn(`⚠️ Pas de position pour la lane ${lane.id}`);
                    return;
                }

                // Position relative au process parent (délta des coordonnées BPMN absolues)
                const relativeX = lanePos.x - processPos.x;
                const relativeY = lanePos.y - processPos.y;

                console.log(`  └─ Lane: ${lane.name} (${lane.id}) - pos relative: [${relativeX}, ${relativeY}]`);

                const laneVertex = addBPMNLane(graph, processVertex, {
                    id: lane.id,
                    value: lane.name || '',
                    x: relativeX,
                    y: relativeY,
                    width: lanePos.width,
                    height: lanePos.height,
                    // Même largeur de titre que le process parent, pour la cohérence visuelle
                    // entre les deux bandeaux imbriqués.
                    titleSize: processTitleSize,
                    isHorizontal: processIsHorizontal,
                });

                vertexMap[lane.id] = laneVertex;
                // Une lane sans couleur propre hérite de celle du process : sinon, comme
                // les lanes couvrent tout le contenu du process, leur fond blanc par
                // défaut masquerait entièrement la couleur du process.
                applyColors(laneVertex, lane.id, process.id);
                setBpmnMeta(laneVertex, { bpmnId: lane.id, kind: 'lane' });
            });

            // Mettre le process en arrière-plan
            graph.orderCells(true, [processVertex]);
        });

        //---------------------
        // Lanes
        elements.lanes.forEach((lane) => {
            const pos = positions[lane.id] || { x: 0, y: 0, width: 36, height: 36 };

            // Ajouter le carré
            const parent = graph.getDefaultParent();

            const vertex = addBPMNLane(graph, parent, {
                id: lane.id,
                value: lane.name || 'Lane',
                x: pos.x,
                y: pos.y,
                width: pos.width,
                height: pos.height,
                isHorizontal: laneOrientations[lane.id] ?? true,
            });

            vertexMap[lane.id] = vertex;
            applyColors(vertex, lane.id);
            setBpmnMeta(vertex, { bpmnId: lane.id, kind: 'lane' });

            // Mettre en arrière plan
            graph.orderCells(true, [vertex]);


        });

        //---------------------
        // Participants (créer des lanes pour les participants avec processRef)
        elements.participants.forEach((p) => {
            const pos = positions[p.id] || { x: 100, y: 100, width: 600, height: 250 };

            // Si le participant a un processRef, il devient une lane parent pour le process
            if (p.processRef) {
                const referencedProcess = elements.processes.find(proc => proc.id === p.processRef);
                if (referencedProcess) {
                    console.log(`👤 Participant avec processRef: ${p.name} -> ${referencedProcess.name}`);

                    // Trouver les laneSets de ce process
                    const processLaneSets = elements.laneSets.filter(ls => ls.processId === referencedProcess.id);

                    // Collecter toutes les lanes
                    const allProcessLanes: any[] = [];
                    processLaneSets.forEach(ls => {
                        allProcessLanes.push(...ls.lanes);
                    });

                    const participantIsHorizontal = resolveContainerIsHorizontal(p.id, allProcessLanes);

                    // Largeur du bandeau de titre (startSize) calée sur le début réel des
                    // lanes — voir addBPMNLane / AddBPMNLaneOptions.titleSize.
                    const laneOffsets = allProcessLanes
                        .map((lane: any) => positions[lane.id])
                        .filter(Boolean)
                        .map((lp: any) => laneTitleOffset(participantIsHorizontal, pos, lp));
                    const titleSize = laneOffsets.length > 0 ? Math.min(...laneOffsets) : defaultLaneTitleSize;

                    // Le participant devient la lane principale
                    const participantVertex = addBPMNLane(graph, parent, {
                        id: p.id,
                        value: p.name || 'Participant',
                        x: pos.x,
                        y: pos.y,
                        width: pos.width,
                        height: pos.height,
                        titleSize,
                        isHorizontal: participantIsHorizontal,
                    });

                    vertexMap[p.id] = participantVertex;
                    applyColors(participantVertex, p.id);
                    setBpmnMeta(participantVertex, { bpmnId: p.id, kind: 'participant', processRef: referencedProcess.id });

                    // Créer les lanes directement dans le participant
                    allProcessLanes.forEach((lane: any) => {
                        const lanePos = positions[lane.id];
                        if (!lanePos) {
                            console.warn(`⚠️ Pas de position pour la lane ${lane.id}`);
                            return;
                        }

                        // Position relative au participant parent (délta des coordonnées BPMN absolues)
                        const relativeX = lanePos.x - pos.x;
                        const relativeY = lanePos.y - pos.y;

                        console.log(`  └─ Lane: ${lane.name} (${lane.id}) - pos relative: [${relativeX}, ${relativeY}]`);

                        const laneVertex = addBPMNLane(graph, participantVertex, {
                            id: lane.id,
                            value: lane.name || '',
                            x: relativeX,
                            y: relativeY,
                            width: lanePos.width,
                            height: lanePos.height,
                            // Même largeur de titre que le participant parent, pour la
                            // cohérence visuelle entre les deux bandeaux imbriqués.
                            titleSize,
                            isHorizontal: participantIsHorizontal,
                        });

                        vertexMap[lane.id] = laneVertex;
                        // Une lane sans couleur propre hérite de celle du participant :
                        // sinon, comme les lanes couvrent tout le contenu du participant,
                        // leur fond blanc par défaut masquerait entièrement sa couleur.
                        applyColors(laneVertex, lane.id, p.id);
                        setBpmnMeta(laneVertex, { bpmnId: lane.id, kind: 'lane' });
                    });

                    // Mettre le participant en arrière-plan
                    graph.orderCells(true, [participantVertex]);
                } else {
                    // ProcessRef non trouvé, créer un participant simple
                    const simpleVertex = addBPMNLane(graph, parent, {
                        id: p.id,
                        value: p.name || 'Participant',
                        x: pos.x,
                        y: pos.y,
                        width: pos.width,
                        height: pos.height,
                        titleSize: defaultLaneTitleSize,
                        isHorizontal: laneOrientations[p.id] ?? true,
                    });
                    vertexMap[p.id] = simpleVertex;
                    applyColors(simpleVertex, p.id);
                    setBpmnMeta(simpleVertex, { bpmnId: p.id, kind: 'participant', processRef: p.processRef });
                }
            } else {
                // Participant sans processRef : le cas courant est une "bande" de
                // participant d'un diagramme de conversation BPMN (voir
                // elements.conversationNodes/conversationLinks) — dessinée comme un
                // simple rectangle étiqueté en haut, pas comme un pool/lane classique
                // (bandeau de titre vertical à gauche) : horizontal=true l'emporte sur
                // le horizontal=false par défaut du style "lane".
                const simpleVertex = addBPMNLane(graph, parent, {
                    id: p.id,
                    value: p.name || 'Participant',
                    x: pos.x,
                    y: pos.y,
                    width: pos.width,
                    height: pos.height,
                    titleSize: defaultLaneTitleSize,
                });
                graph.setCellStyles('horizontal', true, [simpleVertex]);
                vertexMap[p.id] = simpleVertex;
                applyColors(simpleVertex, p.id);
                setBpmnMeta(simpleVertex, { bpmnId: p.id, kind: 'participant' });
            }
        });

        //---------------------
        // Créer une map des flowNodes vers leurs lanes parentes
        const flowNodeToLane: Record<string, { laneId: string, processId?: string }> = {};

        // Pour les lanes dans les laneSets (qui sont dans les processes)
        elements.laneSets.forEach((laneSet) => {
            laneSet.lanes.forEach((lane: any) => {
                lane.flowNodeRefs?.forEach((flowNodeId: string) => {
                    flowNodeToLane[flowNodeId] = {
                        laneId: lane.id,
                        processId: laneSet.processId
                    };
                });
            });
        });

        // Pour les lanes standalone
        elements.lanes.forEach((lane) => {
            lane.flowNodeRefs?.forEach((flowNodeId: string) => {
                flowNodeToLane[flowNodeId] = { laneId: lane.id };
            });
        });

        // Fonction helper pour obtenir le parent et la position relative d'un flowNode
        const getParentAndPosition = (flowNodeId: string, absolutePos: { x: number, y: number, width: number, height: number }) => {
            const laneInfo = flowNodeToLane[flowNodeId];
            if (!laneInfo) {
                // Pas de lane parent, utiliser le parent par défaut
                return {
                    parent: parent,
                    x: absolutePos.x,
                    y: absolutePos.y
                };
            }

            const laneVertex = vertexMap[laneInfo.laneId];
            if (!laneVertex) {
                console.warn(`⚠️ Lane ${laneInfo.laneId} introuvable pour flowNode ${flowNodeId}`);
                return {
                    parent: parent,
                    x: absolutePos.x,
                    y: absolutePos.y
                };
            }

            const lanePos = positions[laneInfo.laneId];
            if (!lanePos) {
                console.warn(`⚠️ Position de lane ${laneInfo.laneId} introuvable`);
                return {
                    parent: parent,
                    x: absolutePos.x,
                    y: absolutePos.y
                };
            }

            // Position relative au sein de la lane : délta pur des coordonnées BPMN
            // absolues. La lane elle-même est positionnée par le même calcul (voir
            // plus haut), donc l'empilement des deltas reconstruit exactement les
            // coordonnées d'origine, sans compensation additionnelle nécessaire.
            const relativeX = absolutePos.x - lanePos.x;
            const relativeY = absolutePos.y - lanePos.y;

            return {
                parent: laneVertex,
                x: relativeX,
                y: relativeY
            };
        };

        // Calcule le point médian exact (en longueur d'arc) d'un chemin polylignal.
        const computeEdgeMidpoint = (waypoints: Array<{ x: number; y: number }>): { x: number; y: number } => {
            if (waypoints.length === 0) return { x: 0, y: 0 };
            if (waypoints.length === 1) return waypoints[0];
            let totalLength = 0;
            const segLengths: number[] = [];
            for (let i = 1; i < waypoints.length; i++) {
                const dx = waypoints[i].x - waypoints[i - 1].x;
                const dy = waypoints[i].y - waypoints[i - 1].y;
                const len = Math.sqrt(dx * dx + dy * dy);
                segLengths.push(len);
                totalLength += len;
            }
            const half = totalLength / 2;
            let accumulated = 0;
            for (let i = 0; i < segLengths.length; i++) {
                if (accumulated + segLengths[i] >= half) {
                    const t = segLengths[i] > 0 ? (half - accumulated) / segLengths[i] : 0;
                    return {
                        x: waypoints[i].x + t * (waypoints[i + 1].x - waypoints[i].x),
                        y: waypoints[i].y + t * (waypoints[i + 1].y - waypoints[i].y)
                    };
                }
                accumulated += segLengths[i];
            }
            return waypoints[waypoints.length - 1];
        };

        // Ancre le point d'entrée/sortie exact d'un edge sur son extrémité, à partir des
        // coordonnées BPMN absolues du premier/dernier waypoint.
        //
        // `geometry.sourcePoint`/`targetPoint` sont ignorés par maxgraph dès que l'edge a
        // une cellule source/target attachée (voir GraphView.getFixedTerminalPoint : ils ne
        // sont lus que si `terminal` est absent) — ce qui est toujours notre cas ici. Le
        // point réellement utilisé est calculé via une ConnectionConstraint, elle-même lue
        // depuis le style de l'edge : exitX/exitY (source) et entryX/entryY (target), en
        // fraction [0,1] de la boîte englobante de la cellule (voir ConnectionsMixin.
        // getConnectionConstraint). Sans ça, maxgraph retombe sur l'intersection générique
        // du périmètre en direction du point de routage suivant, qui ne correspond au point
        // BPMN d'origine que par coïncidence (segments déjà alignés avec le centre de la
        // forme) — d'où des points de départ/arrivée décalés, surtout visible dès qu'un flux
        // traverse une lane.
        const applyEdgeAnchors = (
            edge: Cell,
            sourceGeo: { width: number; height: number },
            sourceAbsX: number,
            sourceAbsY: number,
            targetGeo: { width: number; height: number },
            targetAbsX: number,
            targetAbsY: number,
            firstWaypoint: { x: number; y: number },
            lastWaypoint: { x: number; y: number }
        ) => {
            const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
            if (sourceGeo.width > 0 && sourceGeo.height > 0) {
                graph.setCellStyles('exitX', clamp01((firstWaypoint.x - sourceAbsX) / sourceGeo.width), [edge]);
                graph.setCellStyles('exitY', clamp01((firstWaypoint.y - sourceAbsY) / sourceGeo.height), [edge]);
            }
            if (targetGeo.width > 0 && targetGeo.height > 0) {
                graph.setCellStyles('entryX', clamp01((lastWaypoint.x - targetAbsX) / targetGeo.width), [edge]);
                graph.setCellStyles('entryY', clamp01((lastWaypoint.y - targetAbsY) / targetGeo.height), [edge]);
            }
        };

        // Position absolue (coordonnées BPMN globales) d'une cellule : remonte la chaîne
        // des parents jusqu'à la racine en sommant leurs géométries respectives.
        const getAbsolutePosition = (cell: Cell): { x: number; y: number } => {
            const geo = cell.getGeometry();
            let x = geo?.x ?? 0;
            let y = geo?.y ?? 0;
            let p = cell.getParent();
            while (p && p !== parent) {
                const pg = p.getGeometry();
                if (pg) {
                    x += pg.x;
                    y += pg.y;
                }
                p = p.getParent();
            }
            return { x, y };
        };

        // Positionne le label d'un vertex selon les coordonnées BPMN absolues.
        //
        // Pipeline MaxGraph (vérifié sur le source de @maxgraph/core@0.21.0) :
        //
        //   updateCellState() :
        //     absoluteOffset.x = scale * geometry.offset.x
        //     absoluteOffset.y = scale * geometry.offset.y
        //
        //   updateVertexLabelOffset() (appelé juste après) :
        //     si VLP='bottom' : absoluteOffset.y += state.height
        //     si VLP='top'    : absoluteOffset.y -= state.height
        //
        //   CellRenderer.getLabelBounds() :
        //     bounds.x = state.x + absoluteOffset.x
        //     bounds.y = state.y + absoluteOffset.y
        //
        //   rotateLabelBounds() (toujours appelé) :
        //     bounds.y -= textShape.margin.y * bounds.height   // margin.y = -1 si valign='top' → +bounds.height
        //     bounds.x -= textShape.margin.x * bounds.width    // margin.x = -0.5 si align='center'
        //     bounds.x += spacing.x * scale                    // spacing.x = (spacingLeft - spacingRight) / 2
        //     bounds.y += spacing.y * scale                    // spacing.y = spacingTop + baseSpacing (si valign='top')
        //
        // Pour VLP='bottom' + valign='top' (gateway, state, conversation) :
        //   bounds.y = vertexY + offset.y + vertexH + (-(-1) * labelH) + (spacingTop + baseSpacing)
        //            = vertexY + offset.y + vertexH + labelH + spacingTop + baseSpacing
        //   On veut bounds.y = labelPos.y  →
        //   offset.y = labelPos.y - vertexY - vertexH - labelH - spacingTop - baseSpacing
        //
        //   bounds.x = vertexX + offset.x + (-(-0.5) * labelW) + (spacingLeft - spacingRight) / 2
        //            = vertexX + offset.x + 0.5*labelW + (spacingLeft - spacingRight)/2
        //   On veut bounds.x = labelPos.x  →
        //   offset.x = labelPos.x - vertexX - 0.5*labelW - (spacingLeft - spacingRight)/2
        //
        // Pour VLP='middle' + valign='middle' (process/task, label interne centré) :
        //   offset = labelCenter - vertexCenter  (margin.y=-0.5, spacing s'annule)
        //
        // Les deux formules portent sur des différences de coordonnées BPMN absolues :
        // elles sont invariantes par rapport au repère du conteneur (swimlane).
        const applyLabelPosition = (
            vertex: Cell,
            elementId: string,
            elementPos: { x: number; y: number; width: number; height: number }
        ) => {
            const labelPos = labelPositions[elementId];
            if (!labelPos || !vertex) return;

            const geometry = vertex.getGeometry();
            if (!geometry) return;

            // graph.getCellStyle() résout les baseStyleNames → valeurs effectives
            const rs = graph.getCellStyle(vertex) as any;
            const vlp = (rs?.verticalLabelPosition ?? 'middle') as string;
            const baseSpacing  = (rs?.spacing      ?? 2)  as number;
            const spacingTop   = (rs?.spacingTop   ?? 0)  as number;
            const spacingLeft  = (rs?.spacingLeft  ?? 0)  as number;
            const spacingRight = (rs?.spacingRight ?? 0)  as number;

            let offsetX: number;
            let offsetY: number;

            if (vlp === 'bottom') {
                // BPMN DI : BPMNLabel/Bounds = coin haut-gauche ABSOLU du label sur le plan.
                //
                // Le rendu réel (labels HTML/foreignObject, mesuré dans un navigateur,
                // cf. `applyLabelPosition`) diffère du pipeline SVG texte pur : le
                // correctif géométrique de `rotateLabelBounds` (margin.x lié à
                // align='center') n'est pas visible sur ce chemin de rendu — seul le
                // décalage de `updateVertexLabelOffset` (dû à labelWidth ≠ largeur du
                // sommet) s'applique. La boîte du label (largeur = labelPos.width) est
                // donc positionnée par :
                //   bx = vx + offsetX - (labelWidth - vw)/2 + (spacingLeft - spacingRight)/2
                //   by = vy + offsetY + vh + spacing + spacingTop
                // On impose (bx, by) = (labelPos.x, labelPos.y) :
                const spacingX = (spacingLeft - spacingRight) / 2;
                const spacingY = baseSpacing + spacingTop; // baseSpacing = style.spacing
                offsetX = labelPos.x - elementPos.x + 0.5 * (labelPos.width - elementPos.width) - spacingX;
                offsetY = labelPos.y - elementPos.y - elementPos.height - spacingY;
            } else if (vlp === 'top') {
                const spacingY = spacingTop + baseSpacing;
                const spacingX = (spacingLeft - spacingRight) / 2;
                offsetX = labelPos.x - elementPos.x - 0.5 * labelPos.width - spacingX;
                offsetY = labelPos.y + labelPos.height - elementPos.y + elementPos.height - spacingY;
            } else {
                // VLP='middle' : valign='middle' → margin.y = -0.5, spacing.y s'annule
                // bounds.y = vertexY + offset.y + (-(-0.5)*labelH) = vertexY + offset.y + 0.5*labelH
                // On veut bounds.y = labelPos.y → offset.y = labelPos.y - vertexY - 0.5*labelH
                // Équivalent : offset = labelCenter - vertexCenter
                offsetX = (labelPos.x + labelPos.width  / 2) - (elementPos.x + elementPos.width  / 2);
                offsetY = (labelPos.y + labelPos.height / 2) - (elementPos.y + elementPos.height / 2);
            }

            geometry.offset = new Point(offsetX, offsetY);

            // labelWidth contrôle le retour à la ligne — mutation directe
            const cellStyle = vertex.getStyle();
            cellStyle.labelWidth = labelPos.width;
            vertex.setStyle(cellStyle);

            vertex.setGeometry(geometry);

            console.log(`📝 Label ${elementId} (vlp=${vlp}): offset=(${offsetX.toFixed(1)}, ${offsetY.toFixed(1)}), labelWidth=${labelPos.width}`);
        };

        //---------------------
        // Events
        elements.events.forEach((event) => {
            console.log("Add event ", event);
            const pos = positions[event.id] || { x: 200, y: 150, width: 36, height: 36 };

            // Obtenir le parent correct et la position relative. Limite connue : un
            // boundaryEvent est positionné via sa lane (flowNodeRef), pas rattaché à la
            // cellule de l'activité désignée par attachedToRef — cela reconstruit déjà la
            // position absolue exacte du diagramme d'origine, donc pas de régression
            // visuelle, mais la cellule ne suit pas l'activité si celle-ci est déplacée.
            const { parent: eventParent, x, y } = getParentAndPosition(event.id, pos);

            const vertex: Cell = addBPMNState(graph, eventParent, x, y);
            vertexMap[event.id] = vertex;
            vertex.setValue(event.name || '');
            applyColors(vertex, event.id);
            setBpmnMeta(vertex, {
                bpmnId: event.id,
                kind: event.type,
                definition: event.definition,
                interrupting: event.interrupting,
                attachedToRef: event.attachedToRef,
                parallelMultiple: event.parallelMultiple,
                labelBounds: labelPositions[event.id],
            });

            // Définir la taille selon le XML
            const geometry = vertex.getGeometry();
            if (geometry) {
                geometry.width = pos.width;
                geometry.height = pos.height;
                vertex.setGeometry(geometry);
            }

            // Appliquer la position du label
            applyLabelPosition(vertex, event.id, pos);

            const iconKey = eventIcon(event.type, event.definition, event.interrupting, event.parallelMultiple);
            const icon = BPMN_ICONS[iconKey];
            if (icon !== undefined) {
                setIconCellValue(graph, vertex, icon);
            } else {
                console.log("Unknown icon key for event: ", iconKey, event.type, event.definition, event.name);
            }
        });

        //---------------------
        // Conversation nodes (diagramme de conversation BPMN) — toujours au niveau
        // racine, jamais rattachés à une lane (BPMN ne prévoit pas de laneSet dans une
        // <collaboration> de conversation).
        elements.conversationNodes.forEach((cn) => {
            const pos = positions[cn.id] || { x: 300, y: 130, width: 40, height: 40 };
            const { parent: cnParent, x, y } = getParentAndPosition(cn.id, pos);

            const vertex: Cell = addBPMNConversation(graph, cnParent, x, y);
            vertexMap[cn.id] = vertex;
            vertex.setValue(cn.name || '');
            applyColors(vertex, cn.id);
            setBpmnMeta(vertex, { bpmnId: cn.id, kind: 'conversationNode', labelBounds: labelPositions[cn.id] });

            const geometry = vertex.getGeometry();
            if (geometry) {
                geometry.width = pos.width;
                geometry.height = pos.height;
                vertex.setGeometry(geometry);
            }

            applyLabelPosition(vertex, cn.id, pos);
        });

        //---------------------
        // Tasks
        elements.tasks.forEach((t) => {
            console.log("Add task ", t);
            const pos = positions[t.id] || { x: 300, y: 130, width: 100, height: 80 };

            // Obtenir le parent correct et la position relative
            const { parent: taskParent, x, y } = getParentAndPosition(t.id, pos);

            const vertex: Cell = addBPMNTask(graph, taskParent, x, y);
            vertexMap[t.id] = vertex;
            vertex.setValue(t.name || '');
            applyColors(vertex, t.id);
            setBpmnMeta(vertex, { bpmnId: t.id, kind: t.type, collapsed: t.collapsed, labelBounds: labelPositions[t.id] });

            // Définir la taille selon le XML
            const geometry = vertex.getGeometry();
            if (geometry) {
                geometry.width = pos.width;
                geometry.height = pos.height;
                vertex.setGeometry(geometry);
            }

            // Appliquer la position du label
            applyLabelPosition(vertex, t.id, pos);

            switch (t.type) {
                case "task":
                    break;
                case "manualTask":
                    setIconCellValue(graph, vertex, BPMN_ICONS.MANUAL_TASK);
                    break;
                case "serviceTask":
                    setIconCellValue(graph, vertex, BPMN_ICONS.SERVICE_TASK);
                    break;
                case "userTask":
                    setIconCellValue(graph, vertex, BPMN_ICONS.USER_TASK);
                    break;
                case "scriptTask":
                    setIconCellValue(graph, vertex, BPMN_ICONS.SCRIPT_TASK);
                    break;
                case "businessRuleTask":
                    setIconCellValue(graph, vertex, BPMN_ICONS.BUSINESS_TASK);
                    break;
                case "sendTask":
                    setIconCellValue(graph, vertex, BPMN_ICONS.SEND_TASK);
                    break;
                case "receiveTask":
                    setIconCellValue(graph, vertex, BPMN_ICONS.RECEIVE_TASK);
                    break;
                case "callActivity":
                    // Bordure 4px : c'est le marqueur du call activity, pas de "+" (voir
                    // setCallActivityVertex dans bpmn-helpers.ts).
                    setCallActivityVertex(graph, vertex);
                    break;
                case "subProcess":
                    // Sous-processus étendu (conteneur avec son propre contenu visible) non
                    // rendu comme tel — hors périmètre de cet import. Seul le cas replié
                    // (isExpanded=false, cf. isCollapsedSubProcess) pose le marqueur "+" ;
                    // un sous-processus étendu s'affiche donc comme une tâche simple.
                    if (t.collapsed) {
                        setSubProcessMarker(graph, vertex);
                    }
                    break;
                case "transaction":
                    // Double bordure (voir setTransactionVertex) + le même marqueur "+"
                    // replié qu'un subProcess collapsed, une transaction restant une
                    // variante de sous-processus.
                    setTransactionVertex(graph, vertex);
                    if (t.collapsed) {
                        setSubProcessMarker(graph, vertex);
                    }
                    break;
                case "adHocSubProcess":
                    if (t.collapsed) {
                        setSubProcessMarker(graph, vertex);
                    }
                    setAdHocMarker(graph, vertex);
                    break;
                default:
                    console.log("Unknown task type: ", t.type, ' ', t.name);
            }
        });

        //---------------------
        // Gateways
        elements.gateways.forEach((g) => {
            console.log("Add gateway ", g.name);
            const pos = positions[g.id] || { x: 450, y: 145, width: 50, height: 50 };

            // Obtenir le parent correct et la position relative
            const { parent: gatewayParent, x, y } = getParentAndPosition(g.id, pos);

            const vertex = addBPMNGateway(graph, gatewayParent, x, y);
            vertexMap[g.id] = vertex;
            vertex.setValue(g.name || '');
            applyColors(vertex, g.id);
            setBpmnMeta(vertex, { bpmnId: g.id, kind: g.type, labelBounds: labelPositions[g.id] });

            // Définir la taille selon le XML
            const geometry = vertex.getGeometry();
            if (geometry) {
                geometry.width = pos.width;
                geometry.height = pos.height;
                vertex.setGeometry(geometry);
            }

            // Appliquer la position du label
            applyLabelPosition(vertex, g.id, pos);

            switch (g.type) {
                case "exclusiveGateway":
                    setIconCellValue(graph, vertex, BPMN_ICONS.EXCLUSIVE_GATEWAY);
                    break;
                case "parallelGateway":
                    setIconCellValue(graph, vertex, BPMN_ICONS.PARALLEL_GATEWAY);
                    break;
                case "inclusiveGateway":
                    setIconCellValue(graph, vertex, BPMN_ICONS.INCLUSIVE_GATEWAY);
                    break;
                case "eventBasedGateway":
                    setIconCellValue(graph, vertex, BPMN_ICONS.EVENT_GATEWAY);
                    break;
                case "complexGateway":
                    setIconCellValue(graph, vertex, BPMN_ICONS.COMPLEX_GATEWAY);
                    break;
                default:
                    console.log("Unknown gateway type: ", g.type, ' ', g.name);
            }
        });

        //---------------------
        // Data
        elements.data.forEach((d) => {
            console.log("Add data ", d.name);
            const pos = positions[d.id] || { x: 300, y: 130, width: 60, height: 80 };

            // Obtenir le parent correct et la position relative
            const { parent: dataParent, x, y } = getParentAndPosition(d.id, pos);

            const vertex = addBPMNData(graph, dataParent, x, y);
            vertexMap[d.id] = vertex;
            vertex.setValue(d.name || '');
            applyColors(vertex, d.id);
            setBpmnMeta(vertex, { bpmnId: d.id, kind: d.type, labelBounds: labelPositions[d.id] });

            // Définir la taille selon le XML
            const geometry = vertex.getGeometry();
            if (geometry) {
                geometry.width = pos.width;
                geometry.height = pos.height;
                vertex.setGeometry(geometry);
            }

            // Appliquer la position du label
            applyLabelPosition(vertex, d.id, pos);

            switch (d.type) {
                case "dataObjectReference":
                case "dataObject":
                    break;
                case "dataStoreReference":
                case "dataStore":
                    setDatabaseVertex(graph, vertex);
                    break;
                case "dataInput":
                    setInputDataVertex(graph, vertex);
                    break;
                case "dataOutput":
                    setOutputDataVertex(graph, vertex);
                    break;
                default:
                    console.log("Unknown data type: ", d.type, ' ', d.name);
            }
        });

        //---------------------
        // Annotations
        elements.annotations.forEach((a) => {
            console.log("Add annotation ", a.name);
            const pos = positions[a.id] || { x: 450, y: 145, width: 50, height: 50 };

            // Obtenir le parent correct et la position relative
            const { parent: annotationParent, x, y } = getParentAndPosition(a.id, pos);

            const vertex = addBPMNAnnotation(graph, annotationParent, x, y);
            vertexMap[a.id] = vertex;
            vertex.setValue(a.text || '');
            applyColors(vertex, a.id);
            setBpmnMeta(vertex, { bpmnId: a.id, kind: 'textAnnotation', labelBounds: labelPositions[a.id] });

            // Définir la taille selon le XML
            const geometry = vertex.getGeometry();
            if (geometry) {
                geometry.width = pos.width;
                geometry.height = pos.height;
                vertex.setGeometry(geometry);
            }

            // Appliquer la position du label
            applyLabelPosition(vertex, a.id, pos);
        });

        //---------------------
        // Créer les edges avec waypoints
        for (const flow of elements.flows) {
            const sourceCell = vertexMap[flow.source];
            const targetCell = vertexMap[flow.target];

            if (sourceCell && targetCell) {
                const edge = addBPMNConnection(graph, sourceCell, targetCell);

                edge.setValue(flow.name || '');
                applyColors(edge, flow.id);
                setBpmnMeta(edge, { bpmnId: flow.id, kind: 'sequenceFlow', labelBounds: labelPositions[flow.id] });

                // Utiliser les waypoints pour définir la géométrie complète de l'edge
                if (flow.waypoints && flow.waypoints.length >= 2) {
                    const geometry = edge.getGeometry();
                    if (geometry) {
                        // Le parent de l'edge est le parent commun le plus profond
                        const edgeParent = edge.getParent();

                        // Calculer l'offset absolu du parent de l'edge
                        let offsetX = 0;
                        let offsetY = 0;
                        let swimlaneCount = 0;

                        // Remonter la hiérarchie pour calculer l'offset
                        let current = edgeParent;
                        while (current && current !== parent) {
                            const geo = current.getGeometry();
                            if (geo) {
                                offsetX += geo.x;
                                offsetY += geo.y;
                            }

                            // Compter les swimlanes pour l'ajustement
                            const style = current.getStyle();
                            if (style && style.baseStyleNames && style.baseStyleNames.includes('lane')) {
                                swimlaneCount++;
                            }

                            current = current.getParent();
                        }

                        // Soustraire l'ajustement fait aux objets (20px par niveau de swimlane)
                        offsetX -= (swimlaneCount * 20);

                        // Obtenir les positions des cellules source et target
                        const sourceGeo = sourceCell.getGeometry();
                        const targetGeo = targetCell.getGeometry();

                        if (sourceGeo && targetGeo) {
                            // Calculer les positions absolues des cellules
                            // La position geometry.x contient déjà l'ajustement de marge (+20px ou +10px)
                            // donc on ne doit PAS soustraire cet ajustement
                            let sourceAbsX = sourceGeo.x;
                            let sourceAbsY = sourceGeo.y;
                            let targetAbsX = targetGeo.x;
                            let targetAbsY = targetGeo.y;

                            // Remonter la hiérarchie pour obtenir les positions absolues
                            let sourceParent = sourceCell.getParent();
                            while (sourceParent && sourceParent !== parent) {
                                const parentGeo = sourceParent.getGeometry();
                                if (parentGeo) {
                                    sourceAbsX += parentGeo.x;
                                    sourceAbsY += parentGeo.y;
                                }
                                sourceParent = sourceParent.getParent();
                            }

                            let targetParent = targetCell.getParent();
                            while (targetParent && targetParent !== parent) {
                                const parentGeo = targetParent.getGeometry();
                                if (parentGeo) {
                                    targetAbsX += parentGeo.x;
                                    targetAbsY += parentGeo.y;
                                }
                                targetParent = targetParent.getParent();
                            }

                            // Premier waypoint = point de sortie exact
                            const firstWaypoint = flow.waypoints[0];
                            const lastWaypoint = flow.waypoints[flow.waypoints.length - 1];

                            // Point d'ancrage réellement utilisé par maxgraph (exitX/Y,
                            // entryX/Y) — voir applyEdgeAnchors.
                            applyEdgeAnchors(
                                edge,
                                sourceGeo, sourceAbsX, sourceAbsY,
                                targetGeo, targetAbsX, targetAbsY,
                                firstWaypoint, lastWaypoint
                            );

                            // Calculer les offsets relatifs à la cellule
                            geometry.sourcePoint = new Point(
                                firstWaypoint.x - sourceAbsX,
                                firstWaypoint.y - sourceAbsY
                            );

                            geometry.targetPoint = new Point(
                                lastWaypoint.x - targetAbsX,
                                lastWaypoint.y - targetAbsY
                            );

                            // Points intermédiaires (exclure premier et dernier)
                            if (flow.waypoints.length > 2) {
                                geometry.points = flow.waypoints.slice(1, -1).map((wp: { x: number; y: number; }) =>
                                    new Point(wp.x - offsetX, wp.y - offsetY)
                                );
                            }

                            graph.model.setGeometry(edge, geometry);
                        }

                        // Label du sequenceFlow
                        const edgeLabelPos = labelPositions[flow.id];
                        if (edgeLabelPos && flow.waypoints && flow.waypoints.length >= 2) {
                            const edgeGeom = edge.getGeometry()!;
                            const mid = computeEdgeMidpoint(flow.waypoints);
                            edgeGeom.offset = new Point(
                                (edgeLabelPos.x + edgeLabelPos.width  / 2) - mid.x,
                                (edgeLabelPos.y + edgeLabelPos.height / 2) - mid.y
                            );
                            const es = edge.getStyle();
                            es.labelWidth = edgeLabelPos.width;
                            edge.setStyle(es);
                            edge.setGeometry(edgeGeom);
                        }

                        console.log(`Flow ${flow.source} -> ${flow.target}: offset = (${offsetX}, ${offsetY}), swimlanes = ${swimlaneCount}`);
                    }
                }
            }
        }

        // Créer les edges avec waypoints pour messageFlow
        for (const flow of elements.messageFlow) {
            const sourceCell = vertexMap[flow.source];
            const targetCell = vertexMap[flow.target];

            console.log("Add message flow ", flow.source, flow.target);

            if (sourceCell && targetCell) {
                const edge = addBPMNConnection(graph, sourceCell, targetCell);
                setMessageFlow(graph, edge);
                applyColors(edge, flow.id);
                setBpmnMeta(edge, { bpmnId: flow.id, kind: 'messageFlow', labelBounds: labelPositions[flow.id] });

                // Utiliser les waypoints pour définir la géométrie complète de l'edge
                if (flow.waypoints && flow.waypoints.length >= 2) {
                    const geometry = edge.getGeometry();
                    if (geometry) {
                        // Le parent de l'edge est le parent commun le plus profond
                        const edgeParent = edge.getParent();

                        // Calculer l'offset absolu du parent de l'edge
                        let offsetX = 0;
                        let offsetY = 0;
                        let swimlaneCount = 0;

                        // Remonter la hiérarchie pour calculer l'offset
                        let current = edgeParent;
                        while (current && current !== parent) {
                            const geo = current.getGeometry();
                            if (geo) {
                                offsetX += geo.x;
                                offsetY += geo.y;
                            }

                            // Compter les swimlanes pour l'ajustement
                            const style = current.getStyle();
                            if (style && style.baseStyleNames && style.baseStyleNames.includes('lane')) {
                                swimlaneCount++;
                            }

                            current = current.getParent();
                        }

                        // Soustraire l'ajustement fait aux objets (20px par niveau de swimlane)
                        offsetX -= (swimlaneCount * 20);

                        // Obtenir les positions des cellules source et target
                        const sourceGeo = sourceCell.getGeometry();
                        const targetGeo = targetCell.getGeometry();

                        if (sourceGeo && targetGeo) {
                            // Calculer les positions absolues des cellules
                            // La position geometry.x contient déjà l'ajustement de marge (+20px ou +10px)
                            // donc on ne doit PAS soustraire cet ajustement
                            let sourceAbsX = sourceGeo.x;
                            let sourceAbsY = sourceGeo.y;
                            let targetAbsX = targetGeo.x;
                            let targetAbsY = targetGeo.y;

                            // Remonter la hiérarchie pour obtenir les positions absolues
                            let sourceParent = sourceCell.getParent();
                            while (sourceParent && sourceParent !== parent) {
                                const parentGeo = sourceParent.getGeometry();
                                if (parentGeo) {
                                    sourceAbsX += parentGeo.x;
                                    sourceAbsY += parentGeo.y;
                                }
                                sourceParent = sourceParent.getParent();
                            }

                            let targetParent = targetCell.getParent();
                            while (targetParent && targetParent !== parent) {
                                const parentGeo = targetParent.getGeometry();
                                if (parentGeo) {
                                    targetAbsX += parentGeo.x;
                                    targetAbsY += parentGeo.y;
                                }
                                targetParent = targetParent.getParent();
                            }

                            // Premier waypoint = point de sortie exact
                            const firstWaypoint = flow.waypoints[0];
                            const lastWaypoint = flow.waypoints[flow.waypoints.length - 1];

                            // Point d'ancrage réellement utilisé par maxgraph (exitX/Y,
                            // entryX/Y) — voir applyEdgeAnchors.
                            applyEdgeAnchors(
                                edge,
                                sourceGeo, sourceAbsX, sourceAbsY,
                                targetGeo, targetAbsX, targetAbsY,
                                firstWaypoint, lastWaypoint
                            );

                            // Calculer les offsets relatifs à la cellule
                            geometry.sourcePoint = new Point(
                                firstWaypoint.x - sourceAbsX,
                                firstWaypoint.y - sourceAbsY
                            );

                            geometry.targetPoint = new Point(
                                lastWaypoint.x - targetAbsX,
                                lastWaypoint.y - targetAbsY
                            );

                            // Points intermédiaires (exclure premier et dernier)
                            if (flow.waypoints.length > 2) {
                                geometry.points = flow.waypoints.slice(1, -1).map((wp: { x: number; y: number; }) =>
                                    new Point(wp.x - offsetX, wp.y - offsetY)
                                );
                            }

                            graph.model.setGeometry(edge, geometry);
                        }

                        // Label du messageFlow
                        const msgLabelPos = labelPositions[flow.id];
                        if (msgLabelPos && flow.waypoints && flow.waypoints.length >= 2) {
                            const edgeGeom = edge.getGeometry()!;
                            const mid = computeEdgeMidpoint(flow.waypoints);
                            edgeGeom.offset = new Point(
                                (msgLabelPos.x + msgLabelPos.width  / 2) - mid.x,
                                (msgLabelPos.y + msgLabelPos.height / 2) - mid.y
                            );
                            const ms = edge.getStyle();
                            ms.labelWidth = msgLabelPos.width;
                            edge.setStyle(ms);
                            edge.setGeometry(edgeGeom);
                        }

                        console.log(`MessageFlow ${flow.source} -> ${flow.target}: offset = (${offsetX}, ${offsetY}), swimlanes = ${swimlaneCount}`);
                    }
                }
            }

        }

        //---------------------
        // Conversation links (bpmn2:conversationLink) — relient toujours deux
        // cellules de niveau racine (participant-bande ou conversationNode, jamais
        // dans une lane), donc déjà en coordonnées absolues : pas besoin du calcul
        // d'offset/swimlane des sequenceFlow/messageFlow ci-dessus.
        // addBPMNConnection applique automatiquement le style double-trait
        // ("bpmnConversationLink", voir isConversationVertex/setConversationFlow
        // dans bpmn-helpers.ts) dès qu'une extrémité est une conversation.
        for (const link of elements.conversationLinks) {
            const sourceCell = vertexMap[link.source];
            const targetCell = vertexMap[link.target];
            if (!sourceCell || !targetCell) {
                console.warn(`⚠️ ConversationLink ${link.id} : source ou cible introuvable (${link.source} -> ${link.target})`);
                continue;
            }

            const edge = addBPMNConnection(graph, sourceCell, targetCell);
            edge.setValue(link.name || '');
            applyColors(edge, link.id);
            setBpmnMeta(edge, { bpmnId: link.id, kind: 'conversationLink', labelBounds: labelPositions[link.id] });

            if (link.waypoints && link.waypoints.length >= 2) {
                const geometry = edge.getGeometry();
                const sourceGeo = sourceCell.getGeometry();
                const targetGeo = targetCell.getGeometry();
                if (geometry && sourceGeo && targetGeo) {
                    const sourcePos = getAbsolutePosition(sourceCell);
                    const targetPos = getAbsolutePosition(targetCell);
                    const firstWaypoint = link.waypoints[0];
                    const lastWaypoint = link.waypoints[link.waypoints.length - 1];

                    applyEdgeAnchors(
                        edge,
                        sourceGeo, sourcePos.x, sourcePos.y,
                        targetGeo, targetPos.x, targetPos.y,
                        firstWaypoint, lastWaypoint
                    );

                    geometry.sourcePoint = new Point(firstWaypoint.x - sourcePos.x, firstWaypoint.y - sourcePos.y);
                    geometry.targetPoint = new Point(lastWaypoint.x - targetPos.x, lastWaypoint.y - targetPos.y);
                    if (link.waypoints.length > 2) {
                        geometry.points = link.waypoints.slice(1, -1).map((wp: { x: number; y: number }) => new Point(wp.x, wp.y));
                    }
                    graph.model.setGeometry(edge, geometry);
                }
            }
        }

        //---------------------
        // Créer les traits pointillés des associations (annotation <-> objet concerné,
        // ou plus généralement deux éléments reliés par <association>)
        for (const assoc of elements.associations) {
            const sourceCell = vertexMap[assoc.source];
            const targetCell = vertexMap[assoc.target];
            if (!sourceCell || !targetCell) {
                console.warn(`⚠️ Association ${assoc.id} : source ou cible introuvable (${assoc.source} -> ${assoc.target})`);
                continue;
            }

            const edge = addBPMNConnection(graph, sourceCell, targetCell);
            setBpmnMeta(edge, { bpmnId: assoc.id, kind: 'association', direction: assoc.direction });
            if (assoc.direction === 'One') {
                setAnnotationDirectionalArrow(graph, edge);
            } else if (assoc.direction === 'Both') {
                setAnnotationDirectionalArrow(graph, edge);
                graph.setCellStyles('startArrow', 'classic', [edge]);
            } else {
                setAnnotationArrow(graph, edge);
            }

            if (assoc.waypoints && assoc.waypoints.length >= 2) {
                const geometry = edge.getGeometry();
                const sourceGeo = sourceCell.getGeometry();
                const targetGeo = targetCell.getGeometry();
                if (geometry && sourceGeo && targetGeo) {
                    const sourceAbs = getAbsolutePosition(sourceCell);
                    const targetAbs = getAbsolutePosition(targetCell);
                    const firstWaypoint = assoc.waypoints[0];
                    const lastWaypoint = assoc.waypoints[assoc.waypoints.length - 1];

                    applyEdgeAnchors(
                        edge,
                        sourceGeo, sourceAbs.x, sourceAbs.y,
                        targetGeo, targetAbs.x, targetAbs.y,
                        firstWaypoint, lastWaypoint
                    );

                    geometry.sourcePoint = new Point(firstWaypoint.x - sourceAbs.x, firstWaypoint.y - sourceAbs.y);
                    geometry.targetPoint = new Point(lastWaypoint.x - targetAbs.x, lastWaypoint.y - targetAbs.y);

                    // Toujours une ligne droite (annotation <-> objet annoté) : contrairement
                    // aux sequenceFlow/messageFlow/conversationLink, on ignore délibérément les
                    // points intermédiaires d'un BPMNEdge à plus de 2 waypoints (un outil tiers
                    // peut avoir enregistré un tracé coudé) plutôt que de les rejouer en
                    // `geometry.points`, ce qui casserait la ligne droite exigée par la notation.
                    graph.model.setGeometry(edge, geometry);
                }
            }
        }

    } finally {
        graph.model.endUpdate();
    }

    console.log('✅ Diagramme dessiné avec succès');

    setTimeout(() => {
        centerGraphView(graph);
        console.log('📐 Vue centrée');
    }, 100);
}

export interface BindBpmnFileInputOptions {
    statusEl?: HTMLElement | null;
    loadSuccessMessage?: string;
    loadErrorMessage?: string;
    onError?: (error: Error) => void;
}

/**
 * Wires an already-created `<input type="file">` element (the caller owns/creates
 * it — no host page ID assumed). Returns a disposer removing the 'change' listener.
 */
export function bindBpmnFileInput(
    graph: Graph,
    input: HTMLInputElement,
    options: BindBpmnFileInputOptions = {}
): () => void {
    const {
        statusEl = null,
        loadSuccessMessage = '✓ Fichier chargé avec succès',
        loadErrorMessage = '✗ Erreur lors du chargement du fichier',
        onError,
    } = options;

    const onChange = async (e: Event) => {
        console.log('📁 Événement file input déclenché');
        const target = e.target as HTMLInputElement;
        const file = target.files?.[0];
        if (!file) {
            console.log('❌ Pas de fichier sélectionné');
            return;
        }

        console.log('📄 Fichier:', file.name, file.size, 'bytes');
        const text = await file.text();
        console.log('📝 Contenu XML (extrait):', text.substring(0, 200) + '...');

        try {
            console.log('🔍 Parsing BPMN...');
            const data = parseBPMN(text);
            console.log('✅ Parsing réussi');

            console.log('🎨 Dessin du diagramme...');
            drawDiagram(graph, data);

            const totalElements =
                data.elements.events.length +
                data.elements.tasks.length +
                data.elements.gateways.length;

            console.log(`📊 Total: ${totalElements} éléments, ${data.elements.flows.length} flux`);

            showStatus(statusEl, loadSuccessMessage);
        } catch (error: any) {
            console.error('❌ ERREUR:', error);
            showStatus(statusEl, loadErrorMessage);
            onError?.(error instanceof Error ? error : new Error(String(error)));
        } finally {
            // Allow re-selecting the same file twice in a row.
            target.value = '';
        }
    };

    input.addEventListener('change', onChange);
    return () => input.removeEventListener('change', onChange);
}