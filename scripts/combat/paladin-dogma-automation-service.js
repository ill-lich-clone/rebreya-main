import {
  CLASS_FEATURES_COMPENDIUM_NAME,
  MODULE_ID,
  SPELLS_COMPENDIUM_NAME
} from "../constants.js";
import {
  PALADIN_DOGMA_LEVELS,
  PALADIN_OATHS,
  getPaladinDogma,
  getPaladinDogmas,
  getPaladinOath
} from "../data/paladin-dogmas.js";

const PALADIN_CLASS_IDENTIFIER = "paladin-rework-v01";
const PALADIN_DOGMA_CHOICES_FLAG = "paladinDogmaChoices";
const PALADIN_DOGMA_FLAG = "paladinDogma";
const PALADIN_DOGMA_SPELL_FLAG = "paladinDogmaSpell";
const PALADIN_DOGMA_DEDICATION_IDENTIFIER = "posvyaschenie-v-dogmaty-paladina";

export const PALADIN_DOGMA_OPERATION_OPTION = "rebreyaPaladinDogmaAutomation";

const OATH_ID_BY_SUBCLASS_IDENTIFIER = new Map([
  ["paladin-oath-devotion", "devotion"],
  ["paladin-oath-vengeance", "vengeance"],
  ["paladin-oath-glory", "glory"],
  ["paladin-oathbreaker", "oathbreaker"],
  ["paladin-oath-oathbreaker", "oathbreaker"],
  ["paladin-oath-nirkadu", "nirkadu"],
  ["paladin-oath-arcana", "arcana"],
  ["paladin-oath-magistrate", "magistrate"]
]);

function deepClone(value) {
  return globalThis.foundry?.utils?.deepClone?.(value)
    ?? JSON.parse(JSON.stringify(value));
}

function getProperty(source, path) {
  return globalThis.foundry?.utils?.getProperty?.(source, path)
    ?? String(path ?? "").split(".").reduce((value, key) => value?.[key], source);
}

function setProperty(target, path, value) {
  if (globalThis.foundry?.utils?.setProperty) {
    globalThis.foundry.utils.setProperty(target, path, value);
    return target;
  }

  const parts = String(path ?? "").split(".").filter(Boolean);
  let cursor = target;
  while (parts.length > 1) {
    const key = parts.shift();
    cursor[key] ??= {};
    cursor = cursor[key];
  }
  cursor[parts[0]] = value;
  return target;
}

