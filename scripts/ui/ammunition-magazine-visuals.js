import { inferRebreyaWeaponAmmunitionSubtype } from "../data/ammunition-types.js";

const ROOT="modules/rebreya-main/assets/ammunition/";
// Visible opaque bounds, measured from the original PNGs. Crop at render time;
// transparent padding must not change the cartridge's center or aspect ratio.
const SPRITES={
  rifle:{file:"rifle-cartridge.png",width:2172,height:724,viewBox:"14 174 2144 364",aspect:2144/364},
  shell:{file:"shotgun-shell.png",width:2170,height:725,viewBox:"49 84 2079 556",aspect:2079/556},
  ball:{file:"primitive-ball.png",width:1254,height:1254,viewBox:"154 150 947 952",aspect:947/952}
};
const LEFT=[[112,91],[132,160],[124,217],[80,294]];
const RIGHT=[[151,71],[177,151],[156,261],[113,321]];
export const MAGAZINE_WINDOW="M112 91 L151 71 C177 151 156 261 113 321 L80 294 C124 217 132 160 112 91 Z";
const point=(edge,t)=>edge[0].map((_,d)=>edge.reduce((n,p,i)=>n+p[d]*[(1-t)**3,3*(1-t)**2*t,3*(1-t)*t*t,t**3][i],0));

export function resolveMagazinePresentation(weapon={},capacity=0){
  const flags=weapon.flags?.["rebreya-main"]??{};
  const primitive=weapon.system?.type?.value==="firearmPrimitive"||flags.firearmClass==="primitive";
  const subtype=weapon.system?.ammunition?.type||inferRebreyaWeaponAmmunitionSubtype(weapon);
  const kind=primitive?"muzzle":subtype==="rebreyaShotgun"?(capacity<=2?"shotgun-chambers":"shotgun-tube"):
    (!subtype||subtype==="rebreyaRifle")&&capacity>2?"curved":"cells";
  const isCurved=kind==="curved",isTube=kind==="shotgun-tube",isMuzzle=kind==="muzzle";
  const raw=SPRITES[isMuzzle?"ball":subtype==="rebreyaShotgun"?"shell":"rifle"];
  const columns=capacity===1||kind==="shotgun-chambers"?1:2,rows=Math.ceil(capacity/columns),height=Math.max(320,rows*100);
  return {kind,isCurved,isTube,isMuzzle,isGrid:!isCurved&&!isTube,
    title:isMuzzle?"Заряды":kind==="shotgun-chambers"?"Патронники":isTube?"Трубчатый магазин":isCurved?"Магазин":"Ячейки зарядки",
    order:isMuzzle?"Порядок зарядки":kind==="shotgun-chambers"?"Первый выстрел — сверху":isCurved||isTube?"Первый патрон — сверху":"Порядок выстрелов",
    subtitle:isMuzzle?"Заряжание оружия":"Снаряжение магазина",unit:isMuzzle?"зарядов":"патронов",
    viewBox:isCurved?"25 25 170 330":`0 0 200 ${height}`,height,columns,windowPath:MAGAZINE_WINDOW,
    sprite:{...raw,url:ROOT+raw.file},body:ROOT+"magazine-body.png"};
}

export function buildCartridgeLayout(presentation,capacity){
  const slots=Array.from({length:capacity},(_,position)=>{
    const t=(position+.5)/capacity;
    let x,y,angle=0,width;
    if(presentation.isCurved){
      const l=point(LEFT,t),r=point(RIGHT,t),dx=r[0]-l[0],dy=r[1]-l[1];
      x=(l[0]+r[0])/2;y=(l[1]+r[1])/2;angle=Math.atan2(dy,dx)*180/Math.PI;width=Math.hypot(dx,dy)*.84;
    }else if(presentation.isTube){x=100;y=35+t*250;angle=90;width=Math.min(76,230/capacity);}
    else{const rows=Math.ceil(capacity/presentation.columns),step=presentation.height/rows;
      x=presentation.columns===1?100:50+position%2*100;y=(Math.floor(position/presentation.columns)+.5)*step;
      width=presentation.isMuzzle?(capacity===1?88:48):(presentation.columns===1?134:78);
    }
    return {position,x,y,angle,width,height:width/presentation.sprite.aspect};
  });
  // Keep dense magazines readable, including the small rotation between neighbors.
  if(presentation.isCurved){
    let scale=1;
    for(let i=1;i<slots.length;i++){
      const a=slots[i-1],b=slots[i],normal=(a.angle+b.angle)/2*Math.PI/180;
      const spacing=(b.x-a.x)*-Math.sin(normal)+(b.y-a.y)*Math.cos(normal);
      const support=s=>s.width/2*Math.abs(Math.sin(s.angle*Math.PI/180-normal))+s.height/2*Math.abs(Math.cos(s.angle*Math.PI/180-normal));
      scale=Math.min(scale,spacing/(support(a)+support(b))*.92);
    }
    for(const slot of slots){slot.width*=scale;slot.height*=scale;}
  }
  return slots.map(slot=>({...slot,left:-slot.width/2,top:-slot.height/2,boreRadius:capacity===1?58:35,
    frameLeft:presentation.columns===1?-76:-44,frameWidth:presentation.columns===1?152:88}));
}

export function buildMagazineBand(presentation,start,size,capacity,slots){
  if(presentation.isTube)return `M88 ${35+250*start/capacity}h24v${250*size/capacity}h-24Z`;
  if(!presentation.isCurved)return slots.map(s=>{
    if(presentation.isMuzzle){const r=s.boreRadius;return `M${s.x-r} ${s.y}a${r} ${r} 0 1 0 ${r*2} 0a${r} ${r} 0 1 0 ${-r*2} 0Z`;}
    const x=s.x+s.frameLeft,y=s.y-48,w=s.frameWidth,r=24;
    return `M${x+r} ${y}h${w-2*r}q${r} 0 ${r} ${r}v48q0 ${r} ${-r} ${r}h${-w+2*r}q${-r} 0 ${-r} ${-r}v-48q0 ${-r} ${r} ${-r}Z`;
  }).join(" ");
  const from=start/capacity,to=(start+size)/capacity;
  const side=edge=>Array.from({length:9},(_,i)=>point(edge,from+(to-from)*i/8));
  const points=[...side(LEFT),...side(RIGHT).reverse()];
  return "M"+points.map(p=>p.join(" ")).join(" L")+" Z";
}
