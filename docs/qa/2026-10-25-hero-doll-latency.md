# Живые замеры куклы героя — 25 октября 2026

## Вывод

В проверенном native owner route исправленный код 1.5.4 работает: **133 завершённых операции, 0 ошибок**, включая 10 следующих действий, отправленных из реального `updateItem` до завершения первого `Item.update` Promise. Пауза 5–10 секунд не воспроизвелась. Максимум до завершения сервисного Promise — **773,3 мс**, включая ожидание очереди трёх одновременно отправленных запросов.

Это положительная проверка исправленного пути, без живого A/B-прогона старого кода. Результат ограничен отдельным простым персонажем и singleton-кольцом; он не доказывает отсутствие задержек на любом боевом персонаже со сложными эффектами.

## Условия и происхождение кода

- Checkout: `lich_branch`, исходный commit `0075572a`; перед работой чистый, origin/lich_branch совпадал, origin/main не содержал новых commits относительно HEAD (HEAD впереди на 93).
- URL: `http://localhost:30000/game`, localhost, без Cloudflare и внешнего соединения.
- Реальные клиенты: игрок **Чёрный рыцарь**, GM **CODEX**, две вкладки одного Chromium-профиля Playwright; существующая чужая GM-сессия Gamemaster сохранена. Версия Foundry **13.351**, dnd5e **5.2.5**.
- В обоих клиентах проверено равенство конструктора действующего `game.rebreyaMain.heroDollService` экспорту из `/modules/rebreya-main/scripts/data/hero-doll-service.js?v=1.5.4` и наличие `item.update({ ...itemPatch })` в исходнике загруженного конструктора.
- Серверная metadata `game.modules.get("rebreya-main").version` оставалась **1.5.3**, entrypoint — `main-1.5.3.js`. HTTP module.json и импорт в main.js уже содержали 1.5.4. Поэтому одна metadata не использовалась как доказательство версии кода. Сервер не перезапускался.
- Fixture: Actor `4VhEZLRiNhtSiYtg`, **QA Hero Doll Latency 2026-10-25**; Item `xee9Dnrrw1omTw1j`, **QA latency singleton ring**, equipment/ring, quantity=1. Создан игроком с разрешённым ACTOR_CREATE, принадлежит ему. Ни исходные игровые Actor/Item, ни их права не изменялись.
- Первая серия из 83 операций была разогревом с неактивной вкладкой куклы; она исключена из результатов. Основные 83 операции повторены с открытой вкладкой heroDoll и ненулевыми размерами слотов.
- Затем 20 операций через реальный обработчик DOM drop и кнопку clear-slot, затем 30 операций с принудительно ранним следующим действием через реальный native Hook.
- MCP bridge не подключён. Playwright в этой сессии доступен. Gemini CLI был вызван для read-only поиска; headless permission отказал в command, response пустой — его анализ не использован.

## Результаты

Миллисекунды, интервал от вызова сервиса до разрешения Promise; медиана обычная, p95 — nearest rank. При N=10 p95 совпадает с максимумом.

| Сценарий | N | Медиана | p95 | Максимум | Ошибки |
|---|---:|---:|---:|---:|---:|
| Надеть singleton | 10 | 220,1 | 388,0 | 388,0 | 0 |
| Снять singleton | 10 | 244,9 | 348,1 | 348,1 | 0 |
| Переставить ring1 ↔ ring2 | 10 | 31,5 | 53,0 | 53,0 | 0 |
| Надеть в серии быстрых действий | 10 | 238,2 | 392,0 | 392,0 | 0 |
| Следующее снятие сразу после DOM обновления | 10 | 230,6 | 647,1 | 647,1 | 0 |
| Тройка одновременных assign ring1/ring2/ring3, 10 серий | 30 | 448,9 | 770,2 | 773,3 | 0 |
| UI drop в ring1 | 10 | 227,9 | 416,0 | 416,0 | 0 |
| Следующий UI click clear-slot | 10 | 227,6 | 330,4 | 330,4 | 0 |
| Надеть перед ранним следующим действием | 10 | 391,6 | 513,6 | 513,6 | 0 |
| Следующий assign ring2 внутри updateItem | 10 | 400,9 | 496,8 | 496,8 | 0 |
| Снять после раннего assign | 10 | 396,6 | 522,4 | 522,4 | 0 |

Ещё 3 успешные setup/cleanup операции включены в итоговые 133. Быстрое снятие вызывалось через 7,1 мс медианно после наблюдаемого обновления DOM (максимум 25,6 мс). Для UI-серии Playwright нажимал кнопку при первой возможности выполнения видимого locator click; overhead автоматизации не вычитался из серверных времён и не включался в интервал Promise.

### Разделение стадий

В каждой ячейке — **медиана / p95 / максимум**. Item и Actor — от вызова native update до разрешения его реального Promise; очередь — от вызова сервиса до начала его callback в существующем coordinator.

