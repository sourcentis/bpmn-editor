import type { Cell } from '@maxgraph/core';

// ── Element catalogue (BPMN palette entries, imported object references, …) ────

export type BpmnElementDef = {
    id: string;
    name: string;
    glyph: string;
    url?: string;
};

// ── Ports (all optional — the editor degrades gracefully without them) ────────

export interface BpmnObjectProvider {
    getGraphObjects(): Promise<BpmnElementDef[]>;
    getInformationObjects(): Promise<BpmnElementDef[]>;
    getActorObjects(): Promise<BpmnElementDef[]>;
    getProcessObjects(): Promise<BpmnElementDef[]>;
}

export interface BpmnPersistencePayload {
    id: number;
    name: string;
    type: string;
    content: string;
}

export interface BpmnPersistenceResult {
    id: number;
}

export interface BpmnPersistence {
    save(payload: BpmnPersistencePayload): Promise<BpmnPersistenceResult>;
}

// ── Options ─────────────────────────────────────────────────────────────────

export type BpmnEditorUiMode = 'default' | 'none';

/**
 * UI strings. All keys are optional; unset keys fall back to the bundled
 * French defaults.
 */
export interface BpmnEditorMessages {
    welcome?: string;
    saveSuccess?: string;
    saveError?: string;
    saveNameRequired?: string;
    exportError?: string;
    exportBpmnSuccess?: string;
    loadSuccess?: string;
    loadError?: string;
    xmlParseError?: string;
    filterPlaceholder?: string;
    filterAriaLabel?: string;
    noMatch?: string;
}

export interface BpmnEditorOptions {
    /** 'default' (built-in toolbar + status bar) or 'none' (canvas only). Default: 'default'. */
    ui?: BpmnEditorUiMode;
    provider?: BpmnObjectProvider;
    persistence?: BpmnPersistence;
    onNavigate?: (url: string) => void;
    /** Read-only ("show") mode: no editing, click-to-navigate, wheel zoom. Default: false. */
    readOnly?: boolean;
    messages?: BpmnEditorMessages;
    /** Overrides the bundled BPMN icon font URL used for SVG export embedding. */
    fontUrl?: string;
    /**
     * In `ui: 'none'` mode there is no built-in palette, so nothing wires
     * drag-and-drop shape insertion. Point this at a host-owned container
     * whose descendants carry `data-node-type` attributes (one of:
     * `task-node`, `state-node`, `gateway-node`, `data-node`,
     * `activities-node`, `annotation-node`, `lane-node`,
     * `conversation-node`) to reuse the same drag-to-insert mechanism the
     * built-in `ui: 'default'` palette uses. Ignored when `ui: 'default'`.
     */
    paletteRoot?: HTMLElement | null;
}

// ── Events ──────────────────────────────────────────────────────────────────

export interface BpmnEditorEventMap {
    change: undefined;
    save: BpmnPersistencePayload;
    select: Cell | null;
    navigate: string;
    error: Error;
}

export type BpmnEditorEventName = keyof BpmnEditorEventMap;

// ── Public instance API ────────────────────────────────────────────────────

export interface BpmnEditorInstance {
    /**
     * Replaces the graph with the one described by `xml`, in the editor's
     * own serialization format (what `getXml()` produces) — not standard
     * BPMN 2.0 XML. Use `importBpmnXml` for that.
     */
    loadXml(xml: string): void;
    /** Serializes the current graph — round-trips with `loadXml`. */
    getXml(): string;
    /**
     * Replaces the graph by parsing standard BPMN 2.0 XML (`<definitions>`,
     * `<process>`, `<bpmndi:BPMNShape>` positions, …) — the format real BPMN
     * modeling tools export, and what the built-in `ui: 'default'` toolbar's
     * file-input Import button reads. Symmetric counterpart: `exportBpmnXml`.
     */
    importBpmnXml(xml: string): void;
    /**
     * Serializes the current graph as standard BPMN 2.0 XML — the format
     * `importBpmnXml` reads, and what a real BPMN modeling tool would produce.
     * Symmetric to `importBpmnXml`: round-trips through the same
     * `<definitions>`/`<process>`/`<bpmndi:BPMNShape>` shape, not the editor's
     * own `loadXml()`/`getXml()` format.
     */
    exportBpmnXml(): string;
    setEnabled(enabled: boolean): void;
    on<K extends BpmnEditorEventName>(
        event: K,
        handler: (payload: BpmnEditorEventMap[K]) => void
    ): void;
    off<K extends BpmnEditorEventName>(
        event: K,
        handler: (payload: BpmnEditorEventMap[K]) => void
    ): void;
    zoomIn(): void;
    zoomOut(): void;
    fit(): void;
    /**
     * Exports the current graph as an SVG file and triggers a download —
     * the same behavior the built-in `ui: 'default'` toolbar's "download-svg"
     * action uses, exposed so a `ui: 'none'` host can wire its own button to
     * it. Resolves once the download has been triggered.
     */
    exportSvg(filename?: string): Promise<void>;
    destroy(): void;
}
