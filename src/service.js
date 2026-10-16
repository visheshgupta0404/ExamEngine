// RPC calls use the signed-in session and never a service-role key.
import { createClient } from "@supabase/supabase-js";
import { previewAllowed } from "./runtime.js";
import { apiError } from "./errors.js";
const imageCache = new Map();
let identityId = null,
  sessionGeneration = 0;
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
client?.auth.onAuthStateChange((event, session) => {
  const nextId = session?.user?.id || null;
  if (nextId !== identityId || event === "SIGNED_OUT") {
    identityId = nextId;
    sessionGeneration++;
    imageCache.clear();
  }
});
function verifySession(generation) {
  if (generation !== sessionGeneration)
    throw apiError({
      message: "Your session changed. Please reopen your workspace.",
      code: "SESSION_CHANGED",
    });
}
export async function run(operation, payload = {}) {
  if (!client) throw new Error("Backend configuration is missing.");
  const generation = sessionGeneration;
  const { data, error, status } = await client.rpc("examengine", {
    operation,
    payload,
  });
  verifySession(generation);
  if (error) throw apiError(error, status);
  if (data?.error) throw apiError(data, status);
  if (data?.quizzes && data?.attempts) await resolveImages(data);
  verifySession(generation);
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
export async function resolveImages(workspace) {
  if (!client) return;
  const generation = sessionGeneration;
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
        verifySession(generation);
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
