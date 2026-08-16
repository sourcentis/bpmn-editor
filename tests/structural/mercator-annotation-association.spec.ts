// tests/structural/mercator-annotation-association.spec.ts
// Un edge touchant une <bpmn2:textAnnotation> ne peut structurellement être
// qu'une <bpmn2:association> (BPMN interdit à un sequenceFlow/messageFlow de
// cibler un artefact, qui n'est pas un flow node) — voir le commentaire sur
// inferEdgeMeta()/collectModel() dans bpmn-export.ts.
//
// Ce test cible spécifiquement les schémas Mercator RÉELS (fixtures-mercator/,
// contenu natif GraphDataModel de loadXml, jamais passé par drawDiagram donc
// sans BpmnMeta — inferEdgeMeta() doit deviner le kind depuis le style). La
// règle `style.dashed === true` seule ne suffit pas : le style d'un edge
// natif Mercator est un Object générique désérialisé par le codec maxGraph,
// où `dashed="1"` peut arriver côté JS comme la chaîne "1" plutôt que le
// booléen `true`, faisant silencieusement échouer l'égalité stricte —
// l'edge retombe alors en sequenceFlow générique, avec sa flèche pleine par
// défaut, sur le lien annotation<->objet. Reproduit par m05-nestor.maxgraph
// (voir tests/visual/__baselines__/m05-nestor-bpmn-roundtrip.png).
//
// Round-trip structurel classique = faux témoin ici (mercator-bpmn-roundtrip.spec.ts
// compare deux passes du MÊME export, donc s'accorderait avec lui-même même
// mal classé) : on inspecte directement le XML exporté, pas une comparaison
// interne aux deux passes.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '../helpers/console-guard';

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '../visual/fixtures-mercator');

const fixtures = readdirSync(FIXTURES_DIR)
    .filter((name) => name.endsWith('.maxgraph'))
    .sort();

interface EdgeRef {
    localName: string;
    sourceRef: string | null;
    targetRef: string | null;
}

function parseEdges(xml: string): EdgeRef[] {
    const out: EdgeRef[] = [];
    const re = /<bpmn2:(sequenceFlow|messageFlow|association|conversationLink)\b([^/>]*)\/?>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml))) {
        const attrs = m[2];
        const sourceRef = attrs.match(/sourceRef="([^"]*)"/)?.[1] ?? null;
        const targetRef = attrs.match(/targetRef="([^"]*)"/)?.[1] ?? null;
        out.push({ localName: m[1], sourceRef, targetRef });
    }
    return out;
}

function parseAnnotationIds(xml: string): string[] {
    return Array.from(xml.matchAll(/<bpmn2:textAnnotation id="([^"]+)"/g)).map((m) => m[1]);
}

for (const fixture of fixtures) {
    const baseName = fixture.replace(/\.maxgraph$/, '');

    test(`${baseName} : tout edge touchant une textAnnotation est une association`, async ({ page }) => {
        await page.goto('/tests/visual/harness.html');
        const xml = readFileSync(join(FIXTURES_DIR, fixture), 'utf-8');

        await page.evaluate((xmlText) => window.renderMaxgraph(xmlText), xml);
        await page.waitForFunction(() => window.__BPMN_RENDERED__ === true);

        const exported = await page.evaluate(() => window.exportMaxgraphAsBpmn());
        const annotationIds = new Set(parseAnnotationIds(exported));
        if (annotationIds.size === 0) {
            test.skip(true, 'aucune textAnnotation dans cette fixture');
            return;
        }

        const edges = parseEdges(exported);
        const touchingAnnotation = edges.filter(
            (e) => (e.sourceRef && annotationIds.has(e.sourceRef)) || (e.targetRef && annotationIds.has(e.targetRef))
        );

        expect(touchingAnnotation.length, 'au moins un edge doit relier chaque textAnnotation').toBeGreaterThan(0);
        for (const e of touchingAnnotation) {
            expect(
                e.localName,
                `edge ${e.sourceRef}->${e.targetRef} touche une textAnnotation, doit être <bpmn2:association>`
            ).toBe('association');
        }
    });
}
