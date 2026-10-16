import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { build } from "esbuild";
const bundled = await build({
  entryPoints: ["src/service.js"],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "Service",
  plugins: [
    {
      name: "fake-supabase",
      setup(build) {
        build.onResolve({ filter: /^@supabase\/supabase-js$/ }, () => ({
          path: "client",
          namespace: "fixture",
        }));
        build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: "export const createClient=()=>globalThis.client;",
        }));
      },
    },
  ],
});
function service() {
  const client = {
    auth: {
      onAuthStateChange(fn) {
        client.onAuth = fn;
      },
    },
    rpc: async () => ({ data: { ok: true }, status: 200 }),
  };
  const context = vm.createContext({
    client,
    location: { hostname: "test.example" },
    EXAMENGINE_CONFIG: {
      supabaseUrl: "https://test.supabase.co",
      supabaseKey: "public-key",
    },
  });
  vm.runInContext(bundled.outputFiles[0].text, context);
  client.onAuth("INITIAL_SESSION", { user: { id: "one" } });
  return { client, api: context.Service };
}
test("API discards private responses when identity changes in flight", async () => {
  const { client, api } = service();
  let resolve;
  client.rpc = () => new Promise((yes) => (resolve = yes));
  const pending = api.run("workspace");
  client.onAuth("SIGNED_OUT", null);
  client.onAuth("SIGNED_IN", { user: { id: "two" } });
  resolve({ data: { private: "old account" }, status: 200 });
  await assert.rejects(pending, (error) => error.code === "SESSION_CHANGED");
});
test("ordinary token refresh for the same user does not discard responses", async () => {
  const { client, api } = service();
  let resolve;
  client.rpc = () => new Promise((yes) => (resolve = yes));
  const pending = api.run("workspace");
  client.onAuth("TOKEN_REFRESHED", { user: { id: "one" } });
  resolve({ data: { ok: true }, status: 200 });
  assert.equal((await pending).ok, true);
});
test("API preserves backend permission codes and HTTP status", async () => {
  const { client, api } = service();
  client.rpc = async () => ({
    data: { error: "Denied", code: "42501" },
    status: 200,
  });
  await assert.rejects(
    api.run("workspace"),
    (error) => error.code === "42501" && error.status === 200,
  );
  client.rpc = async () => ({
    error: { message: "Temporary outage" },
    status: 503,
  });
  await assert.rejects(api.run("workspace"), (error) => error.status === 503);
});
