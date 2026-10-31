export type LocalityDelivery={sourceId:string;row:number;weekday:number;name:string;address:string;phone:string|null;notes:string;city:string;neighborhood:string;street:string;number:string;items:{eggsPerTray:number;trays:number}[]};
type PlannedDelivery=LocalityDelivery&{issues:string[]};
type Building={key:string;street:string;number:string;deliveries:PlannedDelivery[];eggs:number};
type Area={key:string;city:string;neighborhood:string;buildings:Building[];deliveries:number;eggs:number;issues:string[]};
type Day={weekday:number;areas:Area[];deliveries:number;buildings:number;eggs:number};
const normalize=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().replace(/\s+/g,' ').toLocaleUpperCase('pt-BR');
const labels=Object.fromEntries(['Intermares','Camboinha','Ponta de Campina','Poço','Bessa','Brisamar','Miramar','Bairro dos Estados','Expedicionários','Castelo Branco','Tambauzinho','Pedro Gondim','Torre','Manaíra','Aeroclube','Tambaú','Treze de Maio','Jaguaribe','Bancários','Cabo Branco','Altiplano','Penha','Cristo Redentor'].map(s=>[normalize(s),s]));
const cabedelo=new Set(['INTERMARES','CAMBOINHA','PONTA DE CAMPINA','POCO']);
export function planLocalityRoutes(input:LocalityDelivery[]):{days:Day[];deliveries:number;eggs:number;issues:number}{
 const ids=new Set<string>(),days=new Map<number,Day>();let issueCount=0;
 for(const source of [...input].sort((a,b)=>a.row-b.row)){
  if(!source.sourceId||ids.has(source.sourceId)||!Number.isInteger(source.weekday)||source.weekday<2||source.weekday>5)throw Error('Entrega duplicada ou dia operacional inválido.');
  ids.add(source.sourceId);
  if(source.items.some(i=>![15,20,30].includes(i.eggsPerTray)||!Number.isSafeInteger(i.trays)||i.trays<=0))throw Error('Quantidade inválida no roteiro.');
  const n=normalize(source.neighborhood),rawCity=normalize(source.city),issues:string[]=[];
  const expectedCity=cabedelo.has(n)?'CABEDELO':labels[n]?'JOAO PESSOA':null;
  const recognizedCity=['JOAO PESSOA','CABEDELO'].includes(rawCity)?rawCity:null;
  if(!recognizedCity)issues.push('Conferir grafia/conteúdo da cidade na origem.');
  if(expectedCity&&recognizedCity&&expectedCity!==recognizedCity)issues.push('Bairro e cidade divergentes na origem.');
  if(!n||!labels[n])issues.push('Bairro não reconhecido para o agrupamento.');
  const cityKey=expectedCity??recognizedCity??`UNCONFIRMED-${source.sourceId}`;
  const city=cityKey==='JOAO PESSOA'?'João Pessoa':cityKey==='CABEDELO'?'Cabedelo':'Cidade a conferir';
  const neighborhood=labels[n]||source.neighborhood.trim()||'Bairro a conferir';
  const areaKey=JSON.stringify([cityKey,n]);
  let day=days.get(source.weekday);if(!day){day={weekday:source.weekday,areas:[],deliveries:0,buildings:0,eggs:0};days.set(source.weekday,day);}
  let area=day.areas.find(a=>a.key===areaKey);if(!area){area={key:areaKey,city,neighborhood,buildings:[],deliveries:0,eggs:0,issues:[]};day.areas.push(area);}
  const safeNumber=/^[1-9]\d*[A-Za-z]?$/.test(source.number.trim());
  const buildingKey=source.street.trim()&&safeNumber?JSON.stringify([normalize(source.street),normalize(source.number)]):source.sourceId;
  if(!safeNumber)issues.push('Número ausente ou não padronizado; endereço mantido individualmente.');
  let building=area.buildings.find(b=>b.key===buildingKey);if(!building){building={key:buildingKey,street:source.street.trim()||'Rua a conferir',number:source.number.trim(),deliveries:[],eggs:0};area.buildings.push(building);day.buildings++;}
  const eggs=source.items.reduce((sum,item)=>sum+item.eggsPerTray*item.trays,0);
  building.deliveries.push({...source,issues});building.eggs+=eggs;area.deliveries++;area.eggs+=eggs;day.deliveries++;day.eggs+=eggs;
  area.issues=[...new Set([...area.issues,...issues])];if(issues.length)issueCount++;
  if(!Number.isSafeInteger(day.eggs))throw Error('Quantidade de ovos fora da faixa segura.');
 }
 const result=[...days.values()].sort((a,b)=>a.weekday-b.weekday);
 return {days:result,deliveries:input.length,eggs:result.reduce((sum,d)=>sum+d.eggs,0),issues:issueCount};
}
