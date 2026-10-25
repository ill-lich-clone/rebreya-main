# Локальное исправление BG3 HUD, 2026-10-25

Установлен BG3 Inspired HUD **3.4.6** вместо локального 3.4.5. Rebreya Main **1.5.5** исправляет только существующую границу compatibility imports. Код Foundry, Midi-QOL и DAE не изменён.

## Поведение

- Player HUD восстанавливается после startup/reconnect, canvas reload, межсценового переноса и DAE create-before-delete. Учитываются сцена и ID токена; поздний delete/release старого Token не закрывает новый HUD.
- При нескольких выделенных Token сохраняется контекст одного подходящего персонажа; canvas selection не меняется. Выключенный HUD, скрытые/чужие Token и обычный ручной deselect/lock сохраняют свои ограничения. Создание постороннего Token не сбрасывает текущие ручные фильтры.
- У ГМа HUD по-прежнему не создаётся. GM settings registration и callbacks без панели сохранены. `scripts/module.js` побайтово совпадает с прежним после нормализации только cache query.
- Recovery не стирает flags/раскладку и не расходует ресурсы. Настройки, callbacks и их metadata сохранены: весь `utils/config.js` идентичен прежнему за исключением cache query. Default `_loadTokenData()` сохраняет прежнюю CPR Item-section migration; recovery использует readOnly.
- Эффекты безопасны без actor; настоящая ошибка текущего render сообщается в console. MIDI indicators учитывают доступные reaction/bonus limits и reset; advantage/disadvantage/advOnce проверены прежними тестами.
- Все относительные runtime JS imports BG3 используют `?v=3.4.6`; compatibility patches Rebreya импортируют классы с тем же installed-version key.

## Проверки и реальные ограничения

Проверены установленные исходники Foundry **13.351**, dnd5e **5.2.5**, Midi-QOL **13.0.61**, DAE **13.0.27**. Тесты HUD исполняют настоящие классы BG3 в Node VM; doubles заменяют DOM, внешние Foundry hooks/transport и Document I/O. MIDI predicates в соответствующих проверках берутся из установленного MIDI source.

| Команда / проверка | Результат |
| --- | --- |
| `node --test tests/*.test.mjs` | **5025 passed, 0 failed, 1 skipped** (5026 total) |
| `node --test tools/local-module-patches/2026-10-25-bg3-hud-recovery/hud-recovery.test.mjs` | **36 passed, 0 failed** |
| `node --test tools/local-module-patches/2026-10-02-console-errors/console-errors.test.mjs` | **34 passed, 0 failed** |
| `node --experimental-vm-modules --test ../bg3-inspired-hotbar/tests/runtime-policy.test.mjs` | **3 passed, 0 failed**; все прежние assertions сохранены, исправлен query-aware mock lookup |
| `node --test tests/bg3-hotbar-compat.test.mjs tests/module-manifest.test.mjs` | **66 passed, 0 failed** |
| `node --check` для tracked/new JS/MJS | **1063 passed, 0 failed**; затронутые после полного прохода файлы проверены повторно |
| PowerShell `Get-Content -Raw -Encoding UTF8 ... \| ConvertFrom-Json` для tracked/new JSON | **63 passed, 0 failed** |
| Browser ESM syntax BG3 (`node --input-type=module --check`, source на stdin) | **46 passed, 0 failed**; manifest валиден |
| Relative BG3 imports | **113** canonical references, все targets существуют |
| Forward/reverse `git -c core.autocrlf=false apply` к disposable exact copy | **43 after/before SHA-256** совпадают; новый forwarder корректно удаляется при reverse |

Один существующий skipped test: `rendered ghost is removable and mechanically empty; authored names are escaped and readonly controls disabled` — в Node environment отсутствует Foundry Handlebars (`NODE_PATH`), сценарий не объявляется проверенным.

Первый полный запуск выявил только устаревший release assertion `1.5.4` в `main-composition-root.test.mjs`. Он обновлён до нового manifest/forwarder без изменения проверок cache graph; повторный полный запуск зелёный. Первый собственный Node JSON checker не принимал существующий UTF-8 BOM в `lang/ru.json`; файл не менялся, обязательный PowerShell JSON parser подтвердил его корректность.

