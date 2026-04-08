#!/usr/bin/env node

/**
 * Structural validation script for SetupMyAi packages.
 *
 * Checks:
 *  1. Every package has a valid apm.yml with required fields
 *  2. Every local path in sources.yml exists on disk
 *  3. No orphan .md/.sh files untracked by sources.yml (warning)
 *  4. No broken {{PLACEHOLDER}} patterns without nearby documentation
 *  5. No duplicate filenames across packages in the same type directory
 *  6. Every skills subdirectory has SKILL.md
 *  7. Every .sh file has the execute bit set
 *
 * Exit 0 on success, 1 on any error.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import YAML from "yaml";
import { globSync } from "glob";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const PACKAGES_DIR = path.join(ROOT, "packages");

let errors = 0;
let warnings = 0;

function pass(msg) {
  console.log(`\u2713 ${msg}`);
}

function fail(msg, details = []) {
  errors++;
  console.log(`\u2717 ${msg}`);
  for (const d of details) {
    console.log(`  - ${d}`);
  }
}

function warn(msg, details = []) {
  warnings++;
  console.log(`\u26A0 ${msg}`);
  for (const d of details) {
    console.log(`  - ${d}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadYaml(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  return YAML.parse(content);
}

function getPackageDirs() {
  return fs
    .readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

// ---------------------------------------------------------------------------
// Check 1 — Every package has a valid apm.yml
// ---------------------------------------------------------------------------

function checkApmYml() {
  const pkgs = getPackageDirs();
  const failedPkgs = [];

  for (const pkg of pkgs) {
    const apmPath = path.join(PACKAGES_DIR, pkg, "apm.yml");
    if (!fs.existsSync(apmPath)) {
      failedPkgs.push(`${pkg}: missing apm.yml`);
      continue;
    }

    let doc;
    try {
      doc = loadYaml(apmPath);
    } catch {
      failedPkgs.push(`${pkg}: apm.yml is not valid YAML`);
      continue;
    }

    const missing = [];
    if (!doc.name) missing.push("name");
    if (!doc.version) missing.push("version");
    if (!doc.description) missing.push("description");

    if (missing.length) {
      failedPkgs.push(`${pkg}: apm.yml missing fields: ${missing.join(", ")}`);
      continue;
    }

    const expected = `@setupmyai/${pkg}`;
    if (doc.name !== expected) {
      failedPkgs.push(
        `${pkg}: apm.yml name "${doc.name}" should be "${expected}"`
      );
    }
  }

  if (failedPkgs.length) {
    fail(
      `${failedPkgs.length} package(s) have invalid or missing apm.yml`,
      failedPkgs
    );
  } else {
    pass(`${pkgs.length} packages have valid apm.yml`);
  }
}

// ---------------------------------------------------------------------------
// Check 2 — Every local path in sources.yml exists
// ---------------------------------------------------------------------------

function checkSourcesExist() {
  const sourcesPath = path.join(ROOT, "sources.yml");
  if (!fs.existsSync(sourcesPath)) {
    fail("sources.yml not found");
    return [];
  }

  const doc = loadYaml(sourcesPath);
  const files = doc.files || [];
  const missing = [];

  for (const entry of files) {
    const localRel = entry.local;
    if (!localRel) continue;
    const localAbs = path.join(ROOT, localRel);
    if (!fs.existsSync(localAbs)) {
      missing.push(localRel);
    }
  }

  if (missing.length) {
    fail(`${missing.length} source entries point to missing files`, missing);
  } else {
    pass(`${files.length} source entries verified`);
  }

  return files;
}

// ---------------------------------------------------------------------------
// Check 3 — No orphan files in packages
// ---------------------------------------------------------------------------

function checkOrphanFiles(sourcesFiles) {
  const trackedDirs = ["commands", "rules", "agents", "hooks", "scripts"];
  const trackedSet = new Set(
    sourcesFiles.map((f) => f.local?.replace(/\/$/, ""))
  );

  const orphans = [];

  for (const pkg of getPackageDirs()) {
    for (const dir of trackedDirs) {
      const fullDir = path.join(PACKAGES_DIR, pkg, dir);
      if (!fs.existsSync(fullDir)) continue;

      const files = globSync("**/*.{md,sh}", { cwd: fullDir });
      for (const file of files) {
        const rel = `packages/${pkg}/${dir}/${file}`;
        if (!trackedSet.has(rel)) {
          orphans.push(rel);
        }
      }
    }
  }

  if (orphans.length) {
    warn(
      `${orphans.length} untracked files in packages (not in sources.yml)`,
      orphans
    );
  } else {
    pass("No untracked files in packages");
  }
}

