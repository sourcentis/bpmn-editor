# Changelog

All notable changes to this package are documented in this file. Format
loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [1.0.0] — Unreleased

Everything below landed on top of the initial 0.1.0 scaffold: the actual
core migration, librarification, decoupling from Mercator, asset bundling,
the Mercator adapter, and full documentation. Declaring the public API
stable now that Mercator runs on it in production.

### Added

- `createBpmnEditor(container, options)` — single entry point, no side
  effects at import time, multi-instance safe.
- `ui: 'default'` (built-in toolbar, drag-and-drop palette, status bar) and
  `ui: 'none'` (canvas-only, host owns the chrome) modes.
- `readOnly` viewer mode: disabled editing, wheel zoom, click-to-navigate
  on linked elements, auto-resizing container.
- Optional `BpmnObjectProvider` and `BpmnPersistence` ports for backend
  integration — the editor works fully standalone without either.
- `paletteRoot` option to reuse a host's own palette markup as drag sources
  in `ui: 'none'` mode.
- Typed event emitter (`change`, `select`, `save`, `navigate`, `error`).
- `messages` option for full i18n of user-facing strings (default: French).
- Bundled, inlined BPMN glyph font and toolbar/menu icons — no external
  font or icon dependency.
- `exportSvg()` instance method (also available as a built-in toolbar
  button).
- `importBpmnXml()` instance method — parses standard BPMN 2.0 XML (the
  same parser the built-in toolbar's file-input Import button uses),
  exposed for `ui: 'none'` hosts and programmatic use.

### Changed from the original Mercator-embedded editor

- All Laravel/Mercator-specific code (routes, CSRF, `_method: PUT`,
  `window.location`, hardcoded DOM ids) removed from the core — it now
  lives in Mercator's own thin adapter (`mercator-provider.ts`,
  `mercator-persistence.ts`, `bpmn.ts`, `bpmn-show.ts`), outside this
  package.
- The editor now builds its own DOM and injects its own scoped
  (`bpmn-editor-*` prefixed) CSS instead of assuming host page markup/CSS.
- `window.loadGraph`/`window.getXMLGraph` globals replaced by instance
  methods (`loadXml`/`getXml`); a host that still needs the old globals for
  compatibility can shim them itself by delegating to the instance.

## [0.1.0]

Initial package scaffold (`package.json`, build config, port/option type
definitions) — reserved the name on npm ahead of the actual core migration.
