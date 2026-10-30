export const SPELLCASTING_ITEM_FAMILIES = Object.freeze({
  "универсальный-инструмент": { manual: "Владение выбранным инструментом и выбранный заговор остаются ручными." },
  "магический-гримуар": { manual: "Дополнительный уровень ячеек Магического восстановления учитывается вручную." },
  "флакон-с-кровью": { manual: "Восстановление 5 единиц чародейства при расходе Кости Хитов остаётся ручным." },
  "амулет-благочестия": { manual: "Actor-resource Божественного канала изменяется вручную." },
  "барабан-задающего-ритм": { manual: "Игра на барабане остаётся ручной; восстановление вдохновения обрабатывает прежний compatibility-service." },
  "лунный-серп": { manual: "Дополнительное лечение заклинаниями остаётся ручным." },
  "жезл-хранителя-договора": { manual: "Выбор восстанавливаемой ячейки остаётся ручным." }
});

export function getSpellcastingItemDefinition(id) {
  const match = String(id ?? "").match(/^(.*)-([123])$/u);
  const definition = SPELLCASTING_ITEM_FAMILIES[match?.[1]];
  return definition ? { ...definition, family: match[1], bonus: Number(match[2]) } : null;
}
