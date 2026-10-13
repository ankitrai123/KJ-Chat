import { randomUUID } from "node:crypto";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { afterAll, inject } from "vitest";

export const pool = new Pool({ connectionString: inject("databaseUrl"), max: 4 });

afterAll(async () => {
  await pool.end();
});

export type Role = "anon" | "authenticated" | "service_role";

export interface DbError extends Error {
  code?: string;
  hint?: string;
}

async function inTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Runs SQL exactly as PostgREST would for a request: inside a transaction, with the
 * database role switched and the verified JWT claims exposed via request.jwt.claims.
 */
export async function queryAs<T extends QueryResultRow = QueryResultRow>(
  role: Role,
  userId: string | null,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return inTransaction(async (client) => {
    await client.query(`set local role ${role}`);
    const claims = userId ? { sub: userId, role } : { role };
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    const result = await client.query<T>(sql, params);
    return result.rows;
  });
}

export const asUser = <T extends QueryResultRow = QueryResultRow>(userId: string, sql: string, params: unknown[] = []) =>
  queryAs<T>("authenticated", userId, sql, params);

export const asService = <T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []) =>
  queryAs<T>("service_role", null, sql, params);

export const asAnon = <T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []) =>
  queryAs<T>("anon", null, sql, params);

/** Superuser access for arranging fixtures that no API path can create directly. */
export async function asOwner<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []) {
  const result = await pool.query<T>(sql, params);
  return result.rows;
}

/** Evaluates a query as the Realtime server does when authorising a private channel. */
export async function realtimeAs(userId: string, topic: string, sql: string, params: unknown[] = []) {
  return inTransaction(async (client) => {
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    await client.query("select set_config('realtime.topic', $1, true)", [topic]);
    const result = await client.query(sql, params);
    return result.rows;
  });
}

export async function expectDbError(promise: Promise<unknown>, match?: { code?: string; hint?: string; message?: RegExp }) {
  try {
    await promise;
  } catch (error) {
    const err = error as DbError;
    if (match?.code && err.code !== match.code) {
      throw new Error(`Expected error code ${match.code} but got ${err.code}: ${err.message}`);
    }
    if (match?.hint && err.hint !== match.hint) {
      throw new Error(`Expected hint ${match.hint} but got ${err.hint}: ${err.message}`);
    }
    if (match?.message && !match.message.test(err.message)) {
      throw new Error(`Expected message ${match.message} but got: ${err.message}`);
    }
    return err;
  }
  throw new Error("Expected the database to reject the operation, but it succeeded");
}

export interface TestUser {
  id: string;
  email: string;
  username: string;
}

let counter = 0;

/** Creates a user through auth.users (as the Auth server would), firing the real signup trigger. */
export async function createUser(options: { displayName?: string; inviteCode?: string; email?: string } = {}) {
  counter += 1;
  const id = randomUUID();
  const username = `u_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const email = options.email ?? `${username}@test.local`;
  const metadata: Record<string, string> = { display_name: options.displayName ?? `User ${counter}` };
  if (options.inviteCode) metadata.invite_code = options.inviteCode;

  await inTransaction(async (client) => {
    await client.query("set local role supabase_auth_admin");
    await client.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [id, email, metadata]);
  });
  await asUser(id, "update public.profiles set username = $1 where id = $2", [username, id]);

  return { id, email, username } satisfies TestUser;
}

export async function createUsers(count: number) {
  const users: TestUser[] = [];
  for (let i = 0; i < count; i += 1) users.push(await createUser());
  return users;
}

export async function directConversation(a: TestUser, b: TestUser) {
  const [row] = await asUser<{ id: string }>(a.id, "select public.get_or_create_direct_conversation($1) as id", [b.id]);
  return row.id;
}

export async function createGroup(owner: TestUser, members: TestUser[], name = "Test group") {
  const [row] = await asUser<{ id: string }>(owner.id, "select public.create_group($1, null, $2::uuid[]) as id", [
    name,
    members.map((m) => m.id),
  ]);
  return row.id;
}

export async function sendMessage(
  sender: TestUser,
  conversationId: string,
  content: string | null,
  extra: { replyTo?: string; attachments?: unknown[]; clientId?: string } = {},
) {
  const [row] = await asService<{ id: string; created_at: Date; conversation_id: string; message_type: string }>(
    "select * from public.send_message($1, $2, $3, $4, $5, $6::jsonb, false)",
    [
      sender.id,
      conversationId,
      extra.clientId ?? randomUUID(),
      content,
      extra.replyTo ?? null,
      JSON.stringify(extra.attachments ?? []),
    ],
  );
  return row;
}

/** Simulates a completed upload by inserting the storage row the Storage server would create. */
export async function storeObject(owner: TestUser, bucket: string, name: string, size = 1234, mimetype = "image/png") {
  return queryAs("authenticated", owner.id, "insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ($1, $2, $3, $4, $5) returning id", [
    bucket,
    name,
    owner.id,
    owner.id,
    JSON.stringify({ size, mimetype }),
  ]);
}

export function attachmentPath(conversationId: string, uploader: TestUser, fileName = "photo.png") {
  return `${conversationId}/${uploader.id}/${randomUUID()}/${fileName}`;
}
