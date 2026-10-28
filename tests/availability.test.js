import test from "node:test";
import assert from "node:assert/strict";
import { checkBackend } from "../tools/check-backend.mjs";
import { testDatabase } from "../tools/test-database.mjs";
const config = {
  supabaseUrl: "https://example.supabase.co/",
  supabaseKey: "sb_publishable_example",
};
test("readiness probe uses only a public key and validates the exact response", async () => {
  const result = await checkBackend(config, async (url, options) => {
    assert.equal(
      url,
      "https://example.supabase.co/rest/v1/rpc/examengine_health",
    );
    assert.deepEqual(options.headers, {
      apikey: config.supabaseKey,
      "Content-Type": "application/json",
    });
    assert.equal(options.body, "{}");
    assert.equal(options.redirect, "error");
    return { ok: true, json: async () => ({ status: "ok", version: 1 }) };
  });
  assert.equal(result.status, "ok");
});
test("readiness fails for paused/missing endpoints and unexpected payloads without logging responses", async () => {
  await assert.rejects(
    checkBackend({}, () => assert.fail()),
    /configuration/,
  );
  for (const status of [401, 404, 503])
    await assert.rejects(
      checkBackend(config, async () => ({ ok: false, status })),
      new RegExp("HTTP " + status),
    );
  for (const value of [
    {},
    null,
    { status: "ok", version: 2 },
    { status: "ok", version: 1, private: "data" },
  ])
    await assert.rejects(
      checkBackend(config, async () => ({ ok: true, json: async () => value })),
      /Unexpected/,
    );
  await assert.rejects(
    checkBackend(config, async () => ({
      ok: true,
      json: async () => {
        throw Error("Bad JSON");
      },
    })),
    /invalid JSON/,
  );
});
test("public database probe returns only readiness and leaves private tables inaccessible", async () => {
  const pg = await testDatabase();
  try {
    const before = await pg.query(
      "select count(*)::int as n from exam_private.profiles",
    );
    await pg.exec("set role anon");
    assert.deepEqual(
      (await pg.query("select public.examengine_health() as data")).rows[0]
        .data,
      { status: "ok", version: 1 },
    );
    await assert.rejects(
      pg.query("select * from exam_private.attempts"),
      /permission denied/,
    );
    await assert.rejects(
      pg.query("select public.examengine('workspace','{}')"),
      /permission denied/,
    );
    await pg.exec("reset role");
    assert.deepEqual(
      (await pg.query("select count(*)::int as n from exam_private.profiles"))
        .rows,
      before.rows,
    );
    assert.equal(
      (
        await pg.query(
          "select prosecdef as elevated from pg_proc where oid='public.examengine_health()'::regprocedure",
        )
      ).rows[0].elevated,
      false,
    );
  } finally {
    await pg.close();
  }
});
