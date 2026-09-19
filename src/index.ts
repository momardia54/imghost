import { ensureSchema } from "./db";
import { getSessionFromRequest } from "./auth";
import { handleSetup, handleLogin, handleLogout, handleMe } from "./routes/auth";
import { handleTree, handleCreateFolder, handleDeleteFolder } from "./routes/folders";
import { handleListFiles, handleUpload, handleDeleteFile } from "./routes/files";
import { handleServeImage } from "./routes/serve";
import { withSecurityHeaders } from "./security";

export interface Env {
  DB: D1Database;
  IMAGES: R2Bucket;
  ASSETS: Fetcher;
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
      return handleServeImage(key, env.IMAGES);
    }

    // Auth/setup endpoints.
    if (pathname === "/api/setup") {
      return handleSetup(req, env.DB);
    }
    if (pathname === "/api/login" && req.method === "POST") {
      return handleLogin(req, env.DB);
    }
    if (pathname === "/api/logout" && req.method === "POST") {
      return handleLogout(req, env.DB);
    }
    if (pathname === "/api/me" && req.method === "GET") {
      return handleMe(req, env.DB);
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
      if (pathname === "/api/files" && req.method === "GET") {
        return handleListFiles(req, env.DB);
      }
      if (pathname === "/api/upload" && req.method === "POST") {
        return handleUpload(req, env.DB, env.IMAGES, url.origin);
      }
      const fileMatch = pathname.match(/^\/api\/files\/(\d+)$/);
      if (fileMatch && req.method === "DELETE") {
        return handleDeleteFile(Number(fileMatch[1]), env.DB, env.IMAGES);
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
