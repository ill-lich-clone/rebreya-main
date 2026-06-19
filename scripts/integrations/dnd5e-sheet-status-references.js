function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

function buildDescriptionHtml({
  paragraphs = [],
  bullets = [],
  valueHint = "",
  seeAlso = []
} = {}) {
  const rows = [];

  for (const paragraph of paragraphs) {
    const text = String(paragraph ?? "").trim();
    if (!text) {
      continue;
    }

    rows.push(`<p>${escapeHtml(text)}</p>`);
  }

  if (bullets.length) {
    rows.push(`<ul>${bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}</ul>`);
  }

  const safeValueHint = String(valueHint ?? "").trim();
  if (safeValueHint) {
    rows.push(`<p><strong>Значение.</strong> ${escapeHtml(safeValueHint)}</p>`);
  }

  if (seeAlso.length) {
    const related = seeAlso
      .map((entry) => String(entry ?? "").trim())
      .filter(Boolean)
      .map((entry) => escapeHtml(entry))
      .join(", ");
    if (related) {
      rows.push(`<p><strong>См. также:</strong> ${related}.</p>`);
    }
  }

  return rows.join("");
}

function buildTooltipHtml({
  title = "",
  subtitle = "Состояние",
  icon = "icons/svg/aura.svg",
  descriptionHtml = ""
} = {}) {
  return `
    <section class="content">
      <section class="header">
        <div class="top">
          <img src="${escapeHtml(icon)}" alt="${escapeHtml(title)}">
          <div class="name name-stacked">
            <span class="title">${escapeHtml(title)}</span>
            <span class="subtitle">${escapeHtml(subtitle)}</span>
          </div>
        </div>
      </section>
      <section class="description">${descriptionHtml}</section>
    </section>
  `.trim();
}

function shouldUseCompactStatusTitle(label = "") {
  const safeLabel = String(label ?? "").trim();
  if (!safeLabel) {
    return false;
  }

  const longestWord = safeLabel
    .split(/\s+/u)
    .reduce((max, part) => Math.max(max, part.length), 0);

  return longestWord >= 11 || safeLabel.length >= 18;
}

