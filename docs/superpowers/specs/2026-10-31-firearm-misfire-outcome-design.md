# Осечка как промах и отмена конкретного выстрела

Пользователь сообщил реальный баг: native/MIDI атака19 с осечкойd20=2 отметила hit и сняла21 HP. Затем попросил «Отменить осечку» для этого броска (талисман и подобные ручные исключения), отдельную иконку клина и дополнительный значок перезарядки.

## Результат и сохранённые контракты

Клин этого выстрела принудительно превращает его в промах до MIDI hit/damage обработки, включая natural20 и принудительные попадания. HP цели от него не списывается; урон по этому выстрелу блокируется, пока осечка активна. Исходный d20/формула/сумма сохраняются. Автор атаки или GM с native OWNER может отменить конкретную осечку кнопкой, вернув исходный результат этой атаки (natural1 остаётся обычным промахом) и продолжив штатный расчёт урона/автоматизацию MIDI согласно текущим настройкам. Это не новый выстрел: нет нового attack d20, повторного расхода патронов, бюджета атаки или талисмана. Сам талисман/сложные исключения остаются ручными.

Отмена снимает только клин, созданный этим выстрелом, по его сохранённому jammedAt. Это не действие обслуживания/устранения осечки: misfire threshold не повышается и не сбрасывается, более поздний клин не удаляется. Старые сохранённые сообщения без точного адреса выстрела не получают небезопасной кнопки. Для осечки до существования attack d20 (legacy/public pre-attack или area utility) прежняя блокировка остаётся; кнопка восстановления исходного attack roll относится к уже брошенным атакам.

Сохраняются 1/3/6, порядок патронов, quantity rules, авторские attack/damage formulas и bonuses, reload presets, остальные hooks и эффекты. Reload info/button остаются только автору как в1.5.34; cancellation доступна автору/GM с правами, публикует отменённый исход в той же карточке. Новых custom sockets, journals, очередей, recovery/receipt framework нет. Проверяется обычный однократный статус cancelled текущего действия, не строится распределённая защита от конкурентных кликов.

Иконка активного клина — предупреждение вместо обычного прицела. Второй небольшой значок перезарядки показывается автору при пустом магазине. После отмены клина предупреждение убирается, reload badge остаётся, если патрон потрачен.

## Подтверждённая причина и интеграция

Foundry13.351/dnd5e5.2.5/MIDI13.0.61, testovyj3. CombatAttackService native postAttack расходует боеприпас и выставляет weapon jam, но игнорирует результат проверки для hit resolution. dnd5e.rollAttack — поздний notification hook; его return не отменяет MIDI попадание. MIDI preCheckHits/checkHits проходит без информации об осечке.

В реальной disposable native трассе dnd5e.preRollAttack config содержит workflow.id, а dnd5e.rollAttack context содержит только subject/ammoUpdate и Roll без parent. Поэтому pre-roll переносит только workflow ID в roll.options. Post-roll разрешает реальную chatCard по этому ID, пишет один статус и primitive per-shot misfire snapshot в её flags/roll.options/workflow. MIDI preCheckHits применяет miss; hitsChecked закрепляет пустые hit sets/display и не даёт module hit-benefits на клин. MIDI preDamageRoll и native damage config не дают урону пройти при активном snapshot. Не используется глобальный текущий jam оружия для старых нормальных атак.

Forced miss реализуется временными criticalFailure/criticalSuccess options конкретного D20 и его d20 term; исходные значения хранятся в snapshot и восстанавливаются при отмене. MIDI isFumble=true/isCritical=false согласуются с этим, поздние forced-hit sets очищаются. Roll total/dice results не меняются. Отмена восстанавливает options, перечитывает попадания штатным checkHits и продолжает с damage stage без повторного attack stage/roll. При уже брошенном damage используется исходный damage, без повторного применения. Обычно damage при клине ещё не бросается из-за preDamageRoll guard.

## Проверка

Regression RED→GREEN: jammed hit19 и nat20 =>miss/0 HP/no damage; ordinary1 остаётся miss после cancel; успешная проверка не трогает попадания; снятие только current jam, нет +threshold/extra ammo; cancel author/GM rights/repeat; author-only reload hint/badge; новые иконки и исход отмены; native parent отсутствует, но workflow ID ведёт к правильной карточке; hook registration и scoped damage block.

Live disposable actors/tokens/scene: настоящая native MidiAttackActivity, высокий бросок + jam =>red miss и targetHP unchanged; cancel =>тот же attack roll/количество и native damage; исходный miss послеcancel не должен внезапно hit. Сообщения/fixtures очищаются, production actor/HP не меняются. Версия/cache/паспорт/README, полные tests/syntax/JSON/diff, fresh review и own commit/push lich_branch.

## Граница сохранённого контекста

В текущем мире MIDI SaveToChatCard=false. Настройка сохраняется. Кнопка отмены работает, когда исходный workflow ещё доступен; при утраченном контексте disabled с пояснением. Пользователь явно подтвердил: текущей сессии достаточно; реализация ограничена существующим контекстом MIDI. Native guards/snapshots и иконки сохраняются в сообщении. Новых persistence/recovery систем ради обхода этой настройки не добавлено.

Снимок выстрела заменяет свой ChatMessage flag целиком через native deletion+set в одном update. Это необходимо из-за recursive merge Foundry: отсутствующие original critical options/override иначе сохранялись от предыдущего выстрела. Остальные flags сохраняются.
