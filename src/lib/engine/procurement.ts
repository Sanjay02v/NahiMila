import type { CustomerReservation, DemandRequest, Merchant, MerchantAllocation, MerchantApproval, QuoteEvaluation, RuleCheckResult, SupplierQuote } from '@/types';
import { formatPaiseToRupees as money } from '@/lib/constants';
export interface EvaluationInput {
 quote:SupplierQuote; confirmedRequests:(DemandRequest & {reservation?:CustomerReservation; pickup_deadline?:string})[];
 merchants:Merchant[]; existingApprovals?:MerchantApproval[];
}
// Largest-remainder allocation preserves every paise, with stable merchant order for ties.
function apportion(total:number, units:number[]) {
 const sum=units.reduce((a,b)=>a+b,0); if(!sum)return units.map(()=>0);
 const shares=units.map(n=>Math.floor(total*n/sum));
 const indices=units.map((n,i)=>({i,remainder:(total*n)%sum})).sort((a,b)=>b.remainder-a.remainder||a.i-b.i);
 let remainder=total-shares.reduce((a,b)=>a+b,0);
 for(const {i} of indices) { if(remainder--<=0)break; shares[i]++; }
 return shares;
}
export function evaluateSupplierQuote({quote,confirmedRequests,merchants,existingApprovals=[]}:EvaluationInput):QuoteEvaluation {
 const checks:RuleCheckResult[]=[]; const reasons:string[]=[];
 const check=(rule:string,passed:boolean,message:string)=>{checks.push({rule,passed,message,critical:true});if(!passed)reasons.push(message);};
 const now=Date.now();
 const matching=confirmedRequests.filter(r=>r.sku===quote.sku && r.pack_size===quote.pack_size && r.can_wait && r.reservation?.status==='ACTIVE');
 check('Exact product & pack',matching.length>0,'Only active reservations for this exact SKU and pack can count.');
 const numeric=[quote.unit_cost_paise,quote.transport_cost_paise,quote.handling_cost_paise,quote.moq];
 check('Valid quote amounts',numeric.every(n=>Number.isSafeInteger(n)&&n>=0)&&quote.moq>0&&quote.unit_cost_paise>0,'Quote amounts must be integer paise; case size must be positive.');
 const isExpired=!Number.isFinite(Date.parse(quote.quote_expiry_date))||Date.parse(quote.quote_expiry_date)<=now;
 check('Quote validity',!isExpired,isExpired?'Quote has expired or has an invalid expiry.':'Quote is still valid.');
 const delivery=Date.parse(quote.expected_delivery_date);
 const arrives=Number.isFinite(delivery)&&delivery>now&&matching.every(r=>{
 const deadline=Date.parse(r.pickup_deadline||`${r.required_by_date}T20:00:00+05:30`);return Number.isFinite(deadline)&&deadline>now&&delivery<=deadline;
 });
 check('Customer pickup deadline',arrives,arrives?'Delivery fits every confirmed pickup deadline.':'Delivery misses a pickup deadline or is invalid.');
 const total=matching.reduce((s,r)=>s+r.quantity,0);
 const moqMet=total>0&&quote.moq>0&&total%quote.moq===0;
 check('Fully backed supplier cases',moqMet,moqMet?`${total} reserved units cover whole ${quote.moq}-unit cases.`:`${total} reserved units cannot cover whole ${quote.moq}-unit cases. No extra stock is assumed.`);
 const participants=merchants.filter(m=>matching.some(r=>r.merchant_id===m.id));
 check('Known merchants',matching.every(r=>merchants.some(m=>m.id===r.merchant_id)),'Every reservation must belong to a known merchant.');
 const units=participants.map(m=>matching.filter(r=>r.merchant_id===m.id).reduce((s,r)=>s+r.quantity,0));
 const transport=apportion(quote.transport_cost_paise,units), handling=apportion(quote.handling_cost_paise,units);
 const allocations:MerchantAllocation[]=participants.map((m,i)=>{
 const goods=units[i]*quote.unit_cost_paise, exposure=goods+transport[i]+handling[i];
 const approval=existingApprovals.find(a=>a.merchant_id===m.id&&a.quote_id===quote.id&&a.quote_version===quote.version);
 const current=approval?.exposure_paise===exposure;
 return {merchant_id:m.id,merchant_name:m.name,cash_cap_paise:m.cash_cap_paise,requested_units:units[i],allocated_units:units[i],unit_cost_paise:quote.unit_cost_paise,
 allocated_goods_cost_paise:goods,allocated_transport_paise:transport[i],allocated_handling_paise:handling[i],total_exposure_paise:exposure,cash_cap_headroom_paise:m.cash_cap_paise-exposure,within_cap:exposure<=m.cash_cap_paise,
 approval_status:approval?(current?approval.status:'INVALIDATED'):'PENDING',approved_version:approval?.quote_version,invalidation_reason:approval?.invalidation_reason||(!current&&approval?'Allocation changed':undefined)};
 });
 const caps=allocations.every(a=>a.within_cap), permitted=participants.every(m=>m.allowed_suppliers.includes(quote.supplier_id));
 for(const a of allocations)check(`Cash limit · ${a.merchant_name}`,a.within_cap,`${money(a.total_exposure_paise)} exposure / ${money(a.cash_cap_paise)} cash limit.`);
 check('Merchant supplier permissions',permitted,permitted?'Each participating shop permits this supplier.':'A participating shop has not permitted this supplier.');
 const prices=matching.every(r=>{
 const a=allocations.find(a=>a.merchant_id===r.merchant_id);const price=r.reservation!.confirmed_price_paise;
 return price>0&&price<=r.max_retail_price_paise&&!!a&&price*a.allocated_units>=a.total_exposure_paise;
 });
 check('Exact confirmed retail price',prices,prices?'Confirmed prices stay inside customer budgets and cover landed cost.':'A confirmed retail price exceeds its budget or cannot cover landed cost.');
 return {quote_id:quote.id,quote_version:quote.version,supplier_name:quote.supplier_name,sku:quote.sku,pack_size:quote.pack_size,total_demand_units:total,moq:quote.moq,moq_met:moqMet,is_expired:isExpired,arrives_in_time:arrives,all_merchants_within_cap:caps,all_suppliers_permitted:permitted,is_eligible:checks.every(c=>c.passed),rule_checks:checks,allocations,total_procurement_cost_paise:allocations.reduce((s,a)=>s+a.total_exposure_paise,0),rejection_reasons:reasons};
}
