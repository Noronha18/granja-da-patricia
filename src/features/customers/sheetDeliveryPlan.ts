type SheetRow={row:number;cells:Record<string,string>};
type Item={eggsPerTray:15|30;trays:number};
export type DeliveryPlan={sourceId:string;row:number;weekday:number|null;reviewPending:boolean;reasons:string[];items:Item[];deliveryGroup:{key:string;days:number[];rows:number[]}|null};
const weekdays:Record<string,number>={'TERÇA':2,'QUARTA':3,'QUINTA':4,'SEXTA':5};
const day=(r:SheetRow)=>weekdays[(r.cells.N??'').trim().toLocaleUpperCase('pt-BR')]??null;
const name=(r:SheetRow)=>(r.cells.D??'').trim().toLocaleLowerCase('pt-BR');
const normalized=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().replace(/\s+/g,' ').toLocaleUpperCase('pt-BR');
type AddressFormatting={rows:number[];street:string;complement:string;postalCode:string};
const phone=(s:string)=>s.replace(/\D/g,'');
const apartment=(s:string)=>normalized(s).match(/\b(?:APTO|APARTAMENTO)\s*(\d+)(?:\s*([A-Z])(?=\s*[,;\-/]|$))?/)?.slice(1).join('')??'';
export function applyConfirmedAddressFormatting(source:SheetRow[],resolutions:AddressFormatting[]):SheetRow[]{
 const result=source.map(r=>({...r,cells:{...r.cells}})),byRow=new Map(result.map(r=>[r.row,r])),seen=new Set<number>();
 for(const resolution of resolutions){
  const group=resolution.rows.map(row=>{const r=byRow.get(row);if(!r||seen.has(row))throw Error('Equivalência de endereço inválida.');seen.add(row);return r;});
  if(group.length<2)throw Error('Equivalência exige ao menos duas linhas.');
  for(const c of ['B','D','F','H','I','J','K','L','M','N']){
   const values=new Set(group.map(r=>c==='J'?phone(r.cells[c]??''):normalized(r.cells[c]??'')));
   if(values.size>1)throw Error('Há diferença real fora da formatação do endereço.');
  }
  const apartments=new Set(group.map(r=>apartment(r.cells.G??'')));
  if(apartments.size>1||!apartments.has(apartment(resolution.complement)))throw Error('Apartamento divergente.');
  const numbers=(s:string)=>JSON.stringify(s.match(/\d+/g)??[]);
  if(group.some(r=>numbers(r.cells.G??'')!==numbers(resolution.complement)))throw Error('Número do complemento divergente.');
  const codes=new Set(group.map(r=>phone(r.cells.O??'')).filter(Boolean));
  if(codes.size>1||(codes.size===1&&!codes.has(phone(resolution.postalCode)))||(codes.size===0&&resolution.postalCode))throw Error('CEP divergente.');
  if(!resolution.street.trim()||!resolution.complement.trim())throw Error('Endereço formatado incompleto.');
  for(const r of group){r.cells.E=resolution.street;r.cells.G=resolution.complement;r.cells.O=resolution.postalCode;}
 }
 return result;
}
export function formatComplement(value:string):string{
 return value.trim().replace(/\s+/g,' ').replace(/\bAPTO(?=\d)/gi,'APTO ').replace(/\b(?:EDIF[IÍ]CIO|EDIF|EDF)\b\.?\s*/gi,'EDIFÍCIO ').replace(/\s*,\s*/g,', ').trim();
}
export function collapseFormattingDuplicates(source:SheetRow[]):{rows:SheetRow[];merges:{canonicalRow:number;aliasRows:number[];sourceRows:number[];formattedComplement:string}[]}{
 const rows=source.filter(r=>name(r)).sort((a,b)=>a.row-b.row);
 const columns=[...new Set(rows.flatMap(r=>Object.keys(r.cells)))].filter(c=>c!=='C').sort();
 const buckets=new Map<string,SheetRow[]>();
 for(const row of rows){
  const key=JSON.stringify([name(row),...columns.map(c=>c==='J'?phone(row.cells[c]??''):normalized(c==='G'?formatComplement(row.cells[c]??''):row.cells[c]??''))]);
  const bucket=buckets.get(key)??[];bucket.push(row);buckets.set(key,bucket);
 }
 const result:SheetRow[]=[],merges:{canonicalRow:number;aliasRows:number[];sourceRows:number[];formattedComplement:string}[]=[];
 for(const group of buckets.values()){
  const first=group[0];if(group.length===1){result.push(first);continue;}
  const formattedComplement=formatComplement(first.cells.G??'');
  result.push({...first,cells:{...first.cells,G:formattedComplement}});
  merges.push({canonicalRow:first.row,aliasRows:group.slice(1).map(r=>r.row),sourceRows:group.map(r=>r.row),formattedComplement});
 }
 return {rows:result.sort((a,b)=>a.row-b.row),merges};
}
export function planSheetDeliveries(source:SheetRow[]):DeliveryPlan[]{
 const rows=collapseFormattingDuplicates(source).rows;const names=new Map<string,SheetRow[]>();
 for(const r of rows){const group=names.get(name(r))??[];group.push(r);names.set(name(r),group);}
 return rows.map(r=>{
  const d=r.cells,weekday=day(r),group=names.get(name(r))!;
  const reasons:string[]=[],items:Item[]=[];
  if(weekday===null)reasons.push((d.N??'').trim().toLocaleUpperCase('pt-BR')==='SEGUNDA'?'Segunda-feira é coleta; definir dia de entrega.':'Definir dia de entrega.');
  if(group.length>1)reasons.push('Nome repetido: confirmar a única ocorrência e o dia semanal corretos.');
  if(!(d.E??'').trim())reasons.push('Conferir rua/endereço.');
  for(const [column,size] of [['L',30],['M',15]] as const){
   const text=(d[column]??'').trim();if(!text)continue;
   if(!/^\d+$/.test(text)||!Number.isSafeInteger(Number(text))||Number(text)>2147483647){reasons.push('Conferir quantidade inválida.');continue;}
   if(Number(text)>0)items.push({eggsPerTray:size,trays:Number(text)});
  }
  if(!items.length)reasons.push('Conferir quantidade ausente.');
  const annotations=`${d.D??''} ${d.K??''}`;
  if(/\b20\s*OVOS\b/i.test(annotations))reasons.push('Conferir bandeja de 20 ovos indicada na anotação.');
  if(/\bMEL\b/i.test(annotations))reasons.push('Conferir produto adicional indicado na anotação.');
  return {sourceId:`pasta1-planilha1-r${r.row}`,row:r.row,weekday,reviewPending:reasons.length>0,reasons:[...new Set(reasons)],items,deliveryGroup:null};
 });
}
