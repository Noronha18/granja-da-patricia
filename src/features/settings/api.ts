import {supabase} from '../../lib/supabase';
import type {Json} from '../../lib/database.types';
import {preparation} from '../orders/api';
export type Location={id:string;name:string;address:string|null;confirmed:boolean};
export type DaySettings={weekday:number;name:string;originId:string|null;destinationId:string|null;pickupId:string|null;listPickupId:string|null;listReturnId:string|null};
export type Settings={version:number;driverId:string|null;vehicle:{id:string;name:string}|null;locations:Location[];days:DaySettings[]};
export async function loadSettings(){const {data,error}=await supabase.rpc('get_operational_settings');if(error)throw error;return data as unknown as Settings;}
export function saveSettings(settings:Settings,actorId:string){return preparation('save_operational_settings',actorId,async id=>{const {data,error}=await supabase.rpc('save_operational_settings',{p_expected_version:settings.version,p_settings:{...settings,vehicle:settings.vehicle?.name.trim()?settings.vehicle:null} as unknown as Json,p_request_id:id}).retry(false);if(error)throw error;return data as {version:number};});}
