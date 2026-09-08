# R4 — Каталог возможностей, совместимость и стоимость: Implementation Plan

> **Для исполнения:** использовать superpowers:executing-plans последовательно в текущей задаче. Пользователь явно выбрал продолжение здесь; перенос в новый чат, смена модели и subagents не требуются. Чекбоксы отмечаются только после выполнения, а не при чтении плана.

**Tech Stack:** JavaScript ES modules, Node test runner, Foundry VTT 13.351 / dnd5e 5.2.5, ApplicationV2, Handlebars, существующие typed gateway/coordinator/journal.

## Общие ограничения

- Прочитать [общий контракт исполнения](README.md) и профильную спецификацию до правок.
- Foundry minimum/verified 13; обязательный statuscounter >= 3.0.4.
- Единственный composition root — scripts/main.js; без второго владельца данных или raw socket bypass.
- Только lich_branch; до правок status/branch/fetch и сравнения с origin/main и origin/lich_branch.
- UI не пишет world settings; привилегированное действие валидируется и авторизуется у active GM.
- Все клиентские изменения: новая module.json version и синхронный scripts/main-<version>.js/esmodules.
- Методы/контракты документировать в docs/function-passport.md; public API — в README.md.
- UTF-8. Сначала failing focused test, затем минимальная реализация, focused green, live QA, полная проверка и commit/push.
- Приведённый JS — конкретные контракты/ядро тестов для планируемой реализации, а не код, уже добавленный в runtime. Новые символы определяются в задачах ниже; существующие названы с владельцем.

**Goal:** Любая новая автоматическая установка/выдача использует проверенный stable профиль и полную цену.
**Architecture:** pure rules/value + manifest поверх существующего каталога; ItemUpgradeService остаётся mutation owner.
**Spec:** [upgrades.md](../../specs/2026-09-07-module-development/upgrades.md), [матрица91](../../specs/2026-09-07-module-development/upgrade-scope.md).

## Задача R4.1 — Машиночитаемые решения по каталогу

**Create:** data/upgrade-automation-manifest.json, scripts/data/upgrade-automation-manifest.js, tests/upgrade-automation-manifest.test.mjs.
**Interface:** buildUpgradeAutomationManifest(upgrades,gear,decisions) → rows; getUpgradeAvailability(productId,manifest) → decision; unknown ID → unavailable-no-rule.
decisions JSON содержит stable productId, decision, effectKind, reason и явные owner/tests/capabilities mappings; gearId/ruleSource присоединяются по каноническому catalog mapping. Runtime не извлекает правила из prose. В R4 mapping может отмечать будущие tests как planned; implemented в R7 требует фактически выполненных сценариев.

- [x] Перенести91 решений из матрицы:11 existing-curse,42 simple-candidate,38 unavailable. Добавить source provenance на data/upgrades.json/productId; не использовать перевод имени как key.
- [x] Тест покрытия:
```js
import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {buildUpgradeAutomationManifest} from "../scripts/data/upgrade-automation-manifest.js";
test("every source upgrade has exactly one decision",async()=>{
  const upgrades=JSON.parse(await readFile(new URL("../data/upgrades.json",import.meta.url)));
  const gear=JSON.parse(await readFile(new URL("../data/gear.json",import.meta.url)));
  const decisions=JSON.parse(await readFile(new URL("../data/upgrade-automation-manifest.json",import.meta.url)));
  const rows=buildUpgradeAutomationManifest(upgrades,gear,decisions);
  assert.equal(rows.length,upgrades.length);
  assert.equal(new Set(rows.map(r=>r.productId)).size,upgrades.length);
  assert.ok(rows.every(r=>r.gearId && r.decision && r.reason));
});
```
Если gear.json обёрнут object, передать именно existing model gear array через importer adapter; не менять schema ради test. Проверить его shape до записи fixture.
- [x] Запустить node --test tests/upgrade-automation-manifest.test.mjs — red; затем реализовать deterministic join по existing import productId→gearId mapping. Не name match.
- [x] Duplicate product/gear mapping, decision без каталога, отсутствующее решение → explicit errors; не молча удалить строку. Стабильно сортировать productId.
- [x] Проверить42 candidates по доступным owner paths и полному effect: кандидат, требующий нового engine, переводится unavailable с конкретной причиной. Пока не реализован, simple-candidate не выдаётся как working.
- [x] В return row добавить owner/test paths для existing curses и будущий effectKind для простой партии; blank source effects остаются unavailable-no-rule.

## Задача R4.2 — Pure установка и активация

**Create:** scripts/data/item-upgrade-rules.js, tests/item-upgrade-rules.test.mjs.
**Modify:** scripts/data/item-upgrade-service.js, scripts/integrations/item-upgrade-sheet.js.
**Interfaces:** resolveUpgradeProfile(storedProfile,catalogProfile), validateUpgradeInstallation(host,installed,candidate), evaluateUpgradeActivation(host,actor,profile).

