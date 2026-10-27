<?php
/**
 * Incoming resource-credit names.
 * Hive does not index who delegated RC to an account. PeakD does, and it
 * rejects browser calls that send an Origin header, so this same-origin
 * endpoint fetches the list. server.py handles the same path itself.
 */

declare(strict_types=1);

ini_set("display_errors", "0");

const CS77_RC_LIMIT = 2097152;

function cs77_rc_fail(int $status, string $message): void
{
    http_response_code($status);
    header("Content-Type: application/json; charset=utf-8");
    header("Cache-Control: no-store");
    echo json_encode(["error" => $message], JSON_UNESCAPED_UNICODE);
    exit;
}

$name = strtolower(ltrim(trim((string)($_GET["delegatee"] ?? "")), "@"));
if (!preg_match("/^[a-z][a-z0-9.\\-]{1,14}[a-z0-9]$/", $name)) {
    cs77_rc_fail(400, "Enter a hive username.");
}

$url = "https://peakd.com/api/public/rc_delegations/incoming?delegatee=" . rawurlencode($name);
$body = null;
$code = 0;

if (function_exists("curl_init")) {
    $ch = curl_init($url);
    if ($ch !== false) {
        curl_setopt_array($ch, [
            CURLOPT_HTTPGET => true,
            CURLOPT_HTTPHEADER => ["Accept: application/json"],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 20,
            CURLOPT_CONNECTTIMEOUT => 8,
            CURLOPT_USERAGENT => "CyberSpace77",
            CURLOPT_FOLLOWLOCATION => false,
        ]);
        $fetched = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        if (is_string($fetched)) {
            $body = $fetched;
        }
    }
}

if (!is_string($body) || $body === "") {
    $context = stream_context_create([
        "http" => [
            "method" => "GET",
            "header" => "Accept: application/json\r\nUser-Agent: CyberSpace77\r\n",
            "timeout" => 20,
            "ignore_errors" => true,
            "follow_location" => 0,
        ],
    ]);
    $fetched = @file_get_contents($url, false, $context);
    if (is_string($fetched)) {
        $body = $fetched;
        $code = 200;
        foreach ($http_response_header ?? [] as $header) {
            if (preg_match("/^HTTP\\/\\S+\\s+(\\d+)/", $header, $match)) {
                $code = (int)$match[1];
            }
        }
    }
}

if (!is_string($body) || $body === "" || $code !== 200 || strlen($body) > CS77_RC_LIMIT) {
    cs77_rc_fail(502, "Incoming resource credits could not be loaded.");
}

$parsed = json_decode($body, true);
$isList = is_array($parsed) && ($parsed === [] || array_keys($parsed) === range(0, count($parsed) - 1));
if (!$isList) {
    cs77_rc_fail(502, "Incoming resource credits could not be loaded.");
}

header("Content-Type: application/json; charset=utf-8");
header("Cache-Control: no-store");
echo $body;
