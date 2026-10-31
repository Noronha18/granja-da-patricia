import {describe,it,expect} from 'vitest';
import {planSheetDeliveries,collapseFormattingDuplicates,applyConfirmedAddressFormatting} from './sheetDeliveryPlan';
const row=(row:number,name:string,day:string,extra:Record<string,string>={}):{row:number;cells:Record<string,string>}=>({row,cells:{D:name,E:`Rua fictícia ${row}`,J:`8190000${row}`,N:day,L:'1',M:'',K:'',C:'X',...extra}});
describe('regra confirmada da planilha',()=>{
 it('aplica equivalência de endereço revisada, preserva CEP preenchido e não altera a origem',()=>{
  const source=[row(7,'Fictício','TERÇA',{E:'Rua Fictícia Alfa',G:'APTO 201 A, EDF. VILA ALFA',O:'50111000'}),row(14,'Fictício','TERÇA',{E:'Rua Fictícia Alpha',J:'81900007',G:'APTO201 A - EDIFICIO VILLA ALFA',O:''})];
  const formatted=applyConfirmedAddressFormatting(source,[{rows:[7,14],street:'Rua Fictícia Alfa',complement:'APTO 201 A, EDIFÍCIO VILA ALFA',postalCode:'50111000'}]);
  expect(collapseFormattingDuplicates(formatted).rows).toHaveLength(1);
  expect(source[1].cells.O).toBe('');expect(formatted[1].cells.O).toBe('50111000');
  const differences:Record<string,string>[]=[{J:'81912345678'},{N:'QUARTA'},{L:'2'},{K:'Observação diferente'},{G:'APTO 201 B, EDF. VILA ALFA'}];
  for(const different of differences){
   expect(()=>applyConfirmedAddressFormatting([source[0],{...source[1],cells:{...source[1].cells,...different}}],[{rows:[7,14],street:'Rua Fictícia Alfa',complement:'APTO 201 A, EDIFÍCIO VILA ALFA',postalCode:'50111000'}])).toThrow();
  }
 });
 it('consolida somente APTO/EDIF e espaços equivalentes, sem somar quantidades',()=>{
  const source=[row(7,'Cliente fictício','TERÇA',{E:'Rua fictícia única',G:'APTO201 A, EDIF. RIVIERA',C:''}),row(14,'Cliente fictício','TERÇA',{E:'Rua fictícia única',J:'81900007',G:'APTO 201 A, EDIFICIO RIVIERA',C:'X'})];
  const result=collapseFormattingDuplicates(source);
  expect(result.rows).toHaveLength(1);expect(result.rows[0].row).toBe(7);
  expect(result.rows[0].cells.G).toBe('APTO 201 A, EDIFÍCIO RIVIERA');
  expect(result.merges[0]).toEqual({canonicalRow:7,aliasRows:[14],sourceRows:[7,14],formattedComplement:'APTO 201 A, EDIFÍCIO RIVIERA'});
  const plan=planSheetDeliveries(source);expect(plan).toHaveLength(1);expect(plan[0].reviewPending).toBe(false);expect(plan[0].items).toEqual([{eggsPerTray:30,trays:1}]);
 });
 it('diferença de dia, telefone, quantidade ou nome de edifício não é formatação',()=>{
  const base=row(7,'Fictício','TERÇA',{E:'Rua fictícia única',G:'APTO2201'});
  const differences:Record<string,string>[]=[{N:'QUARTA'},{J:'81911111111'},{L:'2'},{G:'APTO 2201, EDIFÍCIO OUTRO'}];
  for(const change of differences){
   const other={row:14,cells:{...base.cells,...change}};
   expect(collapseFormattingDuplicates([base,other]).merges).toHaveLength(0);
   expect(planSheetDeliveries([base,other]).every(r=>r.reviewPending)).toBe(true);
  }
 });
 it('nome repetido em dias diferentes exige escolher a única ocorrência semanal correta',()=>{
  const result=planSheetDeliveries([row(7,'Cliente fictício','TERÇA'),row(14,'Cliente fictício','QUINTA',{L:'2',M:'1',K:'Entregar na portaria'})]);
  expect(result.map(r=>r.reviewPending)).toEqual([true,true]);
  expect(result.every(r=>r.deliveryGroup===null)).toBe(true);
  expect(result[1].items).toEqual([{eggsPerTray:30,trays:2},{eggsPerTray:15,trays:1}]);
  expect(result[0].sourceId).not.toBe(result[1].sourceId);
 });
 it('segunda é coleta; repetições exigem conferência e X sozinho não bloqueia',()=>{
  const result=planSheetDeliveries([row(7,'Fictício','SEGUNDA'),row(14,'Fictício','TERÇA'),row(21,'Outro cliente','TERÇA')]);
  expect(result[0].weekday).toBeNull();expect(result[0].reviewPending).toBe(true);
  expect(result[1].reviewPending).toBe(true);expect(result[1].deliveryGroup).toBeNull();expect(result[2].reviewPending).toBe(false);
 });
 it('repetições no mesmo dia continuam pendentes sem somar quantidades',()=>{
  const result=planSheetDeliveries([row(7,'Fictício','TERÇA'),row(8,'Fictício','TERÇA'),row(14,'Fictício','QUINTA')]);
  expect(result.map(r=>r.reviewPending)).toEqual([true,true,true]);
  expect(result[0].items).toEqual([{eggsPerTray:30,trays:1}]);
 });
 it('quantidades ausentes ou ambíguas e bandeja especial exigem conferência',()=>{
  const result=planSheetDeliveries([row(1,'A','TERÇA',{M:'l'}),row(2,'B','QUARTA',{L:'',M:''}),row(3,'C','QUINTA',{K:'20 OVOS'}),row(4,'D','SEXTA',{L:'2147483648'}),row(5,'E','QINTA')]);
  expect(result.every(r=>r.reviewPending)).toBe(true);
 });
});
