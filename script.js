import { loadStore, saveStore } from "./src/store.js";
import {
  createAttempt,
  submitAttempt,
  gradeAttempt,
  answeredCount,
  remainingSeconds,
  formatTime,
  eligibleEmail,
  validateQuiz,
  isAnswered,
  isCorrect,
  parseRoster,
  advanceAttempt,
} from "./src/core.js";
import {
  preview as localPreview,
  configured,
  client,
  run,
  uploadImage,
  resolveImages,
} from "./src/service.js";
import katex from "katex";
import {
  parseRoute,
  routePath,
  defaultPath,
  accessRoute,
  safeReturnPath,
  ownAttempt,
} from "./src/routes.js";
const basePath = globalThis.EXAMENGINE_CONFIG?.basePath || "/";
const publicViews = new Set([
  "privacy",
  "signin",
  "callback",
  "forbidden",
  "notFound",
]);
let routeEpoch = 0;

const app = document.querySelector("#app");
let db = localPreview ? loadStore() : null,
  role = "student",
  professorId = "prof-demo",
  view = "dashboard";
let selectedQuizId = null,
  selectedAttemptId = null,
  editor = null,
  joinedCode = "",
  submissionFilter = "",
  busy = false,
  finishing = false,
  clockOffset = 0;
let storageOK = true,
  saveError = "",
  savePending = 0,
  saveChain = Promise.resolve(),
  toastTimer,
  answerTimer,
  lastDeadlineRequest = 0;
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const now = () => Date.now() + clockOffset;
const college = () =>
  db.colleges.find((c) => c.id === db.identity.collegeId) ||
  db.colleges[0] || { id: "", name: "Your college", domains: [] };
const professor = () =>
  localPreview
    ? db.professors.find((p) => p.id === professorId)
    : {
        id: db.actorId,
        name: db.identity.name,
        collegeId: db.identity.collegeId,
        status: "approved",
      };
const professorCollege = () =>
  db.colleges.find((c) => c.id === professor()?.collegeId) || college();
const quizById = (id) => db.quizzes.find((q) => q.id === id);
const activeAttempt = () =>
  role === "student"
    ? db?.attempts.find(
        (a) => a.status === "active" && ownAttempt(a, routingContext()),
      )
    : null;
const myAttempts = () =>
  db.attempts.filter((a) => ownAttempt(a, routingContext()));
const displayedAttempt = () =>
  db.attempts.find((a) => a.id === selectedAttemptId);
const fmtDate = (t) =>
  t
    ? new Date(t).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";
const navigable = (a) =>
  !a.quiz.perQuestionSeconds && a.quiz.allowNavigation !== false;
const image = (q) =>
  q.image &&
  (/^https:\/\//.test(q.image) ||
    (localPreview && /^data:image\/(png|jpeg|webp);base64,/.test(q.image)))
    ? `<img data-image-path="${escape(q.imagePath || "")}" class="question-image" src="${escape(q.image)}" alt="${escape(q.imageAlt || "Question illustration")}" loading="lazy" referrerpolicy="no-referrer">`
    : "";
function rich(text) {
  return String(text)
    .split(/(\$\$[\s\S]*?\$\$|\$[^$\n]+\$)/g)
    .map((part) =>
      part.startsWith("$") && part.endsWith("$")
        ? katex.renderToString(
            part.slice(
              part.startsWith("$$") ? 2 : 1,
              part.startsWith("$$") ? -2 : -1,
            ),
            {
              displayMode: part.startsWith("$$"),
              throwOnError: false,
              trust: false,
              strict: "ignore",
            },
          )
        : escape(part).replaceAll("\n", "<br>"),
    )
    .join("");
}
function toast(text) {
  const t = document.querySelector("#toast");
  t.textContent = text;
  t.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("visible"), 5000);
}
function persist() {
  if (localPreview) {
    storageOK = saveStore(db);
    if (!storageOK)
      toast("Browser storage is unavailable. Keep this tab open.");
  }
  return storageOK;
}
function applyWorkspace(data) {
  db = data;
  role = data.role || role;
  if (!localPreview) {
    professorId = data.actorId;
    clockOffset = data.serverNow ? data.serverNow - Date.now() : clockOffset;
  }
}
function applyResponse(data) {
  if (data.attempts) applyWorkspace(data);
  else {
    const index = db.attempts.findIndex((a) => a.id === data.id);
    if (index >= 0) db.attempts[index] = data;
  }
}
async function command(op, payload, localMutation) {
  if (localPreview) {
    localMutation?.();
    persist();
  } else applyWorkspace(await run(op, payload));
}
function go(next, id) {
  view = next;
  if (id) selectedQuizId = id;
  navigatePath(pathForView(), false);
  if (localPreview) render();
  else void readRoute();
  document.querySelector("main")?.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}
function routingContext() {
  return db
    ? {
        db,
        role,
        identity: db.identity,
        actorId: db.actorId,
        professorId,
        preview: localPreview,
      }
    : null;
}
function pathForView() {
  const id = ["instructions", "preview"].includes(view)
    ? selectedQuizId
    : view === "editor"
      ? editor?.id && quizById(editor.id)
        ? editor.id
        : null
      : ["result", "grading"].includes(view)
        ? selectedAttemptId
        : view === "exam"
          ? activeAttempt()?.id
          : null;
  return routePath(publicViews.has(view) ? null : role, view, id, basePath);
}
function navigatePath(path, replace = false) {
  if (location.pathname !== path || location.search || location.hash)
    window.history[replace ? "replaceState" : "pushState"]({}, "", path);
}
function showRouteError(kind) {
  view = kind;
  navigatePath(routePath(null, kind, null, basePath), true);
  renderPublic(kind);
}
function renderPublic(kind) {
  if (kind === "privacy") {
    renderGate(
      "Privacy information",
      "How ExamEngine handles assessment information.",
    );
    document.querySelector(".auth-page .panel").innerHTML =
      privacyContent() +
      '<button data-action="home">Back to workspace</button>';
    return;
  }
  if (kind === "forbidden" || kind === "notFound") {
    renderGate(
      kind === "forbidden" ? "Access denied" : "Page not available",
      kind === "forbidden"
        ? "Your account does not have permission to open this workspace."
        : "This page or record is unavailable to your account.",
    );
    document
      .querySelector(".auth-page .panel")
      .insertAdjacentHTML(
        "beforeend",
        '<button class="primary" data-action="home">Back to workspace</button>',
      );
    return;
  }
  renderGate(
    configured ? "Welcome to ExamEngine" : "Setup is not complete",
    configured
      ? "Sign in with your approved Google account."
      : "The administrator needs to connect the backend and Google sign-in before assessments can be taken.",
    configured,
  );
}
function joinCodeKey(id) {
  return "examengine.join." + (db.actorId || db.identity.email) + "." + id;
}
async function readRoute(verified = false) {
  const epoch = ++routeEpoch;
  let route = parseRoute(location.pathname, basePath);
  if (db && !localPreview && !verified && route.role) {
    const attempt = activeAttempt();
    if (attempt) {
      clearTimeout(answerTimer);
      queueSave(attempt);
      await saveChain;
    }
    if (epoch !== routeEpoch) return;
    renderGate("Opening your workspace", "Checking access…");
    try {
      const fresh = await run("workspace");
      if (epoch !== routeEpoch) return;
      applyWorkspace(fresh);
    } catch {
      if (epoch !== routeEpoch) return;
      db = null;
    }
  }
  if (!db) {
    if (route.role) {
      sessionStorage.setItem("examengine.returnTo", location.pathname);
      navigatePath(routePath(null, "signin", null, basePath), true);
      route = { view: "signin" };
    }
    if (route.view === "root" || route.view === "callback") {
      navigatePath(routePath(null, "signin", null, basePath), true);
      route = { view: "signin" };
    }
    view = route.view;
    renderPublic(view);
    return;
  }
  if (["root", "signin", "callback"].includes(route.view)) {
    const target = safeReturnPath(
      sessionStorage.getItem("examengine.returnTo"),
      role,
      basePath,
    );
    sessionStorage.removeItem("examengine.returnTo");
    navigatePath(target || defaultPath(role, basePath), true);
    route = parseRoute(location.pathname, basePath);
  }
  if (
    route.role === role &&
    role === "student" &&
    route.view === "instructions" &&
    !quizById(route.id) &&
    !localPreview
  ) {
    try {
      const q = await run("quiz", {
        quizId: route.id,
        code: sessionStorage.getItem(joinCodeKey(route.id)) || "",
      });
      if (epoch !== routeEpoch) return;
      db.quizzes.push(q);
    } catch {
      if (epoch === routeEpoch) showRouteError("notFound");
      return;
    }
  }
  let decision = accessRoute(route, routingContext());
  if (decision.redirect) {
    if (["forbidden", "notFound"].includes(decision.redirect)) {
      showRouteError(decision.redirect);
      return;
    }
    navigatePath(
      routePath(role, decision.redirect, decision.id || null, basePath),
      true,
    );
    route = parseRoute(location.pathname, basePath);
    decision = accessRoute(route, routingContext());
    if (!decision.allow) {
      showRouteError("notFound");
      return;
    }
  }
  view = route.view;
  if (["instructions", "preview"].includes(view)) selectedQuizId = route.id;
  if (["result", "grading"].includes(view)) selectedAttemptId = route.id;
  if (view === "instructions")
    joinedCode = sessionStorage.getItem(joinCodeKey(route.id)) || "";
  if (view === "editor")
    editor = route.id ? structuredClone(quizById(route.id)) : newQuiz();
  if (epoch !== routeEpoch) return;
  render();
  document.querySelector("main")?.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}