До runtime edits зафиксированы behavioral RED: исходный HUD — 10 провалов из 18; усиленный pending-close scenario — 1/1; effects/MIDI/stale release — 6 провалов; deferred replacement и empty external render — 2 провала. Последующие preservation regressions для manual deselect/filter также наблюдались RED перед исправлением. Итоговые установленные проверки зелёные.

**Live GM/player reconnect, настоящий PIXI teardown, регион и броски не проверены:** существующий MCP bridge возвращает `Foundry VTT module not connected`, браузерная сессия не авторизована. Сервер и сеансы других пользователей не перезапускались; игровые документы не изменялись для QA.

Для загрузки новых manifests/entrypoints штатно перезапустите сервер Foundry в удобное время, затем обновите страницы игроков через **Ctrl+F5**. До обновления серверной metadata/клиентов уже открытые вкладки могут исполнять прежние версии.

## Source record, установка и откат

Точная исходная копия (50 source/test/manifest files):

`C:/Users/ill_lich/.codex/backups/bg3-hud-recovery-2026-10-25/2026-10-25T11-03-01-917Z`

`manifest.json` содержит original/after versions, backup root, относительные пути и before/after SHA-256 всех 43 изменённых файлов. `patches/bg3-inspired-hotbar.patch` применим только к этой точной локальной версии 3.4.5, включающей прежние исправления. Перед установкой все 50 исходных hashes были сверены; установленные 43 after-hashes совпали с проверенной изолированной копией.

Для проверки patch используйте отдельную папку с дочерней `bg3-inspired-hotbar`, содержащей точные originals. В этой папке выполните `git -c core.autocrlf=false apply --check <absolute-patch-path>`, затем ту же команду без `--check`. Для отката используйте `--reverse --check`, затем `--reverse`. Forward/reverse проверены на отдельной копии за пределами Git checkout; исходный backup остаётся неизменным.

Перед откатом настоящей установки сначала сверьте все after-hashes: неизвестные новые изменения нельзя затирать. Можно восстановить перечисленные original files из backup; новый `scripts/module-3.4.6.js` после восстановления старого manifest не используется. Exact reverse patch также удаляет этот единственный новый forwarder. Повторное обновление upstream BG3 может заменить локальные исправления; не применять этот patch к другой версии без review.

## Согласованные документы и решения

- [Спецификация](../../../docs/superpowers/specs/2026-10-25-bg3-hud-recovery-design.md), [план](../../../docs/superpowers/plans/2026-10-25-bg3-hud-recovery.md): согласованы пользователем; самостоятельное планирование/выполнение без дополнительных согласований разрешено 2026-10-25.
- [Паспорт текущих функций](../../../docs/bg3-hud-function-passport.md) описывает signatures, владельцев, data flow и тесты.
- Использована требуемая `lich_branch`. BG3 вне Git изолирован копией и before/after hashes; новый worktree не изолировал бы установленный sibling. Native PowerShell ledger заменяет Bash helper scripts; после завершения verification evidence сохранено здесь. Baseline Rebreya уже был 1.5.4, поэтому новый release 1.5.5 сохраняет чужие завершённые изменения.
- Awaited protected `_render` использует ту же ERROR recovery state, что публичный Foundry render; это подтверждено исходником core и failing→passing retry test. ReadOnly option не удаляет прежнюю CPR migration у её обычных callers.
- Независимый review Gemini 3.8 Flash High через Antigravity завершился `SUCCESS`. Deferred replacement resolution и empty-render guard исправлены с RED→GREEN; дополнительное утверждение review об отсутствии `clearTimeout` отклонено после проверки полного метода: прежний clear сохранён, rapid release/control test оставляет ровно один timer.
- Отложенные minor предложения review: поддержка изменённых сторонними модулями effect IDs через statuses при одновременно отсутствующих MIDI counters/API; cleanup listeners при неподдерживаемом повторном ручном `new BG3Hotbar()`. Существующие canonical IDs, штатный единственный ready-instance и повторные canvas transitions проверены; новые lifecycle API не добавлялись.
- Templates/CSS и internals CPR/tidy flags не менялись; сохранение layout/schema проверено, визуальная совместимость реальной игры остаётся в live limitation выше.
