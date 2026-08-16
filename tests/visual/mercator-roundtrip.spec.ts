// tests/visual/mercator-roundtrip.spec.ts
// Non-régression sur des schémas RÉELS extraits de la base de données de
// production Mercator (table `graphs`, colonne `content` — format natif
// GraphDataModel de loadXml/getXml, PAS du BPMN 2.0), voir
// tests/visual/fixtures-mercator/. Contrairement à bpmn-import.spec.ts /
// bpmn-roundtrip.spec.ts (fixtures BPMN 2.0 XML écrites à la main, passées
// par importBpmnXml), ces fixtures passent par loadXml (renderMaxgraph) puis
// exportBpmnXml (exportMaxgraphAsBpmn) — voir harness.ts.
//
// Deux garanties par fixture, sur DEUX baselines séparées (voir plus bas
// pourquoi pas la même) :
// 1. Rendu natif stable : loadXml(schéma) doit produire toujours la même
//    image — ${baseName}.png.
// 2. Aller-retour BPMN stable : exportBpmnXml() du schéma chargé, réimporté
//    via importBpmnXml (renderBpmn), doit lui aussi produire toujours la
//    même image — ${baseName}-bpmn-roundtrip.png.
//
// Pourquoi deux baselines et pas une seule comparaison 1↔2 : le contenu
// Mercator réel n'est pas forcément déjà stylé en BPMN canonique — une tâche
// peut porter une icône décorative propre à Mercator (enveloppe, personnage,
// pictogramme de cartographie...) que parseBPMN()/exportBPMN() n'ont aucune
// raison de connaître. L'aller-retour BPMN normalise donc légitimement ces
// glyphes vers les pictogrammes BPMN canoniques (ex. un gateway exclusif
// affiche sa croix, une tâche perd son icône métier) : exiger un pixel-perfect
// contre le rendu natif ferait échouer le test sur un comportement correct.
// La garantie utile ici est que l'aller-retour lui-même reste déterministe ;
// la fidélité des DONNÉES (ids, positions, couleurs, flowNodeRefs...) est
// déjà vérifiée indépendamment par tests/structural/mercator-bpmn-roundtrip.spec.ts.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '../helpers/console-guard';

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures-mercator');

const fixtures = readdirSync(FIXTURES_DIR)
    .filter((name) => name.endsWith('.maxgraph'))
    .sort();

for (const fixture of fixtures) {
    const baseName = fixture.replace(/\.maxgraph$/, '');

    test(`${baseName} : rendu natif stable`, async ({ page }) => {
        await page.goto('/tests/visual/harness.html');
        const xml = readFileSync(join(FIXTURES_DIR, fixture), 'utf-8');

        await page.evaluate((xmlText) => window.renderMaxgraph(xmlText), xml);
        await page.waitForFunction(() => window.__BPMN_RENDERED__ === true);

        const canvas = page.locator('#bpmn-canvas');
        await expect(canvas).toHaveScreenshot(`${baseName}.png`);
    });

    test(`${baseName} : aller-retour BPMN stable`, async ({ page }) => {
        await page.goto('/tests/visual/harness.html');
        const xml = readFileSync(join(FIXTURES_DIR, fixture), 'utf-8');

        await page.evaluate((xmlText) => window.renderMaxgraph(xmlText), xml);
        await page.waitForFunction(() => window.__BPMN_RENDERED__ === true);

        const exported = await page.evaluate(() => window.exportMaxgraphAsBpmn());
        expect(exported.length).toBeGreaterThan(0);

        const wellFormed = await page.evaluate((xmlText) => {
            const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
            return doc.getElementsByTagName('parsererror').length === 0;
        }, exported);
        expect(wellFormed, 'export BPMN mal formé').toBe(true);

        await page.evaluate((xmlText) => window.renderBpmn(xmlText), exported);
        await page.waitForFunction(() => window.__BPMN_RENDERED__ === true);

        const canvas = page.locator('#bpmn-canvas');
        await expect(canvas).toHaveScreenshot(`${baseName}-bpmn-roundtrip.png`);
    });
}
