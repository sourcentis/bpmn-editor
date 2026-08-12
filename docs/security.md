# Security / CSP

The editor is safe to use under a strict [Content Security
Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP) — no
`unsafe-inline`, no `unsafe-eval` needed for anything the package itself
does:

- **No inline event handlers.** Every listener is wired via
  `addEventListener`; nothing sets `onclick="…"`-style attributes.
- **No `eval`, no `new Function(...)`.** (`@maxgraph/core`, a peer
  dependency and not part of this package's own code, does contain one
  internal `eval` call in a utility function — not something this package
  controls or triggers in normal use.)
- **User/provider-supplied data is never interpreted as HTML.** Element
  names and glyphs coming from a `BpmnObjectProvider` response, imported
  file contents, and anything else that isn't a fixed string the package
  itself wrote are always inserted via `.textContent`, never `.innerHTML`.
  The only `.innerHTML` assignment in the codebase writes a static template
  string with one interpolated value — a build-time-bundled icon data URI,
  never external or user-controlled data.
- **Styles are injected via a `<style>` tag**, not external stylesheets or
  inline `style="..."` attributes on untrusted content — this needs
  `style-src` to allow the page's own injected styles the way any
  JS-in-the-page approach does, but nothing beyond that.

## What's out of scope

CSRF tokens, credentials, and cookies are entirely the host's
responsibility, handled inside your `BpmnPersistence`/`BpmnObjectProvider`
implementations — the editor itself never makes a network request. See the
[backend integration guide](./guides/backend-integration.md) and
Mercator's adapter there for a concrete CSRF example.
