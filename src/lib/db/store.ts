import {
  AuditEvent,
  CustomerOffer,
  CustomerReservation,
  DemandRequest,
  Merchant,
  MerchantApproval,
  NoShowAnalysis,
  PickupOutcome,
  PickupRecord,
  ProcurementOrder,
  Product,
  Supplier,
  SupplierQuote,
  UnavailableReason,
} from '@/types';
import {
  INITIAL_MERCHANTS,
  INITIAL_PRODUCTS,
  INITIAL_SUPPLIER_QUOTES,
  INITIAL_SUPPLIERS,
  getFutureDateString,
  getFutureDate,
} from '@/lib/constants';
import { evaluateSupplierQuote } from '@/lib/engine/procurement';
import {
  canCommitSupplierOrder,
  invalidateApprovalsForMerchant,
  invalidateApprovalsForQuote,
} from '@/lib/engine/approval';

// Thread-safe mutex simulation for atomic order commit & pickup recording
class AsyncLock {
  private promise: Promise<void> = Promise.resolve();

  async acquire(): Promise<() => void> {
    let release: () => void;
    const nextPromise = new Promise<void>(resolve => {
      release = resolve;
    });
    const currentPromise = this.promise;
    this.promise = this.promise.then(() => nextPromise);
    await currentPromise;
    return release!;
  }
}

const orderCommitLock = new AsyncLock();
const pickupLock = new AsyncLock();

export interface SeedDataPayload {
  merchants: Merchant[];
  products: Product[];
  suppliers: Supplier[];
  quotes: SupplierQuote[];
  requests: DemandRequest[];
  offers: CustomerOffer[];
  reservations: CustomerReservation[];
  orders: ProcurementOrder[];
  pickups: PickupRecord[];
  auditEvents: AuditEvent[];
  approvalsByQuote?: Record<string, MerchantApproval[]>;
}

// In-Memory & Persistent State Holder
export class MemoryStore {
  public merchants: Merchant[] = [];
  public products: Product[] = [];
  public suppliers: Supplier[] = [];
  public quotes: SupplierQuote[] = [];
  public requests: DemandRequest[] = [];
  public offers: CustomerOffer[] = [];
  public reservations: CustomerReservation[] = [];
  public orders: ProcurementOrder[] = [];
  public pickups: PickupRecord[] = [];
  public auditEvents: AuditEvent[] = [];

  constructor(seed=true) {
    if(seed)this.resetToSeed();
  }

  public resetToSeed() {
    this.merchants = JSON.parse(JSON.stringify(INITIAL_MERCHANTS));
    this.products = JSON.parse(JSON.stringify(INITIAL_PRODUCTS));
    this.suppliers = JSON.parse(JSON.stringify(INITIAL_SUPPLIERS));
    this.quotes = JSON.parse(JSON.stringify(INITIAL_SUPPLIER_QUOTES)).map((q:SupplierQuote,i:number)=>({...q,expected_delivery_date:getFutureDate(i===2?3:1),quote_expiry_date:getFutureDate(2,18)}));
    this.requests = [];
    this.offers = [];
    this.reservations = [];
    this.orders = [];
    this.pickups = [];
    this.auditEvents = [];

    this.approvalsByQuote = {};
    for (let i=0;i<24;i++) {
      const merchant = this.merchants[Math.floor(i/8)];
      const {request,offer}=this.createDemandRequest({merchant_id:merchant.id,product_id:'prod-millet',quantity:1,max_retail_price_paise:5000,required_by_date:getFutureDateString(2),reason_unavailable:'not_stocked',can_wait:true,customer_name:`Customer ${String(i+1).padStart(2,'0')}`});
      const token=`REQ-NML-${8801+i}`; request.request_token=token;if(!offer)throw new Error('Seed requires an offer');offer.request_token=token;
      if(i!==7)this.confirmCustomerOffer(token);
    }

    this.logAudit('SYSTEM', 'SEED', 'INITIALIZE_DEMO', {
      merchantsCount: this.merchants.length,
      seededRequests: this.requests.length,
    });
  }

