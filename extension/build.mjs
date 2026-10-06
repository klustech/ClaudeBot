// Builds the extension into dist/. Broker domains MUST be explicit:
//   BROKER_DOMAINS="https://broker.example.com/*" pnpm --filter @ct/extension build
// <all_urls> and wildcard hosts are refused.
import { build } from "esbuild";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const hosts = (process.env.BROKER_DOMAINS ?? "https://broker.example.invalid/*").split(",").map((s) => s.trim()).filter(Boolean);
for (const h of hosts) {
  if (h === "<all_urls>" || h.startsWith("*://") || /^https?:\/\/\*\/?/.test(h) || !/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}\/\*$/i.test(h)) {
    console.error(`Refusing broker host pattern "${h}". Use explicit https domains like https://broker.example.com/*`);
    process.exit(1);
  }
}
mkdirSync("dist", { recursive: true });
await build({
  entryPoints: { background: "src/background.ts", content: "src/content.ts", popup: "src/ui/popup.ts" },
  bundle: true,
  format: "esm",
  target: "chrome120",
  outdir: "dist",
  define: { __BROKER_HOSTS__: JSON.stringify(hosts) },
});
const manifest = JSON.parse(readFileSync("manifest.template.json", "utf8"));
manifest.host_permissions = [...hosts, "http://127.0.0.1:4100/*"];
manifest.content_scripts[0].matches = hosts;
writeFileSync("dist/manifest.json", JSON.stringify(manifest, null, 2));
copyFileSync("src/ui/popup.html", "dist/popup.html");
console.log(`extension built for ${hosts.join(", ")}`);