function icon(name) {
  const paths = {
    dashboard:
      '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    history: '<path d="M8 3h8l4 4v14H4V3h4Zm8 0v5h4M8 12h8M8 16h5"/>',
    profile:
      '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
    submissions: '<path d="M9 4H4v17h16V4h-5M9 3h6v4H9zM8 13l2 2 6-6"/>',
    professors:
      '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.9M15 3a4 4 0 0 1 0 8"/><circle cx="9" cy="7" r="4"/>',
    audit: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    book: '<path d="M12 5C8 2 4 3 2 4v15c4-2 7-1 10 1 3-2 6-3 10-1V4c-2-1-6-2-10 1Zm0 0v15"/>',
  };
  return `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.dashboard}</svg>`;
}
function heading(title, description, action = "") {
  return `<div class="page-heading"><div><p class="eyebrow">${escape(role === "student" ? college().name + " / Student workspace" : role === "professor" ? "Educator workspace" : "Platform management")}</p><h1>${escape(title)}</h1><p class="muted">${escape(description)}</p></div>${action}</div>`;
}
function stat(label, value) {
  return `<div class="stat${label === "Your class" ? " text-stat" : ""}"><span>${escape(label)}</span><strong>${escape(value)}</strong></div>`;
}
function empty(text) {
  return `<div class="empty">${escape(text)}</div>`;
}
function collegeOptions(id) {
  return db.colleges
    .filter((c) => c.enabled !== false)
    .map(
      (c) =>
        `<option value="${escape(c.id)}" ${c.id === id ? "selected" : ""}>${escape(c.name)}</option>`,
    )
    .join("");
}
function newQuestion() {
  return {
    id: crypto.randomUUID(),
    type: "single",
    text: "",
    options: ["", "", "", ""],
    correctOption: 0,
    correctOptions: [0],
    image: "",
    imageAlt: "",
    rubric: "",
  };
}
function newQuiz() {
  return {
    id: crypto.randomUUID(),
    title: "",
    subject: "",
    description: "",
    collegeId: professorCollege().id,
    professorId,
    code: "",
    className: "",
    duration: 20,
    marks: 1,
    penalty: 0,
    attemptLimit: 1,
    release: false,
    published: false,
    joinMode: "both",
    allowNavigation: true,
    perQuestionSeconds: 0,
    shuffle: false,
    opensAt: null,
    closesAt: null,
    questions: [newQuestion()],
    roster: [],
  };
}
function scheduleText(q) {
  if (q.opensAt && now() < Date.parse(q.opensAt))
    return "Opens " + fmtDate(q.opensAt);
  if (q.closesAt && now() >= Date.parse(q.closesAt)) return "Closed";
  return q.published ? "Available" : "Draft";
}
function quizCard(q, educator = false) {
  const used = myAttempts().filter(
    (a) => a.quizId === q.id && a.status === "submitted",
  ).length;
  return `<article class="quiz-card"><div class="assessment-symbol">${icon("book")}</div><div class="assessment-info"><div class="assessment-label"><span>${escape(q.subject || "General assessment")}</span><span class="badge ${q.published ? "green" : ""}">${escape(scheduleText(q))}</span></div><h3>${escape(q.title)}</h3>${q.description ? `<p class="muted">${escape(q.description)}</p>` : ""}<div class="quiz-meta"><span>${q.questions.length} ${q.questions.length === 1 ? "question" : "questions"}</span><span>${q.duration} minutes</span><span>${escape(q.className)}</span>${educator ? `<span class="quiz-code">${escape(q.code)}</span>` : ""}</div></div>${educator ? `<div class="actions"><button class="small" data-action="edit" data-id="${escape(q.id)}">Edit</button><button class="small ghost" data-action="preview" data-id="${escape(q.id)}">Preview</button><button class="small ghost" data-action="publish" data-id="${escape(q.id)}">${q.published ? "Unpublish" : "Publish"}</button></div>` : `<button class="${used >= q.attemptLimit ? "ghost" : "primary"}" data-action="open-quiz" data-id="${escape(q.id)}">${used >= q.attemptLimit ? "View submission" : "View assessment"} ${icon("arrow")}</button>`}</article>`;
}
function dashboard() {
  const quizzes = db.quizzes.filter(
    (q) =>
      q.published &&
      q.collegeId === college().id &&
      q.className.toLowerCase() === db.identity.className.toLowerCase() &&
      q.joinMode !== "code",
  );
  return (
    heading(
      "Your assessments",
      "A clear space to prepare, take your quizzes, and track your progress.",
      '<button class="ghost" data-action="profile">Student details</button>',
    ) +
    `<div class="stats">${stat("Assigned assessments", quizzes.length)}${stat("Completed attempts", myAttempts().filter((a) => a.status === "submitted").length)}${stat("Your class", db.identity.className || "Complete your details")}</div><div class="section-heading"><h2>Assigned to you</h2><span class="subtext">${escape(college().name)}</span></div><div class="quiz-list">${quizzes.map((q) => quizCard(q)).join("") || empty("No assessments assigned to this class yet. Complete your details or join with a quiz code.")}</div><div class="join-panel"><div><h3>Have a quiz code?</h3><p class="muted">Enter the code shared by your professor.${localPreview ? " Sample: WEB-101." : ""}</p></div><form id="join-form" class="inline-form"><label class="sr-only" for="quiz-code">Quiz code</label><input id="quiz-code" name="code" maxlength="20" placeholder="Enter quiz code" required><button>Join quiz</button></form></div>`
  );
}
function identityFields(identity, forcedCollege) {
  return `<div class="form-grid"><label>Full name<input name="name" value="${escape(identity.name)}" required maxlength="100" autocomplete="name"></label><label>Roll number / student ID<input name="roll" value="${escape(identity.roll)}" required maxlength="50"></label><label>College email<input name="email" type="email" value="${escape(identity.email)}" ${!localPreview ? "readonly" : ""} required maxlength="254" autocomplete="email"></label><label>College<select name="collegeId" ${forcedCollege || !localPreview ? "disabled" : ""}>${collegeOptions(forcedCollege || identity.collegeId)}</select></label><label class="full">Class / cohort<input name="className" value="${escape(identity.className)}" required maxlength="100"></label></div>`;
}
function profile() {
  return (
    heading(
      "Student details",
      "Your identity is attached to every submission.",
    ) +
    `<form id="profile-form" class="panel narrow">${identityFields(db.identity)}<p class="error" id="form-error" role="alert"></p><div class="actions"><button class="primary">Save details</button><button type="button" data-action="dashboard">Cancel</button></div><p class="subtext">${localPreview ? "Email ownership is not verified in this local preview." : "Your email and college are determined from your verified Google account."}</p></form>`
  );
}
function instructions() {
  const q = quizById(selectedQuizId);
  if (!q) return empty("Assessment unavailable.");
  return (
    heading(q.title, q.description) +
    `<section class="panel narrow"><h2>Before you begin</h2><dl class="rules"><div><dt>Questions</dt><dd>${q.questions.length} · ${q.questions.some((i) => i.type === "written") ? "includes written answers" : "objective assessment"}</dd></div><div><dt>Time limit</dt><dd>${q.duration} minutes${q.perQuestionSeconds ? " · " + q.perQuestionSeconds + " seconds per question" : ""}</dd></div><div><dt>Marking</dt><dd>${q.marks} per correct answer · ${q.penalty ? "−" + q.penalty + " per wrong answer" : "no negative marking"}</dd></div><div><dt>Attempts</dt><dd>${q.attemptLimit}</dd></div><div><dt>Navigation</dt><dd>${q.perQuestionSeconds || q.allowNavigation === false ? "Forward only; previous answers lock" : "Return to questions freely"}</dd></div><div><dt>Results</dt><dd>${q.release ? "After submission and any manual grading" : "Released by your professor"}</dd></div></dl><p class="muted">The timer continues when you leave or refresh. Saved answers are submitted when the deadline ends. Multiple-choice questions require all correct selections for full marks.</p>${q.closesAt ? `<p class="subtext">Closes ${escape(fmtDate(q.closesAt))}. Your deadline will not extend beyond closing time.</p>` : ""}</section><form id="start-form" class="panel narrow"><h2>Confirm your details</h2>${identityFields({ ...db.identity, className: db.identity.className || q.className }, q.collegeId)}<label class="check-label" style="margin-top:25px"><input type="checkbox" required name="ready">I have read the instructions and am ready.</label><p id="form-error" class="error" role="alert"></p><div class="actions"><button class="primary">Start assessment</button><button type="button" data-action="dashboard">Back</button></div></form>`
  );
}
function saveStatus() {
  return saveError
    ? "Changes not sent · " + saveError
    : savePending
      ? "Saving answers…"
      : localPreview
        ? storageOK
          ? "Saved in this browser"
          : "Storage unavailable — keep this tab open"
        : "All changes saved to the server";
}
function exam() {
  const a = activeAttempt();
  if (!a) return dashboard();
  const q = a.quiz.questions[a.current],
    answer = a.answers[q.id],
    count = answeredCount(a);
  return `<div class="exam-heading"><div><p class="eyebrow">${escape(a.quiz.subject || "Assessment")} / In progress</p><h1>${escape(a.quiz.title)}</h1><p class="subtext">${escape(a.identity.name)} · ${escape(a.identity.roll)}</p></div><div class="timer" role="timer" aria-label="Time remaining"><span>${a.questionDeadline ? "QUESTION TIME" : "TIME REMAINING"}</span><strong id="time-left">${formatTime(Math.max(0, Math.ceil(((a.questionDeadline || a.deadline) - now()) / 1000)))}</strong>${a.questionDeadline ? `<small>Exam: <span id="exam-time">${formatTime(remainingSeconds(a, now()))}</span></small>` : ""}</div></div><div class="exam-grid"><section class="panel question-panel"><div class="question-top"><span>Question ${a.current + 1} of ${a.quiz.questions.length}</span><span>${a.quiz.marks} ${a.quiz.marks === 1 ? "mark" : "marks"} · ${q.type === "multiple" ? "Select all that apply" : q.type === "written" ? "Written answer" : "Select one"}</span></div><fieldset><legend class="question-title" id="question-title">${rich(q.text)}</legend>${image(q)}${q.type === "written" ? `<label style="margin-top:25px">Your response<textarea id="written-answer" name="written" maxlength="10000" rows="9" placeholder="Write your answer…">${escape(answer || "")}</textarea></label><p class="subtext">Your professor will grade this response.</p>` : `<div class="options">${q.options.map((option, i) => `<label class="option ${(q.type === "multiple" ? answer?.includes(i) : answer === i) ? "selected" : ""}"><input type="${q.type === "multiple" ? "checkbox" : "radio"}" name="answer" value="${i}" ${(q.type === "multiple" ? answer?.includes(i) : answer === i) ? "checked" : ""}><span class="option-letter" aria-hidden="true">${String.fromCharCode(65 + i)}</span><span>${rich(option)}</span></label>`).join("")}</div>`}</fieldset><div class="question-footer"><div class="actions"><button class="ghost small" data-action="flag">${a.flagged.includes(q.id) ? "Marked for review" : "Mark for review"}</button><button class="ghost small" data-action="clear" ${!isAnswered(answer) ? "disabled" : ""}>Clear answer</button></div><div class="actions"><button data-action="previous" ${!navigable(a) || a.current === 0 ? "disabled" : ""}>Previous</button><button class="primary" data-action="next">${a.current === a.quiz.questions.length - 1 ? "Review & submit" : "Next question"}</button></div></div><p class="save-status" id="save-status" role="status">${escape(saveStatus())}</p><button id="retry-save" class="small" data-action="retry-save" ${saveError ? "" : "hidden"}>Retry save</button></section><aside class="panel navigator" aria-label="Question navigation"><h2>Your progress</h2><p class="subtext" id="answered-count">${count} of ${a.quiz.questions.length} answered</p><div class="progress"><span style="width:${(count / a.quiz.questions.length) * 100}%"></span></div><div class="palette">${a.quiz.questions.map((question, i) => `<button class="${isAnswered(a.answers[question.id]) ? "answered" : ""} ${a.flagged.includes(question.id) ? "flagged" : ""} ${i === a.current ? "current" : ""}" data-action="question" data-index="${i}" aria-label="Question ${i + 1}, ${isAnswered(a.answers[question.id]) ? "answered" : "unanswered"}${a.flagged.includes(question.id) ? ", marked for review" : ""}" ${!navigable(a) ? "disabled" : ""}>${i + 1}</button>`).join("")}</div><div class="legend"><span class="answered">Answered</span><span>Not answered</span><span class="flagged">For review</span></div><button class="primary" data-action="review-submit">Review & submit</button></aside></div><dialog id="submit-dialog" aria-labelledby="dialog-title"><h2 id="dialog-title">Submit your assessment?</h2><p class="muted">You cannot change responses after submission.</p><div class="dialog-counts"><div><strong>${count}</strong><span>Answered</span></div><div><strong>${a.quiz.questions.length - count}</strong><span>Unanswered</span></div><div><strong>${a.flagged.length}</strong><span>For review</span></div></div><div class="actions"><button class="primary" data-action="confirm-submit">Submit assessment</button><button data-action="close-dialog">Keep reviewing</button></div></dialog>`;
}
function answerText(q, answer) {
  return q.type === "written"
    ? answer || "Not answered"
    : Array.isArray(answer)
      ? answer.map((i) => q.options[i]).join("; ") || "Not answered"
      : (q.options[answer] ?? "Not answered");
}
function reviewRows(a, grading = false) {
  return a.quiz.questions
    .map(
      (q, i) =>
        `<div class="review-row"><h3>${i + 1}. ${rich(q.text)}</h3>${image(q)}<p class="${isCorrect(q, a.answers[q.id]) ? "correct-text" : "muted"}">Response: ${escape(answerText(q, a.answers[q.id]))}</p>${q.type === "written" ? (grading ? `<p class="subtext">Rubric: ${escape(q.rubric || "No rubric provided.")}</p><div class="form-grid"><label>Marks (0–${a.quiz.marks})<input type="number" name="grade-${escape(q.id)}" min="0" max="${a.quiz.marks}" step="0.1" value="${escape(a.manualGrades?.[q.id]?.marks ?? "")}" ${isAnswered(a.answers[q.id]) ? "required" : "disabled"}></label><label>Feedback<input name="feedback-${escape(q.id)}" maxlength="2000" value="${escape(a.manualGrades?.[q.id]?.feedback || "")}"></label></div>` : `<p class="subtext">Marks: ${escape(a.manualGrades?.[q.id]?.marks ?? "—")} / ${a.quiz.marks}</p><p>${escape(a.manualGrades?.[q.id]?.feedback || "")}</p>`) : `<p class="correct-text">Correct answer: ${escape(answerText(q, q.type === "multiple" ? q.correctOptions : q.correctOption))}</p>`}</div>`,
    )
    .join("");
}
function result() {
  const a = displayedAttempt();
  if (!a) return empty("No submission selected.");
  const released = localPreview
    ? quizById(a.quizId)?.release && !a.result?.pendingManual
    : !!a.result;
  return (
    heading("Assessment submitted", a.quiz.title) +
    `<div class="panel narrow"><span class="badge green">${a.reason === "timeout" ? "Deadline reached · auto-submitted" : "Submission recorded"}</span>${released ? `<div class="result-score">${a.result.score}<span> / ${a.result.maximum}</span></div><p class="muted">${a.result.correct} correct · ${a.result.incorrect} incorrect · ${a.result.unanswered} unanswered</p>` : `<h2 style="margin-top:22px">${a.pendingGrading || a.result?.pendingManual ? "Awaiting manual grading" : "Your result is awaiting release"}</h2><p class="muted">Your professor will release the completed result.</p>`}<p class="subtext">${escape(fmtDate(a.submittedAt))} · ${escape(a.identity.roll)}${localPreview ? "<br>Local browser record; not shared server storage." : ""}</p><div class="actions"><button class="primary" data-action="dashboard">Back to assessments</button><button data-action="history">All results</button></div></div>${released ? `<div class="panel narrow"><h2>Response review</h2>${reviewRows(a)}</div>` : ""}`
  );
}
function history() {
  const attempts = myAttempts()
    .filter((a) => a.status === "submitted")
    .sort((a, b) => b.submittedAt - a.submittedAt);
  return (
    heading("Your results", "Your completed assessments and released scores.") +
    (attempts.length
      ? `<div class="panel table-wrap"><table><thead><tr><th>Assessment</th><th>Submitted</th><th>Score</th><th></th></tr></thead><tbody>${attempts.map((a) => `<tr><td>${escape(a.quiz.title)}</td><td>${escape(fmtDate(a.submittedAt))}</td><td>${a.result && (!localPreview || quizById(a.quizId)?.release) && !a.result.pendingManual ? a.result.score + " / " + a.result.maximum : "Awaiting grading/release"}</td><td><button class="small" data-action="result" data-id="${escape(a.id)}">View result</button></td></tr>`).join("")}</tbody></table></div>`
      : empty("Completed assessments will appear here."))
  );
}
function professorDashboard() {
  const picker = localPreview
    ? `<div class="preview-selector"><label>Preview professor account<select id="professor-account">${db.professors
        .filter((p) => p.status === "approved")
        .map(
          (p) =>
            `<option value="${escape(p.id)}" ${p.id === professorId ? "selected" : ""}>${escape(p.name)} · ${escape(db.colleges.find((c) => c.id === p.collegeId)?.name)}</option>`,
        )
        .join("")}</select></label></div>`
    : "";
  if (professor()?.status !== "approved")
    return (
      heading(
        "Professor approval required",
        "An administrator must approve this account.",
      ) + picker
    );
  const quizzes = db.quizzes.filter((q) => q.professorId === professorId),
    attempts = db.attempts.filter(
      (a) => a.status === "submitted" && quizzes.some((q) => q.id === a.quizId),
    );
  return (
    heading(
      "Manage assessments",
      "Author assessments and follow your students’ progress.",
      '<button class="primary" data-action="new-quiz">Create assessment</button>',
    ) +
    picker +
    `<div class="stats">${stat("Assessments", quizzes.length)}${stat("Published", quizzes.filter((q) => q.published).length)}${stat("Submissions", attempts.length)}</div><div class="quiz-list">${quizzes.map((q) => quizCard(q, true)).join("") || empty("Create your first assessment to get started.")}</div>`
  );
}
function localDate(value) {
  if (!value) return "";
  const d = new Date(value);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
function quizEditor() {
  if (!editor) editor = newQuiz();
  const q = editor;
  return (
    heading(
      "Assessment editor",
      "Draft questions, configure rules, then publish.",
    ) +
    `<form id="editor-form"><section class="panel"><h2>Assessment details</h2><div class="form-grid"><label>Title<input name="title" value="${escape(q.title)}" required maxlength="140"></label><label>Subject<input name="subject" value="${escape(q.subject)}" maxlength="100"></label><label class="full">Description<textarea name="description" maxlength="1000">${escape(q.description)}</textarea></label><label>Assigned class<input name="className" value="${escape(q.className)}" maxlength="100" required></label><label>Quiz code<input name="code" value="${escape(q.code)}" maxlength="20" required></label><label>Joining method<select name="joinMode">${[
      ["both", "Class assignment and quiz code"],
      ["code", "Quiz code only"],
      ["roster", "Roster assignment only"],
    ]
      .map(
        ([value, text]) =>
          `<option value="${value}" ${(q.joinMode || "both") === value ? "selected" : ""}>${text}</option>`,
      )
      .join(
        "",
      )}</select></label></div></section><section class="panel"><h2>Timing & marking</h2><div class="form-grid">${[
      ["duration", "Exam duration (minutes)", 1, 240, 1, 20],
      [
        "perQuestionSeconds",
        "Per-question time (seconds; 0 = off)",
        0,
        3600,
        1,
        0,
      ],
      ["attemptLimit", "Attempts allowed", 1, 10, 1, 1],
      ["marks", "Marks per question", 0.1, 100, 0.1, 1],
      ["penalty", "Penalty per wrong answer", 0, 100, 0.1, 0],
    ]
      .map(
        ([name, label, min, max, step, def]) =>
          `<label>${label}<input type="number" name="${name}" value="${q[name] ?? def}" min="${min}" max="${max}" step="${step}" required></label>`,
      )
      .join(
        "",
      )}<label>Opens at (local time)<input type="datetime-local" name="opensAt" value="${localDate(q.opensAt)}"></label><label>Closes at (local time)<input type="datetime-local" name="closesAt" value="${localDate(q.closesAt)}"></label><label class="check-label"><input type="checkbox" name="allowNavigation" ${q.allowNavigation !== false ? "checked" : ""}>Allow returning to questions</label><label class="check-label"><input type="checkbox" name="shuffle" ${q.shuffle ? "checked" : ""}>Randomize question order per attempt</label><label class="check-label full"><input type="checkbox" name="release" ${q.release ? "checked" : ""}>Release scores and answers after submission and manual grading</label></div><p class="subtext">Per-question timers enforce forward-only navigation. The exam deadline still applies. Written responses need manual grading.</p></section><section class="panel"><h2>Assigned roster (optional)</h2><label>One email,roll number per line<textarea name="roster" placeholder="student@college.edu,ROLL001" rows="5">${escape((q.roster || []).map((r) => r.email + "," + r.roll).join("\n"))}</textarea></label><p class="subtext">Required for roster-only assessments. Import up to 2000 entries. This replaces this quiz’s roster when saved.</p></section><section class="panel"><h2>Questions</h2>${q.questions.map((item, i) => `<div class="question-editor"><div class="editor-heading"><h3>Question ${i + 1}</h3><button class="ghost small danger" type="button" data-action="remove-question" data-index="${i}" ${q.questions.length === 1 ? "disabled" : ""}>Remove</button></div><label>Question type<select name="q-${i}-type" data-question-type="${i}">${["single", "multiple", "written"].map((type) => `<option value="${type}" ${(item.type || "single") === type ? "selected" : ""}>${type === "single" ? "Single choice" : type === "multiple" ? "Multiple select" : "Written answer"}</option>`).join("")}</select></label><label style="margin-top:18px">Question text<textarea name="q-${i}" maxlength="4000" required>${escape(item.text)}</textarea></label><p class="subtext">Equations: use $x^2$ inline or $$…$$ for a displayed equation.</p><div class="form-grid"><label>Image URL (optional, HTTPS)<input name="q-${i}-image" type="url" maxlength="2000" value="${escape(item.imagePath || item.localImage ? "" : item.image || "")}"></label>${item.image ? image(item) + `<button type="button" class="small" data-action="remove-image" data-index="${i}">Remove image</button>` : ""}<label>Upload image (PNG, JPEG, WebP)<input type="file" accept="image/png,image/jpeg,image/webp" data-image-upload="${i}"></label><label>Image description<input name="q-${i}-alt" maxlength="500" value="${escape(item.imageAlt || "")}"></label>${item.type === "written" ? `<label class="full">Grading rubric<textarea name="q-${i}-rubric" maxlength="2000">${escape(item.rubric || "")}</textarea></label>` : item.options.map((option, j) => `<label>Option ${String.fromCharCode(65 + j)}<input name="q-${i}-o-${j}" maxlength="1000" value="${escape(option)}" required></label>`).join("")}${item.type === "multiple" ? `<div class="full"><p class="subtext">Correct selections</p><div class="actions">${item.options.map((_, j) => `<label class="check-label"><input name="q-${i}-correct-${j}" type="checkbox" ${(item.correctOptions || []).includes(j) ? "checked" : ""}>Option ${String.fromCharCode(65 + j)}</label>`).join("")}</div></div>` : item.type === "written" ? "" : `<label>Correct answer<select name="q-${i}-correct">${item.options.map((_, j) => `<option value="${j}" ${item.correctOption === j ? "selected" : ""}>Option ${String.fromCharCode(65 + j)}</option>`).join("")}</select></label>`}</div></div>`).join("")}<div class="actions"><button type="button" data-action="add-question" ${q.questions.length >= 100 ? "disabled" : ""}>+ Add question</button></div></section><p id="form-error" class="error" role="alert"></p><div class="actions"><button class="primary">Save assessment</button><button type="button" data-action="dashboard">Cancel</button><span class="subtext">Existing attempts retain their original questions and rules.</span></div></form>`
  );
}
function previewQuiz() {
  const q = quizById(selectedQuizId);
  return (
    heading(
      "Assessment preview",
      q.title,
      '<button data-action="dashboard">Back</button>',
    ) +
    `<div class="panel narrow">${q.questions.map((question, i) => `<div class="review-row"><h3>${i + 1}. ${rich(question.text)}</h3>${image(question)}${question.type === "written" ? `<p class="muted">Written answer · ${escape(question.rubric || "No rubric")}</p>` : question.options.map((o, j) => `<p class="${question.type === "multiple" ? (question.correctOptions.includes(j) ? "correct-text" : "muted") : question.correctOption === j ? "correct-text" : "muted"}">${String.fromCharCode(65 + j)}. ${rich(o)}</p>`).join("")}</div>`).join("")}</div>`
  );
}
function submissionList() {
  return db.attempts.filter(
    (a) =>
      a.status === "submitted" &&
      quizById(a.quizId)?.professorId === professorId &&
      (!submissionFilter || a.identity.className === submissionFilter),
  );
}
function submissions() {
  if (professor()?.status !== "approved") return professorDashboard();
  const attempts = submissionList();
  const graded = attempts.filter((a) => a.result && !a.result.pendingManual);
  const classes = [
    ...new Set(
      db.attempts
        .filter((a) => quizById(a.quizId)?.professorId === professorId)
        .map((a) => a.identity.className),
    ),
  ];
  return (
    heading(
      "Student submissions",
      "Review responses, grade written answers, and export scores.",
      `<button data-action="export" ${!attempts.length ? "disabled" : ""}>Export CSV</button>`,
    ) +
    `<div class="stats">${stat("Submissions", attempts.length)}${stat("Average graded score", graded.length ? Math.round(graded.reduce((sum, a) => sum + a.result.percent, 0) / graded.length) + "%" : "—")}${stat("Awaiting grading", attempts.length - graded.length)}</div><label class="panel">Filter by class<select id="submission-filter"><option value="">All classes</option>${classes.map((c) => `<option ${submissionFilter === c ? "selected" : ""} value="${escape(c)}">${escape(c)}</option>`).join("")}</select></label>` +
    (attempts.length
      ? `<div class="panel table-wrap"><table><thead><tr><th>Student</th><th>Assessment</th><th>Score</th><th>Submitted</th><th></th></tr></thead><tbody>${attempts.map((a) => `<tr><td>${escape(a.identity.name)}<p class="subtext">${escape(a.identity.roll)} · ${escape(a.identity.email)}</p></td><td>${escape(a.quiz.title)}</td><td>${a.result?.score ?? "—"} / ${a.result?.maximum ?? "—"}${a.result?.pendingManual ? '<br><span class="badge amber">Needs grading</span>' : ""}</td><td>${escape(fmtDate(a.submittedAt))}</td><td><button class="small" data-action="grade" data-id="${escape(a.id)}">Review</button></td></tr>`).join("")}</tbody></table></div>`
      : empty("No student submissions yet."))
  );
}
function grading() {
  const a = displayedAttempt();
  return (
    heading("Submission review", a.identity.name + " · " + a.quiz.title) +
    `<form id="grade-form" class="panel narrow">${reviewRows(a, true)}<p class="error" id="form-error" role="alert"></p><div class="actions">${a.quiz.questions.some((q) => q.type === "written") ? '<button class="primary">Save grades</button>' : ""}<button type="button" data-action="submissions">Back</button></div></form>`
  );
}
function adminOverview() {
  return (
    heading(
      "College administration",
      "Manage colleges, email-domain filters, and professor access.",
      '<button data-action="backup">Download backup</button>',
    ) +
    `<div class="stats">${stat("Colleges", db.colleges.length)}${stat("Approved professors", db.professors.filter((p) => p.status === "approved").length)}${stat("Pending approvals", db.professors.filter((p) => p.status !== "approved").length)}</div><section class="panel"><h2>Colleges & student domains</h2>${db.colleges.map((c) => `<form class="form-grid college-edit" data-id="${escape(c.id)}" style="padding:20px 0;border-bottom:1px solid var(--line)"><label>College name<input name="name" maxlength="100" required value="${escape(c.name)}"></label><label>Allowed domains (comma-separated)<input name="domains" required value="${escape(c.domains.join(", "))}"></label><label class="check-label"><input type="checkbox" name="enabled" ${c.enabled !== false ? "checked" : ""}>College enabled</label><div><button class="small">Update college</button></div></form>`).join("")}<form id="college-form" class="form-grid" style="margin-top:24px"><label>New college name<input name="name" maxlength="100" required></label><label>Allowed email domains<input name="domains" required placeholder="college.edu.in"></label><div class="full"><button>Add college</button></div></form></section><section class="panel"><h2>Professor access</h2><div class="table-wrap"><table><thead><tr><th>Professor</th><th>College</th><th>Status</th><th></th></tr></thead><tbody>${db.professors.map((p) => `<tr><td>${escape(p.name)}<p class="subtext">${escape(p.email)}</p></td><td>${escape(db.colleges.find((c) => c.id === p.collegeId)?.name)}</td><td><span class="badge ${p.status === "approved" ? "green" : "amber"}">${escape(p.status)}</span></td><td><button class="small" data-action="approve" data-id="${escape(p.id)}">${p.status === "approved" ? "Revoke approval" : "Approve"}</button></td></tr>`).join("")}</tbody></table></div><form id="professor-form" class="form-grid" style="margin-top:24px"><label>Professor name<input name="name" required maxlength="100"></label><label>Professor email<input name="email" type="email" required maxlength="254"></label><label>College<select name="collegeId">${collegeOptions("bmu")}</select></label><div class="full"><button>Add for approval</button></div></form><p class="subtext">Each professor signs in using their own Google account. Access requires administrator approval.</p></section>${db.audit?.length ? `<section class="panel"><h2>Recent administrative activity</h2>${db.audit.map((e) => `<p class="subtext">${escape(fmtDate(e.createdAt))} · ${escape(e.operation)} · ${escape(e.recordId || "")}</p>`).join("")}</section>` : ""}`
  );
}
function admin() {
  const template = document.createElement("template");
  template.innerHTML = adminOverview();
  const sections = template.content.querySelectorAll("section.panel");
  if (view === "professors")
    return (
      heading(
        "Professor access",
        "Manage separate, administrator-approved educator accounts.",
      ) +
      `<div class="stats">${stat("Approved", db.professors.filter((p) => p.status === "approved").length)}${stat("Pending", db.professors.filter((p) => p.status !== "approved").length)}${stat("Colleges", db.colleges.length)}</div>` +
      sections[1].outerHTML
    );
  if (view === "audit")
    return (
      heading(
        "Activity & backups",
        "Review administrative activity and export private application records.",
        '<button data-action="backup">Download backup</button>',
      ) +
      (sections[2]?.outerHTML || empty("No recent administrative activity."))
    );
  return (
    heading(
      "Colleges & eligibility",
      "Manage institutions and allowed student email domains.",
    ) + sections[0].outerHTML
  );
}
function render() {
  if (!db) return;
  if (publicViews.has(view)) {
    renderPublic(view);
    return;
  }
  const a = activeAttempt();
  if (a && role === "student") view = "exam";
  if (view === "exam" && !a) {
    const previous = displayedAttempt();
    view = previous?.status === "submitted" ? "result" : "dashboard";
  }
  const currentPath = pathForView();
  const decision = accessRoute(
    parseRoute(currentPath, basePath),
    routingContext(),
  );
  if (decision.redirect) {
    showRouteError(
      ["forbidden", "notFound"].includes(decision.redirect)
        ? decision.redirect
        : "notFound",
    );
    return;
  }
  navigatePath(currentPath, true);
  const nav =
    role === "student"
      ? [
          ["dashboard", "Assessments"],
          ["history", "My results"],
          ["profile", "Student details"],
        ]
      : role === "professor"
        ? [
            ["dashboard", "Assessments"],
            ["submissions", "Submissions"],
          ]
        : [
            ["dashboard", "Colleges"],
            ["professors", "Professors"],
            ["audit", "Activity & backups"],
          ];
  const person =
    role === "professor"
      ? professor()?.name || "Professor"
      : db.identity.name || "Administrator";
  const body =
    role === "student"
      ? (
          { dashboard, profile, instructions, exam, history, result }[view] ||
          dashboard
        )()
      : role === "professor"
        ? (
            {
              dashboard: professorDashboard,
              editor: quizEditor,
              preview: previewQuiz,
              submissions,
              grading,
            }[view] || professorDashboard
          )()
        : admin();
  app.innerHTML = `<div class="shell ${view === "exam" ? "exam-shell" : ""}"><aside class="sidebar"><a href="${defaultPath(role, basePath)}" class="brand" data-action="dashboard"><span class="brand-mark">${icon("book")}</span>ExamEngine</a><div class="workspace-label">${role === "student" ? "Learning workspace" : role === "professor" ? "Teaching workspace" : "Administration"}</div><nav class="nav" aria-label="Main navigation">${nav.map(([id, title]) => `<a href="${routePath(role, id, null, basePath)}" data-action="${id}" class="${id === view ? "active" : ""}" ${id === view ? 'aria-current="page"' : ""} ${a ? 'aria-disabled="true"' : ""}>${icon(id)}<span>${title}</span></a>`).join("")}</nav><div class="sidebar-bottom">${localPreview ? `<label class="role-label" for="role">Preview workspace</label><select id="role" aria-label="Preview workspace" ${a ? "disabled" : ""}>${["student", "professor", "admin"].map((r) => `<option value="${r}" ${r === role ? "selected" : ""}>${r[0].toUpperCase() + r.slice(1)} preview</option>`).join("")}</select>` : `<button class="ghost small" data-action="refresh">Refresh workspace</button><button class="ghost small" data-action="signout">Sign out</button>`}<p class="sidebar-note">ExamEngine<br><span>Assessment workspace</span></p><button class="ghost small" data-action="privacy">Privacy information</button></div></aside><div class="content"><header class="topbar">${view === "exam" ? `<span class="brand exam-brand">${icon("book")}ExamEngine</span>` : ""}<span class="topbar-label">${escape(role === "admin" ? "Platform administration" : (role === "professor" ? professorCollege() : college()).name + " / " + role)}</span><div class="profile">${localPreview ? '<span class="badge">Local preview</span>' : ""}<span class="profile-name">${escape(person)}</span><span class="avatar">${escape(
    person
      .split(" ")
      .map((s) => s[0])
      .join("")
      .slice(0, 2),
  )}</span></div></header>${localPreview ? '<div class="demo-banner">Local preview · Browser data and role switching are for development only.</div>' : ""}<main id="main" tabindex="-1">${body}</main></div></div>`;
  tick();
}
function renderGate(title, message, signin = false) {
  app.innerHTML = `<main id="main" class="auth-page"><section class="auth-story" aria-label="About ExamEngine"><a class="brand" href="${db ? defaultPath(role, basePath) : routePath(null, "signin", null, basePath)}" data-action="home"><span class="brand-mark">${icon("book")}</span>ExamEngine</a><div class="auth-story-body"><p class="eyebrow">THE ASSESSMENT WORKSPACE</p><h2>A focused space <br>to do your best.</h2><p>From the first question to the final submission. A clear, considered assessment experience for students and educators.</p><div class="assessment-preview" aria-hidden="true"><div class="preview-top"><span>ASSESSMENT IN PROGRESS</span><span>08:42</span></div><div class="preview-progress"><i></i></div><span class="preview-label">QUESTION 04 / 10</span><p>Great questions deserve<br>your full attention.</p><div class="preview-option"><span>A</span><i></i><b>✓</b></div><div class="preview-option"><span>B</span><i></i></div><div class="preview-bottom"><span>Response saved</span><span>Next question →</span></div></div></div><div class="auth-story-footer"><span>Built around learning.</span><span>01 — EXAMENGINE</span></div></section><section class="auth-entry"><div class="auth-entry-top">STUDENTS & EDUCATORS <span>ACCOUNT ACCESS</span></div><div class="panel auth-card"><div class="auth-lock">${icon("lock")}</div><p class="eyebrow">YOUR WORKSPACE AWAITS</p><h1>${escape(title === "Welcome to ExamEngine" ? "Welcome back." : title)}</h1><p class="muted auth-message">${escape(signin && title === "Welcome to ExamEngine" ? "Sign in to access your assessments, submissions, and results." : message)}</p>${signin ? `<button class="google-signin" data-action="signin"><svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.4a4.6 4.6 0 0 1-2 3v2.5h3.3c1.9-1.7 2.9-4.2 2.9-7.4Z"/><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.7-2.4l-3.3-2.5c-.9.6-2 1-3.4 1a6 6 0 0 1-5.7-4.2H2.9v2.6A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.3 13.9a6 6 0 0 1 0-3.8V7.5H2.9a10 10 0 0 0 0 9l3.4-2.6Z"/><path fill="#EA4335" d="M12 5.9c1.5 0 2.8.5 3.9 1.5l2.9-2.9A9.7 9.7 0 0 0 12 2a10 10 0 0 0-9.1 5.5l3.4 2.6A6 6 0 0 1 12 5.9Z"/></svg>Continue with Google ${icon("arrow")}</button>` : ""}<p class="error" id="form-error" role="alert"></p><div class="access-note">${icon("lock")}<p>Use your college or approved educator account.<br>Your institution manages workspace access.</p></div><button class="privacy-link" data-action="privacy">Privacy & account information ${icon("arrow")}</button></div><footer class="auth-entry-footer"><span>ExamEngine © ${new Date().getFullYear()}</span><span>Focus on what you know.</span></footer></section></main>`;
}

function collectIdentity(form, forced) {
  const f = new FormData(form);
  return {
    name: f.get("name").trim(),
    roll: f.get("roll").trim(),
    email: localPreview
      ? f.get("email").trim().toLowerCase()
      : db.identity.email,
    collegeId: forced || f.get("collegeId") || db.identity.collegeId,
    className: f.get("className").trim(),
  };
}
function identityError(i) {
  const c = db.colleges.find((c) => c.id === i.collegeId);
  return !i.name || !i.roll || !i.className
    ? "Complete your name, student ID, and class."
    : !c || c.enabled === false || !eligibleEmail(i.email, c)
      ? "Use an email from your enabled college’s allowed domain."
      : "";
}
function formError(message) {
  const e = document.querySelector("#form-error");
  if (e) e.textContent = message;
  else toast(message);
}
function updateSaveStatus() {
  const e = document.querySelector("#save-status");
  if (e) e.textContent = saveStatus();
  const retry = document.querySelector("#retry-save");
  if (retry) retry.hidden = !saveError;
}
function cacheDraft(a) {
  if (localPreview) {
    persist();
    return;
  }
  try {
    localStorage.setItem(
      "examengine.draft." + db.actorId,
      JSON.stringify({
        attemptId: a.id,
        answers: a.answers,
        flagged: a.flagged,
        current: a.current,
        revision: a.revision,
        deadline: a.deadline,
      }),
    );
  } catch {
    toast("Offline draft storage is unavailable.");
  }
}
function queueSave(a) {
  if (localPreview) {
    persist();
    return;
  }
  cacheDraft(a);
  const payload = {
    attemptId: a.id,
    answers: structuredClone(a.answers),
    flagged: [...a.flagged],
    current: a.current,
    revision: ++a.revision,
  };
  savePending++;
  updateSaveStatus();
  saveChain = saveChain
    .then(async () => {
      const response = await run("save", payload);
      if (response.revision > payload.revision)
        throw new Error(
          "A newer response exists in another tab. Refresh before editing further.",
        );
      saveError = "";
      if (response.attempts) {
        applyWorkspace(response);
        if (!activeAttempt()) {
          selectedAttemptId = payload.attemptId;
          view = "result";
        }
        render();
      } else if (response.status === "submitted") {
        applyResponse(response);
        selectedAttemptId = response.id;
        view = "result";
        render();
      }
    })
    .catch((error) => {
      saveError = error.message;
      toast("Answer save failed. Your browser draft is retained.");
    })
    .finally(() => {
      savePending--;
      updateSaveStatus();
    });
}
async function flush() {
  clearTimeout(answerTimer);
  const a = activeAttempt();
  if (a && !localPreview) queueSave(a);
  await saveChain;
  if (saveError)
    throw new Error(
      "Some answers are not confirmed saved. Retry saving before continuing.",
    );
}
async function finish(reason) {
  if (finishing || !activeAttempt()) return;
  finishing = true;
  lastDeadlineRequest = Date.now();
  try {
    const a = activeAttempt();
    clearTimeout(answerTimer);
    if (reason !== "timeout") await flush();
    else await saveChain;
    selectedAttemptId = a.id;
    if (localPreview) {
      db.attempts[db.attempts.indexOf(a)] = submitAttempt(a, reason, now());
      persist();
    } else {
      applyWorkspace(await run("submit", { attemptId: a.id }));
      localStorage.removeItem("examengine.draft." + db.actorId);
    }
    saveError = "";
    go("result");
  } catch (e) {
    toast(e.message);
  } finally {
    finishing = false;
  }
}
async function advance() {
  const a = activeAttempt();
  if (!a) return;
  if (finishing) return;
  finishing = true;
  lastDeadlineRequest = Date.now();
  try {
    if (!a.questionDeadline || now() < a.questionDeadline) await flush();
    else await saveChain;
    if (a.current === a.quiz.questions.length - 1) {
      finishing = false;
      await finish(
        a.questionDeadline && now() >= a.questionDeadline
          ? "timeout"
          : "student",
      );
      return;
    }
    if (localPreview) {
      const advanced = advanceAttempt(a, now());
      db.attempts[db.attempts.indexOf(a)] = advanced;
      if (advanced.status === "submitted") {
        selectedAttemptId = a.id;
        view = "result";
      }
      persist();
    } else
      applyResponse(
        await run("advance", { attemptId: a.id, current: a.current }),
      );
    render();
  } catch (e) {
    toast(e.message);
  } finally {
    finishing = false;
  }
}
function guardDeadline() {
  const a = activeAttempt();
  if (!a) return true;
  if (remainingSeconds(a, now()) === 0) {
    void finish("timeout");
    return false;
  }
  if (a.questionDeadline && now() >= a.questionDeadline) {
    void advance();
    return false;
  }
  return true;
}
function tick() {
  const a = activeAttempt();
  if (!a) return;
  if (a.deadline <= now()) {
    if (Date.now() - lastDeadlineRequest > 15000) void finish("timeout");
    return;
  }
  if (a.questionDeadline && a.questionDeadline <= now()) {
    if (Date.now() - lastDeadlineRequest > 15000) void advance();
    return;
  }
  const seconds = Math.ceil(
    ((a.questionDeadline || a.deadline) - now()) / 1000,
  );
  const e = document.querySelector("#time-left");
  if (e) {
    e.textContent = formatTime(Math.max(0, seconds));
    e.parentElement.classList.toggle("urgent", seconds <= 60);
  }
  const overall = document.querySelector("#exam-time");
  if (overall) overall.textContent = formatTime(remainingSeconds(a, now()));
}
function collectEditor() {
  const form = document.querySelector("#editor-form");
  if (!form || !editor) return;
  const f = new FormData(form);
  for (const key of [
    "title",
    "subject",
    "description",
    "className",
    "code",
    "joinMode",
  ])
    editor[key] = String(f.get(key) || "").trim();
  editor.code = editor.code.toUpperCase();
  for (const key of [
    "duration",
    "marks",
    "penalty",
    "attemptLimit",
    "perQuestionSeconds",
  ])
    editor[key] = Number(f.get(key));
  for (const key of ["release", "allowNavigation", "shuffle"])
    editor[key] = f.has(key);
  for (const key of ["opensAt", "closesAt"])
    editor[key] = f.get(key) ? new Date(f.get(key)).toISOString() : null;
  editor.roster = parseRoster(f.get("roster") || "");
  editor.questions.forEach((q, i) => {
    const prior = q.type || "single";
    q.text = f.get(`q-${i}`).trim();
    const imageURL = (f.get(`q-${i}-image`) || "").trim();
    if (imageURL) {
      q.image = imageURL;
      delete q.imagePath;
      delete q.localImage;
    } else if (!q.imagePath && !q.localImage) q.image = "";
    q.imageAlt = (f.get(`q-${i}-alt`) || "").trim();
    if (prior !== "written")
      q.options = q.options.map((_, j) =>
        (f.get(`q-${i}-o-${j}`) || "").trim(),
      );
    if (prior === "multiple")
      q.correctOptions = q.options
        .map((_, j) => (f.has(`q-${i}-correct-${j}`) ? j : null))
        .filter((j) => j !== null);
    if (prior === "single") q.correctOption = Number(f.get(`q-${i}-correct`));
    if (prior === "written") q.rubric = (f.get(`q-${i}-rubric`) || "").trim();
    q.type = f.get(`q-${i}-type`);
  });
}
async function refresh() {
  if (localPreview) return;
  await saveChain;
  applyWorkspace(await run("workspace"));
  render();
}
app.addEventListener("input", (event) => {
  if (event.target.name === "written") {
    if (!guardDeadline()) return;
    const a = activeAttempt();
    if (!a) return;
    a.answers[a.quiz.questions[a.current].id] = event.target.value;
    cacheDraft(a);
    const count = answeredCount(a),
      status = document.querySelector("#answered-count");
    if (status)
      status.textContent = `${count} of ${a.quiz.questions.length} answered`;
    const bar = document.querySelector(".progress span");
    if (bar) bar.style.width = `${(count / a.quiz.questions.length) * 100}%`;
    const clear = document.querySelector('[data-action="clear"]');
    if (clear) clear.disabled = !isAnswered(event.target.value);
    document.querySelectorAll(".palette button").forEach((button, i) => {
      const answered = isAnswered(a.answers[a.quiz.questions[i].id]);
      button.classList.toggle("answered", answered);
      button.setAttribute(
        "aria-label",
        `Question ${i + 1}, ${answered ? "answered" : "unanswered"}`,
      );
    });
    clearTimeout(answerTimer);
    answerTimer = setTimeout(() => queueSave(a), 500);
  }
});
app.addEventListener("change", async (event) => {
  try {
    if (event.target.dataset.imageUpload !== undefined) {
      const file = event.target.files[0];
      if (!file) return;
      if (
        !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
        file.size > 5 * 1024 * 1024
      )
        throw new Error("Choose a PNG, JPEG, or WebP image under 5 MB.");
      collectEditor();
      const q = editor.questions[Number(event.target.dataset.imageUpload)];
      if (localPreview) {
        q.image = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error("Image could not be read."));
          reader.readAsDataURL(file);
        });
        q.localImage = true;
      } else {
        const uploaded = await uploadImage(file, db.actorId);
        q.imagePath = uploaded.path;
        q.image = uploaded.url;
      }
      render();
      toast("Image attached. Save the assessment to keep this change.");
    }
    if (event.target.id === "role") {
      if (activeAttempt()) return;
      role = event.target.value;
      sessionStorage.setItem("examengine.previewRole", role);
      editor = null;
      go("dashboard");
    }
    if (event.target.id === "professor-account") {
      professorId = event.target.value;
      editor = null;
      go("dashboard");
    }
    if (event.target.id === "submission-filter") {
      submissionFilter = event.target.value;
      render();
    }
    if (event.target.dataset.questionType !== undefined) {
      collectEditor();
      render();
    }
    if (event.target.name === "answer") {
      if (!guardDeadline()) return;
      const a = activeAttempt(),
        q = a.quiz.questions[a.current],
        value = Number(event.target.value);
      if (q.type === "multiple") {
        const set = new Set(a.answers[q.id] || []);
        if (event.target.checked) set.add(value);
        else set.delete(value);
        a.answers[q.id] = [...set].sort((a, b) => a - b);
      } else a.answers[q.id] = value;
      queueSave(a);
      render();
      document.querySelector(`input[name="answer"][value="${value}"]`)?.focus();
    }
  } catch (e) {
    toast(e.message);
  }
});
app.addEventListener("click", async (event) => {
  const el = event.target.closest("[data-action]");
  if (!el) return;
  if (
    el.tagName === "A" &&
    (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
  )
    return;
  event.preventDefault();
  const action = el.dataset.action,
    id = el.dataset.id;
  if (busy) return;
  if (action === "home") {
    navigatePath(
      db
        ? defaultPath(role, basePath)
        : routePath(null, "signin", null, basePath),
    );
    await readRoute();
    return;
  }
  if (action === "privacy") {
    showPrivacy();
    return;
  }
  if (action === "signin") {
    await signIn();
    return;
  }
  if (action === "signout") {
    await signOut();
    return;
  }
  if (!db) return;
  if (!guardDeadline()) return;
  busy = true;
  el.disabled = true;
  try {
    if (
      [
        "dashboard",
        "profile",
        "history",
        "submissions",
        "professors",
        "audit",
      ].includes(action)
    ) {
      if (activeAttempt()) return;
      editor = null;
      go(action);
    } else if (action === "refresh") await refresh();
    else if (action === "open-quiz") {
      const q = quizById(id),
        attempts = myAttempts().filter(
          (a) => a.quizId === id && a.status === "submitted",
        );
      if (attempts.length >= q.attemptLimit) {
        selectedAttemptId = attempts.at(-1).id;
        go("result");
      } else {
        joinedCode = "";
        go("instructions", id);
      }
    } else if (action === "result") {
      selectedAttemptId = id;
      go("result");
    } else if (action === "grade") {
      selectedAttemptId = id;
      go("grading");
    } else if (action === "new-quiz") {
      if (professor()?.status !== "approved")
        throw new Error("Professor approval required.");
      editor = newQuiz();
      go("editor");
    } else if (action === "edit") {
      editor = structuredClone(quizById(id));
      go("editor");
    } else if (action === "preview") go("preview", id);
    else if (action === "publish") {
      const q = quizById(id);
      if (!q.published) {
        const error = validateQuiz(q);
        if (error) throw new Error(error);
        if (q.joinMode === "roster" && !q.roster?.length)
          throw new Error("Add a roster before publishing.");
      }
      await command(
        "publish",
        { quizId: id, published: !q.published },
        () => (q.published = !q.published),
      );
      render();
      toast("Publication updated.");
    } else if (action === "add-question" || action === "remove-question") {
      collectEditor();
      if (action === "add-question") editor.questions.push(newQuestion());
      else editor.questions.splice(Number(el.dataset.index), 1);
      render();
    } else if (action === "approve") {
      const p = db.professors.find((p) => p.id === id);
      await command(
        "approve",
        { id, approved: p.status !== "approved" },
        () => (p.status = p.status === "approved" ? "pending" : "approved"),
      );
      render();
    } else if (action === "remove-image") {
      collectEditor();
      const q = editor.questions[Number(el.dataset.index)];
      q.image = "";
      delete q.imagePath;
      delete q.localImage;
      render();
    } else if (action === "export") exportResults();
    else if (action === "backup") {
      const backup = localPreview
        ? { localPreview: true, workspace: db }
        : await run("backup");
      downloadJSON(
        backup,
        localPreview
          ? "examengine-local-preview.json"
          : "examengine-backup.json",
      );
    } else if (action === "retry-save") {
      const a = activeAttempt();
      if (a) {
        queueSave(a);
        await saveChain;
        render();
      }
    } else if (
      [
        "question",
        "previous",
        "next",
        "clear",
        "flag",
        "review-submit",
        "confirm-submit",
        "close-dialog",
      ].includes(action)
    ) {
      const a = activeAttempt();
      if (!a) return;
      if (
        action === "review-submit" ||
        (action === "next" && a.current === a.quiz.questions.length - 1)
      ) {
        render();
        document.querySelector("#submit-dialog").showModal();
        return;
      }
      if (action === "confirm-submit") {
        await finish("student");
        return;
      }
      if (action === "close-dialog") {
        document.querySelector("#submit-dialog").close();
        return;
      }
      if (action === "next" && !navigable(a)) {
        await advance();
        return;
      }
      if (action === "previous" && navigable(a))
        a.current = Math.max(0, a.current - 1);
      if (action === "next") a.current++;
      if (action === "question" && navigable(a))
        a.current = Number(el.dataset.index);
      const q = a.quiz.questions[a.current];
      if (action === "clear") delete a.answers[q.id];
      if (action === "flag")
        a.flagged = a.flagged.includes(q.id)
          ? a.flagged.filter((f) => f !== q.id)
          : [...a.flagged, q.id];
      queueSave(a);
      render();
      if (["next", "previous", "question"].includes(action)) {
        const title = document.querySelector("#question-title");
        title?.setAttribute("tabindex", "-1");
        title?.focus();
      }
    }
  } catch (e) {
    formError(e.message);
  } finally {
    busy = false;
    if (el.isConnected) el.disabled = false;
  }
});
app.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy) return;
  const form = event.target,
    button = form.querySelector('button[type="submit"],button:not([type])');
  busy = true;
  if (button) button.disabled = true;
  try {
    const f = new FormData(form);
    if (form.id === "join-form") {
      joinedCode = f.get("code").trim().toUpperCase();
      let q;
      if (localPreview)
        q = db.quizzes.find(
          (q) =>
            q.published &&
            q.code === joinedCode &&
            q.collegeId === college().id &&
            q.joinMode !== "roster",
        );
      else {
        q = await run("join", { code: joinedCode });
        if (!quizById(q.id)) db.quizzes.push(q);
      }
      if (!q)
        throw new Error("No available quiz matches that code in your college.");
      sessionStorage.setItem(joinCodeKey(q.id), joinedCode);
      go("instructions", q.id);
    } else if (form.id === "profile-form" || form.id === "start-form") {
      if (activeAttempt()) throw new Error("An assessment is already active.");
      const q = form.id === "start-form" ? quizById(selectedQuizId) : null,
        i = collectIdentity(form, q?.collegeId);
      const error = identityError(i);
      if (error) throw new Error(error);
      if (q) {
        if (!q.published) throw new Error("This quiz is unavailable.");
        if (i.className.toLowerCase() !== q.className.toLowerCase())
          throw new Error("This quiz is restricted to its assigned class.");
        if (q.opensAt && now() < Date.parse(q.opensAt))
          throw new Error("This assessment has not opened yet.");
        if (q.closesAt && now() >= Date.parse(q.closesAt))
          throw new Error("This assessment is closed.");
      }
      await command("profile", i, () => (db.identity = i));
      if (q) {
        if (localPreview) {
          if (
            myAttempts().filter((a) => a.quizId === q.id).length >=
            q.attemptLimit
          )
            throw new Error("No attempts remaining.");
          if (q.joinMode === "code" && joinedCode !== q.code)
            throw new Error("Enter the quiz code to join.");
          if (
            q.joinMode === "roster" &&
            !(q.roster || []).some(
              (r) =>
                r.email === i.email &&
                (!r.roll || r.roll.toLowerCase() === i.roll.toLowerCase()),
            )
          )
            throw new Error(
              "Your college email and roll number must match the assigned roster.",
            );
          db.attempts.push(createAttempt(q, i, now()));
          persist();
        } else
          applyWorkspace(
            await run("start", { quizId: q.id, code: joinedCode }),
          );
        saveError = "";
        go("exam");
      } else {
        go("dashboard");
        toast("Student details saved.");
      }
    } else if (form.id === "editor-form") {
      if (professor()?.status !== "approved")
        throw new Error("Professor approval required.");
      collectEditor();
      const error = validateQuiz(editor);
      if (error) throw new Error(error);
      if (
        editor.roster.some((r) => !eligibleEmail(r.email, professorCollege()))
      )
        throw new Error("Roster emails must match this college.");
      if (
        db.quizzes.some(
          (q) =>
            q.id !== editor.id &&
            q.collegeId === editor.collegeId &&
            q.code === editor.code,
        )
      )
        throw new Error("Quiz code already in use.");
      const saved = structuredClone(editor);
      await command("saveQuiz", { quiz: saved }, () => {
        const idx = db.quizzes.findIndex((q) => q.id === saved.id);
        if (idx < 0) db.quizzes.push(saved);
        else db.quizzes[idx] = saved;
      });
      if (!localPreview)
        applyWorkspace(
          await run("roster", { quizId: saved.id, rows: saved.roster }),
        );
      editor = null;
      go("dashboard");
      toast("Assessment saved.");
    } else if (form.id === "grade-form") {
      const a = displayedAttempt(),
        grades = {};
      for (const q of a.quiz.questions.filter(
        (q) => q.type === "written" && isAnswered(a.answers[q.id]),
      )) {
        const marks = Number(f.get("grade-" + q.id));
        if (!Number.isFinite(marks) || marks < 0 || marks > a.quiz.marks)
          throw new Error("Enter valid marks for each written response.");
        grades[q.id] = { marks, feedback: f.get("feedback-" + q.id) || "" };
      }
      await command(
        "manualGrade",
        { quizId: a.quizId, attemptId: a.id, grades },
        () => {
          a.manualGrades = { ...a.manualGrades, ...grades };
          a.result = gradeAttempt(a.quiz, a.answers, a.manualGrades);
        },
      );
      go("submissions");
      toast("Grades saved.");
    } else if (
      form.id === "college-form" ||
      form.classList.contains("college-edit")
    ) {
      const domains = f
        .get("domains")
        .split(",")
        .map((s) => s.trim().replace(/^@/, "").toLowerCase());
      if (
        domains.some(
          (d) => !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(d),
        )
      )
        throw new Error("Enter valid email domains.");
      const c = {
        id: form.dataset.id || crypto.randomUUID(),
        name: f.get("name").trim(),
        domains,
        enabled: form.id === "college-form" || f.has("enabled"),
      };
      if (
        db.colleges.some(
          (other) =>
            other.id !== c.id && other.domains.some((d) => domains.includes(d)),
        )
      )
        throw new Error("That domain already belongs to a college.");
      await command("college", c, () => {
        const idx = db.colleges.findIndex((x) => x.id === c.id);
        if (idx < 0) db.colleges.push(c);
        else db.colleges[idx] = c;
      });
      render();
      toast("College configuration saved.");
    } else if (form.id === "professor-form") {
      const p = {
        id: crypto.randomUUID(),
        name: f.get("name").trim(),
        email: f.get("email").trim().toLowerCase(),
        collegeId: f.get("collegeId"),
        status: "pending",
      };
      if (db.professors.some((x) => x.email === p.email))
        throw new Error("Professor email already exists.");
      await command("professor", p, () => db.professors.push(p));
      render();
      toast("Professor added for approval.");
    }
  } catch (e) {
    formError(e.message);
  } finally {
    busy = false;
    if (button?.isConnected) button.disabled = false;
  }
});
function exportResults() {
  const rows = [
    [
      "Student",
      "Roll number",
      "Email",
      "College",
      "Class",
      "Assessment",
      "Score",
      "Maximum",
      "Pending grading",
      "Submitted",
    ],
  ];
  for (const a of submissionList())
    rows.push([
      a.identity.name,
      a.identity.roll,
      a.identity.email,
      a.identity.collegeId,
      a.identity.className,
      a.quiz.title,
      a.result.score,
      a.result.maximum,
      a.result.pendingManual,
      new Date(a.submittedAt).toISOString(),
    ]);
  const csv = rows
    .map((row) =>
      row
        .map((value) => {
          let text = String(value);
          if (/^[=+@\-\t\r]/.test(text)) text = "'" + text;
          return '"' + text.replaceAll('"', '""') + '"';
        })
        .join(","),
    )
    .join("\r\n");
  const url = URL.createObjectURL(
      new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }),
    ),
    link = document.createElement("a");
  link.href = url;
  link.download = "examengine-results.csv";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function showPrivacy() {
  go("privacy");
}
function privacyContent() {
  const config = globalThis.EXAMENGINE_CONFIG || {};
  return (
    '<h2>Privacy information</h2><p>ExamEngine records your verified email, name, college, class, roll number, quiz responses, and results. Approved professors access their own assessments; platform administrators manage college access.</p><p>No camera, microphone, or location is collected. Google provides account identity. The institution must publish its retention policy and support contact before inviting real students.</p><p class="subtext">' +
    (localPreview
      ? "This preview stores data only in this browser."
      : "The configured backend stores assessment records. This service is not a substitute for your institution’s approved privacy notice.") +
    "</p>" +
    (config.privacyUrl
      ? `<p><a href="${escape(config.privacyUrl)}" target="_blank" rel="noopener noreferrer">Read the approved privacy policy</a></p>`
      : "") +
    (config.supportEmail
      ? `<p>Support: <a href="mailto:${escape(config.supportEmail)}">${escape(config.supportEmail)}</a></p>`
      : "") +
    ""
  );
}
function downloadJSON(value, filename) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
// Google sign-in is wired only after the assessment and backend features.
async function signIn() {
  try {
    const { error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo:
          location.origin + routePath(null, "callback", null, basePath),
        queryParams: { prompt: "select_account" },
      },
    });
    if (error) throw error;
  } catch (e) {
    formError(e.message);
  }
}
async function signOut() {
  if (activeAttempt()) {
    const d = document.createElement("dialog");
    d.innerHTML =
      '<h2>Sign out during an assessment?</h2><p>The deadline keeps running. Your confirmed responses remain saved.</p><form method="dialog"><div class="actions"><button value="cancel">Stay here</button><button value="confirm">Sign out</button></div></form>';
    document.body.append(d);
    const choice = await new Promise((resolve) => {
      d.addEventListener("close", () => resolve(d.returnValue));
      d.showModal();
    });
    d.remove();
    if (choice !== "confirm") return;
  }
  clearTimeout(answerTimer);
  if (activeAttempt()) queueSave(activeAttempt());
  await saveChain;
  const { error } = await client.auth.signOut();
  if (error) {
    toast(error.message);
    return;
  }
  db = null;
  navigatePath(routePath(null, "signin", null, basePath), true);
  renderGate(
    "Welcome to ExamEngine",
    "Sign in with your approved college or professor Google account.",
    true,
  );
}
async function bootstrap() {
  const epoch = ++routeEpoch;
  if (localPreview) {
    role = sessionStorage.getItem("examengine.previewRole") || "student";
    if (!["student", "professor", "admin"].includes(role)) role = "student";
    persist();
    await readRoute(true);
    return;
  }
  db = null;
  if (!configured) {
    await readRoute();
    return;
  }
  renderGate("Opening your workspace", "Checking your verified account…");
  try {
    const { data, error } = await client.auth.getSession();
    if (epoch !== routeEpoch) return;
    if (error) throw error;
    if (!data.session) {
      await readRoute();
      return;
    }
    const workspace = await run("workspace");
    if (epoch !== routeEpoch) return;
    applyWorkspace(workspace);
    const a = activeAttempt();
    if (a) {
      try {
        const draft = JSON.parse(
          localStorage.getItem("examengine.draft." + db.actorId),
        );
        if (
          draft?.attemptId === a.id &&
          draft.revision >= a.revision &&
          a.deadline > now()
        ) {
          a.answers = draft.answers;
          a.flagged = draft.flagged;
          a.current = navigable(a) ? draft.current : a.current;
          a.revision = Math.max(a.revision, draft.revision) + 1;
          queueSave(a);
        }
      } catch {}
    }
    await readRoute(true);
  } catch (e) {
    if (epoch !== routeEpoch) return;
    db = null;
    navigatePath(routePath(null, "signin", null, basePath), true);
    renderGate("Account access unavailable", e.message, true);
  }
}
window.addEventListener("online", () => {
  const a = activeAttempt();
  if (a) {
    queueSave(a);
    void saveChain.then(() => render());
  }
});
window.addEventListener("storage", (event) => {
  if (
    localPreview &&
    event.key === "examengine.local.v1" &&
    view !== "editor"
  ) {
    db = loadStore();
    render();
  }
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) tick();
});
client?.auth.onAuthStateChange((event, session) => {
  if (localPreview) return;
  if (event === "SIGNED_OUT") {
    routeEpoch++;
    db = null;
    navigatePath(routePath(null, "signin", null, basePath), true);
    renderGate(
      "Welcome to ExamEngine",
      "Sign in with your approved college or professor Google account.",
      true,
    );
  } else if (event === "SIGNED_IN" && (!db || db.actorId !== session?.user?.id))
    setTimeout(() => void bootstrap(), 0);
});
setInterval(async () => {
  if (localPreview || !db) return;
  try {
    await resolveImages(db);
    const questions = [
      ...db.quizzes.flatMap((q) => q.questions),
      ...db.attempts.flatMap((a) => a.quiz.questions),
    ];
    document.querySelectorAll("[data-image-path]").forEach((el) => {
      const q = questions.find((q) => q.imagePath === el.dataset.imagePath);
      if (q?.image && el.src !== q.image) el.src = q.image;
    });
  } catch {
    /* Signed image renewal retries on the next tick without changing unsent text. */
  }
}, 60000);
setInterval(tick, 1000);
window.addEventListener("popstate", () => void readRoute());
void bootstrap();
