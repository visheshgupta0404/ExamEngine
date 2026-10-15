export function remainingSeconds(attempt, now = Date.now()) {
  return Math.max(0, Math.ceil((attempt.deadline - now) / 1000));
}
export function formatTime(seconds) {
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}
export function emailDomain(email) {
  const match = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/.exec(email.trim());
  return match ? match[1].toLowerCase() : "";
}
export function eligibleEmail(email, college) {
  return college.domains.some(
    (domain) => domain.toLowerCase() === emailDomain(email),
  );
}
export function isAnswered(answer) {
  return (
    Number.isInteger(answer) ||
    (Array.isArray(answer) && answer.length > 0) ||
    (typeof answer === "string" && answer.trim().length > 0)
  );
}
export function isCorrect(question, answer) {
  return question.type === "multiple"
    ? Array.isArray(answer) &&
        answer.length === question.correctOptions.length &&
        [...new Set(answer)].length === answer.length &&
        answer.every((n) => question.correctOptions.includes(n))
    : answer === question.correctOption;
}
export function gradeAttempt(quiz, answers, manualGrades = {}) {
  let correct = 0,
    incorrect = 0,
    unanswered = 0,
    pendingManual = 0,
    writtenScore = 0;
  for (const question of quiz.questions) {
    const answer = answers[question.id];
    if (!isAnswered(answer)) unanswered++;
    else if (question.type === "written") {
      if (manualGrades[question.id])
        writtenScore += Number(manualGrades[question.id].marks);
      else pendingManual++;
    } else if (isCorrect(question, answer)) correct++;
    else incorrect++;
  }
  const maximum = quiz.questions.length * quiz.marks,
    score = correct * quiz.marks - incorrect * quiz.penalty + writtenScore;
  return {
    correct,
    incorrect,
    unanswered,
    maximum,
    score,
    percent: maximum ? Math.round((score / maximum) * 100) : 0,
    pendingManual,
  };
}
export function createAttempt(
  quiz,
  identity,
  now = Date.now(),
  id = crypto.randomUUID(),
) {
  const snapshot = structuredClone(quiz);
  if (quiz.shuffle)
    for (let i = snapshot.questions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [snapshot.questions[i], snapshot.questions[j]] = [
        snapshot.questions[j],
        snapshot.questions[i],
      ];
    }
  const deadline = Math.min(
    now + quiz.duration * 60000,
    quiz.closesAt ? new Date(quiz.closesAt).getTime() : Infinity,
  );
  return {
    id,
    quizId: quiz.id,
    quiz: snapshot,
    identity: structuredClone(identity),
    startedAt: now,
    deadline,
    questionDeadline: quiz.perQuestionSeconds
      ? Math.min(deadline, now + quiz.perQuestionSeconds * 1000)
      : null,
    answers: {},
    flagged: [],
    current: 0,
    revision: 0,
    manualGrades: {},
    status: "active",
  };
}
export function submitAttempt(attempt, reason = "student", now = Date.now()) {
  if (attempt.status !== "active") return attempt;
  return {
    ...attempt,
    status: "submitted",
    submittedAt: now,
    reason,
    result: gradeAttempt(attempt.quiz, attempt.answers),
  };
}
export function advanceAttempt(attempt, now = Date.now()) {
  if (attempt.status !== "active") return attempt;
  if (attempt.deadline <= now) return submitAttempt(attempt, "timeout", now);
  const seconds = attempt.quiz.perQuestionSeconds || 0;
  const expired = seconds && attempt.questionDeadline <= now;
  const steps = expired
    ? Math.floor((now - attempt.questionDeadline) / (seconds * 1000)) + 1
    : 1;
  if (attempt.current + steps >= attempt.quiz.questions.length)
    return submitAttempt(attempt, expired ? "timeout" : "student", now);
  return {
    ...attempt,
    current: attempt.current + steps,
    questionDeadline: seconds
      ? Math.min(
          attempt.deadline,
          expired
            ? attempt.questionDeadline + steps * seconds * 1000
            : now + seconds * 1000,
        )
      : null,
  };
}
export function answeredCount(attempt) {
  return attempt.quiz.questions.filter((q) => isAnswered(attempt.answers[q.id]))
    .length;
}
export function validateQuiz(quiz) {
  if (!quiz.title.trim()) return "Enter a quiz title.";
  if (!quiz.className.trim()) return "Enter the assigned class.";
  if (!/^[A-Z0-9-]{4,20}$/.test(quiz.code))
    return "Use a 4–20 character quiz code with letters, numbers, or hyphens.";
  if (
    !Number.isInteger(quiz.duration) ||
    quiz.duration < 1 ||
    quiz.duration > 240
  )
    return "Duration must be 1–240 minutes.";
  if (!Number.isFinite(quiz.marks) || quiz.marks <= 0 || quiz.marks > 100)
    return "Marks must be greater than zero and at most 100.";
  if (
    !Number.isFinite(quiz.penalty) ||
    quiz.penalty < 0 ||
    quiz.penalty > quiz.marks
  )
    return "Penalty must be between zero and marks per question.";
  if (
    !Number.isInteger(quiz.attemptLimit) ||
    quiz.attemptLimit < 1 ||
    quiz.attemptLimit > 10
  )
    return "Attempts must be 1–10.";
  if (!quiz.questions.length || quiz.questions.length > 100)
    return "Add between 1 and 100 questions.";
  if (
    quiz.opensAt &&
    quiz.closesAt &&
    new Date(quiz.opensAt) >= new Date(quiz.closesAt)
  )
    return "Closing time must follow opening time.";
  if (
    !Number.isInteger(quiz.perQuestionSeconds ?? 0) ||
    (quiz.perQuestionSeconds ?? 0) < 0 ||
    (quiz.perQuestionSeconds ?? 0) > 3600
  )
    return "Per-question time must be 0–3600 seconds.";
  const ids = new Set();
  for (let i = 0; i < quiz.questions.length; i++) {
    const q = quiz.questions[i];
    if (!q.id || ids.has(q.id)) return "Question IDs must be unique.";
    ids.add(q.id);
    if (!q.text.trim() || q.text.length > 4000)
      return `Complete question ${i + 1} (maximum 4000 characters).`;
    if (
      q.image &&
      !q.imagePath &&
      !(q.localImage && /^data:image\/(png|jpeg|webp);base64,/.test(q.image)) &&
      !/^https:\/\//i.test(q.image)
    )
      return `Question ${i + 1} needs an HTTPS image URL.`;
    if (q.type === "written") continue;
    if (
      q.options.length < 2 ||
      q.options.length > 6 ||
      q.options.some((o) => !o.trim() || o.length > 1000)
    )
      return `Complete question ${i + 1} and its options.`;
    if (q.type === "multiple") {
      if (
        !q.correctOptions?.length ||
        new Set(q.correctOptions).size !== q.correctOptions.length ||
        q.correctOptions.some(
          (n) => !Number.isInteger(n) || n < 0 || n >= q.options.length,
        )
      )
        return `Select correct answers for question ${i + 1}.`;
    } else if (
      !Number.isInteger(q.correctOption) ||
      q.correctOption < 0 ||
      q.correctOption >= q.options.length
    )
      return `Select the correct answer for question ${i + 1}.`;
  }
  return "";
}
export function parseRoster(text) {
  const rows = text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => line.split(",").map((s) => s.trim()));
  if (rows[0]?.[0]?.toLowerCase() === "email") rows.shift();
  if (rows.length > 2000) throw new Error("Import at most 2000 students.");
  const seen = new Set();
  return rows.map(([email, roll = "", ...extra]) => {
    email = email.toLowerCase();
    if (
      !emailDomain(email) ||
      extra.length ||
      roll.length > 50 ||
      seen.has(email)
    )
      throw new Error("Use unique email,roll rows with no extra columns.");
    seen.add(email);
    return { email, roll };
  });
}
