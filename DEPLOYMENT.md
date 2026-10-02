# NahiMila on Render Free and Supabase Free

Deployment files are prepared. No cloud accounts, database or public site have been created yet.

## What you need to provide

1. A GitHub repository containing this **Solution** Git repository. It can be private. There is currently no Git remote connected; send the repository URL once it exists. Never upload `.env.local`, `.data` or API keys.
2. A new Supabase Free project. Choose a nearby region such as Singapore. Enter the project URL, publishable key and server service-role key in the matching fields of your local `.env.local`. Do not send secret keys in chat. Existing Gemini and Sarvam keys can be used.
3. A Render account. Sign up/sign in yourself and select the Free web-service plan. Connect only the repository needed for this website.

## Prepare Supabase

In the new project's SQL Editor, run these saved files in this order:

1. `supabase/migrations/20261002010000_merchant_product.sql`
2. `supabase/migrations/20261002020000_gemini_quota.sql`

Do **not** apply the historical `demo_workspaces` migration for this product. The two current migrations configure owner-scoped data access and server-only coordination. This path has not yet been verified against a real Supabase project.

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
