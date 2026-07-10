import fs from "fs";
import path from "path";

const FILE = path.join(process.cwd(), "repliedTweets.json");

// In-memory cache
let repliedCache: Set<string> | null = null;

function load(): Set<string> {
  if (repliedCache) {
    return repliedCache;
  }

  if (!fs.existsSync(FILE)) {
    repliedCache = new Set();
    return repliedCache;
  }

  const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
  repliedCache = new Set(data);
  return repliedCache;
}

function save() {
  if (repliedCache) {
    fs.writeFileSync(
      FILE,
      JSON.stringify([...repliedCache], null, 2)
    );
  }
}

export function hasReplied(id: string): boolean {
  return load().has(id);
}

export function markReplied(id: string): void {
  const ids = load();
  ids.add(id);
  save();
}