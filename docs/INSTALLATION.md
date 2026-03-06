# Installation

## Prerequisites

- A working OpenClaw instance
- A working NapCat instance with OneBot v11 reverse WebSocket support
- Permission to edit OpenClaw configuration

## 1. Place the plugin in OpenClaw

Copy this repository into the upstream OpenClaw workspace as:

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

## Recommended validation order

1. Private chat pairing / allowlist
2. Private chat reply
3. Owner grant command
4. Group `@bot` reply from authorized sender
5. Group no-reply for unauthorized or non-mentioned messages
