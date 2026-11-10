#!/usr/bin/env node
"use strict";

/**
 * Minimal, dependency-free secret scanner for CI. Walks tracked-looking
 * source files and flags patterns typical of real credentials. It is not a
 * substitute for a dedicated secret-scanning service, but it catches the
 * obvious cases (private keys, cloud access keys, bearer tokens, .env
 * files) without adding an external dependency or network call to CI.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const IGNORED_DIRS = new Set(["node_modules", ".git", ".next", "dist", "out", "coverage"]);
const IGNORED_FILES = new Set([".env.example"]);

const PATTERNS = [
  { name: "PEM private key", regex: /-----BEGIN (RSA |EC |)PRIVATE KEY-----/ },
  { name: "AWS access key ID", regex: /AKIA[0-9A-Z]{16}/ },
  { name: "generic bearer token assignment", regex: /(?:api[_-]?key|secret|token)\s*[:=]\s*["'][A-Za-z0-9+/_\-]{24,}["']/i },
  { name: ".env file committed", regex: null, filenameCheck: (name) => name === ".env" },
];

const SAFE_PLACEHOLDER_HINT = /(local_dev_only|not_a_real_secret|test_secret|do_not_use|placeholder|example)/i;

let findings = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (IGNORED_FILES.has(entry.name)) continue;
    checkFile(full, entry.name);
  }
}

function checkFile(fullPath, name) {
  for (const pattern of PATTERNS) {
    if (pattern.filenameCheck && pattern.filenameCheck(name)) {
      findings.push({ file: fullPath, rule: pattern.name });
    }
  }

  let content;
  try {
    content = fs.readFileSync(fullPath, "utf8");
  } catch {
    return; // binary or unreadable file
  }

  for (const pattern of PATTERNS) {
    if (!pattern.regex) continue;
    const match = content.match(pattern.regex);
    if (match && !SAFE_PLACEHOLDER_HINT.test(match[0])) {
      findings.push({ file: fullPath, rule: pattern.name, match: match[0].slice(0, 40) });
    }
  }
}

walk(ROOT);

if (findings.length > 0) {
  console.error("Potential secrets found:");
  for (const f of findings) {
    console.error(`  [${f.rule}] ${path.relative(ROOT, f.file)}`);
  }
  process.exit(1);
}

console.log("secret-scan: no findings.");
