# Remaining user setup

The implementation is on `main` in the Quiz App repository. Real backend and Google configuration remain pending. Follow [the launch walkthrough](LAUNCH.md) for the current account setup sequence.

1. **Supabase:** create a Free project, choose the storage region, and apply migrations 001, 002, 003, followed by the generated private `work/provision.local.sql`.
2. **Google:** create/configure your OAuth web client and consent screen, enable the Supabase Google provider, and use the callback and frontend URLs shown in the deployment guide. Keep Google secrets in provider settings.
3. **Hosting:** connect the completed repository branch to a free static host. Recommended candidate: Cloudflare Pages, build `npm run build`, output `dist`, Node 24. Enter only `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` as public build variables. Use its free subdomain initially.
4. **College setup:** initial BMU student domain is `bmu.edu.in`; the admin email is already recorded in the private provisioning SQL. Add other colleges and professor emails through the admin screen, approve professors, and import real student rosters for formal exams.
5. **Before inviting students:** publish your institution-approved privacy/retention/support information, provide the expected simultaneous student count, and run the real-account staging checklist in `docs/DEPLOYMENT.md`. We can complete the live verification after configuration is available.

No passwords, service-role keys, or Google client secrets need to be pasted into chat. No custom domain or paid upgrade is required to start within free-tier limits.

Private image uploads need the storage migration. Application backups do not include Google accounts or image binaries; protect and back up those through the institution-approved account tooling separately.

Routes are already implemented. For root hosting use `APP_BASE_PATH=/`; GitHub Pages builds use `/ExamEngine/`. Allow the exact frontend `/auth/callback` path (including any base path) in Supabase Auth, as detailed in the deployment guide. After deployment, refresh a student result, professor editor, and admin approval link and verify wrong-role URLs are denied.
