import test from 'node:test';
import assert from 'node:assert/strict';
import { createOverlayDom } from './helpers/overlay-dom.mjs';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

let handlebars;
try {handlebars=createRequire(import.meta.url)('handlebars');}catch{}

test('rendered ghost is removable and mechanically empty; authored names are escaped and readonly controls disabled', {skip:!handlebars && 'Foundry Handlebars dependency not available (set NODE_PATH)'}, async()=>{
  const template=await readFile(new URL('../templates/hero-doll-tab.hbs',import.meta.url),'utf8');
  const render=handlebars.compile(template);
  const html=render({heroDollTab:{id:'heroDoll',group:'primary'},heroDoll:{canEditPresets:false,presets:[{id:'p',name:'<img src=x>',selected:true}],
    slots:[{id:'neck',area:'neck',label:'Шея',ghost:true,occupied:false,itemImg:'missing.webp',itemName:'<img src=x>',title:'Предмет отсутствует'}]}});
  const surface=html.match(/<button[^>]*data-hero-doll-slot="true"[\s\S]*?<\/button>/)?.[0];
  assert.ok(surface);assert.doesNotMatch(surface,/data-item-id|open-slot-item|is-occupied/);
  assert.match(surface,/is-ghost/);assert.match(surface,/data-hero-doll-ghost-image/);assert.match(surface,/&lt;img/);
  assert.match(html,/<option value="p" selected>&lt;img src&#x3D;x&gt;<\/option>/);
  assert.match(html,/data-action="clear-slot"[^>]*aria-label="Убрать силуэт"[^>]*disabled/);
  for(const action of ['apply','save','manage'])assert.match(html,new RegExp(`data-preset-command="${action}"[^>]*disabled`));
});

test('preset naming safely escapes authored names and cancellation never mutates the actor',async()=>{
  const {handleHeroDollPresetAction}=await import('../scripts/ui/hero-doll-presets-ui.js');
  let promptOptions,writes=0;
  const dialog={prompt:async options=>{promptOptions=options;return null;}};
  const service={getActorSnapshot:()=>({presets:[{id:'p',name:'<img onerror="bad">'}]}),renamePreset:()=>writes++};
  await handleHeroDollPresetAction('rename',{actor:{},service,presetId:'p',dialog});
  assert.equal(writes,0);assert.match(promptOptions.content,/&lt;img/);assert.doesNotMatch(promptOptions.content,/<img/);
  assert.equal(promptOptions.ok.callback(null,{form:{elements:{name:{value:'  Поход  '}}}}),'Поход');
});
test('apply/save/clear and confirmed deletion invoke canonical service; cancelled deletion preserves set',async()=>{
  const {handleHeroDollPresetAction}=await import('../scripts/ui/hero-doll-presets-ui.js');
  const effects=[];const service={getActorSnapshot:()=>({presets:[{id:'p',name:'Бой'}]})};
  for(const method of ['applyPreset','savePreset','clearGhost','deletePreset'])service[method]=async(actor,id)=>effects.push([method,id]);
  const options={actor:{},service,presetId:'p',slotId:'neck',dialog:{confirm:async()=>false}};
  await handleHeroDollPresetAction('apply',options);await handleHeroDollPresetAction('save',options);await handleHeroDollPresetAction('clear-ghost',options);
  await handleHeroDollPresetAction('delete',options);assert.deepEqual(effects,[['applyPreset','p'],['savePreset','p'],['clearGhost','neck']]);
  options.dialog.confirm=async()=>true;await handleHeroDollPresetAction('delete',options);assert.equal(effects.at(-1)[0],'deletePreset');
});
test('preset controls select without mutation, reject simultaneous actions and detach on abort',async()=>{
  const {bindHeroDollPresetControls}=await import('../scripts/ui/hero-doll-presets-ui.js');
  const dom=createOverlayDom(),{owner:panel,anchor:button}=dom.fixture(),select=new dom.Element();panel.append(select);
  button.dataset.presetCommand='apply';select.value='p';select.dataset.heroDollPresetSelect='true';
  panel.querySelector=()=>select;panel.querySelectorAll=()=>[button];button.closest=()=>button;
  const controller=new AbortController();let finish,applies=0,selected='',renders=0;
  const service={selectPreset:(_,id)=>selected=id,applyPreset:()=>{applies++;return new Promise(resolve=>finish=resolve);}};
  bindHeroDollPresetControls(panel,{actor:{},service,rerender:async()=>renders++,signal:controller.signal});
  await select.emit('change');assert.equal(selected,'p');assert.equal(applies,0);
  const event={target:button,preventDefault(){},stopPropagation(){}};
  const pending=panel.emit('click',event);await panel.emit('click',event);assert.equal(applies,1);
  finish();await pending;assert.equal(renders,1);controller.abort();await panel.emit('click',event);assert.equal(applies,1);
});
test('ghost image failure uses safe local fallback once and abort removes the listener',async()=>{
  const {bindHeroDollPresetControls}=await import('../scripts/ui/hero-doll-presets-ui.js');
  const dom=createOverlayDom(),{owner:panel,anchor:image}=dom.fixture();image.dataset.heroDollGhostImage='true';image.src='missing.webp';
  panel.querySelector=()=>null;panel.querySelectorAll=selector=>selector.includes('ghost')?[image]:[];
  const controller=new AbortController();bindHeroDollPresetControls(panel,{actor:{},service:{},signal:controller.signal});
  await image.emit('error');assert.equal(image.src,'icons/svg/item-bag.svg');
  image.src='after-abort.webp';controller.abort();await image.emit('error');assert.equal(image.src,'after-abort.webp');
});
