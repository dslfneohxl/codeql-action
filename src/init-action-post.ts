/**
 * This file is the entry point for the `post:` hook of `init-action.yml`.
 * It will run after the all steps in this job, in reverse order in relation to
 * other `post:` hooks.
 */

import * as core from "@actions/core";

import * as actionsUtil from "./actions-util";
import * as debugArtifacts from "./debug-artifacts";
import * as initActionPostHelper from "./init-action-post-helper";

async function runWrapper() {
  try {
    await initActionPostHelper.run(
      debugArtifacts.uploadDatabaseBundleDebugArtifact,
      debugArtifacts.uploadLogsDebugArtifact,
      actionsUtil.printDebugLogs
    );
  } catch (error) {
    core.setFailed(`init post-action step failed: ${error}`);
    console.log(error);
  }
}

void runWrapper();
