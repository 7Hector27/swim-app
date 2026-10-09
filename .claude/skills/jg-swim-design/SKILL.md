---
name: jg-swim-design
description: Visual design system for the JG Swim website (colors, light and dark themes, fonts, buttons, cards, leaderboards, wave dividers, logo usage). Use this skill whenever building, editing, styling, or reviewing any page, component, or UI in this project, even small changes like adding a button, a card, a form, or a new section, and even if the request doesn't mention design or colors.
---

# JG Swim design system

The site's look comes from Jason's JG Swim logo: deep navy, mid blue, and cyan water. Every page should feel like it belongs next to that logo in both light and dark mode. When in doubt, match the existing home page instead of inventing something new.

## Rule 1: use the tokens, never raw hex

All colors, fonts, radii, and widths live as CSS variables in `tokens.css` (imported in `globals.css`). Use `var(--color-...)` in components. Do not hardcode hex values in components, because dark mode works by swapping the variables. A hardcoded color will break in one of the two themes.

If a component needs a color that has no token, stop and ask before adding a new one. Don't pick a "close enough" color.

## Theme switching

Light mode is the default. Dark mode activates only when `data-theme="dark"` is set on `<html>`. There is no `prefers-color-scheme` fallback — the system setting is ignored.

**How it works:** `next-themes` manages the toggle with `attribute="data-theme"`, `defaultTheme="light"`, `enableSystem={false}`, and `storageKey="jg-theme"`. It injects an inline script before first paint so the correct theme is applied without a flash. The user's choice persists in `localStorage` under the key `"jg-theme"`.

**Token structure:** `tokens.css` has two states only — `:root` (light defaults) and `:root[data-theme="dark"]` (dark overrides). Every component that uses design token classes switches correctly without any extra code.

**`ThemeToggle` component:** renders a sun icon when dark (click → light) and a moon icon when light (click → dark). It lives in `SiteNav` on both desktop and in the mobile menu. Do not add a second toggle anywhere else on the page.

## Color roles

| Token                               | Light      | Dark       | Use for                                                       |
| ----------------------------------- | ---------- | ---------- | ------------------------------------------------------------- |
| `--color-background`                | `#FFFFFF`  | `#04182C`  | Page background                                               |
| `--color-section`                   | `#082C4F`  | `#0A2540`  | Feature sections (lessons, leaderboards)                      |
| `--color-surface-soft`              | `#E6F6FA`  | `#163252`  | Supporting sections: coach bio, FAQ; see Section rhythm below |
| `--color-card`                      | `#0F3B66`  | `#113256`  | Cards sitting on a section background                         |
| `--color-border`                    | `#E3EEF3`  | `#1E4670`  | Borders and dividers on the page                              |
| `--color-divider-section`           | `#24527D`  | `#1E4670`  | Table rows and dividers inside sections and cards             |
| `--color-placeholder-border`        | `#8FD3E5`  | `#2E5F88`  | Dashed border on image placeholders                           |
| `--color-heading`                   | `#082C4F`  | `#FFFFFF`  | Headings on the page background                               |
| `--color-text`                      | `#082C4F`  | `#EAF4FA`  | Body text on the page background                              |
| `--color-text-secondary`            | `#2E4A66`  | `#9DB7CC`  | Supporting text on the page background                        |
| `--color-text-on-section`           | `#FFFFFF`  | `#EAF4FA`  | Text inside sections and cards                                |
| `--color-text-secondary-on-section` | `#BCD3E4`  | `#9DB7CC`  | Supporting text inside sections and cards                     |
| `--color-accent`                    | `#10BFDE`  | `#10BFDE`  | Step numbers, leaderboard ranks, waves, small highlights      |
| `--color-on-accent`                 | `#04182C`  | `#04182C`  | Text and icons placed on a cyan accent background             |
| `--color-focus-ring`                | `#04182C`  | `#FFFFFF`  | Focus outline on every focusable element                      |
| `--color-link`                      | `#017FAA`  | `#10BFDE`  | Links                                                         |
| `--color-link-hover`                | `#082C4F`  | `#EAF4FA`  | Link hover                                                    |
| `--color-success`                   | `#15803d`  | `#4ade80`  | Improvement indicators (leaderboard trend up, status badges)  |
| `--color-danger`                    | `#b91c1c`  | `#f87171`  | Regression indicators (leaderboard trend down, error states)  |
| `--color-button-primary-background` | `#082C4F`  | `#10BFDE`  | Primary button fill                                           |
| `--color-button-primary-text`       | `#FFFFFF`  | `#04182C`  | Primary button text                                           |
| `--color-button-outline`            | `#082C4F`  | `#EAF4FA`  | Outline button border and text                                |
| `--color-rank-gold`                 | `#FFD700`  | `#FFD700`  | Leaderboard rank #1 badge fill                                |
| `--color-rank-silver`               | `#C0C8D8`  | `#C0C8D8`  | Leaderboard rank #2 badge fill                                |
| `--color-rank-bronze`               | `#CD7F32`  | `#CD7F32`  | Leaderboard rank #3 badge fill                                |

