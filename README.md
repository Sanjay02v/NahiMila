# NahiMila

A merchant website for HackSprint PS21: remember unmet requests, see anonymous local interest, and buy supplier cases only when exact customer confirmations and every participating shop's approval justify them.

## Run the prototype

Use **Node 22 or newer** (Node 24 recommended).

```sh
npm install
npm run dev -- --port 3001
```

Open http://localhost:3001. Typed capture, account access, customer offers and procurement work without external keys. Local data persists in `.data/product-network.json`; account passwords are scrypt hashes and sessions are opaque, hashed server-side tokens in `.data/product-auth.json`. One local Node process only. File storage is deliberately disabled on Vercel.

Separate fictional accounts use `sharma`, `gupta`, `lakshmi`, `corner`, `daily` and `annapurna` at `@demo.nahimila.local`. Their initial demo password is `NahiMila-demo-2026`. Use separate browser profiles/devices for simultaneous merchant accounts. Signing in identifies one shop; there is no merchant selector. A newly registered account completes shop/location onboarding.

To restore the fictional local seed (with a backup in `.data/backups`):

```sh
npm run demo:reset -- --confirm
```

This is a development command, not a merchant action. It refuses hosted storage. Reload after running it. Use synthetic test data only.

## Product behavior

- **Any product:** type free-form text or speak with Sarvam when configured. Home Speak opens voice mode and requests microphone access; Type/New request opens a focused text field without recording. Review product, brand, variant, pack, quantity, budget, deadline and explicit constraints before saving. No catalog restriction on capture.
- **Demand Book:** one expandable group per exact product/variant/pack, product search and status filters, with requested, demand-only, pending and active confirmed units kept separate. Products and entries render in batches of 20. This reduces repeated UI; the prototype still loads the shop snapshot rather than providing database pagination.
- **Contact and confirmation:** willing-to-wait requests without a phone remain demand signals and never create offers. Waiting with a phone but incomplete terms remains pending interest. Contact use is stated inline for reservation and pickup updates. A phone does not confirm anything. Customer links confirm exact quantity, offered price and pickup date; merchants may instead explicitly record the same acceptance in-store. That method/time is recorded and the customer page does not ask for a duplicate confirmation. Existing fictional reservations remain preserved; they predate contact capture.
- **Changed terms:** before procurement, Change reservation terms revokes the old capability link, cancels the old active reservation, clears approvals and creates a fresh pending offer. Changed quantity, price or deadline must be accepted again. Committed reservations cannot be revised to erase procurement costs. Withdrawn links cannot re-confirm.
- **Missing contact:** Add customer number collects a validated number with a scoped contact-use note for an existing pending/confirmed reservation. It preserves the offer token, accepted terms, confirmation evidence and procurement approvals; it cannot silently replace a saved recipient. Demand-only entries cannot become confirmed by adding contact.
- **WhatsApp:** Send on WhatsApp opens a prepared message in WhatsApp for the merchant to send; it does not send automatically, track delivery or claim a sent status. Pending entries share confirmation links; confirmed entries share details without another confirmation request. After the merchant records receipt, outstanding pickups with a saved number can open an arrival message. Links need a reachable deployment origin to work on customers’ devices; localhost is for local demonstration only.

