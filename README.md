# panda-auth-me

**PandaAuth by PandaLabs** · [简体中文](README.zh-CN.md)

**Official page [pandalabs.cc](https://pandalabs.cc/products/panda-auth/)** · Chinese site [pandalabs.cn](https://pandalabs.cn/products/panda-auth/) · [PandaLabs product suite](https://pandalabs.cc/products/)

> The PandaAuth suite is currently in **Community Preview 0.2.0-preview.1** — deployed in production and open to early community users. The stable Community Release 1.0.0 has not shipped yet. Access is by invitation or request.

## Responsibility and boundaries

PandaAuth's end-user account center uses a .NET 10 BFF, OpenIddict.Client 7.7.0 and React 19. It references sibling [panda-auth-share](https://github.com/PandaLabs2026/panda-auth-share) and acts as Server's first-party `me-web` client. Production path: `/me`; binding: 127.0.0.1:9007.

## Current implementation and limitations

The [backend](src/PandaAuth.Me/Program.cs) contains OIDC challenge/callback, local Cookie, session, antiforgery logout and health entry points. The [frontend](frontend/src/pages/profile.tsx) includes an identity overview, and the [security settings page](frontend/src/pages/security.tsx) lets users self-manage Passkey/TOTP/recovery codes (same-origin calls to the IDP's `/account/mfa/user/*` with IDP antiforgery tokens; code complete, production release and end-to-end acceptance pending). Login history, devices, grants and password changes remain placeholders or plans.

Default redirect URIs in the local [Auth configuration](src/PandaAuth.Me/appsettings.json) now include the `/me` prefix required by the `/me/callback/login/{provider}` route (local: `http://localhost:9007/me/callback/login/pandaauth`); production values are injected via compose (`Auth__Seed__Me__RedirectUris__*` / `__PostLogoutRedirectUris__*`), and the Server-side Seeder **upserts** existing whitelists to match. The production login flow is verified up to “the IDP renders the login page”, and a scripted OIDC flow verified userinfo, refresh, revocation and logout on 2026-09-17 (the callback carries the `/me` prefix and PKCE `S256`; tampered callback and post-logout refresh-token replay have negative evidence). Real-browser and local-HTTPS acceptance remain outstanding. Cookies always require Secure; logout is not claimed to clear every client session globally.

The [Dockerfile](Dockerfile) uses the **workspace root** as its build context (the project references sibling Share, so it is not a self-contained build from this repository's own context; context filtering comes from the sibling `Dockerfile.dockerignore`, and this repository's `.dockerignore` does not apply to a workspace-root context). The runtime stage starts as the non-root `app` user (uid 1654), carries an image-level `HEALTHCHECK`, and pre-creates plus `chown`s the DataProtection key directory (a missing or root-owned directory makes the application fail closed). That context has produced the me image actually running in production.

## Prerequisites, build and run entry points

Use the .NET SDK selected by [global.json](global.json) (currently 10.0.112 with latestFeature roll-forward). This repository can be built without the private coordination repository, but the public Share repository must be cloned beside it. Commands below run from this repository root.

```bash
git clone https://github.com/PandaLabs2026/panda-auth-me.git
git clone https://github.com/PandaLabs2026/panda-auth-share.git
cd panda-auth-me
```

Share, Node 24 and npm are required. Login validation also requires a working IDP, matching me-web registration and secret, Issuer, callback/logout URLs and local HTTPS. Resolve the blockers first; do not weaken Cookie requirements to make documentation appear one-command ready.

Source build entry points (not proof of a working OIDC login):

```bash
dotnet build PandaAuth.Me.slnx
cd frontend
npm ci
npm run build
```

Frontend output goes to BFF `wwwroot/me`. The backend entry point is `dotnet run --project src/PandaAuth.Me` from the repository root; current development binding is http://localhost:9007, health path `/me/healthz`. Run `npm run dev` in `frontend` for port 5172; the dev server proxies only the routes the BFF actually owns (`/me/api`, `/me/login`, `/me/callback`, `/me/healthz`) to 9007 and leaves the rest of `/me/*` (including `@vite/client` and source files) to Vite — proxying the whole `/me` prefix breaks HMR, the module graph and source debugging. Full local run instructions await callback/TLS/Issuer validation.

Self-service profile and MFA factor management (TOTP, Passkeys, recovery codes) are implemented; administrator and cross-client safety boundaries are enforced on the Server side.

## Roadmap and governance

Product roadmap, release gates and community/commercial boundaries remain maintainer-governed until a formal public release. This README documents only the independently reproducible Me build and runtime boundary.

- [Security](SECURITY.md): selected private reporting channel, enablement unverified; no public vulnerability details.
- [Contributing](CONTRIBUTING.md): repository-specific checks and the shared contribution policy.
- [MIT License](LICENSE) for project-owned code/documentation, subject to [license scope](LICENSING.md); third-party terms remain applicable and brand images are excluded.

## Production state keys and bridge proxy

Non-development environments require an existing `Auth:DataProtectionKeyPath` directory.
The service stores separate OpenIddict state credentials in `client-keys.json` in that directory:
version 1, A256KW/A256CBC-HS512 encryption and RSA-2048/RS256 signing. DataProtection still
protects session cookies and antiforgery tokens with application name `PandaAuth.Me`.
The first key file is published atomically without overwriting an existing file; concurrent
creators read the winner. On Unix a newly created file has mode 0600. Mount and back up the
whole private directory, retain its ownership for the container user, and never log its contents.
Corruption or unsupported material stops startup; it does not silently rotate credentials.
Development without a directory retains ephemeral state keys and logs one startup warning.

The first upgrade from ephemeral keys invalidates in-flight login state once; users can restart
login. Later restarts with the same directory preserve state verification and existing session
cookies. Rolling back to an ephemeral-key image again invalidates in-flight state; do not remove
the volume or key file. Atomic initialization is tested, but a multi-instance deployment also
needs a shared DataProtection key ring and filesystem with atomic, no-overwrite rename semantics.
The restart tests use an offline token stub; they do not claim production IDP login acceptance.

The default production bridge stack must set both `PANDA_AUTH_TENANT_NETWORK_MODE=bridge`
and `PANDA_AUTH_TRUSTED_PROXY` to the allocation's exact IPv4 gateway. Same-subnet peers and
loopback cannot supply trusted forwarded headers in bridge mode. Production ports and release
commands are maintained in the sibling meta repository's `deploy/README.md`.
