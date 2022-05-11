"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeArifactName = exports.isAnalyzingDefaultBranch = exports.getRelativeScriptPath = exports.isRunningLocalAction = exports.sendStatusReport = exports.createStatusReportBase = exports.getActionsStatus = exports.getRef = exports.computeAutomationID = exports.getAutomationID = exports.getAnalysisKey = exports.getWorkflowRunID = exports.getWorkflow = exports.formatWorkflowCause = exports.formatWorkflowErrors = exports.validateWorkflow = exports.getWorkflowErrors = exports.WorkflowErrors = exports.patternIsSuperset = exports.determineMergeBaseCommitOid = exports.getCommitOid = exports.getToolCacheDirectory = exports.getTemporaryDirectory = exports.getOptionalInput = exports.getRequiredInput = void 0;
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const core = __importStar(require("@actions/core"));
const toolrunner = __importStar(require("@actions/exec/lib/toolrunner"));
const safeWhich = __importStar(require("@chrisgavin/safe-which"));
const yaml = __importStar(require("js-yaml"));
const api = __importStar(require("./api-client"));
const sharedEnv = __importStar(require("./shared-environment"));
const util_1 = require("./util");
// eslint-disable-next-line import/no-commonjs
const pkg = require("../package.json");
/**
 * The utils in this module are meant to be run inside of the action only.
 * Code paths from the runner should not enter this module.
 */
/**
 * Wrapper around core.getInput for inputs that always have a value.
 * Also see getOptionalInput.
 *
 * This allows us to get stronger type checking of required/optional inputs
 * and make behaviour more consistent between actions and the runner.
 */
function getRequiredInput(name) {
    return core.getInput(name, { required: true });
}
exports.getRequiredInput = getRequiredInput;
/**
 * Wrapper around core.getInput that converts empty inputs to undefined.
 * Also see getRequiredInput.
 *
 * This allows us to get stronger type checking of required/optional inputs
 * and make behaviour more consistent between actions and the runner.
 */
const getOptionalInput = function (name) {
    const value = core.getInput(name);
    return value.length > 0 ? value : undefined;
};
exports.getOptionalInput = getOptionalInput;
function getTemporaryDirectory() {
    const value = process.env["CODEQL_ACTION_TEMP"];
    return value !== undefined && value !== ""
        ? value
        : (0, util_1.getRequiredEnvParam)("RUNNER_TEMP");
}
exports.getTemporaryDirectory = getTemporaryDirectory;
function getToolCacheDirectory() {
    const value = process.env["CODEQL_ACTION_TOOL_CACHE"];
    return value !== undefined && value !== ""
        ? value
        : (0, util_1.getRequiredEnvParam)("RUNNER_TOOL_CACHE");
}
exports.getToolCacheDirectory = getToolCacheDirectory;
/**
 * Gets the SHA of the commit that is currently checked out.
 */
const getCommitOid = async function (checkoutPath, ref = "HEAD") {
    // Try to use git to get the current commit SHA. If that fails then
    // log but otherwise silently fall back to using the SHA from the environment.
    // The only time these two values will differ is during analysis of a PR when
    // the workflow has changed the current commit to the head commit instead of
    // the merge commit, which must mean that git is available.
    // Even if this does go wrong, it's not a huge problem for the alerts to
    // reported on the merge commit.
    try {
        let commitOid = "";
        await new toolrunner.ToolRunner(await safeWhich.safeWhich("git"), ["rev-parse", ref], {
            silent: true,
            listeners: {
                stdout: (data) => {
                    commitOid += data.toString();
                },
                stderr: (data) => {
                    process.stderr.write(data);
                },
            },
            cwd: checkoutPath,
        }).exec();
        return commitOid.trim();
    }
    catch (e) {
        core.info(`Failed to call git to get current commit. Continuing with data from environment or input: ${e}`);
        core.info(e.stack || "NO STACK");
        return (0, exports.getOptionalInput)("sha") || (0, util_1.getRequiredEnvParam)("GITHUB_SHA");
    }
};
exports.getCommitOid = getCommitOid;
/**
 * If the action was triggered by a pull request, determine the commit sha of the merge base.
 * Returns undefined if run by other triggers or the merge base cannot be determined.
 */