  public logAudit(entityType: string, entityId: string, action: string, payload: Record<string, unknown>) {
    if (this.auditEvents.length>=500) this.auditEvents=this.auditEvents.slice(-499);
    this.auditEvents.push({
      id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      entity_type: entityType,
      entity_id: entityId,
      action,
      payload,
      timestamp: new Date().toISOString(),
    });
  }

  // ================= Merchant Operations =================
  public getMerchants(): Merchant[] {
    return this.merchants;
  }

  public getMerchantById(id: string): Merchant | undefined {
    return this.merchants.find(m => m.id === id);
  }

  public updateMerchantCashCap(merchantId: string, newCapPaise: number): {
    merchant: Merchant;
    invalidatedApprovalsCount: number;
  } {
    const merchant = this.merchants.find(m => m.id === merchantId);
    if (!merchant) {
      throw new Error(`Merchant ${merchantId} not found`);
    }

    const oldCap = merchant.cash_cap_paise;
    merchant.cash_cap_paise = newCapPaise;

    // Material change: Cash cap change invalidates affected approvals!
    let invalidatedCount = 0;
    for (const quote of this.quotes) {
      // Find approvals for this merchant
      // In our store, we track approvals per quote/merchant
      const initialApprovals = this.getApprovalsForQuote(quote.id);
      const updatedApprovals = invalidateApprovalsForMerchant(
        initialApprovals,
        merchantId,
        `Merchant cash cap modified from ₹${oldCap / 100} to ₹${newCapPaise / 100}`
      );
      this.saveApprovalsForQuote(quote.id, updatedApprovals);
      invalidatedCount += updatedApprovals.filter(a => a.status === 'INVALIDATED').length;
    }

    this.logAudit('MERCHANT', merchantId, 'UPDATE_CASH_CAP', {
      oldCapPaise: oldCap,
      newCapPaise,
      invalidatedCount,
    });

    return { merchant, invalidatedApprovalsCount: invalidatedCount };
  }

  // ================= Product Operations =================
  public getProducts(): Product[] {
    return this.products;
  }

  public getProductBySku(sku: string): Product | undefined {
    return this.products.find(p => p.sku === sku);
  }

  // ================= Demand Request Operations =================
  public createDemandRequest(params: {
    merchant_id: string;
    product_id: string;
    quantity: number;
    max_retail_price_paise: number;
    required_by_date: string;
    reason_unavailable: UnavailableReason;
    can_wait: boolean;
    pickup_deadline?: string;
    customer_phone?: string;
    customer_name?: string;
  }): { request: DemandRequest; offer: CustomerOffer | null } {
    const merchant = this.getMerchantById(params.merchant_id);
    if (!merchant) throw new Error('Invalid merchant ID');

    const product = this.products.find(p => p.id === params.product_id);
    if (!product) throw new Error('Unknown product SKU. Correction required before counting as demand.');

    if (!Number.isSafeInteger(params.quantity) || params.quantity <= 0) throw new Error('Quantity must be at least 1');
    if (!Number.isSafeInteger(params.max_retail_price_paise) || params.max_retail_price_paise < (params.can_wait ? 1 : 0)) throw new Error('Retail price ceiling must be greater than 0');

    if (params.pickup_deadline && (!Number.isFinite(Date.parse(params.pickup_deadline)) || Date.parse(params.pickup_deadline)<=Date.now())) throw new Error('INVALID_DEADLINE');
    if (params.can_wait && !params.pickup_deadline && (!/^\d{4}-\d{2}-\d{2}$/.test(params.required_by_date) || !Number.isFinite(Date.parse(`${params.required_by_date}T20:00:00+05:30`)) || Date.parse(`${params.required_by_date}T20:00:00+05:30`)<=Date.now())) throw new Error('Choose a future pickup deadline.');
    // Generate unique stable token
    const token = `NML-${crypto.randomUUID()}`;
    const reqId = `req-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const offerId = `off-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const now = new Date().toISOString();

    const request: DemandRequest = {
      id: reqId,
      request_token: token,
      merchant_id: params.merchant_id,
      product_id: product.id,
      sku: product.sku,
      pack_size: product.pack_size,
      quantity: params.quantity,
      max_retail_price_paise: params.max_retail_price_paise,
      required_by_date: params.can_wait ? params.required_by_date : '',
      reason_unavailable: params.reason_unavailable,
      can_wait: params.can_wait,
      customer_phone: params.customer_phone,
      customer_name: params.customer_name || 'Walk-in Customer',
      status: params.can_wait ? 'OFFER_CREATED' : 'MISSED_DEMAND',
      created_at: now,
      updated_at: now,
    };

    const offer: CustomerOffer | null = params.can_wait ? {
      id: offerId,
      request_id: reqId,
      request_token: token,
      proposed_price_paise: params.max_retail_price_paise,
      pickup_merchant_id: params.merchant_id,
      pickup_deadline: params.pickup_deadline || `${params.required_by_date}T20:00:00+05:30`,
      is_conditional: true,
      created_at: now,
    } : null;

    this.requests.push(request);
    if (offer) this.offers.push(offer);

    this.logAudit('REQUEST', reqId, 'REQUEST_CAPTURED', {
      token,
      sku: product.sku,
      merchantId: params.merchant_id,
      canWait: params.can_wait,
    });

    return { request, offer };
  }

