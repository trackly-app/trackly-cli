# Trackly Apply (local) for Claude

This folder is the source of two downloads published with each trackly-cli release:

- `trackly-apply-claude-skill-<version>.zip`: the Trackly Apply skill for claude.ai. Upload it in Claude under Settings, then Capabilities, then Skills.
- `trackly-claude-plugin-<version>.zip`: a Claude Code plugin that bundles the same skill with the Trackly Claude connector.

Both connect to the Trackly Claude connector:

`https://mcp.usetrackly.app/api/plugin/trackly/claude/mcp`

## What it does

The skill guides Claude through Trackly Apply (local) setup (missing profile answers, the default resume and profile confirmation) and fills job applications the user approved, in the user's own Chrome with Claude in Chrome. It stops before Submit; the user always submits. It reads only typed Trackly state, because Trackly results on Claude carry no prose instructions.

Trackly Apply (local) on Claude is enabled per account while Anthropic reviews the Claude directory listing. Without it, the skill still helps with setup and the connector's job search, profile and Tracker tools work as usual.

## Install

**claude.ai.** Connect Trackly from the Claude directory (or add the connector URL above as a custom connector) and connect Claude in Chrome. Then upload `trackly-apply-claude-skill-<version>.zip` in Settings, Capabilities, Skills.

**Claude Code.** Unzip `trackly-claude-plugin-<version>.zip`. It contains a local marketplace with this plugin. Run:

```text
/plugin marketplace add /absolute/path/to/trackly-claude-plugin-<version>
/plugin install trackly@trackly-claude
```

To update to a newer release, unzip the new archive, then run `/plugin marketplace remove trackly-claude` and repeat the two commands above with the new folder. Bump `version` in `.claude-plugin/plugin.json` whenever the skill changes, so Claude Code installs the new copy.

Or load it for one session with `claude --plugin-dir /absolute/path/to/trackly-claude-plugin-<version>/trackly`. Sign in to Trackly when Claude Code first connects to the server, and connect Claude in Chrome.

## Safety boundary

- Never activates an employer's Submit control.
- Works only on jobs the user approved, and never invents answers.
- Opens only the employer page Trackly froze for each job and enters private data only on origins Trackly authorized.
- Attaches only the exact resume file the user approved for that application.
- Stops for sign-in, account creation, one-time codes and CAPTCHAs.

Privacy: https://usetrackly.app/privacy. Terms: https://usetrackly.app/terms. Support: https://usetrackly.app/support.
