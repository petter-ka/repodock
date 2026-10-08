# ADR-0020: "JWT tool" mini app

- Status: Accepted
- Date: 2026-10-08

## Context

The team generates test JWTs with a small Node script (`jsonwebtoken`, RS256) driven by a `.env` file: ID, email, a comma-separated role list, expiry in days and a base64-encoded PEM key pair. Changing roles means editing the env file and re-running the script, and there is no quick way to inspect or verify a token. This fits the mini app pattern (ADR-0018).

## Decision

- Backend module `internal/modules/jwttool` (standard library only):
  - `Generate(settings)` builds the script's payload shape — `id`, `userId`/`userName`/`name` (email), `deviceId`, `realm`, `resource_access.roles`, `channel` — plus `iat`, `exp` (expiry in days, fractions allowed), `iss`, `sub`; an optional JSON object of extra claims is merged over it. Empty optional strings are left out. RS256 (PKCS#1 v1.5, SHA-256) or HS256.
  - Keys are accepted as PEM text or base64-encoded PEM (the script's `*_SECRET_IN_BASE64` form); PKCS#1/PKCS#8 private keys, PKIX/PKCS#1 public keys or certificates.
  - `Decode(token, settings)` splits the token (a `Bearer ` prefix is ignored), pretty-prints header and payload, reports `iat`/`exp`/expired and `resource_access.roles`, and verifies the signature with the public key, or the private key's public half, or the HS256 secret: `valid`, `invalid` or `unverified` (no key, unsupported algorithm). A malformed token is an error; a bad signature is not.
  - The script used `allowInsecureKeySizes`, so `main.go` sets `//go:debug rsa1024min=0`: Go otherwise refuses RSA keys under 1024 bits. Only this tool uses `crypto/rsa`.
- **Persistence**: the tool's input (fields, role catalogue and selection, extra claims, keys/secret) is stored in `jwt-tool.json` next to the workspace file, written atomically with mode 0600. It is separate from the workspace so it is never part of export/import (ADR-0011), and its content is never logged. The frontend saves 400 ms after the last change and on window close.
- Facade bindings: `JWTSettings`, `SaveJWTSettings`, `GenerateJWT(settings)`, `DecodeJWT(token, settings)`. Generation and decoding take the settings from the UI, so unsaved edits are used immediately.
- UI (`modules/jwt-tool`): Encode | Decode tabs. Encode has collapsible sections for claims, roles, keys (masked until "Show keys") and extra claims, and a sticky Generate button (Mod+Enter) with copy and "Open in decoder". The role list supports search, create (Enter in the search field), inline rename, delete, per-role and bulk ("shown") selection; selected roles keep catalogue order. Decode shows signature/expiry badges, the token's roles, payload and header, and fills the Encode form from the token once per token (`fromToken.ts`): ID, email (`userName`, else `userId`/`name`/`email`), device ID, realm, channel, issuer, subject, expiry from `exp − iat`, algorithm (RS256/HS256), the token's roles added to the catalogue and selected, and any other claims as extra claims. Keys are never changed. The generated token opened via "Open in decoder" is not re-applied, and switching tabs does not re-apply a token over later edits.

## Consequences

- Signing keys live in a plain local file protected by file permissions only. This follows the env-file stance (ADR-0005); OS keychain storage remains future work.
- The payload shape is the team's; other shapes are covered by extra claims (which can override any claim, including `exp`).

## Reconsider when

- Keys should move to the OS keychain.
- Several profiles (environments, users) are needed; the settings file would become a list.
