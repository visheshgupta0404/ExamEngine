import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { build } from "esbuild";

// Exercise the actual navigation and rendering code with a delayed auth/API
// adapter. No browser session, credentials, or live backend is used.
const source = (await readFile("script.js", "utf8")).replace(
  "void bootstrap();",
  "globalThis.navigationTest = {bootstrap, go, readRoute, applyWorkspace, queueSave, advance, saveStatus, refresh, getWorkspace:()=>db, waitForSaves:()=>saveChain};",
);
const bundled = await build({
  stdin: {
    contents: source,
    resolveDir: process.cwd(),
    sourcefile: "script.js",
  },
  bundle: true,
  format: "iife",
  write: false,
  plugins: [
    {
      name: "test-auth-adapter",
      setup(build) {
        build.onResolve({ filter: /src\/service\.js$/ }, () => ({
          path: "service",
          namespace: "fixture",
        }));
        build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: `
        export const preview=false, configured=true;
        export const client={auth:{getSession:()=>globalThis.service.getSession(),onAuthStateChange(callback){globalThis.service.onAuth=callback;}}};
        export const run=(operation,payload)=>globalThis.service.rpc?globalThis.service.rpc(operation,payload):globalThis.service.workspace();
        export const uploadImage=()=>{},resolveImages=()=>{};
      `,
        }));
      },
    },
  ],
});
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function harness() {
  const listeners = {},
    windowListeners = {},
    skipListeners = {};
  let mainFocused = false;
  const renders = [],
    attrs = new Map();
  let html = "";
  const app = {
    addEventListener: (name, handler) => (listeners[name] = handler),
    setAttribute: (k, v) => attrs.set(k, v),
    removeAttribute: (k) => attrs.delete(k),
    get innerHTML() {
      return html;
    },
    set innerHTML(value) {
      html = value;
      renders.push(value);
    },
  };
  const location = {
    pathname: "/student/assessments",
    hostname: "test.example",
    search: "",
    hash: "",
  };
  const store = new Map();
  const workspace = {
    role: "student",
    actorId: "student-1",
    identity: {
      name: "Test Student",
      email: "student@test.edu",
      roll: "001",
      className: "CSE",
      collegeId: "college",
    },
    colleges: [{ id: "college", name: "College", domains: ["test.edu"] }],
    quizzes: [],
    attempts: [],
    professors: [],
  };
  const service = {
    getSession: async () => ({
      data: { session: { user: { id: "student-1" } } },
    }),
    workspace: async () => structuredClone(workspace),
  };
  const context = vm.createContext({
    console,
    crypto: webcrypto,
    service,
    location,
    structuredClone,
    URL,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    sessionStorage: {
      getItem: (k) => store.get(k) || null,
      setItem: (k, v) => store.set(k, v),
      removeItem: (k) => store.delete(k),
    },
    localStorage: {
      getItem: (k) => store.get(k) || null,
      setItem: (k, v) => store.set(k, v),
      removeItem: (k) => store.delete(k),
    },
    document: {
      compatMode: "CSS1Compat",
      querySelector: (selector) =>
        selector === "#app"
          ? app
          : selector === "main"
            ? {
                focus() {
                  mainFocused = true;
                },
                setAttribute() {},
                scrollIntoView() {},
              }
            : selector === ".skip-link"
              ? {
                  addEventListener: (name, handler) =>
                    (skipListeners[name] = handler),
                }
              : selector === "#toast"
                ? { textContent: "", classList: { add() {}, remove() {} } }
                : null,
      addEventListener() {},
    },
    window: {
      confirm: () => service.confirm?.() ?? false,
      addEventListener: (name, handler) => (windowListeners[name] = handler),
      scrollTo() {},
      history: {
        replaceState: (_, __, path) => (location.pathname = path),
        pushState: (_, __, path) => (location.pathname = path),
      },
    },
  });
  vm.runInContext(bundled.outputFiles[0].text, context);
  return {
    app,
    listeners,
    windowListeners,
    skipListeners,
    mainFocused: () => mainFocused,
    attrs,
    renders,
    location,
    service,
    api: context.navigationTest,
  };
}

