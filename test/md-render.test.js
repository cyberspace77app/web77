/**
 * Exact-output fixtures for js/md-render.js.
 * Run: node test/md-render.test.js [inline|block|html|publish]
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const file = path.join(root, "js", "md-render.js");

function loadRender() {
  if (!fs.existsSync(file)) {
    console.error("missing js/md-render.js");
    process.exit(1);
  }
  const sandbox = { console: console, window: {}, URL: URL };
  sandbox.window.window = sandbox.window;
  sandbox.globalThis = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
  const render = sandbox.window.Markdown && sandbox.window.Markdown.render;
  if (typeof render !== "function") {
    console.error("Markdown.render is missing");
    process.exit(1);
  }
  return render;
}

function caseOf(name, source, html) {
  return { name: name, source: source, html: html };
}

const groups = {
  inline: [
    caseOf("italic", "*italic*", "<p><em>italic</em></p>\n"),
    caseOf("bold", "**bold**", "<p><strong>bold</strong></p>\n"),
    caseOf("both", "***both***", "<p><strong><em>both</em></strong></p>\n"),
    caseOf("underscore italic", "_italic_", "<p><em>italic</em></p>\n"),
    caseOf("underscore bold", "__bold__", "<p><strong>bold</strong></p>\n"),
    caseOf("strike", "~~strike~~", "<p><del>strike</del></p>\n"),
    caseOf(
      "nested emphasis",
      "**bold *and* italic**",
      "<p><strong>bold <em>and</em> italic</strong></p>\n"
    ),
    caseOf("unmatched star", "*asterisk", "<p>*asterisk</p>\n"),
    caseOf("four stars then text", "****a", "<p><strong></strong>a</p>\n"),
    caseOf("unpaired underscores", "_a _b", "<p>_a _b</p>\n"),
    caseOf("snake case", "snake_case", "<p>snake_case</p>\n"),
    caseOf("intra-word underscores", "already_italic_word", "<p>already_italic_word</p>\n"),
    caseOf("intra-word stars", "*intra*word*", "<p><em>intra</em>word*</p>\n"),
    caseOf("code span", "`code`", "<p><code>code</code></p>\n"),
    caseOf("code span keeps stars", "`*stars*`", "<p><code>*stars*</code></p>\n"),
    caseOf("code span one newline", "`line\ntwo`", "<p><code>line\ntwo</code></p>\n"),
    caseOf("unmatched backtick", "`oops", "<p>`oops</p>\n"),
    caseOf(
      "link",
      "[label](https://example.com)",
      '<p><a href="https://example.com">label</a></p>\n'
    ),
    caseOf(
      "link bold title",
      '[**bold**](https://example.com "title")',
      '<p><a href="https://example.com" title="title"><strong>bold</strong></a></p>\n'
    ),
    caseOf("unsafe link", "[text](javascript:alert(1))", "<p>text</p>\n"),
    caseOf(
      "balanced parens",
      "[wiki](https://en.wikipedia.org/wiki/Markdown_(markup))",
      '<p><a href="https://en.wikipedia.org/wiki/Markdown_(markup)">wiki</a></p>\n'
    ),
    caseOf("mailto link", "[mail](mailto:a@b.c)", '<p><a href="mailto:a@b.c">mail</a></p>\n'),
    caseOf("fragment link", "[top](#top)", '<p><a href="#top">top</a></p>\n'),
    caseOf("relative link", "[link text](url)", '<p><a href="url">link text</a></p>\n'),
    caseOf(
      "image in sentence",
      "see ![alt](https://example.com/a.jpg) here",
      '<p>see <img src="https://example.com/a.jpg" alt="alt"> here</p>\n'
    ),
    caseOf(
      "image alt with brackets",
      "see ![PINGU [C__Users_Victor's PC]](https://example.com/a.jpg) here",
      '<p>see <img src="https://example.com/a.jpg" alt="PINGU [C__Users_Victor&#39;s PC]"> here</p>\n'
    ),
    caseOf(
      "image alt bracket is not a link",
      "![a] not [b](https://example.com)",
      '<p>![a] not <a href="https://example.com">b</a></p>\n'
    ),
    caseOf(
      "angle url",
      "<https://example.com>",
      '<p><a href="https://example.com">https://example.com</a></p>\n'
    ),
    caseOf("angle mailto", "<mailto:a@b.c>", '<p><a href="mailto:a@b.c">a@b.c</a></p>\n'),
    caseOf(
      "bare url stays text",
      "https://youtu.be/abcdefghijk",
      "<p>https://youtu.be/abcdefghijk</p>\n"
    ),
    caseOf("www stays text", "www.example.com", "<p>www.example.com</p>\n"),
    caseOf("email stays text", "user@example.com", "<p>user@example.com</p>\n"),
    caseOf(
      "entities",
      "a &amp; b &nbsp; c &#160; d &#x2014; e & f",
      "<p>a &amp; b &nbsp; c &#160; d &#x2014; e &amp; f</p>\n"
    ),
    caseOf("raw less-than", "1 < 2", "<p>1 &lt; 2</p>\n"),
    caseOf("escaped stars", "\\*not italic\\*", "<p>*not italic*</p>\n"),
    caseOf("mention stays text", "@user", "<p>@user</p>\n"),
    caseOf("hashtag stays text", "#hive", "<p>#hive</p>\n"),
    caseOf("not a shortcut link", "[text]", "<p>[text]</p>\n"),
    caseOf(
      "link label with brackets",
      "[Title [EN-ES]](https://example.com)",
      '<p><a href="https://example.com">Title [EN-ES]</a></p>\n'
    ),
    caseOf(
      "footnote brackets",
      "[[3]](/@smooth/post)",
      '<p><a href="/@smooth/post">[3]</a></p>\n'
    ),
    caseOf(
      "escaped brackets in a label",
      "[a \\[b\\]](https://example.com)",
      '<p><a href="https://example.com">a [b]</a></p>\n'
    ),
    caseOf(
      "emphasis spans a link",
      "_see [a](https://example.com) now_",
      '<p><em>see <a href="https://example.com">a</a> now</em></p>\n'
    ),
    caseOf(
      "emphasis spans several links",
      "_Report ([Android](https://bit.ly/actifit-app) | [iOS](https://bit.ly/actifit-ios))._",
      '<p><em>Report (<a href="https://bit.ly/actifit-app">Android</a> | <a href="https://bit.ly/actifit-ios">iOS</a>).</em></p>\n'
    ),
    caseOf(
      "bold spans an inline tag",
      "**<u>We are alive</u>**",
      "<p><strong><u>We are alive</u></strong></p>\n"
    ),
  ],
  block: [
    caseOf("paragraph", "hello", "<p>hello</p>\n"),
    caseOf("soft break", "a\nb", "<p>a<br>b</p>\n"),
    caseOf("crlf", "a\r\nb", "<p>a<br>b</p>\n"),
    caseOf("blank line", "a\n\nb", "<p>a</p>\n<p>b</p>\n"),
    caseOf("atx", "## heading", "<h2>heading</h2>\n"),
    caseOf("atx closing hashes", "## heading ##", "<h2>heading</h2>\n"),
    caseOf("hash without space", "#hive", "<p>#hive</p>\n"),
    caseOf(
      "heading inline",
      "## *em* and [a](https://example.com)",
      '<h2><em>em</em> and <a href="https://example.com">a</a></h2>\n'
    ),
    caseOf("setext h1", "Title\n===", "<h1>Title</h1>\n"),
    caseOf("setext h2", "Title\n---", "<h2>Title</h2>\n"),
    caseOf("hr dashes", "---", "<hr>\n"),
    caseOf("hr stars", "***", "<hr>\n"),
    caseOf("hr spaced", "* * *", "<hr>\n"),
    caseOf("text then hr", "Text\n***", "<p>Text</p>\n<hr>\n"),
    caseOf("tight list", "- a\n- b", "<ul>\n<li>a</li>\n<li>b</li>\n</ul>\n"),
    caseOf("loose list", "- a\n\n- b", "<ul>\n<li><p>a</p></li>\n<li><p>b</p></li>\n</ul>\n"),
    caseOf(
      "nested list",
      "- a\n  - b",
      "<ul>\n<li>a<ul>\n<li>b</li>\n</ul>\n</li>\n</ul>\n"
    ),
    caseOf("list continuation", "- item\n    more", "<ul>\n<li>item<br>more</li>\n</ul>\n"),
    caseOf(
      "lazy list continuation",
      "1. The Death of the Lifetime Guarantee\nToday, roughly 40% of workers change jobs.",
      "<ol>\n<li>The Death of the Lifetime Guarantee<br>Today, roughly 40% of workers change jobs.</li>\n</ol>\n"
    ),
    caseOf(
      "blank line ends a list",
      "1. Item\n\nNext",
      "<ol>\n<li>Item</li>\n</ol>\n<p>Next</p>\n"
    ),
    caseOf(
      "fence interrupts a list",
      "- item\n```\ncode\n```",
      "<ul>\n<li>item</li>\n</ul>\n<pre><code>code\n</code></pre>\n"
    ),
    caseOf(
      "fence inside a list item",
      "- item\n  ```js\n  for await () {}\n  ```\n- next",
      "<ul>\n<li><p>item</p>\n<pre><code>for await () {}\n</code></pre></li>\n<li>next</li>\n</ul>\n"
    ),
    caseOf("ol start", "3. c", '<ol start="3">\n<li>c</li>\n</ol>\n'),
    caseOf("ol paren", "1) a", "<ol>\n<li>a</li>\n</ol>\n"),
    caseOf("star italic is not a list", "*italic*", "<p><em>italic</em></p>\n"),
    caseOf(
      "task list",
      "- [ ] item\n- [x] done\n- [X] also",
      "<ul>\n<li>item</li>\n<li>done</li>\n<li>also</li>\n</ul>\n"
    ),
    caseOf("quote", "> text", "<blockquote>\n<p>text</p>\n</blockquote>\n"),
    caseOf(
      "quote lines",
      "> outer\n> still",
      "<blockquote>\n<p>outer<br>still</p>\n</blockquote>\n"
    ),
    caseOf(
      "nested quote",
      "> > inner",
      "<blockquote>\n<blockquote>\n<p>inner</p>\n</blockquote>\n</blockquote>\n"
    ),
    caseOf(
      "lazy quote",
      "> quote\ncontinues",
      "<blockquote>\n<p>quote<br>continues</p>\n</blockquote>\n"
    ),
    caseOf(
      "quote heading",
      "> ## Title",
      "<blockquote>\n<h2>Title</h2>\n</blockquote>\n"
    ),
    caseOf(
      "fence",
      "```\ncode\n```",
      "<pre><code>code\n</code></pre>\n"
    ),
    caseOf(
      "fence info ignored",
      "```js\ncode\n```",
      "<pre><code>code\n</code></pre>\n"
    ),
    caseOf(
      "fence escapes",
      "```\n<tag>\n```",
      "<pre><code>&lt;tag&gt;\n</code></pre>\n"
    ),
    caseOf(
      "fence keeps markdown",
      "```\n*not italic*\n```",
      "<pre><code>*not italic*\n</code></pre>\n"
    ),
    caseOf(
      "longer fence",
      "````\n```\ncode\n```\n````",
      "<pre><code>```\ncode\n```\n</code></pre>\n"
    ),
    caseOf("tilde fence", "~~~\ncode\n~~~", "<pre><code>code\n</code></pre>\n"),
    caseOf("unclosed fence", "```\nno close", "<pre><code>no close</code></pre>\n"),
    caseOf("indented code", "    code\n", "<pre><code>code\n</code></pre>\n"),
    caseOf("indented code escapes", "    a < b\n", "<pre><code>a &lt; b\n</code></pre>\n"),
    caseOf(
      "indented html stays code",
      "    <img src=\"https://example.com/a.jpg\">\n",
      "<pre><code>&lt;img src=\"https://example.com/a.jpg\"&gt;\n</code></pre>\n"
    ),
    caseOf(
      "table align",
      "| a | b |\n| --- | :---: |\n| *em* | x |",
      "<table>\n<thead>\n<tr>\n<th>a</th>\n<th align=\"center\">b</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td><em>em</em></td>\n<td align=\"center\">x</td>\n</tr>\n</tbody>\n</table>\n"
    ),
    caseOf(
      "reference link",
      "see [text][label]\n\n[label]: https://example.com",
      '<p>see <a href="https://example.com">text</a></p>\n'
    ),
    caseOf(
      "collapsed reference",
      "[text][]\n\n[text]: https://example.com",
      '<p><a href="https://example.com">text</a></p>\n'
    ),
    caseOf("empty", "", ""),
  ],
  html: [
    caseOf("center inline", "<center>*text*</center>", "<center><em>text</em></center>\n"),
    caseOf(
      "same-line sibling",
      "<div>Hello</div> *italic*",
      "<div>Hello</div> <em>italic</em>\n"
    ),
    caseOf(
      "center paragraphs",
      "<center>one\n\ntwo</center>",
      "<center><p>one</p>\n<p>two</p>\n</center>\n"
    ),
    caseOf(
      "sup url stays text",
      "<sup>see https://example.com/a</sup>",
      "<p><sup>see https://example.com/a</sup></p>\n"
    ),
    caseOf("sup digit", "km<sup>2</sup>", "<p>km<sup>2</sup></p>\n"),
    caseOf(
      "cell emphasis",
      "<table><tr><td>*em*</td></tr></table>",
      "<table><tr><td><em>em</em></td></tr></table>\n"
    ),
    caseOf("pre raw", "<pre>*nope*</pre>", "<pre>*nope*</pre>\n"),
    caseOf(
      "code tag raw",
      "say <code>*nope*</code> now",
      "<p>say <code>*nope*</code> now</p>\n"
    ),
    caseOf(
      "image then caption",
      "![alt](https://example.com/a.jpg)\n*caption*",
      '<img src="https://example.com/a.jpg" alt="alt">\n<p><em>caption</em></p>\n'
    ),
    caseOf(
      "linked image line",
      "[![alt](https://example.com/a.jpg)](https://example.com/)",
      '<a href="https://example.com/"><img src="https://example.com/a.jpg" alt="alt"></a>\n'
    ),
    caseOf(
      "bracketed image line",
      "![PINGU [C__Users_Victor]](https://example.com/a.jpg)",
      '<img src="https://example.com/a.jpg" alt="PINGU [C__Users_Victor]">\n'
    ),
    caseOf(
      "indented html inside a cell",
      "<table><tr><td>\n    <img src=\"https://example.com/a.jpg\">\n    <h3>Hello</h3>\n</td></tr></table>",
      "<table><tr><td><img src=\"https://example.com/a.jpg\">\n<h3>Hello</h3>\n</td></tr></table>\n"
    ),
    caseOf(
      "hr then italic",
      "---\n*Posted via Lumen*",
      "<hr>\n<p><em>Posted via Lumen</em></p>\n"
    ),
    caseOf(
      "emphasis does not cross tags",
      "<b>*not</b> italic*",
      "<p><b>*not</b> italic*</p>\n"
    ),
    caseOf(
      "comment does not swallow",
      "<!-- secret -->\n*yes*",
      "<!-- secret -->\n<p><em>yes</em></p>\n"
    ),
    caseOf(
      "comment inside paragraph",
      "a <!-- secret --> b",
      "<p>a <!-- secret --> b</p>\n"
    ),
    caseOf(
      "details summary",
      "<details><summary>*open*</summary>\n\nbody</details>",
      "<details><summary><em>open</em></summary>\n<p>body</p>\n</details>\n"
    ),
    caseOf(
      "unclosed div",
      "<div class= 'text-justify'>\n\nHello",
      "<div class= 'text-justify'>Hello</div>\n"
    ),
    caseOf(
      "unclosed div keeps later paragraphs",
      "<div>Hello\n\nthere",
      "<div><p>Hello</p>\n<p>there</p>\n</div>\n"
    ),
    caseOf(
      "unclosed sub",
      "<center><sub>All photographs</center>",
      "<center><sub>All photographs</sub></center>\n"
    ),
    caseOf("typo tag stays text", "<cente>Hello", "<p>&lt;cente&gt;Hello</p>\n"),
    caseOf("unclosed script stays text", "<script>alert(1)", "<p>&lt;script&gt;alert(1)</p>\n"),
    caseOf(
      "actifit activity pre",
      '<div class="text-center"><pre><b>Walking, Daily Activity</b></div></pre></div>',
      '<div class="text-center"><pre><b>Walking, Daily Activity</b></div></pre>\n</div>\n'
    ),
    caseOf(
      "div close inside script stays in the script",
      "<div><script>alert('</div>')</script>after</div>",
      "<div><script>alert('</div>')</script>after\n</div>\n"
    ),
    caseOf(
      "image inside an anchor",
      '<a href="https://example.com">![jeanjean.png](https://example.com/a.png)</a>',
      '<a href="https://example.com"><img src="https://example.com/a.png" alt="jeanjean.png"></a>\n'
    ),
    caseOf(
      "emphasis inside an anchor",
      '<a href="https://example.com">*hi*</a>',
      '<a href="https://example.com"><em>hi</em></a>\n'
    ),
    caseOf(
      "unclosed anchor stays text",
      '<a href="https://example.com">hello',
      '<p>&lt;a href="https://example.com"&gt;hello</p>\n'
    ),
  ],
  publish: [
    caseOf("menu heading", "## heading", "<h2>heading</h2>\n"),
    caseOf("menu bold", "**bold**", "<p><strong>bold</strong></p>\n"),
    caseOf("menu italic", "*italic*", "<p><em>italic</em></p>\n"),
    caseOf("menu strike", "~~strike~~", "<p><del>strike</del></p>\n"),
    caseOf("menu quote", "> quote", "<blockquote>\n<p>quote</p>\n</blockquote>\n"),
    caseOf("menu link", "[link text](url)", '<p><a href="url">link text</a></p>\n'),
    caseOf(
      "menu image",
      "![alt text](https://example.com/a.jpg)",
      '<img src="https://example.com/a.jpg" alt="alt text">\n'
    ),
    caseOf("unsafe image dropped", "![alt text](url)", ""),
    caseOf("menu code", "`code`", "<p><code>code</code></p>\n"),
    caseOf("menu fence", "```\ncode\n```", "<pre><code>code\n</code></pre>\n"),
    caseOf(
      "menu table",
      "|column1|column2|column3|\n|-|-|-|\n|content1|content2|content3|",
      "<table>\n<thead>\n<tr>\n<th>column1</th>\n<th>column2</th>\n<th>column3</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>content1</td>\n<td>content2</td>\n<td>content3</td>\n</tr>\n</tbody>\n</table>\n"
    ),
    caseOf(
      "menu video html",
      '<video controls>\n<source src="self-hosted video url">\n</video>',
      '<video controls>\n<source src="self-hosted video url">\n</video>\n'
    ),
  ],
};

const want = process.argv[2];
if (want && !groups[want]) {
  console.error("unknown group " + want);
  process.exit(1);
}

const render = loadRender();
const names = want ? [want] : Object.keys(groups);
let passed = 0;
let failed = 0;

names.forEach(function (group) {
  groups[group].forEach(function (item) {
    let actual;
    try {
      actual = render(item.source);
    } catch (err) {
      failed++;
      console.error("FAIL " + group + " / " + item.name);
      console.error("threw " + (err && err.stack ? err.stack : err));
      return;
    }
    if (actual !== item.html) {
      failed++;
      console.error("FAIL " + group + " / " + item.name);
      console.error("SOURCE\n" + JSON.stringify(item.source));
      console.error("EXPECTED\n" + JSON.stringify(item.html));
      console.error("ACTUAL\n" + JSON.stringify(actual));
      return;
    }
    passed++;
  });
});

console.log(passed + " passed, " + failed + " failed");
if (failed) process.exit(1);
