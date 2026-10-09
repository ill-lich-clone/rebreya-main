# Пресеты куклы и предметы без equipped

Runtime cause confirmed: target Item4FJI1F1UxBP5P8Hz is signet ring in ring1 metadata. Current catalog classifies this ring as loot. Installed dnd5e LootData has no EquippableItemTemplate/equipped schema. Relevant durable placement in user's local world journal has before system.equipped:null and after:true; verification rejects the unsupported field. Reads were scoped to this Item ID, no world mutation performed.

Observable result: supported loot can occupy compatible doll slots, switch presets, clear slots and normalize ordinary legacy quantity without writing a nonexistent equipped field. Actual equippable Items retain previous equipped/heldHands behavior. Non-equippable Item existence remains verified using an empty field receipt. No Item type conversion, no weakened post-write verification, no bypass of broken armor/hooks. Legacy remainders omit unsupported equipped but retain heldHands cleanup and all quantity/receipt/rollback contracts.

This eliminates the confirmed cancel/compensation path and its repeated restoration renders. Do not claim measured live latency improvement without user world QA. Preset placement/quantity/permissions/explicit save/ghost/settings/formulas/budgets remain unchanged.

Owner: HeroDollService buildHeroDollEquippedUpdate / new buildHeroDollRemainderUpdate and assignment/preset normalizer data preparation. Regression fixture emulates dnd5e ignoring unsupported loot equipped writes; tests apply/clear and legacy split/rollback. Release1.4.369; service cache changes only, unchanged workflow/driver cache retained. Full checks and fresh review required.
