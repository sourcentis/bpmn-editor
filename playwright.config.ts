// playwright.config.ts
// Configuration strictement déterministe : un seul navigateur (chromium),
// viewport fixe, pas d'animation, tolérance de diff modérée pour
// l'antialiasing. Voir la section "Tests" de CONTRIBUTING.md pour le détail
// des familles de tests (visuel / structurel / filet zéro erreur console).
import { defineConfig, devices } from '@playwright/test';

const PORT = 5183;

export default defineConfig({
    testDir: 'tests',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    reporter: 'list',

    // Nom de baseline = nom de la fixture (`t01-start-end.png`), pas un nom
    // auto-généré par Playwright (qui inclurait le nom du test/projet).
    snapshotPathTemplate: 'tests/visual/__baselines__/{arg}{ext}',

    expect: {
        toHaveScreenshot: {
            animations: 'disabled',
            caret: 'hide',
            maxDiffPixelRatio: 0.01,
        },
    },

    use: {
        baseURL: `http://localhost:${PORT}`,
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 1,
        colorScheme: 'light',
        trace: 'retain-on-failure',
    },

    projects: [
        {
            name: 'chromium',
            use: {
                ...devices['Desktop Chrome'],
                // Explicites malgré le preset ci-dessus : la reproductibilité des
                // baselines ne doit pas dépendre d'une valeur par défaut qui
                // pourrait changer d'une version de Playwright à l'autre.
                viewport: { width: 1280, height: 720 },
                deviceScaleFactor: 1,
                colorScheme: 'light',
            },
        },
    ],

    webServer: {
        command: `npm run dev -- --port ${PORT} --strictPort`,
        // Le projet n'a pas de index.html à la racine (seuls examples/*.html
        // et tests/visual/harness.html sont des pages servies) — la sonde de
        // disponibilité de Playwright exige un 2xx sur `/` (ou `/index.html`
        // à défaut), donc on la pointe explicitement vers une page qui
        // existe réellement.
        url: `http://localhost:${PORT}/tests/visual/harness.html`,
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
    },
});
