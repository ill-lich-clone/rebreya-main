# Console fixes: Rebreya 1.5.6 / BG3 3.4.7

Установлены локальные исправления поверх Rebreya 1.5.5 и BG3 3.4.6. Foundry 13.351, dnd5e 5.2.5, Midi-QOL 13.0.61 и DAE 13.0.27 не изменены. Предыдущий SmallTime fix остаётся без изменений.

## Результат и границы

- Созданы два отсутствовавших alias изображения `goggles-of-night.webp` из существующего «Ночные очки». World Items/UUID не переписываются.
- Managed macro «Перевязка ран» обрабатывает ожидаемый отказ `invalid-tokens`; публичный API продолжает уведомлять и отклонять Promise. Cleanup продолжает удаление остальных истёкших эффектов при точном missing-ID race. Проверки прав, world-hour deadline, Medicine/DC, количество комплектов, HP и receipts сохранены.
- Подсказка отсутствующего документа безопасно пропускается. Существующий dataset guard сохранён; остальные ошибки остаются видимыми.
- dnd5e inventory resize выполняет прежнюю responsive разметку в одном animation frame с последним размером; закрытый элемент пропускается.
- BG3 разрешает собственный Item сохранённого слота через нового токена после native переноса с сохранением token ID и actor ID. Живой токен другой сцены остаётся внешней ссылкой, даже если IDs совпали. Иные token/actor IDs, world Actor, Macro и Compendium сохраняют native resolution. Missing own Item не заменяется по имени. Layout/flags не мигрируют. До использования и после ожидания target selector проверяется действующий token context; потеря контекста отменяет ещё не начатое действие без use/target writes. Уже запущенные MIDI workflows и старые chat cards не переигрываются.
- Native activity без targeting получает один click после удаления точного capture listener, без `arguments.callee`. Исчезнувший HUD/manager или устаревший собственный Item безопасно отклоняет оба пути до native click/use/target writes.

Source-only QA выбрана пользователем. Live GM/player teleport не проверялся. Безымянный десятый 404 в логе не содержит URL; его asset неизвестен. Источник исходного безымянного ResizeObserver warning не установлен: исправлен найденный синхронный inventory path, полное исчезновение предупреждений не заявляется.

## Проверки

| Команда / проверка | Результат |
| --- | --- |
| Четыре focused Rebreya suites: dnd5e-tooltip-compat, treat-wounds-dialog/service, grapple-macro-service | 35 passed, 0 failed |
| Те же suites + `tests/module-manifest.test.mjs tests/main-composition-root.test.mjs` | 88 passed, 0 failed |
| `node --test tests/*.test.mjs` до финальных review fixes | 5030 passed, 0 failed, 1 existing skipped (5031 total) |
| `node --test` для четырёх focused Rebreya suites и `bg3-transfer.test.mjs`, `hud-recovery.test.mjs`, `console-errors.test.mjs` | 119 passed, 0 failed: 35 Rebreya + 14 transfer + 36 HUD + 34 compatibility |
| `node --experimental-vm-modules --test ../bg3-inspired-hotbar/tests/runtime-policy.test.mjs` | 3 passed, 0 failed |
| Rebreya tracked/new JS/MJS `node --check` | 1066 passed, 0 failed |
| BG3 browser ESM syntax | 47 passed, 0 failed; изменённые после полного прохода helper/HUD проверены повторно |
| PowerShell `Get-Content -Raw -Encoding UTF8 ... \| ConvertFrom-Json` | 66 passed, 0 failed |
| Exact-byte patch forward/reverse на disposable copy | 44 after hashes, 43 original hashes, новый loader удаляется при reverse |
| BG3 relative runtime imports | 120 canonical references с `?v=3.4.7`, все targets существуют |
| `git diff --check` | Без ошибок whitespace |

Существующий skip: `rendered ghost is removable and mechanically empty; authored names are escaped and readonly controls disabled` — Foundry Handlebars недоступен в Node environment (`NODE_PATH`).

До реализации наблюдались RED: 5 новых Rebreya failures при 29 baseline passes; 7 transfer failures при 3 preservation passes. Дополнительный live-foreign-scene regression дал RED перед guard, затем 11/11 GREEN. Финальное ревью Gemini выявило detached inventory без RAF, strict-mode `arguments.callee` и исчезнувший HUD/manager: все три воспроизведены новыми failing tests до исправления. Дополнительный RED подтвердил необходимость общей проверки Item context перед native click, а не только перед targeting. После изменений повторены все 119 затронутых tests, 88 release tests, 3 runtime tests, синтаксис изменённых JS/test файлов, manifest JSON и exact patch verification. Полный Rebreya запуск выполнен до этих узких правок; затронутые проверки повторены после них. Публичные и игровые assertions не ослаблялись.

Gemini получил два self-contained inline source excerpts и вернул exit 0/status SUCCESS. Предложение менять ошибку отсутствия комплектов отклонено после проверки: canonical `TreatWoundsDocuments.preview()` всегда возвращает `kits` array, а изменение этого отказа выходит за согласованный контракт. Exact missing-effect message подтверждён установленным core/логом; остальные ошибки намеренно пробрасываются. Сохранены прежнее закрытие activity dialog перед selector и отмена без replay. Более ранний stdin review не подтвердил получение контекста и был отвергнут целиком.

Alias SHA-256 совпадают с canonical image: `fd1767951f0c27b36714a292299646a06ab1bb021d0cbe25874c55c7a09aa304`. HTTP HEAD не подтверждён: локальный сервер закрывал соединение (`UND_ERR_SOCKET`) для обоих aliases и самой ранее доступной canonical картинки. Перезапуск сервера и изменения игровых документов для проверки не выполнялись.

## Source record, установка и откат

Spec: [design](../../../docs/superpowers/specs/2026-10-25-console-followup-fixes-design.md). Plan: [implementation](../../../docs/superpowers/plans/2026-10-25-console-followup-fixes.md).

Exact backup: `C:/Users/ill_lich/.codex/backups/console-followup-2026-10-25/2026-10-25T21-52-24-710Z`. Папка `original/bg3-inspired-hotbar` содержит 48 исходных manifest/JS/test files; `work` — проверенная копия, `validation` — отдельная проверка patch. `manifest.json` хранит 44 изменённых пути с before/after SHA-256 и оба созданных asset aliases. Все installed after hashes проверены. Patch применим только к точной локальной версии 3.4.6 с предыдущими исправлениями.

Для проверки patch создайте отдельную копию originals с дочерней папкой `bg3-inspired-hotbar`. Из родительской папки выполните `git -c core.autocrlf=false apply --check <absolute-patch-path>`, затем без `--check`. Откат: `--reverse --check`, затем `--reverse`. Перед изменением настоящей установки проверьте все before/after hashes соответственно: неизвестные последующие изменения нельзя затирать. Reverse восстанавливает BG3 3.4.6 и удаляет новый `module-3.4.7.js`; Rebreya откатывается своим Git commit. Созданные aliases можно удалить только при совпадении recorded hashes; это вернёт старые ссылки к 404. World database не затронута.

Новые manifests/entrypoints требуют штатного перезапуска сервера Foundry в удобное время и **Ctrl+F5** у клиентов. До обновления metadata открытые сеансы могут продолжить исполнять прежние версии. BG3 runtime changes находятся в sibling module; этот репозиторий хранит точный patch и tests.
