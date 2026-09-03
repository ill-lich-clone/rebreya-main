import { MODULE_ID } from "../constants.js";
import { REBREYA_TOOLS } from "../constants.js";
import { GROUP_CONTEXT_ERRORS } from "../data/group-context-service.js";
import {
  buildInventoryFolderSearchIndex,
  buildInventoryFolderTree,
  MAX_INVENTORY_FOLDER_NAME_LENGTH,
  normalizeExpandedFolderIds,
  projectInventoryFolderRows
} from "../data/inventory-folder-tree.js";
import { buildPartyInventoryItemDragData } from "../integrations/inventory-sync.js";
import {
  INVENTORY_INGRESS_RULE_FIELD_DEFINITIONS,
  normalizeInventoryIngressRule,
  normalizeInventoryIngressRuleState
} from "../data/inventory-ingress-rules.js";
import { bringAppToFront, formatNumber, getAppElement } from "../ui.js";
import {
  cleanText,
  finiteNumber as toNumber
} from "../shared/foundry-values.js";
import {
  openPartyInventoryCrestPicker,
  resolvePartyInventoryCrest
} from "./party-inventory-crest.js";
import { isJournalRecordItem } from "../data/journal-record-item.js?v=1.4.217-journal-record-items";
import { openStorageJournalViewer } from "./storage-journal-viewer.js?v=1.4.218-journal-record-error";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export async function openInventoryItem(item, {
  moduleApi,
  openViewer = openStorageJournalViewer
} = {}) {
  if (isJournalRecordItem(item)) {
    const snapshot = await moduleApi.readJournalRecord(item.uuid);
    await openViewer(snapshot);
    return "journal";
  }
  await item?.sheet?.render?.(true);
  bringAppToFront(item?.sheet);
  return "sheet";
}

const KNOWN_GROUP_CONTEXT_ERROR_MESSAGES = new Set([
  GROUP_CONTEXT_ERRORS.GM_NO_ACTIVE_GROUP,
  GROUP_CONTEXT_ERRORS.PLAYER_NO_GROUP
]);

const DOWNTIME_STATUS_META = Object.freeze({
  pending: {
    label: "Ожидает",
    type: "info"
  },
  approved: {
    label: "Одобрено",
    type: "good"
  },
  returned: {
    label: "Возвращено",
    type: "warning"
  },
  rejected: {
    label: "Отклонено",
    type: "danger"
  },
  completed: {
    label: "Завершено",
    type: "good"
  }
});

const CALENDAR_DOWNTIME_STATUS_META = Object.freeze({
  free: { label: "Свободно" },
  pending: { label: "Ожидает" },
  approved: { label: "Одобрено" },
  processed: { label: "Обработано" },
  blocked: { label: "Заблокировано" }
});
const CALENDAR_DOWNTIME_STATUSES = Object.freeze(["free", "pending", "approved", "processed", "blocked"]);
const CALENDAR_DOWNTIME_DOMINANCE = Object.freeze(["blocked", "pending", "approved", "processed", "free"]);

const DOWNTIME_ARCHIVE_STATUSES = new Set(["completed", "rejected"]);
const DOWNTIME_PAGE_SIZE = 5;
const TRAVEL_CITY_PREVIEW_LIMIT = 8;
const TRAVEL_DAY_HOURS = 8;
const INVENTORY_SORT_OPTIONS = Object.freeze([
  { value: "name", label: "Сортировка: название" },
  { value: "weight-desc", label: "Сортировка: вес" },
  { value: "price-desc", label: "Сортировка: цена" },
  { value: "category", label: "Сортировка: категория" },
  { value: "quantity-desc", label: "Сортировка: количество" }
]);
const INVENTORY_SORT_MODES = new Set(INVENTORY_SORT_OPTIONS.map((option) => option.value));
const INVENTORY_RULE_ACTION_OPTIONS = Object.freeze([
  { value: "folder", label: "Переместить в папку" },
  { value: "skip", label: "Пропустить" },
  { value: "dismantle", label: "Разобрать" }
]);
const INVENTORY_FOLDER_DRAG_TYPE = "RebreyaInventoryFolder";
const INVENTORY_TREE_DRAG_VERSION = 1;
const INVENTORY_ITEM_FOLDER_DRAG_FLAG = "inventoryFolderDrag";
const INVENTORY_DRAG_MIME_TYPES = Object.freeze(["text/plain", "text", "application/json", "text/uri-list"]);
let activeInventoryTreeDragSession = null;
const COIN_LABELS = Object.freeze({
  pp: "пм",
  gp: "зм",
  sp: "см",
  cp: "мм"
});
const CURRENCY_MULTIPLIERS = Object.freeze({
  pp: 1000,
  gp: 100,
  sp: 10,
  cp: 1
});

function hasExactObjectKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = [...keys].sort();
  return actualKeys.length === expectedKeys.length
    && actualKeys.every((key, index) => key === expectedKeys[index]);
}

function requireInventoryDragId(value, label) {
  const id = cleanText(value);
  if (!id) throw new TypeError(`${label} is required for inventory drag data.`);
  return id;
}

export function buildInventoryFolderDragData({ groupActorId, folderId } = {}) {
  return {
    type: INVENTORY_FOLDER_DRAG_TYPE,
    rebreyaInventory: {
      version: INVENTORY_TREE_DRAG_VERSION,
      kind: "folder",
      groupActorId: requireInventoryDragId(groupActorId, "groupActorId"),
      folderId: requireInventoryDragId(folderId, "folderId")
    }
  };
}

export function extendInventoryItemDragData(basePayload, { groupActorId, itemId } = {}) {
  if (!basePayload || typeof basePayload !== "object" || Array.isArray(basePayload) || basePayload.type !== "Item") {
    throw new TypeError("A Foundry Item drag payload is required.");
  }
  const moduleFlags = basePayload.flags?.[MODULE_ID];
  return {
    ...basePayload,
    flags: {
      ...(basePayload.flags ?? {}),
      [MODULE_ID]: {
        ...(moduleFlags && typeof moduleFlags === "object" && !Array.isArray(moduleFlags) ? moduleFlags : {}),
        [INVENTORY_ITEM_FOLDER_DRAG_FLAG]: {
          version: INVENTORY_TREE_DRAG_VERSION,
          kind: "item",
          groupActorId: requireInventoryDragId(groupActorId, "groupActorId"),
          itemId: requireInventoryDragId(itemId, "itemId")
        }
      }
    }
  };
}

export function readInventoryTreeDragData(dragData) {
  if (!dragData || typeof dragData !== "object" || Array.isArray(dragData)) return null;

  if (dragData.type === INVENTORY_FOLDER_DRAG_TYPE) {
    if (!hasExactObjectKeys(dragData, ["type", "rebreyaInventory"])) return null;
    const metadata = dragData.rebreyaInventory;
    if (!hasExactObjectKeys(metadata, ["version", "kind", "groupActorId", "folderId"])) return null;
    const groupActorId = cleanText(metadata.groupActorId);
    const folderId = cleanText(metadata.folderId);
    if (metadata.version !== INVENTORY_TREE_DRAG_VERSION || metadata.kind !== "folder" || !groupActorId || !folderId) {
      return null;
    }
    return { version: INVENTORY_TREE_DRAG_VERSION, kind: "folder", groupActorId, folderId };
  }

  if (dragData.type !== "Item") return null;
  const metadata = dragData.flags?.[MODULE_ID]?.[INVENTORY_ITEM_FOLDER_DRAG_FLAG];
  if (!hasExactObjectKeys(metadata, ["version", "kind", "groupActorId", "itemId"])) return null;
  const groupActorId = cleanText(metadata.groupActorId);
  const itemId = cleanText(metadata.itemId);
  if (metadata.version !== INVENTORY_TREE_DRAG_VERSION || metadata.kind !== "item" || !groupActorId || !itemId) {
    return null;
  }
  return { version: INVENTORY_TREE_DRAG_VERSION, kind: "item", groupActorId, itemId };
}

function hasInventoryTreeDragMetadata(dragData) {
  return Boolean(
    dragData?.type === INVENTORY_FOLDER_DRAG_TYPE
    || Object.prototype.hasOwnProperty.call(
      dragData?.flags?.[MODULE_ID] ?? {},
      INVENTORY_ITEM_FOLDER_DRAG_FLAG
    )
  );
}
const DOWNTIME_NON_ROLL_ACTION_TYPES = new Set(["resources", "itemChoice", "numericInput", "optionChoice", "rankChoice", "formulaRoll", "descriptionBlock", "downtimeResult"]);
const DOWNTIME_NON_ROLL_ACTION_SUMMARY_LABELS = Object.freeze({
  resources: "Ресурсы",
  itemChoice: "Предмет",
  numericInput: "Числовой ресурс",
  optionChoice: "Выбор",
  rankChoice: "Выбор ранга",
  formulaRoll: "Формула",
  descriptionBlock: "Описание",
  downtimeResult: "Итог"
});

const MAX_DOWNTIME_TARGET_CHOICES = 5;
const MAX_DOWNTIME_THRESHOLDS = 12;
const MAX_DOWNTIME_RESOURCE_PURCHASES = 3;
const DOWNTIME_TARGET_DIALOG_DIMENSIONS = Object.freeze({
  basis: { width: 620, height: 360 },
  variants: { width: 820, height: 560 },
  outcome: { width: 720, height: 520 },
  effects: { width: 720, height: 560 }
});

const DOWNTIME_ACTION_TYPE_OPTIONS = Object.freeze([
  { value: "check", label: "Проверка", help: "Одна проверка характеристики, навыка, инструмента, действия или атаки." },
  { value: "resources", label: "Ресурсы", help: "Стоимость простоя, нарративные требования и опциональные покупки бонусов." },
  { value: "rankChoice", label: "Выбор ранга", help: "Игрок выбирает ранг простоя из заданного диапазона или таблицы." },
  { value: "optionChoice", label: "Выбор варианта", help: "Игрок выбирает один или несколько заранее описанных вариантов." },
  { value: "numericInput", label: "Числовой ресурс", help: "Игрок вводит количество с ограничениями min/max/default." },
  { value: "formulaRoll", label: "Формула", help: "Игрок или мастер записывает формулу или вычисленное значение." },
  { value: "descriptionBlock", label: "Блок описания", help: "Игрок заполняет название и описание заявки или проекта." },
  { value: "choice", label: "Выбор проверки", help: "Мастер задаёт допустимые варианты, игрок выбирает один перед броском." },
  { value: "downtimeResult", label: "Итог простоя", help: "Общий итог по всем проверкам заявки: сумма, успехи, пороги и итоговые эффекты." },
  { value: "tool", label: "Инструмент", help: "Запрос владения инструментом из листа персонажа." },
  { value: "sheetAction", label: "Действие листа", help: "Запрос готового действия с листа персонажа." },
  { value: "attack", label: "Атака листа", help: "Запрос атаки из листа персонажа; позже выполняется через dnd5e/Midi workflow." },
  { value: "freeform", label: "Свободный итог", help: "Задача без фиксированного броска; мастер оценивает итог вручную." }
]);

const DOWNTIME_ACTION_TYPE_SELECT_OPTIONS = Object.freeze(DOWNTIME_ACTION_TYPE_OPTIONS
  .filter((option) => ["check", "resources", "rankChoice", "optionChoice", "numericInput", "formulaRoll", "descriptionBlock", "downtimeResult", "freeform"].includes(option.value)));

const DOWNTIME_SOURCE_TYPE_OPTIONS = Object.freeze([
  { value: "ability", label: "Характеристика", help: "Чистая проверка характеристики без навыка." },
  { value: "skill", label: "Навык", help: "Навык из листа, включая замену характеристики." },
  { value: "tool", label: "Инструмент", help: "Инструмент или владение с листа персонажа." },
  { value: "save", label: "Спасбросок", help: "Спасбросок выбранной характеристики." },
  { value: "sheetAction", label: "Действие", help: "Действие, уже существующее на листе персонажа." },
  { value: "attack", label: "Атака", help: "Атака оружием, заклинанием или другим атакующим действием листа." }
]);

const DOWNTIME_REBREYA_TOOL_OPTIONS = Object.freeze(REBREYA_TOOLS.map((tool) => ({
  value: tool.id,
  label: tool.label,
  sourceType: "tool",
  help: `Проверка владения инструментом Ребреи: ${tool.label}.`
})));

const DOWNTIME_TARGET_OPTION_GROUPS = Object.freeze([
  {
    label: "Навыки",
    options: [
      { value: "acr", label: "Акробатика", sourceType: "skill", ability: "dex", help: "Ловкость (Акробатика)." },
      { value: "ani", label: "Уход за животными", sourceType: "skill", ability: "wis", help: "Мудрость (Уход за животными)." },
      { value: "arc", label: "Магия", sourceType: "skill", ability: "int", help: "Интеллект (Магия)." },
      { value: "ath", label: "Атлетика", sourceType: "skill", ability: "str", help: "Сила (Атлетика)." },
      { value: "dec", label: "Обман", sourceType: "skill", ability: "cha", help: "Харизма (Обман)." },
      { value: "his", label: "История", sourceType: "skill", ability: "int", help: "Интеллект (История)." },
      { value: "ins", label: "Проницательность", sourceType: "skill", ability: "wis", help: "Мудрость (Проницательность)." },
      { value: "itm", label: "Запугивание", sourceType: "skill", ability: "cha", help: "Харизма (Запугивание); характеристику можно заменить." },
      { value: "inv", label: "Расследование", sourceType: "skill", ability: "int", help: "Интеллект (Расследование)." },
      { value: "med", label: "Медицина", sourceType: "skill", ability: "wis", help: "Мудрость (Медицина)." },
      { value: "nat", label: "Природа", sourceType: "skill", ability: "int", help: "Интеллект (Природа)." },
      { value: "prc", label: "Восприятие", sourceType: "skill", ability: "wis", help: "Мудрость (Восприятие)." },
      { value: "prf", label: "Выступление", sourceType: "skill", ability: "cha", help: "Харизма (Выступление)." },
      { value: "per", label: "Убеждение", sourceType: "skill", ability: "cha", help: "Харизма (Убеждение)." },
      { value: "rel", label: "Религия", sourceType: "skill", ability: "int", help: "Интеллект (Религия)." },
      { value: "slt", label: "Ловкость рук", sourceType: "skill", ability: "dex", help: "Ловкость (Ловкость рук)." },
      { value: "ste", label: "Скрытность", sourceType: "skill", ability: "dex", help: "Ловкость (Скрытность)." },
      { value: "sur", label: "Выживание", sourceType: "skill", ability: "wis", help: "Мудрость (Выживание)." }
    ]
  },
  {
    label: "Характеристики",
    options: [
      { value: "str", label: "Сила", sourceType: "ability", ability: "str", help: "Чистая проверка Силы." },
      { value: "dex", label: "Ловкость", sourceType: "ability", ability: "dex", help: "Чистая проверка Ловкости." },
      { value: "con", label: "Телосложение", sourceType: "ability", ability: "con", help: "Чистая проверка Телосложения." },
      { value: "int", label: "Интеллект", sourceType: "ability", ability: "int", help: "Чистая проверка Интеллекта." },
      { value: "wis", label: "Мудрость", sourceType: "ability", ability: "wis", help: "Чистая проверка Мудрости." },
      { value: "cha", label: "Харизма", sourceType: "ability", ability: "cha", help: "Чистая проверка Харизмы." }
    ]
  },
  {
    label: "Спасброски",
    options: [
      { value: "save-str", label: "Спасбросок Силы", sourceType: "save", ability: "str", help: "Спасбросок Силы." },
      { value: "save-dex", label: "Спасбросок Ловкости", sourceType: "save", ability: "dex", help: "Спасбросок Ловкости." },
      { value: "save-con", label: "Спасбросок Телосложения", sourceType: "save", ability: "con", help: "Спасбросок Телосложения." },
      { value: "save-int", label: "Спасбросок Интеллекта", sourceType: "save", ability: "int", help: "Спасбросок Интеллекта." },
      { value: "save-wis", label: "Спасбросок Мудрости", sourceType: "save", ability: "wis", help: "Спасбросок Мудрости." },
      { value: "save-cha", label: "Спасбросок Харизмы", sourceType: "save", ability: "cha", help: "Спасбросок Харизмы." },
      { value: "death", label: "Спасбросок смерти", sourceType: "save", ability: "death", help: "Спасбросок смерти из чарника." }
    ]
  },
  {
    label: "Инструменты",
    options: DOWNTIME_REBREYA_TOOL_OPTIONS
  },
  {
    label: "Лист персонажа",
    options: [
      { value: "sheet-action", label: "Действие из листа", sourceType: "sheetAction", help: "Готовое действие из чарника; точный список будет расширяться из данных актёра." },
      { value: "sheet-attack", label: "Атака из листа", sourceType: "attack", help: "Атака оружием, заклинанием или другим действием атаки." }
    ]
  }
]);

const DOWNTIME_ABILITY_OPTIONS = Object.freeze([
  { value: "", label: "Из листа", help: "Использовать характеристику, заданную системой или выбранным действием." },
  { value: "str", label: "Сила", help: "СИЛ" },
  { value: "dex", label: "Ловкость", help: "ЛОВ" },
  { value: "con", label: "Телосложение", help: "ТЕЛ; можно сочетать с навыками вроде Запугивания." },
  { value: "int", label: "Интеллект", help: "ИНТ" },
  { value: "wis", label: "Мудрость", help: "МДР" },
  { value: "cha", label: "Харизма", help: "ХАР" }
]);

const DOWNTIME_OUTCOME_MODE_OPTIONS = Object.freeze([
  { value: "dc", label: "DC", help: "Сравнить total с порогом сложности." },
  { value: "sum", label: "Сумма", help: "Сохранить total для накопления суммы." },
  { value: "dc-sum", label: "DC + сумма", help: "Одновременно проверить DC и сохранить total в сумму." },
  { value: "thresholds", label: "Пороги", help: "Сравнить общий итог простоя с несколькими порогами или диапазонами." },
  { value: "pass-thresholds", label: "Передать пороги", help: "Передать выбранный порог проверки в итоговое действие." },
  { value: "freeform", label: "Свободный", help: "Сохранить результат без автоматической оценки успеха." }
]);

const DOWNTIME_RECORD_MODE_OPTIONS = Object.freeze([
  { value: "total-success", label: "Total и успех", help: "Сохранить total и отметку успеха/провала." },
  { value: "total", label: "Только total", help: "Сохранить только число броска." },
  { value: "pass-thresholds", label: "Передать пороги", help: "Сохранить total и выбранный порог для итогового действия." },
  { value: "single-result", label: "Одно значение", help: "Сохранить одно вычисленное значение результата простоя." },
  { value: "group-sum", label: "Сумма группы", help: "Добавить результат к общей сумме заявки." },
  { value: "gm", label: "Решение мастера", help: "Оставить итог на ручное решение мастера." }
]);

const DOWNTIME_RESOURCE_CURRENCY_OPTIONS = Object.freeze([
  { value: "gp", label: "зм", help: "Золотые монеты." },
  { value: "sp", label: "см", help: "Серебряные монеты." },
  { value: "cp", label: "мм", help: "Медные монеты." },
  { value: "custom", label: "ресурс", help: "Нестандартный ресурс группы или предмет." }
]);

const DOWNTIME_RESOURCE_PAYER_OPTIONS = Object.freeze([
  { value: "character", label: "персонаж", help: "Платит персонаж заявки." },
  { value: "group", label: "группа", help: "Платит партийная группа." },
  { value: "manual", label: "мастер", help: "Мастер списывает вручную." }
]);

const DOWNTIME_RESOURCE_TIMING_OPTIONS = Object.freeze([
  { value: "onApproval", label: "при одобрении", help: "Резервировать или списывать после одобрения мастером." },
  { value: "onStart", label: "при старте", help: "Списывать перед выполнением проверок." },
  { value: "onComplete", label: "при завершении", help: "Списывать после решения заявки." },
  { value: "manual", label: "вручную", help: "Только запись для мастера без автоматического действия." }
]);

const DOWNTIME_PURCHASE_EFFECT_OPTIONS = Object.freeze([
  { value: "bonus", label: "бонус", help: "Добавить число или формулу к броску." },
  { value: "advantage", label: "преимущество", help: "Дать преимущество на подходящую проверку." },
  { value: "unlock", label: "доступ", help: "Открыть дополнительный вариант или результат." }
]);

const DOWNTIME_PURCHASE_SCOPE_OPTIONS = Object.freeze([
  { value: "next-check", label: "следующая проверка", help: "Применить к следующему броску этой заявки." },
  { value: "request", label: "вся заявка", help: "Применить ко всему простою." },
  { value: "outcome", label: "итог", help: "Применить к итоговому подсчёту." },
  { value: "manual", label: "мастер решит", help: "Мастер применит покупку вручную." }
]);

const DOWNTIME_THRESHOLD_OUTCOME_OPTIONS = Object.freeze([
  { value: "failure", label: "Провал", help: "Итог считается провалом." },
  { value: "partial", label: "Частично", help: "Итог даёт частичный результат." },
  { value: "success", label: "Успех", help: "Итог считается успехом." },
  { value: "great-success", label: "Сильный успех", help: "Итог даёт улучшенный результат." },
  { value: "no-fragments", label: "0 фрагментов", help: "Не выдать фрагменты сведений." },
  { value: "one-fragment", label: "1 фрагмент", help: "Выдать один фрагмент сведений." },
  { value: "two-fragments", label: "2 фрагмента", help: "Выдать два фрагмента сведений." },
  { value: "three-fragments", label: "3 фрагмента", help: "Выдать три фрагмента сведений." },
  { value: "grant-item", label: "Выдать предмет", help: "Итогом становится выдача предмета." },
  { value: "grant-resource", label: "Выдать ресурс", help: "Итогом становится выдача ресурса." },
  { value: "gm-note", label: "Заметка мастеру", help: "Создать заметку мастеру." },
  { value: "gm", label: "Решение мастера", help: "Мастер решает последствия вручную." }
]);

const DOWNTIME_EFFECT_TRIGGER_OPTIONS = Object.freeze([
  { value: "none", label: "Без эффекта", help: "Ничего не запускать автоматически." },
  { value: "success", label: "После успеха", help: "Запустить эффект только после успешной проверки." },
  { value: "failure", label: "После провала", help: "Запустить эффект только после провала." },
  { value: "any", label: "После любого результата", help: "Запустить эффект после любого результата проверки." }
]);

const DOWNTIME_DOWNTIME_EFFECT_TRIGGER_OPTIONS = Object.freeze([
  { value: "none", label: "Без эффекта", help: "Ничего не запускать при закрытии заявки." },
  { value: "complete", label: "При завершении заявки", help: "Запустить эффект, когда мастер завершит простой." },
  { value: "failure", label: "При провале заявки", help: "Запустить эффект при итоговом провале или отклонении." },
  { value: "manual", label: "При ручном решении", help: "Запустить эффект после явного решения мастера." }
]);

const DOWNTIME_EFFECT_ADAPTER_OPTIONS = Object.freeze([
  { value: "none", label: "Без эффекта", help: "Слот эффекта выключен." },
  { value: "rebreya", label: "Rebreya Main", help: "Изменить состояние Rebreya: прогресс, торговцы, события, награды." },
  { value: "dae", label: "DAE", help: "Выдать или снять Active Effect через DAE." },
  { value: "midi", label: "Midi-QOL", help: "Запустить Midi/dnd5e workflow или макрос." }
]);

const DOWNTIME_CHECK_EFFECT_TEMPLATE_OPTIONS = Object.freeze([
  { value: "none", label: "Без шаблона", help: "Не выполнять шаблон." },
  { value: "project-progress", label: "Записать прогресс", help: "Добавить успех или total к прогрессу проекта." },
  { value: "active-effect", label: "Выдать Active Effect", help: "Создать эффект на персонаже или цели." },
  { value: "workflow", label: "Запустить workflow", help: "Передать событие в Midi/dnd5e workflow." },
  { value: "gm-note", label: "Создать запись мастеру", help: "Оставить структурную запись для мастера." }
]);

const DOWNTIME_REQUEST_EFFECT_TEMPLATE_OPTIONS = Object.freeze([
  { value: "none", label: "Без шаблона", help: "Не выполнять шаблон." },
  { value: "reward", label: "Выдать награду", help: "Выдать предмет, ресурс или отметку прогресса." },
  { value: "trader-stock", label: "Добавить товар торговцу", help: "Изменить ассортимент торговца группы." },
  { value: "group-event", label: "Изменить событие группы", help: "Запустить, завершить или отметить активный ивент." },
  { value: "active-effect", label: "Выдать Active Effect", help: "Создать эффект после завершения простоя." }
]);

function toInteger(value, fallback = 0) {
  return Math.floor(toNumber(value, fallback));
}

export function formatCompactCurrencyAmount(value) {
  const amount = toInteger(value, 0);
  const absolute = Math.abs(amount);
  const compact = (divisor, suffix) => {
    const scaled = amount / divisor;
    const precision = Math.abs(scaled) < 10 ? 1 : 0;
    return `${Number(scaled.toFixed(precision))}${suffix}`;
  };
  if (absolute >= 1_000_000) return compact(1_000_000, "м");
  if (absolute >= 1_000) return compact(1_000, "к");
  return String(amount);
}

function escapeHtml(value) {
  return foundry.utils.escapeHTML(cleanText(value));
}

function getOptionLabel(options, value, fallback = "") {
  const safeValue = cleanText(value);
  if (!safeValue) {
    return fallback;
  }

  return options.find((option) => option.value === safeValue)?.label ?? (fallback || safeValue);
}

function createSelectedOptions(options, selectedValue) {
  const safeSelectedValue = cleanText(selectedValue);
  return options.map((option) => ({
    ...option,
    selected: option.value === safeSelectedValue
  }));
}

function renderSelectOptions(options, selectedValue) {
  return createSelectedOptions(options, selectedValue).map((option) => {
    const selected = option.selected ? " selected" : "";
    const title = option.help ? ` title="${foundry.utils.escapeHTML(option.help)}"` : "";
    return `<option value="${foundry.utils.escapeHTML(option.value)}"${selected}${title}>${foundry.utils.escapeHTML(option.label)}</option>`;
  }).join("");
}

function getTargetOption(value, sourceType = "", actor = null) {
  const safeValue = cleanText(value);
  if (!safeValue) {
    return null;
  }

  const groups = cleanText(sourceType)
    ? getTargetOptionGroupsForSourceType(sourceType, actor)
    : DOWNTIME_TARGET_OPTION_GROUPS;
  for (const group of groups) {
    const option = group.options.find((entry) => entry.value === safeValue);
    if (option) {
      return option;
    }
  }
  return null;
}

function getTargetOptionLabel(value, sourceType = "", actor = null) {
  return getTargetOption(value, sourceType, actor)?.label ?? cleanText(value);
}

function renderGroupedSelectOptions(groups, selectedValue) {
  return groups.map((group) => {
    const label = foundry.utils.escapeHTML(group.label);
    return `<optgroup label="${label}">${renderSelectOptions(group.options, selectedValue)}</optgroup>`;
  }).join("");
}

function collectionValues(collection) {
  if (!collection) {
    return [];
  }
  if (Array.isArray(collection)) {
    return collection;
  }
  if (typeof collection.values === "function") {
    return Array.from(collection.values());
  }
  if (typeof collection === "object") {
    return Object.values(collection);
  }
  return [];
}

function getGameActorById(actorId) {
  const safeActorId = cleanText(actorId);
  if (!safeActorId) {
    return null;
  }
  return globalThis.game?.actors?.get?.(safeActorId)
    ?? collectionValues(globalThis.game?.actors).find((actor) => actor?.id === safeActorId)
    ?? null;
}

function getActivityType(activity) {
  return cleanText(activity?.type)
    || cleanText(activity?._source?.type)
    || cleanText(activity?.constructor?.metadata?.type)
    || cleanText(activity?.system?.type);
}

function getActivityName(activity) {
  return cleanText(activity?.name)
    || cleanText(activity?.label)
    || cleanText(activity?.title)
    || cleanText(activity?.type);
}

function getActivityId(activity) {
  return cleanText(activity?.id)
    || cleanText(activity?._id)
    || cleanText(activity?.key)
    || cleanText(activity?.uuid);
}

function isAttackActivity(activity, item = null) {
  const activityType = getActivityType(activity);
  const actionType = cleanText(activity?.actionType)
    || cleanText(activity?.system?.actionType)
    || cleanText(item?.system?.actionType);
  return activityType === "attack"
    || Boolean(activity?.attack || activity?.system?.attack)
    || ["mwak", "rwak", "fwak", "msak", "rsak"].includes(actionType);
}

function buildActorActivityOptions(actor, sourceType) {
  const options = [];
  for (const item of collectionValues(actor?.items)) {
    const itemId = cleanText(item?.id);
    const itemName = cleanText(item?.name) || itemId;
    const activities = collectionValues(item?.system?.activities);
    if (!activities.length) {
      const actionType = cleanText(item?.system?.actionType);
      const hasActivation = Boolean(cleanText(item?.system?.activation?.type));
      const attackLike = ["mwak", "rwak", "fwak", "msak", "rsak"].includes(actionType);
      if ((sourceType === "attack" && attackLike) || (sourceType === "sheetAction" && hasActivation && !attackLike)) {
        options.push({
          value: itemId,
          label: itemName,
          sourceType,
          help: itemName
        });
      }
      continue;
    }

    for (const activity of activities) {
      const activityId = getActivityId(activity);
      const attackLike = isAttackActivity(activity, item);
      if ((sourceType === "attack" && !attackLike) || (sourceType === "sheetAction" && attackLike)) {
        continue;
      }
      const activityName = getActivityName(activity);
      const value = itemId && activityId ? `${itemId}:${activityId}` : (activityId || itemId);
      if (!value) {
        continue;
      }
      options.push({
        value,
        label: activityName && activityName !== itemName ? `${itemName}: ${activityName}` : itemName,
        sourceType,
        help: itemName
      });
    }
  }
  return options;
}

function getTargetOptionGroupsForSourceType(sourceType, actor = null) {
  const safeSourceType = cleanText(sourceType) || "skill";
  if (safeSourceType === "sheetAction" || safeSourceType === "attack") {
    const actorOptions = buildActorActivityOptions(actor, safeSourceType);
    if (actorOptions.length) {
      return [{
        label: safeSourceType === "attack" ? "Атаки листа" : "Действия листа",
        options: actorOptions
      }];
    }
  }

  return DOWNTIME_TARGET_OPTION_GROUPS
    .map((group) => ({
      ...group,
      options: group.options.filter((option) => option.sourceType === safeSourceType)
    }))
    .filter((group) => group.options.length);
}

function getDefaultTargetOption(sourceType = "skill", actor = null) {
  return getTargetOptionGroupsForSourceType(sourceType, actor)[0]?.options?.[0] ?? null;
}

function readSelectedOptionLabel(root, fieldName, { sourceType = "", actor = null } = {}) {
  const field = root?.querySelector?.(`[data-field='${fieldName}']`);
  const selectedOption = field?.selectedOptions?.[0];
  return cleanText(selectedOption?.textContent ?? selectedOption?.label)
    || getTargetOptionLabel(field?.value, sourceType, actor)
    || cleanText(field?.value);
}

function readFieldValue(root, fieldName) {
  return cleanText(root?.querySelector(`[data-field='${fieldName}']`)?.value);
}

function buildNextTargetActionId(actions = []) {
  const usedIds = new Set(actions.map((action) => cleanText(action?.id)).filter(Boolean));
  for (let index = 1; index <= MAX_DOWNTIME_TARGET_CHOICES; index += 1) {
    const candidate = `check-${index}`;
    if (!usedIds.has(candidate)) {
      return candidate;
    }
  }
  return `check-${Date.now()}`;
}

function getSelectableDowntimeActionType(actionType = "") {
  const safeActionType = cleanText(actionType);
  return DOWNTIME_ACTION_TYPE_SELECT_OPTIONS.some((option) => option.value === safeActionType)
    ? safeActionType
    : "check";
}

function normalizeRankChoiceRows(action = {}) {
  const rankChoice = action.rankChoice && typeof action.rankChoice === "object" && !Array.isArray(action.rankChoice)
    ? action.rankChoice
    : {};
  const configuredRows = Array.isArray(rankChoice.rows) && rankChoice.rows.length
    ? rankChoice.rows
    : (Array.isArray(action.options) ? action.options : []);
  if (configuredRows.length) {
    return configuredRows.map((row, index) => {
      const rank = toInteger(row?.rank, index);
      return {
        ...row,
        id: cleanText(row?.id) || `rank-${rank}`,
        label: cleanText(row?.label) || `Ранг ${rank}`,
        rank,
        baseCost: row?.baseCost ?? "",
        unitCost: row?.unitCost ?? row?.stepCost ?? "",
        min: row?.min ?? "",
        max: row?.max ?? ""
      };
    });
  }

  const min = Math.max(0, toInteger(rankChoice.min, 0));
  const max = Math.min(10, toInteger(rankChoice.max, 10));
  return Array.from({ length: Math.max(0, max - min + 1) }, (_entry, index) => {
    const rank = min + index;
    return {
      id: `rank-${rank}`,
      label: `Ранг ${rank}`,
      rank,
      baseCost: "",
      unitCost: "",
      min: "",
      max: ""
    };
  });
}

