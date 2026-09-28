# Новый комплект иконок компендиумов — план исполнения

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:executing-plans` before code changes. Для Luna Max: выполнить весь план последовательно, отмечая `- [x]` только после записанного доказательства. Одновременно генерировать только один `packId`. После каждого pack фиксировать checkpoint и переходить к следующему без обязательной смены чата; не поручать отдельные мелкие шаги субагентам.

**Goal:** новый набор иконок для всех включённых managed документов с проверенными сетками 5×5 по 1000×1000 px, начиная с backup и текущей синхронизации.

**Architecture:** live synced packs дают список документов и стабильные ID; source catalogs уточняют смысл и исключения; `tools/icon-pipeline.py` владеет детерминированным manifest, промптами, приёмкой и нарезкой. Изображения устанавливаются после приёмки полного batch, затем существующий active-GM sync обновляет только ожидаемые `img`.

**Tech Stack:** Foundry VTT 13, dnd5e, Python 3, Pillow или FFmpeg/FFprobe из текущей среды, встроенный ImageGen, Node test runner, Git/PowerShell.

**Spec:** `docs/superpowers/specs/2026-09-23-full-compendium-icon-set-design.md` — прочитать целиком перед исполнением. Старый план на 443 иконки не использовать как техническое задание.

## Global Constraints / глобальные ограничения

- Один batch = один компендиум, до 25 целей, строгий порядок 5×5. Сетка должна быть **ровно 1000×1000 px**; каждая ячейка 200×200. Неверный размер или раскладка означает reject и повторную генерацию, без ресайза исходной сетки.
- Чёрный или простой тёмный фон; форма предмета может быть детальной. Следовать style registry спецификации и опознавать pack/класс/набор. Не помещать текст и номера в картинку.
- Обычные 504 gear ID из пяти source sheets исключены. Все 108 имплантов и 124 усовершенствования включены. Всего gear целей текущей волны 304; иной результат блокирует генерацию до объяснения diff.
- Существующие изображения и пользовательские world-документы защищены backup. UUID, флаги, mechanics и source catalogs не менять ради арта. Коллизии normalized name или output path разрешать до первой сетки pack.
- Сначала backup, затем нынешний sync, затем manifest, затем pilot, затем pack batches. Не запускать `reloadData()` до проверки backup.
- Код, шаблоны, изображения и другие файлы, выдаваемые игрокам, требуют новой версии `module.json`, versioned forwarder и проверки runtime-путей. Сохранять единственный shared icon-cache lifecycle из `#syncManagedCompendia()`.
- Использовать `lich_branch`; перед изменениями выполнить Git preflight из `AGENTS.md`. Перед commit — focused tests, один полный прогон проверок, `git diff --check`, diff review; stage только свои файлы; commit и `git push -u origin lich_branch`, без force push.

## Review Focus / проверки, которые нельзя пропустить

1. Генератор вернул 1024×1024 либо 1000×1024: batch rejected, нет WebP и нет installed receipt.
2. Размер 1000×1000, но одна ячейка смещена, пуста или изображает соседний предмет: batch rejected целиком.
3. Два документа имеют одинаковый normalized name: manifest блокирует неоднозначное разрешение, не присваивает им одну картинку молча.
4. Последняя сетка pack содержит меньше 25 целей: незанятые ячейки чёрные, следующий pack туда не добавляется.
5. Прерванная запись или повторный запуск: не возникает частично установленного batch; сохранённый receipt и backup позволяют возобновление либо откат.

## Задача 1. Защитить текущее состояние и выполнить нынешний sync

**Владелец:** операционный шаг, `scripts/main.js:#syncManagedCompendia()` и public `reloadData()`; никаких правок runtime-кода.

- [ ] Выполнить `git status --short --branch`, `git branch --show-current`, `git fetch origin`, `git rev-list --left-right --count HEAD...origin/main`, `git log --oneline HEAD..origin/main`, сравнение с `origin/lich_branch`. Если появились чужие изменения, расхождение remote или конфликт с main — остановиться по `AGENTS.md`.
- [ ] На активном GM определить фактический `game.world.id`, полный путь world root и список `world.rebreya-*` packs. Сохранить counts, UUID и `img` для каждого managed документа в read-only pre-sync snapshot. Зафиксировать SHA текущего HEAD и `module.json` version.
- [ ] Остановить Foundry для файловой копии либо выполнить консистентный backup штатным механизмом Foundry. Копировать **модуль и весь мир**, включая pack storage, в новый каталог вне репозитория. Перед любыми рекурсивными операциями проверить resolved absolute source/destination и что destination не попал внутрь source. Записать SHA-256 manifest и проверить чтение/распаковку случайной выборки плюс наличие pack storage. Записать точные шаги restore.
- [ ] После проверенного backup запустить Foundry как active GM и вызвать `game.rebreyaMain.reloadData({ notify: true })` ровно один раз. Сохранить post-sync snapshot и журнал ошибок. Проверить ожидаемые pack counts, стабильность UUID и отсутствие изменений чужих документов; при сбое остановиться и восстановить из backup, не переходить к генерации.
- [ ] Сохранить в `tmp/imagegen/baseline/` (ignored) pre/post snapshots, backup receipt и commit/version. Продублировать receipt вне модуля вместе с backup.

