const KEYS=["criticalSuccess","criticalFailure"];
const die=roll=>roll?.d20??roll?.terms?.find(term=>term.faces===20);
const thresholds=options=>Object.fromEntries(KEYS.map(key=>[key,options?.[key]]));

export function captureFirearmMisfire(roll,result,address){
  return {...address,jammed:result.jammed===true,cancelled:false,threshold:result.threshold,rollTotal:result.rollTotal,
    originalIsFumble:roll.isFumble===true,originalIsCritical:roll.isCritical===true,
    rollOptions:thresholds(roll.options),dieOptions:thresholds(die(roll)?.options)};
}

export function applyFirearmMisfireToRoll(roll,state){
  if(!roll||!state)return;
  roll.options??={};roll.options.rebreyaFirearmMisfire=state;
  for(const [options,original] of [[roll.options,state.rollOptions],[die(roll)?.options,state.dieOptions]]){
    if(!options)continue;
    if(state.jammed&&!state.cancelled){options.criticalSuccess=21;options.criticalFailure=20;}
    else for(const key of KEYS){if(original?.[key]===undefined)delete options[key];else options[key]=original[key];}
  }
}

export function activeFirearmMisfire(workflow){
  const state=workflow?.rebreyaFirearmMisfire??workflow?.attackRoll?.options?.rebreyaFirearmMisfire
    ??workflow?.chatCard?.getFlag?.("rebreya-main","firearmMisfire")??workflow?.chatCard?.flags?.["rebreya-main"]?.firearmMisfire;
  return state?.jammed&&!state.cancelled?state:null;
}
