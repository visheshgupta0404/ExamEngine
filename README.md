# ExamEngine

A focused dark-blue assessment platform for multiple colleges. Students take assessments and review released results; approved professors author quizzes and grade submissions; administrators configure college email domains and professor access.

**Status:** application and backend implementation are prepared for setup. Local preview and PostgreSQL policy/rule tests work. Live Google/Supabase integration and hosting acceptance still require your accounts and configuration; do not invite real students until the staging checks pass.

## Development

Node.js 24 recommended. Dependencies are locked; no paid development service is required.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:4173. Local preview includes sample BMU data and a role switch. Use sample code `WEB-101`, a sample `@bmu.edu.in` email, roll number, and class `CSE · 2024`. Preview identities and grading are not production security, and preview records stay in that browser.

```sh
npm test
npm run check
npm run build
```

`npm run dev:live` runs the configured Supabase version without preview identities. Set browser-safe backend values in ignored `.env`, as documented in `.env.example`.

## Implemented

- Student identity, assigned quizzes, code joining, roster restrictions, attempts, history, and result release.
- Single-choice, multiple-select, and written questions; equations, HTTPS illustrations, and private image uploads.
- Exam and per-question deadlines, scheduling, question randomization, forward-only or free navigation, autosave, review flags, clear selection, refresh recovery, and timeout submission.
- Configurable scoring/penalties/attempt limits, immutable attempt versions, manual written grading, class summaries, and safe CSV exports.
- College/domain configuration, approved professor accounts, audit events, private backup export, and reviewed restore tooling.
- PostgreSQL RPCs with server-authoritative timing/grading, role/college checks, protected answer keys, revision checking, idempotent start/submit, and per-account request limits.
- Google OAuth with PKCE, verified college domains, private admin provisioning, session refresh, and sign-out.
- Separate student, professor, and admin routes, record ownership guards, direct-link refresh, browser history, and a dedicated OAuth callback. See [route and access documentation](docs/ROUTES.md).
- Production builds, locked dependencies, deployment checks, security headers, and a safe unconfigured setup screen. Preview roles work only on loopback hostnames.

## Setup

Follow [the deployment guide](docs/DEPLOYMENT.md) for Supabase migrations, Google provider settings, free static hosting, backup/restore, and the required real-account staging checklist. Your private administrator provisioning SQL is in ignored `work/provision.local.sql`. The local implementation plan is also ignored.

Free-tier quotas and inactivity rules apply. No paid plan has been enabled. Live capacity, institutional privacy/retention policy, and provider configuration must be confirmed before production use. No camera, microphone, location, or proctoring is collected.
