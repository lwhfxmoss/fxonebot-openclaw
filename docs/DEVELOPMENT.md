# Development

## Development model

This repository is maintained as a **plugin-only repository**.

The plugin is validated against upstream OpenClaw rather than pretending to be a full OpenClaw workspace.

## Local validation

Run upstream strong validation locally:

```bash
bash scripts/ci_validate_upstream.sh
```

What it does:

1. clones upstream OpenClaw
2. installs upstream dependencies
3. patches upstream for OneBot plugin SDK routing
4. overlays this plugin into `extensions/onebot/`
5. runs focused tests
6. runs upstream build and checks

## Why CI matters

Because the plugin depends on upstream OpenClaw interfaces, CI is the compatibility gate.

If upstream changes plugin SDK import rules, build constraints, or lint rules, this repository should fail early in CI rather than later in deployment.

## Source files

- `index.ts` - plugin registration entry
- `src/channel.ts` - channel plugin wiring
- `src/inbound.ts` - inbound handling and gate logic
- `src/ws-server.ts` - reverse WebSocket server
- `src/accounts.ts` - account resolution
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