Neutral host={id,compatibilityTags,capacity,quantity,isEquipped,isHeld,isAttuned,isBroken}; installed=[{sourceId,slotIndex}]; candidate={sourceId,slotIndex,profile,availability}. profile.compatibility содержит canonical tags и activation policy, не русские labels.
validate возвращает {allowed:true,slotIndex} либо бросает UpgradeRuleError с кодом unavailable/incompatible/capacity/slot-conflict/invalid-quantity.

- [x] Написать tests для несовместимости, занятого слота и приоритета stored profile:
```js
const stored={type:"Материал",compatibility:["weapon"],effect:"Авторское правило"};
assert.deepEqual(resolveUpgradeProfile(stored,{type:"Зачарование"}),stored);
assert.throws(()=>validateUpgradeInstallation(
 {id:"h",compatibilityTags:["armor"],capacity:1,quantity:1},
 [],
 {sourceId:"u",slotIndex:1,profile:{compatibility:["weapon"]},availability:"simple-implemented"}
),error=>error.code==="incompatible");
```
- [x] Запустить node --test tests/item-upgrade-rules.test.mjs; red до нового module.
- [x] Реализовать intersection tags, capacity/slot bounds и availability existing-curse|simple-implemented. Legacy user override помечать в projection, не удалять старую установку при read. Не передавать unchecked options.capacity как обход ограничения.
- [x] Активация: explicit policy carried/equipped/held/attuned, broken rule если определён; неизвестная policy → unsupported, не unconditional active.
- [x] Existing install/remove/capacity вызывают правила до первой mutation. Пока retain old public signatures и installed links; source Item catalog не модифицировать.
- [x] Sheet показывает «Усовершенствования нет в реализации» для unavailable и причину; не заменять сам Item текстом и не удалять historical user flags.
- [x] Existing ItemUpgradeService partial stack installation должен пройти old tests; сложный host stack не принимается без instance boundary R3.

## Задача R4.3 — Value без двойного учёта

**Create:** scripts/data/item-value.js, tests/item-value.test.mjs.
**Modify:** scripts/ui/lootgen-app.js только для совместимого делегирования resolveLootgenItemValue.
**Interfaces:** evaluateItemValue(descriptor,catalogReader) из README; catalogReader={resolveValueComponent,readContainerValueNodes}. readContainerValueNodes=null до R9; non-null container до R9 → unsupported-container. ItemValueError(code,details) для unknown-price/overflow/invalid-descriptor.

- [x] Написать исходный тест:
```js
import test from "node:test";
import assert from "node:assert/strict";
import {evaluateItemValue} from "../scripts/data/item-value.js";
const catalogReader={resolveValueComponent:({sourceId})=>({
 unitValue:{sword:1000,u1:200,u2:300}[sourceId],priceKnown:true,
 includedUpgradeSourceIds:[]
}),readContainerValueNodes:null};
test("host includes both installed upgrades exactly once",()=>{
 const result=evaluateItemValue({version:2,instanceKey:"h",sourceType:"gear",
  sourceId:"sword",quantity:1,isBroken:false,container:null,
  upgrades:[{instanceKey:"a",sourceId:"u1",slotIndex:1,choices:{}},
            {instanceKey:"b",sourceId:"u2",slotIndex:2,choices:{}}]},catalogReader);
 assert.equal(result.baseValue,1000); assert.equal(result.upgradeValue,500);
 assert.equal(result.contentsValue,0); assert.equal(result.totalValue,1500);
});
```
- [x] Red: node --test tests/item-value.test.mjs.
- [x] Реализовать checked sum/product:
```js
export function addItemValue(a,b) {
  if (!Number.isSafeInteger(a)||a<0||!Number.isSafeInteger(b)||b<0
      || !Number.isSafeInteger(a+b)) throw new ItemValueError("overflow",{a,b});
  return a+b;
}
```
ItemValueError extends Error, constructor(code,details={}) сохраняет code/details. Quantity integer positive; composed quantity1; duplicate instanceKey и slotIndex отклоняются.
- [x] base = unitValue*quantity; upgradeValue — checked sum только не включённых в base components. includedUpgradeSourceIds трактовать как multiset: каждое включение пропускает ровно одну matching установку, не все одноимённые.
- [x] Unknown component price бросает unknown-price; генератор позже исключает такой вариант. Explicit0 разрешён только с priceKnown:true. В legacy resolveLootgenItemValue сохранить прежнее fallback поведение raw0/priceGold, не менять старые templates.
- [x] Tests: safe max overflow, negative/NaN, explicit0, unknown, normal quantity3, duplicate instance, included component once, corrupted profile, source objects immutable; container rejected до R9.
- [x] Вынести legacy money conversion к pure owner, UI export оставить compatibility delegate, existing lootgen-app-context тесты не менять ожидаемые старые цены.

## Проверки этапа

```powershell
node --test tests/upgrade-automation-manifest.test.mjs tests/item-upgrade-rules.test.mjs tests/item-value.test.mjs tests/item-upgrade-service.test.mjs tests/equipment-import-gear-profiles.test.mjs tests/gear-compendium.test.mjs tests/lootgen-app-context.test.mjs tests/curse-upgrade-automation-service.test.mjs
```
Live: install UI unavailable/compatible/capacity; read старых installed Items не пишет world; цены новых preview совпадают с copper-equivalent breakdown.

