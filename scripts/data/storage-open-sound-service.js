import { MODULE_ID } from "../constants.js";
import { storageTokenCenter } from "./storage-access.js";
import { isActiveGmClient } from "../infrastructure/foundry/active-gm.js";

export const STORAGE_OPEN_SOUND_PATH = `modules/${MODULE_ID}/assets/storage/sounds/chest-open.mp3`;
export const TEMPORARY_STORAGE_SOUND_FLAG = "temporaryStorageOpenSound";

export class StorageOpenSoundService {
  constructor({
    gameProvider = () => globalThis.game,
    isActiveGm = isActiveGmClient,
    audioHelper = globalThis.AudioHelper,
    setTimeout = globalThis.setTimeout?.bind(globalThis),
    logger = console
  } = {}) {
    this.gameProvider = gameProvider;
    this.isActiveGm = isActiveGm;
    this.audioHelper = audioHelper;
    this.setTimeout = setTimeout;
    this.logger = logger;
  }

  async playForToken(token) {
    if (this.isActiveGm(this.gameProvider()) !== true) return null;
    const scene = token?.parent;
    if (typeof scene?.createEmbeddedDocuments !== "function") return null;
    try { await this.audioHelper?.preloadSound?.(STORAGE_OPEN_SOUND_PATH); }
    catch (error) { this.logger?.warn?.(`${MODULE_ID} | Storage sound preload failed.`, error); }
    try {
      const center = storageTokenCenter(token);
      const [sound] = await scene.createEmbeddedDocuments("AmbientSound", [{
        x: center.x,
        y: center.y,
        path: STORAGE_OPEN_SOUND_PATH,
        radius: 10,
        repeat: false,
        volume: 0.8,
        easing: true,
        walls: true,
        hidden: false,
        flags: { [MODULE_ID]: { [TEMPORARY_STORAGE_SOUND_FLAG]: true } }
      }]);
      if (sound?.id && typeof this.setTimeout === "function") {
        this.setTimeout(async () => {
          try { await scene.deleteEmbeddedDocuments("AmbientSound", [sound.id]); }
          catch (error) { this.logger?.warn?.(`${MODULE_ID} | Storage sound cleanup failed.`, error); }
        }, 1250);
      }
      return sound ?? null;
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
