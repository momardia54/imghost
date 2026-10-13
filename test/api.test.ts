import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/index";
import { GIF, PNG } from "./fixtures";

const IMAGES = (env as unknown as Env).IMAGES;

const BASE = "https://imghost.test";
let ipCounter = 0;
const freshIp = () => `203.0.113.${++ipCounter}`;

function call(path: string, init: RequestInit = {}, cookie?: string): Promise<Response> {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("Cookie", cookie);
  return SELF.fetch(`${BASE}${path}`, { ...init, headers });
}

function postJson(path: string, body: unknown, cookie?: string, extra: Record<string, string> = {}): Promise<Response> {
  return call(path, { method: "POST", headers: { "Content-Type": "application/json", ...extra }, body: JSON.stringify(body) }, cookie);
}

async function login(): Promise<string> {
  const res = await postJson("/api/login", { username: "admin", password: "test-password" }, undefined, { "CF-Connecting-IP": freshIp() });
  expect(res.status).toBe(200);
  return res.headers.get("Set-Cookie")!.split(";")[0];
}

interface Uploaded {
  id: number;
  r2_key: string;
  folder_id: number | null;
  content_type: string;
  url: string;
}

async function upload(auth: { cookie?: string; bearer?: string }, bytes: Uint8Array, name: string, folderId?: number): Promise<Response> {
  const form = new FormData();
  form.append("file", new File([bytes], name));
  if (folderId !== undefined) form.append("folder_id", String(folderId));
  const headers: Record<string, string> = {};
  if (auth.bearer) headers.Authorization = `Bearer ${auth.bearer}`;
  return call("/api/upload", { method: "POST", body: form, headers }, auth.cookie);
}

async function uploadOk(cookie: string, name: string, folderId?: number, bytes = PNG): Promise<Uploaded> {
  const res = await upload({ cookie }, bytes, name, folderId);
  expect(res.status).toBe(201);
  return res.json();
}

async function folder(cookie: string, name: string, parentId: number | null = null): Promise<number> {
  const res = await postJson("/api/folders", { name, parent_id: parentId }, cookie);
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: number }).id;
}

async function names(cookie: string, query: string): Promise<string[]> {
  const res = await call(`/api/files?${query}`, {}, cookie);
  expect(res.status).toBe(200);
  return ((await res.json()) as { files: { original_name: string }[] }).files.map((f) => f.original_name);
}

describe("auth", () => {
  it("reports configured and unauthenticated", async () => {
    const res = await call("/api/me");
    expect(await res.json()).toEqual({ authenticated: false, configured: true });
  });

  it("rejects wrong credentials and protects every session route", async () => {
    const bad = await postJson("/api/login", { username: "admin", password: "nope" }, undefined, { "CF-Connecting-IP": freshIp() });
    expect(bad.status).toBe(401);
    for (const path of ["/api/tree", "/api/files", "/api/keys"]) expect((await call(path)).status).toBe(401);
    expect((await postJson("/api/files/move", { ids: [1], folder_id: null })).status).toBe(401);
    expect((await postJson("/api/files/delete", { ids: [1] })).status).toBe(401);
  });

  it("sets an HttpOnly session cookie and logs out", async () => {
    const res = await postJson("/api/login", { username: "admin", password: "test-password" }, undefined, { "CF-Connecting-IP": freshIp() });
    expect(res.headers.get("Set-Cookie")).toMatch(/HttpOnly; Secure; SameSite=Lax/);
    const cookie = res.headers.get("Set-Cookie")!.split(";")[0];
    expect(((await (await call("/api/me", {}, cookie)).json()) as { authenticated: boolean }).authenticated).toBe(true);
    await call("/api/logout", { method: "POST" }, cookie);
    expect((await call("/api/tree", {}, cookie)).status).toBe(401);
  });

  it("rate-limits after 8 failures per IP, even for the right password", async () => {
    const ip = freshIp();
    for (let i = 0; i < 8; i++) {
      const res = await postJson("/api/login", { username: "admin", password: `wrong-${i}` }, undefined, { "CF-Connecting-IP": ip });
      expect(res.status).toBe(401);
    }
    const blocked = await postJson("/api/login", { username: "admin", password: "test-password" }, undefined, { "CF-Connecting-IP": ip });
    expect(blocked.status).toBe(429);
    const otherIp = await postJson("/api/login", { username: "admin", password: "test-password" }, undefined, { "CF-Connecting-IP": freshIp() });
    expect(otherIp.status).toBe(200);
  });
});

