import fs from "node:fs";
import { configPath } from "./paths.js";

export function readAppConfig() {
  if (!fs.existsSync(configPath)) {
    return { libraries: [] };
  }

  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = JSON.parse(raw);
  return {
    libraries: Array.isArray(parsed.libraries) ? parsed.libraries : []
  };
}

