export type LedgerPosting = {
  direction: "debit" | "credit";
  amount: number;
};

export function createBalancedPostings(
  amount: number,
  fee: number,
): LedgerPosting[] {
  const total = Math.round((amount + fee) * 100) / 100;
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error("Ledger total must be positive.");
  }
  return [
    { direction: "debit", amount: total },
    { direction: "credit", amount: total },
  ];
}
