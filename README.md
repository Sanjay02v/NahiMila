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

- **Any product:** type free-form text or speak with Sarvam when configured. Review product, brand, variant, pack, quantity, budget, deadline and explicit constraints before saving. No catalog restriction on capture.
- **Private book:** only the signed-in shop's individual requests, customer nicknames, spending allowance, approvals, orders and pickups are returned. The retired anonymous workspace API returns 410.
- **Missed demand:** customers who won't wait are recorded even without a name, budget or date. These records never create reservations or fund orders.
- **Nearby intelligence:** confirmed shop coordinates, a 1.5 km radius, seven-day window, opt-in contributors, at least three other shops, and five-request count bands. No peer customer records, shop-by-shop demand or cash limits are returned. Products without your own requests stay hidden below the threshold. This suppression reduces leakage; it is not a formal differential privacy guarantee.
- **Exact customer offers:** independent `/confirm/<opaque-token>` pages show only that offer's product, pack, quantity, price, shop and deadline. Copy, preview and QR actions are compact merchant controls. Repeated confirmation counts once.
- **Deterministic purchasing:** exact reviewed identity/pack, whole supplier cases, live confirmations, supplier permission, landed cost, customer budgets, delivery, quote expiry and each shop's remaining cash allowance are checked on the server. Group membership is restricted to the quote origin's consenting local cohort. Gemini cannot approve or commit.
- **Approvals:** each participant approves their own computed exposure. Changing confirmations, terms, permissions or caps clears stale approvals. A fingerprint also checks selected reservations, deadlines, caps and permissions. The final commit rechecks all rules inside the persistence transaction/revision retry. A repeated commit creates no new order and debits no second budget.
- **Whole cases:** if excess demand exists, a deterministic deadline/confirmation priority attempts a complete case using whole customer reservations. Unselected requests remain active. It is a conservative heuristic, not an optimal purchase solver.
- **Supplier terms:** manually enter or edit quotes obtained outside the app; there is no invented supplier integration. Quote origin can edit terms; other shops approve their own supplier permission and share.
- **Orders and conversion:** receive the simulated delivery, record your customers' pickups, and see supplier exposure, collected cash, uncollected units and cash shortfall. No-shows cannot be recorded before the exact pickup deadline. Recorded outcomes are idempotent and conflicting outcomes are rejected. Supplier cost snapshots remain immutable.
- **English, Hindi and Kannada:** navigation, onboarding, review, statuses, errors, approvals, offers and orders use Next Intl dictionaries. Preferences persist per shop. More languages can be added to the same structure.
- **Ask NahiMila:** a small read-only accessibility layer for your requests, anonymous nearby demand, orders and pickups. Gemini routes text/code-mixed questions to an allowlisted tool; results come from server data. Direct read buttons remain usable without Gemini. It never spends or changes records.

## Configure real language services

Copy `.env.example` to `.env.local` without overwriting existing secrets, then restart the server.

- `SARVAM_API_KEY`: actual audio is sent server-side to Sarvam speech-to-text (`saaras:v4`, automatic language detection). Recording is at most 20 seconds; upload cap is 3 MB; upstream timeout is 25 seconds. Review the transcript before interpreting it. Microphone access needs HTTPS or localhost.
- `GEMINI_API_KEY` and optional `GEMINI_MODEL`: server-side structured intent normalization and controlled read-tool selection. The default is `gemini-2.5-flash`, verified with live Hindi extraction and assistant requests; `gemini-3.8-flash` returned intermittent high-demand errors during setup. Model output passes a Zod schema. Canonical labels assist differently worded requests; exact brand, pack, packaging and hard constraints determine the stored identity. Unknown fields stay unknown; ambiguity needs review. There is no embedding or fuzzy procurement substitution.

Without keys, manual suggestions are clearly labeled, typing remains available, and no fabricated transcript/AI response is returned. Instance-local rate limits are best-effort controls; they are not distributed quotas. Normalization review and agent read-tool events are audited. Provider keys never reach the browser. No successful live provider call was available during development verification.

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
7. Switch the interface to Hindi or Kannada; show the same private workflow. Demonstrate voice/Gemini only after real keys and successful live calls are available.

All seeded people, products, suppliers and quotes are fictional. Customer reservations are conditional, nonbinding and unpaid. Supplier commitment, delivery and pickups are simulated. No deposit, refund, auction, actual payment or supplier acceptance is claimed. Real merchant impact needs a pilot; demo arithmetic is not measured field impact.

## Verification

```sh
npm test
npm run lint
npm run build
```

Tests cover the pooling/approval/commitment lifecycle, private DTOs, authentication boundaries, spoofed shop IDs, arbitrary missed demand, exact offer constraints, local privacy suppression, geography, fingerprints, repeat clicks, cash debits and pickup ownership. Build/dev use supported webpack compilation because local Turbopack worker port binding was restricted. The existing domain store, arithmetic and approval helpers were retained; the obsolete dashboard was replaced.
