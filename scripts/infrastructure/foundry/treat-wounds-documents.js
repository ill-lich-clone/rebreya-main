import { TreatWoundsError, getTreatWoundsTiers } from "../../application/treat-wounds-rules.js?v=1.4.372";
const reject = (code, text) => { throw new TreatWoundsError(code, text); };
const values = c => Array.from(c?.contents ?? c?.values?.() ?? c ?? []);

export class TreatWoundsDocuments {
  constructor({ adapter, groupContextService, resolve = uuid => globalThis.fromUuid(uuid), gameProvider = () => globalThis.game, canvasProvider = () => globalThis.canvas }) {
    Object.assign(this, { adapter, groupContextService, resolve, gameProvider, canvasProvider });
  }
  async tokens(intent, sender) {
    const game = this.gameProvider();
    if (game.system?.id !== "dnd5e") reject("unsupported-system", "Перевязка ран требует dnd5e.");
    if (!sender?.id || game.users.get(sender.id) !== sender) reject("unauthorized", "Пользователь не определён.");
    const [source, target] = await Promise.all([this.resolve(intent.sourceTokenUuid), this.resolve(intent.targetTokenUuid)]);
    if (!source?.actor || !target?.actor || source.parent?.id !== target.parent?.id || source.parent?.id !== this.canvasProvider()?.scene?.id) reject("invalid-tokens", "Выберите лекаря и пациента на активной сцене.");
    if (!sender.isGM && (source.actor.testUserPermission?.(sender, "OWNER") !== true || target.hidden)) reject("unauthorized", "Нет доступа к лекарю или пациент скрыт.");
    if (!this.adapter.isLiving(target.actor)) reject("invalid-target", "Перевязка доступна только живому существу.");
    if (!this.adapter.hasMedicineProficiency(source.actor)) reject("medicine-required", "Лекарь должен владеть Медициной.");
    return { source, target };
  }
  async preview(intent, sender) {
    const { source, target } = await this.tokens(intent, sender), kits = [];
    const addKits = (actor, groupActorId = "") => {
      for (const item of values(actor.items)) if (this.adapter.kitState(item).eligible) kits.push({ uuid: item.uuid, groupActorId,
        name: item.name, quantity: item.system.quantity, sourceName: groupActorId ? `Группа: ${actor.name}` : `Личный: ${source.name}` });
    };
    addKits(source.actor);
    for (const id of Object.keys(this.groupContextService.getRegistry().groupsById ?? {})) {
      if (!this.groupContextService.canManageGroupForUser(id, sender)) continue;
      const { groupActor } = this.groupContextService.resolveForGroup(id);
      addKits(groupActor, id);
    }
    return { sourceName: source.name, targetName: target.name, level: this.adapter.level(source.actor), kits,
      tiers: getTreatWoundsTiers(this.adapter.level(source.actor)), canSetDc: sender.isGM === true };
  }
  async prepare(intent, sender) {
    const { source, target } = await this.tokens(intent, sender);
    const tier = getTreatWoundsTiers(this.adapter.level(source.actor)).find(t => t.dc === intent.tierDc);
    if (!tier || (intent.customDc !== null && !sender.isGM)) reject("invalid-tier", "Эта Сл недоступна лекарю.");
    const preview = await this.preview(intent, sender);
    if (!preview.kits.some(k => k.uuid === intent.kitItemUuid && k.groupActorId === intent.groupActorId)) reject("invalid-kit", "Выберите доступный целый комплект целителя.");
    return { source, target, tier, dc: intent.customDc ?? tier.dc };
  }
}
