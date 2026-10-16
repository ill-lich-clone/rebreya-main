# Тултипы, ПКМ, UUID ссылки и снятие — 1.4.392

Спецификация: [2026-10-16-weapon-mod-interactions-design](superpowers/specs/2026-10-16-weapon-mod-interactions-design.md). План: [2026-10-16-weapon-mod-interactions](superpowers/plans/2026-10-16-weapon-mod-interactions.md). Владельцы: [оружейная UI](weapon-mods-function-passport.md), [ItemInstanceDocuments](item-instance-passport.md), [AnchoredOverlay](function-passport.md).

## Причина ошибки игрока

Перед снятием ItemInstanceDocuments превращал `system.container:null` в `system.-=container:null`. Установленный dnd5e5.2.5 определяет container как required, но nullable ForeignDocumentField. Native dry-run отклоняет undefined и отбрасывает весь child update, включая удаление installedWeaponMod. Строгая verifyCommitted правильно обнаруживала оба прежних поля и запускала компенсацию. Ослабление CAS/ack проблему скрывало бы.

На actual native Item из сообщения выполнены только операции над клонами в памяти. Старый patch воспроизвёл `container: may not be undefined`; прямой null прошёл native updateSource. Новый реальный ItemInstanceDocuments.writePlacement и verifyCommitted на такой native копии подтвердили container:null, reverseCleared:true, quantity1, originalUnchanged:true. Native persisted Item/кошелёк/патроны не изменялись.

Минимальный adapter fix сохраняет прямой null только у system.container, остальные flag deletion/object replacement/CAS/compensation остаются прежними. RED schema-aware fixture отбрасывала весь неправильный update и получила ровно сообщение игрока: «Переключение отменено… Не подтверждена запись… system.container, flags.rebreya-main.installedWeaponMod». После fix успешно снимается одна реальная owned единица, parent/reverse очищены, quantity сохранена. Owner tests83/83, включая failures/recovery/перенос/пересборку.

## UI и ссылки

- Настоящий tooltip использует общий с куклой bindAnchoredTooltips, body portal и role=tooltip. Native hover: «Низ 1: Тактическая рукоятка (установлена)», расположен выше ячейки, background rgba(0,0,0,0); скрывается штатными событиями/abort. Shared default auto placement не изменён.
- ПКМ реального установленного обвеса вызывает существующий openHeldItemContextMenu: строки «Открыть предмет» и «Снять · действие», select отсутствует. Callback снимает через прежнюю typed active-GM команду. Legacy ordinary reverse требует reciprocal связи с этим host и направляется в прежний removeItemUpgrade. Чужая связь не снимается.
- Каталог300×263px находится в AnchoredOverlay вне native листа: разделы owned/missing, два совместимых прицела, оба отсутствующие disabled. Высота листа не меняется. Проверены outside/Escape/close/rebind и передача событий из portal; чтение Item закрывает каталог.
- У native UUID ссылок `href === null`. Щелчок открыл настоящий «Оптический прицел» из world.rebreya-gear; doc.sheet.rendered:true, текущий URL не изменился, список браузерных вкладок до/после остался5/6. Существующая вкладка6 game# открылась ещё до исправления и не является результатом нового щелчка. Keyboard Enter/Space поддержан.
- Размер18.7%, золотая связь и замок сохранены. Нет ручных исправлений или удаления игровых Items ради проверки.

Native baseline: Foundry13.351/dnd5e5.2.5/MIDI13.0.61, CODEX GM. Снятие с действующего персонажа не выполнялось; подтверждены native schema/adapter на копии, полноценный canonical mutation flow и UI callbacks в focused tests. Игровую операцию выполняет активный GM: для применения392 требуется обновить страницы ведущего и игрока. Активный сервер не перезапускался; его metadata manifest остаётся кэшированной до штатного refresh, actual JS/CSS392 загружены.

Снимки вне Git: `C:/Users/ill_lich/.codex/visualizations/2026/10/16/01a143f6-c29f-7890-9695-27a2582c0497/weapon-mod-context-392.jpg`, `weapon-mod-catalog-392.jpg`.

## Проверки выпуска

UI RED4→GREEN35; portal-reference-close RED→GREEN34; release focused80/80. Независимый свежий review всего diff: Critical0/Important0/Minor0; reviewer самостоятельно выполнил focused50/50. Первичная Gemini CLI discovery не вернула usable SUCCESS; source/native диагноз проверен локально и независимо.

- `node --test tests/*.test.mjs`:4782 total,4781 passed,0 failed,1 skipped (прежний rendered ghost test без Node Foundry Handlebars dependency).
- `node --check`:1006 tracked/new JS/MJS,0 failed. PowerShell ConvertFrom-Json:58 JSON,0 failed.
- `git diff --check`:exit0; stat и содержательный diff проверены.
- Release1.4.392, versioned forwarder импортирует только main.js, stylesheet epoch392. Shared adapter/overlay потребовали cache cohort25 owners; отдельная проверка подтвердила45 canonical imports и cache-only изменения остальных owners. Незатронутые keys и исторические forwarders сохранены. Tests проверяют согласованность URL, а не снимают cache guarantees. Native UI console errors0.
