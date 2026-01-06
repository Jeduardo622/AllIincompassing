var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// netlify/functions/dashboard.ts
var dashboard_exports = {};
__export(dashboard_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(dashboard_exports);

// src/server/env.ts
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
var DEFAULT_ENV_FILENAME = ".env.codex";
var envCache = /* @__PURE__ */ new Map();
var stripInlineComments = (value) => {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    const previous = index > 0 ? value[index - 1] : void 0;
    if (character === "'" && previous !== "\\" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (character === '"' && previous !== "\\" && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    if (character === "#" && !inSingleQuote && !inDoubleQuote) {
      return value.slice(0, index);
    }
  }
  return value;
};
var unquoteValue = (value) => {
  if (value.length < 2) {
    return value;
  }
  const first = value[0];
  const last = value[value.length - 1];
  if (first !== last || first !== '"' && first !== "'") {
    return value;
  }
  const inner = value.slice(1, -1);
  if (first === '"') {
    try {
      return JSON.parse(value);
    } catch {
      return inner.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "	").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
  }
  if (first === "'") {
    return inner.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "	").replace(/\\'/g, "'").replace(/\\\\/g, "\\");
  }
  return inner;
};
var sanitizeValue = (raw) => {
  if (typeof raw !== "string") {
    return void 0;
  }
  const withoutComments = stripInlineComments(raw);
  const trimmed = withoutComments.trim();
  if (!trimmed) {
    return void 0;
  }
  const unquoted = unquoteValue(trimmed);
  const normalized = unquoted.trim();
  return normalized.length > 0 ? normalized : void 0;
};
var parseEnvContent = (content) => {
  const result = {};
  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }
    const withoutExport = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
    const equalsIndex = withoutExport.indexOf("=");
    if (equalsIndex === -1) {
      return;
    }
    const key = withoutExport.slice(0, equalsIndex).trim();
    if (!key) {
      return;
    }
    const value = sanitizeValue(withoutExport.slice(equalsIndex + 1));
    if (value !== void 0) {
      result[key] = value;
    }
  });
  return result;
};
var getEnvFilePath = (explicitPath) => {
  const configuredPath = explicitPath ?? process.env.CODEX_ENV_PATH ?? DEFAULT_ENV_FILENAME;
  return (0, import_node_path.resolve)(process.cwd(), configuredPath);
};
var getCachedEnv = (envPath) => {
  const cached = envCache.get(envPath);
  if (cached) {
    return cached;
  }
  if (!(0, import_node_fs.existsSync)(envPath)) {
    const empty = {};
    envCache.set(envPath, empty);
    return empty;
  }
  try {
    const content = (0, import_node_fs.readFileSync)(envPath, "utf8");
    const parsed = parseEnvContent(content);
    envCache.set(envPath, parsed);
    return parsed;
  } catch (error2) {
    throw new Error(
      `Failed to read ${envPath}: ${error2 instanceof Error ? error2.message : "Unknown error"}`
    );
  }
};
var getProcessEnvValue = (key) => {
  const raw = process.env[key];
  const normalized = sanitizeValue(raw);
  if (normalized && raw !== normalized) {
    process.env[key] = normalized;
  }
  return normalized;
};
var loadFromCodex = (keys, { envPath } = {}) => {
  const filteredKeys = keys.map((key) => key?.trim()).filter((key) => typeof key === "string" && key.length > 0);
  if (filteredKeys.length === 0) {
    return;
  }
  const missingKeys = filteredKeys.filter((key) => !getProcessEnvValue(key));
  if (missingKeys.length === 0) {
    return;
  }
  const resolvedPath = getEnvFilePath(envPath);
  const parsed = getCachedEnv(resolvedPath);
  missingKeys.forEach((key) => {
    const value = parsed[key];
    if (value !== void 0) {
      process.env[key] = value;
    }
  });
};
var getOptionalServerEnv = (key, options) => {
  loadFromCodex([key], options);
  return getProcessEnvValue(key);
};
var getRequiredServerEnv = (key, options) => {
  const value = getOptionalServerEnv(key, options);
  if (value) {
    return value;
  }
  const resolvedPath = getEnvFilePath(options?.envPath);
  throw new Error(`Missing required environment variable ${key}. Provide it via process.env or set it in ${resolvedPath}.`);
};

