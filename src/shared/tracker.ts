// What the task a cadence tracker emits is called.
//
// SHARED because both sides need the same answer: the Worker writes the title
// when the 06:00 tick emits, and the client shows you what it is about to create
// before it happens. Two copies would drift the moment either changed, which is
// the lesson the three task renderers taught (see MISTAKES).

// A template rather than a literal title, so `{name}` stays in step with the
// tracker: rename "Ivka" to "Ivka Novak" and "Call {name}" follows, where a
// stored "Call Ivka" would quietly go stale. Unset falls back to the bare name,
// which is what emitting did before templates existed.
//
// Deliberately ONE placeholder. A tracker is a name and an interval; there is
// nothing else here worth interpolating, and every extra token is another thing
// to explain and mistype.
export function emittedTaskTitle(t: {
  name: string;
  task_title: string | null;
}): string {
  const tpl = t.task_title?.trim();
  if (!tpl) return t.name;
  const out = tpl.replace(/\{name\}/gi, t.name).replace(/\s+/g, " ").trim();
  // A template of only whitespace, or one that interpolates away to nothing,
  // must not produce a nameless task.
  return out || t.name;
}
