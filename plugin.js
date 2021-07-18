const child_process = require('child_process');
const archiver = require('archiver');
const os = require('os');
const chokidar = require('chokidar');
const anymatch = require('anymatch');

const ignoredPaths = [
    '.git/*',
    '.serverless/*',
    'serverless.yml',
];

class ServerlessPlugin {
    constructor(serverless) {
        this.serverless = serverless;
        this.commands = {
            'bref-live': {
                usage: 'Start Bref live',
                lifecycleEvents: [
                    'start',
                ],
            },
        };
        this.hooks = {
            initialize: () => this.init(),
            'bref-live:start': () => this.start(),
        };
    }

    async init() {
        this.awsProvider = this.serverless.getProvider('aws');
        this.region = this.awsProvider.getRegion();
        const accountId = await this.awsProvider.getAccountId();
        this.bucketName = `bref-live-${accountId}`;

        this.serverless.service.provider.environment = this.serverless.service.provider.environment ?? {};
        this.serverless.service.provider.environment.BREF_LIVE_BUCKET = this.bucketName;
        this.serverless.service.provider.environment.BREF_LIVE_BUCKET_REGION = 'eu-west-3';
    }

    async start() {
        this.sync();
        chokidar.watch('.', {
            ignoreInitial: true,
            ignored: ignoredPaths,
        }).on('all', async (event, path) => {
            if (this.isGitIgnored(path)) return;
            console.log(`${path} (${event})`);
            await this.sync();
        });
    }

    async sync() {
        const startTime = process.hrtime();
        const functionNames = this.serverless.service.getAllFunctionsNames();
        await Promise.all(functionNames.map((functionName) => this.uploadDiff(functionName)));
        console.log(new Date().toLocaleTimeString() + ' - Patch uploaded - ' + this.elapsedTime(startTime) + ' s');
    }

    async uploadDiff(functionName) {
        const changedFilesOutput = this.spawnSync('git', ['diff', 'HEAD', '--name-only']);
        let changedFiles = changedFilesOutput.split(os.EOL);
        changedFiles = changedFiles.filter((file) => file !== '' && !anymatch(ignoredPaths, file));

        const archive = archiver('zip', {});
        for (const file of changedFiles) {
            console.log(`+ ${file}`);
            archive.file(file, {name: file});
        }
        await archive.finalize();

        await this.awsProvider.request("S3", "upload", {
            Bucket: this.bucketName,
            Key: `${this.region}/${functionName}.zip`,
            Body: archive,
        });
    }

    elapsedTime(startTime){
        const hrtime = process.hrtime(startTime);
        return (hrtime[0] + (hrtime[1] / 1e9)).toFixed(3);
    }

    isGitIgnored(path) {
        return child_process.spawnSync('git', ['check-ignore', path]).status === 0;
    }

    spawnSync(cmd, args) {
        const p = child_process.spawnSync(cmd, args);
        return p.stdout.toString().trim();
    }
}

module.exports = ServerlessPlugin;
