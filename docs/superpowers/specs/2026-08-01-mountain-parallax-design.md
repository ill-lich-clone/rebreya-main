# Mountain Travel Parallax Design

## Goal

Replace the Travel tab's three selectable WebM landscapes with one genuine,
runtime-rendered mountain parallax. The result must follow the `Parallax2D`
model described in the Godot 4.x documentation: independently authored visual
layers, one shared horizontal scroll direction, layer-specific scroll scales,
and seamless horizontal repetition.

The parallax is visible only on the Travel tab. Every other inventory tab keeps
the current workshop header and current styles unchanged.

## Approved Direction

Use a slow side view from a moving vehicle in a polished, slightly cartoon-like
Victorian-steampunk mountain setting. The scene contains alpine peaks, mist,
wooded ridges, a valley, period stone or brass structures, and restrained steam
details. It must not contain electrical poles, telegraph poles, utility poles,
overhead wires, modern vehicles, text, logos, or watermarks.

There is exactly one landscape. The circular `1`, `2`, and `3` controls and
local per-player landscape persistence are removed.

## Independent Source Assets

The scene is authored as five separate images. No layer may be extracted from,
masked out of, or cut from a single completed panorama. Each layer receives its
own image-generation request using one shared art-direction specification:

1. `sky` - opaque sky, high clouds, and distant atmospheric color;
2. `far-mountains` - the most distant snow-capped mountain range;
3. `middle-ridges` - wooded alpine ridges and sparse period structures;
4. `valley` - nearer forest, river or meadow, rocks, and restrained steam;
5. `foreground` - close grass, shrubs, and low roadside stones that establish
   vehicle motion without poles, wires, or baked motion blur.

All five final assets use the same `1920x450` coordinate system. The sky is
opaque. The other four layers are transparent WebP files produced from their
own flat chroma-key generations and locally validated after key removal.

Each source is made horizontally tileable on its own. Seam preparation may
wrap and blend the left and right edges of that individual layer, but it must
never derive one depth layer from another layer or from a composite panorama.

Final module assets:

- `assets/ui/travel-parallax/mountain-sky.webp`
- `assets/ui/travel-parallax/mountain-far-mountains.webp`
- `assets/ui/travel-parallax/mountain-middle-ridges.webp`
- `assets/ui/travel-parallax/mountain-valley.webp`
- `assets/ui/travel-parallax/mountain-foreground.webp`

## Runtime Model

The template renders one decorative parallax container with five ordered layer
elements. Each element covers the full header and repeats its own image along
the x-axis. The images are aligned to the same top-left origin, equivalent to
placing Godot parallax content at `(0, 0)` inside its repeating canvas.

The implementation maps the Godot concepts as follows:

| Godot concept | Foundry implementation |
| --- | --- |
| `Parallax2D` node | one travel-only parallax container |
| child visual nodes | five independently generated layer elements |
| `scroll_offset` | one continuously increasing horizontal travel offset |
| `scroll_scale.x` | a fixed speed multiplier per layer |
| `repeat_size.x` | the rendered width of one repeated layer texture |

The shared base motion travels from right to left. The layer scales are:

- sky: `0.00`;
- far mountains: `0.10`;
- middle ridges: `0.24`;
- valley: `0.52`;
- foreground: `1.00`.

The foreground base loop lasts approximately 60 seconds. All other moving
layers derive their slower apparent movement from the scale above. Motion is
smooth and constant, with no camera shake, vertical bob, sudden acceleration,
or hard 30-second video restart.

CSS animations implement the shared motion model using a common direction and
per-layer duration derived from the approved scale. Every animation advances
by exactly one rendered texture width before repeating, which is the browser
equivalent of wrapping at `repeat_size.x`.

## Template and Styling

`templates/inventory-app.hbs` replaces the Travel-only `<video>` and selector
markup with one `aria-hidden="true"` parallax container and five empty decorative
layers. No controls, media sources, or landscape identifiers remain.

`styles/main.css` owns all composition and motion:

- the current header height, padding, overflow, identity layout, and control
  stacking remain the source of truth;
- the parallax container is absolute, fills the current header, stays below
  identity and resource controls, and ignores pointer input;
- each layer uses its own module-local WebP, `repeat-x`, explicit z-order, and
  fixed vertical alignment;
- the Travel modifier continues to disable the ordinary workshop pseudo-image;
- existing graphite-and-brass UI surfaces are not replaced or restyled;
- `prefers-reduced-motion: reduce` freezes all layers at their initial offsets.

The implementation must adapt to the current CSS rather than restoring any
older decorative frame or selector styles.

## Code Removal

The following obsolete behavior is removed:

- the three landscape descriptors;
- landscape-id normalization and local-storage helpers;
- landscape selection context data;
- selector click listeners and rerender handling;
- selector-specific tests and CSS;
- all three old WebM files and their poster WebPs.

No replacement application state, setting, socket message, or persistence is
introduced. The effect is decorative and deterministic for every client.

## Performance and Accessibility

The parallax exists only while the Travel tab is rendered. It uses five WebP
textures and compositor-friendly background-position or transform animation;
it does not decode video, allocate a canvas loop, or run a per-frame application
render.

The complete layer set should remain below the combined size of the obsolete
three WebMs and posters. Each transparent asset is checked for alpha coverage,
opaque chroma-key remnants, and edge fringes before integration.

The container and layers are decorative, hidden from assistive technology, and
non-interactive. Reduced-motion users receive the same composed mountain scene
without movement.

## Validation

Automated tests verify:

- the Travel template contains one parallax container and exactly five layers;
- no Travel `<video>`, `<source>`, selector, or landscape-selection action
  remains;
- each layer references a distinct expected asset;
- layer ordering, repeat behavior, scroll scales, and slow durations are
  declared in application-scoped CSS;
- reduced-motion rules stop the animation;
- the ordinary workshop header remains unchanged outside the Travel tab;
- removed selector modules have no remaining imports or consumers;
- the full repository test suite passes.

Asset validation verifies:

- all five final WebPs are `1920x450`;
- the four foreground-capable layers contain an alpha channel and transparent
  pixels;
- each layer is independently sourced and visually matches its assigned depth;
- left-to-right seams remain visually continuous when tiled three times;
- no forbidden poles, wires, modern objects, text, logos, or watermarks appear;
- the composite has no uncovered pixels at supported header sizes.

Manual Foundry validation covers the current default inventory size and a
narrower resized window. Header information must stay readable, the layers must
remain aligned, no seam or blank gap may cross the viewport, and opening,
closing, or switching tabs must not produce console errors.

## Acceptance Criteria

The feature is complete when:

1. the Travel header shows one mountain parallax and no landscape selector;
2. five independently generated images create visible depth at five approved
   scroll scales;
3. horizontal motion loops seamlessly and remains deliberately slow;
4. the scene contains no electrical or telegraph infrastructure;
5. current inventory CSS and non-Travel header behavior are preserved;
6. reduced-motion behavior, asset checks, targeted tests, and the full test
   suite pass.

## Out of Scope

- Additional selectable landscapes.
- A precomposited WebM or GIF.
- Cutting a composite panorama into depth layers.
- Mouse-driven or travel-progress-driven camera control.
- Vertical parallax, sound, weather simulation, or day/night variants.
- Changes to travel calculations, transport fuel, sockets, or group state.
