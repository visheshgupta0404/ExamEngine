# Implemented backend

The SQL in `backend/migrations/` is executed by local PostgreSQL tests and consumed by the browser Supabase adapter. Live Supabase/Google provisioning remains pending. See `DEPLOYMENT.md` for setup and provider validation.

## Records and permissions

All application tables live in the unexposed `exam_private` schema. Anonymous/authenticated roles have no direct schema or table permissions. RLS is enabled without public table policies. Controlled security-definer functions use an empty search path and explicit qualified relations.

| Record | Purpose |
| --- | --- |
| colleges | Enabled institutions and exact student email domains. |
| admin_emails | Private administrator provisioning allowlist. |
| professor_access | Admin-created email invitations/approvals, tied to a college. |
| profiles | Verified auth identity, derived role/college, name, roll, and class. |
| quizzes | Professor-owned draft, live publication/release state, college and code. |
| versions | Immutable public question/rule snapshot and separate private answer-key column. |
| rosters | College-email and optional roll eligibility per quiz. |
| attempts | Student/version binding, saved responses, deadlines, revisions, grading, and identity snapshot. |
| audit | Administrative/publication/grading/backup events. |
| throttle | Per-account operation counters, including rejected mutation/lookup requests. |

One account belongs to one college, derived from its verified email or approved professor invitation. Students' class names are self-reported; formal exams must use a roster for enrollment verification. Multiple colleges are supported, and professor access is scoped to their own quizzes within their approved college.

## Public API

`examengine(operation, payload)` is granted only to authenticated users. The server derives identity from `auth.uid()` and verified Google-linked account metadata; it ignores submitted email/role/score claims.

- `workspace`: authorized quizzes, attempts, identity, college metadata, and admin audit entries. Finalizes expired attempts.
- `profile`: student name, college-scoped unique roll, and class; verified email/role/college cannot be overwritten.
- `join` / `start`: college/class/code/roster eligibility, schedules, attempt limits, immutable version, server deadline, and persisted random order.
- `save` / `advance`: validated responses, monotonic revisions, review flags, navigation and timed-question locks. Stale advances are idempotent when supplied the expected current index.
- `submit`: row-locked, server-computed grade with repeat-call stability. Expired answers are rejected; browser scores are ignored.
- `saveQuiz` / `publish` / `roster` / `manualGrade`: approved professor ownership, quiz validation, version creation, roster-domain validation, and bounded written grades.
- `college` / `professor` / `approve`: platform admin only; exact domains and approval/revocation.
- `backup`: admin-only private application-record export, with an audit event. Auth accounts and image binaries are excluded.

The frontend serializes response saves, distinguishes pending/failed/acknowledged saves, retains an offline draft per user, and retries on reconnect. It does not claim unsent responses were accepted after a deadline. Direct frontend state edits cannot bypass server permissions.

## Images and timing

The private `question-images` bucket permits PNG/JPEG/WebP uploads up to 5 MB. Only approved professors upload to their own user folder. Students can obtain short-lived signed URLs only for their active eligible attempt or released completed result. New URLs are renewed during the assessment. Existing signed URLs remain valid until their short expiry; role revocation blocks issuance of new URLs.

The server controls both exam-wide and per-question timing. Returning after several question deadlines skips expired windows rather than resetting time. Private maintenance finalizes expired attempts in bounded batches and does not delete student records. Optional Supabase Cron configuration is left to account setup.

## Validation and launch boundaries

Local tests execute the actual migrations in PGlite against a test auth/storage schema: permission denial, college separation, approval/revocation, private keys/images, schedules, rosters, marking, written grading, retries, expired writes, snapshots, rate limits, and backup restore. The production build disables local roles and refuses secret keys.

These tests cannot validate real Google consent/redirect configuration, Supabase gateway behavior, hosted image signing/uploads, or free-tier exam capacity before your accounts exist. Real concurrent load and live-account acceptance are required before production use. The pilot workspace currently loads its authorized history in one response; pagination/archive work should follow measured large-record workloads.
