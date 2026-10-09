# Исправление открытия листов с куклой

Наблюдаемое требование: штатные character/NPC sheets снова открываются; все функции куклы, пресетов, черт и других вкладок сохраняются.

Причина: Foundry server Files.loadTemplate использует path.extname непосредственно над socket path. `hero-doll-tab.hbs?v=...` отклоняется, поскольку расширение не hbs. Browser fetch URL cache rules неприменимы к этому контракту. Единственное deliberate изменение: HERO_DOLL_TEMPLATE становится каноническим filesystem path без query; клиентский sheet integration import и stylesheet/module version повышаются до 1.4.366. Сам шаблон не меняется. Существующий page-refresh lifecycle заново загружает шаблон через socket.

Владелец: dnd5e-sheet-extensions.js / ensureHeroDollTabDefinition. Regression test проверяет все module-owned PARTS template и templates путей обеих Sheet classes по настоящему server extension contract и читает файл с диска. Права, flags, количество, хват, бюджеты, формулы и пресеты не изменяются. Live проверку ранее пользователь оставил себе.
