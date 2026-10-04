# Technical implementation notes

For the project overview, architecture diagram and current demo walkthrough, see [README](../README.md). These notes explain the implementation for reviewers.

## Product identity and demand

Capture accepts arbitrary typed or recorded requests. Gemini extracts product details and assists compatible synonym matching against reviewed product identities. Brands, variants, sizes, units, packaging and meaningful requirements must remain aligned. Ambiguous or incompatible matches stay separate; uncertain fields remain unknown for merchant review.

Product-family grouping simplifies the demand book display. It does not merge different packs or flavours into one procurement quantity. Exact commercial identity determines shared-order eligibility. Saved customer offers and historical orders are not silently rewritten by language matching.

The demand book distinguishes requested, demand-only, pending and active customer-confirmed units. A customer who cannot wait can still contribute a demand signal; that request never supports an order. A phone number or customer name alone is not acceptance. Exact item, quantity, price and pickup date must be offered and explicitly accepted.

## Nearby interest and privacy

Nearby demand uses confirmed shop locations, a 1.5 km radius, a seven-day window and opt-in contributors. Anonymous interest requires at least three other contributing shops and uses five-request count bands. Peer customer records, shop-by-shop quantities and cash limits are not returned. This suppression reduces leakage; it is not a formal differential privacy guarantee.

Private views contain only the signed-in shop’s individual requests, customer details, spending allowance, approvals, orders and pickups. Fictional demo shops remain a separate cohort from real accounts.

## Order decisions

Server rules check exact identity, whole-case quantities, active confirmations, supplier permission, landed cost, customer budgets, delivery deadlines, quote expiry and each shop’s remaining cash allowance. Supplier quotes are entered by merchants; there is no automated supplier marketplace.

Each participating shop approves its own computed exposure. Relevant changes to confirmations, terms, permissions or cash limits invalidate approvals. A fingerprint identifies the reviewed allocation. The final order action rechecks current rules during a persistence transaction or revision retry.

Withdrawals before ordering recalculate eligibility and clear stale approvals. Changing accepted offer terms requires fresh customer acceptance. Committed costs cannot be erased by revising a reservation. Repeated confirmation, commitment or pickup counts once; conflicting outcomes are rejected.

When demand exceeds a case, a deterministic deadline/confirmation priority attempts a complete case using whole reservations. This is a conservative heuristic, not an optimal purchasing solver.

## Storage and authorization

Supabase provides hosted authentication and PostgreSQL persistence. Database clients have owner-scoped read access and no direct product writes. Server endpoints verify users and resolve their shops; the service-only coordinator rechecks rules and commits through revision compare-and-swap operations. Conflicts reload state and recompute decisions.

The prototype coordinator loads the network as a document. This is suitable for the demonstration, not a high-volume query architecture. Local development uses file persistence for a single process; hosted storage never falls back to temporary files.

Provider credentials and the Supabase service-role key stay server-side. Retired anonymous workspace access is denied. Short recorded audio is authenticated and owner-bound, with duration, size and request-rate limits.

## Language services and assistant

Sarvam transcribes a recording after the merchant stops it. The editable transcript is then reviewed; the current website does not stream words while recording. English, Hindi and Kannada are supported. Review labels follow the input language, and explicitly stated customer names retain their original wording.

Gemini handles structured extraction, compatible product-family matching, display translation and assistant replies. Outputs are validated. Missing services or failed requests retain manual review; no fabricated transcript or AI result is returned.

Ask NahiMila receives an owner-scoped operational summary without saved customer names, contact numbers, offer tokens, coordinates or peer rows. It explains blockers, shows relevant records and prepares drafts. The merchant must save through the ordinary review form. It cannot approve spending or place orders. Its suggestions are stocking considerations, not verified sales forecasts.

Hindi and Kannada labels can be cached with product records while canonical identity remains stable. Unchanged display labels map back to the original fields; edits require review.

## AI usage controls

Extraction, matching, label translation and assistant calls share a persisted project/model budget. Every provider attempt reserves usage, including failures and a bounded retry. Rate-limit responses trigger a cooldown; a reported daily quota failure pauses calls until the next provider day. Manual actions remain available.

Counters contain scope/model hashes, usage counts and timestamps rather than customer requests. They survive restarts and demo resets. These counters measure this deployment’s usage and do not guarantee that other applications on the same provider project cannot exhaust its allowance.

Identical extraction drafts may be reused briefly within the authenticated shop and language. Concurrent identical calls are deduplicated. Assistant responses are not reused across turns.

## Demo state and outcomes

The public **Explore the demo** action signs into only the fixed fictional Sharma shop. All six demo shops share a resettable scenario. Reset requires confirmation, checks fixed demo identities, restores requests and approvals, and replaces old customer links. It preserves real-account records and AI usage counters; simultaneous demo visitors can affect each other’s progress.

The Masala 100g scenario starts at 23 confirmed units against a 24-unit case. Asha’s pending acceptance adds the final unit. The separate Lime 100g scenario has 12 confirmed units and two peer approvals preloaded; the current merchant reviews a four-unit ₹148 share. A cheaper ₹136 option arrives too late and is blocked. These values are calculated from fictional records.

Simulated receipt and pickup tracking retains immutable supplier-cost snapshots. Outstanding units and collected cash remain visible. No-shows cannot be recorded before the pickup deadline. WhatsApp controls prepare a message for the merchant to send; they do not send automatically or claim delivery.

## Verification and limitations

The recorded checks include 235 passing automated tests, lint and a production build. Tests cover access boundaries, exact product constraints, geography/privacy suppression, cash checks, approval fingerprints, duplicate protection and pickup ownership. Live integration checks verified multilingual extraction and Hindi assistant drafts.

Supplier orders, delivery and pickups are simulated; payments, deposits, refunds and supplier bidding are not implemented. Customer confirmation does not guarantee collection. Merchant adoption, distribution effort and actual pickup rates require the proposed pilot. Device microphone behavior still needs rehearsal on the final judging device.
