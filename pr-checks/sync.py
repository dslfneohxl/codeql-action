import ruamel.yaml
from ruamel.yaml.scalarstring import FoldedScalarString
import os
import textwrap

# The default set of CodeQL Bundle versions to use for the PR checks.
defaultTestVersions = [
    # The oldest supported CodeQL version: 2.8.5. If bumping, update `CODEQL_MINIMUM_VERSION` in `codeql.ts`
    "stable-20220401",
    # The last CodeQL release in the 2.9 series: 2.9.4.
    "stable-20220615",
    # The last CodeQL release in the 2.10 series: 2.10.5.
    "stable-20220908",
    # The last CodeQL release in the 2.11 series: 2.11.6.
    "stable-20221211",
    # The version of CodeQL currently in the toolcache. Typically either the latest release or the one before.
    "cached",
    # The latest release of CodeQL.
    "latest",
    # A nightly build directly from the our private repo, built in the last 24 hours.
    "nightly-latest"
]


header = """# Warning: This file is generated automatically, and should not be modified.
# Instead, please modify the template in the pr-checks directory and run:
#     (cd pr-checks; pip install ruamel.yaml && python3 sync.py)
# to regenerate this file.

"""


class NonAliasingRTRepresenter(ruamel.yaml.representer.RoundTripRepresenter):
    def ignore_aliases(self, data):
        return True


def writeHeader(checkStream):
    checkStream.write(header)


yaml = ruamel.yaml.YAML()
yaml.Representer = NonAliasingRTRepresenter

allJobs = {}
for file in os.listdir('checks'):
    with open(f"checks/{file}", 'r') as checkStream:
        checkSpecification = yaml.load(checkStream)

    matrix = []
    for version in checkSpecification.get('versions', defaultTestVersions):
        runnerImages = ["ubuntu-latest", "macos-latest", "windows-latest"]
        if checkSpecification.get('operatingSystems', None):
            runnerImages = [image for image in runnerImages for operatingSystem in checkSpecification['operatingSystems']
                            if image.startswith(operatingSystem)]

        for runnerImage in runnerImages:
            matrix.append({
                'os': runnerImage,
                'version': version
            })

    steps = [
        {
            'name': 'Check out repository',
            'uses': 'actions/checkout@v3'
        },
        {
            'name': 'Prepare test',
            'id': 'prepare-test',
            'uses': './.github/actions/prepare-test',
            'with': {
                'version': '${{ matrix.version }}'
            }
        },
        # We don't support Swift on Windows or prior versions of the CLI.
        {
            'name': 'Set environment variable for Swift enablement',
            # Ensure that this is serialized as a folded (`>`) string to preserve the readability
            # of the generated workflow.
            'if': FoldedScalarString(textwrap.dedent('''
                runner.os != 'Windows' && (
                    matrix.version == '20220908' ||
                    matrix.version == '20221211'
                )
            ''').strip()),
            'shell': 'bash',
            'run': 'echo "CODEQL_ENABLE_EXPERIMENTAL_FEATURES_SWIFT=true" >> $GITHUB_ENV'
        },
    ]

    steps.extend(checkSpecification['steps'])

    checkJob = {
        'strategy': {
            'matrix': {
                'include': matrix
            }
        },
        'name': checkSpecification['name'],
        'permissions': {
            'contents': 'read',
            'security-events': 'write'
        },
        'timeout-minutes': 45,
        'runs-on': '${{ matrix.os }}',
        'steps': steps,
    }
    if 'permissions' in checkSpecification:
        checkJob['permissions'] = checkSpecification['permissions']

    for key in ["env", "container", "services"]:
        if key in checkSpecification:
            checkJob[key] = checkSpecification[key]

    checkJob['env'] = checkJob.get('env', {})
    if 'CODEQL_ACTION_TEST_MODE' not in checkJob['env']:
        checkJob['env']['CODEQL_ACTION_TEST_MODE'] = True
    checkName = file[:len(file) - 4]

    with open(f"../.github/workflows/__{checkName}.yml", 'w') as output_stream:
        writeHeader(output_stream)
        yaml.dump({
            'name': f"PR Check - {checkSpecification['name']}",
            'env': {
                'GITHUB_TOKEN': '${{ secrets.GITHUB_TOKEN }}',
                'GO111MODULE': 'auto',
                # Disable Kotlin analysis while it's incompatible with Kotlin 1.8, until we find a
                # workaround for our PR checks.
                'CODEQL_EXTRACTOR_JAVA_AGENT_DISABLE_KOTLIN': 'true',
            },
            'on': {
                'push': {
                    'branches': ['main', 'releases/v2']
                },
                'pull_request': {
                    'types': ["opened", "synchronize", "reopened", "ready_for_review"]
                },
                'workflow_dispatch': {}
            },
            'jobs': {
                checkName: checkJob
            }
        }, output_stream)
