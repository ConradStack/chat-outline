# chat-outline

A Claude Code mod that adds an **Outline** pane beside the chat. The pane
lists every prompt you have sent in the current conversation, so you can see
the shape of a long session at a glance.

Each prompt in the outline shows:

- its number (`#1`, `#2`, ...), in bold
- the time you sent it, in your local time; the date is added for prompts
  not sent today (`2026-11-18 17:25`)
- the full text of the prompt, wrapped across lines, cut off with `...` past
  a character limit (1000 by default)

A dashed rule separates one prompt from the next. The pane updates as you
send new prompts and empties after `/clear`.

Only your own prompts are listed. Claude's replies, tool results, slash
command records, background task notifications and system reminders are left
out.

## Loading the mod

The mod is a plugin folder: this repository. Load it with either of these.

For a single terminal session:

```bash
claude --plugin-dir /path/to/chat-outline
```

For sessions you cannot pass a flag to, such as those the Claude desktop app
starts, name the folder in `CLAUDE_CODE_PLUGIN_DIRS`, in the process
environment or in the `env` block of `~/.claude/settings.json`:

```json
{
    "env": {
        "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/chat-outline"
    }
}
```

Several folders are separated by the platform's path-list separator (`:` on
macOS and Linux).

## Using it

The Outline pane opens when a session starts. If you close it, type
`/outline` to open it again.

## Settings

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `maxQueryChars` | whole number, 1 or more | 1000 | Prompts longer than this are cut off in the outline |

In the terminal the option is a row in the config menu. Elsewhere, set it in
`~/.claude/settings.json` under `pluginConfigs`, keyed by the plugin's name:

```json
{
    "pluginConfigs": {
        "chat-outline": {
            "options": { "maxQueryChars": 500 }
        }
    }
}
```

A plugin loaded with `--plugin-dir` or `CLAUDE_CODE_PLUGIN_DIRS` may be keyed
as `chat-outline@inline` instead. If the value is not a positive whole
number, the pane shows an error instead of the outline.

## Limitations

- **No click-to-scroll in the desktop app.** The outline is read-only. The
  desktop app refuses to let a mod scroll its conversation, so clicking a
  prompt cannot jump to it there.
- **Timestamps come from the session's transcript file.** The mod reads the
  file's new lines each time the pane is drawn. If the file cannot be read,
  a dim note at the top of the pane says why, and the prompts are listed
  without times.
- **Which prompts count is a heuristic.** A user message whose text starts
  with `<` is treated as engine-made (a slash command record or a reminder)
  and left out, so a prompt you typed that starts with `<` is left out too.

## Files

- `.claude-plugin/plugin.json` - the manifest, including the `maxQueryChars`
  option
- `hooks/hooks.json` - names the hooks module
- `hooks/register.tsx` - the mod: the pane, the `/outline` command, and the
  hooks that refresh the pane
- `hooks/register.test.tsx` - tests
- `types/index.d.ts` - the type contract for the mod's one stored value

Claude Code writes `.claude-plugin/types/` each time it loads the mod. It is
generated, so it is left out of git.

## Development

Check the manifest and module the way Claude Code will load them:

```bash
claude plugin validate .
```

Run the tests:

```bash
claude plugin test .
```

Type-check, once Claude Code has loaded the mod and written
`.claude-plugin/types/`:

```bash
npx -p typescript tsc -p .
```
