(function () {
  const statusEl = document.getElementById("authStatus");
  const googleBtn = document.getElementById("authGoogleBtn");
  const xBtn = document.getElementById("authXBtn");
  const form = document.getElementById("magicLinkForm");
  const emailInput = document.getElementById("magicEmail");
  const sessionPanel = document.getElementById("sessionPanel");
  const sessionIdentity = document.getElementById("sessionIdentity");
  const signOutBtn = document.getElementById("signOutBtn");

  let client = null;
  let pollingTimer = 0;

  const setStatus = (msg, isError) => {
    if (!statusEl) return;
    statusEl.textContent = String(msg || "");
    statusEl.classList.toggle("error", !!isError);
  };

  const getConfig = () => {
    const cfg = (window.__HITOMI_SUPABASE_CONFIG && typeof window.__HITOMI_SUPABASE_CONFIG === "object")
      ? window.__HITOMI_SUPABASE_CONFIG
      : {};
    const url = String(cfg.url || "").trim();
    const anonKey = String(cfg.anonKey || "").trim();
    return { url, anonKey, ok: Boolean(url && anonKey) };
  };

  const getClient = () => {
    if (client) return { ok: true, client };
    const cfg = getConfig();
    if (!cfg.ok) return { ok: false, error: "Supabase config missing." };
    if (!window.supabase?.createClient) return { ok: false, error: "Supabase SDK not loaded." };
    client = window.supabase.createClient(cfg.url, cfg.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce",
        storageKey: "hitomi_supabase_auth_v1",
      },
    });
    return { ok: true, client };
  };

  const redirectTo = () => {
    try {
      const u = new URL(window.location.href);
      u.hash = "";
      u.search = "";
      return `${u.origin}${u.pathname}`;
    } catch {
      return `${window.location.origin}${window.location.pathname}`;
    }
  };

  const cleanCallbackParams = () => {
    if (!window.history?.replaceState) return;
    try {
      const u = new URL(window.location.href);
      const keys = ["code", "state", "error", "error_code", "error_description", "access_token", "refresh_token", "token_type", "expires_in"];
      let changed = false;
      keys.forEach((k) => {
        if (u.searchParams.has(k)) {
          u.searchParams.delete(k);
          changed = true;
        }
      });
      if (changed) window.history.replaceState({}, "", `${u.pathname}${u.search}${u.hash}`);
    } catch {}
  };

  const currentIdentityText = (user) => {
    const email = String(user?.email || "").trim();
    const identities = Array.isArray(user?.identities) ? user.identities : [];
    const providerRaw = String(user?.app_metadata?.provider || identities[0]?.provider || "").toLowerCase();
    const provider = providerRaw === "twitter" ? "X" : providerRaw || "provider";
    const handle = String(
      user?.user_metadata?.user_name
      || user?.user_metadata?.preferred_username
      || user?.user_metadata?.username
      || identities[0]?.identity_data?.user_name
      || identities[0]?.identity_data?.preferred_username
      || identities[0]?.identity_data?.username
      || ""
    ).trim();
    if (handle) return `${provider}: @${handle}`;
    if (email) return `${provider}: ${email}`;
    return `Signed in via ${provider}`;
  };

  const applySignedState = (session) => {
    const signedIn = Boolean(session?.user);
    if (sessionPanel) sessionPanel.classList.toggle("agent-hidden", !signedIn);
    if (googleBtn) googleBtn.disabled = signedIn;
    if (xBtn) xBtn.disabled = signedIn;
    if (emailInput) emailInput.disabled = signedIn;
    const submitBtn = document.getElementById("magicSendBtn");
    if (submitBtn) submitBtn.disabled = signedIn;
    if (sessionIdentity) sessionIdentity.textContent = signedIn ? currentIdentityText(session.user) : "No active session.";
    setStatus(signedIn ? "Signed in successfully." : "Signed out.");
  };

  const processCallbackIfPresent = async () => {
    const params = new URLSearchParams(window.location.search || "");
    const code = String(params.get("code") || "").trim();
    if (!code) return;
    const c = getClient();
    if (!c.ok) {
      setStatus(c.error, true);
      return;
    }
    setStatus("Processing sign-in callback...");
    try {
      const { error } = await c.client.auth.exchangeCodeForSession(code);
      if (error) {
        setStatus(error.message || "Could not complete callback.", true);
        return;
      }
      cleanCallbackParams();
      setStatus("Sign-in completed.");
    } catch (err) {
      setStatus(err?.message || "Could not complete callback.", true);
    }
  };

  const refreshSession = async () => {
    const c = getClient();
    if (!c.ok) {
      setStatus(c.error, true);
      return;
    }
    const { data, error } = await c.client.auth.getSession();
    if (error) {
      setStatus(error.message || "Session check failed.", true);
      return;
    }
    applySignedState(data?.session || null);
  };

  const openOAuth = async (providerHint) => {
    const c = getClient();
    if (!c.ok) {
      setStatus(c.error, true);
      return;
    }
    const provider = providerHint === "x" ? "x" : "google";
    setStatus("Redirecting to sign-in...");
    const { data, error } = await c.client.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: redirectTo(),
        skipBrowserRedirect: true,
      },
    });
    if (error || !data?.url) {
      setStatus(error?.message || "Could not start OAuth sign-in.", true);
      return;
    }
    window.location.assign(data.url);
  };

  const bindPress = (node, fn) => {
    if (!node) return;
    let last = 0;
    const run = (event) => {
      const now = Date.now();
      if (now - last < 350) return;
      last = now;
      event?.preventDefault?.();
      event?.stopPropagation?.();
      Promise.resolve().then(fn).catch((err) => setStatus(err?.message || "Action failed.", true));
    };
    node.addEventListener("click", run);
    node.addEventListener("touchend", run, { passive: false });
    node.addEventListener("pointerup", run);
  };

  bindPress(googleBtn, () => openOAuth("google"));
  bindPress(xBtn, () => openOAuth("x"));

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = String(emailInput?.value || "").trim();
    if (!email || !email.includes("@")) {
      setStatus("Enter a valid email first.", true);
      return;
    }
    const c = getClient();
    if (!c.ok) {
      setStatus(c.error, true);
      return;
    }
    const { error } = await c.client.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo() },
    });
    if (error) {
      setStatus(error.message || "Could not send magic link.", true);
      return;
    }
    setStatus(`Magic link sent to ${email}.`);
  });

  signOutBtn?.addEventListener("click", async () => {
    const c = getClient();
    if (!c.ok) {
      setStatus(c.error, true);
      return;
    }
    const { error } = await c.client.auth.signOut();
    if (error) {
      setStatus(error.message || "Could not sign out.", true);
      return;
    }
    applySignedState(null);
  });

  (async () => {
    await processCallbackIfPresent();
    await refreshSession();
    const c = getClient();
    if (c.ok) {
      c.client.auth.onAuthStateChange((_evt, session) => applySignedState(session || null));
    }
    pollingTimer = window.setInterval(() => {
      refreshSession().catch(() => {});
    }, 1500);
    window.addEventListener("beforeunload", () => {
      if (pollingTimer) window.clearInterval(pollingTimer);
    });
  })();
})();
