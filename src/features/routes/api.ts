import {supabase} from '../../lib/supabase';
import type {Database} from '../../lib/database.types';
export type Stop=Database['public']['Tables']['route_stops']['Row'];
export type DriverStop={id:string;kind:string;position:number;customerName:string;address:string|null;phone:string|null;items:{eggsPerTray:number;trays:number}[];status:string;reason:string|null};
export type DriverRoute={available:false}|{id:string;status:string;version:number;initialOdometerKm:number|null;finalOdometerKm:number|null;loadEggs:number;vehicleEggs:number;declaredReturnEggs:number|null;declaredLossEggs:number|null;lastConfirmedAt:string|null;stops:DriverStop[]};
export async function loadDriverRoute(date:string){const {data,error}=await supabase.rpc('get_driver_route',{p_service_date:date});if(error)throw error;return data as DriverRoute;}
export async function loadRoute(date:string){
 const result=await supabase.from('route_runs').select('*').eq('service_date',date).maybeSingle();if(result.error)throw result.error;
 const stops:Stop[]=[];
 if(result.data)for(let start=0;;start+=200){const rows=await supabase.from('route_stops').select('*').eq('route_id',result.data.id).order('position').range(start,start+199);if(rows.error)throw rows.error;stops.push(...rows.data);if(rows.data.length<200)break;}
 return {route:result.data,stops};
}
export async function loadRouteOptions(){const {data,error}=await supabase.rpc('get_route_options');if(error)throw error;return data as {drivers:{id:string}[];vehicles:{id:string;name:string}[]};}
export async function loadTemplate(date:string){
 const weekday=new Date(`${date}T12:00:00Z`).getUTCDay();const template=await supabase.from('route_templates').select('*').eq('weekday',weekday).maybeSingle();if(template.error)throw template.error;if(!template.data)return null;
 const stops=await supabase.from('route_template_stops').select('*').eq('template_id',template.data.id).order('position');if(stops.error)throw stops.error;
 return {...template.data,stops:stops.data};
}
