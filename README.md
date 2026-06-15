# pi-fusion

Use [OpenRouter Fusion](https://openrouter.ai/docs/guides/routing/routers/fusion-router) in [Pi](https://pi.dev) as a first-class model provider.

Fusion is OpenRouter's multi-model deliberation router: several models can reason over the same prompt in parallel, a judge analyzes the results, and the outer model writes a stronger final answer.

## Why

Pi already has a native provider/model system, so `pi-fusion` does not wrap the `pi` binary or spoof Anthropic environment variables. It simply teaches Pi about Fusion:

```text
provider: pi-fusion
model:    openrouter/fusion
```

You also get optional `budget`, `quality`, and `frontier` preset modes for dialing cost vs capability.

## Install

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

## Use

Default OpenRouter Fusion, no setup required:

```bash
pi --provider pi-fusion --model openrouter/fusion
```

Optional preset modes:

```text
/fusion:setup                 # create all presets on your OpenRouter account
/fusion:setup budget          # create one preset
/fusion:setup quality frontier
```

Then run:

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
```

- `/fusion:doctor` checks key validity, credits, and preset availability.
- `/fusion:setup` creates or updates OpenRouter presets on your account.
- `/fusion:help` shows usage.

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
- Pi's normal coding tools remain available. For simple prompts, OpenRouter's outer model may answer directly instead of invoking Fusion.
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
