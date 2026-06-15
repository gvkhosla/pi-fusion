import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { join } from "node:path";
import type { OAuthCredentials, OAuthLoginCallbacks } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

const PROVIDER_ID = "pi-fusion";
const OPENROUTER_API = "https://openrouter.ai/api/v1";
const DEFAULT_TIMEOUT_MS = 15_000;
const RESOLVER_PATH = fileURLToPath(new URL("../bin/resolve-openrouter-key.mjs", import.meta.url));
const API_KEY_RESOLVER_COMMAND = `!node ${JSON.stringify(RESOLVER_PATH)}`;

type FusionPresetConfig = {
	slug?: string;
	name?: string;
	description?: string;
	panel?: string[];
	judge?: string;
};

type PiFusionConfig = {
	modes?: Record<string, FusionPresetConfig>;
};

export type FusionPreset = {
	mode: string;
	slug: string;
	name: string;
	description: string;
	panel: string[];
	judge: string;
};

const DEFAULT_PRESETS: FusionPreset[] = [
	{
		mode: "budget",
		slug: "pi-fusion-budget",
		name: "Pi Fusion Budget",
		description: "Lower-cost panel for everyday second opinions.",
		panel: ["~google/gemini-flash-latest", "deepseek/deepseek-v3.2", "qwen/qwen3-coder-plus"],
		judge: "~google/gemini-flash-latest",
	},
	{
		mode: "quality",
		slug: "pi-fusion-quality",
		name: "Pi Fusion Quality",
		description: "Balanced frontier panel for hard coding and design work.",
		panel: ["~anthropic/claude-opus-latest", "~openai/gpt-latest", "~google/gemini-pro-latest"],
		judge: "~anthropic/claude-opus-latest",
	},
	{
		mode: "frontier",
		slug: "pi-fusion-frontier",
		name: "Pi Fusion Frontier",
		description: "Maximum-quality broad panel. Most expensive.",
		panel: [
			"~anthropic/claude-opus-latest",
			"~openai/gpt-latest",
			"~google/gemini-pro-latest",
			"deepseek/deepseek-v3.2",
			"qwen/qwen3-coder-plus",
		],
		judge: "~anthropic/claude-opus-latest",
	},
];

type AuthEntry = {
	type?: string;
	key?: string;
	access?: string;
};

type OpenRouterKeyInfo = {
	data?: {
		label?: string;
		usage?: number;
		limit?: number | null;
		is_free_tier?: boolean;
	};
};

type OpenRouterCredits = {
	data?: {
		total_credits?: number;
		total_usage?: number;
	};
};

type FetchLike = typeof fetch;

type OpenRouterRequestOptions = {
	fetchImpl?: FetchLike;
	timeoutMs?: number;
};

function agentAuthPath(): string {
	return join(homedir(), ".pi", "agent", "auth.json");
}

function configPath(): string {
	return process.env.PI_FUSION_CONFIG?.trim() || join(homedir(), ".pi", "agent", "pi-fusion.json");
}

function readAuthJson(): Record<string, AuthEntry> {
	const authPath = agentAuthPath();
	if (!existsSync(authPath)) return {};
	try {
		return JSON.parse(readFileSync(authPath, "utf8")) as Record<string, AuthEntry>;
	} catch {
		return {};
	}
}

function getOpenRouterKey(): { key: string; source: string } | null {
	const envKey = process.env.OPENROUTER_API_KEY?.trim();
	if (envKey) return { key: envKey, source: "$OPENROUTER_API_KEY" };

	const auth = readAuthJson();
	const piFusion = auth[PROVIDER_ID];
	if (piFusion?.key) return { key: piFusion.key, source: `~/.pi/agent/auth.json:${PROVIDER_ID}.key` };
	if (piFusion?.access) return { key: piFusion.access, source: `~/.pi/agent/auth.json:${PROVIDER_ID}.access` };

	const openrouter = auth.openrouter;
	if (openrouter?.key) return { key: openrouter.key, source: "~/.pi/agent/auth.json:openrouter.key" };
	if (openrouter?.access) return { key: openrouter.access, source: "~/.pi/agent/auth.json:openrouter.access" };

	return null;
}

function readPiFusionConfig(): PiFusionConfig | null {
	const path = configPath();
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, "utf8")) as PiFusionConfig;
	} catch (error) {
		console.warn(`pi-fusion: ignoring invalid config at ${path}: ${error instanceof Error ? error.message : String(error)}`);
		return null;
	}
}

function isValidModeName(mode: string): boolean {
	return /^[a-z][a-z0-9-]{0,48}$/.test(mode);
}

