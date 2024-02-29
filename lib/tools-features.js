"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSupportedToolsFeature = exports.ToolsFeature = void 0;
var ToolsFeature;
(function (ToolsFeature) {
    ToolsFeature["BuildModeOption"] = "buildModeOption";
    ToolsFeature["IndirectTracingSupportsStaticBinaries"] = "indirectTracingSupportsStaticBinaries";
    ToolsFeature["InformsAboutUnsupportedPathFilters"] = "informsAboutUnsupportedPathFilters";
    ToolsFeature["SetsCodeqlRunnerEnvVar"] = "setsCodeqlRunnerEnvVar";
    ToolsFeature["TraceCommandUseBuildMode"] = "traceCommandUseBuildMode";
})(ToolsFeature || (exports.ToolsFeature = ToolsFeature = {}));
/**
 * Determines if the given feature is supported by the CLI.
 *
 * @param versionInfo Version information, including features, returned by the CLI.
 * @param feature The feature to check for.
 * @returns True if the feature is supported or false otherwise.
 */
function isSupportedToolsFeature(versionInfo, feature) {
    return !!versionInfo.features && versionInfo.features[feature];
}
exports.isSupportedToolsFeature = isSupportedToolsFeature;
//# sourceMappingURL=tools-features.js.map