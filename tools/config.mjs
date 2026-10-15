import { existsSync } from "node:fs";
import { normalizeBase } from "../src/routes.js";
export function publicConfig(preview = false) {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const supabaseUrl = process.env.SUPABASE_URL || "",
    supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY || "";
  if (supabaseKey.startsWith("sb_secret_"))
    throw new Error(
      "Secret keys cannot be bundled into the browser. Use the public publishable key.",
    );
  if (supabaseKey.split(".").length === 3) {
    try {
      if (
        JSON.parse(Buffer.from(supabaseKey.split(".")[1], "base64url")).role !==
        "anon"
      )
        throw new Error();
    } catch {
      throw new Error(
        "Invalid or private API key. Use a public publishable key.",
      );
    }
  }
  if (
    supabaseUrl &&
    !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(supabaseUrl)
  )
    throw new Error("SUPABASE_URL must be your HTTPS Supabase project URL.");
  if (!!supabaseUrl !== !!supabaseKey)
    throw new Error("Set both Supabase public configuration values.");
  const supportEmail = process.env.SUPPORT_EMAIL || "",
    privacyUrl = process.env.PRIVACY_POLICY_URL || "";
  if (supportEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail))
    throw new Error("Invalid public support email.");
  if (privacyUrl && !/^https:\/\//.test(privacyUrl))
    throw new Error("Privacy policy URL must use HTTPS.");
  const basePath = normalizeBase(process.env.APP_BASE_PATH || "/");
  return {
    preview,
    supabaseUrl,
    supabaseKey,
    supportEmail,
    privacyUrl,
    basePath,
  };
}
