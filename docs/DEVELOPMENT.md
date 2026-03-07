# Development

## Development model

This repository is maintained as a **plugin-only repository**.

It is intended to stay compatible with the currently usable public OpenClaw release line for this plugin target.

## Current compatibility strategy

Current public target:

- OpenClaw `2026.3.2` npm/global install path

This is why the plugin currently imports from:

- `openclaw/plugin-sdk`

instead of using source-tree-only subpaths that may not be exported in the released npm package.

## Local validation

Run upstream compatibility validation locally:

```bash
bash scripts/ci_validate_upstream.sh
```

## Validation flow

The script currently does this:

1. clones upstream OpenClaw
2. installs upstream dependencies
3. patches upstream for OneBot plugin SDK routing
4. overlays this plugin into `extensions/onebot/`
5. runs focused tests
6. runs upstream build

This keeps the repository practical for real released-host compatibility.

## Source files

- `index.ts` - plugin registration entry
- `src/channel.ts` - channel wiring and outbound behavior
- `src/inbound.ts` - inbound parsing, gate checks, owner commands, QQ DM typing
- `src/ws-server.ts` - reverse WebSocket server
- `src/accounts.ts` - account config resolution
- `src/config-schema.ts` - OneBot config schema

## Tests

Focused tests live in:

- `src/ws-server.test.ts`
- `src/inbound-internal.test.ts`

## Public repository policy

This repository is intended to stay public-safe:

- use placeholders in examples and docs
- do not commit real tokens, IPs, account ids, or owner identifiers
- keep deployment-specific details in private runtime configuration, not in the repo
