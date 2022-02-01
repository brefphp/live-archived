const child_process = require('child_process');
const archiver = require('archiver');
const chokidar = require('chokidar');
const chalk = require('chalk');

class BrefLive {
    constructor(serverless, options, utils) {
        this.serverless = serverless;
        this.utils = utils;
        this.commands = {
            'bref:live': {
                usage: 'Start Bref Live',
                lifecycleEvents: ['start'],
            },
            'bref:live:install': {
                usage: 'Install Bref Live',
                lifecycleEvents: ['install'],
            },
        };
        this.hooks = {
            initialize: () => this.init(),
            'bref:live:start': () => this.start(),
            'bref:live:install:install': () => this.install(),
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
        if (process.env.BREF_LIVE_ENABLE) {
            this.serverless.service.provider.environment.BREF_LIVE_ENABLE = process.env.BREF_LIVE_ENABLE;
        }

        // TODO support include/exclude
        this.packagePatterns = this.serverless.service.package.patterns ?? [];
    }

    async install() {
        // TODO create the bucket, maybe with a separate CloudFormation stack?
        console.log(`WIP - Create a bucket '${this.bucketName}' and make it accessible by Lambda.`);
        console.log('Create it in an AWS region close to your location for faster uploads.');
        console.log('In the future the CLI should create the bucket for you, sorry for the trouble :)');
    }

    async start() {
        this.changedFiles = [];

        this.spinner = this.utils.progress.create();

        // TODO implement a pattern matching that == the one used by Framework
        const pathsToWatch = this.packagePatterns.filter((pattern) => !pattern.startsWith('!'));
        if (pathsToWatch.length === 0) {
            pathsToWatch.push('*');
        }
        const pathsToIgnore = this.packagePatterns.filter((pattern) => pattern.startsWith('!'))
            .map((pattern) => pattern.replace('!', ''));

        await this.initialSync();

        this.spinner.update('Watching changes');
        chokidar.watch(pathsToWatch, {
            ignoreInitial: true,
            ignored: pathsToIgnore,
        }).on('all', async (event, path) => {
            await this.sync(path);
        });

        // TODO catch interrupt to cancel BREF_LIVE_ENABLE
        return new Promise(resolve => {});
    }

    async initialSync() {
        this.spinner.update('Deploying all functions');

        this.serverless.service.provider.environment.BREF_LIVE_ENABLE = '1';
        const functionNames = this.serverless.service.getAllFunctions();
        await Promise.all(functionNames.map((functionName) => {
            return this.spawnAsync('serverless', [
                'deploy', 'function', '--function', functionName
            ], {
                BREF_LIVE_ENABLE: '1',
            });
        }));
    }

    async sync(path) {
        this.changedFiles.push(path);

        this.spinner.update('Uploading');

        const startTime = process.hrtime();
        const startTimeHuman = new Date().toLocaleTimeString();
        const functionNames = this.serverless.service.getAllFunctionsNames();
        await Promise.all(functionNames.map((functionName) => this.uploadDiff(functionName)));

        const elapsedTime = `${this.elapsedTime(startTime)}s`;
        this.utils.log.success(`${chalk.gray(startTimeHuman)} ${path} ${chalk.gray(elapsedTime)}`);

        this.spinner.update('Watching changes');
    }

    async uploadDiff(functionName) {
        const archive = archiver('zip', {});
        for (const file of this.changedFiles) {
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
        return (hrtime[0] + (hrtime[1] / 1e9)).toFixed(1);
    }

    async spawnAsync(command, args, env) {
        const child = child_process.spawn(command, args, {
            env: {
                ...process.env,
                ...env,
            },
        });
        let output = "";
        for await (const chunk of child.stdout) {
            output += chunk;
        }
        for await (const chunk of child.stderr) {
            output += chunk;
        }
        const exitCode = await new Promise( (resolve, reject) => {
            child.on('close', resolve);
        });
        if( exitCode) {
            throw new Error(`${output}`);
        }
        return output;
    }
}

module.exports = BrefLive;
