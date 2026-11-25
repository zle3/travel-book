import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Db } from "./db.ts";
import { createServer, type Config } from "./server.ts";

const env = process.env;
const cfg: Config = {
  adminToken: env.ADMIN_TOKEN ?? "",
  proxySecret: env.PROXY_SECRET ?? "",
  siteOrigin: env.SITE_ORIGIN || "https://travel.zachle.info",
  tilesUpstream: env.TILES_UPSTREAM || "http://tiles:8080",
  version: env.APP_VERSION || "0.1.0",
  adminRatePerMin: Number(env.ADMIN_RATE_PER_MIN) || 120,
  adminFailPerMin: Number(env.ADMIN_FAIL_PER_MIN) || 10,
};
if (!cfg.adminToken) console.warn("ADMIN_TOKEN is not set: /v1/admin/* will refuse every request");
if (!cfg.proxySecret) console.warn("PROXY_SECRET is not set: /v1/live is open until it is set");

const dbPath = env.DATABASE_PATH || "/data/live.sqlite";
mkdirSync(dirname(dbPath), { recursive: true });
const db = new Db(dbPath);
const server = createServer(cfg, db);
server.keepAliveTimeout = 65_000;
const port = Number(env.PORT) || 8787;
server.listen(port, "0.0.0.0", () => console.log(`travel-api ${cfg.version} listening on :${port}`));

const stop = (): void => { server.close(() => { db.close(); process.exit(0); }); setTimeout(() => process.exit(0), 5000).unref(); };
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
