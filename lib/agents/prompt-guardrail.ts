import { createHash } from "crypto";
import fs from "fs";
import path from "path";

const FRONTMATTER_RE = /^---\s*[\r\n]+([\s\S]*?)\r?\n---\s*/;
const VALID_SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type PromptConfidence = "high" | "medium" | "low";

export interface SkillMetadata {
  name: string;
  description: string;
  root: string;
  skill_root: string;
  source: string;
}

export interface SkillDetail extends SkillMetadata {
  instructions: string;
  resource_paths: string[];
}

export interface SkillResource {
  name: string;
  resource_path: string;
  source: string;
  content: string;
}

export interface SkillRegistryAdapter {
  listSkills(): SkillMetadata[];
  loadSkill(name: string): SkillDetail;
  loadSkillResource(name: string, resourcePath: string): SkillResource;
}

export interface CanonicalPromptInput {
  name: string;
  value: string;
}

export interface CanonicalPromptEnvelope {
  cleaned_text: string;
  goal: string;
  task_type: string;
  inputs: CanonicalPromptInput[];
  constraints: string[];
  desired_output: string;
  candidate_skills: string[];
  ambiguities: string[];
  confidence: PromptConfidence;
  ask_back_required: boolean;
}

export interface PromptGuardrailResult {
  envelope: CanonicalPromptEnvelope;
  selected_skills: string[];
  style_modules: string[];
  blocked: boolean;
  block_reason: string;
  correlation_id: string;
  raw_prompt_hash: string;
}

export interface StyleResourceRef {
  label: string;
  skillName: string;
  resourcePath: string;
}

