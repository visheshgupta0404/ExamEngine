// Runtime auth is connected in the final feature step. RPC calls never use a service-role key.
import { createClient } from "@supabase/supabase-js";
import { previewAllowed } from "./runtime.js";
const config = globalThis.EXAMENGINE_CONFIG || {};
export const preview = previewAllowed(location.hostname, config);
export const configured = Boolean(config.supabaseUrl && config.supabaseKey);
export const client = configured
  ? createClient(config.supabaseUrl, config.supabaseKey, {
      auth: {
        flowType: "pkce",
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null;
export async function run(operation, payload = {}) {
  if (!client) throw new Error("Backend configuration is missing.");
  const { data, error } = await client.rpc("examengine", {
    operation,
    payload,
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  if (data?.quizzes && data?.attempts) await resolveImages(data);
  return data;
}
export async function uploadImage(file, actorId) {
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    file.size > 5 * 1024 * 1024
  )
    throw new Error("Choose a PNG, JPEG, or WebP image under 5 MB.");
  const extension = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
  }[file.type];
  const path = actorId + "/" + crypto.randomUUID() + "." + extension;
  const { error } = await client.storage
    .from("question-images")
    .upload(path, file, { upsert: false, contentType: file.type });
  if (error) throw new Error(error.message);
  const { data, error: signError } = await client.storage
    .from("question-images")
    .createSignedUrl(path, 600);
  if (signError) throw new Error(signError.message);
  return { path, url: data.signedUrl };
}
const imageCache = new Map();
export async function resolveImages(workspace) {
  if (!client) return;
  const questions = [
    ...workspace.quizzes.flatMap((q) => q.questions),
    ...workspace.attempts.flatMap((a) => a.quiz.questions),
  ];
  const paths = [...new Set(questions.map((q) => q.imagePath).filter(Boolean))];
  await Promise.all(
    paths.map(async (path) => {
      let cached = imageCache.get(path);
      if (!cached || cached.until < Date.now()) {
        const { data, error } = await client.storage
          .from("question-images")
          .createSignedUrl(path, 600);
        if (error) return;
        cached = { url: data.signedUrl, until: Date.now() + 480000 };
        imageCache.set(path, cached);
      }
      questions
        .filter((q) => q.imagePath === path)
        .forEach((q) => (q.image = cached.url));
    }),
  );
}
