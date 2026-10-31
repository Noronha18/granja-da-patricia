import {supabase} from '../../lib/supabase';
import type {Json} from '../../lib/database.types';
import type {ImportedCustomer} from './import';
import {preparation} from '../orders/api';
export type ImportResult={created:number;updated:number;rejected:number};
export type ImportPreview=ImportResult&{groups:{sourceId:string;action:'create'|'update'}[]};
export async function prepareImport(batchId:string,source:string,rows:ImportedCustomer[]){const {data,error}=await supabase.rpc('prepare_customer_import',{p_batch_id:batchId,p_source:source,p_rows:rows as unknown as Json}).retry(false);if(error)throw error;return data as unknown as ImportPreview;}
export function commitImport(batchId:string,rows:ImportedCustomer[],actorId:string){return preparation('commit_customer_import',actorId,async id=>{const {data,error}=await supabase.rpc('commit_customer_import',{p_batch_id:batchId,p_rows:rows as unknown as Json,p_request_id:id}).retry(false);if(error)throw error;return data as ImportResult;});}
export function importError(error:unknown){const failure=error as {code?:string;message?:string};if(failure.message==='VERSION_CONFLICT')return 'Um cadastro mudou em outra sessão. Nenhum cliente deste lote foi alterado. Confira o arquivo novamente.';if(failure.message==='BATCH_CONFLICT')return 'O arquivo mudou depois da conferência. Nenhum cliente foi alterado. Confira novamente.';if(failure.code==='22023')return 'O banco recusou o lote. Nenhum cadastro foi gravado. Confira nomes, endereços, identificadores e quantidades do formato de exemplo.';return 'Não foi possível confirmar o envio. A tentativa foi preservada. Verifique antes de tentar novamente.';}
