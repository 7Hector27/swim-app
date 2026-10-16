# 012 — Design token system and CSS-native theming

**Date:** 2026-10-08  
**Status:** Accepted

## Context

The Axiom Aquatics site needs to support light and dark mode. The design derives from a specific brand (navy, mid blue, cyan) that requires consistent color, type, and spacing values across every component. We needed a way to store those values once and swap them for dark mode without touching every component.

## Decision

All design values — colors, radii, shadows, font references, and max-width — live as **CSS custom properties** in `apps/web/src/styles/tokens.css`, imported into `globals.css` at the top level.

**Two-layer token structure:**

1. `tokens.css` defines the raw values on `:root` (light defaults), `:root[data-theme="dark"]`, and `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])`.
2. `globals.css` re-registers every token under `@theme inline` so Tailwind v4 generates utilities (`bg-background`, `text-accent`, etc.) alongside the CSS variable.

**Theme switching strategy:**

- `prefers-color-scheme: dark` activates the dark tokens automatically, unless a `data-theme` attribute overrides it.
- An explicit `data-theme="dark"` on `<html>` forces dark mode regardless of system preference.
- An explicit `data-theme="light"` on `<html>` forces light mode and suppresses the media query override via `:root:not([data-theme="light"])`.
- No JS theme library is used. Theme toggling (when added) will set `document.documentElement.dataset.theme`.

**Font variable chain:**

Fonts are loaded via `next/font/google` which emits CSS variables `--font-saira` and `--font-figtree`. These are mapped to semantic names in `@theme inline`: `--font-heading: var(--font-saira)` and `--font-body: var(--font-figtree)`. Components always use `var(--font-heading)` and `var(--font-body)` — the Next.js variable names are an implementation detail of the font loader.

## Why

- **No hardcoded hex in components** — dark mode works by swapping the variables, not by duplicating rules.
- **Single source of truth** — every color appears once in `tokens.css`. Reviewing or changing the palette means editing one file.
- **No library dependency** — CSS handles both the system-preference and explicit-override cases natively. The toggle JS is small: read `localStorage`, set `dataset.theme`, write back to `localStorage`. An inline `<script>` in `<head>` applies the saved choice before first paint to prevent a flash of the wrong theme.
- **`@theme inline` dual registration** — registers the CSS variable (so `var(--color-accent)` works in CSS modules and `@layer base`) AND generates Tailwind utilities in one declaration. Without `inline`, Tailwind would emit its own variables that conflict with the `:root` values from `tokens.css`.

## Alternatives considered

- **Tailwind's built-in dark mode (`darkMode: "class"`)** — adds a `dark:` variant, but doesn't handle the system-preference fallback cleanly alongside an explicit override without a library.
- **CSS-in-JS / styled-components** — not appropriate for a Next.js App Router project; server components can't use React context for theming.
- **Duplicating color values per component** — rejected immediately; breaks on the first dark-mode addition.
