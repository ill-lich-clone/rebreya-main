export const DND5E_STORAGE_SIZE_LOCKS = Object.freeze({ lockSize: true, lockScale: true });

export function supportsDnd5eStorageSizeLocks(game) {
  return game?.system?.id === "dnd5e" && Number.parseInt(game.system.version, 10) >= 6;
}
