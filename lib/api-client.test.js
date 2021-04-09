"use strict";
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const githubUtils = __importStar(require("@actions/github/lib/utils"));
const ava_1 = __importDefault(require("ava"));
const sinon_1 = __importDefault(require("sinon"));
const api_client_1 = require("./api-client");
const testing_utils_1 = require("./testing-utils");
testing_utils_1.setupTests(ava_1.default);
let githubStub;
ava_1.default.beforeEach(() => {
    githubStub = sinon_1.default.stub(githubUtils, "GitHub");
});
ava_1.default("Get the client API", async (t) => {
    doTest(t, {
        auth: "xyz",
        externalRepoAuth: "abc",
        url: "http://hucairz",
    }, undefined, {
        auth: "token xyz",
        baseUrl: "http://hucairz/api/v3",
        userAgent: "CodeQL Action",
    });
});
ava_1.default("Get the client API external", async (t) => {
    doTest(t, {
        auth: "xyz",
        externalRepoAuth: "abc",
        url: "http://hucairz",
    }, { allowExternal: true }, {
        auth: "token abc",
        baseUrl: "http://hucairz/api/v3",
        userAgent: "CodeQL Action",
    });
});
ava_1.default("Get the client API external not present", async (t) => {
    doTest(t, {
        auth: "xyz",
        url: "http://hucairz",
    }, { allowExternal: true }, {
        auth: "token xyz",
        baseUrl: "http://hucairz/api/v3",
        userAgent: "CodeQL Action",
    });
});
ava_1.default("Get the client API with github url", async (t) => {
    doTest(t, {
        auth: "xyz",
        url: "https://github.com/some/invalid/url",
    }, undefined, {
        auth: "token xyz",
        baseUrl: "https://api.github.com",
        userAgent: "CodeQL Action",
    });
});
function doTest(t, clientArgs, clientOptions, expected) {
    api_client_1.getApiClient(clientArgs, clientOptions);
    const firstCallArgs = githubStub.args[0];
    // log is a function, so we don't need to test for equality of it
    delete firstCallArgs[0].log;
    t.deepEqual(firstCallArgs, [expected]);
}
//# sourceMappingURL=api-client.test.js.map