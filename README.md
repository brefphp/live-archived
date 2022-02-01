Edit code live on Lambda without leaving your editor.

## How?

TODO

## Installation

Install Bref Live:

```
composer require bref/live
```

Install the Serverless Framework plugin:

```
serverless plugin install -n @bref.sh/live
```

> The command above is a shortcut. You can also install the plugin manually: install via NPM: `npm install --save-dev @bref.sh/live` and load the `'@bref.sh/live'` plugin in `serverless.yml`.

Set up Bref Live's S3 bucket by running:

```
serverless bref:live:install
```

Run Bref Live at the top of your main file (`index.php` or similar):

```php
require __DIR__.'/../vendor/bref/live/live.php';
Bref\live(__FILE__);

// Composer's autoloader MUST be loaded after Bref Live
// ...
require __DIR__.'/../vendor/autoload.php';
```

## Usage

Run Bref Live:

```
serverless bref:live
```

After a first sync, all file changes will be uploaded live to Lambda.

After using Bref Live, reset the environment to a clean state via:

```
serverless deploy
```
