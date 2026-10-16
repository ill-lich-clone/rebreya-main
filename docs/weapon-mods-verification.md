# Проверка оружейных обвесов

Дата: 2026-10-16. Проверяемая реализация: release `1.4.389` с T12 исправлениями после `51e76f21`, ветка `lich_branch`. [Спецификация](superpowers/specs/2026-10-16-weapon-attachments-design.md), [план](superpowers/plans/2026-10-16-weapon-attachments.md), [паспорт](weapon-mods-function-passport.md).

## Автоматические результаты

- `node --test tests/*.test.mjs`:4768 tests,4767 passed,0 failed,1 skipped. Последний full log завершился59.1сек.; skip существующий, не новый обход требований.
- `node --check` для всех tracked и новых task JS/MJS:1003 valid. Parse JSON через PowerShell ConvertFrom-Json:58 valid. После последней правки lifecycle повторно проверены оба затронутых JS/MJS; затем выполнен свежий full suite.
- Final focused panel/projection/roll/target/mutation/transport/combat/manifest/composition/Storage:226/226. T10 artwork4/4. После реальных дефектов сначала RED, затем исправление и затронутые GREEN. Публичные оба attack API проверены с реальным service и observer receipt; тест дальности дополнительно исполняет checkRangeFunction из установленного MIDI13.0.61.
- `git diff --check`; version/entrypoint/cache assertions; исторические forwarders сохранены. Последняя полная проверка относится к product code выше; дальнейший report-only commit не меняет runtime.

## Границы живой проверки

Локально установлены Foundry13.351, dnd5e5.2.5 и MIDI13.0.61; их исходные native методы/Hook ordering сверены. Это source evidence, а не live world verdict.

Configured local port30000 не слушает; Browser visit `http://127.0.0.1:30000/` завершился `net::ERR_CONNECTION_REFUSED`. Foundry bridge tools в текущей сессии отсутствуют. Live GM/player/active-inactive GM, бой, native templates/cards и transfer/Storage в работающем world **не проверены**. QA Actors/Items/Scenes в настоящем world не создавались. Нет утверждения, что static preview заменяет live QA.

Изолированный браузерный DOM использовал настоящие panel/catalog/rules/blueprint modules и временный mock document/API boundary. Проверены схемы6/3/2 при ширинах480/820: без clip/overlap. Занятый двухместный штык показывает один primary child и ссылку; первоначальный narrow clip найден и закреплён regression test. Проверены ПКМ/ЛКМ пустого слота, полный13-row catalogue, owned-first/blocked/missing, click-install exact Item payload, readonly all-disabled, resize и порядок перед old slots. Нативный mouse drag в доступном browser tool не создал drop; raw CDP drag unsupported — drag/drop не объявляется live-проверенным. Его UI handler использует прежние payload resolver и canonical install helper, который tested через настоящий mutation service (split3→2+1).

После T12 в браузере повторно проверен полный каталог при480px: механика/крепления читаемы,13 вариантов,11 disabled в этом fixture; main.clientWidth=scrollWidth=480, горизонтального переполнения нет. Preview compatibility и освобождение document listeners при native close проверены focused tests; настоящий browser drag остаётся непроверенным. Временные preview-серверы остановлены; world data не изменялись.

## Матрица требований

| Требование spec | Доказательство |
| --- | --- |
| §1–3 чертёж/место/каталог | panel tests, DOM проверки выше, blueprint tests и visual contact pages |
| §4 slots/one-kind/one-instance/all mounts | weapon-mod-rules/catalog/mutations/transport tests |
| §5 действия и немедленная пересборка | weapon-rebuild-rules/mutations:500gp один раз,499gp отказ, replacement, GM audit, recovery; календарь не используется |
| §6 все25 механик | таблица ниже и профильные owner tests; явные GM/manual условия сохранены |
| §7 один владелец/авторизация | typed command tests, existing coordinator/journal/instance batches, native packet owner |
| §8 сохранность | transport/runtime graph/Storage/source/weight/quantity/charges/formulas/wallet regression tests |
| §9 regression и runtime evidence | full suite/source inspection/DOM; actual live world остаётся непроверенным |

## Все25 профилей

Каждая строка связана с executable consumer; manual/unknown условия перечислены явно. Тесты graph/commands/rebuild применимы ко всем профилям дополнительно.

