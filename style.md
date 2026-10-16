# CiteSeen design system

**Concept:** architectural clarity for AI search visibility. Editorial typography, precise technical UI, generous whitespace, one art-directed 3D object.
**Story:** REACH → UNDERSTAND → QUOTE. Every marketing section and report group follows it.

## Theme
Light only (`color-scheme: light`). No automatic dark mode. Print uses the same light tokens.

## Color tokens (`public/assets/style.css` `:root`)
| Token | Hex | Use |
| --- | --- | --- |
| `--cs-canvas` / `--bg` | #F7F6F2 | Porcelain page background (~80% of surface) |
| `--cs-surface` / `--surface` | #FFFFFF | Functional surfaces |
| `--cs-surface-muted` / `--surface-2` | #F0F0EC | Secondary surfaces, code |
| `--cs-surface-blue` / `--brand-soft` | #EAF0FF | Selected / informative |
| `--cs-ink` / `--ink` | #202A33 | Headlines, primary text |
| `--cs-text` / `--ink-2` | #4F5B68 | Body |
| `--cs-muted` / `--muted` | #66707B | Supporting text (darkened from #78828C to pass 4.5:1 on porcelain) |
| `--cs-border` / `--line` | #E3E2DC | Hairlines |
| `--cs-border-strong` / `--line-2` | #C8CBCB | Inputs, strong dividers |
| `--cs-cobalt` / `--brand` | #315CEB | Primary action, active state |
| `--cs-cobalt-hover` | #2448CC | Hover |
| `--cs-teal` | #267C70 | Occasional secondary emphasis |
| success / warning / danger / info | #197447 / #98550D / #B93843 / #245F9C | Real states only, always with text |

## Type
Geist (sans) + Geist Mono. One editorial phrase in Instrument Serif italic on the hero only.
Hero 56–76px · page title 36–48 · section 28–36 · card 18–22 · body 15–17 · support 13–14.

## Space & shape
4/8px scale. Sections 96–128px (marketing), 64px (app). Max width 1240px, gutters 40px desktop / 20px mobile.
Radii: controls 10px, components 14px, feature surfaces 20px. Shadows only for real elevation.

## Motion
150–250ms UI transitions, `cubic-bezier(.22,1,.36,1)`. 3D: slow camera drift + pointer parallax, pauses offscreen, static under `prefers-reduced-motion` or without WebGL.

## Honesty rules
- 18 checks run; 16 are scored, 2 are informational (llms.txt, training bots).
- Illustrative data is labelled and is the same dataset everywhere (score 49, three findings).
- Technical readiness ≠ model recognition ≠ live AI citations. Live answer-engine checks are not built.
