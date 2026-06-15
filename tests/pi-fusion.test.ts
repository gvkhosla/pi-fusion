import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { buildFusionPresetRequest, parseAdvisorArgs, parsePresetArgs, resolvePresets, type FusionPreset } from "../extensions/pi-fusion.ts";

test("resolvePresets returns the built-in budget, quality, and frontier modes", () => {
	const presets = resolvePresets(null);
	assert.deepEqual(
		presets.map((preset) => preset.mode),
		["budget", "quality", "frontier"],
	);
	for (const preset of presets) {
		assert.ok(preset.slug.startsWith("pi-fusion-"));
		assert.ok(preset.panel.length >= 1 && preset.panel.length <= 8);
		assert.ok(preset.judge.length > 0);
	}
});

test("resolvePresets merges user config overrides and custom modes", () => {
	const presets = resolvePresets({
		modes: {
			budget: {
				panel: ["model/a", "model/b"],
				judge: "model/judge",
				description: "Custom budget mode.",
			},
			team: {
				name: "Team Fusion",
				panel: ["model/x"],
				judge: "model/y",
			},
		},
	});

	const budget = presets.find((preset) => preset.mode === "budget");
	assert.ok(budget);
	assert.deepEqual(budget.panel, ["model/a", "model/b"]);
	assert.equal(budget.judge, "model/judge");
	assert.equal(budget.description, "Custom budget mode.");

	const team = presets.find((preset) => preset.mode === "team");
	assert.ok(team);
	assert.equal(team.slug, "pi-fusion-team");
	assert.equal(team.name, "Team Fusion");
	assert.deepEqual(team.panel, ["model/x"]);
});

test("parsePresetArgs selects modes, deduplicates, supports all, and reports unknown modes", () => {
	const presets = resolvePresets(null);
	assert.equal((parsePresetArgs("", presets) as FusionPreset[]).length, 3);
	assert.equal((parsePresetArgs("all", presets) as FusionPreset[]).length, 3);
	assert.deepEqual(
		(parsePresetArgs("budget quality budget", presets) as FusionPreset[]).map((preset) => preset.mode),
		["budget", "quality"],
	);

	const unknown = parsePresetArgs("budget nope", presets);
	assert.ok("error" in unknown);
	assert.match(unknown.error, /Unknown mode\(s\): nope/);
});

test("parseAdvisorArgs supports --mode flags and preserves the question", () => {
	assert.deepEqual(parseAdvisorArgs("why is this failing?"), { mode: "default", question: "why is this failing?" });
	assert.deepEqual(parseAdvisorArgs("--mode quality why is this failing?"), { mode: "quality", question: "why is this failing?" });
	assert.deepEqual(parseAdvisorArgs("--mode=frontier review the diff"), { mode: "frontier", question: "review the diff" });
	assert.deepEqual(parseAdvisorArgs("-m budget check tests"), { mode: "budget", question: "check tests" });
});

test("buildFusionPresetRequest emits OpenRouter Fusion server-tool payload", () => {
	const preset = resolvePresets(null)[1];
	const body = buildFusionPresetRequest(preset);
	assert.equal(body.model, "openrouter/fusion");
	assert.equal(body.tool_choice, "required");
	assert.deepEqual(body.tools, [
		{
			type: "openrouter:fusion",
			parameters: {
				analysis_models: preset.panel,
				model: preset.judge,
			},
		},
	]);
});

test("bin/resolve-openrouter-key.mjs prefers env, then pi-fusion auth, then openrouter auth", () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-fusion-test-"));
	const authFile = join(dir, "auth.json");
	const script = join(process.cwd(), "bin", "resolve-openrouter-key.mjs");
	const baseEnv: NodeJS.ProcessEnv = { ...process.env, PI_FUSION_AUTH_FILE: authFile };
	delete baseEnv.OPENROUTER_API_KEY;

	writeFileSync(authFile, JSON.stringify({ openrouter: { type: "api_key", key: "openrouter-key" } }));
	let result = spawnSync(process.execPath, [script], { env: baseEnv, encoding: "utf8" });
	assert.equal(result.status, 0);
	assert.equal(result.stdout, "openrouter-key");

	writeFileSync(authFile, JSON.stringify({ "pi-fusion": { type: "api_key", key: "pi-fusion-key" }, openrouter: { type: "api_key", key: "openrouter-key" } }));
	result = spawnSync(process.execPath, [script], { env: baseEnv, encoding: "utf8" });
	assert.equal(result.status, 0);
	assert.equal(result.stdout, "pi-fusion-key");

	result = spawnSync(process.execPath, [script], {
		env: { ...baseEnv, OPENROUTER_API_KEY: "env-key" },
		encoding: "utf8",
	});
	assert.equal(result.status, 0);
	assert.equal(result.stdout, "env-key");
});
