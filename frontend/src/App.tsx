import { useCallback, useEffect, useState } from "react";
import { FolderNode, getMe, getTree, logout } from "./api";
import LoginForm from "./components/LoginForm";
import FolderTree, { Selection } from "./components/FolderTree";
import Breadcrumb from "./components/Breadcrumb";
import Gallery from "./components/Gallery";
import UploadTray from "./components/UploadTray";
import ModalHost from "./components/Modal";
import ApiKeysPanel from "./components/ApiKeysPanel";
import SearchBox from "./components/SearchBox";
import ThemeToggle from "./components/ThemeToggle";
import { KeyIcon, LogOutIcon, LogoMark } from "./icons";

type View = "loading" | "not-configured" | "login" | "app";

export default function App() {
  const [view, setView] = useState<View>("loading");
  const [folders, setFolders] = useState<FolderNode[]>([]);
  const [total, setTotal] = useState(0);
  const [selection, setSelection] = useState<Selection>({ type: "all" });
  const [refreshKey, setRefreshKey] = useState(0);
  const [showApiKeys, setShowApiKeys] = useState(false);
  const [query, setQuery] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setSearchTerm(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  // Picking a folder (sidebar, breadcrumb or a card) leaves search mode.
  function select(sel: Selection) {
    setQuery("");
    setSearchTerm("");
    setSelection(sel);
  }

  const checkAuth = useCallback(() => {
    getMe()
      .then((res) => {
        if (!res.configured) setView("not-configured");
        else if (!res.authenticated) setView("login");
        else setView("app");
      })
      .catch(() => setView("login"));
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const refreshTree = useCallback(() => {
    getTree()
      .then((res) => {
        setFolders(res.folders);
        setTotal(res.total);
      })
      .catch(() => {
        /* handled by Gallery's own auth check */
      });
  }, []);

  useEffect(() => {
    if (view === "app") refreshTree();
  }, [view, refreshTree]);

  const handleChanged = useCallback(() => {
    refreshTree();
    setRefreshKey((k) => k + 1);
  }, [refreshTree]);

  function handleUnauthorized() {
    setView("login");
  }

  if (view === "loading") return null;

  if (view === "not-configured") {
    return (
      <div className="center-screen">
        <div className="auth-card">
          <LogoMark className="brand-mark" />
          <h1>Not configured yet</h1>
          <p className="sub">
            No admin username and password have been set for this instance yet. In the Cloudflare
            dashboard, open Workers &amp; Pages → <b>imghost</b> → Settings → Variables and Secrets and add
            two secrets:
          </p>
          <pre className="config-snippet">ADMIN_USERNAME{"\n"}ADMIN_PASSWORD</pre>
          <p className="sub">
            Or from a terminal: <code>npx wrangler secret put ADMIN_USERNAME</code> and{" "}
            <code>npx wrangler secret put ADMIN_PASSWORD</code>. Reload this page once that's done.
          </p>
        </div>
      </div>
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

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <LogoMark />
          imghost
        </div>
        <SearchBox value={query} onChange={setQuery} />
        <FolderTree
          folders={folders}
          total={total}
          selection={selection}
          onSelect={select}
          onChanged={handleChanged}
          filter={query}
        />
        <div className="sidebar-footer">
          <ThemeToggle label />
          <button onClick={() => setShowApiKeys(true)}>
            <KeyIcon />
            API keys
          </button>
          <button
            onClick={async () => {
              await logout();
              setView("login");
            }}
          >
            <LogOutIcon />
            Log out
          </button>
        </div>
      </aside>
      <main className="main">
        <div className="main-header">
          <h1>
            {searchTerm
              ? `Results for "${searchTerm}"`
              : selection.type === "all"
                ? "All images"
                : folders.find((f) => f.id === selection.id)?.name ?? ""}
          </h1>
        </div>
        {!searchTerm && <Breadcrumb folders={folders} selection={selection} onSelect={select} />}
        {!searchTerm && <UploadTray folderId={folderId} onUploaded={handleChanged} onUnauthorized={handleUnauthorized} />}
        <Gallery
          selection={selection}
          folders={folders}
          refreshKey={refreshKey}
          onChanged={handleChanged}
          query={searchTerm}
          onSelect={select}
          onUnauthorized={handleUnauthorized}
        />
      </main>
      {showApiKeys && <ApiKeysPanel onClose={() => setShowApiKeys(false)} />}
      <ModalHost />
    </div>
  );
}
