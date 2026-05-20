import express from "express";
import cors from "cors";
import path from "node:path";
import { api } from "./api/routes.js";
import { migrate } from "./db/database.js";
import { dataRoot } from "./config/paths.js";
import { syncConfiguredLibraries } from "./scanner/scanner.js";

const app = express();
const port = Number(process.env.PORT || 4000);

migrate();
await syncConfiguredLibraries();

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use("/assets", express.static(dataRoot));
app.use("/api", api);

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: error.message || "Server error" });
});

app.listen(port, () => {
  console.log(`NicFlix API listening at http://localhost:${port}/api`);
  console.log(`Serving local assets from ${path.resolve(dataRoot)}`);
});