function normalizeSlash(value: string): string {
  return value.replace(/\\/g, "/");
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function parseFrontmatter(markdown: string): { name: string; description: string } {
  const match = markdown.match(FRONTMATTER_RE);
  if (!match) {
    return { name: "", description: "" };
  }

  const frontmatter = match[1];
  const name = frontmatter.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? "";
  const description = frontmatter.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? "";
  return { name, description };
}

function stripFrontmatter(markdown: string): string {
  return markdown.replace(FRONTMATTER_RE, "").trim();
}

function resolveSkillRoots(roots: string[]): string[] {
  const seen = new Set<string>();
  const resolved: string[] = [];
  for (const root of roots) {
    const trimmed = String(root ?? "").trim();
    if (!trimmed || !fs.existsSync(trimmed) || !fs.statSync(trimmed).isDirectory()) continue;
    const fullPath = path.resolve(trimmed);
    if (seen.has(fullPath)) continue;
    seen.add(fullPath);
    resolved.push(fullPath);
  }
  return resolved;
}

function collectFiles(rootDir: string): string[] {
  if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
    return [];
  }

  const files: string[] = [];
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function resolveSkillDirectory(roots: string[], name: string) {
  const skillName = String(name ?? "").trim();
  if (!VALID_SKILL_NAME_RE.test(skillName)) {
    throw new Error(`Invalid skill name: ${skillName || "<empty>"}`);
  }

  for (const root of resolveSkillRoots(roots)) {
    const skillRoot = path.join(root, skillName);
    const skillPath = path.join(skillRoot, "SKILL.md");
    if (fs.existsSync(skillPath) && fs.statSync(skillPath).isFile()) {
      return { skillName, root, skillRoot, skillPath };
    }
  }

  throw new Error(`Skill not found: ${skillName}`);
}

function resolveSkillResource(skillRoot: string, resourcePath: string): string {
  const relativePath = String(resourcePath ?? "").trim();
  if (!relativePath) {
    throw new Error("Resource path is required.");
  }

  const fullPath = path.resolve(skillRoot, relativePath);
  const rootWithSep = `${path.resolve(skillRoot)}${path.sep}`;
  if (fullPath !== path.resolve(skillRoot) && !fullPath.startsWith(rootWithSep)) {
    throw new Error(`Resource path escapes the skill root: ${relativePath}`);
  }
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    throw new Error(`Skill resource not found: ${relativePath}`);
  }
  return fullPath;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizeCleanedText(text: string): string {
  return String(text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeInputs(inputs: CanonicalPromptInput[]): CanonicalPromptInput[] {
  return inputs
    .map((entry) => ({
      name: String(entry?.name ?? "").trim(),
      value: String(entry?.value ?? "").trim(),
    }))
    .filter((entry) => entry.name && entry.value);
}

function computeAmbiguities(
  cleanedText: string,
  inputs: CanonicalPromptInput[],
  requiredInputNames: string[]
): string[] {
  const values = new Map(inputs.map((entry) => [entry.name, entry.value]));
  const ambiguities: string[] = [];

  for (const field of uniqueStrings(requiredInputNames)) {
    if (!values.get(field)) {
      ambiguities.push(`Missing required input: ${field}.`);
    }
  }

  if (!cleanedText) {
    ambiguities.push("The raw prompt is empty after normalization.");
  } else if (cleanedText.length < 24) {
    ambiguities.push("The raw prompt is very short and may be underspecified.");
  }

  if (/\b(?:or|either)\b/i.test(cleanedText) && /\?/i.test(cleanedText)) {
    ambiguities.push("The prompt includes multiple possible actions or outcomes.");
  }

  return uniqueStrings(ambiguities);
}

export function createSkillRegistryAdapter(roots: string[]): SkillRegistryAdapter {
  const resolvedRoots = resolveSkillRoots(roots);
  if (resolvedRoots.length < 1) {
    throw new Error("No skill roots available for the registry adapter.");
  }

  return {
    listSkills(): SkillMetadata[] {
      const seen = new Set<string>();
      const listed: SkillMetadata[] = [];
      for (const root of resolvedRoots) {
        for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const skillPath = path.join(root, entry.name, "SKILL.md");
          if (!fs.existsSync(skillPath) || !fs.statSync(skillPath).isFile()) continue;
          if (seen.has(entry.name)) continue;
          seen.add(entry.name);
          const markdown = fs.readFileSync(skillPath, "utf8");
          const frontmatter = parseFrontmatter(markdown);
          listed.push({
            name: frontmatter.name || entry.name,
            description: frontmatter.description || "",
            root,
            skill_root: path.join(root, entry.name),
            source: skillPath,
          });
        }
      }
      return listed;
    },

    loadSkill(name: string): SkillDetail {
      const resolved = resolveSkillDirectory(resolvedRoots, name);
      const markdown = fs.readFileSync(resolved.skillPath, "utf8");
      const frontmatter = parseFrontmatter(markdown);
      const resourcePaths = collectFiles(path.join(resolved.skillRoot, "references")).map((filePath) =>
        normalizeSlash(path.relative(resolved.skillRoot, filePath))
      );
      return {
        name: frontmatter.name || resolved.skillName,
        description: frontmatter.description || "",
        instructions: stripFrontmatter(markdown),
        root: resolved.root,
        skill_root: resolved.skillRoot,
        source: resolved.skillPath,
        resource_paths: uniqueStrings(resourcePaths),
      };
    },

    loadSkillResource(name: string, resourcePath: string): SkillResource {
      const resolved = resolveSkillDirectory(resolvedRoots, name);
      const fullPath = resolveSkillResource(resolved.skillRoot, resourcePath);
      return {
        name: resolved.skillName,
        resource_path: normalizeSlash(resourcePath),
        source: fullPath,
        content: fs.readFileSync(fullPath, "utf8"),
      };
    },
  };
}

export function buildPromptGuardrailResult(params: {
  rawPrompt: string;
  correlationId: string;
  registry: SkillRegistryAdapter;
  goal: string;
  taskType: string;
  inputs: CanonicalPromptInput[];
  constraints: string[];
  desiredOutput: string;
  candidateSkills: string[];
  baseSkills: string[];
  requiredInputNames: string[];
  consequential?: boolean;
  styleModules?: string[];
}): PromptGuardrailResult {
  const listedSkills = new Set(params.registry.listSkills().map((entry) => entry.name));
  const selectedSkills = uniqueStrings([...params.baseSkills, ...params.candidateSkills]).filter((name) =>
    listedSkills.has(name)
  );
  const normalizedInputs = normalizeInputs(params.inputs);
  const cleanedText = normalizeCleanedText(params.rawPrompt);
  const ambiguities = computeAmbiguities(cleanedText, normalizedInputs, params.requiredInputNames);

  let confidence: PromptConfidence = "high";
  if (ambiguities.length >= 2) {
    confidence = "low";
  } else if (ambiguities.length === 1) {
    confidence = "medium";
  }

  const envelope: CanonicalPromptEnvelope = {
    cleaned_text: cleanedText,
    goal: String(params.goal ?? "").trim(),
    task_type: String(params.taskType ?? "general").trim() || "general",
    inputs: normalizedInputs,
    constraints: uniqueStrings(params.constraints),
    desired_output: String(params.desiredOutput ?? "").trim(),
    candidate_skills: uniqueStrings([...params.baseSkills, ...params.candidateSkills]),
    ambiguities,
    confidence,
    ask_back_required: confidence === "low" || (Boolean(params.consequential) && ambiguities.length > 0),
  };

  return {
    envelope,
    selected_skills: selectedSkills,
    style_modules: uniqueStrings(params.styleModules ?? []),
    blocked: !cleanedText && selectedSkills.length < 1,
    block_reason: !cleanedText && selectedSkills.length < 1 ? "empty_prompt" : "",
    correlation_id: String(params.correlationId ?? "").trim(),
    raw_prompt_hash: sha256(params.rawPrompt),
  };
}

export function buildPromptGuardrailInstructionBlock(params: {
  guardrail: PromptGuardrailResult;
  registry: SkillRegistryAdapter;
  styleResources?: StyleResourceRef[];
}): string {
  const sections: string[] = [];

  for (const skillName of params.guardrail.selected_skills) {
    try {
      const skill = params.registry.loadSkill(skillName);
      sections.push(`Skill: ${skill.name}\n${skill.instructions}`);
    } catch {
      // Keep rendering deterministic even if a skill disappears between list and load.
    }
  }

  for (const resource of params.styleResources ?? []) {
    try {
      const loaded = params.registry.loadSkillResource(resource.skillName, resource.resourcePath);
      sections.push(`Style Module: ${resource.label}\n${loaded.content.trim()}`);
    } catch {
      // Missing resources should not block prompt assembly in tests or dry runs.
    }
  }

  return sections.join("\n\n").trim();
}
