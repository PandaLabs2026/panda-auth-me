# panda-auth-me

**PandaAuth by PandaLabs** · [简体中文](README.md)

> In development; no formally supported release yet. Access is by invitation or request. Implementation does not imply a verified release.

## Responsibility and boundaries

PandaAuth's end-user account center uses a .NET 10 BFF, OpenIddict.Client 7.7.0 and React 19. It references sibling [panda-auth-share](https://github.com/PandaLabs2026/panda-auth-share) and acts as Server's first-party `me-web` client. Production path: `/me`; binding: 127.0.0.1:9007.

## Current implementation and limitations

The [backend](src/PandaAuth.Me/Program.cs) contains OIDC challenge/callback, local Cookie, session, antiforgery logout and health entry points. The [frontend](frontend/src/pages/profile.tsx) includes an identity overview. Login history, devices, grants, password changes and MFA are placeholders or plans, not available features.

Default redirect URIs in the local [Auth configuration](src/PandaAuth.Me/appsettings.json) now include the `/me` prefix required by the `/me/callback/login/{provider}` route (local: `http://localhost:9007/me/callback/login/pandaauth`); production values are injected via compose (`Auth__Seed__Me__RedirectUris__*` / `__PostLogoutRedirectUris__*`), and the Server-side Seeder **upserts** existing whitelists to match. The production login flow is **verified up to "the IDP renders the login page"** (callback carries the `/me` prefix, PKCE `S256`; counter-check: a tampered callback is rejected). **The post-login userinfo / refresh / logout path is unverified**, and the local HTTPS constraint still applies. Cookies always require Secure; HTTP startup and default settings are not a verified login flow. Logout is not claimed to clear every client session globally.

The [Dockerfile](Dockerfile) uses the **workspace root** as its build context (the project references sibling Share, so it is not a self-contained build from this repository's own context; context filtering comes from the sibling `Dockerfile.dockerignore`, and this repository's `.dockerignore` does not apply to a workspace-root context). The runtime stage starts as the non-root `app` user (uid 1654), carries an image-level `HEALTHCHECK`, and pre-creates plus `chown`s the DataProtection key directory (a missing or root-owned directory makes the application fail closed). That context has produced the me image actually running in production.

## Prerequisites, build and run entry points

Use the .NET SDK selected by [global.json](global.json) (currently 10.0.112 with latestFeature roll-forward). This repository can be built without the private coordination repository, but the public Share repository must be cloned beside it. Commands below run from this repository root. They were statically checked, not executed, in this documentation change.

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

Self-service features target Phase 2. The current login flow and the build/scan gates are tracked in G04/G09; administrator and cross-client safety boundaries are covered by G06.

## Roadmap and governance

Product roadmap, release gates and community/commercial boundaries remain maintainer-governed until a formal public release. This README documents only the independently reproducible Me build and runtime boundary.

- [Security](SECURITY.md): selected private reporting channel, enablement unverified; no public vulnerability details.
- [Contributing](CONTRIBUTING.md): repository-specific checks and the shared contribution policy.
- [MIT License](LICENSE) for project-owned code/documentation, subject to [license scope](LICENSING.md); third-party terms remain applicable and brand images are excluded.
