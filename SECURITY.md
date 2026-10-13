# Security Policy

## Supported versions

Security fixes are applied to the latest published release on npm (`polygit`).

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Report privately instead:

1. Use GitHub **Private vulnerability reporting** on this repository:  
   https://github.com/Minacava/Polygit/security/advisories/new  
   or
2. Email the maintainer at the address listed on the [npm package page](https://www.npmjs.com/package/polygit) / GitHub profile for **Minacava**.

Include:

- A clear description of the issue and impact
- Steps to reproduce (PoC if possible)
- Affected versions / commit if known

You should receive an acknowledgement within a few days. Please allow time for a fix and coordinated disclosure before public discussion.

## Scope

In scope examples:

- Token or credential leakage (forge tokens, API keys)
- Path traversal or symlink abuse affecting local project files
- Unsafe handling of cloned repository config or remote URLs

Out of scope examples:

- Issues that require an already-compromised local machine with full user access
- Vulnerabilities only in third-party services (GitHub/GitLab/LLM providers) unrelated to polygit’s usage of them
