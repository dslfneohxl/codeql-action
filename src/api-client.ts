import * as path from "path";

import * as githubUtils from "@actions/github/lib/utils";
import * as retry from "@octokit/plugin-retry";
import consoleLogLevel from "console-log-level";

import { getRequiredInput } from "./actions-util";
import * as util from "./util";
import { getMode, getRequiredEnvParam, GitHubVersion } from "./util";

// eslint-disable-next-line import/no-commonjs
const pkg = require("../package.json");

export enum DisallowedAPIVersionReason {
  ACTION_TOO_OLD,
  ACTION_TOO_NEW,
}

export type GitHubApiCombinedDetails = GitHubApiDetails &
  GitHubApiExternalRepoDetails;

export interface GitHubApiDetails {
  auth: string;
  url: string;
  apiURL: string | undefined;
}

export interface GitHubApiExternalRepoDetails {
  externalRepoAuth?: string;
  url: string;
  apiURL: string | undefined;
}

export const getApiClient = function (
  apiDetails: GitHubApiCombinedDetails,
  { allowExternal = false } = {}
) {
  const auth =
    (allowExternal && apiDetails.externalRepoAuth) || apiDetails.auth;
  const retryingOctokit = githubUtils.GitHub.plugin(retry.retry);
  const apiURL = apiDetails.apiURL || deriveApiUrl(apiDetails.url);
  return new retryingOctokit(
    githubUtils.getOctokitOptions(auth, {
      baseUrl: apiURL,
      userAgent: `CodeQL-${getMode()}/${pkg.version}`,
      log: consoleLogLevel({ level: "debug" }),
    })
  );
};

// Once the runner is deleted, this can also be removed since the GitHub API URL is always available in an environment variable on Actions.
function deriveApiUrl(githubUrl: string): string {
  const url = new URL(githubUrl);

  // If we detect this is trying to connect to github.com
  // then return with a fixed canonical URL.
  if (url.hostname === "github.com" || url.hostname === "api.github.com") {
    return "https://api.github.com";
  }

  // Add the /api/v3 API prefix
  url.pathname = path.join(url.pathname, "api", "v3");
  return url.toString();
}

export function getApiDetails() {
  return {
    auth: getRequiredInput("token"),
    url: getRequiredEnvParam("GITHUB_SERVER_URL"),
    apiURL: getRequiredEnvParam("GITHUB_API_URL"),
  };
}

// Temporary function to aid in the transition to running on and off of github actions.
// Once all code has been converted this function should be removed or made canonical
// and called only from the action entrypoints.
export function getActionsApiClient() {
  return getApiClient(getApiDetails());
}

let cachedGitHubVersion: GitHubVersion | undefined = undefined;

/**
 * Report the GitHub server version. This is a wrapper around
 * util.getGitHubVersion() that automatically supplies GitHub API details using
 * GitHub Action inputs. If you need to get the GitHub server version from the
 * Runner, please call util.getGitHubVersion() instead.
 *
 * @returns GitHub version
 */
export async function getGitHubVersionActionsOnly(): Promise<GitHubVersion> {
  if (!util.isActions()) {
    throw new Error("getGitHubVersionActionsOnly() works only in an action");
  }
  if (cachedGitHubVersion === undefined) {
    cachedGitHubVersion = await util.getGitHubVersion(getApiDetails());
  }
  return cachedGitHubVersion;
}