## Задача 2. Зафиксировать точный manifest и стиль до генерации

**Файлы:** изменить `tools/icon-pipeline.py`; создать профильные `tests/icon-pipeline-grid.test.mjs` либо Python unittest в `tests/`; записать machine-readable manifest и style registry в `tmp/imagegen/` с резервной копией рядом с backup. Изменённые методы документировать в разделе 15 `docs/function-passport.md`.

- [ ] Написать failing fixtures для двух packs с одинаковым названием, 25+1 документов, неполного batch и gear из каждого source sheet. Проверить, что исключены 504 base ID и включены все 304 специальные gear ID.
- [ ] Из post-sync pack indexes (при нехватке полей — read-only `pack.getDocuments()`) построить target rows вида `{packId, documentId, sourceId, name, sourceRef, group, outputPath, styleKey, status}`. Для gear связать document flags `gearId` с `data/gear.json`, исключать по пяти точным source-sheet prefixes из спецификации; `data/implants.json` и `data/upgrades.json` не добавлять повторно. Для остальных packs сверить managed flags/source ID и фактический документ. Отдельно пометить construct Actor и не менять его token автоматически.
- [ ] Проверить уникальность `packId+documentId`, source ID, normalized name в каждом runtime search scope, output path (Windows case insensitive), наличие pack style и семантических описаний. Ошибку коллизии возвращать с обеими строками; не выдумывать случайный suffix.
- [ ] Для каждого pack отдельно упорядочить по stable source ID/document ID, разбить на последовательные batches по 25. Сохранить source commit, module version, source fingerprints, counts `included/excluded/total`, SHA manifest. На последней сетке оставлять пустые слоты, не подмешивать следующий pack.
- [ ] Сверить живые pack counts с контролями спецификации и отчётом по каждому source sheet. Если общий каталог или текущая волна отличается от ожидаемого, записать причины в manifest report; не заявлять «3500 готово» по количеству файлов.

## Задача 3. Проверить достижимость строгих 1000×1000

- [ ] После фиксации target/style manifest выбрать пилотные 25 имплантов и вызвать встроенный ImageGen с точным требованием 1000×1000 и 5×5. Это одноразовый пробный файл в ignored `tmp/imagegen/`, без нарезки и установки.
- [ ] Проверить размер декодированного результата независимым image probe. Если он не 1000×1000, записать размер, prompt и SHA, повторить максимум ещё два раза. Каждый неверный результат пометить rejected; не делать resize/crop, чтобы представить его как допустимую сетку.
- [ ] Если три попытки не дали 1000×1000, остановить **всю генерацию** и передать пользователю подтверждённое ограничение генератора. Не переходить к адаптеру и не заменять модель/метод генерации без нового решения пользователя. Если геометрия достижима, сохранить одну принятую сырую сетку для следующей задачи.

## Задача 4. Реализовать строгую приёмку сетки и установку batch

**Файлы:** `tools/icon-pipeline.py`, его focused tests, при необходимости только существующие service owners для icon lookup, `docs/function-passport.md`. Не переписывать managed sync.

- [ ] Сначала написать failing tests: corrupt image, 999×1000, 1024×1024, неправильное количество/положение занятых ячеек, заполненные пустые ячейки, existing output без backup, interrupted install, rerun по receipt. Проверить no-write при reject.
- [ ] Добавить CLI contract в существующий pipeline: `grid-manifest --snapshot <json> --out <json>`, `grid-prompt --manifest <json> --batch <id>`, `grid-validate --manifest <json> --batch <id> --image <path>`, `grid-apply --manifest <json> --batch <id> --image <path> --backup-dir <path>`, `grid-audit --manifest <json>`. Команды должны печатать краткий JSON/сводку и реальные ошибки; пути ограничить `templates/icons/`.
- [ ] `grid-prompt` печатает 25 numbered subjects с коротким описанием и styleKey, общий контраст/фон/запрет текста и **точные** 1000×1000/5×5/200×200. Незаполненные slots называются чёрными пустыми ячейками.
- [ ] `grid-validate` декодирует файл и требует 1000×1000; фиксирует результат проверки ровной раскладки и визуальный QA receipt. Сама программа не вправе утверждать семантическое соответствие 25 предметам без поклеточного осмотра. Отклонённую сетку оставлять в `tmp/imagegen/rejected/` с причиной; максимум три попытки на batch, затем остановка.
- [ ] `grid-apply` принимает только `accepted` receipt, режет координаты `(column*200,row*200,200,200)`, создаёт 200×200 WebP, повторно декодирует все outputs, делает backup заменяемых файлов и атомарную установку полного batch. После сбоя восстановить originals, не отмечать batch установленным. SHA, paths и prompt revision записать в receipt.
- [ ] Запустить focused tests на каждом изменённом владельце. Если для glossary/spells/construct либо коллизий нужен lookup, менять только их сервис и тесты, не добавлять второй cache или startup scan. Изменения публичного контракта описать в нужном разделе `README.md`.

