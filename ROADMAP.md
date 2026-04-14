# NimbleCo Roadmap

## Inter-Agent Swarms: On-Device vs Cross-Device

### Current State

Swarms work via a shared universal agent pool (`nimble-agent-1/2/3`) that all bot coordinators dispatch to over the local NATS bus. This works but has problems:

- Universal agents use their own credentials (not the dispatching bot's), so swarm tasks can't be properly isolated per persona
- Universal agents are not managed by Swarm-Map — restarting a bot doesn't restart its workers
- Bots get confused between NATS inter-agent messaging and Mattermost bot-to-bot messaging (two different comms channels that look similar to the LLM)
- All agents must run on the same machine

### Decision: Keep as-is for now

The current architecture is functional and changing it is a non-trivial refactor. The main workaround is manually restarting universal agents after code changes.

### Future Architecture

#### On-Device Swarms → Run inside the coordinator

For swarms where all agents run on the same machine, remove the NATS hop entirely. The coordinator spawns agents as in-process async tasks:

- Uses the bot's own credentials (proper isolation per persona)
- Restart bot in Swarm-Map = workers updated automatically
- No separate processes to manage
- No meaningful latency difference (NATS is sub-ms locally; LLM calls dominate at 15-60s each)
- Eliminates the "inter-agent NATS bus vs Mattermost" confusion — swarms are internal, Mattermost is for bot-to-bot

#### Cross-Device Swarms → NATS bus (to be built)

For a future federated network where agents run on different machines/devices:

- Build a proper distributed NATS setup (NATS server accessible over the internet, not just localhost)
- Per-bot NATS subjects: `tasks.agent-universal.osint`, `tasks.agent-universal.cryptid`, etc.
- Credentials passed via task payload (not env vars) so each bot's workers use the right keys
- Friends can run universal agents on their own machines and contribute to swarms
- This is the foundation for agent-to-agent comms without Mattermost — pure task delegation over NATS

#### Why not use Mattermost for cross-device?

Mattermost works for bot-to-human and bot-to-bot messaging at human speed. For swarm coordination (rapid task/result exchanges, structured payloads, sub-second round-trips) NATS is the right tool. The distinction to maintain:

- **Mattermost**: user-facing, human-readable, async, notifications
- **NATS**: machine-facing, structured, fast, ephemeral task coordination

### Migration Path

1. **(Now)** Keep universal agents, restart manually when code changes
2. **(Soon)** Refactor: move swarm execution into coordinator, drop universal agents for on-device swarms (~2-3h)
3. **(Later)** Rebuild cross-device swarms on a networked NATS bus with per-bot subjects and credential injection

---

## Multi-Channel Messaging: Beyond Mattermost

### Current State

The MattermostListener is tightly coupled to Mattermost's WebSocket API, but the Coordinator and tool system are already platform-agnostic (`ToolContext.platform` supports multiple platforms, `tasks.from-chat.{BOT_ID}` exists as an unused generic inbound subject).

### Architecture: Hermes Frontend + NimbleCo Tool Backend

Rather than rebuilding platform adapters in TypeScript, use Hermes (which already has production Telegram, Discord, Slack, Matrix support) as the messaging frontend. NimbleCo provides the tool backend via its api-server. Swarm-Map wires them together.

```
Platform User → Hermes (owns bot token, manages sessions)
                    → Swarm-Map (policy, credentials, audit)
                        → NimbleCo api-server (tool execution)
```

Each agent registers its own bot via BotFather. Tokens managed per-agent in Swarm-Map.

### Phases

1. **Make Coordinator platform-agnostic** (~2-3h): Add generic `platform`, `chat_channel`, `chat_thread`, `chat_user` fields alongside existing `mattermost_*` fields. Refactor `postToChatPlatform()` to publish to `messages.to-${platform}`. Zero risk to Mattermost.

2. **Hermes Telegram integration** (~2-3 days): Register Hermes agent in Swarm-Map with `parentAgentId` → NimbleCo. Hermes handles Telegram, routes tool calls through Swarm-Map proxy to NimbleCo tools.

3. **Egregore integration** (when ready): Hermes instance per egregore via `/summon`. Coexists with existing relay bot (`bin/notify.sh` for notifications, Hermes for conversation).

4. **Port MattermostListener to generic format** (future): Refactor MattermostListener to use the same generic payload fields, making it one adapter among many rather than the hardcoded default.
