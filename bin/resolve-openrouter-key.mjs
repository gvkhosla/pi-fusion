#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PROVIDER_ID = "pi-fusion";

function authPath() {
  return process.env.PI_FUSION_AUTH_FILE || join(homedir(), ".pi", "agent", "auth.json");
}

function readAuthJson() {
  const path = authPath();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

function findKey() {
  const envKey = process.env.OPENROUTER_API_KEY?.trim();
  if (envKey) return envKey;

  const auth = readAuthJson();
  const piFusion = auth[PROVIDER_ID];
  if (piFusion?.key) return piFusion.key;
  if (piFusion?.access) return piFusion.access;

  const openrouter = auth.openrouter;
  if (openrouter?.key) return openrouter.key;
  if (openrouter?.access) return openrouter.access;

  return null;
}

const key = findKey();
if (!key) process.exit(1);
process.stdout.write(key);