- **Shared product identity:** registered brand/variant/packaging aliases are normalized consistently, including English/Hindi spellings. Gemini can resolve other product-family synonyms against up to 60 existing compatible reviewed product identities. Exact brand, variant, size, unit, packaging and meaningful requirements must match first; only the family label can change. The merchant reviews it before saving. Missing packs, ambiguous decisions, service failures and incompatible specifications never produce a semantic merge. Product-label/specification metadata form a shared catalog; customer records, original peer wording, shop identities, counts, budgets and deadlines are never sent to the matcher. New products remain unrestricted. Older equivalent records can share a Nearby interest bucket without rewriting issued offers, reservations or historical orders; historical commercial records are not automatically migrated between SKUs.
- **Private book:** only the signed-in shop's individual requests, customer nicknames, spending allowance, approvals, orders and pickups are returned. The retired anonymous workspace API returns 410.
- **Missed demand:** customers who won't wait are recorded even without a name, budget or date. These records never create reservations or fund orders.
- **Nearby intelligence:** confirmed shop coordinates, a 1.5 km radius, seven-day window, opt-in contributors, at least three other shops, and five-request count bands. No peer customer records, shop-by-shop demand or cash limits are returned. Products without your own requests stay hidden below the threshold. This suppression reduces leakage; it is not a formal differential privacy guarantee.
- **Exact customer offers:** independent `/confirm/<opaque-token>` pages show only that offer's product, pack, quantity, price, shop and deadline. Copy, preview and QR actions are compact merchant controls. Repeated confirmation counts once.
- **Deterministic purchasing:** exact reviewed identity/pack, whole supplier cases, live confirmations, supplier permission, landed cost, customer budgets, delivery, quote expiry and each shop's remaining cash allowance are checked on the server. Group membership is restricted to the quote origin's consenting local cohort. Gemini cannot approve or commit.
- **Approvals:** each participant approves their own computed exposure. Changing confirmations, terms, permissions or caps clears stale approvals. A fingerprint also checks selected reservations, deadlines, caps and permissions. The final commit rechecks all rules inside the persistence transaction/revision retry. A repeated commit creates no new order and debits no second budget.
- **Visible order blockers:** cost previews remain accessible while a case is incomplete. The preview is explicitly provisional; actual approval stays disabled until eligibility checks pass. The quote shows missing confirmed units, late delivery, expiry, price/budget or group-permission failures and outstanding shop approvals beside the order action. A waiting-offers shortcut opens the merchant's own request book.
- **Whole cases:** if excess demand exists, a deterministic deadline/confirmation priority attempts a complete case using whole customer reservations. Unselected requests remain active. It is a conservative heuristic, not an optimal purchase solver.
- **Supplier terms:** manually enter or edit quotes obtained outside the app; there is no invented supplier integration. Quote origin can edit terms; other shops approve their own supplier permission and share.
- **Orders and conversion:** receive the simulated delivery, record your customers' pickups, and see supplier exposure, collected cash, uncollected units and cash shortfall. No-shows cannot be recorded before the exact pickup deadline. Recorded outcomes are idempotent and conflicting outcomes are rejected. Supplier cost snapshots remain immutable.
- **English, Hindi and Kannada:** navigation, onboarding, review, statuses, errors, approvals, offers and orders use Next Intl dictionaries. Preferences persist per shop. More languages can be added to the same structure.
- **Ask NahiMila:** a conversational merchant assistant for demand, stocking considerations, supplier-case blockers, orders, pickups, app guidance and general practical shop questions. Gemini receives an owner-scoped product/outcome summary, without customer names, contact details, offer tokens, coordinates or peer rows. Responses show original record cards and navigation actions. Up to eight recent messages provide conversation context; conversation text is not stored on the server. A request command prepares a draft, then opens the existing exact-product review form. It creates no demand, reservation, approval or order until the merchant explicitly saves through that form. The assistant opens from a single floating button in a non-blocking desktop panel and a mobile sheet. Minimize preserves its conversation and unfinished message in page memory; reload/sign-out clears them. Starter prompts fill the composer and require Send; the microphone sits beside Send and stops when the panel is hidden. Requests/order starter prompts can read records without Gemini. All spending and order approvals stay in the normal guarded workflow. Suggestions are not verified forecasts or current external research.

## Configure real language services

Copy `.env.example` to `.env.local` without overwriting existing secrets, then restart the server.

- `SARVAM_API_KEY`: live microphone audio streams to Sarvam’s realtime WebSocket endpoint (`saaras:v4`, automatic language detection). The browser uses an AudioWorklet to produce mono 16kHz PCM in 200ms chunks; genuine provider partials appear while speaking, then Stop finalizes the transcript. There is no audio-upload control. Recordings stop automatically at 20 seconds. Mic permission and HTTPS/localhost are required. Closing the form stops the microphone and aborts the stream. The server holds the provider key, authenticates both stream creation and audio submission, binds each session to its shop, limits one active session per shop, checks sequence numbers and bounds audio/session lifetime. The existing REST transcription endpoint is retained for compatibility tests, but the website uses `/api/voice/live`.

**Live voice hosting:** the current bridge keeps short-lived WebSocket sessions in one Node process. Use one persistent Node server with concurrent requests and unbuffered streaming for this prototype; an ordinary stateless, multi-instance serverless deployment is not compatible with this bridge. A separate persistent streaming service would be needed for that hosting model. No API key is ever sent to the browser.
- `GEMINI_API_KEY` and optional `GEMINI_MODEL`: server-side structured intent normalization and conversational assistant replies with allowlisted read tools and review-only drafts. The default and current local setting are `gemini-3.5-flash`, selected by the user and listed by the key’s Models API. Model availability does not guarantee every request succeeds; a capacity error is retried once with the same model and overall timeout. Persistent failures retain manual request review and direct record actions. Model output passes a Zod schema. Canonical labels assist differently worded requests; exact brand, pack, packaging and hard constraints determine the stored identity. Unknown fields stay unknown; ambiguity needs review. There is no embedding or fuzzy procurement substitution.

Without keys, manual suggestions are clearly labeled, typing remains available, and no fabricated transcript/AI response is returned. Instance-local rate limits are best-effort controls; they are not distributed quotas. Normalization review, product-match review, agent reads and draft-review events are audited. Provider keys never reach the browser. Live verification on October 2 used fictional English, Hindi and Kannada Coke Zero requests: all four resolved to one 500ml bottle identity across four isolated test shops, yielding one anonymous Nearby bucket. A separate live test resolved wireless-earphones/true-wireless-earbuds family synonyms with identical specifications. Sarvam transcribed a generated English sample through the authenticated website; the realtime endpoint also returned genuine partial transcripts and a final result through the authenticated streaming bridge. Microphone recordings still require device testing. These are prototype integration checks, not evidence of field impact or universal SKU-matching accuracy.

## Supabase and hosted deployment

Local mode is sufficient to review the prototype. Hosted mode requires all three Supabase values in `.env.example` and the **new** `supabase/migrations/20261002010000_merchant_product.sql` migration. Apply it in your Supabase SQL editor. The earlier `demo_workspaces` migration is historical and is not the active product database.

