<?php
/**
 * Preview HTML for crawlers that do not run this single-page app.
 * .htaccess sends those user agents here. Everyone else still gets index.html.
 *
 * The response is index.html with the title, description, and image the app
 * would set for the same URL. Posts, comments, profiles, and subspace pages
 * are filled from the Hive API.
 */

declare(strict_types=1);

ini_set("display_errors", "0");

if (PHP_SAPI === "cli") {
    foreach (["REQUEST_URI", "HTTP_HOST", "HTTPS", "HTTP_X_FORWARDED_PROTO"] as $key) {
        $value = getenv($key);
        if ($value !== false && $value !== "") {
            $_SERVER[$key] = $value;
        }
    }
}

const CS77_NODES = [
    "https://api.hive.blog",
    "https://api.openhive.network",
    "https://api.deathwing.me",
];

const CS77_ABBREV = [
    "mr" => true, "mrs" => true, "ms" => true, "mz" => true, "dr" => true,
    "prof" => true, "sr" => true, "jr" => true, "vs" => true, "etc" => true,
    "eg" => true, "ie" => true, "st" => true, "fig" => true, "al" => true,
    "ed" => true, "vol" => true, "pp" => true, "ca" => true, "approx" => true,
    "dept" => true, "inc" => true, "ltd" => true, "co" => true,
];

function cs77_origin(): string
{
    $host = (string)($_SERVER["HTTP_HOST"] ?? "cyberspace77.com");
    $host = str_replace(["\r", "\n", " "], "", $host);
    if ($host === "" || !preg_match("/^[A-Za-z0-9.:_-]+$/", $host)) {
        $host = "cyberspace77.com";
    }
    $local = (bool)preg_match("/^(localhost|127\\.0\\.0\\.1|\\[::1\\])(?::\\d+)?$/i", $host);
    $https = !$local;
    if (!empty($_SERVER["HTTPS"]) && $_SERVER["HTTPS"] !== "off") {
        $https = true;
    }
    $forwarded = strtolower((string)($_SERVER["HTTP_X_FORWARDED_PROTO"] ?? ""));
    if ($forwarded === "https") {
        $https = true;
    } elseif ($forwarded === "http" && $local) {
        $https = false;
    }
    if ((string)($_SERVER["SERVER_PORT"] ?? "") === "443") {
        $https = true;
    }
    return ($https ? "https" : "http") . "://" . $host;
}

function cs77_request_uri(): string
{
    $uri = (string)($_SERVER["REQUEST_URI"] ?? "/");
    return $uri === "" ? "/" : $uri;
}

function cs77_request_path(): string
{
    $path = parse_url(cs77_request_uri(), PHP_URL_PATH);
    if (!is_string($path) || $path === "") {
        $path = "/";
    }
    $decoded = rawurldecode($path);
    return $decoded === "" ? "/" : $decoded;
}

function cs77_request_fragment(): string
{
    $frag = parse_url(cs77_request_uri(), PHP_URL_FRAGMENT);
    if (!is_string($frag) || $frag === "") {
        return "";
    }
    $decoded = rawurldecode($frag);
    return $decoded === "" ? $frag : $decoded;
}

function cs77_fragment_comment(string $fragment): array
{
    if (!preg_match("/^@([a-z0-9.\\-]{3,16})\\/([^\\s#?]+)/i", $fragment, $match)) {
        return ["author" => "", "permlink" => ""];
    }
    return ["author" => strtolower($match[1]), "permlink" => $match[2]];
}

function cs77_one_line(string $text): string
{
    $text = preg_replace("/\\s+/u", " ", $text);
    return trim(is_string($text) ? $text : "");
}

function cs77_absolute_url(string $url, string $origin): string
{
    $url = trim($url);
    if ($url === "") {
        return "";
    }
    if (preg_match("#^https?://#i", $url)) {
        return $url;
    }
    if (strpos($url, "//") === 0) {
        return "https:" . $url;
    }
    if (isset($url[0]) && $url[0] === "/") {
        return $origin . $url;
    }
    return $origin . "/" . $url;
}

function cs77_is_community_name(string $raw): bool
{
    return (bool)preg_match("/^hive-\\d+$/i", trim($raw));
}

function cs77_community_name(string $raw): string
{
    $name = strtolower(trim($raw));
    $name = preg_replace("/^@/", "", $name);
    $name = preg_replace("/^c\\//i", "", (string)$name);
    $name = (string)$name;
    return cs77_is_community_name($name) ? $name : "";
}

function cs77_community_from_token(string $raw): string
{
    $named = cs77_community_name($raw);
    if ($named !== "") {
        return $named;
    }
    $token = trim($raw);
    if (!preg_match("/^\\d+$/", $token)) {
        return "";
    }
    return cs77_community_name("hive-" . $token);
}

