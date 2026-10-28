# Backend availability - 28 October 2026

ExamEngine uses a Supabase Free project. Low database activity can cause pausing even while the static sign-in page remains available. Opening the website alone does not prove its database is running.

## Current installation

On 28 October 2026, the existing ExamEngine project was resumed, migration 005 was applied, and the live REST readiness request returned `status: ok`. All 64 automated tests and the production build passed. Private data remains outside the health response.

## Automated checks

The `Check database availability` GitHub Actions workflow calls the read-only `examengine_health` database RPC four times daily. The planned UTC times are 01:17, 07:17, 13:17, and 19:17 (06:47, 12:47, 18:47, and 00:47 India time). GitHub may delay scheduled runs.

The check executes a PostgreSQL query returning only `{ "status": "ok", "version": 1 }`. It uses the existing publishable key, requires no user account or service-role key, and neither reads nor changes student/exam records. The RPC is a security-invoker function with an empty search path. It grants no access to private tables. The script has a 20-second timeout, rejects redirects and unexpected responses, and does not log keys or backend response bodies.

The workflow runs on GitHub infrastructure; your laptop does not need to stay on. It also runs when its source changes and can be started manually from Actions. Failed checks appear as failed workflow runs; GitHub notification delivery depends on your account's notification settings.

## One-time installation

1. Resume the current project from the Supabase dashboard if paused. A scheduled request cannot resume an already paused project.
2. Apply only `backend/migrations/005_availability.sql` to the existing database. Paste the file's SQL contents into the SQL editor, not its filename. Do not rerun the combined initial setup.
3. Existing repository variables `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` are reused. No new credentials are needed.
4. Check a successful availability run at [GitHub Actions](https://github.com/visheshgupta0404/ExamEngine/actions/workflows/availability.yml). Locally, `npm run check:backend` performs the same check with ignored `.env` configuration.

New installations apply migrations 001-005 in order before private provisioning. The setup generator includes all five migrations.

## Limits of a free setup

This is a best-effort readiness monitor, not an always-on guarantee or an automatic resume service. Supabase controls what counts as sufficient activity. Daily database calls may reduce inactivity pauses, but a successful health check does not verify real user login, grading, or result access.

GitHub can delay or drop scheduled jobs. In public repositories, scheduled workflows are disabled after 60 days without repository activity; a workflow run is not a substitute for repository activity. The job deliberately does not generate fake commits to defeat this rule. Check the Actions page if GitHub sends an inactivity notice. Do not assume this combination will run indefinitely unattended.

For a firm requirement that Supabase never pauses for inactivity, choose a paid Supabase organization after approving its cost. This change does not upgrade billing or enable any paid service. A paid plan removes inactivity pausing, not all possible outages.

References:

- [Supabase project pausing](https://supabase.com/docs/guides/platform/free-project-pausing)
- [GitHub scheduled workflow limitations](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
- [Supabase publishable keys](https://supabase.com/docs/guides/getting-started/api-keys)
