import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createOverlayDom } from './helpers/overlay-dom.mjs';

test('hero slot template keeps names outside fixed squares and has accessible custom tooltips', async () => {
  const template=await readFile(new URL('../templates/hero-doll-tab.hbs',import.meta.url),'utf8');
  const button=template.slice(template.indexOf('class="rm-hero-doll-slot__surface'),template.indexOf('</button>',template.indexOf('class="rm-hero-doll-slot__surface')));
  assert.equal(/title=|slot__copy|<strong>|<small>/.test(button),false);
  assert.equal(/aria-label=/.test(button),true);
  assert.equal(/data-rm-tooltip="\{\{ title \}\}"/.test(button),true);
  assert.equal(/\{\{\{/.test(button),false);
  const css=await readFile(new URL('../styles/main.css',import.meta.url),'utf8');
  const surface=css.match(/\.rm-hero-doll-slot__surface\s*\{([^}]+)\}/u)?.[1]??'';
  for(const prop of ['inline-size','block-size','min-inline-size','min-block-size']) assert.ok(surface.includes(`${prop}: 80px`),prop);
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
