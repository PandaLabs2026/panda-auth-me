# panda-auth-me

**PandaAuth by PandaLabs** · [简体中文](README.md)

> In development; no formally supported release yet. Access is by invitation or request. Implementation does not imply a verified release.

## Responsibility and boundaries

PandaAuth's end-user account center uses a .NET 10 BFF, OpenIddict.Client 7.7.0 and React 19. It references sibling [panda-auth-share](https://github.com/PandaLabs2026/panda-auth-share) and acts as Server's first-party `me-web` client. Production path: `/me`; binding: 127.0.0.1:9007.

## Current implementation and limitations

The [backend](src/PandaAuth.Me/Program.cs) contains OIDC challenge/callback, local Cookie, session, antiforgery logout and health entry points. The [frontend](frontend/src/pages/profile.tsx) includes an identity overview. Login history, devices, grants, password changes and MFA are placeholders or plans, not available features.

Default redirect URIs in the local [Auth configuration](src/PandaAuth.Me/appsettings.json) now include the `/me` prefix required by the `/me/callback/login/{provider}` route (local: `http://localhost:9007/me/callback/login/pandaauth`); production values are injected via compose — end-to-end login regression evidence is pending. Cookies always require Secure. HTTP startup and default settings are not a verified login flow. The production compose Issuer and callback/logout combination also needs consistency validation. Logout is not claimed to clear every client session globally.

The [Dockerfile](Dockerfile) currently uses only this repository as context despite the sibling Share reference. This build gap remains unresolved; a working self-contained image build is not claimed.

## Prerequisites, build and run entry points

Use the .NET SDK selected by [global.json](global.json) (currently 10.0.112 with latestFeature roll-forward). Clone repositories as siblings using the [workspace layout](https://github.com/PandaLabs2026/panda-auth/blob/main/WORKSPACE.md); cross-repository links require access. Commands below run from this repository root. They were statically checked, not executed, in this documentation change.

Share, Node 24 and npm are required. Login validation also requires a working IDP, matching me-web registration and secret, Issuer, callback/logout URLs and local HTTPS. Resolve the blockers first; do not weaken Cookie requirements to make documentation appear one-command ready.

Source build entry points (not proof of a working OIDC login):

```bash
dotnet build PandaAuth.Me.slnx
cd frontend
npm ci
npm run build
```

Frontend output goes to BFF `wwwroot/me`. The backend entry point is `dotnet run --project src/PandaAuth.Me` from the repository root; current development binding is http://localhost:9007, health path `/me/healthz`. Run `npm run dev` in `frontend` for port 5172, proxying APIs to 9007. Full local run instructions await callback/TLS/Issuer validation.

Self-service features target Phase 2. Current login and build issues are tracked in G04/G09; administrator and cross-client safety boundaries are covered by G06.

## Roadmap and governance

Implementation targets are tracked in the [capability matrix](https://github.com/PandaLabs2026/panda-auth/blob/main/docs/open-source/capabilities.md) and [release gates](https://github.com/PandaLabs2026/panda-auth/blob/main/docs/open-source/release-readiness.md). Real product needs drive the roadmap; community requests are evaluated without delivery commitments. [Community/commercial boundaries](https://github.com/PandaLabs2026/panda-auth/blob/main/docs/open-source/strategy.md) describe scope, not delivered commercial products.

- [Security](SECURITY.md): selected private reporting channel, enablement unverified; no public vulnerability details.
- [Contributing](CONTRIBUTING.md): repository-specific checks and the shared contribution policy.
- [MIT License](LICENSE) for project-owned code/documentation, subject to [license scope](LICENSING.md); third-party terms remain applicable and brand images are excluded.