// src/lib/logger/server.ts
var prefix = (level) => `[${level.toUpperCase()}]`;
var info = (message, metadata) => {
  console.info(prefix("info"), message, metadata ?? "");
};
var warn = (message, metadata) => {
  console.warn(prefix("warn"), message, metadata ?? "");
};
var error = (message, metadata) => {
  console.error(prefix("error"), message, metadata ?? "");
};
var debug = (message, metadata) => {
  console.debug(prefix("debug"), message, metadata ?? "");
};
var serverLogger = {
  info,
  warn,
  error,
  debug
};

// src/server/runtimeConfig.ts
var RUNTIME_CONFIG_FALLBACK_ORGANIZATION_ID = "5238e88b-6198-4862-80a2-dbe15bbeabdd";
var resolveDefaultOrganizationId = () => {
  const explicit = getOptionalServerEnv("DEFAULT_ORGANIZATION_ID");
  if (explicit) {
    return explicit;
  }
  const fallbackKeys = [
    "SUPABASE_DEFAULT_ORGANIZATION_ID",
    "VITE_DEFAULT_ORGANIZATION_ID",
    "DEFAULT_ORG_ID"
  ];
  for (const key of fallbackKeys) {
    const candidate = getOptionalServerEnv(key);
    if (candidate) {
      serverLogger.warn("DEFAULT_ORGANIZATION_ID missing; falling back to alternate env", {
        fallbackKey: key
      });
      return candidate;
    }
  }
  serverLogger.warn(
    "DEFAULT_ORGANIZATION_ID missing; falling back to baked-in runtime config default",
    {
      fallbackOrganizationId: RUNTIME_CONFIG_FALLBACK_ORGANIZATION_ID
    }
  );
  return RUNTIME_CONFIG_FALLBACK_ORGANIZATION_ID;
};
var getDefaultOrganizationId = () => resolveDefaultOrganizationId();

// src/lib/logger/normalizeError.ts
var extractMessage = (value) => {
  const candidates = [value.message, value.error_description, value.error];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
};
var toError = (value, fallback = "Unknown error") => {
  if (value instanceof Error) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return new Error(value.trim());
  }
  if (value && typeof value === "object") {
    const message = extractMessage(value);
    if (message) {
      const err = new Error(message);
      const code = value.code;
      if (typeof code === "string" && code.trim().length > 0) {
        err.name = `SupabaseError:${code.trim()}`;
      }
      return err;
    }
  }
  return new Error(fallback);
};

