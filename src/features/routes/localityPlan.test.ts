import {describe,it,expect} from 'vitest';
import {planLocalityRoutes,type LocalityDelivery} from './localityPlan';
const delivery=(id:string,row:number,extra:Partial<LocalityDelivery>={}):LocalityDelivery=>({sourceId:id,row,weekday:2,name:`Cliente fictício ${id}`,address:'Rua fictícia, 10, apartamento próprio',phone:null,notes:'Portaria fictícia',city:'João Pessoa',neighborhood:'Tambaú',street:'Rua fictícia',number:'10',items:[{eggsPerTray:30,trays:1}],...extra});
describe('roteiro preliminar por localidade',()=>{
 it('agrupa bairro e edifício sem juntar apartamentos nem mudar o dia',()=>{
  const result=planLocalityRoutes([delivery('a',7),delivery('b',14,{neighborhood:'TAMBAU',address:'Rua fictícia, 10, outro apartamento'}),delivery('c',20,{weekday:3})]);
  expect(result.days.map(d=>[d.weekday,d.deliveries])).toEqual([[2,2],[3,1]]);
  expect(result.days[0].areas).toHaveLength(1);
  expect(result.days[0].areas[0].buildings).toHaveLength(1);
  expect(result.days[0].areas[0].buildings[0].deliveries.map(d=>d.sourceId)).toEqual(['a','b']);
  expect(result.days[0].eggs).toBe(60);
 });
 it('não confunde cidades nem agrupa endereços sem número',()=>{
  const result=planLocalityRoutes([delivery('a',1,{neighborhood:'Bairro fictício',number:''}),delivery('b',2,{neighborhood:'Bairro fictício',number:''}),delivery('c',3,{city:'Cabedelo',neighborhood:'Bairro fictício'})]);
  expect(result.days[0].areas).toHaveLength(2);
  expect(result.days[0].areas[0].buildings).toHaveLength(2);
 });
 it('mantém a primeira ocorrência da origem como ordem provisória de setores',()=>{
  const result=planLocalityRoutes([delivery('c',30,{neighborhood:'Manaíra'}),delivery('b',20,{neighborhood:'Tambaú'}),delivery('a',10,{neighborhood:'Manaíra'})]);
  expect(result.days[0].areas.map(a=>a.neighborhood)).toEqual(['Manaíra','Tambaú']);
  expect(result.days[0].areas[0].buildings[0].deliveries.map(d=>d.sourceId)).toEqual(['a','c']);
 });
 it('não aceita segunda-feira ou identificador duplicado como entrega',()=>{
  expect(()=>planLocalityRoutes([delivery('a',1,{weekday:1})])).toThrow();
  expect(()=>planLocalityRoutes([delivery('a',1),delivery('a',2)])).toThrow();
 });
});
