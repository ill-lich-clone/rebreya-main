import { MODULE_ID } from "../constants.js";
import { storageObjectKind } from "../data/storage-object-kind.js";
import { isActiveGmClient } from "../infrastructure/foundry/active-gm.js";

const LEGACY_FRAME_NAME_PREFIX = `${MODULE_ID}.ground-pile-frame`;
const FRAME_NAME_PREFIX = `${LEGACY_FRAME_NAME_PREFIX}.v2`;

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
    effectManagerProvider = () => globalThis.Sequencer?.EffectManager,
    isActiveGm = (game) => isActiveGmClient(game),
    logger = console
  } = {}) {
    this.gameProvider = gameProvider;
    this.effectManagerProvider = effectManagerProvider;
    this.isActiveGm = isActiveGm;
    this.logger = logger;
  }

  async ensure(token) {
    if (storageObjectKind(token) !== "groundPile") return false;
    const game = this.gameProvider?.();
    const effectManager = this.effectManagerProvider?.();
    if (
      this.isActiveGm?.(game) !== true
      || game?.modules?.get?.("sequencer")?.active !== true
      || typeof effectManager?.getEffects !== "function"
      || typeof effectManager?.endEffects !== "function"
    ) return false;

    const uuid = tokenUuid(token);
    const sceneId = tokenSceneId(token);
    if (!uuid || !sceneId) return false;
    try {
      const names = [
        `${FRAME_NAME_PREFIX}.${uuid}`,
        `${LEGACY_FRAME_NAME_PREFIX}.${uuid}`
      ];
      for (const name of names) {
        if (effectManager.getEffects({ name, sceneId }).length > 0) {
          await effectManager.endEffects({ name, sceneId });
        }
      }
      return true;
    }
    catch (error) {
      this.logger?.debug?.(`${MODULE_ID} | Ground-pile frame cleanup was skipped.`, error);
      return false;
    }
  }
}
