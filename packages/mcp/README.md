# tamperdonkey-mcp

MCP server for [TamperDonkey](https://github.com/dbugom/TamperDonkey). It lets MCP clients list, install, edit and run userscripts in your browser.

```bash
node src/cli.js --help
```

- Default: MCP over stdio.
- `--http [port]`: MCP over HTTP at `http://127.0.0.1:<port>/mcp` (default 8766). Send the pairing token as a Bearer token.
- `--token`: print the pairing token.
- `--port <n>`: port the browser extension connects to (default 8765).

The token is stored in `~/.config/tamperdonkey/token`, or taken from `TAMPERDONKEY_TOKEN`.

Pair the browser under TamperDonkey > Integrations. See the main README for the permission and confirmation rules.
