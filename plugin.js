const fs = require('fs');
const child_process = require('child_process');
const archiver = require('archiver');
const os = require('os');
const chokidar = require('chokidar');

class ServerlessPlugin {
    constructor(serverless, options) {
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
        this.region = this.serverless.getProvider('aws').getRegion();
        const accountId = await this.serverless.getProvider('aws').getAccountId();
        this.bucketName = `bref-live-${accountId}`;

        this.serverless.service.provider.environment = this.serverless.service.provider.environment ?? {};
        this.serverless.service.provider.environment.BREF_LIVE_BUCKET = this.bucketName;
        this.serverless.service.provider.environment.BREF_LIVE_BUCKET_REGION = 'eu-west-3';
    }

    async start() {
        this.sync();
        chokidar.watch('.', {
            ignoreInitial: true,
        }).on('all', async (event, path) => {
            if (path.startsWith('.git/') || path.startsWith('.serverless/') || path.startsWith('node_modules/') || path.startsWith('vendor/')) {
                return;
            }
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
        if (!fs.existsSync('.serverless')) {
            fs.mkdirSync('.serverless');
        }
        const process = child_process.spawnSync('git', ['diff', 'HEAD', '--name-only']);

        const archive = archiver('zip', {});
        for (const file of process.stdout.toString().split(os.EOL)) {
            if (file === '') {
                continue;
            }
            console.log(`+ ${file}`);
            archive.file(file, {name: file});
        }
        await archive.finalize();

        await this.serverless.getProvider('aws').request("S3", "upload", {
            Bucket: this.bucketName,
            Key: `${this.region}/${functionName}.zip`,
            Body: archive,
        });
    }

    elapsedTime(startTime){
        const hrtime = process.hrtime(startTime);
        return (hrtime[0] + (hrtime[1] / 1e9)).toFixed(3);
    }
}

module.exports = ServerlessPlugin;
