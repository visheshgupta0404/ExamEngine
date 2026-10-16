# ExamEngine setup and launch

The app is deployed on GitHub Pages, Supabase migrations 001-004 are applied, and the Google provider is configured. Real admin/professor/student acceptance testing and institution-approved privacy/support details remain necessary before inviting students. See [the audit](AUDIT.md) and [remaining setup](USER-SETUP-CHECKLIST.md). The production build cannot use the local role switch.

## 1. Check the application

Run from the Quiz App repository using Node.js 24:

```sh
npm ci
npm test
npm run check
npm run dev
```

The local preview is http://127.0.0.1:4173. Its data is browser-only. `npm run dev:live` uses real backend configuration when supplied, with no role switch.

## 2. Create the free backend

Create a Supabase **Free** project under your own account, choose the institution-appropriate region, and keep its database password private. No payment plan or custom backend domain is needed.

Apply these SQL files in order in that project's SQL editor, once each:

1. `backend/migrations/001_examengine.sql` — application schema, authorization, and assessment RPC.
2. `backend/migrations/002_question_images.sql` — private image bucket and access policies.
3. `backend/migrations/003_maintenance.sql` — deadline-finalization maintenance.
4. `backend/migrations/004_assessment_integrity.sql` - question privacy, input validation, and blank-answer grading.
5. `work/provision.local.sql` — your ignored admin/BMU provisioning file, already generated locally.

For the existing ExamEngine project, these migrations are already applied. Do not rerun the combined setup or provisioning. For future upgrades, apply only new migration files in order.

Keep `exam_private` out of Supabase's exposed schemas. The public API exposes only the controlled `examengine` RPC and the boolean image-access helper. Never add public read policies to answer keys, attempts, or profile tables.

Optionally enable Supabase Cron and schedule `select exam_private.finalize_expired();` every minute. Without Cron, expired attempts finalize on the next student/professor/admin workspace access. No scheduled deletion of student records is enabled.

## 3. Configure Google sign-in (final feature setup)

Use a Google Cloud project owned by you. Configure a web OAuth client and the consent screen. In Supabase's Google provider configuration, enter the client ID/secret. Use the **callback URL shown by Supabase** as the authorized Google redirect URI; do not guess it.

Add your actual frontend origin and localhost development origin where the provider requires them. In Supabase Auth URL Configuration, set the production site URL and explicitly allow `https://YOUR-HOST/auth/callback` and `http://127.0.0.1:4173/auth/callback` for local staging. For GitHub project hosting, the frontend callback includes the base path: `https://YOUR-USER.github.io/ExamEngine/auth/callback`. These frontend URLs differ from Google's authorized redirect URI, which remains the callback shown by Supabase. Avoid unrestricted wildcard production redirects. Finish Google consent/verification or testing-user requirements shown by Google before inviting students. See [Supabase redirect URL configuration](https://supabase.com/docs/guides/auth/redirect-urls).

The initial administrator uses the private allowlist entry generated for your Gmail address. Each professor uses their own Google account and receives access only after admin approval. Students use verified emails from configured college domains and fill in name, roll number, and class. For formal exams, use an explicit roster; a self-declared class alone is not enrollment verification.

