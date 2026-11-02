import { definitions } from "../../registry.js";
export const custom = {
    getMacro(id, rules) {
        const catalog = definitions[rules];
        return catalog && Object.hasOwn(catalog, id) ? catalog[id] : undefined;
    }
};
