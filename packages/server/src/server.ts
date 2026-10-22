import fs from "node:fs";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve, type ServerType } from "@hono/node-server";
import { WebSocketServer } from "ws";
import { apiPaths, bankPaths, tokenQueryParam, type AgentId } from "@prepare-to-interview/shared";
import { AcpDriver } from "./agent/acp-driver.ts";
import { detectInstalledAgents, findOnPath, type AgentDetector } from "./agent/detect.ts";
import type { AgentDriver, McpServerConfig } from "./agent/driver.ts";
import { createProfile } from "./agent/profiles.ts";
import { Canvas } from "./canvas/canvas.ts";
import { Chat, type DriverProvider } from "./chat/chat.ts";
import { loopbackHost } from "./config.ts";
import { openDataDir } from "./data-dir.ts";
import { openDatabase } from "./db/database.ts";
import { Domain } from "./domain/domain.ts";
import { Bank } from "./domain/bank.ts";
import { Practice } from "./domain/practice.ts";
import { EventBus } from "./events.ts";
import { createApp } from "./http/app.ts";
import { createMcpHandler, mcpServerName } from "./mcp/handler.ts";
import { createResearchTools, researchSessionTools } from "./mcp/research-tools.ts";
import { createTools } from "./mcp/tools.ts";
import { Researcher } from "./interviewer/researcher.ts";
import { ResearchArchive } from "./research/archive.ts";
import { Search } from "./search/search.ts";
import { Grader } from "./interviewer/grader.ts";
import { defaultContentDir, Interviewer } from "./interviewer/interviewer.ts";
import { PracticeRunner } from "./interviewer/practice-runner.ts";
import { Settings } from "./settings/settings.ts";

export const appVersion = "0.0.0";
export const defaultClientDir = fileURLToPath(new URL("../../client/dist", import.meta.url));

export interface ServerOptions {
  dataDir: string;
  /** 0 picks a free port. */
  port: number;
  clientDir?: string;
  /** Creates the driver for an agent; defaults to the ACP drivers. Tests pass the fake driver. */
  drivers?: DriverProvider;
  /** Finds installed agents; defaults to looking up their commands on PATH. */
  detectAgents?: AgentDetector;
  /** Directory with the Interviewer content (`persona.md`); defaults to `interviewer/` in the repo. */
  interviewerDir?: string;
  /** Clock for the domain core and the hidden state; tests pin it. */
  now?: () => Date;
}

export interface RunningServer {
  /** Tokenized URL the Candidate opens in the browser. */
  url: string;
  port: number;
  token: string;
  /** How an Agent session reaches the app's MCP tools. */
  mcpServer: McpServerConfig;
  close: () => Promise<void>;
}