| Сценарий | Локальная очередь | Item.update | Actor.update | DOM куклы от начала |
|---|---|---|---|---|
| Надеть (N=10) | 0,1 / 0,3 / 0,3 | 8,7 / 17,2 / 17,2 | 212,6 / 378,5 / 378,5 | 401,1 / 540,2 / 540,2 |
| Снять (N=10) | 0,1 / 0,3 / 0,3 | 10,1 / 14,8 / 14,8 | 233,7 / 332,9 / 332,9 | 424,2 / 530,0 / 530,0 |
| Переставить (N=10) | 0,1 / 0,2 / 0,2 | Нет записи Item | 31,2 / 52,4 / 52,4 | 192,8 / 311,6 / 311,6 |
| Быстрое следующее снятие (N=10) | 0,1 / 0,2 / 0,2 | 19,6 / 259,1 / 259,1 | 209,9 / 387,4 / 387,4 | 385,4 / 791,6 / 791,6 |
| Burst (N=30) | 210,4 / 496,9 / 534,7 | Одна запись: 6,9 | 207,9 / 297,7 / 329,9 | Не интерпретируется |
| UI drop (N=10) | 0,2 / 0,5 / 0,5 | 10,0 / 29,4 / 29,4 | 211,0 / 385,1 / 385,1 | 377,6 / 588,0 / 588,0 |
| UI clear (N=10) | 0,1 / 0,2 / 0,2 | 55,5 / 65,7 / 65,7 | 185,9 / 274,4 / 274,4 | 349,9 / 491,6 / 491,6 |

Burst может проходить промежуточные состояния быстрее рендера, а его целевое состояние могло быть видно до начала конкретного queued действия. Поэтому поля visible/paint burst в raw JSON не являются временем показа результата именно этой операции и исключены из вывода об отображении. Аналогично не интерпретируется DOM latency в native-pending серии, где специально не ожидается рендер между запросами.

DOM время определяется MutationObserver по aria-label слотов и ненулевой ширине элементов. Это готовое состояние отображения в документе, не измерение физического показа пикселей. Поле paint в raw JSON — следующий requestAnimationFrame; оно не является гарантией compositor paint и не использовано в итогах.

### Другой клиент и готовность следующего действия

Для всех **133** Actor placement updates найден соответствующий GM updateActor по состоянию slots и ближайшему локальному Hook в ограниченном временном окне. Для localhost используется общая шкала `performance.timeOrigin + performance.now()`; отдельной синхронизации часов удалённых компьютеров здесь нет.

- GM updateActor от вызова действия: **55,1 / 453,5 / 567,1 мс**.
- GM updateActor от начала Actor.update: **29,9 / 40,1 / 345,4 мс**.
- GM Hook относительно локального updateActor Hook: медиана **−175,6 мс**, p95 **−0,2 мс**, максимум **+8,0 мс**. Доставка часто происходит раньше завершения локального Promise.
- В native-pending серии следующий assign был вызван **10/10 раз до завершения первого Item.update Promise**, непосредственно в updateItem Hook. Ожидание существующей очереди: **208,8 / 293,8 / 293,8 мс**; полное завершение следующего действия: **400,9 / 496,8 / 496,8 мс**; ошибок 0.
- Это отдельная проверка раннего следующего действия, а не искусственная задержка native update. Механику, таймауты, retry, проверки stale-slot и завершение Promise не меняли.

Из измеренных стадий основное ожидание — **локальное завершение Actor.update** после уже доставленного изменения; очередь заметна при burst и раннем следующем действии. Замеры не разделяют внутренние Foundry/dnd5e post-update обработчики, поэтому конкретный внутренний Hook виновником не объявляется. Сетевой GM workflow простой singleton не использует.

## Целостность, сохранение и уборка

- Для каждой из 133 операций проверены: один и тот же Item ID, один предмет у Actor, quantity=1, heldHands=[], equipped=true при assign/false при clear, ровно один/ноль slots с этим Item.
- Во всех измеренных сериях **0 custom emit в module.rebreya-main**, **0 вызовов game.settings.set для world-scope settings**. Это клиентское наблюдение, не серверный аудит сторонних GM-записей.
- В консоли игрока после прогонов: **0 errors**, 8 warnings; новых исключений stale-slot/ItemInstanceError не было.
- Итог игрока совпал с GM: slots={}, equipped=false, heldHands=[], quantity=1, itemCount=1.
- GM-вкладка перезагружена, дождались game.ready: те же значения прочитаны заново из серверных документов. Факт доставки не подменяет эту проверку сохранения.
- Все временные wrappers, MutationObserver, Hooks и QA globals удалены; тестовый лист закрыт. Actor с кольцом оставлен под явным QA-именем для воспроизведения. Игровые предметы пользователя не затронуты.
- Runtime-файлы и module version не менялись; добавлены только QA-артефакты и индекс документации. Полный runtime suite повторно не запускался: продуктовый код не изменён; прежние 5023 passed относятся к исходному исправлению, а не к этой проверке.

## Воспроизведение