describe("upload", () => {
  it("stores a PNG in R2 and identifies it by content, not file name", async () => {
    const cookie = await login();
    const file = await uploadOk(cookie, "photo.gif");
    expect(file.content_type).toBe("image/png");
    expect(file.r2_key).toMatch(/\.png$/);
    expect(await IMAGES.head(file.r2_key)).not.toBeNull();
  });

  it("rejects SVG, spoofed and empty files", async () => {
    const cookie = await login();
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect((await upload({ cookie }, svg, "x.svg")).status).toBe(400);
    expect((await upload({ cookie }, new TextEncoder().encode("<html>"), "x.png")).status).toBe(400);
    expect((await upload({ cookie }, new Uint8Array(), "x.png")).status).toBe(400);
  });

  it("rejects an unknown folder", async () => {
    const cookie = await login();
    expect((await upload({ cookie }, PNG, "x.png", 999999)).status).toBe(404);
  });
});

describe("listing", () => {
  it("lists folders recursively, unsorted on its own, and reports bytes", async () => {
    const cookie = await login();
    const parent = await folder(cookie, "Parent");
    const child = await folder(cookie, "Child", parent);
    await uploadOk(cookie, "in-parent.png", parent);
    await uploadOk(cookie, "in-child.png", child);
    await uploadOk(cookie, "loose-listing.png");

    expect((await names(cookie, `folder_id=${parent}`)).sort()).toEqual(["in-child.png", "in-parent.png"]);
    expect(await names(cookie, "")).toContain("loose-listing.png");
    expect(await names(cookie, "")).not.toContain("in-parent.png");

    const tree = (await (await call("/api/tree", {}, cookie)).json()) as { folders: { id: number; count: number }[]; bytes: number };
    expect(tree.folders.find((f) => f.id === parent)?.count).toBe(2);
    expect(tree.bytes).toBeGreaterThanOrEqual(PNG.byteLength * 3);
  });

  it("sorts and pages by offset", async () => {
    const cookie = await login();
    const f = await folder(cookie, "Sorting");
    for (const n of ["c.png", "a.png", "b.png", "d.png"]) await uploadOk(cookie, n, f);

    expect(await names(cookie, `folder_id=${f}&sort=name`)).toEqual(["a.png", "b.png", "c.png", "d.png"]);
    expect(await names(cookie, `folder_id=${f}&sort=newest`)).toEqual(["d.png", "b.png", "a.png", "c.png"]);
    expect(await names(cookie, `folder_id=${f}&sort=oldest`)).toEqual(["c.png", "a.png", "b.png", "d.png"]);
    expect(await names(cookie, `folder_id=${f}&sort=bogus`)).toEqual(await names(cookie, `folder_id=${f}&sort=newest`));
    expect(await names(cookie, `folder_id=${f}&sort=name&limit=2&offset=1`)).toEqual(["b.png", "c.png"]);
    expect(await names(cookie, `folder_id=${f}&sort=name&limit=2&page=2`)).toEqual(["c.png", "d.png"]);
    expect(await names(cookie, `folder_id=${f}&sort=name&limit=2&offset=-5`)).toEqual(["a.png", "b.png"]);
  });

  it("searches names across folders, treating % and _ literally", async () => {
    const cookie = await login();
    const f = await folder(cookie, "Search");
    await uploadOk(cookie, "needle_100%.png", f);
    await uploadOk(cookie, "needleX100.png");
    expect(await names(cookie, `q=${encodeURIComponent("needle_100%")}`)).toEqual(["needle_100%.png"]);
  });
});

