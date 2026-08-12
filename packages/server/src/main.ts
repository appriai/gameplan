import { resolve } from "node:path";
import { startServer } from "./app.js";
import { lanAddress } from "./net.js";

const port = Number(process.env.GAMEPLAN_PORT ?? 3939);
const host = process.env.GAMEPLAN_HOST ?? "0.0.0.0";
const dataDir = resolve(process.env.GAMEPLAN_DATA ?? ".gameplan");

const server = await startServer({ port, host, dataDir });

const lan = lanAddress();
console.log(`gameplan listening on http://localhost:${port}`);
if (lan) console.log(`             LAN:  http://${lan}:${port}`);
console.log(`             data: ${dataDir}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void server.close().then(() => process.exit(0));
  });
}
