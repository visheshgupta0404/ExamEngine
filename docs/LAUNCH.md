# Finish the first live setup

The application is on `main`. The existing Supabase project, Google provider, and GitHub Pages deployment are configured; migrations 001-004 are applied. The creation steps below are for a new installation, and must not be repeated on the current database. See [remaining setup](USER-SETUP-CHECKLIST.md). This guide uses the existing GitHub Pages address to avoid adding a hosting account. Real student use still requires the acceptance checks below and institution-approved privacy/support details.

## 1. Create the backend

Open [Supabase](https://supabase.com/dashboard) and create a project called `ExamEngine` under a Free organization. Choose a suitable nearby region and create/store the database password yourself in your password manager. Do not send the password in chat. Wait until the project is available.

In the local repo run:

```sh
npm run setup:prepare
```

This prepares **ignored, private** `work/setup.local.sql` from the four migrations and your existing admin/BMU provisioning file. In the new project's SQL editor, paste and run this file once. It is for an empty project only. Use the combined file **or** the individual migration sequence, never both. If a section fails, stop and inspect the error before retrying: earlier sections may already be committed.

Keep `exam_private` out of the exposed API schemas. Copy the project URL and **publishable** API key from the project settings. These browser-safe values are the only backend values the frontend needs.

## 2. Set up Google

Open [Google Cloud Console](https://console.cloud.google.com/). Create/select an ExamEngine project and configure Google Auth Platform branding, audience, and data access. Because students may belong to different institutions, use an External audience. During testing, add the actual admin/professor/student test accounts where Google requires test users.

Request only basic identity scopes: `openid`, email, and profile. Create an OAuth client of type **Web application**:

- Authorized JavaScript origin: `https://visheshgupta0404.github.io`
- Authorized redirect URI: copy the exact callback displayed in **your Supabase Google provider settings**. It normally ends in `/auth/v1/callback` on your project's Supabase domain. This is different from the frontend callback below.

Enter the OAuth client ID and client secret directly in Supabase's Google provider settings and enable the provider. Keep the client secret out of `.env`, GitHub variables, source code, and chat. Follow the [official Supabase Google setup guide](https://supabase.com/docs/guides/auth/social-login/auth-google) for current console steps and any Google publishing/verification requirements.

In Supabase Auth URL Configuration set:

```text
Site URL:
https://visheshgupta0404.github.io/ExamEngine/

Allowed redirect URL:
https://visheshgupta0404.github.io/ExamEngine/auth/callback
```

For local staging you can also allow `http://127.0.0.1:4173/auth/callback` and use a root-path local build. Production Google availability must be checked with the intended student accounts; a testing-mode login alone does not confirm a public launch.

## 3. Publish the built app

Open [repository Pages settings](https://github.com/visheshgupta0404/ExamEngine/settings/pages), sign in as the repository owner, and set **Build and deployment → Source → GitHub Actions**. The application requires the prepared `dist` artifact, including generated `config.js` and bundled dependencies; serving the repository root directly is insufficient. See [GitHub's publishing source documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

In [Actions variables](https://github.com/visheshgupta0404/ExamEngine/settings/variables/actions), add:

```text
SUPABASE_URL = your project's HTTPS URL
SUPABASE_PUBLISHABLE_KEY = your public publishable key
```

The workflow already supplies `APP_BASE_PATH=/ExamEngine/`. In [Actions](https://github.com/visheshgupta0404/ExamEngine/actions), run **Deploy static content to Pages** against `main`. Verify the run succeeds and then open the public site. Nested URLs use the GitHub Pages 404 application fallback; for normal 200 responses and custom security headers, use the Cloudflare option in [DEPLOYMENT.md](DEPLOYMENT.md).

## 4. Verify before inviting students

- Sign in as the privately provisioned admin; confirm the college and professor-management routes work.
- Add a professor account and approve it. Confirm an unapproved professor cannot use the educator API.
- Have the professor publish a tiny test quiz with one choice question and one written question.
- Sign in using a permitted college account, fill name/roll/class, start the quiz, answer, refresh, and submit. Confirm the original deadline persists and the submission appears for its professor.
- Grade the written answer and release results. Confirm the student sees the recorded score after signing in again.
- Test a second student and another college. They must not read the first student's attempt, grade answers, or access admin routes by changing the URL.
- Confirm sign-out, nested-route refresh, private-image access, CSV exports, and backup download. Complete the broader staging checks in [DEPLOYMENT.md](DEPLOYMENT.md).

Add institution-approved `SUPPORT_EMAIL` and `PRIVACY_POLICY_URL` build variables before inviting real students. Keep staging test data separate from actual exam records.

## Current handoff

Neither Supabase nor Google setup has been completed as of October 15, 2026. Repository push alone does not finish those accounts. The public site was observed serving the older app while the generated configuration and nested routes returned 404; check the Pages publishing source as above. Backend setup, provider login, and real-account acceptance remain unverified until completed in the actual accounts.
