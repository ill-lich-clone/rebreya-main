# Локальные исправления Foundry, 2026-10-02

Исправления уже установлены в `D:/FoundryVTT/Data/modules`. Здесь сохранены diffs от точных резервных копий, SHA-256 и тесты, исполняющие настоящий установленный исходник в Node VM. Runtime rebreya-main не изменён.

| Модуль | Исходная → локальная версия | Исправление |
| --- | --- | --- |
| bg3-inspired-hotbar | 3.4.4 → 3.4.5 | Регистрация настроек на ready у всех клиентов; безопасные roll/onChange callbacks без панели; преимущество, помеха и advOnce сохранены |
| sm-airship | 0.1.9 → 0.1.10 | renderSettings принимает HTMLElement и jQuery, сохраняет одну кнопку и её действие |
| transform-cleanup | 13.351.5.3.2.1 → 13.351.5.3.2.2 | Проверка наличия dnd5e flags перед очисткой; прежнее удаление только active GM |
| effectmacro | 13.0.3 → 13.0.4 | Отсутствующий Actor пропускается; эффекты валидного Actor и выбор исполнителя сохранены |

Это локальные версии, не заявления об upstream releases. Обновление этих модулей может заменить правки. Новые versioned entrypoints импортируют существующих владельцев lifecycle; весь относительный JS import graph BG3 использует единый `?v=3.4.5`.

Для загрузки новых manifests/entrypoints перезапустите сервер Foundry в удобное время, затем полностью обновите страницы клиентов (Ctrl+F5). Сервер и чужие сеансы во время работы не перезапускались. Live-проверка после исправлений пропущена по прямому указанию пользователя; результат в текущем игровом сеансе не подтверждён. Исправление регистрации gadget Item уже было в `7f770ec4`; повторные правки игровых предметов не выполнялись. Неподтверждённые ResizeObserver/reactions и прочие симптомы из полного лога не объявляются исправленными.

## Проверки

Из корня rebreya-main:

```powershell
node --test --test-reporter=tap tools/local-module-patches/2026-10-02-console-errors/console-errors.test.mjs
```

Результат: **34 passed, 0 failed** (BG3 18, airship 5, transform 5, effectmacro 6). До исправлений наблюдались ожидаемые падения: BG3 8 и ещё 2 для новых GM callbacks/migration; airship 2; transform 2; effectmacro 3. VM doubles заменяют только внешние API; проверки не пишут документы мира и не выполняют настоящие броски, macros или удаление Actor.

Дополнительно: синтаксис 46 изменённых JS/MJS проверен через `node --input-type=module --check` со source на stdin (в airship package.json указан CommonJS, хотя браузерный entrypoint является ESM); четыре module.json разобраны JSON parser; 125 относительных import references проверены на существование и canonical cache query. Сравнение исходного registerSettings после удаления добавленных guards подтвердило неизменность keys/scopes/defaults и прежних player callback bodies. Прежняя consumable migration остаётся только у игроков.

Все четыре patches применены к изолированным копиям исходников: 50 after hashes совпали с manifest, все 34 теста прошли. Обратное применение восстановило 46 точных исходных hashes и удалило четыре новых forwarders. `git diff --check` проверяет repository changes. Общая runtime suite rebreya-main не запускалась: его runtime не менялся.

Независимое ревью Gemini 3.8 Flash High (Antigravity, inline code, без доступа к файлам) не выявило critical/important findings. По замечанию о тестах используется настоящий `isExecutor`, а не его имитация; итоговые 34 теста повторно прошли. Ревью получило поведенческие diffs и тесты; механический import graph проверен отдельно. Существующий недостижимый lib-wrapper notification/log, повторные UI reads и гипотетические primitive dnd5e flags не изменены: первые не влияют на эту правку, последние не соответствуют подтверждённым payloads. Ограничения: synthetic DOM/jQuery boundary, callbacks проверены с default values, нет live-проверки.

Для проверки другой копии модулей задайте `THIRD_PARTY_MODULES_ROOT` перед той же командой; по умолчанию тесты читают sibling modules относительно своего файла. После проверки удалите переменную из текущего процесса.

## Восстановление и повторное применение

Точные исходники и backup manifest:
`C:/Users/ill_lich/.codex/backups/foundry-console-errors-2026-10-02/2026-10-02T17-42-39-989Z`.

`manifest.json` в этой папке patches хранит original/patched versions, entrypoints, relative paths и SHA-256. Перед заменой сверяйте текущие hashes: неизвестные изменения нельзя затирать. Для восстановления скопируйте файлы из backup обратно в соответствующие модули, включая старые module.json. Новые forwarders после восстановления manifest не используются; их можно удалить по списку `beforeSha256: null`.

Локальный `.gitattributes` сохраняет patches без преобразования окончаний строк и исключает обязательные пробелы unified-diff context из whitespace lint; код и документация проверяются как обычно.

Для повторного применения к **точным исходным версиям** из каталога `D:/FoundryVTT/Data/modules` сначала выполните `git -c core.autocrlf=false apply --check <absolute-patch-path>`, затем `git -c core.autocrlf=false apply <absolute-patch-path>` для каждого файла в `patches/`. Для обратного применения к точным исправленным файлам используйте те же команды с `--reverse`. Отключение autocrlf сохраняет точные байты/hashes на Windows. Не применяйте patches к более новым upstream версиям без review.

## Согласованные документы и решения исполнения

- [Спецификация](../../../docs/superpowers/specs/2026-10-02-foundry-console-errors-design.md), [план](../../../docs/superpowers/plans/2026-10-02-foundry-console-errors.md): пользователь согласовал оба документа 2026-10-02.
- Использована текущая `lich_branch`: установленный runtime находится вне Git-репозитория; второй worktree не изолировал бы эти файлы. Риск concurrent edits ограничен резервными копиями и before/after hashes.
- Для cache bust обновлён весь относительный BG3 import graph. Дополнительные механические правки сохраняют targets и canonical ESM URL, исключая загрузку старого config из cached parent.
- Регистрация настроек у GM открыла прежние UI callbacks и player migration. Добавлены 36 guards отсутствующей панели и сохранено player-only выполнение migration; нормальные player bodies и metadata сверены с backup.
- Ledger вёлся напрямую в PowerShell вместо Bash helper scripts; dependencies не добавлялись. Завершение сверено с каждым пунктом плана.
