# thumbs-reactions

A Claude Code mod that puts 👍 and 👎 buttons under Claude's latest reply, so you can answer with one click instead of typing.

- **👍** sends `👍 Looks good, continue`
- **👎** sends `👎 That's not right — try another approach`

The buttons appear only once Claude has finished replying, and only under the most recent reply. They stay hidden while Claude (or a subagent) is still working, and disappear as soon as you press one, so a double click can't send twice. Claude reads your reaction like any other message you type.

To change what each button sends, edit `THUMBS_UP` and `THUMBS_DOWN` at the top of `hooks/register.tsx`.

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
