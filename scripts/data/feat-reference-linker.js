function cleanString(value) {
  return String(value ?? "").trim();
}

function normalizeReferenceText(value) {
  return cleanString(value)
    .toLocaleLowerCase("ru")
    .replace(/ё/gu, "е")
    .replace(/\s+/gu, " ");
}

function escapeRegexCharacter(value) {
  return /[.*+?^$()|[\]\\{}]/u.test(value) ? `\\${value}` : value;
}

function labelPattern(label) {
  let pattern = "";
  let inWhitespace = false;
  for (const character of label) {
    if (/\s/u.test(character)) {
      if (!inWhitespace) {
        pattern += "\\s+";
        inWhitespace = true;
      }
      continue;
    }
    inWhitespace = false;
    pattern += character === "е" ? "[её]" : escapeRegexCharacter(character);
  }
  return pattern;
}

function freezeTarget(target, label) {
  return Object.freeze({
    uuid: cleanString(target?.uuid),
    canonicalName: cleanString(target?.canonicalName),
    aliases: Object.freeze(Array.isArray(target?.aliases)
      ? target.aliases.map(cleanString).filter(Boolean)
      : []),
    kind: cleanString(target?.kind),
    sourceId: cleanString(target?.sourceId),
    label
  });
}

export function buildFeatReferenceMatcher(targets = []) {
  const aliases = new Map();
  for (const target of Array.isArray(targets) ? targets : []) {
    const uuid = cleanString(target?.uuid);
    if (!uuid || /[\]}]/u.test(uuid)) {
      throw new TypeError("Feat reference target requires a safe UUID");
    }

    for (const label of [target?.canonicalName, ...(target?.aliases ?? [])]) {
      const displayLabel = cleanString(label);
      const key = normalizeReferenceText(displayLabel);
      if (!key) {
        continue;
      }
      const bucket = aliases.get(key) ?? [];
      if (!bucket.some((candidate) => candidate.uuid === uuid)) {
        bucket.push(freezeTarget({ ...target, uuid }, displayLabel));
      }
      aliases.set(key, bucket);
    }
  }

  for (const [key, bucket] of aliases) {
    aliases.set(key, Object.freeze([...bucket]));
  }
  const labels = Object.freeze(
    [...aliases.keys()].sort((left, right) => (
      right.length - left.length
      || left.localeCompare(right, "ru")
    ))
  );
  const alternation = labels.map(labelPattern).join("|");
  return Object.freeze({
    aliases,
    labels,
    pattern: alternation
      ? `(^|[^\\p{L}\\p{N}])(${alternation})(?=$|[^\\p{L}\\p{N}])`
      : ""
  });
}

function findTagEnd(html, start) {
  let quote = "";
  for (let index = start + 1; index < html.length; index += 1) {
    const character = html[index];
    if (quote) {
      if (character === quote) {
        quote = "";
      }
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
      continue;
    }
    if (character === ">") {
      return index;
    }
  }
  return -1;
}

function scanHtml(html) {
  const segments = [];
  let textStart = 0;
  let index = 0;
  const flushText = (end) => {
    if (end > textStart) {
      segments.push({ type: "text", value: html.slice(textStart, end) });
    }
  };

  while (index < html.length) {
    if (html.startsWith("@UUID[", index)) {
      const uuidEnd = html.indexOf("]", index + 6);
      const labelStart = uuidEnd >= 0 && html[uuidEnd + 1] === "{" ? uuidEnd + 2 : -1;
      const labelEnd = labelStart >= 0 ? html.indexOf("}", labelStart) : -1;
      if (uuidEnd < 0 || labelStart < 0 || labelEnd < 0) {
        return null;
      }
      flushText(index);
      segments.push({ type: "uuid", value: html.slice(index, labelEnd + 1) });
      index = labelEnd + 1;
      textStart = index;
      continue;
    }

    if (html[index] === "<") {
      const tagEnd = findTagEnd(html, index);
      if (tagEnd < 0) {
        return null;
      }
      flushText(index);
      segments.push({ type: "tag", value: html.slice(index, tagEnd + 1) });
      index = tagEnd + 1;
      textStart = index;
      continue;
    }

    index += 1;
  }

  flushText(html.length);
  return segments;
}

function isOpeningAnchor(tag) {
  return /^<\s*a(?:\s|\/?>)/iu.test(tag) && !/^<\s*\/\s*a(?:\s|>)/iu.test(tag);
}

function isClosingAnchor(tag) {
  return /^<\s*\/\s*a(?:\s|>)/iu.test(tag);
}

function linkTextSegment(text, {
  matcher,
  selfUuid,
  linked,
  ambiguous,
  ambiguousKeys
}) {
  if (!matcher.pattern || !text) {
    return text;
  }

  const pattern = new RegExp(matcher.pattern, "giu");
  return text.replace(pattern, (match, prefix, displayText) => {
    const key = normalizeReferenceText(displayText);
    const bucket = matcher.aliases.get(key) ?? [];
    const distinctUuids = new Set(bucket.map((target) => target.uuid));
    if (distinctUuids.size !== 1) {
      if (distinctUuids.size > 1 && !ambiguousKeys.has(key)) {
        ambiguousKeys.add(key);
        ambiguous.push(displayText);
      }
      return match;
    }

    const target = bucket[0];
    if (!target || target.uuid === selfUuid) {
      return match;
    }

    linked.push(Object.freeze({
      uuid: target.uuid,
      text: displayText,
      kind: target.kind,
      sourceId: target.sourceId
    }));
    return `${prefix}@UUID[${target.uuid}]{${displayText}}`;
  });
}

export function linkFeatDescriptionHtml(html, {
  matcher,
  selfUuid = ""
} = {}) {
  const source = String(html ?? "");
  const segments = scanHtml(source);
  if (!segments || !matcher?.aliases || !Array.isArray(matcher?.labels)) {
    return {
      html: source,
      linked: [],
      ambiguous: []
    };
  }

  const linked = [];
  const ambiguous = [];
  const ambiguousKeys = new Set();
  const output = [];
  let anchorDepth = 0;

  for (const segment of segments) {
    if (segment.type === "tag") {
      if (isClosingAnchor(segment.value)) {
        anchorDepth = Math.max(0, anchorDepth - 1);
      }
      output.push(segment.value);
      if (isOpeningAnchor(segment.value) && !/\/\s*>$/u.test(segment.value)) {
        anchorDepth += 1;
      }
      continue;
    }

    if (segment.type === "text" && anchorDepth === 0) {
      output.push(linkTextSegment(segment.value, {
        matcher,
        selfUuid: cleanString(selfUuid),
        linked,
        ambiguous,
        ambiguousKeys
      }));
    }
    else {
      output.push(segment.value);
    }
  }

  return {
    html: output.join(""),
    linked,
    ambiguous
  };
}
