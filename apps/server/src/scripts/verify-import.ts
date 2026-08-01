/* eslint-disable no-console */
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { loadStudioContext, studioContextToPrompt } from "../utils/studio-context.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB = path.join(__dirname, "..", "..", "..", "..", "data", "db.sqlite");

const id = Number(process.argv[2] ?? 3);
const sqlite = new Database(DB);
const ctx = loadStudioContext(sqlite, id);

console.log("book:", id);
console.log("concept logline:", ctx.concept?.premise.logline ?? "(none)");
console.log("world aspects:", ctx.worldAspects.map((a) => a.name));
console.log("lore aspects:", ctx.loreAspects.map((a) => a.name));
console.log("plot aspects:", ctx.plotAspects.map((a) => a.name));
console.log("prompt length:", studioContextToPrompt(ctx)?.length ?? 0);

const chars = sqlite
  .prepare("SELECT id, canonical_name FROM characters WHERE book_id = ? ORDER BY id")
  .all(id);
console.log("characters:", chars);
sqlite.close();
