import fs from "node:fs";
import { e2eEnv } from "./env.ts";

export default function teardown(): void {
  fs.rmSync(e2eEnv().dataDir, { recursive: true, force: true });
}