function buildRankChoicePanel(action = {}) {
  const rankChoice = action.rankChoice && typeof action.rankChoice === "object" && !Array.isArray(action.rankChoice)
    ? action.rankChoice
    : {};
  const rows = normalizeRankChoiceRows(action);
  return `
    <div class="rm-downtime-rank-choice-panel" data-rank-choice-panel>
      <div class="rm-downtime-target-dialog__grid">
        <div class="rm-field">
          <label title="Минимальный доступный ранг.">Мин. ранг</label>
          <input type="number" min="0" max="10" step="1" value="${escapeHtml(rankChoice.min ?? 0)}" data-field="target-action-rank-min">
        </div>
        <div class="rm-field">
          <label title="Максимальный доступный ранг.">Макс. ранг</label>
          <input type="number" min="0" max="10" step="1" value="${escapeHtml(rankChoice.max ?? 10)}" data-field="target-action-rank-max">
        </div>
        <div class="rm-field">
          <label title="Ранг, выбранный по умолчанию.">По умолчанию</label>
          <input type="number" min="0" max="10" step="1" value="${escapeHtml(rankChoice.default ?? rankChoice.min ?? 0)}" data-field="target-action-rank-default">
        </div>
      </div>
      <div class="rm-downtime-rank-table" data-rank-choice-rows>
        ${rows.map((row) => `
          <div class="rm-downtime-rank-row" data-rank-choice-row>
            <input type="number" min="0" max="10" step="1" value="${escapeHtml(row.rank)}" data-field="target-rank-row-rank" aria-label="Ранг">
            <input type="text" value="${escapeHtml(row.label)}" data-field="target-rank-row-label" aria-label="Подпись ранга">
            <input type="number" min="0" step="1" value="${escapeHtml(row.baseCost)}" data-field="target-rank-row-base-cost" aria-label="База">
            <input type="number" min="0" step="1" value="${escapeHtml(row.unitCost)}" data-field="target-rank-row-unit-cost" aria-label="Цена единицы">
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function buildNumericInputPanel(action = {}) {
  const input = action.input && typeof action.input === "object" && !Array.isArray(action.input)
    ? action.input
    : {};
  const effect = action.effect && typeof action.effect === "object" && !Array.isArray(action.effect)
    ? action.effect
    : {};
  return `
    <div class="rm-downtime-numeric-input-panel" data-numeric-input-panel>
      <div class="rm-downtime-target-dialog__grid">
        <div class="rm-field">
          <label title="Минимальное значение.">Мин.</label>
          <input type="number" step="1" value="${escapeHtml(input.min ?? 0)}" data-field="target-action-numeric-min">
        </div>
        <div class="rm-field">
          <label title="Максимальное значение.">Макс.</label>
          <input type="number" step="1" value="${escapeHtml(input.max ?? "")}" data-field="target-action-numeric-max">
        </div>
        <div class="rm-field">
          <label title="Значение по умолчанию.">По умолчанию</label>
          <input type="number" step="1" value="${escapeHtml(input.default ?? 0)}" data-field="target-action-numeric-default">
        </div>
        <div class="rm-field">
          <label title="Шаг изменения числа.">Шаг</label>
          <input type="number" min="1" step="1" value="${escapeHtml(input.step ?? 1)}" data-field="target-action-numeric-step">
        </div>
        <div class="rm-field">
          <label title="Подпись единицы измерения.">Единица</label>
          <input type="text" value="${escapeHtml(input.unit ?? "")}" data-field="target-action-numeric-unit" placeholder="шаг.">
        </div>
        <div class="rm-field">
          <label title="Целевое действие, к которому применить эффект.">Куда бонус</label>
          <input type="text" value="${escapeHtml(effect.targetActionId ?? "")}" data-field="target-action-numeric-effect-target" placeholder="research-check">
        </div>
      </div>
    </div>
  `;
}

function normalizeDescriptionBlock(action = {}) {
  const block = action.descriptionBlock && typeof action.descriptionBlock === "object" && !Array.isArray(action.descriptionBlock)
    ? action.descriptionBlock
    : {};
  return {
    title: cleanText(block.title),
    description: cleanText(block.description)
  };
}

function buildDescriptionBlockPanel(action = {}) {
  const block = normalizeDescriptionBlock(action);
  return `
    <div class="rm-downtime-description-block-panel" data-description-block-panel>
      <div class="rm-field">
        <label title="Предзаполненное название. Игрок сможет изменить его в заявке.">Название</label>
        <input type="text" value="${escapeHtml(block.title)}" data-field="target-action-description-title" placeholder="Название проекта">
      </div>
      <div class="rm-field">
        <label title="Предзаполненное описание. Игрок сможет изменить его в заявке.">Описание</label>
        <textarea rows="5" data-field="target-action-description-text" placeholder="Что персонаж хочет сделать?">${escapeHtml(block.description)}</textarea>
      </div>
    </div>
  `;
}

function buildOptionChoicePanel(action = {}) {
  const options = Array.isArray(action.options) && action.options.length
    ? action.options
    : [{ id: "option-1", label: "Вариант 1" }];
  return `
    <div class="rm-downtime-option-choice-panel" data-option-choice-panel>
      <div class="rm-field">
        <label title="Можно выбрать один или несколько вариантов.">Режим выбора</label>
        <select data-field="target-action-option-selection-mode">
          ${renderSelectOptions([
            { value: "single", label: "один" },
            { value: "multiple", label: "несколько" }
          ], cleanText(action.selectionMode) || "single")}
        </select>
      </div>
      <div class="rm-downtime-option-choice-list" data-option-choice-rows>
        ${options.map((option, index) => `
          <div class="rm-downtime-option-choice-row" data-option-choice-row>
            <input type="text" value="${escapeHtml(cleanText(option.id) || `option-${index + 1}`)}" data-field="target-option-row-id" aria-label="ID варианта">
            <input type="text" value="${escapeHtml(cleanText(option.label) || `Вариант ${index + 1}`)}" data-field="target-option-row-label" aria-label="Подпись варианта">
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function buildResultExpressionPanel(action = {}, existingActions = []) {
  const terms = Array.isArray(action.resultFormula?.terms) && action.resultFormula.terms.length
    ? action.resultFormula.terms
    : [{ actionId: "", field: "total", operator: "+" }];
  const outputField = cleanText(action.resultFormula?.outputField) || cleanText(action.outputField) || "value";
  const previousActions = existingActions.filter((entry) => cleanText(entry?.id) && cleanText(entry?.id) !== cleanText(action.id));
  const sourceOptions = [
    { value: "", label: "выбрать" },
    ...previousActions.map((entry) => ({ value: cleanText(entry.id), label: cleanText(entry.label) || cleanText(entry.id) }))
  ];
  const fieldOptions = [
    { value: "total", label: "total" },
    { value: "success", label: "успех" },
    { value: "successes", label: "успехи" },
    { value: "value", label: "значение" },
    { value: "quantity", label: "количество" },
    { value: "computedTotal", label: "стоимость" },
    { value: "formulaResult", label: "результат формулы" },
    { value: "selectedValue", label: "значение выбора" }
  ];
  return `
    <div class="rm-downtime-result-expression-panel" data-result-expression-panel>
      <div class="rm-field">
        <label title="Имя единственного итогового значения, например successes, progressGold или priceGold.">Итоговое поле</label>
        <input type="text" value="${escapeHtml(outputField)}" data-field="target-result-formula-output-field" placeholder="successes">
      </div>
      <div class="rm-downtime-result-expression-list" data-result-expression-rows>
        ${terms.map((term) => `
          <div class="rm-downtime-result-expression-row" data-result-expression-row>
            <select data-field="target-result-term-action">${renderSelectOptions(sourceOptions, cleanText(term.actionId))}</select>
            <select data-field="target-result-term-field">${renderSelectOptions(fieldOptions, cleanText(term.field) || "total")}</select>
            <select data-field="target-result-term-operator">${renderSelectOptions([
              { value: "+", label: "+" },
              { value: "-", label: "-" }
            ], cleanText(term.operator) || "+")}</select>
            <input type="number" step="1" value="${escapeHtml(term.multiplier ?? 1)}" data-field="target-result-term-multiplier" aria-label="Множитель">
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function getResultMappingSourceActions(action = {}, existingActions = []) {
  const currentId = cleanText(action.id);
  return (Array.isArray(existingActions) ? existingActions : [])
    .filter((entry) => cleanText(entry?.id) && cleanText(entry?.id) !== currentId)
    .filter((entry) => ["check", "choice"].includes(cleanText(entry?.actionType) || "check"));
}

function getResultMappingSourceThresholds(sourceAction = {}) {
  const thresholds = Array.isArray(sourceAction?.thresholds) ? sourceAction.thresholds : [];
  if (thresholds.length) {
    return thresholds.map((threshold, index) => {
      const outcome = cleanText(threshold?.outcome) || cleanText(threshold?.id) || `threshold-${index + 1}`;
      return {
        value: outcome,
        label: cleanText(threshold?.label) || getOptionLabel(DOWNTIME_THRESHOLD_OUTCOME_OPTIONS, outcome, outcome)
      };
    });
  }
  return [
    { value: "failure", label: "Провал" },
    { value: "partial", label: "Частичный успех" },
    { value: "success", label: "Успех" },
    { value: "great-success", label: "Сильный успех" }
  ];
}

function normalizeResultMappingRows(action = {}, sourceAction = {}) {
  const configuredRows = Array.isArray(action.resultMapping?.rows) ? action.resultMapping.rows : [];
  if (configuredRows.length) {
    return configuredRows.map((row) => ({
      sourceOutcome: cleanText(row?.sourceOutcome) || cleanText(row?.match),
      value: row?.value ?? "",
      label: cleanText(row?.label),
      outcome: cleanText(row?.outcome)
    }));
  }

  return getResultMappingSourceThresholds(sourceAction).map((threshold) => ({
    sourceOutcome: threshold.value,
    value: "",
    label: "",
    outcome: ""
  }));
}

function buildResultMappingPanel(action = {}, existingActions = []) {
  const sourceActions = getResultMappingSourceActions(action, existingActions);
  const mapping = action.resultMapping && typeof action.resultMapping === "object" && !Array.isArray(action.resultMapping)
    ? action.resultMapping
    : {};
  const selectedSourceId = cleanText(mapping.sourceActionId) || cleanText(action.resultFormula?.terms?.[0]?.actionId) || cleanText(sourceActions[0]?.id);
  const sourceAction = sourceActions.find((entry) => cleanText(entry.id) === selectedSourceId) ?? sourceActions[0] ?? null;
  const sourceThresholdOptions = getResultMappingSourceThresholds(sourceAction);
  const sourceOptions = [
    { value: "", label: "Выбрать" },
    ...sourceActions.map((entry) => ({ value: cleanText(entry.id), label: cleanText(entry.label) || cleanText(entry.id) }))
  ];
  const rows = normalizeResultMappingRows(action, sourceAction);
  return `
    <div class="rm-downtime-result-mapping-panel" data-result-mapping-panel>
      <div class="rm-downtime-target-dialog__grid">
        <div class="rm-field">
          <label title="Целевое действие, чьи пороги нужно превратить в итог простоя.">Источник порогов</label>
          <select data-field="target-result-mapping-source">${renderSelectOptions(sourceOptions, selectedSourceId)}</select>
        </div>
        <div class="rm-field">
          <label title="Поле результата, которое будет передаваться. Для порогов это thresholdOutcome.">Поле</label>
          <select data-field="target-result-mapping-source-field">${renderSelectOptions([
            { value: "thresholdOutcome", label: "порог" },
            { value: "thresholdLabel", label: "подпись порога" },
            { value: "total", label: "total" },
            { value: "success", label: "успех" }
          ], cleanText(mapping.sourceField) || "thresholdOutcome")}</select>
        </div>
        <div class="rm-field">
          <label title="Имя итогового значения, например fragments.">Итоговое поле</label>
          <input type="text" value="${escapeHtml(cleanText(mapping.outputField) || "value")}" data-field="target-result-mapping-output-field" placeholder="fragments">
        </div>
      </div>
      <div class="rm-downtime-result-map-list" data-result-map-rows>
        ${rows.map((row) => `
          <div class="rm-downtime-result-map-row" data-result-map-row>
            <div class="rm-field">
              <label title="Какой порог пришёл из проверки.">Если</label>
              <select data-field="target-result-map-source">${renderSelectOptions(sourceThresholdOptions, row.sourceOutcome)}</select>
            </div>
            <div class="rm-field">
              <label title="Одно числовое значение результата.">Значение</label>
              <input type="number" step="1" value="${escapeHtml(row.value)}" data-field="target-result-map-value">
            </div>
            <div class="rm-field">
              <label title="Что увидят игрок и мастер.">Подпись</label>
              <input type="text" value="${escapeHtml(row.label)}" data-field="target-result-map-label" placeholder="2 фрагмента знаний">
            </div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function normalizeDowntimeTargetChoice(choice = {}, fallback = {}, actor = null) {
  const sourceType = cleanText(choice.sourceType)
    || cleanText(fallback.sourceType)
    || "skill";
  const requestedTarget = cleanText(choice.target) || cleanText(fallback.target);
  const targetOption = getTargetOption(requestedTarget, sourceType, actor) ?? getDefaultTargetOption(sourceType, actor);
  const target = targetOption?.value ?? requestedTarget;
  const ability = cleanText(choice.ability)
    || cleanText(fallback.ability)
    || targetOption?.ability
    || "";
  const targetLabel = cleanText(choice.targetLabel)
    || cleanText(choice.label)
    || getTargetOptionLabel(target, sourceType, actor);
  const rollMode = cleanText(choice.rollMode)
    || cleanText(fallback.rollMode)
    || "normal";

  return {
    sourceType,
    ability,
    target,
    targetLabel,
    rollMode,
    label: targetLabel
  };
}

function buildDowntimeTargetChoices(action = {}, actor = null) {
  const fallback = normalizeDowntimeTargetChoice({
    sourceType: action.sourceType,
    ability: action.ability,
    target: action.target,
    targetLabel: action.targetLabel,
    rollMode: action.rollMode
  }, {}, actor);
  const choices = Array.isArray(action.choices) && action.choices.length
    ? action.choices.map((choice) => normalizeDowntimeTargetChoice(choice, fallback, actor))
    : [fallback];

  return choices.slice(0, MAX_DOWNTIME_TARGET_CHOICES);
}

function buildDowntimeTargetChoiceSummary(choice = {}) {
  const sourceType = cleanText(choice.sourceType) || "skill";
  const targetLabel = cleanText(choice.targetLabel) || getTargetOptionLabel(choice.target, sourceType);
  if (sourceType === "skill" || sourceType === "tool") {
    const abilityLabel = getOptionLabel(DOWNTIME_ABILITY_OPTIONS, choice.ability, "Из листа");
    return [abilityLabel, targetLabel].filter(Boolean).join(" · ");
  }
  return targetLabel || getOptionLabel(DOWNTIME_SOURCE_TYPE_OPTIONS, sourceType, sourceType);
}

function buildDowntimeTargetChoiceFields(choice = {}, actor = null) {
  const safeChoice = normalizeDowntimeTargetChoice(choice, {}, actor);
  const targetGroups = getTargetOptionGroupsForSourceType(safeChoice.sourceType, actor);
  const targetLabel = safeChoice.sourceType === "skill"
    ? "Навык"
    : (safeChoice.sourceType === "tool"
      ? "Инструмент"
      : (safeChoice.sourceType === "attack"
        ? "Атака"
        : (safeChoice.sourceType === "sheetAction" ? "Действие" : "Цель")));

  if (safeChoice.sourceType === "ability") {
    return `
      <div class="rm-field">
        <label title="Характеристика из листа персонажа.">Характеристика</label>
        <select data-field="target-choice-target" data-target-choice-target="ability">${renderGroupedSelectOptions(targetGroups, safeChoice.target)}</select>
      </div>
    `;
  }

  if (safeChoice.sourceType === "skill" || safeChoice.sourceType === "tool") {
    return `
      <div class="rm-field">
        <label title="Характеристика броска. «Из листа» берёт системную характеристику выбранного пункта.">Характеристика</label>
        <select data-field="target-choice-ability">${renderSelectOptions(DOWNTIME_ABILITY_OPTIONS, safeChoice.ability)}</select>
      </div>
      <div class="rm-field">
        <label title="Конкретный ${safeChoice.sourceType === "skill" ? "навык" : "инструмент"} из доступного списка.">${targetLabel}</label>
        <select data-field="target-choice-target" data-target-choice-target="${foundry.utils.escapeHTML(safeChoice.sourceType)}">${renderGroupedSelectOptions(targetGroups, safeChoice.target)}</select>
      </div>
    `;
  }

  return `
    <div class="rm-field">
      <label title="Конкретный пункт из листа персонажа или системного списка.">${targetLabel}</label>
      <select data-field="target-choice-target" data-target-choice-target="${foundry.utils.escapeHTML(safeChoice.sourceType)}">${renderGroupedSelectOptions(targetGroups, safeChoice.target)}</select>
    </div>
  `;
}

function buildDowntimeTargetChoiceHeading(choiceCount = 1) {
  return choiceCount > 1 ? "Персонаж выбирает одно из" : "Персонаж должен";
}

function buildDowntimeTargetChoiceRow(choice = {}, index = 0, { visible = true, actor = null } = {}) {
  const safeChoice = normalizeDowntimeTargetChoice(choice, {}, actor);
  const hidden = visible ? "" : " hidden";
  const open = index === 0 ? " open" : "";
  const summary = foundry.utils.escapeHTML(buildDowntimeTargetChoiceSummary(safeChoice));

  return `
    <details class="rm-downtime-target-choice"${open}${hidden} data-target-choice data-choice-index="${index}">
      <summary class="rm-downtime-target-choice__summary" title="Нажмите, чтобы раскрыть настройки варианта.">
        <strong data-target-choice-summary>${summary}</strong>
        <span class="rm-downtime-target-choice__actions">
          <button type="button" class="rm-icon-button" data-action="target-choice-edit" title="Редактировать вариант" aria-label="Редактировать вариант">
            <i class="fa-solid fa-pen"></i>
          </button>
          <button type="button" class="rm-icon-button rm-icon-button--danger" data-action="target-choice-remove" title="Удалить вариант" aria-label="Удалить вариант">
            <i class="fa-solid fa-trash"></i>
          </button>
        </span>
      </summary>
      <div class="rm-downtime-target-choice__body">
        <div class="rm-field rm-downtime-target-choice__source">
          <label title="Откуда брать механику броска или действия.">Что бросать</label>
          <select data-field="target-choice-source-type">${renderSelectOptions(DOWNTIME_SOURCE_TYPE_OPTIONS, safeChoice.sourceType)}</select>
        </div>
        <div class="rm-downtime-target-choice__fields" data-target-choice-fields>
          ${buildDowntimeTargetChoiceFields(safeChoice, actor)}
        </div>
      </div>
    </details>
  `;
}

function normalizeDowntimeResources(action = {}) {
  const resources = action.resources && typeof action.resources === "object" && !Array.isArray(action.resources)
    ? action.resources
    : {};
  const cost = resources.cost && typeof resources.cost === "object" && !Array.isArray(resources.cost)
    ? resources.cost
    : {};
  return {
    narrative: cleanText(resources.narrative),
    cost: {
      amount: toInteger(cost.amount, 0),
      currency: cleanText(cost.currency) || "gp",
      payer: cleanText(cost.payer) || "character",
      timing: cleanText(cost.timing) || "onApproval"
    },
    purchases: Array.isArray(resources.purchases) ? resources.purchases.slice(0, MAX_DOWNTIME_RESOURCE_PURCHASES) : []
  };
}

function normalizeDowntimeResourcePurchase(purchase = {}) {
  const cost = purchase.cost && typeof purchase.cost === "object" && !Array.isArray(purchase.cost)
    ? purchase.cost
    : {};
  const effect = purchase.effect && typeof purchase.effect === "object" && !Array.isArray(purchase.effect)
    ? purchase.effect
    : {};
  return {
    label: cleanText(purchase.label),
    cost: {
      amount: toInteger(cost.amount, 0),
      currency: cleanText(cost.currency) || "gp"
    },
    effect: {
      type: cleanText(effect.type) || "bonus",
      value: cleanText(effect.value)
    },
    scope: cleanText(purchase.scope) || "next-check"
  };
}

function buildDowntimeResourcePurchaseRow(purchase = {}, index = 0, { visible = true } = {}) {
  const safePurchase = normalizeDowntimeResourcePurchase(purchase);
  const hidden = visible ? "" : " hidden";
  return `
    <div class="rm-downtime-resource-purchase" data-resource-purchase-row data-purchase-index="${index}"${hidden}>
      <div class="rm-field">
        <label title="Название покупки, которое увидит мастер и позже игрок.">Покупка</label>
        <input type="text" value="${foundry.utils.escapeHTML(safePurchase.label)}" data-field="target-action-purchase-label" placeholder="Нанять помощников">
      </div>
      <div class="rm-field">
        <label title="Сколько стоит эта опция.">Цена</label>
        <input type="number" min="0" step="1" value="${safePurchase.cost.amount || ""}" data-field="target-action-purchase-amount">
      </div>
      <div class="rm-field">
        <label title="Валюта или тип ресурса.">Валюта</label>
        <select data-field="target-action-purchase-currency">${renderSelectOptions(DOWNTIME_RESOURCE_CURRENCY_OPTIONS, safePurchase.cost.currency)}</select>
      </div>
      <div class="rm-field">
        <label title="Что даёт покупка.">Эффект</label>
        <select data-field="target-action-purchase-effect-type">${renderSelectOptions(DOWNTIME_PURCHASE_EFFECT_OPTIONS, safePurchase.effect.type)}</select>
      </div>
      <div class="rm-field">
        <label title="Число, ключ Foundry или формула: 2, @prof, 1d4. Для преимущества можно оставить пустым.">Значение</label>
        <input type="text" value="${foundry.utils.escapeHTML(safePurchase.effect.value)}" data-field="target-action-purchase-effect-value" placeholder="+2, @prof, 1d4">
      </div>
      <div class="rm-field">
        <label title="Куда применить покупку.">Куда</label>
        <select data-field="target-action-purchase-scope">${renderSelectOptions(DOWNTIME_PURCHASE_SCOPE_OPTIONS, safePurchase.scope)}</select>
      </div>
    </div>
  `;
}

function buildDowntimeResourcesPanel(action = {}) {
  const resources = normalizeDowntimeResources(action);
  const quantity = resources.quantity && typeof resources.quantity === "object" && !Array.isArray(resources.quantity)
    ? resources.quantity
    : {};
  const rankCosts = Array.isArray(resources.rankCosts) ? resources.rankCosts : [];
  const visiblePurchaseCount = resources.purchases.length;
  const purchaseRows = Array.from({ length: MAX_DOWNTIME_RESOURCE_PURCHASES }, (_entry, index) =>
    buildDowntimeResourcePurchaseRow(resources.purchases[index] ?? {}, index, { visible: index < visiblePurchaseCount }));
  return `
    <div class="rm-downtime-resources-panel" data-resource-panel>
      <div class="rm-downtime-target-dialog__grid">
        <div class="rm-field">
          <label title="Название ресурса или количества, которое оплачивает игрок.">Ресурс</label>
          <input type="text" value="${foundry.utils.escapeHTML(resources.resourceName ?? "")}" data-field="target-action-resource-name" placeholder="Шаг исследования">
        </div>
        <label class="rm-field rm-checkbox-field" title="Стоимость зависит от выбранного ранга.">
          <span>Зависит от ранга</span>
          <input type="checkbox" data-field="target-action-resource-depends-rank" ${resources.dependsOnRank ? "checked" : ""}>
        </label>
        <label class="rm-field rm-checkbox-field" title="Стоимость зависит от уровня персонажа.">
          <span>Зависит от уровня</span>
          <input type="checkbox" data-field="target-action-resource-depends-level" ${resources.dependsOnLevel ? "checked" : ""}>
        </label>
        <div class="rm-field">
          <label title="ID целевого действия выбора ранга.">Источник ранга</label>
          <input type="text" value="${foundry.utils.escapeHTML(resources.rankSourceActionId ?? "")}" data-field="target-action-resource-rank-source" placeholder="research-rank">
        </div>
      </div>
      <div class="rm-downtime-target-dialog__grid">
        <div class="rm-field">
          <label title="Минимальное количество ресурса.">Мин.</label>
          <input type="number" step="1" value="${foundry.utils.escapeHTML(quantity.min ?? 0)}" data-field="target-action-resource-quantity-min">
        </div>
        <div class="rm-field">
          <label title="Максимальное количество ресурса.">Макс.</label>
          <input type="number" step="1" value="${foundry.utils.escapeHTML(quantity.max ?? "")}" data-field="target-action-resource-quantity-max">
        </div>
        <div class="rm-field">
          <label title="Количество по умолчанию.">По умолчанию</label>
          <input type="number" step="1" value="${foundry.utils.escapeHTML(quantity.default ?? 0)}" data-field="target-action-resource-quantity-default">
        </div>
        <div class="rm-field">
          <label title="Единица ресурса.">Единица</label>
          <input type="text" value="${foundry.utils.escapeHTML(quantity.unit ?? "")}" data-field="target-action-resource-quantity-unit" placeholder="шаг.">
        </div>
      </div>
      <div class="rm-downtime-target-dialog__grid">
        <div class="rm-field">
          <label title="Базовая стоимость простоя. Позже она будет списываться через экономику группы или персонажа.">Стоимость</label>
          <input type="number" min="0" step="1" value="${resources.cost.amount || ""}" data-field="target-action-resource-amount">
        </div>
        <div class="rm-field">
          <label title="Валюта или тип ресурса для стоимости простоя.">Валюта</label>
          <select data-field="target-action-resource-currency">${renderSelectOptions(DOWNTIME_RESOURCE_CURRENCY_OPTIONS, resources.cost.currency)}</select>
        </div>
        <div class="rm-field">
          <label title="Из какого кошелька списывать стоимость.">Платит</label>
          <select data-field="target-action-resource-payer">${renderSelectOptions(DOWNTIME_RESOURCE_PAYER_OPTIONS, resources.cost.payer)}</select>
        </div>
        <div class="rm-field">
          <label title="Когда эта стоимость должна резервироваться или списываться.">Когда</label>
          <select data-field="target-action-resource-timing">${renderSelectOptions(DOWNTIME_RESOURCE_TIMING_OPTIONS, resources.cost.timing)}</select>
        </div>
      </div>
      <div class="rm-field">
        <label title="Нарративные требования: библиотека, мудрец, город, материалы, доступ.">Нарратив</label>
        <textarea rows="3" data-field="target-action-resource-narrative" placeholder="Что нужно для этого простоя">${foundry.utils.escapeHTML(resources.narrative)}</textarea>
      </div>
      <div class="rm-downtime-rank-table" data-resource-rank-costs>
        ${rankCosts.map((row) => `
          <div class="rm-downtime-rank-row" data-resource-rank-cost-row>
            <input type="number" min="0" max="10" step="1" value="${foundry.utils.escapeHTML(row.rank ?? "")}" data-field="target-resource-rank-cost-rank" aria-label="Ранг">
            <input type="number" min="0" step="1" value="${foundry.utils.escapeHTML(row.baseCost ?? "")}" data-field="target-resource-rank-cost-base" aria-label="База">
            <input type="number" min="0" step="1" value="${foundry.utils.escapeHTML(row.unitCost ?? row.stepCost ?? "")}" data-field="target-resource-rank-cost-unit" aria-label="Цена единицы">
            <input type="number" min="0" step="1" value="${foundry.utils.escapeHTML(row.max ?? "")}" data-field="target-resource-rank-cost-max" aria-label="Лимит">
          </div>
        `).join("")}
      </div>
      <div class="rm-downtime-resource-purchases">
        <header>
          <h4>Опционально докупить</h4>
        </header>
        ${purchaseRows.join("")}
        <button type="button" class="rm-button rm-downtime-add-alternative" data-action="target-action-add-purchase" title="Добавить ещё одну покупку." ${visiblePurchaseCount >= MAX_DOWNTIME_RESOURCE_PURCHASES ? "disabled" : ""}>+ Покупка</button>
      </div>
    </div>
  `;
}

function readDowntimeResourcePurchase(row) {
  const purchase = {
    label: readFieldValue(row, "target-action-purchase-label"),
    cost: {
      amount: toInteger(readFieldValue(row, "target-action-purchase-amount"), 0),
      currency: readFieldValue(row, "target-action-purchase-currency") || "gp"
    },
    effect: {
      type: readFieldValue(row, "target-action-purchase-effect-type") || "bonus",
      value: readFieldValue(row, "target-action-purchase-effect-value")
    },
    scope: readFieldValue(row, "target-action-purchase-scope") || "next-check"
  };
  return purchase;
}

function readDowntimeResources(root) {
  const purchases = Array.from(root?.querySelectorAll?.("[data-resource-purchase-row]:not([hidden])") ?? [])
    .map((row) => readDowntimeResourcePurchase(row))
    .filter((purchase) => purchase.label || purchase.cost.amount > 0 || purchase.effect.value || purchase.effect.type === "advantage");
  const quantity = {
    min: toInteger(readFieldValue(root, "target-action-resource-quantity-min"), 0),
    default: toInteger(readFieldValue(root, "target-action-resource-quantity-default"), 0),
    unit: readFieldValue(root, "target-action-resource-quantity-unit")
  };
  const quantityMax = readFieldValue(root, "target-action-resource-quantity-max");
  if (quantityMax !== "") {
    quantity.max = toInteger(quantityMax, quantity.min);
  }
  const rankCosts = Array.from(root?.querySelectorAll?.("[data-resource-rank-cost-row]") ?? [])
    .map((row) => {
      const rank = toInteger(readFieldValue(row, "target-resource-rank-cost-rank"), -1);
      return {
        rank,
        baseCost: toInteger(readFieldValue(row, "target-resource-rank-cost-base"), 0),
        unitCost: toInteger(readFieldValue(row, "target-resource-rank-cost-unit"), 0),
        max: toInteger(readFieldValue(row, "target-resource-rank-cost-max"), 0)
      };
    })
    .filter((row) => row.rank >= 0);
  const resourceName = readFieldValue(root, "target-action-resource-name");
  const dependsOnRank = Boolean(root?.querySelector?.("[data-field='target-action-resource-depends-rank']")?.checked);
  const dependsOnLevel = Boolean(root?.querySelector?.("[data-field='target-action-resource-depends-level']")?.checked);
  const rankSourceActionId = readFieldValue(root, "target-action-resource-rank-source");
  const resources = {
    narrative: readFieldValue(root, "target-action-resource-narrative"),
    cost: {
      amount: toInteger(readFieldValue(root, "target-action-resource-amount"), 0),
      currency: readFieldValue(root, "target-action-resource-currency") || "gp",
      payer: readFieldValue(root, "target-action-resource-payer") || "character",
      timing: readFieldValue(root, "target-action-resource-timing") || "onApproval"
    },
    purchases
  };
  if (resourceName) {
    resources.resourceName = resourceName;
  }
  if (dependsOnRank) {
    resources.dependsOnRank = true;
  }
  if (dependsOnLevel) {
    resources.dependsOnLevel = true;
  }
  if (rankSourceActionId) {
    resources.rankSourceActionId = rankSourceActionId;
  }
  if (quantity.max !== undefined || quantity.min > 0 || quantity.default > 0 || quantity.unit) {
    resources.quantity = quantity;
  }
  if (rankCosts.length) {
    resources.rankCosts = rankCosts;
  }
  return resources;
}

function normalizeDowntimeThreshold(threshold = {}, index = 0) {
  const defaults = [
    { from: 0, to: 9, outcome: "failure" },
    { from: 10, to: 20, outcome: "partial" },
    { from: 21, to: "", outcome: "success" }
  ];
  const fallback = defaults[index] ?? { from: "", to: "", outcome: "gm" };
  return {
    from: cleanText(threshold.from) || cleanText(fallback.from),
    to: cleanText(threshold.to) || cleanText(fallback.to),
    label: cleanText(threshold.label),
    outcome: cleanText(threshold.outcome) || fallback.outcome
  };
}

function buildDowntimeThresholdRow(threshold = {}, index = 0) {
  const safeThreshold = normalizeDowntimeThreshold(threshold, index);
  return `
    <div class="rm-downtime-threshold-row" data-threshold-row>
      <div class="rm-field">
        <label title="Нижняя граница общего итога простоя.">От</label>
        <input type="number" step="1" value="${foundry.utils.escapeHTML(safeThreshold.from)}" data-field="target-threshold-from">
      </div>
      <div class="rm-field">
        <label title="Верхняя граница. Пусто означает значение и выше.">До</label>
        <input type="number" step="1" value="${foundry.utils.escapeHTML(safeThreshold.to)}" data-field="target-threshold-to">
      </div>
      <div class="rm-field">
        <label title="Какой итог применить при попадании в этот диапазон.">Итог</label>
        <select data-field="target-threshold-outcome">${renderSelectOptions(DOWNTIME_THRESHOLD_OUTCOME_OPTIONS, safeThreshold.outcome)}</select>
      </div>
      <div class="rm-field">
        <label title="Что увидят игрок и мастер в результате.">Подпись</label>
        <input type="text" value="${foundry.utils.escapeHTML(safeThreshold.label)}" data-field="target-threshold-label" placeholder="Ставка + 50%">
      </div>
      <button type="button" class="rm-icon-button rm-icon-button--danger" data-action="target-threshold-remove" title="Убрать порог" aria-label="Убрать порог">
        <i class="fa-solid fa-minus"></i>
      </button>
    </div>
  `;
}

function buildDowntimeThresholdRows(thresholds = []) {
  const safeThresholds = Array.isArray(thresholds) ? thresholds.slice(0, MAX_DOWNTIME_THRESHOLDS) : [];
  const rows = safeThresholds.length ? safeThresholds : [{}, {}, {}];
  return `
    <div data-threshold-rows>
      ${rows.map((threshold, index) => buildDowntimeThresholdRow(threshold, index)).join("")}
    </div>
    <button type="button" class="rm-button rm-downtime-add-alternative" data-action="target-threshold-add" ${rows.length >= MAX_DOWNTIME_THRESHOLDS ? "disabled" : ""}>+ Порог</button>
  `;
}

function readDowntimeThreshold(row) {
  return {
    from: readFieldValue(row, "target-threshold-from"),
    to: readFieldValue(row, "target-threshold-to"),
    label: readFieldValue(row, "target-threshold-label"),
    outcome: readFieldValue(row, "target-threshold-outcome") || "gm"
  };
}

function readRankChoice(root) {
  const rows = Array.from(root?.querySelectorAll?.("[data-rank-choice-row]") ?? [])
    .map((row, index) => {
      const rank = toInteger(readFieldValue(row, "target-rank-row-rank"), index);
      return {
        id: `rank-${rank}`,
        rank,
        label: readFieldValue(row, "target-rank-row-label") || `Ранг ${rank}`,
        baseCost: toInteger(readFieldValue(row, "target-rank-row-base-cost"), 0),
        unitCost: toInteger(readFieldValue(row, "target-rank-row-unit-cost"), 0)
      };
    });
  return {
    min: toInteger(readFieldValue(root, "target-action-rank-min"), 0),
    max: toInteger(readFieldValue(root, "target-action-rank-max"), 10),
    default: toInteger(readFieldValue(root, "target-action-rank-default"), 0),
    rows
  };
}

function readNumericInput(root) {
  const input = {
    min: toInteger(readFieldValue(root, "target-action-numeric-min"), 0),
    step: Math.max(1, toInteger(readFieldValue(root, "target-action-numeric-step"), 1)),
    default: toInteger(readFieldValue(root, "target-action-numeric-default"), 0),
    unit: readFieldValue(root, "target-action-numeric-unit")
  };
  const max = readFieldValue(root, "target-action-numeric-max");
  if (max !== "") {
    input.max = toInteger(max, input.min);
  }
  return input;
}

function readDescriptionBlock(root) {
  return {
    title: readFieldValue(root, "target-action-description-title"),
    description: readFieldValue(root, "target-action-description-text")
  };
}

function readOptionChoiceOptions(root) {
  return Array.from(root?.querySelectorAll?.("[data-option-choice-row]") ?? [])
    .map((row, index) => ({
      id: readFieldValue(row, "target-option-row-id") || `option-${index + 1}`,
      label: readFieldValue(row, "target-option-row-label") || `Вариант ${index + 1}`
    }))
    .filter((option) => option.id && option.label);
}

function readResultFormula(root) {
  const terms = Array.from(root?.querySelectorAll?.("[data-result-expression-row]") ?? [])
    .map((row) => ({
      actionId: readFieldValue(row, "target-result-term-action"),
      field: readFieldValue(row, "target-result-term-field") || "total",
      operator: readFieldValue(row, "target-result-term-operator") || "+",
      multiplier: toInteger(readFieldValue(row, "target-result-term-multiplier"), 1)
    }))
    .filter((term) => term.actionId || term.field);
  return {
    outputField: readFieldValue(root, "target-result-formula-output-field") || "value",
    terms
  };
}

function readResultMapping(root) {
  const sourceActionId = readFieldValue(root, "target-result-mapping-source");
  const sourceField = readFieldValue(root, "target-result-mapping-source-field") || "thresholdOutcome";
  const outputField = readFieldValue(root, "target-result-mapping-output-field") || "value";
  const rows = Array.from(root?.querySelectorAll?.("[data-result-map-row]") ?? [])
    .map((row) => ({
      sourceOutcome: readFieldValue(row, "target-result-map-source"),
      value: toInteger(readFieldValue(row, "target-result-map-value"), 0),
      label: readFieldValue(row, "target-result-map-label")
    }))
    .filter((row) => row.sourceOutcome || row.label || row.value !== 0);
  return {
    sourceActionId,
    sourceField,
    outputField,
    rows
  };
}

function readDowntimeTargetChoice(row, actor = null) {
  const sourceType = readFieldValue(row, "target-choice-source-type") || "skill";
  const defaultTarget = getDefaultTargetOption(sourceType, actor);
  const target = readFieldValue(row, "target-choice-target") || defaultTarget?.value || "prc";
  const targetOption = getTargetOption(target, sourceType, actor) ?? defaultTarget;
  const targetLabel = readSelectedOptionLabel(row, "target-choice-target", { sourceType, actor }) || targetOption?.label || target;
  let ability = readFieldValue(row, "target-choice-ability") || targetOption?.ability || "";
  if (sourceType === "ability") {
    ability = target;
  }
  else if (sourceType === "save") {
    ability = targetOption?.ability || (target.startsWith("save-") ? target.slice(5) : target);
  }
  const rollMode = "normal";

  return {
    sourceType,
    ability,
    target,
    targetLabel,
    rollMode,
    label: targetLabel
  };
}

function isKnownGroupContextError(error) {
  return KNOWN_GROUP_CONTEXT_ERROR_MESSAGES.has(error?.message);
}

function normalizeTravelCitySearchText(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/ё/gu, "е")
    .replace(/[\u2019\u2018\u02bc\u02b9\u2032`´"]/gu, "'")
    .replace(/\s+/gu, " ");
}

function setTravelCityOptionVisible(option, visible) {
  option.hidden = !visible;
  if (option.style) {
    option.style.display = visible ? "" : "none";
  }
}

function setTravelCityOptionActive(option, active) {
  option.dataset.active = active ? "true" : "";
  const className = String(option.className ?? "").replace(/\bis-active\b/gu, "").trim();
  option.className = active ? `${className} is-active`.trim() : className;
}

function getTravelCityOptions(resultRoot, role) {
  return Array.from(resultRoot?.querySelectorAll?.(`[data-action='travel-city-option'][data-role='${role}']`) ?? []);
}

function getVisibleTravelCityOptions(resultRoot, role) {
  return getTravelCityOptions(resultRoot, role).filter((option) => option.hidden !== true);
}

function formatTravelNumber(value) {
  return formatNumber(value, 2);
}

function formatTravelDayNumber(value) {
  return formatNumber(value, 0);
}

function resolveTravelDays(days, hours) {
  const numericDays = Number(days);
  if (Number.isFinite(numericDays)) {
    return roundNumber(numericDays, 2);
  }

  return roundNumber(toNumber(hours, 0) / TRAVEL_DAY_HOURS, 2);
}

function formatTravelDuration(days, hours) {
  const safeHours = roundNumber(toNumber(hours, 0), 2);
  return `${formatTravelDayNumber(resolveTravelDays(days, safeHours))} дн. (${formatTravelNumber(safeHours)} ч.)`;
}

function prepareTravelContext(snapshot = {}, trackTime = false) {
  const source = snapshot && typeof snapshot === "object" ? snapshot : buildEmptyTravelContext();
  const plan = source.plan && typeof source.plan === "object"
    ? {
        ...source.plan,
        totalTravelDays: resolveTravelDays(source.plan.totalTravelDays, source.plan.totalHours)
      }
    : source.plan;
  const progress = source.progress && typeof source.progress === "object"
    ? {
        ...source.progress,
        traveledTravelDays: resolveTravelDays(source.progress.traveledTravelDays, source.progress.traveledHours),
        remainingTravelDays: resolveTravelDays(source.progress.remainingTravelDays, source.progress.remainingHours)
      }
    : {
        traveledMiles: 0,
        remainingMiles: 0,
        percent: 0,
        traveledHours: 0,
        remainingHours: 0,
        traveledTravelDays: 0,
        remainingTravelDays: 0,
        label: "Маршрут не выбран",
        completed: false
      };
  const routeAvailable = Boolean(
    plan?.available
    && cleanText(plan.originName)
    && cleanText(plan.destinationName)
  );
  const headerRoute = routeAvailable
    ? {
        available: true,
        routeLabel: `${cleanText(plan.originName)} → ${cleanText(plan.destinationName)}`,
        remainingDaysLabel: `${formatTravelDayNumber(progress.remainingTravelDays)} дн.`
      }
    : {
        available: false,
        routeLabel: "Маршрут не выбран",
        remainingDaysLabel: "—"
      };

  return {
    ...source,
    plan,
    progress,
    headerRoute,
    canRewind: Boolean(source.canRewind),
    trackTime: Boolean(trackTime)
  };
}

function buildEmptyTransportContext({ warning = "" } = {}) {
  return {
    available: !warning,
    warning,
    canManage: false,
    vehicles: [],
    hasVehicles: false,
    activeTransportId: "",
    activeVehicle: null,
    fuel: {
      configured: false,
      selector: {},
      card: null,
      quantity: 0,
      consumptionPerMile: 0,
      unit: "",
      miles: 0,
      isEmpty: false,
      stacks: [],
      reason: "noTransport",
      valueLabel: "—",
      note: "Транспорт не выбран"
    },
    effectiveSpeedMph: 3,
    speedLabel: "3 мили/час",
    speedSourceLabel: "Пешком",
    cargoLabel: "-",
    cargoUsageLabel: "-",
    cargoFreeLabel: "-",
    cargoOverloaded: false,
    durabilityLabel: "-"
  };
}

const TRANSPORT_CONDITION_OPTIONS = Object.freeze([
  { value: "operational", label: "Исправен" },
  { value: "damaged", label: "Повреждён" },
  { value: "broken", label: "Сломан" }
]);

function prepareTransportFuelContext(sourceFuel = {}, { canManage = false, vehicle = null } = {}) {
  const configured = sourceFuel?.configured === true;
  const fuelReason = cleanText(sourceFuel?.reason) || (vehicle ? "unconfigured" : "noTransport");
  const miles = Math.max(0, Math.floor(toNumber(sourceFuel?.miles, 0)));
  const unit = cleanText(sourceFuel?.unit);
  return {
    ...sourceFuel,
    configured,
    selector: sourceFuel?.selector && typeof sourceFuel.selector === "object" ? sourceFuel.selector : {},
    card: sourceFuel?.card && typeof sourceFuel.card === "object" ? sourceFuel.card : null,
    quantity: Math.max(0, toNumber(sourceFuel?.quantity, 0)),
    consumptionPerMile: Math.max(0, toNumber(sourceFuel?.consumptionPerMile, 0)),
    unit,
    unitLabel: unit === "lb" ? "фнт." : unit === "gal" ? "гал." : "ед.",
    consumptionForm: {
      canEdit: Boolean(canManage && vehicle?.isConcreteInstance && configured),
      amount: String(Math.max(0, toNumber(sourceFuel?.consumptionPerMile, 0))),
      unitOptions: [
        { value: "lb", label: "фунты", selected: unit === "lb" },
        { value: "gal", label: "галлоны", selected: unit === "gal" }
      ]
    },
    miles,
    isEmpty: configured && sourceFuel?.isEmpty === true,
    stacks: Array.isArray(sourceFuel?.stacks) ? sourceFuel.stacks : [],
    reason: configured ? "" : fuelReason,
    emptyLabel: "Добавьте топливо",
    valueLabel: configured ? `${miles} миль` : "—",
    note: configured
      ? (cleanText(sourceFuel?.card?.name) || cleanText(sourceFuel?.selector?.name) || "Топливо")
      : (fuelReason === "noTransport" ? "Транспорт не выбран" : "Топливо не выбрано")
  };
}

function prepareTransportVehicleContext(vehicle = {}, { canManage = false } = {}) {
  const condition = cleanText(vehicle.condition) || "operational";
  return {
    ...vehicle,
    canOpen: Boolean(vehicle.actorId || vehicle.actorUuid),
    fuel: prepareTransportFuelContext(vehicle.fuel, { canManage, vehicle }),
    stateForm: {
      canEdit: Boolean(canManage && vehicle.isActorBacked && vehicle.canEditState !== false),
      hpCurrent: String(Number.isFinite(Number(vehicle.hpValue)) ? Number(vehicle.hpValue) : 0),
      conditionOptions: TRANSPORT_CONDITION_OPTIONS.map((option) => ({
        ...option,
        selected: option.value === condition
      }))
    }
  };
}

function prepareTransportContext(snapshot = {}) {
  const source = snapshot && typeof snapshot === "object" ? snapshot : buildEmptyTransportContext();
  const canManage = Boolean(source.canManage);
  const activeSource = source.activeVehicle && typeof source.activeVehicle === "object"
    ? source.activeVehicle
    : null;
  const vehicles = (Array.isArray(source.vehicles) ? source.vehicles : []).map((vehicle) => {
    const merged = activeSource?.id && activeSource.id === vehicle?.id
      ? {
          ...vehicle,
          ...activeSource,
          fuel: vehicle?.fuel ?? source.fuel
        }
      : vehicle;
    return prepareTransportVehicleContext(merged, { canManage });
  });
  const activeVehicle = vehicles.find((vehicle) => vehicle.active)
    ?? (activeSource ? prepareTransportVehicleContext({ ...activeSource, fuel: source.fuel }, { canManage }) : null);
  const sourceFuel = source.fuel && typeof source.fuel === "object"
    ? source.fuel
    : {};
  const fuel = prepareTransportFuelContext(sourceFuel, { canManage, vehicle: activeVehicle });
  return {
    ...buildEmptyTransportContext(),
    ...source,
    vehicles,
    hasVehicles: Boolean(source.hasVehicles ?? vehicles.length > 0),
    canManage,
    activeVehicle,
    fuel,
    cargoOverloaded: Boolean(source.cargoOverloaded)
  };
}

function buildTransportDialogSpecs(vehicle = {}) {
  const specs = [
    ["Скорость", vehicle.speedLabel || "—"],
    ["Грузоподъёмность", vehicle.cargoLabel || "—"],
    ["КД", vehicle.acLabel || "—"],
    ["Экипаж", vehicle.crewLabel || "—"],
    ["Пассажиры", vehicle.passengersLabel || "—"],
    ["Разгон", vehicle.accelerationFt ? `${vehicle.accelerationFt} фт.` : "—"],
    ["Поломка, к20", vehicle.breakdownThreshold || "—"]
  ];
  return specs.map(([label, value]) => `
    <p><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></p>
  `).join("");
}

function buildTransportDialogContent(vehicle = {}, { canManage = false } = {}) {
  const disabled = canManage ? "" : " disabled";
  const fuelConfigured = vehicle.fuel?.configured === true;
  const fuelDisabled = canManage && fuelConfigured ? "" : " disabled";
  const fuelName = cleanText(vehicle.fuel?.card?.name) || "Топливо не назначено";
  const hpMax = Math.max(0, Number(vehicle.hpMax) || 0);
  const hpMaxAttribute = hpMax > 0 ? ` max="${hpMax}"` : "";
  const conditionOptions = TRANSPORT_CONDITION_OPTIONS.map((option) => `
    <option value="${option.value}" ${option.value === vehicle.condition ? "selected" : ""}>${escapeHtml(option.label)}</option>
  `).join("");
  const consumptionUnit = cleanText(vehicle.fuel?.unit);
  return `
    <form class="rm-transport-dialog" data-transport-dialog-form>
      <label class="rm-transport-dialog__active">
        <input type="checkbox" name="active" ${vehicle.active ? "checked" : ""}${disabled}>
        <span>Активный транспорт</span>
      </label>
      <div class="rm-transport-dialog__fields">
        <label>
          <span>Хиты</span>
          <input type="number" name="hpCurrent" min="0"${hpMaxAttribute} value="${Number(vehicle.hpValue) || 0}"${disabled}>
        </label>
        <label>
          <span>Состояние</span>
          <select name="condition"${disabled}>${conditionOptions}</select>
        </label>
        <label>
          <span>Расход</span>
          <input type="number" name="fuelConsumptionAmount" min="0.000001" step="any" value="${Number(vehicle.fuel?.consumptionPerMile) || 0}"${fuelDisabled}>
        </label>
        <label>
          <span>Единица</span>
          <select name="fuelConsumptionUnit"${fuelDisabled}>
            <option value="lb" ${consumptionUnit === "lb" ? "selected" : ""}>фунты</option>
            <option value="gal" ${consumptionUnit === "gal" ? "selected" : ""}>галлоны</option>
          </select>
        </label>
      </div>
      <p class="rm-transport-dialog__fuel"><span>Топливо</span><strong>${escapeHtml(fuelName)}</strong></p>
      <div class="rm-transport-dialog__specs">${buildTransportDialogSpecs(vehicle)}</div>
      ${canManage ? `
        <footer>
          <button type="button" class="rm-button rm-button--primary" data-action="transport-dialog-save">Сохранить</button>
        </footer>
      ` : ""}
    </form>
  `;
}

function applyTravelProgressSnapshot(element, snapshot = {}) {
  if (!element || !snapshot?.progress || !snapshot?.plan?.available) {
    return false;
  }

  const progress = snapshot.progress;
  const percent = Math.max(0, Math.min(100, roundNumber(toNumber(progress.percent, 0), 2)));
  const percentStyle = `${percent}%`;
  const progressRoot = element.querySelector("[data-travel-progress]");
  const progressBar = element.querySelector("[data-travel-progress-bar]");
  const progressToken = element.querySelector("[data-travel-progress-token]");
  const progressLabel = element.querySelector("[data-travel-progress-label]");
  const remainingMiles = element.querySelector("[data-travel-remaining-miles]");
  const remainingTime = element.querySelector("[data-travel-remaining-time]");
  const safeLabel = cleanText(progress.label);
  const remainingTimeLabel = formatTravelDuration(progress.remainingTravelDays, progress.remainingHours);

  progressRoot?.setAttribute?.("aria-label", safeLabel);
  if (progressBar?.style) {
    progressBar.style.width = percentStyle;
  }
  if (progressToken?.style) {
    progressToken.style.left = percentStyle;
  }
  if (remainingMiles) {
    remainingMiles.textContent = `${formatTravelNumber(progress.remainingMiles)} миль`;
  }
  if (remainingTime) {
    remainingTime.textContent = remainingTimeLabel;
  }
  if (progressLabel) {
    progressLabel.textContent = `${safeLabel} • осталось ${remainingTimeLabel}`;
  }

  element.querySelectorAll("[data-action='travel-advance']").forEach((button) => {
    const hours = toNumber(button.dataset?.hours, 0);
    button.disabled = hours < 0 ? !snapshot.canRewind : !snapshot.canAdvance;
  });
  return true;
}

function bindTravelCityAutocomplete(element, role, onSelectRoute, listenerOptions) {
  const queryInput = element.querySelector(`[data-action='travel-${role}-query']`);
  const valueInput = element.querySelector(`[data-action='travel-${role}']`);
  const resultRoot = element.querySelector(`[data-travel-city-results='${role}']`);
  if (!queryInput || !valueInput || !resultRoot) {
    return;
  }

  let activeIndex = -1;

  const updateActiveOption = () => {
    const visibleOptions = getVisibleTravelCityOptions(resultRoot, role);
    visibleOptions.forEach((option, index) => {
      setTravelCityOptionActive(option, index === activeIndex);
    });
  };

  const renderResults = () => {
    const safeQuery = normalizeTravelCitySearchText(queryInput.value);
    let visibleCount = 0;
    for (const option of getTravelCityOptions(resultRoot, role)) {
      const haystack = normalizeTravelCitySearchText(option.dataset?.search || option.textContent || option.dataset?.cityLabel || "");
      const visible = Boolean(safeQuery && haystack.includes(safeQuery) && visibleCount < TRAVEL_CITY_PREVIEW_LIMIT);
      setTravelCityOptionVisible(option, visible);
      if (visible) {
        visibleCount += 1;
      }
    }

    resultRoot.hidden = visibleCount === 0;
    activeIndex = visibleCount > 0 ? 0 : -1;
    updateActiveOption();
  };

  const selectOption = async (option) => {
    if (!option) {
      return;
    }

    const cityId = cleanText(option.dataset?.cityId);
    const cityLabel = cleanText(option.dataset?.cityLabel || option.textContent);
    if (!cityId) {
      return;
    }

    valueInput.value = cityId;
    queryInput.value = cityLabel;
    resultRoot.hidden = true;
    for (const entry of getTravelCityOptions(resultRoot, role)) {
      setTravelCityOptionVisible(entry, false);
      setTravelCityOptionActive(entry, false);
    }
    await onSelectRoute?.();
  };

  queryInput.addEventListener("input", () => {
    valueInput.value = "";
    renderResults();
  }, listenerOptions);

  queryInput.addEventListener("focus", renderResults, listenerOptions);

  queryInput.addEventListener("keydown", async (event) => {
    const visibleOptions = getVisibleTravelCityOptions(resultRoot, role);
    if (event.key === "ArrowDown") {
      event.preventDefault?.();
      activeIndex = visibleOptions.length ? Math.min(visibleOptions.length - 1, activeIndex + 1) : -1;
      updateActiveOption();
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault?.();
      activeIndex = visibleOptions.length ? Math.max(0, activeIndex - 1) : -1;
      updateActiveOption();
      return;
    }

    if (event.key === "Escape") {
      resultRoot.hidden = true;
      return;
    }

    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault?.();
    const exactQuery = normalizeTravelCitySearchText(queryInput.value);
    const exactOption = visibleOptions.find((option) => normalizeTravelCitySearchText(option.dataset?.cityLabel || option.textContent) === exactQuery) ?? null;
    await selectOption(exactOption ?? visibleOptions[Math.max(0, activeIndex)] ?? visibleOptions[0] ?? null);
  }, listenerOptions);

  for (const option of getTravelCityOptions(resultRoot, role)) {
    option.addEventListener("pointerdown", (event) => {
      event.preventDefault?.();
    }, listenerOptions);
    option.addEventListener("click", async () => {
      await selectOption(option);
    }, listenerOptions);
    setTravelCityOptionVisible(option, false);
  }

  resultRoot.hidden = true;
}

function buildEmptyTravelContext({ warning = "" } = {}) {
  const safeWarning = cleanText(warning);
  return {
    available: !safeWarning,
    warning: safeWarning,
    canAdvance: false,
    canRewind: false,
    canSelectRoute: false,
    mode: "land",
    originCityId: "",
    originCityName: "",
    destinationCityId: "",
    destinationCityName: "",
    cityOptions: [],
    modeOptions: [
      { value: "land", label: "Земля", selected: true, disabled: false },
      { value: "rail", label: "ЖД", selected: false, disabled: true, disabledReason: "ЖД будет подключена следующим этапом." },
      { value: "water", label: "Море", selected: false, disabled: true, disabledReason: "Море будет подключено следующим этапом." }
    ],
    plan: null,
    progress: {
      traveledMiles: 0,
      remainingMiles: 0,
      percent: 0,
      traveledHours: 0,
      remainingHours: 0,
      traveledTravelDays: 0,
      remainingTravelDays: 0,
      label: "Маршрут не выбран",
      completed: false
    },
    emptyMessage: safeWarning || "Выберите города и способ пути.",
    speedMph: 3,
    speedLabel: "3 мили/час"
  };
}

function buildEmptyDowntimeContext({ warning = "", grantWeeks = 1, grantActorId = "all", requestActorId = "", requestActionId = "", requestWeeks = 1, requestTitle = "", requestDescription = "" } = {}) {
  const safeWarning = cleanText(warning);
  return {
    members: [],
    requests: [],
    archiveRequests: [],
    visibleRequests: [],
    selectedRequest: null,
    showArchive: false,
    visiblePage: paginateDowntimeRequests([]),
    visibleRequestCount: 0,
    requestPage: paginateDowntimeRequests([]),
    archivePage: paginateDowntimeRequests([]),
    requestCount: 0,
    archiveCount: 0,
    actionOptions: [],
    grantActorOptions: [{
      value: "all",
      label: "Всем участникам",
      selected: true
    }],
    requestActorOptions: [],
    canManage: false,
    canSubmit: false,
    warning: safeWarning,
    grantWeeks,
    grantActorId,
    requestActorId,
    requestActionId,
    requestWeeks,
    requestTitle,
    requestDescription,
    grantDisabled: true,
    grantDisabledReason: safeWarning || "Нет участников для выдачи простоя.",
    submitDisabled: true,
    submitDisabledReason: safeWarning || "Нет доступных персонажей для заявки.",
    emptyMembers: true,
    emptyRequests: true,
    emptyArchiveRequests: true,
    emptyVisibleRequests: true
  };
}

function buildCalendarDowntimeCells(calendarSnapshot = {}, downtimeSnapshot = {}) {
  const snapshot = downtimeSnapshot && typeof downtimeSnapshot === "object" ? downtimeSnapshot : {};
  const calendarByIsoDate = snapshot.calendarByIsoDate && typeof snapshot.calendarByIsoDate === "object"
    ? snapshot.calendarByIsoDate
    : {};
  const requestsById = new Map((snapshot.requests ?? [])
    .map((request) => [cleanText(request?.id), request])
    .filter(([requestId]) => requestId));
  const actorNamesById = new Map((snapshot.members ?? [])
    .map((member) => [cleanText(member?.actorId), cleanText(member?.actorName)])
    .filter(([actorId]) => actorId));
  const slotsByIsoDate = new Map();

  for (const slot of snapshot.scheduleSlots ?? []) {
    const isoDate = cleanText(slot?.isoDate);
    if (!isoDate) {
      continue;
    }
    if (!slotsByIsoDate.has(isoDate)) {
      slotsByIsoDate.set(isoDate, []);
    }
    slotsByIsoDate.get(isoDate).push(slot);
  }

  return (calendarSnapshot.cells ?? []).map((cell) => {
    const isoDate = cleanText(cell?.isoDate);
    const summary = calendarByIsoDate[isoDate] ?? {};
    const slots = slotsByIsoDate.get(isoDate) ?? [];
    const counts = Object.fromEntries(CALENDAR_DOWNTIME_STATUSES.map((status) => [
      status,
      Math.max(0, toInteger(summary?.counts?.[status], 0))
    ]));
    if (Object.values(counts).every((count) => count === 0) && slots.length > 0) {
      for (const slot of slots) {
        const status = cleanText(slot?.status);
        if (status in counts) {
          counts[status] += 1;
        }
      }
    }

    const countedTotal = Object.values(counts).reduce((total, count) => total + count, 0);
    const total = Math.max(0, toInteger(summary?.total, 0), countedTotal, slots.length);
    let dominantStatus = "";
    let dominantCount = 0;
    for (const status of CALENDAR_DOWNTIME_DOMINANCE) {
      if (counts[status] > dominantCount) {
        dominantStatus = status;
        dominantCount = counts[status];
      }
    }

    const markers = CALENDAR_DOWNTIME_STATUSES
      .filter((status) => counts[status] > 0)
      .map((status) => ({
        status,
        count: counts[status],
        label: CALENDAR_DOWNTIME_STATUS_META[status].label
      }));
    const entries = slots.map((slot) => {
      const request = requestsById.get(cleanText(slot?.requestId)) ?? null;
      const status = CALENDAR_DOWNTIME_STATUS_META[cleanText(slot?.status)]
        ? cleanText(slot.status)
        : "free";
      const actorId = cleanText(slot?.actorId || request?.actorId);
      const actorName = cleanText(request?.actorName)
        || actorNamesById.get(actorId)
        || cleanText(slot?.actorName)
        || actorId
        || "Неизвестный персонаж";
      const title = cleanText(slot?.activityTitle)
        || cleanText(slot?.requestTitle)
        || cleanText(request?.title)
        || cleanText(request?.actionLabel)
        || cleanText(slot?.activityId)
        || (status === "free" ? "Свободный рабочий день" : "Заявка простоя");
      const slotHours = Number(slot?.hours);
      const requestHours = Number(request?.hoursPerDay);
      const hours = slot?.hours != null && Number.isFinite(slotHours)
        ? slotHours
        : (request?.hoursPerDay != null && Number.isFinite(requestHours) ? requestHours : null);
      const ownedWorkshop = slot?.ownedWorkshop === true || request?.ownedWorkshop === true;

      return {
        actorName,
        title,
        status,
        statusLabel: CALENDAR_DOWNTIME_STATUS_META[status].label,
        hours,
        workshop: ownedWorkshop ? "owned" : "city",
        workshopLabel: ownedWorkshop ? "Собственная мастерская" : "Городская мастерская",
        blockReason: cleanText(slot?.blockReason)
      };
    });

    return {
      ...cell,
      downtime: {
        total,
        dominantStatus,
        counts,
        entries,
        markers
      }
    };
  });
}

function buildCheckSummary(check) {
  const actionType = cleanText(check?.actionType);
  if (DOWNTIME_NON_ROLL_ACTION_TYPES.has(actionType)) {
    const prefix = DOWNTIME_NON_ROLL_ACTION_SUMMARY_LABELS[actionType] ?? "Целевое действие";
    const label = cleanText(check?.label);
    return label ? `${prefix}: ${label}` : prefix;
  }

  const abilityLabel = getOptionLabel(DOWNTIME_ABILITY_OPTIONS, check?.ability, cleanText(check?.ability));
  const dc = cleanText(check?.dc);
  const outcomeMode = cleanText(check?.outcomeMode) || (dc ? "dc" : "freeform");
  const numericDc = Number(dc.replace(/^dc\s*/iu, ""));
  const shouldShowDc = ["dc", "dc-sum"].includes(outcomeMode)
    && dc
    && (!Number.isFinite(numericDc) || numericDc > 0);
  const sourceType = cleanText(check?.sourceType) || "skill";
  const targetLabel = cleanText(check?.targetLabel) || cleanText(check?.label) || cleanText(check?.target);
  let summary = cleanText(check?.label) || "Проверка";

  if (sourceType === "save") {
    summary = cleanText(check?.ability) === "death" ? "Спасбросок смерти" : `Спасбросок: ${abilityLabel}`;
  }
  else if (sourceType === "ability") {
    summary = `Проверка: ${abilityLabel}`;
  }
  else if (sourceType === "tool") {
    summary = abilityLabel && targetLabel
      ? `Инструмент: ${abilityLabel} (${targetLabel})`
      : `Инструмент: ${targetLabel || abilityLabel || cleanText(check?.label) || "проверка"}`;
  }
  else if (abilityLabel && targetLabel) {
    summary = `Проверка: ${abilityLabel} (${targetLabel})`;
  }
  else if (targetLabel) {
    summary = `Проверка: ${targetLabel}`;
  }

  return [
    summary,
    shouldShowDc ? `DC ${dc.replace(/^dc\s*/iu, "")}` : ""
  ].filter(Boolean).join(" | ");
}

function buildEffectLabel(effect, { downtime = false } = {}) {
  const safeEffect = effect && typeof effect === "object" && !Array.isArray(effect) ? effect : {};
  const triggerOptions = downtime ? DOWNTIME_DOWNTIME_EFFECT_TRIGGER_OPTIONS : DOWNTIME_EFFECT_TRIGGER_OPTIONS;
  const trigger = cleanText(safeEffect.trigger);
  const adapter = cleanText(safeEffect.adapter);
  const template = cleanText(safeEffect.template);
  if (!trigger || trigger === "none" || !adapter || adapter === "none") {
    return "";
  }

  const templateOptions = downtime ? DOWNTIME_REQUEST_EFFECT_TEMPLATE_OPTIONS : DOWNTIME_CHECK_EFFECT_TEMPLATE_OPTIONS;
  return [
    getOptionLabel(triggerOptions, trigger, trigger),
    [
      getOptionLabel(DOWNTIME_EFFECT_ADAPTER_OPTIONS, adapter, adapter),
      getOptionLabel(templateOptions, template, template)
    ].filter(Boolean).join(" / ")
  ].filter(Boolean).join(": ");
}

function buildOutcomeSummary(check, outcomeMode) {
  if (cleanText(check?.actionType) === "resources") {
    if (check?.computedCost?.total !== undefined) {
      const currency = getOptionLabel(DOWNTIME_RESOURCE_CURRENCY_OPTIONS, check.computedCost.currency, check.computedCost.currency);
      return `${check.computedCost.total} ${currency}`;
    }
    const resources = normalizeDowntimeResources(check);
    const amount = toInteger(resources.cost.amount, 0);
    const currency = getOptionLabel(DOWNTIME_RESOURCE_CURRENCY_OPTIONS, resources.cost.currency, resources.cost.currency);
    return amount > 0 ? `${amount} ${currency}` : "Ресурсы";
  }
  if (cleanText(check?.actionType) === "rankChoice") {
    return cleanText(check?.selectedOptionLabel) || (check?.selectedRank !== undefined ? `Ранг ${check.selectedRank}` : "Выбор ранга");
  }
  if (cleanText(check?.actionType) === "numericInput") {
    const unit = cleanText(check?.input?.unit);
    return check?.numericValue !== undefined ? [check.numericValue, unit].filter(Boolean).join(" ") : "Число";
  }
  if (cleanText(check?.actionType) === "optionChoice") {
    return cleanText(check?.selectedOptionLabel) || "Выбор";
  }
  if (cleanText(check?.actionType) === "formulaRoll") {
    return cleanText(check?.selectedFormula) || "Формула";
  }
  if (cleanText(check?.actionType) === "descriptionBlock") {
    const block = check?.descriptionBlock && typeof check.descriptionBlock === "object" && !Array.isArray(check.descriptionBlock)
      ? check.descriptionBlock
      : {};
    return cleanText(block.title) || cleanText(block.description) || "Описание";
  }
  if (cleanText(check?.actionType) === "downtimeResult") {
    return buildDowntimeCheckResultLabel(check?.result) || cleanText(check?.label) || "Итог";
  }
  const numericDc = Number(check?.dc);
  const hasDc = Number.isFinite(numericDc) && numericDc > 0;
  switch (outcomeMode) {
    case "dc":
      return hasDc ? `DC ${numericDc}` : "DC";
    case "sum":
    case "total":
      return "Сумма";
    case "dc-sum":
    case "dc-total":
      return hasDc ? `DC ${numericDc} + сумма` : "DC + сумма";
    case "thresholds":
      return "Пороги";
    case "pass-thresholds":
      return "Передать пороги";
    case "freeform":
      return "Свободный";
    default:
      return getOptionLabel(DOWNTIME_OUTCOME_MODE_OPTIONS, outcomeMode, outcomeMode);
  }
}

function mapDowntimeTargetAction(check, index) {
  const actionType = cleanText(check?.actionType) || "check";
  const nonRollAction = DOWNTIME_NON_ROLL_ACTION_TYPES.has(actionType);
  const sourceType = nonRollAction ? "" : (cleanText(check?.sourceType) || "skill");
  const outcomeMode = cleanText(check?.outcomeMode) || (cleanText(check?.dc) ? "dc" : "freeform");
  const recordMode = cleanText(check?.recordMode) || "total-success";
  const checkEffectLabel = buildEffectLabel(check?.checkEffect);
  const downtimeEffectLabel = buildEffectLabel(check?.downtimeEffect, { downtime: true });
  return {
    ...check,
    number: index + 1,
    summary: buildCheckSummary(check),
    actionType,
    sourceType,
    outcomeMode,
    recordMode,
    actionTypeLabel: getOptionLabel(DOWNTIME_ACTION_TYPE_OPTIONS, actionType, actionType),
    sourceTypeLabel: nonRollAction ? getOptionLabel(DOWNTIME_ACTION_TYPE_OPTIONS, actionType, actionType) : getOptionLabel(DOWNTIME_SOURCE_TYPE_OPTIONS, sourceType, sourceType),
    abilityLabel: nonRollAction ? "" : getOptionLabel(DOWNTIME_ABILITY_OPTIONS, check?.ability, cleanText(check?.ability)),
    outcomeModeLabel: getOptionLabel(DOWNTIME_OUTCOME_MODE_OPTIONS, outcomeMode, outcomeMode),
    outcomeSummary: buildOutcomeSummary(check, outcomeMode),
    recordModeLabel: getOptionLabel(DOWNTIME_RECORD_MODE_OPTIONS, recordMode, recordMode),
    targetLabel: actionType === "resources"
      ? cleanText(check?.resources?.narrative)
      : (nonRollAction ? "" : (cleanText(check?.targetLabel) || cleanText(check?.target))),
    checkEffectLabel,
    downtimeEffectLabel,
    hasCheckEffect: Boolean(checkEffectLabel),
    hasDowntimeEffect: Boolean(downtimeEffectLabel),
    hasResult: Boolean(check?.result && typeof check.result === "object" && Object.keys(check.result).length),
    resultLabel: buildDowntimeCheckResultLabel(check?.result),
    hasChoices: Array.isArray(check?.choices) && check.choices.length > 1
  };
}

function buildDowntimeCheckResultLabel(result) {
  if (!result || typeof result !== "object") {
    return "";
  }

  const parts = [];
  if (result.total !== undefined && result.total !== null && cleanText(result.total) !== "") {
    parts.push(cleanText(result.total));
  }
  if (cleanText(result.label)) {
    parts.push(cleanText(result.label));
  }
  else if (result.value !== undefined && result.value !== null && cleanText(result.value) !== "") {
    parts.push(cleanText(result.value));
  }
  else if (cleanText(result.thresholdLabel)) {
    parts.push(cleanText(result.thresholdLabel));
  }
  if (result.success === true) {
    parts.push("успех");
  }
  else if (result.success === false) {
    parts.push("провал");
  }
  if (cleanText(result.note)) {
    parts.push(cleanText(result.note));
  }

  return parts.join(", ");
}

function buildDowntimeTargetActionDetailLines(action = {}) {
  const lines = [];
  const actionType = cleanText(action.actionType);
  if (actionType === "rankChoice") {
    const rankLabel = cleanText(action.selectedOptionLabel) || (action.selectedRank !== undefined ? `Ранг ${action.selectedRank}` : "");
    if (rankLabel) {
      lines.push(`Выбранный ранг: ${rankLabel}`);
    }
  }
  if (actionType === "numericInput" && action.numericValue !== undefined) {
    lines.push(`Значение: ${[action.numericValue, cleanText(action.input?.unit)].filter(Boolean).join(" ")}`);
  }
  if (actionType === "optionChoice" && cleanText(action.selectedOptionLabel)) {
    lines.push(`Выбор игрока: ${cleanText(action.selectedOptionLabel)}`);
  }
  if (actionType === "resources") {
    const quantity = action.resourceQuantity;
    if (quantity?.value !== undefined) {
      lines.push(`Количество: ${[quantity.value, cleanText(quantity.unit)].filter(Boolean).join(" ")}`);
    }
    const cost = action.computedCost;
    if (cost?.total !== undefined) {
      const currency = getOptionLabel(DOWNTIME_RESOURCE_CURRENCY_OPTIONS, cost.currency, cost.currency);
      const parts = [];
      if (cost.rank !== undefined) {
        parts.push(`ранг ${cost.rank}`);
      }
      parts.push(`база ${cost.baseCost}`);
      parts.push(`${cost.quantity} x ${cost.unitCost}`);
      lines.push(`Стоимость: ${cost.total} ${currency} (${parts.join(", ")})`);
    }
    else {
      const resources = normalizeDowntimeResources(action);
      if (resources.cost.amount > 0) {
        const currency = getOptionLabel(DOWNTIME_RESOURCE_CURRENCY_OPTIONS, resources.cost.currency, resources.cost.currency);
        lines.push(`Стоимость: ${resources.cost.amount} ${currency}`);
      }
    }
  }
  if (actionType === "formulaRoll" && cleanText(action.selectedFormula)) {
    lines.push(`Формула: ${cleanText(action.selectedFormula)}`);
  }
  if (actionType === "descriptionBlock") {
    const block = action?.descriptionBlock && typeof action.descriptionBlock === "object" && !Array.isArray(action.descriptionBlock)
      ? action.descriptionBlock
      : {};
    if (cleanText(block.title)) {
      lines.push(`Название: ${cleanText(block.title)}`);
    }
    if (cleanText(block.description)) {
      lines.push(`Описание: ${cleanText(block.description)}`);
    }
  }
  if (!DOWNTIME_NON_ROLL_ACTION_TYPES.has(actionType) && action?.result) {
    const result = action.result;
    if (result.total !== undefined && cleanText(result.total) !== "") {
      lines.push(`Бросок: ${cleanText(result.total)}`);
    }
    if (cleanText(result.thresholdLabel)) {
      lines.push(`Порог: ${cleanText(result.thresholdLabel)}`);
    }
  }
  if (actionType === "downtimeResult") {
    const resultLabel = buildDowntimeCheckResultLabel(action.result);
    if (resultLabel) {
      lines.push(`Итог: ${resultLabel}`);
    }
  }
  return lines;
}

function hasDowntimeTargetActionResult(action = {}) {
  const result = action?.result;
  return Boolean(result && typeof result === "object" && Object.keys(result).length);
}

function buildDowntimeTemplateView(action = null) {
  if (!action) {
    return null;
  }

  const targetActions = (Array.isArray(action.targetActions) ? action.targetActions : [])
    .map((entry, index) => mapDowntimeTargetAction(entry, index));
  return {
    id: cleanText(action.id),
    label: cleanText(action.label),
    rank: cleanText(action.rank),
    duration: cleanText(action.duration),
    summary: cleanText(action.summary),
    descriptionHtml: cleanText(action.descriptionHtml),
    requirements: Array.isArray(action.requirements) ? action.requirements.map((entry) => cleanText(entry)).filter(Boolean) : [],
    rankTable: Array.isArray(action.rankTable) ? action.rankTable : [],
    targetActions,
    resourceActions: targetActions.filter((entry) => entry.actionType === "resources"),
    checkActions: targetActions.filter((entry) => !DOWNTIME_NON_ROLL_ACTION_TYPES.has(entry.actionType)),
    resultActions: targetActions.filter((entry) => entry.actionType === "downtimeResult"),
    hasTargetActions: targetActions.length > 0
  };
}

function paginateDowntimeRequests(requests = [], page = 1, pageSize = DOWNTIME_PAGE_SIZE) {
  const safeRequests = Array.isArray(requests) ? requests : [];
  const total = Math.max(1, Math.ceil(safeRequests.length / pageSize));
  const current = Math.min(Math.max(1, toInteger(page, 1)), total);
  const start = (current - 1) * pageSize;
  return {
    items: safeRequests.slice(start, start + pageSize),
    current,
    total,
    count: safeRequests.length,
    hasPrevious: current > 1,
    hasNext: current < total
  };
}

function findTemplateAction(actionCatalogById, request = {}) {
  const ids = [
    cleanText(request.actionId),
    cleanText(request.templateUuid),
    cleanText(request.templateItemId)
  ].filter(Boolean);
  for (const id of ids) {
    const action = actionCatalogById.get(id);
    if (action) {
      return action;
    }
  }
  return null;
}

function mapDowntimeRequest(request, actionCatalogById = new Map()) {
  const status = cleanText(request?.status) || "pending";
  const statusMeta = DOWNTIME_STATUS_META[status] ?? {
    label: status || "Заявка",
    type: "info"
  };
  const templateAction = findTemplateAction(actionCatalogById, request);
  const templateView = buildDowntimeTemplateView(templateAction);
  const checks = (request?.checks ?? []).map((check, index) => mapDowntimeTargetAction(check, index));
  const requestResourceActions = checks.filter((check) => check.actionType === "resources");
  const requestCheckActions = checks.filter((check) => !DOWNTIME_NON_ROLL_ACTION_TYPES.has(check.actionType));
  const requestResultActions = checks.filter((check) => check.actionType === "downtimeResult");
  const resourceActions = templateView?.resourceActions?.length ? templateView.resourceActions : requestResourceActions;
  const checkActions = templateView?.checkActions?.length ? templateView.checkActions : requestCheckActions;
  const resultActions = templateView?.resultActions?.length ? templateView.resultActions : requestResultActions;

  return {
    ...request,
    displayTitle: cleanText(request?.title) || cleanText(request?.actionLabel) || "Заявка",
    status,
    statusLabel: statusMeta.label,
    statusType: statusMeta.type,
    statusClass: `rm-status-badge--${statusMeta.type}`,
    templateRank: cleanText(request?.templateRank) || templateView?.rank || "",
    templateDuration: cleanText(request?.templateDuration) || templateView?.duration || "",
    templateSummary: cleanText(request?.templateSummary) || templateView?.summary || "",
    templateDescriptionHtml: cleanText(request?.templateDescriptionHtml) || templateView?.descriptionHtml || "",
    templateRequirements: Array.isArray(request?.templateRequirements) && request.templateRequirements.length
      ? request.templateRequirements
      : (templateView?.requirements ?? []),
    templateRankTable: Array.isArray(request?.templateRankTable) && request.templateRankTable.length
      ? request.templateRankTable
      : (templateView?.rankTable ?? []),
    hasTemplateRank: Boolean(cleanText(request?.templateRank) || templateView?.rank),
    hasTemplateDuration: Boolean(cleanText(request?.templateDuration) || templateView?.duration),
    hasTemplateSummary: Boolean(cleanText(request?.templateSummary) || templateView?.summary),
    hasTemplateDescriptionHtml: Boolean(cleanText(request?.templateDescriptionHtml) || templateView?.descriptionHtml),
    hasTemplateRequirements: Boolean(
      (Array.isArray(request?.templateRequirements) && request.templateRequirements.length)
      || templateView?.requirements?.length
    ),
    hasTemplateRankTable: Boolean(
      (Array.isArray(request?.templateRankTable) && request.templateRankTable.length)
      || templateView?.rankTable?.length
    ),
    checks,
    targetActions: checks,
    resourceActions,
    checkActions,
    resultActions,
    targetActionCount: checks.length,
    hasChecks: checks.length > 0,
    hasTargetActions: checks.length > 0,
    hasResources: resourceActions.length > 0,
    hasCheckActions: checkActions.length > 0,
    hasResultActions: resultActions.length > 0,
    isArchived: DOWNTIME_ARCHIVE_STATUSES.has(status),
    hasResult: Boolean(cleanText(request?.result)),
    canApprove: status === "pending" || status === "returned",
    canReturn: status === "pending" || status === "approved",
    canReject: status === "pending" || status === "approved" || status === "returned",
    canComplete: status === "approved"
  };
}

function buildDowntimeRequestDetailTargetActions(request = {}, { canManage = false } = {}) {
  const targetActions = Array.isArray(request.targetActions) ? request.targetActions : [];
  if (!targetActions.length) {
    return `<p class="rm-downtime-inspector__empty">Целевые действия пока не назначены.</p>`;
  }

  return `
    <ul class="rm-downtime-target-action-list">
      ${targetActions.map((action) => {
        const hasResult = Boolean(action.hasResult || hasDowntimeTargetActionResult(action));
        const canEdit = Boolean(canManage && !hasResult && !request.isArchived);
        const actionButton = canManage
          ? `
            <button
              type="button"
              class="rm-icon-button"
              data-action="downtime-target-action"
              data-request-id="${escapeHtml(request.id)}"
              data-check-id="${escapeHtml(action.id)}"
              data-tooltip="${canEdit ? "Редактировать целевое действие" : "Просмотреть целевое действие"}"
            >
              <i class="fa-solid ${canEdit ? "fa-pen" : "fa-eye"}"></i>
            </button>
          `
          : "";
        const removeButton = canEdit
          ? `
            <button
              type="button"
              class="rm-icon-button rm-icon-button--danger"
              data-action="downtime-remove-target-action"
              data-request-id="${escapeHtml(request.id)}"
              data-check-id="${escapeHtml(action.id)}"
              data-tooltip="Удалить целевое действие"
            >
              <i class="fa-solid fa-trash"></i>
            </button>
          `
          : "";
        const choices = action.hasChoices
          ? `<p class="rm-downtime-target-action__meta">Выбор игрока: ${action.choices.map((choice) => escapeHtml(choice.label)).join(" / ")}</p>`
          : "";
        const result = hasResult
          ? `<span class="rm-badge rm-status-badge rm-status-badge--good">${escapeHtml(action.resultLabel || buildDowntimeCheckResultLabel(action.result))}</span>`
          : "";
        const effects = [
          action.hasCheckEffect ? `<p class="rm-downtime-target-action__meta">Эффект проверки: ${escapeHtml(action.checkEffectLabel)}</p>` : "",
          action.hasDowntimeEffect ? `<p class="rm-downtime-target-action__meta">Эффект простоя: ${escapeHtml(action.downtimeEffectLabel)}</p>` : ""
        ].filter(Boolean).join("");
        const details = buildDowntimeTargetActionDetailLines(action)
          .map((line) => `<p class="rm-downtime-target-action__meta">${escapeHtml(line)}</p>`)
          .join("");

        return `
          <li class="rm-downtime-target-action">
            <div class="rm-downtime-target-action__main">
              <div class="rm-downtime-target-action__title">
                <strong>${escapeHtml(action.label)}</strong>
                <span class="rm-badge rm-status-badge rm-status-badge--info">${escapeHtml(action.outcomeSummary)}</span>
              </div>
              <p class="rm-muted">${escapeHtml(action.sourceTypeLabel)}${action.abilityLabel ? ` • ${escapeHtml(action.abilityLabel)}` : ""}${action.targetLabel ? ` (${escapeHtml(action.targetLabel)})` : ""}</p>
              ${result}
              ${choices}
              ${details}
              ${effects}
            </div>
            ${canManage ? `<div class="rm-downtime-target-action__actions">${actionButton}${removeButton}</div>` : ""}
          </li>
        `;
      }).join("")}
    </ul>
  `;
}

function buildDowntimeRequestDialogContent(request = {}, { canManage = false } = {}) {
  const requestDescription = cleanText(request.description)
    ? `<p class="rm-downtime-request-dialog__text">${escapeHtml(request.description)}</p>`
    : "";
  const templateDescription = request.hasTemplateDescriptionHtml
    ? `<div class="rm-downtime-inspector__template-description">${request.templateDescriptionHtml}</div>`
    : (request.hasTemplateSummary ? `<p class="rm-downtime-request-dialog__text">${escapeHtml(request.templateSummary)}</p>` : "");
  const result = request.hasResult
    ? `<p class="rm-inline-status rm-inline-status--info"><span>${escapeHtml(request.result)}</span></p>`
    : "";
  const requirements = request.hasTemplateRequirements
    ? request.templateRequirements.map((entry) =>
      `<span class="rm-badge rm-status-badge rm-status-badge--info" data-tooltip="Требование простоя">${escapeHtml(entry)}</span>`
    ).join("")
    : "";
  const meta = [
    request.hasTemplateRank ? `<span class="rm-badge rm-status-badge rm-status-badge--info" data-tooltip="Ранг простоя">${escapeHtml(request.templateRank)}</span>` : "",
    request.hasTemplateDuration ? `<span class="rm-badge rm-status-badge rm-status-badge--info" data-tooltip="Базовая длительность">${escapeHtml(request.templateDuration)}</span>` : "",
    requirements
  ].filter(Boolean).join("");

  return `
    <section class="rm-downtime-request-dialog" data-request-id="${escapeHtml(request.id)}">
      <header class="rm-downtime-request-dialog__header">
        <div>
          <p class="rm-eyebrow">${escapeHtml(request.actorName)} • ${escapeHtml(request.actionLabel)} • ${escapeHtml(request.weeks)} нед.</p>
          <h3>${escapeHtml(request.displayTitle)}</h3>
        </div>
        <span class="rm-badge rm-status-badge ${escapeHtml(request.statusClass)}">${escapeHtml(request.statusLabel)}</span>
      </header>

      ${requestDescription}
      ${result}
      ${meta ? `<div class="rm-status-strip rm-downtime-template-meta">${meta}</div>` : ""}
      ${templateDescription}

      <section class="rm-downtime-target-actions">
        <header class="rm-downtime-target-actions__header">
          <h4>Целевые действия</h4>
          <span class="rm-badge rm-status-badge rm-status-badge--info">${escapeHtml(request.targetActionCount)}</span>
        </header>
        ${buildDowntimeRequestDetailTargetActions(request, { canManage })}
      </section>
    </section>
  `;
}

function shouldPromptDowntimeResult(status) {
  return ["returned", "rejected", "completed"].includes(status);
}

function normalizeInventorySourceType(value) {
  const text = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_\-\s]+/gu, "");

  if (["material", "materials", "материал", "материалы"].includes(text)) {
    return "material";
  }

  if (["gear", "equipment", "loot", "снаряжение"].includes(text)) {
    return "gear";
  }

  if (["magicitem", "magicitems", "magic", "magical", "магическийпредмет", "магия"].includes(text)) {
    return "magicItem";
  }

  if (["supply", "supplies", "resource", "resources", "запасы"].includes(text)) {
    return "supply";
  }

  return text || "";
}

function normalizeLookupText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function roundNumber(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round((toNumber(value, 0) + Number.EPSILON) * factor) / factor;
}

function normalizeInventorySortMode(value) {
  const mode = cleanText(value);
  return INVENTORY_SORT_MODES.has(mode) ? mode : "name";
}

function formatCopperValue(totalCopper) {
  let remaining = Math.max(0, Math.floor(toNumber(totalCopper, 0)));
  const pp = Math.floor(remaining / CURRENCY_MULTIPLIERS.pp);
  remaining -= pp * CURRENCY_MULTIPLIERS.pp;
  const gp = Math.floor(remaining / CURRENCY_MULTIPLIERS.gp);
  remaining -= gp * CURRENCY_MULTIPLIERS.gp;
  const sp = Math.floor(remaining / CURRENCY_MULTIPLIERS.sp);
  remaining -= sp * CURRENCY_MULTIPLIERS.sp;
  const cp = remaining;
  const parts = [
    pp > 0 ? `${pp} ${COIN_LABELS.pp}` : "",
    gp > 0 ? `${gp} ${COIN_LABELS.gp}` : "",
    sp > 0 ? `${sp} ${COIN_LABELS.sp}` : "",
    cp > 0 ? `${cp} ${COIN_LABELS.cp}` : ""
  ].filter(Boolean);
  return parts.length ? parts.join(" ") : `0 ${COIN_LABELS.cp}`;
}

function getInventoryEntryItemValueCopper(entry) {
  return Math.max(0, Math.floor(toNumber(entry?.priceCopper, 0) * Math.max(0, toNumber(entry?.quantity, 0))));
}

function compareInventoryEntries(left, right, sortMode) {
  const mode = normalizeInventorySortMode(sortMode);
  const compareName = (left, right) => cleanText(left?.name).localeCompare(cleanText(right?.name), "ru");
  switch (mode) {
    case "weight-desc": {
      const result = toNumber(right?.totalWeight, 0) - toNumber(left?.totalWeight, 0);
      return result || compareName(left, right);
    }
    case "price-desc": {
      const result = getInventoryEntryItemValueCopper(right) - getInventoryEntryItemValueCopper(left);
      return result || compareName(left, right);
    }
    case "category": {
      const categoryResult = cleanText(left?.sourceTypeLabel).localeCompare(cleanText(right?.sourceTypeLabel), "ru")
        || cleanText(left?.itemTypeLabel).localeCompare(cleanText(right?.itemTypeLabel), "ru");
      return categoryResult || compareName(left, right);
    }
    case "quantity-desc": {
      const result = toNumber(right?.quantity, 0) - toNumber(left?.quantity, 0);
      return result || compareName(left, right);
    }
    case "name":
    default:
      return compareName(left, right);
  }
}

function sortInventoryEntries(entries, sortMode) {
  return [...(Array.isArray(entries) ? entries : [])]
    .sort((left, right) => compareInventoryEntries(left, right, sortMode));
}

function sortInventoryFolderTreeItems(node, sortMode) {
  if (!node) return;
  node.items = sortInventoryEntries(node.items, sortMode);
  for (const folder of node.folders ?? []) sortInventoryFolderTreeItems(folder, sortMode);
}

function buildInventoryValueSummary(entries) {
  const totalItemValueCopper = Math.max(0, Math.floor((Array.isArray(entries) ? entries : [])
    .reduce((sum, entry) => sum + getInventoryEntryItemValueCopper(entry), 0)));
  return {
    totalItemValueCopper,
    totalItemValueLabel: formatCopperValue(totalItemValueCopper)
  };
}

function resolveCapacitySeverity(freeCapacityLb, usedPercentRaw) {
  if (toNumber(freeCapacityLb, 0) < 0) {
    return "danger";
  }
  if (toNumber(usedPercentRaw, 0) >= 90) {
    return "warning";
  }
  return "good";
}

function resolveSupplySeverity(daysLeft, hasEstimate) {
  if (!hasEstimate) {
    return "info";
  }
  const safeDays = toNumber(daysLeft, 0);
  if (safeDays <= 0) {
    return "danger";
  }
  if (safeDays <= 1) {
    return "warning";
  }
  return "good";
}

function resolveEnergySeverity(current, max) {
  const safeMax = toNumber(max, 0);
  if (safeMax <= 0) {
    return "info";
  }
  const ratioPercent = (toNumber(current, 0) / safeMax) * 100;
  if (ratioPercent <= 30) {
    return "danger";
  }
  if (ratioPercent <= 60) {
    return "warning";
  }
  return "good";
}

function toStateClass(severity) {
  const safeSeverity = ["danger", "warning", "good", "info"].includes(severity) ? severity : "info";
  return `rm-state-${safeSeverity}`;
}

function toStatusBadgeType(severity) {
  if (severity === "danger" || severity === "warning" || severity === "good") {
    return severity;
  }
  return "info";
}

function getDialogRoot(html) {
  if (!html) {
    return null;
  }

  if (html instanceof HTMLElement) {
    return html;
  }

  if (html[0] instanceof HTMLElement) {
    return html[0];
  }

  return null;
}

function renderDialogOnTop(dialog) {
  dialog?.render?.(true);
  if (typeof globalThis.window?.setTimeout === "function") {
    globalThis.window.setTimeout(() => bringAppToFront(dialog), 0);
  }
  else {
    bringAppToFront(dialog);
  }
}

function hasOpenDowntimeTargetActionDialog() {
  return Boolean(globalThis.document?.querySelector?.(".rm-downtime-target-action-window"));
}

function parseCurrencyInputValue(rawValue, fallback = 0) {
  const text = String(rawValue ?? "").trim();
  const safeFallback = toInteger(fallback, 0);
  if (/^[+-]\d+$/u.test(text)) {
    return Math.max(0, safeFallback + toInteger(text, 0));
  }

  return Math.max(0, toInteger(text, safeFallback));
}

function parseQuantityInputValue(rawValue, fallback = 0, { relative = false, min = null } = {}) {
  const text = String(rawValue ?? "").trim().replace(",", ".");
  const safeFallback = roundNumber(fallback, 2);
  const relativeNumberPattern = /^[+-](?:\d+(?:\.\d+)?|\.\d+)$/u;
  const absoluteNumberPattern = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/u;
  const parsed = relative && relativeNumberPattern.test(text)
    ? safeFallback + Number(text)
    : absoluteNumberPattern.test(text)
      ? Number(text)
      : safeFallback;
  const rounded = roundNumber(parsed, 2);
  return min === null ? rounded : Math.max(min, rounded);
}

function readCurrencyValuesFromRoot(root, baseCurrency = {}) {
  return {
    pp: parseCurrencyInputValue(root?.querySelector("[data-field='currency-pp']")?.value, baseCurrency.pp),
    gp: parseCurrencyInputValue(root?.querySelector("[data-field='currency-gp']")?.value, baseCurrency.gp),
    sp: parseCurrencyInputValue(root?.querySelector("[data-field='currency-sp']")?.value, baseCurrency.sp),
    cp: parseCurrencyInputValue(root?.querySelector("[data-field='currency-cp']")?.value, baseCurrency.cp)
  };
}

async function promptInventoryFolderName({ title, initialName = "", confirmLabel = "Сохранить" } = {}) {
  const dialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (typeof dialogV2?.wait !== "function") {
    throw new Error("Диалог папки инвентаря недоступен.");
  }

  const rawName = await dialogV2.wait({
    window: { title: cleanText(title) || "Папка инвентаря" },
    content: `
      <form class="rm-inventory-folder-dialog">
        <div class="form-group">
          <label>Название папки</label>
          <input
            type="text"
            name="folderName"
            value="${foundry.utils.escapeHTML(cleanText(initialName))}"
            maxlength="${MAX_INVENTORY_FOLDER_NAME_LENGTH}"
            required
            autofocus
            autocomplete="off"
          >
        </div>
      </form>
    `,
    buttons: [
      {
        action: "confirm",
        label: cleanText(confirmLabel) || "Сохранить",
        icon: "fa-solid fa-check",
        default: true,
        callback: (_event, button) => button?.form?.elements?.folderName?.value ?? ""
      },
      {
        action: "cancel",
        label: "Отмена",
        callback: () => null
      }
    ],
    rejectClose: false
  });
  if (rawName === null || rawName === undefined || rawName === false) return null;

  const name = cleanText(rawName);
  if (!name) throw new Error("Название папки не может быть пустым.");
  if (name.length > MAX_INVENTORY_FOLDER_NAME_LENGTH) {
    throw new Error(`Название папки должно быть не длиннее ${MAX_INVENTORY_FOLDER_NAME_LENGTH} символов.`);
  }
  return name;
}

export async function promptInventoryIngressConfirmation(preview) {
  const rows = Array.isArray(preview?.rows) ? preview.rows : [];
  const dismantleRows = rows.filter((row) => row?.action?.type === "dismantle");
  const singleSkip = preview?.batch !== true
    && rows.length === 1
    && rows[0]?.action?.type === "skip"
    ? rows[0]
    : null;
  if (dismantleRows.length === 0 && !singleSkip) {
    return Object.freeze({ rootOverrideSourceKeys: Object.freeze([]) });
  }
  const dialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (typeof dialogV2?.wait !== "function") {
    throw new Error("Диалог фильтра входящего лута недоступен.");
  }
  if (singleSkip) {
    const result = await dialogV2.wait({
      window: { title: "Фильтр входящего лута" },
      content: `<p>Правило пропускает «${foundry.utils.escapeHTML(cleanText(singleSkip.displayName))}».</p>`,
      buttons: [
        {
          action: "skip",
          label: "Не забирать",
          default: true,
          callback: () => ({ rootOverrideSourceKeys: [] })
        },
        {
          action: "root",
          label: "Всё равно добавить в корень",
          callback: () => ({ rootOverrideSourceKeys: [singleSkip.sourceKey] })
        },
        { action: "cancel", label: "Отмена", callback: () => null }
      ],
      rejectClose: false
    });
    return result == null || result === false ? null : result;
  }

  const content = dismantleRows.map((row) => {
    const outputs = (Array.isArray(row.dismantlePreview) ? row.dismantlePreview : [])
      .map((output) => (
        `${foundry.utils.escapeHTML(cleanText(output?.name))} × ${foundry.utils.escapeHTML(String(output?.quantity ?? 0))}`
      ))
      .join(", ");
    return `
      <label class="rm-inventory-ingress-dismantle-row">
        <input type="checkbox" data-ingress-dismantle-choice data-source-key="${foundry.utils.escapeHTML(row.sourceKey)}" checked>
        <span><strong>${foundry.utils.escapeHTML(cleanText(row.displayName))}</strong>${outputs ? ` → ${outputs}` : ""}</span>
      </label>
    `;
  }).join("");
  const result = await dialogV2.wait({
    window: { title: "Подтверждение разборки" },
    content: `<form class="rm-inventory-ingress-dismantle-dialog">${content}</form>`,
    buttons: [
      {
        action: "confirm",
        label: "Подтвердить",
        icon: "fa-solid fa-hammer",
        default: true,
        callback: (_event, button) => ({
          rootOverrideSourceKeys: Array.from(
            button?.form?.querySelectorAll?.("[data-ingress-dismantle-choice]") ?? []
          ).filter((input) => input.checked !== true)
            .map((input) => cleanText(input.dataset?.sourceKey))
            .filter(Boolean)
        })
      },
      { action: "cancel", label: "Отмена", callback: () => null }
    ],
    rejectClose: false
  });
  return result == null || result === false ? null : result;
}

function createInventoryFolderId() {
  const folderId = cleanText(globalThis.crypto?.randomUUID?.());
  if (!folderId) {
    throw new Error("Не удалось создать стабильный идентификатор папки.");
  }
  return folderId;
}

async function promptNumericValue({ title, label, value = "", min = 0, step = "0.01", confirmLabel = "Сохранить", allowRelative = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const inputType = allowRelative ? "text" : "number";
    const relativeAttributes = allowRelative
      ? 'inputmode="decimal" pattern="[+\\-]?(?:[0-9]+(?:[.,][0-9]+)?|[.,][0-9]+)"'
      : `min="${foundry.utils.escapeHTML(String(min))}" step="${foundry.utils.escapeHTML(String(step))}"`;

    const resolveFromRoot = (root) => {
      if (settled) {
        return false;
      }
      const input = root?.querySelector("[data-field='numeric-value']");
      settled = true;
      resolve(input?.value ?? null);
      return true;
    };

    const dialog = new Dialog({
      title,
      content: `
        <form class="rm-purchase-dialog">
          <div class="rm-field">
            <label for="rm-number-prompt">${foundry.utils.escapeHTML(label)}</label>
            <input
              id="rm-number-prompt"
              type="${inputType}"
              ${relativeAttributes}
              value="${foundry.utils.escapeHTML(String(value ?? ""))}"
              data-field="numeric-value"
            >
          </div>
        </form>
      `,
      buttons: {
        confirm: {
          label: confirmLabel,
          callback: (html) => {
            const root = getDialogRoot(html);
            resolveFromRoot(root);
          }
        },
        cancel: {
          label: "Отмена",
          callback: () => {
            settled = true;
            resolve(null);
          }
        }
      },
      default: "confirm",
      render: (html) => {
        const root = getDialogRoot(html);
        const input = root?.querySelector("[data-field='numeric-value']");
        root?.querySelector("form")?.addEventListener("submit", (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (resolveFromRoot(root)) {
            dialog.close?.();
          }
        });
        if (input instanceof HTMLInputElement) {
          input.focus();
          input.select();
        }
      },
      close: () => {
        if (!settled) {
          resolve(null);
        }
      }
    }, {
      classes: ["rebreya-main", "rebreya-trader-dialog", "rm-currency-dialog-window"]
    });

    renderDialogOnTop(dialog);
  });
}

async function confirmAction(title, content) {
  const dialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (typeof dialogV2?.confirm === "function") {
    return dialogV2.confirm({
      window: {
        title
      },
      content
    });
  }

  return new Promise((resolve) => {
    Dialog.confirm({
      title,
      content,
      yes: () => resolve(true),
      no: () => resolve(false),
      defaultYes: false,
      close: () => resolve(false)
    });
  });
}

async function confirmActionOnTop(title, content) {
  const documentRef = globalThis.document;
  if (globalThis.game?.ready !== true || !documentRef?.body) {
    return confirmAction(title, content);
  }

  return new Promise((resolve) => {
    let settled = false;
    const overlay = documentRef.createElement("div");
    overlay.className = "rm-calendar-confirm-overlay";
    overlay.innerHTML = `
      <section class="rm-calendar-confirm" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
        <header class="rm-calendar-confirm__header">
          <h3>${escapeHtml(title)}</h3>
        </header>
        <div class="rm-calendar-confirm__body">${content}</div>
        <footer class="rm-calendar-confirm__actions">
          <button type="button" class="rm-button rm-button--secondary" data-action="cancel">
            <i class="fa-solid fa-xmark" aria-hidden="true"></i>
            <span>Нет</span>
          </button>
          <button type="button" class="rm-button rm-button--primary" data-action="confirm">
            <i class="fa-solid fa-check" aria-hidden="true"></i>
            <span>Да</span>
          </button>
        </footer>
      </section>
    `;

    const finish = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      documentRef.removeEventListener("keydown", onKeyDown);
      overlay.remove();
      resolve(value);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      }
    };

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay || event.target.closest("[data-action='cancel']")) {
        event.preventDefault();
        finish(false);
      }
      else if (event.target.closest("[data-action='confirm']")) {
        event.preventDefault();
        finish(true);
      }
    });
    documentRef.addEventListener("keydown", onKeyDown);
    documentRef.body.append(overlay);
    overlay.querySelector("[data-action='confirm']")?.focus?.();
  });
}

async function promptCurrencyDialog(currency = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const safeCurrency = {
      pp: toInteger(currency.pp, 0),
      gp: toInteger(currency.gp, 0),
      sp: toInteger(currency.sp, 0),
      cp: toInteger(currency.cp, 0)
    };

    const resolveWith = (payload) => {
      settled = true;
      resolve(payload);
    };

    const dialog = new Dialog({
      title: "Монеты склада",
      content: `
        <form class="rm-purchase-dialog rm-currency-dialog">
          <div class="rm-currency-dialog__grid">
            <div class="rm-field rm-field--narrow">
              <label>Пм</label>
              <input type="text" inputmode="numeric" pattern="[+\\-]?[0-9]*" value="${safeCurrency.pp}" data-field="currency-pp">
            </div>
            <div class="rm-field rm-field--narrow">
              <label>Зм</label>
              <input type="text" inputmode="numeric" pattern="[+\\-]?[0-9]*" value="${safeCurrency.gp}" data-field="currency-gp">
            </div>
            <div class="rm-field rm-field--narrow">
              <label>См</label>
              <input type="text" inputmode="numeric" pattern="[+\\-]?[0-9]*" value="${safeCurrency.sp}" data-field="currency-sp">
            </div>
            <div class="rm-field rm-field--narrow">
              <label>Мм</label>
              <input type="text" inputmode="numeric" pattern="[+\\-]?[0-9]*" value="${safeCurrency.cp}" data-field="currency-cp">
            </div>
          </div>
          <p class="rm-muted">Сначала отредактируйте значения, затем при необходимости примените конвертацию.</p>
        </form>
      `,
      buttons: {
        save: {
          label: "Сохранить",
          callback: (html) => {
            const root = getDialogRoot(html);
            resolveWith({
              action: "save",
              values: readCurrencyValuesFromRoot(root, safeCurrency)
            });
          }
        },
        normalized: {
          label: "Нормализация",
          callback: (html) => {
            const root = getDialogRoot(html);
            resolveWith({
              action: "convert",
              mode: "normalized",
              values: readCurrencyValuesFromRoot(root, safeCurrency)
            });
          }
        },
        toGold: {
          label: "В золото",
          callback: (html) => {
            const root = getDialogRoot(html);
            resolveWith({
              action: "convert",
              mode: "gp",
              values: readCurrencyValuesFromRoot(root, safeCurrency)
            });
          }
        },
        toSilver: {
          label: "В серебро",
          callback: (html) => {
            const root = getDialogRoot(html);
            resolveWith({
              action: "convert",
              mode: "sp",
              values: readCurrencyValuesFromRoot(root, safeCurrency)
            });
          }
        },
        toCopper: {
          label: "В медь",
          callback: (html) => {
            const root = getDialogRoot(html);
            resolveWith({
              action: "convert",
              mode: "cp",
              values: readCurrencyValuesFromRoot(root, safeCurrency)
            });
          }
        },
        cancel: {
          label: "Отмена",
          callback: () => resolveWith(null)
        }
      },
      default: "save",
      close: () => {
        if (!settled) {
          resolve(null);
        }
      }
    }, {
      classes: ["rebreya-main", "rebreya-trader-dialog", "rm-currency-dialog-window"]
    });

    renderDialogOnTop(dialog);
  });
}

function parseCalendarIsoDate(isoDate, errorMessage = "Некорректная дата календаря.") {
  const match = /^(\d+)-(\d{2})-(\d{2})$/u.exec(cleanText(isoDate));
  if (!match) {
    throw new Error(errorMessage);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  if (
    !Number.isSafeInteger(year)
    || year < 1
    || date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    throw new Error(errorMessage);
  }

  return { year, month, day, date };
}

function formatCalendarIsoDate(date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0")
  ].join("-");
}

function buildCalendarIsoDate(year, month, day) {
  const safeYear = toInteger(year, 0);
  const safeMonth = toInteger(month, 0);
  const safeDay = toInteger(day, 0);
  const { date } = parseCalendarIsoDate([
    safeYear,
    String(safeMonth).padStart(2, "0"),
    String(safeDay).padStart(2, "0")
  ].join("-"));
  return formatCalendarIsoDate(date);
}

function buildCalendarAdvanceIsoDate(isoDate, unit, value) {
  const { date } = parseCalendarIsoDate(isoDate, "Некорректная текущая дата календаря.");
  const safeValue = Math.max(1, toInteger(value, 1));
  if (unit === "month") {
    date.setUTCMonth(date.getUTCMonth() + safeValue);
  }
  else {
    date.setUTCDate(date.getUTCDate() + (unit === "week" ? safeValue * 7 : safeValue));
  }
  return formatCalendarIsoDate(date);
}

const INVENTORY_TAB_LABELS = Object.freeze({
  inventory: "Инвентарь",
  party: "Группа",
  craft: "Крафт",
  calendar: "Календарь",
  travel: "Путешествие",
  transport: "Транспорт",
  downtime: "Простой"
});

export class InventoryApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["rebreya-main", "rebreya-inventory-app"],
    window: {
      title: "Партийный инвентарь",
      icon: "fa-solid fa-box-open",
      resizable: true
    },
    position: {
      width: 1320,
      height: 920
    }
  };

  static PARTS = {
    main: {
      root: true,
      template: `modules/${MODULE_ID}/templates/inventory-app.hbs`
    }
  };

  constructor(moduleApi, options = {}) {
    const {
      groupActorId = "",
      rootFolderId = null,
      inventoryViewKey = "main",
      ...applicationOptions
    } = options ?? {};
    super(applicationOptions);
    this.moduleApi = moduleApi;
    this.inventoryHeaderAnimationStartedAt = Date.now();
    this.groupActorId = cleanText(groupActorId);
    this.rootFolderId = cleanText(rootFolderId) || null;
    this.inventoryViewKey = cleanText(inventoryViewKey) || "main";
    this.expandedFolderIds = new Set();
    this.inventorySnapshotCache = null;
    this.inventoryFolderTreeCache = null;
    this.inventorySearchIndexCache = null;
    this.inventoryContextCache = null;
    this.missingRootCloseScheduled = false;
    this.activeTab = "inventory";
    this.search = "";
    this.typeFilter = "all";
    this.sortMode = "name";
    this.inventoryMode = "items";
    this.inventoryRuleDraft = null;
    this.inventoryRuleDraftError = "";
    this.selectedNewMemberId = "";
    this.newMemberQuery = "";
    this.availablePartyActors = [];
    this.craftSearch = "";
    this.craftCrafterActorId = "";
    this.downtimeGrantWeeks = 1;
    this.downtimeGrantActorId = "all";
    this.downtimeRequestActorId = "";
    this.downtimeRequestActionId = "";
    this.downtimeRequestWeeks = 1;
    this.downtimeRequestTitle = "";
    this.downtimeRequestDescription = "";
    this.downtimeShowArchive = false;
    this.downtimeSelectedRequestId = "";
    this.downtimeQueuePage = 1;
    this.downtimeArchivePage = 1;
    this.travelTrackTime = false;
    this.pendingTravelSnapshot = null;
    this.travelMutationSequence = 0;
    this.expandedPartyMembers = new Set();
    this.searchRenderTimeout = null;
    this.inventorySearchRenderPending = false;
    this.craftSearchRenderTimeout = null;
    this.craftMutationIds = new Map();
    this.actionFeedbackTimeout = null;
    this.contextMenuCleanup = null;
    this.focusRestore = null;
    this.renderListenersAbortController = null;
    this.actionFeedback = null;
    this.canManage = false;
    this.canDropInventoryItems = false;
    this.canOrganizeInventory = false;
    this.groupActor = null;
    this.partyMembershipManagedByNativeGroup = false;
    this.scrollRestore = null;
    this.calendarDowntimeByIsoDate = {};
    this.calendarTransitionPending = false;
  }

  get id() {
    if (this.inventoryViewKey === "main") {
      return `${MODULE_ID}-inventory-app`;
    }
    const scopedToken = Array.from(this.inventoryViewKey, (character) => character.codePointAt(0).toString(16)).join("-");
    return `${MODULE_ID}-inventory-folder-${scopedToken}`;
  }

  get inventoryActorId() {
    return cleanText(this.inventorySnapshotCache?.actor?.id) || this.groupActorId;
  }

  async refreshInventorySnapshot({ preserveScroll = true } = {}) {
    this.inventorySnapshotCache = null;
    this.inventoryFolderTreeCache = null;
    this.inventorySearchIndexCache = null;
    this.inventoryContextCache = null;
    this.inventorySearchRenderPending = false;
    return this.render({ force: true, preserveScroll });
  }

  setActiveTab(tab, { render = true } = {}) {
    const allowedTabs = new Set(Object.keys(INVENTORY_TAB_LABELS));
    const nextTab = allowedTabs.has(tab) ? tab : "inventory";
    if (this.activeTab === nextTab) {
      return;
    }

    this.activeTab = nextTab;
    if (render) {
      this.render({ force: true });
    }
  }

  render(options = {}) {
    if (options?.preserveScroll) {
      this.scrollRestore = this.#captureScrollPositions();
    }

    if (typeof super.render === "function") {
      return super.render(options);
    }

    return Promise.resolve(this);
  }

  #captureScrollPositions() {
    const element = getAppElement(this);
    if (!element?.querySelectorAll) {
      return null;
    }

    return Array.from(element.querySelectorAll(".scrollable, [data-rm-preserve-scroll]"))
      .map((node, index) => ({
        index,
        top: Number(node.scrollTop ?? 0),
        left: Number(node.scrollLeft ?? 0)
      }));
  }

  #restoreScrollPositions(element) {
    const positions = this.scrollRestore;
    this.scrollRestore = null;
    if (!positions?.length || !element?.querySelectorAll) {
      return;
    }

    const nodes = Array.from(element.querySelectorAll(".scrollable, [data-rm-preserve-scroll]"));
    for (const position of positions) {
      const node = nodes[position.index] ?? null;
      if (!node) {
        continue;
      }

      node.scrollTop = position.top;
      node.scrollLeft = position.left;
    }
  }

  #setActionFeedback(type, message) {
    const safeType = ["success", "error", "warning", "info"].includes(type) ? type : "info";
    const safeMessage = String(message ?? "").trim();
    if (!safeMessage) {
      return;
    }

    this.actionFeedback = {
      type: safeType,
      message: safeMessage
    };

    window.clearTimeout(this.actionFeedbackTimeout);
    const feedbackMarker = `${safeType}:${safeMessage}`;
    this.actionFeedbackTimeout = window.setTimeout(() => {
      const currentMarker = this.actionFeedback
        ? `${this.actionFeedback.type}:${this.actionFeedback.message}`
        : "";
      if (currentMarker !== feedbackMarker) {
        return;
      }

      this.actionFeedback = null;
      this.actionFeedbackTimeout = null;
      if (getAppElement(this) && !hasOpenDowntimeTargetActionDialog()) {
        this.render({ force: true });
      }
    }, 3500);
  }

  #openTransportDialog(transportId) {
    const vehicle = (this.transportContext?.vehicles ?? [])
      .find((entry) => entry.id === cleanText(transportId));
    const DialogClass = globalThis.Dialog;
    if (!vehicle || typeof DialogClass !== "function") {
      return;
    }

    const dialog = new DialogClass({
      title: cleanText(vehicle.name) || "Транспорт",
      content: buildTransportDialogContent(vehicle, {
        canManage: Boolean(this.transportContext?.canManage)
      }),
      buttons: {},
      render: (html) => {
        const root = getDialogRoot(html);
        const form = root?.querySelector?.("[data-transport-dialog-form]");
        form?.addEventListener("submit", (event) => {
          event.preventDefault();
          event.stopPropagation();
        });
        form?.addEventListener("keydown", (event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          event.stopPropagation();
        });
        root?.querySelector?.("[data-action='transport-dialog-save']")
          ?.addEventListener("click", async (event) => {
            await this.#saveTransportDialog(vehicle, root, dialog, event.currentTarget);
          });
      }
    }, {
      classes: ["rebreya-main", "rebreya-trader-dialog", "rm-transport-dialog-window"],
      width: 720
    });
    renderDialogOnTop(dialog);
  }

  async #saveTransportDialog(vehicle, root, dialog, button) {
    const field = (name) => root?.querySelector?.(`[name='${name}']`);
    button.disabled = true;
    try {
      const hpCurrent = Number(field("hpCurrent")?.value);
      const hpMax = Math.max(0, Number(vehicle.hpMax) || 0);
      const condition = cleanText(field("condition")?.value);
      const amount = Number(cleanText(field("fuelConsumptionAmount")?.value).replace(",", "."));
      const unit = cleanText(field("fuelConsumptionUnit")?.value);
      if (!Number.isFinite(hpCurrent) || hpCurrent < 0 || (hpMax > 0 && hpCurrent > hpMax)) {
        throw new Error("Проверьте текущие хиты транспорта.");
      }
      if (!TRANSPORT_CONDITION_OPTIONS.some((option) => option.value === condition)) {
        throw new Error("Проверьте состояние транспорта.");
      }
      if (vehicle.fuel?.configured && (!Number.isFinite(amount) || amount <= 0 || !["lb", "gal"].includes(unit))) {
        throw new Error("Проверьте расход и единицу топлива.");
      }

      await this.moduleApi.updateTransportInstanceState?.({
        groupActorId: cleanText(this.groupActor?.id),
        actorId: cleanText(vehicle.actorId),
        patch: { hpCurrent, condition }
      });
      if (vehicle.fuel?.configured) {
        await this.moduleApi.updateTransportFuelConsumption?.({
          groupActorId: cleanText(this.groupActor?.id),
          actorId: cleanText(vehicle.actorId),
          consumption: { amount, unit }
        });
      }
      const active = Boolean(field("active")?.checked);
      if (active !== Boolean(vehicle.active)) {
        await this.moduleApi.setActiveTransport?.(active ? vehicle.id : "");
      }
      this.#setActionFeedback("success", "Транспорт сохранён.");
      dialog.close?.();
      await this.render?.({ force: true, preserveScroll: true });
    }
    catch (error) {
      button.disabled = false;
      console.error(`${MODULE_ID} | Failed to save transport dialog.`, error);
      const message = error?.message || "Не удалось сохранить транспорт.";
      this.#setActionFeedback("error", message);
      globalThis.ui?.notifications?.error?.(message);
    }
  }

  #resolveAvailableActorIdByName(query, availableActors = null) {
    const source = Array.isArray(availableActors) ? availableActors : this.availablePartyActors;
    const safeQuery = normalizeLookupText(query);
    if (!safeQuery || !source.length) {
      return "";
    }

    const exactMatch = source.find((actor) => normalizeLookupText(actor.name) === safeQuery) ?? null;
    if (exactMatch) {
      return exactMatch.id;
    }

    const startsWithMatches = source.filter((actor) => normalizeLookupText(actor.name).startsWith(safeQuery));
    if (startsWithMatches.length === 1) {
      return startsWithMatches[0].id;
    }

    return "";
  }

  #closeContextMenu() {
    if (typeof this.contextMenuCleanup === "function") {
      this.contextMenuCleanup();
    }
    this.contextMenuCleanup = null;
  }

  #getContextMenuZIndex() {
    const appElement = getAppElement(this);
    const ownerWindow = appElement?.closest?.(".window-app, .application") ?? null;
    const windows = Array.from(document.querySelectorAll(".window-app, .application"));
    if (ownerWindow && !windows.includes(ownerWindow)) {
      windows.push(ownerWindow);
    }

    const maxZIndex = windows.reduce((maxValue, node) => {
      const currentValue = Number.parseInt(window.getComputedStyle(node).zIndex ?? "", 10);
      return Number.isFinite(currentValue) ? Math.max(maxValue, currentValue) : maxValue;
    }, 100);
    return String(maxZIndex + 2);
  }

  #openContextMenu({ x, y, anchor = null, title = "", actions = [] }) {
    this.#closeContextMenu();
    if (!Array.isArray(actions) || !actions.length) {
      return;
    }

    const menuRoot = document.createElement("div");
    menuRoot.className = "rm-context-menu";
    menuRoot.setAttribute("role", "menu");

    if (title) {
      const titleNode = document.createElement("p");
      titleNode.className = "rm-context-menu__title";
      titleNode.textContent = title;
      menuRoot.appendChild(titleNode);
    }

    for (const action of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.disabled = action.disabled === true;
      button.className = `rm-context-menu__item${action.danger ? " is-danger" : ""}${button.disabled ? " is-disabled" : ""}`;
      if (action.icon) {
        const iconNode = document.createElement("i");
        iconNode.className = action.icon;
        button.appendChild(iconNode);
      }

      const labelNode = document.createElement("span");
      labelNode.textContent = action.label ?? "";
      button.appendChild(labelNode);

      button.addEventListener("click", async () => {
        if (button.disabled) return;
        this.#closeContextMenu();
        try {
          await action.callback?.();
        }
        catch (error) {
          console.error(`${MODULE_ID} | Context menu action failed.`, error);
        }
      });
      menuRoot.appendChild(button);
    }

    document.body.appendChild(menuRoot);
    const syncMenuLayer = () => {
      const nextZIndex = this.#getContextMenuZIndex();
      if (menuRoot.style.zIndex !== nextZIndex) {
        menuRoot.style.zIndex = nextZIndex;
      }
    };
    syncMenuLayer();
    const windowLayerObserver = typeof MutationObserver === "function"
      ? new MutationObserver(syncMenuLayer)
      : null;
    windowLayerObserver?.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style"]
    });

    const positionMenu = () => {
      const anchorBounds = anchor?.getBoundingClientRect?.() ?? null;
      const targetX = toNumber(anchorBounds?.right, x);
      const targetY = toNumber(anchorBounds?.bottom, y);
      const bounds = menuRoot.getBoundingClientRect();
      const maxLeft = window.innerWidth - bounds.width - 8;
      const maxTop = window.innerHeight - bounds.height - 8;
      const safeLeft = Math.max(8, Math.min(targetX, maxLeft));
      const safeTop = Math.max(8, Math.min(targetY, maxTop));

      menuRoot.style.left = `${safeLeft}px`;
      menuRoot.style.top = `${safeTop}px`;
    };
    positionMenu();

    const handlePointerDown = (event) => {
      if (!menuRoot.contains(event.target)) {
        this.#closeContextMenu();
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        this.#closeContextMenu();
      }
    };
    const handleAnchorChange = () => {
      if (anchor?.isConnected === false) {
        this.#closeContextMenu();
        return;
      }
      positionMenu();
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    if (anchor) {
      document.addEventListener("scroll", handleAnchorChange, true);
      window.addEventListener?.("resize", handleAnchorChange);
    }

    this.contextMenuCleanup = () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
      if (anchor) {
        document.removeEventListener("scroll", handleAnchorChange, true);
        window.removeEventListener?.("resize", handleAnchorChange);
      }
      windowLayerObserver?.disconnect();
      menuRoot.remove();
    };
  }

  async #runInventoryFolderMutation(operation, { successMessage, errorMessage }) {
    try {
      const result = await operation();
      ui.notifications?.info(successMessage);
      return result;
    }
    catch (error) {
      console.error(`${MODULE_ID} | Inventory folder action failed.`, error);
      try {
        await this.refreshInventorySnapshot({ preserveScroll: true });
      }
      catch (refreshError) {
        console.error(`${MODULE_ID} | Failed to refresh inventory folders after command error.`, refreshError);
      }
      ui.notifications?.error(error.message || errorMessage);
      return null;
    }
  }

  async #runInventoryRuleMutation(operation) {
    try {
      const result = await operation();
      this.inventoryRuleDraft = null;
      this.inventoryRuleDraftError = "";
      await this.refreshInventorySnapshot({ preserveScroll: true });
      return result;
    }
    catch (error) {
      this.inventoryRuleDraftError = error?.message || "Не удалось сохранить правило фильтрации.";
      this.inventorySnapshotCache = null;
      this.inventoryFolderTreeCache = null;
      this.inventorySearchIndexCache = null;
      this.inventoryContextCache = null;
      await this.render({ force: true, preserveScroll: true });
      globalThis.ui?.notifications?.error?.(this.inventoryRuleDraftError);
      return null;
    }
  }

  async #saveInventoryRuleDraft() {
    let rule;
    try {
      rule = this.#normalizeInventoryRuleDraft();
      this.inventoryRuleDraftError = "";
    }
    catch (error) {
      this.inventoryRuleDraftError = error?.message || "Заполните правило.";
      this.inventorySearchRenderPending = true;
      await this.render({ force: true, preserveScroll: true });
      return null;
    }
    const expectedRevision = normalizeInventoryIngressRuleState(
      this.inventorySnapshotCache?.inventoryIngressRules ?? null
    ).revision;
    const payload = {
      groupActorId: this.inventoryActorId,
      operationId: globalThis.crypto.randomUUID(),
      expectedRevision,
      rule
    };
    return this.#runInventoryRuleMutation(() => (
      this.inventoryRuleDraft.mode === "edit"
        ? this.moduleApi.updateInventoryIngressRule(payload)
        : this.moduleApi.createInventoryIngressRule(payload)
    ));
  }

  async #deleteInventoryRule(ruleId) {
    const expectedRevision = normalizeInventoryIngressRuleState(
      this.inventorySnapshotCache?.inventoryIngressRules ?? null
    ).revision;
    return this.#runInventoryRuleMutation(() => this.moduleApi.deleteInventoryIngressRule({
      groupActorId: this.inventoryActorId,
      operationId: globalThis.crypto.randomUUID(),
      expectedRevision,
      ruleId
    }));
  }

  async #createInventoryFolder(parentId = null) {
    let name;
    let folderId;
    try {
      name = await promptInventoryFolderName({
        title: parentId ? "Создать вложенную папку" : "Создать папку",
        confirmLabel: "Создать"
      });
      if (name === null) return null;
      folderId = createInventoryFolderId();
    }
    catch (error) {
      ui.notifications?.error(error.message || "Не удалось подготовить создание папки.");
      return null;
    }

    const groupActorId = this.inventoryActorId;
    return this.#runInventoryFolderMutation(
      () => this.moduleApi.createInventoryFolder({
        groupActorId,
        folderId,
        name,
        parentId: cleanText(parentId) || null
      }),
      {
        successMessage: `Папка «${name}» создана.`,
        errorMessage: "Не удалось создать папку."
      }
    );
  }

  async #renameInventoryFolder(folderId, initialName) {
    let name;
    try {
      name = await promptInventoryFolderName({
        title: "Переименовать папку",
        initialName,
        confirmLabel: "Переименовать"
      });
      if (name === null) return null;
    }
    catch (error) {
      ui.notifications?.error(error.message || "Не удалось подготовить переименование папки.");
      return null;
    }

    const groupActorId = this.inventoryActorId;
    return this.#runInventoryFolderMutation(
      () => this.moduleApi.renameInventoryFolder({ groupActorId, folderId, name }),
      {
        successMessage: `Папка переименована в «${name}».`,
        errorMessage: "Не удалось переименовать папку."
      }
    );
  }

  async #deleteInventoryFolder(folderId, folderName) {
    const safeName = cleanText(folderName) || "Папка";
    const confirmed = await confirmAction(
      "Удалить папку",
      `<p>Удалить папку «${foundry.utils.escapeHTML(safeName)}»?</p>
       <p>Предметы и вложенные папки будут перемещены на один уровень выше и не будут удалены.</p>`
    );
    if (!confirmed) return null;

    const groupActorId = this.inventoryActorId;
    return this.#runInventoryFolderMutation(
      () => this.moduleApi.deleteInventoryFolder({ groupActorId, folderId }),
      {
        successMessage: `Папка «${safeName}» удалена.`,
        errorMessage: "Не удалось удалить папку."
      }
    );
  }

  async #openInventoryFolderPopout(folderId) {
    const groupActorId = this.inventoryActorId;
    if (typeof this.moduleApi.openInventoryFolderPopout !== "function") {
      ui.notifications?.error("Отдельное окно папки пока недоступно.");
      return null;
    }
    return this.moduleApi.openInventoryFolderPopout(groupActorId, folderId);
  }

  #openInventoryFolderContextMenu(row, { x = 0, y = 0, anchor = null } = {}) {
    if (!(row instanceof HTMLElement) || !this.canOrganizeInventory) return;

    const folderId = cleanText(row.dataset.folderId);
    const folderName = cleanText(row.dataset.folderName) || "Папка";
    if (!folderId) return;

    const actions = [
      {
        label: "Создать вложенную папку",
        icon: "fa-solid fa-folder-plus",
        disabled: row.dataset.canCreateChild === "false",
        callback: () => this.#createInventoryFolder(folderId)
      },
      {
        label: "Переименовать",
        icon: "fa-solid fa-pen",
        callback: () => this.#renameInventoryFolder(folderId, folderName)
      },
      {
        label: "Открыть отдельно",
        icon: "fa-solid fa-up-right-from-square",
        callback: () => this.#openInventoryFolderPopout(folderId)
      },
      {
        label: "Удалить",
        icon: "fa-solid fa-trash",
        danger: true,
        callback: () => this.#deleteInventoryFolder(folderId, folderName)
      }
    ];

    this.#openContextMenu({ x, y, anchor, title: folderName, actions });
  }

  #resolveInventoryDropTarget(event, dropzone) {
    const eventTarget = event?.target instanceof HTMLElement
      ? event.target
      : event?.target?.parentElement ?? null;
    if (!eventTarget) return null;

    const itemTarget = eventTarget.closest?.(".rm-inventory-tree-row--item[data-item-id]") ?? null;
    if (itemTarget && dropzone.contains(itemTarget)) {
      return {
        folderId: null,
        targetElement: itemTarget,
        highlightElement: itemTarget
      };
    }

    let targetElement = eventTarget.closest?.("[data-folder-drop-id]") ?? null;
    if (!targetElement && dropzone.contains(eventTarget)) targetElement = dropzone;
    if (!targetElement || (targetElement !== dropzone && !dropzone.contains(targetElement))) return null;

    const folderId = cleanText(targetElement.dataset?.folderDropId) || null;
    if (folderId !== null && !this.inventoryFolderTreeCache?.foldersById.has(folderId)) return null;
    return {
      folderId,
      targetElement,
      highlightElement: targetElement.closest?.(".rm-inventory-folder-row[data-folder-id]") ?? targetElement
    };
  }

  #resolveInventoryDropAction(dragData, folderId) {
    if (!this.canDropInventoryItems || !this.inventoryFolderTreeCache) return null;
    const internal = readInventoryTreeDragData(dragData);
    if (internal) {
      if (internal.groupActorId !== this.inventoryActorId) return null;
      if (internal.kind === "folder") {
        if (!this.inventoryFolderTreeCache.foldersById.has(internal.folderId)) return null;
        if (folderId === internal.folderId) return null;
        let currentId = folderId;
        while (currentId !== null) {
          if (currentId === internal.folderId) return null;
          currentId = this.inventoryFolderTreeCache.foldersById.get(currentId)?.parentId ?? null;
        }
        return { kind: "folder", internal };
      }
      if (!this.inventoryFolderTreeCache.itemsById.has(internal.itemId)) return null;
      return { kind: "item", internal };
    }

    if (hasInventoryTreeDragMetadata(dragData)) return null;
    return dragData?.type === "Item" ? { kind: "external", dragData } : null;
  }

  async #applyInventoryDrop(action, folderId) {
    const groupActorId = this.inventoryActorId;
    if (action.kind === "folder") {
      return this.moduleApi.moveInventoryFolder({
        groupActorId,
        folderId: action.internal.folderId,
        parentId: folderId
      });
    }
    if (action.kind === "item") {
      return this.moduleApi.moveInventoryItemToFolder({
        groupActorId,
        itemId: action.internal.itemId,
        folderId
      });
    }
    return this.moduleApi.importInventoryDrop(action.dragData, { groupActorId, folderId });
  }

  #openItemContextMenu(row, { x = 0, y = 0, anchor = null } = {}) {
    if (!(row instanceof HTMLElement)) {
      return;
    }

    const itemName = String(row.dataset.itemName ?? "Предмет").trim() || "Предмет";
    const actionButtons = {
      takeSelf: row.querySelector("[data-action='take-item-self']"),
      sellItem: row.querySelector("[data-action='sell-item']"),
      editQuantity: row.querySelector("[data-action='edit-item-quantity']"),
      breakItem: row.querySelector("[data-action='break-item']"),
      deleteItem: row.querySelector("[data-action='delete-item']")
    };

    const actions = [];
    if (actionButtons.takeSelf) {
      actions.push({
        label: "Забрать себе",
        icon: "fa-solid fa-hand-holding",
        callback: () => actionButtons.takeSelf.click()
      });
    }
    if (actionButtons.sellItem) {
      actions.push({
        label: "Продать",
        icon: "fa-solid fa-coins",
        callback: () => actionButtons.sellItem.click()
      });
    }
    if (actionButtons.editQuantity) {
      actions.push({
        label: "Изменить количество",
        icon: "fa-solid fa-pen",
        callback: () => actionButtons.editQuantity.click()
      });
    }
    if (actionButtons.breakItem) {
      actions.push({
        label: "Разобрать",
        icon: "fa-solid fa-hammer",
        callback: () => actionButtons.breakItem.click()
      });
    }
    if (actionButtons.deleteItem) {
      actions.push({
        label: "Удалить",
        icon: "fa-solid fa-trash",
        danger: true,
        callback: () => actionButtons.deleteItem.click()
      });
    }

    this.#openContextMenu({
      x,
      y,
      anchor,
      title: itemName,
      actions
    });
  }

  async #openPartyMemberSheet(actorId, actorName = "участника") {
    const safeActorId = String(actorId ?? "").trim();
    const safeActorName = String(actorName ?? "участника").trim() || "участника";
    if (!safeActorId) {
      return;
    }

    try {
      const actor = game.actors?.get(safeActorId) ?? null;
      if (!actor) {
        ui.notifications?.warn(`Лист участника «${safeActorName}» не найден.`);
        return;
      }

      await actor.sheet?.render?.(true);
      bringAppToFront(actor.sheet);
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to open party member sheet.`, error);
      ui.notifications?.error(error.message || "Не удалось открыть лист участника.");
    }
  }

  async #removePartyMember(actorId, actorName, element) {
    const safeActorId = String(actorId ?? "").trim();
    const safeActorName = String(actorName ?? "участника").trim() || "участника";
    if (!safeActorId) {
      return;
    }

    const confirmed = await confirmAction(
      "Удалить из группы",
      `<p>Удалить «${foundry.utils.escapeHTML(safeActorName)}» из состава группы?</p>`
    );
    if (!confirmed) {
      return;
    }

    try {
      this.#rememberExpandedPartyMembers(element);
      await this.moduleApi.removePartyMember(safeActorId);
      this.#setActionFeedback("success", `Участник «${safeActorName}» удалён из группы.`);
      ui.notifications?.info(`Участник «${safeActorName}» удалён из группы.`);
      bringAppToFront(this);
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to remove party member.`, error);
      const message = error.message || "Не удалось удалить участника группы.";
      this.#setActionFeedback("error", message);
      this.render({ force: true });
      ui.notifications?.error(message);
    }
  }

  async #resolveDroppedActor(dragData) {
    if (!dragData || typeof dragData !== "object") {
      return null;
    }

    const droppedDocument = dragData.uuid ? await fromUuid(dragData.uuid) : null;
    if (droppedDocument instanceof Actor) {
      return droppedDocument;
    }

    if (droppedDocument?.actor instanceof Actor) {
      return droppedDocument.actor;
    }

    if (dragData.type === "Actor" && dragData.id) {
      return game.actors.get(dragData.id) ?? null;
    }

    return null;
  }

  #prepareDowntimeContext(snapshot = {}, warning = "") {
    if (!snapshot || warning) {
      return buildEmptyDowntimeContext({
        warning,
        grantWeeks: this.downtimeGrantWeeks,
        grantActorId: this.downtimeGrantActorId,
        requestActorId: this.downtimeRequestActorId,
        requestActionId: this.downtimeRequestActionId,
        requestWeeks: this.downtimeRequestWeeks,
        requestTitle: this.downtimeRequestTitle,
        requestDescription: this.downtimeRequestDescription
      });
    }

    const members = (snapshot.members ?? []).map((member) => {
      const balance = member.balance ?? {};
      return {
        ...member,
        availableWorkdays: toInteger(balance.availableWorkdays, toInteger(balance.availableWeeks, 0) * 5),
        reservedWorkdays: toInteger(balance.reservedWorkdays, toInteger(balance.reservedWeeks, 0) * 5),
        spentWorkdays: toInteger(balance.spentWorkdays, toInteger(balance.spentWeeks, 0) * 5),
        totalGrantedWorkdays: toInteger(balance.totalGrantedWorkdays, toInteger(balance.totalGrantedWeeks, 0) * 5),
        availableWeeks: toInteger(balance.availableWeeks, 0),
        reservedWeeks: toInteger(balance.reservedWeeks, 0),
        spentWeeks: toInteger(balance.spentWeeks, 0),
        totalGrantedWeeks: toInteger(balance.totalGrantedWeeks, 0)
      };
    });
    const grantActorIds = new Set(members.map((member) => member.actorId));
    if (this.downtimeGrantActorId !== "all" && !grantActorIds.has(this.downtimeGrantActorId)) {
      this.downtimeGrantActorId = "all";
    }

    const requestMembers = members.filter((member) => member.canSubmit);
    if (!requestMembers.some((member) => member.actorId === this.downtimeRequestActorId)) {
      this.downtimeRequestActorId = requestMembers[0]?.actorId ?? "";
    }

    const actionCatalog = snapshot.actionCatalog ?? [];
    if (!actionCatalog.some((action) => action.id === this.downtimeRequestActionId)) {
      this.downtimeRequestActionId = actionCatalog[0]?.id ?? "";
    }

    const canManageDowntime = Boolean(snapshot.canManage);
    const canSubmitDowntime = Boolean(snapshot.canSubmit && requestMembers.length);
    const grantDisabled = !canManageDowntime || members.length === 0;
    const submitDisabled = !canSubmitDowntime || !this.downtimeRequestActorId || actionCatalog.length === 0;

    const actionCatalogById = new Map(actionCatalog.flatMap((action) => {
      const ids = [
        cleanText(action.id),
        cleanText(action.templateUuid),
        cleanText(action.templateItemId)
      ].filter(Boolean);
      return ids.map((id) => [id, action]);
    }));
    const allRequests = (snapshot.requests ?? []).map((request) => mapDowntimeRequest(request, actionCatalogById));
    const activeRequests = allRequests.filter((request) => !request.isArchived);
    const archiveRequests = allRequests.filter((request) => request.isArchived);
    const queuePage = paginateDowntimeRequests(activeRequests, this.downtimeQueuePage);
    const archivePage = paginateDowntimeRequests(archiveRequests, this.downtimeArchivePage);
    this.downtimeQueuePage = queuePage.current;
    this.downtimeArchivePage = archivePage.current;
    const visiblePage = this.downtimeShowArchive ? archivePage : queuePage;
    const rawVisibleRequests = this.downtimeShowArchive ? archivePage.items : queuePage.items;
    let selectedRequest = rawVisibleRequests.find((request) => request.id === this.downtimeSelectedRequestId) ?? null;
    if (!selectedRequest) {
      selectedRequest = rawVisibleRequests[0] ?? null;
      this.downtimeSelectedRequestId = selectedRequest?.id ?? "";
    }
    const visibleRequests = rawVisibleRequests.map((request) => ({
      ...request,
      isSelected: request.id === selectedRequest?.id
    }));
    selectedRequest = visibleRequests.find((request) => request.id === selectedRequest?.id) ?? selectedRequest;

    return {
      members,
      requests: queuePage.items,
      archiveRequests: archivePage.items,
      visibleRequests,
      selectedRequest,
      showArchive: this.downtimeShowArchive,
      visiblePage,
      visibleRequestCount: visiblePage.count,
      requestPage: queuePage,
      archivePage,
      requestCount: activeRequests.length,
      archiveCount: archiveRequests.length,
      actionOptions: actionCatalog.map((action) => ({
        value: action.id,
        label: action.label ?? action.id,
        selected: action.id === this.downtimeRequestActionId
      })),
      grantActorOptions: [
        {
          value: "all",
          label: "Всем участникам",
          selected: this.downtimeGrantActorId === "all"
        },
        ...members.map((member) => ({
          value: member.actorId,
          label: member.actorName,
          selected: member.actorId === this.downtimeGrantActorId
        }))
      ],
      requestActorOptions: requestMembers.map((member) => ({
        value: member.actorId,
        label: member.actorName,
        selected: member.actorId === this.downtimeRequestActorId
      })),
      canManage: canManageDowntime,
      canSubmit: canSubmitDowntime,
      warning: "",
      grantWeeks: this.downtimeGrantWeeks,
      grantActorId: this.downtimeGrantActorId,
      requestActorId: this.downtimeRequestActorId,
      requestActionId: this.downtimeRequestActionId,
      requestWeeks: this.downtimeRequestWeeks,
      requestTitle: this.downtimeRequestTitle,
      requestDescription: this.downtimeRequestDescription,
      grantDisabled,
      grantDisabledReason: grantDisabled
        ? (canManageDowntime ? "Нет участников для выдачи простоя." : "Только мастер может выдавать недели простоя.")
        : "",
      submitDisabled,
      submitDisabledReason: submitDisabled
        ? (canSubmitDowntime ? "Заполните персонажа и действие." : "Нет доступных персонажей для заявки.")
        : "",
      emptyMembers: members.length === 0,
      emptyRequests: activeRequests.length === 0,
      emptyArchiveRequests: archiveRequests.length === 0,
      emptyVisibleRequests: visibleRequests.length === 0
    };
  }

  #newInventoryRuleDraft(rule = null) {
    const source = rule ? foundry.utils.deepClone(rule) : null;
    return {
      mode: source ? "edit" : "create",
      id: cleanText(source?.id) || globalThis.crypto.randomUUID(),
      name: cleanText(source?.name),
      conditions: (source?.conditions?.length ? source.conditions : [{
        field: "sourceType",
        operator: "is",
        value: ""
      }]).map((condition) => ({
        field: cleanText(condition.field) || "sourceType",
        operator: cleanText(condition.operator) || "is",
        valueText: Array.isArray(condition.value) ? condition.value.join(", ") : String(condition.value ?? "")
      })),
      actionType: cleanText(source?.action?.type) || "folder",
      folderId: cleanText(source?.action?.folderId) || ""
    };
  }

  #parseInventoryRuleCondition(condition) {
    const definition = INVENTORY_INGRESS_RULE_FIELD_DEFINITIONS[condition.field];
    const text = String(condition.valueText ?? "").trim();
    if (!definition || !definition.operators.includes(condition.operator) || !text) {
      throw new Error("Заполните поле, оператор и значение каждого условия.");
    }
    let value = text;
    if (definition.kind === "number") {
      value = condition.operator === "between"
        ? text.split(",").map((entry) => Number(entry.trim()))
        : Number(text);
    }
    else if (definition.kind === "boolean") {
      if (!["true", "false"].includes(text.toLowerCase())) {
        throw new Error("Логическое значение должно быть true или false.");
      }
      value = text.toLowerCase() === "true";
    }
    else if (condition.operator === "in" || condition.operator === "notIn") {
      value = text.split(",").map((entry) => entry.trim()).filter(Boolean);
    }
    return { field: condition.field, operator: condition.operator, value };
  }

  #normalizeInventoryRuleDraft() {
    const draft = this.inventoryRuleDraft;
    if (!draft) throw new Error("Черновик правила не найден.");
    const action = draft.actionType === "folder"
      ? { type: "folder", folderId: cleanText(draft.folderId) }
      : { type: draft.actionType };
    return normalizeInventoryIngressRule({
      id: cleanText(draft.id),
      name: cleanText(draft.name),
      conditions: draft.conditions.map((condition) => this.#parseInventoryRuleCondition(condition)),
      action
    });
  }

  #prepareInventoryRuleDraftContext(folderOptions) {
    if (!this.inventoryRuleDraft) return null;
    const draft = this.inventoryRuleDraft;
    return {
      ...draft,
      conditions: draft.conditions.map((condition, index) => {
        const definition = INVENTORY_INGRESS_RULE_FIELD_DEFINITIONS[condition.field]
          ?? INVENTORY_INGRESS_RULE_FIELD_DEFINITIONS.sourceType;
        return {
          ...condition,
          index,
          invalid: !cleanText(condition.valueText),
          isBoolean: definition.kind === "boolean",
          isNumber: definition.kind === "number" && condition.operator !== "between",
          booleanOptions: ["true", "false"].map((value) => ({
            value,
            label: value === "true" ? "Да" : "Нет",
            selected: value === String(condition.valueText).toLowerCase()
          })),
          fieldOptions: Object.keys(INVENTORY_INGRESS_RULE_FIELD_DEFINITIONS).map((value) => ({
            value,
            label: value,
            selected: value === condition.field
          })),
          operatorOptions: definition.operators.map((value) => ({
            value,
            label: value,
            selected: value === condition.operator
          }))
        };
      }),
      actionOptions: INVENTORY_RULE_ACTION_OPTIONS.map((option) => ({
        ...option,
        selected: option.value === draft.actionType
      })),
      showFolder: draft.actionType === "folder",
      folderOptions: folderOptions.map((folder) => ({
        value: folder.id,
        label: folder.name,
        selected: folder.id === draft.folderId
      }))
    };
  }

  #inventoryRuleContext() {
    const state = normalizeInventoryIngressRuleState(
      this.inventorySnapshotCache?.inventoryIngressRules ?? null
    );
    const folders = this.inventorySnapshotCache?.folders ?? [];
    return {
      inventoryFiltersActive: this.inventoryMode === "filters",
      inventoryRulesRevision: state.revision,
      inventoryRules: state.rules.map((rule) => ({
        ...rule,
        conditionLabels: rule.conditions.map((condition) => (
          `${condition.field} ${condition.operator} ${Array.isArray(condition.value) ? condition.value.join(", ") : condition.value}`
        )),
        actionLabel: rule.action.type === "folder"
          ? `Папка: ${folders.find((folder) => folder.id === rule.action.folderId)?.name ?? rule.action.folderId}`
          : rule.action.type === "skip" ? "Пропустить" : "Разобрать"
      })),
      inventoryRuleDraft: this.#prepareInventoryRuleDraftContext(folders),
      inventoryRuleDraftError: this.inventoryRuleDraftError
    };
  }

  #projectCachedInventoryContext() {
    if (!this.inventoryContextCache || !this.inventoryFolderTreeCache || !this.inventorySearchIndexCache) {
      return null;
    }

    this.sortMode = normalizeInventorySortMode(this.sortMode);
    sortInventoryFolderTreeItems(this.inventoryFolderTreeCache.root, this.sortMode);
    const projection = projectInventoryFolderRows({
      tree: this.inventoryFolderTreeCache,
      searchIndex: this.inventorySearchIndexCache,
      rootFolderId: this.rootFolderId,
      expandedFolderIds: [...this.expandedFolderIds],
      search: this.search,
      typeFilter: this.typeFilter
    });
    const inventoryRows = projection.rows.map((row) => ({
      ...row,
      isFolder: row.kind === "folder",
      isItem: row.kind === "item",
      isCollapsed: row.kind === "folder" && !row.expanded
    }));
    const inventory = inventoryRows.filter((row) => row.kind === "item");
    const inventoryRootFolder = projection.rootFolder
      ? {
          folderId: projection.rootFolder.folderId,
          name: projection.rootFolder.name,
          parentId: projection.rootFolder.parentId
        }
      : null;

    return {
      ...this.inventoryContextCache,
      ...this.#inventoryRuleContext(),
      search: this.search,
      typeFilter: this.typeFilter,
      inventoryActorId: this.inventoryActorId,
      inventoryRootFolder,
      inventoryRootFolderMissing: projection.rootFolderMissing,
      inventoryRows,
      inventory,
      inventoryCount: projection.visibleItemCount,
      emptyInventory: inventoryRows.length === 0,
      expandedFolderIds: [...this.expandedFolderIds],
      typeOptions: this.inventoryContextCache.typeOptions.map((option) => ({
        ...option,
        selected: option.value === this.typeFilter
      })),
      sortMode: this.sortMode,
      sortOptions: INVENTORY_SORT_OPTIONS.map((option) => ({
        ...option,
        selected: option.value === this.sortMode
      }))
    };
  }

  #applyInventoryRootLifecycle(context) {
    if (!this.rootFolderId || !context) {
      return context;
    }

    if (context.inventoryRootFolder) {
      this.missingRootCloseScheduled = false;
      this.options ??= {};
      this.options.window ??= {};
      this.options.window.title = context.inventoryRootFolder.name;
      return context;
    }

    if (context.inventoryRootFolderMissing && !this.missingRootCloseScheduled) {
      this.missingRootCloseScheduled = true;
      globalThis.queueMicrotask?.(() => {
        globalThis.ui?.notifications?.info?.("Папка инвентаря удалена. Её содержимое перемещено на один уровень выше.");
        void this.close?.();
      });
    }
    return {
      ...context,
      inventoryRows: [],
      inventory: [],
      inventoryCount: 0,
      emptyInventory: true
    };
  }

  async _prepareContext() {
    if (this.inventorySearchRenderPending) {
      this.inventorySearchRenderPending = false;
      const cachedContext = this.#projectCachedInventoryContext();
      if (cachedContext) return this.#applyInventoryRootLifecycle(cachedContext);
    }
    this.inventorySearchRenderPending = false;
    this.calendarDowntimeByIsoDate = {};
    this.groupActor = null;
    try {
      const inventorySnapshot = await this.moduleApi.getInventorySnapshot({
        createActor: false,
        groupActorId: this.groupActorId
      });
      this.inventorySnapshotCache = inventorySnapshot;
      const inventoryItems = inventorySnapshot.allItems ?? inventorySnapshot.items ?? [];
      const itemFolderIds = Object.fromEntries(inventoryItems
        .map((item) => [cleanText(item?.itemId ?? item?.id), cleanText(item?.folderId) || null])
        .filter(([itemId]) => itemId));
      this.inventoryFolderTreeCache = buildInventoryFolderTree({
        state: {
          version: inventorySnapshot.folderStateVersion,
          folders: inventorySnapshot.folders ?? [],
          itemFolderIds
        },
        items: inventoryItems,
        compareItems: (left, right) => compareInventoryEntries(left, right, this.sortMode)
      });
      this.inventorySearchIndexCache = buildInventoryFolderSearchIndex(this.inventoryFolderTreeCache, {
        itemText: (item) => [
          item?.name,
          item?.itemTypeLabel,
          item?.materialLabel,
          item?.sourceTypeLabel
        ].join(" ")
      });
      const folderIds = [...this.inventoryFolderTreeCache.foldersById.keys()];
      const inventoryActorId = this.inventoryActorId;
      const folderUiState = inventoryActorId
        ? await this.moduleApi.getInventoryFolderUiState?.(inventoryActorId, folderIds)
        : null;
      this.expandedFolderIds = new Set(normalizeExpandedFolderIds(folderUiState?.expandedFolderIds, { folderIds }));
      let group = null;
      let groupContextError = String(inventorySnapshot.groupContextError ?? "").trim();
      try {
        const groupContext = this.moduleApi.getGroupContext?.() ?? null;
        const groupActor = groupContext?.groupActor ?? null;
        if (groupActor) {
          this.groupActor = groupActor;
          group = {
            id: groupContext.groupId ?? groupActor.id ?? "",
            name: groupActor.name ?? "Группа",
            crestUrl: resolvePartyInventoryCrest(groupActor),
            memberCount: toInteger(
              groupContext.memberActorIds?.length
                ?? groupContext.members?.length
                ?? groupActor.system?.members?.length,
              0
            )
          };
          groupContextError = "";
        }
      }
      catch (error) {
        if (![
          GROUP_CONTEXT_ERRORS.GM_NO_ACTIVE_GROUP,
          GROUP_CONTEXT_ERRORS.PLAYER_NO_GROUP
        ].includes(error?.message)) {
          throw error;
        }

        groupContextError = groupContextError || error.message || "Не удалось определить группу Rebreya.";
      }
      const partySnapshot = await this.moduleApi.getPartySnapshot();
      const craftSnapshot = await this.moduleApi.getCraftSnapshot({
        search: this.craftSearch,
        crafterActorId: this.craftCrafterActorId
      });
      const calendarSnapshot = this.moduleApi.getCalendarSnapshot();
      let travelSnapshot = null;
      let travelWarning = "";
      try {
        if (this.pendingTravelSnapshot !== null) {
          travelSnapshot = this.pendingTravelSnapshot;
          this.pendingTravelSnapshot = null;
        }
        else {
          travelSnapshot = await this.moduleApi.getTravelSnapshot?.();
        }
      }
      catch (error) {
        if (!isKnownGroupContextError(error)) {
          throw error;
        }

        travelWarning = error.message || "Не удалось определить группу Rebreya.";
      }
      let transportSnapshot = null;
      let transportWarning = "";
      try {
        transportSnapshot = await this.moduleApi.getTransportSnapshot?.({
          partySnapshot,
          inventorySnapshot
        });
      }
      catch (error) {
        if (!isKnownGroupContextError(error)) {
          throw error;
        }

        transportWarning = error.message || "Не удалось определить группу Rebreya.";
      }
      let downtimeSnapshot = null;
      let downtimeWarning = "";
      try {
        downtimeSnapshot = await this.moduleApi.getDowntimeSnapshot();
      }
      catch (error) {
        if (!isKnownGroupContextError(error)) {
          throw error;
        }

        downtimeWarning = error.message || "Не удалось определить группу Rebreya.";
      }
      const availableActors = partySnapshot.availableActors ?? [];
      this.availablePartyActors = availableActors.map((actor) => ({
        id: actor.id,
        name: actor.name
      }));
      const totalCapacityLb = toNumber(partySnapshot.totalCapacityLb, 0);
      const inventoryWeight = toNumber(partySnapshot.inventoryWeight, 0);
      const freeCapacityLb = roundNumber(toNumber(partySnapshot.freeCapacityLb, 0), 2);
      const capacityUsedRawPercent = totalCapacityLb > 0
        ? roundNumber((inventoryWeight / totalCapacityLb) * 100, 1)
        : 0;
      const capacityUsedPercent = totalCapacityLb > 0
        ? Math.min(100, Math.max(0, capacityUsedRawPercent))
        : 0;
      const hasFoodEstimate = partySnapshot.foodDaysLeft !== null;
      const hasWaterEstimate = partySnapshot.waterDaysLeft !== null;
      const foodDaysLeft = hasFoodEstimate ? roundNumber(toNumber(partySnapshot.foodDaysLeft, 0), 1) : null;
      const waterDaysLeft = hasWaterEstimate ? roundNumber(toNumber(partySnapshot.waterDaysLeft, 0), 1) : null;
      const totalFoodPerDay = roundNumber(toNumber(partySnapshot.totalFoodPerDay, 0), 2);
      const totalWaterPerDay = roundNumber(toNumber(partySnapshot.totalWaterGalPerDay, 0), 2);
      const totalEnergyCurrent = toNumber(partySnapshot.totalEnergyCurrent, 0);
      const totalEnergyMax = toNumber(partySnapshot.totalEnergyMax, 0);
      const energyPercent = totalEnergyMax > 0
        ? Math.max(0, Math.min(100, roundNumber((totalEnergyCurrent / totalEnergyMax) * 100, 0)))
        : 0;

      const weightSeverity = resolveCapacitySeverity(freeCapacityLb, capacityUsedRawPercent);
      const foodSeverity = resolveSupplySeverity(foodDaysLeft, hasFoodEstimate);
      const waterSeverity = resolveSupplySeverity(waterDaysLeft, hasWaterEstimate);
      const energySeverity = resolveEnergySeverity(totalEnergyCurrent, totalEnergyMax);
      const overloadLb = roundNumber(Math.abs(freeCapacityLb), 2);

      const dashboard = {
        weight: {
          isOverloaded: freeCapacityLb < 0,
          className: toStateClass(weightSeverity),
          badgeType: toStatusBadgeType(weightSeverity),
          badgeLabel: freeCapacityLb < 0
            ? `Перегруз ${overloadLb} фнт.`
            : `Загрузка ${roundNumber(capacityUsedRawPercent, 1)}%`,
          note: freeCapacityLb < 0
            ? `Свободно: -${overloadLb} фнт.`
            : `Свободно: ${roundNumber(freeCapacityLb, 2)} фнт.`,
          meterClass: `is-${weightSeverity}`,
          meterPercent: capacityUsedPercent
        },
        food: {
          isEmpty: toNumber(inventorySnapshot.summary.foodLb, 0) <= 0,
          className: toStateClass(foodSeverity),
          badgeType: toStatusBadgeType(foodSeverity),
          daysLabel: hasFoodEstimate ? `${foodDaysLeft} дн.` : "Без нормы",
          note: hasFoodEstimate
            ? (foodDaysLeft <= 0 ? "Запас исчерпан" : `Расход ${totalFoodPerDay} / день`)
            : "Задайте расход в группе"
        },
        water: {
          isEmpty: toNumber(inventorySnapshot.summary.waterGal, 0) <= 0,
          className: toStateClass(waterSeverity),
          badgeType: toStatusBadgeType(waterSeverity),
          daysLabel: hasWaterEstimate ? `${waterDaysLeft} дн.` : "Без нормы",
          note: hasWaterEstimate
            ? (waterDaysLeft <= 0 ? "Запас исчерпан" : `Расход ${totalWaterPerDay} / день`)
            : "Задайте расход в группе"
        },
        energy: {
          className: toStateClass(energySeverity),
          badgeType: toStatusBadgeType(energySeverity),
          ratioLabel: `${roundNumber(totalEnergyCurrent, 0)} / ${roundNumber(totalEnergyMax, 0)}`,
          note: totalEnergyMax > 0
            ? `Готовность ${energyPercent}%`
            : "Нет участников"
        }
      };

      const currency = inventorySnapshot.summary.currency ?? {
        pp: 0,
        gp: 0,
        sp: 0,
        cp: 0,
        totalCopper: 0,
        label: inventorySnapshot.summary.currencyLabel
      };
      const currencyDisplay = Object.fromEntries(
        ["pp", "gp", "sp", "cp"].map((denomination) => [
          denomination,
          formatCompactCurrencyAmount(currency[denomination])
        ])
      );
      this.sortMode = normalizeInventorySortMode(this.sortMode);
      const itemValueSummary = buildInventoryValueSummary(inventorySnapshot.allItems ?? inventorySnapshot.items);
      const partyMembers = (partySnapshot.members ?? []).map((member) => {
        const memberInventoryWeight = Math.max(0, toNumber(member.inventoryWeight, 0));
        const memberCapacityLb = Math.max(0, toNumber(member.capacityLb, 0));
        const capacityUsedRawPercent = memberCapacityLb > 0
          ? roundNumber((memberInventoryWeight / memberCapacityLb) * 100, 1)
          : (memberInventoryWeight > 0 ? 100 : 0);

        return {
          ...member,
          inventoryWeight: memberInventoryWeight,
          capacityLb: memberCapacityLb,
          currencyGp: Math.max(0, roundNumber(toNumber(member.currencyGp, 0), 2)),
          capacityUsedRawPercent,
          capacityUsedPercent: Math.min(100, Math.max(0, capacityUsedRawPercent)),
          isOverloaded: memberInventoryWeight > memberCapacityLb,
          expanded: this.expandedPartyMembers.has(member.actorId)
        };
      });
      const membershipManagedByNativeGroup = Boolean(partySnapshot.membershipManagedByNativeGroup);
      const addMemberDisabled = membershipManagedByNativeGroup || availableActors.length === 0;
      const craftHasCrafters = (craftSnapshot.crafters ?? []).length > 0;
      const partyAlerts = [];
      if (freeCapacityLb < 0) {
        partyAlerts.push({
          type: "danger",
          message: `Перегруз: ${overloadLb} фнт.`
        });
      }
      if (hasFoodEstimate && toNumber(foodDaysLeft, 0) <= 0) {
        partyAlerts.push({
          type: "warning",
          message: "Еда закончилась: пополните запас."
        });
      }
      if (hasWaterEstimate && toNumber(waterDaysLeft, 0) <= 0) {
        partyAlerts.push({
          type: "warning",
          message: "Вода закончилась: пополните запас."
        });
      }
      const actionFeedback = this.actionFeedback
        ? {
            ...this.actionFeedback,
            className: `rm-inline-status rm-inline-status--${this.actionFeedback.type}`
          }
        : null;
      const canManage = Boolean(partySnapshot.canManage || inventorySnapshot.actor?.canEdit);
      const canDropInventoryItems = Boolean(
        canManage
        || partySnapshot.canDropInventoryItems
        || inventorySnapshot.canDropInventoryItems
      );
      const canEditCurrency = Boolean(canManage || canDropInventoryItems);
      this.canManage = canManage;
      this.canDropInventoryItems = canDropInventoryItems;
      this.canOrganizeInventory = canDropInventoryItems;
      this.partyMembershipManagedByNativeGroup = membershipManagedByNativeGroup;

      if (!availableActors.some((actor) => actor.id === this.selectedNewMemberId)) {
        this.selectedNewMemberId = "";
      }

      const resolvedActorIdByQuery = this.#resolveAvailableActorIdByName(this.newMemberQuery, this.availablePartyActors);
      if (resolvedActorIdByQuery) {
        this.selectedNewMemberId = resolvedActorIdByQuery;
      }

      if (!String(this.newMemberQuery ?? "").trim() && this.selectedNewMemberId) {
        const selectedActor = availableActors.find((actor) => actor.id === this.selectedNewMemberId) ?? null;
        this.newMemberQuery = selectedActor?.name ?? "";
      }

      if (!craftSnapshot.crafters?.some((entry) => entry.actorId === this.craftCrafterActorId)) {
        this.craftCrafterActorId = craftSnapshot.crafters?.[0]?.actorId ?? "";
      }

      const downtime = this.#prepareDowntimeContext(downtimeSnapshot, downtimeWarning);
      const craftPendingRequests = (downtimeSnapshot?.requests ?? [])
        .filter((request) => request?.craftProject && request.status === "pending")
        .map((request) => {
          const outputs = Array.isArray(request.craftProject?.outputs) ? request.craftProject.outputs : [];
          return {
            ...request,
            outputLabel: outputs.map((output) => {
              const label = cleanText(output?.name) || cleanText(output?.sourceId) || "Предмет";
              const quantity = Math.max(1, toInteger(output?.quantity, 1));
              return quantity > 1 ? `${label} x${quantity}` : label;
            }).join(", ") || "Предмет",
            hoursPerDay: Math.max(8, toInteger(request.craftProject?.hoursPerDay, 8)),
            workshopLabel: request.craftProject?.ownedWorkshop === true ? "Собственная" : "Городская"
          };
        });
      const craftProjects = (craftSnapshot.projects ?? []).map((project) => {
        const targetGold = Math.max(0, toNumber(project.targetGold, 0));
        const progressGold = Math.max(0, toNumber(project.progressGold, 0));
        const progressPercent = targetGold > 0
          ? Math.max(0, Math.min(100, roundNumber((progressGold / targetGold) * 100, 1)))
          : (project.status === "completed" ? 100 : 0);
        const operationalStatus = cleanText(project.operationalStatus);
        const status = cleanText(project.status);
        const reconciliationRequired = project.reconciliation?.required === true;
        return {
          ...project,
          outputLabel: (project.outputs ?? []).map((output) => {
            const label = cleanText(output?.name) || cleanText(output?.sourceId) || "Предмет";
            const quantity = Math.max(1, toInteger(output?.quantity, 1));
            return quantity > 1 ? `${label} x${quantity}` : label;
          }).join(", ") || project.id,
          progressPercent,
          remainingGold: Math.max(0, roundNumber(targetGold - progressGold, 2)),
          workshopLabel: project.ownedWorkshop === true ? "Собственная" : "Городская",
          statusLabel: status === "completed"
            ? "Завершён"
            : status === "cancelled"
              ? "Отменён"
              : operationalStatus === "paused"
                ? "На паузе"
                : operationalStatus === "blocked"
                  ? "Заблокирован"
                  : "В работе",
          canPause: ["active", "blocked"].includes(operationalStatus) && !["completed", "cancelled"].includes(status),
          canResume: ["paused", "blocked"].includes(operationalStatus) && !reconciliationRequired,
          canReconcile: reconciliationRequired,
          canCancel: !["completed", "cancelled"].includes(status)
        };
      });
      const travel = prepareTravelContext(travelSnapshot ?? buildEmptyTravelContext({ warning: travelWarning }), this.travelTrackTime);
      const transport = prepareTransportContext(transportSnapshot ?? buildEmptyTransportContext({ warning: transportWarning }));
      this.transportContext = transport;
      const calendarCells = buildCalendarDowntimeCells(calendarSnapshot, downtimeSnapshot);
      this.calendarDowntimeByIsoDate = Object.fromEntries(calendarCells.map((cell) => [cell.isoDate, cell.downtime]));

      const context = {
        hasError: false,
        actor: inventorySnapshot.actor ?? {
          id: "",
          name: "Партийный инвентарь",
          img: "icons/svg/item-bag.svg",
          currencyLabel: inventorySnapshot.summary.currencyLabel,
          canEdit: false
        },
        activeTab: this.activeTab,
        activeTabLabel: INVENTORY_TAB_LABELS[this.activeTab] ?? INVENTORY_TAB_LABELS.inventory,
        appDomId: this.id,
        search: this.search,
        typeFilter: this.typeFilter,
        craftSearch: this.craftSearch,
        craftCrafterActorId: this.craftCrafterActorId,
        group,
        partyIdentity: {
          name: group?.name
            ?? inventorySnapshot.actor?.name
            ?? "Партийный инвентарь",
          crestUrl: group?.crestUrl
            ?? resolvePartyInventoryCrest(inventorySnapshot.actor),
          canEditCrest: Boolean(canManage && this.groupActor)
        },
        groupContextError,
        inventoryRows: [],
        inventory: [],
        inventoryCount: 0,
        emptyInventory: true,
        summary: {
          ...inventorySnapshot.summary,
          currency,
          currencyDisplay,
          ...itemValueSummary,
          partyCapacityLb: partySnapshot.totalCapacityLb,
          freeCapacityLb,
          freeCapacityClass: freeCapacityLb < 0 ? "rm-negative" : "rm-positive"
        },
        party: {
          ...partySnapshot,
          freeCapacityLb,
          foodDaysLeft,
          waterDaysLeft,
          members: partyMembers,
          capacityUsedPercent,
          capacityUsedRawPercent,
          alerts: partyAlerts,
          dashboard,
          membershipManagedByNativeGroup,
          addMemberDisabled,
          addMemberDisabledReason: membershipManagedByNativeGroup
            ? "Состав управляется листом группы dnd5e."
            : (addMemberDisabled
              ? "Нет доступных актёров для добавления в группу."
              : ""),
          availableActors: availableActors.map((actor) => ({
            ...actor,
            selected: actor.id === this.selectedNewMemberId
          })),
          addMemberQuery: this.newMemberQuery,
          hasFoodEstimate,
          hasWaterEstimate
        },
        craft: {
          ...craftSnapshot,
          crafters: (craftSnapshot.crafters ?? []).map((entry) => ({
            ...entry,
            selected: entry.actorId === this.craftCrafterActorId
          })),
          pendingRequests: craftPendingRequests,
          pendingRequestCount: craftPendingRequests.length,
          hasPendingRequests: craftPendingRequests.length > 0,
          projects: craftProjects,
          projectCount: craftProjects.length,
          hasProjects: craftProjects.length > 0,
          hasQueue: false,
          hasCrafters: craftHasCrafters,
          queueDisabledReason: craftHasCrafters
            ? ""
            : "Добавьте участника в группу, чтобы запустить крафт."
        },
        calendar: {
          ...calendarSnapshot,
          cells: calendarCells,
          yearValue: calendarSnapshot.year,
          monthValue: calendarSnapshot.month,
          dayValue: calendarSnapshot.day
        },
        travel,
        transport,
        downtime,
        typeOptions: [
          { value: "all", label: "Все", selected: this.typeFilter === "all" },
          { value: "gear", label: "Снаряжение", selected: this.typeFilter === "gear" },
          { value: "material", label: "Материалы", selected: this.typeFilter === "material" },
          { value: "supply", label: "Запасы", selected: this.typeFilter === "supply" },
          { value: "downtime", label: "Простой", selected: this.typeFilter === "downtime" },
          { value: "custom", label: "Прочее", selected: this.typeFilter === "custom" }
        ],
        sortMode: this.sortMode,
        sortOptions: INVENTORY_SORT_OPTIONS.map((option) => ({
          ...option,
          selected: option.value === this.sortMode
        })),
        tabs: {
          isInventory: this.activeTab === "inventory",
          isParty: this.activeTab === "party",
          isCraft: this.activeTab === "craft",
          isCalendar: this.activeTab === "calendar",
          isTravel: this.activeTab === "travel",
          isTransport: this.activeTab === "transport",
          isDowntime: this.activeTab === "downtime"
        },
        actionFeedback,
        canManage,
        canDropInventoryItems,
        canDismantleInventory: canDropInventoryItems,
        canOrganizeInventory: canDropInventoryItems,
        canEditCurrency
      };
      this.inventoryContextCache = context;
      return this.#applyInventoryRootLifecycle(this.#projectCachedInventoryContext());
    }
    catch (error) {
      this.inventorySnapshotCache = null;
      this.inventoryFolderTreeCache = null;
      this.inventorySearchIndexCache = null;
      this.inventoryContextCache = null;
      console.error(`${MODULE_ID} | Failed to prepare inventory app.`, error);
      return {
        hasError: true,
        errorMessage: error.message || "Не удалось подготовить партийный инвентарь."
      };
    }
  }

  async #openItemSheet(itemId) {
    const actor = await this.moduleApi.inventoryService.getInventoryActor({
      create: true,
      groupActorId: this.inventoryActorId
    });
    const item = actor?.items.get(itemId) ?? null;
    if (!item) {
      throw new Error("Предмет уже не найден в складе.");
    }

    await openInventoryItem(item, { moduleApi: this.moduleApi });
  }

  async #promptSupply(resourceKey) {
    const quantity = await promptNumericValue({
      title: resourceKey === "water" ? "Изменить воду" : "Изменить еду",
      label: resourceKey === "water" ? "Сколько галлонов добавить или убрать" : "Сколько фунтов добавить или убрать",
      value: "0",
      step: "0.01",
      confirmLabel: "Изменить",
      allowRelative: true
    });

    if (quantity === null) {
      return;
    }

    await this.moduleApi.addPartySupply(resourceKey, parseQuantityInputValue(quantity, 0, { relative: true }));
    const successMessage = resourceKey === "water"
      ? "Запас воды обновлён."
      : "Запас еды обновлён.";
    this.#setActionFeedback("success", successMessage);
    ui.notifications?.info(successMessage);
    bringAppToFront(this);
  }

  #readCurrencyFromElement(element) {
    const root = element.querySelector("[data-action='edit-currency-root']");
    return {
      pp: toInteger(root?.dataset.currencyPp, 0),
      gp: toInteger(root?.dataset.currencyGp, 0),
      sp: toInteger(root?.dataset.currencySp, 0),
      cp: toInteger(root?.dataset.currencyCp, 0)
    };
  }

  #rememberExpandedPartyMembers(element) {
    const rows = element.querySelectorAll(".rm-party-row[data-actor-id]");
    if (!rows.length) {
      return;
    }

    const expanded = new Set();
    rows.forEach((row) => {
      const actorId = String(row.dataset.actorId ?? "").trim();
      if (actorId && row.open) {
        expanded.add(actorId);
      }
    });
    this.expandedPartyMembers = expanded;
  }

  #restoreFocusToInput(element) {
    const focus = this.focusRestore;
    this.focusRestore = null;
    if (!focus?.action) {
      return;
    }

    const selector = focus.action === "craft-search"
      ? "[data-action='craft-search']"
      : "[data-action='search']";
    const input = element.querySelector(selector);
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    input.focus();
    const start = Math.max(0, Math.min(toInteger(focus.start, input.value.length), input.value.length));
    const end = Math.max(start, Math.min(toInteger(focus.end, input.value.length), input.value.length));
    input.setSelectionRange(start, end);
  }

  async #notifyAdvanceResult(result) {
    const supplyTotals = result?.cycles?.supplyTotals ?? {};
    const craftCompleted = Number(result?.cycles?.craft?.completedCount ?? 0);
    const shortageParts = [];
    const traderReset = result?.traderReset ?? {};

    if (toNumber(supplyTotals.foodShortage, 0) > 0) {
      shortageParts.push(`еда: нехватка ${roundNumber(supplyTotals.foodShortage, 2)}`);
    }
    if (toNumber(supplyTotals.waterShortage, 0) > 0) {
      shortageParts.push(`вода: нехватка ${roundNumber(supplyTotals.waterShortage, 2)}`);
    }

    const shortageText = shortageParts.length ? ` (${shortageParts.join(", ")})` : "";
    const dateLabel = result?.to?.dateLabel ? ` Текущая дата: ${result.to.dateLabel}.` : "";
    const traderResetText = traderReset?.triggered
      ? ` Ассортименты торговцев обновлены (${toInteger(traderReset.monthResetCount, 0)} мес. переходов).`
      : "";
    const eventActivation = result?.eventActivation ?? {};
    const eventText = (toNumber(eventActivation?.started?.length, 0) > 0 || toNumber(eventActivation?.ended?.length, 0) > 0)
      ? ` Ивенты: старт ${toInteger(eventActivation?.started?.length, 0)}, завершение ${toInteger(eventActivation?.ended?.length, 0)}.`
      : "";
    const message = `Пропущено ${result.daysAdvanced} дн.: еда -${roundNumber(supplyTotals.foodSpent ?? 0, 2)}, вода -${roundNumber(supplyTotals.waterSpent ?? 0, 2)}, завершено крафта ${craftCompleted}.${shortageText}${dateLabel}${traderResetText}${eventText}`;
    this.#setActionFeedback("success", message);
    globalThis.window?.setTimeout?.(() => ui.notifications?.info(message), 0);
  }

  async #confirmCalendarTransition(toIsoDate, { processSupplies = false } = {}) {
    const preview = await this.moduleApi.previewCalendarTransition({
      toIsoDate,
      processDowntime: true,
      processSupplies,
      reason: "calendar-ui"
    });
    if (!preview || typeof preview !== "object") {
      throw new Error("Не удалось подготовить изменение даты календаря.");
    }

    const fromLabel = cleanText(preview.from?.dateLabel)
      || cleanText(preview.from?.isoDate)
      || cleanText(preview.fromIsoDate)
      || "—";
    const toLabel = cleanText(preview.to?.dateLabel)
      || cleanText(preview.to?.isoDate)
      || cleanText(preview.toIsoDate)
      || toIsoDate;
    const directionLabel = preview.direction === "backward"
      ? "Назад"
      : (preview.direction === "same" ? "Без изменения" : "Вперёд");
    const crossedCount = Math.max(0, toInteger(
      preview.counts?.crossedDates,
      Array.isArray(preview.crossedDates) ? preview.crossedDates.length : 0
    ));
    const affectedCount = Math.max(0, toInteger(
      preview.counts?.affectedDowntimeRequests,
      preview.affectedRequestCount ?? 0
    ));
    const content = `
      <section class="rm-calendar-transition-confirm">
        <p><strong>Откуда:</strong> ${escapeHtml(fromLabel)}</p>
        <p><strong>Куда:</strong> ${escapeHtml(toLabel)}</p>
        <p><strong>Направление:</strong> ${escapeHtml(directionLabel)}</p>
        <p><strong>Пересечено дней:</strong> ${crossedCount}</p>
        <p><strong>Затронуто заявок:</strong> ${affectedCount}</p>
      </section>
    `;
    const confirmed = await confirmActionOnTop("Изменить дату календаря", content);
    return confirmed ? preview : null;
  }

  async #runCalendarTransition(toIsoDate, { processSupplies = false } = {}) {
    if (this.calendarTransitionPending) {
      return null;
    }

    this.calendarTransitionPending = true;
    try {
      const preview = await this.#confirmCalendarTransition(toIsoDate, { processSupplies });
      if (!preview) {
        return null;
      }

      const expectedFromIsoDate = cleanText(preview.fromIsoDate) || cleanText(preview.from?.isoDate);
      const currentIsoDate = cleanText(this.moduleApi.getCalendarSnapshot()?.isoDate);
      if (!expectedFromIsoDate || currentIsoDate !== expectedFromIsoDate) {
        const message = "Дата календаря изменилась во время подтверждения. Повторите действие с актуальной датой.";
        this.#setActionFeedback("warning", message);
        ui.notifications?.warn?.(message);
        return null;
      }

      const confirmedToIsoDate = cleanText(preview.toIsoDate) || cleanText(preview.to?.isoDate);
      const { year, month, day } = parseCalendarIsoDate(confirmedToIsoDate);
      const options = {
        expectedFromIsoDate,
        processDowntime: true,
        processSupplies,
        processDailyCycles: processSupplies,
        consumeSupplies: processSupplies,
        applyEnergy: processSupplies,
        processCraft: processSupplies,
        refreshApps: false,
        reason: "calendar-ui"
      };
      if (processSupplies) {
        options.monthResetCount = Math.max(0, toInteger(
          preview.monthResetCount,
          preview.counts?.monthBoundaries ?? 0
        ));
      }

      const result = await this.moduleApi.setCalendarDate(year, month, day, options);
      this.render({ force: true })?.catch?.((error) => {
        console.error(`${MODULE_ID} | Failed to refresh inventory calendar after transition.`, error);
      });
      return { preview, result };
    }
    finally {
      this.calendarTransitionPending = false;
    }
  }

  #openCalendarDayInfo(isoDate) {
    const DialogClass = globalThis.Dialog;
    if (typeof DialogClass !== "function") {
      return;
    }

    const downtime = this.calendarDowntimeByIsoDate[isoDate] ?? { entries: [] };
    const entries = Array.isArray(downtime.entries) ? downtime.entries : [];
    const entryHtml = entries.map((entry) => {
      const hoursLabel = entry.hours == null ? "Часы не указаны" : `${entry.hours} ч.`;
      const blockReason = cleanText(entry.blockReason);
      return `
        <article class="rm-calendar-day-entry is-${escapeHtml(entry.status)}">
          <header class="rm-calendar-day-entry__header">
            <strong>${escapeHtml(entry.actorName)}</strong>
            <span class="rm-badge rm-status-badge">${escapeHtml(entry.statusLabel)}</span>
          </header>
          <p>${escapeHtml(entry.title)}</p>
          <div class="rm-calendar-day-entry__meta">
            <span>${escapeHtml(hoursLabel)}</span>
            <span>${escapeHtml(entry.workshopLabel)}</span>
          </div>
          ${blockReason ? `<p class="rm-calendar-day-entry__block-reason"><strong>Причина блокировки:</strong> ${escapeHtml(blockReason)}</p>` : ""}
        </article>
      `;
    }).join("");
    const content = `
      <section class="rm-calendar-day-dialog" data-iso-date="${escapeHtml(isoDate)}">
        ${entryHtml || '<p class="rm-empty">Нет запланированного простоя.</p>'}
      </section>
    `;
    const dialog = new DialogClass({
      title: `Простой: ${escapeHtml(isoDate)}`,
      content,
      buttons: {
        close: {
          label: "Закрыть"
        }
      },
      default: "close"
    }, {
      classes: ["rebreya-main", "rebreya-trader-dialog", "rm-calendar-day-dialog-window"],
      width: 440
    });
    renderDialogOnTop(dialog);
  }

  async #promptDowntimeText(title, message, initialValue = "") {
    const DialogClass = globalThis.Dialog;
    if (typeof DialogClass !== "function") {
      return null;
    }

    return new Promise((resolve) => {
      let settled = false;
      const safeTitle = foundry.utils.escapeHTML(title);
      const safeMessage = foundry.utils.escapeHTML(message);
      const safeInitialValue = foundry.utils.escapeHTML(String(initialValue ?? ""));
      const content = `
        <form class="rm-purchase-dialog rm-downtime-text-dialog">
          <div class="rm-field">
            <label>${safeMessage}</label>
            <textarea rows="4" data-field="downtime-text">${safeInitialValue}</textarea>
          </div>
        </form>
      `;

      const dialog = new DialogClass({
        title: safeTitle,
        content,
        buttons: {
          confirm: {
            label: "Сохранить",
            callback: (html) => {
              const root = getDialogRoot(html);
              const input = root?.querySelector("[data-field='downtime-text']");
              settled = true;
              resolve(input?.value ?? "");
            }
          },
          cancel: {
            label: "Отмена",
            callback: () => {
              settled = true;
              resolve(null);
            }
          }
        },
        default: "confirm",
        render: (html) => {
          const root = getDialogRoot(html);
          const input = root?.querySelector("[data-field='downtime-text']");
          if (input instanceof HTMLElement) {
            input.focus();
          }
        },
        close: () => {
          if (!settled) {
            resolve(null);
          }
        }
      }, {
        classes: ["rebreya-main", "rebreya-trader-dialog"]
      });

      renderDialogOnTop(dialog);
    });
  }

  async #getDowntimeRequestById(requestId) {
    const snapshot = await this.moduleApi.getDowntimeSnapshot();
    return (snapshot?.requests ?? []).find((request) => cleanText(request?.id) === requestId) ?? null;
  }

  async #getDowntimeRequestViewById(requestId) {
    const snapshot = await this.moduleApi.getDowntimeSnapshot();
    const actionCatalog = snapshot?.actionCatalog ?? [];
    const actionCatalogById = new Map(actionCatalog.flatMap((action) => {
      const ids = [
        cleanText(action.id),
        cleanText(action.templateUuid),
        cleanText(action.templateItemId)
      ].filter(Boolean);
      return ids.map((id) => [id, action]);
    }));
    const request = (snapshot?.requests ?? []).find((entry) => cleanText(entry?.id) === requestId) ?? null;
    return request
      ? {
        ...mapDowntimeRequest(request, actionCatalogById),
        canManage: Boolean(snapshot?.canManage)
      }
      : null;
  }

  async #promptDowntimeRequestDetails(request = null) {
    const DialogClass = globalThis.Dialog;
    if (!request || typeof DialogClass !== "function") {
      return null;
    }

    return new Promise((resolve) => {
      const dialog = new DialogClass({
        title: request.displayTitle || "Заявка простоя",
        content: buildDowntimeRequestDialogContent(request, { canManage: Boolean(request.canManage ?? this.canManage) }),
        buttons: {},
        render: (html) => {
          const root = getDialogRoot(html);
          root?.querySelectorAll?.("[data-action='downtime-target-action']").forEach((button) => {
            button.addEventListener("click", async (event) => {
              event.preventDefault?.();
              event.stopPropagation?.();
              try {
                await this.#handleDowntimeTargetAction(event.currentTarget);
              }
              catch (error) {
                console.error(`${MODULE_ID} | Failed to open downtime target action.`, error);
                ui.notifications?.error(error.message || "Не удалось открыть целевое действие простоя.");
              }
            });
          });
          root?.querySelectorAll?.("[data-action='downtime-remove-target-action']").forEach((button) => {
            button.addEventListener("click", async (event) => {
              event.preventDefault?.();
              event.stopPropagation?.();
              try {
                await this.#handleDowntimeRemoveTargetAction(event.currentTarget);
                dialog.close?.();
              }
              catch (error) {
                console.error(`${MODULE_ID} | Failed to remove downtime target action.`, error);
                ui.notifications?.error(error.message || "Не удалось удалить целевое действие простоя.");
              }
            });
          });
        },
        close: () => resolve(null)
      }, {
        classes: ["rebreya-main", "rebreya-trader-dialog", "rm-downtime-request-window"],
        width: 940,
        height: 760
      });

      renderDialogOnTop(dialog);
    });
  }

  #buildDowntimeTargetActionDialogContent(action = {}, actor = null, { readOnly = false, existingActions = [] } = {}) {
    const safeDc = foundry.utils.escapeHTML(cleanText(action.dc));
    const choices = buildDowntimeTargetChoices(action, actor);
    const visibleChoiceCount = Math.max(1, choices.length);
    const selectedActionType = getSelectableDowntimeActionType(action.actionType);
    const isResourceAction = selectedActionType === "resources";
    const isCheckAction = selectedActionType === "check" || selectedActionType === "freeform";
    const isRankAction = selectedActionType === "rankChoice";
    const isOptionAction = selectedActionType === "optionChoice";
    const isNumericAction = selectedActionType === "numericInput";
    const isResultAction = selectedActionType === "downtimeResult";
    const isFormulaAction = selectedActionType === "formulaRoll";
    const isDescriptionAction = selectedActionType === "descriptionBlock";
    const usesResultFormula = isResultAction
      && action.resultFormula
      && typeof action.resultFormula === "object"
      && !Array.isArray(action.resultFormula);
    const showOutcomeStep = !isResultAction && !isDescriptionAction;
    const choiceRows = Array.from({ length: MAX_DOWNTIME_TARGET_CHOICES }, (_entry, index) =>
      buildDowntimeTargetChoiceRow(choices[index] ?? {}, index, { visible: index < visibleChoiceCount, actor }));
    const checkEffect = action.checkEffect && typeof action.checkEffect === "object" ? action.checkEffect : {};
    const downtimeEffect = action.downtimeEffect && typeof action.downtimeEffect === "object" ? action.downtimeEffect : {};
    const outcomeMode = action.outcomeMode || (cleanText(action.dc) ? "dc" : "freeform");
    const recordMode = action.recordMode || (outcomeMode === "freeform" ? "gm" : "total-success");
    const showDc = ["dc", "dc-sum"].includes(outcomeMode);
    const showThresholds = outcomeMode === "thresholds";
    const checkEffectActive = cleanText(checkEffect.trigger) && checkEffect.trigger !== "none";
    const downtimeEffectActive = cleanText(downtimeEffect.trigger) && downtimeEffect.trigger !== "none";
    const readOnlyResult = readOnly && hasDowntimeTargetActionResult(action)
      ? `<p class="rm-inline-status rm-inline-status--info"><span>Результат: ${escapeHtml(buildDowntimeCheckResultLabel(action.result))}</span></p>`
      : "";

    return `
      <form class="rm-purchase-dialog rm-downtime-target-action-dialog" data-readonly="${readOnly ? "true" : "false"}">
        ${readOnlyResult}
        <nav class="rm-downtime-target-dialog__steps" aria-label="Этапы настройки целевого действия" role="tablist">
          <button type="button" class="is-active" data-action="target-action-step" data-step="basis" title="Тип задачи и общий сценарий." aria-selected="true">1. Основа</button>
          <button type="button" data-action="target-action-step" data-step="variants" title="Один основной вариант и, при необходимости, альтернативы для игрока." aria-selected="false">2. Варианты</button>
          ${showOutcomeStep ? `<button type="button" data-action="target-action-step" data-step="outcome" title="Как считать результат броска." aria-selected="false">3. Итог</button>` : ""}
          <button type="button" data-action="target-action-step" data-step="effects" title="Что запустить после проверки или всего простоя." aria-selected="false">4. Эффекты</button>
        </nav>

        <section class="rm-downtime-target-dialog__section rm-downtime-target-dialog__section--compact" data-step-panel="basis">
          <header>
            <h4>Основа</h4>
          </header>
          <div class="rm-downtime-target-dialog__grid rm-downtime-target-dialog__grid--compact">
            <div class="rm-field">
              <label title="Определяет, какой тип задачи получит игрок.">Тип действия</label>
              <select data-field="target-action-type">${renderSelectOptions(DOWNTIME_ACTION_TYPE_SELECT_OPTIONS, selectedActionType)}</select>
            </div>
          </div>
        </section>

        <section class="rm-downtime-target-dialog__section" data-step-panel="variants" hidden>
          <header>
            ${isCheckAction ? `<h4 data-target-choice-heading>${buildDowntimeTargetChoiceHeading(visibleChoiceCount)}</h4>` : ""}
            <h4 data-resource-heading${isResourceAction ? "" : " hidden"}>Ресурсы</h4>
            <h4 data-rank-choice-heading${isRankAction ? "" : " hidden"}>Выбор ранга</h4>
            <h4 data-option-choice-heading${isOptionAction ? "" : " hidden"}>Выбор варианта</h4>
            <h4 data-numeric-input-heading${isNumericAction ? "" : " hidden"}>Числовой ресурс</h4>
            <h4 data-result-mapping-heading${isResultAction ? "" : " hidden"}>Результат по порогам</h4>
            <h4 data-formula-roll-heading${isFormulaAction ? "" : " hidden"}>Формула</h4>
            <h4 data-description-block-heading${isDescriptionAction ? "" : " hidden"}>Блок описания</h4>
          </header>
          ${isCheckAction ? `
            <div data-target-choice-panel>
              <div class="rm-downtime-target-choice-list">
                ${choiceRows.join("")}
              </div>
              <button
                type="button"
                class="rm-button rm-downtime-add-alternative"
                data-action="target-action-add-alternative"
                title="Добавляет ещё один структурный вариант, который игрок сможет выбрать вместо основного."
                ${visibleChoiceCount >= MAX_DOWNTIME_TARGET_CHOICES ? "disabled" : ""}
              >
                + Добавить альтернативу
              </button>
            </div>
          ` : ""}
          <div${isResourceAction ? "" : " hidden"} data-resource-panel-shell>
            ${buildDowntimeResourcesPanel(action)}
          </div>
          <div${isRankAction ? "" : " hidden"} data-rank-choice-panel-shell>
            ${buildRankChoicePanel(action)}
          </div>
          <div${isOptionAction ? "" : " hidden"} data-option-choice-panel-shell>
            ${buildOptionChoicePanel(action)}
          </div>
          <div${isNumericAction ? "" : " hidden"} data-numeric-input-panel-shell>
            ${buildNumericInputPanel(action)}
          </div>
          <div${isResultAction ? "" : " hidden"} data-result-mapping-panel-shell>
            ${usesResultFormula ? `
              ${buildResultExpressionPanel(action, existingActions)}
              <div class="rm-downtime-thresholds" data-result-formula-thresholds>
                ${buildDowntimeThresholdRows(action.thresholds)}
              </div>
            ` : buildResultMappingPanel(action, existingActions)}
          </div>
          <div${isFormulaAction ? "" : " hidden"} data-formula-roll-panel-shell>
            <div class="rm-downtime-numeric-input-panel" data-formula-roll-panel>
              <div class="rm-field">
                <label title="Формула, которую можно записать в заявку.">Формула</label>
                <input type="text" value="${escapeHtml(action.selectedFormula || action.formula || "")}" data-field="target-action-formula" placeholder="1d20 + @mod">
              </div>
            </div>
          </div>
          <div${isDescriptionAction ? "" : " hidden"} data-description-block-panel-shell>
            ${buildDescriptionBlockPanel(action)}
          </div>
        </section>

        ${showOutcomeStep ? `<section class="rm-downtime-target-dialog__section" data-step-panel="outcome" hidden>
          <header>
            <h4>Итог</h4>
          </header>
          <div class="rm-downtime-target-dialog__grid">
            <div class="rm-field">
              <label title="Как трактовать результат броска.">Режим</label>
              <select data-field="target-action-outcome-mode">${renderSelectOptions(DOWNTIME_OUTCOME_MODE_OPTIONS, outcomeMode)}</select>
            </div>
            <div class="rm-field" data-outcome-dc-field${showDc ? "" : " hidden"}>
              <label title="Порог сложности для режимов DC и DC + сумма.">DC</label>
              <input type="number" min="0" step="1" value="${safeDc}" data-field="target-action-dc">
            </div>
            <div class="rm-field">
              <label title="Как сохранить результат после броска.">Записать</label>
              <select data-field="target-action-record-mode">${renderSelectOptions(DOWNTIME_RECORD_MODE_OPTIONS, recordMode)}</select>
            </div>
          </div>
          <div class="rm-downtime-thresholds" data-outcome-thresholds-field${showThresholds ? "" : " hidden"}>
            ${buildDowntimeThresholdRows(action.thresholds)}
          </div>
        </section>` : ""}

        <section class="rm-downtime-target-dialog__section" data-step-panel="effects" hidden>
          <div class="rm-downtime-effect-block">
            <header>
              <h4>Эффект проверки</h4>
            </header>
            <div class="rm-field">
              <label title="Когда запускать эффект этой проверки. Остальные поля появляются только если эффект включён.">Триггер</label>
              <select data-field="target-action-check-effect-trigger">${renderSelectOptions(DOWNTIME_EFFECT_TRIGGER_OPTIONS, checkEffect.trigger || "none")}</select>
            </div>
            <div class="rm-downtime-target-dialog__grid" data-effect-fields="check"${checkEffectActive ? "" : " hidden"}>
              <div class="rm-field">
                <label title="Кто исполняет эффект: Rebreya Main, DAE или Midi-QOL.">Исполнитель</label>
                <select data-field="target-action-check-effect-adapter">${renderSelectOptions(DOWNTIME_EFFECT_ADAPTER_OPTIONS, checkEffect.adapter || "none")}</select>
              </div>
              <div class="rm-field">
                <label title="Что именно сделать после срабатывания эффекта.">Шаблон</label>
                <select data-field="target-action-check-effect-template">${renderSelectOptions(DOWNTIME_CHECK_EFFECT_TEMPLATE_OPTIONS, checkEffect.template || "none")}</select>
              </div>
            </div>
          </div>

          <div class="rm-downtime-effect-block">
            <header>
              <h4>Эффект простоя</h4>
            </header>
            <div class="rm-field">
              <label title="Когда запускать эффект всей заявки. Остальные поля появляются только если эффект включён.">Когда</label>
              <select data-field="target-action-downtime-effect-trigger">${renderSelectOptions(DOWNTIME_DOWNTIME_EFFECT_TRIGGER_OPTIONS, downtimeEffect.trigger || "none")}</select>
            </div>
            <div class="rm-downtime-target-dialog__grid" data-effect-fields="downtime"${downtimeEffectActive ? "" : " hidden"}>
              <div class="rm-field">
                <label title="Кто исполняет эффект простоя.">Исполнитель</label>
                <select data-field="target-action-downtime-effect-adapter">${renderSelectOptions(DOWNTIME_EFFECT_ADAPTER_OPTIONS, downtimeEffect.adapter || "none")}</select>
              </div>
              <div class="rm-field">
                <label title="Что сделать при завершении/решении заявки.">Шаблон</label>
                <select data-field="target-action-downtime-effect-template">${renderSelectOptions(DOWNTIME_REQUEST_EFFECT_TEMPLATE_OPTIONS, downtimeEffect.template || "none")}</select>
              </div>
            </div>
          </div>
        </section>

        <footer class="rm-downtime-target-dialog__footer">
          <button
            type="button"
            class="rm-button rm-button--secondary"
            data-action="target-action-previous"
            title="Вернуться к предыдущему шагу."
            hidden
            disabled
          >Назад</button>
          <span class="rm-downtime-target-dialog__footer-spacer"></span>
          <button
            type="button"
            class="rm-button rm-button--primary"
            data-action="target-action-next"
            title="Перейти к следующему шагу без сохранения."
          >Далее</button>
          ${readOnly ? "" : `
            <button
              type="button"
              class="rm-button rm-button--primary"
              data-action="target-action-save"
              title="Сохранить целевое действие."
              hidden
              disabled
            >Сохранить</button>
          `}
          <button
            type="button"
            class="rm-button rm-button--secondary"
            data-action="target-action-cancel"
            title="Закрыть окно без сохранения изменений."
          >Отмена</button>
        </footer>
      </form>
    `;
  }

  #readDowntimeTargetActionDialog(root, existingAction = {}, existingActions = [], actor = null) {
    const selectedActionType = getSelectableDowntimeActionType(readFieldValue(root, "target-action-type"));
    const isResourceAction = selectedActionType === "resources";
    const isCheckAction = selectedActionType === "check" || selectedActionType === "freeform";
    const choiceRows = isCheckAction ? Array.from(root?.querySelectorAll?.("[data-target-choice]:not([hidden])") ?? []) : [];
    const choices = isResourceAction
      ? []
      : (isCheckAction && choiceRows.length
        ? choiceRows.map((row) => readDowntimeTargetChoice(row, actor))
        : (isCheckAction ? [normalizeDowntimeTargetChoice(existingAction, {}, actor)] : []));
    const primaryChoice = choices[0] ?? normalizeDowntimeTargetChoice(existingAction);
    const checkEffect = {
      trigger: readFieldValue(root, "target-action-check-effect-trigger") || "none",
      adapter: readFieldValue(root, "target-action-check-effect-adapter") || "none",
      template: readFieldValue(root, "target-action-check-effect-template") || "none"
    };
    const downtimeEffect = {
      trigger: readFieldValue(root, "target-action-downtime-effect-trigger") || "none",
      adapter: readFieldValue(root, "target-action-downtime-effect-adapter") || "none",
      template: readFieldValue(root, "target-action-downtime-effect-template") || "none"
    };
    const outcomeMode = readFieldValue(root, "target-action-outcome-mode") || "dc";
    const thresholds = Array.from(root?.querySelectorAll?.("[data-threshold-row]") ?? [])
      .map((row) => readDowntimeThreshold(row))
      .filter((threshold) => threshold.from || threshold.to || threshold.outcome !== "gm");

    if (selectedActionType === "rankChoice") {
      return {
        ...existingAction,
        id: cleanText(existingAction.id) || buildNextTargetActionId(existingActions),
        label: cleanText(existingAction.label) || "Ранг",
        actionType: "rankChoice",
        rankChoice: readRankChoice(root)
      };
    }

    if (selectedActionType === "numericInput") {
      const effectTarget = readFieldValue(root, "target-action-numeric-effect-target");
      const action = {
        ...existingAction,
        id: cleanText(existingAction.id) || buildNextTargetActionId(existingActions),
        label: cleanText(existingAction.label) || "Количество",
        actionType: "numericInput",
        input: readNumericInput(root)
      };
      if (effectTarget) {
        action.effect = {
          type: "bonus",
          targetActionId: effectTarget,
          valuePerStep: 1
        };
      }
      return action;
    }

    if (selectedActionType === "optionChoice") {
      return {
        ...existingAction,
        id: cleanText(existingAction.id) || buildNextTargetActionId(existingActions),
        label: cleanText(existingAction.label) || "Выбор",
        actionType: "optionChoice",
        selectionMode: readFieldValue(root, "target-action-option-selection-mode") || "single",
        options: readOptionChoiceOptions(root)
      };
    }

    if (selectedActionType === "formulaRoll") {
      return {
        ...existingAction,
        id: cleanText(existingAction.id) || buildNextTargetActionId(existingActions),
        label: cleanText(existingAction.label) || "Формула",
        actionType: "formulaRoll",
        selectedFormula: readFieldValue(root, "target-action-formula")
      };
    }

    if (selectedActionType === "descriptionBlock") {
      return {
        ...existingAction,
        id: cleanText(existingAction.id) || buildNextTargetActionId(existingActions),
        label: cleanText(existingAction.label) || "Описание проекта",
        actionType: "descriptionBlock",
        descriptionBlock: readDescriptionBlock(root)
      };
    }

    if (selectedActionType === "downtimeResult") {
      const resultFormula = readResultFormula(root);
      const hasResultFormula = resultFormula.terms.some((term) => cleanText(term.actionId));
      const action = {
        ...existingAction,
        id: cleanText(existingAction.id) || buildNextTargetActionId(existingActions),
        label: cleanText(existingAction.label) || "Итог простоя",
        actionType: "downtimeResult",
        recordMode: "single-result",
        outcomeMode: hasResultFormula ? "thresholds" : "pass-thresholds"
      };
      if (hasResultFormula) {
        action.resultFormula = resultFormula;
        delete action.resultMapping;
        if (thresholds.length) {
          action.thresholds = thresholds;
        }
      }
      else {
        action.resultMapping = readResultMapping(root);
        delete action.resultFormula;
      }
      return action;
    }

    const action = {
      id: cleanText(existingAction.id) || buildNextTargetActionId(existingActions),
      label: isResourceAction ? "Ресурсы" : (primaryChoice.label || primaryChoice.targetLabel || "Целевое действие"),
      actionType: selectedActionType === "check" && choices.length > 1 ? "choice" : selectedActionType,
      sourceType: isResourceAction ? "" : primaryChoice.sourceType,
      ability: isResourceAction ? "" : primaryChoice.ability,
      target: isResourceAction ? "" : primaryChoice.target,
      targetLabel: isResourceAction ? "" : primaryChoice.targetLabel,
      outcomeMode,
      dc: toInteger(readFieldValue(root, "target-action-dc"), 0),
      rollMode: primaryChoice.rollMode || "normal",
      recordMode: readFieldValue(root, "target-action-record-mode") || "total-success",
      choices,
      checkEffect,
      downtimeEffect
    };

    if (action.checkEffect.trigger === "none" || action.checkEffect.adapter === "none") {
      delete action.checkEffect;
    }
    if (action.downtimeEffect.trigger === "none" || action.downtimeEffect.adapter === "none") {
      delete action.downtimeEffect;
    }
    if (outcomeMode === "thresholds" && thresholds.length) {
      action.thresholds = thresholds;
    }
    if (isResourceAction) {
      action.resources = readDowntimeResources(root);
    }
    return action;
  }

  #wireDowntimeTargetActionDialog(root, { onSave, onCancel, actor = null, dialog = null, readOnly = false } = {}) {
    const rows = Array.from(root?.querySelectorAll?.("[data-target-choice]") ?? []);
    const addButton = root?.querySelector?.("[data-action='target-action-add-alternative']");
    const choiceHeading = root?.querySelector?.("[data-target-choice-heading]");
    const actionTypeSelect = root?.querySelector?.("[data-field='target-action-type']");
    const resourceHeading = root?.querySelector?.("[data-resource-heading]");
    const rankHeading = root?.querySelector?.("[data-rank-choice-heading]");
    const optionHeading = root?.querySelector?.("[data-option-choice-heading]");
    const numericHeading = root?.querySelector?.("[data-numeric-input-heading]");
    const resultHeading = root?.querySelector?.("[data-result-mapping-heading]");
    const formulaHeading = root?.querySelector?.("[data-formula-roll-heading]");
    const descriptionHeading = root?.querySelector?.("[data-description-block-heading]");
    const choicePanel = root?.querySelector?.("[data-target-choice-panel]");
    const resourcePanelShell = root?.querySelector?.("[data-resource-panel-shell]");
    const rankPanelShell = root?.querySelector?.("[data-rank-choice-panel-shell]");
    const optionPanelShell = root?.querySelector?.("[data-option-choice-panel-shell]");
    const numericPanelShell = root?.querySelector?.("[data-numeric-input-panel-shell]");
    const resultPanelShell = root?.querySelector?.("[data-result-mapping-panel-shell]");
    const formulaPanelShell = root?.querySelector?.("[data-formula-roll-panel-shell]");
    const descriptionPanelShell = root?.querySelector?.("[data-description-block-panel-shell]");
    const addPurchaseButton = root?.querySelector?.("[data-action='target-action-add-purchase']");
    const purchaseRows = Array.from(root?.querySelectorAll?.("[data-resource-purchase-row]") ?? []);
    const stepButtons = Array.from(root?.querySelectorAll?.("[data-action='target-action-step']") ?? []);
    const stepPanels = Array.from(root?.querySelectorAll?.("[data-step-panel]") ?? []);
    const previousButton = root?.querySelector?.("[data-action='target-action-previous']");
    const nextButton = root?.querySelector?.("[data-action='target-action-next']");
    const saveButton = root?.querySelector?.("[data-action='target-action-save']");
    const cancelButton = root?.querySelector?.("[data-action='target-action-cancel']");
    const outcomeSelect = root?.querySelector?.("[data-field='target-action-outcome-mode']");
    const dcField = root?.querySelector?.("[data-outcome-dc-field]");
    const thresholdsField = root?.querySelector?.("[data-outcome-thresholds-field]");
    const thresholdRowsRoot = root?.querySelector?.("[data-threshold-rows]");
    const addThresholdButton = root?.querySelector?.("[data-action='target-threshold-add']");
    const checkEffectTrigger = root?.querySelector?.("[data-field='target-action-check-effect-trigger']");
    const downtimeEffectTrigger = root?.querySelector?.("[data-field='target-action-downtime-effect-trigger']");
    const checkEffectFields = root?.querySelector?.("[data-effect-fields='check']");
    const downtimeEffectFields = root?.querySelector?.("[data-effect-fields='downtime']");

    root?.addEventListener?.("keydown", (event) => {
      if (event.key !== "Enter") {
        return;
      }
      if (cleanText(event.target?.tagName).toLowerCase() === "textarea") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    });

    if (stepButtons.length && stepPanels.length) {
      stepButtons.forEach((button) => {
        button.addEventListener("click", (event) => {
          event.preventDefault();
          this.#setDowntimeTargetActionStep(root, button.dataset?.step, dialog);
        });
      });
      this.#setDowntimeTargetActionStep(root, stepButtons.find((button) => button.classList?.contains?.("is-active"))?.dataset?.step ?? "basis", dialog);
    }

    previousButton?.addEventListener?.("click", (event) => {
      event.preventDefault();
      this.#moveDowntimeTargetActionStep(root, -1, dialog);
    });
    nextButton?.addEventListener?.("click", (event) => {
      event.preventDefault();
      this.#moveDowntimeTargetActionStep(root, 1, dialog);
    });
    saveButton?.addEventListener?.("click", (event) => {
      event.preventDefault();
      onSave?.(root);
    });
    cancelButton?.addEventListener?.("click", (event) => {
      event.preventDefault();
      onCancel?.();
    });

    const getVisibleChoiceRows = () => rows.filter((row) => row.hidden !== true);
    const getActionType = () => cleanText(actionTypeSelect?.value) || "check";
    const isResourceAction = () => getActionType() === "resources";
    const isCheckAction = () => ["check", "freeform"].includes(getActionType());
    const updateChoiceListState = () => {
      const visibleRows = getVisibleChoiceRows();
      if (choiceHeading) {
        choiceHeading.textContent = buildDowntimeTargetChoiceHeading(Math.max(1, visibleRows.length));
      }
      if (addButton) {
        addButton.disabled = readOnly || visibleRows.length >= Math.min(rows.length, MAX_DOWNTIME_TARGET_CHOICES);
      }
      rows.forEach((row) => {
        const hidden = row.hidden === true;
        const editButton = row?.querySelector?.("[data-action='target-choice-edit']");
        const removeButton = row?.querySelector?.("[data-action='target-choice-remove']");
        if (editButton) {
          editButton.disabled = readOnly || hidden;
        }
        if (removeButton) {
          removeButton.disabled = readOnly || hidden || visibleRows.length <= 1;
        }
      });
    };
    const updateActionTypePanels = () => {
      const actionType = getActionType();
      const checkActive = isCheckAction();
      const resourceActive = actionType === "resources";
      const rankActive = actionType === "rankChoice";
      const optionActive = actionType === "optionChoice";
      const numericActive = actionType === "numericInput";
      const resultActive = actionType === "downtimeResult";
      const formulaActive = actionType === "formulaRoll";
      const descriptionActive = actionType === "descriptionBlock";
      if (choiceHeading) {
        choiceHeading.hidden = !checkActive;
      }
      if (resourceHeading) {
        resourceHeading.hidden = !resourceActive;
      }
      if (rankHeading) {
        rankHeading.hidden = !rankActive;
      }
      if (optionHeading) {
        optionHeading.hidden = !optionActive;
      }
      if (numericHeading) {
        numericHeading.hidden = !numericActive;
      }
      if (resultHeading) {
        resultHeading.hidden = !resultActive;
      }
      if (formulaHeading) {
        formulaHeading.hidden = !formulaActive;
      }
      if (descriptionHeading) {
        descriptionHeading.hidden = !descriptionActive;
      }
      if (choicePanel) {
        choicePanel.hidden = !checkActive;
      }
      if (resourcePanelShell) {
        resourcePanelShell.hidden = !resourceActive;
      }
      if (rankPanelShell) {
        rankPanelShell.hidden = !rankActive;
      }
      if (optionPanelShell) {
        optionPanelShell.hidden = !optionActive;
      }
      if (numericPanelShell) {
        numericPanelShell.hidden = !numericActive;
      }
      if (resultPanelShell) {
        resultPanelShell.hidden = !resultActive;
      }
      if (formulaPanelShell) {
        formulaPanelShell.hidden = !formulaActive;
      }
      if (descriptionPanelShell) {
        descriptionPanelShell.hidden = !descriptionActive;
      }
      const outcomeButton = stepButtons.find((button) => button.dataset?.step === "outcome");
      const outcomePanel = stepPanels.find((panel) => panel.dataset?.stepPanel === "outcome");
      if (outcomeButton) {
        outcomeButton.hidden = resultActive || descriptionActive;
      }
      if (outcomePanel && (resultActive || descriptionActive)) {
        outcomePanel.hidden = true;
      }
      const activeStep = stepButtons.find((button) => button.classList?.contains?.("is-active"))?.dataset?.step;
      if ((resultActive || descriptionActive) && activeStep === "outcome") {
        this.#setDowntimeTargetActionStep(root, "variants", dialog);
      }
    };

    actionTypeSelect?.addEventListener?.("change", updateActionTypePanels);
    updateActionTypePanels();

    if (!readOnly && addButton && rows.length) {
      addButton.addEventListener?.("click", (event) => {
        event.preventDefault();
        event.stopPropagation?.();
        const nextRow = rows.find((row) => row.hidden === true);
        if (!nextRow) {
          updateChoiceListState();
          return;
        }
        nextRow.hidden = false;
        nextRow.open = true;
        updateChoiceListState();
      });
    }

    if (!readOnly && addPurchaseButton && purchaseRows.length) {
      const updatePurchaseButtonState = () => {
        addPurchaseButton.disabled = !purchaseRows.some((row) => row.hidden === true);
      };
      addPurchaseButton.addEventListener?.("click", (event) => {
        event.preventDefault();
        event.stopPropagation?.();
        const nextRow = purchaseRows.find((row) => row.hidden === true);
        if (!nextRow) {
          updatePurchaseButtonState();
          return;
        }
        nextRow.hidden = false;
        updatePurchaseButtonState();
      });
      updatePurchaseButtonState();
    }

    const getThresholdRows = () => Array.from(root?.querySelectorAll?.("[data-threshold-row]") ?? [])
      .filter((row) => row.hidden !== true);
    const updateThresholdButtons = () => {
      const visibleRows = getThresholdRows();
      if (addThresholdButton) {
        addThresholdButton.disabled = readOnly || visibleRows.length >= MAX_DOWNTIME_THRESHOLDS;
      }
      visibleRows.forEach((row) => {
        const removeButton = row?.querySelector?.("[data-action='target-threshold-remove']");
        if (removeButton) {
          removeButton.disabled = readOnly || visibleRows.length <= 1;
        }
      });
    };
    const bindThresholdRemove = (row) => {
      const removeButton = row?.querySelector?.("[data-action='target-threshold-remove']");
      removeButton?.addEventListener?.("click", (event) => {
        event.preventDefault();
        if (readOnly || getThresholdRows().length <= 1) {
          return;
        }
        row.hidden = true;
        updateThresholdButtons();
      });
    };
    getThresholdRows().forEach((row) => bindThresholdRemove(row));
    addThresholdButton?.addEventListener?.("click", (event) => {
      event.preventDefault();
      if (readOnly || !thresholdRowsRoot || getThresholdRows().length >= MAX_DOWNTIME_THRESHOLDS) {
        return;
      }
      const wrapper = document.createElement?.("div");
      if (!wrapper) {
        return;
      }
      wrapper.innerHTML = buildDowntimeThresholdRow({}, getThresholdRows().length);
      const row = wrapper.children?.[0];
      if (row) {
        thresholdRowsRoot.appendChild(row);
        bindThresholdRemove(row);
      }
      updateThresholdButtons();
    });
    updateThresholdButtons();

    const updateOutcomeFields = () => {
      if (dcField) {
        dcField.hidden = !["dc", "dc-sum"].includes(cleanText(outcomeSelect?.value));
      }
      if (thresholdsField) {
        thresholdsField.hidden = cleanText(outcomeSelect?.value) !== "thresholds";
      }
    };
    outcomeSelect?.addEventListener?.("change", updateOutcomeFields);
    updateOutcomeFields();

    const updateEffectFields = (trigger, fields) => {
      if (fields) {
        fields.hidden = !cleanText(trigger?.value) || trigger.value === "none";
      }
    };
    checkEffectTrigger?.addEventListener?.("change", () => updateEffectFields(checkEffectTrigger, checkEffectFields));
    downtimeEffectTrigger?.addEventListener?.("change", () => updateEffectFields(downtimeEffectTrigger, downtimeEffectFields));
    updateEffectFields(checkEffectTrigger, checkEffectFields);
    updateEffectFields(downtimeEffectTrigger, downtimeEffectFields);

    const updateChoiceSummary = (row) => {
      const summary = row?.querySelector?.("[data-target-choice-summary]");
      if (summary) {
        summary.textContent = buildDowntimeTargetChoiceSummary(readDowntimeTargetChoice(row, actor));
      }
    };
    const bindChoiceFieldListeners = (row) => {
      const targetField = row?.querySelector?.("[data-field='target-choice-target']");
      const abilityField = row?.querySelector?.("[data-field='target-choice-ability']");
      targetField?.addEventListener?.("change", () => syncChoiceTarget(row));
      abilityField?.addEventListener?.("change", () => updateChoiceSummary(row));
    };
    const renderChoiceFields = (row) => {
      const fields = row?.querySelector?.("[data-target-choice-fields]");
      if (!fields) {
        return;
      }
      const sourceType = readFieldValue(row, "target-choice-source-type") || "skill";
      const nextChoice = normalizeDowntimeTargetChoice({
        ...readDowntimeTargetChoice(row, actor),
        sourceType
      }, {}, actor);
      fields.innerHTML = buildDowntimeTargetChoiceFields(nextChoice, actor);
      if (row?.dataset) {
        row.dataset.previousTarget = nextChoice.target;
      }
      bindChoiceFieldListeners(row);
      updateChoiceSummary(row);
    };
    const syncChoiceTarget = (row) => {
      const targetField = row?.querySelector?.("[data-field='target-choice-target']");
      const abilityField = row?.querySelector?.("[data-field='target-choice-ability']");
      const sourceType = readFieldValue(row, "target-choice-source-type") || "skill";
      const previousTargetOption = getTargetOption(row?.dataset?.previousTarget, sourceType, actor);
      const targetOption = getTargetOption(targetField?.value, sourceType, actor);
      if (abilityField && targetOption?.ability && (!abilityField.value || abilityField.value === previousTargetOption?.ability)) {
        abilityField.value = targetOption.ability;
      }
      if (row?.dataset) {
        row.dataset.previousTarget = cleanText(targetField?.value);
      }
      updateChoiceSummary(row);
    };
    rows.forEach((row) => {
      if (row?.dataset && !row.dataset.previousTarget) {
        row.dataset.previousTarget = readFieldValue(row, "target-choice-target");
      }
      const sourceField = row?.querySelector?.("[data-field='target-choice-source-type']");
      const editButton = row?.querySelector?.("[data-action='target-choice-edit']");
      const removeButton = row?.querySelector?.("[data-action='target-choice-remove']");
      if (!readOnly) {
        sourceField?.addEventListener?.("change", () => renderChoiceFields(row));
      }
      editButton?.addEventListener?.("click", (event) => {
        event.preventDefault();
        event.stopPropagation?.();
        if (readOnly) {
          return;
        }
        if (row.hidden !== true) {
          row.open = true;
        }
      });
      removeButton?.addEventListener?.("click", (event) => {
        event.preventDefault();
        event.stopPropagation?.();
        if (readOnly) {
          return;
        }
        if (row.hidden === true || getVisibleChoiceRows().length <= 1) {
          updateChoiceListState();
          return;
        }
        row.hidden = true;
        row.open = false;
        updateChoiceListState();
      });
      bindChoiceFieldListeners(row);
      updateChoiceSummary(row);
    });
    if (rows.length) {
      updateChoiceListState();
    }
    if (readOnly) {
      root?.querySelectorAll?.("input, select, textarea").forEach((control) => {
        control.disabled = true;
      });
    }
  }

  #getDowntimeTargetActionStepOrder(root) {
    const steps = Array.from(root?.querySelectorAll?.("[data-action='target-action-step']") ?? [])
      .filter((button) => button.hidden !== true)
      .map((button) => cleanText(button?.dataset?.step))
      .filter(Boolean);
    return steps.length ? steps : ["basis", "variants", "outcome", "effects"];
  }

  #setDowntimeTargetActionStep(root, step = "basis", dialog = null) {
    const stepOrder = this.#getDowntimeTargetActionStepOrder(root);
    const safeStep = stepOrder.includes(cleanText(step)) ? cleanText(step) : "basis";
    const stepButtons = Array.from(root?.querySelectorAll?.("[data-action='target-action-step']") ?? []);
    const stepPanels = Array.from(root?.querySelectorAll?.("[data-step-panel]") ?? []);
    stepButtons.forEach((button) => {
      const active = button.dataset?.step === safeStep;
      button.classList?.toggle?.("is-active", active);
      button.setAttribute?.("aria-selected", active ? "true" : "false");
    });
    stepPanels.forEach((panel) => {
      panel.hidden = panel.dataset?.stepPanel !== safeStep;
    });
    this.#updateDowntimeTargetActionDialogButtons(root, safeStep);
    this.#resizeDowntimeTargetActionDialog(root, safeStep, dialog);
  }

  #moveDowntimeTargetActionStep(root, direction = 1, dialog = null) {
    const stepOrder = this.#getDowntimeTargetActionStepOrder(root);
    const activeButton = Array.from(root?.querySelectorAll?.("[data-action='target-action-step']") ?? [])
      .find((button) => button.classList?.contains?.("is-active") || button.getAttribute?.("aria-selected") === "true");
    const activeStep = cleanText(activeButton?.dataset?.step) || "basis";
    const activeIndex = Math.max(0, stepOrder.indexOf(activeStep));
    const nextIndex = Math.max(0, Math.min(stepOrder.length - 1, activeIndex + direction));
    this.#setDowntimeTargetActionStep(root, stepOrder[nextIndex], dialog);
  }

  #resizeDowntimeTargetActionDialog(root, activeStep = "basis", dialog = null) {
    const dimensions = DOWNTIME_TARGET_DIALOG_DIMENSIONS[activeStep] ?? DOWNTIME_TARGET_DIALOG_DIMENSIONS.basis;
    root?.style?.setProperty?.("--rm-downtime-target-dialog-width", `${dimensions.width}px`);
    root?.style?.setProperty?.("--rm-downtime-target-dialog-height", `${dimensions.height}px`);
    const shell = root?.closest?.(".rm-downtime-target-action-window, .window-app, .application");
    shell?.style?.setProperty?.("--rm-downtime-target-dialog-width", `${dimensions.width}px`);
    shell?.style?.setProperty?.("--rm-downtime-target-dialog-height", `${dimensions.height}px`);
    if (typeof dialog?.setPosition === "function") {
      dialog.setPosition(dimensions);
    }
  }

  #updateDowntimeTargetActionDialogButtons(root, activeStep = "basis") {
    const stepOrder = this.#getDowntimeTargetActionStepOrder(root);
    const index = Math.max(0, stepOrder.indexOf(activeStep));
    const previous = root?.querySelector?.("[data-action='target-action-previous']");
    const next = root?.querySelector?.("[data-action='target-action-next']");
    const confirm = root?.querySelector?.("[data-action='target-action-save']");
    if (previous) {
      previous.hidden = index === 0;
      previous.disabled = index === 0;
    }
    if (next) {
      next.hidden = index >= stepOrder.length - 1;
      next.disabled = index >= stepOrder.length - 1;
    }
    if (confirm) {
      confirm.hidden = index < stepOrder.length - 1;
      confirm.disabled = index < stepOrder.length - 1;
    }
  }

  async #promptDowntimeTargetAction(existingAction = {}, existingActions = [], actor = null, { readOnly = false } = {}) {
    const DialogClass = globalThis.Dialog;
    if (typeof DialogClass !== "function") {
      return null;
    }

    return new Promise((resolve) => {
      let settled = false;
      const dialog = new DialogClass({
        title: readOnly ? "Просмотр целевого действия" : "Целевое действие",
        content: this.#buildDowntimeTargetActionDialogContent(existingAction, actor, { readOnly, existingActions }),
        buttons: {},
        render: (html) => {
          const root = getDialogRoot(html);
          this.#wireDowntimeTargetActionDialog(root, {
            actor,
            dialog,
            readOnly,
            onSave: (dialogRoot) => {
              if (readOnly) {
                settled = true;
                resolve(null);
                dialog.close?.();
                return;
              }
              settled = true;
              resolve(this.#readDowntimeTargetActionDialog(dialogRoot, existingAction, existingActions, actor));
              dialog.close?.();
            },
            onCancel: () => {
              settled = true;
              resolve(null);
              dialog.close?.();
            }
          });
          const firstControl = root?.querySelector("[data-field='target-action-type']");
          if (firstControl instanceof HTMLElement && typeof firstControl.focus === "function") {
            firstControl.focus();
          }
        },
        close: () => {
          if (!settled) {
            resolve(null);
          }
        }
      }, {
        classes: ["rebreya-main", "rebreya-trader-dialog", "rm-downtime-target-action-window"],
        width: DOWNTIME_TARGET_DIALOG_DIMENSIONS.basis.width,
        height: DOWNTIME_TARGET_DIALOG_DIMENSIONS.basis.height
      });

      renderDialogOnTop(dialog);
    });
  }

  async #handleDowntimeGrant(element) {
    const actorId = cleanText(element.querySelector("[data-action='downtime-grant-actor']")?.value) || "all";
    const weeks = Math.max(1, toInteger(element.querySelector("[data-action='downtime-grant-weeks']")?.value, 1));
    this.downtimeGrantActorId = actorId;
    this.downtimeGrantWeeks = weeks;

    const actorIds = actorId === "all" ? [] : [actorId];
    await this.moduleApi.grantDowntimeWeeks({
      actorIds,
      weeks,
      reason: ""
    });

    this.#setActionFeedback("success", `Выдано недель простоя: ${weeks}.`);
    ui.notifications?.info(`Выдано недель простоя: ${weeks}.`);
  }

  async #handleDowntimeRevoke(element) {
    const actorId = cleanText(element.querySelector("[data-action='downtime-grant-actor']")?.value) || "all";
    const weeks = Math.max(1, toInteger(element.querySelector("[data-action='downtime-grant-weeks']")?.value, 1));
    this.downtimeGrantActorId = actorId;
    this.downtimeGrantWeeks = weeks;

    const actorIds = actorId === "all" ? [] : [actorId];
    const result = await this.moduleApi.revokeDowntimeWeeks({
      actorIds,
      weeks,
      reason: ""
    });

    const revokedActorCount = Array.isArray(result?.actorIds) ? result.actorIds.length : actorIds.length;
    const skippedActorCount = Array.isArray(result?.skippedActorIds) ? result.skippedActorIds.length : 0;
    const totalRevokedWeeks = Math.max(0, toInteger(result?.totalRevokedWeeks, weeks * Math.max(1, revokedActorCount)));
    const message = totalRevokedWeeks > 0
      ? `Забрано недель простоя: ${totalRevokedWeeks}${skippedActorCount ? `, без свободных недель: ${skippedActorCount}` : ""}.`
      : "Свободных недель для списания нет.";
    this.#setActionFeedback("success", message);
    ui.notifications?.info(message);
  }

  async #handleDowntimeClearHistory() {
    const confirmed = await confirmAction(
      "Очистить историю простоя",
      "<p>Удалить все заявки, целевые действия и записи решений мастера? Резерв открытых заявок вернётся в свободные недели.</p>"
    );
    if (!confirmed) {
      return;
    }

    const result = await this.moduleApi.clearDowntimeHistory();
    const removedRequests = toInteger(result?.removedRequests, 0);
    this.#setActionFeedback("success", `История простоя очищена. Удалено заявок: ${removedRequests}.`);
    ui.notifications?.info("История простоя очищена.");
  }

  async #handleDowntimeOpenRequest(button) {
    const requestId = cleanText(button?.dataset?.requestId);
    if (!requestId) {
      return;
    }

    const request = await this.#getDowntimeRequestViewById(requestId);
    if (!request) {
      throw new Error("Downtime request not found.");
    }

    this.downtimeSelectedRequestId = requestId;
    await this.#promptDowntimeRequestDetails({
      ...request,
      canManage: this.canManage || Boolean(request.canManage)
    });
  }

  async #handleDowntimeSubmit(element) {
    this.downtimeRequestActorId = cleanText(element.querySelector("[data-action='downtime-request-actor']")?.value);
    this.downtimeRequestActionId = cleanText(element.querySelector("[data-action='downtime-request-action']")?.value);
    this.downtimeRequestWeeks = Math.max(1, toInteger(element.querySelector("[data-action='downtime-request-weeks']")?.value, 1));
    this.downtimeRequestTitle = cleanText(element.querySelector("[data-action='downtime-request-title']")?.value);
    this.downtimeRequestDescription = cleanText(element.querySelector("[data-action='downtime-request-description']")?.value);

    await this.moduleApi.createDowntimeRequest({
      actorId: this.downtimeRequestActorId,
      actionId: this.downtimeRequestActionId,
      title: this.downtimeRequestTitle,
      description: this.downtimeRequestDescription,
      weeks: this.downtimeRequestWeeks
    });

    this.downtimeRequestTitle = "";
    this.downtimeRequestDescription = "";
    this.#setActionFeedback("success", "Заявка на простой отправлена.");
    ui.notifications?.info("Заявка на простой отправлена.");
  }

  async #handleDowntimeStatus(button) {
    const requestId = cleanText(button.dataset.requestId);
    const status = cleanText(button.dataset.status);
    if (!requestId || !status) {
      return;
    }

    let result = "";
    if (shouldPromptDowntimeResult(status)) {
      const prompted = await this.#promptDowntimeText(
        "Результат простоя",
        "Короткий комментарий для заявки:",
        button.dataset.result ?? ""
      );
      if (prompted === null) {
        return;
      }
      result = cleanText(prompted);
    }

    await this.moduleApi.setDowntimeRequestStatus(requestId, status, { result });
    this.#setActionFeedback("success", "Статус заявки обновлён.");
    ui.notifications?.info("Статус заявки обновлён.");
  }

  async #handleDowntimeTargetAction(button) {
    const requestId = cleanText(button.dataset.requestId);
    if (!requestId) {
      return;
    }

    const request = await this.#getDowntimeRequestById(requestId);
    if (!request) {
      throw new Error("Downtime request not found.");
    }

    const existingActions = Array.isArray(request.checks) ? request.checks : [];
    const checkId = cleanText(button.dataset.checkId);
    const existingAction = existingActions.find((action) => cleanText(action?.id) === checkId) ?? null;

    const actor = getGameActorById(request.actorId);
    const readOnly = Boolean(existingAction && hasDowntimeTargetActionResult(existingAction))
      || DOWNTIME_ARCHIVE_STATUSES.has(cleanText(request.status));
    const nextAction = await this.#promptDowntimeTargetAction(existingAction ?? {}, existingActions, actor, { readOnly });
    if (!nextAction) {
      return;
    }

    const nextActions = existingAction
      ? existingActions.map((action) => cleanText(action?.id) === checkId ? nextAction : action)
      : [...existingActions, nextAction];
    await this.moduleApi.setDowntimeRequestChecks(requestId, nextActions);
    this.#setActionFeedback("success", "Целевые действия заявки обновлены.");
    ui.notifications?.info("Целевые действия заявки обновлены.");
  }

  async #handleDowntimeRemoveTargetAction(button) {
    const requestId = cleanText(button.dataset.requestId);
    const checkId = cleanText(button.dataset.checkId);
    if (!requestId || !checkId) {
      return;
    }

    const request = await this.#getDowntimeRequestById(requestId);
    if (!request) {
      throw new Error("Downtime request not found.");
    }

    const nextActions = (Array.isArray(request.checks) ? request.checks : [])
      .filter((action) => cleanText(action?.id) !== checkId);
    await this.moduleApi.setDowntimeRequestChecks(requestId, nextActions);
    this.#setActionFeedback("success", "Целевое действие удалено.");
    ui.notifications?.info("Целевое действие удалено.");
  }

  #getCraftMutation(action, documentId) {
    const safeAction = cleanText(action);
    const safeDocumentId = cleanText(documentId);
    if (!safeAction || !safeDocumentId) {
      throw new Error("Для операции крафта нужен стабильный идентификатор.");
    }

    const key = `${safeAction}:${safeDocumentId}`;
    let mutationId = this.craftMutationIds.get(key);
    if (!mutationId) {
      const nonce = globalThis.crypto?.randomUUID?.()
        ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      mutationId = `craft-ui:${safeAction}:${safeDocumentId}:${nonce}`;
      this.craftMutationIds.set(key, mutationId);
    }
    return { key, mutationId };
  }

  async #runCraftMutation({ action, documentId, successMessage, errorMessage, callback }) {
    const { key, mutationId } = this.#getCraftMutation(action, documentId);
    try {
      const result = await callback(mutationId);
      this.craftMutationIds.delete(key);
      this.#setActionFeedback("success", successMessage);
      ui.notifications?.info(successMessage);
      this.render?.({ force: true });
      bringAppToFront(this);
      return result;
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to run craft ${action} action.`, error);
      const message = error.message || errorMessage;
      this.#setActionFeedback("error", message);
      ui.notifications?.error(message);
      this.render?.({ force: true });
      return null;
    }
  }

  async #handleCraftApproval(button) {
    const requestId = cleanText(button?.dataset?.requestId);
    if (!requestId) {
      return;
    }

    await this.#runCraftMutation({
      action: "approve",
      documentId: requestId,
      successMessage: "Проект крафта одобрен и поставлен в календарь.",
      errorMessage: "Не удалось одобрить проект крафта.",
      callback: (mutationId) => this.moduleApi.approveCraftDowntimeRequest({
        requestId,
        mutationId
      })
    });
  }

  async #handleCraftRequestDecision(button, status) {
    const requestId = cleanText(button?.dataset?.requestId);
    if (!requestId) {
      return;
    }

    const result = await this.#promptDowntimeText(
      status === "returned" ? "Вернуть заявку" : "Отклонить заявку",
      "Комментарий игроку:",
      ""
    );
    if (result === null) {
      return;
    }

    try {
      await this.moduleApi.setDowntimeRequestStatus(requestId, status, {
        result: cleanText(result)
      });
      const message = status === "returned" ? "Заявка возвращена игроку." : "Заявка отклонена.";
      this.#setActionFeedback("success", message);
      ui.notifications?.info(message);
      this.render?.({ force: true });
      bringAppToFront(this);
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to update craft request.`, error);
      const message = error.message || "Не удалось обновить заявку крафта.";
      this.#setActionFeedback("error", message);
      ui.notifications?.error(message);
      this.render?.({ force: true });
    }
  }

  async #handleCraftProjectLifecycle(button, action) {
    const projectId = cleanText(button?.dataset?.projectId);
    if (!projectId) {
      return;
    }

    if (action === "pause") {
      const reason = await this.#promptDowntimeText("Пауза проекта", "Причина паузы:", "");
      if (reason === null) {
        return;
      }
      await this.#runCraftMutation({
        action,
        documentId: projectId,
        successMessage: "Проект крафта поставлен на паузу.",
        errorMessage: "Не удалось поставить проект на паузу.",
        callback: (mutationId) => this.moduleApi.pauseCraftProject(projectId, {
          mutationId,
          reason: cleanText(reason)
        })
      });
      return;
    }

    if (action === "reconcile") {
      const note = await this.#promptDowntimeText("Сверка проекта", "Комментарий к сверке:", "");
      if (note === null) {
        return;
      }
      await this.#runCraftMutation({
        action,
        documentId: projectId,
        successMessage: "Проект крафта сверен и продолжен.",
        errorMessage: "Не удалось сверить проект крафта.",
        callback: (mutationId) => this.moduleApi.reconcileCraftProject(projectId, {
          mutationId,
          note: cleanText(note),
          resume: true
        })
      });
      return;
    }

    if (action === "cancel") {
      const projectName = cleanText(button?.dataset?.projectName) || "проект";
      const confirmed = await confirmAction(
        "Отменить проект крафта",
        `<p>Отменить «${foundry.utils.escapeHTML(projectName)}» и вернуть зарезервированные ресурсы?</p>`
      );
      if (!confirmed) {
        return;
      }
      await this.#runCraftMutation({
        action,
        documentId: projectId,
        successMessage: "Проект крафта отменён, ресурсы возвращены.",
        errorMessage: "Не удалось отменить проект крафта.",
        callback: (mutationId) => this.moduleApi.cancelCraftProject(projectId, { mutationId })
      });
      return;
    }

    await this.#runCraftMutation({
      action: "resume",
      documentId: projectId,
      successMessage: "Проект крафта продолжен.",
      errorMessage: "Не удалось продолжить проект крафта.",
      callback: (mutationId) => this.moduleApi.resumeCraftProject(projectId, { mutationId })
    });
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const element = getAppElement(this);
    if (!element) {
      return;
    }

    const inventoryHeader = element.querySelector(".rm-inventory-book__header--inventory");
    if (inventoryHeader instanceof HTMLElement) {
      const elapsedSeconds = Math.max(0, Date.now() - this.inventoryHeaderAnimationStartedAt) / 1000;
      inventoryHeader.style.setProperty(
        "--rm-inventory-header-animation-delay",
        `${-elapsedSeconds}s`
      );
    }

    this.#closeContextMenu();
    this.renderListenersAbortController?.abort();
    this.renderListenersAbortController = new AbortController();
    const listenerOptions = { signal: this.renderListenersAbortController.signal };

    element.querySelectorAll(".is-drop-target-ready").forEach((node) => {
      node.classList.remove("is-drop-target-ready");
    });
    element.querySelectorAll(".rm-inventory-drop-surface.is-dragover").forEach((node) => {
      node.classList.remove("is-dragover");
    });

    this.#rememberExpandedPartyMembers(element);

    element.querySelectorAll(".rm-party-row[data-actor-id]").forEach((row) => {
      row.addEventListener("toggle", (event) => {
        const actorId = String(event.currentTarget.dataset.actorId ?? "").trim();
        if (!actorId) {
          return;
        }

        if (event.currentTarget.open) {
          this.expandedPartyMembers.add(actorId);
        }
        else {
          this.expandedPartyMembers.delete(actorId);
        }
      }, listenerOptions);
    });

    element.querySelectorAll("[data-item-drag]").forEach((row) => {
      row.addEventListener("dragstart", (event) => {
        const uuid = event.currentTarget.dataset.itemUuid;
        const itemId = cleanText(event.currentTarget.dataset.itemId);
        const groupActorId = this.inventoryActorId;
        if (!uuid || !itemId || !groupActorId || !event.dataTransfer) {
          return;
        }

        try {
          event.dataTransfer.effectAllowed = "all";
          const dragData = extendInventoryItemDragData(
            buildPartyInventoryItemDragData(uuid),
            { groupActorId, itemId }
          );
          const payload = JSON.stringify(dragData);
          for (const mimeType of INVENTORY_DRAG_MIME_TYPES) {
            try {
              event.dataTransfer.setData(mimeType, payload);
            }
            catch (_error) {
              // Ignore MIME types unsupported by this browser.
            }
          }
          activeInventoryTreeDragSession = { dataTransfer: event.dataTransfer, dragData };
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to start inventory Item drag.`, error);
          ui.notifications?.error(error.message || "Не удалось начать перенос предмета.");
        }
      }, listenerOptions);
      row.addEventListener("dragend", () => {
        activeInventoryTreeDragSession = null;
      }, listenerOptions);
    });

    element.querySelectorAll("[data-folder-drag]").forEach((row) => {
      row.addEventListener("dragstart", (event) => {
        const folderId = cleanText(event.currentTarget.dataset.folderId);
        const groupActorId = this.inventoryActorId;
        if (!folderId || !groupActorId || !event.dataTransfer) return;

        try {
          event.dataTransfer.effectAllowed = "all";
          const dragData = buildInventoryFolderDragData({ groupActorId, folderId });
          const payload = JSON.stringify(dragData);
          for (const mimeType of INVENTORY_DRAG_MIME_TYPES) {
            try {
              event.dataTransfer.setData(mimeType, payload);
            }
            catch (_error) {
              // Ignore MIME types unsupported by this browser.
            }
          }
          activeInventoryTreeDragSession = { dataTransfer: event.dataTransfer, dragData };
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to start inventory folder drag.`, error);
          ui.notifications?.error(error.message || "Не удалось начать перенос папки.");
        }
      }, listenerOptions);
      row.addEventListener("dragend", () => {
        activeInventoryTreeDragSession = null;
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='switch-tab']").forEach((button) => {
      button.addEventListener("click", (event) => {
        this.setActiveTab(event.currentTarget.dataset.tab || "inventory");
      }, listenerOptions);
    });

    const updateTravelRoute = async () => {
      const originCityId = cleanText(element.querySelector("[data-action='travel-origin']")?.value);
      const destinationCityId = cleanText(element.querySelector("[data-action='travel-destination']")?.value);
      const mode = cleanText(element.querySelector("[data-action='travel-mode']")?.value) || "land";
      const mutationSequence = ++this.travelMutationSequence;
      try {
        const snapshot = await this.moduleApi.setTravelRoute?.({
          originCityId,
          destinationCityId,
          mode
        });
        if (mutationSequence !== this.travelMutationSequence) {
          return;
        }
        this.pendingTravelSnapshot = snapshot ?? null;
        await this.render({ force: true, preserveScroll: true });
        this.#setActionFeedback("success", "Маршрут путешествия обновлён.");
        bringAppToFront(this);
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to update travel route.`, error);
        const message = error.message || "Не удалось обновить маршрут путешествия.";
        this.#setActionFeedback("error", message);
        this.render({ force: true });
        ui.notifications?.error(message);
      }
    };

    bindTravelCityAutocomplete(element, "origin", updateTravelRoute, listenerOptions);
    bindTravelCityAutocomplete(element, "destination", updateTravelRoute, listenerOptions);

    ["travel-mode"].forEach((action) => {
      element.querySelector(`[data-action='${action}']`)?.addEventListener("change", updateTravelRoute, listenerOptions);
    });

    const travelTrackTimeInput = element.querySelector("[data-action='travel-track-time']");
    if (travelTrackTimeInput) {
      this.travelTrackTime = Boolean(travelTrackTimeInput.checked);
      travelTrackTimeInput.addEventListener("change", (event) => {
        this.travelTrackTime = Boolean(event.currentTarget.checked);
      }, listenerOptions);
    }

    element.querySelectorAll("[data-action='travel-speed-multiplier']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        const speedMultiplier = toNumber(event.currentTarget.dataset.multiplier, 1);
        try {
          await this.moduleApi.setTravelSpeedMultiplier?.(speedMultiplier);
          this.#setActionFeedback("success", "Модификатор скорости обновлён.");
          bringAppToFront(this);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to update travel speed multiplier.`, error);
          const message = error.message || "Не удалось изменить модификатор скорости.";
          this.#setActionFeedback("error", message);
          this.render({ force: true });
          ui.notifications?.error(message);
        }
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='travel-advance']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        const hours = toNumber(event.currentTarget.dataset.hours, 0);
        const trackTime = Boolean(element.querySelector("[data-action='travel-track-time']")?.checked);
        this.travelTrackTime = trackTime;
        try {
          const snapshot = await this.moduleApi.advanceTravelHours?.(hours, { trackTime });
          applyTravelProgressSnapshot(element, snapshot);
          this.#setActionFeedback("success", `Путь продвинут на ${hours} ч.`);
          bringAppToFront(this);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to advance travel.`, error);
          const message = error.message || "Не удалось продвинуть путешествие.";
          this.#setActionFeedback("error", message);
          this.render({ force: true });
          ui.notifications?.error(message);
        }
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='travel-open-city']").forEach((button) => {
      button.addEventListener("click", (event) => {
        const cityId = cleanText(event.currentTarget.dataset.cityId);
        if (!cityId) {
          return;
        }
        this.moduleApi.openCityApp?.(cityId);
        bringAppToFront(this);
      }, listenerOptions);
    });

    const clearTravelRoute = async () => {
      const mutationSequence = ++this.travelMutationSequence;
      try {
        const snapshot = await this.moduleApi.clearTravelRoute?.();
        if (mutationSequence !== this.travelMutationSequence) {
          return;
        }
        this.pendingTravelSnapshot = snapshot ?? null;
        await this.render({ force: true, preserveScroll: true });
        this.#setActionFeedback("success", "Маршрут путешествия очищен.");
        bringAppToFront(this);
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to clear travel route.`, error);
        const message = error.message || "Не удалось очистить маршрут путешествия.";
        this.#setActionFeedback("error", message);
        this.render({ force: true });
        ui.notifications?.error(message);
      }
    };

    element.querySelector("[data-action='travel-clear']")?.addEventListener("click", clearTravelRoute, listenerOptions);

    element.querySelectorAll("[data-action='clear-header-travel-route']").forEach((routeCard) => {
      routeCard.addEventListener("contextmenu", async (event) => {
        if (!this.canManage) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        await clearTravelRoute();
      }, listenerOptions);
    });

    element.querySelectorAll("[data-transport-row]").forEach((row) => {
      row.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.#openTransportDialog(cleanText(row.dataset?.transportId));
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='open-transport-document']").forEach((control) => {
      control.addEventListener("click", (event) => {
        event.stopPropagation();
        const actorId = cleanText(event.currentTarget.dataset?.actorId);
        const actor = globalThis.game?.actors?.get?.(actorId)
          ?? globalThis.game?.actors?.contents?.find?.((candidate) => candidate?.id === actorId)
          ?? null;
        if (!actor?.sheet) {
          globalThis.ui?.notifications?.warn?.("Карточка транспорта недоступна.");
          return;
        }
        actor.sheet.render?.(true);
        bringAppToFront(actor.sheet);
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='transport-fuel-dropzone']").forEach((dropzone) => {
      dropzone.addEventListener("dragover", (event) => {
        let dragData = null;
        try {
          dragData = globalThis.TextEditor?.getDragEventData?.(event);
        }
        catch (_error) {
          return;
        }
        if (dragData?.type !== "Item" || !cleanText(dragData.uuid)) return;
        event.preventDefault();
        dropzone.classList?.add?.("is-dragover");
      }, listenerOptions);

      dropzone.addEventListener("dragleave", (event) => {
        if (event.relatedTarget && dropzone.contains?.(event.relatedTarget)) return;
        dropzone.classList?.remove?.("is-dragover");
      }, listenerOptions);

      dropzone.addEventListener("drop", async (event) => {
        event.preventDefault();
        dropzone.classList?.remove?.("is-dragover");
        try {
          const dragData = globalThis.TextEditor?.getDragEventData?.(event);
          const itemUuid = cleanText(dragData?.uuid);
          if (dragData?.type !== "Item" || !itemUuid) {
            globalThis.ui?.notifications?.warn?.("Перетащите сюда предмет топлива.");
            return;
          }
          await this.moduleApi.selectTransportFuel?.({
            groupActorId: cleanText(this.groupActor?.id),
            actorId: cleanText(dropzone.dataset?.actorId),
            itemUuid
          });
          this.#setActionFeedback("success", "Предмет топлива выбран.");
          globalThis.ui?.notifications?.info?.("Предмет топлива выбран.");
          bringAppToFront(this);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to select transport fuel.`, error);
          const message = error?.message || "Не удалось выбрать предмет топлива.";
          this.#setActionFeedback("error", message);
          globalThis.ui?.notifications?.error?.(message);
        }
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='open-transport-fuel-item']").forEach((control) => {
      control.addEventListener("click", async (event) => {
        event.stopPropagation();
        const itemUuid = cleanText(event.currentTarget.dataset?.itemUuid);
        try {
          const item = itemUuid && typeof globalThis.fromUuid === "function"
            ? await globalThis.fromUuid(itemUuid)
            : null;
          const Item = globalThis.Item;
          const isItem = item?.documentName === "Item"
            || (typeof Item === "function" && item instanceof Item);
          if (!isItem || !item?.sheet) {
            globalThis.ui?.notifications?.warn?.("Выбранный предмет топлива больше недоступен.");
            return;
          }
          item.sheet.render?.(true);
          bringAppToFront(item.sheet);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to open transport fuel item.`, error);
          globalThis.ui?.notifications?.error?.(error?.message || "Не удалось открыть предмет топлива.");
        }
      }, listenerOptions);
    });

    const bindDowntimeField = (selector, assign) => {
      element.querySelector(selector)?.addEventListener("change", (event) => {
        assign(event.currentTarget.value ?? "");
      }, listenerOptions);
    };
    bindDowntimeField("[data-action='downtime-grant-actor']", (value) => {
      this.downtimeGrantActorId = cleanText(value) || "all";
    });
    bindDowntimeField("[data-action='downtime-grant-weeks']", (value) => {
      this.downtimeGrantWeeks = Math.max(1, toInteger(value, 1));
    });
    bindDowntimeField("[data-action='downtime-request-actor']", (value) => {
      this.downtimeRequestActorId = cleanText(value);
    });
    bindDowntimeField("[data-action='downtime-request-action']", (value) => {
      this.downtimeRequestActionId = cleanText(value);
    });
    bindDowntimeField("[data-action='downtime-request-weeks']", (value) => {
      this.downtimeRequestWeeks = Math.max(1, toInteger(value, 1));
    });
    bindDowntimeField("[data-action='downtime-request-title']", (value) => {
      this.downtimeRequestTitle = String(value ?? "");
    });
    bindDowntimeField("[data-action='downtime-request-description']", (value) => {
      this.downtimeRequestDescription = String(value ?? "");
    });

    element.querySelectorAll("[data-action='downtime-grant']").forEach((button) => {
      button.addEventListener("click", async () => {
        try {
          await this.#handleDowntimeGrant(element);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to grant downtime weeks.`, error);
          const message = error.message || "Не удалось выдать недели простоя.";
          this.#setActionFeedback("error", message);
          ui.notifications?.error(message);
        }
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='downtime-revoke']").forEach((button) => {
      button.addEventListener("click", async () => {
        try {
          await this.#handleDowntimeRevoke(element);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to revoke downtime weeks.`, error);
          const message = error.message || "Не удалось забрать недели простоя.";
          this.#setActionFeedback("error", message);
          ui.notifications?.error(message);
        }
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='downtime-clear-history']").forEach((button) => {
      button.addEventListener("click", async () => {
        try {
          await this.#handleDowntimeClearHistory();
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to clear downtime history.`, error);
          const message = error.message || "Не удалось очистить историю простоя.";
          this.#setActionFeedback("error", message);
          ui.notifications?.error(message);
        }
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='downtime-toggle-archive']").forEach((button) => {
      button.addEventListener("click", () => {
        this.downtimeShowArchive = !this.downtimeShowArchive;
        this.downtimeSelectedRequestId = "";
        this.render({ force: true });
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='downtime-open-request']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        const interactiveTarget = event.target?.closest?.("button, a, input, select, textarea, summary");
        if (interactiveTarget && interactiveTarget !== event.currentTarget) {
          return;
        }

        try {
          await this.#handleDowntimeOpenRequest(event.currentTarget);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to open downtime request.`, error);
          ui.notifications?.error(error.message || "Не удалось открыть заявку простоя.");
        }
      }, listenerOptions);
      button.addEventListener("keydown", async (event) => {
        if (!["Enter", " "].includes(event.key)) {
          return;
        }

        event.preventDefault?.();
        try {
          await this.#handleDowntimeOpenRequest(event.currentTarget);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to open downtime request.`, error);
          ui.notifications?.error(error.message || "Не удалось открыть заявку простоя.");
        }
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='downtime-page']").forEach((button) => {
      button.addEventListener("click", (event) => {
        const target = event.currentTarget;
        const pageType = cleanText(target?.dataset?.pageType);
        const direction = cleanText(target?.dataset?.direction);
        const delta = direction === "next" ? 1 : -1;
        if (pageType === "archive") {
          this.downtimeArchivePage = Math.max(1, this.downtimeArchivePage + delta);
        }
        else {
          this.downtimeQueuePage = Math.max(1, this.downtimeQueuePage + delta);
        }
        this.render({ force: true });
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='downtime-submit']").forEach((button) => {
      button.addEventListener("click", async () => {
        try {
          await this.#handleDowntimeSubmit(element);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to submit downtime request.`, error);
          const message = error.message || "Не удалось отправить заявку на простой.";
          this.#setActionFeedback("error", message);
          ui.notifications?.error(message);
        }
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='downtime-status']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        try {
          await this.#handleDowntimeStatus(event.currentTarget);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to update downtime request status.`, error);
          const message = error.message || "Не удалось обновить заявку простоя.";
          this.#setActionFeedback("error", message);
          ui.notifications?.error(message);
        }
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='downtime-target-action']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        try {
          await this.#handleDowntimeTargetAction(event.currentTarget);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to update downtime target actions.`, error);
          const message = error.message || "Не удалось обновить целевые действия простоя.";
          this.#setActionFeedback("error", message);
          ui.notifications?.error(message);
        }
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='downtime-remove-target-action']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        try {
          await this.#handleDowntimeRemoveTargetAction(event.currentTarget);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to remove downtime target action.`, error);
          const message = error.message || "Не удалось удалить целевое действие простоя.";
          this.#setActionFeedback("error", message);
          ui.notifications?.error(message);
        }
      }, listenerOptions);
    });

    element.querySelector("[data-action='open-actor-sheet']")?.addEventListener("click", async () => {
      try {
        const actor = await this.moduleApi.openPartyInventorySheet();
        bringAppToFront(actor?.sheet);
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to open party inventory sheet.`, error);
        ui.notifications?.error(error.message || "Не удалось открыть лист партийного инвентаря.");
      }
    }, listenerOptions);

    element.querySelector("[data-action='edit-party-crest']")?.addEventListener("click", () => {
      try {
        openPartyInventoryCrestPicker({
          actor: this.groupActor,
          current: resolvePartyInventoryCrest(this.groupActor),
          onSelected: async () => {
            try {
              await this.render({ force: true });
            }
            catch (error) {
              console.error(`${MODULE_ID} | Party inventory crest was saved, but rerender failed.`, error);
              ui.notifications?.warn("Герб сохранён, но окно не удалось обновить.");
            }
          },
          onError: (error) => {
            console.error(`${MODULE_ID} | Failed to update party inventory crest.`, error);
            ui.notifications?.error("Не удалось сохранить герб группы.");
          }
        });
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to open party inventory crest picker.`, error);
        ui.notifications?.error("Не удалось открыть выбор герба группы.");
      }
    }, listenerOptions);

    for (const supplyElement of element.querySelectorAll("[data-action='edit-supply']")) {
      supplyElement.addEventListener("contextmenu", async (event) => {
        if (!this.canManage) {
          return;
        }

        const resourceKey = cleanText(event.currentTarget?.dataset?.resourceKey);
        if (!["food", "water"].includes(resourceKey)) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        try {
          await this.#promptSupply(resourceKey);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to edit party ${resourceKey}.`, error);
          ui.notifications?.error(
            error.message
            || (resourceKey === "water" ? "Не удалось изменить запас воды." : "Не удалось изменить запас еды.")
          );
        }
      }, listenerOptions);
    }

    element.querySelector("[data-action='toggle-inventory-filters']")?.addEventListener("click", async (event) => {
      event.preventDefault();
      this.inventoryMode = this.inventoryMode === "filters" ? "items" : "filters";
      this.inventoryRuleDraftError = "";
      this.inventorySearchRenderPending = true;
      await this.render({ force: true, preserveScroll: true });
    }, listenerOptions);

    element.querySelector("[data-action='create-inventory-rule']")?.addEventListener("click", async () => {
      if (!this.canOrganizeInventory) return;
      this.inventoryRuleDraft = this.#newInventoryRuleDraft();
      this.inventoryRuleDraftError = "";
      this.inventorySearchRenderPending = true;
      await this.render({ force: true, preserveScroll: true });
    }, listenerOptions);

    element.querySelectorAll("[data-action='edit-inventory-rule']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        if (!this.canOrganizeInventory) return;
        const ruleId = cleanText(event.currentTarget.dataset.ruleId);
        const state = normalizeInventoryIngressRuleState(this.inventorySnapshotCache?.inventoryIngressRules ?? null);
        const rule = state.rules.find((entry) => entry.id === ruleId);
        if (!rule) return;
        this.inventoryRuleDraft = this.#newInventoryRuleDraft(rule);
        this.inventoryRuleDraftError = "";
        this.inventorySearchRenderPending = true;
        await this.render({ force: true, preserveScroll: true });
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='delete-inventory-rule']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        if (!this.canOrganizeInventory) return;
        await this.#deleteInventoryRule(cleanText(event.currentTarget.dataset.ruleId));
      }, listenerOptions);
    });

    element.querySelector("[data-action='inventory-rule-name']")?.addEventListener("input", (event) => {
      if (this.inventoryRuleDraft) this.inventoryRuleDraft.name = event.currentTarget.value ?? "";
    }, listenerOptions);

    for (const action of ["inventory-rule-field", "inventory-rule-operator", "inventory-rule-value"]) {
      element.querySelectorAll(`[data-action='${action}']`).forEach((control) => {
        const eventName = action === "inventory-rule-value" && control.tagName !== "SELECT" ? "input" : "change";
        control.addEventListener(eventName, async (event) => {
          const index = Number(event.currentTarget.closest?.("[data-condition-index]")?.dataset?.conditionIndex);
          const condition = this.inventoryRuleDraft?.conditions?.[index];
          if (!condition) return;
          if (action === "inventory-rule-field") {
            condition.field = cleanText(event.currentTarget.value);
            condition.operator = INVENTORY_INGRESS_RULE_FIELD_DEFINITIONS[condition.field]?.operators?.[0] ?? "is";
            condition.valueText = INVENTORY_INGRESS_RULE_FIELD_DEFINITIONS[condition.field]?.kind === "boolean"
              ? "true"
              : "";
          }
          else if (action === "inventory-rule-operator") condition.operator = cleanText(event.currentTarget.value);
          else condition.valueText = event.currentTarget.value ?? "";
          this.inventoryRuleDraftError = "";
          if (action !== "inventory-rule-value") {
            this.inventorySearchRenderPending = true;
            await this.render({ force: true, preserveScroll: true });
          }
        }, listenerOptions);
      });
    }

    element.querySelector("[data-action='inventory-rule-action']")?.addEventListener("change", async (event) => {
      if (!this.inventoryRuleDraft) return;
      this.inventoryRuleDraft.actionType = cleanText(event.currentTarget.value);
      this.inventoryRuleDraftError = "";
      this.inventorySearchRenderPending = true;
      await this.render({ force: true, preserveScroll: true });
    }, listenerOptions);

    element.querySelector("[data-action='inventory-rule-folder']")?.addEventListener("change", (event) => {
      if (this.inventoryRuleDraft) this.inventoryRuleDraft.folderId = cleanText(event.currentTarget.value);
    }, listenerOptions);

    element.querySelector("[data-action='add-inventory-rule-condition']")?.addEventListener("click", async () => {
      this.inventoryRuleDraft?.conditions.push({ field: "sourceType", operator: "is", valueText: "" });
      this.inventorySearchRenderPending = true;
      await this.render({ force: true, preserveScroll: true });
    }, listenerOptions);

    element.querySelectorAll("[data-action='remove-inventory-rule-condition']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        const index = Number(event.currentTarget.closest?.("[data-condition-index]")?.dataset?.conditionIndex);
        if (!this.inventoryRuleDraft?.conditions?.[index]) return;
        this.inventoryRuleDraft.conditions.splice(index, 1);
        this.inventorySearchRenderPending = true;
        await this.render({ force: true, preserveScroll: true });
      }, listenerOptions);
    });

    element.querySelector("[data-action='save-inventory-rule']")?.addEventListener("click", async () => {
      if (this.canOrganizeInventory) await this.#saveInventoryRuleDraft();
    }, listenerOptions);

    element.querySelector("[data-action='cancel-inventory-rule']")?.addEventListener("click", async () => {
      this.inventoryRuleDraft = null;
      this.inventoryRuleDraftError = "";
      this.inventorySearchRenderPending = true;
      await this.render({ force: true, preserveScroll: true });
    }, listenerOptions);

    element.querySelectorAll("[data-action='create-inventory-folder']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await this.#createInventoryFolder(this.rootFolderId);
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='open-inventory-folder-menu']").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const row = event.currentTarget.closest(".rm-inventory-folder-row[data-folder-id]");
        if (!(row instanceof HTMLElement)) return;
        const rect = event.currentTarget.getBoundingClientRect?.() ?? {};
        this.#openInventoryFolderContextMenu(row, {
          x: toNumber(rect.right, toNumber(rect.left, 0) + toNumber(rect.width, 0)),
          y: toNumber(rect.bottom, toNumber(rect.top, 0) + toNumber(rect.height, 0)),
          anchor: event.currentTarget
        });
      }, listenerOptions);
    });

    if (this.canOrganizeInventory) {
      element.querySelectorAll(".rm-inventory-folder-row[data-folder-id]").forEach((row) => {
        row.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.#openInventoryFolderContextMenu(event.currentTarget, {
            x: event.clientX,
            y: event.clientY
          });
        }, listenerOptions);
      });
    }

    element.querySelectorAll("[data-action='toggle-inventory-folder']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const folderId = cleanText(event.currentTarget.dataset.folderId);
        const groupActorId = this.inventoryActorId;
        if (!folderId || !groupActorId || !this.inventoryFolderTreeCache?.foldersById.has(folderId)) return;

        const previousExpandedFolderIds = new Set(this.expandedFolderIds);
        const expanded = !previousExpandedFolderIds.has(folderId);
        if (expanded) this.expandedFolderIds.add(folderId);
        else this.expandedFolderIds.delete(folderId);

        try {
          this.inventorySearchRenderPending = true;
          await this.render({ force: true, preserveScroll: true });
          await this.moduleApi.setInventoryFolderExpanded(groupActorId, folderId, expanded);
        }
        catch (error) {
          this.expandedFolderIds = previousExpandedFolderIds;
          this.inventorySearchRenderPending = true;
          await this.render({ force: true, preserveScroll: true });
          console.error(`${MODULE_ID} | Failed to persist inventory folder expansion.`, error);
          ui.notifications?.error(error.message || "Не удалось изменить раскрытие папки.");
        }
      }, listenerOptions);
    });

    element.querySelector("[data-action='search']")?.addEventListener("input", (event) => {
      this.search = event.currentTarget.value ?? "";
      this.inventorySearchRenderPending = true;
      this.focusRestore = {
        action: "search",
        start: event.currentTarget.selectionStart ?? this.search.length,
        end: event.currentTarget.selectionEnd ?? this.search.length
      };
      window.clearTimeout(this.searchRenderTimeout);
      this.searchRenderTimeout = window.setTimeout(() => {
        this.render({ force: true });
      }, 180);
    }, listenerOptions);

    element.querySelector("[data-action='type-filter']")?.addEventListener("change", (event) => {
      this.typeFilter = event.currentTarget.value || "all";
      this.inventorySearchRenderPending = true;
      this.render({ force: true });
    }, listenerOptions);

    element.querySelector("[data-action='sort-mode']")?.addEventListener("change", (event) => {
      this.sortMode = normalizeInventorySortMode(event.currentTarget.value);
      this.inventorySearchRenderPending = true;
      this.render({ force: true });
    }, listenerOptions);

    element.querySelectorAll("[data-action='edit-currency']").forEach((button) => {
      button.addEventListener("click", async () => {
        try {
          const currentCurrency = this.#readCurrencyFromElement(element);
          const action = await promptCurrencyDialog(currentCurrency);
          if (!action) {
            return;
          }

          if (action.values) {
            await this.moduleApi.updatePartyCurrency(action.values);
          }

          if (action.action === "convert") {
            await this.moduleApi.convertPartyCurrency(action.mode || "normalized");
            ui.notifications?.info("Монеты конвертированы.");
          }
          else {
            ui.notifications?.info("Монеты обновлены.");
          }
          bringAppToFront(this);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to edit currency.`, error);
          ui.notifications?.error(error.message || "Не удалось изменить монеты.");
        }
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='open-compendium-entry']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const { sourceType, sourceId, sourceName } = event.currentTarget.dataset;
        const normalizedSourceType = normalizeInventorySourceType(sourceType);
        try {
          const document = await this.moduleApi.openTradeEntry(normalizedSourceType, sourceId, sourceName);
          bringAppToFront(document?.sheet);
          if (!document) {
            ui.notifications?.warn("Не удалось найти запись в компендии.");
          }
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to open inventory compendium entry '${normalizedSourceType}:${sourceId}'.`, error);
          ui.notifications?.error("Не удалось открыть запись предмета.");
        }
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='open-item-sheet']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        try {
          await this.#openItemSheet(event.currentTarget.dataset.itemId);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to open inventory item sheet.`, error);
          ui.notifications?.error(error.message || "Не удалось открыть лист предмета.");
        }
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='edit-item-quantity']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        const itemId = event.currentTarget.dataset.itemId;
        const currentQuantity = event.currentTarget.dataset.quantity ?? "0";
        const itemName = event.currentTarget.dataset.itemName ?? "Предмет";

        try {
          const nextQuantity = await promptNumericValue({
            title: `Количество: ${itemName}`,
            label: "Новое количество",
            value: currentQuantity,
            min: 0,
            step: "0.01",
            confirmLabel: "Сохранить",
            allowRelative: true
          });

          if (nextQuantity === null) {
            return;
          }

          const parsedQuantity = parseQuantityInputValue(nextQuantity, currentQuantity, {
            relative: true,
            min: 0
          });
          await this.moduleApi.updateInventoryItemQuantity(itemId, parsedQuantity);
          ui.notifications?.info(`Количество предмета «${itemName}» обновлено.`);
          bringAppToFront(this);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to update inventory item quantity.`, error);
          ui.notifications?.error(error.message || "Не удалось изменить количество предмета.");
        }
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='break-item']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        const itemId = event.currentTarget.dataset.itemId;
        const itemName = event.currentTarget.dataset.itemName ?? "предмет";
        const maxQuantity = Math.max(1, toInteger(event.currentTarget.dataset.quantity, 1));
        const minQuantity = Math.max(
          1,
          Math.min(maxQuantity, toInteger(event.currentTarget.dataset.minQuantity, 1))
        );
        try {
          const quantity = await promptNumericValue({
            title: `Разбор: ${itemName}`,
            label: `Сколько разбирать (${minQuantity}-${maxQuantity})`,
            value: String(minQuantity),
            min: minQuantity,
            step: "1",
            confirmLabel: "Разобрать"
          });
          if (quantity === null) {
            return;
          }

          const safeQuantity = Math.max(
            minQuantity,
            Math.min(maxQuantity, toInteger(quantity, minQuantity))
          );
          const result = await this.moduleApi.breakInventoryItemToMaterial(itemId, safeQuantity);
          ui.notifications?.info(`Разобрано: ${result.breakQuantity} x ${result.itemName} -> ${result.materialWeight} фнт. (${result.materialName}).`);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to break inventory item.`, error);
          ui.notifications?.error(error.message || "Не удалось разобрать предмет.");
        }
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='take-item-self']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        const itemId = event.currentTarget.dataset.itemId;
        const itemName = event.currentTarget.dataset.itemName ?? "предмет";
        const maxQuantity = Math.max(1, toInteger(event.currentTarget.dataset.quantity, 1));
        try {
          const quantity = maxQuantity > 1
            ? await promptNumericValue({
              title: `Забрать: ${itemName}`,
              label: `Сколько забрать (1-${maxQuantity})`,
              value: "1",
              min: 1,
              step: "1",
              confirmLabel: "Забрать"
            })
            : 1;
          if (quantity === null) {
            return;
          }

          const safeQuantity = Math.max(1, Math.min(maxQuantity, toInteger(quantity, 1)));
          const result = await this.moduleApi.takeInventoryItemToCharacter(itemId, {
            quantity: safeQuantity
          });
          ui.notifications?.info(result?.requested
            ? `Запрос на получение «${itemName}» отправлен мастеру.`
            : `Предмет «${itemName}» добавлен в ваш лист.`);
          bringAppToFront(this);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to take inventory item.`, error);
          ui.notifications?.error(error.message || "Не удалось забрать предмет из склада.");
        }
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='sell-item']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        const itemId = event.currentTarget.dataset.itemId;
        const itemName = event.currentTarget.dataset.itemName ?? "предмет";
        const maxQuantity = Math.max(1, toInteger(event.currentTarget.dataset.quantity, 1));
        try {
          const quantity = maxQuantity > 1
            ? await promptNumericValue({
              title: `Продать: ${itemName}`,
              label: `Сколько продать (1-${maxQuantity})`,
              value: "1",
              min: 1,
              step: "1",
              confirmLabel: "Продать"
            })
            : 1;
          if (quantity === null) {
            return;
          }

          const safeQuantity = Math.max(1, Math.min(maxQuantity, toInteger(quantity, 1)));
          const result = await this.moduleApi.sellInventoryItem(itemId, safeQuantity);
          ui.notifications?.info(result?.requested
            ? `Запрос на продажу «${itemName}» отправлен мастеру.`
            : `Предмет «${itemName}» продан за половину цены.`);
          bringAppToFront(this);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to sell inventory item.`, error);
          ui.notifications?.error(error.message || "Не удалось продать предмет.");
        }
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='delete-item']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        const itemId = event.currentTarget.dataset.itemId;
        const itemName = event.currentTarget.dataset.itemName ?? "предмет";
        const confirmed = await confirmAction(
          "Удалить предмет",
          `<p>Удалить «${foundry.utils.escapeHTML(itemName)}» из партийного склада?</p>`
        );
        if (!confirmed) {
          return;
        }

        try {
          const result = await this.moduleApi.deleteInventoryItem(itemId);
          ui.notifications?.info(result?.requested
            ? `Запрос на удаление «${itemName}» отправлен мастеру.`
            : `Предмет «${itemName}» удалён из партийного склада.`);
          bringAppToFront(this);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to delete inventory item.`, error);
          ui.notifications?.error(error.message || "Не удалось удалить предмет.");
        }
      }, listenerOptions);
    });

    const dropzone = element.querySelector("[data-action='inventory-dropzone']");
    if (dropzone) {
      let activeDropTarget = null;
      const clearDropState = () => {
        activeDropTarget?.classList?.remove("is-drop-target-ready");
        activeDropTarget = null;
        dropzone.classList.remove("is-dragover");
      };
      const readAcceptedDrop = (event) => {
        let dragData;
        try {
          dragData = TextEditor.getDragEventData(event);
        }
        catch (_error) {
          return null;
        }
        const target = this.#resolveInventoryDropTarget(event, dropzone);
        if (!target) return null;
        const action = this.#resolveInventoryDropAction(dragData, target.folderId);
        return action ? { action, dragData, target } : null;
      };
      const readAcceptedDragOver = (event) => {
        const target = this.#resolveInventoryDropTarget(event, dropzone);
        if (!target) return null;

        try {
          const readableDragData = TextEditor.getDragEventData(event);
          if (readableDragData && Object.keys(readableDragData).length > 0) {
            const action = this.#resolveInventoryDropAction(readableDragData, target.folderId);
            return action ? { action, target } : null;
          }
        }
        catch (_error) {
          // Browsers protect DataTransfer contents during dragover.
        }

        if (activeInventoryTreeDragSession?.dataTransfer === event.dataTransfer) {
          const action = this.#resolveInventoryDropAction(
            activeInventoryTreeDragSession.dragData,
            target.folderId
          );
          return action ? { action, target } : null;
        }

        const transferTypes = Array.from(event.dataTransfer?.types ?? []);
        return transferTypes.some((mimeType) => INVENTORY_DRAG_MIME_TYPES.includes(mimeType))
          ? { action: null, target }
          : null;
      };

      dropzone.addEventListener("dragover", (event) => {
        clearDropState();
        const accepted = readAcceptedDragOver(event);
        if (!accepted) return;
        event.preventDefault();
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = accepted.action?.kind === "external" || !accepted.action ? "copy" : "move";
        }
        dropzone.classList.add("is-dragover");
        activeDropTarget = accepted.target.highlightElement;
        activeDropTarget?.classList?.add("is-drop-target-ready");
      }, listenerOptions);

      dropzone.addEventListener("dragleave", (event) => {
        if (event.relatedTarget && dropzone.contains(event.relatedTarget)) {
          return;
        }
        clearDropState();
      }, listenerOptions);

      dropzone.addEventListener("drop", async (event) => {
        const accepted = readAcceptedDrop(event);
        activeInventoryTreeDragSession = null;
        clearDropState();
        if (!accepted) return;
        event.preventDefault();

        try {
          const result = await this.#applyInventoryDrop(accepted.action, accepted.target.folderId);
          if (accepted.action.kind === "external") {
            if (result?.cancelled === true || result == null) return;
            bringAppToFront(this);
            return;
          }
          const message = accepted.action.kind === "folder"
            ? "Папка перемещена."
            : "Стэк предмета перемещён целиком.";
          ui.notifications?.info(message);
          bringAppToFront(this);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to apply inventory tree drop.`, error);
          ui.notifications?.error(error.message || "Не удалось переместить содержимое инвентаря.");
        }
      }, listenerOptions);
    }

    const addMemberQueryInput = element.querySelector("[data-action='add-member-query']");
    const syncAddMemberSelection = () => {
      const query = addMemberQueryInput?.value ?? "";
      this.newMemberQuery = query;
      this.selectedNewMemberId = this.#resolveAvailableActorIdByName(query);
    };

    addMemberQueryInput?.addEventListener("input", syncAddMemberSelection, listenerOptions);
    addMemberQueryInput?.addEventListener("change", syncAddMemberSelection, listenerOptions);

    element.querySelector("[data-action='add-member']")?.addEventListener("click", async () => {
      this.selectedNewMemberId = this.#resolveAvailableActorIdByName(this.newMemberQuery);
      if (!this.selectedNewMemberId) {
        this.#setActionFeedback("warning", "Введите имя участника и выберите актёра из доступных.");
        this.render({ force: true });
        ui.notifications?.warn("Выберите доступного актёра по имени.");
        return;
      }

      try {
        const actorName = this.availablePartyActors.find((actor) => actor.id === this.selectedNewMemberId)?.name ?? "участник";
        await this.moduleApi.addPartyMember(this.selectedNewMemberId);
        this.newMemberQuery = "";
        this.selectedNewMemberId = "";
        this.#setActionFeedback("success", "Участник добавлен в группу.");
        ui.notifications?.info(`Участник «${actorName}» добавлен в группу.`);
        bringAppToFront(this);
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to add party member.`, error);
        const message = error.message || "Не удалось добавить участника группы.";
        this.#setActionFeedback("error", message);
        this.render({ force: true });
        ui.notifications?.error(message);
      }
    }, listenerOptions);

    const partyDropzone = this.partyMembershipManagedByNativeGroup
      ? null
      : element.querySelector("[data-action='party-dropzone']");
    if (partyDropzone) {
      partyDropzone.addEventListener("dragover", (event) => {
        let dragData = null;
        try {
          dragData = TextEditor.getDragEventData(event);
        }
        catch (_error) {
          return;
        }

        const isActorDrag = dragData?.type === "Actor" || String(dragData?.uuid ?? "").includes("Actor.");
        if (!isActorDrag) {
          return;
        }

        event.preventDefault();
        partyDropzone.classList.add("is-dragover");
      }, listenerOptions);

      partyDropzone.addEventListener("dragleave", () => {
        partyDropzone.classList.remove("is-dragover");
      }, listenerOptions);

      partyDropzone.addEventListener("drop", async (event) => {
        event.preventDefault();
        partyDropzone.classList.remove("is-dragover");

        try {
          const dragData = TextEditor.getDragEventData(event);
          const actorDocument = await this.#resolveDroppedActor(dragData);
          if (!(actorDocument instanceof Actor)) {
            ui.notifications?.warn("Перетащите лист персонажа или актёра.");
            return;
          }

          const isAvailable = this.availablePartyActors.some((actor) => actor.id === actorDocument.id);
          if (!isAvailable) {
            ui.notifications?.warn(`«${actorDocument.name}» нельзя добавить: актёр недоступен или уже в группе.`);
            return;
          }

          const confirmed = await confirmAction(
            "Добавить участника",
            `<p>Добавить «${foundry.utils.escapeHTML(actorDocument.name)}» в группу?</p>`
          );
          if (!confirmed) {
            return;
          }

          await this.moduleApi.addPartyMember(actorDocument.id);
          this.newMemberQuery = "";
          this.selectedNewMemberId = "";
          this.#setActionFeedback("success", `Участник «${actorDocument.name}» добавлен в группу.`);
          ui.notifications?.info(`Участник «${actorDocument.name}» добавлен в группу.`);
          bringAppToFront(this);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to add party member by drop.`, error);
          ui.notifications?.error(error.message || "Не удалось добавить участника из перетаскивания.");
        }
      }, listenerOptions);
    }

    element.querySelectorAll("[data-action='party-field']").forEach((field) => {
      field.addEventListener("change", async (event) => {
        const actorId = event.currentTarget.dataset.actorId;
        const fieldName = event.currentTarget.dataset.field;
        const nextValue = event.currentTarget.value ?? "";
        if (!actorId || !fieldName) {
          return;
        }

        const patch = {};
        patch[fieldName] = nextValue;

        try {
          this.#rememberExpandedPartyMembers(element);
          await this.moduleApi.updatePartyMember(actorId, patch);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to update party member field '${fieldName}'.`, error);
          ui.notifications?.error(error.message || "Не удалось обновить участника группы.");
        }
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='party-energy-current']").forEach((field) => {
      field.addEventListener("change", async (event) => {
        const actorId = event.currentTarget.dataset.actorId;
        const currentEnergy = event.currentTarget.value;
        if (!actorId) {
          return;
        }

        try {
          this.#rememberExpandedPartyMembers(element);
          await this.moduleApi.setPartyMemberEnergy(actorId, currentEnergy);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to set party member energy.`, error);
          ui.notifications?.error(error.message || "Не удалось обновить энергию участника.");
        }
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='party-restore-energy']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        const actorId = event.currentTarget.dataset.actorId;
        const actorName = event.currentTarget.dataset.actorName ?? "участник";
        if (!actorId) {
          return;
        }

        try {
          const daysValue = await promptNumericValue({
            title: `Восстановить энергию: ${actorName}`,
            label: "На сколько дней восстановить энергию",
            value: "1",
            min: 1,
            step: "1",
            confirmLabel: "Восстановить"
          });
          if (daysValue === null) {
            return;
          }

          const days = Math.max(1, toInteger(daysValue, 1));
          this.#rememberExpandedPartyMembers(element);
          await this.moduleApi.restorePartyMemberEnergy(actorId, days);
          ui.notifications?.info(`Энергия ${actorName} восстановлена на ${days} дн.`);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to restore party member energy.`, error);
          ui.notifications?.error(error.message || "Не удалось восстановить энергию.");
        }
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='party-tool-field']").forEach((field) => {
      field.addEventListener("change", async (event) => {
        const actorId = event.currentTarget.dataset.actorId;
        const toolId = event.currentTarget.dataset.toolId;
        const fieldName = event.currentTarget.dataset.field;
        if (!actorId || !toolId || !fieldName) {
          return;
        }

        const patch = {};
        if (fieldName === "owned" || fieldName === "prof") {
          patch[fieldName] = Boolean(event.currentTarget.checked);
        }
        else {
          patch[fieldName] = toNumber(event.currentTarget.value, 0);
        }

        try {
          this.#rememberExpandedPartyMembers(element);
          await this.moduleApi.updatePartyMemberTool(actorId, toolId, patch);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to update party member tool state.`, error);
          ui.notifications?.error(error.message || "Не удалось обновить инструмент участника.");
        }
      }, listenerOptions);
    });

    element.querySelector("[data-action='craft-search']")?.addEventListener("input", (event) => {
      this.craftSearch = event.currentTarget.value ?? "";
      this.focusRestore = {
        action: "craft-search",
        start: event.currentTarget.selectionStart ?? this.craftSearch.length,
        end: event.currentTarget.selectionEnd ?? this.craftSearch.length
      };
      window.clearTimeout(this.craftSearchRenderTimeout);
      this.craftSearchRenderTimeout = window.setTimeout(() => {
        this.render({ force: true });
      }, 180);
    }, listenerOptions);

    element.querySelector("[data-action='craft-crafter']")?.addEventListener("change", (event) => {
      this.craftCrafterActorId = event.currentTarget.value || "";
      this.render({ force: true });
    }, listenerOptions);

    element.querySelectorAll("[data-action='craft-approve-request']").forEach((button) => {
      button.addEventListener("click", (event) => this.#handleCraftApproval(event.currentTarget), listenerOptions);
    });

    element.querySelectorAll("[data-action='party-default-field']").forEach((field) => {
      field.addEventListener("change", async (event) => {
        const fieldName = event.currentTarget.dataset.field;
        if (!fieldName) {
          return;
        }

        try {
          await this.moduleApi.updatePartyDefaults({
            [fieldName]: event.currentTarget.type === "checkbox"
              ? event.currentTarget.checked
              : (event.currentTarget.value ?? "")
          });
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to update party default field '${fieldName}'.`, error);
          ui.notifications?.error(error.message || "Не удалось обновить настройки группы.");
        }
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='craft-return-request']").forEach((button) => {
      button.addEventListener("click", (event) => (
        this.#handleCraftRequestDecision(event.currentTarget, "returned")
      ), listenerOptions);
    });

    element.querySelectorAll("[data-action='craft-reject-request']").forEach((button) => {
      button.addEventListener("click", (event) => (
        this.#handleCraftRequestDecision(event.currentTarget, "rejected")
      ), listenerOptions);
    });

    for (const action of ["pause", "resume", "reconcile", "cancel"]) {
      element.querySelectorAll(`[data-action='craft-${action}-project']`).forEach((button) => {
        button.addEventListener("click", (event) => (
          this.#handleCraftProjectLifecycle(event.currentTarget, action)
        ), listenerOptions);
      });
    }

    element.querySelectorAll(".rm-party-row__summary").forEach((summaryNode) => {
      summaryNode.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();

        const row = event.currentTarget.closest(".rm-party-row[data-actor-id]");
        if (!(row instanceof HTMLElement)) {
          return;
        }

        const actorId = String(row.dataset.actorId ?? "").trim();
        const actorName = String(row.dataset.actorName ?? "").trim() || "участника";
        if (!actorId) {
          return;
        }

        const actions = [{
          label: "Открыть лист",
          icon: "fa-solid fa-user",
          callback: () => {
            void this.#openPartyMemberSheet(actorId, actorName);
          }
        }];
        if (this.canManage && !this.partyMembershipManagedByNativeGroup) {
          actions.push({
            label: "Удалить из группы",
            icon: "fa-solid fa-user-minus",
            danger: true,
            callback: async () => {
              await this.#removePartyMember(actorId, actorName, element);
            }
          });
        }

        this.#openContextMenu({
          x: event.clientX,
          y: event.clientY,
          title: actorName,
          actions
        });
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='open-item-menu']").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const row = event.currentTarget.closest(".rm-compact-item");
        if (!(row instanceof HTMLElement)) {
          return;
        }

        const rect = event.currentTarget.getBoundingClientRect?.() ?? {};
        const x = Number.isFinite(event.clientX) && event.clientX > 0
          ? event.clientX
          : toNumber(rect.right, toNumber(rect.left, 0) + toNumber(rect.width, 0));
        const y = Number.isFinite(event.clientY) && event.clientY > 0
          ? event.clientY
          : toNumber(rect.bottom, toNumber(rect.top, 0) + toNumber(rect.height, 0));
        this.#openItemContextMenu(row, {
          x,
          y,
          anchor: event.currentTarget
        });
      }, listenerOptions);
    });

    element.querySelectorAll(".rm-compact-item").forEach((itemRow) => {
      itemRow.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();

        const row = event.currentTarget.closest(".rm-compact-item");
        if (!(row instanceof HTMLElement)) {
          return;
        }

        this.#openItemContextMenu(row, {
          x: event.clientX,
          y: event.clientY
        });
      }, listenerOptions);
    });

    element.querySelector("[data-action='calendar-set']")?.addEventListener("click", async () => {
      try {
        const year = toInteger(element.querySelector("[data-field='calendar-year']")?.value, 1);
        const month = toInteger(element.querySelector("[data-field='calendar-month']")?.value, 1);
        const day = toInteger(element.querySelector("[data-field='calendar-day']")?.value, 1);
        const toIsoDate = buildCalendarIsoDate(year, month, day);
        const transition = await this.#runCalendarTransition(toIsoDate);
        if (!transition) {
          return;
        }
        ui.notifications?.info("Календарь обновлён.");
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to set calendar date.`, error);
        ui.notifications?.error(error.message || "Не удалось изменить дату календаря.");
      }
    }, listenerOptions);

    element.querySelectorAll("[data-action='calendar-pick-day']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        try {
          const year = toInteger(event.currentTarget.dataset.year, 1);
          const month = toInteger(event.currentTarget.dataset.month, 1);
          const day = toInteger(event.currentTarget.dataset.day, 1);
          const toIsoDate = cleanText(event.currentTarget.dataset.isoDate) || buildCalendarIsoDate(year, month, day);
          const transition = await this.#runCalendarTransition(toIsoDate);
          if (!transition) {
            return;
          }
          bringAppToFront(this);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to pick calendar day.`, error);
          ui.notifications?.error(error.message || "Не удалось выбрать дату календаря.");
        }
      }, listenerOptions);

      button.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const isoDate = cleanText(event.currentTarget.dataset.isoDate);
        this.#openCalendarDayInfo(isoDate);
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='calendar-advance']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        const unit = event.currentTarget.dataset.unit || "day";
        const value = Math.max(1, toInteger(event.currentTarget.dataset.value, 1));
        try {
          const currentIsoDate = cleanText(this.moduleApi.getCalendarSnapshot()?.isoDate);
          const toIsoDate = buildCalendarAdvanceIsoDate(currentIsoDate, unit, value);
          const transition = await this.#runCalendarTransition(toIsoDate, { processSupplies: true });
          if (!transition) {
            return;
          }

          await this.#notifyAdvanceResult(transition.result);
          bringAppToFront(this);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to advance calendar.`, error);
          const message = error.message || "Не удалось продвинуть календарь.";
          this.#setActionFeedback("error", message);
          this.render({ force: true });
          ui.notifications?.error(message);
        }
      }, listenerOptions);
    });

    this.#restoreFocusToInput(element);
    this.#restoreScrollPositions(element);
  }

  async _preClose(options) {
    this.#closeContextMenu();
    window.clearTimeout(this.searchRenderTimeout);
    window.clearTimeout(this.craftSearchRenderTimeout);
    window.clearTimeout(this.actionFeedbackTimeout);
    this.searchRenderTimeout = null;
    this.inventorySearchRenderPending = false;
    this.inventorySnapshotCache = null;
    this.inventoryFolderTreeCache = null;
    this.inventorySearchIndexCache = null;
    this.inventoryContextCache = null;
    this.expandedFolderIds.clear();
    this.craftSearchRenderTimeout = null;
    this.actionFeedbackTimeout = null;
    this.renderListenersAbortController?.abort();
    this.renderListenersAbortController = null;
    return super._preClose ? super._preClose(options) : undefined;
  }

  async _onClose(options) {
    this.moduleApi?.unregisterInventoryFolderPopout?.(this.inventoryViewKey, this);
    return super._onClose ? super._onClose(options) : undefined;
  }
}

