// The app's task views. The queries live in lib/viewSql, shared with the Claude
// connector, so what a view shows is decided in one place.
import { Hono } from "hono";
import { type Bindings, getUserId } from "../db";
import { hydrateTasks } from "./_hydrate";
import { todayFor } from "../lib/tz";
import { viewQuery, type TaskView } from "../lib/viewSql";

export const views = new Hono<{ Bindings: Bindings }>();

const APP_VIEWS: TaskView[] = [
  "today",
  "upcoming",
  "overdue",
  "backlog",
  "whenever",
  "parked",
  "snoozed",
  "logbook",
  "completed-today",
]

for (const name of APP_VIEWS) {
  views.get(`/${name}`, async (c) => {
    const userId = await getUserId(c);
    const { sql, binds } = viewQuery(name, userId, await todayFor(c.env.DB, userId));
    const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
    return c.json(await hydrateTasks(c.env.DB, results as Record<string, unknown>[]));
  });
}
