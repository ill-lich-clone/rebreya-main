# План исправления «Смертельного»

1. В tests/combat-attack-service.test.mjs воспроизвести последовательность MIDI-QOL: GM вызывает dnd5e.preApplyDamage, пишет HP и вызывает dnd5e.applyDamage с карточкой, затем клиент игрока получает RollComplete. Проверить синтетический Actor, одну запись обнуления и одно сообщение. Проверить отказ при промахе, полном поглощении временными HP и чужом источнике. Запустить focused-тесты и увидеть регрессию.
2. В CombatAttackService и registerCombatHooks связать стадии применения через объект options, восстановить активность из карточки и использовать существующий расчёт порога. Проверить право на запись перед вызовом Actor.update и сохранить исходный fallback по явному UUID. Повторить focused-тесты.
3. Обновить паспорт, manifest, versioned imports и forwarder. Запустить полный Node test runner, проверки JS, JSON и diff. Проверить итоговый diff, сделать commit и push в lich_branch.
