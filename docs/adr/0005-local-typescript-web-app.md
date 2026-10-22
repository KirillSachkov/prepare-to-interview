# Local TypeScript web app, not a desktop app

The app is a pnpm TypeScript monorepo: a Node server (WebSocket for chat and live Canvas updates, the MCP server over HTTP in the same process) and a React + Vite client. It runs with `pnpm start` and opens in the browser. The server binds to `127.0.0.1` and requires a token, because it can drive the Candidate's coding agent. Electron is deferred until a concrete need appears.
