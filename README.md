# NahiMila

A responsive merchant website that turns unavailable-product requests into exact customer reservations and shared supplier cases. The prototype implements the locked PS21 mechanism: customer-backed demand, deterministic cash and delivery checks, individual shop approvals, and an honest pickup ledger.

## Run locally

```sh
npm install
npm run dev -- --port 3001
```

Open http://localhost:3001. Node 20.9+ is required by this Next.js version; Node 24 is recommended. The existing development server may already occupy 3001.

No credentials are needed for the typed demonstration. Data persists in `.data/<workspace-id>.json`, survives reload/restart, and is shared by tabs/devices using the same workspace URL on one Node server. Do not run several Node processes against local file storage. For a phone on the same Wi-Fi, replace `localhost` with the laptop's LAN address and retain `?workspace=...`. Microphone recording requires HTTPS or localhost.

## What actually works

- Merchant capture of exact SKU/pack, integer quantity, retail budget, wait eligibility and 8pm IST pickup deadline.
- Independent customer `/confirm/<token>?workspace=<id>` links. Confirmation is idempotent for the token; a saved request alone contributes zero demand.
- A 23-unit seed across three shops, plus Customer 08's pending offer. Confirmation reaches a complete 24-unit case.
- Editable supplier quotes, integer-paise cost allocation including logistics, per-shop cash limits and supplier permissions.
- Whole supplier cases only, without speculative excess stock. Exact pack, quote validity, confirmed retail price, actual offer pickup deadline and each shop's cash cap are server checks.
- Approvals tied to current quote terms and exposure. Confirmation/cancellation, quote edits, cash-cap edits and permission changes invalidate affected approvals.
- A final server recheck before simulated commitment. Repeated commitment/pickup cannot multiply orders or cash. Conflicting pickup outcomes cannot overwrite a record.
- A saved commitment snapshot, then collected/no-show outcomes. Six ₹50 pickups at an eight-unit shop retain ₹344 supplier cost and show ₹300 cash, ₹44 shortfall and two unsold units.
- Overview, demand book, shared orders, customer offer and pickup ledger adapt to mobile, tablet and desktop. Keyboard focus states and dialog focus trapping are included.

Supplier quotes and all product/customer/shop data are fictional. Supplier acceptance, delivery, pickups and cash collection are simulated. Reservations are conditional and nonbinding; no payments, deposit, auction, real supplier API or identity verification is claimed. A workspace demonstrates one procurement cycle; reset for another.

## Live Sarvam voice

Copy `.env.example` to `.env.local` without overwriting existing values. Set `SARVAM_API_KEY` locally, then restart Next.js. Never paste the secret into chat or a client-side variable.

The browser records at most 20 seconds using MediaRecorder. `/api/voice/transcribe` sends the actual audio to [Sarvam's speech-to-text API](https://docs.sarvam.ai/api-reference/speech-to-text/transcribe), with `saaras:v4` and automatic language detection. The merchant reviews the editable transcript and explicit field suggestions; ambiguous fields stay blank. Failure or missing configuration produces an honest error and typed entry remains usable. No canned transcript substitutes for an API call.

Server limits: 3 MB audio, 25-second upstream timeout, six requests per IP per minute per running instance. This rate limiter is best-effort, not a distributed quota/security boundary. Before making voice public, restrict account/API spending and use provider/platform abuse controls. No Sarvam account or successful live transcription was available during local verification.

## Shared database and free demo deployment

The selected demo deployment is Vercel Hobby plus Supabase Free, within their limits. Sarvam may consume account credits; it is not unlimited free usage. Review the accounts' actual quotas before publishing.

1. Create/open a Supabase project. Apply **only** `supabase/migrations/20261002000000_demo_workspaces.sql` in the SQL editor. The old Antigravity normalized schema was unused and has been removed from active migrations.
2. Set server-only `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` and later Vercel. Add `SARVAM_API_KEY` if voice is enabled. Restart the server.
3. The footer must say **Supabase shared database**. Open one copied customer link in another browser/device and verify its confirmation updates the merchant view.
4. Import the `Solution` directory as the Vercel project root; normal Next.js build/start settings apply. Add the same server environment variables.
5. Test the complete deployed flow before submission. Vercel deliberately refuses the file-storage fallback, so a missing database fails clearly rather than losing serverless state.

`demo_workspaces` stores the full synthetic domain state as JSONB. A revision-based compare-and-swap SQL function atomically writes all state. On a conflict, the server reloads and reruns the domain decision, including final eligibility checks. This supports multiple app instances without treating a process mutex as database transactionality. RLS is enabled; anon/authenticated roles cannot directly access the table/function; the server service role performs operations.

This is an anonymous synthetic demo, **not a production merchant account system**. Workspace URLs are bearer-like shared demo links; anyone holding the complete link can operate its demo roles/reset it. Use synthetic nicknames only. Real deployment would require merchant authorization, separate customer/merchant capabilities, distributed voice quotas, retention controls and production payment/fulfillment integrations.

## Verification

```sh
npm test
npm run lint
npm run build
```

The tests cover the complete pooling/cancellation/approval/commitment/pickup lifecycle, exact-offer constraints, paise remainders, API validation, persisted independent loads and concurrent device requests. Live Supabase execution and Sarvam credentials require an account smoke test; local tests do not prove those external integrations.

The browser demo can be reset using the top-bar reset control. Use **Demo walkthrough** for the judge input sequence. There are no pre-scripted eligibility outcomes: changing an input changes server computations.

## Existing work retained

The existing Next.js/React/TypeScript project, domain types, store lifecycle, approval helpers, supplier evaluation structure and Supabase dependency were reused and repaired. The obsolete UI and in-memory API routes were replaced with one coherent interface and transactional workspace boundary. An archive of the old unused UI/routes/tests is at `/tmp/nahimila-unused-antigravity-ui.tar.gz` for this local session.
