import { AbstractGraph, ModelXmlSerializer } from '@maxgraph/core';

export function loadGraphXml(graph: AbstractGraph, xml: string): void {
    new ModelXmlSerializer(graph.model).import(xml);
}

export function getXMLGraph(graph: AbstractGraph): string {
    return new ModelXmlSerializer(graph.model).export();
}

/** Fallback used by the default "Save" toolbar action when no BpmnPersistence port is configured. */
export function downloadXml(xml: string, filename = 'diagram.bpmn'): void {
    const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();

    URL.revokeObjectURL(url);
}
