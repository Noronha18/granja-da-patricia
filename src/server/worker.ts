import { createReceiptStore, type ReceiptEnvironment } from './receiptStore';
import { handleReceiptRequest } from './receipts';
import {createMapsStore,handleMapsRequest} from './maps';

type Environment=ReceiptEnvironment&{GEOAPIFY_API_KEY?:string;ASSETS:{fetch(request:Request):Promise<Response>}};
export default {
 async fetch(request:Request,env:Environment):Promise<Response>{
  if(new URL(request.url).pathname.startsWith('/api/')){
   if(!env.SUPABASE_URL||!env.SUPABASE_ANON_KEY||!env.SUPABASE_SERVICE_ROLE_KEY)return Response.json({error:'SERVER_NOT_CONFIGURED'},{status:503});
   if(new URL(request.url).pathname.startsWith('/api/routes/'))return handleMapsRequest(request,createMapsStore(env),env.GEOAPIFY_API_KEY);
   return handleReceiptRequest(request,createReceiptStore(env));
  }
  return env.ASSETS.fetch(request);
 }
};
