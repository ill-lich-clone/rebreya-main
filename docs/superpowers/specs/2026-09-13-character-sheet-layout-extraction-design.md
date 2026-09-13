# Character Sheet Layout: выделение оформления листов в отдельный модуль

Дата: 2026-09-13. Статус: дизайн утверждён; runtime-код не изменён.

Исследованная база: ветка `lich_branch`, Rebreya Main `1.4.292`. Текущий модуль рассчитан на Foundry VTT 13. Локальная живая проверка при подготовке спецификации не выполнялась.

## 1. Наблюдаемый результат

Оформление листов становится самостоятельным локальным модулем `Character Sheet Layout` в `D:\FoundryVTT\Data\modules\character-sheet-layout`.

После реализации:

- Rebreya Main не содержит кода, стилей, хуков, документации или тестов, владеющих оформлением листов;
- Character Sheet Layout устанавливается и разрабатывается без Rebreya Main и без обязательного игрового модуля;
- пункт настройки доступен владельцу документа и GM на всех открываемых листах Actor и Item независимо от типа документа и активной системы;
- Actor и Item используют один schema-versioned flag `flags.character-sheet-layout.sheetArt`;
- существующая геометрия, SVG-маска, кисть входа внутрь листа, ластик, масштабирование предпросмотра, позиционирование, прозрачность и привязка изображения слева сохраняются;
- изменение ширины листа не меняет размер и положение изображения; изменение высоты масштабирует оформление по прежней геометрии;
- изображение не перехватывает ввод, не ломает прокрутку листа и скрывается при сворачивании окна;
- новый модуль имеет собственный локальный Git-репозиторий без remote.

## 2. Границы

### Включено

- Новый модуль, манифест, entrypoint, стили, русская и английская локализация, README и focused-тесты.
- System-agnostic Document adapter для Actor и Item.
- Совместимость хуков, корневых элементов листа, header controls, закрытия и диалогов для Foundry VTT 12–14 через один runtime adapter.
- Перенос текущих pure data/SVG контрактов из Rebreya с заменой namespace и Actor-only ограничений.
- Удаление прежнего владельца поведения из Rebreya и обновление `docs/function-passport.md`.
- Однократная локальная миграция существующих world Actor-флагов через уже установленный Foundry MCP bridge.

### Исключено

- Runtime-мигратор, legacy fallback или код чтения `flags.rebreya-main.sheetArt` в новом модуле.
- Публикация репозитория, создание remote, release ZIP или регистрация пакета Foundry.
- Bundled artwork, пресеты оформления, system-specific поля и адаптеры dnd5e.
- Оформление JournalEntry, Scene, TokenConfig и произвольных Application окон.
- Обещание живой совместимости на поколении Foundry, которое фактически не запускалось.

## 3. Владение данными и локальная миграция

Канонический namespace после переноса:

```text
flags.character-sheet-layout.sheetArt
```

Schema остаётся version 1 и хранит allowlisted поля `{version, enabled, src, x, y, scale, aspect, frameAspect, opacity, strokes}`. Данные не содержат HTML, CSS или пользовательского SVG.

Миграция выполняется только в текущем локальном мире пользователя через MCP и не попадает в исходники нового модуля:

1. GM-клиент перечисляет world Actors с непустым `flags.rebreya-main.sheetArt`.
2. Для каждого Actor старое значение нормализуется текущим schema-v1 normalizer.
3. Нормализованное значение записывается в `flags.character-sheet-layout.sheetArt`.
4. Значение перечитывается и сравнивается с ожидаемым нормализованным объектом.
5. Только после успешного сравнения удаляется `flags.rebreya-main.sheetArt` этого Actor.
6. Итоговый отчёт содержит число найденных, перенесённых, проверенных, очищенных и ошибочных документов без полного содержимого пользовательских флагов.

Миграция не обрабатывает Item: прежняя реализация не позволяла сохранять оформление предметов. Ошибка одного Actor не должна удалять его старый флаг или прерывать проверку остальных. Повторный запуск безопасен для уже перенесённых Actor.

## 4. Архитектура нового модуля

Предлагаемая минимальная структура:

```text
character-sheet-layout/
  module.json
  README.md
  scripts/main.js
  scripts/data/sheet-art.js
  scripts/foundry/application-compat.js
  scripts/foundry/document-sheet-hooks.js
  scripts/ui/sheet-art-editor.js
  scripts/ui/sheet-art-overlay.js
  styles/main.css
  lang/en.json
  lang/ru.json
  tests/*.test.mjs
```

`scripts/main.js` является единственным composition root. Он регистрирует hooks один раз и публикует небольшой API через `game.modules.get("character-sheet-layout").api` для открытия редактора, привязки/отвязки overlay и проверки версии runtime.

`scripts/data/sheet-art.js` владеет schema, нормализацией, URL-validation, геометрией и Document flag writes. Сохранение принимает Actor или Item, проверяет `document.documentName`, `document.isOwner` и наличие `setFlag`.

