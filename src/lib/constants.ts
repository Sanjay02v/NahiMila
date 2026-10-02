import type { Merchant, Product, Supplier, SupplierQuote } from '@/types';
export const SYNTHETIC_NEIGHBORHOOD = 'Indiranagar, Bengaluru';
export function getFutureDateString(days: number) { return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Date.now()+days*86400000)); }
export function getFutureDate(days: number, hours=12) { return `${getFutureDateString(days)}T${String(hours).padStart(2,'0')}:00:00+05:30`; }
const created_at = new Date().toISOString();
export const INITIAL_MERCHANTS: Merchant[] = ['Sharma Kirana','Gupta General Store','Lakshmi Provisions'].map((name,i)=>({
 id: ['m-sharma-001','m-gupta-002','m-lakshmi-003'][i], name, owner_name:['Ramesh','Alok','Lakshmi'][i], neighborhood:SYNTHETIC_NEIGHBORHOOD,
 cash_cap_paise:35000, allowed_suppliers:['sup-a','sup-b','sup-c'], contact_phone:'', created_at
}));
export const INITIAL_PRODUCTS: Product[] = [
 {id:'prod-millet',sku:'MC-MASALA-100G',name:'Millet Crunch · Masala',category:'Snacks',pack_size:'100g',standard_mrp_paise:5000,shelf_stable:true,created_at},
 {id:'prod-millet-200',sku:'MC-MASALA-200G',name:'Millet Crunch · Masala',category:'Snacks',pack_size:'200g',standard_mrp_paise:9000,shelf_stable:true,created_at},
 {id:'prod-millet-lime',sku:'MC-LIME-100G',name:'Millet Crunch · Lime',category:'Snacks',pack_size:'100g',standard_mrp_paise:5000,shelf_stable:true,created_at}
];
export const INITIAL_SUPPLIERS: Supplier[] = ['Neighbourhood Wholesale','Local Distribution Co.','Community Supply'].map((name,i)=>({id:['sup-a','sup-b','sup-c'][i],name,contact_email:'',is_verified:false}));
export const INITIAL_SUPPLIER_QUOTES: SupplierQuote[] = INITIAL_SUPPLIERS.map((supplier,i)=>({
 id:['quote-a','quote-b','quote-c'][i],supplier_id:supplier.id,supplier_name:supplier.name,sku:'MC-MASALA-100G',pack_size:'100g',
 unit_cost_paise:[3800,4200,4000][i],moq:[48,24,24][i],transport_cost_paise:2400,handling_cost_paise:0,
 expected_delivery_date:getFutureDate(i===2?3:1),quote_expiry_date:getFutureDate(2,18),version:1,created_at,updated_at:created_at
}));
export function formatPaiseToRupees(paise:number) { return new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2,minimumFractionDigits:paise%100===0?0:2}).format(paise/100); }
export function formatPaisePlain(paise:number) { return String(paise/100); }
export function parseRupeesToPaise(value:number|string) { const n=Number(value); return Number.isFinite(n)?Math.round(n*100):0; }