| Stable ID | Наблюдаемая механика / условие GM | Focused tests |
| --- | --- | --- |
| `fonarik` | Native отдельный световой конус60°, bright30/dim60; bonus toggle, выбор своего Token, Token.light сохраняется. | [weapon-mod-activities](../tests/weapon-mod-activities.test.mjs) |
| `giganskaya-oboyma` | Ёмкость ×2, несовместима с расширенной; overflow/refund и automatic area ammo планируются в прежнем batch. | [weapon-mod-mutations](../tests/weapon-mod-mutations.test.mjs) |
| `glushitel` | Native Восприятие слышащего наблюдателя в30фт. против10+floor(actual attack total/2); hearing/hidden неизвестны → GM, private receipt. | [weapon-mod-target-effects](../tests/weapon-mod-target-effects.test.mjs) |
| `kollimatornyy-pritsel` | Aim в свой ход при движении≤10фт.; скорость0, игнор half cover; source-host-turn привязка и сброс. | [weapon-mod-roll-modifiers](../tests/weapon-mod-roll-modifiers.test.mjs) |
| `lazernyy-tseleukazatel` | +1 к атаке только видимой цели с использованием proficiency; неизвестное условие → exact target/card decision. | [weapon-mod-roll-modifiers](../tests/weapon-mod-roll-modifiers.test.mjs) |
| `narezka-stvola` | Дистанции +30/+10фт., rifle ammunition; исходные патроны возвращаются точно в общем batch. | [weapon-mod-mutations](../tests/weapon-mod-mutations.test.mjs) |
| `oblegchyonnyy-korpus` | Вес тела после signed part deltas/clamp0 делится на2; массу обвесов и прежний reducer учитывает единственный weight owner. | [weapon-mod-projections](../tests/weapon-mod-projections.test.mjs) |
| `oblegchyonnyy-stvol` | Исходный signed вес и +10/+20фт.; конфликт с утяжелённым стволом. | [weapon-mod-projections](../tests/weapon-mod-projections.test.mjs) |
| `obrezka-stvola` | Short form, минус одна ступень base die, удаление two, -10/-10фт.; custom formula не переписывается, выводится diagnosis. | [weapon-mod-projections](../tests/weapon-mod-projections.test.mjs) |
| `opticheskiy-pritsel` | Aim без движения; дистанции ×2 и half cover ignore до конца хода. Нет выдуманного action cost. | [weapon-mod-roll-modifiers](../tests/weapon-mod-roll-modifiers.test.mjs) |
| `pistoletnaya-rukoyat` | +1 к атаке; dependency для улучшенной рукояти, отдельный counted part. | [weapon-mod-roll-modifiers](../tests/weapon-mod-roll-modifiers.test.mjs) |
| `podstvol-nyy-granatomet` | 6 реальных гранат, одна загрузка за action, native save/damage90фт., отдельный magazine. Недостающее save ability/onSave → GM; задержки/особые эффекты вручную по карточке. | [weapon-mod-activities](../tests/weapon-mod-activities.test.mjs) |
| `podvodnyy-klapan` | Разрешает подводный огонь и делит обе дистанции на2 только под водой; неизвестная среда → решение, без клапана известная underwater блокирует. | [weapon-mod-roll-modifiers](../tests/weapon-mod-roll-modifiers.test.mjs) |
| `priklad` | +1 к атаке не prone; неизвестное prone → решение. Совместимость проверяется по actual form. | [weapon-mod-roll-modifiers](../tests/weapon-mod-roll-modifiers.test.mjs) |
| `rasshirennaya-oboyma` | Ёмкость ×1.5, несовместима с гиганской. Уточнённый automatic расход и возвраты исходных патронов остаются в ammo owner. | [weapon-mod-mutations](../tests/weapon-mod-mutations.test.mjs) |
| `razgonshchik-snaryadov` | MaterialTarget только от GM; conditional nonmagical resistance игнорируется, immunity становится resistance конкретного packet/target. | [weapon-mod-target-effects](../tests/weapon-mod-target-effects.test.mjs) |
| `shtyk` | Native spear proficiency/STR/base1d6/versatile1d8, без thr и firearm ammo. Один child занимает один низ+ствол. | [weapon-mod-activities](../tests/weapon-mod-activities.test.mjs) |
| `sil-naya-sverdlovka` | Scatter радиус10фт., тот же attack total против AC других существ; одна выбранная клетка large target, один fixed DamageRoll. | [weapon-mod-target-effects](../tests/weapon-mod-target-effects.test.mjs) |
| `slabaya-sverdlovka` | Scatter5фт. + фактический ability modifier исходного roll; отсутствующий modifier подтверждает GM; обычные bonuses не добавляются. | [weapon-mod-target-effects](../tests/weapon-mod-target-effects.test.mjs) |
| `soshki` | +2 к атаке prone и native prone-fire property; прочие атаки не получают бонус. | [weapon-mod-roll-modifiers](../tests/weapon-mod-roll-modifiers.test.mjs) |
| `takticheskaya-rukoyatka` | +1 к атаке и +1 к native save от разоружения точного оружия. | [weapon-mod-roll-modifiers](../tests/weapon-mod-roll-modifiers.test.mjs) |
| `uluchshennaya-pistoletnaya-rukoyat` | Дополнительный +1 при наличии базовой рукояти (всего2); не расходует counted limit. | [weapon-mod-roll-modifiers](../tests/weapon-mod-roll-modifiers.test.mjs) |
| `uluchshennyy-glushitel` | Как глушитель, радиус10фт.; точная ammo family musket/pistol/rifle, private per-observer result. | [weapon-mod-target-effects](../tests/weapon-mod-target-effects.test.mjs) |
| `uplotnitel-snaryadov` | Та же conditional nonmagical resistance/immunity механика, включая нематериальную цель; source/target/card scoped. | [weapon-mod-target-effects](../tests/weapon-mod-target-effects.test.mjs) |
| `utyazhelyonnyy-stvol` | Исходный signed вес и +20/+30фт.; конфликт с облегчённым стволом. | [weapon-mod-projections](../tests/weapon-mod-projections.test.mjs) |

