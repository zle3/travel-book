import { writeFileSync } from "node:fs";
import { Client, GatewayIntentBits, Partials } from "discord.js";
import { loadConfig } from "./config.ts";
import { Store } from "./store.ts";
import { HttpApi } from "./apiClient.ts";
import { ClaudeParser } from "./parser.ts";
import { Planner } from "./planner.ts";
import { DiscordChat, attachGateway } from "./discord.ts";

const cfg = loadConfig(process.env);
const log = (m: string): void => console.log(`${new Date().toISOString()} ${m}`);
const store = new Store(cfg.dbPath);
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMessageReactions],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User],
  allowedMentions: { parse: [], repliedUser: false },
});
const chat = new DiscordChat(client);
const parser = cfg.anthropicKey ? new ClaudeParser({ apiKey: cfg.anthropicKey, model: cfg.model }) : null;
log(parser ? `AI parsing on (model ${cfg.model})` : "AI parsing off (no ANTHROPIC_API_KEY): posts are queued for the planner run");
const planner = new Planner({
  store, chat, api: new HttpApi(cfg.apiBase, cfg.adminToken), parser,
  channelId: cfg.channelId, ownerId: cfg.ownerId, now: Date.now, log,
  maxAttempts: cfg.maxAttempts, windowMs: cfg.reactionWindowDays * 86_400_000,
});
attachGateway(client, chat, planner, log);

let ready = false;
const beat = (): void => { if (ready) try { writeFileSync(cfg.heartbeatPath, String(Date.now())); } catch (e) { log(`heartbeat: ${(e as Error).message}`); } };
const runSweep = (): void => { void planner.sweep().catch((e: Error) => log(`sweep: ${e.message}`)); };

client.once("clientReady", () => { ready = true; log(`logged in as ${client.user?.tag}`); beat(); runSweep(); });
client.on("shardResume", () => runSweep()); // catch up right after a reconnect
client.on("error", (e) => log(`client error: ${e.message}`));
setInterval(beat, 30_000);
setInterval(runSweep, cfg.checkIntervalMin * 60_000);

const stop = (): void => { log("stopping"); void client.destroy(); store.close(); process.exit(0); };
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
await client.login(cfg.discordToken);