const determineMergeBaseCommitOid = async function () {
    if (process.env.GITHUB_EVENT_NAME !== "pull_request") {
        return undefined;
    }
    const mergeSha = (0, util_1.getRequiredEnvParam)("GITHUB_SHA");
    const checkoutPath = (0, exports.getOptionalInput)("checkout_path");
    try {
        let commitOid = "";
        let baseOid = "";
        let headOid = "";
        await new toolrunner.ToolRunner(await safeWhich.safeWhich("git"), ["show", "-s", "--format=raw", mergeSha], {
            silent: true,
            listeners: {
                stdline: (data) => {
                    if (data.startsWith("commit ") && commitOid === "") {
                        commitOid = data.substring(7);
                    }
                    else if (data.startsWith("parent ")) {
                        if (baseOid === "") {
                            baseOid = data.substring(7);
                        }
                        else if (headOid === "") {
                            headOid = data.substring(7);
                        }
                    }
                },
                stderr: (data) => {
                    process.stderr.write(data);
                },
            },
            cwd: checkoutPath,
        }).exec();
        // Let's confirm our assumptions: We had a merge commit and the parsed parent data looks correct
        if (commitOid === mergeSha &&
            headOid.length === 40 &&
            baseOid.length === 40) {
            return baseOid;
        }
        return undefined;
    }
    catch (e) {
        core.info(`Failed to call git to determine merge base. Continuing with data from environment: ${e}`);
        core.info(e.stack || "NO STACK");
        return undefined;
    }
};
exports.determineMergeBaseCommitOid = determineMergeBaseCommitOid;
function isObject(o) {
    return o !== null && typeof o === "object";
}
const GLOB_PATTERN = new RegExp("(\\*\\*?)");
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // $& means the whole matched string
}
function patternToRegExp(value) {
    return new RegExp(`^${value
        .toString()
        .split(GLOB_PATTERN)
        .reduce(function (arr, cur) {
        if (cur === "**") {
            arr.push(".*?");
        }
        else if (cur === "*") {
            arr.push("[^/]*?");
        }
        else if (cur) {
            arr.push(escapeRegExp(cur));
        }
        return arr;
    }, [])
        .join("")}$`);
}
// this function should return true if patternA is a superset of patternB
// e.g: * is a superset of main-* but main-* is not a superset of *.
function patternIsSuperset(patternA, patternB) {
    return patternToRegExp(patternA).test(patternB);
}
exports.patternIsSuperset = patternIsSuperset;
function branchesToArray(branches) {
    if (typeof branches === "string") {
        return [branches];
    }
    if (Array.isArray(branches)) {
        if (branches.length === 0) {
            return "**";
        }
        return branches;
    }
    return "**";
}
function toCodedErrors(errors) {
    return Object.entries(errors).reduce((acc, [key, value]) => {
        acc[key] = { message: value, code: key };
        return acc;
    }, {});
}
// code to send back via status report
// message to add as a warning annotation to the run
exports.WorkflowErrors = toCodedErrors({
    MismatchedBranches: `Please make sure that every branch in on.pull_request is also in on.push so that Code Scanning can compare pull requests against the state of the base branch.`,
    MissingPushHook: `Please specify an on.push hook so that Code Scanning can compare pull requests against the state of the base branch.`,
    PathsSpecified: `Using on.push.paths can prevent Code Scanning annotating new alerts in your pull requests.`,
    PathsIgnoreSpecified: `Using on.push.paths-ignore can prevent Code Scanning annotating new alerts in your pull requests.`,
    CheckoutWrongHead: `git checkout HEAD^2 is no longer necessary. Please remove this step as Code Scanning recommends analyzing the merge commit for best results.`,
});
function getWorkflowErrors(doc) {
    var _a, _b, _c, _d, _e;
    const errors = [];
    const jobName = process.env.GITHUB_JOB;
    if (jobName) {
        const job = (_a = doc === null || doc === void 0 ? void 0 : doc.jobs) === null || _a === void 0 ? void 0 : _a[jobName];
        const steps = job === null || job === void 0 ? void 0 : job.steps;
        if (Array.isArray(steps)) {
            for (const step of steps) {
                // this was advice that we used to give in the README
                // we actually want to run the analysis on the merge commit
                // to produce results that are more inline with expectations
                // (i.e: this is what will happen if you merge this PR)
                // and avoid some race conditions
                if ((step === null || step === void 0 ? void 0 : step.run) === "git checkout HEAD^2") {
                    errors.push(exports.WorkflowErrors.CheckoutWrongHead);
                    break;
                }
            }
        }
    }
    let missingPush = false;
    if (doc.on === undefined) {
        // this is not a valid config
    }
    else if (typeof doc.on === "string") {
        if (doc.on === "pull_request") {
            missingPush = true;
        }
    }
    else if (Array.isArray(doc.on)) {
        const hasPush = doc.on.includes("push");
        const hasPullRequest = doc.on.includes("pull_request");
        if (hasPullRequest && !hasPush) {
            missingPush = true;
        }
    }
    else if (isObject(doc.on)) {
        const hasPush = Object.prototype.hasOwnProperty.call(doc.on, "push");
        const hasPullRequest = Object.prototype.hasOwnProperty.call(doc.on, "pull_request");
        if (!hasPush && hasPullRequest) {
            missingPush = true;
        }
        if (hasPush && hasPullRequest) {
            const paths = (_b = doc.on.push) === null || _b === void 0 ? void 0 : _b.paths;
            // if you specify paths or paths-ignore you can end up with commits that have no baseline
            // if they didn't change any files
            // currently we cannot go back through the history and find the most recent baseline
            if (Array.isArray(paths) && paths.length > 0) {
                errors.push(exports.WorkflowErrors.PathsSpecified);
            }
            const pathsIgnore = (_c = doc.on.push) === null || _c === void 0 ? void 0 : _c["paths-ignore"];
            if (Array.isArray(pathsIgnore) && pathsIgnore.length > 0) {
                errors.push(exports.WorkflowErrors.PathsIgnoreSpecified);
            }
        }
        // if doc.on.pull_request is null that means 'all branches'
        // if doc.on.pull_request is undefined that means 'off'
        // we only want to check for mismatched branches if pull_request is on.
        if (doc.on.pull_request !== undefined) {
            const push = branchesToArray((_d = doc.on.push) === null || _d === void 0 ? void 0 : _d.branches);
            if (push !== "**") {
                const pull_request = branchesToArray((_e = doc.on.pull_request) === null || _e === void 0 ? void 0 : _e.branches);
                if (pull_request !== "**") {
                    const difference = pull_request.filter((value) => !push.some((o) => patternIsSuperset(o, value)));
                    if (difference.length > 0) {
                        // there are branches in pull_request that may not have a baseline
                        // because we are not building them on push
                        errors.push(exports.WorkflowErrors.MismatchedBranches);
                    }
                }
                else if (push.length > 0) {
                    // push is set up to run on a subset of branches
                    // and you could open a PR against a branch with no baseline
                    errors.push(exports.WorkflowErrors.MismatchedBranches);
                }
            }
        }
    }
    if (missingPush) {
        errors.push(exports.WorkflowErrors.MissingPushHook);
    }
    return errors;
}
exports.getWorkflowErrors = getWorkflowErrors;
async function validateWorkflow() {
    let workflow;
    try {
        workflow = await getWorkflow();
    }
    catch (e) {
        return `error: getWorkflow() failed: ${String(e)}`;
    }
    let workflowErrors;
    try {
        workflowErrors = getWorkflowErrors(workflow);
    }
    catch (e) {
        return `error: getWorkflowErrors() failed: ${String(e)}`;
    }
    if (workflowErrors.length > 0) {
        let message;
        try {
            message = formatWorkflowErrors(workflowErrors);
        }
        catch (e) {
            return `error: formatWorkflowErrors() failed: ${String(e)}`;
        }
        core.warning(message);
    }
    return formatWorkflowCause(workflowErrors);
}
exports.validateWorkflow = validateWorkflow;
function formatWorkflowErrors(errors) {
    const issuesWere = errors.length === 1 ? "issue was" : "issues were";
    const errorsList = errors.map((e) => e.message).join(" ");
    return `${errors.length} ${issuesWere} detected with this workflow: ${errorsList}`;
}
exports.formatWorkflowErrors = formatWorkflowErrors;
function formatWorkflowCause(errors) {
    if (errors.length === 0) {
        return undefined;
    }
    return errors.map((e) => e.code).join(",");
}
exports.formatWorkflowCause = formatWorkflowCause;
async function getWorkflow() {
    const relativePath = await getWorkflowPath();
    const absolutePath = path.join((0, util_1.getRequiredEnvParam)("GITHUB_WORKSPACE"), relativePath);
    return yaml.load(fs.readFileSync(absolutePath, "utf-8"));
}
exports.getWorkflow = getWorkflow;
/**
 * Get the path of the currently executing workflow.
 */