// src/server/api/dashboard.ts
var JSON_HEADERS = {
  "Content-Type": "application/json"
};
var CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS"
};
function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...CORS_HEADERS, ...extra }
  });
}
async function fetchJson(url, init) {
  const response = await fetch(url, init);
  const status = response.status;
  const ok = response.ok;
  const text = await response.text();
  if (text.length === 0) {
    return { status, ok, data: null };
  }
  try {
    return { status, ok, data: JSON.parse(text) };
  } catch {
    return { status, ok, data: null };
  }
}
async function dashboardHandler(request) {
  if (request.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: { ...CORS_HEADERS } });
  }
  if (request.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }
  const authHeader = request.headers.get("Authorization");
  const accessToken = typeof authHeader === "string" ? authHeader.replace(/^Bearer\s+/i, "").trim() : "";
  if (!authHeader || accessToken.length === 0) {
    return json({ error: "Missing authorization token" }, 401, { "WWW-Authenticate": "Bearer" });
  }
  const supabaseUrl = getOptionalServerEnv("SUPABASE_URL") || getOptionalServerEnv("SUPABASE_DATABASE_URL") || getRequiredServerEnv("VITE_SUPABASE_URL");
  const anonKey = getOptionalServerEnv("SUPABASE_ANON_KEY") || getRequiredServerEnv("VITE_SUPABASE_ANON_KEY");
  try {
    const orgUrl = `${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/current_user_organization_id`;
    const orgResult = await fetchJson(orgUrl, {
      method: "POST",
      headers: {
        ...JSON_HEADERS,
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`
      },
      body: "{}"
    });
    const fallbackOrgId = (() => {
      try {
        return getDefaultOrganizationId();
      } catch {
        return null;
      }
    })();
    const resolvedOrganizationId = orgResult.ok && typeof orgResult.data === "string" && orgResult.data.length > 0 ? orgResult.data : fallbackOrgId;
    if (!resolvedOrganizationId) {
      return json({ error: "Access denied" }, 403);
    }
    if ((!orgResult.ok || !orgResult.data) && fallbackOrgId) {
      serverLogger.warn("Dashboard request falling back to default organization", { fallbackOrgId });
    }
    const roleUrl = `${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/user_has_role_for_org`;
    const rolePayload = { role_name: "org_admin", target_organization_id: resolvedOrganizationId };
    const roleResult = await fetchJson(roleUrl, {
      method: "POST",
      headers: {
        ...JSON_HEADERS,
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify(rolePayload)
    });
    const superAdminUrl = `${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/current_user_is_super_admin`;
    const superAdminResult = await fetchJson(superAdminUrl, {
      method: "POST",
      headers: {
        ...JSON_HEADERS,
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`
      },
      body: "{}"
    });
    const isOrgAdmin = roleResult.ok && roleResult.data === true;
    const isSuperAdmin = superAdminResult.ok && superAdminResult.data === true;
    serverLogger.info("Dashboard auth check", {
      resolvedOrganizationId,
      isOrgAdmin,
      isSuperAdmin,
      roleStatus: roleResult.status,
      superAdminStatus: superAdminResult.status
    });
    if (!isOrgAdmin && !isSuperAdmin) {
      return json({ error: "Forbidden" }, 403);
    }
    const dashboardUrl = `${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/get_dashboard_data`;
    const rpcResult = await fetchJson(dashboardUrl, {
      method: "POST",
      headers: {
        ...JSON_HEADERS,
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`
      },
      body: "{}"
    });
    if (!rpcResult.ok) {
      const status = rpcResult.status === 42501 ? 403 : rpcResult.status;
      return json({ error: "Dashboard RPC failed" }, status > 0 ? status : 500);
    }
    return new Response(JSON.stringify(rpcResult.data ?? {}), {
      status: 200,
      headers: { ...JSON_HEADERS, ...CORS_HEADERS }
    });
  } catch (error2) {
    serverLogger.error("/api/dashboard failed", { error: toError(error2, "dashboard proxy error") });
    return json({ error: "Internal Server Error" }, 500);
  }
}

// netlify/functions/dashboard.ts
var toNetlifyResponse = async (response) => {
  const headers = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return {
    statusCode: response.status,
    headers,
    body: await response.text(),
    isBase64Encoded: false
  };
};
var handler = async (event) => {
  try {
    const bodyNeeded = event.httpMethod !== "GET" && event.httpMethod !== "HEAD";
    const body = bodyNeeded && event.body ? event.isBase64Encoded ? Buffer.from(event.body, "base64") : event.body : void 0;
    const request = new Request(event.rawUrl || `https://${event.headers.host}${event.path}`, {
      method: event.httpMethod,
      headers: event.headers,
      body
    });
    const response = await dashboardHandler(request);
    return toNetlifyResponse(response);
  } catch {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: "Internal Server Error" })
    };
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