  public getRequestByToken(token: string): {
    request: DemandRequest;
    offer: CustomerOffer;
    product: Product;
    merchant: Merchant;
    reservation?: CustomerReservation;
  } | null {
    const request = this.requests.find(r => r.request_token === token);
    if (!request) return null;

    const offer = this.offers.find(o => o.request_token === token);
    if (!offer) return null;

    const product = this.products.find(p => p.id === request.product_id);
    const merchant = this.getMerchantById(request.merchant_id);
    const reservation = this.reservations.find(
      r => r.request_token === token && r.status === 'ACTIVE'
    );

    if (!product || !merchant) return null;

    return { request, offer, product, merchant, reservation };
  }

  // ================= Customer Confirmation (IDEMPOTENT) =================
  public confirmCustomerOffer(token: string): {
    reservation: CustomerReservation;
    isDuplicate: boolean;
  } {
    // 1. Check if an active reservation already exists (Database Unique Constraint simulation)
    const existing = this.reservations.find(
      r => r.request_token === token && r.status !== 'CANCELLED'
    );
    if (existing) {
      // Idempotent return: do NOT create duplicate
      return { reservation: existing, isDuplicate: true };
    }

    const reqData = this.getRequestByToken(token);
    if (!reqData) {
      throw new Error(`Invalid or expired request token: ${token}`);
    }

    const { request, offer } = reqData;

    if (!request.can_wait || Date.parse(offer.pickup_deadline)<=Date.now()) throw new Error('Offer has expired or the customer cannot wait.');
    if (offer.proposed_price_paise>request.max_retail_price_paise) throw new Error('Offer exceeds the customer budget.');
    // Check state transition validity
    if (
      request.status !== 'OFFER_CREATED' &&
      request.status !== 'REQUEST_CAPTURED' &&
      request.status !== 'CUSTOMER_CONFIRMED'
    ) {
      throw new Error(`Cannot confirm offer in state: ${request.status}`);
    }

    const resId = `res-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const now = new Date().toISOString();

    const reservation: CustomerReservation = {
      id: resId,
      request_token: token,
      request_id: request.id,
      offer_id: offer.id,
      merchant_id: request.merchant_id,
      sku: request.sku,
      pack_size: request.pack_size,
      quantity: request.quantity,
      confirmed_price_paise: offer.proposed_price_paise,
      status: 'ACTIVE',
      confirmed_at: now,
      updated_at: now,
    };

    this.invalidateProductApprovals(reservation.sku, reservation.pack_size, 'Confirmed demand changed');
    this.reservations.push(reservation);
    request.status = 'CUSTOMER_CONFIRMED';
    request.updated_at = now;

    this.logAudit('RESERVATION', resId, 'CUSTOMER_CONFIRMED', {
      token,
      quantity: reservation.quantity,
      pricePaise: reservation.confirmed_price_paise,
    });

    return { reservation, isDuplicate: false };
  }

  // ================= Cancellation before commitment =================
  public cancelCustomerReservation(token: string, reason: string = 'Customer cancelled'): {
    reservation: CustomerReservation;
    invalidatedApprovalsCount: number;
  } {
    const reservation = this.reservations.find(
      r => r.request_token === token && r.status === 'ACTIVE'
    );
    if (!reservation) {
      throw new Error(`No active reservation found for token ${token}`);
    }

    // If order is already committed, cancellation cannot pretend supplier cost disappeared
    const committedOrder = this.orders.find(o=>o.selected_reservation_ids?.includes(reservation.id));
    if (committedOrder) {
      throw new Error(
        'Supplier order already committed. Supplier procurement cost cannot be eliminated.'
      );
    }

    reservation.status = 'CANCELLED';
    reservation.updated_at = new Date().toISOString();

    const request = this.requests.find(r => r.request_token === token);
    if (request) {
      request.status = 'CANCELLED';
      request.updated_at = reservation.updated_at;
    }

    // Material change: Invalidate approvals because quantity changed!
    let invalidatedCount = 0;
    for (const quote of this.quotes.filter(q => q.sku === reservation.sku && q.pack_size === reservation.pack_size)) {
      const initialApprovals = this.getApprovalsForQuote(quote.id);
      const updated = invalidateApprovalsForQuote(
        initialApprovals,
        quote.id,
        `Reservation ${token} cancelled before commitment (${reason})`
      );
      this.saveApprovalsForQuote(quote.id, updated);
      invalidatedCount += updated.filter(a => a.status === 'INVALIDATED').length;
    }

    this.logAudit('RESERVATION', reservation.id, 'CANCELLED_BEFORE_COMMIT', {
      token,
      reason,
      invalidatedCount,
    });

    return { reservation, invalidatedApprovalsCount: invalidatedCount };
  }

  // ================= Supplier Quotes Operations =================
  public getQuotes(): SupplierQuote[] {
    return this.quotes;
  }

  public getQuoteById(quoteId: string): SupplierQuote | undefined {
    return this.quotes.find(q => q.id === quoteId);
  }

  public saveQuote(quote: SupplierQuote): { quote: SupplierQuote; invalidatedCount: number } {
    const existingIndex = this.quotes.findIndex(q => q.id === quote.id);
    let invalidatedCount = 0;

    if (existingIndex >= 0) {
      const existing = this.quotes[existingIndex];
      // Increment version
      const updatedQuote: SupplierQuote = {
        ...quote,
        version: existing.version + 1,
        updated_at: new Date().toISOString(),
      };
      this.quotes[existingIndex] = updatedQuote;

      // Invalidate existing approvals because quote parameters changed!
      const initialApprovals = this.getApprovalsForQuote(quote.id);
      const updatedApprovals = invalidateApprovalsForQuote(
        initialApprovals,
        quote.id,
        `Supplier quote modified to v${updatedQuote.version} (Price/Logistics/Timeline changed)`
      );
      this.saveApprovalsForQuote(quote.id, updatedApprovals);
      invalidatedCount = updatedApprovals.filter(a => a.status === 'INVALIDATED').length;

      this.logAudit('QUOTE', quote.id, 'QUOTE_UPDATED', {
        newVersion: updatedQuote.version,
        invalidatedCount,
      });

      return { quote: updatedQuote, invalidatedCount };
    } else {
      const newQuote: SupplierQuote = {
        ...quote,
        id: quote.id || `quote-${Date.now()}`,
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      this.quotes.push(newQuote);

      this.logAudit('QUOTE', newQuote.id, 'QUOTE_CREATED', {
        sku: newQuote.sku,
        supplier: newQuote.supplier_name,
      });

      return { quote: newQuote, invalidatedCount: 0 };
    }
  }

  // ================= Approvals Storage =================
  private approvalsByQuote: Record<string, MerchantApproval[]> = {};

  public getApprovalsForQuote(quoteId: string): MerchantApproval[] {
    return this.approvalsByQuote[quoteId] || [];
  }

  public saveApprovalsForQuote(quoteId: string, approvals: MerchantApproval[]) {
    this.approvalsByQuote[quoteId] = approvals;
  }

  public recordMerchantApproval(params: {
    merchant_id: string;
    quote_id: string;
    quote_version: number;
    allocation_version?: number;
    allocation_fingerprint?: string;
    exposure_paise: number;
    approved: boolean;
  }): MerchantApproval {
    const evaluation=this.evaluateQuote(params.quote_id);
    const allocation=evaluation.allocations.find(a=>a.merchant_id===params.merchant_id);
    if(params.approved && (!evaluation.is_eligible || !allocation || evaluation.quote_version!==params.quote_version || allocation.total_exposure_paise!==params.exposure_paise)) throw new Error('The order changed. Review the current eligible allocation before approving.');
    const approvals = this.getApprovalsForQuote(params.quote_id);
    const existingIndex = approvals.findIndex(
      a =>
        a.merchant_id === params.merchant_id &&
        a.quote_id === params.quote_id &&
        a.quote_version === params.quote_version
    );

    const now = new Date().toISOString();
    const approval: MerchantApproval = {
      id:
        existingIndex >= 0
          ? approvals[existingIndex].id
          : `appr-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      merchant_id: params.merchant_id,
      quote_id: params.quote_id,
      quote_version: params.quote_version,
      allocation_version: params.allocation_version || 1,
      allocation_fingerprint: params.allocation_fingerprint,
      exposure_paise: params.exposure_paise,
      status: params.approved ? 'APPROVED' : 'REJECTED',
      approved_at: params.approved ? now : null,
      invalidated_at: null,
      invalidation_reason: null,
    };

