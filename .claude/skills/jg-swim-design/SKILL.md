---
name: jg-swim-design
description: Visual design system for the JG Swim website (colors, light and dark themes, fonts, buttons, cards, leaderboards, wave dividers, logo usage). Use this skill whenever building, editing, styling, or reviewing any page, component, or UI in this project, even small changes like adding a button, a card, a form, or a new section, and even if the request doesn't mention design or colors.
---

# JG Swim design system

The site's look comes from Jason's JG Swim logo: deep navy, mid blue, and cyan water. Every page should feel like it belongs next to that logo in both light and dark mode. When in doubt, match the existing home page instead of inventing something new.

## Rule 1: use the tokens, never raw hex

All colors, fonts, radii, and widths live as CSS variables in `tokens.css` (imported in `globals.css`). Use `var(--color-...)` in components. Do not hardcode hex values in components, because dark mode works by swapping the variables. A hardcoded color will break in one of the two themes.

If a component needs a color that has no token, stop and ask before adding a new one. Don't pick a "close enough" color.

## Color roles

| Token                               | Light     | Dark      | Use for                                                  |
| ----------------------------------- | --------- | --------- | -------------------------------------------------------- |
| `--color-background`                | `#FFFFFF` | `#04182C` | Page background                                          |
| `--color-section`                   | `#082C4F` | `#0A2540` | Feature sections (lessons, leaderboards)                 |
| `--color-surface-soft`              | `#E6F6FA` | `#0A2540` | CTA bands, photo placeholders, icon buttons              |
| `--color-card`                      | `#0F3B66` | `#113256` | Cards sitting on a section background                    |
| `--color-border`                    | `#E3EEF3` | `#1E4670` | Borders and dividers on the page                         |
| `--color-divider-section`           | `#24527D` | `#1E4670` | Table rows and dividers inside sections and cards        |
| `--color-placeholder-border`        | `#8FD3E5` | `#2E5F88` | Dashed border on image placeholders                      |
| `--color-heading`                   | `#082C4F` | `#FFFFFF` | Headings on the page                                     |
| `--color-text`                      | `#082C4F` | `#EAF4FA` | Body text on the page                                    |
| `--color-text-secondary`            | `#2E4A66` | `#9DB7CC` | Supporting text on the page                              |
| `--color-text-on-section`           | `#FFFFFF` | `#EAF4FA` | Text inside sections and cards                           |
| `--color-text-secondary-on-section` | `#BCD3E4` | `#9DB7CC` | Supporting text inside sections and cards                |
| `--color-accent`                    | `#10BFDE` | `#10BFDE` | Step numbers, leaderboard ranks, waves, small highlights |
| `--color-link`                      | `#017FAA` | `#10BFDE` | Links                                                    |
| `--color-link-hover`                | `#082C4F` | `#EAF4FA` | Link hover                                               |
| `--color-button-primary-background` | `#082C4F` | `#10BFDE` | Primary button fill                                      |
| `--color-button-primary-text`       | `#FFFFFF` | `#04182C` | Primary button text                                      |
| `--color-button-outline`            | `#082C4F` | `#EAF4FA` | Outline button border and text                           |

On a section background in light mode, a primary button uses the accent fill with `#04182C` text, like dark mode does.

### Contrast rules

- Never put white text on cyan (`#10BFDE`). It fails contrast. Use navy text on cyan.
- Cyan is for accents, not for body text on white. On white it's too light to read as text.
- Keep accent use small: numbers, ranks, a wave, a link. If more than one element in a view is shouting in cyan, cut back.

## Typography

| Use                         | Font                     | Settings                                                                           |
| --------------------------- | ------------------------ | ---------------------------------------------------------------------------------- |
| Headings (h1 to h3 display) | Saira (`--font-heading`) | Weight 800, italic, `font-stretch: 125%`, tight line height (1 to 1.05)            |
| Step numbers and ranks      | Saira                    | Weight 800, italic, accent color                                                   |
| Body, UI, tables, buttons   | Figtree (`--font-body`)  | 400 for body, 600 for nav links and table headers, 700 for buttons and card titles |

The wide heavy italic headings echo the "JG SWIM" lettering in the logo. That's what makes pages look like this brand, so don't swap the heading style for something plain.

Load the fonts with `next/font/google`: Saira with the `wdth` axis and both normal and italic styles, Figtree normally. Expose them as `--font-heading` and `--font-body`.

Sizes (desktop / mobile): h1 about 4.5rem / 2.5rem, section h2 2.75rem / 2rem, body 1.0625rem / 1rem. Use tabular numbers (`font-variant-numeric: tabular-nums`) for swim times.

## Components

**Buttons.** Pill shaped (`--radius-pill`). Min height 52px, or 44px in the nav. Bold label. Two kinds only: primary (filled) and outline (2px border). Labels say what happens: "Book a lesson", "Create an account", not "Submit" or "Click here".

**Cards.** `--radius-card`, 24px padding, `--color-card` background when on a section. In dark mode add a 1px `--color-border` border.

**Image and photo placeholders.** `--radius-media`, `--color-surface-soft` fill, 2px dashed `--color-placeholder-border`, centered label in brackets describing the photo needed.

**Leaderboard tables.** Columns: rank, swimmer, event, time (on mobile, event moves under the name). Rank uses the Saira number style in accent. Rows are separated by a 1px `--color-divider-section` top border. Swimmer names always display as first name and last initial (for example "Maya R."), never full names.

**Sections.** Content is centered at `--content-max-width` with `--page-padding` on the sides. Alternate between the page background and `--color-section` blocks.

**Wave dividers.** Moving into or out of a `--color-section` block uses an SVG wave instead of a straight edge: the main wave in the section color, with a thinner accent wave peeking out behind it on the way in. Waves are full width with `preserveAspectRatio="none"`, about 110px tall on desktop and 56px on mobile. Use waves only at those transitions, not as decoration elsewhere.

## Logo

- Light mode: the original navy and cyan emblem.
- Dark mode: the off-white version of the emblem. This is a temporary conversion, so replace it if Jason gets an official reversed logo.
- Never recolor, stretch, or add effects to the logo.
- Favicon: white "JG" on a navy rounded square with a cyan wave.

## Layout and breakpoints

- Mobile: up to 768px. Stack everything, full-width buttons, nav links go behind a menu button with a small "Book" button kept visible, leaderboards become a horizontal swipe row of cards.
- Tablet: 769px to 1247px.
- Desktop: 1248px and up.

Tap targets are at least 44px. Nothing should scroll sideways at any width except an intentional swipe row or a wide table inside its own scroll container.

## Avoid

- Hardcoded colors, or new colors outside the tokens.
- Gradients, glows, and drop shadows on text or buttons. The look is flat with solid color blocks.
- Fonts other than Saira and Figtree.
- Pure black (`#000`) or gray backgrounds in dark mode. Dark mode is deep navy.
- Emoji as icons. Use simple line SVG icons in the current text color.
