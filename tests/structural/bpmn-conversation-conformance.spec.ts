// tests/structural/bpmn-conversation-conformance.spec.ts
// Conformité BPMN 2.0 (OMG dtc/2010-05-24) de l'export d'un diagramme de
// conversation, en plus du round-trip de données déjà couvert par
// mercator-bpmn-roundtrip.spec.ts. Ce dernier est un faux témoin pour la
// conformité : import et export s'accordant tous deux sur un même tag, un
// tag non standard y survivrait sans faire échouer le test. Ici on inspecte
// le XML exporté lui-même :
//   - <bpmn2:conversationNode> est une tête de substitution abstraite du XSD
//     BPMN 2.0 (tConversationNode est abstract="true") — non instanciable,
//     rejetée par tout validateur de schéma. Le concret est
//     <bpmn2:conversation>.
//   - Les enfants de <bpmn2:collaboration> doivent respecter la
//     xsd:sequence de tCollaboration : participant, messageFlow,
//     conversationNode (i.e. conversation/conversationLink dans ce sens du
//     XSD — conversationLink ferme la séquence), donc dans l'ordre
//     participant* messageFlow* conversation* conversationLink*.
// Pas de dépendance de validation XSD dans ce repo (ajv/ajv-draft-04 valident
// du JSON Schema, pas du XML) : ces assertions sont un succédané ciblé sur
// les deux points de non-conformité corrigés, pas une validation de schéma
// complète — voir la conversation avec l'utilisateur si un validateur XSD
// XML doit être ajouté.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '../helpers/console-guard';

const FIXTURE = join(
    dirname(fileURLToPath(import.meta.url)),
    '../visual/fixtures-mercator/m10-bpmn-conversation.maxgraph'
);

// Ordre imposé par xsd:sequence de tCollaboration (voir commentaire d'en-tête).
const SEQUENCE_RANK: Record<string, number> = {
    participant: 0,
    messageFlow: 1,
    conversation: 2,
    conversationLink: 3,
};

function collaborationChildOrder(xml: string): string[] {
    const collab = xml.match(/<bpmn2:collaboration[\s\S]*?<\/bpmn2:collaboration>/);
    expect(collab, 'aucune <bpmn2:collaboration> trouvée dans l\'export').toBeTruthy();
    return Array.from(collab![0].matchAll(/<bpmn2:(participant|messageFlow|conversation|conversationLink)\b/g)).map(
        (m) => m[1]
    );
}

test('export d\'un diagramme de conversation : élément concret, pas la tête de substitution abstraite', async ({
    page,
}) => {
    await page.goto('/tests/visual/harness.html');
    const xml = readFileSync(FIXTURE, 'utf-8');

    await page.evaluate((xmlText) => window.renderMaxgraph(xmlText), xml);
    await page.waitForFunction(() => window.__BPMN_RENDERED__ === true);

    const bpmn = await page.evaluate(() => window.exportMaxgraphAsBpmn());

    // Élément concret <bpmn2:conversation>, jamais l'abstrait <bpmn2:conversationNode>.
    expect(bpmn).toMatch(/<bpmn2:conversation\b/);
    expect(bpmn).not.toMatch(/<bpmn2:conversationNode\b/);
});

test('export d\'un diagramme de conversation : ordre des enfants de <collaboration> conforme au XSD', async ({
    page,
}) => {
    await page.goto('/tests/visual/harness.html');
    const xml = readFileSync(FIXTURE, 'utf-8');

    await page.evaluate((xmlText) => window.renderMaxgraph(xmlText), xml);
    await page.waitForFunction(() => window.__BPMN_RENDERED__ === true);

    const bpmn = await page.evaluate(() => window.exportMaxgraphAsBpmn());
    const order = collaborationChildOrder(bpmn);

    // Doit couvrir au moins un participant et une conversation pour que le
    // test soit significatif sur cette fixture.
    expect(order).toContain('participant');
    expect(order).toContain('conversation');

    const ranks = order.map((tag) => SEQUENCE_RANK[tag]);
    expect(ranks, `ordre observé : ${order.join(', ')}`).toEqual([...ranks].sort((a, b) => a - b));
});

test('collaboration classique (participants + messageFlows, sans conversation) reste conforme', async ({ page }) => {
    await page.goto('/tests/visual/harness.html');
    const xml = readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), '../visual/fixtures/t21-collaboration-multi-pool.bpmn'),
        'utf-8'
    );

    await page.evaluate((xmlText) => window.renderBpmn(xmlText), xml);
    await page.waitForFunction(() => window.__BPMN_RENDERED__ === true);

    const bpmn = await page.evaluate(() => window.exportBpmn());
    const order = collaborationChildOrder(bpmn);

    expect(order).toContain('participant');
    expect(order).not.toContain('conversation');
    expect(order).not.toContain('conversationLink');

    const ranks = order.map((tag) => SEQUENCE_RANK[tag]);
    expect(ranks, `ordre observé : ${order.join(', ')}`).toEqual([...ranks].sort((a, b) => a - b));
});

test('rétro-compatibilité : un fichier legacy avec <conversationNode> se réimporte toujours', async ({ page }) => {
    await page.goto('/tests/visual/harness.html');
    const xml = readFileSync(FIXTURE, 'utf-8');

    await page.evaluate((xmlText) => window.renderMaxgraph(xmlText), xml);
    await page.waitForFunction(() => window.__BPMN_RENDERED__ === true);

    const bpmn = await page.evaluate(() => window.exportMaxgraphAsBpmn());
    const original = await page.evaluate((xmlText) => window.parseBpmn(xmlText), bpmn);
    expect(original.elements.conversationNodes.length).toBeGreaterThan(0);

    // Simule un fichier déjà exporté avec l'ancien tag non standard : ne
    // touche pas <bpmn2:conversationLink> (pas de \b entre "conversation" et
    // "L", donc regex sans effet dessus).
    const legacyXml = bpmn.replace(/<bpmn2:conversation\b/g, '<bpmn2:conversationNode');
    expect(legacyXml).toContain('<bpmn2:conversationNode');
    expect(legacyXml).not.toMatch(/<bpmn2:conversationLink\bNode/);

    const reimportedLegacy = await page.evaluate((xmlText) => window.parseBpmn(xmlText), legacyXml);
    const sortedIds = (arr: Array<{ id: string }>) => arr.map((x) => x.id).sort();
    expect(sortedIds(reimportedLegacy.elements.conversationNodes)).toEqual(
        sortedIds(original.elements.conversationNodes)
    );
});
