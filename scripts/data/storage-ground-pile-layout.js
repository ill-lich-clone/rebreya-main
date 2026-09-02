export const GROUND_PILE_CARDINAL_ROTATIONS = Object.freeze([0, 90, 180, 270]);

export function isGroundPileCardinalRotation(value) {
  return Number.isInteger(value) && GROUND_PILE_CARDINAL_ROTATIONS.includes(value);
}

export function buildGroundPileTokenLayout({
  width,
  height,
  textureScale = 1,
  rotationMode = ""
} = {}, rotation = 0) {
  if (![width, height, textureScale].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error("Ground-pile layout requires positive finite dimensions and scale.");
  }
  if (rotationMode === "cardinal" && !isGroundPileCardinalRotation(rotation)) {
    throw new Error("Ground-pile furniture rotation must be 0, 90, 180, or 270 degrees.");
  }
  const quarterTurn = rotationMode === "cardinal" && (rotation === 90 || rotation === 270);
  const compensation = quarterTurn && width !== height
    ? Math.max(width / height, height / width)
    : 1;
  return {
    width: quarterTurn ? height : width,
    height: quarterTurn ? width : height,
    textureScale: textureScale * compensation,
    rotation
  };
}