[Google provider configuration](https://supabase.com/docs/guides/auth/social-login/auth-google)

## 4. Public application configuration

Copy `.env.example` to ignored `.env` and fill in:

```text
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_PUBLISHABLE_KEY=YOUR-PUBLIC-PUBLISHABLE-KEY
```

Use the **publishable** or legacy **anon** key, never the service-role/secret key. These two values are intentionally public in the built browser app; all permissions are enforced in the database. The build rejects secret keys. Google client secrets and database passwords belong only in provider settings.

Optional public build variables `SUPPORT_EMAIL` and `PRIVACY_POLICY_URL` connect your institution-approved support contact and HTTPS privacy page to the in-app privacy screen. This needs configuration, not a code edit.

Set `APP_BASE_PATH=/` for Cloudflare Pages or another host serving the app at its root. The GitHub Pages workflow supplies `/ExamEngine/`. This controls asset paths, navigation, and the frontend OAuth callback. See [the route map and hosting behavior](ROUTES.md).

## 5. Deploy on a free static host

Cloudflare Pages is the recommended deployment candidate; use its free provider subdomain. Connect the Git repository, set build command `npm run build`, output directory `dist`, Node version 24, and the two public configuration variables above. The generated `_headers` file includes a Content Security Policy, frame protection, and permissions restrictions.

The existing GitHub Pages workflow is also prepared for a static noncommercial preview. It runs locked dependency installation, tests, syntax checks, and the public build. Set repository Actions variables `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` for a configured build. GitHub Pages does not apply Cloudflare `_headers`; configure equivalent response policies on a host that supports them for production. GitHub Pages has restrictions on commercial SaaS use.

Building without backend configuration deliberately produces a setup screen, not an open exam/admin interface. Local preview builds are restricted to loopback hostnames even if accidentally uploaded.

- [Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/)
- [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)

## 6. Verify with real staging accounts

Before real exams, verify these with a real admin, professor, BMU student, and an account from another college:

- Admin sign-in succeeds only for the privately provisioned email; the college email alone never grants admin privileges.
- Add and approve a professor; revoked approval blocks their next API request.
- Student Google email cannot be edited or replaced with another email in a request.
- Publish a small roster-restricted quiz with single/multiple-select and written questions. Test a private image and equation.
- An unlisted student or another college cannot start the quiz, save its responses, or see its submissions.
- Refresh and reconnect recover confirmed responses and the original deadline. Unsaved offline drafts are visibly distinguished from server acknowledgments. Responses arriving after the hard deadline are rejected.
- Repeat start/submit requests do not create duplicate active attempts or grades. Test two browser tabs and real concurrent sessions.
- Test per-question expiry while the tab is hidden/closed, full-exam timeout, scheduling, retry limits, manual grading, and delayed result release.
- CSV export and backup download work. Restore a backup into a disposable staging database before relying on it.
- Check the hosting response headers, OAuth redirect URLs, browser console, and Supabase API/DB logs.

These live provider checks cannot be completed before the accounts and URL exist. Local PGlite tests execute the real PostgreSQL functions and storage policies against a test auth schema; they do not validate Google's OAuth configuration or Supabase's hosted gateway/storage implementation.

## Backups, operations, and rollback

Admin → Download backup exports application records. Treat this JSON as private: it includes student identities/responses and answer keys. It excludes Google/Supabase auth secrets and image binary files. Back up the private image bucket separately using your trusted Supabase account tooling. Keep backups in institution-approved storage.

Generate reviewed restore SQL with:

```sh
node tools/restore.mjs PRIVATE-BACKUP.json work/restore.local.sql
```

The restore tool refuses a database with existing assessments. Use the same project with its original `auth.users` identities, or arrange an explicit identity migration before restoring into another project. It does not create Google accounts. Never execute SQL supplied by an untrusted backup author.

For frontend rollback, redeploy the previous known-good host build. Database migrations are additive and versioned; do not undo them by deleting student records. Test any future migration in staging and export a private backup first.

Review provider DB/API/storage usage and error logs before scheduled exams. Watch storage size, failed RPCs, response latency, and rejected/deadline saves. The SQL rate limit is per verified account/operation; it is not a substitute for provider-level denial-of-service protection. Run a realistic staging load test for your expected simultaneous student count before enabling large classes.

The workspace currently loads the user's authorized quiz/attempt history in one response. For large long-running deployments, introduce pagination/archive views after measuring record counts. The zero-cost target is a pilot, not a guarantee of unlimited multi-college capacity or uninterrupted availability.

Supabase documents a 500 MB free database allowance and possible pausing after low activity. Check actual current quotas before launching and before each large exam period. Do not enable paid upgrades automatically.

- [Supabase billing](https://supabase.com/docs/guides/platform/billing-on-supabase)
- [Free-project pausing](https://supabase.com/docs/guides/platform/free-project-pausing)

## Institution decisions before real student use

Publish an approved privacy notice, retention/deletion policy, and support contact. Confirm the expected concurrent student count, eligible rosters, hosting region, and how grades may be released. The in-app privacy summary describes collected fields but is not an institution's final approved policy. No real records are automatically deleted, and no camera, microphone, location, or proctoring telemetry is collected.
