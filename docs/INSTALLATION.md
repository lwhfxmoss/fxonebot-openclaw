# Installation

## Target environment

This repository is currently organized for **OpenClaw `2026.3.2` released via npm/global installs**.

## Prerequisites

- A working OpenClaw instance
- A working NapCat instance with OneBot v11 reverse WebSocket support
- Permission to edit OpenClaw configuration

## 1. Place the plugin in OpenClaw

Copy this repository into the OpenClaw workspace as:

- `extensions/onebot/`

The final structure should look like:

- `extensions/onebot/index.ts`
- `extensions/onebot/openclaw.plugin.json`
- `extensions/onebot/package.json`
- `extensions/onebot/src/...`

## 2. Enable the plugin in OpenClaw

Make sure OpenClaw configuration enables the plugin and allows it to load.

## 3. Add OneBot channel configuration

Use the example in `../examples/openclaw.config.example.json` and replace placeholders:

- `<ONEBOT_WS_TOKEN>`
- `<OWNER_QQ>`
- `<GROUP_ID>`

## 4. Configure NapCat

Use the example in `../examples/napcat.websocket_client.example.json`.

Replace placeholders:

- `<OPENCLAW_HOST>`
- `<OPENCLAW_ONEBOT_PORT>`
- `<ONEBOT_WS_TOKEN>`

## 5. Restart and verify

After configuration:

1. Restart OpenClaw
2. Restart or reload NapCat
3. Verify NapCat connects to OpenClaw
4. Test private chat flow
5. Test group allowlist + `@bot` flow
6. Test QQ DM typing indicator

## QQ DM typing note

`v0.2.0` adds QQ private-chat typing support only.

- private chat: supported
- group chat typing: not enabled in this version
- typing failure: should not block reply delivery
