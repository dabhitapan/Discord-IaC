import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import {
  DEFAULT_PROFILE,
  getProfileDirectory,
  getSelectedProfileName,
} from "./profileSelection.js";

test("PROFILE=wao-noobs resolves profiles/wao-noobs", () => {
  const selected = getSelectedProfileName({ PROFILE: "wao-noobs" });
  assert.equal(selected, "wao-noobs");
  assert.equal(
    getProfileDirectory(selected),
    path.resolve("profiles", "wao-noobs"),
  );
});

test("PROFILE=titanz resolves profiles/titanz", () => {
  const selected = getSelectedProfileName({ PROFILE: "titanz" });
  assert.equal(selected, "titanz");
  assert.equal(getProfileDirectory(selected), path.resolve("profiles", "titanz"));
});

test("missing PROFILE defaults to wao-noobs", () => {
  assert.equal(getSelectedProfileName({}), DEFAULT_PROFILE);
});

test("missing profile directory throws a descriptive error", () => {
  assert.throws(
    () => getProfileDirectory("does-not-exist"),
    /Profile "does-not-exist" does not exist\.\nExpected:\nprofiles\/does-not-exist\//,
  );
});