function cs77_community_page(string $raw): string
{
    $page = strtolower(trim($raw));
    if ($page === "" || $page === "created" || $page === "latest") {
        return "latest";
    }
    if ($page === "trending" || $page === "hot") {
        return $page;
    }
    if ($page === "about") {
        return "about";
    }
    if ($page === "members" || $page === "roles") {
        return "members";
    }
    if ($page === "edit") {
        return "edit";
    }
    return "";
}

function cs77_profile_page(string $raw): string
{
    $page = strtolower(trim($raw));
    if ($page === "" || $page === "posts" || $page === "blog") {
        return "posts";
    }
    if ($page === "comments" || $page === "replies" || $page === "wallet") {
        return $page;
    }
    return "";
}

function cs77_route_tag(string $raw): string
{
    $tag = strtolower(trim($raw));
    $tag = preg_replace("/^#/", "", $tag);
    $tag = (string)$tag;
    if ($tag === "" || strlen($tag) > 24) {
        return "";
    }
    if (!preg_match("/^[a-z0-9][a-z0-9-]*$/", $tag)) {
        return "";
    }
    return $tag;
}

function cs77_route(string $pathname): array
{
    $path = $pathname;
    $parts = array_values(array_filter(explode("/", $path), function ($part) {
        return $part !== "";
    }));
    if (isset($parts[0]) && strcasecmp($parts[0], "index.html") === 0) {
        array_shift($parts);
    }
    $route = [
        "name" => "notfound",
        "sort" => "",
        "tag" => "",
        "author" => "",
        "permlink" => "",
        "page" => "",
        "community" => "",
    ];
    if (count($parts) === 0) {
        $route["name"] = "feed";
        $route["sort"] = "latest";
        return $route;
    }
    $first = strtolower($parts[0]);
    if (count($parts) === 1 && $first === "publish") {
        $route["name"] = "publish";
        return $route;
    }
    if (count($parts) === 1 && $first === "spaces") {
        $route["name"] = "tags";
        return $route;
    }
    if ($first === "subspaces") {
        if (count($parts) === 1) {
            $route["name"] = "communities";
            $route["page"] = "search";
            return $route;
        }
        if (count($parts) === 2) {
            $page = strtolower($parts[1]);
            if ($page === "search" || $page === "browse" || $page === "newest") {
                $route["name"] = "communities";
                $route["page"] = $page;
                return $route;
            }
        }
        return $route;
    }
    if (count($parts) === 1 && ($first === "welcome" || $first === "about" || $first === "imprint")) {
        $route["name"] = $first;
        return $route;
    }
    if ($first === "settings") {
        if (count($parts) === 1) {
            $route["name"] = "settings";
            $route["page"] = "general";
            return $route;
        }
        if (count($parts) === 2) {
            $page = strtolower($parts[1]);
            if ($page === "general" || $page === "profile" || $page === "nodes") {
                $route["name"] = "settings";
                $route["page"] = $page;
                return $route;
            }
        }
        return $route;
    }
    if ($first === "search") {
        if (count($parts) === 1) {
            $route["name"] = "search";
            $route["page"] = "users";
            return $route;
        }
        if (count($parts) === 2) {
            $page = strtolower($parts[1]);
            if ($page === "users" || $page === "spaces" || $page === "subspaces") {
                $route["name"] = "search";
                $route["page"] = $page;
                return $route;
            }
        }
        return $route;
    }
    if ($first === "c" && count($parts) >= 2) {
        $community = cs77_community_name($parts[1]);
        if ($community === "") {
            return $route;
        }
        if (count($parts) === 2) {
            $route["name"] = "community";
            $route["community"] = $community;
            $route["page"] = "latest";
            return $route;
        }
        if (count($parts) === 3) {
            $page = cs77_community_page($parts[2]);
            if ($page !== "") {
                $route["name"] = "community";
                $route["community"] = $community;
                $route["page"] = $page;
                return $route;
            }
        }
        return $route;
    }
    if ($first === "subspace") {
        if (count($parts) < 2 || count($parts) > 3) {
            return $route;
        }
        $community = cs77_community_from_token($parts[1]);
        if ($community === "") {
            return $route;
        }
        $page = count($parts) === 2 ? "latest" : cs77_community_page($parts[2]);
        if ($page === "") {
            return $route;
        }
        $route["name"] = "community";
        $route["community"] = $community;
        $route["page"] = $page;
        return $route;
    }
    $sort = "";
    if ($first === "created" || $first === "latest") {
        $sort = "latest";
    } elseif ($first === "space" && count($parts) >= 2) {
        $sort = "latest";
    } elseif ($first === "feed") {
        $sort = "feed";
    } elseif ($first === "trending" || $first === "hot") {
        $sort = $first;
    }
    if ($sort !== "") {
        if (count($parts) === 1) {
            $route["name"] = "feed";
            $route["sort"] = $sort;
            return $route;
        }
        if (count($parts) === 2 && $sort !== "feed") {
            $tag = cs77_route_tag($parts[1]);
            if ($tag !== "") {
                $community = cs77_community_name($tag);
                if ($community !== "") {
                    $route["name"] = "community";
                    $route["community"] = $community;
                    $route["page"] = $sort;
                    return $route;
                }
                $route["name"] = "feed";
                $route["sort"] = $sort;
                $route["tag"] = $tag;
                return $route;
            }
        }
        return $route;
    }
    if (preg_match("/^\\d+$/", $first) && count($parts) <= 2) {
        $community = cs77_community_from_token($first);
        $page = count($parts) === 1 ? "latest" : cs77_community_page($parts[1]);
        if ($community !== "" && $page !== "") {
            $route["name"] = "community";
            $route["community"] = $community;
            $route["page"] = $page;
            return $route;
        }
    }
    $at = -1;
    foreach ($parts as $index => $part) {
        if (isset($part[0]) && $part[0] === "@") {
            $at = $index;
            break;
        }
    }
    if ($at >= 0) {
        $author = strtolower(substr($parts[$at], 1));
        if (!preg_match("/^[a-z0-9.\\-]{3,16}$/", $author)) {
            return $route;
        }
        if ($at === 0 && count($parts) <= 2) {
            if (count($parts) === 1) {
                $route["name"] = "profile";
                $route["author"] = $author;
                $route["page"] = "posts";
                return $route;
            }
            $page = cs77_profile_page($parts[1]);
            if ($page !== "") {
                $route["name"] = "profile";
                $route["author"] = $author;
                $route["page"] = $page;
                return $route;
            }
        }
        $permlink = $parts[$at + 1] ?? "";
        if ($permlink !== "") {
            $route["name"] = "post";
            $route["author"] = $author;
            $route["permlink"] = $permlink;
            return $route;
        }
        $route["name"] = "profile";
        $route["author"] = $author;
        $route["page"] = "posts";
        return $route;
    }
    return $route;
}

