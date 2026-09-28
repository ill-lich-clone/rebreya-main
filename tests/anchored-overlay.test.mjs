import test from 'node:test';
import assert from 'node:assert/strict';
import { createOverlayDom } from './helpers/overlay-dom.mjs';
import { calculateAnchoredOverlayPosition as place, AnchoredOverlay, bindAnchoredTooltips } from '../scripts/ui/anchored-overlay.js';

test('bottom-right anchor flips and stays inside viewport', () => {
  const p = place({left:1200,right:1270,top:620,bottom:700}, {width:224,height:200}, {width:1280,height:720});
  assert.deepEqual(p, { placement:'top', left:1048, top:414, width:224, maxHeight:200 });
});
test('oversized content receives a scrollable height and constrained width', () => {
  const p = place({left:10,right:90,top:100,bottom:180}, {width:600,height:1500}, {width:400,height:720});
  assert.equal(p.placement, 'bottom'); assert.equal(p.maxHeight, 526); assert.equal(p.width, 384);
});
test('overlay geometry rejects nonfinite or negative dimensions', () => {
  for (const width of [NaN, Infinity, -1]) assert.throws(() => place(
    {left:0,right:80,top:0,bottom:80}, {width,height:100}, {width:400,height:720}));
});
test('show replaces one portal and close releases observers and callbacks once', () => {
  const dom = createOverlayDom(); const {owner,anchor,content} = dom.fixture(); let closes=0;
  const overlay = new AnchoredOverlay({ownerElement:owner,resolveAnchor:()=>anchor,onClose:()=>closes++});
  overlay.show(content); overlay.show(content); overlay.show(content);
  assert.equal(dom.document.body.children.length, 2);
  assert.equal(overlay.element.contains(content), true);
  overlay.close(); overlay.destroy(); overlay.destroy();
  assert.equal(closes,1); assert.equal(dom.document.body.children.length,1);
  assert.ok(dom.observers.every(o=>o.disconnected)); assert.equal(dom.frames.size,0);
});
test('reposition resolves replacement anchor and closes a detached owner', () => {
  const dom=createOverlayDom(); const {owner,anchor,content}=dom.fixture(); let current=anchor;
  const overlay=new AnchoredOverlay({ownerElement:owner,resolveAnchor:()=>current}); overlay.show(content);
  const replacement=new dom.Element(); replacement.rect={left:1200,right:1270,top:620,bottom:700,width:70,height:80};
  anchor.remove(); owner.append(replacement); current=replacement; overlay.reposition();
  assert.equal(overlay.element.style.left,'1048px'); assert.equal(overlay.element.style.top,'414px');
  owner.remove(); overlay.reposition(); assert.equal(overlay.element,null);
});
test('scroll and owner motion schedule fresh placement; Escape closes only the top overlay', async () => {
  const dom=createOverlayDom(); const first=dom.fixture(), second=dom.fixture();
  const a=new AnchoredOverlay({ownerElement:first.owner,resolveAnchor:()=>first.anchor});
  const b=new AnchoredOverlay({ownerElement:second.owner,resolveAnchor:()=>second.anchor});
  a.show(first.content); b.show(second.content);
  second.anchor.rect={left:1200,right:1270,top:620,bottom:700,width:70,height:80};
  await dom.events.emit('scroll'); dom.flush(); assert.equal(b.element.style.left,'1048px');
  let stopped=false;
  await dom.events.emit('keydown',{key:'Escape',preventDefault(){},stopImmediatePropagation(){stopped=true;}});
  assert.equal(b.element,null); assert.ok(a.element); assert.equal(stopped,true);
  assert.equal(dom.document.activeElement,second.anchor); a.destroy(); b.destroy();
});

test('destroying tooltip bindings prevents future hover from recreating a portal', async () => {
  const dom=createOverlayDom(); const {owner,anchor}=dom.fixture(); anchor.dataset.rmTooltip='Имя';
  const binding=bindAnchoredTooltips(owner,[anchor]);
  await anchor.emit('mouseenter'); assert.equal(dom.document.body.children.length,2);
  binding.destroy(); await anchor.emit('mouseenter'); assert.equal(dom.document.body.children.length,1);
  assert.equal(anchor.listeners.get('mouseenter').size,0);
});
