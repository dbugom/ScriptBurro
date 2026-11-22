# scriptburro-mcp

MCP server for [ScriptBurro](https://github.com/dbugom/ScriptBurro). It lets MCP clients list, install, edit and run userscripts in your browser.

```bash
node src/cli.js --help
```

- Default: MCP over stdio.
- `--http [port]`: MCP over HTTP at `http://127.0.0.1:<port>/mcp` (default 8766). Send the pairing token as a Bearer token.
- `--token`: print the pairing token.
- `--port <n>`: port the browser extension connects to (default 8765).

The token is stored in `~/.config/scriptburro/token`, or taken from `SCRIPTBURRO_TOKEN`.

Pair the browser under ScriptBurro > Integrations. See the main README for the permission and confirmation rules.
