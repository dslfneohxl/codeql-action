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
exports.runPromise = exports.sendStatusReport = void 0;
const core = __importStar(require("@actions/core"));
const actionsUtil = __importStar(require("./actions-util"));
const analyze_1 = require("./analyze");
const api_client_1 = require("./api-client");
const codeql_1 = require("./codeql");
const config_utils_1 = require("./config-utils");
const database_upload_1 = require("./database-upload");
const feature_flags_1 = require("./feature-flags");
const logging_1 = require("./logging");
const repository_1 = require("./repository");
const trap_caching_1 = require("./trap-caching");
const upload_lib = __importStar(require("./upload-lib"));
const util = __importStar(require("./util"));
// eslint-disable-next-line import/no-commonjs
const pkg = require("../package.json");
async function sendStatusReport(startedAt, config, stats, error, trapCacheUploadTime, didUploadTrapCaches, logger) {
    const status = actionsUtil.getActionsStatus(error, stats === null || stats === void 0 ? void 0 : stats.analyze_failure_language);
    const statusReportBase = await actionsUtil.createStatusReportBase("finish", status, startedAt, error === null || error === void 0 ? void 0 : error.message, error === null || error === void 0 ? void 0 : error.stack);
    const statusReport = {
        ...statusReportBase,
        ...(config
            ? {
                ml_powered_javascript_queries: util.getMlPoweredJsQueriesStatus(config),
            }
            : {}),
        ...(stats || {}),
    };
    if (config && didUploadTrapCaches) {
        const trapCacheUploadStatusReport = {
            ...statusReport,
            trap_cache_upload_duration_ms: trapCacheUploadTime || 0,
            trap_cache_upload_size_bytes: await (0, trap_caching_1.getTotalCacheSize)(config.trapCaches, logger),
        };
        await actionsUtil.sendStatusReport(trapCacheUploadStatusReport);
    }
    else {
        await actionsUtil.sendStatusReport(statusReport);
    }
}
exports.sendStatusReport = sendStatusReport;
// `expect-error` should only be set to any value by the
// codeql-action repo or a fork of it.
function hasBadExpectErrorInput() {
    return (actionsUtil.getOptionalInput("expect-error") !== "false" &&
        !actionsUtil.isAnalyzingCodeQLActionRepoOrFork());
}
async function run() {
    const startedAt = new Date();
    let uploadResult = undefined;
    let runStats = undefined;
    let config = undefined;
    let trapCacheUploadTime = undefined;
    let didUploadTrapCaches = false;
    util.initializeEnvironment(util.Mode.actions, pkg.version);
    await util.checkActionVersion(pkg.version);
    const logger = (0, logging_1.getActionsLogger)();
    try {
        if (!(await actionsUtil.sendStatusReport(await actionsUtil.createStatusReportBase("finish", "starting", startedAt)))) {
            return;
        }
        config = await (0, config_utils_1.getConfig)(actionsUtil.getTemporaryDirectory(), logger);
        if (config === undefined) {
            throw new Error("Config file could not be found at expected location. Has the 'init' action been called?");
        }
        if (hasBadExpectErrorInput()) {
            throw new Error("`expect-error` input parameter is for internal use only. It should only be set by codeql-action or a fork.");
        }
        await util.enrichEnvironment(util.Mode.actions, await (0, codeql_1.getCodeQL)(config.codeQLCmd));
        const apiDetails = {
            auth: actionsUtil.getRequiredInput("token"),
            url: util.getRequiredEnvParam("GITHUB_SERVER_URL"),
            apiURL: util.getRequiredEnvParam("GITHUB_API_URL"),
        };
        const outputDir = actionsUtil.getRequiredInput("output");
        const threads = util.getThreadsFlag(actionsUtil.getOptionalInput("threads") || process.env["CODEQL_THREADS"], logger);
        const memory = util.getMemoryFlag(actionsUtil.getOptionalInput("ram") || process.env["CODEQL_RAM"]);
        const repositoryNwo = (0, repository_1.parseRepositoryNwo)(util.getRequiredEnvParam("GITHUB_REPOSITORY"));
        const gitHubVersion = await (0, api_client_1.getGitHubVersionActionsOnly)();
        const featureFlags = new feature_flags_1.GitHubFeatureFlags(gitHubVersion, apiDetails, repositoryNwo, logger);
        await (0, analyze_1.runFinalize)(outputDir, threads, memory, config, logger, featureFlags);
        if (actionsUtil.getRequiredInput("skip-queries") !== "true") {
            runStats = await (0, analyze_1.runQueries)(outputDir, memory, util.getAddSnippetsFlag(actionsUtil.getRequiredInput("add-snippets")), threads, actionsUtil.getOptionalInput("category"), config, logger);
        }
        if (actionsUtil.getOptionalInput("cleanup-level") !== "none") {
            await (0, analyze_1.runCleanup)(config, actionsUtil.getOptionalInput("cleanup-level") || "brutal", logger);
        }
        const dbLocations = {};
        for (const language of config.languages) {
            dbLocations[language] = util.getCodeQLDatabasePath(config, language);
        }
        core.setOutput("db-locations", dbLocations);
        if (runStats && actionsUtil.getRequiredInput("upload") === "true") {
            uploadResult = await upload_lib.uploadFromActions(outputDir, config.gitHubVersion, apiDetails, logger);
            core.setOutput("sarif-id", uploadResult.sarifID);
        }
        else {
            logger.info("Not uploading results");
        }
        // Possibly upload the database bundles for remote queries
        await (0, database_upload_1.uploadDatabases)(repositoryNwo, config, apiDetails, logger);
        // Possibly upload the TRAP caches for later re-use
        const trapCacheUploadStartTime = performance.now();
        const codeql = await (0, codeql_1.getCodeQL)(config.codeQLCmd);
        trapCacheUploadTime = performance.now() - trapCacheUploadStartTime;
        didUploadTrapCaches = await (0, trap_caching_1.uploadTrapCaches)(codeql, config, logger);
        // We don't upload results in test mode, so don't wait for processing
        if (util.isInTestMode()) {
            core.debug("In test mode. Waiting for processing is disabled.");
        }
        else if (uploadResult !== undefined &&
            actionsUtil.getRequiredInput("wait-for-processing") === "true") {
            await upload_lib.waitForProcessing((0, repository_1.parseRepositoryNwo)(util.getRequiredEnvParam("GITHUB_REPOSITORY")), uploadResult.sarifID, apiDetails, (0, logging_1.getActionsLogger)());
        }
        // If we did not throw an error yet here, but we expect one, throw it.
        if (actionsUtil.getOptionalInput("expect-error") === "true") {
            core.setFailed(`expect-error input was set to true but no error was thrown.`);
        }
    }
    catch (origError) {
        const error = origError instanceof Error ? origError : new Error(String(origError));
        if (actionsUtil.getOptionalInput("expect-error") !== "true" ||
            hasBadExpectErrorInput()) {
            core.setFailed(error.message);
        }
        console.log(error);
        if (error instanceof analyze_1.CodeQLAnalysisError) {
            const stats = { ...error.queriesStatusReport };
            await sendStatusReport(startedAt, config, stats, error, trapCacheUploadTime, didUploadTrapCaches, logger);
        }
        else {
            await sendStatusReport(startedAt, config, undefined, error, trapCacheUploadTime, didUploadTrapCaches, logger);
        }
        return;
    }
    if (runStats && uploadResult) {
        await sendStatusReport(startedAt, config, {
            ...runStats,
            ...uploadResult.statusReport,
        }, undefined, trapCacheUploadTime, didUploadTrapCaches, logger);
    }
    else if (runStats) {
        await sendStatusReport(startedAt, config, { ...runStats }, undefined, trapCacheUploadTime, didUploadTrapCaches, logger);
    }
    else {
        await sendStatusReport(startedAt, config, undefined, undefined, trapCacheUploadTime, didUploadTrapCaches, logger);
    }
}
exports.runPromise = run();
async function runWrapper() {
    try {
        await exports.runPromise;
    }
    catch (error) {
        core.setFailed(`analyze action failed: ${error}`);
        console.log(error);
    }
}
void runWrapper();
//# sourceMappingURL=analyze-action.js.map