# Travel Landscape Selector Design

## Goal

Replace the distorted single travel-header video with three purpose-built
panoramic landscapes. Each player can choose a landscape locally from circular
`1`, `2`, and `3` controls in the lower-right corner of the header.

The travel header must look like part of the existing graphite-and-brass
inventory UI. The landscape media contains no baked window frame; the window
trim is rendered in CSS so it remains sharp and correctly proportioned at every
inventory window size.

## Approved Landscapes

1. **Industrial valley** — Victorian factories, steam pipes, airships, and
   cultivated fields.
2. **Wilderness** — mountains, forests, rivers, and sparse Victorian steam
   structures.
3. **City outskirts** — stone buildings, bridges, carriages, and a steam
   railway.

All three landscapes use a polished, slightly cartoon-like Victorian steampunk
illustration style consistent with the adventure. They must not contain
electrical poles, telegraph poles, utility poles, overhead wires, power lines,
modern road furniture, modern vehicles, text, logos, or watermarks.

## Media Composition

Each landscape is generated as a new clean illustration. The generated source
keeps important scenery in a broad horizontal band so it can be cropped, never
stretched, into a `1920x450` master frame. This aspect ratio closely matches the
inventory header at its default width and prevents the distortion seen in the
previous `1920x1080` asset.

The animation pipeline produces one WebM and one WebP poster per landscape:

- `rebreya-travel-industrial.webm`
- `rebreya-travel-industrial-poster.webp`
- `rebreya-travel-wilderness.webm`
- `rebreya-travel-wilderness-poster.webp`
- `rebreya-travel-city.webm`
- `rebreya-travel-city-poster.webp`

Each WebM is:

- VP9, `yuv420p`;
- `1920x450`;
- 15 fps;
- exactly 30 seconds / 450 frames;
- silent;
- an automatically looping, slow parallax view from a moving vehicle;
- seamless at the loop boundary;
- free of a baked decorative frame.

Foreground motion may use grasses, hedges, low stone walls, brush, rails, or
other period-appropriate low objects. It must not introduce poles or wires.

Only the selected WebM is present in the rendered template, so Foundry does not
decode or preload all three videos simultaneously.

## CSS Window Frame

The travel-only header modifier owns a decorative `::after` overlay above the
video and below the header controls. The frame uses the inventory theme:

- graphite surfaces from `--rm-color-ink`, `--rm-color-surface`, and their RGB
  variants;
- brass borders and highlights from `--rm-color-gold`,
  `--rm-color-gold-bright`, and `--rm-color-gold-rgb`;
- restrained inset shadows and corner brackets;
- no rasterized rivets or trim in the media itself.

The video uses `object-fit: cover` and `object-position: center`. Because the
media is authored at the header aspect ratio, `cover` removes only a negligible
edge at unusual window sizes and never vertically squashes the scene.

The existing workshop `header::before` remains disabled on the Travel tab and
unchanged on every other inventory tab.

## Selector Controls

The Travel header renders three circular buttons in its lower-right corner:

- visible labels `1`, `2`, and `3`;
- `data-action="select-travel-landscape"`;
- a stable landscape identifier;
- Russian `aria-label` and `title` text naming the landscape;
- `aria-pressed="true"` on the active choice;
- a gold active state plus keyboard-visible focus treatment.

The selector sits above the CSS frame and video. It remains clickable, does not
interfere with the shared header controls, and is not rendered on other tabs.

Changing the selection:

1. normalizes the requested identifier to one of the three known values;
2. updates the InventoryApp's in-memory selection;
3. persists the choice locally;
4. rerenders the inventory with scroll preservation;
5. renders only the new video source and poster, which autoplay silently.

## Local Per-Player Persistence

The choice is client-local and user-scoped. The storage key includes both the
Foundry world id and current user id, for example:

`rebreya-main.travelLandscape:<world-id>:<user-id>`

Storage reads and writes are guarded because browser storage may be unavailable
or throw. Missing, malformed, or unknown stored values fall back to landscape
`1` without blocking the inventory. No world document, group flag, socket
message, or GM permission is involved.

## Code Boundaries

- `scripts/ui/inventory-app.js`
  - owns the three immutable landscape descriptors;
  - normalizes and loads the local selection;
  - exposes only the active descriptor plus selector state to Handlebars;
  - binds the selection buttons and persists changes.
- `templates/inventory-app.hbs`
  - renders one active `<video>`;
  - renders the three travel-only selector buttons.
- `styles/main.css`
  - renders the graphite-and-brass CSS frame;
  - positions and styles the selector;
  - fits the purpose-built panoramic media without distortion.
- `assets/ui/`
  - contains the three WebMs and three WebP posters.

The obsolete single-video files are removed after every consumer points to the
new descriptors:

- `rebreya-travel-window.webm`
- `rebreya-travel-window-poster.webp`

## Testing and Validation

Automated tests cover:

- fallback and normalization of the selected landscape;
- local storage scoping by world and user;
- context containing exactly one active video and three selector choices;
- click handling, persistence, and rerender with scroll preservation;
- template accessibility attributes and active state;
- CSS frame, circular controls, and non-distorting `cover` behavior;
- preservation of the workshop background for non-Travel tabs;
- existence and non-zero size of all six media assets.

Media validation checks each WebM with `ffprobe` and a full FFmpeg decode:

- VP9;
- `1920x450`;
- 15 fps;
- 450 frames;
- 30 seconds;
- no audio stream;
- no decode errors.

Visual QA checks the default `1320x920` inventory window and a narrower resized
window:

- no stretched or vertically compressed scenery;
- no electrical or telegraph poles and no wires;
- readable shared header content;
- CSS frame matches the inventory palette;
- selector is unobstructed and keyboard focus is visible;
- only the selected video loads;
- selection survives closing and reopening the inventory for the same user;
- other users and other inventory tabs remain unaffected.

## Acceptance Criteria

The feature is complete when:

1. all three new scenes are visually distinct and contain none of the forbidden
   modern/electrical elements;
2. each scene loops slowly for 30 seconds without a visible hard cut;
3. the header shows the landscape without distortion at supported inventory
   sizes;
4. the CSS window trim looks native to the graphite-and-brass inventory theme;
5. the three round controls switch scenes and identify the active choice;
6. each user's choice persists locally and independently;
7. only the selected video is rendered and decoded;
8. non-Travel tabs retain their current workshop behavior;
9. automated tests, media validation, and the full repository test suite pass.
