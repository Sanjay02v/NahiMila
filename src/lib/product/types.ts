import type {
  DemandRequest,
  Merchant,
  MerchantAllocation,
  PickupRecord,
  Product,
  QuoteEvaluation,
  SupplierQuote,
} from "@/types";
export const locales = ["en", "kn", "hi"] as const;
export type Locale = (typeof locales)[number];
export interface Intent {
  product: string;
  category: string;
  brand: string | null;
  variant: string | null;
  size: number | null;
  unit: "g" | "ml" | "piece" | null;
  packaging: string | null;
  quantity: number | null;
  budget_paise: number | null;
  deadline: string | null;
  substitutions: boolean;
  hard_constraints: string[];
  preferences: string[];
  missing: string[];
  evidence: Record<string, string>;
  source: "gemini" | "manual";
}
export interface Shop extends Merchant {
  user_id: string;
  locale: Locale;
  latitude: number | null;
  longitude: number | null;
  location_accuracy: "confirmed" | "approximate";
  sharing: boolean;
}
export interface RequestDetail {
  raw_text: string;
  intent: Intent;
  revision: number;
  submission_key: string;
  willing_to_wait?: boolean;
  contact_consent?: boolean;
  confirmation?: { method: "link" | "in_store"; at: string } | null;
}
export type PrivateRequest = DemandRequest & {
  product: Product;
  detail: RequestDetail | null;
  offer: { token: string; price: number; deadline: string } | null;
};
export interface NearbySignal {
  key: string;
  name: string;
  pack: string;
  own_requests: number;
  own_units: number;
  peer_band: string | null;
  shops: number;
  radius: number;
  window_days: number;
  suppressed: boolean;
}
export interface QuoteView {
  can_edit: boolean;
  quote: SupplierQuote;
  product: Product;
  own: MerchantAllocation | null;
  total_units: number;
  eligible: boolean;
  checks: { code: string; passed: boolean }[];
  fingerprint: string;
  approval_count: number;
  participant_count: number;
  committed: boolean;
}
export interface OrderView {
  id: string;
  reference: string;
  product: Product;
  quantity: number;
  exposure: number;
  collected_units: number;
  collected_cash: number;
  remaining: number;
  received: boolean;
  pickups: {
    id: string;
    name: string;
    phone: string | null;
    token: string;
    deadline: string;
    quantity: number;
    price: number;
    can_no_show: boolean;
    outcome: PickupRecord["outcome"] | null;
  }[];
}
export interface MerchantView {
  shop: Shop;
  requests: PrivateRequest[];
  nearby: NearbySignal[];
  quotes: QuoteView[];
  orders: OrderView[];
  voice: boolean;
  gemini: boolean;
  storage: "local" | "supabase";
}
export interface CustomerView {
  product: string;
  pack: string;
  quantity: number;
  price: number;
  shop: string;
  area: string;
  deadline: string;
  status: string;
  can_confirm: boolean;
  can_cancel: boolean;
}
export type Evaluation = QuoteEvaluation;
