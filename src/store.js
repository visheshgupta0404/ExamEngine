import { seedData } from "./data.js";
const KEY = "examengine.local.v1";
export function loadStore() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (
      saved?.version === 1 &&
      Array.isArray(saved.quizzes) &&
      Array.isArray(saved.attempts) &&
      saved.colleges?.length &&
      Array.isArray(saved.professors) &&
      saved.identity
    )
      return saved;
  } catch {
    /* Recover a local workspace from unavailable or corrupt storage. */
  }
  return seedData();
}
export function saveStore(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}
