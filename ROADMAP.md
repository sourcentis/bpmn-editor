# Roadmap

This document tracks the current state and planned work for `@sourcentis/bpmn-editor`.

## Done

- **BPMN import** — parse a BPMN document and build the corresponding diagram model.
- **BPMN export** — serialize the current diagram back to a valid BPMN document.
- **Non-regression test script** — automated round-trip and rendering checks to guard against regressions.
- **npm package publication** — publish under the `@sourcentis` scope: [sourcentis/bpmn-editor](https://www.npmjs.com/package/@sourcentis/bpmn-editor).

## In progress / planned

- **Sub-process support** — model, render, and edit embedded sub-processes, including expand/collapse.
- **Call activity support** — reference and navigate to a called sub-process (`callActivity`).

## Backlog

_Ideas and future improvements land here before being scheduled._

## Bug

- Render data does not work (v1.7)
