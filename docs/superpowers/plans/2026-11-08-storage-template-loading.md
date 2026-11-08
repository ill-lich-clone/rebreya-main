# Загрузка шаблона хранилища — план реализации

> **For agentic workers:** Use superpowers:executing-plans for this plan.

**Цель** — восстановить открытие окна хранилища через штатный загрузчик Foundry.

**Архитектура** — очистить путь в `StorageApp.PARTS.main.template`. Выпустить patch-версию через существующий composition root и отдельный JS cache key окна.

**Проверки** — Node test runner, Node syntax checker, PowerShell JSON parser и Git.

**Спецификация** — [Загрузка шаблона хранилища](../specs/2026-11-08-storage-template-loading-design.md).

## Ограничения

Правки и публикация идут через `lich_branch`. Совместимые ранее опубликованные forwarder-файлы сохраняются. Проверка проходит через терминал и файловую систему.

## Правка и проверка

- [x] Добавить в `tests/storage-app.test.mjs` тест фактического пути `StorageApp.PARTS.main.template`. Сравнить с каноническим путём, проверить `.hbs` через `path.extname` и прочитать файл по этому пути.
- [x] Запустить тест шаблона по имени. Убедиться, что он падает на расширении `.48`.
- [x] Убрать query из пути шаблона в `scripts/ui/storage-app.js`. Изменить ключ импорта `StorageApp` в `scripts/main.js` на `1.5.67`. Обновить существующую проверку ключа в `tests/module-manifest.test.mjs`.
- [x] Обновить manifest и тесты версии до `1.5.67`, добавить `scripts/main-1.5.67.js` с единственным импортом `./main.js`, обновить README и паспорт функций.
- [x] Запустить focused-тесты и просмотреть runtime-пути к шаблонам на query и fragment. Выполнить полный набор тестов, проверки JS, JSON и diff.

Новый тест до правки получил `.48` вместо `.hbs`. После правки профильные тесты прошли, поиск вернул ноль совпадений. Полный набор — 5778 passed, 0 failed, 2 skipped. Синтаксис проверен у 1304 JS/MJS и 65 JSON-файлов.

Коммит с правкой и этим планом публикуется в `origin/lich_branch`.
