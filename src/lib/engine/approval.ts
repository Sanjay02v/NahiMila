import { MerchantAllocation, MerchantApproval, ProcurementOrder } from '@/types';

export interface InvalidationTrigger {
  reason: string;
  affectedQuoteId?: string;
  affectedMerchantId?: string;
}

export function invalidateApprovalsForQuote(
  approvals: MerchantApproval[],
  quoteId: string,
  reason: string
): MerchantApproval[] {
  const now = new Date().toISOString();
  return approvals.map(approval => {
    if (approval.quote_id === quoteId && approval.status === 'APPROVED') {
      return {
        ...approval,
        status: 'INVALIDATED',
        invalidated_at: now,
        invalidation_reason: reason,
      };
    }
    return approval;
  });
}

export function invalidateApprovalsForMerchant(
  approvals: MerchantApproval[],
  merchantId: string,
  reason: string
): MerchantApproval[] {
  const now = new Date().toISOString();
  return approvals.map(approval => {
    if (approval.merchant_id === merchantId && approval.status === 'APPROVED') {
      return {
        ...approval,
        status: 'INVALIDATED',
        invalidated_at: now,
        invalidation_reason: reason,
      };
    }
    return approval;
  });
}

export function canCommitSupplierOrder({
  allocations,
  approvals,
  quoteId,
  quoteVersion,
  existingOrders = [],
}: {
  allocations: MerchantAllocation[];
  approvals: MerchantApproval[];
  quoteId: string;
  quoteVersion: number;
  existingOrders?: ProcurementOrder[];
}): {
  allowed: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // 1. Idempotency: Check if order already committed for this quote / demand
  const activeOrder = existingOrders.find(
    o => o.quote_id === quoteId && (o.status === 'SIMULATED_COMMITTED' || o.status === 'IN_TRANSIT')
  );
  if (activeOrder) {
    errors.push(`Duplicate commitment blocked: Order already committed (${activeOrder.id})`);
    return { allowed: false, errors };
  }

  // 2. Check each participating merchant with allocated units > 0
  const participatingMerchants = allocations.filter(a => a.allocated_units > 0);
  if (participatingMerchants.length === 0) {
    errors.push('No participating merchants with allocated units.');
    return { allowed: false, errors };
  }

  for (const merchantAlloc of participatingMerchants) {
    // Must be within cash cap
    if (!merchantAlloc.within_cap) {
      errors.push(
        `Merchant ${merchantAlloc.merchant_name} exceeds cash cap. Cannot commit order.`
      );
      continue;
    }

    // Must have an APPROVED record matching CURRENT quote version
    const approval = approvals.find(
      a =>
        a.merchant_id === merchantAlloc.merchant_id &&
        a.quote_id === quoteId &&
        a.quote_version === quoteVersion
    );

    if (!approval) {
      errors.push(
        `Pending approval: ${merchantAlloc.merchant_name} has not approved quote v${quoteVersion}.`
      );
    } else if (approval.status === 'INVALIDATED') {
      errors.push(
        `Stale approval: Approval for ${merchantAlloc.merchant_name} was invalidated (${approval.invalidation_reason || 'material change'}). Re-approval required.`
      );
    } else if (approval.exposure_paise !== merchantAlloc.total_exposure_paise || merchantAlloc.approval_status !== 'APPROVED') {
      errors.push(`Allocation changed for ${merchantAlloc.merchant_name}. Fresh approval required.`);
    } else if (approval.status !== 'APPROVED') {
      errors.push(
        `Invalid approval state: ${merchantAlloc.merchant_name} approval status is ${approval.status}.`
      );
    }
  }

  return {
    allowed: errors.length === 0,
    errors,
  };
}
