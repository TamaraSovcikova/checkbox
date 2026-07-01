import { Hono } from "hono";
import { type Bindings, getUserId, uuid } from "../db";

export const push = new Hono<{ Bindings: Bindings }>();

// GET /vapid-public-key — browser subscribes using this key
push.get("/vapid-public-key", (c) => {
  if (!c.env.VAPID_PUBLIC_KEY) return c.json({ error: "push not configured" }, 503);
  return c.json({ key: c.env.VAPID_PUBLIC_KEY });
});

// GET /status — is push configured + how many subscriptions?
push.get("/status", async (c) => {
  const userId = await getUserId(c);
  const row = await c.env.DB.prepare(
    "SELECT COUNT(*) as n FROM push_subscriptions WHERE user_id = ?"
  )
    .bind(userId)
    .first<{ n: number }>();
  return c.json({
    configured: !!c.env.VAPID_PUBLIC_KEY,
    subscriptions: row?.n ?? 0,
  });
});

// POST /subscribe — save a push subscription (upsert by endpoint)
push.post("/subscribe", async (c) => {
  const userId = await getUserId(c);
  const body = await c.req.json<{
    endpoint: string;
    keys: { p256dh: string; auth: string };
  }>();
  if (!body.endpoint || !body.keys?.p256dh) return c.json({ error: "bad body" }, 400);

  await c.env.DB.prepare(
    `INSERT INTO push_subscriptions (id, user_id, endpoint, keys)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET keys = excluded.keys, user_id = excluded.user_id`
  )
    .bind(uuid(), userId, body.endpoint, JSON.stringify(body.keys))
    .run();

  return c.json({ ok: true });
});

// DELETE /subscribe — remove a specific subscription
push.delete("/subscribe", async (c) => {
  const userId = await getUserId(c);
  const body = await c.req.json<{ endpoint: string }>();
  await c.env.DB.prepare(
    "DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?"
  )
    .bind(userId, body.endpoint)
    .run();
  return c.json({ ok: true });
});

// GET /brief-data — lightweight summary fetched by the service worker when a push arrives
push.get("/brief-data", async (c) => {
  const userId = await getUserId(c);
  const today = new Date()
    .toLocaleDateString("en-CA", { timeZone: "Europe/Brussels" })
    .slice(0, 10);

  const { results } = await c.env.DB.prepare(
    `SELECT priority, due_date FROM tasks
     WHERE user_id = ? AND status != 'done'
       AND due_date IS NOT NULL AND due_date <= ?`
  )
    .bind(userId, today)
    .all<{ priority: number; due_date: string }>();

  const total = results.length;
  const urgent = results.filter((t) => t.priority <= 2).length;
  const overdue = results.filter((t) => t.due_date < today).length;

  const date = new Date().toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Europe/Brussels",
  });

  return c.json({ total, urgent, overdue, date });
});
