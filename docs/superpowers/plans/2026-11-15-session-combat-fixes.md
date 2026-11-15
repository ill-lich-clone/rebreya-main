# Session Combat Fixes Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for the linked reaction work and review the exact diff for each owner before committing.

**Goal:** Implement the approved combat and interface fixes through their existing owners.

**Architecture:** Preserve Foundry and system hooks and authorization boundaries. Keep lexical MIDI changes in a versioned, offline-tested patch. Keep data-driven effects and round changes in the existing implementations.

**Tech Stack:** Foundry VTT 14, dnd5e 6.0.6, Midi-QOL 14.6.8, ES modules, Node tests.

**Spec:** `docs/superpowers/specs/2026-11-15-session-combat-fixes-design.md`.

- [x] Reproduce reaction deadlines and filtering. Check per-activity ownership, network acknowledgement, expiry after application, durable reservations, chat outcomes and Shield variants.
- [x] Pin and implement the Midi-QOL patch. Rejected reaction RPCs resolve the outer wait. Save failures are isolated per target, with no automatic repeat after uncertain dispatch. Source and tests are derived from the installed version without writing it.
- [x] Trace and verify native and Rebreya resource resets. Fix Fighter confirmation ordering, and check Rune Knight providers against the revised reaction contract.
- [x] Repair Holy Weapon, Bless and Treat Wounds expiry. Verify the already-wired Performer roll path with its existing tests.
- [x] Verify door permissions and lock state transitions. Add pack banners and adjust heroic roll and ammunition controls.
- [x] Add the finish-turn macro through the existing macro owner and conditional turn transition. Check stale actions, no duplicates and permissions.
- [x] Bump module version, update owned imports and function passports, and run focused and full offline checks and review.

Review Focus includes the vendor disconnect path, lost acknowledgements without replay, one result for each reaction prompt, shared resource changes, and keeping effects and user permissions stable. Live-world validation and multiplayer measurement are excluded by request.

## Подтверждение перехода для макроса

- В `tests/grouped-combat-commands.test.mjs` воспроизвести отменённый `nextTurn`, пока другой GM продвинул трекер, и подтверждение на границе раунда.
- В `scripts/integrations/grouped-combat-runtime.js` привязать объявление к фактическому `updateCombat` с отметкой запроса макроса. В групповом пути принять только результат перехода, который запустил сам макрос. В обоих путях получить имена при подтверждении.
- Обновить паспорт, версию модуля и затронутые ключи кэша. Прогнать профильные и общие офлайн-проверки перед записью изменений.
- Сверить SHA-256 установленного файла Midi-QOL с manifest патча, применить отдельное изменение файла и проверить конечный хеш, синтаксис и профильные тесты. Повторная загрузка клиента проверяется отдельно.
