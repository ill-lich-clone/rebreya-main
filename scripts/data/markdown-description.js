const UUID_TOKEN_PATTERN = /@UUID\[[^\]]+\]\{[^}]*\}/gu;

function normalizeNewlines(value) {
  return String(value ?? "").replace(/\r\n?/gu, "\n");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

function preserveUuidTokens(value) {
  const tokens = [];
  const text = String(value ?? "").replace(UUID_TOKEN_PATTERN, (token) => {
    const index = tokens.push(token) - 1;
    return `\u0000UUID${index}\u0000`;
  });
  return { text, tokens };
}

function restoreUuidTokens(value, tokens) {
  return String(value ?? "").replace(/\u0000UUID(\d+)\u0000/gu, (_match, index) => tokens[Number(index)] ?? "");
}

function preserveMarkdownLinks(value) {
  const links = [];
  const text = String(value ?? "").replace(
    /\[((?:\\.|[^\]\\])*)\]\((https?:\/\/[^)\s]+|#[^)\s]+)\)/giu,
    (_match, label, href) => {
      const index = links.push(`<a href="${escapeHtml(href)}">${renderInline(label, { links: false })}</a>`) - 1;
      return `\u0000LINK${index}\u0000`;
    }
  );
  return { text, links };
}

function restoreMarkdownLinks(value, links) {
  return String(value ?? "").replace(/\u0000LINK(\d+)\u0000/gu, (_match, index) => links[Number(index)] ?? "");
}

function preserveEscapedMarkdown(value) {
  const escaped = [];
  const text = String(value ?? "").replace(/\\([^\p{L}\p{N}\s])/gu, (_match, character) => {
    const index = escaped.push(character) - 1;
    return `\u0000ESC${index}\u0000`;
  });
  return { text, escaped };
}

function restoreEscapedMarkdown(value, escaped) {
  return String(value ?? "").replace(
    /\u0000ESC(\d+)\u0000/gu,
    (_match, index) => escapeHtml(escaped[Number(index)] ?? "")
  );
}

function renderInline(value, options = {}) {
  const { text, tokens } = preserveUuidTokens(value);
  const preservedLinks = options.links === false
    ? { text, links: [] }
    : preserveMarkdownLinks(text);
  const { text: escapedText, escaped } = preserveEscapedMarkdown(preservedLinks.text);
  const html = escapeHtml(escapedText)
    .replace(/\*\*([^*\n]+)\*\*/gu, "<strong>$1</strong>")
    .replace(/__([^_\n]+)__/gu, "<strong>$1</strong>")
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/gu, "<em>$1</em>")
    .replace(/(?<!_)_([^_\n]+)_(?!_)/gu, "<em>$1</em>")
    .replace(/`([^`\n]+)`/gu, "<code>$1</code>");
  return restoreUuidTokens(
    restoreMarkdownLinks(restoreEscapedMarkdown(html, escaped), preservedLinks.links),
    tokens
  );
}

function splitTableRow(value) {
  const text = String(value ?? "").trim();
  if (!text.includes("|")) {
    return null;
  }
  const normalized = text.replace(/^\|/u, "").replace(/\|$/u, "");
  const cells = [];
  let cell = "";
  let escaped = false;
  for (const character of normalized) {
    if (escaped) {
      cell += character;
      escaped = false;
    }
    else if (character === "\\") {
      escaped = true;
    }
    else if (character === "|") {
      cells.push(cell.trim());
      cell = "";
    }
    else {
      cell += character;
    }
  }
  cells.push(cell.trim());
  return cells.length ? cells : null;
}

function isTableDivider(value, columnCount) {
  const cells = splitTableRow(value);
  return cells?.length === columnCount && cells.every((cell) => /^:?-{3,}:?$/u.test(cell));
}

function renderTable(lines, startIndex) {
  const header = splitTableRow(lines[startIndex]);
  if (!header || !isTableDivider(lines[startIndex + 1], header.length)) {
    return null;
  }

  const rows = [];
  let index = startIndex + 2;
  while (index < lines.length) {
    const row = splitTableRow(lines[index]);
    if (!row || row.length !== header.length || isTableDivider(lines[index], header.length)) {
      break;
    }
    rows.push(row);
    index += 1;
  }

  const headings = header.map((cell) => `<th>${renderInline(cell)}</th>`).join("");
  const body = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join("")}</tr>`)
    .join("");
  return {
    html: `<table><thead><tr>${headings}</tr></thead><tbody>${body}</tbody></table>`,
    nextIndex: index
  };
}

