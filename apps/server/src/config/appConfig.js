import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { configPath, dataRoot } from "./paths.js";

const encryptedPrefix = "v1:";
const secretPath = path.join(dataRoot, "app.secret");

const defaultConfig = {
  libraries: [],
  tmdbApiKeyEncrypted: "",
  tmdbDisconnected: false,
  autoSkipEnabled: true,
  autoPlayNextEnabled: true
};

function readRawConfig() {
  if (!fs.existsSync(configPath)) {
    return defaultConfig;
  }

  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = JSON.parse(raw);
  return {
    libraries: Array.isArray(parsed.libraries) ? parsed.libraries : [],
    tmdbApiKeyEncrypted: typeof parsed.tmdbApiKeyEncrypted === "string" ? parsed.tmdbApiKeyEncrypted : "",
    tmdbApiKey: typeof parsed.tmdbApiKey === "string" ? parsed.tmdbApiKey : "",
    tmdbDisconnected: parsed.tmdbDisconnected === true,
    autoSkipEnabled: parsed.autoSkipEnabled !== false,
    autoPlayNextEnabled: parsed.autoPlayNextEnabled !== false
  };
}

function getEncryptionKey() {
  const envSecret = process.env.NICFLIX_CONFIG_SECRET;
  if (envSecret) {
    return crypto.createHash("sha256").update(envSecret).digest();
  }

  fs.mkdirSync(dataRoot, { recursive: true });
  if (!fs.existsSync(secretPath)) {
    fs.writeFileSync(secretPath, crypto.randomBytes(32).toString("base64"), { mode: 0o600 });
  }
  return crypto.createHash("sha256").update(fs.readFileSync(secretPath, "utf8")).digest();
}

function encryptSecret(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${encryptedPrefix}${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

function decryptSecret(value) {
  if (!value?.startsWith(encryptedPrefix)) return "";
  const [, ivRaw, tagRaw, encryptedRaw] = value.split(":");
  if (!ivRaw || !tagRaw || !encryptedRaw) return "";

  const decipher = crypto.createDecipheriv("aes-256-gcm", getEncryptionKey(), Buffer.from(ivRaw, "base64"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, "base64")),
    decipher.final()
  ]).toString("utf8");
}

export function readAppConfig() {
  const config = readRawConfig();
  return {
    libraries: config.libraries,
    tmdbApiKeyEncrypted: config.tmdbApiKeyEncrypted,
    tmdbDisconnected: config.tmdbDisconnected,
    autoSkipEnabled: config.autoSkipEnabled,
    autoPlayNextEnabled: config.autoPlayNextEnabled
  };
}

export function writeAppConfig(updates) {
  const nextConfig = {
    ...readRawConfig(),
    ...updates
  };

  if (Object.hasOwn(nextConfig, "tmdbApiKey")) {
    nextConfig.tmdbApiKeyEncrypted = nextConfig.tmdbApiKey
      ? encryptSecret(nextConfig.tmdbApiKey)
      : "";
    delete nextConfig.tmdbApiKey;
  }

  fs.writeFileSync(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`);
  return nextConfig;
}

export function getTmdbApiKey() {
  const config = readRawConfig();
  if (config.tmdbDisconnected) return "";

  const configKey = config.tmdbApiKeyEncrypted
    ? decryptSecret(config.tmdbApiKeyEncrypted)
    : config.tmdbApiKey;
  if (config.tmdbApiKey && !config.tmdbApiKeyEncrypted) {
    writeAppConfig({ tmdbApiKey: config.tmdbApiKey, tmdbDisconnected: false });
  }

  const envKey = process.env.TMDB_API_KEY;
  return (configKey || envKey || "").trim();
}

export function hasAppManagedTmdbKey() {
  const config = readRawConfig();
  return Boolean(config.tmdbApiKeyEncrypted || config.tmdbApiKey);
}

export function maskSecret(value) {
  if (!value) return "";
  if (value.length <= 8) return "********";
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}
