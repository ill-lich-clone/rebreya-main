# Bugfixes 3, 4 and 9

User requests: dead NPCs must remain dead creatures across world restart and immediately open as corpse containers; dismantling identical materials must merge across the whole group warehouse (explicitly selected by user); notes must be addable to and readable from group inventory.

## Behavior and owners

3. storage-corpse-target/storage-object-kind own creature-vs-object classification. Confirmed dead or materialized-corpse NPC loot states must not turn that NPC into a chest; existing token-only storage objects without corpse evidence retain their classification. Explicit storage Actor markers and ground piles remain objects. Durability reconciliation removes only legacy object projection from eligible corpse NPCs, preserves loot/creature identity, and reacts immediately to storage updates as well as startup. Explicit dead status is authoritative even if old projection set18HP; unconscious/stable alone are not death. Preserve existing corpse materialization and opened loot, no new world journal/settings.

4. InventoryService owns material stack compatibility and destination receipts. Same material identity, logical unit weight and economic unit price merge globally despite folder or currency denomination representation. Preserve genuinely different unit price/weight and item instance restrictions. Keep an existing material stack in its current folder; route new unmatched material through existing rules. Append acquisition history and preserve material12-digit quantity projections. This intentionally changes the old per-folder material split policy; no unrelated Item-folder rules change and no bulk migration silently rewrites existing inventories.

9. Existing journal-record Items/viewer remain canonical. A storage note records into the caller's resolved group when present, with character fallback only without a group; exact target must be authorized for sender. Direct Journal/Page drops into an owned group are allowed only when the sender can read that source, preserving protected-document access. Existing group record opens in the current read-only viewer; no raw journal contents are copied into public Item data. Retain the existing privileged read adapter where source access requires GM. Group ownership/membership permissions and deduplication are preserved.

## Delivery and verification

Write focused regressions for classification/startup/live repair, global material merge including gp/sp/cp equivalence and nonmerge of distinct units, group note create/read/denied source or target and real UI/API routes. Preserve source contracts, formulas/budgets and native inventory routing. Execute inline with independent final review, full repository checks, passports/README, release1.5.19 and matching forwarder; commit/push lich_branch. Current baseline082fbc58 is clean and synchronized. Live Foundry verification requires an authenticated test-world session; otherwise disclose the limit.

Small repair design self-review: user clarified enemy token18HP and global folder consolidation; no product choice remains open. Existing services are extended, with no replacement inventory, new framework or duplicated permission owner.

Recovery boundary verified in review: objectDurability itself is produced by legitimate chest projection and cannot prove death. Automatic repair requires explicit dead/HP0 or complete corpse provenance; ambiguous old positive-HP tokens without independent evidence remain unchanged.
