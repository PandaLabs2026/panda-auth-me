# Isolated Me browser host

Test-only actual Me BFF/production SPA, signed loopback OIDC provider and synthetic MFA reverse-proxy routes. No production configuration, account, database or key material is used. The MFA stand-in checks transport/UX only; it is not a proof of Server MFA authorization. Certificate trust is limited to loopback and the generated certificate, without product changes.

Build `frontend`, then `dotnet build tests/BrowserHost/PandaAuth.Me.BrowserHost.csproj`. Run `dotnet run --no-build --project tests/BrowserHost/PandaAuth.Me.BrowserHost.csproj -- <absolute-Me-root> <private-temp-metadata-path>` with organization TMPDIR. Both listeners use random HTTPS loopback ports. Stop with Ctrl-C. The host metadata/run ID and counters contain no protocol tokens or state.

The cross-service browser driver belongs to the Auth coordinator (`scripts/tests/me-browser-protocol.py`) under the organization implementation-language boundary. Use the approved isolated Playwright environment and its matching Chromium; output stays in the task temporary directory. No driver run is production or human acceptance.
