# Scoped UI Refresh Design

## Problem

Several unrelated user actions call `refreshOpenApps()`. That function force-renders every
open module window and every open Actor sheet. A single mutation can also trigger a setting
change, a socket result, a broadcast, and Foundry document hooks, so the same applications
are rendered several times concurrently. Trader and loot generator windows additionally
bring themselves to the front after every render. The result is apparently unrelated windows
opening or stealing focus and, for expensive inventory contexts, temporary UI freezes.

The confirmed hot paths are:

- Mechanus: the setting `onChange`, the command completion, and the cosmology application
  each request another render.
- Downtime: a player sheet renders itself and then refreshes all applications; socket results
  and `downtime-updated` can add more full refresh waves.
- Inventory: document hooks already refresh inventory views, while socket request/result
  handlers also refresh every open application.
- Inventory rendering can create its backing Actor, causing document hooks while a render is
  already in progress.

## Decision

Introduce one keyed, single-flight UI refresh coordinator and route mutations to scoped view
refresh methods. The coordinator coalesces duplicate requests for the same rendered
application, drains requests added during an active refresh in a later pass, and remains
usable when an individual render rejects.

Keep `refreshOpenApps()` as a compatibility boundary for legacy callers, but make it use the
same coordinator. New and corrected paths use these scopes:

- `refreshCosmologyViews()` renders only the cosmology application.
- `refreshDowntimeViews({ actorIds })` renders the relevant Actor sheets and the inventory
  application, whose context includes downtime.
- `refreshInventoryViews({ actorIds })` renders the inventory application and relevant Actor
  sheets.

Background refreshes never change window focus. Explicit open commands remain responsible
for bringing their window to the front.

## Behaviour changes

### Mechanus

The setting change is the authoritative refresh signal. Its `onChange` refreshes only
cosmology views. Command completion and the cosmology UI do not issue redundant full refreshes.

### Downtime

The local sheet submit handler renders only its sheet. Successful socket result messages carry
the operation result but do not refresh views; `downtime-updated` is the single broadcast
refresh signal. Creation emits that broadcast as updates already do, so the active GM and
other clients see a new request. Refreshing is restricted to affected Actor sheets and the
inventory downtime view.

### Inventory

Socket handlers use the inventory scope. Foundry Item/Actor hooks continue to request that
scope and are coalesced by the coordinator. Opening inventory explicitly ensures its backing
Actor before rendering; `_prepareContext` is read-only and never creates documents.

### Window focus

Trader and loot generator `_onRender` hooks no longer bring windows to the front. Their
explicit open methods still do so.

## Compatibility and failure handling

Socket payloads remain compatible; downtime creation only adds the already-supported
`downtime-updated` notification. Legacy callers of `refreshOpenApps()` continue to work.
Refresh failures are isolated with `Promise.allSettled`, so one broken application cannot
block other refreshes or poison later requests.

## Verification

Tests cover coalescing and recovery, scoped routing, socket fan-out, read-only inventory
rendering, and focus behaviour. Existing downtime, inventory-sync, command-dispatch, and UI
tests provide regression coverage.
