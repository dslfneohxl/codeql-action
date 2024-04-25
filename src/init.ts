import * as fs from "fs";
import * as path from "path";

import * as exec from "@actions/exec/lib/exec";
import * as toolrunner from "@actions/exec/lib/toolrunner";
import * as safeWhich from "@chrisgavin/safe-which";

import { GitHubApiCombinedDetails, GitHubApiDetails } from "./api-client";
import { CodeQL, setupCodeQL } from "./codeql";
import * as configUtils from "./config-utils";
import { CodeQLDefaultVersionInfo, FeatureEnablement } from "./feature-flags";
import { Language, isScannedLanguage } from "./languages";
import { Logger } from "./logging";
import { ToolsSource } from "./setup-codeql";
import { ToolsFeature } from "./tools-features";
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
  inputs: configUtils.InitConfigInputs,
  codeql: CodeQL,
): Promise<configUtils.Config> {
  const logger = inputs.logger;
  logger.startGroup("Load language configuration");
  const config = await configUtils.initConfig(inputs);
  if (
    !(await codeql.supportsFeature(
      ToolsFeature.InformsAboutUnsupportedPathFilters,
    ))
  ) {
    printPathFiltersWarning(config, logger);
  }
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
  features: FeatureEnablement,
  logger: Logger,
): Promise<TracerConfig | undefined> {
  fs.mkdirSync(config.dbLocation, { recursive: true });

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
        features,
        logger,
      ),
  );
  return await getCombinedTracerConfig(codeql, config, features);
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

// For MacOS runners: runs `csrutil status` to determine whether System
// Integrity Protection is enabled.
export async function isSipEnabled(logger): Promise<boolean | undefined> {
  try {
    const sipStatusOutput = await exec.getExecOutput("csrutil status");
    if (sipStatusOutput.exitCode === 0) {
      if (
        sipStatusOutput.stdout.includes(
          "System Integrity Protection status: enabled.",
        )
      ) {
        return true;
      }
      if (
        sipStatusOutput.stdout.includes(
          "System Integrity Protection status: disabled.",
        )
      ) {
        return false;
      }
    }
    return undefined;
  } catch (e) {
    logger.warning(
      `Failed to determine if System Integrity Protection was enabled: ${e}`,
    );
    return undefined;
  }
}
