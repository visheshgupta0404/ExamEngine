# ExamEngine audit - 16 October 2026

## Confirmed issues fixed

| Issue | Change |
| --- | --- |
| Students could inspect question text/options before starting the timer | The server now returns assessment summaries until an authorized attempt starts. Professor editing and authorized attempt snapshots retain full questions. |
| A late API/save response could restore private data after sign-out or an account change | Session generation checks discard responses from an earlier identity, including private image renewal. |
| Two tabs could send different answers at the same revision and silently disagree | Equal-revision content conflicts now stop autosaving, preserve the local draft as conflicted, and require refreshing server answers. |
| A temporary network/server error during navigation looked like sign-out | The authorized screen and its URL remain visible; actual access denial still clears the workspace. |
| Reaching the attempt limit could open the oldest result | The newest attempt is selected by timestamp, independently of API ordering. |
| The last timed question could return to the dashboard | Server-finalized attempts now open their result route. |
| Whitespace-only written answers required manual grading | The database treats them as unanswered, without a pending written grade. Historical results are unchanged. |
| Missing question/option arrays and fractional question timers were accepted by server validation | Database validation rejects malformed structures and non-integer timers. |
| Navigating away could silently discard professor edits | Unsaved editor changes trigger a leave/close warning; canceling keeps the editor. This is a warning, not persistent draft recovery. |
| The skip link could change routes under a deployment base path | It now focuses and scrolls the current main area without navigating. |

## Verification

- 50 automated tests passed: actual PostgreSQL functions in PGlite, authorization/college isolation, snapshots, grading, timers, image access, backups, routing, navigation, session races, and conflict handling.
- Syntax checks and production build passed. Production dependency audit reported zero known vulnerabilities at audit time.
- Migration 004 was applied to the live Supabase project. The live verification showed the summary helper exists, question content is hidden, and zero private tables lack row security.
- The live database had zero quizzes and zero attempts before and after the migration. A separate populated-database regression test verified the upgrade leaves attempt records unchanged.
- No real-account end-to-end acceptance or representative simultaneous-student load test has been completed. Automated fixtures do not prove OAuth audience configuration or real college account behavior.

## Next improvements, in priority order

1. **Before a student pilot:** replace the OAuth secret previously exposed in chat, complete real admin/professor/student acceptance, confirm Google audience access, and publish institution-approved privacy/support/retention information. See [the setup checklist](USER-SETUP-CHECKLIST.md).
2. **Before larger exams:** test the intended concurrency, monitor errors and storage/database usage, establish backup/restore ownership, and choose hosting with configurable security response headers. Free-provider capacity must be measured for the intended class size.
3. **Reliability:** recoverable professor drafts, a clearer reconnect/saved-answer history, and paginated assessment/result queries. Current workspace responses can grow with accumulated attempts.
4. **Professor productivity:** validated CSV/question imports, reusable question banks, reusable roster groups, and assessment duplication with scheduling presets.
5. **Teaching insight:** question-level performance summaries, review filters, and accessible downloadable result reports. Keep access scoped to each professor/college and honor result-release rules.

This is a bounded audit and repair pass, not a guarantee that every possible bug has been found. Current code, migrations, and deployment instructions are in the repository; private setup files remain ignored.

## Follow-up - 21 October 2026

Professor recovery, validated question CSV import, paged/searchable lists, more reliability checks, fresh-database backup verification, and a local student workload are implemented. Equation rendering now loads on demand. See [the technical completion report](TECHNICAL-HANDOFF.md) for evidence, limits, and remaining account/institution steps.
