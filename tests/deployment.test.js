import test from "node:test";
import assert from "node:assert/strict";
import { previewAllowed } from "../src/runtime.js";
import { publicConfig } from "../tools/config.mjs";
import { restoreSQL } from "../tools/restore.mjs";
test("development role switching is impossible on a hosted hostname", () => {
  assert.equal(previewAllowed("127.0.0.1", { preview: true }), true);
  assert.equal(previewAllowed("college.pages.dev", { preview: true }), false);
  assert.equal(previewAllowed("127.0.0.1", { preview: false }), false);
  assert.equal(
    previewAllowed("evil-localhost.example", { preview: true }),
    false,
  );
});
test("build configuration rejects private Supabase credentials", () => {
  const before = {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_PUBLISHABLE_KEY,
  };
  try {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_PUBLISHABLE_KEY = "sb_secret_TEST";
    assert.throws(() => publicConfig(), /Secret/);
    process.env.SUPABASE_PUBLISHABLE_KEY =
      "a." +
      Buffer.from(JSON.stringify({ role: "service_role" })).toString(
        "base64url",
      ) +
      ".z";
    assert.throws(() => publicConfig(), /private/);
  } finally {
    for (const [env, value] of [
      ["SUPABASE_URL", before.url],
      ["SUPABASE_PUBLISHABLE_KEY", before.key],
    ]) {
      if (value === undefined) delete process.env[env];
      else process.env[env] = value;
    }
  }
});
test("restore rejects invalid archives and escapes SQL literals", () => {
  assert.throws(() => restoreSQL({ format: 0 }), /Invalid/);
  const backup = {
    format: 1,
    colleges: [{ id: "test", name: "O'Brien", domains: ["test.edu"] }],
    admin_emails: [],
    professor_access: [],
    profiles: [],
    quizzes: [],
    versions: [],
    rosters: [],
    attempts: [],
  };
  assert.match(restoreSQL(backup), /O''Brien/);
  assert.match(restoreSQL(backup), /empty assessment database/);
});
