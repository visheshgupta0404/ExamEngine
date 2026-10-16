# Remaining launch checks

The app is deployed from `main` at https://visheshgupta0404.github.io/ExamEngine/. Supabase migrations 001-004 and private admin/BMU provisioning are applied. Google OAuth is enabled and redirects to Google. Do not rerun the combined setup on this project.

1. **Replace the exposed OAuth secret:** in Google Auth Platform > Clients > ExamEngine Web, create a replacement secret yourself. Save it in Supabase Authentication > Sign In / Providers > Google, verify sign-in, then remove the old exposed secret. Never paste secrets in chat or commit them.
2. **Real-account acceptance:** sign in as admin, approve a separate professor, create a short roster-restricted quiz, and have a college student submit it. Check result release/manual grading and denial of other-college, other-student, and wrong-role links. Include a refresh and reconnect test. The automated suite does not replace this external-account check.
3. **Google audience:** confirm the intended college accounts can sign in under the current audience/testing settings before invitations.
4. **Institution setup:** add other colleges, approve their professors, and use verified email rosters for formal exams. A self-declared class is not enrollment verification.
5. **Operational readiness:** agree on privacy, retention, support, backup ownership, and expected simultaneous student count. Supply institution-approved SUPPORT_EMAIL and PRIVACY_POLICY_URL build settings. Run a representative load test before a large exam.

No custom domain or paid upgrade is needed for a small pilot within provider limits. GitHub Pages does not apply the generated Cloudflare response headers; a host with configurable security headers is a useful next step. See [deployment details](DEPLOYMENT.md) and [audit findings](AUDIT.md).