function parseListLine(value) {
  const match = /^(\s*)([-+*]|\d+[.)])\s+(.*)$/u.exec(String(value ?? ""));
  if (!match) {
    return null;
  }
  return {
    indent: match[1].replace(/\t/gu, "    ").length,
    ordered: /^\d/u.test(match[2]),
    text: match[3]
  };
}

function renderJoinedLines(lines) {
  let html = "";
  for (let index = 0; index < lines.length; index += 1) {
    const raw = String(lines[index] ?? "");
    if (index > 0) {
      const previous = String(lines[index - 1] ?? "");
      html += / {2,}$/u.test(previous) ? "<br>" : " ";
    }
    html += renderInline(raw.trim());
  }
  return html;
}

function isLegacyListLine(line) {
  return /^(?:[—•▪*]|\d+[.)])\s*/u.test(String(line ?? "").trim());
}

function isLegacyLevelLine(line) {
  return /^(?:\d+[-\s]?(?:й|го)\s+уровень|умение\s+\d)/iu.test(String(line ?? "").trim());
}

function isLikelyStandaloneHeading(line) {
  const text = String(line ?? "").trim();
  return Boolean(text) && text.length <= 72 && !/[.!?;:,]$/u.test(text);
}

function renderParagraphLines(lines) {
  const segments = [];
  for (const rawLine of lines) {
    const line = String(rawLine ?? "").trim();
    if (!line) {
      continue;
    }

    const previousRaw = segments.at(-1)?.at(-1) ?? "";
    const startsSegment = !segments.length
      || / {2,}$/u.test(previousRaw)
      || isLegacyListLine(line)
      || isLegacyLevelLine(line)
      || /^\s{4,}\S/u.test(String(rawLine ?? ""))
      || isLikelyStandaloneHeading(segments.at(-1)?.map((entry) => entry.trim()).join(" "));
    if (startsSegment) {
      segments.push([rawLine]);
    }
    else {
      segments.at(-1).push(rawLine);
    }
  }

  return segments.map((segment) => renderJoinedLines(segment)).join("<br>");
}

function renderList(lines, startIndex, indent, ordered) {
  const tag = ordered ? "ol" : "ul";
  const items = [];
  let index = startIndex;

  while (index < lines.length) {
    const item = parseListLine(lines[index]);
    if (!item || item.indent !== indent || item.ordered !== ordered) {
      break;
    }

    const contentLines = [item.text];
    const nested = [];
    index += 1;
    while (index < lines.length && lines[index].trim()) {
      const nextItem = parseListLine(lines[index]);
      if (nextItem) {
        if (nextItem.indent <= indent) {
          break;
        }
        const child = renderList(lines, index, nextItem.indent, nextItem.ordered);
        nested.push(child.html);
        index = child.nextIndex;
        continue;
      }

      const leadingWhitespace = /^(\s*)/u.exec(lines[index])?.[1] ?? "";
      if (leadingWhitespace.replace(/\t/gu, "    ").length <= indent) {
        break;
      }
      contentLines.push(lines[index].trimStart());
      index += 1;
    }

    items.push(`<li>${renderJoinedLines(contentLines)}${nested.join("")}</li>`);
  }

  return { html: `<${tag}>${items.join("")}</${tag}>`, nextIndex: index };
}

function isBlockStart(lines, index) {
  const line = lines[index] ?? "";
  if (!line.trim()) {
    return true;
  }
  if (/^#{1,6}\s+/u.test(line) || /^>\s?/u.test(line) || parseListLine(line)) {
    return true;
  }
  return Boolean(renderTable(lines, index));
}