function isValidModelList(models: unknown): models is string[] {
	return Array.isArray(models) && models.length >= 1 && models.length <= 8 && models.every((model) => typeof model === "string" && model.trim().length > 0);
}

export function resolvePresets(config: PiFusionConfig | null = readPiFusionConfig()): FusionPreset[] {
	const byMode = new Map(DEFAULT_PRESETS.map((preset) => [preset.mode, { ...preset, panel: [...preset.panel] }]));
	if (!config?.modes) return [...byMode.values()];

	for (const [mode, override] of Object.entries(config.modes)) {
		if (!isValidModeName(mode)) {
			console.warn(`pi-fusion: ignoring invalid mode name ${JSON.stringify(mode)}`);
			continue;
		}

		const base = byMode.get(mode) ?? {
			mode,
			slug: `pi-fusion-${mode}`,
			name: `Pi Fusion ${mode[0]?.toUpperCase() ?? ""}${mode.slice(1)}`,
			description: "Custom Fusion panel.",
			panel: ["~anthropic/claude-opus-latest", "~openai/gpt-latest", "~google/gemini-pro-latest"],
			judge: "~anthropic/claude-opus-latest",
		};

		const panel = override.panel === undefined ? base.panel : override.panel;
		if (!isValidModelList(panel)) {
			console.warn(`pi-fusion: ignoring mode ${mode}: panel must contain 1-8 non-empty model IDs`);
			continue;
		}
		if (override.judge !== undefined && (typeof override.judge !== "string" || !override.judge.trim())) {
			console.warn(`pi-fusion: ignoring mode ${mode}: judge must be a non-empty model ID`);
			continue;
		}

		byMode.set(mode, {
			mode,
			slug: override.slug?.trim() || base.slug,
			name: override.name?.trim() || base.name,
			description: override.description?.trim() || base.description,
			panel: panel.map((model) => model.trim()),
			judge: override.judge?.trim() || base.judge,
		});
	}

	return [...byMode.values()];
}

const PRESETS = resolvePresets();
const PRESET_BY_MODE = new Map(PRESETS.map((preset) => [preset.mode, preset]));

function timeoutFromEnv(): number {
	const raw = process.env.PI_FUSION_TIMEOUT_MS;
	if (!raw) return DEFAULT_TIMEOUT_MS;
	const parsed = Number(raw);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

function truncate(text: string, max = 1_000): string {
	return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function describeFetchError(error: unknown, timeoutMs: number): string {
	if (error instanceof DOMException && error.name === "AbortError") return `request timed out after ${timeoutMs}ms`;
	if (error instanceof Error && error.name === "AbortError") return `request timed out after ${timeoutMs}ms`;
	return error instanceof Error ? error.message : String(error);
}

async function fetchWithTimeout(url: string, init: RequestInit, options: OpenRouterRequestOptions = {}): Promise<Response> {
	const timeoutMs = options.timeoutMs ?? timeoutFromEnv();
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await (options.fetchImpl ?? fetch)(url, { ...init, signal: controller.signal });
	} catch (error) {
		throw new Error(describeFetchError(error, timeoutMs));
	} finally {
		clearTimeout(timeout);
	}
}

async function openRouterGet<T>(apiKey: string, path: string, options: OpenRouterRequestOptions = {}): Promise<T> {
	const response = await fetchWithTimeout(
		`${OPENROUTER_API}/${path}`,
		{ headers: { Authorization: `Bearer ${apiKey}` } },
		options,
	);
	if (!response.ok) {
		throw new Error(`${response.status} ${response.statusText}: ${truncate(await response.text())}`);
	}
	return (await response.json()) as T;
}

async function validateOpenRouterKey(apiKey: string, options?: OpenRouterRequestOptions): Promise<OpenRouterKeyInfo> {
	return openRouterGet<OpenRouterKeyInfo>(apiKey, "key", options);
}

async function getCredits(apiKey: string, options?: OpenRouterRequestOptions): Promise<OpenRouterCredits> {
	return openRouterGet<OpenRouterCredits>(apiKey, "credits", options);
}

async function getPreset(apiKey: string, slug: string, options?: OpenRouterRequestOptions): Promise<unknown> {
	return openRouterGet<unknown>(apiKey, `presets/${encodeURIComponent(slug)}`, options);
}

export function buildFusionPresetRequest(preset: FusionPreset) {
	return {
		model: "openrouter/fusion",
		tools: [
			{
				type: "openrouter:fusion",
				parameters: {
					analysis_models: preset.panel,
					model: preset.judge,
				},
			},
		],
		tool_choice: "required",
		messages: [{ role: "user", content: `Create or update ${preset.slug}.` }],
	};
}

async function createFusionPreset(apiKey: string, preset: FusionPreset, options: OpenRouterRequestOptions = {}) {
	const response = await fetchWithTimeout(
		`${OPENROUTER_API}/presets/${encodeURIComponent(preset.slug)}/chat/completions`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(buildFusionPresetRequest(preset)),
		},
		options,
	);

	const text = await response.text();
	let json: any = null;
	try {
		json = JSON.parse(text);
	} catch {
		// Keep raw text for error output.
	}

	if (!response.ok) {
		const message = truncate(json?.error?.message ?? text);
		throw new Error(`${response.status} ${response.statusText}: ${message}`);
	}

	const model = json?.data?.designated_version?.config?.model;
	const toolTypes = json?.data?.designated_version?.config?.tools?.map((tool: any) => tool.type) ?? [];
	if (model !== "openrouter/fusion" || !toolTypes.includes("openrouter:fusion")) {
		throw new Error("OpenRouter did not confirm that the preset contains the Fusion router/tool configuration.");
	}

	return json;
}

