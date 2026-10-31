import {describe,it,expect,vi} from 'vitest';
import {calculateRoute,handleMapsRequest,type MapsStore} from './maps';
const snapshot={version:1,addresses:['Rua A, 10, Recife','Rua B, 20, Recife']};
function setup(){const store:MapsStore={identity:vi.fn(async()=> 'owner'),context:vi.fn(async()=>snapshot)};return store;}
const req=(token=true,body='{"expectedVersion":1}')=>new Request('https://test/api/routes/00000000-0000-4000-8000-000000000001/distance',{method:'POST',headers:token?{Authorization:'Bearer fixture'}:{},body});
describe('private route estimates',()=>{
 it('requires login, owner and configured key before external calls',async()=>{
  const store=setup(),provider=vi.fn();
  expect((await handleMapsRequest(req(false),store,'fixture',provider)).status).toBe(401);
  store.identity=async()=> 'driver';expect((await handleMapsRequest(req(),store,'fixture',provider)).status).toBe(403);
  store.identity=async()=> 'owner';expect((await handleMapsRequest(req(),store,undefined,provider)).status).toBe(503);expect(provider).not.toHaveBeenCalled();
 });
 it('rejects invalid input and stale versions without exposing service errors',async()=>{
  const store=setup();expect((await handleMapsRequest(req(true,'{}'),store,'fixture')).status).toBe(400);
  store.context=async()=>{throw Error('VERSION_CONFLICT');};expect((await handleMapsRequest(req(),store,'fixture')).status).toBe(409);
 });
 it('rechecks snapshot after calculation and never returns stale estimate',async()=>{
  const store=setup();let count=0;store.context=async()=>({...snapshot,addresses:++count===1?snapshot.addresses:['changed','changed']});
  const response=await handleMapsRequest(req(),store,'fixture',async()=>({distanceMetres:300,durationSeconds:60}));expect(response.status).toBe(409);
 });
 it('returns distance and duration without addresses, credentials or cache',async()=>{
  const response=await handleMapsRequest(req(),setup(),'secret-fixture',async()=>({distanceMetres:300,durationSeconds:60}));
  expect(response.status).toBe(200);expect(response.headers.get('Cache-Control')).toBe('no-store');const text=await response.text();expect(text).not.toContain('secret-fixture');expect(text).not.toContain('Rua A');
 });
 it('maps quota and incomplete route to actionable errors',async()=>{
  for(const [code,status]of [['MAPS_LIMIT',429],['INCOMPLETE_ROUTE',422],['ROUTE_LOCKED',409]] as const){const store=setup();store.context=async()=>{throw Error(code);};expect((await handleMapsRequest(req(),store,'fixture')).status).toBe(status);}
 });
});
describe('Geoapify adapter',()=>{
 it('accepts explicit coordinates without guessing a street or calling geocoding',async()=>{
  const fetcher=vi.fn(async()=>Response.json({results:[{distance:300,time:60,legs:[{}]}]}));
  expect(await calculateRoute(['-8.05, -34.88','-8.06,-34.89'],'fixture',fetcher)).toEqual({distanceMetres:300,durationSeconds:60});expect(fetcher).toHaveBeenCalledTimes(1);
  await expect(calculateRoute(['91,0','-8,-34'],'fixture',fetcher)).rejects.toThrow('ADDRESS_UNCERTAIN');
 });
 it('accepts one precise building even if provider also returns an imprecise city',async()=>{
  const fetcher:typeof fetch=async(input)=>new URL(String(input)).pathname.includes('geocode')?Response.json({results:[{lat:-8,lon:-34,result_type:'building',rank:{confidence:1}},{lat:-8,lon:-34,result_type:'city',rank:{confidence:1}}]}):Response.json({results:[{distance:300,time:60,legs:[{}]}]});
  expect(await calculateRoute(snapshot.addresses,'fixture',fetcher)).toEqual({distanceMetres:300,durationSeconds:60});
 });
 it('distinguishes rejected key and provider quota without leaking payload',async()=>{
  for(const [status,code]of [[401,'MAPS_KEY_REJECTED'],[403,'MAPS_KEY_REJECTED'],[429,'MAPS_PROVIDER_LIMIT']] as const)await expect(calculateRoute(snapshot.addresses,'fixture',async()=>new Response('private provider payload',{status}))).rejects.toThrow(code);
 });
 it('fails closed on ambiguity, quota and malformed response',async()=>{
  for(const response of [Response.json({results:[]}),new Response('',{status:429}),Response.json({results:[{lat:1,lon:2,rank:{confidence:0.1}}]})]){
   await expect(calculateRoute(snapshot.addresses,'fixture',async()=>response)).rejects.toThrow();
  }
 });
 it('preserves repeated stops and adds every leg in order',async()=>{
  const calls:URL[]=[];
  const fetcher=vi.fn(async(input:string|URL|Request)=>{const url=new URL(String(input));calls.push(url);return url.pathname.includes('geocode')?Response.json({results:[{lat:-8,lon:-34,result_type:"building",rank:{confidence:1}}]}):Response.json({results:[{distance:300,time:60,legs:[{},{}]}]});});
  expect(await calculateRoute([...snapshot.addresses,snapshot.addresses[0]],'fixture',fetcher)).toEqual({distanceMetres:300,durationSeconds:60});
  expect(calls.at(-1)?.searchParams.get('waypoints')?.split('|')).toHaveLength(3);
  expect(calls.at(-1)?.searchParams.get('optimize_stops')).toBe('false');
 });
 it('rejects incomplete routes before calling provider',async()=>{const fetcher=vi.fn();await expect(calculateRoute(['','B'],'fixture',fetcher)).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();});
 it('does not accept a city centre as a delivery address',async()=>{await expect(calculateRoute(snapshot.addresses,'fixture',async()=>Response.json({results:[{lat:-8,lon:-34,result_type:'city',rank:{confidence:1}}]}))).rejects.toThrow('ADDRESS_UNCERTAIN');});
 it('sums all legs across shared-endpoint groups',async()=>{
  const lengths:number[]=[];const fetcher:typeof fetch=async(input)=>{
   const url=new URL(String(input));if(url.pathname.includes('geocode'))return Response.json({results:[{lat:-8,lon:-34,result_type:'building',rank:{confidence:1}}]});
   const count=url.searchParams.get('waypoints')!.split('|').length;lengths.push(count);return Response.json({results:[{distance:(count-1)*100,time:(count-1)*60,legs:Array.from({length:count-1},()=>({}))}]});
  };
  expect(await calculateRoute(Array.from({length:12},(_,i)=>snapshot.addresses[i%2]),'fixture',fetcher)).toEqual({distanceMetres:1100,durationSeconds:660});expect(lengths).toEqual([10,3]);
 });
});
