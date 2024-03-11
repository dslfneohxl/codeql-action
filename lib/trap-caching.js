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
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTotalCacheSize = exports.getLanguagesSupportingCaching = exports.uploadTrapCaches = exports.downloadTrapCaches = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const cache = __importStar(require("@actions/cache"));
const actionsUtil = __importStar(require("./actions-util"));
const util_1 = require("./util");
// This constant should be bumped if we make a breaking change
// to how the CodeQL Action stores or retrieves the TRAP cache,
// and will invalidate previous caches. We don't need to bump
// this for CLI/extractor changes, since the CLI version also
// goes into the cache key.
const CACHE_VERSION = 1;
// This constant sets the minimum size in megabytes of a TRAP
// cache for us to consider it worth uploading.
const MINIMUM_CACHE_MB_TO_UPLOAD = 10;
// The maximum number of milliseconds to wait for TRAP cache
// uploads or downloads to complete before continuing. Note
// this timeout is per operation, so will be run as many
// times as there are languages with TRAP caching enabled.
const MAX_CACHE_OPERATION_MS = 120_000; // Two minutes
/**
 * Download TRAP caches from the Actions cache.
 * @param codeql The CodeQL instance to use.
 * @param languages The languages being analyzed.
 * @param logger A logger to record some informational messages to.
 * @returns A partial map from languages to TRAP cache paths on disk, with
 * languages for which we shouldn't use TRAP caching omitted.
 */
async function downloadTrapCaches(codeql, languages, logger) {
    const result = {};
    const languagesSupportingCaching = await getLanguagesSupportingCaching(codeql, languages, logger);
    logger.info(`Found ${languagesSupportingCaching.length} languages that support TRAP caching`);
    if (languagesSupportingCaching.length === 0)
        return result;
    const cachesDir = path.join(actionsUtil.getTemporaryDirectory(), "trapCaches");
    for (const language of languagesSupportingCaching) {
        const cacheDir = path.join(cachesDir, language);
        fs.mkdirSync(cacheDir, { recursive: true });
        result[language] = cacheDir;
    }
    if (await actionsUtil.isAnalyzingDefaultBranch()) {
        logger.info("Analyzing default branch. Skipping downloading of TRAP caches.");
        return result;
    }
    let baseSha = "unknown";
    const eventPath = process.env.GITHUB_EVENT_PATH;
    if (actionsUtil.getWorkflowEventName() === "pull_request" &&
        eventPath !== undefined) {
        const event = JSON.parse(fs.readFileSync(path.resolve(eventPath), "utf-8"));
        baseSha = event.pull_request?.base?.sha || baseSha;
    }
    for (const language of languages) {
        const cacheDir = result[language];
        if (cacheDir === undefined)
            continue;
        // The SHA from the base of the PR is the most similar commit we might have a cache for
        const preferredKey = await cacheKey(codeql, language, baseSha);
        logger.info(`Looking in Actions cache for TRAP cache with key ${preferredKey}`);
        const found = await (0, util_1.withTimeout)(MAX_CACHE_OPERATION_MS, cache.restoreCache([cacheDir], preferredKey, [
            // Fall back to any cache with the right key prefix
            await cachePrefix(codeql, language),
        ]), () => {
            logger.info(`Timed out downloading cache for ${language}, will continue without it`);
        });
        if (found === undefined) {
            // We didn't find a TRAP cache in the Actions cache, so the directory on disk is
            // still just an empty directory. There's no reason to tell the extractor to use it,
            // so let's unset the entry in the map so we don't set any extractor options.
            logger.info(`No TRAP cache found in Actions cache for ${language}`);
            delete result[language];
        }
    }
    return result;
}
exports.downloadTrapCaches = downloadTrapCaches;
/**
 * Possibly upload TRAP caches to the Actions cache.
 * @param codeql The CodeQL instance to use.
 * @param config The configuration for this workflow.
 * @param logger A logger to record some informational messages to.
 * @returns Whether the TRAP caches were uploaded.
 */
async function uploadTrapCaches(codeql, config, logger) {
    if (!(await actionsUtil.isAnalyzingDefaultBranch()))
        return false; // Only upload caches from the default branch
    for (const language of config.languages) {
        const cacheDir = config.trapCaches[language];
        if (cacheDir === undefined)
            continue;
        const trapFolderSize = await (0, util_1.tryGetFolderBytes)(cacheDir, logger);
        if (trapFolderSize === undefined) {
            logger.info(`Skipping upload of TRAP cache for ${language} as we couldn't determine its size`);
            continue;
        }
        if (trapFolderSize < MINIMUM_CACHE_MB_TO_UPLOAD * 1_048_576) {
            logger.info(`Skipping upload of TRAP cache for ${language} as it is too small`);
            continue;
        }
        const key = await cacheKey(codeql, language, process.env.GITHUB_SHA || "unknown");
        logger.info(`Uploading TRAP cache to Actions cache with key ${key}`);
        await (0, util_1.withTimeout)(MAX_CACHE_OPERATION_MS, cache.saveCache([cacheDir], key), () => {
            logger.info(`Timed out waiting for TRAP cache for ${language} to upload, will continue without uploading`);
        });
    }
    return true;
}
exports.uploadTrapCaches = uploadTrapCaches;
async function getLanguagesSupportingCaching(codeql, languages, logger) {
    const result = [];
    const resolveResult = await codeql.betterResolveLanguages();
    outer: for (const lang of languages) {
        const extractorsForLanguage = resolveResult.extractors[lang];
        if (extractorsForLanguage === undefined) {
            logger.info(`${lang} does not support TRAP caching (couldn't find an extractor)`);
            continue;
        }
        if (extractorsForLanguage.length !== 1) {
            logger.info(`${lang} does not support TRAP caching (found multiple extractors)`);
            continue;
        }
        const extractor = extractorsForLanguage[0];
        const trapCacheOptions = extractor.extractor_options?.trap?.properties?.cache?.properties;
        if (trapCacheOptions === undefined) {
            logger.info(`${lang} does not support TRAP caching (missing option group)`);
            continue;
        }
        for (const requiredOpt of ["dir", "bound", "write"]) {
            if (!(requiredOpt in trapCacheOptions)) {
                logger.info(`${lang} does not support TRAP caching (missing ${requiredOpt} option)`);
                continue outer;
            }
        }
        result.push(lang);
    }
    return result;
}
exports.getLanguagesSupportingCaching = getLanguagesSupportingCaching;
async function getTotalCacheSize(trapCaches, logger) {
    const sizes = await Promise.all(Object.values(trapCaches).map((cacheDir) => (0, util_1.tryGetFolderBytes)(cacheDir, logger)));
    return sizes.map((a) => a || 0).reduce((a, b) => a + b, 0);
}
exports.getTotalCacheSize = getTotalCacheSize;
async function cacheKey(codeql, language, baseSha) {
    return `${await cachePrefix(codeql, language)}${baseSha}`;
}
async function cachePrefix(codeql, language) {
    return `codeql-trap-${CACHE_VERSION}-${(await codeql.getVersion()).version}-${language}-`;
}
//# sourceMappingURL=trap-caching.js.map