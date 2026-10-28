# Claude Code + hosted Freejira

This adapter talks to the published Sites database. It does not use the old local SQLite application. Node.js 22+ is required; no packages, daemon, public port or second Mac are needed.

## One-time setup

The Site owner provisions service access using the supported Sites `get_site` credential. Run `node mcp/connector.mjs configure`, then supply `{ "siteUrl": "https://your-site.chatgpt.site", "siteAccessToken": "..." }` through its hidden stdin. Never put service access in shell arguments, source, browser code, screenshots or chat. This credential only passes Sites dispatch; it does not identify a user or grant task access by itself.

1. `node mcp/connector.mjs pair "Claude Code · my computer"`
2. Open the returned URL in your signed-in Freejira account, compare the displayed code, then choose **Подключить Claude Code**. Request expires after 10 minutes. This binds the random 256-bit application token to the approving active workspace member. The database stores only its SHA-256 hash.
3. `node mcp/connector.mjs finish`
4. `node mcp/connector.mjs check`
5. Copy this adapter to a stable user directory and register it: `claude mcp add --scope user --transport stdio freejira -- /absolute/path/to/node /absolute/path/to/connector.mjs`.
6. Copy `freejira-task.md` to `~/.claude/commands/freejira-task.md`. Start a new Claude Code session in the repository that implements the task. Use `/mcp` to check the connection.

Configuration lives in `~/.config/freejira/mcp.json` (directory 0700, file 0600); `FREEJIRA_MCP_CONFIG` overrides its location for tests. The adapter keeps credentials out of Claude MCP config and tool output. It does not retry writes after an uncertain response. Do not commit or share this file. An existing connection remains usable while a new pairing is pending; finish switches to the new one. Revoke old connections in Freejira after changing computers.

## Usage

`/freejira-task DEMO-12 review` — implement, test, report, then move to «На проверке».

`/freejira-task DEMO-12 done` — implement, test, report, then move to «Готово» if completed.

You can pass a copied Freejira task URL instead of the key. Without a target column, the command uses review. It does not start a background agent or watch all tasks. Claude runs when you give it a task, in its current repository, under its normal tool permissions.

Connections permit workspace reads (including video screenshots attached to tasks), task updates and comments; project creation/editing, task creation/deletion, team administration and the video worker API are unavailable. Writes retain user attribution and source=mcp. Revoke access under **MCP и AI → Claude Code → Ваши подключения**. Deactivating a workspace member also blocks their connections. Tokens expire after one year; re-pair when needed.

The shared Site audience and native ChatGPT/Codex MCP remain unchanged. Removing a Sites viewer grant alone is not sufficient to revoke their existing service-backed app token: deactivate the workspace member or revoke the connection as well.

The external transport is `/api/mcp/rpc`, behind Sites service access plus the app token. The native `/mcp` is reserved by Sites for its own OAuth clients and remains available to the built-in ChatGPT/Codex plugin. Claude Desktop local Code sessions load the same user MCP configuration; a terminal is only used during initial installation.
