import { mkdir, writeFile } from "node:fs/promises";
const [adminEmail, collegeName, domain] = process.argv.slice(2);
if (
  !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail || "") ||
  !collegeName ||
  !/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(domain || "")
)
  throw new Error(
    "Usage: node tools/provision.mjs ADMIN_EMAIL COLLEGE_NAME DOMAIN",
  );
const literal = (s) => "'" + s.replaceAll("'", "''") + "'";
await mkdir("work", { recursive: true });
await writeFile(
  "work/provision.local.sql",
  `-- Private one-time setup. Apply after migrations; never publish this file.\nbegin;\ninsert into exam_private.colleges(id,name,domains) values('bmu',${literal(collegeName)},array[${literal(domain)}]) on conflict(id) do nothing;\ninsert into exam_private.admin_emails(email) values(${literal(adminEmail.toLowerCase())}) on conflict do nothing;\ncommit;\n`,
);
console.log(
  "Prepared ignored work/provision.local.sql. No account or live resource was created.",
);
