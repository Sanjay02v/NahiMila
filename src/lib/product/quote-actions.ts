import type { QuoteView } from "./types";
export function quoteActions(q: QuoteView, busy = false) {
  return {
    canReview: !busy && !!q.own,
    canApprove:
      !busy && q.eligible && !!q.own && q.own.approval_status !== "APPROVED",
    canCommit:
      !busy &&
      q.eligible &&
      !!q.own &&
      q.participant_count > 0 &&
      q.approval_count === q.participant_count,
  };
}
export function quoteBlockers(q: QuoteView): { key: string; count?: number }[] {
  const result = q.checks
    .filter((c) => !c.passed)
    .map((c) => ({
      key:
        (
          {
            cases: "blockedCases",
            deadline: "blockedDelivery",
            expiry: "blockedExpiry",
            price: "blockedPrice",
            group: "blockedGroup",
          } as Record<string, string>
        )[c.code] || "blockedGeneral",
      ...(c.code === "cases" && q.total_units < q.quote.moq
        ? { key: "blockedUnits", count: q.quote.moq - q.total_units }
        : {}),
    }));
  if (!q.own) result.push({ key: "blockedShare" });
  if (q.eligible && q.approval_count < q.participant_count)
    result.push({
      key: "blockedApprovals",
      count: q.participant_count - q.approval_count,
    });
  return result;
}
