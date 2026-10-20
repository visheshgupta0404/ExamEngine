# Technical completion report - 21 October 2026

This pass implements the technical work that can be completed without account credentials or college policy decisions. It adds no paid services, dependencies, or database migration/setup steps.

## Delivered

- **Professor recovery:** raw unfinished form values and question structure recover on refresh in the same tab. Recovery is scoped to professor/college/assessment, expires after 24 hours, excludes private signed image links from question snapshots, and clears on sign-out. Storage failures display a save warning. A recovery copy is not an online save, cross-device sync, or a guarantee after closing a tab.
- **Question CSV import:** the editor offers a downloadable template. Single-choice, multiple-select, and written questions are validated before appending. Quoted commas, multiline values, escaped quotes, fresh IDs, answer bounds, row limits, and file size limits are covered. Imported questions remain drafts until the professor saves them. Unrelated assessment rules and rosters are not imported or published.
- **Long lists:** student/professor assessments, student results, and professor submissions have search and 20-item pages. CSV exports still cover all class-filtered submissions. This bounds DOM rendering, not backend response size: the current workspace API still returns all authorized records.
- **Reliability checks:** regression tests cover offline answer-save retries, equal-revision multi-tab conflicts, draft recovery with invalid unfinished roster text, sign-out cleanup, list filtering/page clamping, and existing role/college restrictions.
- **Backup verification:** an exported backup was restored into a fresh local database containing the original test auth identities. All eight exported application tables matched exactly. Google identities, storage image binaries, and operational backup ownership remain outside the application JSON backup.
- **Repeatable workload:** `npm run test:load -- --students=50` runs entirely in a new local PGlite database. The deployment workflow also runs a 25-student workload automatically. No real student records, hosted endpoints, or credentials are used.
- **Loading:** the equation library now loads only when authorized question content contains equations. In the before/after build measurement, initial compressed JavaScript fell from 162,281 to approximately 85,000 bytes (about 48% smaller). The equation chunk is still downloaded when needed. This is an asset-size measurement, not a Core Web Vitals or Lighthouse score.
- **Accessibility:** route-specific page titles, table column headers, named action columns, labeled search controls, page status, keyboard focus on navigation, and mobile wrapping were checked. Existing reduced-motion and focus styles remain in place. No formal accessibility conformance certification is claimed.
- **Question summary display:** instructions now use server-provided question counts and written-question flags when pre-start question content is hidden.

## Evidence

- 61 automated tests passed; syntax checks and production build passed.
- Production dependency audit: zero known vulnerabilities at the time of this pass.
- Local workload: 50 synthetic students, 250 requests, 50 submitted attempts, identity isolation passed. One observed run took 0.65 seconds with p95 queued request latency of 157.2 ms. PGlite serializes the database queue: these are local observations, not Supabase concurrency/capacity promises.
- Browser: refreshed an unfinished professor form, recovered its fields, imported the three-type CSV, saved it into loopback preview data, and verified equations in its preview. Search returned the intended assessment. Mobile preview/list checks found no horizontal overflow and no unnamed buttons; browser console had no errors in the checked flow.
- Trace tooling was unavailable. No real-user Core Web Vitals, hosted load test, or real Google-account flow was measured.

## Remaining human work

Follow [the setup checklist](USER-SETUP-CHECKLIST.md): replace the exposed OAuth secret, complete real admin/professor/student sign-in acceptance, confirm Google audience access, provide expected exam size, and approve institutional privacy, retention, support, and backup ownership.

## Future scaling work

Server-side summary pagination and on-demand attempt details remain advisable if workspace payloads grow significantly. Representative hosted load testing needs the intended student count and dedicated test identities/environment. Question banks, richer analytics, and persistent cross-device professor drafts are optional product extensions, not implemented by this pass.

No new backend setup is needed for the features delivered here. Existing database authorization remains the source of truth.