function cs77_is_missing_hive($error): bool
{
    if (is_string($error)) {
        $text = $error;
    } else {
        $encoded = json_encode($error, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $text = is_string($encoded) ? $encoded : "";
    }
    return (bool)preg_match(
        "/account does not exist|invalid account name|\\bpost\\b[^\\n]{0,240}does not exist|community name is not valid|community does not exist|unknown community/i",
        $text
    );
}

function cs77_hive(string $method, array $params): array
{
    $payload = json_encode([
        "jsonrpc" => "2.0",
        "method" => $method,
        "params" => $params,
        "id" => 1,
    ]);
    if (!is_string($payload)) {
        return ["state" => "error"];
    }
    foreach (CS77_NODES as $node) {
        $body = cs77_http_post($node, $payload);
        if ($body === null) {
            continue;
        }
        $decoded = json_decode($body, true);
        if (!is_array($decoded)) {
            continue;
        }
        if (array_key_exists("error", $decoded)) {
            // Hivemind puts the real reason in assertion_expression. error.message
            // is only "Assert Exception", which is also used for other failures.
            if (cs77_is_missing_hive($decoded["error"])) {
                return ["state" => "missing"];
            }
            continue;
        }
        if (!array_key_exists("result", $decoded) || $decoded["result"] === null) {
            return ["state" => "missing"];
        }
        return ["state" => "ok", "result" => $decoded["result"]];
    }
    return ["state" => "error"];
}

function cs77_http_post(string $url, string $payload): ?string
{
    if (function_exists("curl_init")) {
        $ch = curl_init($url);
        if ($ch === false) {
            return null;
        }
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $payload,
            CURLOPT_HTTPHEADER => ["Content-Type: application/json", "Accept: application/json"],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 5,
            CURLOPT_CONNECTTIMEOUT => 3,
            CURLOPT_USERAGENT => "CyberSpace77-crawler/1.0",
        ]);
        $body = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        if (!is_string($body) || $body === "" || $code < 200 || $code >= 300) {
            return null;
        }
        return $body;
    }
    $context = stream_context_create([
        "http" => [
            "method" => "POST",
            "header" => "Content-Type: application/json\r\nAccept: application/json\r\nUser-Agent: CyberSpace77-crawler/1.0\r\n",
            "content" => $payload,
            "timeout" => 5,
            "ignore_errors" => true,
        ],
    ]);
    $body = @file_get_contents($url, false, $context);
    return is_string($body) && $body !== "" ? $body : null;
}

function cs77_profile_info($profile): array
{
    if (!is_array($profile)) {
        return [];
    }
    $meta = $profile["metadata"] ?? ($profile["posting_json_metadata"] ?? []);
    if (is_string($meta)) {
        $decoded = json_decode($meta, true);
        $meta = is_array($decoded) ? $decoded : [];
    }
    if (!is_array($meta)) {
        return [];
    }
    $info = (isset($meta["profile"]) && is_array($meta["profile"])) ? $meta["profile"] : [];
    return $info;
}

