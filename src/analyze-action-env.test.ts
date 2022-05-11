import test from "ava";
import * as sinon from "sinon";

import * as actionsUtil from "./actions-util";
import * as analyze from "./analyze";
import * as configUtils from "./config-utils";
import {
  setupTests,
  setupActionsVars,
  mockFeatureFlagApiEndpoint,
} from "./testing-utils";
import * as util from "./util";

setupTests(test);

// This test needs to be in its own file so that ava would run it in its own
// nodejs process. The code being tested is in analyze-action.ts, which runs
// immediately on load. So the file needs to be loaded during part of the test,
// and that can happen only once per nodejs process. If multiple such tests are
// in the same test file, ava would run them in the same nodejs process, and all
// but the first test would fail.

test("analyze action with RAM & threads from environment variables", async (t) => {
  await util.withTmpDir(async (tmpDir) => {
    process.env["GITHUB_SERVER_URL"] = "fake-server-url";
    process.env["GITHUB_REPOSITORY"] = "fake/repository";
    sinon
      .stub(actionsUtil, "createStatusReportBase")
      .resolves({} as actionsUtil.StatusReportBase);
    sinon.stub(actionsUtil, "sendStatusReport").resolves(true);
    sinon.stub(configUtils, "getConfig").resolves({
      gitHubVersion: { type: util.GitHubVariant.DOTCOM },
      languages: [],
      packs: [],
    } as unknown as configUtils.Config);
    const requiredInputStub = sinon.stub(actionsUtil, "getRequiredInput");
    requiredInputStub.withArgs("token").returns("fake-token");
    requiredInputStub.withArgs("upload-database").returns("false");
    const optionalInputStub = sinon.stub(actionsUtil, "getOptionalInput");
    optionalInputStub.withArgs("cleanup-level").returns("none");
    setupActionsVars(tmpDir, tmpDir);
    mockFeatureFlagApiEndpoint(200, {});

    // When there are no action inputs for RAM and threads, the action uses
    // environment variables (passed down from the init action) to set RAM and
    // threads usage.
    process.env["CODEQL_THREADS"] = "-1";
    process.env["CODEQL_RAM"] = "4992";

    // Don't upload SARIF or send status reports. This cuts down on the number of requests we make
    // to the GitHub API when running PR checks.
    process.env["TEST_MODE"] = "true";

    const runFinalizeStub = sinon.stub(analyze, "runFinalize");
    const runQueriesStub = sinon.stub(analyze, "runQueries");
    const analyzeAction = require("./analyze-action");

    // When analyze-action.ts loads, it runs an async function from the top
    // level but does not wait for it to finish. To ensure that calls to
    // runFinalize and runQueries are correctly captured by spies, we explicitly
    // wait for the action promise to complete before starting verification.
    await analyzeAction.runPromise;

    t.deepEqual(runFinalizeStub.firstCall.args[1], "--threads=-1");
    t.deepEqual(runFinalizeStub.firstCall.args[2], "--ram=4992");
    t.deepEqual(runQueriesStub.firstCall.args[3], "--threads=-1");
    t.deepEqual(runQueriesStub.firstCall.args[1], "--ram=4992");
  });
});