async function getWorkflowPath() {
    const repo_nwo = (0, util_1.getRequiredEnvParam)("GITHUB_REPOSITORY").split("/");
    const owner = repo_nwo[0];
    const repo = repo_nwo[1];
    const run_id = Number((0, util_1.getRequiredEnvParam)("GITHUB_RUN_ID"));
    const apiClient = api.getActionsApiClient();
    const runsResponse = await apiClient.request("GET /repos/:owner/:repo/actions/runs/:run_id?exclude_pull_requests=true", {
        owner,
        repo,
        run_id,
    });
    const workflowUrl = runsResponse.data.workflow_url;
    const workflowResponse = await apiClient.request(`GET ${workflowUrl}`);
    return workflowResponse.data.path;
}
/**
 * Get the workflow run ID.
 */
function getWorkflowRunID() {
    const workflowRunID = parseInt((0, util_1.getRequiredEnvParam)("GITHUB_RUN_ID"), 10);
    if (Number.isNaN(workflowRunID)) {
        throw new Error("GITHUB_RUN_ID must define a non NaN workflow run ID");
    }
    return workflowRunID;
}
exports.getWorkflowRunID = getWorkflowRunID;
/**
 * Get the analysis key parameter for the current job.
 *
 * This will combine the workflow path and current job name.
 * Computing this the first time requires making requests to
 * the github API, but after that the result will be cached.
 */
