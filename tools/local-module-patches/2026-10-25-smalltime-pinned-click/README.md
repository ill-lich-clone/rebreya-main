# SmallTime: закрепление после неподвижного щелчка, 2026-10-25

Установленный SmallTime обновлён локально с **2.0.4** до **2.0.5**. В `SmallTimeApp.onDragEnd(event)` добавлен один guard: неподвижный жест закреплённого окна освобождает capture/listeners, очищает animation/state и завершается без записи `position`/`pinned`.

Ранее такой щелчок мог сохранить `pinned=false`, оставляя DOM закреплённым; после reload часы использовали старые свободные координаты. Исправлены `pointerup` и `pointercancel`, включая 58px/79px и zero-delta move. Реальное перетаскивание, прежний порог движения, pin zone, snap свободного окна, client settings schema и вся календарная/игровая логика сохранены.

## Загрузка и существующая позиция

Manifest SmallTime указывает `scripts/smalltime-app-2.0.5.mjs`; loader импортирует source с `?v=2.0.5`. `helpers.mjs` и upstream metadata/download URL 2.0.4 сохранены: это локальный patch, публичный upstream release не создавался. Rebreya runtime не менялся, его версия остаётся **1.5.5**.

Уже открытый клиент продолжает использовать загруженный код. В удобное время штатно перезапустите сервер для перечитывания manifest и обновите страницы клиентов (Ctrl+F5). Сервер/сеансы в этой задаче не перезапускались.

Ранее сохранённое `pinned=false` не сбрасывается автоматически: это может быть намеренное свободное размещение. Для уже сместившихся часов используйте штатный **Shift+клик по подписи `Player Visibility Default`** в настройках SmallTime; он закрепляет окно и перезагружает только этот клиент.

## Source record и откат

`manifest.json` содержит точный backup root и before/after SHA-256 трёх файлов; `beforeSha256:null` означает новый loader. Backup содержит исходные `module.json` и `scripts/smalltime-app.mjs`. `patches/smalltime.patch` применим только к этой точной локальной версии 2.0.4.

Для проверки создайте отдельную папку с дочерней `smalltime`, содержащей точные originals из backup. Выполните из неё `git -c core.autocrlf=false apply --check <absolute-patch-path>`, затем ту же команду без `--check`. Для отката используйте `--reverse --check`, затем `--reverse`. Forward/reverse проверяются побайтово, включая удаление только нового loader. Перед откатом установленной копии обязательно сверьте все after hashes, чтобы не затереть последующие изменения. Обновление upstream может заменить локальный patch.

## Проверки и ограничения

Проверка выполняется только по исходникам, как выбрал пользователь. Исходники Foundry **13.351** использованы при диагностике; реальная игра, GM/player UI и browser drag в этой задаче не проверялись. SmallTime manifest по-прежнему указывает minimum 13 / verified 14; это прежние upstream значения, отдельная проверка Foundry 14 не заявляется.

`pinned-click.test.mjs` исполняет настоящий установленный класс в Node VM. Doubles заменяют только внешние Foundry positioning, DOM и settings I/O; методы start/move/end, pin/unpin и pin-zone не подменяются. Для проверки отдельной копии задайте `SMALLTIME_TEST_ROOT` её абсолютному пути.

| Команда / проверка | Результат |
| --- | --- |
| Patch regression suite до изменения source | 5 ожидаемых failures / 5 preservation passes |
| `node --test tools/local-module-patches/2026-10-25-smalltime-pinned-click/pinned-click.test.mjs tests/smalltime-compat.test.mjs tests/bg3-hotbar-compat.test.mjs` | 49 passed, 0 failed |
| Полный `node --test tests/*.test.mjs` | 5025 passed, 0 failed, 1 existing skipped (5026 total) |
| `node --check` для tracked/new JS/MJS Rebreya и JS/MJS SmallTime | 1064 + 4 passed, 0 failed |
| PowerShell `Get-Content -Raw -Encoding UTF8 ... \| ConvertFrom-Json` для tracked/new JSON и sibling manifest | 65 passed, 0 failed |
| `git diff --check` и `git diff --cached --check` | PASS |
| Forward/reverse patch | 3 after hashes / 2 before hashes совпадают; новый loader удалён при reverse |

Спецификация: `docs/superpowers/specs/2026-10-25-smalltime-pinned-click-design.md`; план: `docs/superpowers/plans/2026-10-25-smalltime-pinned-click.md`. Пользователь согласовал спецификацию и самостоятельное планирование/выполнение. Работа ведётся в обязательной `lich_branch`; sibling вне Git защищён exact backup и disposable validation copies.

Единственный существующий skip: `rendered ghost is removable and mechanically empty; authored names are escaped and readonly controls disabled` — среда Node не предоставляет Foundry Handlebars; этот UI-сценарий не объявляется проверенным.

Gemini 3.8 Flash High через Antigravity подтвердил достаточность guard для найденного сценария. Предложения о новом пороге движения и изменении floating-click snap исключены: они выходят за согласованное изменение поведения. Независимый финальный review завершился `SUCCESS`: блокирующих замечаний нет. Вывод review о клиентском кэше ограничен необходимостью перечитать серверный manifest и обновить клиенты, как описано выше.
