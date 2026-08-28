import assert from "node:assert/strict";
import test from "node:test";

import {
  GRAPPLE_DRAG_COMMAND,
  GRAPPLE_PLACE_COMMAND,
  GRAPPLE_RELEASE_AND_MOVE_COMMAND,
  GRAPPLE_TOGGLE_COMMAND,
  isValidGrappleDragPayload,
  isValidGrapplePlacePayload,
  isValidGrappleReleaseAndMovePayload,
  isValidGrappleTogglePayload
} from "../scripts/infrastructure/foundry/grapple-command-contract.js";

const sourceTokenUuid = "Scene.scene-a.Token.source-a";
const targetTokenUuid = "Scene.scene-a.Token.target-a";

test("grapple command names are stable", () => {
  assert.equal(GRAPPLE_TOGGLE_COMMAND, "combat.grapple.toggle");
  assert.equal(GRAPPLE_PLACE_COMMAND, "combat.grapple.place");
  assert.equal(GRAPPLE_DRAG_COMMAND, "combat.grapple.drag");
  assert.equal(GRAPPLE_RELEASE_AND_MOVE_COMMAND, "combat.grapple.release-and-move");
});

test("toggle and place accept only exact token payloads", () => {
  const toggle = { sourceTokenUuid, targetTokenUuid, operationId: "operation-a" };
  assert.equal(isValidGrappleTogglePayload(toggle), true);
  assert.equal(isValidGrappleTogglePayload({ ...toggle, extra: true }), false);
  assert.equal(isValidGrappleTogglePayload({ ...toggle, sourceTokenUuid: ` ${sourceTokenUuid}` }), false);
  assert.equal(isValidGrappleTogglePayload({ ...toggle, targetTokenUuid: "Token.target" }), false);
  assert.equal(isValidGrappleTogglePayload({ ...toggle, operationId: "" }), false);

  const place = { ...toggle, x: 100.5, y: -20 };
  assert.equal(isValidGrapplePlacePayload(place), true);
  assert.equal(isValidGrapplePlacePayload({ ...place, x: Number.NaN }), false);
  assert.equal(isValidGrapplePlacePayload({ ...place, y: Number.POSITIVE_INFINITY }), false);
  assert.equal(isValidGrapplePlacePayload({ ...place, requesterUserId: "player-a" }), false);
});

test("drag and release-and-move require authenticated requester identity fields", () => {
  const drag = {
    sourceTokenUuid,
    x: 500,
    y: 600,
    operationId: "drag-a",
    requesterUserId: "player-a"
  };
  assert.equal(isValidGrappleDragPayload(drag), true);
  assert.equal(isValidGrappleDragPayload({ ...drag, requesterUserId: " player-a" }), false);
  assert.equal(isValidGrappleDragPayload({ ...drag, targetTokenUuid }), false);

  const releaseMove = {
    targetTokenUuid,
    linkId: "link-a",
    x: 500,
    y: 600,
    operationId: "release-a",
    requesterUserId: "player-a"
  };
  assert.equal(isValidGrappleReleaseAndMovePayload(releaseMove), true);
  assert.equal(isValidGrappleReleaseAndMovePayload({ ...releaseMove, sourceTokenUuid }), false);
  assert.equal(isValidGrappleReleaseAndMovePayload({ ...releaseMove, linkId: "" }), false);
});

test("identifiers are bounded and non-plain payloads are rejected", () => {
  const toggle = { sourceTokenUuid, targetTokenUuid, operationId: "x".repeat(129) };
  assert.equal(isValidGrappleTogglePayload(toggle), false);
  assert.equal(isValidGrappleTogglePayload(Object.assign([], toggle)), false);
  assert.equal(isValidGrappleTogglePayload(null), false);
});