async function getAnalysisKey() {
    const analysisKeyEnvVar = "CODEQL_ACTION_ANALYSIS_KEY";
    let analysisKey = process.env[analysisKeyEnvVar];
    if (analysisKey !== undefined) {
        return analysisKey;
    }
    const workflowPath = await getWorkflowPath();
    const jobName = (0, util_1.getRequiredEnvParam)("GITHUB_JOB");
    analysisKey = `${workflowPath}:${jobName}`;
    core.exportVariable(analysisKeyEnvVar, analysisKey);
    return analysisKey;
}
exports.getAnalysisKey = getAnalysisKey;
async function getAutomationID() {
    const analysis_key = await getAnalysisKey();
    const environment = getRequiredInput("matrix");
    return computeAutomationID(analysis_key, environment);
}
exports.getAutomationID = getAutomationID;
function computeAutomationID(analysis_key, environment) {
    let automationID = `${analysis_key}/`;
    // the id has to be deterministic so we sort the fields
    if (environment !== undefined && environment !== "null") {
        const environmentObject = JSON.parse(environment);
        for (const entry of Object.entries(environmentObject).sort()) {
            if (typeof entry[1] === "string") {
                automationID += `${entry[0]}:${entry[1]}/`;
            }
            else {
                // In code scanning we just handle the string values,
                // the rest get converted to the empty string
                automationID += `${entry[0]}:/`;
            }
        }
    }
    return automationID;
}
exports.computeAutomationID = computeAutomationID;
/**
 * Get the ref currently being analyzed.
 */
