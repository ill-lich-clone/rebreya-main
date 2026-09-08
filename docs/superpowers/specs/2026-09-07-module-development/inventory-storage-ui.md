# Папки, частичный перенос и окна хранилища

Общие ограничения: [основная спецификация](../2026-09-07-module-development-design.md). Запросы 5 и 7.1–7.4. Этапы R0–R3 независимы по результату.

## Подтверждённые владельцы и исходное поведение до R0

- UI: scripts/ui/inventory-app.js, scripts/ui/storage-app.js; templates/storage-app.hbs; styles/main.css.

- Folder state: scripts/data/inventory-folder-tree.js и InventoryService в scripts/data/inventory-service.js. Actor flag inventoryFolders v1, максимальная глубина 5, имя до 80 символов.

- Паспорт: разделы 7, 8, 19. Typed ingress и refresh сохраняются.

- promptInventoryFolderName() вызывает DialogV2.wait; callback отмены возвращает null. Локальный Foundry client/applications/api/dialog.mjs:242 использует nullish fallback на button.action, поэтому результатом становится строка cancel.

- #resolveInventoryDropTarget() отдаёт folderId:null любой .rm-inventory-tree-row--item[data-item-id]. Текущие тесты/паспорт фиксируют это как контракт.

- moveInventoryItemToFolder({groupActorId,itemId,folderId}) меняет membership целого Item, не количество.

- StorageApp строит anchorRow/anchorColumn по индексу; CSS вычисляет top через шаг 80px, popover остаётся absolute внутри окна. Это подтверждённый способ размещения; конкретные визуальные дефекты нужно воспроизвести live.

- InventoryApp.#openContextMenu() уже использует body portal, viewport clamping и пересчёт слоя. Использовать проверенный подход, не менять целиком систему окон.

## R0: отмена и цель drag-and-drop

Наблюдаемый результат: Отмена/крестик/Escape ничего не создают; drop на Item в папке сохраняет предмет в этой папке.

Контракт результата диалога (реализован в R0, 1.4.246): confirm callback возвращает {confirmed:true,name}; cancel возвращает {confirmed:false}; закрытие нормализуется в отмену. Только confirmed:true допускает name validation и mutation. Введённое и подтверждённое пользователем имя «cancel» остаётся допустимым: нельзя лечить баг запретом такой строки.

Цель определяется заново при drop из текущего inventory snapshot, а не только из dragover cache:

- строка Item → membership именно этого Item;

- строка папки → её ID;

- корневая поверхность основного окна → null;

- пустая поверхность folder popout → rootFolderId этого окна;

- Item в корне → null; Item в глубокой/свёрнутой/отфильтрованной папке → его настоящая папка;

- некорректная/исчезнувшая цель → отмена с обновлением, без тихого переноса в корень.

Self/descendant/cross-group запреты папок сохраняются. Продолжительность hover не меняет destination. Подсветка и итог используют одного resolver; highlight остаётся у точной строки. Старые утверждения «любой Item → корень» заменить, а не оставить конфликтующими.

Изменяемые методы: promptInventoryFolderName(), #createInventoryFolder(), #renameInventoryFolder(), #resolveInventoryDropTarget(); templates дерева только при необходимости передать stable identity, без доверия UI membership.

Focused: tests/inventory-app-context.test.mjs; tests/inventory-folder-tree.test.mjs; tests/inventory-folder-socket.test.mjs.

Приёмка:
1. Cancel в настоящем DialogV2, Escape и крестик: ноль API calls и записей.
2. Имя cancel после Confirm создаёт одну папку; пустое/81 символ — ошибка, не write.
3. Drop root→folder Item, folder→folder Item, folder→root Item и popout background дают ожидаемый membership.
4. Hover 2 секунды, drag leave, rerender и drop после удаления цели не оставляют stale highlight.
5. Диалоговый test double воспроизводит nullish fallback Foundry, иначе регрессия останется незамеченной.

## R1: всплывающие окна хранилища

Наблюдаемый результат: содержимое и все действия дополнительного окна доступны даже у нижней строки высокого хранилища.

Реализован в R1 (1.4.247) presentation-only helper scripts/ui/anchored-overlay.js: измеряет anchor.getBoundingClientRect(), сначала ставит окно снизу, при нехватке места переворачивает вверх, затем ограничивает позицию viewport с отступом 8 CSS px. Высота не превышает доступный viewport; прокрутка находится внутри popover. Он не знает Item/Actor/state.

