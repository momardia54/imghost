import { useCallback, useEffect, useRef, useState } from "react";
import { FolderNode, SortOrder, getMe, getTree, logout } from "./api";
import { Selection } from "./lib/actions";
import { childFolders, pluralize } from "./lib/format";
import { readPref, writePref } from "./lib/prefs";
import ApiKeysPanel from "./components/ApiKeysPanel";
import Gallery, { ViewMode } from "./components/Gallery";
import LoginForm, { AuthShell } from "./components/LoginForm";
import ModalHost from "./components/Modal";
import Sidebar from "./components/Sidebar";
import ToastHost from "./components/Toast";
import { PageHead, TopBar } from "./components/Toolbar";
import UploadHost, { ACCEPT_ATTR, uploadFiles } from "./components/Uploads";

type View = "loading" | "not-configured" | "login" | "app";

const SORTS = ["newest", "oldest", "name", "size"] as const;
const VIEWS = ["grid", "list"] as const;
const TILE_SIZES = ["120", "140", "160", "180", "200", "220", "240", "260", "280", "300", "320"] as const;

export default function App() {
  const [view, setView] = useState<View>("loading");
  const [folders, setFolders] = useState<FolderNode[]>([]);
  const [total, setTotal] = useState(0);
  const [bytes, setBytes] = useState(0);
  const [selection, setSelection] = useState<Selection>({ type: "all" });
  const [refreshKey, setRefreshKey] = useState(0);
  const [showApiKeys, setShowApiKeys] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [viewTotal, setViewTotal] = useState<number | null>(null);
  const [sort, setSort] = useState<SortOrder>(() => readPref("sort", SORTS, "newest"));
  const [mode, setMode] = useState<ViewMode>(() => readPref("view", VIEWS, "grid"));
  const [tileSize, setTileSize] = useState(() => Number(readPref("tile", TILE_SIZES, "200")));
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setSearchTerm(query.trim()), 200);
    return () => clearTimeout(t);
  }, [query]);

  // Picking a location (sidebar, breadcrumb or a card) leaves search mode.
  function select(sel: Selection) {
    setQuery("");
    setSearchTerm("");
    setSelection(sel);
    setSidebarOpen(false);
  }

  useEffect(() => {
    getMe()
      .then((res) => setView(!res.configured ? "not-configured" : res.authenticated ? "app" : "login"))
      .catch(() => setView("login"));
  }, []);

  const refreshTree = useCallback(() => {
    getTree()
      .then((res) => {
        setFolders(res.folders);
        setTotal(res.total);
        setBytes(res.bytes ?? 0);
      })
      .catch(() => {
        /* Gallery surfaces auth and network errors */
      });
  }, []);

  useEffect(() => {
    if (view === "app") refreshTree();
  }, [view, refreshTree]);

  // A folder that disappears (deleted elsewhere) falls back to the library.
  useEffect(() => {
    if (selection.type === "folder" && folders.length && !folders.some((f) => f.id === selection.id)) setSelection({ type: "all" });
  }, [folders, selection]);

  const handleChanged = useCallback(() => {
    refreshTree();
    setRefreshKey((k) => k + 1);
  }, [refreshTree]);

  if (view === "loading") return null;

  if (view === "not-configured") {
    return (
      <AuthShell>
        <h1>Almost there</h1>
        <p className="auth-sub">
          No admin credentials are set for this instance. In the Cloudflare dashboard open Workers &amp; Pages → your
          Worker → Settings → <b>Variables and Secrets</b> and add two secrets:
        </p>
        <pre className="config-snippet">ADMIN_USERNAME{"\n"}ADMIN_PASSWORD</pre>
        <p className="auth-sub">
          Or run <code>npx wrangler secret put ADMIN_USERNAME</code> and <code>npx wrangler secret put ADMIN_PASSWORD</code>,
          then reload this page.
        </p>
      </AuthShell>
    );
  }

  if (view === "login") {
    return (
      <>
        <LoginForm onDone={() => setView("app")} />
        <ModalHost />
      </>
    );
  }

  const folderId = selection.type === "folder" ? selection.id : null;
  const current = folderId !== null ? folders.find((f) => f.id === folderId) : undefined;
  const title = searchTerm ? `"${searchTerm}"` : selection.type === "all" ? "All images" : selection.type === "unsorted" ? "Unsorted" : current?.name ?? "";
  const subCount = searchTerm
    ? folders.filter((f) => f.name.toLowerCase().includes(searchTerm.toLowerCase())).length
    : folderId !== null
      ? childFolders(folders, folderId).length
      : 0;
  const subtitle =
    viewTotal === null
      ? "Loading…"
      : [pluralize(viewTotal, "image"), subCount ? pluralize(subCount, "folder") : "", searchTerm ? "matching by name" : ""]
          .filter(Boolean)
          .join(" · ");

  return (
    <div className="app">
      <Sidebar
        open={sidebarOpen}
        folders={folders}
        total={total}
        bytes={bytes}
        selection={searchTerm ? { type: "folder", id: -1 } : selection}
        onSelect={select}
        onChanged={handleChanged}
        onApiKeys={() => setShowApiKeys(true)}
        onLogout={async () => {
          await logout().catch(() => {});
          setView("login");
        }}
      />
      {sidebarOpen && <div className="scrim" onClick={() => setSidebarOpen(false)} />}

      <main className="main">
        <TopBar
          folders={folders}
          selection={selection}
          searching={!!searchTerm}
          query={query}
          onQuery={setQuery}
          onSelect={select}
          onMenu={() => setSidebarOpen(true)}
          onUpload={() => fileInputRef.current?.click()}
        />
        <div className="content">
          <PageHead
            title={title}
            subtitle={subtitle}
            sort={sort}
            view={mode}
            tileSize={tileSize}
            onSort={(s) => {
              setSort(s);
              writePref("sort", s);
            }}
            onView={(v) => {
              setMode(v);
              writePref("view", v);
            }}
            onTileSize={(n) => {
              setTileSize(n);
              writePref("tile", String(n));
            }}
          />
          <Gallery
            selection={selection}
            folders={folders}
            query={searchTerm}
            sort={sort}
            view={mode}
            tileSize={tileSize}
            refreshKey={refreshKey}
            libraryTotal={total}
            onTreeChanged={refreshTree}
            onSelect={select}
            onUnauthorized={() => setView("login")}
            onPickFiles={() => fileInputRef.current?.click()}
            onTotal={setViewTotal}
          />
        </div>
      </main>

      <input
        ref={fileInputRef}
        className="visually-hidden"
        type="file"
        accept={ACCEPT_ATTR}
        multiple
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          uploadFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <UploadHost
        folderId={folderId}
        folderName={current?.name ?? "Unsorted"}
        onUploaded={handleChanged}
        onUnauthorized={() => setView("login")}
      />
      {showApiKeys && <ApiKeysPanel onClose={() => setShowApiKeys(false)} />}
      <ModalHost />
      <ToastHost />
    </div>
  );
}
