// tests/structural/mercator-bpmn-roundtrip.spec.ts
// Round-trip structurel de l'export BPMN de schémas RÉELS extraits de la
// base de production Mercator (voir tests/visual/fixtures-mercator/, format
// natif GraphDataModel de loadXml — pas du BPMN 2.0). Complète
// mercator-roundtrip.spec.ts (comparaison visuelle) par une comparaison de
// données, insensible aux polices/antialiasing, dans le même esprit que
// tests/structural/bpmn-roundtrip.spec.ts.
//
// Étapes, par fixture :
//   1. loadXml(schéma natif)                         (renderMaxgraph)
//   2. bpmn1 = exportBpmnXml()                        (exportMaxgraphAsBpmn)
//   3. data1 = parseBPMN(bpmn1)                        — référence
//   4. importBpmnXml(bpmn1) puis exportBPMN() -> bpmn2 (renderBpmn + exportBpmn)
//   5. data2 = parseBPMN(bpmn2)
//   data1 et data2 doivent décrire le MÊME diagramme : l'export produit par
//   un schéma réel, une fois réimporté, doit se réexporter identique — sans
//   quoi importBpmnXml(exportBpmnXml(...)) perd de l'information sur du
//   contenu de production, pas seulement sur les fixtures écrites à la main.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '../helpers/console-guard';

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '../visual/fixtures-mercator');

const fixtures = readdirSync(FIXTURES_DIR)
    .filter((name) => name.endsWith('.maxgraph'))
    .sort();

const sortedIds = (arr: Array<{ id: string }>) => arr.map((x) => x.id).sort();
const closeEnough = (a: number, b: number, tolerance = 0.5) => Math.abs(a - b) < tolerance;

