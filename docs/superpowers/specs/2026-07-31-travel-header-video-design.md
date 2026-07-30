# Travel Header Video Design

## Goal

Replace the static party-inventory header artwork with a slow, seamless
Victorian-steampunk landscape animation only while the `Путешествие` tab is
active. Every other inventory tab keeps the existing workshop background.

## Current Behavior

`templates/inventory-app.hbs` renders one shared
`.rm-inventory-book__header`. Its artwork is provided by
`.rm-inventory-book__header::before` in `styles/main.css` through
`--rm-party-inventory-header-image`.

Changing tabs calls `InventoryApp.setActiveTab()`, updates `activeTab`, and
forces a full application render. The existing `tabs.isTravel` template flag
therefore provides everything needed to conditionally create and remove the
animation without adding JavaScript.

## Media Assets

Create two module-local assets:

- `assets/ui/rebreya-travel-window.webm`
- `assets/ui/rebreya-travel-window-poster.webp`

The video requirements are:

- VP9 WebM, 1920×1080, 15 frames per second, no audio.
- Exactly 30 seconds and 450 frames.
- Seamless infinite loop with matching motion across the final-to-first frame.
- The existing generated Victorian-steampunk countryside remains the visual
  source: hills, telegraph poles, brick factory, copper machinery, steam, and a
  distant airship seen through a brass-trimmed vehicle window.
- Scenery motion is 4.17 times slower than the approved 7.2-second GIF:
  far, middle, and near layers travel 1, 2, and 3 tile widths per 30 seconds.
  At 1920 pixels this is approximately 64, 128, and 192 pixels per second.
- Body movement is a restrained slow sway rather than rapid vibration.
- Target encoded size is at most 20 MiB. Visual clarity takes priority over
  reaching a smaller arbitrary size.

The poster is a WebP export of the first composited frame. It must match the
video crop so loading does not cause a visual jump.

## Template Integration

Inside `.rm-inventory-book__header`, render a decorative video only when
`tabs.isTravel` is true:

```handlebars
{{#if tabs.isTravel}}
  <video
    class="rm-inventory-book__travel-video"
    autoplay
    muted
    loop
    playsinline
    preload="metadata"
    poster="/modules/rebreya-main/assets/ui/rebreya-travel-window-poster.webp"
    aria-hidden="true"
  >
    <source
      src="/modules/rebreya-main/assets/ui/rebreya-travel-window.webm"
      type="video/webm"
    >
  </video>
{{/if}}
```

The video is purely decorative. It has no controls, receives no pointer events,
and does not change the accessible name or interaction model of the header.

When the user leaves the travel tab, the existing full re-render removes the
video element. Other tabs continue using the current workshop pseudo-element
unchanged.

## Styling

Add a selector scoped to `.rebreya-inventory-app`:

- Position the video absolutely across the complete header.
- Use `width: 100%`, `height: 100%`, and `object-fit: cover`.
- Keep the same centered top crop as the current artwork.
- Apply the same bottom fade mask used by the current header pseudo-element.
- Set `pointer-events: none` and keep the video below the existing identity,
  wallet, supply, and action controls.

The existing static workshop pseudo-element remains behind the video. The
travel poster appears before playback; if WebM playback is unavailable, the
header remains readable and the static layers continue to provide a usable
fallback.

## Performance

- The WebM is not present in the DOM outside the travel tab.
- `preload="metadata"` avoids eagerly fetching the entire asset before the
  browser attempts muted autoplay.
- VP9 replaces a 30-second Full-HD animated GIF that would otherwise be several
  hundred megabytes and expensive for Foundry clients to decode.
- No frame-progress synchronization is needed. A normal inventory re-render may
  restart the decorative loop without affecting travel state or controls.

## Validation

Automated checks must verify:

- The video is inside `{{#if tabs.isTravel}}`.
- The source and poster use absolute Foundry module paths.
- `autoplay`, `muted`, `loop`, `playsinline`, `preload="metadata"`, and
  `aria-hidden="true"` remain present.
- The video CSS is application-scoped, full-header, masked, non-interactive, and
  below the existing header content.
- The original workshop background variable and pseudo-element remain intact.
- Existing inventory context and style tests continue passing.

Media validation must confirm:

- 1920×1080 VP9 video, 15 fps, 450 frames, 30-second duration, no audio.
- Full decode succeeds.
- The final-to-first transition is visually continuous.
- The poster is 1920×1080 and matches the first video frame.
- The WebM is no larger than 20 MiB unless preserving acceptable visual quality
  requires documenting a larger result.

Manual Foundry validation covers:

- Travel tab playback for GM and player users.
- Static workshop art on every non-travel tab.
- Switching into and out of travel repeatedly.
- Reopening and resizing the inventory window.
- Readable header text and controls throughout playback.
- No console errors or visible playback controls.

## Out of Scope

- Synchronizing the animation with traveled miles or calendar time.
- Different animations for land, water, and air travel.
- Adding sound.
- Changing travel logic, group state, sockets, or data schemas.
