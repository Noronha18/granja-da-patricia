import { describe, it, expect } from 'vitest';
import { handleReceiptRequest, type ReceiptStore } from './receipts';

const payment='75000000-0000-0000-0000-000000000001';
const attempt='76000000-0000-0000-0000-000000000001';
const png=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,6,0,0,0,31,21,196,137,0,0,0,11,73,68,65,84,120,156,99,96,0,2,0,0,5,0,1,165,246,69,64,0,0,0,0,73,69,78,68,174,66,96,130]);
function fixture(role='owner') {
 const objects=new Map<string,Uint8Array>();
 const receipts=new Map<string,{id:string;paymentId:string;path:string;mime:string;size:number;sha256:string;actorId:string;createdAt:string}>();
 const pending=new Map<string,Parameters<ReceiptStore['reserveReceipt']>[0]>();const removed=new Set<string>();
 const store:ReceiptStore={
  async identity(token){return token==='valid'?{id:'owner-test',role}:null;},
  async paymentExists(id){return id===payment;},
  async getReceipt(id){return receipts.get(id)??null;},
  async reserveReceipt(row){if(removed.has(row.path))return 'removed';const previous=receipts.get(row.id)??pending.get(row.id);if(previous&&(previous.sha256!==row.sha256||previous.paymentId!==row.paymentId))return 'conflict';if(receipts.has(row.id))return 'ready';pending.set(row.id,row);return 'pending';},
  async listReceipts(id){return [...receipts.values()].filter(row=>row.paymentId===id);},
  async putObject(path,body){if(objects.has(path)) return false;objects.set(path,body);return true;},
  async getObject(path){return objects.get(path)??null;},
  async linkReceipt(row){if(removed.has(row.path))throw Error('RECEIPT_REMOVED');receipts.set(row.id,{...row,createdAt:'2026-10-29T12:00:00Z'});},
  async signedDownload(path){return objects.has(path)?`https://private.test/${path}?download=receipt&expires=300`:null;},
  async orphanPaths(){return [...objects.keys()].filter(path=>![...receipts.values()].some(row=>row.path===path));},
  async removeOrphan(path){if([...receipts.values()].some(row=>row.path===path))return false;removed.add(path);objects.delete(path);return true;}
 };
 return {store,objects,receipts};
}
function upload(body:BodyInit=png,mime='image/png',id=attempt){return new Request(`https://app.test/api/payments/${payment}/receipt`,{method:'POST',headers:{Authorization:'Bearer valid','Content-Type':mime,'X-Request-Id':id},body});}
describe('private receipt handler',()=>{
 it('accepts verified bytes and retries one deterministic attachment',async()=>{
  const f=fixture();
  const first=await handleReceiptRequest(upload(),f.store);expect(first.status).toBe(201);
  const result=await first.json();expect(result).toMatchObject({receiptId:attempt});
  expect((await handleReceiptRequest(upload(),f.store)).status).toBe(200);
  expect(f.objects.size).toBe(1);expect(f.receipts.size).toBe(1);
  expect((await handleReceiptRequest(upload(new TextEncoder().encode('%PDF-1.7\n%%EOF'),'application/pdf'),f.store)).status).toBe(409);
 });
 it('denies anonymous and driver before reading or saving bytes',async()=>{
  for(const role of ['owner','driver']){
   const f=fixture(role);const request=upload();if(role==='owner')request.headers.delete('Authorization');
   expect((await handleReceiptRequest(request,f.store)).status).toBe(role==='driver'?403:401);expect(f.objects.size).toBe(0);
  }
 });
 it('rejects missing payment, spoofed MIME, SVG, truncated bytes and over5MB streams',async()=>{
  const f=fixture();
  const missing=new Request(upload().url.replace(payment,attempt),upload());
  expect((await handleReceiptRequest(missing,f.store)).status).toBe(404);
  for(const [bytes,mime] of [[new TextEncoder().encode('<html>unsafe</html>'),'image/png'],[png,'image/jpeg'],[new TextEncoder().encode('<svg/>'),'image/svg+xml'],[png.slice(0,16),'image/png']] as const){
   expect((await handleReceiptRequest(upload(bytes,mime),f.store)).status).toBe(415);
  }
  expect((await handleReceiptRequest(upload(new Uint8Array(5000001)),f.store)).status).toBe(413);
  expect(f.objects.size).toBe(0);
 });
 it('preserves orphan after failed metadata link and cleans it idempotently',async()=>{
  const f=fixture();f.store.linkReceipt=async()=>{throw Error('simulated database failure');};
  expect((await handleReceiptRequest(upload(),f.store)).status).toBe(503);
  expect(f.objects.size).toBe(1);expect(f.receipts.size).toBe(0);
  const list=await handleReceiptRequest(new Request('https://app.test/api/receipts/orphans',{headers:{Authorization:'Bearer valid'}}),f.store);
  const {paths}=await list.json();expect(paths).toHaveLength(1);
  const remove=()=>new Request('https://app.test/api/receipts/orphans',{method:'DELETE',headers:{Authorization:'Bearer valid','Content-Type':'application/json'},body:JSON.stringify({path:paths[0]})});
  expect((await handleReceiptRequest(remove(),f.store)).status).toBe(200);expect((await handleReceiptRequest(remove(),f.store)).status).toBe(200);expect(f.objects.size).toBe(0);
 });
 it('recovers an uncertain upload and refuses to delete a linked object',async()=>{
  const f=fixture();const link=f.store.linkReceipt;f.store.linkReceipt=async()=>{throw Error('temporary');};
  await handleReceiptRequest(upload(),f.store);f.store.linkReceipt=link;
  expect((await handleReceiptRequest(upload(),f.store)).status).toBe(201);
  const path=[...f.objects.keys()][0];
  expect((await handleReceiptRequest(new Request('https://app.test/api/receipts/orphans',{method:'DELETE',headers:{Authorization:'Bearer valid'},body:JSON.stringify({path})}),f.store)).status).toBe(409);
  const response=await handleReceiptRequest(new Request(`https://app.test/api/receipts/${attempt}/download`,{headers:{Authorization:'Bearer valid'}}),f.store);
  expect(response.status).toBe(200);expect((await response.json()).url).toContain('download=receipt');
  f.objects.clear();expect((await handleReceiptRequest(new Request(`https://app.test/api/receipts/${attempt}/download`,{headers:{Authorization:'Bearer valid'}}),f.store)).status).toBe(404);
 });
 it('cleanup racing an in-flight upload cannot publish a removed receipt',async()=>{
  const f=fixture();const put=f.store.putObject;
  f.store.putObject=async(path,bytes,mime)=>{
   await f.store.removeOrphan(path);return put(path,bytes,mime);
  };
  expect((await handleReceiptRequest(upload(),f.store)).status).toBe(503);
  expect(f.receipts.size).toBe(0);expect(f.objects.size).toBe(1);
  expect((await handleReceiptRequest(upload(),f.store)).status).toBe(409);
 });
});
