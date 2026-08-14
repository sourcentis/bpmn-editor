// tests/helpers/console-guard.ts
// Filet « zéro erreur console » : fixture Playwright auto-appliquée à chaque
// test qui importe `test` depuis ce module. Collecte les messages console de
// niveau "error" et les exceptions non gérées (`pageerror`) pendant tout le
// test, puis échoue si la liste n'est pas vide en fin de test — une
// régression qu'un diff d'image ou une assertion structurelle ne détecte
// pas forcément (exception silencieuse, style `undefined`, ressource
// manquante…).
import { test as base, expect } from '@playwright/test';

export const test = base.extend<{ consoleErrors: string[] }>({
    // `auto: true` : la fixture s'active pour chaque test sans que la spec
    // ait besoin de déclarer explicitement `{ consoleErrors }` dans ses
    // paramètres.
    consoleErrors: [
        async ({ page }, use) => {
            const errors: string[] = [];

            page.on('console', (msg) => {
                if (msg.type() === 'error') {
                    errors.push(`[console] ${msg.text()}`);
                }
            });
            page.on('pageerror', (err) => {
                errors.push(`[pageerror] ${err.message}`);
            });

            await use(errors);

            expect(
                errors,
                `Erreurs console/pageerror inattendues pendant le test :\n${errors.join('\n')}`
            ).toEqual([]);
        },
        { auto: true },
    ],
});

export { expect };
