# 013 — Theme toggle with light default replaces following system setting

**Date:** 2026-10-09  
**Status:** Accepted

## Context

Decision 012 set up CSS-native theming where dark mode could activate automatically via `prefers-color-scheme: dark`, with an explicit `data-theme` override as the escape hatch. The plan was to add a toggle later.

When implementing the toggle, two approaches were considered:

1. Keep the system-preference fallback and let the toggle override it.
2. Drop the system-preference fallback and make light the unconditional default, with the toggle as the only way to reach dark mode.

## Decision

Light mode is the default. Dark mode activates only when `data-theme="dark"` is explicitly set on `<html>`. The `prefers-color-scheme: dark` fallback in `tokens.css` and `ThemeLogo.module.css` has been removed.

**`next-themes`** manages the toggle with:
- `attribute="data-theme"` — sets `data-theme` on `<html>`
- `defaultTheme="light"` — light unless the user has previously chosen
- `enableSystem={false}` — system preference is ignored entirely
- `storageKey="jg-theme"` — persists the choice in `localStorage`

`next-themes` injects an inline script in `<head>` that reads `localStorage` and sets `data-theme` before first paint, preventing a flash of the wrong theme.

A `ThemeToggle` button in `SiteNav` (desktop and mobile) lets users switch. Sun icon = currently dark (click to go light). Moon icon = currently light (click to go dark).

## Why

- **Predictability** — the site always opens in light mode for first-time visitors. A dark flash on a light system (or vice versa) is jarring; a consistent light default avoids it entirely.
- **User control** — the toggle is explicit and remembered. Users who want dark mode opt in once and stay there.
- **Simpler token rules** — removing the media-query fallback means `tokens.css` has two clear states: `:root` (light) and `:root[data-theme="dark"]` (dark). No three-way logic.
- **`next-themes` flash prevention** — the inline script approach is more reliable than a hand-rolled `localStorage` read, especially under Next.js App Router hydration.

## Alternatives considered

- **Keep system fallback, toggle overrides it** — more complex three-way logic (`data-theme="light"` suppresses the media query, no `data-theme` follows the system, `data-theme="dark"` forces dark). Rejected because the toggle already replaces the system signal; keeping both is confusing for users and for the token rules.
- **Hand-rolled toggle script in `<head>`** — would work but `next-themes` provides the same flash prevention with less custom code to maintain.
