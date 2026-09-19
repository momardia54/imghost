import { ensureSchema } from "./db";
import { getApiKeyFromRequest, getSessionFromRequest } from "./auth";
import { handleLogin, handleLogout, handleMe } from "./routes/auth";
import { handleTree, handleCreateFolder, handleDeleteFolder, handleRenameFolder } from "./routes/folders";
import { handleListFiles, handleUpload, handleDeleteFile, handleMoveFile } from "./routes/files";
import { handleServeImage } from "./routes/serve";
import { handleListApiKeys, handleCreateApiKey, handleRevokeApiKey } from "./routes/apiKeys";
import { withSecurityHeaders } from "./security";

export interface Env {
  DB: D1Database;
  IMAGES: R2Bucket;
  TRANSFORM?: ImagesBinding;
  ASSETS: Fetcher;
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD?: string;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function handle(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const { pathname } = url;

    await ensureSchema(env.DB);

    // Public direct-link image serving — no auth required.
    if (req.method === "GET" && pathname.startsWith("/i/")) {
      const key = pathname.slice("/i/".length);
      if (!key) return new Response("Not found", { status: 404 });
      return handleServeImage(key, url.searchParams.get("size"), env.IMAGES, env.TRANSFORM);
    }

    // Auth endpoints.
    if (pathname === "/api/login" && req.method === "POST") {
      return handleLogin(req, env.DB, env);
    }
    if (pathname === "/api/logout" && req.method === "POST") {
      return handleLogout(req, env.DB);
    }
    if (pathname === "/api/me" && req.method === "GET") {
      return handleMe(req, env.DB, env);
    }

    // Upload accepts either a browser session OR an API key (Authorization: Bearer <token>) —
    // scoped to this one route so a leaked key can only upload, not browse/delete/manage keys.
    if (pathname === "/api/upload" && req.method === "POST") {
      const hasSession = await getSessionFromRequest(req, env.DB);
      const apiKey = hasSession ? null : await getApiKeyFromRequest(req, env.DB);
      if (!hasSession && !apiKey) return json({ error: "Unauthorized" }, 401);
      return handleUpload(req, env.DB, env.IMAGES, url.origin);
    }

    // Everything else under /api requires a valid session.
    if (pathname.startsWith("/api/")) {
      const authed = await getSessionFromRequest(req, env.DB);
      if (!authed) return json({ error: "Unauthorized" }, 401);

      if (pathname === "/api/tree" && req.method === "GET") {
        return handleTree(env.DB);
      }
      if (pathname === "/api/folders" && req.method === "POST") {
        return handleCreateFolder(req, env.DB);
      }
      const folderMatch = pathname.match(/^\/api\/folders\/(\d+)$/);
      if (folderMatch && req.method === "DELETE") {
        return handleDeleteFolder(Number(folderMatch[1]), env.DB, env.IMAGES);
      }
      if (folderMatch && req.method === "PATCH") {
        return handleRenameFolder(Number(folderMatch[1]), req, env.DB);
      }
      if (pathname === "/api/files" && req.method === "GET") {
        return handleListFiles(req, env.DB);
      }
      const fileMatch = pathname.match(/^\/api\/files\/(\d+)$/);
      if (fileMatch && req.method === "DELETE") {
        return handleDeleteFile(Number(fileMatch[1]), env.DB, env.IMAGES);
      }
      if (fileMatch && req.method === "PATCH") {
        return handleMoveFile(Number(fileMatch[1]), req, env.DB);
      }
      if (pathname === "/api/keys" && req.method === "GET") {
        return handleListApiKeys(env.DB);
      }
      if (pathname === "/api/keys" && req.method === "POST") {
        return handleCreateApiKey(req, env.DB);
      }
      const keyMatch = pathname.match(/^\/api\/keys\/(\d+)$/);
      if (keyMatch && req.method === "DELETE") {
        return handleRevokeApiKey(Number(keyMatch[1]), env.DB);
      }

      return json({ error: "Not found" }, 404);
    }

    // Static frontend (public/*) via the assets binding.
    return env.ASSETS.fetch(req);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    return withSecurityHeaders(await handle(req, env));
  },
};
