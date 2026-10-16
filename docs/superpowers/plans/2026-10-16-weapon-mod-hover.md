# Weapon Mod Hover Captions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Показать подписи слотов только при наведении над изображением без фона.
**Architecture:** Существующие HTML/CSS owners, одна общая caption на карточку; native aria/actions сохраняются.
**Tech Stack:** Foundry13/dnd5e5.2.5, ESM/CSS, Node tests.
**Spec:** `docs/superpowers/specs/2026-10-16-weapon-mod-hover-design.md` — прямое уточнение пользователя уже утверждённого дизайна.

## Global Constraints

- lich_branch; не изменять игровые данные и механику. Hover и keyboard focus-visible дают одинаковую подпись.
- Caption выше изображения, без заливки/рамки/native title; квадрат и полный размер изображения сохраняются.
- Version1.4.391, entrypoint/stylesheet/cohort синхронны, прежние forwarders сохраняются.
- Размер18.7% вместо22% (−15%); прежние центры. Half-size93.5 normalized вместо110; golden route midpoint сохраняется, один lock в его середине.

## Review Focus

- Верхний слот: подпись не обрезается рамкой — native DOM/screenshot.
- Два слота одного child: обе картинки остаются полными, linked marker только в подписи — markup regression.
- Пустой слот:＋остаётся, название скрыто до hover — regression/native.
- Клавиатура: focus-visible открывает подпись без мыши — native computed styles.
- Native title не создаёт фонового tooltip; соседние подписи не появляются — markup/native.

### Task 1: Подписи и выпуск

**Files:** `scripts/integrations/weapon-mod-panel.js`, `styles/main.css`, `tests/weapon-mod-panel.test.mjs`; паспорт/README; release manifest/forwarder/importers/assertions.
**Interfaces:** `createWeaponModPanelHtml` сохраняет сигнатуру и actions; выводит `.rm-wm__caption` с mount/name/linked marker, aria-label на button; CSS hidden → hover/focus-visible, bottom100%+gap, transparent.

- [x] RED: filled/empty markup имеет caption, нет title/persistent caption children; CSS contract скрывает и поднимает текст, background transparent, mount overflow visible, hover/focus-visible включает видимость. Геометрия18.7%, endpoints93.5; один lock в середине multi-mount связи.
- [x] Минимальные HTML/CSS изменения; GREEN `node --test tests/weapon-mod-panel.test.mjs tests/item-sheet-branding.test.mjs`.
- [x] Native hover/rest/focus проверки и снимки; независимое read-only review; паспорт/README и краткий отчёт с evidence.
- [x] Release1.4.391; полные тесты, JS/MJS syntax, JSON parse, diff check/stat/review; scoped commit/push lich_branch, clean0 0.