function dollars(value: number | undefined): string {
	if (typeof value !== "number" || Number.isNaN(value)) return "?";
	return `$${Math.round(value * 100) / 100}`;
}

function notifyMultiline(
	ctx: ExtensionCommandContext,
	title: string,
	lines: string[],
	level: "info" | "warning" | "error" = "info",
) {
	ctx.ui.notify(`${title}\n${lines.join("\n")}`, level);
}

export function parsePresetArgs(args: string, presets: FusionPreset[] = PRESETS): FusionPreset[] | { error: string } {
	const byMode = new Map(presets.map((preset) => [preset.mode, preset]));
	const modeList = presets.map((preset) => preset.mode).join(", ");
	const raw = args
		.trim()
		.toLowerCase()
		.split(/[\s,]+/)
		.filter(Boolean);
	if (raw.length === 0 || raw.includes("all")) return presets;

	const selected: FusionPreset[] = [];
	const unknown: string[] = [];
	for (const mode of raw) {
		const preset = byMode.get(mode);
		if (preset) selected.push(preset);
		else unknown.push(mode);
	}
	if (unknown.length > 0) {
		return { error: `Unknown mode(s): ${unknown.join(", ")}. Use: ${modeList}, or all.` };
	}
	return [...new Map(selected.map((preset) => [preset.mode, preset])).values()];
}

async function loginWithOpenRouterKey(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
	const key = (await callbacks.onPrompt({ message: "Paste your OpenRouter API key (sk-or-v1-...):" })).trim();
	if (!key) throw new Error("No OpenRouter API key provided");
	await validateOpenRouterKey(key);
	return {
		access: key,
		refresh: key,
		expires: Date.now() + 100 * 365 * 24 * 60 * 60 * 1000,
	};
}

