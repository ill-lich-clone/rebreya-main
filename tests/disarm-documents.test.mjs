import test from "node:test";
import assert from "node:assert/strict";
import { collectDisarmDropPoints, DisarmDocuments } from "../scripts/infrastructure/foundry/disarm-documents.js";
test("random candidates exclude walls and scene borders before rolling",()=>{
  const scene={grid:{size:100,type:1}};
  const token={x:100,y:100,width:1,height:1,parent:scene,object:{checkCollision:p=>p.x>150}};
  const canvas={grid:{isHexagonal:false},dimensions:{sceneRect:{contains:(x,y)=>x>=0&&y>=100&&x<=400&&y<=400}}};
  const points=collectDisarmDropPoints(token,canvas);
  assert.deepEqual(points.map(p=>p.direction),[5,6,7]);
  assert.ok(points.every(p=>p.x<=150&&p.y>=100));
  token.object.checkCollision=()=>true;assert.deepEqual(collectDisarmDropPoints(token,canvas),[]);
});
test("gridless uses adjacent directions and hex uses public grid neighbours",()=>{
  const token={x:100,y:100,width:1,height:1,parent:{grid:{size:100,type:0}},object:{checkCollision:()=>false}};
  const canvas={grid:{isHexagonal:false},dimensions:{sceneRect:{contains:()=>true}}};
  assert.equal(collectDisarmDropPoints(token,canvas).length,8);
  canvas.grid={isHexagonal:true,getOffset:p=>({i:1,j:1}),getAdjacentOffsets:()=>[{i:0,j:1},{i:2,j:1}],getCenterPoint:p=>({x:150,y:p.i*100+50})};
  assert.equal(collectDisarmDropPoints(token,canvas).length,2);
});

test("live token gate rejects other owners, hidden targets, walls and two linked tokens of one actor", async () => {
  const player = { id: "player", isGM: false };
  const scene = { id: "scene", grid: { size: 100 } };
  let owned = true, blocked = false;
  const source = { uuid: "source", x: 0, y: 0, width: 1, height: 1, parent: scene,
    actor: { uuid: "Actor.a", testUserPermission: () => owned }, object: { checkCollision: () => blocked } };
  const target = { ...source, uuid: "target", x: 100, actor: { uuid: "Actor.b" } };
  const service = new DisarmDocuments({ resolve: async id => id === "source" ? source : target,
    gameProvider: () => ({ system: { id: "dnd5e" }, users: new Map([[player.id, player]]) }), canvasProvider: () => ({ scene }) });
  const intent = { sourceTokenUuid: "source", targetTokenUuid: "target" };
  await service.tokens(intent, player);
  owned = false; await assert.rejects(service.tokens(intent, player), e => e.code === "unauthorized"); owned = true;
  target.hidden = true; await assert.rejects(service.tokens(intent, player), e => e.code === "target-not-visible"); target.hidden = false;
  blocked = true; await assert.rejects(service.tokens(intent, player), e => e.code === "target-not-visible"); blocked = false;
  target.actor = source.actor; await assert.rejects(service.tokens(intent, player), e => e.code === "invalid-tokens");
});