function cs77_profile_about($profile): string
{
    if (!is_array($profile)) {
        return "";
    }
    $info = cs77_profile_info($profile);
    $about = (string)($info["about"] ?? ($profile["about"] ?? ""));
    return trim($about);
}

function cs77_profile_image($profile): string
{
    if (!is_array($profile)) {
        return "";
    }
    $info = cs77_profile_info($profile);
    $image = trim((string)($info["profile_image"] ?? ""));
    if ($image !== "") {
        return $image;
    }
    return trim((string)($profile["profile_image"] ?? ""));
}

function cs77_account_image(string $account): string
{
    $name = strtolower(trim($account));
    if ($name === "") {
        return "";
    }
    $loaded = cs77_hive("bridge.get_profile", [
        "account" => $name,
        "observer" => "",
    ]);
    if ($loaded["state"] !== "ok" || !is_array($loaded["result"])) {
        return "";
    }
    return cs77_profile_image($loaded["result"]);
}

function cs77_json_meta($raw): array
{
    if (is_string($raw)) {
        $decoded = json_decode($raw, true);
        $raw = is_array($decoded) ? $decoded : [];
    }
    return is_array($raw) ? $raw : [];
}

function cs77_post_authored_description($post): string
{
    if (!is_array($post)) {
        return "";
    }
    $meta = cs77_json_meta($post["json_metadata"] ?? []);
    $description = $meta["description"] ?? "";
    if (!is_string($description)) {
        return "";
    }
    return trim($description);
}

function cs77_is_comment($post): bool
{
    if (!is_array($post)) {
        return false;
    }
    if (trim((string)($post["parent_author"] ?? "")) !== "") {
        return true;
    }
    return (int)($post["depth"] ?? 0) > 0;
}

function cs77_replied_title($comment, string $articleTitle): string
{
    if (is_array($comment)) {
        $root = trim((string)($comment["root_title"] ?? ""));
        if ($root !== "") {
            return $root;
        }
    }
    if ($articleTitle !== "") {
        return $articleTitle;
    }
    $title = trim((string)(is_array($comment) ? ($comment["title"] ?? "") : ""));
    $stripped = preg_replace("/^(?:re:\\s*)+/i", "", $title);
    $stripped = trim(is_string($stripped) ? $stripped : "");
    if ($stripped !== "") {
        return $stripped;
    }
    return $title !== "" ? $title : "Post";
}

function cs77_comment_heading(string $author, string $postTitle): string
{
    $subject = $postTitle !== "" ? $postTitle : "Post";
    return "@" . $author . " replied to: " . $subject . " — CyberSpace77";
}

function cs77_fetch_post(string $author, string $permlink): array
{
    $loaded = cs77_hive("bridge.get_post", [
        "author" => $author,
        "permlink" => $permlink,
        "observer" => "",
    ]);
    $post = [];
    $state = $loaded["state"];
    if ($state === "ok" && is_array($loaded["result"])) {
        $post = $loaded["result"];
        if (trim((string)($post["author"] ?? "")) === "") {
            $post = [];
            $state = "missing";
        }
    }
    return ["state" => $state, "post" => $post];
}

function cs77_comment_page($comment, string $articleTitle): array
{
    $author = trim((string)($comment["author"] ?? ""));
    $image = cs77_post_image($comment);
    if ($image === "") {
        $image = cs77_account_image($author);
    }
    if ($image === "") {
        $image = "/assets/satoshi.png";
    }
    return [
        "title" => cs77_comment_heading($author, cs77_replied_title($comment, $articleTitle)),
        "description" => cs77_post_description((string)($comment["body"] ?? "")),
        "image" => $image,
    ];
}

function cs77_post_image($post): string
{
    if (!is_array($post)) {
        return "";
    }
    $meta = cs77_json_meta($post["json_metadata"] ?? []);
    $list = $meta["image"] ?? [];
    if (!is_array($list)) {
        return "";
    }
    foreach ($list as $item) {
        if (is_string($item) && trim($item) !== "") {
            return trim($item);
        }
    }
    return "";
}

function cs77_chars(string $text): array
{
    static $cachedKey = null;
    static $cached = [];
    if ($cachedKey === $text) {
        return $cached;
    }
    if (function_exists("mb_str_split")) {
        $chars = mb_str_split($text, 1, "UTF-8");
    } else {
        $chars = preg_split("//u", $text, -1, PREG_SPLIT_NO_EMPTY);
    }
    $cachedKey = $text;
    $cached = is_array($chars) ? $chars : [];
    return $cached;
}

function cs77_char_len(string $text): int
{
    return count(cs77_chars($text));
}

