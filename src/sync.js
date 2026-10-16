function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
export function conflictingSave(response, payload) {
  if (response.status !== "active") return false;
  if (response.revision > payload.revision) return true;
  return (
    response.revision === payload.revision &&
    (JSON.stringify(canonical(response.answers || {})) !==
      JSON.stringify(canonical(payload.answers || {})) ||
      response.current !== payload.current ||
      JSON.stringify([...(response.flagged || [])].sort()) !==
        JSON.stringify([...payload.flagged].sort()))
  );
}
export function latestAttempt(attempts) {
  return attempts.reduce(
    (latest, attempt) =>
      !latest ||
      (attempt.submittedAt || attempt.startedAt) >
        (latest.submittedAt || latest.startedAt)
        ? attempt
        : latest,
    null,
  );
}