const STATUS_REFERENCE_DATA = Object.freeze({
  unconscious: {
    subtitle: "Базовое состояние",
    bullets: [
      "Вы недееспособны, не можете перемещаться и говорить и не осознаёте происходящее вокруг.",
      "Вы роняете всё, что держите, и падаете ничком.",
      "Вы автоматически проваливаете спасброски Силы и Ловкости.",
      "Броски атаки по вам совершаются с преимуществом.",
      "Попадание по вам из 5 футов считается критическим."
    ],
    seeAlso: ["Недееспособный", "Опрокинутый"]
  },
  incapacitated: {
    subtitle: "Базовое состояние",
    paragraphs: [
      "Существо не может совершать действия, бонусные действия и реакции."
    ]
  },
  exhaustion: {
    subtitle: "Базовое состояние",
    paragraphs: [
      "Истощение накапливается по уровням. Чем выше уровень, тем тяжелее штрафы к действиям существа."
    ],
    valueHint: "Используйте значение состояния как уровень истощения, если его задаёт источник."
  },
  invisible: {
    subtitle: "Базовое состояние",
    bullets: [
      "Существо нельзя увидеть без особых чувств или магии.",
      "Атаки существа совершаются с преимуществом.",
      "Атаки по существу совершаются с помехой."
    ]
  },
  deafened: {
    subtitle: "Базовое состояние",
    paragraphs: [
      "Существо не слышит и автоматически проваливает проверки, требующие слуха."
    ]
  },
  petrified: {
    subtitle: "Базовое состояние",
    bullets: [
      "Существо превращается в неподвижную материю и становится недееспособным.",
      "Оно не осознаёт происходящее вокруг и автоматически проваливает спасброски Силы и Ловкости.",
      "Броски атаки по нему совершаются с преимуществом, а само существо получает сопротивление ко всему урону."
    ],
    seeAlso: ["Недееспособный"]
  },
  prone: {
    subtitle: "Базовое состояние",
    bullets: [
      "Существо лежит ничком и может только ползти, если не встанет.",
      "Чтобы встать, нужно потратить часть перемещения.",
      "Атаки существа совершаются с помехой.",
      "Атаки по существу вблизи совершаются с преимуществом, а издали — с помехой."
    ]
  },
  poisoned: {
    subtitle: "Базовое состояние",
    paragraphs: [
      "Существо совершает броски атаки и проверки характеристик с помехой."
    ]
  },
  charmed: {
    subtitle: "Базовое состояние",
    bullets: [
      "Существо не может атаковать очаровавшего его или направлять на него вредоносные эффекты.",
      "Очаровавший получает преимущество на социальные проверки против существа."
    ]
  },
  stunned: {
    subtitle: "Базовое состояние",
    bullets: [
      "Существо недееспособно, не может перемещаться и говорит с трудом.",
      "Оно автоматически проваливает спасброски Силы и Ловкости.",
      "Броски атаки по нему совершаются с преимуществом."
    ],
    seeAlso: ["Недееспособный"]
  },
  paralyzed: {
    subtitle: "Базовое состояние",
    bullets: [
      "Существо недееспособно, не может перемещаться и говорить.",
      "Оно автоматически проваливает спасброски Силы и Ловкости.",
      "Броски атаки по нему совершаются с преимуществом.",
      "Попадание по нему из 5 футов считается критическим."
    ],
    seeAlso: ["Недееспособный"]
  },
  grappled: {
    subtitle: "Базовое состояние",
    paragraphs: [
      "Скорость существа становится равной 0, пока захват не окончится."
    ]
  },
  blinded: {
    subtitle: "Базовое состояние",
    bullets: [
      "Существо не видит и автоматически проваливает проверки, требующие зрения.",
      "Его броски атаки совершаются с помехой.",
      "Броски атаки по нему совершаются с преимуществом."
    ]
  },
  restrained: {
    subtitle: "Базовое состояние",
    bullets: [
      "Скорость существа равна 0.",
      "Его броски атаки совершаются с помехой.",
      "Броски атаки по нему совершаются с преимуществом.",
      "Спасброски Ловкости существа совершаются с помехой."
    ]
  },
  frightened: {
    subtitle: "Состояние Rebreya",
    paragraphs: [
      "Ребрея использует свой вариант испуга вместо стандартного dnd5e."
    ],
    valueHint: "Значение состояния даёт такой же штраф к броскам атак и проверкам характеристик. Если источник не задал число, Ребрея берёт половину мастерства источника, минимум 2."
  },
  "rebreya-discreet": {
    subtitle: "Состояние Rebreya",
    paragraphs: [
      "Состояние описывает ограничение подвижности."
    ],
    valueHint: "Если значение указано, оно вычитается из всех типов скорости. Если значение не указано, скорость уменьшается вдвое."
  },
  "rebreya-gaseous": {
    subtitle: "Состояние Rebreya",
    paragraphs: [
      "Служебное состояние для газообразной формы. Точные последствия задаёт источник эффекта."
    ]
  },
  "rebreya-surrounded": {
    subtitle: "Состояние Rebreya",
    paragraphs: [
      "Служебное состояние для правил окружения Rebreya."
    ]
  },
  "rebreya-open-position": {
    subtitle: "Состояние Rebreya",
    paragraphs: [
      "Цель открыла защиту и считается уязвимой для тактического давления."
    ]
  },
  "rebreya-entangled-mind": {
    subtitle: "Состояние Rebreya",
    paragraphs: [
      "Служебное состояние спутанного разума. Его точные последствия задаёт источник эффекта."
    ]
  },
  "rebreya-frostbitten": {
    subtitle: "Состояние Rebreya",
    paragraphs: [
      "Числовое состояние холода и окоченения."
    ],
    valueHint: "Используйте значение как текущую тяжесть окоченения."
  },
  "rebreya-nauseated": {
    subtitle: "Состояние Rebreya",
    paragraphs: [
      "Числовое состояние тошноты."
    ],
    valueHint: "Используйте значение как текущую тяжесть тошноты."
  },
  "rebreya-hasted": {
    subtitle: "Состояние Rebreya",
    paragraphs: [
      "На цели действует ускорение по правилам Rebreya."
    ]
  },
  "rebreya-slowed": {
    subtitle: "Состояние Rebreya",
    paragraphs: [
      "На цели действует замедление по правилам Rebreya."
    ]
  },
  "rebreya-weakened": {
    subtitle: "Состояние Rebreya",
    paragraphs: [
      "Числовое состояние слабости."
    ],
    valueHint: "Используйте значение как текущую тяжесть ослабления."
  },
  "rebreya-clumsy": {
    subtitle: "Состояние Rebreya",
    paragraphs: [
      "Числовое состояние потери координации."
    ],
    valueHint: "Используйте значение как текущую тяжесть неуклюжести."
  },
  "rebreya-decaying-damage": {
    subtitle: "Состояние Rebreya",
    paragraphs: [
      "Числовое состояние затухающего периодического урона."
    ],
    valueHint: "Используйте значение как текущую силу затухающего урона."
  },
  "rebreya-charged": {
    subtitle: "Состояние Rebreya",
    paragraphs: [
      "На цели накоплен заряд по правилам Rebreya."
    ]
  },
  "rebreya-provoked": {
    subtitle: "Состояние Rebreya",
    paragraphs: [
      "Числовое состояние провокации и открытой угрозы."
    ],
    valueHint: "Используйте значение как текущую тяжесть провокации."
  },
  "rebreya-twisted": {
    subtitle: "Состояние Rebreya",
    paragraphs: [
      "Числовое состояние скручивания и болезненной фиксации."
    ],
    valueHint: "Используйте значение как текущую тяжесть эффекта."
  },
  "rebreya-swallowed": {
    subtitle: "Состояние Rebreya",
    paragraphs: [
      "Числовое состояние проглатывания."
    ],
    valueHint: "Используйте значение как текущую тяжесть положения внутри существа или объекта."
  },
  "rebreya-possessed": {
    subtitle: "Состояние Rebreya",
    paragraphs: [
      "На цели действует одержимость по правилам Rebreya."
    ]
  }
});

