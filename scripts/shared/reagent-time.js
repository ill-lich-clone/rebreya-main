export function formatReagentTime(seconds) {
  let remaining = Math.max(0, Math.ceil(seconds));
  const hours = Math.floor(remaining / 3600);
  remaining %= 3600;
  const minutes = Math.floor(remaining / 60);
  const secondsPart = remaining % 60;
  return [hours && `${hours} ч`, minutes && `${minutes} мин`, secondsPart && `${secondsPart} с`]
    .filter(Boolean).join(" ") || "0 с";
}
