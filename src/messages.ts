import type { BpmnEditorMessages } from './types';

/** French defaults — mirror the strings the editor previously hardcoded. */
export const DEFAULT_MESSAGES: Required<BpmnEditorMessages> = {
    welcome:            '👋 Bienvenue ! Charge un fichier BPMN',
    saveSuccess:        '✓ Graphe sauvegardé',
    saveError:          'Erreur lors de la sauvegarde du graphe.',
    saveNameRequired:   'Le nom du graphe est obligatoire.',
    exportError:        '✗ Impossible de générer le BPMN',
    loadSuccess:        '✓ Fichier chargé avec succès',
    loadError:          '✗ Erreur lors du chargement du fichier',
    xmlParseError:      'Erreur de parsing XML',
    filterPlaceholder:  'Filter...',
    filterAriaLabel:    'Filter elements',
    noMatch:            'No match.',
};

export function resolveMessages(overrides?: BpmnEditorMessages): Required<BpmnEditorMessages> {
    return { ...DEFAULT_MESSAGES, ...overrides };
}
