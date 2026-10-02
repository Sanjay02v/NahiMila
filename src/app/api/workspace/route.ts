import { NextResponse } from 'next/server';
import { assertSameOrigin } from '@/lib/same-origin';
import { withWorkspace,snapshot } from '@/lib/db/workspace';
import type { SupplierQuote, UnavailableReason } from '@/types';
export const runtime='nodejs';
const response=(data:unknown)=>NextResponse.json(data,{headers:{'Cache-Control':'no-store'}});
const errorResponse=(e:unknown)=>NextResponse.json({error:e instanceof Error?e.message:'Unable to update demo.'},{status:400});
export async function GET(req:Request){try{const id=new URL(req.url).searchParams.get('workspace')||'';return response(await withWorkspace(id,s=>snapshot(s)));}catch(e){return errorResponse(e);}}
function amount(value:unknown,label:string,min=0){if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>100000000)throw new Error(`${label} must be a valid integer amount.`);return value;}
function text(value:unknown,label:string){if(typeof value!=='string'||!value.trim()||value.length>300)throw new Error(`Invalid ${label}.`);return value;}
export async function POST(req:Request){
 try{
 assertSameOrigin(req);
 if(Number(req.headers.get('content-length'))>15000)throw new Error('Request too large.');
 const body=await req.json();const id=text(body.workspace,'workspace');
 const result=await withWorkspace(id,async s=>{
 let message='Updated';let token:string|undefined;
 switch(body.action){
 case 'reset':s.resetToSeed();message='Demo reset: 23 reservations and one offer awaiting confirmation.';break;
 case 'create':{
 if(s.requests.length>=200)throw new Error('This demo is limited to 200 requests. Reset to start again.');
 const reason=text(body.reason,'unavailability reason') as UnavailableReason;
 if(!['not_stocked','out_of_stock','wrong_variant','wrong_pack','price_mismatch','unavailable_before_deadline'].includes(reason))throw new Error('Invalid reason.');
 if(typeof body.can_wait!=='boolean')throw new Error('Specify whether the customer can wait.');
 const canWait=body.can_wait;
 const customerName=body.customer_name==null||body.customer_name===''?undefined:text(body.customer_name,'customer name');
 if(canWait&&!customerName)throw new Error('Invalid customer name.');
 const result=s.createDemandRequest({merchant_id:text(body.merchant_id,'merchant'),product_id:text(body.product_id,'product'),quantity:amount(body.quantity,'Quantity',1),max_retail_price_paise:amount(body.price_paise??(canWait?undefined:0),'Customer budget',canWait?1:0),required_by_date:canWait?text(body.deadline,'deadline'):'',reason_unavailable:reason,can_wait:canWait,customer_name:customerName});
 token=result.request.request_token;message=result.offer?'Exact offer created. Only customer confirmation adds it to shared demand.':'Missed demand recorded. Customer won’t wait; no offer or reservation was created.';break;}
 case 'confirm':{const r=s.confirmCustomerOffer(text(body.token,'offer token'));message=r.isDuplicate?'Already confirmed. This reservation was counted only once.':'Reservation confirmed. Shared demand has been recalculated.';break;}
 case 'cancel':s.cancelCustomerReservation(text(body.token,'offer token'));message='Reservation withdrawn. Previous approvals are cleared.';break;
 case 'cap':s.updateMerchantCashCap(text(body.merchant_id,'merchant'),amount(body.cap_paise,'Cash limit'));message='Cash limit updated. Review the new allocation before approving.';break;
 case 'permission':{
 const m=s.getMerchantById(text(body.merchant_id,'merchant'));const supplier=text(body.supplier_id,'supplier');if(!m||!s.suppliers.some(x=>x.id===supplier))throw new Error('Unknown merchant or supplier.');
 m.allowed_suppliers=body.allowed===true?[...new Set([...m.allowed_suppliers,supplier])]:m.allowed_suppliers.filter(x=>x!==supplier);s.invalidateAllApprovals('Supplier permission changed');message='Supplier permission updated; approvals cleared.';break;}
 case 'quote':{
 const old=s.getQuoteById(text(body.quote_id,'quote'));if(!old)throw new Error('Unknown quote.');
 const sku=text(body.sku,'SKU'),pack=text(body.pack_size,'pack');
 const delivery=text(body.delivery,'delivery'),expiry=text(body.expiry,'expiry');if(!Number.isFinite(Date.parse(delivery))||!Number.isFinite(Date.parse(expiry)))throw new Error('Choose valid delivery and expiry dates.');
 const q:SupplierQuote={...old,sku,pack_size:pack,unit_cost_paise:amount(body.unit_paise,'Unit cost',1),moq:amount(body.moq,'Case size',1),transport_cost_paise:amount(body.transport_paise,'Transport'),handling_cost_paise:amount(body.handling_paise,'Handling'),expected_delivery_date:delivery,quote_expiry_date:expiry};s.saveQuote(q);message='Quote updated. Previous approvals no longer apply.';break;}
 case 'approve':s.recordMerchantApproval({merchant_id:text(body.merchant_id,'merchant'),quote_id:text(body.quote_id,'quote'),quote_version:amount(body.quote_version,'Quote version',1),exposure_paise:amount(body.exposure_paise,'Exposure'),approved:true});message='This shop approved its current cash exposure.';break;
 case 'commit':{const order=await s.commitSupplierOrder(text(body.quote_id,'quote'));message=`Order ${order.tracking_reference} recorded once. Supplier acceptance and delivery are simulated.`;break;}
 case 'pickup':{if(!['COLLECTED','NO_SHOW'].includes(body.outcome))throw new Error('Invalid outcome.');await s.recordPickup({reservation_id:text(body.reservation_id,'reservation'),outcome:body.outcome});message='Demo outcome recorded. Committed supplier cost remains in the ledger.';break;}
 default:throw new Error('Unknown action.');
 }
 return {data:snapshot(s),message,token};
 },true);return response(result);
 }catch(e){return errorResponse(e);}
}