test("session checking does not render sign-in before authentication resolves", async () => {
  const h = harness(),
    session = deferred();
  h.service.getSession = () => session.promise;
  const pending = h.api.bootstrap();
  assert.match(h.app.innerHTML, /session-loading/);
  assert.doesNotMatch(h.app.innerHTML, /auth-story|Continue with Google/);
  session.resolve({ data: { session: null } });
  await pending;
  assert.match(h.app.innerHTML, /Continue with Google/);
});
test("protected navigation retains the workspace while revalidating access", async () => {
  const h = harness();
  await h.api.bootstrap();
  const original = h.app.innerHTML,
    request = deferred();
  h.service.workspace = () => request.promise;
  h.location.pathname = "/student/profile";
  const pending = h.api.readRoute();
  assert.equal(h.app.innerHTML, original);
  assert.equal(h.attrs.get("aria-busy"), "true");
  request.resolve({
    role: "student",
    actorId: "student-1",
    identity: {
      name: "Test Student",
      email: "student@test.edu",
      roll: "001",
      className: "CSE",
      collegeId: "college",
    },
    colleges: [{ id: "college", name: "College", domains: ["test.edu"] }],
    quizzes: [],
    attempts: [],
    professors: [],
  });
  await pending;
  assert.match(h.app.innerHTML, /profile-form/);
  assert.equal(h.attrs.has("aria-busy"), false);
  assert.equal(
    h.renders.some((html) => html.includes('class="auth-page"')),
    false,
  );
});
test("failed access revalidation clears the workspace and returns to sign-in", async () => {
  const h = harness();
  await h.api.bootstrap();
  h.location.pathname = "/student/profile";
  h.service.workspace = async () => {
    throw Object.assign(Error("Access revoked"), { code: "42501" });
  };
  await h.api.readRoute();
  assert.equal(h.location.pathname, "/sign-in");
  assert.match(h.app.innerHTML, /Continue with Google/);
  assert.equal(h.attrs.has("aria-busy"), false);
});

test("transient navigation failures keep the authorized screen and restore its URL", async () => {
  const h = harness();
  await h.api.bootstrap();
  const original = h.app.innerHTML;
  h.location.pathname = "/student/profile";
  h.service.workspace = async () => {
    throw Object.assign(Error("Temporary outage"), { status: 503 });
  };
  await h.api.readRoute();
  assert.equal(h.location.pathname, "/student/assessments");
  assert.equal(h.app.innerHTML, original);
  assert.ok(h.api.getWorkspace());
  assert.equal(h.attrs.has("aria-busy"), false);
});
test("a late save cannot restore private workspace data after sign-out", async () => {
  const h = harness();
  await h.api.bootstrap();
  const request = deferred(),
    workspace = structuredClone(h.api.getWorkspace());
  const attempt = {
    id: "attempt",
    userId: "student-1",
    answers: { q: 1 },
    flagged: [],
    current: 0,
    revision: 0,
  };
  h.service.rpc = () => request.promise;
  h.api.queueSave(attempt);
  await Promise.resolve();
  h.service.onAuth("SIGNED_OUT", null);
  request.resolve(workspace);
  await h.api.waitForSaves();
  assert.equal(h.api.getWorkspace(), null);
  assert.equal(h.location.pathname, "/sign-in");
  assert.match(h.app.innerHTML, /Continue with Google/);
});
test("finishing the last timed question opens its result, not the dashboard", async () => {
  const h = harness();
  await h.api.bootstrap();
  const workspace = structuredClone(h.api.getWorkspace());
  const attempt = {
    id: "timed",
    userId: "student-1",
    quizId: "quiz",
    status: "active",
    current: 0,
    revision: 0,
    answers: {},
    flagged: [],
    deadline: Date.now() + 60000,
    questionDeadline: Date.now() - 1000,
    identity: workspace.identity,
    quiz: {
      id: "quiz",
      title: "Timed quiz",
      questions: [
        { id: "q", type: "single", text: "Question", options: ["A", "B"] },
      ],
      marks: 1,
      duration: 1,
      perQuestionSeconds: 10,
    },
  };
  workspace.attempts = [attempt];
  h.api.applyWorkspace(workspace);
  const submitted = {
    ...workspace,
    attempts: [
      {
        ...attempt,
        status: "submitted",
        submittedAt: Date.now(),
        result: null,
      },
    ],
  };
  h.service.rpc = async () => submitted;
  await h.api.advance();
  assert.equal(h.location.pathname, "/student/results/timed");
  assert.match(h.app.innerHTML, /Assessment submitted/);
});

test("unsaved assessment edits survive canceled navigation and warn before closing", async () => {
  const h = harness();
  const w = await h.service.workspace();
  w.role = "professor";
  h.service.workspace = async () => structuredClone(w);
  h.location.pathname = "/professor/assessments/new";
  await h.api.bootstrap();
  assert.match(h.app.innerHTML, /editor-form/);
  h.listeners.input({ target: { name: "title", closest: () => ({}) } });
  let prevented = false;
  h.windowListeners.beforeunload({
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  h.api.go("dashboard");
  assert.equal(h.location.pathname, "/professor/assessments/new");
  assert.match(h.app.innerHTML, /editor-form/);
  h.service.confirm = () => true;
  h.api.go("dashboard");
  assert.equal(h.location.pathname, "/professor/assessments");
  prevented = false;
  h.windowListeners.beforeunload({
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, false);
});

test("skip link focuses the main area without changing the current route", async () => {
  const h = harness();
  await h.api.bootstrap();
  let prevented = false;
  h.skipListeners.click({
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(h.mainFocused(), true);
  assert.equal(h.location.pathname, "/student/assessments");
});
