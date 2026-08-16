// tests/visual/harness.ts
// Page minimale servie par le serveur de dev Vite (piloté par Playwright,
// voir playwright.config.ts) : monte un éditeur sans UI ni mise en page
// automatique sur #bpmn-canvas et expose deux points d'entrée globaux
// consommés par les specs — window.renderBpmn (tests visuels) et
// window.parseBpmn (tests structurels). Rien ici n'a d'équivalent dans
// src/ : ce fichier est le seul endroit qui a besoin de ces signaux.
import { createBpmnEditor } from '../../src/index';
import { drawDiagram, parseBPMN } from '../../src/bpmn-import';
import { exportBPMN } from '../../src/bpmn-export';
import { initBpmnEditor } from '../../src/bpmn-edit';
// tests/helpers/window.d.ts augmente globalement `Window` (renderBpmn,
// parseBpmn, __BPMN_RENDERED__) — inclus par tests/tsconfig.json, pas besoin
// d'import explicite ici pour que le typage s'applique.

const container = document.getElementById('bpmn-canvas');
if (!container) {
    throw new Error('harness.html : conteneur #bpmn-canvas introuvable');
}

let editor: ReturnType<typeof createBpmnEditor> | null = null;

// Attend une frame peinte par le navigateur (MaxGraph dessine en SVG au fil
// des mutations DOM ; deux rAF successifs laissent le temps au navigateur de
// peindre la frame qui suit la dernière mutation, cf. Phase 2 du prompt).
function nextPaint(): Promise<void> {
    return new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
}

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

window.renderBpmn = async (xml: string): Promise<void> => {
    window.__BPMN_RENDERED__ = false;

    editor?.destroy();
    editor = createBpmnEditor(container, { ui: 'none', readOnly: true });
    editor.importBpmnXml(xml);
    // La bibliothèque ne recentre plus la vue automatiquement (un recentrage
    // différé/automatique provoquait un saut visible au chargement dans un
    // vrai navigateur — voir bpmn-import.ts/drawDiagram) : c'est maintenant à
    // l'appelant de le faire explicitement, comme un vrai consommateur le
    // ferait via le bouton "Fit" ou instance.fit(). Les baselines de ce
    // harnais dépendent d'un cadrage centré reproductible, donc on l'appelle
    // ici — pas un comportement par défaut de la lib.
    editor.fit();

    await document.fonts.ready;
    await nextPaint();

    // (readOnly) adjustReadOnlyContainerHeight mute la taille du conteneur
    // via un setTimeout(…, 150) — cf. create-bpmn-editor.ts. Marge doublée
    // (400ms, pas seulement 200) : sous charge (suite complète, plusieurs
    // workers), un écart plus court laisse parfois passer une capture avant
    // ce callback, un rendu instable capturé une fois sur plusieurs dizaines.
    await wait(400);
    await nextPaint();

    window.__BPMN_RENDERED__ = true;
};

window.parseBpmn = (xml: string) => {
    const data = parseBPMN(xml);
    // `xmlDoc` est un Document DOM, non sérialisable à travers page.evaluate —
    // on ne renvoie que la partie JSON-safe utilisée par les tests structurels.
    const { elements, positions, labelPositions, colors } = data;
    return { elements, positions, labelPositions, colors };
};

// Exporte l'état actuellement affiché par renderBpmn(). N'a pas d'équivalent
// dans src/ : l'éditeur `ui: 'none'` monté par renderBpmn() n'expose pas sa
// Graph interne via BpmnEditorInstance, donc on reconstruit un graphe
// équivalent hors écran à partir du dernier XML rendu (même parseBPMN +
// drawDiagram que renderBpmn(), donc un état de cellules identique), on
// l'exporte, puis on le détruit aussitôt.
let lastRenderedXml: string | null = null;
const originalRenderBpmn = window.renderBpmn;
window.renderBpmn = async (xml: string): Promise<void> => {
    lastRenderedXml = xml;
    await originalRenderBpmn(xml);
};

window.exportBpmn = (): string => {
    if (lastRenderedXml === null) {
        throw new Error('exportBpmn : aucun renderBpmn() préalable');
    }
    const offscreen = document.createElement('div');
    offscreen.style.position = 'absolute';
    offscreen.style.left = '-10000px';
    offscreen.style.width = '2000px';
    offscreen.style.height = '2000px';
    document.body.appendChild(offscreen);

    const { graph, dispose } = initBpmnEditor(offscreen, {});
    try {
        drawDiagram(graph, parseBPMN(lastRenderedXml));
        return exportBPMN(graph);
    } finally {
        dispose();
        offscreen.remove();
    }
};

// Charge `xml` (format natif GraphDataModel de loadXml/getXml — pas du BPMN
// 2.0) via editor.loadXml() sur l'éditeur monté sur #bpmn-canvas. Utilisé par
// les tests de non-régression tests/*/mercator-*.spec.ts qui rejouent des
// schémas réels exportés de la base Mercator (voir tests/visual/fixtures-mercator).
window.renderMaxgraph = async (xml: string): Promise<void> => {
    window.__BPMN_RENDERED__ = false;

    editor?.destroy();
    editor = createBpmnEditor(container, { ui: 'none', readOnly: true });
    editor.loadXml(xml);
    // Voir le commentaire équivalent dans renderBpmn() ci-dessus : loadXml()
    // ne recentre plus automatiquement, fit() explicite pour ce harnais.
    editor.fit();

    await document.fonts.ready;
    await nextPaint();
    // Même marge que renderBpmn.
    await wait(400);
    await nextPaint();

    window.__BPMN_RENDERED__ = true;
};

// Exporte en BPMN 2.0 XML l'état correspondant au dernier renderMaxgraph()
// appelé, via l'API publique exportBpmnXml() de l'éditeur actuellement monté
// (contrairement à exportBpmn() ci-dessus, pas besoin de reconstruction hors
// écran : editor.exportBpmnXml() lit directement le graphe affiché).
window.exportMaxgraphAsBpmn = (): string => {
    if (!editor) {
        throw new Error('exportMaxgraphAsBpmn : aucun renderMaxgraph() préalable');
    }
    return editor.exportBpmnXml();
};
