import { itemUtils } from "../../../../lib/utilities/itemUtils.js";
import { actorUtils } from "../../../../lib/utilities/actorUtils.js";
import { dialogUtils } from "../../../../lib/utilities/dialogUtils.js";
import { genericUtils } from "../../../../lib/utilities/genericUtils.js";
export async function useQuickened({workflow}) {
    const actor = workflow.actor;
    const rebreyaSorcerer = actor.items.some(item => item.type === 'class' && item.system.identifier === 'sorcerer-rework-v011');
    const points = actor.items.find(item => item.system.identifier === 'sorcerer-sorcery-points')
        ?? itemUtils.getItemByIdentifier(actor, 'sorceryPoints');
    if (!(Number(points?.system?.uses?.value) >= 2)) {
        genericUtils.notify('CHRISPREMADES.Macros.Metamagic.NotEnough', 'info');
        return;
    }
    const spells = actorUtils.getCastableSpells(actor).filter(item => item.system.activation.type === 'action')
        .sort((a,b) => a.system.level - b.system.level || a.name.localeCompare(b.name));
    if (!spells.length) {
        genericUtils.notify('CHRISPREMADES.Macros.Metamagic.NoValid', 'info');
        return;
    }
    const spell = await dialogUtils.selectDocumentDialog(workflow.item.name,
        genericUtils.format('CHRISPREMADES.Macros.Metamagic.Which', {cost:2,plural:'s'}), spells,
        {showSpellLevel:true,addNoneDocument:true});
    if (!spell) return;
    const baseLevel = spell.system.level;
    const consumesSlot = baseLevel > 0 && !['atwill','innate','ritual'].includes(spell.system.method);
    const usage = {
        consume: {spellSlot: consumesSlot},
        midiOptions: {targetUuids: Array.from(workflow.targets, token => token.document.uuid)}
    };
    let spellLevel = baseLevel;
    if (consumesSlot) {
        const choice = await dialogUtils.selectSpellSlot(actor, workflow.item.name, 'Выберите ячейку заклинания', {minLevel:baseLevel});
        if (!choice) return;
        const slot = choice === 'pact' ? 'pact' : `spell${choice}`;
        const selected = actor.system.spells[slot];
        if (!selected || selected.value < 1 || selected.level < baseLevel) return;
        spellLevel = selected.level;
        usage.spell = {slot};
        usage.scaling = spellLevel - baseLevel;
    }
    if (rebreyaSorcerer) {
        // Rebreya's preflight and payment/rollback own this cast. Keep the actual embedded spell and its contracts.
        usage.sorcererVirtualSpellLevel = {spellLevel,castingMode:'normal',metamagic:{ids:['quickened-spell']}};
        return MidiQOL.completeItemUse(spell,usage,{configure:false});
    }
    // Outside the rework class, let native dnd5e commit the extra two uses and the chosen slot together.
    const changes = {'system.activation.type':'bonus'};
    for (const activity of spell.system.activities) {
        changes[`system.activities.${activity.id}.consumption.targets`] = [
            ...activity.toObject().consumption.targets,
            {type:'itemUses',target:points.id,value:'2'}
        ];
        if (activity.activation?.override && activity.activation.type === 'action') {
            changes[`system.activities.${activity.id}.activation.type`] = 'bonus';
        }
    }
    usage.consume.resources = true;
    return MidiQOL.completeItemUse(spell.clone(changes,{keepId:true}),usage,{configure:false});
}
export const quickenedSpell = {
    name: 'Metamagic: Quickened Spell',
    version: '1.1.0',
    midi: {
        item: [
            {
                pass: 'rollFinished',
                macro: async args => { await useQuickened(args); },
                priority: 50
            }
        ]
    },
    ddbi: {
        removedItems: {
            'Metamagic: Quickened Spell': [
                'Metamagic - Quickened Spell'
            ]
        },
        correctedItems: {
            'Metamagic: Quickened Spell': {
                system: {
                    consume: {
                        amount: null,
                        target: '',
                        type: ''
                    }
                }
            }
        }
    }
};