On a section background in light mode, a primary button uses the accent fill with `var(--color-on-accent)` text, exactly like it behaves in dark mode.

## Layout utilities

Three layout tokens generate Tailwind utility classes. Shadow is registered via `@theme inline`; max-width and padding use `@layer utilities` because Tailwind v4 treats `--width-*` and `--spacing-*` as internal scale namespaces and drops them from `@theme inline` without emitting a CSS variable.

| Token in `tokens.css`   | How registered   | Tailwind utility  |
| ------------------------ | ---------------- | ----------------- |
| `--shadow-elevated`      | `@theme inline`  | `shadow-elevated` |
| `--content-max-width`    | `@layer utilities` | `max-w-content` |
| `--page-padding`         | `@layer utilities` | `px-page`       |

Always use the Tailwind utilities or the original `var(--...)` tokens — never raw pixel values for these.

### Contrast rules

- Never put white text on cyan (`#10BFDE`). It fails contrast. Use `var(--color-on-accent)` for any text or icon on a cyan background.
- Cyan is for accents, not for body text on white. On white it's too light to read as text.
- Keep accent use small: numbers, ranks, a wave, a link. If more than one element in a view is shouting in cyan, cut back.
- `--color-success` and `--color-danger` light values are verified at ≥4.5:1 on both `--color-background` and `--color-surface-soft`. Do not use these tokens as text on `--color-section` or `--color-card` backgrounds — only on page and soft-surface backgrounds.

### Focus states

Every focusable element (links, buttons, inputs, interactive components) must have a visible focus indicator in both themes:

```css
outline: 2px solid var(--color-focus-ring);
outline-offset: 2px;
```

Never suppress `outline: none` without replacing it with this pattern. `--color-focus-ring` is dark navy in light mode and white in dark mode, keeping it visible against both background tiers.

## Shadows

One shadow token: `--shadow-elevated`. It is **only allowed** on two elements:

1. The sticky nav after the page scrolls (the "scrolled" state)
2. Floating menus (dropdowns, popovers, mobile menu panels)

Everything else stays flat — no drop shadows on cards, sections, buttons, text, or decorative elements. The look is built with solid color blocks, not depth.

**Approved exception:** `HeroWaterBg` (the animated swim-lane / bubble / wave layer in the homepage hero) is the one approved exception to the flat look. All other sections and components remain fully flat.

## Typography

| Use                         | Font                     | Settings                                                                           |
| --------------------------- | ------------------------ | ---------------------------------------------------------------------------------- |
| Headings (h1 to h3 display) | Saira (`--font-heading`) | Weight 800, italic, `font-stretch: 125%`, tight line height (1 to 1.05)            |
| Step numbers and ranks      | Saira                    | Weight 800, italic, accent color                                                   |
| Body, UI, tables, buttons   | Figtree (`--font-body`)  | 400 for body, 600 for nav links and table headers, 700 for buttons and card titles |

The wide heavy italic headings echo the "JG SWIM" lettering in the logo. That's what makes pages look like this brand, so don't swap the heading style for something plain.