// ---------------------------------------------------------------------------
// Check 4 — No broken {{PLACEHOLDER}} patterns
// ---------------------------------------------------------------------------

function checkPlaceholders() {
  const mdFiles = globSync("packages/**/*.md", { cwd: ROOT });
  const broken = [];

  for (const rel of mdFiles) {
    const abs = path.join(ROOT, rel);
    const content = fs.readFileSync(abs, "utf8");

    if (!content.includes("{{")) continue;

    // Check if there's documentation about placeholders nearby.
    // We look for words like "placeholder", "replace", "configure",
    // "set ", "variable", or a comment/note within the file.
    const hasDoc =
      /placeholder|replace|configure|set\s|variable|<!--.*\{\{/i.test(content);

    if (!hasDoc) {
      // Extract the placeholder names for the report
      const matches = content.match(/\{\{[^}]+\}\}/g) || [];
      const unique = [...new Set(matches)];
      broken.push(`${rel} (${unique.join(", ")})`);
    }
  }

  if (broken.length) {
    warn(`${broken.length} files with undocumented placeholders`, broken);
  } else {
    pass("No broken placeholders");
  }
}

// ---------------------------------------------------------------------------
// Check 5 — No duplicate filenames across packages
// ---------------------------------------------------------------------------

function checkDuplicateFilenames() {
  const typeDirs = [
    "commands",
    "rules",
    "agents",
    "hooks",
    "scripts",
    "skills",
  ];
  // Map: "type/filename" -> [package names]
  const seen = new Map();
  const pkgs = getPackageDirs();

  for (const pkg of pkgs) {
    for (const dir of typeDirs) {
      const fullDir = path.join(PACKAGES_DIR, pkg, dir);
      if (!fs.existsSync(fullDir)) continue;

      const entries = fs.readdirSync(fullDir);
      for (const entry of entries) {
        const key = `${dir}/${entry}`;
        if (!seen.has(key)) seen.set(key, []);
        seen.get(key).push(pkg);
      }
    }
  }

  const dupes = [];
  for (const [key, packages] of seen) {
    if (packages.length > 1) {
      dupes.push(`${key} in: ${packages.join(", ")}`);
    }
  }

  if (dupes.length) {
    fail(`${dupes.length} duplicate filenames across packages`, dupes);
  } else {
    pass("No duplicate filenames");
  }
}

// ---------------------------------------------------------------------------
// Check 6 — Skills have SKILL.md
// ---------------------------------------------------------------------------

function checkSkillsMd() {
  const pkgs = getPackageDirs();
  const missing = [];

  for (const pkg of pkgs) {
    const skillsDir = path.join(PACKAGES_DIR, pkg, "skills");
    if (!fs.existsSync(skillsDir)) continue;

    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillDir = path.join(skillsDir, entry.name);
      const hasSkillMd =
        fs.existsSync(path.join(skillDir, "SKILL.md")) ||
        fs.existsSync(path.join(skillDir, "SKILL.MD"));
      if (!hasSkillMd) {
        missing.push(`packages/${pkg}/skills/${entry.name}`);
      }
    }
  }

  if (missing.length) {
    fail(`${missing.length} skills missing SKILL.md`, missing);
  } else {
    pass("All skills have SKILL.md");
  }
}

// ---------------------------------------------------------------------------
// Check 7 — Shell scripts are executable
// ---------------------------------------------------------------------------

function checkExecutableBit() {
  const shFiles = [
    ...globSync("packages/**/*.sh", { cwd: ROOT }),
    ...globSync("scripts/**/*.sh", { cwd: ROOT }),
  ];
  const notExecutable = [];

  for (const rel of shFiles) {
    const abs = path.join(ROOT, rel);
    try {
      fs.accessSync(abs, fs.constants.X_OK);
    } catch {
      notExecutable.push(rel);
    }
  }

  if (notExecutable.length) {
    fail(
      `${notExecutable.length} script(s) missing execute bit`,
      notExecutable
    );
  } else {
    pass("All shell scripts are executable");
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log("Validating SetupMyAi packages...\n");

checkApmYml();
const sourcesFiles = checkSourcesExist();
checkOrphanFiles(sourcesFiles);
checkPlaceholders();
checkDuplicateFilenames();
checkSkillsMd();
checkExecutableBit();

console.log(`\nResult: ${errors} error(s), ${warnings} warning(s)`);
process.exit(errors > 0 ? 1 : 0);