function cs77_char_at(string $text, int $index): string
{
    if ($index < 0) {
        return "";
    }
    $chars = cs77_chars($text);
    return $chars[$index] ?? "";
}

function cs77_char_slice(string $text, int $start, ?int $end = null): string
{
    $chars = cs77_chars($text);
    $len = count($chars);
    if ($start < 0) {
        $start = 0;
    }
    if ($end === null || $end > $len) {
        $end = $len;
    }
    if ($end < $start) {
        return "";
    }
    return implode("", array_slice($chars, $start, $end - $start));
}

function cs77_is_decimal_dot(string $text, int $index): bool
{
    return (bool)preg_match("/\\d/u", cs77_char_at($text, $index - 1))
        && (bool)preg_match("/\\d/u", cs77_char_at($text, $index + 1));
}

function cs77_is_abbrev_dot(string $text, int $index): bool
{
    $j = $index - 1;
    while ($j >= 0 && preg_match("/[A-Za-z]/", cs77_char_at($text, $j))) {
        $j--;
    }
    $word = cs77_char_slice($text, $j + 1, $index);
    if ($word === "") {
        return false;
    }
    if (cs77_char_len($word) === 1) {
        return true;
    }
    if (strtolower($word) === "no") {
        $k = $index + 1;
        $len = cs77_char_len($text);
        while ($k < $len && preg_match("/\\s/u", cs77_char_at($text, $k))) {
            $k++;
        }
        return (bool)preg_match("/\\d/u", cs77_char_at($text, $k));
    }
    return isset(CS77_ABBREV[strtolower($word)]);
}

function cs77_first_sentence_end(string $text): int
{
    $len = cs77_char_len($text);
    for ($i = 0; $i < $len; $i++) {
        $ch = cs77_char_at($text, $i);
        if ($ch !== "." && $ch !== "!" && $ch !== "?" && $ch !== "…" && $ch !== "。" && $ch !== "！" && $ch !== "？") {
            continue;
        }
        $next = cs77_char_at($text, $i + 1);
        if (($ch === "." || $ch === "!" || $ch === "?") && preg_match("/[.!?]/u", $next)) {
            continue;
        }
        if ($ch === "." && (cs77_is_decimal_dot($text, $i) || cs77_is_abbrev_dot($text, $i))) {
            continue;
        }
        $end = $i + 1;
        while ($end < $len && preg_match("/['\"”’)\\\]]/u", cs77_char_at($text, $end))) {
            $end++;
        }
        $after = cs77_char_at($text, $end);
        if (preg_match("/[。！？…]/u", $ch) || $end >= $len || preg_match("/\\s/u", $after)) {
            return $end;
        }
    }
    return -1;
}

function cs77_clip_excerpt(string $text): string
{
    $limit = 280;
    $src = preg_replace("/^\\s+/u", "", $text);
    $src = is_string($src) ? $src : "";
    if ($src === "") {
        return "";
    }
    $sentence = cs77_first_sentence_end($src);
    if ($sentence > 0 && $sentence <= $limit) {
        $cut = cs77_char_slice($src, 0, $sentence);
        $cut = preg_replace("/[ \\t]+$/u", "", $cut);
        return is_string($cut) ? $cut : "";
    }
    if (cs77_char_len($src) <= $limit) {
        $cut = preg_replace("/\\s+$/u", "", $src);
        return is_string($cut) ? $cut : "";
    }
    $end = $limit - 1;
    $slice = $end > 0 ? cs77_char_slice($src, 0, $end) : "";
    $next = cs77_char_at($src, $end);
    $last = cs77_char_at($slice, cs77_char_len($slice) - 1);
    if ($slice !== "" && $next !== "" && !preg_match("/\\s/u", $next) && !preg_match("/\\s/u", $last)) {
        $trimmed = preg_replace("/\\s+\\S*$/u", "", $slice);
        if (is_string($trimmed) && preg_match("/\\S/u", $trimmed)) {
            $slice = $trimmed;
        }
    }
    $slice = preg_replace("/[\\s\\x{00a0}]+$/u", "", $slice);
    $slice = is_string($slice) ? $slice : "";
    if ($slice === "") {
        return "…";
    }
    return $slice . "…";
}

function cs77_strip_fenced_code(string $src): string
{
    $lines = preg_split("/\\n/", $src);
    if (!is_array($lines)) {
        return $src;
    }
    $out = [];
    $inFence = false;
    $mark = "";
    $len = 0;
    foreach ($lines as $line) {
        if (preg_match("/^[ \\t]{0,3}(`{3,}|~{3,})/", $line, $open)) {
            $ch = $open[1][0];
            if (!$inFence) {
                $inFence = true;
                $mark = $ch;
                $len = strlen($open[1]);
                continue;
            }
            if ($ch === $mark && strlen($open[1]) >= $len) {
                $inFence = false;
                $mark = "";
                $len = 0;
                continue;
            }
        }
        if (!$inFence) {
            $out[] = $line;
        }
    }
    return implode("\n", $out);
}

