export function apiError(error, status) {
  return Object.assign(
    new Error(error.message || error.error || "The request failed."),
    {
      code: error.code,
      status: status || error.status,
    },
  );
}
export function isAccessDenied(error) {
  return (
    [401, 403].includes(error.status) ||
    ["42501", "PGRST301", "PGRST302", "PGRST303", "SESSION_CHANGED"].includes(
      error.code,
    )
  );
}
