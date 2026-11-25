import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const here = new URL(".", import.meta.url).pathname;
const docker = spawnSync("docker", ["compose", "version"]).status === 0;
const REQUIRED = { ADMIN_TOKEN: "a", PROXY_SECRET: "p", DISCORD_OWNER_ID: "2", DISCORD_BOT_TOKEN: "b", DISCORD_PLANNER_CHANNEL_ID: "1", TUNNEL_TOKEN: "t" };

function config(env, withEnvFile = false) {
  const dir = mkdtempSync(join(tmpdir(), "compose-"));
  copyFileSync(join(here, "compose.yaml"), join(dir, "compose.yaml"));
  // `docker compose config` needs the build contexts to exist.
  spawnSync("mkdir", ["-p", join(dir, "api"), join(dir, "bot"), join(dir, "tiles")]);
  return spawnSync("docker", ["compose", "-f", join(dir, "compose.yaml"), "config", "--format", "json"], { env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env }, encoding: "utf8" });
}

test("compose.yaml and env.example agree on required secrets, and env.example holds placeholders only", () => {
  const compose = readFileSync(join(here, "compose.yaml"), "utf8");
  const example = readFileSync(join(here, "env.example"), "utf8");
  for (const k of Object.keys(REQUIRED)) { assert.match(compose, new RegExp(`\\$\\{${k}:\\?`)); assert.match(example, new RegExp(`^${k}=`, "m")); }
  assert.doesNotMatch(compose, /PUID|PGID/);
  assert.doesNotMatch(example, /PUID|PGID/);
  assert.doesNotMatch(compose, /^\s+ports:/m, "no ports published on the host");
  assert.match(compose, /ANTHROPIC_API_KEY: \$\{ANTHROPIC_API_KEY:-\}/);
  for (const l of example.split("\n")) if (/^(ADMIN_TOKEN|PROXY_SECRET|TUNNEL_TOKEN|DISCORD_BOT_TOKEN|ANTHROPIC_API_KEY)=/.test(l)) assert.match(l, /=(change-me)?$/, "placeholder only: " + l);
  for (const img of compose.match(/image: \S+/g)) assert.doesNotMatch(img, /:latest/);
});

test("docker compose config: valid with the required secrets, four services, healthchecks, no host ports", { skip: !docker }, () => {
  const r = config(REQUIRED);
  assert.equal(r.status, 0, r.stderr);
  const c = JSON.parse(r.stdout);
  assert.deepEqual(Object.keys(c.services).sort(), ["api", "bot", "cloudflared", "tiles"]);
  for (const s of ["api", "bot", "cloudflared"]) assert.ok(c.services[s].healthcheck, `${s} healthcheck`);
  for (const s of Object.values(c.services)) assert.equal(s.ports, undefined);
  assert.equal(c.services.bot.environment.ANTHROPIC_MODEL, "claude-opus-5-5");
  assert.equal(c.services.bot.environment.ANTHROPIC_API_KEY, "");
  assert.deepEqual(Object.keys(c.volumes).sort(), ["api_data", "bot_data"]);
});

for (const missing of Object.keys(REQUIRED)) {
  test(`docker compose config: refuses to start without ${missing}`, { skip: !docker }, () => {
    const env = { ...REQUIRED }; delete env[missing];
    const r = config(env);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, new RegExp(missing));
  });
}