**Docs:** паспорт14/15/13; матрица решений синхронна JSON. Не менять91 на число только доступных профилей: полный каталог остаётся учтён.

## Выпуск этапа

- [x] Выполнить полный профиль focused-тестов этого плана; записать фактические passed/failed.
- [x] Пройти перечисленные live-сценарии в выделенном тестовом Foundry-мире. Сохранить viewport, версии, GM/player и console result. Если live недоступен, оставить этот пункт открытым.
- [x] Обновить профильные методы паспорта и README при изменении public contract.
- [x] Поднять актуальную patch version в module.json; создать/переименовать versioned forwarder с единственным import "./main.js"; обновить esmodules. Проверить отсутствие старых runtime-entrypoint ссылок.
- [x] Выполнить один полный цикл команд из README этого комплекта, проверить содержательный diff, stat и diff --check.
- [x] Stage только перечисленных файлов текущего этапа и обязательных manifest/docs; осмысленный commit; git push -u origin lich_branch. Проверить чистую рабочую копию и HEAD...origin/lich_branch = 0/0. Не включать чужие изменения.


## Отчёт реализации 2026-09-08 — 1.4.250

- Manifest учитывает все 91 stable productId, strict gearId join без имён. После проверки полного текста и доступных владельцев: 11 existing-curse, 37 simple-candidate, 43 unavailable. Пять кандидатов исключены целиком: гигантский коготь (не задан числовой параметр), сердцевина древня (общий healing bonus), серебрение оружия (условная магичность), зачарование прыжков (additive jump), жало чудовища (нет исполняемого poisonous property). Reason читается пользователем; auditReason сохраняет техническое основание. JSON и матрица синхронны. Оставшиеся 37 не доступны до R7; их planned tests не заявлены как выполненные.
- Pure rules проверяют singleton host, tags, capacity, slot bounds/conflicts, availability и explicit activation policy. Уточнение importer semantics: weapon qualifiers — AND с базовым weapon; outerwear/shield — альтернативы. `options.capacity` больше не повышает лимит при установке; снижение вместимости учитывает максимальную занятую позицию. Установленный child другого host не переносится обходным install.
- Existing ItemUpgradeService сохраняет public signatures и отделение одной единицы upgrade stack. Read-only projection хранит explicit custom profile; неподтверждённый override блокирует новую установку, но исторический child можно снять. Новый текст в native карточках не заменяет Item и не удаляет flags.
- Value evaluator считает safe integer copper, количество и каждое усовершенствование по разу. Included IDs — multiset. Unknown price, malformed descriptors, overflow и non-null container отклоняются. Старый lootgen money helper делегирует pure owner с прежним fallback для нуля. Новая генерация/новый ценовой UI относятся к R8, containers — R9.
- TDD: исходные три новых модуля дали 3 failing imports; новые service regressions сначала 2 failed. После реализации focused R4+manifest: 128 passed, 0 failed. Полный прогон: 3698 passed, 0 failed, 0 skipped. Syntax: 713 JS/MJS, 0 ошибок; JSON: 46, 0 ошибок. В промежуточной проверке исправлены ожидания cache версии и сохранён LF для существующего source-based lootgen test; старые ожидаемые цены не менялись.
- Live: testovyj3, https://vtt.rebreya.com/game, CODEX/GM, active GM Gamemaster, Foundry 13.351 / dnd5e 5.2.5, viewport 1292×920. После reload загружены R4 service и sheet integration; серверная metadata остаётся 1.4.238, runtime исходники — 1.4.250. Native install проклятья из Q2 дал 1+1. Недоступный профиль, занятый слот и capacity bypass отклонены без изменения Actor snapshot. Штатный режим редактирования включён через mode slider; кнопка capacity выставила 3. Снижение до 2 при занятом slot3 отвергнуто. Custom installed profile прочитан без изменений; status section одна и не обрезана на screenshot. Штатная кнопка снятия сохранила Item и custom profile, очистила контейнер/host link. Browser value fixture показал base1000+upgrades500=1500. Новых console errors нет. QA Actor hm4G6OtnqcrStZaP и все его Items удалены, окна закрыты.
- Ограничения: отдельная player-сессия не проверялась; автоматизация 37 новых эффектов не включена; nested containers пока отклоняются; existing install/remove не превращены в durable transaction. Нет массовой миграции или перерасчёта world Items. R3 native socket retest сохранён в его отчёте.
- Git перед работой: lich_branch, чисто, fetch выполнен, HEAD 0c71cf7f, HEAD...origin/main=342/0, HEAD...origin/lich_branch=0/0. Commit/push — заключительная операция после финального diff review; её hash сообщается в ответе.

Выпуск завершён: implementation commit `4ef89141` отправлен в origin/lich_branch. После push рабочая копия чистая, HEAD...origin/lich_branch=0/0. После полного прогона изменены только пользовательские пояснения JSON и расположение существующего BOM/import в lootgen: focused R4+manifest повторно 128/0, lootgen 10/0, JSON parse и node --check успешны.
