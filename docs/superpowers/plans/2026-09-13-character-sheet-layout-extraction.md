# Character Sheet Layout extraction — implementation plan

> Реализовать в текущем чате без subagents. Дизайн: `docs/superpowers/specs/2026-09-13-character-sheet-layout-extraction-design.md`.

**Цель:** перенести оформление листов Actor в независимый system-agnostic модуль, расширить его на Actor и Item, однократно перенести локальные world-флаги и удалить прежнее поведение из Rebreya.

**Архитектура:** pure data/SVG core переносится почти без изменений. Один compatibility adapter нормализует Foundry V12 ApplicationV1 и V13–14 ApplicationV2. Новый модуль владеет `flags.character-sheet-layout.sheetArt`; Rebreya после локальной миграции не знает об этом поведении.

## 1. Создать standalone module repository

Создать `D:\FoundryVTT\Data\modules\character-sheet-layout` и локальный Git repository без remote.

Добавить:

- `module.json` с id `character-sheet-layout`, version `1.0.0`, minimum 12, verified 13;
- `scripts/main.js` как единственный entrypoint;
- `styles/main.css`;
- `lang/en.json`, `lang/ru.json`;
- `README.md`, `.gitignore`.

Проверить JSON parse и отсутствие remote.

## 2. Перенести data core и поведенческие тесты

Создать `scripts/data/sheet-art.js` и `tests/sheet-art-data.test.mjs`.

Перенести `normalizeSheetArt`, `sheetArtGeometry`, `sheetArtPreview`. Заменить `saveSheetArt(actor, value)` на `saveSheetArt(document, value)`:

- разрешены только `documentName` Actor/Item;
- требуется `isOwner` и `setFlag`;
- запись только в `character-sheet-layout.sheetArt`;
- никаких `game.system` и `document.system`.

Focused test:

```powershell
node --test tests/sheet-art-data.test.mjs
```

## 3. Перенести SVG overlay и редактор

Создать:

- `scripts/ui/sheet-art-overlay.js`;
- `scripts/ui/sheet-art-editor.js`;
- `tests/sheet-art-svg.test.mjs`.

Переименовать CSS/data prefixes `rm-` в `csl-`. Overlay читает новый namespace, принимает Actor или Item, заменяет прежний binding и освобождает ResizeObserver. Сохранить left anchoring и height-based geometry.

Редактор сохраняет draft, FilePicker, image decode guard, mask paint/erase, undo/clear, preview zoom/pan, opacity/position/scale и save/cancel. Диалог создаётся через injected compatibility function.

Focused test:

```powershell
node --test tests/sheet-art-svg.test.mjs
```

## 4. Добавить Foundry V12–14 compatibility adapter

Создать:

- `scripts/foundry/application-compat.js`;
- `scripts/foundry/document-sheet-hooks.js`;
- `tests/application-compat.test.mjs`;
- `tests/document-sheet-hooks.test.mjs`.

Adapter должен:

- распознавать Actor/Item через `documentName` и несколько публичных app references;
- нормализовать HTMLElement и jQuery-like root;
- добавлять V12/V1 header button через `getApplicationHeaderButtons`;
- добавлять V13–14/V2 control через `getHeaderControlsApplicationV2`;
- использовать DialogV2, если доступен, иначе legacy Dialog;
- регистрировать render/close hooks обоих поколений;
- дедуплицировать controls и root bindings.

Focused tests:

```powershell
node --test tests/application-compat.test.mjs tests/document-sheet-hooks.test.mjs
```

## 5. Собрать module API и проверить новый репозиторий

`scripts/main.js` регистрирует hooks на `init`, публикует API и не читает Rebreya. README фиксирует поддерживаемые Documents, флаг и честную матрицу проверки поколений.

Проверки:

```powershell
node --test tests/*.test.mjs
Get-ChildItem scripts -Recurse -Include *.js | ForEach-Object { node --check $_.FullName }
Get-Content -Raw -Encoding UTF8 module.json | ConvertFrom-Json | Out-Null
git diff --check
```

Сделать локальный commit в новом repository; remote не добавлять.

## 6. Включить модуль и выполнить локальную миграцию

Через существующий Foundry MCP bridge:

1. подтвердить `game.ready`, Foundry/system versions, active modules и GM user;
2. включить `character-sheet-layout` в текущем мире штатным способом и перезагрузить мир при необходимости;
3. перечислить world Actors с `rebreya-main.sheetArt`;
4. нормализовать и записать каждый флаг в `character-sheet-layout.sheetArt`;
5. перечитать и сравнить новое значение;
6. удалить старый флаг только для успешно проверенного Actor;
7. повторно перечислить legacy/new flags и записать агрегированный результат.

Не сохранять migration script в модуле или Rebreya. Не печатать полный пользовательский mask payload.

## 7. Удалить старого владельца из Rebreya

Удалить:

- `scripts/data/character-sheet-art.js`;
- `scripts/ui/character-sheet-art.js`;
- `tests/character-sheet-art.test.mjs`.

Изменить:

- `scripts/integrations/dnd5e-sheet-extensions.js`: убрать import, controls registration, bind/unbind calls;
- `tests/item-sheet-branding.test.mjs`: убрать ожидание `rebreyaSheetArt`;
- `styles/main.css`: убрать только `.rm-sheet-art*` и `.rm-art-*` блоки;
- `README.md`: удалить раздел оформления;
- `docs/function-passport.md`: удалить записи методов оформления;
- `module.json`: повысить patch version;
- `scripts/main-<version>.js`: создать forwarder и переключить `esmodules`.

Проверить `rg` на остаточные runtime references. Историческую утверждённую спецификацию и этот план не считать runtime ownership.

## 8. Проверить Rebreya и live UI

Focused проверки затронутых Rebreya tests, затем один полный проход из `AGENTS.md`:

```powershell
node --test tests/*.test.mjs
git diff --check
$files = git ls-files '*.js' '*.mjs'; foreach ($file in $files) { node --check $file }
$json = git ls-files '*.json'; foreach ($file in $json) { Get-Content -Raw -Encoding UTF8 $file | ConvertFrom-Json | Out-Null }
```

Live QA на установленной версии Foundry:

- Actor и Item получают ровно один menu control;
- editor open/save/cancel;
- overlay после reload;
- horizontal resize не меняет art geometry;
- vertical resize масштабирует art и mask вместе;
- minimize/reopen и repeated render не оставляют дубликаты/observer;
- новый модуль работает при отключённой Rebreya;
- console не содержит новых ошибок или deprecation warnings.

После проверок добавить только task files, сделать commit в `lich_branch` и push. Не трогать чужие изменения.
