# mintows Browser Relay (Render)

Deploy this directory as a Node web service on Render.

Environment variable:
- `MINTOWS_GATE_PASSWORD` = the same secret used by the Windows Browser agent.

The relay exposes:
- `/remote` browser client
- `/ws` client WebSocket (WSS when Render serves HTTPS)
- `/agent` outbound WebSocket used by mintows Browser
- `/health` status

Do not expose the relay without a strong gate password. The relay can forward browser screen frames and input events.

## v26 diagnostics
- Render `/health` now reports `agentConnected`, `agentConnectedAt`, `agentLastMessageAt`, and `agentAuthFailures`.
- The Windows agent writes `%APPDATA%\mintows Browser\remote-relay.log`.
- `show-relay-log.cmd` opens that log in Notepad.


v27 uses a single ws WebSocketServer with explicit HTTP upgrade routing for /ws and /agent.


v0.39 uses WebRTC for video/audio. The Render service only handles HTTPS, authentication, WebRTC signaling, state and control/file messages. No JPEG/Base64 video is relayed through Render. STUN is configured in the client/agent; TURN is not bundled.