function cs77_strip_html(string $src): string
{
    $s = $src;
    $s = preg_replace("/<!--[\\s\\S]*?-->/", " ", $s);
    $s = preg_replace("/<(https?:\\/\\/[^>\\s]+)>/i", "$1", (string)$s);
    $s = preg_replace("/<(script|style|iframe|object|embed|svg|math|noscript|template|textarea|noembed|noframes|canvas|form)\\b[^>]*>[\\s\\S]*?<\\/\\1>/i", " ", (string)$s);
    $s = preg_replace("/<(script|style|iframe|object|embed|svg|math|noscript|template|textarea|noembed|noframes|canvas|form)\\b[^>]*\\/?>/i", " ", (string)$s);
    $s = preg_replace("/<pre\\b[^>]*>[\\s\\S]*?<\\/pre>/i", "\n", (string)$s);
    $s = preg_replace("/<img\\b[^>]*>/i", " ", (string)$s);
    $s = preg_replace("/<hr\\b[^>]*\\/?>/i", "\n", (string)$s);
    $s = preg_replace("/<br\\b[^>]*\\/?>/i", "\n", (string)$s);
    $s = preg_replace("/<\\/(p|h[1-6]|blockquote|ul|ol|table|pre|figure|address)>/i", "\n\n", (string)$s);
    $s = preg_replace("/<\\/(div|li|tr|section|header|footer|center|caption|figcaption|article)>/i", "\n", (string)$s);
    $s = preg_replace("/<\\/t[dh]>/i", " ", (string)$s);
    $s = preg_replace("/<\\/?[a-z][a-z0-9:-]*\\b[^>]*>/i", "", (string)$s);
    $s = html_entity_decode((string)$s, ENT_QUOTES | ENT_HTML5, "UTF-8");
    return $s;
}

function cs77_strip_markdown(string $src): string
{
    $s = $src;
    $s = preg_replace("/!\\[[^\\]]*\\]\\([^)]*\\)/", " ", $s);
    $s = preg_replace("/!\\[[^\\]]*\\]\\[[^\\]]*\\]/", " ", (string)$s);
    $s = preg_replace("/\\[([^\\]]*)\\]\\([^)]*\\)/", "$1", (string)$s);
    $s = preg_replace("/\\[([^\\]]+)\\]\\[[^\\]]*\\]/", "$1", (string)$s);
    $s = preg_replace("/`{1,3}([^`]*)`{1,3}/", "$1", (string)$s);
    $s = preg_replace("/\\[\\^[^\\]]+\\]/", "", (string)$s);
    $s = preg_replace("/(\\*\\*|__)(.*?)\\1/s", "$2", (string)$s);
    $s = preg_replace("/(?<![A-Za-z0-9])[*_](?![\\s*_])(.+?)(?<![\\s*_])[*_](?![A-Za-z0-9])/s", "$1", (string)$s);
    $s = str_replace(["**", "__", "~~"], "", (string)$s);
    $s = preg_replace("/^[ \\t]{0,3}#{1,6}(?:[ \\t]+|$)/m", "", (string)$s);
    $s = preg_replace("/^[ \\t]{0,3}(?:>[ \\t]*)+/m", "", (string)$s);
    $s = preg_replace("/^[ \\t]{0,3}(?:[-*+]|\\d{1,9}[.)])[ \\t]+/m", "", (string)$s);
    $s = preg_replace("/^[ \\t]{0,3}(?:(?:\\*[ \\t]*){3,}|(?:-[ \\t]*){3,}|(?:_[ \\t]*){3,})[ \\t]*$/m", " ", (string)$s);
    return (string)$s;
}

function cs77_strip_plain_urls(string $src): string
{
    $out = preg_replace_callback("/https?:\\/\\/[^\\s<]+/i", function ($match) {
        $url = $match[0];
        $trail = "";
        while ($url !== "") {
            $ch = substr($url, -1);
            if ($ch === "]" || $ch === "}" || $ch === '"' || $ch === "'" || $ch === "”" || $ch === "’") {
                $trail = $ch . $trail;
                $url = substr($url, 0, -1);
                continue;
            }
            break;
        }
        return $trail === "" ? " " : $trail;
    }, $src);
    return is_string($out) ? $out : $src;
}

