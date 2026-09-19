let currentFolderId = null;
let folders = [];

function showModal({ message, withInput = false, defaultValue = "" }) {
  return new Promise((resolve) => {
    const overlay = document.getElementById("modal-overlay");
    const messageEl = document.getElementById("modal-message");
    const input = document.getElementById("modal-input");
    const confirmBtn = document.getElementById("modal-confirm");
    const cancelBtn = document.getElementById("modal-cancel");

    messageEl.textContent = message;
    input.hidden = !withInput;
    input.value = defaultValue;

    function cleanup(result) {
      overlay.hidden = true;
      confirmBtn.removeEventListener("click", onConfirm);
      cancelBtn.removeEventListener("click", onCancel);
      input.removeEventListener("keydown", onKeydown);
      resolve(result);
    }
    function onConfirm() {
      cleanup(withInput ? input.value.trim() || null : true);
    }
    function onCancel() {
      cleanup(withInput ? null : false);
    }
    function onKeydown(e) {
      if (e.key === "Enter") onConfirm();
      if (e.key === "Escape") onCancel();
    }

    confirmBtn.addEventListener("click", onConfirm);
    cancelBtn.addEventListener("click", onCancel);
    input.addEventListener("keydown", onKeydown);

    overlay.hidden = false;
    if (withInput) input.focus();
    else confirmBtn.focus();
  });
}

function modalConfirm(message) {
  return showModal({ message, withInput: false });
}

function modalPrompt(message, defaultValue = "") {
  return showModal({ message, withInput: true, defaultValue });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { ...(options.headers || {}) },
  });
  if (res.status === 401) {
    window.location.href = "/login";
    throw new Error("unauthorized");
  }
  return res;
}

async function checkAuth() {
  const res = await fetch("/api/me");
  const data = await res.json();
  if (data.setupRequired) {
    window.location.href = "/setup";
    return false;
  }
  if (!data.authenticated) {
    window.location.href = "/login";
    return false;
  }
  return true;
}

function buildTree(flat, parentId = null) {
  return flat
    .filter((f) => f.parent_id === parentId)
    .map((f) => ({ ...f, children: buildTree(flat, f.id) }));
}

const MAX_DEPTH_CLASS = 8;

function renderFolderNode(node, depth) {
  const el = document.createElement("div");
  const depthClass = `depth-${Math.min(depth, MAX_DEPTH_CLASS)}`;
  el.className = "folder-item " + depthClass + (node.id === currentFolderId ? " active" : "");
  el.innerHTML = `<span>${escapeHtml(node.name)}</span><button class="del-folder" title="Delete folder">&times;</button>`;
  el.querySelector("span").addEventListener("click", () => selectFolder(node.id, node.name));
  el.querySelector(".del-folder").addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!(await modalConfirm(`Delete "${node.name}" and everything inside it?`))) return;
    await api(`/api/folders/${node.id}`, { method: "DELETE" });
    if (currentFolderId === node.id) selectFolder(null, "All images");
    else loadTree();
  });
  return el;
}

function renderTree(nodes, container, depth = 0) {
  for (const node of nodes) {
    container.appendChild(renderFolderNode(node, depth));
    if (node.children.length) renderTree(node.children, container, depth + 1);
  }
}

async function loadTree() {
  const res = await api("/api/tree");
  const data = await res.json();
  folders = data.folders;
  const treeEl = document.getElementById("folder-tree");
  treeEl.innerHTML = "";

  const rootEl = document.createElement("div");
  rootEl.className = "folder-item" + (currentFolderId === null ? " active" : "");
  rootEl.textContent = "All images";
  rootEl.addEventListener("click", () => selectFolder(null, "All images"));
  treeEl.appendChild(rootEl);

  renderTree(buildTree(folders), treeEl);
}

function selectFolder(id, label) {
  currentFolderId = id;
  document.getElementById("current-folder-label").textContent = label;
  loadTree();
  loadFiles();
}

async function loadFiles() {
  const qs = currentFolderId === null ? "" : `?folder_id=${currentFolderId}`;
  const res = await api(`/api/files${qs}`);
  const data = await res.json();
  renderFiles(data.files);
}

function renderFiles(files) {
  const grid = document.getElementById("image-grid");
  const empty = document.getElementById("empty-state");
  grid.innerHTML = "";

  if (!files.length) {
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";

  for (const file of files) {
    const card = document.createElement("div");
    card.className = "image-card";
    card.innerHTML = `
      <div class="thumb"><img src="${file.url}" alt="${escapeHtml(file.original_name)}" loading="lazy" /></div>
      <div class="info">
        <div class="name" title="${escapeHtml(file.original_name)}">${escapeHtml(file.original_name)}</div>
        <div class="actions">
          <button class="copy">Copy link</button>
          <button class="del">Delete</button>
        </div>
      </div>
    `;
    card.querySelector(".copy").addEventListener("click", async (e) => {
      const absoluteUrl = new URL(file.url, window.location.origin).href;
      await navigator.clipboard.writeText(absoluteUrl);
      const btn = e.target;
      btn.textContent = "Copied!";
      btn.classList.add("copied");
      setTimeout(() => {
        btn.textContent = "Copy link";
        btn.classList.remove("copied");
      }, 1500);
    });
    card.querySelector(".del").addEventListener("click", async () => {
      if (!(await modalConfirm(`Delete "${file.original_name}"?`))) return;
      await api(`/api/files/${file.id}`, { method: "DELETE" });
      loadFiles();
    });
    grid.appendChild(card);
  }
}

async function uploadFile(file) {
  const form = new FormData();
  form.append("file", file);
  if (currentFolderId !== null) form.append("folder_id", String(currentFolderId));

  const res = await api("/api/upload", { method: "POST", body: form });
  const data = await res.json();
  if (!res.ok) {
    alert(data.error || "Upload failed");
    return;
  }
  loadFiles();
}

function setupUpload() {
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("file-input");

  document.getElementById("pick-file-btn").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    if (fileInput.files.length) uploadFile(fileInput.files[0]);
    fileInput.value = "";
  });

  ["dragenter", "dragover"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add("dragover");
    })
  );
  ["dragleave", "drop"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
    })
  );
  dropzone.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files[0];
    if (file) uploadFile(file);
  });
}

function setupFolderCreate() {
  document.getElementById("new-folder-btn").addEventListener("click", async () => {
    const name = await modalPrompt("Folder name:");
    if (!name) return;
    await api("/api/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), parent_id: currentFolderId }),
    });
    loadTree();
  });
}

function setupLogout() {
  document.getElementById("logout-btn").addEventListener("click", async () => {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  });
}

(async function init() {
  if (!(await checkAuth())) return;
  setupUpload();
  setupFolderCreate();
  setupLogout();
  loadTree();
  loadFiles();
})();
