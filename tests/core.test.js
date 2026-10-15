import test from "node:test";
import assert from "node:assert/strict";
import {
  createAttempt,
  submitAttempt,
  gradeAttempt,
  remainingSeconds,
  eligibleEmail,
  answeredCount,
  validateQuiz,
  advanceAttempt,
  parseRoster,
} from "../src/core.js";
import { seedData } from "../src/data.js";
const quiz = seedData().quizzes[0];
test("timed questions do not reset when a tab returns late", () => {
  const timed = { ...quiz, perQuestionSeconds: 30 };
  let a = createAttempt(timed, { email: "test@bmu.edu.in" }, 0, "timed");
  a = advanceAttempt(a, 65000);
  assert.equal(a.current, 2);
  assert.equal(a.questionDeadline, 90000);
  a = advanceAttempt(a, 301000);
  assert.equal(a.status, "submitted");
  assert.equal(a.reason, "timeout");
});
test("roster parser rejects duplicate identities and malformed rows", () => {
  assert.deepEqual(parseRoster("email,roll\nstudent@bmu.edu.in,001"), [
    { email: "student@bmu.edu.in", roll: "001" },
  ]);
  assert.throws(
    () => parseRoster("student@bmu.edu.in,001\nstudent@bmu.edu.in,002"),
    /unique/,
  );
  assert.throws(() => parseRoster("not-an-email,001"), /unique/);
});
test("college eligibility requires exact email domain and rejects lookalikes", () => {
  const college = seedData().colleges[0];
  assert.equal(eligibleEmail("student@BMU.edu.in", college), true);
  assert.equal(eligibleEmail("student@evilbmu.edu.in", college), false);
  assert.equal(eligibleEmail("student@bmu.edu.in.evil.com", college), false);
  assert.equal(eligibleEmail("student@gmail.com", college), false);
  assert.equal(eligibleEmail("invalid", college), false);
});
test("zero-index option scores correctly and blank answers receive no penalty", () => {
  const custom = {
    ...quiz,
    marks: 2,
    penalty: 0.5,
    questions: [
      { id: "a", correctOption: 0 },
      { id: "b", correctOption: 1 },
      { id: "c", correctOption: 2 },
    ],
  };
  assert.deepEqual(gradeAttempt(custom, { a: 0, b: 0 }), {
    correct: 1,
    incorrect: 1,
    unanswered: 1,
    maximum: 6,
    score: 1.5,
    percent: 25,
    pendingManual: 0,
  });
});
test("deadline uses elapsed wall time, not a resetting interval", () => {
  const attempt = createAttempt(
    quiz,
    { email: "test@bmu.edu.in" },
    1000,
    "test-id",
  );
  assert.equal(remainingSeconds(attempt, 1000), 600);
  assert.equal(remainingSeconds(attempt, 601000), 0);
  assert.equal(remainingSeconds(attempt, 700000), 0);
});
test("attempt snapshots keep grading stable after professor edits", () => {
  const editable = structuredClone(quiz),
    attempt = createAttempt(
      editable,
      { email: "test@bmu.edu.in" },
      0,
      "stable",
    );
  editable.questions[0].correctOption = 3;
  assert.equal(attempt.quiz.questions[0].correctOption, 1);
});
test("submission is idempotent and counts only saved answers", () => {
  const attempt = createAttempt(quiz, { email: "test@bmu.edu.in" }, 0, "once");
  attempt.answers["web-1"] = 1;
  assert.equal(answeredCount(attempt), 1);
  const result = submitAttempt(attempt, "timeout", 600000);
  assert.equal(result.result.score, 1);
  assert.equal(result.reason, "timeout");
  assert.strictEqual(submitAttempt(result, "student", 800000), result);
});
test("quiz validation rejects missing content and impossible scoring settings", () => {
  assert.equal(validateQuiz(quiz), "");
  assert.match(validateQuiz({ ...quiz, duration: 0 }), /Duration/);
  assert.match(validateQuiz({ ...quiz, penalty: 2 }), /Penalty/);
  assert.match(validateQuiz({ ...quiz, questions: [] }), /questions/);
});
