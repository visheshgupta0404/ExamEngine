import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { build } from "esbuild";

// Exercise the actual navigation and rendering code with a delayed auth/API
// adapter. No browser session, credentials, or live backend is used.
const source = (await readFile("script.js", "utf8")).replace(
  "void bootstrap();",
  "globalThis.navigationTest = {bootstrap, readRoute};",
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
        export const client={auth:{getSession:()=>globalThis.service.getSession(),onAuthStateChange(){}}};
        export const run=()=>globalThis.service.workspace();
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
  const renders = [],
    attrs = new Map();
  let html = "";
  const app = {
    addEventListener() {},
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
    localStorage: { getItem: () => null },
    document: {
      compatMode: "CSS1Compat",
      querySelector: (selector) =>
        selector === "#app" ? app : selector === "main" ? { focus() {} } : null,
      addEventListener() {},
    },
    window: {
      addEventListener() {},
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
    throw Error("Access revoked");
  };
  await h.api.readRoute();
  assert.equal(h.location.pathname, "/sign-in");
  assert.match(h.app.innerHTML, /Continue with Google/);
  assert.equal(h.attrs.has("aria-busy"), false);
});
