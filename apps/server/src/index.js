import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { api } from "./api/routes.js";
import { migrate } from "./db/database.js";
import { dataRoot, repoRoot } from "./config/paths.js";
import { syncConfiguredLibraries } from "./scanner/scanner.js";

const port = Number(process.env.PORT || 4000);
const __filename = fileURLToPath(import.meta.url);

export async function createApp() {
  migrate();
  await syncConfiguredLibraries();

  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "2mb" }));
  app.use("/assets", express.static(dataRoot));
  app.use("/api", api);

  const clientDist = path.join(repoRoot, "apps", "client", "dist");
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api") || req.path.startsWith("/assets")) {
        next();
        return;
      }
      res.sendFile(path.join(clientDist, "index.html"));
    });
  }

  app.use((error, _req, res, _next) => {
    console.error(error);
    res.status(500).json({ error: error.message || "Server error" });
  });

  return app;
}

export async function startServer() {
  const app = await createApp();
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      console.log(`NicFlix listening at http://localhost:${port}`);
      console.log(`NicFlix API listening at http://localhost:${port}/api`);
      console.log(`Serving local assets from ${path.resolve(dataRoot)}`);
      resolve(server);
    });
    server.on("error", reject);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  await startServer();
}