describe("bulk actions", () => {
  it("moves many images in one request", async () => {
    const cookie = await login();
    const target = await folder(cookie, "Bulk target");
    const files = await Promise.all(["m1.png", "m2.png", "m3.png"].map((n) => uploadOk(cookie, n)));
    const res = await postJson("/api/files/move", { ids: files.map((f) => f.id), folder_id: target }, cookie);
    expect(res.status).toBe(200);
    expect((await names(cookie, `folder_id=${target}`)).sort()).toEqual(["m1.png", "m2.png", "m3.png"]);

    const back = await postJson("/api/files/move", { ids: [files[0].id], folder_id: null }, cookie);
    expect(back.status).toBe(200);
    expect(await names(cookie, "")).toContain("m1.png");
  });

  it("validates ids and the destination", async () => {
    const cookie = await login();
    for (const ids of [[], [0], [1.5], ["1"], "1", Array.from({ length: 501 }, (_, i) => i + 1)]) {
      expect((await postJson("/api/files/move", { ids, folder_id: null }, cookie)).status).toBe(400);
      expect((await postJson("/api/files/delete", { ids }, cookie)).status).toBe(400);
    }
    expect((await postJson("/api/files/move", { ids: [1] }, cookie)).status).toBe(400);
    expect((await postJson("/api/files/move", { ids: [1], folder_id: 999999 }, cookie)).status).toBe(404);
  });

  it("handles more ids than one D1 statement can bind", async () => {
    const cookie = await login();
    const f = await folder(cookie, "Many");
    const ids = Array.from({ length: 250 }, (_, i) => 900000 + i);
    const real = await uploadOk(cookie, "many.png");
    ids.push(real.id);
    expect((await postJson("/api/files/move", { ids, folder_id: f }, cookie)).status).toBe(200);
    expect(await names(cookie, `folder_id=${f}`)).toEqual(["many.png"]);
  });

  it("deletes rows, originals and generated variants", async () => {
    const cookie = await login();
    const a = await uploadOk(cookie, "del-a.png");
    const b = await uploadOk(cookie, "del-b.png");
    await IMAGES.put(`thumbs/small/${a.r2_key}`, "variant");

    const res = await postJson("/api/files/delete", { ids: [a.id, b.id, 999999] }, cookie);
    expect(await res.json()).toEqual({ ok: true, deleted: 2 });
    expect(await IMAGES.head(a.r2_key)).toBeNull();
    expect(await IMAGES.head(b.r2_key)).toBeNull();
    expect(await IMAGES.head(`thumbs/small/${a.r2_key}`)).toBeNull();
    expect(await names(cookie, "q=del-")).toEqual([]);
  });
});

describe("serving", () => {
  it("serves originals publicly with immutable caching", async () => {
    const cookie = await login();
    const file = await uploadOk(cookie, "public.png");
    const res = await call(`/i/${file.r2_key}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Cache-Control")).toContain("immutable");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
  });

  it("serves GIFs untouched even when a size is requested", async () => {
    const cookie = await login();
    const gif = await uploadOk(cookie, "anim.gif", undefined, GIF);
    const res = await call(`/i/${gif.r2_key}?size=small`);
    expect(res.headers.get("Content-Type")).toBe("image/gif");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(GIF);
    expect(await IMAGES.head(`thumbs/small/${gif.r2_key}`)).toBeNull();
  });

  it("returns 404 for missing keys and path tricks", async () => {
    expect((await call("/i/does-not-exist.png")).status).toBe(404);
    expect((await call("/i/thumbs/small/x.png")).status).toBe(404);
  });

  it("removes variants when a folder is deleted", async () => {
    const cookie = await login();
    const f = await folder(cookie, "Doomed");
    const sub = await folder(cookie, "Doomed child", f);
    const file = await uploadOk(cookie, "doomed.png", sub);
    await IMAGES.put(`thumbs/medium/${file.r2_key}`, "variant");

    expect((await call(`/api/folders/${f}`, { method: "DELETE" }, cookie)).status).toBe(200);
    expect(await IMAGES.head(file.r2_key)).toBeNull();
    expect(await IMAGES.head(`thumbs/medium/${file.r2_key}`)).toBeNull();
    const tree = (await (await call("/api/tree", {}, cookie)).json()) as { folders: { id: number }[] };
    expect(tree.folders.some((x) => x.id === sub)).toBe(false);
  });

  it("sends security headers", async () => {
    const res = await call("/api/me");
    expect(res.headers.get("Content-Security-Policy")).toContain("script-src 'self'");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });
});

describe("API keys", () => {
  it("can upload, cannot do anything else, and stop working when revoked", async () => {
    const cookie = await login();
    const created = (await (await postJson("/api/keys", { name: "ci" }, cookie)).json()) as { id: number; token: string };
    expect(created.token).toMatch(/^imghost_sk_/);

    expect((await upload({ bearer: created.token }, PNG, "via-key.png")).status).toBe(201);
    const bearer = { Authorization: `Bearer ${created.token}` };
    expect((await call("/api/tree", { headers: bearer })).status).toBe(401);
    expect((await call("/api/keys", { headers: bearer })).status).toBe(401);
    expect((await call("/api/files/delete", { method: "POST", headers: bearer, body: "{}" })).status).toBe(401);

    expect((await call(`/api/keys/${created.id}`, { method: "DELETE" }, cookie)).status).toBe(200);
    expect((await upload({ bearer: created.token }, PNG, "after-revoke.png")).status).toBe(401);
  });
});