    if (existingIndex >= 0) {
      approvals[existingIndex] = approval;
    } else {
      approvals.push(approval);
    }

    this.saveApprovalsForQuote(params.quote_id, approvals);

    this.logAudit('APPROVAL', approval.id, params.approved ? 'MERCHANT_APPROVED' : 'MERCHANT_REJECTED', {
      merchantId: params.merchant_id,
      quoteId: params.quote_id,
      quoteVersion: params.quote_version,
      exposurePaise: params.exposure_paise,
    });

    return approval;
  }

  // ================= Evaluation =================
  // The product coordinator restricts a quote to its consenting local cohort.
  public eligibleMerchantIdsForQuote?: (quote: SupplierQuote) => Set<string>;

  public evaluateQuote(quoteId: string) {
    const quote = this.getQuoteById(quoteId);
    if (!quote) throw new Error(`Quote ${quoteId} not found`);

    const allowed = this.eligibleMerchantIdsForQuote?.(quote);
    const confirmedRequests = this.requests.filter(r=>!allowed || allowed.has(r.merchant_id)).map(r=>({...r,
      reservation:this.reservations.find(res=>res.request_token===r.request_token&&res.status==='ACTIVE'),
      pickup_deadline:this.offers.find(o=>o.request_token===r.request_token)?.pickup_deadline
    }));

    const existingApprovals = this.getApprovalsForQuote(quoteId);

    return evaluateSupplierQuote({
      quote,
      confirmedRequests,
      merchants: this.merchants.filter(m=>!allowed || allowed.has(m.id)),
      existingApprovals,
    });
  }

  // ================= Atomic Supplier Commitment =================
  public async commitSupplierOrder(quoteId: string): Promise<ProcurementOrder> {
    const release = await orderCommitLock.acquire();
    try {
      // 1. Idempotency Check: Return existing committed order immediately
      const existing = this.orders.find(
        o => o.quote_id === quoteId && o.status === 'SIMULATED_COMMITTED'
      );
      if (existing) {
        return existing;
      }


      // 2. Evaluate quote and checks
      const evaluation = this.evaluateQuote(quoteId);
      if (!evaluation.is_eligible) {
        throw new Error(
          `Procurement ineligible: ${evaluation.rejection_reasons.join(', ')}`
        );
      }

      const existingApprovals = this.getApprovalsForQuote(quoteId);
      const validation = canCommitSupplierOrder({
        allocations: evaluation.allocations,
        approvals: existingApprovals,
        quoteId,
        quoteVersion: evaluation.quote_version,
        existingOrders: this.orders,
      });

      if (!validation.allowed) {
        throw new Error(validation.errors.join('; '));
      }

      const orderId = `ord-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const now = new Date().toISOString();

      const order: ProcurementOrder = {
        id: orderId,
        selected_reservation_ids: evaluation.selected_reservation_ids,
        evaluation: structuredClone(evaluation),
        supplier_quote: structuredClone(this.getQuoteById(quoteId)!),
        quote_id: quoteId,
        quote_version: evaluation.quote_version,
        allocation_version: 1,
        total_units: evaluation.total_demand_units,
        total_cost_paise: evaluation.total_procurement_cost_paise,
        status: 'SIMULATED_COMMITTED',
        committed_at: now,
        tracking_reference: `SYNTH-TRK-${Math.floor(100000 + Math.random() * 900000)}`,
        merchant_allocations: evaluation.allocations.map(a => ({
          merchant_id: a.merchant_id,
          units: a.allocated_units,
          exposure_paise: a.total_exposure_paise,
        })),
      };

      this.orders.push(order);

      // Transition affected reservations and requests to SUPPLIER_COMMITTED -> READY_FOR_PICKUP
      for (const req of this.requests) {
        if (this.reservations.some(res=>res.request_id===req.id&&res.status==='ACTIVE'&&!!evaluation.selected_reservation_ids?.includes(res.id))) {
          req.status = 'READY_FOR_PICKUP';
          req.updated_at = now;
        }
      }

      for (const res of this.reservations) {
        if (res.sku === evaluation.sku && res.pack_size === evaluation.pack_size && res.status === 'ACTIVE' && !!evaluation.selected_reservation_ids?.includes(res.id)) {
          res.status = 'COMMITTED';
          res.updated_at = now;
        }
      }

      this.logAudit('ORDER', orderId, 'SUPPLIER_COMMITTED', {
        quoteId,
        quoteVersion: evaluation.quote_version,
        totalUnits: order.total_units,
        totalCostPaise: order.total_cost_paise,
      });

      return order;
    } finally {
      release();
    }
  }

  // ================= Record Pickup / No-Show Outcome =================
  public async recordPickup(params: {
    reservation_id: string;
    outcome: PickupOutcome;
  }): Promise<PickupRecord> {
    const release = await pickupLock.acquire();
    try {
      // 1. Check idempotency / uniqueness: pickup can only be recorded once
      const existing = this.pickups.find(p => p.reservation_id === params.reservation_id);
      if (existing) {
        if(existing.outcome===params.outcome)return existing;
        throw new Error(
          `Pickup already recorded for reservation ${params.reservation_id} on ${new Date(
            existing.recorded_at
          ).toLocaleTimeString()}`
        );
      }

      const reservation = this.reservations.find(r => r.id === params.reservation_id);
      if (!reservation) {
        throw new Error(`Reservation ${params.reservation_id} not found`);
      }

      const request = this.requests.find(r => r.id === reservation.request_id);
      const merchant = this.getMerchantById(reservation.merchant_id);
      if (!request || !merchant) {
        throw new Error('Associated request or merchant record missing');
      }

      if (!['COLLECTED','NO_SHOW'].includes(params.outcome)) throw new Error('Invalid pickup outcome.');
      if (reservation.status !== 'COMMITTED') throw new Error('Simulate supplier commitment before recording pickup.');
      const pickupId = `pick-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const now = new Date().toISOString();
      const unitPricePaise = reservation.confirmed_price_paise;
      const isCollected = params.outcome === 'COLLECTED';
      const collectedUnits = isCollected ? reservation.quantity : 0;
      const totalCollectedPaise = isCollected ? reservation.quantity * unitPricePaise : 0;

      const record: PickupRecord = {
        id: pickupId,
        reservation_id: reservation.id,
        request_id: request.id,
        merchant_id: merchant.id,
        customer_name: request.customer_name || 'Customer',
        quantity: reservation.quantity,
        unit_price_paise: unitPricePaise,
        total_collected_paise: totalCollectedPaise,
        outcome: params.outcome,
        recorded_at: now,
      };

      this.pickups.push(record);

      // Transition state
      if (isCollected) {
        reservation.status = 'FULFILLED';
        request.status = 'PICKED_UP';
      } else {
        reservation.status = 'NO_SHOW';
        request.status = 'NO_SHOW';
      }
      reservation.updated_at = now;
      request.updated_at = now;

      this.logAudit('PICKUP', pickupId, `PICKUP_${params.outcome}`, {
        reservationId: reservation.id,
        collectedUnits,
        totalCollectedPaise,
      });

      return record;
    } finally {
      release();
    }
  }

  // ================= No-Show & Residual Exposure Analysis =================
  public getNoShowAnalysis(merchantId: string = 'm-sharma-001'): NoShowAnalysis {
    const merchant = this.getMerchantById(merchantId);
    if (!merchant) throw new Error('Merchant not found');

    // Find committed order allocations for this merchant
    const activeOrder = this.orders.find(o => o.status === 'SIMULATED_COMMITTED');
    const merchantAlloc = activeOrder?.merchant_allocations.find(a => a.merchant_id === merchantId);

    const allocatedUnits = merchantAlloc?.units || 0;
    const totalProcurementCostPaise = merchantAlloc?.exposure_paise || 0; // ₹344.00

    // Pickups recorded for this merchant
    const pickups = this.pickups.filter(p => p.merchant_id === merchantId);
    const collectedRecords = pickups.filter(p => p.outcome === 'COLLECTED');

    const collectedUnits = collectedRecords.reduce((sum, p) => sum + p.quantity, 0);
    const collectedCashPaise = collectedRecords.reduce((sum, p) => sum + p.total_collected_paise, 0);

    const retailPricePaise = 5000; // ₹50.00
    const uncollectedUnits = Math.max(0, allocatedUnits - collectedUnits);
    const currentCashShortfallPaise = Math.max(0, totalProcurementCostPaise - collectedCashPaise);

    let statusDescription = 'Awaiting customer collections.';
    if (pickups.length > 0) {
      if (uncollectedUnits === 0) {
        statusDescription = 'All units successfully collected. Full retail margin realized.';
      } else {
        statusDescription = `Current cash exposure / shortfall of ₹${(
          currentCashShortfallPaise / 100
        ).toFixed(2)} with ${uncollectedUnits} unsold units remaining in merchant inventory.`;
      }
    }

    return {
      merchant_id: merchantId,
      merchant_name: merchant.name,
      allocated_units: allocatedUnits,
      total_procurement_cost_paise: totalProcurementCostPaise,
      retail_price_paise: retailPricePaise,
      collected_units: collectedUnits,
      collected_cash_paise: collectedCashPaise,
      uncollected_units: uncollectedUnits,
      current_cash_shortfall_paise: currentCashShortfallPaise,
      status_description: statusDescription,
    };
  }

  public invalidateProductApprovals(sku: string, pack: string, reason: string) {
    for (const quote of this.quotes.filter(q => q.sku === sku && q.pack_size === pack)) this.saveApprovalsForQuote(quote.id, invalidateApprovalsForQuote(this.getApprovalsForQuote(quote.id), quote.id, reason));
  }

  public invalidateAllApprovals(reason:string) {
    for(const quote of this.quotes) this.saveApprovalsForQuote(quote.id,invalidateApprovalsForQuote(this.getApprovalsForQuote(quote.id),quote.id,reason));
  }
  public hydrate(state:SeedDataPayload) {
    this.merchants=state.merchants; this.products=state.products; this.suppliers=state.suppliers; this.quotes=state.quotes;
    this.requests=state.requests;this.offers=state.offers;this.reservations=state.reservations;this.orders=state.orders;this.pickups=state.pickups;this.auditEvents=state.auditEvents;
    this.approvalsByQuote=state.approvalsByQuote||{};
  }
  // Helper for automated tests and resetting
  public exportState(): SeedDataPayload {
    return {
      merchants: this.merchants,
      products: this.products,
      suppliers: this.suppliers,
      quotes: this.quotes,
      requests: this.requests,
      offers: this.offers,
      reservations: this.reservations,
      orders: this.orders,
      pickups: this.pickups,
      auditEvents: this.auditEvents,
      approvalsByQuote: this.approvalsByQuote,
    };
  }
}
