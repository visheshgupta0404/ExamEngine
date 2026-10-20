export function draftKey(scope, route) {
  return (
    "examengine.editor." +
    encodeURIComponent(scope) +
    "." +
    encodeURIComponent(route)
  );
}
export function writeDraft(
  storage,
  scope,
  route,
  editor,
  fields,
  now = Date.now(),
) {
  const safe = structuredClone(editor);
  for (const q of safe.questions) if (q.imagePath) delete q.image;
  const value = JSON.stringify({
    version: 1,
    scope,
    route,
    savedAt: now,
    editor: safe,
    fields,
  });
  if (value.length > 2_000_000)
    throw new Error(
      "Recovery copy is too large. Save the assessment to keep your changes.",
    );
  storage.setItem(draftKey(scope, route), value);
}
export function readDraft(storage, scope, route, now = Date.now()) {
  try {
    const d = JSON.parse(storage.getItem(draftKey(scope, route)) || "null");
    if (
      !d ||
      d.version !== 1 ||
      d.scope !== scope ||
      d.route !== route ||
      !Number.isFinite(d.savedAt) ||
      now - d.savedAt > 86400000 ||
      d.savedAt > now + 60000 ||
      !Array.isArray(d.editor?.questions) ||
      !d.editor.questions.length ||
      d.editor.questions.length > 100 ||
      !Array.isArray(d.fields) ||
      d.fields.some(
        (f) =>
          !Array.isArray(f) ||
          f.length !== 2 ||
          f.some((v) => typeof v !== "string"),
      )
    )
      return null;
    return d;
  } catch {
    return null;
  }
}
export function removeDraft(storage, scope, route) {
  storage.removeItem(draftKey(scope, route));
}
export function clearEditorDrafts(storage) {
  for (let i = storage.length - 1; i >= 0; i--) {
    const key = storage.key(i);
    if (key?.startsWith("examengine.editor.")) storage.removeItem(key);
  }
}
