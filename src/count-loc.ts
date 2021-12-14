import { LocDir } from "github-linguist";

import { KnownLanguage, Language } from "./languages";
import { Logger } from "./logging";

// Map from linguist language names to language prefixes used in the action and codeql
const linguistToMetrics: Record<string, KnownLanguage> = {
  c: KnownLanguage.cpp,
  "c++": KnownLanguage.cpp,
  "c#": KnownLanguage.csharp,
  go: KnownLanguage.go,
  java: KnownLanguage.java,
  javascript: KnownLanguage.javascript,
  python: KnownLanguage.python,
  ruby: KnownLanguage.ruby,
  typescript: KnownLanguage.javascript,
};

const nameToLinguist = Object.entries(linguistToMetrics).reduce(
  (obj, [key, name]) => {
    if (!obj[name]) {
      obj[name] = [];
    }
    obj[name].push(key);
    return obj;
  },
  {} as Record<KnownLanguage, string[]>
);

/**
 * Count the lines of code of the specified language using the include
 * and exclude glob paths.
 *
 * @param cwd the root directory to start the count from
 * @param include glob patterns to include in the search for relevant files
 * @param exclude glob patterns to exclude in the search for relevant files
 * @param dbLanguages list of languages to include in the results
 * @param logger object to log results
 */
export async function countLoc(
  cwd: string,
  include: string[],
  exclude: string[],
  dbLanguages: Language[],
  logger: Logger
): Promise<Partial<Record<Language, number>>> {
  const result = await new LocDir({
    cwd,
    include: Array.isArray(include) && include.length > 0 ? include : ["**"],
    exclude,
    analysisLanguages: dbLanguages.flatMap((lang) => nameToLinguist[lang]),
  }).loadInfo();

  // The analysis counts LoC in all languages. We need to
  // extract the languages we care about. Also, note that
  // the analysis uses slightly different names for language.
  const lineCounts = Object.entries(result.languages).reduce(
    (obj, [language, { code }]) => {
      const metricsLanguage = linguistToMetrics[language];
      if (metricsLanguage && dbLanguages.includes(metricsLanguage)) {
        obj[metricsLanguage] = code + (obj[metricsLanguage] || 0);
      }
      return obj;
    },
    {} as Record<Language, number>
  );

  if (Object.keys(lineCounts).length) {
    logger.debug("Lines of code count:");
    for (const [language, count] of Object.entries(lineCounts)) {
      logger.debug(`  ${language}: ${count}`);
    }
  } else {
    logger.info(
      "Could not determine the baseline lines of code count in this repository. " +
        "Because of this, it will not be possible to compare the lines " +
        "of code analyzed by code scanning with the baseline. This will not affect " +
        "the results produced by code scanning. If you have any questions, you can " +
        "raise an issue at https://github.com/github/codeql-action/issues. Please " +
        "include a link to the repository if public, or otherwise information about " +
        "the code scanning workflow you are using."
    );
  }

  return lineCounts;
}
