# Sandbox Styles

Vanilla CSS grouped by concern; no CSS-in-JS or pre-processors to keep payload small.

| Path | Contents |
|------|----------|
| `variables.css` | Global colour & spacing tokens |
| `base.css` | Core styles for canvas, windows & context menus |
| `components/` | Component-scoped CSS files (names mirror `/components`) |
| `utils/` | Minor utility classes / mixins |

All selectors are prefixed with `.sandbox-` to avoid bleeding into the public site. 