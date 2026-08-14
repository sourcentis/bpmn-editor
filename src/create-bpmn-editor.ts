// src/create-bpmn-editor.ts
// Single internal orchestration factory. Wires the previously-scattered
// bootstrap logic into a self-contained, multi-instance-safe editor with its
// own DOM, an event emitter, and a destroy() that removes every listener it
// added.
//
// NOTE (Phase 5 scope not yet covered here): `ui: 'none'` is declared in
// BpmnEditorOptions but not yet consumed — `ui` always renders the default
// chrome for now. Phase 5 adds the branch that skips it; nothing below needs
// to change shape to support that.

import { Cell, InternalEvent } from '@maxgraph/core';
import type { BpmnEditorInstance, BpmnEditorOptions, BpmnPersistencePayload } from './types';
import { BpmnEditorEmitter } from './events';
import { resolveMessages } from './messages';
import { renderEditorDom } from './ui/dom';
import { downloadXml, getXMLGraph, loadGraphXml } from './xml';
import { enableArrowKeyMovement, exportGraphAsSvgFile, initBpmnEditor, showStatus, wireEditorUi } from './bpmn-edit';
import { bindBpmnFileInput, drawDiagram, parseBPMN } from './bpmn-import';
import { exportBPMN } from './bpmn-export';
import { initVertexMenuActions } from './bpmn-menu-init';
import { setupBpmnMenuSelect } from './bpmn-menu-select';
import { installEdgeRules } from './bpmn-arrows';
import { installDropInActivitiesParent } from './bpmn-parent';
import { initCopyPaste } from './bpmn-copy-paste';
import { initZOrder, setupBringToFrontKeyBinding } from './bpmn-zorder';

