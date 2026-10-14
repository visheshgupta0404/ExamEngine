import test from "node:test";
import assert from "node:assert/strict";
import {
  parseRoute,
  routePath,
  accessRoute,
  safeReturnPath,
  hostRedirects,
  isAppDocument,
} from "../src/routes.js";

const student = {
  role: "student",
  actorId: "student-1",
  identity: {
    email: "student@college.edu",
    collegeId: "college",
    className: "CSE",
  },
  preview: false,
  db: {
    quizzes: [
      {
        id: "quiz-1",
        collegeId: "college",
        className: "CSE",
        published: true,
        professorId: "prof-1",
      },
    ],
    attempts: [],
  },
};
test("routes support direct links and repository hosting paths", () => {
  for (const [role, view, id] of [
    ["student", "dashboard"],
    ["student", "profile"],
    ["student", "history"],
    ["student", "instructions", "quiz-1"],
    ["student", "exam", "attempt-1"],
    ["student", "result", "attempt-1"],
    ["professor", "dashboard"],
    ["professor", "editor"],
    ["professor", "editor", "quiz-1"],
    ["professor", "preview", "quiz-1"],
    ["professor", "submissions"],
    ["professor", "grading", "attempt-1"],
    ["admin", "dashboard"],
    ["admin", "professors"],
    ["admin", "audit"],
    [null, "privacy"],
    [null, "callback"],
  ]) {
    const path = routePath(role, view, id, "/ExamEngine/");
    assert.deepEqual(parseRoute(path, "/ExamEngine/"), {
      role,
      view,
      id: id || null,
    });
  }
  for (const path of [
    "/student/results/%2Fprivate",
    "/student/results/%ZZ",
    "/student/results/../admin",
    "/random",
  ])
    assert.equal(parseRoute(path).view, "notFound");
  assert.equal(isAppDocument("/student/profile"), true);
  assert.equal(isAppDocument("/work/provision.local.sql"), false);
  assert.match(
    hostRedirects("/ExamEngine/"),
    /\/ExamEngine\/student\/\* \/ExamEngine\/index.html 200/,
  );
  assert.doesNotMatch(hostRedirects(), /^\/\* /m);
});
test("role gates and return URLs cannot grant privileges", () => {
  assert.equal(
    accessRoute(parseRoute("/admin/audit"), null).redirect,
    "signin",
  );
  assert.equal(
    accessRoute(parseRoute("/admin/audit"), student).redirect,
    "forbidden",
  );
  for (const path of [
    "https://evil.test",
    "//evil.test",
    "/admin/audit",
    "/student/profile?token=secret",
    "/student/profile#x",
    "/student/\\profile",
  ])
    assert.equal(safeReturnPath(path, "student"), null);
  assert.equal(
    safeReturnPath("/student/profile", "student"),
    "/student/profile",
  );
});
test("record routes enforce student and professor ownership", () => {
  const c = structuredClone(student);
  c.db.attempts = [
    {
      id: "attempt-1",
      userId: "student-1",
      quizId: "quiz-1",
      status: "submitted",
    },
    {
      id: "foreign",
      userId: "student-2",
      quizId: "quiz-1",
      status: "submitted",
    },
  ];
  assert.equal(
    accessRoute(parseRoute("/student/results/attempt-1"), c).allow,
    true,
  );
  assert.equal(
    accessRoute(parseRoute("/student/results/foreign"), c).redirect,
    "notFound",
  );
  assert.equal(
    accessRoute(parseRoute("/student/quizzes/quiz-1"), c).allow,
    true,
  );
  c.identity.collegeId = "other";
  assert.equal(
    accessRoute(parseRoute("/student/quizzes/quiz-1"), c).redirect,
    "notFound",
  );
  const professor = { ...c, role: "professor", professorId: "prof-2" };
  assert.equal(
    accessRoute(parseRoute("/professor/submissions/attempt-1"), professor)
      .redirect,
    "notFound",
  );
  assert.equal(
    accessRoute(parseRoute("/professor/assessments/quiz-1/edit"), professor)
      .redirect,
    "notFound",
  );
  professor.professorId = "prof-1";
  assert.equal(
    accessRoute(parseRoute("/professor/submissions/attempt-1"), professor)
      .allow,
    true,
  );
});
test("active attempts resume and submitted attempts use result URLs", () => {
  const c = structuredClone(student);
  c.db.attempts = [
    {
      id: "attempt-1",
      userId: "student-1",
      quizId: "quiz-1",
      status: "active",
    },
  ];
  assert.deepEqual(accessRoute(parseRoute("/student/profile"), c), {
    redirect: "exam",
    id: "attempt-1",
  });
  assert.equal(
    accessRoute(parseRoute("/student/attempts/attempt-1"), c).allow,
    true,
  );
  c.db.attempts[0].status = "submitted";
  assert.deepEqual(accessRoute(parseRoute("/student/attempts/attempt-1"), c), {
    redirect: "result",
    id: "attempt-1",
  });
});
