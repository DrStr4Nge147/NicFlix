import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const serverRoot = path.resolve(__dirname, "../..");
export const repoRoot = path.resolve(serverRoot, "../..");

dotenv.config({ path: path.join(serverRoot, ".env") });

export function resolveFromServer(value, fallback) {
  return path.resolve(serverRoot, value || fallback);
}

export const databasePath = resolveFromServer(process.env.DATABASE_PATH, "../../data/app.db");
export const configPath = resolveFromServer(process.env.CONFIG_PATH, "../../config.json");
export const dataRoot = path.resolve(process.env.DATA_ROOT || path.join(repoRoot, "data"));
export const postersRoot = path.join(dataRoot, "posters");
export const backdropsRoot = path.join(dataRoot, "backdrops");

export function ensureDataDirs() {
  for (const dir of [dataRoot, postersRoot, backdropsRoot, path.join(dataRoot, "thumbnails")]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