Load the fonts with `next/font/google`: Saira with the `wdth` axis and both normal and italic styles, Figtree normally. Set `variable: "--font-saira"` and `variable: "--font-figtree"` on the Next.js font objects, then add both class names to `<html>`. In `globals.css`, map them to semantic names via `@theme inline`: `--font-heading: var(--font-saira)` and `--font-body: var(--font-figtree)`. All components use `var(--font-heading)` and `var(--font-body)` — never `var(--font-saira)` or `var(--font-figtree)` directly. The Next.js variable names are an implementation detail of the font loader.

**Heading sizes** use fluid `clamp()` values that hit the exact target size at 375 px (mobile) and 1248 px (desktop), with no hard breakpoint jump in between:

```css
h1:             clamp(2.5rem, 1.64rem + 3.67vw, 4.5rem)
section h2:     clamp(2rem,   1.68rem + 1.37vw, 2.75rem)
```

The middle value intentionally mixes `rem` and `vw`. The `vw` part scales with viewport width. The `rem` part is the linear-interpolation intercept — it keeps the formula anchored to the user's browser base font size, so the heading still grows correctly when a user increases their font size preference or zooms in. A pure `vw` value would ignore those settings entirely.

Body: 1.0625rem desktop / 1rem mobile. Use tabular numbers (`font-variant-numeric: tabular-nums`) for swim times.

### Eyebrow labels

Section eyebrows sit directly above a heading and name the section. Rules:

