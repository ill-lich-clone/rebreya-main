# Паспорт: интеграция с rebreya.com (импорт персонажа по коду и синхронизация состояния)

Профильный паспорт. Точка маршрутизации — `docs/function-passport.md`, раздел 18.

## Что делает

Игрок собирает персонажа на rebreya.com, нажимает «В Foundry» и получает одноразовый код (15 минут, один раз). В Foundry он нажимает «Импорт по коду» в директории Actors или в панели Rebreya на листе. Модуль обменивает код на **токен привязки** конкретного персонажа. Пароль от сайта в Foundry не вводится. Дальше хиты, ячейки, кости хитов, спасброски от смерти, вдохновение, истощение, состояния и деньги синхронизируются в обе стороны автоматически.

Всё выключено, пока мир не включит `siteIntegrationEnabled`.

## Контракт сайта (Backend Rebreya, `/api/v1`)

| Запрос | Авторизация | Назначение |
|---|---|---|
| `POST /characters/claim/` `{code, label}` | нет | код → `{linkToken, character}`; код одноразовый |
| `GET /characters/linked/` | `Authorization: RebreyaLink <token>` | персонаж по токену |
| `GET/PATCH /characters/linked/state/` | `RebreyaLink <token>` | состояние; PATCH сливается по ключам, ответ содержит `stateHash` |

Сайт хранит только SHA-256 кодов и токенов. Владелец может отозвать привязку на сайте; тогда запросы получают 401 и модуль бросает `LinkRevoked`. Лимит PATCH состояния на сайте — 600 в час на IP.

## Владельцы и точки входа

- **Composition (`scripts/main.js`).** В конструкторе `RebreyaMainModule` создаются `this.site` (`RebreyaSiteService`), `this.characterSync` (`RebreyaCharacterSync`), `this.siteSpellsCompendium`, `this.siteArticlesCompendium`, `this.siteBestiaryCompendium`. На `ready` вызываются `registerSiteShareImport(moduleApi)` и `registerSiteAutoSync(moduleApi)`; они публикуют `moduleApi.siteShareImport` и `moduleApi.siteAutoSync`.
- **HTTP-клиент `scripts/integrations/rebreya-site-api.js`.** `RebreyaSiteApi`: `request(path, {method, body, auth, linkToken})`, `claimShareCode(code, label)`, `getLinkedCharacter(linkToken)`, `getLinkedState(linkToken)`, `patchLinkedState(linkToken, patch)`, а также каталожные `list/getBySlug/manifest`. `normalizeBaseUrl(input, {allowLocal})` пропускает только https, кроме dev-режима. Ошибки — подклассы `RebreyaApiError`: `AuthRequired`, `TokenExpired`, `ApiUnavailable`, `SchemaMismatch`, `LinkRevoked`, `ShareCodeInvalid`, `RateLimited`. Без Foundry. Тест: `rebreya-site-api`.
- **Сервис настроек `scripts/integrations/rebreya-site-service.js`.** `RebreyaSiteService`: `isEnabled()`, `getLinkToken(actorId)`, `hasLinkToken(actorId)`, `setLinkToken(actorId, {token, siteId})`, `clearLinkToken(actorId)`. `createFoundrySettingsAdapter(game)` читает world/client settings. Локальный адрес сайта (`siteAllowLocalhost`) действует только если сама страница Foundry открыта с localhost (`isLocalPage()`). Тест: `rebreya-site-service`.
- **Импорт по коду `scripts/integrations/site-share-import.js`.** `SiteShareImport.importByCode(code, {actor})` выбирает маршрут **до** погашения кода:
  - `existing` — в существующий Actor владельца;
  - `local` — игрок с правом `ACTOR_CREATE` создаёт Actor сам;
  - `gm` — typed command `site.share-import.create-actor` через `SocketCommandBus`.

  Если GM нет онлайн, импорт отказывает и код остаётся неиспользованным. `executeGmImport(character, requester)` выполняется на клиенте активного GM. Владелец нового Actor — `context.sender`, то есть отправитель, которого подтвердил транспорт Foundry, а не поле payload. `isValidShareImportPayload`: ровно `{operationId, character}`, `character.id` — положительное целое, JSON персонажа ≤ `MAX_SHARED_CHARACTER_BYTES` (48000). `authorizeShareImport`: текущий не-GM User. Scheduling: `keyedMutationScheduling(site-share-import:<operationId>)`. Токен привязки **никогда** не уходит в сокет: сообщения модуля получают все клиенты. Тест: `site-share-import` (настоящий `SocketCommandBus`, включая отказ на подделанный `senderId`).
- **Сборка персонажа `scripts/integrations/site-build-importer.js` + `scripts/data/site-build-resolver.js`.**
  - `SiteBuildImporter.import(actor, character)` создаёт Items класса, подкласса, расы и предыстории. Сначала ищет в мировых компендиях модуля (`REBREYA_PACKS` → `world.rebreya-classes|subclasses|races|backgrounds`, имена из `constants.js`), затем в SRD-паках dnd5e (`SRD_PACKS`).
  - Если ничего не нашлось, создаёт заглушку `buildPlaceholderItem`.
  - Свои Items помечены `flags.rebreya-main.siteBuild`; повторный импорт заменяет только их.
  - Ячейки заклинаний dnd5e выводит из классов. `flags.rebreya-main.siteSlotOverride` используется только как запасной вариант.

  Чистые функции резолвера тестируются без Foundry. Тесты: `site-build-importer`, `site-build-resolver`.
