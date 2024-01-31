/** Error messages from the CLI that we handle specially. */
export enum CliError {
  IncompatibleWithActionVersion,
  InitCalledTwice,
  InvalidSourceRoot,
  NoJavaScriptTypeScriptCodeFound,
}

/**
 * All of our caught CLI error messages that we handle specially: ie. if we
 * would like to categorize an error as a configuration error or not. Optionally
 * associated with a CLI error code as well. Note that either of the conditions
 * is enough to be considered a match: if the exit code is a match, or the error
 * messages match.
 */
export const cliErrorsConfig: Record<
  CliError,
  {
    cliErrorMessageSnippets: string[];
    exitCode?: number;
  }
> = {
  // Version of CodeQL CLI is incompatible with this version of the CodeQL Action
  [CliError.IncompatibleWithActionVersion]: {
    cliErrorMessageSnippets: ["is not compatible with this CodeQL CLI"],
  },
  [CliError.InitCalledTwice]: {
    cliErrorMessageSnippets: [
      "Refusing to create databases",
      "exists and is not an empty directory",
    ],
  },
  // Expected source location for database creation does not exist
  [CliError.InvalidSourceRoot]: {
    cliErrorMessageSnippets: ["Invalid source root"],
  },
  /**
   * Earlier versions of the JavaScript extractor (pre-CodeQL 2.12.0) extract externs even if no
   * source code was found. This means that we don't get the no code found error from
   * `codeql database finalize`. To ensure users get a good error message, we detect this manually
   * here, and upon detection override the error message.
   *
   * This can be removed once support for CodeQL 2.11.6 is removed.
   */
  [CliError.NoJavaScriptTypeScriptCodeFound]: {
    exitCode: 32,
    cliErrorMessageSnippets: ["No JavaScript or TypeScript code found."],
  },
};

/**
 * Checks whether or not the error message received from the CLI is a config
 * error. Returns true as long as either of the conditions holds: the exit
 * codes are a match, or the error message matches the expected message snippets.
 */
export function isCliConfigurationError(
  cliError: CliError,
  cliErrorMessage: string,
  exitCode?: number,
): boolean {
  const cliErrorConfig = cliErrorsConfig[cliError];

  if (
    exitCode !== undefined &&
    cliErrorConfig.exitCode !== undefined &&
    exitCode === cliErrorConfig.exitCode
  ) {
    return true;
  }

  for (const e of cliErrorConfig.cliErrorMessageSnippets) {
    if (!cliErrorMessage.includes(e)) {
      return false;
    }
  }
  return true;
}

/**
 * Maps a CLI error class to the error message that the Action should return in
 * case of this error. Leave undefined if the CLI error message should be returned
 * directly.
 *
 * Otherwise, specify an error message to return for this CLI error; and whether the
 * original CLI error text should be appended to it.
 */
export const cliToActionErrorsConfig: Record<
  CliError,
  | {
      actionErrorMessage: string;
      appendCliError: boolean;
    }
  | undefined
> = {
  [CliError.InitCalledTwice]: {
    actionErrorMessage: `Is the "init" action called twice in the same job?`,
    appendCliError: true,
  },
  [CliError.NoJavaScriptTypeScriptCodeFound]: {
    actionErrorMessage:
      "No code found during the build. Please see: " +
      "https://gh.io/troubleshooting-code-scanning/no-source-code-seen-during-build",
    appendCliError: false,
  },
  [CliError.IncompatibleWithActionVersion]: undefined,
  [CliError.InvalidSourceRoot]: undefined,
};

export function processCliConfigurationError(
  cliError: CliError,
  cliErrorMessage: string,
): string {
  const cliToActionErrorConfig = cliToActionErrorsConfig[cliError];
  if (cliToActionErrorConfig === undefined) {
    return cliErrorMessage;
  }

  return cliToActionErrorConfig.appendCliError
    ? cliToActionErrorConfig.actionErrorMessage + cliErrorMessage
    : cliToActionErrorConfig.actionErrorMessage;
}
