# Native NEXT for individual turns

If all groups are singletons, the start-combat macro starts or extends a normal Foundry encounter. It still selects eligible tokens, rolls missing initiative, and preserves the current round, turn and old scores when extending a started encounter. It does not require grouped-effect provider compatibility. The original NEXT, Previous, round moves and turn hooks own this encounter. Group camera/title presentation belongs to genuinely grouped encounters.

Previously saved singleton-only grouped encounters switch to native mode on active GM reconciliation (or on rerunning the start macro). Retain the flag and old receipt history as inactive data and retain the tie order to keep the acting token and turn-index-based durations stable. No phase is replayed on mode switch. A blocked or interrupted transition uses existing recovery first. Encounters with saved shared groups remain managed, including when members are removed during a fight, to preserve effect anchors and completion history. A newly formed shared group can enable the existing pending-round conversion in an individual encounter.

Changing only the NEXT wrapper would still leave effect providers suppressed and direct/round navigation intercepted. Avoid the grouped pipeline at start and change the persisted lifecycle owner for legacy singleton-only encounters. Shared turns still use the existing order, effects, provider validation and journal.

Verify the native start, legacy conversion without a turn change, native NEXT delegation and existing shared-effect workflows with focused tests. In live Foundry compare an isolated encounter against the pre-release behavior when available. Report actual frame timing and authority limits.
