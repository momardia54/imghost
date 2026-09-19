import { useCallback, useEffect, useState } from "react";
import { FolderNode, getMe, getTree, logout } from "./api";
import LoginForm from "./components/LoginForm";
import FolderTree, { Selection } from "./components/FolderTree";
import Breadcrumb from "./components/Breadcrumb";
import Gallery from "./components/Gallery";
import UploadTray from "./components/UploadTray";
import ModalHost from "./components/Modal";
import ApiKeysPanel from "./components/ApiKeysPanel";
import { KeyIcon, LogOutIcon } from "./icons";

type View = "loading" | "not-configured" | "login" | "app";

export default function App() {
  const [view, setView] = useState<View>("loading");
  const [folders, setFolders] = useState<FolderNode[]>([]);
  const [total, setTotal] = useState(0);
  const [selection, setSelection] = useState<Selection>({ type: "all" });
  const [refreshKey, setRefreshKey] = useState(0);
  const [showApiKeys, setShowApiKeys] = useState(false);

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
          <div className="brand-mark" />
          <h1>Not configured yet</h1>
          <p className="sub">
            This imghost instance doesn't have admin credentials set. Whoever deployed it needs to run:
          </p>
          <pre className="config-snippet">
            npx wrangler secret put ADMIN_USERNAME{"\n"}npx wrangler secret put ADMIN_PASSWORD
          </pre>
          <p className="sub">Reload this page once that's done.</p>
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
        <FolderTree
          folders={folders}
          total={total}
          selection={selection}
          onSelect={setSelection}
          onChanged={handleChanged}
        />
        <div className="sidebar-footer">
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
          <h1>{selection.type === "all" ? "All images" : folders.find((f) => f.id === selection.id)?.name ?? ""}</h1>
        </div>
        <Breadcrumb folders={folders} selection={selection} onSelect={setSelection} />
        <UploadTray folderId={folderId} onUploaded={handleChanged} onUnauthorized={handleUnauthorized} />
        <Gallery
          selection={selection}
          folders={folders}
          refreshKey={refreshKey}
          onChanged={handleChanged}
          onSelect={setSelection}
          onUnauthorized={handleUnauthorized}
        />
      </main>
      {showApiKeys && <ApiKeysPanel onClose={() => setShowApiKeys(false)} />}
      <ModalHost />
    </div>
  );
}
