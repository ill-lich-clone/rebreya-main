# Inventory and Transport Header Animation Design

## Goal

Give the Inventory and Transport tabs distinct, slow-moving illustrated headers without adding video or JavaScript animation. Inventory reuses the current workshop artwork. Transport receives one new classic steam-train illustration. Travel keeps its existing five-layer mountain parallax.

## Scope

- Animate only the shared header while the active tab is `inventory` or `transport`.
- Keep the existing 300 px header geometry, identity block, wallet, controls, masks, colors, and stacking order.
- Keep Party, Craft, Calendar, and Downtime on the current static workshop header.
- Do not change the Travel parallax.
- Do not add player settings, selectors, persistence, video, canvas, or JavaScript animation loops.

## Header Routing

The inventory template adds explicit modifier classes to the shared header:

- `rm-inventory-book__header--inventory`
- `rm-inventory-book__header--travel`
- `rm-inventory-book__header--transport`

The current Travel-only parallax markup remains conditional on `tabs.isTravel`. Inventory and Transport continue to render their artwork through the header pseudo-elements so shared interactive header content stays above the animation.

## Inventory Artwork and Motion

Inventory continues to use `assets/ui/rebreya-party-inventory-workshop.webp`.

Its `::before` artwork runs a clearly visible but smooth Ken Burns-style camera drift:

- duration: 22 seconds;
- direction: `alternate`;
- easing: `ease-in-out`;
- movement: horizontal and vertical `translate3d` changes expressed only as percentages, with up to a 5% travel range;
- zoom: `scale(1.04)` to `scale(1.12)`;
- transform origin: biased toward the lit workbench and window;
- no visible reset between cycles.

A separate `::after` overlay combines a warm radial glow with a narrow diagonal brass highlight. It crosses the header slowly through percentage-based transforms and opacity, making the motion immediately legible without obscuring the artwork or competing with the controls. Inventory uses no steam or smoke effect.

## Transport Artwork

Create one new `1920 x 700` WebP illustration at `assets/ui/rebreya-transport-steam-depot.webp`.

The scene is a classic nineteenth-century steam locomotive inside a Victorian depot, viewed from a three-quarter angle. The locomotive uses dark steel, aged iron, brass fittings, rivets, and restrained warm lamp light. The left third is quieter and darker for the party identity, while the upper-right region avoids important details under the inventory controls. The locomotive remains clearly recognizable in the visible 300 px crop.

The visual style is cinematic, slightly stylized concept art consistent with the existing workshop and Travel art. The image contains no people, text, watermark, electrical poles, electrical wires, modern equipment, or modern signage.

## Transport Motion

Transport uses the same lazy camera principle as Inventory, tuned to travel visibly along the locomotive:

- duration: 24 seconds;
- direction: `alternate`;
- easing: `ease-in-out`;
- movement: lateral and slight vertical `translate3d` drift expressed only as percentages, with up to a 5% travel range;
- zoom: `scale(1.03)` to `scale(1.11)`;
- transform origin: centered on the locomotive boiler and cab;
- no visible reset between cycles.

Its `::after` overlay combines soft CSS radial gradients for drifting steam with a narrow warm highlight across the boiler. Only percentage-based `transform` and `opacity` animate, producing visible steam and reflected lamp light without animating blur, filters, background position, or pixel offsets.

## Performance and Accessibility

- Continuous motion is limited to `transform` and `opacity`.
- Do not animate layout properties, `background-position`, masks, or filters.
- Use `will-change` only on the two actively animated pseudo-elements.
- All Inventory and Transport header animation becomes `none` under `@media (prefers-reduced-motion: reduce)`.
- The artwork and overlays remain `pointer-events: none`.

## Tests and Acceptance Criteria

Automated tests must verify:

- the correct header modifier is emitted for Inventory, Travel, and Transport;
- Inventory references the existing workshop asset;
- Transport references the new train asset;
- the expected 22-second and 24-second camera animations use `alternate` and `ease-in-out`;
- all animation keyframe translations use percentages rather than pixel offsets;
- Inventory and Transport include distinct glare/steam overlay animations;
- the reduced-motion rule disables both artwork and overlay animations;
- no obsolete video or landscape selector returns;
- the new WebP is nonempty and exactly `1920 x 700`.

Rendered QA must verify:

- both headers fill the 300 px crop without empty edges during their full transform range;
- text, wallet, summary, and action controls stay readable and clickable;
- the motion is clearly visible within two seconds while remaining smooth and avoiding a sudden camera move;
- Transport reads immediately as a classic steam train;
- no clipping, z-index regression, missing asset, console error, or visible loop seam appears.