function cs77_post_description(string $body): string
{
    $text = str_replace(["\r\n", "\r"], "\n", $body);
    $inner = "!(?:worldmappin|pinmapple)\\s+(-?\\d+(?:\\.\\d+)?)\\s+lat\\s+(-?\\d+(?:\\.\\d+)?)\\s+long\\s*(.*?)\\s*d3scr";
    $text = preg_replace("/\\[\\/\\/\\]:\\s*#\\s*\\(" . $inner . "\\)/i", " ", $text);
    $text = preg_replace("/<!--\\s*" . $inner . "\\s*-->/i", " ", (string)$text);
    $text = preg_replace("/" . $inner . "/i", " ", (string)$text);
    $text = cs77_strip_fenced_code((string)$text);
    $text = cs77_strip_html($text);
    $text = cs77_strip_markdown($text);
    $text = cs77_strip_plain_urls($text);
    $text = str_replace(["\xC2\xA0"], " ", $text);
    $text = preg_replace("/[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]/", "", $text);
    $text = cs77_one_line((string)$text);
    return cs77_one_line(cs77_clip_excerpt($text));
}

function cs77_profile_title(string $author, string $page): string
{
    $name = "@" . $author;
    if ($page === "comments") {
        return "Comments · " . $name . " — CyberSpace77";
    }
    if ($page === "replies") {
        return "Replies · " . $name . " — CyberSpace77";
    }
    if ($page === "wallet") {
        return "Wallet · " . $name . " — CyberSpace77";
    }
    return $name . " — CyberSpace77";
}

function cs77_community_title($info, string $name, string $page): string
{
    $title = "";
    if (is_array($info) && isset($info["title"]) && trim((string)$info["title"]) !== "") {
        $title = trim((string)$info["title"]);
    }
    if ($title === "") {
        $title = $name;
    }
    if ($page === "about") {
        return "About · " . $title . " — CyberSpace77";
    }
    if ($page === "members") {
        return "Members · " . $title . " — CyberSpace77";
    }
    if ($page === "edit") {
        return "Edit · " . $title . " — CyberSpace77";
    }
    return $title . " — CyberSpace77";
}

function cs77_page(array $route): array
{
    $title = "Not found — CyberSpace77";
    $description = "";
    $image = "";
    $exactDescription = false;
    $name = $route["name"];
    if ($name === "feed") {
        if ($route["tag"] !== "") {
            $title = "#" . $route["tag"] . " — CyberSpace77";
        } elseif ($route["sort"] === "feed") {
            $title = "Feed — CyberSpace77";
        } else {
            $title = "CyberSpace77";
        }
    } elseif ($name === "tags") {
        $title = "Spaces — CyberSpace77";
    } elseif ($name === "communities") {
        $title = "Subspaces — CyberSpace77";
    } elseif ($name === "welcome") {
        $title = "CyberSpace77";
    } elseif ($name === "about") {
        $title = "About — CyberSpace77";
    } elseif ($name === "settings") {
        $title = "Settings — CyberSpace77";
    } elseif ($name === "search") {
        $title = "Search — CyberSpace77";
    } elseif ($name === "imprint") {
        $title = "Imprint — CyberSpace77";
    } elseif ($name === "publish") {
        $title = "Publish — CyberSpace77";
    } elseif ($name === "profile") {
        $title = cs77_profile_title($route["author"], $route["page"] !== "" ? $route["page"] : "posts");
        $loaded = cs77_hive("bridge.get_profile", [
            "account" => $route["author"],
            "observer" => "",
        ]);
        if ($loaded["state"] === "missing") {
            $title = "Not found — CyberSpace77";
        } elseif ($loaded["state"] === "ok") {
            $profile = $loaded["result"];
            if (!is_array($profile) || trim((string)($profile["name"] ?? "")) === "") {
                $title = "Not found — CyberSpace77";
            } else {
                $description = cs77_profile_about($profile);
                $exactDescription = true;
                $image = cs77_profile_image($profile);
                if ($image === "") {
                    $image = "/assets/satoshi.png";
                }
            }
        }
    } elseif ($name === "community") {
        $loaded = cs77_hive("bridge.get_community", [
            "name" => $route["community"],
            "observer" => "",
        ]);
        if ($loaded["state"] === "missing") {
            $title = "Not found — CyberSpace77";
        } elseif ($loaded["state"] === "ok" && is_array($loaded["result"]) && trim((string)($loaded["result"]["name"] ?? "")) !== "") {
            $info = $loaded["result"];
            $title = cs77_community_title($info, $route["community"], $route["page"] !== "" ? $route["page"] : "latest");
            $description = trim((string)($info["about"] ?? ""));
            $exactDescription = true;
            $image = cs77_account_image($route["community"]);
        } else {
            $title = cs77_community_title(null, $route["community"], $route["page"] !== "" ? $route["page"] : "latest");
        }
    } elseif ($name === "post") {
        $title = "Post — CyberSpace77";
        $loadedPost = cs77_fetch_post($route["author"], $route["permlink"]);
        $post = $loadedPost["post"];
        if ($loadedPost["state"] === "missing") {
            $title = "Not found — CyberSpace77";
        } elseif ($post !== []) {
            $fragment = cs77_fragment_comment(cs77_request_fragment());
            $anchored = [];
            if ($fragment["author"] !== "" && !(
                strcasecmp($fragment["author"], (string)$post["author"]) === 0
                && (string)$fragment["permlink"] === (string)$post["permlink"]
            )) {
                $anchored = cs77_fetch_post($fragment["author"], $fragment["permlink"])["post"];
            }
            if ($anchored !== [] && cs77_is_comment($anchored)) {
                $articleTitle = cs77_is_comment($post) ? "" : trim((string)($post["title"] ?? ""));
                $commentPage = cs77_comment_page($anchored, $articleTitle);
                $title = $commentPage["title"];
                $description = $commentPage["description"];
                $image = $commentPage["image"];
            } elseif (cs77_is_comment($post)) {
                $commentPage = cs77_comment_page($post, "");
                $title = $commentPage["title"];
                $description = $commentPage["description"];
                $image = $commentPage["image"];
            } else {
                $author = trim((string)($post["author"] ?? ""));
                $postTitle = trim((string)($post["title"] ?? ""));
                $title = ($postTitle !== "" ? $postTitle : "Post") . " — CyberSpace77";
                $authored = cs77_post_authored_description($post);
                $description = $authored !== ""
                    ? $authored
                    : cs77_post_description((string)($post["body"] ?? ""));
                $image = cs77_post_image($post);
                if ($image === "") {
                    $image = cs77_account_image($author);
                }
                if ($image === "") {
                    $image = "/assets/satoshi.png";
                }
            }
        }
    }
    return [
        "title" => $title,
        "description" => cs77_one_line($description),
        "image" => $image,
        "exact_description" => $exactDescription,
    ];
}

