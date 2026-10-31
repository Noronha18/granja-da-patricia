import { supabase } from '../../lib/supabase';
import type { Database } from '../../lib/database.types';
type Row<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];
export type Product = Row<'products'>;
export type Customer = Row<'customers'> & { items: Row<'standing_order_items'>[] };
export type CustomerDetails = Customer & { prices: Row<'customer_prices'>[] };
export async function loadProducts() {
 const all: Product[] = [];
 for (let start=0;;start+=200) {
  const {data,error}=await supabase.from('products').select('id,name,eggs_per_tray,default_price_cents').order('eggs_per_tray').range(start,start+199);
  if(error) throw error; all.push(...data); if(data.length<200) return all;
 }
}
export async function listCustomers(search: string,page: number,weekday='',activity='') {
 let query=supabase.from('customers').select('id,name,address,phone,active,weekday,position,version,notes,review_pending,source_details',{count:'exact'}).ilike('name',`%${search}%`);
 if(weekday) query=query.eq('weekday',Number(weekday));
 if(activity==='review') query=query.eq('review_pending',true);
 else if(activity) query=query.eq('active',activity==='active');
 const {data,error,count}=await query.order('name').order('id').range(page*50,page*50+49);
 if(error) throw error;
 const items: Row<'standing_order_items'>[]=[];
 if(data.length) for(let start=0;;start+=200) {
  const result=await supabase.from('standing_order_items').select('customer_id,product_id,trays').in('customer_id',data.map(customer=>customer.id)).order('customer_id').order('product_id').range(start,start+199);
  if(result.error) throw result.error;items.push(...result.data);if(result.data.length<200) break;
 }
 return {rows:data.map(customer=>({...customer,items:items.filter(item=>item.customer_id===customer.id)})),count:count??0};
}
export async function loadCustomer(id: string): Promise<CustomerDetails> {
 const {data,error}=await supabase.from('customers').select('id,name,address,phone,active,weekday,position,version,notes,review_pending,source_details').eq('id',id).single();if(error) throw error;
 const items: Row<'standing_order_items'>[]=[]; const prices: Row<'customer_prices'>[]=[];
 for(let start=0;;start+=200) {const result=await supabase.from('standing_order_items').select('customer_id,product_id,trays').eq('customer_id',id).order('product_id').range(start,start+199);if(result.error) throw result.error;items.push(...result.data);if(result.data.length<200) break;}
 for(let start=0;;start+=200) {const result=await supabase.from('customer_prices').select('customer_id,product_id,price_cents').eq('customer_id',id).order('product_id').range(start,start+199);if(result.error) throw result.error;prices.push(...result.data);if(result.data.length<200) break;}
 return {...data,items,prices};
}
export type CustomerWrite = { id:string; version:number; details: {name:string;address:string;phone:string|null;active:boolean;weekday:number|null;position:number;notes:string;reviewPending:boolean}; items: {productId:string;trays:number}[]; prices:{productId:string;priceCents:number}[] };
export async function saveCustomer(value: CustomerWrite,requestId: string) {
 const {data,error}=await supabase.rpc('save_customer',{p_customer_id:value.id,p_expected_version:value.version,p_details:value.details,p_items:value.items,p_prices:value.prices,p_request_id:requestId}).retry(false);if(error) throw error;
 return data as {id:string;version:number};
}
export async function saveProduct(product: Pick<Product,'name'|'eggs_per_tray'|'default_price_cents'>) {
 const {error}=await supabase.from('products').insert(product);if(error) throw error;
}
export async function recoverCustomerRequest(requestId:string) {
 const {data,error}=await supabase.rpc('reconcile_customer_request',{p_request_id:requestId}).retry(false);if(error) throw error;
 return data as {status:'saved';result:{id:string;version:number}}|{status:'closed'};
}
