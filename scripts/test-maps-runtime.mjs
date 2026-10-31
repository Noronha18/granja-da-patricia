import {buildSync} from 'esbuild';
import {Miniflare} from 'miniflare';
import assert from 'node:assert/strict';

// Real Workers runtime, synthetic provider only. No external request or real key.
const contents=buildSync({stdin:{contents:`
import {calculateRoute} from './src/server/maps.ts';
export default {async fetch(){
 try{
  const result=await calculateRoute(['Fixture A','Fixture B'],'fixture-only',async(input,init)=>{
   const request=new Request(input,init);
   if(request.redirect!=='manual')throw Error('Unsafe redirect handling');
   return new URL(request.url).pathname.includes('geocode')
    ?Response.json({results:[{lat:-8,lon:-34,result_type:'building',rank:{confidence:1}}]})
    :Response.json({results:[{distance:300,time:60,legs:[{}]}]});
  });return Response.json(result);
 }catch(error){return Response.json({error:error.message},{status:500});}
}};`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'browser',logLevel:'silent'}).outputFiles[0].text;
const mf=new Miniflare({workers:[{config:{name:'maps-runtime-fixture',compatibilityDate:'2026-10-27',manifest:{mainModule:'worker.js',modules:{'worker.js':{type:'esm',contents}}}}}]});
try{
 const response=await mf.dispatchFetch('http://fixture.test');
 const result=await response.json();
 assert.equal(response.status,200,JSON.stringify(result));
 assert.deepEqual(result,{distanceMetres:300,durationSeconds:60});
 console.log('Geoapify adapter passed in real Workers runtime with synthetic provider.');
}finally{await mf.dispose();}