function cs77_attr(string $html, string $attr, string $key): string
{
    $pattern = "/<meta\\s+" . preg_quote($attr, "/") . "=\"" . preg_quote($key, "/") . "\"\\s+content=\"([^\"]*)\"/i";
    if (!preg_match($pattern, $html, $match)) {
        return "";
    }
    return html_entity_decode($match[1], ENT_QUOTES | ENT_HTML5, "UTF-8");
}

function cs77_escape(string $text): string
{
    return htmlspecialchars($text, ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML5, "UTF-8");
}

function cs77_replace_meta(string $html, string $attr, string $key, string $content): string
{
    $tag = "<meta " . $attr . "=\"" . $key . "\" content=\"" . cs77_escape($content) . "\">";
    $pattern = "/<meta\\s+" . preg_quote($attr, "/") . "=\"" . preg_quote($key, "/") . "\"\\s+content=\"[^\"]*\"\\s*\\/?>/i";
    $next = preg_replace($pattern, $tag, $html, 1, $count);
    if (!is_string($next) || $count !== 1) {
        return str_replace("</head>", "  " . $tag . "\n</head>", $html);
    }
    return $next;
}

function cs77_apply(string $html, array $page, string $origin): string
{
    $defaultDescription = cs77_attr($html, "name", "description");
    if ($defaultDescription === "") {
        $defaultDescription = "Own your voice. Create, earn, and connect without censorship, gatekeepers, and algos.";
    }
    $defaultImage = cs77_attr($html, "property", "og:image");
    if ($defaultImage === "") {
        $defaultImage = "/assets/cyberspace77.jpg";
    }
    $description = !empty($page["exact_description"])
        ? $page["description"]
        : ($page["description"] !== "" ? $page["description"] : $defaultDescription);
    $image = cs77_absolute_url($page["image"] !== "" ? $page["image"] : $defaultImage, $origin);
    $title = $page["title"] !== "" ? $page["title"] : "CyberSpace77";
    $html = preg_replace("/<title>.*?<\\/title>/s", "<title>" . cs77_escape($title) . "</title>", $html, 1);
    if (!is_string($html)) {
        return "";
    }
    $html = cs77_replace_meta($html, "name", "description", $description);
    $html = cs77_replace_meta($html, "property", "og:title", $title);
    $html = cs77_replace_meta($html, "property", "og:description", $description);
    $html = cs77_replace_meta($html, "property", "og:image", $image);
    return $html;
}

$htmlPath = __DIR__ . DIRECTORY_SEPARATOR . "index.html";
$html = @file_get_contents($htmlPath);
if (!is_string($html) || $html === "") {
    if (PHP_SAPI !== "cli") {
        http_response_code(500);
        header("Content-Type: text/plain; charset=utf-8");
    }
    echo "index.html is missing\n";
    exit;
}

$page = cs77_page(cs77_route(cs77_request_path()));
$rendered = cs77_apply($html, $page, cs77_origin());
if (PHP_SAPI !== "cli") {
    header("Content-Type: text/html; charset=utf-8");
    header("Vary: User-Agent");
}
echo $rendered;
