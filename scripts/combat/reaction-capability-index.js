function collectionValues(collection) {
  if (Array.isArray(collection)) {
    return collection;
  }
  if (Array.isArray(collection?.contents)) {
    return collection.contents;
  }
  if (typeof collection?.values === "function") {
    return Array.from(collection.values());
  }
  return [];
}

function cleanString(value) {
  return String(value ?? "").trim();
}

function normalizeCandidate(kind, providerId, candidate = {}) {
  return {
    kind,
    providerId,
    actorUuid: cleanString(candidate.actorUuid),
    tokenUuid: cleanString(candidate.tokenUuid),
    itemUuid: cleanString(candidate.itemUuid),
    activityId: cleanString(candidate.activityId),
    ownerUserIds: Array.from(new Set(collectionValues(candidate.ownerUserIds)
      .map(cleanString)
      .filter(Boolean)))
  };
}

function candidateKey(candidate) {
  return [
    candidate.providerId,
    candidate.actorUuid,
    candidate.tokenUuid,
    candidate.itemUuid,
    candidate.activityId
  ].join("|");
}

export class ReactionCapabilityIndex {
  constructor({ sceneProvider = () => globalThis.canvas?.scene ?? null } = {}) {
    this._sceneProvider = sceneProvider;
    this._providers = new Map();
    this._entriesByKind = new Map();
    this._keysByActor = new Map();
    this._keysByToken = new Map();
    this._tokensByActor = new Map();
    this._scene = null;
    this._sceneId = "";
    this._built = false;
  }

  registerProvider(kind, resolver, { providerId = kind } = {}) {
    const normalizedKind = cleanString(kind);
    if (!normalizedKind || typeof resolver !== "function") {
      throw new TypeError("Reaction capability provider requires a kind and resolver");
    }

    this._providers.set(normalizedKind, {
      providerId: cleanString(providerId) || normalizedKind,
      resolver
    });
    this._built = false;
    return this;
  }

  has(kind) {
    this._ensureBuilt();
    return (this._entriesByKind.get(cleanString(kind))?.size ?? 0) > 0;
  }

  list(kind) {
    this._ensureBuilt();
    return Array.from(this._entriesByKind.get(cleanString(kind))?.values() ?? [], (entry) => ({
      ...entry,
      ownerUserIds: [...entry.ownerUserIds]
    }));
  }

  rebuildScene(scene = this._sceneProvider()) {
    this._entriesByKind.clear();
    this._keysByActor.clear();
    this._keysByToken.clear();
    this._tokensByActor.clear();
    this._scene = scene ?? null;
    this._sceneId = cleanString(scene?.id ?? scene?._id);

    for (const token of collectionValues(scene?.tokens)) {
      const actor = token?.actor ?? token?.document?.actor ?? null;
      if (!actor) {
        continue;
      }
      const actorUuid = cleanString(actor.uuid ?? actor.id ?? actor._id);
      const tokens = this._tokensByActor.get(actorUuid) ?? new Map();
      tokens.set(cleanString(token.uuid ?? token.id ?? token._id), token);
      this._tokensByActor.set(actorUuid, tokens);
      this._indexActorToken(actor, token, scene);
    }

    this._built = true;
    return this;
  }

  refreshActor(actor) {
    this._ensureBuilt();
    const actorUuid = cleanString(actor?.uuid ?? actor?.id ?? actor?._id);
    if (!actorUuid) {
      return this;
    }

    this._removeActorEntries(actorUuid);
    for (const token of this._tokensByActor.get(actorUuid)?.values() ?? []) {
      this._indexActorToken(actor, token, this._scene);
    }
    return this;
  }

  removeToken(tokenUuid) {
    this._ensureBuilt();
    const normalizedTokenUuid = cleanString(tokenUuid);
    for (const compoundKey of this._keysByToken.get(normalizedTokenUuid) ?? []) {
      const separator = compoundKey.indexOf("\u0000");
      const kind = compoundKey.slice(0, separator);
      const key = compoundKey.slice(separator + 1);
      const entries = this._entriesByKind.get(kind);
      const entry = entries?.get(key);
      entries?.delete(key);
      if (entries?.size === 0) {
        this._entriesByKind.delete(kind);
      }
      if (entry?.actorUuid) {
        this._keysByActor.get(entry.actorUuid)?.delete(compoundKey);
      }
    }
    this._keysByToken.delete(normalizedTokenUuid);

    for (const [actorUuid, tokens] of this._tokensByActor) {
      tokens.delete(normalizedTokenUuid);
      if (tokens.size === 0) {
        this._tokensByActor.delete(actorUuid);
      }
    }
    return this;
  }

  invalidateScene(sceneId = this._sceneId) {
    const normalizedSceneId = cleanString(sceneId);
    if (normalizedSceneId && this._sceneId && normalizedSceneId !== this._sceneId) {
      return this;
    }

    this._entriesByKind.clear();
    this._keysByActor.clear();
    this._keysByToken.clear();
    this._tokensByActor.clear();
    this._scene = null;
    this._sceneId = "";
    this._built = false;
    return this;
  }

  _indexActorToken(actor, token, scene) {
    const actorUuid = cleanString(actor?.uuid ?? actor?.id ?? actor?._id);
    const actorKeys = this._keysByActor.get(actorUuid) ?? new Set();
    for (const [kind, provider] of this._providers) {
      const resolved = collectionValues(provider.resolver({ actor, token, scene }));
      if (!resolved.length) {
        continue;
      }
      const entries = this._entriesByKind.get(kind) ?? new Map();
      for (const candidate of resolved) {
        const normalized = normalizeCandidate(kind, provider.providerId, candidate);
        const key = candidateKey(normalized);
        const compoundKey = `${kind}\u0000${key}`;
        entries.set(key, normalized);
        actorKeys.add(compoundKey);
        const tokenKeys = this._keysByToken.get(normalized.tokenUuid) ?? new Set();
        tokenKeys.add(compoundKey);
        this._keysByToken.set(normalized.tokenUuid, tokenKeys);
      }
      this._entriesByKind.set(kind, entries);
    }
    this._keysByActor.set(actorUuid, actorKeys);
  }

  _removeActorEntries(actorUuid) {
    for (const compoundKey of this._keysByActor.get(actorUuid) ?? []) {
      const separator = compoundKey.indexOf("\u0000");
      const kind = compoundKey.slice(0, separator);
      const key = compoundKey.slice(separator + 1);
      const entries = this._entriesByKind.get(kind);
      const entry = entries?.get(key);
      entries?.delete(key);
      if (entries?.size === 0) {
        this._entriesByKind.delete(kind);
      }
      if (entry?.tokenUuid) {
        const tokenKeys = this._keysByToken.get(entry.tokenUuid);
        tokenKeys?.delete(compoundKey);
        if (tokenKeys?.size === 0) {
          this._keysByToken.delete(entry.tokenUuid);
        }
      }
    }
    this._keysByActor.delete(actorUuid);
  }

  _ensureBuilt() {
    if (!this._built) {
      this.rebuildScene();
    }
  }
}
