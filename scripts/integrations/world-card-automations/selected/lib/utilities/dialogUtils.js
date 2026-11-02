import { DialogApp } from "../../applications/dialog.js";
import { genericUtils } from "./genericUtils.js";
import { tokenUtils } from "./tokenUtils.js";
import { socket } from "../sockets.js";
import { sockets } from "../sockets.js";
export async function buttonDialog(title, content, buttons, {displayAsRows = true, userId = game.user.id} = {}) {
    let inputs = [
        ['button', [], {displayAsRows: displayAsRows}]
    ];
    for (let [label, value, options] of buttons) {
        inputs[0][1].push({label: label, name: value, options: options ?? {}});
    }
    let result;
    if (userId != game.user.id) {
        result = await socket.executeAsUser(sockets.dialog.name, userId, title, content, inputs, undefined, {width: 400});
    } else result = await DialogApp.dialog(title, content, inputs, undefined, {width: 400});
    return result?.buttons ?? false;
}
export async function selectDialog(title, content, input = {label: 'Label', name: 'identifier', options: {}}, {buttons = 'okCancel', userId = game.user.id}={}) {
    if (!input.options) input.options = {};
    let inputOptions = input.options.options ?? [];
    if (!inputOptions.length) inputOptions = ['None'];
    if (inputOptions[0].label === undefined) {
        inputOptions = inputOptions.map(text => {return {value: text, label: text};});
    }
    input.options.options = inputOptions;
    let inputs = [
        ['selectOption',
            [{
                label: input.label,
                name: input.name,
                options: input.options
            }]
        ]
    ];
    let result;
    if (userId && userId != game.user.id) {
        result = await socket.executeAsUser(sockets.dialog.name, userId, title, content, inputs, buttons);
    } else result = await DialogApp.dialog(title, content, inputs, buttons);
    return result?.[input.name];
}
export async function selectTargetDialog(title, content, targets, {type = 'one', selectOptions = [], skipDeadAndUnconscious = true, coverToken = undefined, reverseCover = false, displayDistance = true, maxAmount = 1, minAmount = 0, userId = game.user.id, buttons = 'okCancel', maxes = {}} = {}) {
    let inputs = [
        [type === 'multiple' ? 'checkbox' : type === 'number' ? 'number' : type === 'select' ? 'selectOption' : type === 'selectAmount' ? 'selectAmount' : 'radio']
    ];
    let targetInputs = [];
    let number = 1;
    for (let i of targets) {
        let label;
        if (!genericUtils.getCPRSetting('hideNames')) {
            label = i.document.name;
        } else {
            if (i.document.disposition <= 0) {
                label = genericUtils.translate('CHRISPREMADES.UnknownTarget') + ' (' + number + ')';
                number++;
            } else {
                label = i.document.name;
            }
        }
        if (coverToken && !reverseCover) {
            label += ' [' + tokenUtils.checkCover(coverToken, i, {displayName: true}) + ']';
        } else if (coverToken) {
            label += ' [' + tokenUtils.checkCover(i, coverToken, {displayName: true}) + ']';
        }
        if (displayDistance && coverToken) {
            let distance = tokenUtils.getDistance(coverToken, i);
            label += ' [' + distance.toFixed(2) + ' ' + canvas.scene.grid.units + ' ]';
        }
        let image = i.document.texture.src;
        let value = i.id;
        let isDefaultSelected = targetInputs.length === 0;
        targetInputs.push({
            label: label,
            name: value,
            options: {image: image, isChecked: isDefaultSelected, options: selectOptions, maxAmount: maxes[i.id] ?? maxAmount, minAmount}
        });
    }
    inputs[0].push(targetInputs);
    inputs[0].push({displayAsRows: true, radioName: 'targets', totalMax: maxAmount});
    if (skipDeadAndUnconscious) {
        inputs.push([
            'checkbox',
            [{
                label: 'CHRISPREMADES.SkipDeadAndUnconscious',
                name: 'skip',
                options: {isChecked: true}
            }]
        ]);
    }
    let selection;
    if (userId && userId != game.user.id) {
        selection = await socket.executeAsUser(sockets.dialog.name, userId, title, content, inputs, buttons, {width: 500});
    } else selection = await DialogApp.dialog(title, content, inputs, buttons, {width: 500});
    if (selection?.buttons == false || !selection) return false;
    let result;
    let skip = selection?.skip;
    switch (type) {
        case 'multiple': {
            for (let [key, value] of Object.entries(selection)) {
                if (key === 'buttons' || value === false) continue;
                let doc = targets.find(target => target.id === key);
                if (!doc) continue;
                if (!Array.isArray(result)) result = [];
                result.push(doc);
            }
            break;
        }
        case 'number': {
            for (let [key, value] of Object.entries(selection)) {
                if (key === 'buttons' || value === 0) continue;
                let doc = targets.find(target => target.id === key);
                if (!doc) continue;
                if (!Array.isArray(result)) result = [];
                result.push({document: doc, value: value});
            }
            break;
        }
        case 'selectAmount':
        case 'select': {
            for (let [key, value] of Object.entries(selection)) {
                if (key === 'buttons' || !value || value === '0') continue;
                let doc = targets.find(target => target.id === key);
                if (!doc) continue;
                if (!Array.isArray(result)) result = [];
                result.push({document: doc, value: value});
            }
            break;
        }
        default: {
            result = targets.find(target => target.id === selection.targets);
        }
    }
    return ([result, skip]);
}
export async function confirm(title, content, {userId = game.user.id, buttons = 'yesNo'} = {}) {
    let selection;
    if (userId !== game.user.id) {
        selection = await socket.executeAsUser(sockets.dialog.name, userId, title, content, [], buttons);
    } else selection = await DialogApp.dialog(title, content, [], buttons);
    return selection?.buttons;
}
export async function selectDocumentDialog(title, content, documents, {displayTooltips = false, sortAlphabetical = false, sortCR = false, userId = game.user.id, addNoneDocument = false, showCR = false, showSpellLevel = false, showUses = false, displayReference = false} = {}) {
    if (sortAlphabetical) {
        documents = documents.sort((a, b) => {
            return a.name.localeCompare(b.name, 'en', {sensitivity: 'base'});
        });
    }
    if (sortCR) {
        documents = documents.sort((a, b) => {
            return a.system?.details?.cr > b.system?.details?.cr ? -1 : 1;
        });
    }
    let isCompendiumDoc = !documents[0]?.id;
    let buildLabel = doc => {
        let label = doc.name;
        if (showCR) label += ` [${genericUtils.format('DND5E.CRLabel', {cr: doc.system?.details?.cr ?? '?'})}]`;
        if (showSpellLevel) label += ` [${genericUtils.translate('DND5E.SpellLevel')} ${doc.system?.level ?? '?'}]`;
        let uses = doc.system?.uses ?? doc.uses;
        if (showUses && uses?.max) label += ` [${uses.value ?? '?'}/${uses.max} ${genericUtils.translate('DND5E.Uses')}]`;
        return label + (doc.system?.linkedActivity ? ' (' + doc.system.linkedActivity.item.name + ')' : '');
    };
    let inputFields = documents.map(i => ({
        label: buildLabel(i),
        name: isCompendiumDoc ? (i.uuid ?? i.actor?.uuid) : (i.id ?? i.actor?.id),
        options: {
            image: i.img + (i.system?.details?.cr != undefined ? ` (CR ${genericUtils.decimalToFraction(i.system?.details?.cr)})` : ``),
            tooltip: displayTooltips ? i.system.description.value.replace(/<[^>]*>?|@UUID\[.*?\]{(.*?)}/gm, '$1') : undefined,
            reference: (displayReference && i.reference) ? i.reference : undefined
        }
    }));
    if (addNoneDocument) {
        inputFields.push({
            label: genericUtils.translate('DND5E.None'),
            name: 'none',
            options: {
                image: 'icons/svg/cancel.svg'
            }
        });
    }
    let inputs = [['button', inputFields, {displayAsRows: true}]];
    let result;
    if (userId != game.user.id) {
        result = await socket.executeAsUser(sockets.dialog.name, userId, title, content, inputs, undefined);
    } else {
        result = await DialogApp.dialog(title, content, inputs, undefined);
    }
    if (result?.buttons) return isCompendiumDoc ? fromUuid(result.buttons) : documents.find(i => i.id === result.buttons);
    return false;
}
export async function selectSpellSlot(actor, title, content, {maxLevel = 9, minLevel = 0, userId = game.user.id, no = false} = {}) {
    let inputs = Object.entries(actor.system.spells).filter(i => {
        if (i[1].level > maxLevel) return;
        if (i[1].level < minLevel) return;
        if (i[0] === 'spell0') return;
        if (i[1].value > 0 && i[1].max > 0) return true;
    }).map(j => {
        if (j[0] === 'pact') {
            return [(CONFIG.DND5E.spellcasting?.pact?.label ?? game.i18n.localize('DND5E.PactMagic')) + ' (' + j[1].level + ')', 'pact'];
        } else {
            return [CONFIG.DND5E.spellLevels[j[1].level], j[1].level];
        }
    });
    if (no) inputs.push(['CHRISPREMADES.Generic.No', false]);
    return await buttonDialog(title, content, inputs, {displayAsRows: true, userId: userId});
}
export const dialogUtils = {
    buttonDialog,
    selectDialog,
    selectTargetDialog,
    selectDocumentDialog,
    confirm,
    selectSpellSlot
};
