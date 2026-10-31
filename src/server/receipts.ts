export interface ReceiptRow {
 id:string; paymentId:string; path:string; mime:string; size:number; sha256:string; actorId:string; createdAt:string;
}
export interface ReceiptStore {
 identity(token:string):Promise<{id:string;role:string}|null>;
 paymentExists(id:string):Promise<boolean>;
 getReceipt(id:string):Promise<ReceiptRow|null>;
 reserveReceipt(row:Omit<ReceiptRow,'createdAt'>):Promise<'pending'|'ready'|'removed'|'conflict'>;
 listReceipts(paymentId:string):Promise<ReceiptRow[]>;
 putObject(path:string,body:Uint8Array,mime:string):Promise<boolean>;
 getObject(path:string):Promise<Uint8Array|null>;
 linkReceipt(row:Omit<ReceiptRow,'createdAt'>):Promise<void>;
 signedDownload(path:string):Promise<string|null>;
 orphanPaths():Promise<string[]>;
 removeOrphan(path:string):Promise<boolean>;
}
const uuid='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const uuidPattern=new RegExp(`^${uuid}$`,'i');
const pathPattern=new RegExp(`^${uuid}/${uuid}\\.(png|jpg|pdf)$`);
const maxBytes=5000000;
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
class HttpError extends Error {constructor(readonly status:number,code:string){super(code);}}
function format(bytes:Uint8Array):{mime:string;ext:string}|null {
 const starts=(signature:number[])=>signature.every((value,index)=>bytes[index]===value);
 if(bytes.length>=45 && starts([137,80,78,71,13,10,26,10]) && new TextDecoder().decode(bytes.slice(12,16))==='IHDR' && new TextDecoder().decode(bytes.slice(-8,-4))==='IEND') return {mime:'image/png',ext:'png'};
 if(bytes.length>=4 && starts([255,216,255]) && bytes.at(-2)===255 && bytes.at(-1)===217)return {mime:'image/jpeg',ext:'jpg'};
 if(bytes.length>=14 && /^%PDF-\d\.\d/.test(new TextDecoder().decode(bytes.slice(0,8))) && /%%EOF\s*$/.test(new TextDecoder().decode(bytes.slice(-1024))))return {mime:'application/pdf',ext:'pdf'};
 return null;
}
async function readBody(request:Request,limit:number):Promise<Uint8Array>{
 const declared=request.headers.get('Content-Length');
 if(declared!==null && (!/^\d+$/.test(declared) || Number(declared)>limit))throw new HttpError(413,'FILE_TOO_LARGE');
 if(!request.body)return new Uint8Array();
 const reader=request.body.getReader();const chunks:Uint8Array[]=[];let length=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>limit){await reader.cancel();throw new HttpError(413,'FILE_TOO_LARGE');}chunks.push(value);}}
 finally{reader.releaseLock();}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
const digest=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as Uint8Array<ArrayBuffer>)),byte=>byte.toString(16).padStart(2,'0')).join('');
export async function handleReceiptRequest(request:Request,store:ReceiptStore):Promise<Response>{
 try{
  const bearer=/^Bearer (\S+)$/i.exec(request.headers.get('Authorization')??'');
  if(!bearer)throw new HttpError(401,'UNAUTHENTICATED');
  const actor=await store.identity(bearer[1]);if(!actor)throw new HttpError(401,'UNAUTHENTICATED');
  if(actor.role!=='owner')throw new HttpError(403,'FORBIDDEN');
  const path=new URL(request.url).pathname;
  if(path==='/api/receipts/orphans'){
   if(request.method==='GET')return json({paths:await store.orphanPaths()});
   if(request.method==='DELETE'){
    let data:unknown;try{data=JSON.parse(new TextDecoder().decode(await readBody(request,1024)));}catch(error){if(error instanceof HttpError)throw error;throw new HttpError(400,'INVALID_INPUT');}
    if(typeof data!=='object'||data===null||!('path'in data)||typeof data.path!=='string'||!pathPattern.test(data.path))throw new HttpError(400,'INVALID_INPUT');
    if(!await store.removeOrphan(data.path))throw new HttpError(409,'RECEIPT_LINKED');return json({removed:true});
   }
  }
  const download=new RegExp(`^/api/receipts/(${uuid})/download$`,'i').exec(path);
  if(download && request.method==='GET'){
   const receipt=await store.getReceipt(download[1]);if(!receipt)throw new HttpError(404,'RECEIPT_NOT_FOUND');
   const url=await store.signedDownload(receipt.path);if(!url)throw new HttpError(404,'RECEIPT_NOT_FOUND');return json({url,expiresIn:300});
  }
  const match=new RegExp(`^/api/payments/(${uuid})/(receipt|receipts)$`,'i').exec(path);
  if(!match)throw new HttpError(404,'NOT_FOUND');
  const paymentId=match[1].toLowerCase();if(!await store.paymentExists(paymentId))throw new HttpError(404,'PAYMENT_NOT_FOUND');
  if(request.method==='GET' && match[2]==='receipts')return json({receipts:await store.listReceipts(paymentId)});
  if(request.method!=='POST'||match[2]!=='receipt')throw new HttpError(405,'METHOD_NOT_ALLOWED');
  const requestedId=request.headers.get('X-Request-Id');if(!requestedId||!uuidPattern.test(requestedId))throw new HttpError(400,'REQUEST_ID_REQUIRED');const id=requestedId.toLowerCase();
  const bytes=await readBody(request,maxBytes);const detected=format(bytes);
  if(!detected || request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!==detected.mime)throw new HttpError(415,'UNSUPPORTED_FILE');
  const sha256=await digest(bytes);const row={id,paymentId,path:`${paymentId}/${id}.${detected.ext}`,mime:detected.mime,size:bytes.length,sha256,actorId:actor.id};
  const reservation=await store.reserveReceipt(row);
  if(reservation==='conflict'||reservation==='removed')throw new HttpError(409,'REQUEST_CONFLICT');
  if(reservation==='ready')return json({receiptId:id});
  if(!await store.putObject(row.path,bytes,row.mime)){
   const previous=await store.getObject(row.path);
   if(!previous||await digest(previous)!==sha256)throw new HttpError(409,'REQUEST_CONFLICT');
  }
  // Failed linking leaves a pending, bounded object. A retry completes it; the
  // owner may list/clean it. Cleanup tombstones first, preventing a late link.
  await store.linkReceipt(row);return json({receiptId:id},201);
 }catch(error){return error instanceof HttpError?json({error:error.message},error.status):json({error:'RECEIPT_SERVICE_UNAVAILABLE',paymentPreserved:true},503);}
}