function collectionValues(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection.contents)) return collection.contents;
  if (typeof collection.values === "function") return Array.from(collection.values());
  return [];
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function normalizeText(value) {
  return cleanText(value)
    .toLocaleLowerCase("ru-RU")
    .replace(/\u0451/gu, "\u0435")
    .replace(/['"\u2019\u2018\u02BC\u00AB\u00BB]/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function escapeHtml(value) {
  return globalThis.foundry?.utils?.escapeHTML?.(cleanText(value))
    ?? cleanText(value)
      .replace(/&/gu, "&amp;")
      .replace(/</gu, "&lt;")
      .replace(/>/gu, "&gt;")
      .replace(/"/gu, "&quot;");
}

function readModuleFlag(document, key) {
  return document?.getFlag?.(MODULE_ID, key)
    ?? getProperty(document, `flags.${MODULE_ID}.${key}`);
}

function itemIdentifier(item) {
  return cleanText(item?.system?.identifier ?? item?.identifier);
}

function actorFromItem(item) {
  return item?.parent ?? item?.actor ?? null;
}

function isCurrentUserHook(userId) {
  const hookUserId = cleanText(userId);
  const currentUserId = cleanText(globalThis.game?.user?.id);
  return !hookUserId || !currentUserId || hookUserId === currentUserId;
}

function canManageActor(actor) {
  if (!actor) return false;
  if (globalThis.game?.user?.isGM) return true;
  if (actor.isOwner === true) return true;
  if (typeof actor.testUserPermission === "function") {
    try {
      return actor.testUserPermission(globalThis.game?.user, "OWNER") === true;
    }
    catch (_error) {
      return false;
    }
  }
  return false;
}

function isPaladinClassItem(item) {
  return item?.type === "class" && itemIdentifier(item) === PALADIN_CLASS_IDENTIFIER;
}

function isPaladinSubclassItem(item) {
  return item?.type === "subclass" && Boolean(paladinOathIdFromSubclass(item));
}

function isPaladinDogmaDedication(item) {
  return item?.type === "feat" && itemIdentifier(item) === PALADIN_DOGMA_DEDICATION_IDENTIFIER;
}

function isPaladinDogmaSpell(item) {
  return item?.type === "spell" && Boolean(readModuleFlag(item, PALADIN_DOGMA_SPELL_FLAG));
}

function paladinClassLevel(actor) {
  const classItem = collectionValues(actor?.items).find(isPaladinClassItem);
  const level = Number(
    classItem?.system?.levels
    ?? classItem?.system?.level
    ?? classItem?.system?.advancement?.level
    ?? 0
  );
  return Number.isFinite(level) ? Math.max(0, Math.floor(level)) : 0;
}

function cloneItemData(document) {
  const data = typeof document?.toObject === "function"
    ? document.toObject()
    : deepClone(document);
  delete data?._id;
  delete data?.folder;
  return data;
}

function normalizedChoiceState(item, fallbackOathId = "") {
  const raw = readModuleFlag(item, PALADIN_DOGMA_CHOICES_FLAG);
  const selections = {};
  if (raw?.selections && typeof raw.selections === "object") {
    for (const [level, dogmaIds] of Object.entries(raw.selections)) {
      if (Array.isArray(dogmaIds) && dogmaIds.length) {
        selections[String(level)] = [...dogmaIds];
      }
    }
  }
  return {
    oathId: cleanText(raw?.oathId ?? fallbackOathId),
    selections
  };
}

function spellMatchKey(item) {
  return cleanText(item?.system?.identifier)
    || normalizeText(item?.name);
}

function dogmaSpellMatchKey(dogma) {
  return cleanText(dogma?.spell?.identifier)
    || normalizeText(dogma?.spell?.nameEn)
    || normalizeText(dogma?.spell?.nameRu);
}

function sourceDogmaIds(item) {
  const flag = readModuleFlag(item, PALADIN_DOGMA_SPELL_FLAG);
  return Array.isArray(flag?.dogmaIds) ? flag.dogmaIds.map(cleanText).filter(Boolean) : [];
}

function ownedDogmaIds(actor) {
  return new Set(collectionValues(actor?.items)
    .map((item) => cleanText(readModuleFlag(item, PALADIN_DOGMA_FLAG)?.id))
    .filter(Boolean));
}

export function normalizePaladinDogmaSelection(selection, availableDogmas) {
  if (!Array.isArray(selection) || selection.length < 1 || selection.length > 2) {
    return [];
  }

  const availableIds = new Set((availableDogmas ?? []).map((dogma) => dogma.id));
  const selected = Array.from(new Set(selection.map(cleanText).filter(Boolean)));
  if (selected.length < 1 || selected.length > 2 || selected.some((id) => !availableIds.has(id))) {
    return [];
  }
  return selected;
}

export function paladinOathIdFromSubclass(item) {
  if (item?.type !== "subclass") return "";
  const identifier = itemIdentifier(item);
  return OATH_ID_BY_SUBCLASS_IDENTIFIER.get(identifier) ?? "";
}

function getDialogForm(button) {
  return button?.form ?? button?.closest?.("form") ?? null;
}

function bindDogmaValidation(_event, dialog) {
  const root = dialog?.element ?? dialog;
  const confirm = root?.querySelector?.('[data-action="confirm"]');
  const inputs = Array.from(root?.querySelectorAll?.('input[name="dogmaIds"]') ?? []);
  if (!confirm || !inputs.length) return;

  const update = () => {
    const count = inputs.filter((input) => input.checked).length;
    confirm.disabled = count < 1 || count > 2;
  };
  for (const input of inputs) input.addEventListener?.("change", update);
  update();
}

async function promptOathChoice() {
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2
    ?? globalThis.DialogV2;
  if (typeof DialogV2?.wait !== "function") return null;

  const options = PALADIN_OATHS
    .map((oath) => `<option value="${escapeHtml(oath.id)}">${escapeHtml(oath.name)}</option>`)
    .join("");
  return DialogV2.wait({
    window: { title: "Посвящение в догматы паладина" },
    content: `
      <form>
        <div class="form-group">
          <label>Клятва</label>
          <select name="oathId">${options}</select>
        </div>
      </form>
    `,
    buttons: [
      {
        action: "confirm",
        label: "Далее",
        default: true,
        callback: (_event, button) => cleanText(getDialogForm(button)?.elements?.oathId?.value)
      },
      {
        action: "cancel",
        label: "Отмена",
        callback: () => null
      }
    ],
    close: () => null
  });
}

async function promptDogmaChoice({ oath, level, dogmas }) {
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2
    ?? globalThis.DialogV2;
  if (typeof DialogV2?.wait !== "function") return null;

  const choices = dogmas.map((dogma) => `
    <label class="checkbox">
      <input type="checkbox" name="dogmaIds" value="${escapeHtml(dogma.id)}">
      <strong>${escapeHtml(dogma.spell.nameRu)}</strong>
      <span>${escapeHtml(dogma.tenet)}</span>
    </label>
  `).join("");
  return DialogV2.wait({
    window: { title: `${oath.name}: догматы ${level}-го уровня` },
    content: `
      <form>
        <p>Выберите минимум один догмат. Можно выбрать оба.</p>
        ${choices}
      </form>
    `,
    render: bindDogmaValidation,
    buttons: [
      {
        action: "confirm",
        label: "Подтвердить",
        default: true,
        callback: (_event, button) => Array.from(
          getDialogForm(button)?.querySelectorAll?.('input[name="dogmaIds"]:checked') ?? []
        ).map((input) => input.value)
      },
      {
        action: "cancel",
        label: "Отмена",
        callback: () => null
      }
    ],
    close: () => null
  });
}

async function packIndex(pack, fields) {
  if (typeof pack?.getIndex !== "function") return [];
  const index = await pack.getIndex({ fields });
  return collectionValues(index);
}

async function defaultResolveDogmaDocument(dogma) {
  const pack = globalThis.game?.packs?.get?.(`world.${CLASS_FEATURES_COMPENDIUM_NAME}`);
  if (!pack) return null;
  const index = await packIndex(pack, [`flags.${MODULE_ID}.${PALADIN_DOGMA_FLAG}`]);
  const entry = index.find((candidate) => (
    cleanText(getProperty(candidate, `flags.${MODULE_ID}.${PALADIN_DOGMA_FLAG}.id`)) === dogma.id
  ));
  return entry && typeof pack.getDocument === "function"
    ? pack.getDocument(entry._id ?? entry.id)
    : null;
}

function orderedSpellPacks() {
  const packs = collectionValues(globalThis.game?.packs);
  const priority = [
    `world.${SPELLS_COMPENDIUM_NAME}`,
    "dnd5e.spells",
    "dnd5e.spells24"
  ];
  return [...packs].sort((left, right) => {
    const leftId = cleanText(left?.collection ?? left?.metadata?.id);
    const rightId = cleanText(right?.collection ?? right?.metadata?.id);
    const leftPriority = priority.indexOf(leftId);
    const rightPriority = priority.indexOf(rightId);
    return (leftPriority < 0 ? priority.length : leftPriority)
      - (rightPriority < 0 ? priority.length : rightPriority);
  });
}

async function defaultResolveSpellDocument(dogma) {
  const identifiers = new Set([
    cleanText(dogma?.spell?.identifier),
    normalizeText(dogma?.spell?.nameEn),
    normalizeText(dogma?.spell?.nameRu)
  ].filter(Boolean));

  for (const pack of orderedSpellPacks()) {
    if (pack?.documentName && pack.documentName !== "Item") continue;
    const index = await packIndex(pack, ["name", "system.identifier"]);
    const entry = index.find((candidate) => (
      identifiers.has(cleanText(candidate?.system?.identifier))
      || identifiers.has(normalizeText(candidate?.name))
    ));
    if (entry && typeof pack.getDocument === "function") {
      return pack.getDocument(entry._id ?? entry.id);
    }
  }
  return null;
}

export class PaladinDogmaAutomationService {
  constructor(module, options = {}) {
    this.module = module;
    this.chooseOath = options.chooseOath ?? promptOathChoice;
    this.chooseDogmas = options.chooseDogmas ?? promptDogmaChoice;
    this.resolveDogmaDocument = options.resolveDogmaDocument ?? defaultResolveDogmaDocument;
    this.resolveSpellDocument = options.resolveSpellDocument ?? defaultResolveSpellDocument;
    this.notifyWarning = options.notifyWarning ?? ((message) => globalThis.ui?.notifications?.warn?.(message));
  }

  async handleCreatedItem(item, options = {}, userId = "") {
    if (options?.[PALADIN_DOGMA_OPERATION_OPTION] || !isCurrentUserHook(userId)) return;
    if (!isPaladinClassItem(item) && !isPaladinSubclassItem(item) && !isPaladinDogmaDedication(item)) return;
    const actor = actorFromItem(item);
    if (canManageActor(actor)) await this.reconcileActor(actor);
  }

  async handleUpdatedItem(item, _changed = {}, options = {}, userId = "") {
    if (options?.[PALADIN_DOGMA_OPERATION_OPTION] || !isCurrentUserHook(userId)) return;
    const actor = actorFromItem(item);
    if (!canManageActor(actor)) return;

    if (isPaladinDogmaSpell(item)) {
      if (Number(item?.system?.prepared) !== 1) {
        await item.update(
          { "system.prepared": 1 },
          { [PALADIN_DOGMA_OPERATION_OPTION]: true }
        );
      }
      return;
    }

    if (isPaladinClassItem(item) || isPaladinSubclassItem(item) || isPaladinDogmaDedication(item)) {
      await this.reconcileActor(actor);
    }
  }

  async reconcileActor(actor) {
    if (!canManageActor(actor)) return;
    const items = collectionValues(actor.items);
    const level = paladinClassLevel(actor);
    const subclass = items.find(isPaladinSubclassItem);
    const oathId = paladinOathIdFromSubclass(subclass);
    if (level >= PALADIN_DOGMA_LEVELS[0] && subclass && oathId) {
      await this.#reconcileSource(actor, subclass, oathId, PALADIN_DOGMA_LEVELS.filter((entry) => entry <= level));
    }

    for (const dedication of items.filter(isPaladinDogmaDedication)) {
      await this.#reconcileDedication(actor, dedication);
    }
  }

  async #reconcileDedication(actor, dedication) {
    const saved = normalizedChoiceState(dedication);
    let oathId = saved.oathId;
    if (!getPaladinOath(oathId)) {
      oathId = cleanText(await this.chooseOath({ actor, item: dedication, oaths: PALADIN_OATHS }));
      if (!getPaladinOath(oathId)) return;
    }
    await this.#reconcileSource(actor, dedication, oathId, [3]);
  }

  async #reconcileSource(actor, sourceItem, oathId, levels) {
    const oath = getPaladinOath(oathId);
    if (!oath) return;
    const choiceState = normalizedChoiceState(sourceItem, oathId);
    choiceState.oathId = oathId;

    for (const level of levels) {
      const dogmas = getPaladinDogmas(oathId, level);
      let selectedIds = normalizePaladinDogmaSelection(choiceState.selections[String(level)], dogmas);
      let isNewChoice = false;
      if (!selectedIds.length) {
        const rawSelection = await this.chooseDogmas({
          actor,
          item: sourceItem,
          oath,
          level,
          dogmas
        });
        if (rawSelection === null || rawSelection === undefined) return;
        selectedIds = normalizePaladinDogmaSelection(rawSelection, dogmas);
        if (!selectedIds.length) return;
        isNewChoice = true;
      }

      const resolved = await this.#resolveSelection(selectedIds);
      if (!resolved) return;
      await this.#grantSelection(actor, resolved);

      if (isNewChoice) {
        choiceState.selections[String(level)] = selectedIds;
        await sourceItem.update(
          { [`flags.${MODULE_ID}.${PALADIN_DOGMA_CHOICES_FLAG}`]: deepClone(choiceState) },
          { [PALADIN_DOGMA_OPERATION_OPTION]: true }
        );
      }
    }
  }

  async #resolveSelection(selectedIds) {
    const resolved = [];
    for (const dogmaId of selectedIds) {
      const dogma = getPaladinDogma(dogmaId);
      if (!dogma) return null;
      const [dogmaDocument, spellDocument] = await Promise.all([
        this.resolveDogmaDocument(dogma),
        this.resolveSpellDocument(dogma)
      ]);
      if (!dogmaDocument || !spellDocument) {
        const missing = !spellDocument ? dogma.spell.nameRu : `догмат ${dogma.spell.nameRu}`;
        this.notifyWarning(`Не найден документ: ${missing}. Выбор догмата не сохранён.`);
        return null;
      }
      resolved.push({ dogma, dogmaDocument, spellDocument });
    }
    return resolved;
  }

  async #grantSelection(actor, resolved) {
    const operationOptions = { [PALADIN_DOGMA_OPERATION_OPTION]: true };
    const existingDogmaIds = ownedDogmaIds(actor);
    const dogmaData = resolved
      .filter(({ dogma }) => !existingDogmaIds.has(dogma.id))
      .map(({ dogma, dogmaDocument }) => {
        const data = cloneItemData(dogmaDocument);
        setProperty(data, `flags.${MODULE_ID}.${PALADIN_DOGMA_FLAG}`, deepClone(dogma));
        return data;
      });
    if (dogmaData.length) {
      await actor.createEmbeddedDocuments("Item", dogmaData, operationOptions);
    }

    const groups = new Map();
    for (const entry of resolved) {
      const key = dogmaSpellMatchKey(entry.dogma);
      const group = groups.get(key) ?? [];
      group.push(entry);
      groups.set(key, group);
    }

    const spellData = [];
    for (const [key, group] of groups) {
      const dogmaIds = group.map(({ dogma }) => dogma.id);
      const existing = collectionValues(actor.items).find((item) => (
        item?.type === "spell"
        && (
          spellMatchKey(item) === key
          || sourceDogmaIds(item).some((dogmaId) => dogmaIds.includes(dogmaId))
        )
      ));
      if (existing) {
        const mergedDogmaIds = Array.from(new Set([...sourceDogmaIds(existing), ...dogmaIds]));
        const currentPrepared = Number(existing?.system?.prepared);
        const currentSourceClass = cleanText(existing?.system?.sourceClass);
        const currentMethod = cleanText(existing?.system?.method);
        if (
          currentPrepared !== 1
          || currentSourceClass !== PALADIN_CLASS_IDENTIFIER
          || currentMethod !== "spell"
          || JSON.stringify(sourceDogmaIds(existing)) !== JSON.stringify(mergedDogmaIds)
        ) {
          await existing.update({
            "system.prepared": 1,
            "system.sourceClass": PALADIN_CLASS_IDENTIFIER,
            "system.method": "spell",
            [`flags.${MODULE_ID}.${PALADIN_DOGMA_SPELL_FLAG}`]: { dogmaIds: mergedDogmaIds }
          }, operationOptions);
        }
        continue;
      }

      const { spellDocument } = group[0];
      const data = cloneItemData(spellDocument);
      data.type = "spell";
      setProperty(data, "system.identifier", key);
      setProperty(data, "system.prepared", 1);
      setProperty(data, "system.sourceClass", PALADIN_CLASS_IDENTIFIER);
      setProperty(data, "system.method", "spell");
      setProperty(data, `flags.${MODULE_ID}.${PALADIN_DOGMA_SPELL_FLAG}`, { dogmaIds });
      if (spellDocument?.uuid) {
        setProperty(data, "flags.dnd5e.sourceId", spellDocument.uuid);
      }
      spellData.push(data);
    }
    if (spellData.length) {
      await actor.createEmbeddedDocuments("Item", spellData, operationOptions);
    }
  }
}
