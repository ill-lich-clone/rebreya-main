# Оружейные обвесы и модернизированные части

Входной индекс: [паспорт функций](function-passport.md), раздел 14. Правила: [утверждённая спецификация](superpowers/specs/2026-10-16-weapon-attachments-design.md).

## Каталог и носители

Владелец: `scripts/data/weapon-mod-catalog.js`; источники: `data/gear.json`, `data/weapon-mod-rules.json`, `data/weapon-mod-hosts.json`.

- `buildWeaponModCatalog(gear,definitions,hosts) -> {rows,hosts}` проверяет уникальные stable IDs, source joins, типы правил и известные compatibility tags; future source без правила сохраняется видимым unavailable. Возвращает detached профили с исходным attachment signature; source данные не меняет.
- `loadWeaponModCatalog() -> Promise<Catalog>` объединяет три versioned read-only fetch в cached Promise; ошибки сбрасывают Promise для повтора. Не сканирует assets и не пишет settings/Items.
- `getWeaponModCandidate(item,catalog)` возвращает `{itemId,sourceId,quantity,profile,profileSignature,available,legacyOverride,reason}`. Source — только `gearId`; отсутствие старого stored attachment допускает каталог, отличающийся custom профиль сохраняется без новой установки. Нет name fallback.
- `getWeaponModHostDescriptor(item,catalog)` возвращает `{id,gearId,family,form,baseForm,modelTags,mountIds,quantity,requiresGmApproval}` либо null. Канонические source rows различают primitive/advanced/crossbow и short/long; колесцовый пистолет long. Удаление текущего Reload исключает magazine-fed tag. Native неизвестный firearm получает family fallback и необходимость решения GM; обычный неизвестный weapon не становится огнестрелом по имени.
- Focused: `tests/weapon-mod-catalog.test.mjs`, `tests/weapon-mod-rules.test.mjs`.

## Pure правила и проверка сохранённых связей

Владелец: `scripts/data/weapon-mod-rules.js`; Foundry globals отсутствуют.

- `WeaponModRuleError(code,details={})` сообщает объяснимый отказ incompatible/invalid-quantity/slot-conflict/duplicate-mod/capacity/missing-dependency/unavailable/gm-approval-required.
- `weaponModFlag(item,key)` читает flag без записи; `weaponModProfileSignature(profile)` канонизирует object keys. `isInstalledWeaponMod(item)` распознаёт синтаксическую обратную связь/container; это не подтверждение авторизации/валидности.
- `validateWeaponAttachmentInstallation(host,installed,candidate,{mountId=null}={}) -> {mountIds}` требует singleton host, доступную целую единицу, verified profile, совместимость и уникальность вида. oneOf занимает одно свободное место в topology order; all занимает по одному месту каждой категории. Для bottom+barrel выбранный bottom закрепляется, второй остаётся свободен. Повреждённые/перекрывающиеся installed mounts отклоняются до выбора.
- `validateModernizedPartInstallation(host,parts,candidate,{removeItemId=null,gmApproval=null}={}) -> {countedParts,removeItemId}` проверяет итоговую сборку, зависимости, исключающие пары, максимум3 counted parts, improved-grip exception и GM requirement. Бесплатное включённое снятие допускается при достигнутом лимите; оно не оставляет orphan dependency. Crossbows не являются носителями modernizedPart.
- `readWeaponMods(host,resolveItem,catalog) -> {attachments,modernizedParts,diagnostics}` читает weaponMods v1 и возвращает только реальные children с quantity1, exact Actor/host/container/reverse links, source signatures и допустимыми полными mount sets/частями. Все исторические flags сохраняются, invalid entries получают diagnostics без эффекта. Проверка прежней установленной части не требует повторного GM approval после переноса.
- Новый state не переиспользует `itemUpgrades`/`installedUpgrade` и не меняет 1–3 слота обычных усовершенствований. Runtime mutation/effect APIs не публикуются на этом этапе.
- Focused: `tests/weapon-mod-rules.test.mjs`, `tests/weapon-mod-catalog.test.mjs`; compatibility regressions: item-upgrade-rules/service, gear-compendium.
