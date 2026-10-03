// Fixed fictional identities created by the seed script. Onboarding cannot set IDs.
export const DEMO_ACCOUNTS = [
  ["m-sharma-001", "sharma"],
  ["m-gupta-002", "gupta"],
  ["m-lakshmi-003", "lakshmi"],
  ["m-neighbor-3", "corner"],
  ["m-neighbor-4", "daily"],
  ["m-neighbor-5", "annapurna"],
] as const;
export const isDemoShop = (id: string) =>
  DEMO_ACCOUNTS.some(([shop]) => shop === id);
