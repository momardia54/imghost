import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import spec from "../frontend/public/openapi.json";
import pkg from "../package.json";

// Keeps frontend/public/openapi.json honest: every documented operation must exist in the router, and the status
// it answers to a minimal request must be one the description lists.
const BASE = "https://imghost.test";
const METHODS = ["get", "post", "patch", "delete"] as const;

type Operation = { responses: Record<string, unknown> };
const paths = spec.paths as unknown as Record<string, Partial<Record<(typeof METHODS)[number], Operation>>>;

async function session(): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": "198.51.100.7" },
    body: JSON.stringify({ username: "admin", password: "test-password" }),
  });
  expect(res.status).toBe(200);
  return res.headers.get("Set-Cookie")!.split(";")[0];
}

describe("openapi.json", () => {
  it("has the package's version", async () => {
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info.version).toBe(pkg.version);
  });

  const operations = Object.entries(paths)
    .filter(([path]) => !path.startsWith("/i/"))
    .flatMap(([path, item]) => METHODS.filter((m) => item[m]).map((m) => ({ path, method: m, op: item[m]! })));

  it.each(operations)("$method $path exists and answers a documented status", async ({ path, method, op }) => {
    const cookie = await session();
    const url = BASE + path.replace("{id}", "999999");
    const init: RequestInit = { method: method.toUpperCase(), headers: { Cookie: cookie } };
    if (method !== "get" && method !== "delete") {
      (init.headers as Record<string, string>)["Content-Type"] = "application/json";
      init.body = "{}";
    }
    const res = await SELF.fetch(url, init);
    const body = await res.clone().json().catch(() => ({}));

    expect((body as { error?: string }).error, "the router does not know this route").not.toBe("Not found");
    expect(Object.keys(op.responses)).toContain(String(res.status));
  });

  it("documents the public image route", async () => {
    const res = await SELF.fetch(`${BASE}/i/missing.png?size=small`);
    expect(Object.keys(paths["/i/{key}"].get!.responses)).toContain(String(res.status));
  });
});
