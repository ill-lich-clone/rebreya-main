# R1 — Всплывающие окна и стабильная кукла: Implementation Plan

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

**Goal:** Все дополнительные окна хранилища доступны у краёв viewport; клетки куклы не меняются от имени.
**Architecture:** один presentation helper для anchored overlays; StorageApp/HeroDollService сохраняют state и действия.
**Spec:** [хранилища R1](../../specs/2026-09-07-module-development/inventory-storage-ui.md), [кукла R1](../../specs/2026-09-07-module-development/hero-doll.md). Item identity/quantity в R1 не менять.

## Задача R1.1 — Геометрия и lifecycle overlay

**Create:** scripts/ui/anchored-overlay.js, tests/anchored-overlay.test.mjs.
**Interfaces:** calculateAnchoredOverlayPosition(anchor,size,viewport,{margin=8,gap=6}={}) → {left,top,width,maxHeight,placement}; anchor={left,top,right,bottom}, size={width,height}, viewport={width,height}.
AnchoredOverlay({ownerElement,resolveAnchor,onClose}) имеет show(content), reposition(), close(), destroy(); владеет только DOM, не Documents.

- [x] Написать геометрический тест с реальными граничными числами:
```js
import test from "node:test";
import assert from "node:assert/strict";
import { calculateAnchoredOverlayPosition as place } from "../scripts/ui/anchored-overlay.js";
test("bottom-right anchor flips and stays inside viewport", () => {
  const p = place({left:1200,right:1270,top:620,bottom:700},
    {width:224,height:200}, {width:1280,height:720});
  assert.equal(p.placement, "top");
  assert.equal(p.left, 1048);
  assert.equal(p.top, 414);
  assert.ok(p.top + p.maxHeight <= 712);
});
test("oversized content receives a scrollable height", () => {
  const p = place({left:10,right:90,top:100,bottom:180},
    {width:300,height:1500}, {width:400,height:720});
  assert.equal(p.placement, "bottom");
  assert.equal(p.maxHeight, 526);
});
```
- [x] Запустить node --test tests/anchored-overlay.test.mjs, получить red на missing module.
- [x] Реализовать pure расчёт:
```js
export function calculateAnchoredOverlayPosition(a, s, v, {margin=8,gap=6}={}) {
  const width = Math.min(s.width, Math.max(0, v.width - 2 * margin));
  const below = Math.max(0, v.height - margin - a.bottom - gap);
  const above = Math.max(0, a.top - gap - margin);
  const placement = s.height <= below || below >= above ? "bottom" : "top";
  const maxHeight = Math.min(s.height, placement === "bottom" ? below : above);
  const left = Math.max(margin, Math.min(a.left, v.width - margin - width));
  const top = placement === "bottom" ? a.bottom + gap : a.top - gap - maxHeight;
  return {left, top, width, maxHeight, placement};
}
```
В boundary отвергать nonfinite dimensions; для anchor за viewport закрывать либо clamp перед вызовом. Не возвращать NaN style.
- [x] Реализовать AnchoredOverlay: body portal с position:fixed; content передаётся DOM node; text через textContent. show заменяет content одного portal, onClose ровно один раз на открытие. reposition читает свежий anchor, measured size и viewport, вычисляет style и слой выше computed z-index окон.
- [x] Подписать capture scroll, resize, ResizeObserver owner/overlay и движение ApplicationV2. Все listeners принадлежат AbortController; close отключает временные подписки и возвращает focus, destroy также освобождает references.
- [x] Добавить fake-DOM lifecycle tests: show×3 = один portal; anchor detached → close; destroy×2 безопасен; observers disconnected; Escape не закрывает другое окно. Не использовать приватный ApplicationV2._maxZ.

## Задача R1.2 — Хранилище использует измеренный anchor

**Modify:** scripts/ui/storage-app.js, templates/storage-app.hbs, styles/main.css, tests/storage-app.test.mjs.
**Consumes:** AnchoredOverlay R1.1; activePopover/rowId текущего StorageApp.
**Produces:** один действующий row popover за пределами scroll-container.