Предварительные решения: [спецификация исправления](../superpowers/specs/2026-10-25-hero-doll-native-update-design.md), [план исправления](../superpowers/plans/2026-10-25-hero-doll-native-update.md). Эта задача — измерение уже реализованного поведения, без новой продуктовой спецификации или реализации.

1. В двух авторизованных вкладках открыть работающий мир: player-owner и GM. Проверить Foundry/system, равенство действующего конструктора экспорту `hero-doll-service.js?v=1.5.4` и shallow copy в загруженном коде.
2. Использовать указанный fixture либо создать отдельный character с флагом `flags.rebreya-main.heroDollLatencyQA=true`, OWNER игроку и единственным equipment ring quantity=1/equipped=false. Новые ID подставить во все сниппеты. Не использовать игровые Actor.
3. Открыть его sheet, выбрать вкладку heroDoll. У ring1/ring2/ring3 должны быть ненулевые размеры.
4. В GM-вкладке до прогона установить наблюдение:

```js
const actorId = "4VhEZLRiNhtSiYtg";
const events = [], hookIds = [];
for (const type of ["Item", "Actor"]) {
  const id = Hooks.on("update" + type, (doc, change) => {
    if ((type === "Item" ? doc.parent?.id : doc.id) !== actorId) return;
    const actor = game.actors.get(actorId);
    events.push({
      type, time: performance.timeOrigin + performance.now(),
      modified: doc._stats.modifiedTime, keys: Object.keys(change),
      equipped: actor.items.get("xee9Dnrrw1omTw1j").system.equipped,
      slots: foundry.utils.deepClone(actor.getFlag("rebreya-main", "heroDoll")?.slots ?? {})
    });
  });
  hookIds.push(["update" + type, id]);
}
```

5. В player-вкладке явно импортировать вспомогательный измеритель (он не включён в runtime entrypoint):

```js
const {installHeroDollLatencyQA} =
  await import("/modules/rebreya-main/docs/qa/hero-doll-latency.mjs");
installHeroDollLatencyQA({
  actorId: "4VhEZLRiNhtSiYtg", itemId: "xee9Dnrrw1omTw1j"
});
const result = await __rebreyaHeroLatencyQA.run(10);
```

6. Для UI-серии очистить и заново установить измеритель. Через Playwright для каждого из 10 повторов создать DataTransfer с text/plain JSON `{type:"Item",uuid:"Actor.<actorId>.Item.<itemId>"}`, dispatchEvent("drop",{dataTransfer}) в `[data-hero-doll-slot][data-slot-id="ring1"]` внутри тестового sheet. Нажать visible `[data-action="clear-slot"][data-slot-id="ring1"]`, дождаться последней clear записи с end и visible. Это синтетическое DOM drop-событие и настоящий locator click, не физический pointer drag.
7. Для проверки раннего native follow-up выполнить 10 циклов:

```js
const q = __rebreyaHeroLatencyQA;
for (let n = 0; n < 10; n++) {
  let followup;
  const hook = Hooks.on("updateItem", item => {
    if (item.id !== "xee9Dnrrw1omTw1j" ||
        item.system.equipped !== true || followup) return;
    followup = q.invoke("assign", "ring2", "native-pending-followup");
  });
  try {
    await q.invoke("assign", "ring1", "native-pending-equip");
    if (!followup) throw Error("Native hook did not trigger");
    await followup;
    await q.invoke("clear", "ring2", "native-pending-clear");
  } finally {
    Hooks.off("updateItem", hook);
  }
}
```

8. Экспортировать records/counters/final и GM events; отдельно рассчитать интервалы. Проверить `followup.start < preceding.itemUpdates[0].end`, ошибки и финальные поля. Для percentile отсортировать значения и брать индекс `ceil(N * .95) - 1`.
9. Снять измеритель `__rebreyaHeroLatencyQA.cleanup()`; снять GM Hooks через `hookIds.forEach(([name,id])=>Hooks.off(name,id))`. Закрыть QA sheet. Перезагрузить GM-клиент и проверить сохранённые поля. Не перезагружать player-вкладку общего browser context после GM login: cookie этого профиля уже принадлежит GM.

## Артефакты и проверка

- [Измеритель](hero-doll-latency.mjs): `installHeroDollLatencyQA({actorId,itemId})`; временная инструментация только явно помеченного fixture. Публикует `run(count)`, `invoke(mode,slot,group)`, `records`, `counters`, `state()`, `cleanup()` в локальном QA global.
- [Основная серия](2026-10-25-hero-doll-latency-player.json), [UI-серия](2026-10-25-hero-doll-latency-ui.json), [native-pending](2026-10-25-hero-doll-latency-pending.json), [GM events](2026-10-25-hero-doll-latency-gm.json). GM events включают также разогрев; для анализа брать временные окна измеренных записей.
- Проверки перед commit: `node --check docs/qa/hero-doll-latency.mjs`; JSON parse четырёх raw файлов; проверка 133 records на ошибки/целостность и ранних 10/10 follow-up; `git diff --check`; обзор полного diff и stat. Полные успешные логи не сохраняются.
