"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runCleanup = exports.runFinalize = exports.runQueries = exports.dbIsFinalized = exports.createdDBForScannedLanguages = exports.CodeQLAnalysisError = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const perf_hooks_1 = require("perf_hooks");
const toolrunner = __importStar(require("@actions/exec/lib/toolrunner"));
const del_1 = __importDefault(require("del"));
const yaml = __importStar(require("js-yaml"));
const codeql_1 = require("./codeql");
const feature_flags_1 = require("./feature-flags");
const languages_1 = require("./languages");
const tracer_config_1 = require("./tracer-config");
const upload_lib_1 = require("./upload-lib");
const util = __importStar(require("./util"));
class CodeQLAnalysisError extends Error {
    constructor(queriesStatusReport, message) {
        super(message);
        this.name = "CodeQLAnalysisError";
        this.queriesStatusReport = queriesStatusReport;
    }
}
exports.CodeQLAnalysisError = CodeQLAnalysisError;
async function setupPythonExtractor(logger, features, codeql) {
    const codeqlPython = process.env["CODEQL_PYTHON"];
    if (codeqlPython === undefined || codeqlPython.length === 0) {
        // If CODEQL_PYTHON is not set, no dependencies were installed, so we don't need to do anything
        return;
    }
    if (await (0, feature_flags_1.isPythonDependencyInstallationDisabled)(codeql, features)) {
        logger.warning("We recommend that you remove the CODEQL_PYTHON environment variable from your workflow. This environment variable was originally used to specify a Python executable that included the dependencies of your Python code, however Python analysis no longer uses these dependencies." +
            "\nIf you used CODEQL_PYTHON to force the version of Python to analyze as, please use CODEQL_EXTRACTOR_PYTHON_ANALYSIS_VERSION instead, such as 'CODEQL_EXTRACTOR_PYTHON_ANALYSIS_VERSION=2.7' or 'CODEQL_EXTRACTOR_PYTHON_ANALYSIS_VERSION=3.11'.");
        return;
    }
    const scriptsFolder = path.resolve(__dirname, "../python-setup");
    let output = "";
    const options = {
        listeners: {
            stdout: (data) => {
                output += data.toString();
            },
        },
    };
    await new toolrunner.ToolRunner(codeqlPython, [path.join(scriptsFolder, "find_site_packages.py")], options).exec();
    logger.info(`Setting LGTM_INDEX_IMPORT_PATH=${output}`);
    process.env["LGTM_INDEX_IMPORT_PATH"] = output;
    output = "";
    await new toolrunner.ToolRunner(codeqlPython, ["-c", "import sys; print(sys.version_info[0])"], options).exec();
    logger.info(`Setting LGTM_PYTHON_SETUP_VERSION=${output}`);
    process.env["LGTM_PYTHON_SETUP_VERSION"] = output;
}
async function createdDBForScannedLanguages(codeql, config, logger, features) {
    for (const language of config.languages) {
        if ((0, languages_1.isScannedLanguage)(language) &&
            !dbIsFinalized(config, language, logger)) {
            logger.startGroup(`Extracting ${language}`);
            if (language === languages_1.Language.python) {
                await setupPythonExtractor(logger, features, codeql);
            }
            await codeql.extractScannedLanguage(config, language);
            logger.endGroup();
        }
    }
}
exports.createdDBForScannedLanguages = createdDBForScannedLanguages;
function dbIsFinalized(config, language, logger) {
    const dbPath = util.getCodeQLDatabasePath(config, language);
    try {
        const dbInfo = yaml.load(fs.readFileSync(path.resolve(dbPath, "codeql-database.yml"), "utf8"));
        return !("inProgress" in dbInfo);
    }
    catch (e) {
        logger.warning(`Could not check whether database for ${language} was finalized. Assuming it is not.`);
        return false;
    }
}
exports.dbIsFinalized = dbIsFinalized;
async function finalizeDatabaseCreation(config, threadsFlag, memoryFlag, logger, features) {
    const codeql = await (0, codeql_1.getCodeQL)(config.codeQLCmd);
    const extractionStart = perf_hooks_1.performance.now();
    await createdDBForScannedLanguages(codeql, config, logger, features);
    const extractionTime = perf_hooks_1.performance.now() - extractionStart;
    const trapImportStart = perf_hooks_1.performance.now();
    for (const language of config.languages) {
        if (dbIsFinalized(config, language, logger)) {
            logger.info(`There is already a finalized database for ${language} at the location where the CodeQL Action places databases, so we did not create one.`);
        }
        else {
            logger.startGroup(`Finalizing ${language}`);
            await codeql.finalizeDatabase(util.getCodeQLDatabasePath(config, language), threadsFlag, memoryFlag);
            logger.endGroup();
        }
    }
    const trapImportTime = perf_hooks_1.performance.now() - trapImportStart;
    return {
        scanned_language_extraction_duration_ms: Math.round(extractionTime),
        trap_import_duration_ms: Math.round(trapImportTime),
    };
}
// Runs queries and creates sarif files in the given folder
async function runQueries(sarifFolder, memoryFlag, addSnippetsFlag, threadsFlag, automationDetailsId, config, logger, features) {
    const statusReport = {};
    const codeql = await (0, codeql_1.getCodeQL)(config.codeQLCmd);
    const queryFlags = [memoryFlag, threadsFlag];
    for (const language of config.languages) {
        try {
            const sarifFile = path.join(sarifFolder, `${language}.sarif`);
            // The work needed to generate the query suites
            // is done in the CLI. We just need to make a single
            // call to run all the queries for each language and
            // another to interpret the results.
            logger.startGroup(`Running queries for ${language}`);
            const startTimeRunQueries = new Date().getTime();
            const databasePath = util.getCodeQLDatabasePath(config, language);
            await codeql.databaseRunQueries(databasePath, queryFlags, features);
            logger.debug(`Finished running queries for ${language}.`);
            // TODO should not be using `builtin` here. We should be using `all` instead.
            // The status report does not support `all` yet.
            statusReport[`analyze_builtin_queries_${language}_duration_ms`] =
                new Date().getTime() - startTimeRunQueries;
            logger.startGroup(`Interpreting results for ${language}`);
            const startTimeInterpretResults = new Date();
            const analysisSummary = await runInterpretResults(language, undefined, sarifFile, config.debugMode);
            const endTimeInterpretResults = new Date();
            statusReport[`interpret_results_${language}_duration_ms`] =
                endTimeInterpretResults.getTime() - startTimeInterpretResults.getTime();
            logger.endGroup();
            logger.info(analysisSummary);
            if (await features.getValue(feature_flags_1.Feature.QaTelemetryEnabled)) {
                const perQueryAlertCounts = getPerQueryAlertCounts(sarifFile, logger);
                const perQueryAlertCountEventReport = {
                    event: "codeql database interpret-results",
                    started_at: startTimeInterpretResults.toISOString(),
                    completed_at: endTimeInterpretResults.toISOString(),
                    exit_status: "success",
                    language,
                    properties: {
                        alertCounts: perQueryAlertCounts,
                    },
                };
                if (statusReport["event_reports"] === undefined) {
                    statusReport["event_reports"] = [];
                }
                statusReport["event_reports"].push(perQueryAlertCountEventReport);
            }
            if (!(await util.codeQlVersionAbove(codeql, codeql_1.CODEQL_VERSION_ANALYSIS_SUMMARY_V2))) {
                await runPrintLinesOfCode(language);
            }
        }
        catch (e) {
            statusReport.analyze_failure_language = language;
            throw new CodeQLAnalysisError(statusReport, `Error running analysis for ${language}: ${util.wrapError(e).message}`);
        }
    }
    return statusReport;
    async function runInterpretResults(language, queries, sarifFile, enableDebugLogging) {
        const databasePath = util.getCodeQLDatabasePath(config, language);
        return await codeql.databaseInterpretResults(databasePath, queries, sarifFile, addSnippetsFlag, threadsFlag, enableDebugLogging ? "-vv" : "-v", automationDetailsId, config, features, logger);
    }
    /** Get an object with all queries and their counts parsed from a SARIF file path. */
    function getPerQueryAlertCounts(sarifPath, log) {
        (0, upload_lib_1.validateSarifFileSchema)(sarifPath, log);
        const sarifObject = JSON.parse(fs.readFileSync(sarifPath, "utf8"));
        // We do not need to compute fingerprints because we are not sending data based off of locations.
        // Generate the query: alert count object
        const perQueryAlertCounts = {};
        // All rules (queries), from all results, from all runs
        for (const sarifRun of sarifObject.runs) {
            if (sarifRun.results) {
                for (const result of sarifRun.results) {
                    const query = result.rule?.id || result.ruleId;
                    if (query) {
                        perQueryAlertCounts[query] = (perQueryAlertCounts[query] || 0) + 1;
                    }
                }
            }
        }
        return perQueryAlertCounts;
    }
    async function runPrintLinesOfCode(language) {
        const databasePath = util.getCodeQLDatabasePath(config, language);
        return await codeql.databasePrintBaseline(databasePath);
    }
}
exports.runQueries = runQueries;
async function runFinalize(outputDir, threadsFlag, memoryFlag, config, logger, features) {
    try {
        await (0, del_1.default)(outputDir, { force: true });
    }
    catch (error) {
        if (error?.code !== "ENOENT") {
            throw error;
        }
    }
    await fs.promises.mkdir(outputDir, { recursive: true });
    const timings = await finalizeDatabaseCreation(config, threadsFlag, memoryFlag, logger, features);
    // WARNING: This does not _really_ end tracing, as the tracer will restore its
    // critical environment variables and it'll still be active for all processes
    // launched from this build step.
    // However, it will stop tracing for all steps past the codeql-action/analyze
    // step.
    // Delete variables as specified by the end-tracing script
    await (0, tracer_config_1.endTracingForCluster)(config);
    return timings;
}
exports.runFinalize = runFinalize;
async function runCleanup(config, cleanupLevel, logger) {
    logger.startGroup("Cleaning up databases");
    for (const language of config.languages) {
        const codeql = await (0, codeql_1.getCodeQL)(config.codeQLCmd);
        const databasePath = util.getCodeQLDatabasePath(config, language);
        await codeql.databaseCleanup(databasePath, cleanupLevel);
    }
    logger.endGroup();
}
exports.runCleanup = runCleanup;
//# sourceMappingURL=analyze.js.map