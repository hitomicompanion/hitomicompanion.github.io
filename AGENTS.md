# AGENTS.md - `hitomicompanion.github.io`

This file is the handoff brief for future Codex/GPT instances working on the standalone Hitomi Companion web auth frontend.

## 1) What this repo is

`hitomicompanion.github.io` is a **focused auth frontend**:
- Google/X/Magic Link sign-in UI
- Supabase session handling
- Android handoff code creation via edge function
- deep-link return to Hitomi Android app

It is intentionally lightweight and should remain independent in branding from Agent1c web OS.

## 2) Cross-repo map (critical)

From this repo (`/home/decentricity/hitomicompanion.github.io`):
- Android app repo is: `../hitomi-android`
- Agent1c.ai web OS repo is: `../agent1c-ai.github.io`
- Agent1c.me web OS repo is: `../agent1c-me.github.io`

From `../hitomi-android` back to this repo:
- this site is at `../hitomicompanion.github.io`

## 3) Current architecture and flow

1. User starts auth from Android app.
2. App opens this site with `?android_auth=1` (and optional `android_provider` hint).
3. User signs in via Supabase OAuth or magic link.
4. This site exchanges callback session and calls edge function `android-auth-handoff` with authenticated bearer.
5. This site deep-links back to app:
   - primary: `hitomicompanion://auth/callback?...`
   - fallback: `agent1cai://auth/callback?...`

Primary auth script:
- `js/app.js`

Page shell:
- `index.html`
- `styles.css`

## 4) Config and constants (source of truth)

`index.html`:
- `window.__HITOMI_SUPABASE_CONFIG.url = "https://gkfhxhrleuauhnuewfmw.supabase.co"`
- anon key set there as runtime config

`js/app.js` key constants:
- `HITOMI_OAUTH_REDIRECT = "https://hitomicompanion.github.io/"`
- `ANDROID_HANDOFF_FUNCTION = "android-auth-handoff"`
- `ANDROID_DEEP_LINK_PRIMARY = "hitomicompanion://auth/callback"`
- `ANDROID_DEEP_LINK_FALLBACK = "agent1cai://auth/callback"`
- storage key: `hitomi_supabase_auth_v1`

## 5) What has already been done

- Phase A scaffold is complete.
- Supabase wiring and callback handling are active.
- OAuth provider branding updated for X (not legacy Twitter wording).
- Android return handoff wired via edge function.
- Mobile click reliability improvements exist:
  - click + pointer/touch binding (`bindPress`) to avoid iOS dead taps.

## 6) Unique failure cases we already hit (do not repeat)

### 6.1 Provider mismatch

Using wrong provider key caused:
- `Unsupported provider: provider is not enabled`

Rule:
- use `"x"` for X provider in Supabase OAuth requests.

### 6.2 Wrong redirect destination

Observed issue:
- login returned to `agent1c.ai` instead of this repo.

Fix pattern:
- keep `HITOMI_OAUTH_REDIRECT` locked to this site
- keep Supabase redirect allowlist aligned.

### 6.3 GitHub Pages not active

Site may 404 if Pages source branch is unset.
For this repo, ensure Pages deploys from `master` root.

### 6.4 Supabase function auth setting drift

Even though this repo is auth UI, downstream chat health depends on Supabase functions.
Hard guard for project `gkfhxhrleuauhnuewfmw`:
- `xai-chat` -> `Verify JWT with legacy secret` must stay OFF.

This has auto-flipped ON before and caused widespread 401 regressions.

## 7) Operational guardrails

1. Keep this repo auth-focused; do not turn it into full app runtime.
2. Keep Android fallback deep link present until migration is complete.
3. Do not expose service-role secrets in this repo.
4. Keep domain naming canonical:
   - `agent1c.ai`
   - `agent1c.me`
   - `hitomicompanion.github.io`
   - never introduce `agentic.*`

## 7.1) Existing code debt/watchouts in source

- `README.md` still contains phase wording from early scaffold history and may lag current behavior.
- Supabase config is currently embedded in `index.html` runtime object.
  - Acceptable for publishable key, but keep strict separation from service-role secrets.
- Deep-link fallback to `agent1cai://` is intentionally retained for backward compatibility.
  - Do not remove until Android migration policy says safe.

## 8) Testing checklist (minimum)

1. OAuth with Google:
   - opens provider
   - returns to this site
   - session visible
   - Android handoff redirect attempt fired
2. OAuth with X:
   - same checks as Google
3. Magic link:
   - email sent
   - callback handled
4. iOS tap behavior:
   - both OAuth buttons and magic-link submit respond
5. Android handoff:
   - primary deep link attempted first
   - fallback deep link attempted after delay

## 9) Recommended next steps

1. Add explicit "Return to app failed?" helper section:
   - copy deep-link button
   - retry handoff button
2. Add small diagnostics panel behind a query flag:
   - callback params detected
   - handoff function status code
3. Add safe version stamp in UI footer for support debugging.
4. Add optional custom domain (future) while preserving existing github.io fallback.
5. Keep backend shared with Agent1c unless/ until strong isolation is required.

## 10) Handoff summary

This repo is now the branded auth front door for Hitomi Android, while backend remains shared with Agent1c Supabase project. The critical constraints are redirect correctness, provider naming (`x`), callback/deep-link compatibility, and guarding against Supabase JWT setting drift in dependent functions.
