import test from "node:test";
import assert from "node:assert/strict";
import { registerCombatHooks } from "../scripts/combat/hooks.js";

test("activity stops before consumption when its synthetic source token left the scene", () => {
  const oldGame=globalThis.game, oldHooks=globalThis.Hooks, oldUi=globalThis.ui;
  const handlers=new Map(), warnings=[];
  globalThis.game={}; globalThis.Hooks={on(name,fn){const list=handlers.get(name)??[]; list.push(fn); handlers.set(name,list);}};
  globalThis.ui={notifications:{warn(message){warnings.push(message);}}};
  try {
    registerCombatHooks({ magicItemsCompendium: {} });
    const preUse=handlers.get("dnd5e.preUseActivity")[0];
    const tokens=new Map(), scene={documentName:"Scene",tokens};
    const token={id:"same",parent:scene}, actor={isToken:true,token}; tokens.set(token.id,token);
    assert.equal(preUse({actor}),true); assert.equal(warnings.length,0);
    tokens.delete(token.id);
    assert.equal(preUse({actor}),false); assert.match(warnings[0],/лист|токен/iu);
    let laterHookCalled=false;
    const hookChain=[preUse,()=>{laterHookCalled=true;return true;}];
    assert.equal(hookChain.every(callback=>callback({actor})!==false),false);
    assert.equal(laterHookCalled,false,"stale source stops the pre-use chain before later hooks");
    assert.equal(preUse({item:{actor}}),false);
    tokens.set(token.id,{id:token.id,parent:scene});
    assert.equal(preUse({actor}),false,"reused ID must not identify a different token");
    assert.equal(preUse({actor:{isToken:false}}),true);
    assert.equal(preUse({actor:{isToken:true,token:{id:"x",parent:{documentName:"Scene"}}}}),true);
    assert.equal(preUse({actor:{isToken:true,token:{id:"x",parent:{documentName:"Scene",tokens:{get(){throw new Error("unavailable");}}}}}}),true);
    assert.equal(preUse({}),true);
  } finally { globalThis.game=oldGame; globalThis.Hooks=oldHooks; globalThis.ui=oldUi; }
});
