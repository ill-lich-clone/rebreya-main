# Восстановление представления наземных куч

## Согласованное наблюдаемое поведение

Один обычный предмет остаётся своим изображением. Два и более оружия или доспеха, включая одну строку со стопкой одинаковых предметов, показываются как «Куча оружия» или «Куча доспехов» с соответствующим существующим asset. Несколько разных категорий показываются как «Куча предметов». Контейнер остаётся одним физическим объектом: его содержимое не увеличивает количество предметов на земле. Journal-ссылки сохраняют существующий приоритет и правила.

Один номинал монет использует существующее изображение, соответствующее количеству: 1–50 — точный спрайт, 51+ — спрайт кучи этого номинала. Два и более положительных номинала показываются как «Куча монет» с `assets/storage/piles/coins.png`. Сотня монет хранится как баланс 100 внутри одного токена; дополнительные Item-монеты и 100 отдельных токенов не создаются. При открытии и получении сохраняются точное количество и номинал.

## Подтверждённые факты и границы диагноза

- `4b277ed0` добавил изображения категорий. Даже в этом commit одна строка с quantity > 1 показывалась одиночным предметом; переход стопки оружия/доспехов к категории — явно согласованное изменение поведения.
- `34eea12d` добавил quantity-aware спрайты монет. Текущий pure helper правильно выбирает `pp-pile.webp` для `pp:100` и `coins.png` для нескольких номиналов.
- `storage-deposit-source.js:buildItemRow()` не сохраняет `typeLabel`; категория в `storage-pile-presentation.js` ищется по русскому label либо native `itemData.type`. Поэтому две native `weapon` строки дают общую «Кучу предметов».
- `storage-pile-presentation.js` выбирает одиночное изображение по числу строк, без проверки quantity.
- `storage-app.js` принудительно назначает валютным строкам старые gear-иконки, независимо от quantity.
- Новые скриншоты показывают корневую строку `container` quantity 1 с именем платиновой монеты, вложенным балансом pp:100 и независимым корневым балансом gp:1000. Подтверждён источник ошибки: `resolveStorageTokenSource()` извлекает только одиночный ordinary Item через `singleGroundItem()`, а pure coin pile с нулём Item rows передаёт в `buildStorageContainerRow()`. Read-only воспроизведение текущего кода для открытой ground coin pile pp:100 вернуло `{available:1,rowKind:"container",itemType:"container",nestedCoins:{pp:100,gp:0,sp:0,cp:0}}`. Это не ошибка текущей классификации gear-каталога: его платиновая монета имеет категорию «Сокровища», без container capacity/foundryType.
- 79 текущих тестов presentation / ground-pile service / deposit source проходят. Live bridge сообщает `Foundry VTT module not connected`; живые Documents и версии Foundry/dnd5e пока не проверены.

## Владельцы и минимальный подход

1. Существующий `storage-pile-presentation.js` остаётся владельцем вида кучи. Категория разрешается из canonical metadata managed Item и существующего label; native weapon поддерживается явно, native equipment становится доспехом только при подтверждённом armor subtype. Не считать любой equipment доспехом и не угадывать категорию по имени. Для стопки оружия/доспехов quantity учитывается отдельно от числа строк. Остальные quantity-зависимые single-item контракты, в частности боеприпасы и материалы, не меняются без отдельного основания.
2. Existing storage currency pipeline остаётся единственным владельцем баланса. Исправить перенос pure coin ground token: разрешать источник как валютный баланс, а не физический container Item; сохранять все номиналы, partial/full consume, restore и idempotent commands. Перенос в хранилище/персонажу/группе и обратно на сцену должен использовать существующих authoritative владельцев баланса. Stable Coin Item flag contract не расширять по имени либо предположению о старом gear Item.
3. Устранить уже созданные synthetic coin wrappers: только при доказуемом происхождении из coin-only pile snapshot, без настоящего физического host и без обычных/Journal/container вложений. Переносить только unclaimed nested currency в родительский баланс, не начислять стоимость/quantity оболочки и не изменять независимый корневой баланс gp:1000. Реальные кошельки/сундуки с монетами остаются контейнерами. Если snapshot не позволяет надёжно отличить synthetic wrapper от пользовательского контейнера, не мигрировать его автоматически; зафиксировать точный безопасный способ ремонта в плане. Повторный ремонт не начисляет валюту снова.
4. Валютные строки окна используют общий quantity-aware resolver изображения. Существующие row IDs `__coins:<denomination>`, quantity, команды выдачи и доступ остаются прежними.
5. Старые module-owned наземные токены получают исправленное представление через существующий active-GM repair/refresh owner. Исправление не должно повторно начислять баланс, возвращать claimed coins или заменять custom texture без основания. Сохранить UUID, ownership, центр и существующий размер/rotation contract.

## Сохраняемые контракты

Не менять настройки, flag schemas, публичные сигнатуры API, typed commands, права игрока/GM, quantity limits, authored loot formulas, расход бюджета, правила stacking, receipts/rollback и идемпотентность. Не вводить второго владельца world-state или прямых UI-записей. Pure coin pile остаётся 0.5 × 0.5; одиночные top-down предметы и контейнеры сохраняют footprints.

## Регрессионные проверки до реализации

- Один меч / один доспех сохраняют single art; quantity 2+ дают category art.
- Две разные managed/native weapons; armor subtype; non-armor equipment; смешанные категории; неизвестные/custom Items.
- Не менять существующее single-представление стопок боеприпасов/материалов и контейнеров с содержимым.
- Монеты 1, 50, 51, 100; два разных номинала; merge и частичное получение, которое меняет mixed pile обратно в denomination pile.
- Источник ground-token pp:100 не становится container quantity1; смешанная coin pile переносит оба баланса. Частичный и полный перенос и rollback сохраняют суммы.
- Synthetic wrapper fixture с nested pp:100 и root gp:1000: после ремонта pp:100 и gp:1000, без wrapper Item и без повторного credit после reload; claimed nested balance не возвращается. Реальный кошелёк с такими же монетами остаётся кошельком. Неизвестная flag version и сторонний Item с именем монеты сохраняют прежний контракт.
- Storage UI показывает quantity-aware currency art и прежние quantity/claim actions.
- Ошибка transfer/write сохраняет source и balance; retry не дублирует выдачу.

## Выпуск и проверка

После утверждения спецификации написать отдельный implementation plan и пройти его review gate. Применить focused red/green проверки владельцев; обновить README и соответствующие разделы function passport. Для runtime-изменений повысить version в module.json, синхронно создать versioned forwarder и обновить runtime cache URLs затронутых модулей. Перед commit выполнить полный `node --test tests/*.test.mjs`, syntax checks всех tracked JS/MJS, JSON parse и git diff checks; commit/push только в lich_branch. Отдельно указать границу live QA, если bridge по-прежнему недоступен.