Nonmagical trait integration работает через штатные conditional `mgc` bypass traits, scoped options и native/MIDI pipeline без изменения Actor traits. Custom MIDI trait expressions требуют ручного расчёта GM и дают предупреждение. Native packet/save/rounding/HP не заменены новой damage engine.

## Все38 индивидуальных чертежей

Каждый PNG просмотрен в контактной таблице; исходные ImageGen outputs сохранены отдельно. Колёсцовый пистолет изображён длинной винтовкой по описанию, гармата семиствольная, миниакула с акульим кожухом. Антиматериальный рисунок очищен от неустановленных scope/support через ImageGen edit. Все41 PNG имеют разные SHA256; anchors нормализованы по поддержанным mount IDs. Item.img не меняется.

| Stable ID | Семейство | Изображение |
| --- | --- | --- |
| `antimaterial-naya-vintovka` | advanced | [PNG](../assets/weapon-blueprints/antimaterial-naya-vintovka.png) |
| `antimaterial-nyy-revol-ver` | advanced | [PNG](../assets/weapon-blueprints/antimaterial-nyy-revol-ver.png) |
| `arbalet-legkiy` | crossbow | [PNG](../assets/weapon-blueprints/arbalet-legkiy.png) |
| `arbalet-ruchnoy` | crossbow | [PNG](../assets/weapon-blueprints/arbalet-ruchnoy.png) |
| `arbalet-tyazhelyy` | crossbow | [PNG](../assets/weapon-blueprints/arbalet-tyazhelyy.png) |
| `arkebuza` | primitive | [PNG](../assets/weapon-blueprints/arkebuza.png) |
| `avtomaticheskaya-vintovka` | advanced | [PNG](../assets/weapon-blueprints/avtomaticheskaya-vintovka.png) |
| `avtomaticheskiy-pistolet` | advanced | [PNG](../assets/weapon-blueprints/avtomaticheskiy-pistolet.png) |
| `derrindzher` | primitive | [PNG](../assets/weapon-blueprints/derrindzher.png) |
| `dragun` | primitive | [PNG](../assets/weapon-blueprints/dragun.png) |
| `drobovik` | advanced | [PNG](../assets/weapon-blueprints/drobovik.png) |
| `dvukhstvol-nyy-drobovik` | advanced | [PNG](../assets/weapon-blueprints/dvukhstvol-nyy-drobovik.png) |
| `garmata` | advanced | [PNG](../assets/weapon-blueprints/garmata.png) |
| `gauss-pulemyot` | advanced | [PNG](../assets/weapon-blueprints/gauss-pulemyot.png) |
| `gauss-vintovka` | advanced | [PNG](../assets/weapon-blueprints/gauss-vintovka.png) |
| `karabin` | advanced | [PNG](../assets/weapon-blueprints/karabin.png) |
| `kolestsovyy-pistolet` | primitive | [PNG](../assets/weapon-blueprints/kolestsovyy-pistolet.png) |
| `kremnevyy-pistolet` | primitive | [PNG](../assets/weapon-blueprints/kremnevyy-pistolet.png) |
| `lazernaya-vintovka` | advanced | [PNG](../assets/weapon-blueprints/lazernaya-vintovka.png) |
| `miniakula` | advanced | [PNG](../assets/weapon-blueprints/miniakula.png) |
| `mnogostvol-nyy-kremnevyy-pistolet` | primitive | [PNG](../assets/weapon-blueprints/mnogostvol-nyy-kremnevyy-pistolet.png) |
| `mnogozaryadnyy-arbalet` | crossbow | [PNG](../assets/weapon-blueprints/mnogozaryadnyy-arbalet.png) |
| `mushket` | primitive | [PNG](../assets/weapon-blueprints/mushket.png) |
| `mushketon` | primitive | [PNG](../assets/weapon-blueprints/mushketon.png) |
| `obrez` | advanced | [PNG](../assets/weapon-blueprints/obrez.png) |
| `ognemyot` | advanced | [PNG](../assets/weapon-blueprints/ognemyot.png) |
| `perenosnaya-pushka` | advanced | [PNG](../assets/weapon-blueprints/perenosnaya-pushka.png) |
| `pistolet` | advanced | [PNG](../assets/weapon-blueprints/pistolet.png) |
| `poluavtomaticheskaya-vintovka` | advanced | [PNG](../assets/weapon-blueprints/poluavtomaticheskaya-vintovka.png) |
| `revol-ver` | advanced | [PNG](../assets/weapon-blueprints/revol-ver.png) |
| `ruchnitsa` | advanced | [PNG](../assets/weapon-blueprints/ruchnitsa.png) |
| `ruchnoy-granatomyot` | advanced | [PNG](../assets/weapon-blueprints/ruchnoy-granatomyot.png) |
| `samodel-noe-rpu` | advanced | [PNG](../assets/weapon-blueprints/samodel-noe-rpu.png) |
| `tesla-vintovka` | advanced | [PNG](../assets/weapon-blueprints/tesla-vintovka.png) |
| `tyazhelaya-vintovka` | advanced | [PNG](../assets/weapon-blueprints/tyazhelaya-vintovka.png) |
| `tyazhelyy-pistolet` | advanced | [PNG](../assets/weapon-blueprints/tyazhelyy-pistolet.png) |
| `uravnitel` | advanced | [PNG](../assets/weapon-blueprints/uravnitel.png) |
| `vintovka` | advanced | [PNG](../assets/weapon-blueprints/vintovka.png) |

