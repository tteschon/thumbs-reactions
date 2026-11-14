# thumbs-reactions

A Claude Code mod that puts 👍, 👎 and 🔁 buttons under Claude's latest reply, so you can answer with one click instead of typing.

- **👍** sends `👍 Looks good, continue`
- **👎** sends `👎 That's not right — try another approach`
- **🔁** sends `🔁 Try that again`

The buttons appear only once Claude has finished replying, and only under the most recent reply. They stay hidden while Claude is working on a reply (including subagents it runs as part of that reply), and disappear as soon as you press one, so a double click can't send twice.

## What Claude makes of a press

The mod adds a short section to Claude's system prompt (only in sessions that draw the buttons) saying what each one means:

- **👍** approves the last reply, or says yes to a single yes/no question or one suggested next step. It never picks between options or fills in a value: Claude says so and asks again. It never approves anything the reply didn't propose.
- **👎** means the reply missed: Claude says what it will change, or asks one short question.
- **🔁** asks Claude to redo the work as a fresh attempt, not a rewording.

To change what each button sends, edit `THUMBS_UP`, `THUMBS_DOWN` and `RETRY` at the top of `hooks/register.tsx`; the system-prompt section (`MEANING`) quotes them, so it follows.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install thumbs-reactions --marketplace tteschon/thumbs-reactions
```

Answer `y` to add the marketplace, then press Enter to pick the user scope.

From a shell:

```bash
claude plugin install thumbs-reactions --marketplace tteschon/thumbs-reactions
```

In the Claude desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `tteschon/thumbs-reactions`, then **Add plugin**.

## Development

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

## License

MIT
