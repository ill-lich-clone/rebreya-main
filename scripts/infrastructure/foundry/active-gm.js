function isEligibleGm(user) {
  return Boolean(user?.isGM && user?.active && user?.id != null);
}

function listUsers(users) {
  if (Array.isArray(users?.contents)) {
    return users.contents;
  }
  if (Array.isArray(users)) {
    return users;
  }
  if (typeof users?.values === "function") {
    return Array.from(users.values());
  }
  if (users && typeof users[Symbol.iterator] === "function") {
    return Array.from(users);
  }
  return [];
}

function compareUserIds(left, right) {
  const leftId = String(left.id);
  const rightId = String(right.id);
  if (leftId < rightId) {
    return -1;
  }
  if (leftId > rightId) {
    return 1;
  }
  return 0;
}

export function getActiveGm(game) {
  const foundryActiveGm = game?.users?.activeGM;
  if (isEligibleGm(foundryActiveGm)) {
    return foundryActiveGm;
  }

  const candidates = listUsers(game?.users)
    .filter(isEligibleGm)
    .sort(compareUserIds);
  if (candidates.length > 0) {
    return candidates[0];
  }

  return isEligibleGm(game?.user) ? game.user : null;
}

export function isActiveGmClient(game) {
  const activeGm = getActiveGm(game);
  const currentUser = game?.user;
  return Boolean(
    activeGm
    && isEligibleGm(currentUser)
    && String(activeGm.id) === String(currentUser.id)
  );
}
