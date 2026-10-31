import {createClient} from '@supabase/supabase-js';
import type {ReceiptEnvironment} from './receiptStore';
type Snapshot={version:number;addresses:string[]};
export interface MapsStore{identity(token:string):Promise<string|null>;context(token:string,id:string,version:number,reserve:boolean):Promise<Snapshot>;}
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function calculateRoute(addresses:string[],key:string,fetcher:typeof fetch=fetch){
 if(addresses.length<2||addresses.length>30||addresses.some(address=>!address.trim()||address.length>500))throw Error('INCOMPLETE_ROUTE');
 const deadline=AbortSignal.timeout(25000);
 let lastCall=0;
 async function request(path:string,params:Record<string,string>){
  const url=new URL(`https://api.geoapify.com/v1/${path}`);url.search=new URLSearchParams({...params,apiKey:key}).toString();
  const delay=210-(Date.now()-lastCall);if(delay>0)await new Promise(resolve=>setTimeout(resolve,delay));
  deadline.throwIfAborted();lastCall=Date.now();
  const response=await fetcher(url,{signal:deadline,redirect:'manual'});
  if(response.status===401||response.status===403)throw Error('MAPS_KEY_REJECTED');
  if(response.status===429)throw Error('MAPS_PROVIDER_LIMIT');
  if(!response.ok)throw Error('MAPS_PROVIDER_ERROR');
  // Bound external response size; never return/log provider payload or request URL.
  const reader=response.body?.getReader();if(!reader)throw Error('MAPS_UNAVAILABLE');
  let text='',length=0;const decoder=new TextDecoder();
  for(;;){const part=await reader.read();if(part.done)break;length+=part.value.length;if(length>2000000){await reader.cancel();throw Error('MAPS_UNAVAILABLE');}text+=decoder.decode(part.value,{stream:true});}
  return JSON.parse(text+decoder.decode());
 }
 const points:string[]=[];const resolved=new Map<string,string>();
 for(const address of addresses){
  const coordinates=/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(address);
  if(coordinates){const lat=Number(coordinates[1]),lon=Number(coordinates[2]);if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)throw Error('ADDRESS_UNCERTAIN');points.push(`${lat},${lon}`);continue;}
  let point=resolved.get(address);
  if(!point){
   const result=await request('geocode/search',{text:address,filter:'countrycode:br',format:'json',limit:'2'});
   if(!Array.isArray(result.results))throw Error('ADDRESS_UNCERTAIN');
   const precise=result.results.filter((item:{result_type:string;rank?:{confidence?:number}})=>['building','amenity'].includes(item.result_type)&&(item.rank?.confidence??0)>=0.9);
   if(precise.length!==1)throw Error('ADDRESS_UNCERTAIN');
   const item=precise[0];
   if(!["building","amenity"].includes(item.result_type)||!Number.isFinite(item.lat)||!Number.isFinite(item.lon)||Math.abs(item.lat)>90||Math.abs(item.lon)>180||!(item.rank?.confidence>=0.9))throw Error('ADDRESS_UNCERTAIN');
   point=`${item.lat},${item.lon}`;resolved.set(address,point);
  }
  points.push(point);
 }
 let distanceMetres=0,durationSeconds=0;
 // Keep shared endpoints; each pair appears once. Small groups bound URLs/payload.
 for(let offset=0;offset<points.length-1;offset+=9){
  const group=points.slice(offset,offset+10);
  const result=await request('routing',{waypoints:group.join('|'),mode:'drive',format:'json',units:'metric',optimize_stops:'false'});
  const route=result.results?.[0];
  if(!route||!Number.isFinite(route.distance)||route.distance<0||!Number.isFinite(route.time)||route.time<0||!Array.isArray(route.legs)||route.legs.length!==group.length-1)throw Error('MAPS_ROUTE_RESPONSE_INVALID');
  distanceMetres+=route.distance;durationSeconds+=route.time;
 }
 if(!Number.isSafeInteger(Math.ceil(distanceMetres))||!Number.isSafeInteger(Math.ceil(durationSeconds)))throw Error('MAPS_UNAVAILABLE');
 return {distanceMetres:Math.round(distanceMetres),durationSeconds:Math.ceil(durationSeconds)};
}
export async function handleMapsRequest(request:Request,store:MapsStore,key?:string,provider=calculateRoute):Promise<Response>{
 let stage='authorization';
 try{
  const token=/^Bearer (\S+)$/i.exec(request.headers.get('Authorization')??'')?.[1];if(!token)return json({error:'UNAUTHORIZED'},401);
  const role=await store.identity(token);if(!role)return json({error:'UNAUTHORIZED'},401);if(role!=='owner')return json({error:'FORBIDDEN'},403);
  if(!key)return json({error:'MAPS_NOT_CONFIGURED'},503);
  const match=/^\/api\/routes\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\/distance$/i.exec(new URL(request.url).pathname);
  if(request.method!=='POST'||!match)return json({error:'INVALID_INPUT'},400);
  const reader=request.body?.getReader();let body='';if(!reader)return json({error:'INVALID_INPUT'},400);
  for(;;){const part=await reader.read();if(part.done)break;if(body.length+part.value.length>1024){await reader.cancel();return json({error:'INVALID_INPUT'},400);}body+=new TextDecoder().decode(part.value);}
  let version;try{version=JSON.parse(body).expectedVersion;}catch{return json({error:'INVALID_INPUT'},400);}
  if(!Number.isSafeInteger(version)||version<1)return json({error:'INVALID_INPUT'},400);
  stage='context';const initial=await store.context(token,match[1],version,true);
  stage='provider';
  const result=await provider(initial.addresses,key);
  stage='recheck';const current=await store.context(token,match[1],version,false);
  if(JSON.stringify(initial)!==JSON.stringify(current))throw Error('VERSION_CONFLICT');
  return json({...result,routeVersion:version,calculatedAt:new Date().toISOString(),provider:'geoapify'});
 }catch(error){
  const code=error instanceof Error?error.message:'';
  const known:Record<string,number>={VERSION_CONFLICT:409,ROUTE_LOCKED:409,INCOMPLETE_ROUTE:422,ADDRESS_UNCERTAIN:422,MAPS_LIMIT:429,MAPS_KEY_REJECTED:503,MAPS_PROVIDER_LIMIT:429,MAPS_PROVIDER_ERROR:503,MAPS_ROUTE_RESPONSE_INVALID:503,FORBIDDEN:403};
  return json({error:known[code]?code:'MAPS_UNAVAILABLE',stage},known[code]??503);
 }
}
export function createMapsStore(env:ReceiptEnvironment):MapsStore{
 const client=(token:string)=>createClient(env.SUPABASE_URL,env.SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:`Bearer ${token}`}}});
 return {
  async identity(token){const db=client(token),user=await db.auth.getUser(token);if(user.error||!user.data.user)return null;const profile=await db.from('profiles').select('role').eq('id',user.data.user.id).single();return profile.data?.role??null;},
  async context(token,id,version,reserve){const {data,error}=await client(token).rpc('get_route_distance_context',{p_route_id:id,p_expected_version:version,p_reserve:reserve});if(error)throw Error(error.message);return data as Snapshot;}
 };
}
