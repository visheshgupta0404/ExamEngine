import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { seedData } from "../src/data.js";
import { restoreSQL } from "../tools/restore.mjs";
import { testDatabase } from "../tools/test-database.mjs";

test("production PostgreSQL migration and authorization workflows", async (t) => {
  const pg = await PGlite.create();
  const users = {
    admin: "00000000-0000-4000-8000-000000000001",
    professor: "00000000-0000-4000-8000-000000000002",
    student: "00000000-0000-4000-8000-000000000003",
    other: "00000000-0000-4000-8000-000000000004",
    second: "00000000-0000-4000-8000-000000000005",
    gmail: "00000000-0000-4000-8000-000000000006",
  };
  try {
    await pg.exec(`create role anon; create role authenticated;
      create schema auth;
      create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_app_meta_data jsonb,raw_user_meta_data jsonb);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
    await pg.exec(
      await readFile("backend/migrations/001_examengine.sql", "utf8"),
    );
    await pg.exec(
      `create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant insert,select on storage.objects to authenticated;`,
    );
    await pg.exec(
      await readFile("backend/migrations/002_question_images.sql", "utf8"),
    );
    await pg.exec(
      await readFile("backend/migrations/003_maintenance.sql", "utf8"),
    );
    await pg.exec(
      await readFile("backend/migrations/004_assessment_integrity.sql", "utf8"),
    );
    for (const [name, id] of Object.entries(users)) {
      const email = {
        admin: "admin@gmail.com",
        professor: "prof@bmu.edu.in",
        student: "student@bmu.edu.in",
        other: "other@second.edu",
        second: "second@bmu.edu.in",
        gmail: "outsider@gmail.com",
      }[name];
      await pg.query(
        `insert into auth.users values($1,$2,now(),'{}'::jsonb || jsonb_build_object('providers',jsonb_build_array('google')),jsonb_build_object('full_name',$3::text))`,
        [id, email, name],
      );
    }
    await pg.exec(
      `insert into exam_private.colleges(id,name,domains) values('bmu','BMU',array['bmu.edu.in']),('second','Second',array['second.edu']); insert into exam_private.admin_emails values('admin@gmail.com');`,
    );
    async function as(name) {
      await pg.exec("reset role");
      await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [
        users[name],
      ]);
      await pg.exec("set role authenticated");
    }
    async function rpc(operation, payload = {}) {
      const { rows } = await pg.query(
        "select public.examengine($1,$2::jsonb) as data",
        [operation, JSON.stringify(payload)],
      );
      const data = rows[0].data;
      if (data.error) throw new Error(data.error);
      return data;
    }
    let quiz = structuredClone(seedData().quizzes[0]),
      attemptId;
    quiz.id = "test-quiz";
    quiz.release = false;
    quiz.attemptLimit = 1;
    quiz.className = "CSE";
    quiz.joinMode = "both";
    quiz.allowNavigation = true;
    quiz.shuffle = false;
    quiz.perQuestionSeconds = 0;
    await t.test(
      "anonymous access and direct answer-key access are denied",
      async () => {
        await pg.exec("set role anon");
        await assert.rejects(rpc("workspace"), /permission denied/);
        await pg.exec("reset role");
        await as("student");
        await assert.rejects(
          pg.query("select * from exam_private.versions"),
          /permission denied/,
        );
      },
    );
    await t.test("unregistered personal Gmail cannot self-enroll", async () => {
      await as("gmail");
      await assert.rejects(rpc("workspace"), /domain/);
    });
    await t.test(
      "admin approves a professor and students cannot grant privileges",
      async () => {
        await as("student");
        await assert.rejects(
          rpc("professor", {
            name: "Attacker",
            email: "attacker@bmu.edu.in",
            collegeId: "bmu",
          }),
          /Administrator/,
        );
        await as("admin");
        let w = await rpc("professor", {
          name: "Professor",
          email: "prof@bmu.edu.in",
          collegeId: "bmu",
        });
        await as("professor");
        await assert.rejects(rpc("workspace"), /pending/);
        await as("admin");
        await rpc("approve", { id: w.professors[0].id, approved: true });
        await as("professor");
        await rpc("saveQuiz", { quiz });
        await rpc("publish", { quizId: quiz.id, published: true });
      },
    );
    await t.test(
      "server uses verified email and strips answer keys from student payloads",
      async () => {
        await as("student");
        let w = await rpc("profile", {
          name: "Student",
          roll: "001",
          className: "CSE",
          email: "admin@gmail.com",
          role: "admin",
        });
        assert.equal(w.identity.email, "student@bmu.edu.in");
        assert.equal(w.role, "student");
        assert.equal(w.quizzes[0].questions.length, 0);
        assert.equal(w.quizzes[0].questionCount, quiz.questions.length);
        assert.equal(
          JSON.stringify(w.quizzes).includes(quiz.questions[0].text),
          false,
        );
        w = await rpc("start", { quizId: quiz.id });
        attemptId = w.attempts[0].id;
        assert.equal(
          w.attempts[0].quiz.questions.length,
          quiz.questions.length,
        );
        assert.equal(w.attempts[0].userId, users.student);
        const metadata = await rpc("quiz", { quizId: quiz.id });
        assert.equal(metadata.questions.length, 0);
        assert.equal(metadata.questionCount, quiz.questions.length);
        const retry = await rpc("start", { quizId: quiz.id });
        assert.equal(retry.attempts.length, 1);
        assert.equal(retry.attempts[0].id, attemptId);
      },
    );
    await t.test(
      "foreign college and foreign student cannot read or change attempts",
      async () => {
        await as("other");
        const w = await rpc("profile", {
          name: "Other",
          roll: "001",
          className: "CSE",
        });
        assert.equal(w.quizzes.length, 0);
        assert.equal(w.attempts.length, 0);
        await assert.rejects(rpc("quiz", { quizId: quiz.id }), /unavailable/);
        await assert.rejects(rpc("start", { quizId: quiz.id }), /denied/);
        await assert.rejects(
          rpc("save", { attemptId, answers: {}, revision: 1 }),
          /denied/,
        );
        await as("second");
        await rpc("profile", { name: "Second", roll: "002", className: "CSE" });
        await assert.rejects(rpc("submit", { attemptId }), /denied/);
      },
    );
    await t.test(
      "deep-link metadata requires code or roster eligibility",
      async () => {
        await as("professor");
        const codeQuiz = {
          ...quiz,
          id: "route-code",
          code: "ROUTE-101",
          joinMode: "code",
        };
        await rpc("saveQuiz", { quiz: codeQuiz });
        await rpc("publish", { quizId: codeQuiz.id, published: true });
        const rosterQuiz = {
          ...quiz,
          id: "route-roster",
          code: "ROUTE-102",
          joinMode: "roster",
          roster: [{ email: "student@bmu.edu.in", roll: "001" }],
        };
        await rpc("saveQuiz", { quiz: rosterQuiz });
        await rpc("roster", { quizId: rosterQuiz.id, rows: rosterQuiz.roster });
        await rpc("publish", { quizId: rosterQuiz.id, published: true });
        await as("student");
        await assert.rejects(
          rpc("quiz", { quizId: codeQuiz.id }),
          /unavailable/,
        );
        const q = await rpc("quiz", {
          quizId: codeQuiz.id,
          code: codeQuiz.code,
        });
        assert.equal(q.id, codeQuiz.id);
        assert.equal(q.questions.length, 0);
        assert.equal(q.questionCount, quiz.questions.length);
        assert.equal(
          (await rpc("quiz", { quizId: rosterQuiz.id })).id,
          rosterQuiz.id,
        );
        await as("second");
        await assert.rejects(
          rpc("quiz", { quizId: rosterQuiz.id }),
          /unavailable/,
        );
      },
    );
    await t.test(
      "invalid/stale responses are rejected or ignored and client scores are not trusted",
      async () => {
        await as("student");
        await assert.rejects(
          rpc("save", { attemptId, answers: { "web-1": 999 }, revision: 1 }),
          /Invalid/,
        );
        await assert.rejects(
          rpc("save", { attemptId, answers: { unknown: 0 }, revision: 1 }),
          /Unknown/,
        );
        let a = await rpc("save", {
          attemptId,
          answers: { "web-1": 1 },
          revision: 2,
          current: 1,
          flagged: ["web-1"],
          score: 999,
        });
        assert.equal(a.answers["web-1"], 1);
        a = await rpc("save", {
          attemptId,
          answers: { "web-1": 0 },
          revision: 1,
          current: 0,
        });
        assert.equal(a.answers["web-1"], 1);
        assert.equal(a.quiz.questions[0].correctOption, undefined);
      },
    );
    await t.test(
      "professor edits do not alter active attempt grading",
      async () => {
        await as("professor");
        quiz.questions[0].correctOption = 0;
        await rpc("saveQuiz", { quiz });
        await as("student");
        let w = await rpc("submit", { attemptId, score: 999 });
        assert.equal(w.attempts[0].result, null);
        const retry = await rpc("submit", { attemptId });
        assert.equal(retry.attempts.length, 1);
        await assert.rejects(rpc("start", { quizId: quiz.id }), /No attempts/);
        await as("professor");
        w = await rpc("workspace");
        assert.equal(w.attempts[0].result.score, 1);
        quiz.release = true;
        await rpc("saveQuiz", { quiz });
        await as("student");
        w = await rpc("workspace");
        assert.equal(w.attempts[0].result.score, 1);
        assert.equal(w.attempts[0].quiz.questions[0].correctOption, 1);
      },
    );
    await t.test(
      "expired attempts finalize on server access and cannot accept late answers",
      async () => {
        await as("second");
        let w = await rpc("start", { quizId: quiz.id });
        const aid = w.attempts[0].id;
        await pg.exec("reset role");
        await pg.query(
          "update exam_private.attempts set deadline=now()-interval '1 second' where id=$1",
          [aid],
        );
        await as("second");
        w = await rpc("save", {
          attemptId: aid,
          answers: { "web-1": 0 },
          revision: 1,
        });
        assert.equal(w.attempts[0].status, "submitted");
        assert.equal(w.attempts[0].reason, "timeout");
        assert.equal(w.attempts[0].result.score, 0);
      },
    );
    await t.test(
      "admin domain changes are validated and non-admins cannot edit them",
      async () => {
        await as("student");
        await assert.rejects(
          rpc("college", { name: "Bad", domains: ["evil.edu"] }),
          /Administrator/,
        );
        await as("admin");
        await rpc("college", {
          id: "third",
          name: "Third",
          domains: ["third.edu"],
        });
        await assert.rejects(
          rpc("college", {
            id: "duplicate",
            name: "Duplicate",
            domains: ["bmu.edu.in"],
          }),
          /belongs/,
        );
        await assert.rejects(
          rpc("college", { name: "Invalid", domains: ["bmu.edu.in.evil/"] }),
          /Invalid/,
        );
      },
    );
    await t.test(
      "rosters, multiple select, and manual grading are enforced",
      async () => {
        await as("professor");
        const mixed = {
          ...quiz,
          id: "mixed",
          code: "MIX-101",
          joinMode: "roster",
          release: true,
          questions: [
            {
              id: "multi",
              type: "multiple",
              text: "Select both prime numbers",
              options: ["2", "3", "4", "6"],
              correctOptions: [0, 1],
            },
            {
              id: "essay",
              type: "written",
              text: "Explain your reasoning",
              options: [],
              rubric: "A clear explanation",
            },
          ],
        };
        await rpc("saveQuiz", { quiz: mixed });
        await assert.rejects(
          rpc("publish", { quizId: mixed.id, published: true }),
          /roster/,
        );
        await rpc("roster", {
          quizId: mixed.id,
          rows: [{ email: "student@bmu.edu.in", roll: "001" }],
        });
        await rpc("publish", { quizId: mixed.id, published: true });
        await as("second");
        await assert.rejects(rpc("start", { quizId: mixed.id }), /eligibility/);
        await as("student");
        let w = await rpc("start", { quizId: mixed.id });
        let a = w.attempts.find((a) => a.status === "active");
        assert.equal(a.quiz.roster, undefined);
        assert.equal(a.quiz.questions[1].rubric, undefined);
        await rpc("save", {
          attemptId: a.id,
          answers: {
            multi: [1, 0],
            essay: "Both are divisible only by themselves and one.",
          },
          revision: 1,
          current: 1,
        });
        w = await rpc("submit", { attemptId: a.id });
        assert.equal(w.attempts.find((x) => x.id === a.id).result, null);
        await as("professor");
        w = await rpc("workspace");
        assert.equal(
          w.attempts.find((x) => x.id === a.id).result.pendingManual,
          1,
        );
        await assert.rejects(
          rpc("manualGrade", {
            quizId: mixed.id,
            attemptId: a.id,
            grades: { essay: { marks: 5 } },
          }),
          /Invalid manual/,
        );
        await rpc("manualGrade", {
          quizId: mixed.id,
          attemptId: a.id,
          grades: { essay: { marks: 0.5, feedback: "Clear but brief." } },
        });
        await as("student");
        w = await rpc("workspace");
        assert.equal(w.attempts.find((x) => x.id === a.id).result.score, 1.5);
        assert.equal(
          w.attempts.find((x) => x.id === a.id).manualGrades.essay.feedback,
          "Clear but brief.",
        );
      },
    );
    await t.test(
      "scheduled and forward-only assessments reject early access and previous-answer changes",
      async () => {
        await as("professor");
        const timed = {
          ...quiz,
          id: "timed",
          code: "TIME-101",
          perQuestionSeconds: 30,
          allowNavigation: false,
          opensAt: new Date(Date.now() + 3600000).toISOString(),
        };
        await rpc("saveQuiz", { quiz: timed });
        await rpc("publish", { quizId: timed.id, published: true });
        await as("student");
        await assert.rejects(rpc("start", { quizId: timed.id }), /not opened/);
        await as("professor");
        timed.opensAt = null;
        await rpc("saveQuiz", { quiz: timed });
        await as("student");
        let w = await rpc("start", { quizId: timed.id });
        let a = w.attempts.find((x) => x.status === "active");
        await rpc("save", {
          attemptId: a.id,
          answers: { "web-1": 0 },
          current: 0,
          revision: 1,
        });
        a = await rpc("advance", { attemptId: a.id, current: 0 });
        assert.equal(a.current, 1);
        a = await rpc("advance", { attemptId: a.id, current: 0 });
        assert.equal(a.current, 1);
        await assert.rejects(
          rpc("save", {
            attemptId: a.id,
            answers: { "web-1": 1 },
            current: 1,
            revision: 3,
          }),
          /forward-only/,
        );
        await pg.exec("reset role");
        await pg.query(
          "update exam_private.attempts set question_deadline=now()-interval '1 second' where id=$1",
          [a.id],
        );
        await as("student");
        await assert.rejects(
          rpc("save", {
            attemptId: a.id,
            answers: { "web-1": 0, "web-2": 2 },
            current: 1,
            revision: 3,
          }),
          /expired/,
        );
        await rpc("submit", { attemptId: a.id });
      },
    );
    await t.test(
      "failed join attempts remain counted for rate limiting",
      async () => {
        await as("student");
        for (let i = 0; i < 61; i++) {
          try {
            await rpc("join", { code: "NOT-A-CODE" });
          } catch {}
        }
        await assert.rejects(rpc("join", { code: "NOT-A-CODE" }), /Too many/);
      },
    );
    await t.test(
      "image storage permits only approved professor uploads and blocks unrelated students",
      async () => {
        await as("professor");
        await pg.query(
          "insert into storage.objects(bucket_id,name) values('question-images',$1)",
          [users.professor + "/figure.png"],
        );
        await assert.rejects(
          pg.query(
            "insert into storage.objects(bucket_id,name) values('question-images',$1)",
            [users.student + "/fake.png"],
          ),
          /row-level security/,
        );
        await as("student");
        const { rows } = await pg.query(
          "select * from storage.objects where bucket_id='question-images'",
        );
        assert.equal(rows.length, 0);
        await assert.rejects(
          pg.query(
            "insert into storage.objects(bucket_id,name) values('question-images','student/figure.png')",
          ),
          /row-level security/,
        );
      },
    );
    await t.test(
      "private images follow attempt eligibility and result release",
      async () => {
        await as("professor");
        const imageQuiz = {
          ...quiz,
          id: "images",
          code: "IMG-101",
          release: false,
          questions: [
            {
              ...quiz.questions[0],
              imagePath: users.professor + "/figure.png",
              image: "",
            },
          ],
        };
        await rpc("saveQuiz", { quiz: imageQuiz });
        await rpc("publish", { quizId: imageQuiz.id, published: true });
        await as("student");
        let w = await rpc("start", { quizId: imageQuiz.id });
        const a = w.attempts.find((x) => x.status === "active");
        let response = await pg.query("select * from storage.objects");
        assert.equal(response.rows.length, 1);
        await as("other");
        response = await pg.query("select * from storage.objects");
        assert.equal(response.rows.length, 0);
        await as("student");
        await rpc("submit", { attemptId: a.id });
        response = await pg.query("select * from storage.objects");
        assert.equal(response.rows.length, 0);
        await as("professor");
        imageQuiz.release = true;
        await rpc("saveQuiz", { quiz: imageQuiz });
        await as("student");
        response = await pg.query("select * from storage.objects");
        assert.equal(response.rows.length, 1);
      },
    );
    await t.test(
      "server rejects malformed quiz arrays and fractional question timers",
      async () => {
        await as("professor");
        const malformed = { ...quiz, id: "bad-input", questions: undefined };
        await assert.rejects(rpc("saveQuiz", { quiz: malformed }), /questions/);
        await assert.rejects(
          rpc("saveQuiz", { quiz: { ...quiz, perQuestionSeconds: 1.5 } }),
          /rules/,
        );
        await assert.rejects(
          rpc("saveQuiz", {
            quiz: {
              ...quiz,
              questions: [
                {
                  id: "missing-answers",
                  type: "multiple",
                  text: "Choose",
                  options: ["A", "B"],
                },
              ],
            },
          }),
          /correct answers/,
        );
      },
    );
    await t.test(
      "whitespace-only written responses count as unanswered without pending grading",
      async () => {
        await as("professor");
        const written = {
          ...quiz,
          id: "blank-written",
          code: "BLANK-101",
          release: true,
          questions: [{ id: "essay", type: "written", text: "Explain." }],
        };
        await rpc("saveQuiz", { quiz: written });
        await rpc("publish", { quizId: written.id, published: true });
        await as("student");
        let w = await rpc("start", { quizId: written.id });
        const a = w.attempts.find((x) => x.quizId === written.id);
        await rpc("save", {
          attemptId: a.id,
          answers: { essay: " \n\t " },
          flagged: [],
          current: 0,
          revision: 1,
        });
        w = await rpc("submit", { attemptId: a.id });
        const result = w.attempts.find((x) => x.id === a.id).result;
        assert.equal(result.unanswered, 1);
        assert.equal(result.pendingManual, 0);
        assert.equal(result.score, 0);
      },
    );
    await t.test(
      "integrity upgrade preserves populated attempt records",
      async () => {
        await pg.exec("reset role");
        const before = await pg.query(
          "select jsonb_agg(to_jsonb(a) order by id) as records from exam_private.attempts a",
        );
        await pg.exec(
          await readFile(
            "backend/migrations/004_assessment_integrity.sql",
            "utf8",
          ),
        );
        const after = await pg.query(
          "select jsonb_agg(to_jsonb(a) order by id) as records from exam_private.attempts a",
        );
        assert.deepEqual(after.rows, before.rows);
      },
    );
    await t.test(
      "backup access is admin-only and application records restore into an empty database",
      async () => {
        await as("student");
        await assert.rejects(rpc("backup"), /Administrator/);
        await as("admin");
        const backup = await rpc("backup");
        assert.ok(backup.attempts.length > 0);
        await pg.exec("reset role");
        const fresh = await testDatabase();
        try {
          const auth = await pg.query(
            "select to_jsonb(u) as data from auth.users u",
          );
          for (const { data } of auth.rows)
            await fresh.query(
              "insert into auth.users select * from jsonb_populate_record(null::auth.users,$1::jsonb)",
              [JSON.stringify(data)],
            );
          await fresh.exec(restoreSQL(backup));
          const sorted = (rows) =>
            rows.map((row) => JSON.stringify(row)).sort();
          for (const table of [
            "colleges",
            "admin_emails",
            "professor_access",
            "profiles",
            "quizzes",
            "versions",
            "rosters",
            "attempts",
          ]) {
            const restored = await fresh.query(
              `select to_jsonb(t) as data from exam_private.${table} t`,
            );
            assert.deepEqual(
              sorted(restored.rows.map((row) => row.data)),
              sorted(backup[table]),
              table + " must restore exactly",
            );
          }
        } finally {
          await fresh.close();
        }
        await pg.exec(
          "truncate exam_private.attempts,exam_private.rosters,exam_private.versions,exam_private.quizzes cascade;",
        );
        await pg.exec(restoreSQL(backup));
        await as("student");
        const w = await rpc("workspace");
        assert.equal(
          w.attempts.length,
          backup.attempts.filter((a) => a.user_id === users.student).length,
        );
        await pg.exec("reset role");
        await assert.rejects(pg.exec(restoreSQL(backup)), /empty assessment/);
        await pg.exec("rollback");
      },
    );
    await t.test("revocation takes effect on the next request", async () => {
      await as("admin");
      const w = await rpc("workspace");
      await rpc("approve", { id: w.professors[0].id, approved: false });
      await as("professor");
      await assert.rejects(rpc("workspace"), /pending/);
    });
  } finally {
    await pg.close();
  }
});
