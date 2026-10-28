import { pathToFileURL } from "node:url";
import { publicConfig } from "./config.mjs";
export async function checkBackend(config, request = fetch) {
  if (!config.supabaseUrl || !config.supabaseKey)
    throw new Error(
      "Backend configuration is missing. Set the existing Supabase repository variables.",
    );
  const response = await request(
    config.supabaseUrl.replace(/\/$/, "") + "/rest/v1/rpc/examengine_health",
    {
      method: "POST",
      headers: {
        apikey: config.supabaseKey,
        "Content-Type": "application/json",
      },
      body: "{}",
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    },
  );
  if (!response.ok)
    throw new Error(
      `Database readiness check failed (HTTP ${response.status}). Check project status and migration 005; a paused project must be resumed in Supabase.`,
    );
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("Database readiness check returned invalid JSON.");
  }
  if (
    data?.status !== "ok" ||
    data?.version !== 1 ||
    Object.keys(data).some((k) => !["status", "version"].includes(k))
  )
    throw new Error("Unexpected database readiness response.");
  return { status: "ok", checkedAt: new Date().toISOString() };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    console.log(JSON.stringify(await checkBackend(publicConfig())));
  } catch (error) {
    console.error(
      error instanceof TypeError
        ? "Database readiness request could not connect. Check Supabase project status."
        : error.message,
    );
    process.exitCode = 1;
  }
}
