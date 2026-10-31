import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ReceiptRow, ReceiptStore } from './receipts';

// Server-only settings. Never expose the service key through VITE_* or logs.
export interface ReceiptEnvironment {
 SUPABASE_URL:string; SUPABASE_ANON_KEY:string; SUPABASE_SERVICE_ROLE_KEY:string;
}
type DatabaseReceipt={id:string;payment_id:string;object_path:string;mime_type:string;size_bytes:number;sha256:string;actor_id:string;created_at:string};
const fromDatabase=(row:DatabaseReceipt):ReceiptRow=>({id:row.id,paymentId:row.payment_id,path:row.object_path,mime:row.mime_type,size:row.size_bytes,sha256:row.sha256,actorId:row.actor_id,createdAt:row.created_at});
const bucket='payment-receipts';
export function createReceiptStore(env:ReceiptEnvironment):ReceiptStore {
 let admin:SupabaseClient|undefined;
 const service=()=>{if(!admin)throw Error('Unauthenticated receipt service');return admin;};
 return {
  async identity(token){
   const userClient=createClient(env.SUPABASE_URL,env.SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:`Bearer ${token}`}}});
   const {data,error}=await userClient.auth.getUser(token);if(error||!data.user)return null;
   const profile=await userClient.from('profiles').select('role').eq('id',data.user.id).single();
   if(profile.error||!profile.data)return null;
   if(profile.data.role==='owner')admin=createClient(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
   return {id:data.user.id,role:profile.data.role};
  },
  async paymentExists(id){const {data,error}=await service().from('payments').select('id').eq('id',id).is('reversal_of',null).maybeSingle();if(error)throw error;return data!==null;},
  async getReceipt(id){const {data,error}=await service().from('payment_receipts').select('*').eq('id',id).eq('status','ready').maybeSingle();if(error)throw error;return data?fromDatabase(data):null;},
  async reserveReceipt(row){
   const {data,error}=await service().rpc('reserve_payment_receipt',{p_id:row.id,p_payment_id:row.paymentId,p_path:row.path,p_mime:row.mime,p_size:row.size,p_sha256:row.sha256,p_actor_id:row.actorId});
   if(error)throw error;
   if(data!=='pending'&&data!=='ready'&&data!=='removed'&&data!=='conflict')throw Error('Invalid reservation result');return data;
  },
  async listReceipts(paymentId){const {data,error}=await service().from('payment_receipts').select('*').eq('payment_id',paymentId).eq('status','ready').order('created_at');if(error)throw error;return data.map(fromDatabase);},
  async putObject(path,bytes,mime){
   const {error}=await service().storage.from(bucket).upload(path,bytes,{contentType:mime,upsert:false});
   if(!error)return true;
   if('statusCode'in error&&(String(error.statusCode)==='409'||String(error.statusCode)==='400'&&/already exists|duplicate/i.test(error.message)))return false;
   throw error;
  },
  async getObject(path){const {data,error}=await service().storage.from(bucket).download(path);if(error){if('statusCode'in error&&['400','404'].includes(String(error.statusCode)))return null;throw error;}return new Uint8Array(await data.arrayBuffer());},
  async linkReceipt(row){const {error}=await service().rpc('complete_payment_receipt',{p_id:row.id});if(error)throw error;},
  async signedDownload(path){
   const {data:object,error:missing}=await service().storage.from(bucket).download(path);
   if(missing||!object)return null;
   const {data,error}=await service().storage.from(bucket).createSignedUrl(path,300,{download:`comprovante.${path.split('.').at(-1)}`});if(error)throw error;return data.signedUrl;
  },
  async orphanPaths(){const {data,error}=await service().rpc('get_payment_receipt_orphans');if(error)throw error;if(!Array.isArray(data)||data.some(path=>typeof path!=='string'))throw Error('Invalid orphan result');return data;},
  async removeOrphan(path){
   const {data,error}=await service().rpc('mark_receipt_orphan_removed',{p_path:path});if(error)throw error;if(data!==true)return false;
   const removed=await service().storage.from(bucket).remove([path]);if(removed.error)throw removed.error;return true;
  }
 };
}
