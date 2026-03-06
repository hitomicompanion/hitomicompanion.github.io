(function(){
  const status = document.getElementById("authStatus");
  const setStatus = (msg) => { if (status) status.textContent = String(msg || ""); };

  document.getElementById("authGoogleBtn")?.addEventListener("click", () => {
    setStatus("Google sign-in wiring arrives in Phase B.");
  });

  document.getElementById("authXBtn")?.addEventListener("click", () => {
    setStatus("X sign-in wiring arrives in Phase B.");
  });

  document.getElementById("magicLinkForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const email = String(document.getElementById("magicEmail")?.value || "").trim();
    if (!email) {
      setStatus("Enter an email address first.");
      return;
    }
    setStatus("Magic link wiring arrives in Phase B.");
  });
})();