- Font: Figtree (`--font-body`), not Saira
- Weight 700, uppercase, `letter-spacing: 0.08em` to `0.10em`, `font-size: 0.8125rem`
- Color: `var(--color-accent)` on page backgrounds; `var(--color-accent)` on section backgrounds (same token, it's readable in both contexts)
- Content: a short noun phrase naming the section — "Private Lessons", "How It Works", "Meet the Coach". Not a tagline or marketing copy.

## Components

### Buttons

Pill shaped (`--radius-pill`). Min height 52px, or 44px in the nav. Bold label. Two kinds only: primary (filled) and outline (2px border). Labels say what happens: "Book a lesson", "Create an account", not "Submit" or "Click here".

### Cards

Cards on a **section background**: `--radius-card`, 24px padding, `--color-card` fill, `1px --color-divider-section` border. In dark mode add a second `1px --color-border` border on top (or replace — whichever is more visible in context).

Cards on a **page background**: transparent fill, `1px solid --color-border` border, `--radius-card`. On hover, transition `border-color` to `--color-accent` (color transition only — no movement; movement is emil-design-eng's call).

### Image and photo placeholders

`--radius-media` border radius, `--color-surface-soft` fill, `2px dashed --color-placeholder-border` border, centered label in brackets describing the photo needed.

Aspect ratios: portrait subjects (coaches, head shots) use `3/4`. Landscape or action shots default to `16/9`. Always set the aspect ratio explicitly so the placeholder reserves the right space.

### Hero motif

Hero sections use three swim-themed background layers built from token colors only:

1. **Lane lines** — SVG `<line>` elements forming a horizontal or grid pattern. Use `--color-accent` at 6–18% opacity. Horizontal lane-rope lines can use a dashed stroke (`stroke-dasharray`). Vertical dividers use a solid stroke at lower opacity (~6%).
2. **Rising bubbles** — small circles (4–10px) with a `1.5px solid --color-accent` border, no fill. Hollow reads more naturally than filled. Animate slowly upward (9–17s per cycle). Half the bubbles should be hidden on mobile to reduce GPU load.
3. **Wave layers** — two or more SVG wave paths using `--color-accent` at 9–12% fill opacity, drifting horizontally at different speeds and opposite phases.

All ambient layers must stay clearly behind the headline and CTAs. Keep every ambient element under 20% opacity. Pause ambient animations when the hero is offscreen (IntersectionObserver).

**`HeroWaterBg` is the approved exception to the flat look.** All other sections remain fully flat.

### Leaderboard tables

Columns: rank, swimmer, event, time. On mobile, event moves under the name as secondary text.

Ranks 1–3: display as a filled badge using `--color-rank-gold`, `--color-rank-silver`, `--color-rank-bronze` as the background fill, with `--color-on-accent` text. Ranks 4+ use the Saira number style in `--color-accent`. **Never use rank colors as text color** — only as badge/icon fill.

Trend indicators (improvement or regression in time): use `--color-success` for a faster time and `--color-danger` for a slower one. Only use these on page or surface-soft backgrounds, never on section or card backgrounds.

Row dividers: 1px `--color-divider-section` top border. Swimmer names always display as first name and last initial (for example "Maya R."), never full names.

### Nav link hover

**Desktop nav links:** underline treatment. On hover, show `2px solid var(--color-accent)` as a bottom border. The current/active page keeps this underline persistently.

**Mobile menu rows and other list-style nav items:** tint treatment. On hover, show `color-mix(in srgb, var(--color-accent) 8%, transparent)` as a background tint. All hover tints must use `color-mix()` from existing tokens — no new hex values.

### Section rhythm

Pages alternate through three surface levels. The rule is: use each level for the right content type, not at random.

| Level | Token | Use for |
| --- | --- | --- |
| Page background | `--color-background` | Hero, primary content sections (lessons overview, testimonials, how it works on page) |
| Section | `--color-section` | Featured or action-oriented sections: leaderboards, how it works, CTA band, nav, footer |
| Soft surface | `--color-surface-soft` | Supporting sections that need separation without the full section weight: coach bio, FAQ. Use it when two adjacent page-background sections would visually merge without it. |

Never use `--color-surface-soft` twice in a row. A soft-surface section always sits between two sections of a different level.

### Wave dividers

Moving into or out of a `--color-section` block uses an SVG wave instead of a straight edge: the main wave in the section color, with a thinner accent wave peeking out behind it.

Waves are full width with `preserveAspectRatio="none"`. Heights by breakpoint:

| Breakpoint | Height |
| --- | --- |
| Mobile (≤768px) | 56px |
| Tablet (769–1247px) | 80px |
| Desktop (≥1248px) | 110px |

Use waves only at section color transitions. Do not use them as decoration within a section.

### FAQ layout

**Tablet and up:** two-column. The section eyebrow and heading are in the left column, position sticky so they remain visible while scrolling the right column. Questions and answers stack in the right column.

**Mobile:** single column, heading above the question list.

Both layouts use a flat bordered list for question rows: `1px --color-border` top border on the container and bottom border on each item. No card nesting.

## Logo

- Light mode: the original navy and cyan emblem.
- Dark mode: the off-white version of the emblem. This is a temporary conversion, so replace it if Jason gets an official reversed logo.
- **On section backgrounds (`bg-section`), always use the off-white logo, in both themes.** Pass `onSection` to `ThemeLogo` wherever the logo sits on a section background (nav, footer, any section-colored band).
- Never recolor, stretch, or add effects to the logo.
- Favicon: white "JG" on a navy rounded square with a cyan wave.

## Layout and breakpoints

- Mobile: up to 768px. Stack everything, full-width buttons, nav links go behind a menu button with a small "Book" button kept visible, leaderboards become a horizontal swipe row of cards.
- Tablet: 769px to 1247px.
- Desktop: 1248px and up.

`--page-padding` is 20px on mobile and 24px on tablet and desktop. The 24px desktop value is intentional — at desktop widths, `--content-max-width` centers the layout and provides the real gutter. `--page-padding` is only the minimum edge clearance on narrower viewports where the content fills the screen.

Tap targets are at least 44px. Nothing should scroll sideways at any width except an intentional swipe row or a wide table inside its own scroll container.

## Avoid

- Hardcoded colors, or new colors outside the tokens.
- Drop shadows on text, buttons, cards, or decorative elements. The only permitted shadow is `var(--shadow-elevated)` on the scrolled sticky nav and floating menus.
- Gradients or glows. The look is flat with solid color blocks.
- Fonts other than Saira and Figtree.
- Pure black (`#000`) or gray backgrounds in dark mode. Dark mode is deep navy.
- Emoji as icons. Use simple line SVG icons in the current text color.
- Using `--color-success` or `--color-danger` as text on section or card backgrounds — contrast is not verified there.
- Using rank colors (`--color-rank-gold` etc.) as text color — fill only.
