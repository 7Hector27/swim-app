---
name: axiom-aquatics-design
description: Visual design system for the Axiom Aquatics website (colors, light and dark themes, theme toggle, fonts, buttons, cards, leaderboards, wave dividers, logo usage, nav, footer). Use this skill whenever building, editing, styling, or reviewing any page, component, or UI in this project, even small changes like adding a button, a card, a form, or a new section, and even if the request doesn't mention design or colors.
---

# Axiom Aquatics design system

The look comes from Jason's Axiom Aquatics logo: a black "A" with a white "A" inside, electric blue light running through it, and a rippled water reflection underneath. Pages should feel sharp and premium: lots of white (or near-black in dark mode), black blocks, soft-serif headings, and blue used sparingly like the glow in the logo. When in doubt, match the existing home page instead of inventing something new.

## Rule 1: use the tokens, never raw hex

All colors, fonts, radii, and widths live as CSS variables in `tokens.css` (imported in `globals.css`). Use `var(--color-...)` in components. Don't hardcode hex values, because dark mode works by swapping the variables. A hardcoded color will break in one of the two themes.

If a component needs a color that has no token, stop and ask before adding one.

## Themes

- Light is the default.
- A toggle button in the header switches themes. It sets `data-theme="dark"` (or removes it) on `<html>` and saves the choice in `localStorage`.
- The site does not follow the operating system setting.
- To avoid a flash of the wrong theme, read `localStorage` and set `data-theme` in a small inline script in the document head before the page paints.
- The toggle is an icon button with an `aria-label` that says what it will do ("Switch to dark theme"). Show a moon in light mode and a sun in dark mode.

## Color roles

| Token                               | Light     | Dark      | Use for                                                       |
| ----------------------------------- | --------- | --------- | ------------------------------------------------------------- |
| `--color-background`                | `#F5F7FA` | `#10131C` | Page background                                               |
| `--color-section`                   | `#141A2E` | `#171C2A` | Feature sections (leaderboards, CTA band, nav, footer)        |
| `--color-surface-soft`              | `#EBEFF5` | `#1A2030` | Photo placeholders, secondary surface backgrounds             |
| `--color-card`                      | `#1D2440` | `#212839` | Cards on a section background                                 |
| `--color-border`                    | `#DDE3EC` | `#2C3448` | Borders and dividers on the page                              |
| `--color-divider-section`           | `#2C3553` | `#333C52` | Card borders, table rows, dividers inside sections            |
| `--color-placeholder-border`        | `#B4BFD0` | `#424C66` | Dashed border on image placeholders                           |
| `--color-heading`                   | `#141A2E` | `#FFFFFF` | Headings on the page                                          |
| `--color-text`                      | `#1E2433` | `#E8EBF1` | Body text on the page                                         |
| `--color-text-secondary`            | `#4A5468` | `#A0A7B5` | Supporting text on the page                                   |
| `--color-text-on-section`           | `#FFFFFF` | `#E8EBF1` | Text inside sections and cards                                |
| `--color-text-secondary-on-section` | `#A9B3C7` | `#A0A7B5` | Supporting text inside sections and cards                     |
| `--color-accent`                    | `#1440F0` | `#5B7CFF` | Electric blue: buttons, links, small highlights on the page   |
| `--color-accent-on-section`         | `#7C96FF` | `#7C96FF` | Blue on dark sections and cards (step numerals, ranks, links) |
| `--color-ink`                       | `#141A2E` | `#E8EBF1` | Reserved for ink-colored decorative elements                  |
| `--color-link`                      | `#1440F0` | `#7C96FF` | Links                                                         |
| `--color-link-hover`                | `#141A2E` | `#FFFFFF` | Link hover                                                    |
| `--color-button-primary-background` | `#1440F0` | `#5B7CFF` | Primary button fill                                           |
| `--color-button-primary-text`       | `#FFFFFF` | `#10131C` | Primary button text                                           |
| `--color-button-outline`            | `#141A2E` | `#E8EBF1` | Outline button border and text                                |
| `--color-icon-button-background`    | `#EBEFF5` | `#212839` | Theme toggle and menu buttons                                 |
| `--color-focus-ring`                | `#1440F0` | `#5B7CFF` | Focus outline on every focusable element                      |
| `--color-on-accent`                 | `#FFFFFF` | `#07080B` | Text or icons placed directly on a primary blue button        |
| `--color-success`                   | `#0E7A3E` | `#4ADE80` | Improvement indicators (leaderboard trend up)                 |
| `--color-danger`                    | `#C8102E` | `#FF6B6B` | Regression indicators (leaderboard trend down, error states)  |

### Contrast rules

- On a dark section (in either theme), use `--color-accent-on-section` for blue text. The light theme's `#1440F0` is too dark to read on black.
- A primary button sitting on a dark section uses `--color-accent-on-section` as its fill with `--color-on-accent` text.
- Blue is the glow, not the base. Keep it to buttons, links, numerals, ranks, and the wave accent. If a view has more than a few blue elements, cut back.

## Typography

| Use                            | Font                        | Settings                                                                                                  |
| ------------------------------ | --------------------------- | --------------------------------------------------------------------------------------------------------- |
| Headings, step numerals, ranks | Fraunces (`--font-heading`) | Weight 600, `font-variation-settings: "SOFT" 100, "WONK" 0`, `font-optical-sizing: auto`, line height 1.1 |
| Body, UI, tables, buttons      | Figtree (`--font-body`)     | 400 for body, 600 for nav links and table headers, 700 for buttons and card titles                        |