for (const fixture of fixtures) {
    const baseName = fixture.replace(/\.maxgraph$/, '');

    test(baseName, async ({ page }) => {
        await page.goto('/tests/visual/harness.html');
        const xml = readFileSync(join(FIXTURES_DIR, fixture), 'utf-8');

        await page.evaluate((xmlText) => window.renderMaxgraph(xmlText), xml);
        await page.waitForFunction(() => window.__BPMN_RENDERED__ === true);

        const bpmn1 = await page.evaluate(() => window.exportMaxgraphAsBpmn());
        expect(bpmn1.length).toBeGreaterThan(0);

        const original = await page.evaluate((xmlText) => window.parseBpmn(xmlText), bpmn1);

        await page.evaluate((xmlText) => window.renderBpmn(xmlText), bpmn1);
        await page.waitForFunction(() => window.__BPMN_RENDERED__ === true);
        const bpmn2 = await page.evaluate(() => window.exportBpmn());

        const wellFormed = await page.evaluate((xmlText) => {
            const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
            return doc.getElementsByTagName('parsererror').length === 0;
        }, bpmn2);
        expect(wellFormed, 'export BPMN mal formé').toBe(true);

        const reimported = await page.evaluate((xmlText) => window.parseBpmn(xmlText), bpmn2);

        expect(sortedIds(reimported.elements.participants)).toEqual(sortedIds(original.elements.participants));

        const flatLanes = (data: typeof original) =>
            data.elements.laneSets.flatMap((ls: any) => ls.lanes).concat(data.elements.lanes as any[]);
        const origLanes = flatLanes(original);
        const reLanes = flatLanes(reimported);
        expect(sortedIds(reLanes)).toEqual(sortedIds(origLanes));
        // Un flowNode assigné à une lane dans le fichier source ne doit jamais se
        // retrouver orphelin (plus rattaché à AUCUNE lane) au round-trip — en
        // revanche il peut désormais changer de lane, ou en gagner une nouvelle : la
        // position DI (géométrie réelle) prime sur le flowNodeRef déclaré
        // (getParentAndPosition, bpmn-import.ts), donc un flowNode dont le
        // flowNodeRef contredit sa position visuelle migre vers la lane qui le
        // contient réellement à l'écran, et un flowNode/artefact sans flowNodeRef
        // (dataObject/dataStore/textAnnotation, jamais listés en flowNodeRef) en
        // gagne un par repli géométrique — des gains/corrections de fidélité voulus,
        // pas des pertes à traquer ici. Cas concrets : m02-lane (task listé dans la
        // lane "Agent administratifs" mais dessiné dans la ligne "Fournisseur", migre
        // vers la bonne lane) et m06-t7 (tâches déjà placées visuellement dans leurs
        // lanes mais jamais déclarées structurellement, en gagnent une).
        const allOrigFlowNodeIds = origLanes.flatMap((l: any) => l.flowNodeRefs ?? []);
        const allReFlowNodeIds = reLanes.flatMap((l: any) => l.flowNodeRefs ?? []);
        const orphaned = allOrigFlowNodeIds.filter((id: string) => !allReFlowNodeIds.includes(id));
        expect(orphaned, 'flowNodeRefs devenus orphelins (plus rattachés à aucune lane) après round-trip').toEqual([]);

        expect(sortedIds(reimported.elements.events)).toEqual(sortedIds(original.elements.events));
        for (const ev of original.elements.events as any[]) {
            const reEv = reimported.elements.events.find((e: any) => e.id === ev.id);
            expect(reEv, `event ${ev.id} manquant après round-trip`).toBeDefined();
            expect(reEv.type, `type de l'event ${ev.id}`).toBe(ev.type);
            expect(reEv.definition, `definition de l'event ${ev.id}`).toBe(ev.definition);
            if (ev.type === 'boundaryEvent') {
                expect(reEv.attachedToRef, `attachedToRef de ${ev.id}`).toBe(ev.attachedToRef);
                expect(reEv.interrupting, `interrupting de ${ev.id}`).toBe(ev.interrupting);
            }
        }

        expect(sortedIds(reimported.elements.tasks)).toEqual(sortedIds(original.elements.tasks));
        for (const t of original.elements.tasks as any[]) {
            const reT = reimported.elements.tasks.find((x: any) => x.id === t.id);
            expect(reT?.type, `type de la task ${t.id}`).toBe(t.type);
        }

        expect(sortedIds(reimported.elements.gateways)).toEqual(sortedIds(original.elements.gateways));
        for (const g of original.elements.gateways as any[]) {
            const reG = reimported.elements.gateways.find((x: any) => x.id === g.id);
            expect(reG?.type, `type de la gateway ${g.id}`).toBe(g.type);
        }

        expect(sortedIds(reimported.elements.flows)).toEqual(sortedIds(original.elements.flows));
        for (const f of original.elements.flows as any[]) {
            const reF = reimported.elements.flows.find((x: any) => x.id === f.id);
            expect(reF, `flow ${f.id}`).toMatchObject({ source: f.source, target: f.target });
        }

        const msgPairs = (data: typeof original) =>
            data.elements.messageFlow.map((f: any) => `${f.source}->${f.target}`).sort();
        expect(msgPairs(reimported)).toEqual(msgPairs(original));

        expect(sortedIds(reimported.elements.conversationNodes)).toEqual(sortedIds(original.elements.conversationNodes));

        const convLinkPairs = (data: typeof original) =>
            data.elements.conversationLinks.map((f: any) => `${f.source}->${f.target}`).sort();
        expect(convLinkPairs(reimported)).toEqual(convLinkPairs(original));

        for (const [id, color] of Object.entries(original.colors)) {
            expect(reimported.colors[id], `couleur de ${id} après round-trip`).toEqual(color);
        }

        for (const [id, pos] of Object.entries(original.positions)) {
            const rePos = reimported.positions[id];
            expect(rePos, `position de ${id} après round-trip`).toBeDefined();
            expect(closeEnough(rePos.x, (pos as any).x), `x de ${id}: ${rePos.x} vs ${(pos as any).x}`).toBe(true);
            expect(closeEnough(rePos.y, (pos as any).y), `y de ${id}: ${rePos.y} vs ${(pos as any).y}`).toBe(true);
            expect(closeEnough(rePos.width, (pos as any).width), `width de ${id}`).toBe(true);
            expect(closeEnough(rePos.height, (pos as any).height), `height de ${id}`).toBe(true);
        }
    });
}
