// tests/perf/bpmn-perf.spec.ts
// Extension optionnelle (Phase 7) retenue : budget de performance grossier
// sur l'import des fixtures complexes (t20+). Ce n'est pas un banc de perf
// fin — juste un garde-fou de non-régression avec un seuil volontairement
// large, pour repérer une régression flagrante (ex. boucle O(n²) introduite
// par erreur) sans jamais faire flakier la suite sous charge CI variable.
// N'est inclus ni dans `npm run test:visual` ni dans `npm run test:structural`
// (filtrés sur leurs dossiers respectifs) — seulement dans `npm test`.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '../helpers/console-guard';

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '../visual/fixtures');

const COMPLEX_FIXTURES = [
    't20-collaboration-lanes-subprocess.bpmn',
    't21-collaboration-multi-pool.bpmn',
    't22-call-activity.bpmn',
];

const BUDGET_MS = 2000;

for (const fixture of COMPLEX_FIXTURES) {
    test(`budget perf : ${fixture} importe en moins de ${BUDGET_MS}ms`, async ({ page }) => {
        await page.goto('/tests/visual/harness.html');
        const xml = readFileSync(join(FIXTURES_DIR, fixture), 'utf-8');

        const durationMs = await page.evaluate(async (xmlText) => {
            const start = performance.now();
            await window.renderBpmn(xmlText);
            return performance.now() - start;
        }, xml);

        expect(durationMs).toBeLessThan(BUDGET_MS);
    });
}
