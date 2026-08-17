// tests/structural/bpmn-roundtrip.spec.ts
// Round-trip structurel : pour chaque fixture, parseBPMN(exportBPMN(graph))
// doit décrire le MÊME diagramme que parseBPMN(fixture d'origine) — mêmes
// ids de participants/lanes/events/tasks/gateways/flux, mêmes
// definition/interrupting/attachedToRef d'event, mêmes couleurs, mêmes
// positions DI à l'arrondi près. Pas de comparaison de chaîne XML brute
// (l'ordre des attributs/éléments n'est pas significatif) — seule la
// structure de données que parseBPMN() en tire compte, exactement comme
// bpmn-parse.spec.ts pour l'import seul.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '../helpers/console-guard';

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '../visual/fixtures');

const fixtures = readdirSync(FIXTURES_DIR)
    .filter((name) => name.endsWith('.bpmn'))
    .sort();

const sortedIds = (arr: Array<{ id: string }>) => arr.map((x) => x.id).sort();
const closeEnough = (a: number, b: number, tolerance = 0.5) => Math.abs(a - b) < tolerance;

for (const fixture of fixtures) {
    const baseName = fixture.replace(/\.bpmn$/, '');

    test(baseName, async ({ page }) => {
        await page.goto('/tests/visual/harness.html');
        const xml = readFileSync(join(FIXTURES_DIR, fixture), 'utf-8');

        await page.evaluate((xmlText) => window.renderBpmn(xmlText), xml);
        await page.waitForFunction(() => window.__BPMN_RENDERED__ === true);

        const original = await page.evaluate((xmlText) => window.parseBpmn(xmlText), xml);
        const exported = await page.evaluate(() => window.exportBpmn());

        const wellFormed = await page.evaluate((xmlText) => {
            const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
            return doc.getElementsByTagName('parsererror').length === 0;
        }, exported);
        expect(wellFormed, 'export BPMN mal formé').toBe(true);

        const reimported = await page.evaluate((xmlText) => window.parseBpmn(xmlText), exported);

        // Participants : mêmes ids.
        expect(sortedIds(reimported.elements.participants)).toEqual(sortedIds(original.elements.participants));

        // Lanes (laneSets à plat + lanes standalone) : mêmes ids, mêmes
        // flowNodeRefs (triés — l'ordre d'émission n'est pas significatif).
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
        // pas des pertes à traquer ici.
        const allOrigFlowNodeIds = origLanes.flatMap((l: any) => l.flowNodeRefs ?? []);
        const allReFlowNodeIds = reLanes.flatMap((l: any) => l.flowNodeRefs ?? []);
        const orphaned = allOrigFlowNodeIds.filter((id: string) => !allReFlowNodeIds.includes(id));
        expect(orphaned, 'flowNodeRefs devenus orphelins (plus rattachés à aucune lane) après round-trip').toEqual([]);

        // Events : mêmes ids, même type/definition ; pour les boundary,
        // mêmes attachedToRef/interrupting.
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

        // Tasks : mêmes ids, même type (task/userTask/serviceTask/…).
        expect(sortedIds(reimported.elements.tasks)).toEqual(sortedIds(original.elements.tasks));
        for (const t of original.elements.tasks as any[]) {
            const reT = reimported.elements.tasks.find((x: any) => x.id === t.id);
            expect(reT?.type, `type de la task ${t.id}`).toBe(t.type);
        }

        // Gateways : mêmes ids, même type.
        expect(sortedIds(reimported.elements.gateways)).toEqual(sortedIds(original.elements.gateways));
        for (const g of original.elements.gateways as any[]) {
            const reG = reimported.elements.gateways.find((x: any) => x.id === g.id);
            expect(reG?.type, `type de la gateway ${g.id}`).toBe(g.type);
        }

        // sequenceFlow : mêmes ids, mêmes source/target.
        expect(sortedIds(reimported.elements.flows)).toEqual(sortedIds(original.elements.flows));
        for (const f of original.elements.flows as any[]) {
            const reF = reimported.elements.flows.find((x: any) => x.id === f.id);
            expect(reF, `flow ${f.id}`).toMatchObject({ source: f.source, target: f.target });
        }

        // messageFlow : mêmes paires source->target (les ids de messageFlow
        // ne sont pas assertés individuellement par bpmn-parse.spec.ts non
        // plus — seule la relation source/target compte côté import).
        const msgPairs = (data: typeof original) =>
            data.elements.messageFlow.map((f: any) => `${f.source}->${f.target}`).sort();
        expect(msgPairs(reimported)).toEqual(msgPairs(original));

        // Couleurs : la carte colors doit porter les mêmes valeurs pour
        // chaque id qui en avait une dans l'original.
        for (const [id, color] of Object.entries(original.colors)) {
            expect(reimported.colors[id], `couleur de ${id} après round-trip`).toEqual(color);
        }

        // Positions DI : coordonnées absolues identiques à l'arrondi près
        // pour tout élément qui avait une position dans l'original (un
        // process "nu" sans laneSet n'a jamais de BPMNShape, ni côté
        // original ni côté export — rien à comparer pour lui ici).
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