export default function piFusion(pi: ExtensionAPI) {
	pi.registerProvider(PROVIDER_ID, {
		name: "Pi Fusion (OpenRouter)",
		baseUrl: OPENROUTER_API,
		apiKey: API_KEY_RESOLVER_COMMAND,
		api: "openai-completions",
		headers: {
			"HTTP-Referer": "https://pi.dev",
			"X-Title": "pi-fusion",
		},
		models: [
			{
				id: "openrouter/fusion",
				name: "OpenRouter Fusion",
				reasoning: false,
				input: ["text"],
				contextWindow: 200000,
				maxTokens: 32000,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				compat: {
					supportsStore: false,
					supportsReasoningEffort: false,
					maxTokensField: "max_tokens",
				},
			},
			...PRESETS.map((preset) => ({
				id: `@preset/${preset.slug}`,
				name: preset.name,
				reasoning: false,
				input: ["text" as const],
				contextWindow: 200000,
				maxTokens: 32000,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				compat: {
					supportsStore: false,
					supportsReasoningEffort: false,
					maxTokensField: "max_tokens" as const,
				},
			})),
		],
		oauth: {
			name: "OpenRouter API Key for Pi Fusion",
			login: loginWithOpenRouterKey,
			refreshToken: async (credentials) => credentials,
			getApiKey: (credentials) => credentials.access,
		},
	});

	pi.registerCommand("fusion:doctor", {
		description: "Check OpenRouter key, credits, and pi-fusion presets",
		handler: async (_args, ctx) => {
			const key = getOpenRouterKey();
			if (!key) {
				notifyMultiline(
					ctx,
					"pi-fusion doctor",
					[
						"✗ No OpenRouter key found.",
						"Fix: set OPENROUTER_API_KEY, run /login pi-fusion, or run /login openrouter.",
						"Then select provider pi-fusion and model openrouter/fusion.",
					],
					"warning",
				);
				return;
			}

			const lines = [`✓ key source: ${key.source}`];
			try {
				const info = await validateOpenRouterKey(key.key);
				lines.push(`✓ key valid${info.data?.label ? ` (${info.data.label})` : ""}`);
			} catch (error) {
				lines.push(`✗ key rejected: ${error instanceof Error ? error.message : String(error)}`);
				notifyMultiline(ctx, "pi-fusion doctor", lines, "error");
				return;
			}

			try {
				const credits = await getCredits(key.key);
				const total = credits.data?.total_credits ?? 0;
				const used = credits.data?.total_usage ?? 0;
				lines.push(`✓ credits: ${dollars(total - used)} remaining (${dollars(used)} used)`);
			} catch (error) {
				lines.push(`⚠ credits check failed: ${error instanceof Error ? error.message : String(error)}`);
			}

			for (const preset of PRESETS) {
				try {
					await getPreset(key.key, preset.slug);
					lines.push(`✓ ${preset.mode}: @preset/${preset.slug}`);
				} catch {
					lines.push(`⚠ ${preset.mode}: missing — run /fusion:setup ${preset.mode}`);
				}
			}

			lines.push(
				"",
				"Use:",
				"  pi --provider pi-fusion --model openrouter/fusion",
				...PRESETS.map((preset) => `  pi --provider pi-fusion --model ${preset.mode}`),
			);
			notifyMultiline(ctx, "pi-fusion doctor", lines, "info");
		},
	});

	pi.registerCommand("fusion:setup", {
		description: "Create OpenRouter presets: budget, quality, frontier, or all",
		getArgumentCompletions: (prefix) => {
			const options = ["all", ...PRESETS.map((preset) => preset.mode)];
			return options.filter((option) => option.startsWith(prefix.toLowerCase())).map((option) => ({ value: option, label: option }));
		},
		handler: async (args, ctx) => {
			const key = getOpenRouterKey();
			if (!key) {
				notifyMultiline(
					ctx,
					"pi-fusion setup",
					[
						"No OpenRouter key found.",
						"Set OPENROUTER_API_KEY, run /login pi-fusion, or run /login openrouter first.",
					],
					"warning",
				);
				return;
			}

			const parsed = parsePresetArgs(args);
			if ("error" in parsed) {
				notifyMultiline(ctx, "pi-fusion setup", [parsed.error], "warning");
				return;
			}

			const lines = parsed.map(
				(preset) =>
					`${preset.mode}: ${preset.description}\n  @preset/${preset.slug}\n  panel: ${preset.panel.join(", ")}\n  judge: ${preset.judge}`,
			);
			const ok = await ctx.ui.confirm(
				"Create OpenRouter Fusion preset(s)?",
				[
					"This will create/update these presets on your OpenRouter account:",
					"",
					...lines,
				].join("\n"),
			);
			if (!ok) return;

			const results: string[] = [];
			for (const preset of parsed) {
				try {
					await createFusionPreset(key.key, preset);
					results.push(`✓ ${preset.mode}: @preset/${preset.slug}`);
				} catch (error) {
					results.push(`✗ ${preset.mode}: ${error instanceof Error ? error.message : String(error)}`);
				}
			}
			notifyMultiline(ctx, "pi-fusion setup", results, results.some((line) => line.startsWith("✗")) ? "error" : "info");
		},
	});

	pi.registerCommand("fusion:help", {
		description: "Show pi-fusion usage",
		handler: async (_args, ctx) => {
			notifyMultiline(
				ctx,
				"pi-fusion",
				[
					"Provider:",
					"  pi-fusion",
					"",
					"No setup, default OpenRouter Fusion:",
					"  pi --provider pi-fusion --model openrouter/fusion",
					"",
					"Preset modes:",
					...PRESETS.map((preset) => `  ${preset.mode.padEnd(8)} — ${preset.description}`),
					"",
					"Create presets:",
					"  /fusion:setup",
					...PRESETS.map((preset) => `  /fusion:setup ${preset.mode}`),
					"",
					"Run preset modes:",
					...PRESETS.map((preset) => `  pi --provider pi-fusion --model ${preset.mode}`),
					"",
					"Config override:",
					"  ~/.pi/agent/pi-fusion.json or PI_FUSION_CONFIG=/path/to/config.json",
					"",
					"Auth:",
					"  export OPENROUTER_API_KEY=sk-or-v1-...",
					"  or /login pi-fusion",
					"  or /login openrouter",
				],
				"info",
			);
		},
	});
}