Резервные изображения: `fallback-primitive`, `fallback-advanced`, `fallback-crossbow`, отдельные PNG; known host не подменяется fallback.

## Независимая проверка и интеграция

Gemini3.8 Flash High: verified packet analysis T9 и UI integration review T11; подтвердил native trait ordering и риск capture-listener collision. Blueprint секция оставлена sibling к старой upgrade-секции. Одна отдельная scatter review попытка вернула SUCCESS без response; её выводы не использованы.

Fresh-context whole-feature correctness review (`138be70a..51e76f21`) завершён по requesting-code-review:0 Critical,7 Important. Все семь исправлены за один проход с regression tests:

| Замечание | Исправление и проверка |
| --- | --- |
| Патрон/misfire до отмены или отказа по дальности | Legacy conditions gate перенесён перед расходом; cancel/range сохраняют ammo flags и очередь RNG. |
| Storage отвергал гранаты внутри установленного launcher | Канонический runtime graph захватывает descendants/source UUID; тест сохраняет uses, authored formula, original source и remapped containers. |
| MIDI preflight читал исходную дальность | Native activity derived range после prepareFinalData, без source writes/повторного умножения; проверены actual MIDI normal/dis, override и завершение aim. |
| Публичные attack API обходили target-effects | Реальный Roll + native activity/card flags поступают в прежний GM listener; оба API создают ровно один observer check, createMessage:false остаётся без карточки. |
| Прицел не учитывал динамическое MIDI укрытие | Max native cover и публичного computeCoverBonus; ровно half компенсируется, ¾/full остаются. |
| Предупреждение об авторском уроне обрезки не доходило до листа | Projection публикует diagnostics канонического automation owner; formula не меняется. |
| Backend допускал установку уже взятой в руку части | Под Actor lock проверяется equipped+heldHands до wallet/Item writes; оба install/rebuild сохраняют snapshots при отказе. |

Также закрыты Minor замечания о механике/креплениях в каталоге и drag preview. Дополнительная локальная проверка закрепила снятие document listeners на native close. Stylesheet cache epoch обновлён вместе с manifest/entrypoint до389; прежние owner URL вне затронутого cohort и исторические forwarders сохранены. Live world evidence и изображения reviewer не проверял; их границы приведены отдельно выше.

Согласованный Git-процесс: scoped commits/push в lich_branch; main/master не изменялись, force push отсутствует. Спецификация/план и паспорт входят в репозиторий. Merge/PR не запрашивались.
