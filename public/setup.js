(async function init() {
  const res = await fetch("/api/setup");
  const data = await res.json();
  if (!data.setupRequired) {
    window.location.href = "/login";
  }
})();

document.getElementById("setup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;
  const errorEl = document.getElementById("error");
  errorEl.textContent = "";

  const res = await fetch("/api/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok) {
    errorEl.textContent = data.error || "Something went wrong";
    return;
  }
  window.location.href = "/";
});
