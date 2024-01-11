import * as fs from "fs";
import * as path from "path";

import * as toolrunner from "@actions/exec/lib/toolrunner";
import * as safeWhich from "@chrisgavin/safe-which";

import { GitHubApiCombinedDetails, GitHubApiDetails } from "./api-client";
import { CodeQL, setupCodeQL } from "./codeql";
import * as configUtils from "./config-utils";
import { CodeQLDefaultVersionInfo } from "./feature-flags";
import { Language, isScannedLanguage } from "./languages";
import { Logger } from "./logging";
import { RepositoryNwo } from "./repository";
import { ToolsSource } from "./setup-codeql";
import { TracerConfig, getCombinedTracerConfig } from "./tracer-config";
import * as util from "./util";

export async function initCodeQL(
  toolsInput: string | undefined,
  apiDetails: GitHubApiDetails,
  tempDir: string,
  variant: util.GitHubVariant,
  defaultCliVersion: CodeQLDefaultVersionInfo,
  logger: Logger,
): Promise<{
  codeql: CodeQL;
  toolsDownloadDurationMs?: number;
  toolsSource: ToolsSource;
  toolsVersion: string;
}> {
  logger.startGroup("Setup CodeQL tools");
  const { codeql, toolsDownloadDurationMs, toolsSource, toolsVersion } =
    await setupCodeQL(
      toolsInput,
      apiDetails,
      tempDir,
      variant,
      defaultCliVersion,
      logger,
      true,
    );
  await codeql.printVersion();
  logger.endGroup();
  return { codeql, toolsDownloadDurationMs, toolsSource, toolsVersion };
}

export async function initConfig(
  languagesInput: string | undefined,
  queriesInput: string | undefined,
  packsInput: string | undefined,
  configFile: string | undefined,
  dbLocation: string | undefined,
  configInput: string | undefined,
  trapCachingEnabled: boolean,
  debugMode: boolean,
  debugArtifactName: string,
  debugDatabaseName: string,
  repository: RepositoryNwo,
  tempDir: string,
  codeQL: CodeQL,
  workspacePath: string,
  gitHubVersion: util.GitHubVersion,
  apiDetails: GitHubApiCombinedDetails,
  logger: Logger,
): Promise<configUtils.Config> {
  logger.startGroup("Load language configuration");
  const config = await configUtils.initConfig(
    languagesInput,
    queriesInput,
    packsInput,
    configFile,
    dbLocation,
    configInput,
    trapCachingEnabled,
    debugMode,
    debugArtifactName,
    debugDatabaseName,
    repository,
    tempDir,
    codeQL,
    workspacePath,
    gitHubVersion,
    apiDetails,
    logger,
  );
  printPathFiltersWarning(config, logger);
  logger.endGroup();
  return config;
}

export async function runInit(
  codeql: CodeQL,
  config: configUtils.Config,
  sourceRoot: string,
  processName: string | undefined,
  registriesInput: string | undefined,
  apiDetails: GitHubApiCombinedDetails,
  logger: Logger,
): Promise<TracerConfig | undefined> {
  fs.mkdirSync(config.dbLocation, { recursive: true });
  try {
    const { registriesAuthTokens, qlconfigFile } =
      await configUtils.generateRegistries(
        registriesInput,
        config.tempDir,
        logger,
      );
    await configUtils.wrapEnvironment(
      {
        GITHUB_TOKEN: apiDetails.auth,
        CODEQL_REGISTRIES_AUTH: registriesAuthTokens,
      },

      // Init a database cluster
      async () =>
        await codeql.databaseInitCluster(
          config,
          sourceRoot,
          processName,
          qlconfigFile,
          logger,
        ),
    );
  } catch (e) {
    throw processError(e);
  }
  return await getCombinedTracerConfig(await codeql.getVersion(), config);
}

export function printPathFiltersWarning(
  config: configUtils.Config,
  logger: Logger,
) {
  // Index include/exclude/filters only work in javascript/python/ruby.
  // If any other languages are detected/configured then show a warning.
  if (
    (config.originalUserInput.paths?.length ||
      config.originalUserInput["paths-ignore"]?.length) &&
    !config.languages.every(isScannedLanguage)
  ) {
    logger.warning(
      'The "paths"/"paths-ignore" fields of the config only have effect for JavaScript, Python, and Ruby',
    );
  }
}

/**
 * Possibly convert this error into a UserError in order to avoid
 * counting this error towards our internal error budget.
 *
 * @param e The error to possibly convert to a UserError.
 *
 * @returns A UserError if the error is a known error that can be
 *         attributed to the user, otherwise the original error.
 */
function processError(e: any): Error {
  if (!(e instanceof Error)) {
    return e;
  }

  if (
    // Init action called twice
    e.message?.includes("Refusing to create databases") &&
    e.message?.includes("exists and is not an empty directory.")
  ) {
    return new util.UserError(
      `Is the "init" action called twice in the same job? ${e.message}`,
    );
  }

  if (
    // Version of CodeQL CLI is incompatible with this version of the CodeQL Action
    e.message?.includes("is not compatible with this CodeQL CLI") ||
    // Expected source location for database creation does not exist
    e.message?.includes("Invalid source root")
  ) {
    return new util.UserError(e.message);
  }

  return e;
}

/**
 * If we are running python 3.12+ on windows, we need to switch to python 3.11.
 * This check happens in a powershell script.
 */
export async function checkInstallPython311(
  languages: Language[],
  codeql: CodeQL,
) {
  if (
    languages.includes(Language.python) &&
    process.platform === "win32" &&
    !(await codeql.getVersion()).features?.supportsPython312
  ) {
    const script = path.resolve(
      __dirname,
      "../python-setup",
      "check_python12.ps1",
    );
    await new toolrunner.ToolRunner(await safeWhich.safeWhich("powershell"), [
      script,
    ]).exec();
  }
}

export async function installPythonDeps(codeql: CodeQL, logger: Logger) {
  logger.startGroup("Setup Python dependencies");

  const scriptsFolder = path.resolve(__dirname, "../python-setup");

  try {
    if (process.platform === "win32") {
      await new toolrunner.ToolRunner(await safeWhich.safeWhich("powershell"), [
        path.join(scriptsFolder, "install_tools.ps1"),
      ]).exec();
    } else {
      await new toolrunner.ToolRunner(
        path.join(scriptsFolder, "install_tools.sh"),
      ).exec();
    }
    const script = "auto_install_packages.py";
    if (process.platform === "win32") {
      await new toolrunner.ToolRunner(await safeWhich.safeWhich("py"), [
        "-3",
        "-B",
        path.join(scriptsFolder, script),
        path.dirname(codeql.getPath()),
      ]).exec();
    } else {
      await new toolrunner.ToolRunner(await safeWhich.safeWhich("python3"), [
        "-B",
        path.join(scriptsFolder, script),
        path.dirname(codeql.getPath()),
      ]).exec();
    }
  } catch (e) {
    logger.endGroup();
    logger.warning(
      `An error occurred while trying to automatically install Python dependencies: ${e}\n` +
        "Please make sure any necessary dependencies are installed before calling the codeql-action/analyze " +
        "step, and add a 'setup-python-dependencies: false' argument to this step to disable our automatic " +
        "dependency installation and avoid this warning.",
    );
    return;
  }
  logger.endGroup();
}
