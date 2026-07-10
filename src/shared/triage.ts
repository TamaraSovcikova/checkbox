// Deterministic backlog triage scoring.
//
// The old version compared a task title only against the area/project NAME, so
// "Buy oat milk" never matched an area called "Health" and every suggestion came
// back as "no match". This version builds a vocabulary for each destination from
// the tasks already filed there (plus its name, description and goal), then scores
// a backlog task against those vocabularies with IDF weighting, so rare, telling
// words ("invoice", "physio") count far more than words shared by everything.
//
// Pure and dependency-free so it can be unit tested and run inside the Worker.

export type TriageDest = {
  id: string;
  kind: "area" | "project";
  name: string;
  areaId: string | null;
  // Everything we know about this destination: its name/description/goal plus the
  // titles and notes of tasks already filed there.
  corpus: string;
};

export type TriageScore = {
  dest: TriageDest;
  score: number; // 0..1
  matched: string[]; // task tokens that hit this destination
};

// Words too common to carry signal. Deliberately small: IDF handles the rest.
const STOP = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "can", "had",
  "one", "our", "out", "get", "has", "how", "its", "may", "new", "now",
  "see", "two", "who", "did", "let", "put", "say", "use", "add", "fix",
  "make", "with", "from", "that", "this", "have", "been", "will", "would",
  "could", "should", "some", "also", "when", "then", "just", "into", "need",
  "task", "todo", "about", "over", "back", "down", "your", "mine", "more",
]);

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

// Light stemming so "reports"/"report" and "meetings"/"meeting" collide.
function stem(w: string): string {
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 4 && w.endsWith("es")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
  return w;
}

const stemSet = (s: string) => new Set(tokenize(s).map(stem));

// A destination's name is an explicit signal, so a direct name hit gets a bonus
// on top of the corpus similarity.
const NAME_BONUS = 0.25;

// Below this, we do not claim a match (the caller falls back).
export const TRIAGE_THRESHOLD = 0.18;

/**
 * Score a backlog task against every destination, best first.
 * `score` is the share of the task's IDF mass that the destination explains.
 */
export function scoreDestinations(
  title: string,
  notes: string | null,
  dests: TriageDest[]
): TriageScore[] {
  if (dests.length === 0) return [];

  const docs = dests.map((d) => stemSet(d.corpus));
  const names = dests.map((d) => stemSet(d.name));
  const N = docs.length;

  // Document frequency across destinations.
  const df = new Map<string, number>();
  for (const doc of docs) {
    for (const t of doc) df.set(t, (df.get(t) ?? 0) + 1);
  }
  // Rare-across-destinations tokens weigh more.
  const idf = (t: string) => Math.log(1 + N / (1 + (df.get(t) ?? 0)));

  const taskTokens = [...new Set(tokenize(`${title} ${notes ?? ""}`).map(stem))];
  const totalMass = taskTokens.reduce((sum, t) => sum + idf(t), 0);
  if (totalMass === 0) return [];

  return dests
    .map((dest, i) => {
      const doc = docs[i];
      const matched = taskTokens.filter((t) => doc.has(t));
      const mass = matched.reduce((sum, t) => sum + idf(t), 0);
      const nameHit = taskTokens.some((t) => names[i].has(t));
      const score = Math.min(1, mass / totalMass + (nameHit ? NAME_BONUS : 0));
      return { dest, score, matched };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
}

/**
 * Pick the best destination for a task, preferring a project over its parent area
 * when both score comparably (a project is the more specific answer).
 */
export function bestDestination(
  title: string,
  notes: string | null,
  dests: TriageDest[]
): TriageScore | null {
  const ranked = scoreDestinations(title, notes, dests);
  if (ranked.length === 0 || ranked[0].score < TRIAGE_THRESHOLD) return null;

  const top = ranked[0];
  // If an area barely edges out a project, prefer the project.
  const project = ranked.find((r) => r.dest.kind === "project");
  if (project && top.dest.kind === "area" && project.score >= top.score - 0.05) {
    return project;
  }
  return top;
}
