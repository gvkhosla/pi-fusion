import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { join } from "node:path";
import type { OAuthCredentials, OAuthLoginCallbacks } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";

const PROVIDER_ID = "pi-fusion";
const OPENROUTER_API = "https://openrouter.ai/api/v1";
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_ADVISOR_CONTEXT_CHARS = 60_000;
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


type AdvisorArgs = {
	mode: string;
	question: string;
};

type ChatCompletionResponse = {
	choices?: Array<{
		message?: {
			content?: string | null;
		};
	}>;
	error?: {
		message?: string;
	};
};

const ADVISOR_SYSTEM_PROMPT = `You are pi-fusion, a multi-model coding advisor running inside Pi.
Give direct, practical engineering advice. Prefer concrete risks, fixes, and tests over general commentary.
Use this exact structure:

## Verdict
One or two sentences.

## Main risks
- ...

## Disagreements / uncertainty
- ...

## Concrete fixes
- ...

## Tests to add
- ...

## Confidence
Low/Medium/High with one sentence why.`;

function resolveAdvisorModel(mode: string): string | { error: string } {
	const normalized = mode.trim().toLowerCase();
	if (!normalized || normalized === "default" || normalized === "fusion" || normalized === "openrouter/fusion") {
		return "openrouter/fusion";
	}
	const preset = PRESET_BY_MODE.get(normalized);
	if (preset) return `@preset/${preset.slug}`;
	if (normalized.startsWith("@preset/")) return normalized;
	return { error: `Unknown advisor mode: ${mode}. Use default, ${PRESETS.map((preset) => preset.mode).join(", ")}, or @preset/<slug>.` };
}

export function parseAdvisorArgs(args: string): AdvisorArgs {
	const tokens = args.trim().split(/\s+/).filter(Boolean);
	let mode = "default";
	const rest: string[] = [];
	for (let index = 0; index < tokens.length; index++) {
		const token = tokens[index];
		if (token === "--mode" || token === "-m") {
			mode = tokens[index + 1] ?? "default";
			index++;
		} else if (token.startsWith("--mode=")) {
			mode = token.slice("--mode=".length) || "default";
		} else {
			rest.push(token);
		}
	}
	return { mode, question: rest.join(" ").trim() };
}

function clipContext(label: string, content: string, maxChars = MAX_ADVISOR_CONTEXT_CHARS): string {
	if (content.length <= maxChars) return content;
	return `${content.slice(0, maxChars)}\n\n[${label} truncated at ${maxChars.toLocaleString()} characters]`;
}

function buildAdvisorUserPrompt(kind: "ask" | "review-diff" | "review-file", question: string, context: string): string {
	const purpose =
		kind === "review-diff"
			? "Review the git diff below for correctness, maintainability, security, edge cases, and missing tests."
			: kind === "review-file"
				? "Review the file below for correctness, maintainability, security, edge cases, and missing tests."
				: "Answer the coding question below. If context is provided, use it.";
	return [
		purpose,
		question ? `\nUser question:\n${question}` : "",
		context ? `\nContext:\n${clipContext(kind, context)}` : "",
	].join("\n");
}

async function openRouterChatCompletion(
	apiKey: string,
	model: string,
	prompt: string,
	options: OpenRouterRequestOptions = {},
): Promise<string> {
	const response = await fetchWithTimeout(
		`${OPENROUTER_API}/chat/completions`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
				"HTTP-Referer": "https://pi.dev",
				"X-Title": "pi-fusion advisor",
			},
			body: JSON.stringify({
				model,
				messages: [
					{ role: "system", content: ADVISOR_SYSTEM_PROMPT },
					{ role: "user", content: prompt },
				],
				// For the plain openrouter/fusion alias, this forces the injected
				// openrouter:fusion server tool. Presets already carry their own
				// required tool configuration, but this is harmless there too.
				tool_choice: "required",
				max_tokens: 4_000,
			}),
		},
		options,
	);
	const text = await response.text();
	let json: ChatCompletionResponse | null = null;
	try {
		json = JSON.parse(text) as ChatCompletionResponse;
	} catch {
		// Keep raw text for the error below.
	}
	if (!response.ok) {
		throw new Error(`${response.status} ${response.statusText}: ${truncate(json?.error?.message ?? text)}`);
	}
	const content = json?.choices?.[0]?.message?.content;
	if (!content) throw new Error("OpenRouter returned an empty advisor response");
	return content;
}

function renderMarkdownLines(markdown: string): string[] {
	return markdown.trim().split("\n").slice(0, 240);
}

