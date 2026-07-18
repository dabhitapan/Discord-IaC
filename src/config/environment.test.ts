import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { loadProjectEnvironment } from "./environment.js";
import { DEFAULT_PROFILE, getSelectedProfileName } from "./profileSelection.js";

const fixtures = path.resolve("test", "fixtures", "environment");

test("PROFILE from an env file selects titanz", () => {
  const environment: NodeJS.ProcessEnv = {};
  loadProjectEnvironment({
    envFile: path.join(fixtures, "titanz.env"),
    environment,
  });
  assert.equal(getSelectedProfileName(environment), "titanz");
});

test("shell PROFILE takes precedence over the env file", () => {
  const environment: NodeJS.ProcessEnv = { PROFILE: "wao-noobs" };
  loadProjectEnvironment({
    envFile: path.join(fixtures, "titanz.env"),
    environment,
  });
  assert.equal(getSelectedProfileName(environment), "wao-noobs");
});

test("missing PROFILE still defaults to wao-noobs", () => {
  const environment: NodeJS.ProcessEnv = {};
  loadProjectEnvironment({
    envFile: path.join(fixtures, "empty.env"),
    environment,
  });
  assert.equal(getSelectedProfileName(environment), DEFAULT_PROFILE);
});
