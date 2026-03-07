# v0.2.0 Plan - QQ DM Typing

## Scope

This second-version workspace is reserved for the next increment after `v0.1.0`.

Target for `v0.2.0`:

- add **QQ private-chat typing only**
- keep group-chat behavior unchanged
- guarantee typing failure does **not** break streaming reply or final reply

## Locked conclusions from research

- Typing should be **DM-only** for the first implementation.
- OneBot plugin currently does not wire typing into the reply dispatcher yet.
- The safest integration path is to use OpenClaw `createTypingCallbacks`, not a raw direct typing API call.
- NapCat `set_input_status` is currently verified for **C2C / private chat** scope.

## Implementation intent

Planned connection strategy:

1. keep `v0.1.0` untouched
2. implement typing only in this `v0.2.0` workspace
3. wire OneBot inbound reply dispatch with typing callbacks
4. map typing start to NapCat `set_input_status`
5. isolate failure so typing errors are logged but do not break reply delivery

## Non-goals

- no group typing in first release
- no fake typing messages in groups
- no claim that typing is a OneBot-standard capability

## Ready state

This folder is prepared as the separate working base for `v0.2.0`.
No typing code has been changed yet.