export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const dataDir = openDataDir(options.dataDir);
  const db = openDatabase(dataDir.databaseFile);
  const events = new EventBus();
  const canvas = new Canvas(db, events);
  const settings = new Settings(db, events);
  const now = options.now ?? (() => new Date());
  const domain = new Domain(db, events, now);
  const practice = new Practice({ db, domain, canvas, now });
  const bank = new Bank({ db, domain, events, now });
  const archive = new ResearchArchive({ db, root: path.join(dataDir.root, "research"), now });
  const search = new Search(db);
  // Filled once the Chat exists: Research posts its results into the Chat.
  const late: { researcher?: Researcher } = {};
  const contentDir = options.interviewerDir ?? defaultContentDir;
  let allowedHosts: ReadonlySet<string> = new Set();
  // Filled once the server listens and its URL is known.
  const mcpServers: McpServerConfig[] = [];
  const researchMcpServers: McpServerConfig[] = [];
  const interviewer = new Interviewer({
    contentDir,
    domain,
    practice,
    mcpServers: () => mcpServers,
    now,
    turnContext: [{ take: () => late.researcher?.takeResults() ?? { blocks: [], sent: () => undefined } }],
    research: () => ({ running: late.researcher?.running ?? false, proposed_waiting: bank.proposedCount() }),
  });
  const drivers = cachedDrivers(options.drivers ?? acpDrivers(dataDir.root));
  const chat = new Chat({
    db,
    events,
    settings,
    interviewer,
    drivers: drivers.get,
    cardPrompt: (cardId) => practice.cardPrompt(cardId),
  });
  const grader = new Grader({ db, settings, drivers: drivers.get, contentDir });
  const runner = new PracticeRunner({ practice, grader, chat });
  const research = new Researcher({
    db,
    domain,
    bank,
    archive,
    settings,
    drivers: drivers.get,
    contentDir,
    mcpServers: () => researchMcpServers,
    post: (text) => chat.post(text),
  });
  late.researcher = research;

  const researchTools = createResearchTools({ domain, bank, archive, search, researcher: research });
  const app = createApp({
    token: dataDir.token,
    allowedHosts: () => allowedHosts,
    canvas,
    chat,
    domain,
    practice,
    runner,
    settings,
    detectAgents: options.detectAgents ?? (() => detectInstalledAgents()),
    events,
    mcp: createMcpHandler(
      [...createTools({ domain, practice, interviewer }), ...researchTools],
      appVersion,
    ),
    bankRoutes: {
      bank,
      search,
      researchMcp: createMcpHandler(
        researchTools.filter((t) => researchSessionTools.includes(t.name)),
        appVersion,
      ),
    },
    clientDir: options.clientDir ?? defaultClientDir,
  });

  const wss = new WebSocketServer({ noServer: true });
  let httpServer: ServerType;
  try {
    httpServer = await listen((ready) =>
      serve({ fetch: app.fetch, hostname: loopbackHost, port: options.port, websocket: { server: wss } }, ready),
    );
  } catch (error) {
    db.$client.close();
    throw error;
  }
  const port = (httpServer.address() as AddressInfo).port;
  allowedHosts = new Set([`${loopbackHost}:${port}`, `localhost:${port}`]);
  const origin = `http://${loopbackHost}:${port}`;
  const mcpServer: McpServerConfig = {
    type: "http",
    name: mcpServerName,
    url: origin + apiPaths.mcp,
    headers: [{ name: "Authorization", value: `Bearer ${dataDir.token}` }],
  };
  mcpServers.push(mcpServer);
  researchMcpServers.push({ ...mcpServer, url: origin + bankPaths.researchMcp });

  return {
    url: `${origin}/?${tokenQueryParam}=${dataDir.token}`,
    port,
    token: dataDir.token,
    mcpServer,
    close: async () => {
      await chat.close();
      await runner.close();
      await research.close();
      await drivers.dispose();
      for (const client of wss.clients) client.terminate();
      wss.close();
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
        if ("closeAllConnections" in httpServer) httpServer.closeAllConnections();
      });
      db.$client.close();
    },
  };
}

/** Real agents over ACP, run in an empty app-owned working directory inside the data directory. */
function acpDrivers(dataRoot: string): DriverProvider {
  const workDir = path.join(dataRoot, "agent-workdir");
  fs.mkdirSync(workDir, { recursive: true, mode: 0o700 });
  return (agent) =>
    new AcpDriver(
      createProfile(agent, {
        workDir,
        stateDir: path.join(dataRoot, "agents"),
        env: process.env,
        ...(agent === "opencode" && { opencodeCommand: findOnPath("opencode") }),
      }),
    );
}

function cachedDrivers(create: DriverProvider) {
  const drivers = new Map<AgentId, AgentDriver>();
  return {
    get: (agent: AgentId): AgentDriver => {
      let driver = drivers.get(agent);
      if (!driver) {
        driver = create(agent);
        drivers.set(agent, driver);
      }
      return driver;
    },
    dispose: async () => {
      for (const driver of drivers.values()) await driver.dispose().catch(() => undefined);
      drivers.clear();
    },
  };
}

function listen(start: (ready: () => void) => ServerType): Promise<ServerType> {
  return new Promise((resolve, reject) => {
    const server = start(() => resolve(server));
    server.once("error", reject);
  });
}
