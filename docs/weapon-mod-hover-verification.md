# Подписи обвесов, размер ячеек и замок — 1.4.391

Спецификация: [2026-10-16-weapon-mod-hover-design](superpowers/specs/2026-10-16-weapon-mod-hover-design.md). План: [2026-10-16-weapon-mod-hover](superpowers/plans/2026-10-16-weapon-mod-hover.md). Владелец: [панель МОДЫ](weapon-mods-function-passport.md#панель-моды).

В покое надписи крепления/Item скрыты. При hover либо keyboard focus-visible обе находятся над картинкой без заливки; соседние подписи скрыты. Убран native title, который давал бы второй фоновый tooltip. Пустая ячейка показывает＋. Размер22%→18.7% (−15%); aspect1 и центры сохранены. Золотая ортогональная связь сохраняет маршрут/середину, endpoints доходят до новых границ карточек. Один постоянный декоративный замок в середине path, отдельной блокировки/действия нет. Игровые мутации, формы, quantity, деньги, формулы и бонусы не менялись.

## Проверка native UI

Foundry13.351/dnd5e5.2.5, существующая авторизованная сессия CODEX. На реальной аркебузе:

- Три подписи изначально visibility:hidden; hover нижней показывает только её mount+name. Background caption: rgba(0,0,0,0), native title:null. Нижняя и верхняя подписи bottom < top карточки.
- Квадрат95.546875×95.546875px, изображение93.546875px внутри рамки, диаграмма513px. Прежний квадрат был112.4px.
- Tab переводит focus-visible на нижнюю ячейку и открывает её подпись; остальные скрыты.
- По SVG getPointAtLength(total/2) замок совпадает с серединой пути, count1.
- Временный шестислотовый native Actor отсутствовал в game.actors. На440/820px все квадраты и подписи внутри диаграммы. Для проверки длинных краевых имён изменён только временный DOM подписи side/barrel; текст остался выше карточек и внутри горизонтальных границ, при actual hover visible/transparent. Временное окно закрыто; игровые Documents не сохранялись.
- Консоль: ошибок0. Проверенный настоящий лист оставлен открытым. Снимок вне Git: `C:/Users/ill_lich/.codex/visualizations/2026/10/16/01a143f6-c29f-7890-9695-27a2582c0497/weapon-mod-hover.jpg`.

Работающий сервер сохраняет прежнюю metadata manifest до штатного обновления; фактически загруженные JS/CSS имеют новую release cohort/stylesheet391. Активный сервер не перезапускался.

## Review и проверки

Gemini3.8FlashHigh через подписку Antigravity проверил первоначальный CSS подход; приняты рекомендации overflow:visible и hover z-index. Предложение переворачивать верхнюю подпись вниз отклонено как противоречащее «НАД картинкой». Повторный CLI final review не вернул usable SUCCESS response; выполнен отдельный свежий read-only review Codex. Найден риск обрезки длинных краевых подписей и устаревший паспорт. Один проход исправлений: side captions left0, barrel right0, RED→GREEN и native narrow QA; паспорт обновлён.

- Initial RED: geometry + absent caption. GREEN panel/branding21/21.
- Edge clipping regression RED→GREEN21/21. Release focused70/70.
- `node --test tests/*.test.mjs`:4778 total,4777 passed,0 failed,1 skipped. Прежний skipped test требует недоступную в Node Foundry Handlebars dependency.
- `node --check` всех tracked JS/MJS плюс новый forwarder:1005 checked,0 failed.
- PowerShell ConvertFrom-Json всех tracked JSON:58 checked,0 failed.
- `git diff --check`:exit0; stat и содержательный diff проверены. Release1.4.391: четыре затронутых ESM owner, один canonical URL каждого; исторические forwarders и cache keys незатронутых owners сохранены.