## Задача 5. Пилот и серийное изготовление по pack

**Выход:** `tmp/imagegen/sheets/<packId>/<batchId>.png`, previews и receipts (ignored); принятые иконки — `templates/icons/<packCategory>/...`. Использовать встроенный ImageGen, по одному вызову на сетку. Никакой установки до завершения задач 1–4.

- [ ] Первый пилот: `world.rebreya-gear`, группа implants, первые 25 записей manifest. Использовать принятую сырую сетку задачи 3, проверить все 25 позиций в порядке, читаемость, фон и характер имплантов. При содержательном браке сохранить reject reason и перегенерировать; 1024→1000 не масштабировать.
- [ ] После пилота обрабатывать gear по `styleKey` без смешения разных styleKey в одной сетке: implants → upgrades → firearms → attachments → explosives. При этом `packId` остаётся `world.rebreya-gear`; в receipts фиксировать subgroup.
- [ ] Затем по одному pack: materials → magic items → feats → backgrounds → race features → races → class features → subclasses → classes → actions → downtime → states → transport → glossary → spells → craftsman constructs. Для class feature/subclass/class grid дополнительно группировать по родительскому классу, сохраняя его мотив; неполную сетку не дополнять следующим классом. Для pack без целей записать 0-target receipt, не рисовать пустую сетку.
- [ ] На каждой сетке: вывести точный prompt, вызвать ImageGen, сохранить полученный файл, машинно валидировать 1000×1000, построить preview с 25 ячейками, вручную сверить каждую ячейку с manifest, записать `accepted/rejected` и причины. Установить только accepted batch. После трёх reject остановить текущий pack с полным контекстом для исправления.
- [ ] По окончании pack выполнить `grid-audit`, проверить число outputs, SHA, 200×200 decode и отсутствие изменений excluded IDs. Поднять версию модуля, forwarder и runtime-ссылку, провести один active-GM `reloadData()` и проверить pack UUID, `img`, отсутствие изменений механики/чужих документов; проверить обновление изображения на клиенте игрока с обычным кэшем.
- [ ] До следующего pack выполнить focused tests владельца и один полный прогон проверок из `AGENTS.md`, `git diff --check`, `git diff --stat`, содержательный diff. Коммитить/пушить только файлы текущего pack и обязательные runtime/doc изменения. Сохранить pack receipt и краткий handoff с commit и статусом следующего batch.

## Финальный аудит

- [ ] Сравнить каждый included manifest row с установленным WebP и фактическим `img` в world pack; исключённые 504 gear ID проверить отдельно по pre/post `img`. Ошибки именования, cache и содержимого устранить у владельца pack.
- [ ] Свести `total/included/excluded/accepted/installed/synced` по pack и subgroup. Проверить, что число принятых сеток равно сумме `ceil(groupCount/25)` по группам, что нет пропусков/дубликатов и каждый output является 200×200 WebP.
- [ ] Финальный полный набор проверок из `AGENTS.md` выполнить один раз на окончательном HEAD и зафиксировать passed/failed. Финальный commit/push делать только после проверки diff и восстановления пути из backup receipt. В отчёте назвать фактическое количество документов, сеток, reject/retry, unresolved targets и backup location без громоздких логов.

## Checkpoint и возможный handoff

После каждого pack сохранить: текущий commit/version, завершённый и следующий `packId`, styleKey, SHA manifest, путь backup/restore receipt, последний установленный batch ID, список нерешённых коллизий, уже выполненные проверки и точный следующий шаг. Продолжать с очередным pack по этому плану. Если контекст всё же требует нового чата, передать эти данные и ссылки на спецификацию/план без длинных логов или всего manifest. Перед новым pack снова выполнить Git preflight и проверить backup receipt, но не повторять baseline sync и генерацию завершённых batches без причины.
