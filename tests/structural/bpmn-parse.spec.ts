// tests/structural/bpmn-parse.spec.ts
// Tests structurels du parseur (`parseBPMN`) : vérifient que l'import
// produit la bonne structure de données, indépendamment du rendu — donc
// insensibles aux polices/antialiasing, contrairement aux captures de
// tests/visual/. Une régression ici localise précisément le problème (ex.
// bpmn2:participant mal lu, couleur non détectée, eventDefinition perdue)
// là où un diff visuel dit seulement « l'image a changé ». Aucune capture
// d'écran dans ce fichier : ces tests sont volontairement rapides et
// déterministes par construction (mêmes garanties que le harnais visuel,
// sans en payer le coût).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '../helpers/console-guard';

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '../visual/fixtures');

function readFixture(name: string): string {
    return readFileSync(join(FIXTURES_DIR, name), 'utf-8');
}

test.describe('parseBPMN — structure des données', () => {
    test('t05-pool-lanes : 1 participant, 2 lanes, flowNodeRef cohérents', async ({ page }) => {
        await page.goto('/tests/visual/harness.html');
        const xml = readFixture('t05-pool-lanes.bpmn');
        const data = await page.evaluate((xmlText) => window.parseBpmn(xmlText), xml);

        expect(data.elements.participants).toHaveLength(1);
        expect(data.elements.participants[0]).toMatchObject({ id: 'Participant_1', processRef: 'Process_t05' });

        expect(data.elements.laneSets).toHaveLength(1);
        const lanes = data.elements.laneSets[0].lanes;
        expect(lanes).toHaveLength(2);

        const laneA = lanes.find((l: any) => l.id === 'Lane_A');
        const laneB = lanes.find((l: any) => l.id === 'Lane_B');
        expect(laneA.flowNodeRefs).toEqual(['Start_1', 'Task_1', 'Activity_111bgkh']);
        expect(laneB.flowNodeRefs).toEqual(['End_1', 'Task_2']);
    });

    test('t06-message-flow : 2 participants, au moins 1 messageFlow', async ({ page }) => {
        await page.goto('/tests/visual/harness.html');
        const xml = readFixture('t06-message-flow.bpmn');
        const data = await page.evaluate((xmlText) => window.parseBpmn(xmlText), xml);

        expect(data.elements.participants).toHaveLength(2);
        expect(data.elements.messageFlow.length).toBeGreaterThanOrEqual(1);
        expect(data.elements.messageFlow[0]).toMatchObject({ source: 'Task_A', target: 'Task_B' });
    });

    test('t07-boundary-events : attachedToRef correct, interrupting true et false', async ({ page }) => {
        await page.goto('/tests/visual/harness.html');
        const xml = readFixture('t07-boundary-events.bpmn');
        const data = await page.evaluate((xmlText) => window.parseBpmn(xmlText), xml);

        const boundaries = data.elements.events.filter((e: any) => e.type === 'boundaryEvent');
        expect(boundaries).toHaveLength(2);
        expect(boundaries.every((e: any) => e.attachedToRef === 'Task_1')).toBe(true);

        const interrupting = boundaries.find((e: any) => e.id === 'Boundary_Msg');
        const nonInterrupting = boundaries.find((e: any) => e.id === 'Boundary_Timer');
        expect(interrupting).toMatchObject({ definition: 'message', interrupting: true });
        expect(nonInterrupting).toMatchObject({ definition: 'timer', interrupting: false });
    });

    test('t08-events-typed : définition correcte par événement (message / timer / terminate)', async ({ page }) => {
        await page.goto('/tests/visual/harness.html');
        const xml = readFixture('t08-events-typed.bpmn');
        const data = await page.evaluate((xmlText) => window.parseBpmn(xmlText), xml);

        const byId = (id: string) => data.elements.events.find((e: any) => e.id === id);
        expect(byId('Start_1')).toMatchObject({ definition: 'message' });
        expect(byId('Intermediate_Timer')).toMatchObject({ definition: 'timer' });
        expect(byId('End_1')).toMatchObject({ definition: 'terminate' });
    });

    test('t09-colors : carte colors peuplée (OMG + bioc), absente sans couleur propre', async ({ page }) => {
        await page.goto('/tests/visual/harness.html');
        const xml = readFixture('t09-colors.bpmn');
        const data = await page.evaluate((xmlText) => window.parseBpmn(xmlText), xml);

        expect(data.colors['Task_Omg']).toEqual({ fill: '#fde68a', stroke: '#92700c' });
        expect(data.colors['Task_Bioc']).toEqual({ fill: '#bbf7d0', stroke: '#065f46' });
        expect(data.colors['Task_Plain']).toBeUndefined();
    });
});
