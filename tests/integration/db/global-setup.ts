import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import type { TestProject } from "vitest/node";

const ROOT = path.resolve(import.meta.dirname, "../../..");

function adminUrl(): string {
  return process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/postgres";
}

function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

/**
 * Creates an isolated database, applies the Supabase shim and every migration in order,
 * and hands the connection string to the tests. The database is dropped afterwards unless
 * KEEP_TEST_DATABASE=1.
 */
export default async function setup(project: TestProject) {
  const database = `kj_test_${Date.now()}_${process.pid}`;
  const admin = new Client({ connectionString: adminUrl() });

  try {
    await admin.connect();
  } catch (error) {
    throw new Error(
      `Integration tests need PostgreSQL 15+ at TEST_DATABASE_URL (${adminUrl()}). ` +
        `See README "Running the database integration tests". Cause: ${(error as Error).message}`,
    );
  }

  await admin.query(`create database ${database}`);
  const url = withDatabase(adminUrl(), database);
  const db = new Client({ connectionString: url });
  await db.connect();

  try {
    await db.query("set client_min_messages = error");
    await db.query(readFileSync(path.join(ROOT, "tests/integration/db/supabase-shim.sql"), "utf8"));

    const migrationsDir = path.join(ROOT, "supabase/migrations");
    const migrations = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const file of migrations) {
      try {
        await db.query(readFileSync(path.join(migrationsDir, file), "utf8"));
      } catch (error) {
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
      }
    }

    // A bootstrap administrator exists so tests exercise the "not first user" signup path.
    await db.query("set role supabase_auth_admin");
    await db.query(
      `insert into auth.users (id, email, raw_user_meta_data)
       values ('00000000-0000-4000-8000-000000000001', 'bootstrap-admin@test.local', '{"display_name":"Bootstrap Admin"}')`,
    );
    await db.query("reset role");
    // Most tests create users freely; invite-only behaviour is tested explicitly.
    await db.query("update public.app_settings set registration_mode = 'open'");
  } finally {
    await db.end();
  }

  project.provide("databaseUrl", url);

  return async () => {
    if (process.env.KEEP_TEST_DATABASE === "1") {
      console.info(`Kept test database ${database}`);
      await admin.end();
      return;
    }
    await admin.query(`drop database if exists ${database} with (force)`);
    await admin.end();
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}
