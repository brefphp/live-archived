<?php declare(strict_types=1);

namespace Bref;

use AsyncAws\Core\Exception\Http\RedirectionException;
use AsyncAws\S3\Exception\NoSuchKeyException;
use AsyncAws\S3\S3Client;
use RuntimeException;
use ZipArchive;

if (! function_exists('Bref\live')) {

    function live(string $entryPoint)
    {
        if (!getenv('BREF_LIVE_ENABLE')) return;

        $baseRoot = getenv('LAMBDA_TASK_ROOT');
        $newRoot = '/tmp/.bref-live';

        // Not on Lambda
        if (! $baseRoot) return;
        // We are in /tmp, let the application execute as usual
        if (strpos($entryPoint, $newRoot) === 0) return;

        $stderr = fopen('php://stderr', 'ab');

        if (! is_dir($newRoot)) {
            $startCopy = microtime(true);
            recursiveCopy($baseRoot, $newRoot);
            $copyDuration = (int) ((microtime(true) - $startCopy) * 1000);
            fwrite($stderr, "Bref Live Edit: Initialized in $copyDuration ms\n");
        }

        chdir($newRoot);

        // Require the new autoloader from now on (we'll need it for the S3 client)
        require $newRoot . '/vendor/autoload.php';

        $startSync = microtime(true);
        applyChanges($baseRoot, $newRoot, $stderr);
        $syncDuration = (int) ((microtime(true) - $startSync) * 1000);
        fwrite($stderr, "Bref Live Edit: Synchronized live code in $syncDuration ms\n");

        // Run the original file in the new /tmp copy
        require str_replace($baseRoot, $newRoot, $entryPoint);

        fclose($stderr);

        // Stop the rest of the application from running (it's the /var/task original version)
        exit(0);
    }

    function recursiveCopy($source, $target)
    {
        // Missing file
        if (! file_exists($source)) {
            unlink($target);
            return;
        }
        // Check for symlinks
        if (is_link($source)) {
            symlink(readlink($source), $target);
            return;
        }
        // Simple copy for a file
        if (is_file($source)) {
            copy($source, $target);
            return;
        }
        // Make destination directory
        if (! is_dir($target)) {
            if (! mkdir($target) && ! is_dir($target)) {
                throw new RuntimeException(sprintf('Directory "%s" was not created', $target));
            }
        }

        // Loop through the folder
        $dir = dir($source);
        while (false !== $entry = $dir->read()) {
            // Skip pointers
            if ($entry === '.' || $entry === '..') continue;
            // Deep copy directories
            recursiveCopy("$source/$entry", "$target/$entry");
        }
        $dir->close();
    }

    function applyChanges(string $baseRoot, string $newRoot, $stderr)
    {
        $region = getenv('AWS_REGION');
        $functionName = getenv('AWS_LAMBDA_FUNCTION_NAME');
        $zipKey = "$region/$functionName.zip";

        $s3 = new S3Client([
            'region' => getenv('BREF_LIVE_BUCKET_REGION'),
        ]);
        $params = [
            'Bucket' => getenv('BREF_LIVE_BUCKET'),
            'Key' => $zipKey,
        ];
        // Download the new zip only if it was modified
        if (file_exists('/tmp/.bref-live-etag.txt')) {
            $params['IfNoneMatch'] = file_get_contents('/tmp/.bref-live-etag.txt');
        }
        try {
            $result = $s3->getObject($params);
            file_put_contents('/tmp/.bref-live-etag.txt', $result->getEtag());
            $fp = fopen('/tmp/.bref-live.zip', 'wb');
            stream_copy_to_stream($result->getBody()->getContentAsResource(), $fp);
        } catch (NoSuchKeyException $e) {
            fwrite($stderr, "Bref Live Edit: No changes to apply\n");
            return;
        } catch (RedirectionException $e) {
            if ($e->getResponse()->getStatusCode() !== 304) {
                throw $e;
            }
            // We are already up to date!
            fwrite($stderr, "Bref Live Edit: Up to date\n");
            return;
        }

        $zip = new ZipArchive();
        $zip->open('/tmp/.bref-live.zip');

        // Restore previously modified paths
        if (file_exists('/tmp/.bref-live-modified.json')) {
            $previouslyModifiedPaths = file('/tmp/.bref-live-modified.json');
            foreach ($previouslyModifiedPaths as $path) {
                $path = trim($path);
                // If the previously changed files are no longer in the zip, we need to restore the original version
                if ($zip->locateName($path) === false) {
                    recursiveCopy($baseRoot . '/' . $path, $newRoot . '/' . $path);
                }
            }
        }

        // Extract new files from zip
        $zip->extractTo($newRoot);

        // Store modified paths
        $modifiedPaths = [];
        for ($i = 0; $i < $zip->numFiles; $i++){
            $modifiedPaths[] = $zip->getNameIndex($i);
        }
        file_put_contents('/tmp/.bref-live-modified.json', implode(PHP_EOL, $modifiedPaths));

        $zip->close();
    }

}
