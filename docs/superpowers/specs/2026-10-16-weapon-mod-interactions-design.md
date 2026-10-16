# Исправления тултипов, меню и снятия обвесов

Прямые исправления пользователя к утверждённой реализации1.4.391. Исполнение Native продолжается; новая подсистема не создаётся.

Наблюдаемый результат:
- Наведение/фокус открывает настоящий body-portal tooltip через тот же `bindAnchoredTooltips`, что кукла героя. Текст — название ячейки и Item/«Пусто», только plain text. Сохраняются прежние требования: над изображением, без фоновой плашки; маленькие квадратные ячейки18.7% и замок остаются.
- ПКМ по занятому слоту открывает обычный `.rm-context-menu` со строками действий и иконками, через существующий owner куклы/инвентарных контролов. Нет select/dialog подтверждения выбора действия. Open/remove/native actions вызывают прежние APIs.
- Выбор обвеса всплывает у слота через существующий AnchoredOverlay, закрывается снаружи/Escape/закрытием листа; не раздвигает лист встроенным каталогом. Совместимый полный каталог, owned-first, серые отсутствующие, два раздела, реальные источники и ограничения установки сохраняются.
- Ссылка на Item содержит только native UUID data-link; HTTP href отсутствует, веб-навигации и открытия localhost вкладки нет. Keyboard activation сохранена.
- Реальный weapon attachment снимается одним пунктом меню, очищая parent/reverse/container. Legacy ordinary installedUpgrade снимается только через прежний removeItemUpgrade при подтверждённой связи с этим host. Неизвестная связь не исправляется догадкой.
- Ошибка игрока воспроизведена на native клоне: удаление required nullable `system.container` вызывает validation error; прямой null допустим. В ItemInstanceDocuments null этого поля пишется прямо; flag deletion/другие контракты, CAS, ack, compensation, authorization, retries, quantity, деньги и формулы сохраняются.

Владельцы: weapon-mod-panel/UI binding, existing dnd5e openHeldItemContextMenu через injection, shared anchored-overlay, ItemInstanceDocuments.writePlacement/#update. Проверки: RED→GREEN native-like schema fixture и remove/compensation; overlay positioning/cleanup, native UUID без href, context callbacks/legacy routing. Native проверка меню/тултипа/переходов плюс реальный schema-aware Item clone для writePlacement/verifyCommitted без сохранения игровых предметов. Не запускать снятие с действующего персонажа ради теста.

Release1.4.392: cache cohort и stylesheet/entrypoint синхронны. Полная проверка runtime, паспорт, независимый review и scoped commit/push lich_branch.
