# UI Design System

> **Applies when:** the project ships screens a human looks at.
> **Delete this file:** never; Nexalog ships a web UI (and a Flutter app under `mobile/`).

## Design reference

**This UI should feel like: Nexalog's own existing screens** — built on shadcn/ui and the Tailwind v4 CSS custom-property theme tokens in `app/globals.css` (`--background`, `--foreground`, `--sidebar-*`, `--ring`, `--input`, `--font-body`, `--font-code`, `--font-heading`, `--copper`). No external named design reference is established for this product; consistency with the existing screens is the target. The theme is dark-by-default ("warm walnut": `:root` is dark, `.light` is opt-in, so `dark:` variants are essentially unused and `light:` is the override). Brand work in progress lives under `brand-rework/`.

## Visual style

| Axis | This project |
| --- | --- |
| Chrome weight | Not formally documented — match existing screens: shadcn/ui primitives, hairline `border-border` |
| Palette strategy | Token-driven via `app/globals.css`: dark walnut surfaces by default, copper accent (`--copper`, `--copper-dim`), light theme opt-in |
| Density | Not formally documented — match existing screens (dense knowledge-work UI) |
| Default text size | `text-sm` body dominates existing screens; labels `text-xs` |
| Hover and motion | Not formally documented — match existing screens; `tw-animate-css` is available |

## Layout patterns

- **Detail / record page:** primary content stays in the main pane; metadata and secondary actions stay in the sidebar.
- **List / index page:** search and filters sit above the list; use one pagination or infinite-scroll pattern per area.
- **Dashboard:** summary first, detail below; every metric links to the records it summarizes.
- **Form / wizard:** labelled groups, progressive disclosure, and preserved input after failed submission.
- **Async surfaces:** loading, empty, and error states are all designed; see `frontend.md` and `error-handling.md`.

## Component conventions

- Generic primitives live in `components/ui/`; product-aware components live in `components/` outside `ui/`.
- Assemble from existing primitives before inventing a new one. Add a primitive only when no existing combination expresses the need.
- Variants are a closed, named set declared on the primitive. Do not override primitive internals at call sites.
- Presentation may map a status to a visual variant; business eligibility rules stay outside components.
- Use `lucide-react` at `h-4 w-4` for standard icons. Deviate only for deliberate hero or empty-state graphics.
- Styling goes through Tailwind CSS v4 and shadcn/ui. Do not introduce a second styling mechanism.

## Typography and spacing scale

| Role | This project |
| --- | --- |
| Section header | `text-xs font-medium text-muted-foreground` |
| Field label | `text-xs text-muted-foreground` |
| Field value | `text-sm` |
| Section padding | `p-4` |
| Element gap | `gap-2` |
| Borders | `border border-border` |

Use these literals before adding a new size or spacing value. Extend the scale deliberately when the existing vocabulary cannot express the design.

## Forms

- Labels sit above inputs and remain associated with them.
- Pair short related fields in a two-column grid; keep long or free-text fields single-column.
- Show conditional fields after the choice that makes them relevant.
- Keep primary and cancel actions in the same position and order across forms.
- Show field errors beside the offending field; reserve banners for submission failures.
- Preserve entered data after failed submission.

## Consistency check

1. Match Nexalog's existing screens and the `app/globals.css` token set.
2. Keep chrome, palette, density, text, hover, and motion consistent.
3. Keep the primary content in the primary pane on detail screens.
4. Verify loading, empty, error, keyboard, and focus states.
5. Reuse primitives before adding components or variants.
6. Use one icon library at the standard size.
7. Use the typography, spacing, and border scale above.
