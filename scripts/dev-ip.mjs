// Points both apps' local .env at this computer's current network address.
//
// A phone running Expo Go reaches the local Supabase over Wi-Fi, so the apps
// carry this machine's LAN address. When the router hands the laptop a new one
// - a new day, a new network - every request from the phone quietly times out
// and the apps sit on a blank screen. Run `pnpm dev:ip`, then restart Expo.
import { networkInterfaces } from "node:os";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const candidates = Object.values(networkInterfaces())
  .flat()
  .filter((i) => i && i.family === "IPv4" && !i.internal)
  .map((i) => i.address)
  // Home and office Wi-Fi first; virtual adapters (WSL, Docker) last.
  .sort((a, b) => Number(!a.startsWith("192.168.")) - Number(!b.startsWith("192.168.")));

const ip = process.argv[2] ?? candidates[0];
if (!ip) {
  console.error("No network address found. Are you connected to Wi-Fi?");
  process.exit(1);
}

for (const app of ["passenger", "rider"]) {
  const file = `apps/${app}/.env`;
  if (!existsSync(file)) {
    console.log(`${file}: missing, skipped (copy .env.example first)`);
    continue;
  }
  const before = readFileSync(file, "utf8");
  const after = before.replace(/^(EXPO_PUBLIC_SUPABASE_URL=http:\/\/)[^:\s]+(:\d+)/m, `$1${ip}$2`);
  writeFileSync(file, after);
  console.log(`${file}: ${before === after ? "already" : "now"} http://${ip}:54321`);
}
if (candidates.length > 1 && !process.argv[2]) {
  console.log(`\nOther addresses on this machine: ${candidates.slice(1).join(", ")}`);
  console.log("If the phone still cannot connect, pass the right one: pnpm dev:ip 192.168.x.y");
}
console.log("\nRestart Expo with --clear so the apps pick it up.");
