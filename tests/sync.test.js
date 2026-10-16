import test from "node:test";
import assert from "node:assert/strict";
import { conflictingSave, latestAttempt } from "../src/sync.js";
import { apiError, isAccessDenied } from "../src/errors.js";
test("equal save revisions detect rejected changes from another tab", () => {
  const payload = {
    revision: 3,
    answers: { b: [1, 2], a: 0 },
    flagged: ["a", "b"],
    current: 1,
  };
  const response = {
    ...payload,
    status: "active",
    answers: { a: 0, b: [1, 2] },
    flagged: ["b", "a"],
  };
  assert.equal(conflictingSave(response, payload), false);
  assert.equal(
    conflictingSave({ ...response, answers: { a: 1, b: [1, 2] } }, payload),
    true,
  );
  assert.equal(conflictingSave({ ...response, current: 0 }, payload), true);
  assert.equal(conflictingSave({ ...response, revision: 4 }, payload), true);
  assert.equal(
    conflictingSave({ ...response, status: "submitted" }, payload),
    false,
  );
});
test("latest submission is selected independently of backend ordering", () => {
  const old = { id: "old", submittedAt: 100 },
    recent = { id: "recent", submittedAt: 300 };
  assert.equal(latestAttempt([old, recent]).id, "recent");
  assert.equal(latestAttempt([recent, old]).id, "recent");
  assert.equal(latestAttempt([]), null);
});
test("access failures are distinct from transient server and network errors", () => {
  assert.equal(
    isAccessDenied(apiError({ message: "revoked", code: "42501" }, 200)),
    true,
  );
  assert.equal(isAccessDenied(apiError({ message: "expired" }, 401)), true);
  assert.equal(
    isAccessDenied(apiError({ message: "busy", code: "RATE_LIMIT" }, 200)),
    false,
  );
  assert.equal(
    isAccessDenied(apiError({ message: "unavailable" }, 503)),
    false,
  );
  assert.equal(isAccessDenied(new TypeError("Failed to fetch")), false);
});
