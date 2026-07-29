# Party Inventory Workshop Header

## Goal

Turn the party inventory header into a balanced, group-specific composition:

- replace the industrial skyline with a purpose-built workshop/warehouse artwork;
- give the left side visual weight through an editable group crest;
- remove the distracting status palette from cargo and energy;
- lower the external book tabs so their first tab begins at the bottom edge of
  the compact supply row.

The inventory data model, actions, permissions, drag and drop, and other tab
contents remain unchanged.

## Workshop artwork

Create a new project asset at
`assets/ui/rebreya-party-inventory-workshop.webp`.

The scene is a working steampunk workshop that also serves as the party
warehouse:

- worn brick, timber, and metal surfaces;
- oil stains, soot, dust, scratches, and signs of active use;
- a workbench, shelves, crates, tools, loose loot, and weapon racks;
- at least one clearly recognizable firearm without making it the focal point;
- several fuel canisters integrated naturally into the storage scene;
- no characters, lettering, logos, UI, or watermark.

The room itself remains dirty and lived-in. The exposure and color grade are
comparatively light: readable shadow detail, warm neutral daylight and lamp
light, muted brass and timber, and no heavy orange filter or crushed blacks.

The artwork is composed as a wide header. Its strongest object detail sits in
the center and lower third. The left area behind the group identity and the
right area behind the resource controls remain quieter so the interface stays
legible. The existing bottom fade treatment may be retained, but the artwork
must not receive an additional dark tint or shade overlay.

## Header composition

The header keeps its current height and two-sided structure.

### Left identity block

The left side contains:

- a circular group crest;
- the group name in the existing prominent title type;
- no additional resource statistics or duplicated inventory data.

The crest and title form one intentional visual unit rather than two floating
elements. The crest is large enough to counterbalance the complete control
stack on the right without hiding the workshop artwork.

### Right control stack

The existing functional order remains:

1. `Лист склада`, `Еда`, and `Вода`;
2. the full-width cargo meter;
3. the compact `Еда`, `Вода`, and `Энергия` row.

Cargo and energy no longer use green, yellow, or red card backgrounds and
borders in the header. Their cards use the same neutral charcoal treatment as
the food and water cards. The cargo fill uses a low-saturation light neutral
color. Numeric labels and the existing cargo tooltip continue to communicate
state without competing with the group identity and artwork.

No resource values or calculations change.

## Editable crest

The crest is a dedicated party-inventory setting rather than a replacement for
the group Actor portrait.

- Store the selected path on the active group Actor under the module flag
  `partyInventoryCrest`.
- Resolve the displayed image in this order:
  1. the dedicated crest flag;
  2. the active group Actor image;
  3. an existing neutral Foundry/module fallback image.
- Users represented by the existing inventory `canManage` permission may edit
  the crest.
- Other users see the crest without edit controls.
- The editable crest is a real button with a useful accessible label and
  keyboard focus treatment.
- Activating it opens Foundry's current file picker implementation.
- Choosing an image stores the path on the active group Actor and rerenders the
  inventory.
- Cancelling the picker changes nothing.
- Selection or persistence failures produce a concise notification and do not
  clear the previous crest.

## External tab position

The tab rail remains absolutely positioned outside the right page edge and
continues not to consume application width.

Move the rail downward so the top edge of `Инвентарь` aligns with the bottom
edge of the compact `Еда / Вода / Энергия` row. In the current composition this
places the first tab approximately where `Календарь` begins today.

The active-tab extension, shadows, focus treatment, page scrolling, and tab
switching remain unchanged.

## Generated asset workflow

Use the built-in image generation tool for the first workshop asset. Inspect
the generated result before integrating it. If the useful composition needs a
wide crop, crop non-destructively around the center and lower-third workshop
details, then save the final WebP inside the module.

Do not overwrite `rebreya-character-header.webp`; the character sheet continues
to use its current artwork.

## Verification

Automated checks cover:

- crest URL resolution and fallback order;
- crest editing permission;
- successful persistence, cancellation, and failed persistence behavior;
- template structure for the left identity block and accessible edit button;
- neutral cargo and energy styling;
- the lower external tab offset;
- the new workshop asset reference without changes to the character-sheet
  asset.

Run the inventory-focused tests and the complete `node --test` suite.

In Foundry using the CODEX profile, verify:

- the workshop artwork is dirty and detailed but visibly lighter than the
  previous skyline;
- title and crest balance the right-side controls;
- cargo and energy no longer dominate through status color;
- the first external tab begins at the supply-row boundary;
- a managing user can select and persist a crest;
- a non-managing user sees no crest edit affordance;
- cargo tooltip, tab switching, scrolling, and inventory actions still work;
- no new browser console errors appear.