async function getRef() {
    // Will be in the form "refs/heads/master" on a push event
    // or in the form "refs/pull/N/merge" on a pull_request event
    const refInput = (0, exports.getOptionalInput)("ref");
    const shaInput = (0, exports.getOptionalInput)("sha");
    const checkoutPath = (0, exports.getOptionalInput)("checkout_path") ||
        (0, exports.getOptionalInput)("source-root") ||
        (0, util_1.getRequiredEnvParam)("GITHUB_WORKSPACE");
    const hasRefInput = !!refInput;
    const hasShaInput = !!shaInput;
    // If one of 'ref' or 'sha' are provided, both are required
    if ((hasRefInput || hasShaInput) && !(hasRefInput && hasShaInput)) {
        throw new Error("Both 'ref' and 'sha' are required if one of them is provided.");
    }
    const ref = refInput || (0, util_1.getRequiredEnvParam)("GITHUB_REF");
    const sha = shaInput || (0, util_1.getRequiredEnvParam)("GITHUB_SHA");
    // If the ref is a user-provided input, we have to skip logic
    // and assume that it is really where they want to upload the results.
    if (refInput) {
        return refInput;
    }
    // For pull request refs we want to detect whether the workflow
    // has run `git checkout HEAD^2` to analyze the 'head' ref rather
    // than the 'merge' ref. If so, we want to convert the ref that
    // we report back.
    const pull_ref_regex = /refs\/pull\/(\d+)\/merge/;
    if (!pull_ref_regex.test(ref)) {
        return ref;
    }
    const head = await (0, exports.getCommitOid)(checkoutPath, "HEAD");
    // in actions/checkout@v2+ we can check if git rev-parse HEAD == GITHUB_SHA
    // in actions/checkout@v1 this may not be true as it checks out the repository
    // using GITHUB_REF. There is a subtle race condition where
    // git rev-parse GITHUB_REF != GITHUB_SHA, so we must check
    // git git-parse GITHUB_REF == git rev-parse HEAD instead.
    const hasChangedRef = sha !== head &&
        (await (0, exports.getCommitOid)(checkoutPath, ref.replace(/^refs\/pull\//, "refs/remotes/pull/"))) !== head;
    if (hasChangedRef) {
        const newRef = ref.replace(pull_ref_regex, "refs/pull/$1/head");
        core.debug(`No longer on merge commit, rewriting ref from ${ref} to ${newRef}.`);
        return newRef;
    }
    else {
        return ref;
    }
}
exports.getRef = getRef;
function getActionsStatus(error, otherFailureCause) {
    if (error || otherFailureCause) {
        return error instanceof util_1.UserError ? "user-error" : "failure";
    }
    else {
        return "success";
    }
}
exports.getActionsStatus = getActionsStatus;
/**
 * Compose a StatusReport.
 *
 * @param actionName The name of the action, e.g. 'init', 'finish', 'upload-sarif'
 * @param status The status. Must be 'success', 'failure', or 'starting'
 * @param startedAt The time this action started executing.
 * @param cause  Cause of failure (only supply if status is 'failure')
 * @param exception Exception (only supply if status is 'failure')
 */
async function createStatusReportBase(actionName, status, actionStartedAt, cause, exception) {
    const commitOid = (0, exports.getOptionalInput)("sha") || process.env["GITHUB_SHA"] || "";
    const ref = await getRef();
    const workflowRunIDStr = process.env["GITHUB_RUN_ID"];
    let workflowRunID = -1;
    if (workflowRunIDStr) {
        workflowRunID = parseInt(workflowRunIDStr, 10);
    }
    const workflowName = process.env["GITHUB_WORKFLOW"] || "";
    const jobName = process.env["GITHUB_JOB"] || "";
    const analysis_key = await getAnalysisKey();
    let workflowStartedAt = process.env[sharedEnv.CODEQL_WORKFLOW_STARTED_AT];
    if (workflowStartedAt === undefined) {
        workflowStartedAt = actionStartedAt.toISOString();
        core.exportVariable(sharedEnv.CODEQL_WORKFLOW_STARTED_AT, workflowStartedAt);
    }
    const runnerOs = (0, util_1.getRequiredEnvParam)("RUNNER_OS");
    const codeQlCliVersion = (0, util_1.getCachedCodeQlVersion)();
    // If running locally then the GITHUB_ACTION_REF cannot be trusted as it may be for the previous action
    // See https://github.com/actions/runner/issues/803
    const actionRef = isRunningLocalAction()
        ? undefined
        : process.env["GITHUB_ACTION_REF"];
    const statusReport = {
        workflow_run_id: workflowRunID,
        workflow_name: workflowName,
        job_name: jobName,
        analysis_key,
        commit_oid: commitOid,
        ref,
        action_name: actionName,
        action_ref: actionRef,
        action_oid: "unknown",
        started_at: workflowStartedAt,
        action_started_at: actionStartedAt.toISOString(),
        status,
        runner_os: runnerOs,
        action_version: pkg.version,
    };
    // Add optional parameters
    if (cause) {
        statusReport.cause = cause;
    }
    if (exception) {
        statusReport.exception = exception;
    }
    if (status === "success" ||
        status === "failure" ||
        status === "aborted" ||
        status === "user-error") {
        statusReport.completed_at = new Date().toISOString();
    }
    const matrix = getRequiredInput("matrix");
    if (matrix) {
        statusReport.matrix_vars = matrix;
    }
    if ("RUNNER_ARCH" in process.env) {
        // RUNNER_ARCH is available only in GHES 3.4 and later
        // Values other than X86, X64, ARM, or ARM64 are discarded server side
        statusReport.runner_arch = process.env["RUNNER_ARCH"];
    }
    if (runnerOs === "Windows" || runnerOs === "macOS") {
        statusReport.runner_os_release = os.release();
    }
    if (codeQlCliVersion !== undefined) {
        statusReport.codeql_version = codeQlCliVersion;
    }
    return statusReport;
}
exports.createStatusReportBase = createStatusReportBase;
const GENERIC_403_MSG = "The repo on which this action is running is not opted-in to CodeQL code scanning.";
const GENERIC_404_MSG = "Not authorized to use the CodeQL code scanning feature on this repo.";
const OUT_OF_DATE_MSG = "CodeQL Action is out-of-date. Please upgrade to the latest version of codeql-action.";
const INCOMPATIBLE_MSG = "CodeQL Action version is incompatible with the code scanning endpoint. Please update to a compatible version of codeql-action.";
/**
 * Send a status report to the code_scanning/analysis/status endpoint.
 *
 * Optionally checks the response from the API endpoint and sets the action
 * as failed if the status report failed. This is only expected to be used
 * when sending a 'starting' report.
 *
 * Returns whether sending the status report was successful of not.
 */
async function sendStatusReport(statusReport) {
    const gitHubVersion = await api.getGitHubVersionActionsOnly();
    if ((0, util_1.isGitHubGhesVersionBelow)(gitHubVersion, "3.2.0")) {
        // GHES 3.1 and earlier versions reject unexpected properties, which means
        // that they will reject status reports with newly added properties.
        // Inhibiting status reporting for GHES < 3.2 avoids such failures.
        return true;
    }
    const statusReportJSON = JSON.stringify(statusReport);
    core.debug(`Sending status report: ${statusReportJSON}`);
    // If in test mode we don't want to upload the results
    if ((0, util_1.isInTestMode)()) {
        core.debug("In test mode. Status reports are not uploaded.");
        return true;
    }
    const nwo = (0, util_1.getRequiredEnvParam)("GITHUB_REPOSITORY");
    const [owner, repo] = nwo.split("/");
    const client = api.getActionsApiClient();
    try {
        await client.request("PUT /repos/:owner/:repo/code-scanning/analysis/status", {
            owner,
            repo,
            data: statusReportJSON,
        });
        return true;
    }
    catch (e) {
        console.log(e);
        if ((0, util_1.isHTTPError)(e)) {
            switch (e.status) {
                case 403:
                    if (workflowIsTriggeredByPushEvent() && isDependabotActor()) {
                        core.setFailed('Workflows triggered by Dependabot on the "push" event run with read-only access. ' +
                            "Uploading Code Scanning results requires write access. " +
                            'To use Code Scanning with Dependabot, please ensure you are using the "pull_request" event for this workflow and avoid triggering on the "push" event for Dependabot branches. ' +
                            "See https://docs.github.com/en/code-security/secure-coding/configuring-code-scanning#scanning-on-push for more information on how to configure these events.");
                    }
                    else {
                        core.setFailed(e.message || GENERIC_403_MSG);
                    }
                    return false;
                case 404:
                    core.setFailed(GENERIC_404_MSG);
                    return false;
                case 422:
                    // schema incompatibility when reporting status
                    // this means that this action version is no longer compatible with the API
                    // we still want to continue as it is likely the analysis endpoint will work
                    if ((0, util_1.getRequiredEnvParam)("GITHUB_SERVER_URL") !== util_1.GITHUB_DOTCOM_URL) {
                        core.debug(INCOMPATIBLE_MSG);
                    }
                    else {
                        core.debug(OUT_OF_DATE_MSG);
                    }
                    return true;
            }
        }
        // something else has gone wrong and the request/response will be logged by octokit
        // it's possible this is a transient error and we should continue scanning
        core.error("An unexpected error occurred when sending code scanning status report.");
        return true;
    }
}
exports.sendStatusReport = sendStatusReport;
// Was the workflow run triggered by a `push` event, for example as opposed to a `pull_request` event.
function workflowIsTriggeredByPushEvent() {
    return process.env["GITHUB_EVENT_NAME"] === "push";
}
// Is dependabot the actor that triggered the current workflow run.
function isDependabotActor() {
    return process.env["GITHUB_ACTOR"] === "dependabot[bot]";
}
// Is the current action executing a local copy (i.e. we're running a workflow on the codeql-action repo itself)
// as opposed to running a remote action (i.e. when another repo references us)
function isRunningLocalAction() {
    const relativeScriptPath = getRelativeScriptPath();
    return (relativeScriptPath.startsWith("..") || path.isAbsolute(relativeScriptPath));
}
exports.isRunningLocalAction = isRunningLocalAction;
// Get the location where the action is running from.
// This can be used to get the actions name or tell if we're running a local action.
function getRelativeScriptPath() {
    const runnerTemp = (0, util_1.getRequiredEnvParam)("RUNNER_TEMP");
    const actionsDirectory = path.join(path.dirname(runnerTemp), "_actions");
    return path.relative(actionsDirectory, __filename);
}
exports.getRelativeScriptPath = getRelativeScriptPath;
// Reads the contents of GITHUB_EVENT_PATH as a JSON object
function getWorkflowEvent() {
    const eventJsonFile = (0, util_1.getRequiredEnvParam)("GITHUB_EVENT_PATH");
    try {
        return JSON.parse(fs.readFileSync(eventJsonFile, "utf-8"));
    }
    catch (e) {
        throw new Error(`Unable to read workflow event JSON from ${eventJsonFile}: ${e}`);
    }
}
// Is the version of the repository we are currently analyzing from the default branch,
// or alternatively from another branch or a pull request.
async function isAnalyzingDefaultBranch() {
    var _a;
    // Get the current ref and trim and refs/heads/ prefix
    let currentRef = await getRef();
    currentRef = currentRef.startsWith("refs/heads/")
        ? currentRef.slice("refs/heads/".length)
        : currentRef;
    const event = getWorkflowEvent();
    const defaultBranch = (_a = event === null || event === void 0 ? void 0 : event.repository) === null || _a === void 0 ? void 0 : _a.default_branch;
    return currentRef === defaultBranch;
}
exports.isAnalyzingDefaultBranch = isAnalyzingDefaultBranch;
function sanitizeArifactName(name) {
    return name.replace(/[^a-zA-Z0-9_\\-]+/g, "");
}
exports.sanitizeArifactName = sanitizeArifactName;
//# sourceMappingURL=actions-util.js.map