---
inclusion: always
---

# Figma → Code Rules (Campusly V2 Web)

These rules govern how every Figma design is translated into code in `apps/web`.
They encode the project's existing conventions so output is consistent without
repeated prompting. The authoritative visual spec is the UI guidelines:

#[[file:docs/UI_GUIDELINES.md]]

When Figma values and project tokens disagree, prefer **project tokens** for
consistency, and adjust spacing/sizing only to preserve visual fidelity.

## Stack & Conventions

- Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS 3.
- Styling: Tailwind utility classes only. No inline styles, no CSS-in-JS.
- Class composition: always use the `cn()` helper from `apps/web/lib/utils.ts`
  (`clsx` + `tailwind-merge`). Never concatenate class strings manually.
- Variants: use `class-variance-authority` (`cva`) for components with multiple
  visual variants/sizes (see `components/ui/Button.tsx` as the reference pattern).
- Icons: use `lucide-react`. IMPORTANT: do not install other icon packages.
- Import alias: use `@/*` (maps to `apps/web/*`).

## Component Organization

- Reusable UI primitives live in `apps/web/components/ui/` (e.g. `Button`, `Card`, `Input`).
- Composite/feature components live in `apps/web/components/`.
- Route-level UI lives under `apps/web/app/`.
- IMPORTANT: Reuse existing primitives from `components/ui/` before creating new ones.
- Component file structure (match existing primitives):
  - `forwardRef` with the correct DOM element type.
  - Named export (e.g. `export const Button = ...`), not default export.
  - Set `Component.displayName`.
  - Accept and forward a `className` prop, merged via `cn()`.
  - Spread remaining native props (`...props`) onto the root element.
- Variant props use union types via CVA (e.g. `variant: 'primary' | 'secondary' | 'ghost' | 'danger'`).

## Design Tokens (never hardcode)

Tokens are defined in `apps/web/tailwind.config.ts` and `apps/web/styles/globals.css`.

- Colors:
  - IMPORTANT: Never hardcode hex/rgb colors. Use semantic Tailwind tokens.
  - Semantic tokens (theme-aware): `background`, `foreground`, `muted`,
    `muted-foreground`, `surface`, `border`, `divider`, `disabled`.
  - Brand: `brand` / `brand-foreground` (orange `#F97316`, constant across themes;
    used sparingly for primary actions).
  - States: `success`, `warning`, `danger`.
- Spacing: use named 8-point tokens `space-1`(4px) … `space-16`(64px),
  e.g. `px-space-4`, `gap-space-2`.
- Radius: use `rounded-tooltip`(6) / `rounded-button`(8) / `rounded-input`(8) /
  `rounded-card`(12) / `rounded-dialog`(16). Do not use arbitrary radii.
- Typography: use `text-h1`, `text-h2`, `text-h3`, `text-body`, `text-caption`,
  `text-small`. Font family is `font-sans` (Inter via `--font-inter`).

## Theme System

- Dark-first, color-inversion only. IMPORTANT: themes change colors ONLY —
  layout, spacing, and structure are identical across light/dark.
- Dark mode uses the `dark` class (`next-themes`, `attribute="class"`).
- Because semantic colors are CSS variables, using the semantic tokens above
  makes components theme-correct automatically. Do not branch on theme in markup.
- No gradients, glassmorphism, or neon. Backgrounds are solid.

## Figma MCP Integration Flow (do not skip)

1. Run `get_design_context` for the exact node(s) to fetch structured design data.
2. If the response is truncated/too large, run `get_metadata` for the node map,
   then re-fetch only the required node(s) with `get_design_context`.
3. Run `get_screenshot` for a visual reference of the variant being implemented.
4. Optionally run `get_variable_defs` to map Figma variables to the tokens above.
5. Only after you have context + screenshot, download assets and start building.
6. Translate the MCP output (React + Tailwind representation) into THIS project's
   conventions: `cn()`, CVA, semantic tokens, named spacing/radius, lucide icons.
7. Validate against the Figma screenshot for 1:1 look and behavior before finishing.
8. Run `pnpm --filter @campusly/web typecheck` (or `npm run typecheck` in `apps/web`)
   and `lint` before marking complete.

## Asset Handling

- IMPORTANT: If the Figma MCP server returns a `localhost` source for an image/SVG,
  use that source directly — do not rewrite it.
- IMPORTANT: Do not create placeholders when a real asset source is provided.
- IMPORTANT: Do not add new icon packages — prefer `lucide-react` or assets in the payload.
- Store any downloaded static assets under `apps/web/public/`.

## Accessibility (UI_GUIDELINES.md §14)

- Interactive controls need accessible names (`aria-label` where text is absent).
- Maintain min 44px touch targets for inputs/buttons (see `Input` `h-11`).
- Preserve visible focus styles (`focus-visible:ring-2 ring-brand`).
- Meet WCAG AA color contrast using the semantic tokens.
