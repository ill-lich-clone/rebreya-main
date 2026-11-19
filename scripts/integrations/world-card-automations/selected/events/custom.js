let definitions;

export function setCardMacroDefinitions(catalog) {
    definitions = catalog;
}

export const custom = {
    getMacro(id, rules) {
        const catalog = definitions?.[rules];
        return catalog && Object.hasOwn(catalog, id) ? catalog[id] : undefined;
    }
};
