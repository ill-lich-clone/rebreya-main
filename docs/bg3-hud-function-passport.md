# BG3 HUD: функции и границы совместимости

Текущее состояние: локальный `bg3-inspired-hotbar` 3.4.6, Foundry 13.351, dnd5e 5.2.5. Runtime принадлежит sibling-модулю BG3; repository record — `tools/local-module-patches/2026-10-25-bg3-hud-recovery/`. Midi-QOL и DAE не изменяются.

## Lifecycle и контекст

Владелец — `BG3Hotbar` в `bg3-inspired-hotbar/scripts/bg3-hotbar.js`.

| Метод | Назначение и ограничения |
| --- | --- |
| `constructor()` | Регистрирует единственный набор token/canvas/effect hooks и один listener существующего socket manager `reconnect`. Инициализирует transient generation queue, последний actor ID и transition state. Канонический `module.js` выходит у GM до создания HUD; настройки регистрируются у всех. |
| `_onCanvasReady()` | Снимает transition guard, отменяет устаревший timer, выбирает актуальный контекст и ожидает `generate()`. |
| `_getRecoveryToken(preferred = null)` | Возвращает доступный, принадлежащий игроку, нескрытый Token текущей сцены либо null. Порядок: допустимый preferred → текущий → прежний actor → назначенный character → первый выбранный → единственный доступный. Не меняет canvas selection, flags или settings; у GM/не готового canvas возвращает null. |
| `_scheduleRecovery(preferred = null)` | Один debounce timer на batch create/delete/reconnect; переход/отсутствующий canvas запрещает render. Это не polling. |
| `_onCanvasTearDown()` | Инвалидирует generation, отменяет timer, очищает component references и ставит закрытие в ту же последовательную очередь. |
| `_onCreateToken(tokenDocument)` | Ставит recovery только для текущей сцены, не отменяя завершённый ручной deselect; прежний character no-autopopulation сохраняется. NPC autopopulation остаётся отдельным прежним действием. |
| `_onControlToken(token, controlled)` | Игнорирует события другой сцены и запоздалый release удалённого Token; один выбранный задаёт preferred, несколько не скрывают HUD. Обычный пустой selection подчиняется прежнему `deselect` lock. |
| `_onDeleteToken(tokenDocument, options = {})` | Сравнивает исходные scene+token с context, учитывает `options.replacements[id]` через `fromUuidSync`, затем восстанавливает актуальный Token. Не вызывает cleanup/unsetFlag при удалении. Позднее удаление A не затрагивает одноимённый Token B. |
| `generate(token)` | Принимает Token/TokenDocument/null и возвращает завершение generation queue. Новый generation отменяет устаревшую работу; close/load/render последовательны. Проверяет GM, uiEnabled, ownership/hidden, сцену и точный текущий Token object. Загружает сохранённый layout в readOnly режиме и ожидает защищённый `_render(true)`. Реальную актуальную ошибку пишет в console; устаревшие transition errors не вмешиваются в новый контекст. |
| `_render(force = false, options = {})` | Сохраняет ApplicationV1 super-render и прежние post-render controls. При ошибке восстанавливает `Application.RENDER_STATES.ERROR`, как публичный Foundry `render`, чтобы следующий render мог восстановиться. |
| `_renderInner(data)` | Пересоздаёт только текущие components/combat references; при отсутствующем Token/transition возвращает пустую основу без обращения к actor. Настройки CSS и состав панели сохраняются. |
| `_onUpdateActive(effect)` | Обновляет effects и MIDI filters только для актуального actor/context; Item-parent разрешается через parent.actor. Не применяет завершение устаревшего callback к новой панели. Реальный сбой текущего компонента сообщает через console. |

Data flow: Foundry hooks/socket → current-scene candidate → generation queue → manager saved layout → один существующий HUD. `currentTokenId`, settings и flags schema сохранены; `_lastActorId`, `currentSceneId`, queue и generation — только клиентское transient state.

## Manager и данные

Владелец — `HotbarManager` в `scripts/managers/HotbarManager.js` sibling BG3.

- `constructor()` добавляет `currentSceneId = null`, сохраняя прежнюю инициализацию containers.
- `get token()` возвращает null при несовпадающей установленной сцене; временные manager callers, задающие только `currentTokenId`, продолжают работать с текущим canvas. `get actor()` по-прежнему производен от Token.
- `_loadTokenData({readOnly = false} = {})` сохраняет прежнюю загрузку/legacy layout и обычную CPR Item-section migration. Recovery передаёт `readOnly:true`, исключая эту запись. Старые вызовы без параметров сохраняют прежнее поведение.
- `socketUpdateData(actor, changes)` использует scoped `this.token`, затем прежний generate-route. Не применяет входящие flags напрямую.
- `cleanupTokenData(tokenId)` остаётся прежним явным reset-владельцем для ручного link→unlink, но больше не вызывается из delete/recovery.

## Эффекты и MIDI

- `ActiveContainer.activesList` (`scripts/components/containers/ActiveContainer.js`) всегда возвращает actor effects array либо `[]`. Существующий `render()` сохраняет кнопки/действия и безопасен без actor.
- `FilterContainer._checkBonusReactionUsed()` (`scripts/components/containers/FilterContainer.js`) при включённой синхронизации использует активный `MidiQOL.hasUsedBonusAction(actor)`/`hasUsedReaction(actor)`, затем action counters, затем прежние effect IDs. 1/2 не считается исчерпанием. Меняет только клиентское used-state через прежний setter, только при изменении нужного значения. Выключенная синхронизация сохраняет ручное состояние; MIDI resources и advOnce не изменяются.

## Rebreya boundary и кэш

`scripts/hooks.js`: private `getBg3RuntimeModuleUrl(path)` добавляет `?v=<installed BG3 version>` из module metadata либо сохраняет bare path без известной версии. `patchBg3HotbarDeathSavesContainer({force = false, importModule})` и `patchBg3HotbarStorageCommonActions({force = false, importModule})` используют этот canonical URL, сохраняя прежние guards и patch behavior. `main.js` и `settings.js` используют один `hooks.js?v=1.5.5`.

BG3 manifest/forwarder и все относительные runtime JS imports используют 3.4.6; rebreya manifest 1.5.5 указывает тонкий `main-1.5.5.js`. Старые entrypoint-файлы остаются доступны. Новые manifests требуют штатного обновления серверной metadata и клиентов; автоматический перезапуск чужой игры не выполняется.

## Проверки

- `tools/local-module-patches/2026-10-25-bg3-hud-recovery/hud-recovery.test.mjs`: `fixture(options)` загружает настоящий source в VM с внешними Foundry/DOM/document doubles; `midiFixture(options)` исполняет настоящие MIDI predicates. Проверки scene identity, stale events, GM/disabled/ownership, manual lock, replacement/reconnect, serialized render/retry, неизменности layout и отсутствия Document writes, null effects и action limits.
- BG3 `tests/runtime-policy.test.mjs`: `evaluateWithMocks(relativePath, globals, mocks)` нормализует query только для dependency mock lookup, сохраняя реальный SourceTextModule и прежние assertions.
- `tests/bg3-hotbar-compat.test.mjs`, `tests/module-manifest.test.mjs`: URL/version boundaries и прежние compatibility assertions.
- `tools/local-module-patches/2026-10-02-console-errors/console-errors.test.mjs`: прежние 34 проверки, включая GM absent-panel callbacks, advantage/disadvantage и advOnce.
- Exact-byte before/after hashes, forward/reverse patch verification и ограничения live-проверки находятся в README нового patch record.
