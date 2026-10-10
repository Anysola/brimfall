# Security policy

Brimfall holds a storage key that can usually read, write and delete everything in your account, so we take security reports seriously.

## Reporting a vulnerability

Please **do not open a public issue**. Report it privately through GitHub's
[private vulnerability reporting](../../security/advisories/new) ("Report a vulnerability" on the Security tab).

Include the affected version or commit, steps to reproduce and the impact you expect. We aim to acknowledge reports within a few days and will credit you in the release notes unless you prefer otherwise.

## Supported versions

Security fixes are made on the latest release.

## Scope notes

- The storage key never leaves the server. The browser gets short-lived presigned URLs for uploads, downloads and previews.
- Every page and API route requires the signed session cookie (`src/proxy.ts`), and state-changing requests must come from the same origin.
- Deployments must use HTTPS. Running over plain HTTP in production is not supported.
