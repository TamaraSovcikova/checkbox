// The user's timezone on the server side (#5). See shared/tz for the why.
import { DEFAULT_TZ, isValidTimeZone, todayIn, hhmmIn } from "../../shared/tz";

export async function userTz(db: D1Database, userId: string): Promise<string> {
  const row = await db
    .prepare("SELECT timezone FROM users WHERE id = ?")
    .bind(userId)
    .first<{ timezone: string | null }>();
  return isValidTimeZone(row?.timezone) ? row!.timezone! : DEFAULT_TZ;
}

// Today for this user, as YYYY-MM-DD.
export async function todayFor(db: D1Database, userId: string, now?: Date): Promise<string> {
  return todayIn(await userTz(db, userId), now);
}

// Current local time for this user, as HH:MM.
export async function nowHHMMFor(db: D1Database, userId: string, now?: Date): Promise<string> {
  return hhmmIn(await userTz(db, userId), now);
}
