// Today's Focus (#3): GET today's ordered focus (+ yesterday's leftovers to
// carry over), PUT the whole ordered list. See lib/focus.

import { Hono } from "hono";
import { type Bindings, getUserId } from "../db";
import { hydrateTasks } from "./_hydrate";
import { todayFor } from "../lib/tz";
import { getFocus, setFocus } from "../lib/focus";

export const focus = new Hono<{ Bindings: Bindings }>();

focus.get("/", async (c) => {
  const userId = await getUserId(c);
  const today = await todayFor(c.env.DB, userId);
  const { current, carry } = await getFocus(c.env.DB, userId, today);
  return c.json({
    today,
    tasks: await hydrateTasks(c.env.DB, current),
    carryover: await hydrateTasks(c.env.DB, carry),
  });
});

focus.put("/", async (c) => {
  const userId = await getUserId(c);
  const body = await c.req.json<{ ids?: unknown }>();
  if (!Array.isArray(body.ids) || !body.ids.every((x) => typeof x === "string"))
    return c.json({ error: "ids must be an array of task ids" }, 400);
  const today = await todayFor(c.env.DB, userId);
  const r = await setFocus(c.env.DB, userId, body.ids as string[], today);
  if (!r.ok) return c.json({ error: r.error }, 400);
  return c.json({ ids: r.ids });
});
