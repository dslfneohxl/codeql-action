import * as path from "path";

import test from "ava";

import { countLoc } from "./count-loc";
import { KnownLanguage } from "./languages";
import { getRunnerLogger } from "./logging";
import { setupTests } from "./testing-utils";

setupTests(test);

test("ensure lines of code works for cpp and js", async (t) => {
  const results = await countLoc(
    path.join(__dirname, "../tests/multi-language-repo"),
    [],
    [],
    [KnownLanguage.cpp, KnownLanguage.javascript],
    getRunnerLogger(true)
  );

  t.deepEqual(results, {
    cpp: 6,
    javascript: 9,
  });
});

test("ensure lines of code works for csharp", async (t) => {
  const results = await countLoc(
    path.join(__dirname, "../tests/multi-language-repo"),
    [],
    [],
    [KnownLanguage.csharp],
    getRunnerLogger(true)
  );

  t.deepEqual(results, {
    csharp: 10,
  });
});

test("ensure lines of code can handle undefined language", async (t) => {
  const results = await countLoc(
    path.join(__dirname, "../tests/multi-language-repo"),
    [],
    [],
    [KnownLanguage.javascript, KnownLanguage.python, "hucairz" as KnownLanguage],
    getRunnerLogger(true)
  );

  t.deepEqual(results, {
    javascript: 9,
    python: 5,
  });
});

test("ensure lines of code can handle empty languages", async (t) => {
  const results = await countLoc(
    path.join(__dirname, "../tests/multi-language-repo"),
    [],
    [],
    [],
    getRunnerLogger(true)
  );

  t.deepEqual(results, {});
});

test("ensure lines of code can handle includes", async (t) => {
  // note that "**" is always included. The includes are for extra
  // directories outside the normal structure.
  const results = await countLoc(
    path.join(__dirname, "../tests/multi-language-repo"),
    ["../../src/testdata"],
    [],
    [KnownLanguage.javascript],
    getRunnerLogger(true)
  );

  t.deepEqual(results, {
    javascript: 12,
  });
});

test("ensure lines of code can handle empty includes", async (t) => {
  // note that "**" is always included. The includes are for extra
  // directories outside the normal structure.
  const results = await countLoc(
    path.join(__dirname, "../tests/multi-language-repo"),
    ["idontexist"],
    [],
    [KnownLanguage.javascript],
    getRunnerLogger(true)
  );

  t.deepEqual(results, {
    // should get no results
  });
});

test("ensure lines of code can handle exclude", async (t) => {
  const results = await countLoc(
    path.join(__dirname, "../tests/multi-language-repo"),
    [],
    ["**/*.py"],
    [KnownLanguage.javascript, KnownLanguage.python],
    getRunnerLogger(true)
  );

  t.deepEqual(results, {
    javascript: 9,
  });
});
