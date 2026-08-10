# Agent Documentation Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Разделить постоянно загружаемые инструкции агента и подробный паспорт функций без потери существующей архитектурной информации.

**Architecture:** Корневой `AGENTS.md` становится компактной точкой входа с обязательными правилами и явной маршрутизацией. Полный паспорт подсистем хранится в `docs/function-passport.md` и читается только по соответствующему задаче разделу.

**Tech Stack:** Markdown, Git, PowerShell, ripgrep.

## Global Constraints

- Все изменения выполняются только в `lich_branch`.
- `AGENTS.md` должен содержать Git-процесс, быстрый вход, архитектурные слои, порядок реализации, проверки и правило перехода в паспорт.
- Конкретные функции, методы, владельцы данных, маршруты вызовов, точки расширения и профильные тесты должны находиться в `docs/function-passport.md`.
- Новые и изменённые методы должны документироваться в паспорте в том же commit, когда меняется архитектурный контракт.
- Полный паспорт не должен дублироваться в корневом документе.

---

### Task 1: Разделить корневые инструкции и паспорт функций

**Files:**
- Create: `AGENTS.md`
- Create: `docs/function-passport.md`
- Delete: `AGENT.md`
- Verify: `docs/superpowers/specs/2026-08-10-agent-documentation-split-design.md`

**Interfaces:**
- Consumes: существующие разделы `AGENT.md` и согласованную спецификацию разделения.
- Produces: стандартную корневую инструкцию `AGENTS.md` и адресуемый паспорт `docs/function-passport.md`.

- [x] **Step 1: Создать компактный `AGENTS.md`**

Перенести в него обязательный Git-процесс, быстрый вход, архитектурные слои, общий порядок реализации, проверки и список тяжёлых файлов, которые нельзя читать без необходимости.

Добавить явное правило:

```markdown
Если для задачи нужны конкретные функции, методы, владельцы данных, маршруты вызовов, точки расширения или профильные тесты, открой `docs/function-passport.md` и прочитай только относящийся к задаче раздел.
```

- [x] **Step 2: Создать `docs/function-passport.md`**

Перенести контракт актуальности, все двадцать паспортов подсистем и диагностическую карту. Заменить ссылки на старый `AGENT.md` ссылками на `AGENTS.md` или `docs/function-passport.md` по назначению.

- [x] **Step 3: Удалить старый `AGENT.md`**

Убедиться, что информация находится ровно в одном из двух новых документов и полный паспорт не остался в корне.

- [x] **Step 4: Проверить структуру и ссылки**

Run:

```powershell
rg -n "AGENT\.md" AGENTS.md docs/function-passport.md README.md scripts tests
rg -n "^### [0-9]+\." docs/function-passport.md
git diff --check
```

Expected: устаревших ссылок нет; паспорт содержит разделы 1–20; `git diff --check` завершается без ошибок.

- [x] **Step 5: Проверить объём постоянно загружаемого документа**

Run:

```powershell
Get-Content -Raw -Encoding UTF8 AGENTS.md | Measure-Object -Line -Word -Character
Get-Content -Raw -Encoding UTF8 docs/function-passport.md | Measure-Object -Line -Word -Character
```

Expected: `AGENTS.md` существенно меньше полного паспорта и остаётся достаточным для начала реализации.

- [x] **Step 6: Просмотреть и зафиксировать изменения**

Run:

```powershell
git diff --stat
git diff
git add -- AGENT.md AGENTS.md docs/function-passport.md docs/superpowers/plans/2026-08-10-agent-documentation-split.md
git diff --cached --check
git commit -m "docs: split agent instructions and function passport"
git push -u origin lich_branch
```

Expected: commit содержит только документацию этой задачи, push завершается без force.
