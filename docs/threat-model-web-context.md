# Web-Context Threat Model

## Scope

The log viewer runs in VS Code desktop, VS Code web, and a future Salesforce org-hosted browser context. Debug logs, webview messages, and any embedding frame are untrusted inputs.

## Threats and controls

| Threat                                                       | Control                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Crafted log content creates executable markup                | Render ordinary text with Lit or DOM text nodes. SOQL/SOSL HTML formatter escapes every dynamic token and has hostile-input tests. The CSP limits damage if a future sink regresses.                                                                                                                         |
| Hostile postMessage payload triggers an extension capability | The viewer and extension reject malformed message envelopes and command payloads. `openPath` ignores caller data and opens only the URI bound to its panel.                                                                                                                                                  |
| Crafted URL opens a command or local resource                | `openUrl` accepts only `https` URIs. Command URIs are disabled for the webview.                                                                                                                                                                                                                              |
| Hostile outer frame impersonates the host                    | The current viewer has no org-host messaging contract with a stable expected origin or source. It therefore validates message shape but cannot safely implement origin checks yet. A future parent-frame protocol must bind exact configured `origin` and `event.source`, never wildcard or suffix matching. |
| Cross-tenant data leaks through browser resources            | The CSP defaults to deny, permits only viewer assets, and disallows network egress, child frames, objects, and base URL changes. Extension operations remain mediated through the message boundary.                                                                                                          |

## Residual risk

The CSP is defense in depth, not a replacement for safe rendering. A meta CSP cannot enforce `frame-ancestors`; the planned Salesforce host must apply that response header or equivalent framing policy. It must also define its expected sender origin, source, and tenant isolation contract before enabling parent-window messaging.
