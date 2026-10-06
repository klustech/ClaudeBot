import { openDatabase, Repository } from "@ct/database";
import { generateDailyReport } from "@ct/research";

const h = await openDatabase();
const r = await generateDailyReport(new Repository(h.db));
console.log(r.markdown);
console.log(`\nWritten to ${r.path}`);
await h.close();