async function confirmFusionSpend(ctx: ExtensionCommandContext, mode: string): Promise<boolean> {
	if (!ctx.hasUI) return true;
	return ctx.ui.confirm(
		"Run OpenRouter Fusion advisor?",
		`This may run several paid model calls on OpenRouter.\n\nMode/model: ${mode}\n\nContinue?`,
	);
}

async function showAdvisorResult(pi: ExtensionAPI, ctx: ExtensionCommandContext, title: string, mode: string, content: string) {
	const rendered = renderMarkdownLines(content);
	ctx.ui.setWidget("pi-fusion-advisor", [title, `mode: ${mode}`, "", ...rendered], { placement: "aboveEditor" });
	pi.sendMessage({
		customType: "fusion-advisor",
		content,
		display: true,
		details: { title, mode, timestamp: Date.now() },
	});
}

async function getGitDiff(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<string> {
	const unstaged = await pi.exec("git", ["diff", "--no-ext-diff"], { cwd: ctx.cwd, timeout: 10_000 });
	const staged = await pi.exec("git", ["diff", "--cached", "--no-ext-diff"], { cwd: ctx.cwd, timeout: 10_000 });
	if (unstaged.code !== 0 && staged.code !== 0) {
		throw new Error((unstaged.stderr || staged.stderr || "git diff failed").trim());
	}
	const parts = [];
	if (unstaged.stdout.trim()) parts.push(`## Unstaged diff\n\n${unstaged.stdout}`);
	if (staged.stdout.trim()) parts.push(`## Staged diff\n\n${staged.stdout}`);
	return parts.join("\n\n");
}

function readFileForReview(pathArg: string, cwd: string): { label: string; content: string } {
	const trimmed = pathArg.trim();
	if (!trimmed) throw new Error("Usage: /fusion:review-file <path> [optional question] [--mode quality]");
	const [rawPath] = trimmed.split(/\s+/, 1);
	if (!rawPath) throw new Error("Usage: /fusion:review-file <path> [optional question] [--mode quality]");
	const absolutePath = rawPath.startsWith("/") ? rawPath : join(cwd, rawPath);
	const content = readFileSync(absolutePath, "utf8");
	return { label: rawPath, content };
}

function stripFirstToken(text: string): string {
	return text.trim().replace(/^\S+\s*/, "").trim();
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
	pi.registerMessageRenderer("fusion-advisor", (message, { expanded }, theme) => {
		const details = message.details as { title?: string; mode?: string; timestamp?: number } | undefined;
		const content = typeof message.content === "string" ? message.content : JSON.stringify(message.content, null, 2);
		const visible = expanded ? content : renderMarkdownLines(content).join("\n");
		const header = `${theme.fg("success", details?.title ?? "pi-fusion advisor")} ${theme.fg("dim", details?.mode ? `(${details.mode})` : "")}`;
		const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
		box.addChild(new Text(`${header}\n${visible}`, 0, 0));
		return box;
	});

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

	pi.registerCommand("fusion:ask", {
		description: "Ask OpenRouter Fusion for a structured second opinion",
		getArgumentCompletions: (prefix) => {
			const options = ["--mode", "--mode=budget", "--mode=quality", "--mode=frontier", ...PRESETS.map((preset) => preset.mode)];
			return options.filter((option) => option.startsWith(prefix.toLowerCase())).map((option) => ({ value: option, label: option }));
		},
		handler: async (args, ctx) => {
			const parsed = parseAdvisorArgs(args);
			let question = parsed.question;
			if (!question && ctx.hasUI) question = (await ctx.ui.input("Ask Fusion", "What should the model panel analyze?"))?.trim() ?? "";
			if (!question) {
				notifyMultiline(ctx, "pi-fusion ask", ["Usage: /fusion:ask [--mode budget|quality|frontier] <question>"], "warning");
				return;
			}
			const model = resolveAdvisorModel(parsed.mode);
			if (typeof model !== "string") {
				notifyMultiline(ctx, "pi-fusion ask", [model.error], "warning");
				return;
			}
			const key = getOpenRouterKey();
			if (!key) {
				notifyMultiline(ctx, "pi-fusion ask", ["No OpenRouter key found. Set OPENROUTER_API_KEY, run /login pi-fusion, or run /login openrouter."], "warning");
				return;
			}
			if (!(await confirmFusionSpend(ctx, model))) return;
			ctx.ui.setStatus("pi-fusion", "asking Fusion…");
			try {
				const prompt = buildAdvisorUserPrompt("ask", question, "");
				const answer = await openRouterChatCompletion(key.key, model, prompt);
				await showAdvisorResult(pi, ctx, "pi-fusion advisor", model, answer);
			} catch (error) {
				notifyMultiline(ctx, "pi-fusion ask failed", [error instanceof Error ? error.message : String(error)], "error");
			} finally {
				ctx.ui.setStatus("pi-fusion", undefined);
			}
		},
	});

	pi.registerCommand("fusion:review-diff", {
		description: "Review the current git diff with OpenRouter Fusion",
		getArgumentCompletions: (prefix) => {
			const options = ["--mode", "--mode=budget", "--mode=quality", "--mode=frontier", ...PRESETS.map((preset) => preset.mode)];
			return options.filter((option) => option.startsWith(prefix.toLowerCase())).map((option) => ({ value: option, label: option }));
		},
		handler: async (args, ctx) => {
			const parsed = parseAdvisorArgs(args);
			const model = resolveAdvisorModel(parsed.mode);
			if (typeof model !== "string") {
				notifyMultiline(ctx, "pi-fusion review-diff", [model.error], "warning");
				return;
			}
			const key = getOpenRouterKey();
			if (!key) {
				notifyMultiline(ctx, "pi-fusion review-diff", ["No OpenRouter key found. Set OPENROUTER_API_KEY, run /login pi-fusion, or run /login openrouter."], "warning");
				return;
			}
			let diff = "";
			try {
				diff = await getGitDiff(pi, ctx);
			} catch (error) {
				notifyMultiline(ctx, "pi-fusion review-diff", [error instanceof Error ? error.message : String(error)], "error");
				return;
			}
			if (!diff.trim()) {
				notifyMultiline(ctx, "pi-fusion review-diff", ["No staged or unstaged git diff found."], "info");
				return;
			}
			if (!(await confirmFusionSpend(ctx, model))) return;
			ctx.ui.setStatus("pi-fusion", "reviewing diff with Fusion…");
			try {
				const prompt = buildAdvisorUserPrompt("review-diff", parsed.question, diff);
				const answer = await openRouterChatCompletion(key.key, model, prompt);
				await showAdvisorResult(pi, ctx, "pi-fusion diff review", model, answer);
			} catch (error) {
				notifyMultiline(ctx, "pi-fusion review-diff failed", [error instanceof Error ? error.message : String(error)], "error");
			} finally {
				ctx.ui.setStatus("pi-fusion", undefined);
			}
		},
	});

	pi.registerCommand("fusion:review-file", {
		description: "Review one file with OpenRouter Fusion",
		getArgumentCompletions: (prefix) => {
			const options = ["--mode", "--mode=budget", "--mode=quality", "--mode=frontier", ...PRESETS.map((preset) => preset.mode)];
			return options.filter((option) => option.startsWith(prefix.toLowerCase())).map((option) => ({ value: option, label: option }));
		},
		handler: async (args, ctx) => {
			let file;
			try {
				file = readFileForReview(args, ctx.cwd);
			} catch (error) {
				notifyMultiline(ctx, "pi-fusion review-file", [error instanceof Error ? error.message : String(error)], "warning");
				return;
			}
			const parsed = parseAdvisorArgs(stripFirstToken(args));
			const model = resolveAdvisorModel(parsed.mode);
			if (typeof model !== "string") {
				notifyMultiline(ctx, "pi-fusion review-file", [model.error], "warning");
				return;
			}
			const key = getOpenRouterKey();
			if (!key) {
				notifyMultiline(ctx, "pi-fusion review-file", ["No OpenRouter key found. Set OPENROUTER_API_KEY, run /login pi-fusion, or run /login openrouter."], "warning");
				return;
			}
			if (!(await confirmFusionSpend(ctx, model))) return;
			ctx.ui.setStatus("pi-fusion", `reviewing ${file.label} with Fusion…`);
			try {
				const context = `File: ${file.label}\n\n${file.content}`;
				const prompt = buildAdvisorUserPrompt("review-file", parsed.question, context);
				const answer = await openRouterChatCompletion(key.key, model, prompt);
				await showAdvisorResult(pi, ctx, `pi-fusion file review: ${file.label}`, model, answer);
			} catch (error) {
				notifyMultiline(ctx, "pi-fusion review-file failed", [error instanceof Error ? error.message : String(error)], "error");
			} finally {
				ctx.ui.setStatus("pi-fusion", undefined);
			}
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
					"Advisor commands:",
					"  /fusion:ask <question>",
					"  /fusion:review-diff [optional focus]",
					"  /fusion:review-file <path> [optional focus]",
					"  add --mode budget|quality|frontier to use a preset",
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
