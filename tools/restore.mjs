import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const tables = [
  "colleges",
  "admin_emails",
  "professor_access",
  "profiles",
  "quizzes",
  "versions",
  "rosters",
  "attempts",
];
export function restoreSQL(backup) {
  if (backup.format !== 1 || tables.some((t) => !Array.isArray(backup[t])))
    throw new Error("Invalid ExamEngine backup.");
  const sql = [
    "begin; set standard_conforming_strings=on;",
    "do $$ begin if exists(select 1 from exam_private.quizzes) or exists(select 1 from exam_private.attempts) then raise exception 'Restore requires an empty assessment database. Do not overwrite existing data.'; end if; end $$;",
  ];
  const quote = (value) =>
    "'" + JSON.stringify(value).replaceAll("'", "''") + "'::jsonb";
  for (const table of tables)
    for (const row of backup[table]) {
      const value =
        table === "quizzes" ? { ...row, current_version: null } : row;
      sql.push(
        `insert into exam_private.${table} select * from jsonb_populate_record(null::exam_private.${table},${quote(value)}) on conflict do nothing;`,
      );
    }
  for (const row of backup.quizzes)
    if (row.current_version)
      sql.push(
        `update exam_private.quizzes set current_version=${"'" + String(row.current_version).replaceAll("'", "''") + "'"} where id=${"'" + String(row.id).replaceAll("'", "''") + "'"};`,
      );
  sql.push("commit;");
  return sql.join("\n");
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output)
    throw new Error("Usage: node tools/restore.mjs BACKUP.json RESTORE.sql");
  await writeFile(
    output,
    restoreSQL(JSON.parse(await readFile(input, "utf8"))),
  );
  console.log(
    "Restore SQL prepared. Review it and apply only to the same project with its original auth.users identities.",
  );
}
