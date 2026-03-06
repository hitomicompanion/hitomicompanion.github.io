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
  let androidHandoffInFlight = false;
  const HITOMI_OAUTH_REDIRECT = "https://hitomicompanion.github.io/";
  const ANDROID_HANDOFF_ONESHOT_KEY = "hitomi_android_auth_handoff_done";
  const ANDROID_HANDOFF_FUNCTION = "android-auth-handoff";
  // Keep Agent1c fallback target explicit so reverting app-side routing later is trivial.
  const ANDROID_DEEP_LINK_PRIMARY = "hitomicompanion://auth/callback";
  const ANDROID_DEEP_LINK_FALLBACK = "agent1cai://auth/callback";

  const getParams = () => new URLSearchParams(window.location.search || "");
  const isAndroidAuthMode = () => String(getParams().get("android_auth") || "") === "1";
  const getAndroidProviderHint = () => String(getParams().get("android_provider") || "").trim().toLowerCase();

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
      const u = new URL(HITOMI_OAUTH_REDIRECT);
      if (isAndroidAuthMode()) {
        u.searchParams.set("android_auth", "1");
        const hint = getAndroidProviderHint();
        if (hint) u.searchParams.set("android_provider", hint);
      }
      return u.toString();
    } catch {
      return HITOMI_OAUTH_REDIRECT;
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
    const params = getParams();
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
    const session = data?.session || null;
    applySignedState(session);
    await maybeReturnToAndroidApp(session);
  };

  const createAndroidHandoff = async (session) => {
    const cfg = getConfig();
    if (!cfg.ok) throw new Error("Supabase config missing.");
    const token = String(session?.access_token || "").trim();
    if (!token) throw new Error("No auth token available for Android handoff.");
    const headers = {
      "Content-Type": "application/json",
      apikey: cfg.anonKey,
      Authorization: `Bearer ${token}`,
    };
    const body = {
      action: "create",
      session: {
        access_token: token,
        refresh_token: String(session?.refresh_token || ""),
        expires_in: Number(session?.expires_in || 3600),
        token_type: String(session?.token_type || "bearer"),
      },
    };
    const res = await fetch(`${cfg.url}/functions/v1/${ANDROID_HANDOFF_FUNCTION}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(String(json?.error || `Android handoff failed (${res.status})`));
    }
    const handoffCode = String(json?.handoff_code || "").trim();
    if (!handoffCode) throw new Error("Android handoff code missing.");
    return { handoffCode, expiresAt: String(json?.expires_at || "").trim() };
  };

  const buildDeepLink = (base, handoff) => {
    try {
      const u = new URL(base);
      u.searchParams.set("handoff_code", String(handoff?.handoffCode || ""));
      if (handoff?.expiresAt) u.searchParams.set("expires_at", String(handoff.expiresAt));
      u.searchParams.set("source", "hitomicompanion");
      return u.toString();
    } catch {
      return String(base || "");
    }
  };

  const maybeReturnToAndroidApp = async (session) => {
    if (!isAndroidAuthMode()) return;
    if (!session?.user) return;
    if (androidHandoffInFlight) return;
    try {
      if (window.sessionStorage?.getItem(ANDROID_HANDOFF_ONESHOT_KEY) === "1") return;
    } catch {}

    androidHandoffInFlight = true;
    try {
      setStatus("Signed in. Returning to Hitomi app...");
      const handoff = await createAndroidHandoff(session);
      try { window.sessionStorage?.setItem(ANDROID_HANDOFF_ONESHOT_KEY, "1"); } catch {}
      const primary = buildDeepLink(ANDROID_DEEP_LINK_PRIMARY, handoff);
      const fallback = buildDeepLink(ANDROID_DEEP_LINK_FALLBACK, handoff);
      window.location.href = primary;
      if (fallback && fallback !== primary) {
        window.setTimeout(() => { window.location.href = fallback; }, 1200);
      }
    } catch (err) {
      setStatus(err?.message || "Could not return to Hitomi app.", true);
    } finally {
      window.setTimeout(() => { androidHandoffInFlight = false; }, 1500);
    }
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
    try { window.sessionStorage?.removeItem(ANDROID_HANDOFF_ONESHOT_KEY); } catch {}
  });

  (async () => {
    await processCallbackIfPresent();
    await refreshSession();
    const c = getClient();
    if (c.ok) {
      c.client.auth.onAuthStateChange((_evt, session) => {
        const safeSession = session || null;
        applySignedState(safeSession);
        maybeReturnToAndroidApp(safeSession).catch(() => {});
      });
    }
    pollingTimer = window.setInterval(() => {
      refreshSession().catch(() => {});
    }, 1500);
    window.addEventListener("beforeunload", () => {
      if (pollingTimer) window.clearInterval(pollingTimer);
    });
  })();
})();
