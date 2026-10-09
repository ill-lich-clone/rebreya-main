import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createOverlayDom } from './helpers/overlay-dom.mjs';

test('hero slot template shows its name inside only an empty square and keeps accessible custom tooltips', async () => {
  const template=await readFile(new URL('../templates/hero-doll-tab.hbs',import.meta.url),'utf8');
  const slot=template.slice(template.indexOf('<div class="rm-hero-doll-slot'),template.indexOf('</div>',template.indexOf('</button>',template.indexOf('<div class="rm-hero-doll-slot')))+6);
  const button=template.slice(template.indexOf('class="rm-hero-doll-slot__surface'),template.indexOf('</button>',template.indexOf('class="rm-hero-doll-slot__surface')));
  assert.equal(/title=|slot__copy|<strong>|<small>/.test(button),false);
  assert.equal(/rm-hero-doll-slot__label/.test(slot),false);
  assert.match(button,/\{\{else\}\}[\s\S]*rm-hero-doll-slot__empty[\s\S]*\{\{ label \}\}/u);
  assert.equal(/aria-label=/.test(button),true);
  assert.equal(/data-rm-tooltip="\{\{ title \}\}"/.test(button),true);
  assert.equal(/\{\{\{/.test(button),false);
  const css=await readFile(new URL('../styles/main.css',import.meta.url),'utf8');
  const surface=css.match(/\.rm-hero-doll-slot__surface\s*\{([^}]+)\}/u)?.[1]??'';
  for(const prop of ['inline-size','block-size','min-inline-size','min-block-size']) assert.ok(surface.includes(`${prop}: 68px`),prop);
});

test('compact hero doll preserves anatomical placements and reserves the narrow column for inventory', async () => {
  const css=await readFile(new URL('../styles/main.css',import.meta.url),'utf8');
  const layoutRules=[...css.matchAll(/\.rm-hero-doll-tab__layout\s*\{([^}]+)\}/gu)];
  assert.equal(layoutRules.length,1,'no responsive rule may replace the two-column layout');
  assert.match(layoutRules[0][1],/grid-template-columns:\s*minmax\(420px,\s*460px\)\s+minmax\(220px,\s*1fr\)/u);
  assert.match(layoutRules[0][1],/min-width:\s*654px/u);
  assert.match(css,/\.tab\.rm-hero-doll-tab\s*\{[^}]*overflow-x:\s*auto/u);
  assert.match(css,/\.rm-hero-doll-grid\s*\{[^}]*grid-template-columns:\s*repeat\(5,\s*68px\)/u);
  assert.match(css,/\.rm-hero-doll-grid\s*\{[^}]*grid-template-rows:\s*repeat\(8,\s*68px\)/u);
  assert.match(css,/\.rm-hero-doll-slot--head\s*\{\s*grid-column:\s*3;\s*grid-row:\s*1/u);
  assert.match(css,/\.rm-hero-doll-slot--ring3\s*\{\s*grid-column:\s*1;\s*grid-row:\s*4/u);
  assert.match(css,/\.rm-hero-doll-slot--back6\s*\{\s*grid-column:\s*2;\s*grid-row:\s*8/u);
  assert.match(css,/\.rm-hero-doll-slot--back7\s*\{\s*grid-column:\s*4;\s*grid-row:\s*8/u);
  assert.match(css,/\.rm-hero-doll-slot--clothing\s*\{\s*grid-column:\s*3;\s*grid-row:\s*8/u);
  assert.doesNotMatch(css,/@container rm-hero-doll-board \(max-width: 467px\)[\s\S]*?\.rm-hero-doll-slot\s*\{\s*grid-column:\s*auto/u);
  assert.doesNotMatch(css,/@container rm-hero-doll-board \(max-width: 467px\)[\s\S]*?\.rm-hero-doll-grid::before\s*\{\s*display:\s*none/u);
  const globalNarrow=css.match(/@media \(max-width: 1200px\)\s*\{([\s\S]*?)@media \(max-width: 760px\)/u)?.[1]??'';
  assert.doesNotMatch(globalNarrow,/\.rm-hero-doll-tab__layout\s*,/u);
  assert.doesNotMatch(globalNarrow,/\.rm-hero-doll-grid\s*\{\s*min-height:\s*480px/u);
});

test('hero doll slot menu contains only inventory items compatible with the selected slot', async () => {
  const { buildHeroDollSlotMenuItems }=await import('../scripts/integrations/dnd5e-sheet-extensions.js');
  const snapshot={inventoryItems:[
    {id:'amulet',itemUuid:'Actor.a.Item.amulet',name:'Амулет',img:'amulet.webp',allowedSlots:['neck']},
    {id:'sword',itemUuid:'Actor.a.Item.sword',name:'Меч',img:'sword.webp',allowedSlots:['leftHand','rightHand']},
    {id:'scarf',itemUuid:'Actor.a.Item.scarf',name:'Шарф',img:'scarf.webp',allowedSlots:['neck']},
    {id:'broken',itemUuid:'',name:'Без UUID',img:'',allowedSlots:['neck']}
  ]};

  assert.deepEqual(buildHeroDollSlotMenuItems(snapshot,'neck'),[
    {id:'amulet',itemUuid:'Actor.a.Item.amulet',label:'Амулет',image:'amulet.webp'},
    {id:'scarf',itemUuid:'Actor.a.Item.scarf',label:'Шарф',image:'scarf.webp'}
  ]);
  assert.deepEqual(buildHeroDollSlotMenuItems(snapshot,'clothing'),[]);
});

test('hero doll temporarily folds the native portrait without changing its collapsed preference', async () => {
  const css=await readFile(new URL('../styles/main.css',import.meta.url),'utf8');
  assert.match(css,/\.dnd5e2\.sheet\.actor\.character:not\(\.sidebar-collapsed\):has\(\.rm-hero-doll-tab\.active\) \.main-content\s*\{[^}]*grid-template-columns:\s*0\s+1fr/u);
  assert.match(css,/\.dnd5e2\.sheet\.actor\.character:not\(\.sidebar-collapsed\):has\(\.rm-hero-doll-tab\.active\) \.main-content\s*>\s*\.sidebar\s*\{[^}]*margin-left:\s*calc\(var\(--dnd5e-sheet-sidebar-width\)\s*\*\s*-1\)/u);
});

test('hero tooltip preserves distinct IDs and treats long HTML-like names as text; rebind aborts old handlers', async () => {
  const { bindHeroDollTooltips }=await import('../scripts/integrations/dnd5e-sheet-extensions.js');
  const dom=createOverlayDom(); const {owner,anchor}=dom.fixture(); const second=new dom.Element(); owner.append(second);
  const name='<img src=x onerror=alert(1)> '+ 'Длинный амулет '.repeat(12);
  anchor.dataset={itemId:'amulet-a',rmTooltip:name}; second.dataset={itemId:'amulet-b',rmTooltip:name};
  owner.querySelectorAll=()=>[anchor,second];
  const firstController=new AbortController(); bindHeroDollTooltips(owner,owner,{signal:firstController.signal});
  assert.equal(anchor.getAttribute('aria-label'),name);
  await anchor.emit('mouseenter');
  let portal=dom.document.body.children.find(e=>e.dataset.rmAnchoredOverlay);
  assert.equal(portal.children[0].textContent,name.trim()); assert.equal(portal.children[0].children.length,0);
  await anchor.emit('mouseleave'); assert.equal(portal.isConnected,false);
  firstController.abort(); const controller=new AbortController(); bindHeroDollTooltips(owner,owner,{signal:controller.signal});
  await second.emit('focus');
  assert.equal(dom.document.body.children.filter(e=>e.dataset.rmAnchoredOverlay).length,1);
  assert.equal(anchor.dataset.itemId,'amulet-a'); assert.equal(second.dataset.itemId,'amulet-b');
  await second.emit('blur'); assert.equal(dom.document.body.children.length,1);
  controller.abort(); assert.ok(dom.observers.every(o=>o.disconnected));
});
