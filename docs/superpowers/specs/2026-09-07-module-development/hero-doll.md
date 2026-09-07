# Кукла героя: отдельные экземпляры и стабильные ячейки

Общие ограничения: [основная спецификация](../2026-09-07-module-development-design.md). Запросы 8.1–8.4. Этапы R1 (UI) и R3 (экземпляры).

## Владельцы и факты

scripts/data/hero-doll-service.js — HeroDollService; scripts/integrations/dnd5e-sheet-extensions.js — sheet context/bindings; templates/hero-doll-tab.hbs; styles/main.css. Паспорт: раздел 18 для sheet integration и 16 для held-items; при реализации добавить точное описание HeroDollService в профильный раздел.

getActorSnapshot() проецирует slots с {itemId}; #getInventoryItems() убирает из доступного списка весь занятый Item ID. #resolveDropItem() возвращает тот же документ при drop внутри Actor; #moveItemToActor() уже отделяет одну единицу при переносе из другого Actor. assignItemToSlot() переносит одну ID-ссылку между слотами, но не делит owned stack. Это объясняет отсутствие отдельного второго экземпляра у стопки амулетов; одинаковые названия сами по себе не являются причиной.

HBS печатает itemName/itemMeta внутри слота и native title; размер связан с содержимым. UI исправляется отдельно от мутаций экземпляров.

## R1: внешний вид

- Все ячейки имеют одинаковый фиксированный размер в одном layout mode, независимо от имени/метаданных/пустоты. Предлагаемая база — 80×80 CSS px; сетка адаптируется числом колонок, не растягиванием конкретной ячейки.

- В занятом слоте только изображение и необходимые маленькие маркеры состояния. Название предмета и количество не печатаются внутри ячейки; подпись анатомического слота может оставаться вне её фиксированного квадрата.

- Имя/метаданные показываются собственным tooltip при hover и keyboard focus. Native title на том же target убирается, aria-label содержит имя.

- Tooltip использует общий presentation helper R1: viewport clamp, top-layer, Escape, cleanup. Длинное имя переносится внутри tooltip, не в сетке.

- Полный список инвентаря справа сохраняет имена: требование скрыть имя относится к ячейкам куклы, а не всем интерфейсам.

- Явные состояния empty/occupied/drag-valid/drag-invalid/focus; выделение текста не мешает drag. Не отключать user-select глобально. Scoped стили не изменяют штатные dnd5e buttons/slots в других вкладках.

- Назначение/очистка/открытие Item работают прежними действиями. После rerender один listener на действие, без двойного equip.

Focused: tests/hero-doll-service.test.mjs и tests/dnd5e-sheet-downtime-tab.test.mjs (существующий файл с sheet coverage); добавить независимый tests/hero-doll-ui.test.mjs для контекста и lifecycle при необходимости.
Live: два одноимённых амулета, имя 120 символов, empty/full, узкий лист, масштаб 125%, светлая/тёмная тема, hover/focus, invalid drag. Размеры сравнить getBoundingClientRect(), разница ячеек <=1 CSS px.

## R3: идентичность экземпляра

Наблюдаемый результат: экипировка одной единицы из стопки двух амулетов создаёт самостоятельный Item quantity=1; второй остаётся доступен. Два уже разных Item ID всегда остаются разными даже с одинаковым названием/источником.

Предлагаемое решение: использовать реальные embedded Item экземпляры, сохранив slots {itemId}. Не вводить виртуальную индексацию quantity внутри Item — независимым charges, upgrade links и effects нужна Document identity.

При назначении:
1. Проверить Actor ownership, допустимость слота, свежий source, руки/резервации до mutation.
2. Для ordinary stack Q>1 выделить 1 через общий application transfer/instance helper на базе существующей inventory transaction инфраструктуры. Остаток Q-1 не экипирован.
3. Для Q=1 сохранить ID. Перенос уже экипированного экземпляра между слотами не создаёт копию.
4. После target receipt обновить slot и equipped согласованно; предыдущий экземпляр снимается только если больше нигде не используется.
5. Снятие возвращает отдельный Item в список; автоматического слияния по имени нет.
6. Drop из группы проходит тот же authoritative transfer flow; не сохранять приватный незащищённый обход source debit ради удобства куклы.

У многорукого/двуручного предмета одна физическая вещь может занимать несколько рук по существующему held-items контракту; это не два экземпляра. Не вводить новые слоты амулетов и не ослаблять ограничения слотов: отдельный второй амулет может оставаться в инвентаре, если одновременно носить его негде.

Предметы с установленными upgrades/contents/личным runtime state не делятся слепым clone. Existing quantity>1 с такими данными — нужна сверка и предупреждение владельцу; автоматическая миграция при render запрещена. Обычный legacy occupied stack можно нормализовать явным действием пользователя с сохранением original ID за экипированной единицей.

Изменяемые методы: assignItemToSlot(), #resolveDropItem(), #moveItemToActor(), #saveState(), #getInventoryItems(). #saveState() сейчас делает unsetFlag→setFlag: в рамках согласованной мутации заменить на один поддерживаемый replacement update по образцу существующего inventoryFolders owner, проверив удаление старого slot и rollback.

Инварианты: quantity сохраняется; foreign Item/Actor не меняется без прав; installed upgrades и held hands ссылаются на правильные IDs; CurseUpgradeAutomationService и CurseEater считают каждый host один раз. Рендеры и повтор sync не создают Item или эффекты.

Focused: hero-doll-service, held-items, item-upgrade-service, inventory-simple-transfer, inventory-mutation-recovery, curse-eater-automation-service, curse-upgrade-lifecycle.
Новый regression coverage: owned Q=2 → 1+1; already distinct IDs; повтор operation ID; запрещённый слот до create; отказ Actor flag write; перенос из группы; снятие без merge; two-hand representation; сложный стек не дублирует upgrades. Критерий готовности — сохранность всех экземпляров после reload и инъекции сбоя, а не только две иконки.
