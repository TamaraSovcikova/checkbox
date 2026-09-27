// Test dates, one copy. A day `offset` days from TODAY IN BRUSSELS (the
// default user timezone), counted in calendar days.
//
// The copies this replaces added days to the current instant in UTC and then
// formatted it in Brussels, which lands a day off whenever the offset crosses a
// daylight-saving change and the test runs late in the UTC day.
import { addDaysIso, todayIn } from "../src/shared/tz";

export const brussels = (offset = 0) => addDaysIso(todayIn("Europe/Brussels"), offset);