- [x] В existing createApp test fixture добавить наблюдение portal; воспроизвести открытие нижней строки и rerender selection.
- [x] Заменить вычисление положения от rowIndex*80 CSS px вызовом helper. Data-action обработчики продолжают принадлежать StorageApp: передать обработку portal events тому же action dispatcher, чтобы body portal не потерял bubbling в window root.
- [x] Anchor разрешается каждый раз по data-anchor-row-id и точной item row; старый HTMLElement после rerender не переиспользуется.
- [x] _onClose/detached row/breadcrumb change закрывают overlay. Не переносить source row mutation логику в helper; transfer pending/error refresh остаются прежними.
- [x] Из CSS удалить позиционные anchorRow/anchorColumn формулы для этого popover, сохранить scoped theme, кнопки и внутренний overflow:auto. Проверить coin/journal/обычный Item и вложенное хранилище.
- [x] Тесты подтверждают, что "Взять"/quantity/broken actions из portal вызывают прежние API ровно один раз и закрытие не удаляет storage row.

## Задача R1.3 — Fixed cells и tooltip куклы

**Modify:** templates/hero-doll-tab.hbs, styles/main.css, scripts/integrations/dnd5e-sheet-extensions.js.
**Tests:** новый tests/hero-doll-ui.test.mjs; existing hero-doll-service/dnd5e-sheet-downtime-tab.
**Consumes:** getActorSnapshot()/existing binding actions; никакой новой Item mutation.

- [x] Добавить тест prepared slot с длинным itemName и HTML-подобным именем: aria-label/textContent безопасны; tooltip не становится raw HTML; native title на slot target отсутствует.
- [x] В HBS убрать itemName/itemMeta внутри fixed square. Оставить img и необходимые state badges; label анатомического слота вне квадрата; имена списка справа остаются.
- [x] Ядро scoped CSS:
```css
.rm-hero-doll-slot__surface {
  inline-size: 80px;
  block-size: 80px;
  min-inline-size: 80px;
  min-block-size: 80px;
  flex: 0 0 80px;
  overflow: hidden;
}
.rm-hero-doll-slot__image { inline-size: 100%; block-size: 100%; object-fit: contain; }
```
Grid меняет количество колонок на узком окне, но не размер отдельной ячейки от текста. Проверить все более поздние overrides styles/main.css, не добавлять ещё один конфликтующий patch в конец файла.
- [x] Добавить styled tooltip через AnchoredOverlay на hover/focus, Escape/blur/leave закрывают. Clear/open/drag actions сохраняют existing stable data attributes.
- [x] Проверить bindHeroDoll lifecycle через existing WeakMap AbortControllers: rerender отменяет старые handlers, одно нажатие вызывает одно действие.
- [x] В UI test показать два разных source IDs с одним именем; R1 не делит stack и не исправляет identity из R3.

## Проверки этапа

```powershell
node --test tests/anchored-overlay.test.mjs tests/storage-app.test.mjs tests/hero-doll-ui.test.mjs tests/hero-doll-service.test.mjs tests/dnd5e-sheet-downtime-tab.test.mjs
```
Live: 1280×720/1920×1080, 100%/125%, высокий storage 30+ rows, нижний row, scroll/resize/drag window, Item sheet поверх, tooltip длинного имени, keyboard focus, light/dark. Cell bounding boxes одинаковы ±1 CSS px; все кнопки popover видимы; open/close×3 без orphan portals.

**Docs:** паспорт19 для overlay,16/18 для sheet bindings; commit UI может делиться на storage и hero части после каждой самостоятельной приёмки.

## Выпуск этапа

