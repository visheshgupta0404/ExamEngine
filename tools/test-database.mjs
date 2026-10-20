import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
export async function testDatabase() {
  const pg = await PGlite.create();
  await pg.exec(`create role anon; create role authenticated; create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_app_meta_data jsonb,raw_user_meta_data jsonb);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
  await pg.exec(
    await readFile("backend/migrations/001_examengine.sql", "utf8"),
  );
  await pg.exec(
    `create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant insert,select on storage.objects to authenticated;`,
  );
  for (const file of [
    "002_question_images.sql",
    "003_maintenance.sql",
    "004_assessment_integrity.sql",
  ])
    await pg.exec(await readFile("backend/migrations/" + file, "utf8"));
  return pg;
}
export async function request(pg, user, operation, payload = {}) {
  // A single queued PostgreSQL batch scopes every request's identity to its transaction.
  const literal = (value) => "'" + String(value).replaceAll("'", "''") + "'";
  const result = await pg.exec(
    `begin; select set_config('request.jwt.claim.sub',${literal(user)},true); set local role authenticated; select public.examengine(${literal(operation)},${literal(JSON.stringify(payload))}::jsonb) as data; commit;`,
  );
  const data = result.find((r) => r.fields?.some((f) => f.name === "data"))
    ?.rows[0].data;
  if (data?.error) throw new Error(data.error);
  return data;
}