The new migration stores shops, products, requests, offers, reservations, quotes, approvals, orders, shares, pickups and audits as separate relational records, with owner foreign keys, uniqueness, amount checks and RLS. Shop locations have a PostGIS index. The backend currently performs distance filtering with the same stored coordinates rather than a database spatial query.

Ordinary authenticated database clients can read only owner-scoped private tables; they have no direct writes. Server endpoints verify Supabase users and resolve their shop. A service-only coordinator reads the network, rechecks deterministic rules and commits normalized records atomically through revision compare-and-swap RPCs. On a conflict, it reloads and recomputes. No whole-workspace JSONB row is used by the new product, although individual records retain typed JSON payloads. The coordinator still loads the network as one document: appropriate for this demonstration, not a high-volume query architecture.

For a brand-new EMPTY Supabase product database, create the fictional demonstration with:

```sh
npm run seed:supabase -- --confirm
```

The script creates six fictional Auth accounts and the 23-confirmation seed. It refuses an existing product database and preserves existing account passwords. Set `NML_DEMO_PASSWORD` before initial account creation if desired. The script is supplied but has not been run against a live Supabase account. The migration/RLS/RPC path requires live account verification; unit tests do not prove PostgreSQL execution.

Deploy `Solution` as the Next.js project root on a suitable Node/Next.js host (the prepared demo path is Vercel with Supabase). Set the same server credentials and public Supabase URL/publishable key on the host. Check current plan quotas and AI credits before deployment; no paid service is required for local typed review. Do not put service-role or AI keys in `NEXT_PUBLIC` variables.

## Judge walkthrough

1. Sign in as Sharma. Record a customer who won't wait for an arbitrary product. It appears privately and creates no customer offer.
2. Open Nearby: your exact count is separate from anonymous peer interest. Interest alone does not make a case orderable.
3. Open Orders. The seed has 23 active reservations. Supplier A has a 48-unit case; C arrives late; B requires 24 units.
4. In Requests, preview Customer 08's pending offer on another device/tab and confirm. B now has 24 exact confirmed units: eight per shop, ₹344 landed exposure each, inside ₹350 allowances. Duplicate confirmation changes nothing.
5. Each of Sharma, Gupta and Lakshmi must independently approve. Cancel a customer before committing to show demand dropping and approvals clearing; re-confirm and reapprove to proceed. Editing terms/caps also requires review again.
6. Simulate commitment. Only one order is created; each shop's remaining allowance drops to ₹6. Mark that shop's delivery received, then record collections under Orders. Six ₹50 collections retain ₹344 supplier cost, show ₹300 collected cash, two uncollected units and ₹44 cash shortfall. Until the pickup deadline, those two customers are waiting rather than no-shows.
7. Switch the interface to Hindi or Kannada; show the same private workflow. Show words appearing while speaking, then review the final transcript. In Ask NahiMila, ask why a shared order is blocked and show its source figures. Ask it to prepare a no-wait product request, then open the draft in the review form without saving during a read-only demonstration.

All seeded people, products, suppliers and quotes are fictional. Customer reservations are conditional, nonbinding and unpaid. Supplier commitment, delivery and pickups are simulated. No deposit, refund, auction, actual payment or supplier acceptance is claimed. Real merchant impact needs a pilot; demo arithmetic is not measured field impact.

## Verification

```sh
npm test
npm run lint
npm run build
```

Tests cover the pooling/approval/commitment lifecycle, private DTOs, authentication boundaries, spoofed shop IDs, arbitrary missed demand, exact offer constraints, local privacy suppression, geography, fingerprints, repeat clicks, cash debits and pickup ownership. Build/dev use supported webpack compilation because local Turbopack worker port binding was restricted. The existing domain store, arithmetic and approval helpers were retained; the obsolete dashboard was replaced.

### Simple request review

Capture uses one optional Variant / details field (for example `Masala, 100g pouch`), retaining exact pack and packaging internally. Product and quantity remain essential; brand, details, preferred budget, actual offered price, preferred date, customer name and phone can be left blank. A phone suggestion is extracted only from a plausible number, never from ordinary quantity/pack/price values. Willingness, flexible price and no rush are separate reviewed preferences; a phone alone does not imply willingness. Contact use is stated inline and limited to this reservation and pickup updates, without a mandatory consent checkbox.

Waiting with contact but incomplete terms saves as `WAITING_INTEREST`, without an offer or reservation and without increasing confirmed procurement units. Demand Book provides Prepare customer offer to set the exact item, actual price and pickup date later on the same entry. Budget stays optional at that stage; an actual offered price, exact item and pickup arrangement are required before confirmation. Flexible price never accepts an unknown price, and no rush never fabricates an infinite deadline. Date inputs have no time selector; a selected date maps to the end of that calendar day in India. In-store acceptance is recorded by an intentional Confirm action, not a long acceptance checkbox. Invalid/blank AI product output falls back to clearly labelled manual review. Customer WhatsApp messages are short, use calendar dates and distinguish confirmation, reservation and arrival.