export function createBpmnEditor(container: HTMLElement, options: BpmnEditorOptions = {}): BpmnEditorInstance {
    const ui = options.ui ?? 'default';
    const readOnly = options.readOnly ?? false;
    const messages = resolveMessages(options.messages);

    const emitter = new BpmnEditorEmitter();
    const disposers: Array<() => void> = [];
    let destroyed = false;

    const dom = renderEditorDom(container, { ui, readOnly });

    let menuController: { hide(): void; destroy(): void } | null = null;
    const { graph, undoManager, dispose: disposeCore } = initBpmnEditor(dom.canvas, {
        onHideMenu: () => menuController?.hide(),
        // In `ui: 'default'` the built-in palette (dom.paletteRoot) is the
        // drag-source root; in `ui: 'none'` there is none, so fall back to a
        // host-provided container (see BpmnEditorOptions.paletteRoot).
        paletteRoot: dom.paletteRoot ?? options.paletteRoot ?? null,
    });
    disposers.push(disposeCore);

    // ── Selection / change tracking ────────────────────────────────────────
    const onSelectionChange = () => {
        const cells = graph.getSelectionCells() as Cell[];
        emitter.emit('select', cells.length === 1 ? cells[0] : null);
    };
    graph.getSelectionModel().addListener(InternalEvent.CHANGE, onSelectionChange);
    disposers.push(() => graph.getSelectionModel().removeListener(onSelectionChange));

    const onModelChange = () => emitter.emit('change', undefined);
    graph.getDataModel().addListener(InternalEvent.CHANGE, onModelChange);
    disposers.push(() => graph.getDataModel().removeListener(onModelChange));

    if (readOnly) {
        graph.setEnabled(false);
        graph.setCellsSelectable(true);

        const onWheel = (evt: WheelEvent) => {
            if (Math.abs(evt.deltaX) <= 0.5 && Math.abs(evt.deltaY) <= 0.5) return;
            if (evt.ctrlKey) evt.preventDefault();
            const up = evt.deltaY === 0 ? -evt.deltaX > 0 : -evt.deltaY > 0;
            if (up) graph.zoomIn(); else graph.zoomOut();
            evt.preventDefault();
        };
        graph.container.addEventListener('wheel', onWheel, { passive: false });
        disposers.push(() => graph.container.removeEventListener('wheel', onWheel));

        const onMouseMove = (e: MouseEvent) => {
            const rect = graph.container.getBoundingClientRect();
            const cell = graph.getCellAt(e.clientX - rect.left, e.clientY - rect.top) as (Cell & { url?: string }) | null;
            graph.container.style.cursor = cell?.url ? 'pointer' : 'default';
        };
        graph.container.addEventListener('mousemove', onMouseMove);
        disposers.push(() => graph.container.removeEventListener('mousemove', onMouseMove));

        const onClick = (_sender: unknown, evt: any) => {
            const cell = evt.getProperty('cell') as (Cell & { url?: string }) | null;
            if (!cell || !cell.isVertex() || !cell.url) return;
            emitter.emit('navigate', cell.url);
            options.onNavigate?.(cell.url);
        };
        graph.addListener(InternalEvent.CLICK, onClick);
        disposers.push(() => graph.removeListener(onClick));
    } else {
        const disposeUi = wireEditorUi(graph, undoManager, { toolbarRoot: dom.toolbar, fontUrl: options.fontUrl });
        disposers.push(disposeUi);

        const disposeEdgeRules = installEdgeRules(graph);
        disposers.push(disposeEdgeRules);

        const disposeDropParent = installDropInActivitiesParent(graph);
        disposers.push(disposeDropParent);

        const disposeCopyPaste = initCopyPaste(graph);
        disposers.push(disposeCopyPaste);

        const disposeArrowKeys = enableArrowKeyMovement(graph, { onHideMenu: () => menuController?.hide() });
        disposers.push(disposeArrowKeys);

        const disposeZOrder = initZOrder(graph);
        disposers.push(disposeZOrder);

        const disposeBringToFront = setupBringToFrontKeyBinding(graph, graph.container);
        disposers.push(disposeBringToFront);

        if (dom.menuEl) {
            const controller = initVertexMenuActions(graph, undoManager, dom.menuEl);
            menuController = controller;
            disposers.push(() => controller.destroy());

            const disposeMenuSelect = setupBpmnMenuSelect(graph, dom.menuEl, dom.root, {
                provider: options.provider,
                messages,
                onError: (err) => emitter.emit('error', err),
            });
            disposers.push(disposeMenuSelect);
        }

        if (dom.fileInput) {
            const disposeFileInput = bindBpmnFileInput(graph, dom.fileInput, {
                statusEl: dom.statusEl,
                loadSuccessMessage: messages.loadSuccess,
                loadErrorMessage: messages.loadError,
                onError: (err) => emitter.emit('error', err),
            });
            disposers.push(disposeFileInput);
        }

        if (dom.toolbar) {
            const exportBtn = dom.toolbar.querySelector<HTMLElement>('[data-action="export-bpmn"]');
            const onExportBpmn = () => {
                let xml: string;
                try {
                    xml = exportBPMN(graph);
                } catch (err) {
                    showStatus(dom.statusEl, messages.exportError);
                    emitter.emit('error', err instanceof Error ? err : new Error(String(err)));
                    return;
                }
                downloadXml(xml, 'export.bpmn');
                showStatus(dom.statusEl, messages.exportBpmnSuccess);
            };
            exportBtn?.addEventListener('click', onExportBpmn);
            disposers.push(() => exportBtn?.removeEventListener('click', onExportBpmn));

            const saveBtn = dom.toolbar.querySelector<HTMLElement>('[data-action="save"]');
            const onSave = () => {
                void (async () => {
                    let xml: string;
                    try {
                        xml = getXMLGraph(graph);
                    } catch (err) {
                        showStatus(dom.statusEl, messages.exportError);
                        emitter.emit('error', err instanceof Error ? err : new Error(String(err)));
                        return;
                    }
                    if (!xml) {
                        showStatus(dom.statusEl, messages.exportError);
                        return;
                    }

                    if (!options.persistence) {
                        // No BpmnPersistence configured — fall back to a local file
                        // download, exactly like "Download .md" in a Markdown editor.
                        downloadXml(xml);
                        showStatus(dom.statusEl, messages.saveSuccess);
                        return;
                    }

                    // The default chrome has no name/type fields of its own — hosts
                    // that need to attach that metadata should mount with
                    // `ui: 'none'`, own their toolbar, and call their
                    // BpmnPersistence implementation directly.
                    const payload: BpmnPersistencePayload = { id: -1, name: '', type: '', content: xml };
                    emitter.emit('save', payload);

                    try {
                        await options.persistence.save(payload);
                        showStatus(dom.statusEl, messages.saveSuccess);
                    } catch (err) {
                        showStatus(dom.statusEl, messages.saveError);
                        emitter.emit('error', err instanceof Error ? err : new Error(String(err)));
                    }
                })();
            };
            saveBtn?.addEventListener('click', onSave);
            disposers.push(() => saveBtn?.removeEventListener('click', onSave));
        }

        if (dom.statusEl) {
            showStatus(dom.statusEl, messages.welcome);
        }
    }

    // Auto-fit the container's height to the loaded content in readOnly mode
    // — matches the previous standalone "show" bootstrap's behavior, so an
    // embedded read-only diagram doesn't need a fixed/guessed height from the
    // host page. The timeout mirrors the original: MaxGraph needs a tick to
    // finish laying out the newly-imported cells before bounds are accurate.
    const adjustReadOnlyContainerHeight = (): void => {
        const bounds = graph.getGraphBounds();
        if (!bounds) return;
        const finalHeight = Math.max(200, bounds.y + bounds.height + 30);
        graph.container.style.height = `${finalHeight}px`;
        graph.container.style.width = '100%';
    };

    const instance: BpmnEditorInstance = {
        loadXml(xml: string): void {
            try {
                loadGraphXml(graph, xml);
                emitter.emit('change', undefined);
                if (readOnly) setTimeout(adjustReadOnlyContainerHeight, 150);
            } catch (err) {
                emitter.emit('error', err instanceof Error ? err : new Error(String(err)));
                throw err;
            }
        },

        getXml(): string {
            return getXMLGraph(graph);
        },

        importBpmnXml(xml: string): void {
            try {
                const data = parseBPMN(xml);
                drawDiagram(graph, data);
                emitter.emit('change', undefined);
                if (readOnly) setTimeout(adjustReadOnlyContainerHeight, 150);
            } catch (err) {
                emitter.emit('error', err instanceof Error ? err : new Error(String(err)));
                throw err;
            }
        },

        exportBpmnXml(): string {
            try {
                return exportBPMN(graph);
            } catch (err) {
                emitter.emit('error', err instanceof Error ? err : new Error(String(err)));
                throw err;
            }
        },

        async exportSvg(filename?: string): Promise<void> {
            try {
                await exportGraphAsSvgFile(graph, options.fontUrl, filename);
            } catch (err) {
                emitter.emit('error', err instanceof Error ? err : new Error(String(err)));
                throw err;
            }
        },

        setEnabled(enabled: boolean): void {
            graph.setEnabled(enabled);
        },

        on(event, handler) {
            emitter.on(event, handler);
        },

        off(event, handler) {
            emitter.off(event, handler);
        },

        zoomIn(): void {
            graph.zoomIn();
        },

        zoomOut(): void {
            graph.zoomOut();
        },

        fit(): void {
            graph.center();
        },

        destroy(): void {
            if (destroyed) return;
            destroyed = true;

            for (const dispose of disposers.splice(0)) {
                try {
                    dispose();
                } catch {
                    // best-effort cleanup — one failing disposer must not block the rest
                }
            }

            graph.destroy();
            dom.destroy();
            emitter.clear();
        },
    };

    return instance;
}
