import {useEffect,useRef,useState} from 'react';
import {supabase} from '../../lib/supabase';
type Estimate={distanceMetres:number;durationSeconds:number;calculatedAt:string;routeVersion:number};
const messages:Record<string,string>={MAPS_KEY_REJECTED:'A chave não foi aceita pelo Geoapify. Confira a chave e as restrições do projeto.',MAPS_PROVIDER_LIMIT:'A cota do Geoapify foi atingida. Tente novamente mais tarde.',MAPS_NOT_CONFIGURED:'Cálculo aguardando configuração da chave gratuita.',INCOMPLETE_ROUTE:'Confirme origem, chegada e todos os endereços. O cálculo aceita até 30 paradas.',ADDRESS_UNCERTAIN:'Um endereço não foi localizado com segurança. Revise os endereços completos.',MAPS_LIMIT:'Limite de consultas atingido. Aguarde um minuto; são permitidos até 20 cálculos por dia.',VERSION_CONFLICT:'A rota mudou. Atualize a rota antes de calcular novamente.',ROUTE_LOCKED:'A rota já começou. Não é possível criar uma previsão anterior à viagem.',FORBIDDEN:'Somente a dona pode calcular esta rota.',UNAUTHORIZED:'Entre novamente para calcular.'};
export default function RouteDistance({id,version,disabled}:{id:string;version:number;disabled:boolean}){
 const [estimate,setEstimate]=useState<Estimate|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');const controller=useRef<AbortController|null>(null);
 useEffect(()=>()=>controller.current?.abort(),[]);
 async function calculate(){
  setBusy(true);setError('');setEstimate(null);const current=new AbortController();controller.current=current;
  try{
   const session=await supabase.auth.getSession();const token=session.data.session?.access_token;if(!token)throw Error('UNAUTHORIZED');
   const response=await fetch(`/api/routes/${id}/distance`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({expectedVersion:version}),signal:current.signal});
   const result=await response.json();if(!response.ok)throw Error(result.error);
   if(result.routeVersion!==version||!Number.isFinite(result.distanceMetres)||!Number.isFinite(result.durationSeconds))throw Error('MAPS_UNAVAILABLE');
   if(!current.signal.aborted)setEstimate(result);
  }catch(error){if(!current.signal.aborted)setError(messages[error instanceof Error?error.message:'']??'Não foi possível calcular. Entregas e navegação continuam disponíveis.');}
  finally{if(!current.signal.aborted)setBusy(false);}
 }
 return <section aria-label="Estimativa do percurso"><h2>Distância e duração</h2><p>Consulta da rota salva, na ordem das paradas. Os locais podem usar endereço completo ou coordenadas no formato latitude,longitude. O tempo estimado não inclui atendimento nas entregas nem trânsito em tempo real.</p><p>Ao calcular, os endereços são enviados ao Geoapify, sem nomes ou contatos.</p><button type="button" className="secondary" disabled={disabled||busy} onClick={calculate}>{busy?'Calculando percurso…':'Calcular percurso'}</button>{disabled&&<p>Salve as alterações antes de calcular.</p>}{error&&<p role="alert">{error}</p>}{estimate&&<div role="status"><p><strong>{(estimate.distanceMetres/1000).toLocaleString('pt-BR',{maximumFractionDigits:1})} km</strong> · aproximadamente {Math.ceil(estimate.durationSeconds/60)} minutos de deslocamento</p><p>Consulta em {new Date(estimate.calculatedAt).toLocaleString('pt-BR')}. Estimativa momentânea; não fica gravada como previsão histórica.</p><p><a href="https://www.geoapify.com/" target="_blank" rel="noreferrer">Powered by Geoapify</a> · © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a></p></div>}</section>;
}