export function getDnd5eSheetStatusPresentation(statusId, {
  label = "",
  icon = "",
  supportsValue = false
} = {}) {
  const safeStatusId = String(statusId ?? "").trim();
  const safeLabel = String(label ?? "").trim() || safeStatusId;
  if (!safeStatusId && !safeLabel) {
    return null;
  }

  const entry = STATUS_REFERENCE_DATA[safeStatusId] ?? null;
  const shouldUseRebreyaFallback = safeStatusId.startsWith("rebreya-") || supportsValue === true;
  if (!entry && !shouldUseRebreyaFallback) {
    return null;
  }

  const subtitle = entry?.subtitle
    ?? (safeStatusId.startsWith("rebreya-") || supportsValue ? "Состояние Rebreya" : "Состояние");
  const descriptionHtml = buildDescriptionHtml({
    paragraphs: entry?.paragraphs ?? [
      safeStatusId.startsWith("rebreya-") || supportsValue
        ? "Состояние использует правила Rebreya. Точные последствия задаёт наложивший его эффект."
        : "Используйте это состояние по правилам вашего мира и текущей сцены."
    ],
    bullets: entry?.bullets ?? [],
    valueHint: entry?.valueHint ?? "",
    seeAlso: entry?.seeAlso ?? []
  });

  return {
    label: safeLabel,
    compactLabel: shouldUseCompactStatusTitle(safeLabel),
    tooltipHtml: buildTooltipHtml({
      title: safeLabel,
      subtitle,
      icon: icon || "icons/svg/aura.svg",
      descriptionHtml
    })
  };
}
