import { MODULE_ID } from "../constants.js";
import { storageObjectKind } from "../data/storage-object-kind.js";
import { isActiveGmClient } from "../infrastructure/foundry/active-gm.js";

const FRAME_SCALE = 1.12;
const FRAME_NAME_PREFIX = `${MODULE_ID}.ground-pile-frame`;

function positive(value, fallback = 1) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function rounded(value) {
  return Math.round(value * 1000) / 1000;
}

function tokenDocument(token) {
  return token?.document ?? token;
}

function tokenUuid(token) {
  return String(tokenDocument(token)?.uuid ?? token?.uuid ?? "").trim();
}

function tokenSceneId(token) {
  const document = tokenDocument(token);
  return String(document?.parent?.id ?? document?.parent?.uuid ?? "").trim();
}

export class GroundPileFrameController {
  constructor({
    gameProvider = () => globalThis.game,
    sequenceProvider = () => globalThis.Sequence,
    effectManagerProvider = () => globalThis.Sequencer?.EffectManager,
    isActiveGm = (game) => isActiveGmClient(game),
    logger = console
  } = {}) {
    this.gameProvider = gameProvider;
    this.sequenceProvider = sequenceProvider;
    this.effectManagerProvider = effectManagerProvider;
    this.isActiveGm = isActiveGm;
    this.logger = logger;
  }

  async ensure(token) {
    if (storageObjectKind(token) !== "groundPile") return false;
    const game = this.gameProvider?.();
    const SequenceClass = this.sequenceProvider?.();
    const effectManager = this.effectManagerProvider?.();
    if (
      this.isActiveGm?.(game) !== true
      || game?.modules?.get?.("sequencer")?.active !== true
      || typeof SequenceClass !== "function"
      || typeof effectManager?.getEffects !== "function"
    ) return false;

    const uuid = tokenUuid(token);
    const sceneId = tokenSceneId(token);
    if (!uuid || !sceneId) return false;
    const name = `${FRAME_NAME_PREFIX}.${uuid}`;
    try {
      if (effectManager.getEffects({ name, sceneId }).length > 0) return true;
      const document = tokenDocument(token);
      const width = rounded(positive(document?.width) * FRAME_SCALE);
      const height = rounded(positive(document?.height) * FRAME_SCALE);
      const radius = rounded(Math.min(width, height) * 0.08);
      await new SequenceClass()
        .effect()
        .attachTo(token, {
          bindVisibility: true,
          bindAlpha: true,
          bindScale: true,
          bindElevation: true,
          bindRotation: false
        })
        .shape("roundedRect", {
          name: "shadow",
          width,
          height,
          radius,
          gridUnits: true,
          fillColor: 0x0f1116,
          fillAlpha: 0.08,
          lineSize: 8,
          lineColor: 0x0f1116
        })
        .shape("roundedRect", {
          name: "brass",
          width,
          height,
          radius,
          gridUnits: true,
          fillAlpha: 0,
          lineSize: 3,
          lineColor: 0xe0b25e
        })
        .aboveLighting(true)
        .persist(true)
        .name(name)
        .play();
      return true;
    }
    catch (error) {
      this.logger?.debug?.(`${MODULE_ID} | Ground-pile frame was skipped.`, error);
      return false;
    }
  }
}
