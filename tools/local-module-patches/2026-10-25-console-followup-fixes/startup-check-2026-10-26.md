# Проверка доставки и нового startup log, 2026-10-26

После сообщённого пользователем перезапуска получен новый console log. В нём **73 `ERR_NETWORK_CHANGED`** при загрузке JS нескольких независимых модулей, четыре Item preparation failure у двух Actor, два последующих DAE `byType` failure и один ResizeObserver warning. Ошибки Item возникают в `Game.initializeDocuments`, до атаки/телепорта. Missing-token workflow из прежнего лога здесь отсутствует; это не подтверждает и не опровергает исправление телепорта.

## Проверенные факты

- Активная конфигурация — `D:/FoundryVTT/Config/options.json`: порт 30000, TLS включён, hostname `vtt.rebreya.com`. Старый `Data/Config/options.json` описывает другую конфигурацию. Прежний plain HTTP probe локального TLS listener ошибочно использовался как проверка HTTP-доступности файлов; этот вывод исправлен.
- HTTPS GET обоих module manifests: **200**, версии **Rebreya 1.5.6 / BG3 3.4.7**, актуальные versioned entrypoints, `CF-Cache-Status: DYNAMIC`, `Cache-Control: no-cache`.
- HTTPS GET `rebreya-main/scripts/main.js`, BG3 `module-3.4.7.js`, `module.js?v=3.4.7`, `bg3-hotbar.js?v=3.4.7`, `utils/foundryUtils.js?v=3.4.7`: **5/5 HTTP 200**, SHA-256 каждого тела совпадает с локальным исходником. Ответы `DYNAMIC/no-cache`.
- HTTPS HEAD обоих goggles aliases: **2/2 HTTP 200**, `image/webp`. HEAD четырёх JS из сбоивших групп Rebreya/quest-log/text-to-effects/BG3: **4/4 HTTP 200**. Обход TLS validation не использовался.
- Лог содержит BG3 requests `?v=3.4.6`. Само это не доказывает текущий stale cache: у лога нет разграничения сохранённых сообщений между reload. Текущий сервер отдаёт новую версию; состояние проблемного клиента требует отдельного подтверждения.

## Источник Item error

Установленная dnd5e source map `module/documents/item.mjs:528` соответствует `for (const activity of this.system.activities ?? []) activity.prepareData()`, а не эффектам или собственному override MIDI. Bundled equivalent: `dnd5e.mjs:21540`. Ошибка означает неитерируемый runtime `system.activities` у этих Item; сама по себе не доказывает повреждение сохранённых данных.

Foundry `common/data/fields.mjs`, `TypeDataField.getModelForType(type)`/`initialize(value,model,options)` выбирает `CONFIG.Item.dataModels[type]`; без зарегистрированного model возвращает `deepClone(value)`. Rebreya регистрирует собственные Item models в init. Если static import composition root оборван, init-регистрация не исполняется; custom Item тогда может остаться с plain activities object и дать этот failure. Это подтверждённый механизм в исходниках, но принадлежность конкретных четырёх Item к custom types пока не установлена. Нужен read-only вывод type/model/iterability на проблемном клиенте.

Инициализация advancement выполняется позднее в `prepareDerivedData`; поэтому `scaleValues` → `this.advancement.byType` может падать вслед за ранним Item preparation failure. Не следует удалять activities/advancements или заменять их массивами ради подавления ошибки: raw activities object является обычным сохранённым форматом и должен превращаться в runtime collection через правильный DataModel.

Gemini сгруппировал startup symptoms. Его предположение о собственном MIDI override/effects не принято: точная строка установлена по source map. Его утверждение о доказанном stale cache также не принято без свежего client evidence.

Runtime code, world database, server/network configuration не менялись. Доставка исправленных исходников подтверждена; успешный вход проблемного клиента и причина отсутствия runtime collection требуют его read-only диагностики. No attack replay/resource writes.
