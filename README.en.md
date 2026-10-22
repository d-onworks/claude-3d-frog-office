# 3D Office (claude-3d-office)

[한국어](README.md)

A local web page that shows what each of your Claude Code sessions is doing, at a glance.
Every running project becomes a character (a frog or a capybara) in an isometric office.

![3D Office](docs/screenshot.png)

- While Claude works, the character sits at its desk and types, with the real current action above its head ("📖 Reading server.mjs").
- When Claude needs your approval (a tool permission, an input request), the character stands up and hops with a red label.
- While idle, characters hang out on the sofa, in the pantry or the meeting room: coffee, small talk, phone scrolling.
- Subagents appear as small characters in the same color that line up next to their owner and leave when they finish.
- The right-hand panel lists everyone's status and a live activity log.

It is view-only. Clicking a character shows its details in the side panel; it never controls your terminal.
It works the same no matter where you run Claude Code: VS Code, Cursor, JetBrains, iTerm, Windows Terminal, and so on.

## Quick start

Requirements: [Claude Code](https://code.claude.com/docs/en/overview) and Node.js 18+. Nothing else to install (no `npm install`).

```bash
git clone https://github.com/<you>/claude-3d-office.git
cd claude-3d-office
claude
```

Then ask Claude:

```
Set up the 3D office
```

Claude reads this repo's `CLAUDE.md`, installs the hooks, starts the server and opens your browser. To do it yourself:

```bash
node scripts/setup.mjs
```

Your browser opens `http://127.0.0.1:4777`. Bookmark it.

> Claude sessions that were already open before setup don't know about the new hooks yet. They still show up (from their transcripts),
> but approval requests can't be detected for them. Restart those sessions once (`/exit`, then `claude --continue`) for full accuracy.

Want a look before using it for real? Run `npm run demo` (fake data, port 4778).

## How it works

```
Claude Code ──hooks──▶ hooks/office-hook.mjs ──▶ ~/.claude-office/sessions/<session>.json
browser ◀──every 3s── local server (127.0.0.1) ──▶ session cards + tail of transcripts in ~/.claude/projects
```

1. [Claude Code hooks](https://code.claude.com/docs/en/hooks) call a tiny script at a few moments: session start, prompt submitted, approval needed, stop, session end.
   The script writes one small card file per session. It is not called on every tool use, so it does not slow Claude down.
2. The local server reads those cards plus only the last part of each transcript (jsonl) to work out who is doing what. Subagents are counted from the `subagents/` folder next to the transcript.
3. Sessions opened in the same folder (the repository root, for git repos) merge into one character. Repositories with fewer than 50 commits get a smaller character.

### States

| Claude state | Signal | Character |
|---|---|---|
| Working | prompt received and not finished yet, or a subagent is running | sits at the desk typing, current action above its head |
| Needs you | permission / input notification | hops in front of the desk with a red label |
| Idle | finished (Stop) or interrupted with Esc | relaxes on the sofa, in the pantry or meeting room |
| Gone | session ended, or the Claude process disappeared | walks out the door |

## Configuration

`~/.claude-office/config.json` (optional):

```json
{
  "port": 4777,
  "autoStart": true,
  "homes": { "my-main-project": "server" },
  "hide": ["scratch"],
  "fallbackMinutes": 20,
  "staleHours": 6,
  "kidCommits": 50,
  "lang": "auto"
}
```

| Key | Meaning |
|---|---|
| `port` | Server port. The `CLAUDE_OFFICE_PORT` environment variable wins |
| `autoStart` | If the server is not running when a Claude session starts, start it in the background. No need to restart it after a reboot |
| `homes` | These projects work standing in front of the server rack |
| `hide` | Projects (folder name or path) to keep out of the office |
| `fallbackMinutes` | For sessions without hooks: how recent a transcript must be to show up |
| `staleHours` | Sessions whose process can't be checked leave after this many quiet hours |
| `kidCommits` | Fewer commits than this means a smaller character |
| `lang` | `auto`, `ko` or `en`. You can also switch with the button at the top right |

## Commands

| Command | What it does |
|---|---|
| `node scripts/setup.mjs` | install hooks, start the server, open the browser |
| `node scripts/start.mjs --open` | start the server and open the browser |
| `node scripts/stop.mjs` | stop the server |
| `node scripts/status.mjs` | check hooks, server and detected sessions |
| `node scripts/uninstall.mjs` | remove only this repo's hooks and stop the server (`--purge` also deletes `~/.claude-office`) |
| `npm run demo` | preview with fake data |
| `npm test` | run the tests |

## Privacy and security

- The server listens on `127.0.0.1` only and checks the Host header, so other websites can't read it (DNS rebinding).
- Nothing leaves your machine. No external servers, CDNs or analytics.
- The page shows tool names, file names and command descriptions (the Bash `description`) taken from your transcripts. Keep that in mind when screen sharing.
- Setup backs up `settings.json` (`settings.json.bak-office-…`) before changing it and leaves your existing hooks alone.

## Uninstall

```bash
node scripts/uninstall.mjs
```

This removes only the hooks this repo added. Then delete the folder.

## License

MIT. The characters and the office art were made with AI image generation tools and then edited by hand.
