import { readFile, writeFile, mkdir } from "node:fs/promises";

// Generates local setup material only. Never contacts a cloud service.
const paths = [
  "backend/migrations/001_examengine.sql",
  "backend/migrations/002_question_images.sql",
  "backend/migrations/003_maintenance.sql",
  "backend/migrations/004_assessment_integrity.sql",
  "backend/migrations/005_availability.sql",
  "work/provision.local.sql",
];
let sources;
try {
  sources = await Promise.all(paths.map((path) => readFile(path, "utf8")));
} catch (error) {
  if (error.code === "ENOENT")
    throw new Error(
      "A setup input is missing. Generate work/provision.local.sql with tools/provision.mjs first; see docs/DEPLOYMENT.md.",
    );
  throw error;
}
await mkdir("work", { recursive: true });
await writeFile(
  "work/setup.local.sql",
  "-- PRIVATE INITIAL SETUP: run once in a NEW, EMPTY Supabase project.\n" +
    "-- Includes administrator provisioning. Do not commit, share, or re-run on an existing installation.\n\n" +
    sources
      .map((source, index) => `-- Source: ${paths[index]}\n${source.trim()}\n`)
      .join("\n"),
);
console.log(
  "Prepared ignored work/setup.local.sql. Run this once OR apply the individual migrations, not both. No live database was changed.",
);
