import { openDatabase } from "@ct/database";

const h = await openDatabase();
console.log(`Migrations applied (${h.kind}).`);
await h.close();
