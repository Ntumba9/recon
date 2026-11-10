"use strict";

const fs = require("fs");
const path = require("path");

function loadDemoScenarios() {
  const fixturePath = path.join(__dirname, "..", "shared", "fixtures", "demo-scenarios.json");
  const raw = fs.readFileSync(fixturePath, "utf8");
  return JSON.parse(raw);
}

module.exports = { loadDemoScenarios };
