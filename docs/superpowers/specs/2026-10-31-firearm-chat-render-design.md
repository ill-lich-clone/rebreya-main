# Исправление рендера огнестрельной карточки

Продолжение утверждённой механики осечки и её отмены. Пользователь должен раскрывать attack/damage кубики штатным кликом, видеть «Отменить осечку» после всех обновлений текущей атаки и пользоваться прежней перезарядкой. Владелец — CombatAttackService; Foundry 13.351, dnd5e 5.2.5, MIDI 13.0.61.

## Подтверждённые причины

- `#recordAmmunitionShot` создаёт `flags.dnd5e.roll` только ради ammunitionData на MIDI activation card. dnd5e принимает его за native roll card и падает при удалении отсутствующего `.flavor-text`, до подключения dice listeners.
- Удаление/замена firearmMisfire одним update с обычным diff удаляет неизменённые поля снимка. Native probes подтвердили потерю actorUuid/weaponId/jammed и сохранение только midiOriginal даже с `{diff:false}`. Native forced replacement `==firearmMisfire` сохраняет полный снимок и удаляет старые optional fields.

## Контракты и изменения

- Боеприпас по-прежнему хранится в module ammunitionShot. Native ammunitionData дополняется только при существующем native `dnd5e.roll.type`; MIDI activation card не получает фиктивный roll flag.
- Все существующие записи снимка используют native `==firearmMisfire`, как уже делает магазин для своего состояния. Соседние flags сохраняются, старые поля снимка удаляются, отсутствие исходных critical overrides сохраняется.
- Расход 1/3/6, очередность, authored formulas, bonus один раз, jam→miss, блокировка урона, native cancel и author-only reload не меняются. Отмена остаётся в текущей сессии; восстановления workflow после F5 нет.
- Уже повреждённые сообщения тестового мира исправляются адресно: удаляется только созданный нами roll без type и только ammunitionData; снимок восстанавливается из сохранённого attack Roll. Броски/HP/инвентарь не меняются. Автоматическая массовая миграция не вводится.

## Подходы

Выбран локальный ремонт двух исходных записей. Перехват/подмена системного рендера скрывал бы причину и оставлял ложные flags; отдельные сообщения ухудшили бы уже согласованную общую карточку. Новых hooks, sockets, очередей и зависимостей нет.

## Доказательство

Focused regression: native typed card сохраняет ammo, MIDI card не получает native roll, snapshot replace сохраняет address/outcome при default diff boundary. Live: реальная атака со спецпатроном (успех/клин), открытие attack/damage tooltip, стабильная cancel-кнопка после updates, отмена прежнего результата без нового расхода. Полная suite, JS/JSON, diff, версия и push обязательны.
