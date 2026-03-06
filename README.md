# fxonebot-openclaw

A standalone OneBot v11 channel plugin repository for OpenClaw, focused on NapCat reverse WebSocket integration.

## What this repository contains

This is a **pure plugin repository**.

It contains only the OneBot plugin source and the minimal GitHub-standard materials needed to:

- understand the plugin
- configure it in OpenClaw
- connect NapCat to it
- validate compatibility against upstream OpenClaw in CI

It does **not** include a full OpenClaw monorepo.

## Features

- OneBot v11 reverse WebSocket server
- Private-chat access via configurable `dmPolicy`
- Group-chat access via `groupPolicy + allowFrom + requireMention`
- Owner-only DM commands for group authorization management
- Message dedupe and self-message filtering
- Upstream compatibility validation in GitHub Actions

## Documentation

- Docs index: `docs/README.md`
- Installation guide: `docs/INSTALLATION.md`
- Development guide: `docs/DEVELOPMENT.md`
- Example OpenClaw config: `examples/openclaw.config.example.json`
- Example NapCat config: `examples/napcat.websocket_client.example.json`

## Repository layout

- `index.ts` - plugin entry
- `openclaw.plugin.json` - plugin manifest
- `package.json` - plugin package metadata
- `src/` - plugin source and tests
- `docs/` - usage and development docs
- `examples/` - generic example configs
- `scripts/` - upstream validation helpers
- `.github/workflows/ci.yml` - CI workflow

## Using this plugin

This repository is designed to be overlaid into upstream OpenClaw as `extensions/onebot/`.

Typical use:

1. Copy this repository contents into `extensions/onebot/`
2. Enable the plugin in OpenClaw
3. Configure `channels.onebot`
4. Configure NapCat `websocketClients`
5. Restart OpenClaw and verify the connection

See `docs/INSTALLATION.md` for the full flow.

## CI model

This repository uses **upstream strong validation**:

- CI clones upstream `openclaw/openclaw`
- patches the upstream workspace for OneBot plugin SDK routing
- overlays this plugin as `extensions/onebot/`
- runs focused tests, build, and upstream checks

That means this repo stays lightweight, while still validating real compatibility with upstream OpenClaw.

## Notes

- All example values are placeholders
- No private infrastructure identifiers are included
- This repo is intended to be public-safe and understandable by others