function renderBlocks(value) {
  const lines = normalizeNewlines(value).split("\n");
  const output = [];
  let index = 0;

  while (index < lines.length) {
    if (!lines[index].trim()) {
      index += 1;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/u.exec(lines[index]);
    if (heading) {
      const level = heading[1].length;
      output.push(`<h${level}>${renderInline(heading[2].trim())}</h${level}>`);
      index += 1;
      continue;
    }

    const table = renderTable(lines, index);
    if (table) {
      output.push(table.html);
      index = table.nextIndex;
      continue;
    }

    const listItem = parseListLine(lines[index]);
    if (listItem) {
      const list = renderList(lines, index, listItem.indent, listItem.ordered);
      output.push(list.html);
      index = list.nextIndex;
      continue;
    }

    if (/^>\s?/u.test(lines[index])) {
      const quoteLines = [];
      while (index < lines.length && /^>\s?/u.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/u, ""));
        index += 1;
      }
      output.push(`<blockquote><p>${renderJoinedLines(quoteLines)}</p></blockquote>`);
      continue;
    }

    const paragraph = [];
    while (index < lines.length && !isBlockStart(lines, index)) {
      paragraph.push(lines[index]);
      index += 1;
    }
    output.push(`<p>${renderParagraphLines(paragraph)}</p>`);
  }

  return output.join("");
}

function replaceUuidTokensWithLabels(value) {
  return String(value ?? "").replace(/@UUID\[[^\]]+\]\{([^}]*)\}/gu, "$1");
}

function replaceSafeMarkdownLinksWithLabels(value) {
  return String(value ?? "").replace(
    /\[((?:\\.|[^\]\\])*)\]\((?:https?:\/\/[^)\s]+|#[^)\s]+)\)/giu,
    "$1"
  );
}

function decodeHtmlEntities(value) {
  return String(value ?? "")
    .replace(/&nbsp;/giu, " ")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&amp;/giu, "&");
}

function canonicalizeWhitespace(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

export function canonicalizeDescriptionMarkdown(value) {
  const lines = normalizeNewlines(replaceSafeMarkdownLinksWithLabels(replaceUuidTokensWithLabels(value))).split("\n");
  const visibleLines = [];

  for (let index = 0; index < lines.length; index += 1) {
    const header = splitTableRow(lines[index]);
    if (header && isTableDivider(lines[index + 1], header.length)) {
      visibleLines.push(header.join(" "));
      index += 2;
      while (index < lines.length) {
        const row = splitTableRow(lines[index]);
        if (!row || row.length !== header.length) {
          index -= 1;
          break;
        }
        visibleLines.push(row.join(" "));
        index += 1;
      }
      continue;
    }

    visibleLines.push(lines[index]
      .replace(/^\s*#{1,6}\s+/u, "")
      .replace(/^\s*>\s?/u, "")
      .replace(/^\s*(?:[-+*]|\d+[.)])\s+/u, "")
      .replace(/ {2,}$/u, ""));
  }

  return canonicalizeWhitespace(visibleLines.join("\n")
    .replace(/\*\*([^*\n]+)\*\*/gu, "$1")
    .replace(/__([^_\n]+)__/gu, "$1")
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/gu, "$1")
    .replace(/(?<!_)_([^_\n]+)_(?!_)/gu, "$1")
    .replace(/`([^`\n]+)`/gu, "$1")
    .replace(/\\([^\p{L}\p{N}\s])/gu, "$1"));
}

export function canonicalizeDescriptionHtml(value) {
  const withoutTags = replaceUuidTokensWithLabels(value)
    .replace(/<\/?(?:strong|em|code|a)(?:\s[^>]*)?>/giu, "")
    .replace(/<[^>]*>/gu, " ");
  return canonicalizeWhitespace(decodeHtmlEntities(withoutTags));
}

export function verifyDescriptionTextPreserved(markdown, html) {
  if (canonicalizeDescriptionMarkdown(markdown) !== canonicalizeDescriptionHtml(html)) {
    throw new Error("Description renderer changed visible text");
  }
}

export function renderDescriptionMarkdown(value) {
  const markdown = normalizeNewlines(value).trim();
  if (!markdown) {
    return "";
  }

  const html = renderBlocks(markdown);
  verifyDescriptionTextPreserved(markdown, html);
  return html;
}
