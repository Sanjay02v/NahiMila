export type UnavailableReason =
  | 'not_stocked'
  | 'out_of_stock'
  | 'wrong_variant'
  | 'wrong_pack'
  | 'price_mismatch'
  | 'unavailable_before_deadline';

export type RequestStatus =
  | 'REQUEST_CAPTURED'
  | 'OFFER_CREATED'
  | 'CUSTOMER_CONFIRMED'
  | 'DEMAND_MATCHED'
  | 'PROCUREMENT_EVALUATED'
  | 'APPROVAL_PENDING'
  | 'APPROVED'
  | 'SUPPLIER_COMMITTED'
  | 'READY_FOR_PICKUP'
  | 'PICKED_UP'
  | 'REJECTED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'NO_SHOW';

export type ReservationStatus =
  | 'ACTIVE'
  | 'COMMITTED'
  | 'FULFILLED'
  | 'CANCELLED'
  | 'NO_SHOW';

export type ApprovalStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'INVALIDATED'
  | 'REJECTED';

export type OrderStatus =
  | 'SIMULATED_COMMITTED'
  | 'IN_TRANSIT'
  | 'DELIVERED_TO_MERCHANTS'
  | 'CANCELLED';

export type PickupOutcome = 'COLLECTED' | 'NO_SHOW';

export interface Merchant {
  id: string;
  name: string;
  owner_name: string;
  neighborhood: string;
  cash_cap_paise: number; // in paise (e.g. ₹350 = 35000)
  allowed_suppliers: string[]; // supplier IDs
  contact_phone: string;
  created_at: string;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  category: string;
  pack_size: string;
  standard_mrp_paise: number;
  shelf_stable: boolean;
  created_at: string;
}

export interface DemandRequest {
  id: string;
  request_token: string;
  merchant_id: string;
  product_id: string;
  sku: string;
  pack_size: string;
  quantity: number;
  max_retail_price_paise: number;
  required_by_date: string; // ISO date YYYY-MM-DD
  reason_unavailable: UnavailableReason;
  can_wait: boolean;
  customer_phone?: string;
  customer_name?: string;
  status: RequestStatus;
  created_at: string;
  updated_at: string;
}

export interface CustomerOffer {
  id: string;
  request_id: string;
  request_token: string;
  proposed_price_paise: number;
  pickup_merchant_id: string;
  pickup_deadline: string;
  is_conditional: boolean;
  created_at: string;
}

export interface CustomerReservation {
  id: string;
  request_token: string; // Unique per active reservation
  request_id: string;
  offer_id: string;
  merchant_id: string;
  sku: string;
  pack_size: string;
  quantity: number;
  confirmed_price_paise: number;
  status: ReservationStatus;
  confirmed_at: string;
  updated_at: string;
}

export interface Supplier {
  id: string;
  name: string;
  contact_email: string;
  is_verified: boolean;
}

export interface SupplierQuote {
  id: string;
  supplier_id: string;
  supplier_name: string;
  sku: string;
  pack_size: string;
  unit_cost_paise: number;
  moq: number;
  transport_cost_paise: number;
  handling_cost_paise: number;
  expected_delivery_date: string; // ISO string
  quote_expiry_date: string; // ISO string
  version: number;
  created_at: string;
  updated_at: string;
}

export interface MerchantAllocation {
  merchant_id: string;
  merchant_name: string;
  cash_cap_paise: number;
  requested_units: number;
  allocated_units: number;
  unit_cost_paise: number;
  allocated_goods_cost_paise: number;
  allocated_transport_paise: number;
  allocated_handling_paise: number;
  total_exposure_paise: number;
  cash_cap_headroom_paise: number; // positive = headroom, negative = shortfall
  within_cap: boolean;
  approval_status: ApprovalStatus;
  approved_version?: number;
  invalidation_reason?: string;
}

export interface RuleCheckResult {
  rule: string;
  passed: boolean;
  message: string;
  critical: boolean;
}

export interface QuoteEvaluation {
  quote_id: string;
  quote_version: number;
  supplier_name: string;
  sku: string;
  pack_size: string;
  total_demand_units: number;
  moq: number;
  moq_met: boolean;
  is_expired: boolean;
  arrives_in_time: boolean;
  all_merchants_within_cap: boolean;
  all_suppliers_permitted: boolean;
  is_eligible: boolean;
  rule_checks: RuleCheckResult[];
  allocations: MerchantAllocation[];
  total_procurement_cost_paise: number;
  rejection_reasons: string[];
}

export interface MerchantApproval {
  id: string;
  merchant_id: string;
  quote_id: string;
  quote_version: number;
  allocation_version: number;
  exposure_paise: number;
  status: ApprovalStatus;
  approved_at: string | null;
  invalidated_at: string | null;
  invalidation_reason: string | null;
}

export interface ProcurementOrder {
  evaluation?: QuoteEvaluation;
  supplier_quote?: SupplierQuote;
  id: string;
  quote_id: string;
  quote_version: number;
  allocation_version: number;
  total_units: number;
  total_cost_paise: number;
  status: OrderStatus;
  committed_at: string;
  tracking_reference: string;
  merchant_allocations: {
    merchant_id: string;
    units: number;
    exposure_paise: number;
  }[];
}

export interface PickupRecord {
  id: string;
  reservation_id: string; // Unique constraint
  request_id: string;
  merchant_id: string;
  customer_name: string;
  quantity: number;
  unit_price_paise: number;
  total_collected_paise: number;
  outcome: PickupOutcome;
  recorded_at: string;
}

export interface NoShowAnalysis {
  merchant_id: string;
  merchant_name: string;
  allocated_units: number;
  total_procurement_cost_paise: number;
  retail_price_paise: number;
  collected_units: number;
  collected_cash_paise: number;
  uncollected_units: number; // Residual inventory
  current_cash_shortfall_paise: number; // Procurement cost - collected cash
  status_description: string;
}

export interface AuditEvent {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  payload: Record<string, unknown>;
  timestamp: string;
}
