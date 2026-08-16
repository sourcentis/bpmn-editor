// tests/helpers/window.d.ts
// Déclarations globales pour les points d'entrée exposés par le harnais
// (tests/visual/harness.ts) sur `window`, afin que les specs Playwright
// puissent les appeler via `page.evaluate` sans caster `window` à chaque
// fois. Ce fichier ne vit que sous `tests/` — rien ici ne s'exécute ni n'a
// d'équivalent dans `src/`.
import type { BpmnColors, BpmnElements, BpmnPositions } from '../../src/bpmn-import';

export interface BpmnParseResult {
    elements: BpmnElements;
    positions: BpmnPositions;
    labelPositions: Record<string, { x: number; y: number; width: number; height: number }>;
    colors: BpmnColors;
}

declare global {
    interface Window {
        /**
         * Importe le XML BPMN `xml` dans l'éditeur monté sur `#bpmn-canvas`,
         * sans UI ni mise en page automatique, et résout une fois le rendu
         * stabilisé (polices chargées, peinture MaxGraph terminée, recentrage
         * automatique de `drawDiagram` passé).
         */
        renderBpmn(xml: string): Promise<void>;
        /**
         * Parse `xml` avec `parseBPMN` sans rien peindre, et renvoie la partie
         * JSON-safe du résultat (sans le `Document` XML sous-jacent).
         */
        parseBpmn(xml: string): BpmnParseResult;
        /**
         * Exporte en BPMN 2.0 XML l'état correspondant au dernier
         * `renderBpmn()` appelé (throw si aucun). Voir le commentaire de
         * `window.exportBpmn` dans harness.ts pour le détail de la
         * reconstruction hors écran.
         */
        exportBpmn(): string;
        /**
         * Charge `xml` (format natif GraphDataModel — celui de loadXml/getXml,
         * pas du BPMN 2.0) sur l'éditeur monté sur `#bpmn-canvas`, avec les
         * mêmes garanties de stabilisation que `renderBpmn`. Utilisé par les
         * tests `mercator-*` (schémas réels rejoués depuis la base Mercator).
         */
        renderMaxgraph(xml: string): Promise<void>;
        /**
         * Exporte en BPMN 2.0 XML l'état correspondant au dernier
         * `renderMaxgraph()` appelé (throw si aucun), via l'API publique
         * `exportBpmnXml()` de l'éditeur actuellement monté.
         */
        exportMaxgraphAsBpmn(): string;
        __BPMN_RENDERED__?: boolean;
    }
}

export {};
