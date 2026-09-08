import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

class FakeApplicationV2 {
  constructor(options = {}) {
    this.options = options;
  }
  async _onRender() {}
  async render() {return this;}
}

globalThis.foundry = {
  applications: {
    api: {
      ApplicationV2: FakeApplicationV2,
      HandlebarsApplicationMixin: (Base) => Base
    }
  },
  utils: {
    escapeHTML: value=>String(value),
    deepClone: (value) => structuredClone(value),
    getProperty: () => undefined,
    hasProperty: () => false,
    setProperty: () => undefined
  }
};
globalThis.game = {
  user: { isGM: true },
  packs: { get: () => null }
};
globalThis.randomID = () => "test-id";

const {
  LootgenApp,
  buildLootgenMundaneCandidate,
  promptLootgenTemplateName,
  resolveLootgenItemValue
} = await import("../scripts/ui/lootgen-app.js?context-test");

test("lootgen mundane candidates carry authored package formulas", () => {
  assert.deepEqual(buildLootgenMundaneCandidate({
    id: "paper-sheet",
    name: "Бумага (один лист)",
    multipleAppearance: "2к12"
  }, {
    rank: 0,
    value: 2,
    typeLabel: "Снаряжение",
    breakable: false
  }), {
    sourceType: "gear",
    sourceId: "paper-sheet",
    name: "Бумага (один лист)",
    rank: 0,
    value: 2,
    multipleAppearance: "2к12",
    typeLabel: "Снаряжение",
    stackable: true,
    breakable: false
  });
});

test("lootgen item value keeps truly valueless items at zero", () => {
  assert.equal(resolveLootgenItemValue("", 0), 0);
  assert.equal(resolveLootgenItemValue(0, 0), 0);
  assert.equal(resolveLootgenItemValue("25", 0), 25);
  assert.equal(resolveLootgenItemValue("", 1.5), 150);
});

test("lootgen asks for a template name through a Foundry dialog", async () => {
  const name = await promptLootgenTemplateName({
    wait: async (options) => {
      assert.equal(options.window.title, "Сохранить шаблон Lootgen");
      return options.buttons[0].callback(null, {
        form: { elements: { templateName: { value: "  Простой сундук  " } } }
      });
    }
  });

  assert.equal(name, "Простой сундук");
});

test("lootgen hides upgrade categories even when an old template enables them", async () => {
  const app = new LootgenApp({
    getModel: async () => ({ gear: [
      { equipmentType: "Усовершенствование" },
      { equipmentType: "Зачарование" },
      { equipmentType: "Проклятье" },
      { equipmentType: "Оружие" }
    ], materials: [{ id: "iron" }] }),
    listLootgenTemplates: () => []
  });
  app.gearTypeFilters = { "усовершенствование": true };
  const context = await app._prepareContext();
  assert.deepEqual(context.form.gearTypeOptions.map(row => row.label).sort(), ["Материал", "Оружие"]);
});

test("lootgen context exposes saved templates to a GM", async () => {
  const savedTemplate = {
    id: "simple-chest",
    name: "Простой сундук",
    form: {}
  };
  const app = new LootgenApp({
    getModel: async () => ({ gear: [], materials: [] }),
    listLootgenTemplates: () => [savedTemplate]
  }, { appKey: "context-test" });

  const context = await app._prepareContext();

  assert.deepEqual(context.form.lootgenTemplates, [{ ...savedTemplate, selected: false }]);
  assert.equal(context.form.hasLootgenTemplates, true);
});

test("lootgen carries the soft quantity target through context and saved templates", async () => {
  let savedPayload = null;
  const app = new LootgenApp({
    getModel: async () => ({ gear: [], materials: [] }),
    listLootgenTemplates: () => [],
    saveLootgenTemplate: async (payload) => {
      savedPayload = payload;
      return payload;
    }
  }, { appKey: "soft-target" });

  app.applyLootgenTemplate({ form: { optimalItemQuantity: 7 } });
  const context = await app._prepareContext();
  await app.saveTemplateFromName("Семь предметов");

  assert.equal(context.form.optimalItemQuantity, 7);
  assert.equal(savedPayload.form.optimalItemQuantity, 7);
});

test("lootgen exposes a coin reserve for new windows and preserves it in saved templates", async () => {
  let savedPayload;
  const app = new LootgenApp({
    getModel: async () => ({ gear: [], materials: [] }),
    listLootgenTemplates: () => [],
    saveLootgenTemplate: async payload => { savedPayload = payload; return { id: "reserve", ...payload }; }
  }, { appKey: "coin-reserve" });
  assert.equal((await app._prepareContext({})).form.coinBudgetPercent, 20);
  app.applyLootgenTemplate({ form: { coinBudgetPercent: 35 } });
  await app.saveTemplateFromName("Резерв монет");
  assert.equal((await app._prepareContext({})).form.coinBudgetPercent, 35);
  assert.equal(savedPayload.form.coinBudgetPercent, 35);
  app.applyLootgenTemplate({ form: {} });
  assert.equal((await app._prepareContext({})).form.coinBudgetPercent, 0);
});

