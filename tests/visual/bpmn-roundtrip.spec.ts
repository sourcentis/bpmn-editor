// tests/visual/bpmn-roundtrip.spec.ts
// Round-trip visuel : chaque fixture de tests/visual/fixtures/*.bpmn est
// importée, exportée via exportBPMN() (window.exportBpmn(), voir harness.ts),
// puis l'export est RÉ-IMPORTÉ et comparé à la MÊME baseline que le test
// d'import direct (tests/visual/bpmn-import.spec.ts) — pas une baseline
// séparée. Un écart ici prouve que export→ré-import ne redonne pas le rendu
// d'origine (positions, couleurs, waypoints, labels), symétriquement au
// contrat vérifié par bpmn-import.spec.ts côté import seul.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '../helpers/console-guard';

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

const fixtures = readdirSync(FIXTURES_DIR)
    .filter((name) => name.endsWith('.bpmn'))
    .sort();

for (const fixture of fixtures) {
    const baseName = fixture.replace(/\.bpmn$/, '');

    test(baseName, async ({ page }) => {
        await page.goto('/tests/visual/harness.html');

        const xml = readFileSync(join(FIXTURES_DIR, fixture), 'utf-8');
        await page.evaluate((xmlText) => window.renderBpmn(xmlText), xml);
        await page.waitForFunction(() => window.__BPMN_RENDERED__ === true);

        const exported = await page.evaluate(() => window.exportBpmn());
        expect(exported.length).toBeGreaterThan(0);

        const wellFormed = await page.evaluate((xmlText) => {
            const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
            return doc.getElementsByTagName('parsererror').length === 0;
        }, exported);
        expect(wellFormed, 'export BPMN mal formé').toBe(true);

        await page.evaluate((xmlText) => window.renderBpmn(xmlText), exported);
        await page.waitForFunction(() => window.__BPMN_RENDERED__ === true);

        const canvas = page.locator('#bpmn-canvas');
        await expect(canvas).toHaveScreenshot(`${baseName}.png`);
    });
}
