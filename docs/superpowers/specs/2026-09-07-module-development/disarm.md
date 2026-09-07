# Обезоруживание [Lich]

Общие ограничения: [основная спецификация](../2026-09-07-module-development-design.md). Запрос 1, этап R6.

## Обязательное игровое правило

Одной из доступных атак атакующий пытается выбить оружие или иной удерживаемый предмет у существа максимум на одну категорию крупнее. Бросок атаки оружием без временных бонусов и качества задаёт Сл спасброска. Защитник выбирает Силу или Ловкость. Провал: предмет падает рядом; на сетке направление/клетка определяется к8. Атака с помехой при удержании предмета двумя руками. Спасбросок Силы с преимуществом, если атакующий меньше защитника.

Спасбросок total >= DC успешен; total < DC — провал. Атака здесь задаёт DC, не сравнивается с AC, не наносит damage и не запускает обычные on-hit эффекты. Natural 1/20 не дают автоматического результата обезоруживания поверх этого правила.

## Существующие владельцы

- Managed world macros: scripts/combat/grapple-macro-service.js, GrappleMacroService.syncManagedDocuments(); exact папка Macro/Ребрея.

- Атаки: scripts/combat/attack-service.js, CombatAttackService; hooks — scripts/combat/hooks.js.

- Руки: scripts/integrations/held-items.js, getItemHeldHands(), getItemHandRequirement(), handReservations; кукла — HeroDollService.

- Выброшенные вещи: scripts/data/storage-command-service.js, StorageCommandService.dropItemToScene(); ground pile и portable containers — существующие storage services.

- Authority: gateway/coordinator/journal. Паспорт: 2, 8, 16.

Новые предлагаемые файлы: scripts/combat/disarm-service.js (одна операция), scripts/combat/disarm-rules.js (чистые правила/геометрия), scripts/integrations/disarm-roll-adapter.js (dnd5e rolls), scripts/infrastructure/foundry/disarm-command-contract.js (exact schemas). Composition только связывает их. Existing managed macro owner добавляет третий macro, отдельный lifecycle папки не создаётся.

## Пользовательский сценарий

1. Макрос «Обезоруживание» вызывает новый public API disarm({sourceTokenUuid?,targetTokenUuid?}); без аргументов требуется один управляемый свой token и одна цель.
2. Выбрать своё доступное оружие и один удерживаемый предмет цели. Не показывать скрытый инвентарь NPC: authority отдаёт разрешённую проекцию удерживаемых вещей; GM может подтвердить конкретный предмет неизвестного NPC.
3. Показать формулу, исключённые бонусы, причину помехи и стоимость «1 атака». До первого броска cancel не расходует действие.
4. Authority валидирует размеры, сцену, диапазон, источник/руки и сохраняет operation fingerprint. Затем бросок атаки создаёт одну доверенную карточку.
5. OWNER цели выбирает str/dex и бросает save; для NPC/offline owner решение принимает GM. Выбор не подменяется сравнением лучших характеристик. Если владельцев несколько — назначить одного отвечающего; остальные видят ожидание.
6. После save authority повторно проверяет живые token/item/hand identities. Успех save завершает операцию без переноса. Провал запускает ровно один ground transfer.
7. Карточка показывает источник, цель, DC, выбранный save, modifiers, результат и место предмета. Повторное нажатие открывает существующий результат.

## Предлагаемые решения, требующие Q2

Базовая формула: d20 + постоянный ability modifier выбранного оружия + его действительный proficiency contribution. Quality/magical attack bonus, Bless/Bardic/прочие временные добавки исключены. Постоянные class/feat overrides не выбрасываются молча: adapter должен определить provenance и показать состав; неизвестный модификатор требует GM выбора до roll. Изменения ability score временным эффектом тоже требуют baseline, а не механического чтения уже buffed modifier.

Предлагается обычная дистанция выбранного weapon mode, включая ranged, с существующими range/visibility ограничениями; это расширение неоднозначного текста, подтвердить до R6. Пока не определено, нельзя молча ограничить всё 5 футами.

Существующие advantage/disadvantage причины объединяются штатным правилом отмены, без накопления нескольких преимуществ. Преимущество меньшего атакующего относится только к str save. Использовать фактическое held hands, а не одно только свойство versatile/two-handed в названии.

Общего доказанного счётчика оставшихся атак в исследованных владельцах не найдено. На первом этапе карточка явно помечает расход одной атаки; учёт доступных атак остаётся существующим игровым процессом. Если требуется автоматическое списание, сперва найти канонический budget owner либо отдельно согласовать его добавление. Макрос не должен бесплатно выдавать дополнительную атаку или расходовать целое действие вместо одной атаки.

## Падение и сохранность

Для квадратной сетки: к8, 1=север, далее по часовой стрелке СВ/В/ЮВ/Ю/ЮЗ/З/СЗ. У крупного токена берётся ближайшая внешняя клетка по выбранному направлению от footprint; используется реальная grid size сцены.

Стены, границы, hex/gridless не описаны правилом. Предлагаемый fallback: показать GM исходный к8 и выбор законной точки рядом; не перебрасывать молча и не терять предмет вне сцены. На gridless выбор точки рядом выполняет GM. Заполнение клеток другими токенами само по себе не уничтожает предмет.

Падает одна удерживаемая физическая единица с quantity=1, её durability/upgrades/contents/flags сохраняются. До authoritative подтверждения места source не списывается. Не использовать обычный public drop с поддельным GM sender: добавить внутренний authorized-intent путь существующего storage owner, доступный только валидированной disarm operation. Generic inventory transfer ACL не ослаблять.

Снятие held/equipped/heroDoll и ground receipt образуют один recoverable workflow. Если ground create прошёл, а source debit нет, recovery продолжает эту операцию; второй pile запрещён. При stale target/item операция завершается объяснимым конфликтом без нового roll; повтор с новыми исходными данными — новая атака.

## Состояние и команды

Проектируемые phases: prepared → attack-rolled → awaiting-save → save-resolved → drop-prepared → drop-committed → completed; отдельные cancelled/conflict/manual-review. Rolls, выбранная характеристика, к8, item identity и destination фиксируются до повторяемых side effects.

Команды disarm.start и disarm.resolve-save принимают только operation ID, token/item UUID, mode и choice; roll result должен быть связан с доверенной карточкой/назначенным роллером и проверен authority. Player request произвольного total не принимается. При manual roll GM явно подтверждает total как отдельное разрешённое решение. Deadline ожидания не превращается в автопровал или автоспасбросок.

## Проверки

Новые tests/disarm-rules.test.mjs, disarm-service.test.mjs, disarm-socket.test.mjs; расширить grapple-macro-service, held-items, storage-socket, group-command-dispatch при изменении routes.

Матрица: равный размер; цель +1; цель +2 отказ; меньшая цель; две руки; versatile одна рука; str/dex отдельно; equality DC; nat1/20; исключение quality/temporary bonuses; неверный owner; цель на иной сцене; неизвестный item; cancel до roll; retry после каждого phase; два GM; отключение owner; target меняет руки пока ждёт save; upgraded/container drop не теряет дерево.

Live GM+player: macro появляется один раз рядом с захватом после reload, одноимённый unmanaged macro не меняется; атакующий не может отвечать за чужую цель; save dialog и карточка синхронны; ground item можно подобрать существующим storage UI. Существующие захват/движение схваченного/обычная атака не меняются.
