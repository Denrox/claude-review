#!/usr/bin/env node

import { readFileSync, mkdirSync, existsSync, readdirSync, writeFileSync } from "fs";
import { execSync, execFileSync } from "child_process";
import { join, resolve } from "path";
import { parseArgs } from "util";

const ROOT_DIR = resolve(import.meta.dirname);
const REPOS_DIR = join(ROOT_DIR, "repos");
const ARTIFACTS_DIR = join(ROOT_DIR, "artifacts");
const REPO_JSON = join(ROOT_DIR, "repo.json");

// --- CLI args ---

const { values } = parseArgs({
  options: {
    ticket: { type: "string", short: "t" },
    requirements: { type: "string", short: "r" },
  },
  strict: true,
});

const ticketId = values.ticket;
if (!ticketId) {
  console.error("Usage: node review.mjs -t <TICKET_ID> [-r <requirements-url>]");
  process.exit(1);
}

const requirementsUrl = values.requirements ?? null;

// --- Load repos ---

const repos = JSON.parse(readFileSync(REPO_JSON, "utf-8"));

// --- Helpers ---

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], ...opts }).trim();
}

function findBranchWithTicket(url, ticketId) {
  try {
    const refs = run(`git ls-remote --heads ${url}`);
    const branches = refs
      .split("\n")
      .map((line) => line.replace(/^.*refs\/heads\//, ""))
      .filter((branch) => branch.toLowerCase().includes(ticketId.toLowerCase()));
    return branches[0] ?? null;
  } catch (e) {
    console.error(`  Failed to query ${url}: ${e.message}`);
    return null;
  }
}

function cloneOrUpdate(url, branch, targetBranch, dest) {
  if (!existsSync(dest)) {
    console.log(`  Cloning ${url} (branch: ${branch})...`);
    run(`git clone --branch ${branch} ${url} ${dest}`);
    run(`git fetch origin ${targetBranch}`, { cwd: dest });
  } else {
    console.log(`  Repo already cloned, updating...`);
    run(`git fetch origin ${branch} ${targetBranch}`, { cwd: dest });
    run(`git checkout ${branch}`, { cwd: dest });
    run(`git pull origin ${branch}`, { cwd: dest });
  }
}

function getNextIteration(ticketDir) {
  if (!existsSync(ticketDir)) return 1;
  const existing = readdirSync(ticketDir)
    .filter((d) => /^\d+$/.test(d))
    .map(Number);
  return existing.length === 0 ? 1 : Math.max(...existing) + 1;
}

function buildPrompt(alias, targetBranch, featureBranch, repoDir, iterationDir, previousIterations) {
  let prompt = `You are performing a code review on repository "${alias}".

STEP 1 — STUDY REPOSITORY PATTERNS:
Before reviewing changes, study the codebase to understand patterns and conventions used in this repository.
Look at project structure, naming conventions, code style, architectural patterns, error handling patterns,
testing patterns, and any configuration files (.eslintrc, .prettierrc, tsconfig, etc.).

STEP 2 — REVIEW THE DIFF:
Review all changes between branch "${featureBranch}" and target branch "${targetBranch}".
The diff is provided below.

Focus your review on (in priority order):
1. **Repository code pattern violations** (HIGH PRIORITY) — flag any code that deviates from
   the established patterns and conventions you identified in Step 1.
2. **Code duplicates / extraction opportunities** (HIGH PRIORITY) — identify any duplicated logic that already exists
   elsewhere in the repository or within the diff itself. For each duplicate, specify the exact file:line-range
   for EVERY occurrence (both in the diff and in the repo). Describe what the duplicated logic does
   but do NOT include actual code — reference by file:line-range only.
3. **Reusable logic candidates** — identify pieces of logic in the diff that are general-purpose enough
   to be extracted into a shared utility, hook, or helper. Look for: data transformations, formatting,
   validation, or business rules that are not specific to one component and could benefit other parts of
   the codebase. Reference by file:line-range and suggest where it should live (e.g., an existing utils module).
4. **Security violations** — look for injection vulnerabilities, hardcoded secrets,
   insecure data handling, missing input validation, and other OWASP top-10 issues.

Also note: logical errors, potential bugs, missing edge-case handling, and test coverage gaps.

IMPORTANT — REFERENCING LOCATIONS:
When reporting issues, always reference the exact location using the format:
  \`file/path.ts:42\` for a single line, or
  \`file/path.ts:42-58\` for a range of lines.
Use the line numbers from the target file (after applying the diff). Every finding MUST include at least one file:line or file:line-range reference.
`;

  if (requirementsUrl) {
    prompt += `
REQUIREMENTS:
The requirements for this ticket can be found at: ${requirementsUrl}
Fetch and review the requirements, then verify the implementation satisfies them.
`;
  }

  if (previousIterations.length > 0) {
    prompt += `
PREVIOUS REVIEW ITERATIONS:
The following previous code review iterations exist. Read them and:
- Check if issues from previous iterations have been addressed in the current code.
- Do NOT repeat issues that have already been fixed.
- Note any issues that remain unresolved.

Previous iteration files:
${previousIterations.map((p) => `- ${p}`).join("\n")}
`;
  }

  prompt += `
IMPORTANT RULES:
- The report MUST be in plain text format (.txt). Do NOT use markdown, HTML, or any other markup.
- Do NOT include any code snippets in the report. Reference code only by file path and line numbers
  (e.g., file/path.ts:42 or file/path.ts:42-58). Never quote or paste actual source code.

OUTPUT FORMAT:
Structure your review as:

# Code Review: ${alias} — [Ticket ${ticketId}]

## Repository Patterns Summary
(Brief summary of key patterns identified)

## Review Findings

### Pattern Violations (High Priority)
(List each violation with file:line or file:line-range, description, and suggested fix)

### Code Duplicates / Extraction Opportunities (High Priority)
(For each duplicate, list the file:line-range for EVERY occurrence — both in the diff and in existing repo locations. Describe the duplicated logic but do NOT include code. Suggest extraction if applicable.)

### Reusable Logic Candidates
(Identify general-purpose logic that could be extracted into shared utilities, hooks, or helpers. Reference by file:line-range, explain why it is reusable, and suggest where it should live. Do NOT include code.)

### Security Issues
(List any security concerns with file:line or file:line-range references)

### Other Issues
(Bugs, edge cases, test gaps, etc. — always include file:line or file:line-range)

## Summary
(Overall assessment and key action items)
`;

  return prompt;
}

// --- Main ---

console.log(`\nTicket: ${ticketId}`);
if (requirementsUrl) console.log(`Requirements: ${requirementsUrl}`);
console.log(`Scanning ${repos.length} repo(s) for branches matching "${ticketId}"...\n`);

mkdirSync(REPOS_DIR, { recursive: true });

const matched = [];

for (const repo of repos) {
  const { url, targetBranch, alias } = repo;
  console.log(`[${alias}] Checking...`);
  const branch = findBranchWithTicket(url, ticketId);
  if (branch) {
    console.log(`  Found branch: ${branch}`);
    matched.push({ ...repo, featureBranch: branch });
  } else {
    console.log(`  No matching branch found.`);
  }
}

if (matched.length === 0) {
  console.log("\nNo repos have a branch matching the ticket ID. Nothing to review.");
  process.exit(0);
}

console.log(`\n${matched.length} repo(s) matched. Cloning and reviewing...\n`);

const ticketDir = join(ARTIFACTS_DIR, ticketId);
const iteration = getNextIteration(ticketDir);
const iterationDir = join(ticketDir, String(iteration));
mkdirSync(iterationDir, { recursive: true });

console.log(`Artifacts will be written to: artifacts/${ticketId}/${iteration}/\n`);

// Collect previous iteration file paths
const previousIterations = [];
for (let i = 1; i < iteration; i++) {
  const prevDir = join(ticketDir, String(i));
  if (existsSync(prevDir)) {
    for (const file of readdirSync(prevDir).filter((f) => f.endsWith(".txt"))) {
      previousIterations.push(join(prevDir, file));
    }
  }
}

for (const repo of matched) {
  const { url, targetBranch, alias, featureBranch } = repo;
  const repoDir = join(REPOS_DIR, alias);
  const outputFile = join(iterationDir, `${alias}.txt`);

  console.log(`[${alias}] Preparing...`);
  cloneOrUpdate(url, featureBranch, targetBranch, repoDir);

  // Generate diff
  const diff = run(`git diff origin/${targetBranch}...origin/${featureBranch}`, { cwd: repoDir, maxBuffer: 50 * 1024 * 1024 });

  if (!diff) {
    console.log(`  No diff found. Skipping review.`);
    writeFileSync(outputFile, "No changes detected between branches.\n");
    continue;
  }

  const prompt = buildPrompt(alias, targetBranch, featureBranch, repoDir, iterationDir, previousIterations);
  const fullPrompt = `${prompt}\n\nDIFF:\n\`\`\`diff\n${diff}\n\`\`\``;

  console.log(`[${alias}] Running Claude code review...`);
  try {
    const result = execFileSync("claude", ["-p", fullPrompt, "--output-format", "text"], {
      encoding: "utf-8",
      cwd: repoDir,
      maxBuffer: 50 * 1024 * 1024,
      timeout: 600_000,
    });
    writeFileSync(outputFile, result);
    console.log(`[${alias}] Review written to: artifacts/${ticketId}/${iteration}/${alias}.txt`);
  } catch (e) {
    console.error(`[${alias}] Claude review failed: ${e.message}`);
    writeFileSync(outputFile, `Review failed:\n${e.message}\n`);
  }
}

console.log("\nDone.");
