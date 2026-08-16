// tests/structural/bpmn-annotation-association.spec.ts
// Le lien entre un objet et son annotation (<bpmn2:association>, la plupart
// du temps textAnnotation <-> élément annoté) doit toujours se dessiner comme
// une ligne DROITE pointillée (1 1) sans flèche — cf. drawDiagram() dans
// bpmn-import.ts (bloc "Créer les traits pointillés des associations").
// C'est le rendu qu'on obtient déjà pour le cas courant (attribut
// associationDirection absent -> 'None', 2 waypoints), mais un fichier
// BPMN 2.0 produit par un autre outil peut porter plus de 2 waypoints (tracé
// coudé enregistré côté source) : avant correctif, ces points intermédiaires
// étaient rejoués tels quels dans geometry.points, cassant la ligne droite.
// Ces tests utilisent le SVG rendu directement (pas seulement parseBPMN, qui
// ne voit que le XML source, jamais le résultat du dessin) : chaque fixture
// est minimale et ne contient qu'un seul edge, donc le seul <path> avec
// stroke-dasharray dans le SVG est sans ambiguïté celui de l'association.
import { expect, test } from '../helpers/console-guard';

function fixture(opts: { waypoints: Array<{ x: number; y: number }>; direction?: 'None' | 'One' | 'Both' }): string {
    const dirAttr = opts.direction ? ` associationDirection="${opts.direction}"` : '';
    const wpXml = opts.waypoints.map((wp) => `<di:waypoint x="${wp.x}" y="${wp.y}"/>`).join('');
    return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:task id="Task_1" name="T"/>
    <bpmn:textAnnotation id="TextAnnotation_1"><bpmn:text>note</bpmn:text></bpmn:textAnnotation>
    <bpmn:association id="Association_1" sourceRef="Task_1" targetRef="TextAnnotation_1"${dirAttr}/>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1"><dc:Bounds x="100" y="100" width="100" height="80"/></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="TextAnnotation_1_di" bpmnElement="TextAnnotation_1"><dc:Bounds x="300" y="300" width="150" height="50"/></bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Association_1_di" bpmnElement="Association_1">${wpXml}</bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;
}

// Le seul path dasharray du SVG (fixture à un seul edge) ; renvoie son
// attribut `d` et le nombre de segments "L" (commandes de ligne).
async function importedAssociationPath(page: import('@playwright/test').Page, xml: string) {
    await page.evaluate((xmlText) => window.renderBpmn(xmlText), xml);
    await page.waitForFunction(() => window.__BPMN_RENDERED__ === true);

    return page.evaluate(() => {
        const paths = Array.from(document.querySelectorAll('#bpmn-canvas svg path')).filter((p) =>
            p.getAttribute('stroke-dasharray')
        );
        return paths.map((p) => ({
            d: p.getAttribute('d') ?? '',
            dasharray: p.getAttribute('stroke-dasharray') ?? '',
        }));
    });
}

test('association avec plus de 2 waypoints (tracé coudé source) : reste une ligne droite après import', async ({
    page,
}) => {
    await page.goto('/tests/visual/harness.html');
    const xml = fixture({
        waypoints: [
            { x: 200, y: 140 },
            { x: 200, y: 400 },
            { x: 300, y: 325 },
        ],
    });

    const dashed = await importedAssociationPath(page, xml);
    expect(dashed.length, 'exactement une ligne pointillée (l\'association)').toBe(1);

    // Une ligne droite n'a qu'une seule commande L (2 points : M ... L ...) ;
    // le tracé coudé source en avait 3 (M ... L ... L ...).
    const lCount = (dashed[0].d.match(/L/g) ?? []).length;
    expect(lCount, `tracé attendu en ligne droite, obtenu : ${dashed[0].d}`).toBe(1);
});

test('association sans associationDirection (défaut BPMN "None") : pointillé (1 1), sans flèche', async ({
    page,
}) => {
    await page.goto('/tests/visual/harness.html');
    const xml = fixture({
        waypoints: [
            { x: 200, y: 140 },
            { x: 300, y: 325 },
        ],
    });

    const dashed = await importedAssociationPath(page, xml);
    expect(dashed.length).toBe(1);
    // dashPattern "1 1" posé par setAnnotationArrow — maxgraph le restitue à
    // l'échelle du stroke-width courant (2), soit "2 2" en SVG.
    expect(dashed[0].dasharray).toBe('2 2');

    // Sans flèche : le groupe de l'edge ne porte que le hit-path invisible et
    // la ligne visible, jamais un triangle de tête de flèche.
    const edgePathCount = await page.evaluate(() => {
        const dashedPath = Array.from(document.querySelectorAll('#bpmn-canvas svg path')).find((p) =>
            p.getAttribute('stroke-dasharray')
        );
        return dashedPath?.parentElement?.querySelectorAll('path').length ?? -1;
    });
    expect(edgePathCount, 'aucune flèche : seuls le hit-path et la ligne visible').toBe(2);
});

test('association avec associationDirection="One" : flèche toujours rendue (non-régression)', async ({ page }) => {
    await page.goto('/tests/visual/harness.html');
    const xml = fixture({
        waypoints: [
            { x: 200, y: 140 },
            { x: 300, y: 325 },
        ],
        direction: 'One',
    });

    const dashed = await importedAssociationPath(page, xml);
    expect(dashed.length).toBe(1);

    const edgePathCount = await page.evaluate(() => {
        const dashedPath = Array.from(document.querySelectorAll('#bpmn-canvas svg path')).find((p) =>
            p.getAttribute('stroke-dasharray')
        );
        return dashedPath?.parentElement?.querySelectorAll('path').length ?? -1;
    });
    // hit-path + ligne visible + tête de flèche.
    expect(edgePathCount, 'flèche attendue pour une association dirigée').toBe(3);
});
