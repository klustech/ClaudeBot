import { openDatabase, Repository } from "@ct/database";
import { generateWeeklyReview } from "@ct/research";

const h = await openDatabase();
const r = await generateWeeklyReview(new Repository(h.db));
console.log(r.markdown);
console.log(`\nWritten to ${r.path}`);
await h.close();
