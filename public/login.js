(async function init() {
  const res = await fetch("/api/me");
  const data = await res.json();
  if (data.setupRequired) {
    window.location.href = "/setup";
  } else if (data.authenticated) {
    window.location.href = "/";
  }
})();

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;
  const errorEl = document.getElementById("error");
  errorEl.textContent = "";

  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok) {
    errorEl.textContent = data.error || "Invalid credentials";
    return;
  }
  window.location.href = "/";
});
