// tests/visual/bpmn-import.spec.ts
// Non-régression visuelle : chaque fixture de tests/visual/fixtures/*.bpmn
// est importée dans le harnais (harness.ts, servi par le serveur de dev Vite
// — voir playwright.config.ts) et son rendu comparé à une image de
// référence.
//
// Comportement des baselines (tests/visual/__baselines__/, nommées d'après
// la fixture — t01-start-end.bpmn ⇄ t01-start-end.png) :
// - premier passage sans baseline pour une fixture -> Playwright ÉCRIT
//   tests/visual/__baselines__/tNN-….png et fait ÉCHOUER ce run (revue de
//   l'image obligatoire avant de committer fixture + baseline) ;
// - passages suivants -> comparaison pixel à pixel (tolérance : voir
//   expect.toHaveScreenshot dans playwright.config.ts) ; un écart produit un
//   diff visuel dans test-results/ ;
// - régénération volontaire après une évolution légitime du rendu :
//   `npm run test:visual:update`, puis relire les PNG modifiés avant de
//   committer.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '../helpers/console-guard';

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

// Tri par nom -> ordre t01, t02, …, t09, t20, t21, … garanti par la
// convention de nommage (préfixe numérique sur 2 chiffres).
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

        const canvas = page.locator('#bpmn-canvas');
        await expect(canvas).toHaveScreenshot(`${baseName}.png`);
    });
}
