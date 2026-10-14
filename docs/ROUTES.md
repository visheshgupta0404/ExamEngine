# Application routes and access

All paths below are relative to `APP_BASE_PATH` (default `/`). The GitHub Pages workflow builds for `/ExamEngine/`.

| Workspace | Paths |
| --- | --- |
| Public | `/sign-in`, `/auth/callback`, `/privacy`, `/forbidden`, `/not-found` |
| Student | `/student/assessments`, `/student/profile`, `/student/results` |
| Student records | `/student/quizzes/:id`, `/student/attempts/:id`, `/student/results/:id` |
| Professor | `/professor/assessments`, `/professor/assessments/new`, `/professor/submissions` |
| Professor records | `/professor/assessments/:id/edit`, `/professor/assessments/:id/preview`, `/professor/submissions/:id` |
| Admin | `/admin/colleges`, `/admin/professors`, `/admin/audit` |

The root opens the signed-in account's workspace. Unauthenticated protected links return to sign-in and preserve only a registered path for the eventual account's role. Role mismatches show access denied. Unavailable records show a generic unavailable page. No student identity, answers, quiz joining code, or access token belongs in a route. OAuth's temporary callback parameters are removed after session processing.

Live protected navigation refreshes the server-authorized workspace before rendering. Students can open only their own attempts; professors can edit and grade only assessments they own. An active student attempt resumes at its original attempt URL and deadline. A submitted attempt URL redirects to its result. The development role selector is restricted to loopback preview and never provides production privileges.

## Where security is enforced

The static HTML and frontend route code are publicly downloadable. Client guards provide navigation and prevent accidental display; they cannot authorize database access. The PostgreSQL API independently derives identity and role from the verified session and enforces professor approval, college, ownership, roster/code eligibility, result release, private image access, and answer-key restrictions. Changing a URL or editing JavaScript does not grant database privileges. Admin routes have no public data embedded in their HTML.

The `quiz` RPC supports reloading a quiz instruction link without exposing answer keys. Code-only quizzes require the correct code again; the UI retains that code in per-account session storage rather than the URL. A copied code-only instruction URL alone does not grant entry. Full attempts still use the independently authorized `start`, `save`, and `submit` operations.

## Hosting and checks

The local server returns the application shell for registered routes and workspace prefixes, while private source/configuration files remain unavailable. Cloudflare builds generate route-specific `dist/_redirects` with same-site 200 proxy rules; assets retain their own paths. See [Cloudflare redirect documentation](https://developers.cloudflare.com/pages/configuration/redirects/).

GitHub Pages builds include a `404.html` application shell with the correct base path. Direct nested links can run the app from that fallback but retain an HTTP 404 response; Cloudflare's configured proxy rules are preferred for normal route responses. See [GitHub custom 404 documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-custom-404-page-for-your-github-pages-site).

Automated tests cover route parsing/base paths, unsafe return URLs, role mismatch, foreign record ownership, active-attempt resume, and submitted-attempt redirects. PostgreSQL tests cover anonymous access, cross-college isolation, foreign attempt writes, metadata lookup, and approval revocation. Before launch, repeat the deployment guide's staging checks with real Google accounts and refresh each role's nested URLs on the chosen host.
