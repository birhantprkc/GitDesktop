# Security Policy

We take the security of GitDesktop seriously. Thank you for helping keep the
project and its users safe.

## Supported versions

GitDesktop is pre-1.0 and ships from a single active release line. Security fixes
land on the **latest released `0.x` version**, so always update to the newest
release before reporting. Older versions are not patched separately.

| Version        | Supported          |
| -------------- | ------------------ |
| Latest `0.x`   | :white_check_mark: |
| Older releases | :x:                |

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues,
discussions, or pull requests.**

Instead, report them privately through GitHub's
[Private Vulnerability Reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability):

1. Go to the repository's **Security** tab.
2. Click **Report a vulnerability**.
3. Fill in as much detail as you can.

A helpful report includes:

- The type of issue and the component affected (e.g. a Tauri command in
  `src-tauri/src/`, secret handling, the auto-updater, or a `gh`/`git` invocation).
- Steps to reproduce, or a proof-of-concept.
- The GitDesktop version and your OS.
- The potential impact, and any suggested mitigation if you have one.

## What to expect

- We aim to acknowledge a report within **3 business days**.
- We'll keep you updated as we investigate and work on a fix, and we'll let you
  know when it ships.
- We support **coordinated disclosure**: please give us a reasonable window to
  release a fix before any public disclosure. We're happy to credit you in the
  advisory and release notes unless you'd prefer to stay anonymous.

## Scope and design notes

A few things that are intentional in GitDesktop and helpful context when assessing
an issue:

- **Tokens are never stored by the app.** All GitHub access goes through the
  GitHub CLI (`gh`); GitDesktop relies on `gh`'s own authentication.
- **API keys live in the OS keychain** (Windows Credential Manager, macOS
  Keychain, libsecret) — never in plaintext app files.
- **Auto-updates are cryptographically signed** and verified by the app before
  install, separate from OS code signing. Reports about update integrity are in
  scope.
- Issues in **third-party dependencies** are best reported upstream, but let us
  know if GitDesktop's usage makes an upstream issue exploitable here.

Thanks again for reporting responsibly.
