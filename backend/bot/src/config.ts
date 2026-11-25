export interface Config {
  discordToken: string; channelId: string; ownerId: string;
  apiBase: string; adminToken: string;
  anthropicKey: string | null; model: string;
  dbPath: string; heartbeatPath: string;
  checkIntervalMin: number; reactionWindowDays: number; maxAttempts: number; tz: string;
}
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const need = (k: string): string => { const v = env[k]?.trim(); if (!v) throw new Error(`${k} is required`); return v; };
  const num = (k: string, d: number, min: number): number => { const n = Number(env[k]); return Number.isFinite(n) && n >= min && env[k] ? n : d; };
  return {
    discordToken: need("DISCORD_BOT_TOKEN"),
    channelId: need("DISCORD_PLANNER_CHANNEL_ID"),
    ownerId: need("DISCORD_OWNER_ID"),
    apiBase: (env.API_BASE || "http://api:8787").replace(/\/$/, ""),
    adminToken: need("ADMIN_TOKEN"),
    anthropicKey: env.ANTHROPIC_API_KEY?.trim() || null,
    model: env.ANTHROPIC_MODEL?.trim() || "claude-opus-5-5",
    dbPath: env.BOT_DB_PATH || "/data/bot.sqlite",
    heartbeatPath: env.HEARTBEAT_PATH || "/data/heartbeat",
    checkIntervalMin: num("CHECK_INTERVAL_MIN", 5, 0.05),
    reactionWindowDays: num("REACTION_WINDOW_DAYS", 14, 1),
    maxAttempts: num("PARSE_MAX_ATTEMPTS", 5, 1),
    tz: env.PLANNER_TZ || "America/Los_Angeles",
  };
}
