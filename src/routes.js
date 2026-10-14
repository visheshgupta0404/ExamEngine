const definitions = [
  ["sign-in", null, "signin"],
  ["auth/callback", null, "callback"],
  ["privacy", null, "privacy"],
  ["forbidden", null, "forbidden"],
  ["not-found", null, "notFound"],
  ["student/assessments", "student", "dashboard"],
  ["student/profile", "student", "profile"],
  ["student/results", "student", "history"],
  ["student/quizzes/:id", "student", "instructions"],
  ["student/attempts/:id", "student", "exam"],
  ["student/results/:id", "student", "result"],
  ["professor/assessments", "professor", "dashboard"],
  ["professor/assessments/new", "professor", "editor"],
  ["professor/assessments/:id/edit", "professor", "editor"],
  ["professor/assessments/:id/preview", "professor", "preview"],
  ["professor/submissions", "professor", "submissions"],
  ["professor/submissions/:id", "professor", "grading"],
  ["admin/colleges", "admin", "dashboard"],
  ["admin/professors", "admin", "professors"],
  ["admin/audit", "admin", "audit"],
];
export function normalizeBase(value = "/") {
  if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(value))
    throw new Error("APP_BASE_PATH must be / or a path such as /ExamEngine/.");
  return value;
}
export function parseRoute(pathname, base = "/") {
  normalizeBase(base);
  if (pathname === base || pathname === base.slice(0, -1))
    return { view: "root", role: null };
  if (!pathname.startsWith(base)) return { view: "notFound", role: null };
  const path = pathname.slice(base.length).replace(/\/$/, "");
  for (const [pattern, role, view] of definitions) {
    const segments = pattern.split("/"),
      given = path.split("/");
    if (segments.length !== given.length) continue;
    let id = null,
      match = true;
    for (let i = 0; i < segments.length; i++) {
      if (segments[i] === ":id") {
        try {
          id = decodeURIComponent(given[i]);
          if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) match = false;
        } catch {
          match = false;
        }
      } else if (segments[i] !== given[i]) match = false;
    }
    if (match) return { role, view, id };
  }
  return { view: "notFound", role: null };
}
export function routePath(role, view, id, base = "/") {
  normalizeBase(base);
  const definition = definitions.find(
    ([pattern, r, v]) =>
      r === role &&
      v === view &&
      (id ? pattern.includes(":id") : !pattern.includes(":id")),
  );
  if (!definition) throw new Error("Unknown application route.");
  return base + definition[0].replace(":id", encodeURIComponent(id || ""));
}
export function defaultPath(role, base = "/") {
  return routePath(role, "dashboard", null, base);
}
export function ownAttempt(a, context) {
  return context.preview
    ? a.identity.email.toLowerCase() === context.identity.email.toLowerCase() &&
        a.identity.collegeId === context.identity.collegeId
    : a.userId === context.actorId;
}
export function accessRoute(route, context) {
  if (route.role && !context) return { redirect: "signin" };
  if (route.role && route.role !== context.role)
    return { redirect: "forbidden" };
  if (["root", "signin", "callback"].includes(route.view) && context)
    return { redirect: "dashboard" };
  if (route.view === "root") return { redirect: "signin" };
  if (!route.role) return { allow: true };
  const { db, role } = context;
  const active =
    role === "student"
      ? db.attempts.find((a) => a.status === "active" && ownAttempt(a, context))
      : null;
  if (active && (route.view !== "exam" || route.id !== active.id))
    return { redirect: "exam", id: active.id };
  if (
    ["instructions", "preview"].includes(route.view) ||
    (route.view === "editor" && route.id)
  ) {
    const q = db.quizzes.find((q) => q.id === route.id);
    if (
      !q ||
      (role === "student" &&
        (q.collegeId !== context.identity.collegeId ||
          !q.published ||
          q.className.toLowerCase() !==
            context.identity.className.toLowerCase())) ||
      (role === "professor" && q.professorId !== context.professorId)
    )
      return { redirect: "notFound" };
  }
  if (["exam", "result", "grading"].includes(route.view)) {
    const a = db.attempts.find((a) => a.id === route.id),
      q = a && db.quizzes.find((q) => q.id === a.quizId);
    if (
      !a ||
      (role === "student" && !ownAttempt(a, context)) ||
      (role === "professor" && q?.professorId !== context.professorId)
    )
      return { redirect: "notFound" };
    if (route.view === "exam" && a.status !== "active")
      return { redirect: "result", id: a.id };
    if (["result", "grading"].includes(route.view) && a.status !== "submitted")
      return { redirect: "notFound" };
  }
  return { allow: true };
}
export function safeReturnPath(path, role, base = "/") {
  if (
    typeof path !== "string" ||
    path.includes("?") ||
    path.includes("#") ||
    path.includes("\\")
  )
    return null;
  const route = parseRoute(path, base);
  return route.role === role ? path : null;
}
export function isAppDocument(pathname, base = "/") {
  const route = parseRoute(pathname, base);
  return (
    route.view !== "notFound" ||
    pathname.startsWith(base + "student/") ||
    pathname.startsWith(base + "professor/") ||
    pathname.startsWith(base + "admin/")
  );
}
export function hostRedirects(base = "/") {
  normalizeBase(base);
  return (
    [
      "student/*",
      "professor/*",
      "admin/*",
      "sign-in",
      "auth/callback",
      "privacy",
      "forbidden",
      "not-found",
    ]
      .map((path) => `${base}${path} ${base}index.html 200`)
      .join("\n") + "\n"
  );
}