`scripts/ui/sheet-art-overlay.js` владеет безопасным SVG, ResizeObserver и lifecycle одного root element. CSS-классы и mask IDs получают prefix `csl-`.

`scripts/ui/sheet-art-editor.js` владеет draft, FilePicker, preview zoom/pan, рисованием маски и save/cancel. Состояние редактора до сохранения не меняет Document.

`scripts/foundry/application-compat.js` — единственное место различий поколений. Он:

- извлекает Document через публично доступные `app.document`, `app.actor`, `app.item` или `app.object` и принимает только Actor/Item;
- приводит HTMLElement/jQuery-подобный render argument к одному root;
- использует legacy Application/Dialog API на V12 и доступный ApplicationV2/DialogV2 API на V13–14;
- формирует version-specific header-control object без дублирования feature logic.

`scripts/foundry/document-sheet-hooks.js` регистрирует V12/V1 и V13–14/V2 hooks идемпотентно, фильтрует Actor/Item по runtime Document и не обращается к `game.system`, `CONFIG.DND5E` или `document.system`.

## 5. Совместимость Foundry VTT 12–14

Манифест начинает с:

```json
"compatibility": {
  "minimum": "12",
  "verified": "13"
}
```

Поле `maximum` не задаётся. `verified` повышается до 14 только после живой проверки V14. Minimum 12 означает целевой контракт и разрешение установки; фактическая проверка V12 отдельно указывается в README и отчёте.

Runtime adapter использует:

- V12/V1: `getApplicationHeaderButtons`, render/close hooks Application V1 и legacy Dialog;
- V13–14/V2: `getHeaderControlsApplicationV2`, `renderApplicationV2`, `closeApplicationV2` и DialogV2 при наличии;
- capability detection по существованию API, а не по строковому сравнению версии.

Одно приложение не должно получить две кнопки или два overlay, даже если система вызывает одновременно generic и class-specific hooks. Registration и root binding обязаны быть идемпотентными.

## 6. Изменения Rebreya Main

Удаляются:

- `scripts/data/character-sheet-art.js`;
- `scripts/ui/character-sheet-art.js`;
- соответствующие импорты, `rebreyaSheetArt` header action, bind/unbind и close hooks из `scripts/integrations/dnd5e-sheet-extensions.js`;
- scoped CSS оформления из `styles/main.css`;
- `tests/character-sheet-art.test.mjs` и ожидания кнопки оформления из dnd5e UI-тестов;
- пользовательский раздел оформления из README.

Раздел 18 `docs/function-passport.md` обновляется так, чтобы Rebreya больше не объявляла владельца этих методов. В Rebreya повышается версия `module.json`, создаётся соответствующий versioned forwarder и обновляется `esmodules`.

Новый модуль не добавляется в `relationships.requires` или `relationships.recommends` Rebreya: оба пакета работают независимо.

## 7. Focused-проверки

В Character Sheet Layout проверяются только содержательные контракты:

- normalizer отбрасывает опасные URL и лишние поля, ограничивает mask data;
- геометрия сохраняет aspect ratio и не зависит от изменения ширины при постоянной высоте;
- SVG-маска показывает внешнюю часть, а strokes управляют входом изображения внутрь листа;
- сохранение разрешено для принадлежащих пользователю Actor и Item и пишет только новый namespace;
- compatibility adapter выбирает V1/V2 hooks и не создаёт дубликаты controls/bindings;
- cancel не пишет flag, save пишет нормализованное значение.

В Rebreya focused-проверки подтверждают отсутствие старых импортов, action и runtime references. Пустые тесты, повторяющие текст реализации без проверки поведения, не добавляются.

Перед каждым commit выполняются `git diff --check`, содержательный diff и синтаксическая/JSON-проверка изменённых файлов. Перед завершением Rebreya-части выполняется её полная проверка из `AGENTS.md`. UI считается подтверждённым только после живой проверки в Foundry: Actor, Item, resize по ширине и высоте, minimize/reopen, save/cancel, повторный render, GM/owner и отсутствие новых console errors.

## 8. Порядок реализации

1. Создать локальный standalone Git-репозиторий нового модуля без remote.
2. Перенести и обобщить data/UI core, добавить compatibility adapter и focused-тесты.
3. Включить новый модуль в локальном мире и проверить Actor/Item на установленной версии Foundry.
4. Через MCP перенести и проверить старые world Actor-флаги, затем удалить только успешно перенесённые legacy flags.
5. Удалить владельца поведения из Rebreya, обновить паспорт/README/versioned entrypoint и проверки.
6. Выполнить live QA после одновременного включения обновлённой Rebreya и нового модуля.
7. Сделать отдельные локальные commits в новом репозитории и task-scoped commit/push в `lich_branch` Rebreya.

Критерий готовности: оформление существующих Actor визуально сохраняется после миграции, новое оформление можно сохранить на любом Actor или Item, Rebreya не содержит и не регистрирует Character Sheet Layout, а отключение Rebreya не влияет на работу нового модуля.