- **Персонаж и состояние `scripts/integrations/rebreya-character-sync.js` + `scripts/data/site-character-mapper.js` + `scripts/data/site-state-mapping.js`.**
  - `RebreyaCharacterSync`: `importBuild(actor, character, opts)`, `refreshBuild(actor)`, `pushState(actor, {force})`, `applySiteState(actor, remote)`, `localStatePatch(actor)`, `isLocallyDirty(actor)`, `getLink(actor)`, `canSync(actor)`.
  - Флаг связи — `flags.rebreya-main.siteCharacter`: `id` персонажа на сайте, `lastStateHash`, `linkHolderUserId`, `autoSync`, `syncMode`, `ownerUserId` (`buildSiteCharacterFlags`).
  - Состояния сайта ↔ статусы dnd5e: `SITE_CONDITION_TO_STATUS`. Производный dnd5e-статус `bloodied` не синхронизируется.
  - Конфликт: `detectStateConflict(remoteHash, lastStateHash)`.

  Тесты: `site-character-mapper`, `site-character-sync-link`, `site-state-mapping`.
- **Автосинхронизация `scripts/integrations/site-auto-sync.js`.**
  - Синхронизирует ровно один клиент на Actor — браузер с токеном (`linkHolderUserId`). Изменения GM доходят до него обычными обновлениями документов.
  - Push: debounce `2000` мс, не чаще одного PATCH в `8000` мс, один запрос за раз. Не больше 450/час на клиент, что укладывается в лимит сайта. Если отпечаток состояния не изменился, push пропускается; так гасится и эхо собственного pull.
  - Pull: при рендере листа (не чаще раза в 10 с) и раз в 30 с. Цикл опроса (`syncLoop()`) работает, только пока включены `siteIntegrationEnabled` и `siteAutoSync`; `onChange` обеих настроек запускает или останавливает его без перезагрузки. В мирах без интеграции таймеров нет.
  - Если изменились обе стороны, открывается диалог конфликта `resolveStateConflict`, по одному разу на удалённое состояние.

  Hooks: `updateActor`, `create/update/deleteActiveEffect`, `updateItem` (только `class`), `renderActorSheet(V2)`. Всё работает при `siteAutoSync`, а для отдельного Actor можно выключить флагом `siteCharacter.autoSync`. Тест: `site-auto-sync`.
- **UI.**
  - `scripts/integrations/site-sync-panel.js`: `bindSiteSyncPanel(root, app, moduleApi)` — кнопка «Rebreya» в шапке листа персонажа, идемпотентна. Вызывается из обоих путей рендера в `dnd5e-sheet-extensions.js` (legacy hook и ApplicationV2).
  - `bindActorDirectoryShareButton(root, moduleApi)` — «Импорт по коду» в директории Actors.
  - `runShareCodeImport(moduleApi, {actor})`.
  - `resolveStateConflict(actor, moduleApi, conflict)`.
  - `scripts/ui/site-catalog-sync-app.js` — меню настроек GM `siteCatalogSyncMenu`.
- **Каталоги сайта в компендии.**
  - `SiteSpellsCompendiumService.sync()` → `world.rebreya-site-spells`.
  - `SiteArticlesCompendiumService.sync()` → `world.rebreya-site-articles`.
  - `SiteBestiaryCompendiumService.sync({limit})` → `world.rebreya-site-bestiary`.

  Провайдер `SiteApiCatalogProvider` обновляет документы по `content_hash`. `ensureCompendiumFolders` создаёт папки с типом документа пака. Тесты: `site-spell-mapper`, `site-article-mapper`, `site-monster-mapper`.

## Настройки

| Ключ | Scope | Смысл |
|---|---|---|
| `siteIntegrationEnabled` | world | главный выключатель, по умолчанию выключен |
| `siteBaseUrl` | world | `https://rebreya.com` |
| `siteCatalogMode` | world | `local` / `site-api` / `hybrid` |
| `siteCharacterSyncMode` | client | режим связи листа |
| `siteAutoSync` | world, GM | автосинхронизация, по умолчанию включена |
| `siteAllowLocalhost` | world, GM | dev: локальный сайт, только при локальной странице Foundry |
| `siteLinkTokens` | client | токены привязки; только localStorage этого браузера |
| `siteAccessToken`, `siteRefreshToken` | client | вход по паролю для каталогов |
| `siteLastCatalogSyncAt` | world | метки синхронизации каталогов |

Токены не лежат в world/user settings и во флагах Actor: эти данные Foundry рассылает всем клиентам. Цена — привязка действует на одном устройстве; на другом браузере игрок вводит новый код.

## Ограничения

- Если держатель токена офлайн, синхронизация ждёт его возвращения. Затем изменения сводятся: при расхождении открывается диалог.
- Каталожные компендии и вход по паролю — для GM. Импорт персонажа по коду пароля не требует.