Fraunces is a variable serif loaded with axes `["SOFT", "WONK", "opsz"]`. The SOFT axis at 100 gives it a soft, rounded feel. Load it with `next/font/google` (`Fraunces`, variable `--font-fraunces`). Never use Fraunces for body text or long paragraphs.

```tsx
const fraunces = Fraunces({
  subsets: ["latin"],
  axes: ["SOFT", "WONK", "opsz"],
  variable: "--font-fraunces",
});
```

In CSS globals, headings use:

```css
h1,
h2,
h3 {
  font-family: var(--font-heading);
  font-weight: 600;
  line-height: 1.1;
  font-variation-settings:
    "SOFT" 100,
    "WONK" 0;
  font-optical-sizing: auto;
}
```

Sizes (desktop / mobile): h1 about 3.75rem / 2.125rem, section h2 2.5rem / 1.875rem, body 1.0625rem / 1rem. Use tabular numbers (`font-variant-numeric: tabular-nums`) for swim times. Step numbers use arabic numerals (1, 2, 3), not Roman numerals.

## Components

**Buttons.** Pill shaped (`--radius-button`, 999px). Min height 52px, or 44px in the header. Bold label. Two kinds: primary (filled blue) and outline (2px border). Labels say what happens: "Create an account", "See the leaderboards".

**Cards.** `--radius-card` (18px), 24px padding, `--color-card` background with a 1px `--color-divider-section` border when on a section.

**Image and photo placeholders.** `--radius-media` (24px), `--color-surface-soft` fill, 2px dashed `--color-placeholder-border`, centered label in brackets describing the photo needed. Portrait subjects use `aspect-ratio: 3/4`.

**Leaderboard tables.** Columns: rank, swimmer, event, time (on mobile, event moves under the name). Rank in `--font-heading`, `--color-accent-on-section`. Rows separated by a 1px `--color-divider-section` top border. Swimmer names always show as first name and last initial (for example "Maya R."), never full names.

**Sections.** Content centered at `--content-max-width` with `--page-padding` on the sides. Use `WaveDivider` at every color transition between section backgrounds. See Section rhythm below.

**Wave dividers.** `WaveDivider` is in `components/WaveDivider/`. It takes `from` and `to` props (`"background" | "section" | "surface-soft"`). Place one at every surface-color transition. Heights are `h-14` (mobile) / `h-20` (tablet) / `h-[110px]` (desktop), `preserveAspectRatio="none"`, full width.
- `from="background" to="section"`: dual wave — main wave in `var(--color-section)` with a thinner `var(--color-accent)` stripe peeking out behind it at full opacity.
- All other combinations: single main wave in the `to` color.

**Section rhythm.** Pages alternate `--color-background` and `--color-section`. The footer and nav always sit on `--color-section`. The CTA band sits on `--color-section` and flows directly into the footer with a 1px `--color-divider-section` border (no wave between them — same surface). Avoid placing `--color-surface-soft` sections adjacent to each other.

**Nav.** Sticky, `bg-section`. Desktop: logo lockup left, nav links center, ThemeToggle + auth actions right. Auth actions when signed out: Log in (text link) + Sign up (primary pill button). Auth actions when signed in: ProfileMenu (initials button). Mobile: logo emblem left, ThemeToggle + hamburger right. No Book button anywhere in the nav.

**ProfileMenu.** An initials button (`aria-haspopup="menu"`, `aria-expanded`) that opens a dropdown menu. Items: Dashboard, Account settings, Log out. Arrow-key navigation, Escape closes and returns focus. Menu items are `role="menuitem"`, min-height 44px. Log out is a `<form action={logout}>` submit button.

**Footer.** `bg-section border-t border-divider-section` (same dark surface as the CTA band above it). Two link columns — Explore (Home, Lessons, Leaderboards, Coach Jason) and Legal (Privacy, Terms). Logo lockup left (`onDark`), columns right. Copyright "Axiom Aquatics". Use `text-text-on-section` / `text-text-secondary-on-section` for footer text.

## Logo

| File                                   | Use                                                              |
| -------------------------------------- | ---------------------------------------------------------------- |
| `axiom-aquatics-lockup.webp` / `-dark` | Header and footer on desktop (emblem plus wordmark side by side) |
| `axiom-aquatics-emblem.webp`           | Mobile header, anywhere square-ish. Works on both themes.        |

**Choose the logo by the background it sits on, not by the current theme.** The `ThemeLogo` component has an `onDark` boolean prop:
- `onDark={true}`: always shows the `-dark` lockup (high contrast on dark). Use on nav, footer, and any dark section.
- Default (`onDark` omitted): follows `data-theme` — shows the light lockup in light mode and the dark lockup in dark mode. Use on the page background (e.g. a light-surface footer would use this).

The emblem appears only in the header, footer, and favicon — **never in page body sections or heroes**.
Never recolor, stretch, crop the emblem, or add effects to the logo.
Favicon and app icons: the emblem on a black rounded square.

## Layout and breakpoints

- Mobile: up to 768px. Stack everything, full-width buttons. Header shows the emblem, ThemeToggle, and a menu button only.
- Tablet: 769px to 1247px.
- Desktop: 1248px and up.

Tap targets are at least 44px. Nothing scrolls sideways at any width except an intentional swipe row or a wide table inside its own scroll container.

## Avoid

- Hardcoded colors or new colors outside the tokens.
- Gradient backgrounds, glows, and drop shadows on UI. The logo has a glow, the interface doesn't.
- Fonts other than Fraunces and Figtree.
- Pure black `#000` or plain gray backgrounds.
- Emoji as icons. Use simple line SVG icons in the current text color.
- A "Book" button in the navigation.
- The emblem or logo in page body sections (heroes, content sections, cards).
- Straight edges between sections of different colors — always use `WaveDivider`.
