# Кукла всегда в две колонки

Пользователь явно требует две колонки при любой ширине. Слева остаётся кукла, справа инвентарь; перенос инвентаря вниз запрещён на всех viewport/container breakpoints. При ширине меньше минимальной суммы колонок появляется горизонтальная прокрутка вкладки. Кукла сохраняет анатомию, 68px слоты и восемь рядов; минимальная ширина левой панели420px, правой220px, gap14px (654px всего). Обычная левая панель не шире460px; остаток получает инвентарь. Данные, права, presets, ghosts, quantity/heldHands и прочие листы не меняются.

Владелец: scoped styles/main.css, .rm-hero-doll-tab и __layout. Существующие sheet hook/template/service не меняются. Required behavior pinned by layout regression; browser computed layout проверяется на ширинах400/650/744/1000/1400px. Release1.4.367 обновляет module/forwarder/stylesheet cache; остальные import cache keys сохраняются.
