# Design assets (L3)

| Path | Content |
|---|---|
| `stitch/mobile/` | Google Stitch export of the mobile app: one folder per screen with `code.html`, plus `DESIGN.md` |
| `stitch/web/` | Google Stitch export of the web dashboard |
| `renders/` | Current PNG of every screen, rendered from the HTML at 390 px (mobile) and 1440 px (web) |
| `tools/` | The render script |

The HTML files are design references, not production code. The real apps are built in `apps/mobile` and
`apps/web` with the design tokens of `packages/shared`.

Known issues to fix at implementation: see `docs/BUILD_CHECKLIST.md` (contrast tokens, web login button,
confidential greeting, French variants).

## Re-render after a new Stitch export

```bash
cd design/tools
npm install          # installs Puppeteer here only (not in the app workspaces)
npm run render       # needs internet: Tailwind and fonts load from CDNs
```