StorageApp остаётся владельцем выбранной строки и действий. Один portal на приложение, слой выше текущего окна; DOM anchor после rerender ищется по stable row ID. Scroll любого предка, resize, перемещение/изменение размеров ApplicationV2 обновляют положение. Закрытие приложения/удаление anchor удаляют portal, observers, listeners. Escape закрывает popover и возвращает фокус. Tooltip не открывает второе конкурирующее меню.

Область QA: popover предмета, tooltip, меню строки, диалог количества; не только положение окна по умолчанию. Вложенные хранилища проверяются тем же путём.

Focused: tests/storage-app.test.mjs; tests/inventory-app-context.test.mjs при переиспользовании helper. Новый tests/anchored-overlay.test.mjs нужен для геометрии flip/clamp и cleanup, не для копирования CSS.

Live: 1280×720 и 1920×1080, масштаб 100%/125%, длинный русский текст, верх/низ viewport, прокрутка 30+ строк, открытый Item sheet поверх, смена z-order, reopen ×3. Bounding box остаётся в viewport; каждая кнопка доступна мышью и клавиатурой; отсутствуют orphan portals и новые ошибки.

## R2: цветные папки

Наблюдаемый результат: мастер/уполномоченный участник задаёт цвет папки; все окна группы видят его после reload.

Добавить optional color:null|#RRGGBB в существующую запись folder; null означает тему по умолчанию. Нормализация старых v1 данных добавляет только проекцию null, не массовый write. При совместимом добавлении поля версия схемы остаётся v1. Невалидный persisted цвет проецируется как null, не исполняется как CSS.

Новое действие «Цвет папки» в прежнем menu: палитра + hex + «Сбросить». Окрашиваются иконка/узкий акцент, текст сохраняет читаемость. Дочерние папки не наследуют цвет неявно. Переименование/перенос/popout/search не сбрасывают цвет.

Проектируемый additive API setInventoryFolderColor({groupActorId,folderId,color}), exact typed command inventory.folder.set-color с прежней group-management матрицей. Pure reducer рядом с create/rename/move. Сервис fresh-read изменяет только color выбранной папки, сохраняя конкурирующие membership/rules.

Focused: inventory-folder-tree, inventory-folder-socket, inventory-app-context. Проверить старые flags, default/reset, invalid color/CSS injection, две группы, player denial, concurrent rename и recolor.

## R3: перенос количества внутри папок

Наблюдаемый результат: из стопки 10 можно переместить 3, оставив 7 в исходной папке.

Предложение UX: обычный drag переносит весь стек как сейчас; Shift+drop или «Перенести часть…» открывает quantity dialog. Любой внешний путь со штатным quantity dialog сохраняет его, не спрашивает второй раз. Диалог показывает источник, цель, максимум; отмена — no-op.

Расширение существующего public метода совместимо:
moveInventoryItemToFolder({groupActorId,itemId,folderId=null,quantity?,operationId?}).
Отсутствующий quantity — прежний whole-stack path. Внешний маршрут для частичного переноса обязан получить стабильный operationId. Transport конвертирует старые callers без ломки API.

Количество: конечное, >0 и <= fresh available. Обычные штучные вещи — целое; для уже поддерживаемых дробных ресурсов использовать существующую точность нормализатора, не округлять их незаметно до 1. Перенос внутри той же папки — no-op.

Для 0<q<Q: existing inventory transaction owner создаёт один новый Item с q, уменьшает source до Q-q и записывает membership нового ID. Автослияния с одноимённым Item на первом этапе нет. q=Q сохраняет исходный ID и меняет только membership. Суммарные quantity, currency, durability, description и индивидуальные flags не меняются.

Не делить контейнер с contents, host с установленными усовершенствованиями, held/equipped instance и предмет с независимыми charges/effects как обычный стек. Для них whole-instance path либо явная ошибка; не клонировать дочерние связи или личный runtime state. Общее выделение экземпляра для куклы — отдельный контракт R3 в hero-doll.md.

Fresh validation, mutation ID, target receipt и recovery принадлежат InventoryService/coordinator, не reducer/UI. После сбоя создание/списание/папка должны восстановиться до исходного или ровно одного завершённого переноса. Reconnect и retry не создают вторую стопку; ambiguous outcome блокирует слепой повтор.

Focused: tests/inventory-simple-transfer.test.mjs, tests/inventory-mutation-recovery.test.mjs, tests/inventory-folder-socket.test.mjs, tests/inventory-app-context.test.mjs; новый tests/inventory-folder-quantity-transfer.test.mjs.
Сценарии: 10→3+7; q=Q; q=0/Q+1/NaN; cancel; source стал 2 пока открыт диалог; повтор ID; сбой после create/debit/membership; две одновременные выдачи; upgraded/container rejection; старый whole-stack без Item writes.