- [x] Выполнить полный профиль focused-тестов этого плана; записать фактические passed/failed.
- [x] Пройти перечисленные live-сценарии в выделенном тестовом Foundry-мире. Сохранить viewport, версии, GM/player и console result. Если live недоступен, оставить этот пункт открытым.
- [x] Обновить профильные методы паспорта и README при изменении public contract.
- [x] Поднять актуальную patch version в module.json; создать/переименовать versioned forwarder с единственным import "./main.js"; обновить esmodules. Проверить отсутствие старых runtime-entrypoint ссылок.
- [x] Выполнить один полный цикл команд из README этого комплекта, проверить содержательный diff, stat и diff --check.
- [x] Stage только перечисленных файлов текущего этапа и обязательных manifest/docs; осмысленный commit; git push -u origin lich_branch. Проверить чистую рабочую копию и HEAD...origin/lich_branch = 0/0. Не включать чужие изменения.

## Фактическая проверка R1 — 2026-09-08

- Версия 1.4.247. Focused command выше: 128 passed, 0 failed. Red → green проверены missing helper, geometry, lifecycle/disposer, безопасное ARIA и сохранение фокуса без rerender.
- Live: https://vtt.rebreya.com/game, тестовый мир testovyj3, Foundry 13.351, dnd5e 5.2.5, GM CODEX. Проверялись реальные ApplicationV2/HBS/CSS с memory-only storage snapshot (40 строк) и unsaved Actor/Item documents. Quantity/broken/claim делегировались API spies: один вызов на действие, без изменения world loot. Отдельная player-сессия не проверялась; permission/command routes в R1 не изменены.
- Viewport 1280×720 и 1920×1080 при DPR 1; масштаб 125% моделировался CSS viewport 1024×576 и 1536×864 с DPR 1.25 (не системный browser zoom). Нижний popover, coin/Journal/nested storage, диалог количества, открытие/закрытие ×3, изменение viewport, прокрутка и перемещение через Application.setPosition проверены. Все края portal внутри viewport; при скрытии anchor закрывается, при видимом anchor сохраняется. Native Item sheet: слой popover 108, sheet 107. Для content 2002px portal ограничен 633px, нижние действия доступны прокруткой.
- Кукла: 16 ячеек ровно 80×80, в том числе две занятые разными Item ID с одинаковым длинным именем. Имя с буквальным `<img src=x>` осталось текстом tooltip, 0 внедрённых img; ARIA восстановлено безопасным setAttribute после Foundry sanitizer. Hover/focus/Escape, светлая/тёмная палитра, 125%, узкая board 360px (3 колонки) проверены. Проверка узкой board выполнялась отдельным ограничением контейнера: native sheet имеет свой minimum width. Деление owned stacks не входило в R1.
- Финальная проверка Escape в StorageApp: focused row `focus-row`, окно остаётся открытым, portal count 0; закрытие не перерисовывает иконку. После удаления всех QA-приложений: 0 orphan portals, временные API namespace удалены, stylesheet/emulation возвращены к исходным.
- Console: штатное предупреждение Foundry о minimum viewport 1024×768 на запрошенных низких разрешениях; новых ошибок модуля в успешных сценариях не обнаружено. Ошибки временных QA-вызовов/селекторов исправлены при проверке и не относятся к игровым действиям.
- Ограничение загрузки: запущенный сервер продолжает отдавать module metadata 1.4.238. Новые исходники/CSS проверены versioned imports и временным stylesheet query; новое tooltip binding подключалось к реальному sheet вручную. Штатная composition wiring проверена focused tests. Чтобы обычный вход загрузил manifest 1.4.247, нужен перезапуск Foundry/мира; работающий мир с другими GM не перезапускался.

Полная проверка перед выпуском: node --test tests/*.test.mjs — 3633 passed, 0 failed; node --check для всех tracked JS/MJS и пяти новых файлов — 695 checked, 0 errors; ConvertFrom-Json — 45 checked, 0 errors; git diff --check — чисто. Первый полный прогон нашёл один устаревший CSS assertion для удалённого pseudo-tooltip (3632/1); assertion заменён проверкой общего tooltip, focused и полный прогон повторены успешно. Fetch перед выпуском: HEAD...origin/main = 339/0, HEAD...origin/lich_branch = 0/0, входящих изменений нет.