test("lootgen deletes a selected template only after confirmation", async () => {
  const removed = [];
  const template = { id: "codex-test", name: "Codex test", form: {} };
  const app = new LootgenApp({
    getLootgenTemplate: (id) => id === template.id ? template : null,
    removeLootgenTemplate: async (id) => {
      removed.push(id);
      return true;
    }
  }, { appKey: "delete-template" });

  assert.equal(await app.removeTemplateById(template.id, { confirm: async () => false }), false);
  assert.deepEqual(removed, []);
  assert.equal(await app.removeTemplateById(template.id, { confirm: async () => true }), true);
  assert.deepEqual(removed, [template.id]);
});

test("lootgen applies a selected template and remembers its selection", async () => {
  const template = {
    id: "small-cache",
    name: "Small cache",
    form: { itemCount: 4, budgetValue: 900 }
  };
  const app = new LootgenApp({
    getLootgenTemplate: (id) => id === template.id ? template : null
  }, { appKey: "apply-template" });

  await app.applyTemplateById(template.id, { render: false });

  assert.equal(app.itemCount, 4);
  assert.equal(app.budgetValue, 900);
  assert.equal(app.selectedTemplateId, template.id);
});

test("lootgen take-all delegates one batch instead of looping over row grants", () => {
  const source = readFileSync(new URL("../scripts/ui/lootgen-app.js", import.meta.url), "utf8");
  const body = source.match(/async #takeAllToInventory\(\) \{(?<body>[\s\S]*?)\n  \}\n\n  async #sendResultToChat/u)?.groups?.body ?? "";

  assert.match(body, /addLootgenRowsToInventory\(/u);
  assert.doesNotMatch(body, /addLootgenRowToInventory\(/u);
  assert.doesNotMatch(body, /\bfor\s*\(/u);
});

test("lootgen window delegates selection to the shared source catalog",async()=>{
  let seen;
  const app=new LootgenApp({lootgenSourceCatalog:{generate:async(form,options)=>{seen={form,options};return {rows:[],coins:{totalCopper:0},spentValue:0,budgetValue:form.budgetValue,totalItems:0,generatedAt:"test",hasResult:false};}}});
  const result=await app.generateFromForm({budgetValue:777,includeGear:false,includeMagicItems:true});
  assert.equal(seen.form.budgetValue,777);assert.equal(seen.form.includeGear,false);assert.equal(seen.form.includeMagicItems,true);assert.equal(result.budgetValue,777);
});

test("upgrade form choices round trip through the window and template",async()=>{
  let saved;
  const app=new LootgenApp({getModel:async()=>({gear:[]}),saveLootgenTemplate:async payload=>{saved=payload;return payload;}});
  const fields={enableUpgrades:true,upgradeChance:75,maxUpgradesPerItem:3,upgradeTypes:["Материал"],upgradeRanks:[2,4],enableFilledContainers:true,filledContainerChance:65,generationDepth:3};
  app.applyLootgenTemplate({form:fields});await app.saveTemplateFromName("Upgraded");
  const context=await app._prepareContext();
  for(const [key,value] of Object.entries(fields)){assert.deepEqual(saved.form[key],value);assert.deepEqual(context.form[key],value);}
});

test("filled-only window generation uses a stable GM preparation request",async()=>{
  const calls=[],state={resultVersion:2,generationReady:true,published:false,lootId:"filled",rows:[],coins:{totalCopper:0}};
  const app=new LootgenApp({prepareLootgenGeneratedResult:async(form,options)=>{calls.push({form,options});if(calls.length===1)throw new Error("retry");return {lootId:"filled",messageId:"message",state};},
    lootgenSourceCatalog:{generate:()=>{throw new Error("filled tree must use preparation");}}});
  const form={enableFilledContainers:true,filledContainerChance:100,generationDepth:2,enableUpgrades:false};
  await assert.rejects(app.generateFromForm(form),/retry/u);
  await app.generateFromForm(form);
  assert.equal(calls.length,2);assert.equal(calls[0].options.operationId,calls[1].options.operationId);
  for(const [key,value]of Object.entries(form))assert.equal(calls[1].form[key],value);
});

test("upgraded generation retries the same preparation and preserves separate trusted compositions on reopen",async()=>{
  const state={resultVersion:2,generationReady:true,published:false,lootId:"trusted",rows:[1,2].map(index=>({rowId:`row-${index}`,rowIndex:index-1,sourceType:"gear",sourceId:"sword",name:"Sword",quantity:1,totalValue:120,value:120,descriptor:{instanceKey:`host-${index}`},upgrades:[{name:"Sharp",decision:"simple-implemented"}]})),coins:{totalCopper:0},spentValue:240,budgetValue:300,totalItems:2};
  const calls=[];
  const api={prepareLootgenGeneratedResult:async(form,options)=>{calls.push({form,options});if(calls.length===1)throw new Error("request lost");return {lootId:"trusted",messageId:"message",state:structuredClone(state)};},
    getLootgenGeneratedResult:()=>({lootId:"trusted",messageId:"message",state:structuredClone(state)}),
    lootgenSourceCatalog:{generate:()=>{throw new Error("upgrades must be prepared by GM");}},getModel:async()=>({gear:[]})};
  const app=new LootgenApp(api);
  await assert.rejects(app.generateFromForm({enableUpgrades:true,upgradeChance:100}),/request lost/u);
  const generated=await app.generateFromForm({enableUpgrades:true,upgradeChance:100});
  assert.equal(calls[0].options.operationId,calls[1].options.operationId);
  assert.equal(generated.rows.length,2);assert.equal(generated.resultVersion,2);assert.equal(app.chatLootId,"trusted");
  const reopened=new LootgenApp(api,{sharedResult:{resultVersion:2,lootId:"trusted",rows:[{name:"forged"}]}});
  assert.equal(reopened.generated.rows.length,2);assert.equal(reopened.generated.rows[0].name,"Sword");
  state.rows[0].claimed=true;
  reopened.restoreGeneratedResult({resultVersion:2,lootId:"trusted"});
  assert.equal(reopened.generated.rows[0].claimed,true);assert.equal(reopened.chatLootId,"trusted");
});

test("prepared window actions publish the same result, preserve claim IDs after failure, and clear only its view",async()=>{
  const previousElement=globalThis.HTMLElement,previousChat=globalThis.ChatMessage,previousConsole=console.error;
  class Element {
    constructor(dataset={}){this.dataset=dataset;this.listeners={};}
    addEventListener(type,listener){this.listeners[type]=listener;}
  }
  globalThis.HTMLElement=Element;console.error=()=>{};
  const statuses=[],calls=[];
  globalThis.ChatMessage={getSpeaker:()=>({}),create:async data=>{statuses.push(data);}};
  let state={resultVersion:2,lootId:"window-result",generationReady:true,published:false,rows:[{rowId:"row",rowIndex:0,name:"Sword",quantity:1,value:120,totalValue:120,claimed:false}],coins:{gp:1,totalCopper:100},spentValue:120,budgetValue:220,totalItems:1};
  const result=()=>({messageId:"message",lootId:state.lootId,state:structuredClone(state)});
  let fail=true;
  try {
    const api={getLootgenGeneratedResult:result,publishLootgenGeneratedResult:async lootId=>{calls.push(["publish",lootId]);state.published=true;return result();},
      claimLootgenChatRowToInventory:async(lootId,rowId,options)=>{calls.push(["row",lootId,rowId,options]);if(fail){fail=false;throw new Error("target write failed");}state.rows[0].claimed=true;return true;},
      claimLootgenChatAllToInventory:async(lootId,options)=>{calls.push(["all",lootId,options]);state.coinsClaimed=true;return true;}};
    const app=new LootgenApp(api,{sharedResult:{resultVersion:2,lootId:state.lootId}});
    const nodes=new Map(["lootgen-send-chat","lootgen-take-row","lootgen-take-all","lootgen-take-coins","lootgen-clear"].map(action=>[action,new Element({action,rowIndex:"0"})]));
    const root=new Element();root.querySelector=selector=>nodes.get(selector.match(/data-action='([^']+)'/u)?.[1])??null;
    root.querySelectorAll=selector=>{const node=root.querySelector(selector);return node?[node]:[];};app.element=root;
    await app._onRender({},{});
    const click=async action=>{const node=nodes.get(action);await node.listeners.click({currentTarget:node});};
    await click("lootgen-send-chat");assert.equal(state.published,true);
    await click("lootgen-take-row");await click("lootgen-take-row");
    const rowCalls=calls.filter(call=>call[0]==="row");assert.equal(rowCalls.length,2);assert.equal(rowCalls[0][3].claimId,rowCalls[1][3].claimId);
    assert.equal(app.generated.rows[0].claimed,true);
    await click("lootgen-take-coins");assert.equal(calls.at(-1)[2].coinsOnly,true);
    await click("lootgen-take-all");assert.equal(calls.at(-1)[0],"all");
    await click("lootgen-clear");
    const clear=statuses.at(-1).flags["rebreya-main"].lootgenStatus;
    assert.deepEqual(clear.payload,{resultVersion:2,lootId:state.lootId,hasResult:true});
    assert.equal(state.rows.length,1);assert.equal(app.generated.hasResult,false);
  }finally{globalThis.HTMLElement=previousElement;globalThis.ChatMessage=previousChat;console.error=previousConsole;}
});

test("lootgen template path uses a server-loadable extension without URL parameters",()=>{
  assert.equal(LootgenApp.PARTS.main.template,"modules/rebreya-main/templates/lootgen-app.hbs");
});

test("claimed external coins do not become internal container coins when a window reopens",async()=>{
  const state={resultVersion:2,generationReady:true,lootId:"coins",rows:[],coinsClaimed:true,coins:{gp:3,totalCopper:300},currencyValue:500};
  const app=new LootgenApp({getLootgenGeneratedResult:()=>({messageId:"message",state})},{sharedResult:{resultVersion:2,lootId:"coins"}});
  const context=await app._prepareContext();
  assert.equal(context.generated.internalCurrencyValue,200);assert.equal(context.generated.coins.totalCopper,0);
});
