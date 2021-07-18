const child_process = require('child_process');
const archiver = require('archiver');
const os = require('os');
const chokidar = require('chokidar');
const anymatch = require('anymatch');
const ora = require('ora');
const chalk = require('chalk');

const ignoredPaths = [
    '.git/*',
    '.serverless',
    '.serverless/*',
    'serverless.yml',
];

class ServerlessPlugin {
    constructor(serverless) {
        this.serverless = serverless;
        this.commands = {
            'bref-live': {
                usage: 'Start Bref Live',
                lifecycleEvents: ['start'],
            },
            'bref-live-install': {
                usage: 'Install Bref Live',
                lifecycleEvents: ['install'],
            },
        };
        this.hooks = {
            initialize: () => this.init(),
            'bref-live:start': () => this.start(),
            'bref-live-install:install': () => this.install(),
        };
    }

    async init() {
        this.awsProvider = this.serverless.getProvider('aws');
        this.region = this.awsProvider.getRegion();
        const accountId = await this.awsProvider.getAccountId();
        this.bucketName = `bref-live-${accountId}`;

        this.serverless.service.provider.environment = this.serverless.service.provider.environment ?? {};
        // TODO make those configurable in `bref.live` in serverless.yml
        this.serverless.service.provider.environment.BREF_LIVE_BUCKET = this.bucketName;
        this.serverless.service.provider.environment.BREF_LIVE_BUCKET_REGION = 'eu-west-3';
    }

    async install() {
        // TODO create the bucket, maybe with a separate CloudFormation stack?
        console.log(`WIP - Create a bucket '${this.bucketName}' and make it accessible by Lambda.`);
        console.log('Create it in an AWS region close to your location for faster uploads.');
    }

    async start() {
        console.log(chalk.gray(`Bref Live will upload changes tracked by git: ${chalk.underline('git diff HEAD --name-only')}`));
        this.spinner = ora('Watching changes').start();

        this.sync('Initial sync');
        chokidar.watch('.', {
            ignoreInitial: true,
            ignored: ignoredPaths,
        }).on('all', async (event, path) => {
            if (this.isGitIgnored(path)) return;
            await this.sync(path);
        });
    }

    async sync(path) {
        this.spinner.text = 'Uploading';

        const startTime = process.hrtime();
        const startTimeHuman = new Date().toLocaleTimeString();
        const functionNames = this.serverless.service.getAllFunctionsNames();
        await Promise.all(functionNames.map((functionName) => this.uploadDiff(functionName)));
        this.spinner.succeed(`${chalk.gray(startTimeHuman)} - ${this.elapsedTime(startTime)}s - ${path}`);

        // New spinner
        this.spinner = ora('Watching project').start();
    }

    async uploadDiff(functionName) {
        const changedFilesOutput = this.spawnSync('git', ['diff', 'HEAD', '--name-only']);
        let changedFiles = changedFilesOutput.split(os.EOL);
        changedFiles = changedFiles.filter((file) => file !== '' && !anymatch(ignoredPaths, file));

        const archive = archiver('zip', {});
        for (const file of changedFiles) {
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
