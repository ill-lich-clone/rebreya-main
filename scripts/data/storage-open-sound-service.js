import { MODULE_ID } from "../constants.js";
import { storageTokenCenter } from "./storage-access.js";
import { isActiveGmClient } from "../infrastructure/foundry/active-gm.js";

export const STORAGE_OPEN_SOUND_PATH = `modules/${MODULE_ID}/assets/storage/sounds/chest-open.mp3`;
export const TEMPORARY_STORAGE_SOUND_FLAG = "temporaryStorageOpenSound";

export class StorageOpenSoundService {
  constructor({
    gameProvider = () => globalThis.game,
    isActiveGm = isActiveGmClient,
    soundsLayer = null,
    soundsLayerProvider = () => globalThis.canvas?.sounds,
    logger = console
  } = {}) {
    this.gameProvider = gameProvider;
    this.isActiveGm = isActiveGm;
    this.soundsLayerProvider = () => soundsLayer ?? soundsLayerProvider?.();
    this.logger = logger;
  }

  async playForToken(token) {
    if (this.isActiveGm(this.gameProvider()) !== true) return null;
    const soundsLayer = this.soundsLayerProvider();
    if (typeof soundsLayer?.emitAtPosition !== "function") return null;
    try {
      const center = storageTokenCenter(token);
      await soundsLayer.emitAtPosition(STORAGE_OPEN_SOUND_PATH, center, 10, {
        volume: 0.8,
        easing: true,
        walls: true,
        gmAlways: true
      });
      return true;
    }
    catch (error) {
      this.logger?.warn?.(`${MODULE_ID} | Storage sound creation failed.`, error);
      return null;
    }
  }

  async cleanupStale(scene = globalThis.canvas?.scene) {
    if (this.isActiveGm(this.gameProvider()) !== true || typeof scene?.deleteEmbeddedDocuments !== "function") return 0;
    const sounds = scene?.sounds?.contents ?? Array.from(scene?.sounds?.values?.() ?? []);
    const ids = sounds.filter((sound) => sound?.getFlag?.(MODULE_ID, TEMPORARY_STORAGE_SOUND_FLAG) === true
      || sound?.flags?.[MODULE_ID]?.[TEMPORARY_STORAGE_SOUND_FLAG] === true).map((sound) => sound.id).filter(Boolean);
    if (ids.length) await scene.deleteEmbeddedDocuments("AmbientSound", ids);
    return ids.length;
  }
}
