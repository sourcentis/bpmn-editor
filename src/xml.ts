import { AbstractGraph, ModelXmlSerializer } from '@maxgraph/core';

export function loadGraphXml(graph: AbstractGraph, xml: string): void {
    new ModelXmlSerializer(graph.model).import(xml);
}

export function getXMLGraph(graph: AbstractGraph): string {
    return new ModelXmlSerializer(graph.model).export();
}

/**
 * Triggers a browser download of `xml`. Used by the default "Save" toolbar
 * action (as a fallback when no `BpmnPersistence` port is configured — the
 * default `.maxgraph` extension matches `getXml()`'s own serialization
 * format, distinct from the real BPMN 2.0 XML `exportBpmnXml()`/the
 * "Export" toolbar button produce) and by "Export" itself, with an explicit
 * `.bpmn` filename.
 */
export function downloadXml(xml: string, filename = 'diagram.maxgraph'): void {
    const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();

    URL.revokeObjectURL(url);
}
