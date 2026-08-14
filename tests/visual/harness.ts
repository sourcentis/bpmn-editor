// tests/visual/harness.ts
// Page minimale servie par le serveur de dev Vite (piloté par Playwright,
// voir playwright.config.ts) : monte un éditeur sans UI ni mise en page
// automatique sur #bpmn-canvas et expose deux points d'entrée globaux
// consommés par les specs — window.renderBpmn (tests visuels) et
// window.parseBpmn (tests structurels). Rien ici n'a d'équivalent dans
// src/ : ce fichier est le seul endroit qui a besoin de ces signaux.
import { createBpmnEditor } from '../../src/index';
import { parseBPMN } from '../../src/bpmn-import';
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

    await document.fonts.ready;
    await nextPaint();

    // drawDiagram() recentre la vue via un setTimeout(…, 100) fixe et
    // inconditionnel (pas de mise en page force/physique — juste ce recentrage
    // asynchrone, cf. bpmn-import.ts) : on l'attend explicitement avant de
    // considérer le rendu comme stable, avec une marge de sécurité.
    await wait(200);
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
