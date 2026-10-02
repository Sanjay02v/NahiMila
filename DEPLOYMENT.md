# NahiMila on Render Free and Supabase Free

[NahiMila is live](https://nahimila.onrender.com) on Render Free, backed by Supabase Free. Source is pushed to [Sanjay02v/NahiMila](https://github.com/Sanjay02v/NahiMila) on `main`. Both product migrations have been applied and six fictional merchant accounts have been seeded. Render uses Node 24, one instance in Singapore, and the configured server-side Gemini/Sarvam keys with the shared Gemini quota limits.

## Verified deployment checks — 3 October 2026

- Render's production build and deployment succeeded.
- Two demo accounts signed in through both Supabase and the public app. Owner-scoped reads returned only each account's own shop and requests; the anonymous network RPC and unauthenticated merchant endpoint were denied. A cross-shop mutation attempt was also rejected.
- Gemini parsed a fictional request for two Coke Zero 500ml bottles, including the explicit refusal to wait. Saving created a `MISSED_DEMAND` entry, which persisted after reload and remained outside confirmed procurement demand.
- A seeded customer link returned valid data and its public confirmation page loaded successfully.
- The public Sarvam streaming endpoint accepted synthetic speech and returned partial and final transcripts: “A customer asked for 2 Coke Zero bottles.” This verifies the hosted stream and audio-upload path; it does not verify a physical microphone or every device/browser.
- Supabase's Site URL is `https://nahimila.onrender.com`. New-account email confirmation and recovery have not been verified; use seeded demo accounts for judging.

The full shared-order demo and a physical microphone check still need a rehearsal on the final devices. No real WhatsApp messages, payments or supplier orders were sent during deployment verification.

## What you need to provide

1. The GitHub repository is connected. It contains Solution's contents directly, so leave Render's Root Directory blank. `.env.local`, `.data` and API keys are excluded.
2. All three Supabase settings are configured locally and in Render. Both migrations below are already applied to the current project. Do not send secret keys in chat.
3. Render's GitHub connection is configured for this repository. The Free service is already deployed; the remaining setup instructions describe recreating it in a new environment.

## Prepare Supabase

In the new project's SQL Editor, run these saved files in this order:

1. `supabase/migrations/20261002010000_merchant_product.sql`
2. `supabase/migrations/20261002020000_gemini_quota.sql`

Do **not** apply the historical `demo_workspaces` migration for this product. The two current migrations configure owner-scoped data access and server-only coordination. They have been applied and verified in the current Supabase project. Run these instructions only for a new, empty project; do not rerun the first migration against the configured database.

With the three Supabase credentials configured locally, run:

```sh
npm run seed:supabase -- --confirm
```

This creates six fictional merchant accounts and demo requests in an **empty** project. It refuses to overwrite an existing product database. Local requests and accounts stay in `.data`; they are not uploaded or migrated by this seed. If you want to keep particular local test entries online, decide that separately before seeding.

The seeded account email addresses and initial demo password are documented in README.md. To use another initial password, set `NML_DEMO_PASSWORD` in `.env.local` before seeding. Do not commit it. Existing account passwords are preserved.

For the hackathon, judges can sign into a seeded demo account rather than create one. Keep the public demonstration fictional: anyone with a shared demo login can change that shop's demo records. Normal new account registration may require email confirmation depending on your Supabase Auth settings.

## Create the Render website

The `render.yaml` Blueprint is at this Git repository's root. Use **New → Blueprint** on Render, select the repository and fill the requested environment settings privately in Render. The Blueprint requests Free compute, Node 24 and the Singapore region. Review the settings before creating it.

If using **New → Web Service** instead, set:

| Setting           | Value                                                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime           | Node                                                                                                                                  |
| Plan              | Free                                                                                                                                  |
| Root Directory    | Leave blank if the repository contains Solution's contents directly; use `Solution` only if it is a folder in the uploaded repository |
| Build Command     | `npm ci --include=dev && npm run build`                                                                                               |
| Start Command     | `npm run start:render`                                                                                                                |
| Health Check Path | `/`                                                                                                                                   |
| Node version      | `NODE_VERSION=24`                                                                                                                     |

Copy the three Supabase settings plus `GEMINI_API_KEY` and `SARVAM_API_KEY` from local configuration into Render's environment settings. Use `.env.example` for the nonsecret model/quota settings. Public-prefixed Supabase settings must be present when building; changes to them require a new build. The app binds to Render's `PORT` through Next's startup environment. Run one instance so all requests belonging to a live voice recording share the same Node process.

The startup check refuses missing Supabase settings; both authentication and product storage refuse temporary local files on Render. Secrets stay on the server except the intentionally public Supabase project URL/publishable key. The startup check validates presence only, not credentials, migrations or database readiness; a successful build or homepage health check does not confirm those integrations work.

After Render assigns the HTTPS URL, set it as the Site URL in Supabase Authentication → URL Configuration. Configure allowed redirect URLs for any enabled email confirmation/recovery flow. Verify that emailed links return to a supported route before relying on new account signup; the seeded demonstration does not depend on confirmation email delivery.

## Verify before sharing the link

- Sign in to two different demo shops using separate browser profiles and confirm they cannot see each other's private requests.
- Record a request; reload and verify it persists. Check free typing and `100gm` pack entry.
- Test Gemini extraction and live Sarvam microphone transcription over HTTPS, including Stop and closing the form.
- Open a customer link on a different device; check confirmation and WhatsApp's prepared message use the public URL.
- Demonstrate 23 → 24 confirmed units, shop approvals, cancellation clearing approvals, and a simulated order. No real procurement or payments occur.

Render Free sleeps after 15 minutes without traffic and can take roughly a minute to wake. Open it before the demo. Its local files are ephemeral, which is why Supabase stores all durable data. Supabase Free can pause after a week of inactivity. AI quotas/credits are separate from the hosting plans. Free hosting is suitable for this small demo; provider quotas and live integration testing still apply.

Official references: [Render Next.js deployment](https://render.com/docs/deploy-nextjs-app), [Render Free limits](https://render.com/docs/free), [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys), [Supabase Free plan](https://supabase.com/pricing).
