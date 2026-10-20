// Local-only database workload. No hosted endpoint, credentials, or real records.
import { performance } from "node:perf_hooks";
import assert from "node:assert/strict";
import { testDatabase, request } from "./test-database.mjs";
import { seedData } from "../src/data.js";
const argument = process.argv.find((a) => a.startsWith("--students="));
const students = Number(argument?.split("=")[1] || 50);
if (!Number.isInteger(students) || students < 1 || students > 500)
  throw new Error("Use --students=1 through 500.");
const pg = await testDatabase();
const id = (i) => "00000000-0000-4000-8000-" + String(i).padStart(12, "0");
const durations = [];
let requests = 0;
async function timed(user, op, payload) {
  const t = performance.now();
  const data = await request(pg, user, op, payload);
  durations.push(performance.now() - t);
  requests++;
  return data;
}
try {
  await pg.exec(
    `insert into exam_private.colleges(id,name,domains) values('bmu','BMU',array['bmu.edu.in']);`,
  );
  for (let i = 1; i <= students + 2; i++)
    await pg.query(
      `insert into auth.users values($1,$2,now(),'{"providers":["google"]}',jsonb_build_object('full_name',$3::text))`,
      [
        id(i),
        i === 1
          ? "admin@gmail.com"
          : i === 2
            ? "prof@bmu.edu.in"
            : `student${i}@bmu.edu.in`,
        "Test " + i,
      ],
    );
  await pg.exec(
    "insert into exam_private.admin_emails values('admin@gmail.com');",
  );
  await request(pg, id(1), "workspace");
  let w = await request(pg, id(1), "professor", {
    name: "Test Professor",
    email: "prof@bmu.edu.in",
    collegeId: "bmu",
  });
  await request(pg, id(1), "approve", {
    id: w.professors[0].id,
    approved: true,
  });
  await request(pg, id(2), "workspace");
  const q = structuredClone(seedData().quizzes[0]);
  q.id = "load-quiz";
  q.professorId = id(2);
  q.published = false;
  q.joinMode = "code";
  q.release = true;
  q.opensAt = null;
  q.closesAt = null;
  q.duration = 240;
  q.perQuestionSeconds = 0;
  await request(pg, id(2), "saveQuiz", { quiz: q });
  await request(pg, id(2), "publish", { quizId: q.id, published: true });
  const start = performance.now();
  const sessions = await Promise.all(
    Array.from({ length: students }, async (_, i) => {
      const user = id(i + 3);
      await timed(user, "workspace");
      await timed(user, "profile", {
        name: "Student " + i,
        roll: "TEST" + i,
        className: q.className,
      });
      const result = await timed(user, "start", { quizId: q.id, code: q.code });
      return {
        user,
        attempt: result.attempts.find((a) => a.status === "active"),
      };
    }),
  );
  await Promise.all(
    sessions.map(async ({ user, attempt }) => {
      const answers = { [attempt.quiz.questions[0].id]: 0 };
      await timed(user, "save", {
        attemptId: attempt.id,
        answers,
        flagged: [],
        current: 0,
        revision: 1,
      });
      const result = await timed(user, "submit", { attemptId: attempt.id });
      assert.equal(result.attempts.length, 1);
      assert.equal(result.attempts[0].userId, user);
      assert.equal(result.attempts[0].status, "submitted");
    }),
  );
  const seconds = (performance.now() - start) / 1000;
  durations.sort((a, b) => a - b);
  const records = await pg.query(
    "select count(*)::int as n from exam_private.attempts where status='submitted'",
  );
  assert.equal(records.rows[0].n, students);
  console.log(
    JSON.stringify(
      {
        mode: "local PGlite serialized database queue; not hosted concurrency capacity",
        students,
        requests,
        submitted: students,
        elapsedSeconds: +seconds.toFixed(2),
        requestsPerSecond: +(requests / seconds).toFixed(1),
        requestLatencyP95Ms:
          +durations[Math.ceil(durations.length * 0.95) - 1].toFixed(1),
        identityIsolation: "passed",
      },
      null,
      2,
    ),
  );
} finally {
  await pg.close();
}
