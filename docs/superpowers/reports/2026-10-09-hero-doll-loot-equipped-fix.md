# Hero doll loot equipped fix — 1.4.369

Spec: ../specs/2026-10-09-hero-doll-loot-equipped-fix.md
Plan: ../plans/2026-10-09-hero-doll-loot-equipped-fix.md

Confirmed cause: reported Item is signet ring, classified as loot. Installed dnd5e LootData has no equipped field. Scoped read-only local operation journal shows before null / after true. Unsupported write triggers verification failure and compensation with extra document updates/renders. World data was not modified during diagnosis.

HeroDollService generates empty equipped patches for Items without a current boolean equipped field and matching empty before receipts. Item existence verification remains intact. Both legacy normalization paths omit unsupported equipped from remainder data, retaining canonical held/grip cleanup, quantity conservation, rollback and existing equipped hooks. No Item type migration, settings/formulas/budget changes or verification weakening. Release/service cache updated; unchanged workflow/driver retain 1.4.368-hero-performance.

Four regressions failed against previous behavior. Focused owner checks: 73 passed / 0 failed. Fixture emulates dnd5e dropping unsupported fields. Covers loot Apply/clear/reassign, legacy remainder, rollback conservation and manual normalization submitted data. Initial full run: 4459 passed / 3 failed, solely stale style-version assertions and new forwarder CRLF. Corrected release checks: 50 passed / 0 failed.

Final node --test tests/*.test.mjs with actual Handlebars NODE_PATH: 4462 passed / 0 failed / 0 skipped. Syntax checks of all tracked JS/MJS plus new forwarder: 939 files, 0 errors. JSON parse: 55 files, 0 errors. git diff --check passed. Affected release-test and forwarder syntax checks repeated after correction.

Fresh read-only Astra review: no critical or important findings. Minor suggested direct Item deletion during placement regression; unchanged driver existence checks verified by inspection. No runtime correction required. Live latency/UI timing remains unmeasured; user waived live world verification. Gemini supplied a scoped schema-compatible patch/test checklist, verified against installed system source; proposed batching was not used.

Delivered on lich_branch with release 1.4.369. Specification, plan and function passports updated with implementation.
