# pi-fusion

Keep coding with your normal Pi model. When a problem is hard, call Fusion for a second opinion on the question, your diff, or a file — without switching models.

A multi-model advisor layer for [Pi](https://pi.dev), powered by [OpenRouter Fusion](https://openrouter.ai/docs/guides/routing/routers/fusion-router).

## Why this exists

You can already call OpenRouter from Pi. `pi-fusion` adds the workflow around it:

- `/fusion:ask` for a direct multi-model second opinion
- `/fusion:review-diff` to review your current git diff
- `/fusion:review-file` to review a specific file
- budget / quality / frontier preset modes for cost vs capability
- `/fusion:doctor` and `/fusion:setup` for setup and diagnostics

It also still registers Fusion as a first-class Pi provider/model if you want to use it as your main model.

## Install

Install **this repo**. The npm package named `pi-fusion` is a different project.

```bash
pi install git:github.com/gvkhosla/pi-fusion
```

Or try from a local checkout:

```bash
pi -e . --provider pi-fusion --model openrouter/fusion
```

## Auth

Use any one of these:

```bash
export OPENROUTER_API_KEY=sk-or-v1-...
```

or inside Pi:

```text
/login pi-fusion
```

or reuse Pi's built-in OpenRouter auth:

```text
/login openrouter
```

`pi-fusion` resolves keys in this order:

1. `OPENROUTER_API_KEY`
2. `~/.pi/agent/auth.json` entry for `pi-fusion`
3. `~/.pi/agent/auth.json` entry for `openrouter`

## Advisor commands

Ask a general coding question:

```text
/fusion:ask why is this architecture risky?
/fusion:ask --mode quality compare these two approaches
```

Review your staged and unstaged git diff:

```text
/fusion:review-diff
/fusion:review-diff --mode frontier focus on correctness and tests
```

Review one file:

```text
/fusion:review-file src/server.ts
/fusion:review-file src/server.ts --mode budget look for security issues
```

Advisor output is structured as:

```text
Verdict
Main risks
Disagreements / uncertainty
Concrete fixes
Tests to add
Confidence
```

Every advisor command asks for confirmation before making paid Fusion calls.

## Use Fusion as your main model

Default OpenRouter Fusion, no setup required:

```bash
pi --provider pi-fusion --model openrouter/fusion
```

## Preset modes

Create presets from inside Pi:

```text
/fusion:setup                 # create all presets on your OpenRouter account
/fusion:setup budget          # create one preset
/fusion:setup quality frontier
```

Then use them in advisor commands:

```text
/fusion:ask --mode budget <question>
/fusion:review-diff --mode quality
/fusion:review-file src/foo.ts --mode frontier
```

Or as main models:

```bash
pi --provider pi-fusion --model budget
pi --provider pi-fusion --model quality
pi --provider pi-fusion --model frontier
```

| Mode | Backing model | Use when |
|---|---|---|
| `openrouter/fusion` | OpenRouter default router | You want Fusion immediately with no setup |
| `budget` | `@preset/pi-fusion-budget` | You want a cheaper everyday panel |
| `quality` | `@preset/pi-fusion-quality` | You want a strong balanced panel |
| `frontier` | `@preset/pi-fusion-frontier` | You want the broadest, most expensive panel |

## Commands

Inside Pi:

```text
/fusion:help
/fusion:doctor
/fusion:setup [budget|quality|frontier|all]
/fusion:ask [--mode budget|quality|frontier] <question>
/fusion:review-diff [--mode budget|quality|frontier] [optional focus]
/fusion:review-file <path> [--mode budget|quality|frontier] [optional focus]
```

## Configure modes

Override preset panels with `~/.pi/agent/pi-fusion.json`, or point at a different file:

```bash
PI_FUSION_CONFIG=/path/to/pi-fusion.json pi --provider pi-fusion --model team
```

Example:

```json
{
  "modes": {
    "budget": {
      "panel": ["~google/gemini-flash-latest", "deepseek/deepseek-v3.2"],
      "judge": "~google/gemini-flash-latest"
    },
    "team": {
      "name": "Team Fusion",
      "description": "Our preferred internal panel.",
      "panel": ["~anthropic/claude-opus-latest", "~openai/gpt-latest"],
      "judge": "~anthropic/claude-opus-latest"
    }
  }
}
```

Rules:

- mode names must be lowercase letters, numbers, and dashes
- each panel must contain 1–8 model IDs
- `judge` must be a non-empty model ID
- custom modes use `@preset/pi-fusion-<mode>` unless you provide a custom `slug`

## Notes

- Fusion costs more than a single model call: roughly N panel calls + one judge call + the outer response.
- Preset modes only work after `/fusion:setup` creates them for the current OpenRouter account.
- Advisor commands send selected context to OpenRouter. Review diffs/files before sending sensitive code.
- Pi cannot know Fusion's exact dynamic cost from static token prices, so model costs are registered as zero. Use OpenRouter activity/credits for authoritative billing.

## Development

```bash
npm install
npm test

# Individual checks
npm run typecheck
npm run test:unit
npm run test:smoke
```

## License

MIT
