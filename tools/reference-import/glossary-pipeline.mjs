import { createHash } from "node:crypto";

import { GLOSSARY_SHEET_DEFINITION } from "./sheet-definitions.mjs";

const sourceText = value => String(value ?? "").replace(/\r\n?/gu,"\n");
const clean = value => sourceText(value).trim();
const identity = value => clean(value).normalize("NFKC").replace(/\s+/gu," ").toLocaleLowerCase("ru");
const stableTermId = (section,name) => createHash("sha256")
  .update(`${identity(section)}\u0000${identity(name)}`,"utf8")
  .digest("hex")
  .slice(0,24);

function rowValues(row) {
  return Array.isArray(row) ? row.map(sourceText) : [];
}

function hasContent(values) {
  return values.some(value=>clean(value)!=="");
}

function parseTermLabel(value) {
  const label=clean(value);
  const match=label.match(/^(.*\S)\s+\[([^\[\]\r\n]+)\]$/u);
  return match
    ? {name:clean(match[1]),sourceLabel:clean(match[2])}
    : {name:label,sourceLabel:""};
}

export function buildGlossaryArtifacts({spreadsheetId,importedAt,values}) {
  if(!Array.isArray(values))throw new TypeError("glossary values must be an array");
  const headerIndex=GLOSSARY_SHEET_DEFINITION.headerRow-1;
  const headers=GLOSSARY_SHEET_DEFINITION.headers.map((_header,column)=>sourceText(values[headerIndex]?.[column]));
  if(JSON.stringify(headers)!==JSON.stringify(GLOSSARY_SHEET_DEFINITION.headers)){
    throw new Error(`invalid glossary headers: ${headers.join(" | ")}`);
  }

  const preambleRows=values.slice(0,headerIndex).flatMap((row,index)=>{
    const cells=rowValues(row);
    return hasContent(cells)?[{rowNumber:index+1,values:cells}]:[];
  });
  const rows=values.slice(GLOSSARY_SHEET_DEFINITION.dataStartRow-1).flatMap((row,index)=>{
    const cells=rowValues(row);
    return hasContent(cells)?[{rowNumber:index+GLOSSARY_SHEET_DEFINITION.dataStartRow,values:cells}]:[];
  });

  let section="";
  const terms=[];
  const byName=new Map();
  for(const row of rows){
    const rawName=clean(row.values[0]);
    const description=clean(row.values[1]);
    if(!description){
      if(rawName)section=rawName;
      continue;
    }
    if(!rawName)throw new Error(`blank glossary term name at row ${row.rowNumber}`);
    const {name,sourceLabel}=parseTermLabel(rawName);
    if(!name)throw new Error(`blank glossary term name at row ${row.rowNumber}`);
    const term={termId:stableTermId(section,name),name,description,section,sourceLabel,aliases:[]};
    const key=identity(name),previous=byName.get(key);
    if(previous){
      if(identity(previous.description)!==identity(description)
        || identity(previous.section)!==identity(section)
        || identity(previous.sourceLabel)!==identity(sourceLabel)){
        throw new Error(`conflicting glossary term at row ${row.rowNumber}: ${name}`);
      }
      continue;
    }
    byName.set(key,term);
    terms.push(term);
  }

  if(new Set(terms.map(term=>term.termId)).size!==terms.length)throw new Error("duplicate glossary termId");
  const source={spreadsheetId:clean(spreadsheetId),sheetTitle:GLOSSARY_SHEET_DEFINITION.sheetTitle};
  return {
    snapshot:{schemaVersion:1,...source,range:GLOSSARY_SHEET_DEFINITION.range,importedAt:clean(importedAt),headers,preambleRows,rowCount:rows.length,rows},
    catalog:{schemaVersion:1,source,terms}
  };
}
