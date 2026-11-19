/**
 * Markdown to HTML. String in, string out. No DOM.
 * Posts use breaks (a single newline is <br>), GFM tables and strike,
 * and raw HTML that still parses inside. Bare URLs stay text.
 * Emphasis can span a link or an inline tag. A known tag with no close
 * runs to the end of its container. A list item keeps one unindented
 * continuation line, and an indented fence or heading inside it is a block.
 * An image alt or a link label may contain balanced [brackets]. Inside a
 * raw HTML tag, indented lines are not code blocks. A four-space line is
 * a code block only at the start or after a blank line. A nested tag is
 * closed before an outer tag takes a mismatched close, and a closed
 * <a> parses the markdown inside it. An unmatched close of a known tag
 * is dropped. Unknown tags stay text.
 */
(function (global) {
  "use strict";

  var ESCAPE_CHARS = {
    "\\": 1, "`": 1, "*": 1, _: 1, "{": 1, "}": 1, "[": 1, "]": 1,
    "(": 1, ")": 1, "#": 1, "+": 1, "-": 1, ".": 1, "!": 1, "|": 1,
    ">": 1, "~": 1,
  };

  var INLINE_TAGS = {
    span: 1, font: 1, sup: 1, sub: 1, b: 1, i: 1, u: 1, s: 1, strike: 1,
    small: 1, big: 1, mark: 1, tt: 1, em: 1, strong: 1, del: 1, ins: 1,
    cite: 1, abbr: 1, q: 1,
  };

  var BLOCK_TAGS = {
    center: 1, div: 1, p: 1, blockquote: 1, figure: 1, figcaption: 1,
    td: 1, th: 1, li: 1, caption: 1, h1: 1, h2: 1, h3: 1, h4: 1, h5: 1, h6: 1,
    section: 1, article: 1, header: 1, footer: 1, aside: 1, address: 1,
    details: 1, summary: 1, dd: 1, dt: 1,
  };

  var SKIP_TAGS = { pre: 1, code: 1, script: 1, style: 1, textarea: 1 };

  var VOID_TAGS = {
    hr: 1, br: 1, img: 1, source: 1, col: 1, link: 1, meta: 1, input: 1,
    wbr: 1, area: 1, base: 1, embed: 1, param: 1, track: 1,
  };

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeText(s) {
    return String(s).replace(/[&<>]/g, function (ch, index, str) {
      if (ch === "<") return "&lt;";
      if (ch === ">") return "&gt;";
      var rest = str.slice(index);
      if (/^&(?:[A-Za-z][A-Za-z0-9]+|#[0-9]+|#x[0-9A-Fa-f]+);/.test(rest)) return "&";
      return "&amp;";
    });
  }

  function isSafePostUrl(value, kind) {
    var v = String(value == null ? "" : value).trim();
    if (!v || /[\u0000-\u001F\u007F]/.test(v)) return false;
    if (/^https?:\/\//i.test(v)) {
      try {
        var u = new URL(v);
        return u.protocol === "http:" || u.protocol === "https:";
      } catch (err) {
        return false;
      }
    }
    if (kind === "src" || kind === "poster") return false;
    if (/^mailto:/i.test(v)) return kind === "href";
    if (v.charAt(0) === "#") return true;
    if (v.slice(0, 2) === "//" || v.slice(0, 2) === "/\\" || v.charAt(0) === "\\") return false;
    if (/^data:text\/plain,[0-9a-f]{64}$/i.test(v)) return kind === "href";
    if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return false;
    return true;
  }

  function unescapeMd(s) {
    return String(s || "").replace(/\\(.)/g, "$1");
  }

  function skipMdWs(s, i) {
    while (i < s.length && (s.charAt(i) === " " || s.charAt(i) === "\t" || s.charAt(i) === "\n" || s.charAt(i) === "\r")) i++;
    return i;
  }

  function parseMdDestination(s, i) {
    i = skipMdWs(s, i);
    if (i >= s.length) return null;
    if (s.charAt(i) === "<") {
      var j = i + 1;
      while (j < s.length && s.charAt(j) !== ">" && s.charAt(j) !== "\n") {
        if (s.charAt(j) === "\\" && j + 1 < s.length) j += 2;
        else j++;
      }
      if (s.charAt(j) !== ">") return null;
      var angled = unescapeMd(s.slice(i + 1, j)).trim();
      return angled ? { url: angled, next: j + 1 } : null;
    }
    var k = i;
    var depth = 0;
    while (k < s.length) {
      var c = s.charAt(k);
      if (c === "\\" && k + 1 < s.length) {
        k += 2;
        continue;
      }
      if (c === " " || c === "\t" || c === "\n" || c === "\r") break;
      if (c === "(") {
        depth++;
        k++;
        continue;
      }
      if (c === ")") {
        if (depth === 0) break;
        depth--;
        k++;
        continue;
      }
      k++;
    }
    if (k === i) return null;
    var url = unescapeMd(s.slice(i, k)).trim();
    return url ? { url: url, next: k } : null;
  }

  function parseMdTitle(s, i) {
    var start = skipMdWs(s, i);
    if (start >= s.length) return { title: "", next: i };
    var q = s.charAt(start);
    if (q !== '"' && q !== "'" && q !== "(") return { title: "", next: i };
    var close = q === "(" ? ")" : q;
    var j = start + 1;
    while (j < s.length) {
      if (s.charAt(j) === "\\" && j + 1 < s.length) {
        j += 2;
        continue;
      }
      if (s.charAt(j) === close) return { title: unescapeMd(s.slice(start + 1, j)), next: j + 1 };
      if (s.charAt(j) === "\n") return { title: "", next: i };
      j++;
    }
    return { title: "", next: i };
  }

  function parseMarkdownImageAt(s, i) {
    if (s.charAt(i) !== "!" || s.charAt(i + 1) !== "[") return null;
    var j = i + 2;
    var alt = "";
    var depth = 0;
    while (j < s.length) {
      if (s.charAt(j) === "\\" && j + 1 < s.length) {
        alt += s.charAt(j + 1);
        j += 2;
        continue;
      }
      if (s.charAt(j) === "\n") return null;
      if (s.charAt(j) === "[") {
        depth++;
        alt += "[";
        j++;
        continue;
      }
      if (s.charAt(j) === "]") {
        if (depth === 0) break;
        depth--;
        alt += "]";
        j++;
        continue;
      }
      alt += s.charAt(j);
      j++;
    }
    if (s.charAt(j) !== "]") return null;
    j++;
    if (s.charAt(j) !== "(") return null;
    j++;
    var dest = parseMdDestination(s, j);
    if (!dest) return null;
    j = dest.next;
    var title = parseMdTitle(s, j);
    j = title.next;
    j = skipMdWs(s, j);
    if (s.charAt(j) !== ")") return null;
    return { alt: alt, url: dest.url, title: title.title, start: i, end: j + 1 };
  }

  function parseLinkedMarkdownImageAt(s, i) {
    if (s.charAt(i) !== "[") return null;
    var img = parseMarkdownImageAt(s, i + 1);
    if (!img || s.charAt(img.end) !== "]") return null;
    var j = img.end + 1;
    if (s.charAt(j) !== "(") return null;
    j++;
    var dest = parseMdDestination(s, j);
    if (!dest) return null;
    j = dest.next;
    var title = parseMdTitle(s, j);
    j = title.next;
    j = skipMdWs(s, j);
    if (s.charAt(j) !== ")") return null;
    return { alt: img.alt, url: img.url, title: img.title, href: dest.url, start: i, end: j + 1 };
  }

  function imageHtml(url, alt, title) {
    if (!isSafePostUrl(url, "src")) return "";
    var html = '<img src="' + escapeHtml(url) + '" alt="' + escapeHtml(alt || "") + '"';
    if (title) html += ' title="' + escapeHtml(title) + '"';
    return html + ">";
  }

  function linkedImageHtml(href, url, alt, title) {
    var img = imageHtml(url, alt, title);
    if (!img) return "";
    if (!isSafePostUrl(href, "href")) return img;
    return '<a href="' + escapeHtml(href) + '">' + img + "</a>";
  }

  function anchorHtml(href, inner, title) {
    if (!isSafePostUrl(href, "href")) return inner;
    var html = '<a href="' + escapeHtml(href) + '"';
    if (title) html += ' title="' + escapeHtml(title) + '"';
    return html + ">" + inner + "</a>";
  }

  function parseMarkdownLinkAt(s, i) {
    if (s.charAt(i) !== "[") return null;
    if (i > 0 && s.charAt(i - 1) === "!") return null;
    if (s.charAt(i + 1) === "!" && s.charAt(i + 2) === "[") return null;
    var j = i + 1;
    var text = "";
    var depth = 0;
    while (j < s.length) {
      if (s.charAt(j) === "\\" && j + 1 < s.length) {
        text += s.charAt(j + 1);
        j += 2;
        continue;
      }
      if (s.charAt(j) === "\n") return null;
      if (s.charAt(j) === "[") {
        depth++;
        text += "[";
        j++;
        continue;
      }
      if (s.charAt(j) === "]") {
        if (depth === 0) break;
        depth--;
        text += "]";
        j++;
        continue;
      }
      text += s.charAt(j);
      j++;
    }
    if (s.charAt(j) !== "]") return null;
    j++;
    if (s.charAt(j) !== "(") return null;
    j++;
    var dest = parseMdDestination(s, j);
    if (!dest) return null;
    j = dest.next;
    var title = parseMdTitle(s, j);
    j = title.next;
    j = skipMdWs(s, j);
    if (s.charAt(j) !== ")") return null;
    return { text: text, url: dest.url, title: title.title, end: j + 1 };
  }

  function parseHtmlTagAt(s, i) {
    if (s.charAt(i) !== "<") return null;
    if (s.startsWith("<!--", i) || s.startsWith("<!", i) || s.startsWith("<?", i)) return null;
    var j = i + 1;
    var closing = false;
    if (s.charAt(j) === "/") {
      closing = true;
      j++;
    }
    var nameMatch = /^[A-Za-z][A-Za-z0-9]*/.exec(s.slice(j));
    if (!nameMatch) return null;
    var name = nameMatch[0];
    j += name.length;
    var quote = "";
    var selfClosing = false;
    for (; j < s.length; j++) {
      var ch = s.charAt(j);
      if (quote) {
        if (ch === quote) quote = "";
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        continue;
      }
      if (ch === "/" && s.charAt(j + 1) === ">") {
        selfClosing = true;
        j += 2;
        break;
      }
      if (ch === ">") {
        j++;
        break;
      }
    }
    if (quote || s.charAt(j - 1) !== ">") return null;
    return {
      name: name,
      raw: s.slice(i, j),
      end: j,
      closing: closing,
      selfClosing: selfClosing || !!VOID_TAGS[name.toLowerCase()],
    };
  }

  // One Map per top-level search. A failed nested search used to rescan
  // the same suffix for every unclosed tag (~2^k). The close rules stay
  // the same: skip a nest that does close, and do not skip one that does not.
  function findCloseTag(s, from, name) {
    var memo = new Map();
    function search(start, want) {
      var key = start + "\0" + want;
      if (memo.has(key)) return memo.get(key);
      var i = start;
      var found = null;
      while (i < s.length) {
        if (s.startsWith("<!--", i)) {
          var end = s.indexOf("-->", i + 4);
          i = end < 0 ? s.length : end + 3;
          continue;
        }
        if (s.charAt(i) !== "<") {
          i++;
          continue;
        }
        var tag = parseHtmlTagAt(s, i);
        if (!tag) {
          i++;
          continue;
        }
        var tagName = tag.name.toLowerCase();
        if (tag.closing && tagName === want) {
          found = { start: i, end: tag.end, raw: tag.raw };
          break;
        }
        // Skip a nested element that does close, so a </div> inside
        // <pre>…</pre> cannot end the div that wraps that pre.
        // An unclosed nest is not skipped: <script> must not swallow the post.
        if (!tag.closing && !tag.selfClosing) {
          var nested = search(tag.end, tagName);
          if (nested) {
            i = nested.end;
            continue;
          }
        }
        i = tag.end;
      }
      memo.set(key, found);
      return found;
    }
    return search(from, name.toLowerCase());
  }

  function readCodeSpan(s, i) {
    var n = 0;
    while (s.charAt(i + n) === "`") n++;
    if (!n) return null;
    var j = i + n;
    var newlines = 0;
    while (j < s.length) {
      if (s.charAt(j) === "\n") {
        newlines++;
        if (newlines > 1) return null;
        j++;
        continue;
      }
      if (s.charAt(j) !== "`") {
        j++;
        continue;
      }
      var k = 0;
      while (s.charAt(j + k) === "`") k++;
      if (k === n) return { text: s.slice(i + n, j), end: j + k };
      j += k;
    }
    return null;
  }

  function isWord(ch) {
    var c = ch ? ch.charCodeAt(0) : 0;
    return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
  }

  function readRun(s, i, ch) {
    var n = 0;
    while (s.charAt(i + n) === ch) n++;
    return n;
  }

  // miss[ch][len] is the earliest index from which this mark and length have
  // no closer through the end of s. A later opener on the same string skips
  // that scan. The pairing rules stay the same.
  function findCloser(s, from, ch, len, miss) {
    var slot = miss[ch];
    if (slot && slot[len] >= 0 && from >= slot[len]) return -1;
    var j = from;
    while (j < s.length) {
      if (s.charAt(j) !== ch) {
        j++;
        continue;
      }
      var n = readRun(s, j, ch);
      if (n === len) {
        if (ch === "_" && isWord(s.charAt(j + n))) {
          j += n;
          continue;
        }
        return j;
      }
      j += n;
    }
    if (slot && (slot[len] < 0 || from < slot[len])) slot[len] = from;
    return -1;
  }

  function wrapDelim(len, inner) {
    if (len >= 3) return "<strong><em>" + inner + "</em></strong>";
    if (len === 2) return "<strong>" + inner + "</strong>";
    return "<em>" + inner + "</em>";
  }

  function emphasize(s) {
    var out = "";
    var i = 0;
    var miss = { "*": [-1, -1, -1, -1], _: [-1, -1, -1, -1] };
    while (i < s.length) {
      var c = s.charAt(i);
      if (c !== "*" && c !== "_" && c !== "~") {
        var j = i + 1;
        while (j < s.length) {
          var d = s.charAt(j);
          if (d === "*" || d === "_" || d === "~") break;
          j++;
        }
        out += escapeText(s.slice(i, j));
        i = j;
        continue;
      }
      if (c === "~") {
        if (s.charAt(i + 1) === "~") {
          var close = s.indexOf("~~", i + 2);
          if (close >= 0) {
            out += "<del>" + emphasize(s.slice(i + 2, close)) + "</del>";
            i = close + 2;
            continue;
          }
        }
        out += "~";
        i++;
        continue;
      }
      var run = readRun(s, i, c);
      if (c === "_" && isWord(s.charAt(i - 1)) && isWord(s.charAt(i + run))) {
        out += s.slice(i, i + run);
        i += run;
        continue;
      }
      var matched = false;
      var len = run > 3 ? 3 : run;
      while (len >= 1) {
        var closer = findCloser(s, i + len, c, len, miss);
        if (closer >= 0) {
          out += wrapDelim(len, emphasize(s.slice(i + len, closer)));
          i = closer + len;
          matched = true;
          break;
        }
        len--;
      }
      if (!matched) {
        out += s.slice(i, i + run);
        i += run;
      }
    }
    return out;
  }

  // Links, images, code, and tags are one placeholder so emphasis markers
  // on either side still pair. The placeholder is not a word character.
  var INLINE_SLOT = "\u0001";

  function emphasizePieces(pieces) {
    var flat = "";
    var htmls = [];
    for (var i = 0; i < pieces.length; i++) {
      if (pieces[i].html) {
        flat += INLINE_SLOT;
        htmls.push(pieces[i].html);
      } else if (pieces[i].text) {
        flat += pieces[i].text;
      }
    }
    var html = emphasize(flat);
    var n = 0;
    return html.replace(/\u0001/g, function () {
      var chunk = htmls[n] || "";
      n++;
      return chunk;
    });
  }

  function composeInline(parts) {
    if (!parts.length) return "";
    var lines = [];
    var current = [];
    function breakLine() {
      lines.push(current);
      current = [];
    }
    for (var p = 0; p < parts.length; p++) {
      var part = parts[p];
      if (part.html) {
        current.push(part);
        continue;
      }
      var bits = part.text.split("\n");
      for (var b = 0; b < bits.length; b++) {
        if (b) breakLine();
        if (bits[b]) current.push({ text: bits[b] });
      }
    }
    lines.push(current);
    var out = "";
    for (var i = 0; i < lines.length; i++) {
      if (i) out += "<br>";
      if (lines[i].length) out += emphasizePieces(lines[i]);
    }
    return out;
  }

  function parseAutolink(s, i) {
    var m = /^<(https?:\/\/[^>\s]+|mailto:[^>\s]+)>/i.exec(s.slice(i));
    if (!m) return null;
    var dest = m[1];
    if (!isSafePostUrl(/^mailto:/i.test(dest) ? dest : dest, "href")) return null;
    var label = /^mailto:/i.test(dest) ? dest.replace(/^mailto:/i, "") : dest;
    return {
      html: '<a href="' + escapeHtml(dest) + '">' + escapeText(label) + "</a>",
      end: i + m[0].length,
    };
  }

  function parseRefLink(s, i, defs) {
    var m = /^\[([^\]]+)\]\[([^\]]*)\]/.exec(s.slice(i));
    if (!m) return null;
    var key = (m[2] || m[1]).toLowerCase();
    if (!defs || !defs[key]) return null;
    return {
      html: anchorHtml(defs[key], renderInline(m[1], defs), ""),
      end: i + m[0].length,
    };
  }

  function finishElement(src, tag, defs) {
    var name = tag.name.toLowerCase();
    if (tag.selfClosing) return { html: tag.raw, end: tag.end };
    var close = findCloseTag(src, tag.end, tag.name);
    var inner;
    var end;
    var closeRaw;
    if (close) {
      inner = src.slice(tag.end, close.start);
      end = close.end;
      closeRaw = close.raw;
    } else if (BLOCK_TAGS[name] || INLINE_TAGS[name]) {
      // A missing close keeps the element open through this container.
      // Unknown names, typos, and raw skips still fail so the "<" is text.
      inner = src.slice(tag.end);
      end = src.length;
      closeRaw = "</" + name + ">";
    } else {
      return null;
    }
    var html;
    if (SKIP_TAGS[name]) {
      html = tag.raw + inner + closeRaw;
    } else if (BLOCK_TAGS[name]) {
      html = tag.raw + unwrapSingleParagraph(renderBlocks(inner, defs, true)) + closeRaw;
    } else if (INLINE_TAGS[name] || name === "a") {
      // <a> is not a styling tag: an unclosed one stays text. A closed
      // one parses its label, so ![alt](url) inside the anchor is an image.
      html = tag.raw + renderInline(inner, defs) + closeRaw;
    } else {
      html = tag.raw + renderMixed(inner, defs) + closeRaw;
    }
    return { html: html, end: end };
  }

  function renderMixed(src, defs) {
    var out = "";
    var i = 0;
    while (i < src.length) {
      if (src.startsWith("<!--", i)) {
        var end = src.indexOf("-->", i + 4);
        var to = end < 0 ? src.length : end + 3;
        out += src.slice(i, to);
        i = to;
        continue;
      }
      if (src.charAt(i) !== "<") {
        var next = src.indexOf("<", i);
        var stop = next < 0 ? src.length : next;
        out += src.slice(i, stop);
        i = stop;
        continue;
      }
      var auto = parseAutolink(src, i);
      if (auto) {
        out += auto.html;
        i = auto.end;
        continue;
      }
      var stray = strayCloseEnd(src, i);
      if (stray > i) {
        i = stray;
        continue;
      }
      var tag = parseHtmlTagAt(src, i);
      if (!tag || tag.closing) {
        out += src.charAt(i);
        i++;
        continue;
      }
      var el = finishElement(src, tag, defs);
      if (!el) {
        out += src.charAt(i);
        i++;
        continue;
      }
      out += el.html;
      i = el.end;
    }
    return out;
  }

  function renderInline(src, defs) {
    var parts = [];
    var text = "";
    var i = 0;

    function pushText() {
      if (!text) return;
      parts.push({ text: text });
      text = "";
    }

    function pushHtml(html) {
      pushText();
      if (html) parts.push({ html: html });
    }

    while (i < src.length) {
      var c = src.charAt(i);
      if (c === "\\" && i + 1 < src.length && ESCAPE_CHARS[src.charAt(i + 1)]) {
        pushHtml(escapeText(src.charAt(i + 1)));
        i += 2;
        continue;
      }
      if (c === "`") {
        var span = readCodeSpan(src, i);
        if (span) {
          pushHtml("<code>" + escapeText(span.text) + "</code>");
          i = span.end;
          continue;
        }
      }
      if (c === "!" && src.charAt(i + 1) === "[") {
        var img = parseMarkdownImageAt(src, i);
        if (img) {
          pushHtml(imageHtml(img.url, img.alt, img.title));
          i = img.end;
          continue;
        }
      }
      if (c === "[") {
        var linked = parseLinkedMarkdownImageAt(src, i);
        if (linked) {
          pushHtml(linkedImageHtml(linked.href, linked.url, linked.alt, linked.title));
          i = linked.end;
          continue;
        }
        var link = parseMarkdownLinkAt(src, i);
        if (link) {
          pushHtml(anchorHtml(link.url, renderInline(link.text, defs), link.title));
          i = link.end;
          continue;
        }
        var ref = parseRefLink(src, i, defs);
        if (ref) {
          pushHtml(ref.html);
          i = ref.end;
          continue;
        }
      }
      if (c === "<") {
        if (src.startsWith("<!--", i)) {
          var cend = src.indexOf("-->", i + 4);
          var cto = cend < 0 ? src.length : cend + 3;
          pushHtml(src.slice(i, cto));
          i = cto;
          continue;
        }
        var autoLink = parseAutolink(src, i);
        if (autoLink) {
          pushHtml(autoLink.html);
          i = autoLink.end;
          continue;
        }
        var stray = strayCloseEnd(src, i);
        if (stray > i) {
          i = stray;
          continue;
        }
        var tag = parseHtmlTagAt(src, i);
        if (tag && !tag.closing) {
          var el = finishElement(src, tag, defs);
          if (el) {
            pushHtml(el.html);
            i = el.end;
            continue;
          }
        }
      }
      text += c;
      i++;
    }
    pushText();
    return composeInline(parts);
  }

  function splitLines(src) {
    var lines = [];
    var i = 0;
    while (i < src.length) {
      var nl = src.indexOf("\n", i);
      if (nl < 0) {
        lines.push({ text: src.slice(i), nl: false });
        break;
      }
      lines.push({ text: src.slice(i, nl), nl: true });
      i = nl + 1;
      if (i === src.length) break;
    }
    return lines;
  }

  function joinFrom(lines, index) {
    var s = "";
    for (var k = index; k < lines.length; k++) {
      s += lines[k].text;
      if (lines[k].nl) s += "\n";
    }
    return s;
  }

  function isBlankText(text) {
    return /^[ \t]*$/.test(text);
  }

  function fenceInfo(text) {
    var m = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/.exec(text);
    if (!m) return null;
    return { mark: m[1].charAt(0), len: m[1].length };
  }

  function isFenceClose(text, open) {
    var m = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/.exec(text);
    return !!m && m[1].charAt(0) === open.mark && m[1].length >= open.len;
  }

  function isAtx(text) {
    return /^[ \t]{0,3}#{1,6}(?:[ \t]|$)/.test(text);
  }

  function parseAtx(text) {
    var m = /^[ \t]{0,3}(#{1,6})(?:[ \t]+(.*))?$/.exec(text);
    if (!m) return null;
    if (m[2] == null && text.trim().length !== m[1].length && !/^[ \t]{0,3}#{1,6}[ \t]*$/.test(text)) return null;
    var body = m[2] || "";
    body = body.replace(/[ \t]+$/, "");
    body = body.replace(/[ \t]+#+$/, "");
    body = body.replace(/[ \t]+$/, "");
    return { level: m[1].length, text: body };
  }

  function isThematic(text) {
    return /^[ \t]{0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})[ \t]*$/.test(text);
  }

  function isSetextUnderline(text) {
    return /^[ \t]{0,3}(?:=+|-{3,})[ \t]*$/.test(text);
  }

  function looksLikeSetextText(line) {
    var prev = String(line || "").trim();
    if (!prev) return false;
    if (/[<>]/.test(prev)) return false;
    if (/^(?:-{3,}|\*{3,}|_{3,}|={3,})$/.test(prev)) return false;
    if (/^(?:#{1,6}(?:[ \t]|$)|[-*+][ \t]|\d{1,9}[.)][ \t]|>)/.test(prev)) return false;
    return true;
  }

  function isQuoteLine(text) {
    return /^[ \t]{0,3}>/.test(text);
  }

  function stripQuote(text) {
    return text.replace(/^[ \t]{0,3}>[ \t]?/, "");
  }

  function parseListMarker(text) {
    var m = /^([ \t]*)([-+*]|\d{1,9}[.)])(?:[ \t]+(.*))?$/.exec(text);
    if (!m) return null;
    return { indent: m[1].length, marker: m[2], content: m[3] || "" };
  }

  function isIndentedCodeText(text) {
    return /^ {4}/.test(text) || /^\t/.test(text);
  }

  // A code block does not interrupt a paragraph. At the start of the
  // post, or after a blank line, four spaces are still code.
  function indentedCodeAt(lines, index) {
    if (!isIndentedCodeText(lines[index].text)) return false;
    return index === 0 || isBlankText(lines[index - 1].text);
  }

  function dedentCodeIndent(text) {
    return text.replace(/^(?: {4}|\t)/, "");
  }

  function isKnownTagName(name) {
    var n = String(name || "").toLowerCase();
    return !!(BLOCK_TAGS[n] || INLINE_TAGS[n] || SKIP_TAGS[n] || VOID_TAGS[n] || n === "a");
  }

  // A close with no open element is dropped. The matching close of an
  // open element is consumed before this runs. Unknown names stay text,
  // and the raw text inside pre/code/script is copied through elsewhere.
  function strayCloseEnd(s, i) {
    var tag = parseHtmlTagAt(s, i);
    if (!tag || !tag.closing || !isKnownTagName(tag.name)) return -1;
    return tag.end;
  }

  function isStrayCloseLine(text) {
    var lead = /^[ \t]*/.exec(text);
    var i = lead ? lead[0].length : 0;
    var end = strayCloseEnd(text, i);
    if (end < 0) return false;
    return /^[ \t]*$/.test(text.slice(end));
  }

  function isDefLine(text) {
    return /^[ \t]{0,3}\[[^\]]+\]:[ \t]+\S/.test(text);
  }

  function splitRow(text) {
    var t = String(text || "").trim();
    if (!t || t.indexOf("|") < 0) return null;
    if (t.charAt(0) === "|") t = t.slice(1);
    if (t.charAt(t.length - 1) === "|") t = t.slice(0, -1);
    var cells = t.split("|");
    for (var i = 0; i < cells.length; i++) cells[i] = cells[i].trim();
    return cells;
  }

  function isDelimiterRow(text) {
    var cells = splitRow(text);
    if (!cells || !cells.length) return false;
    for (var i = 0; i < cells.length; i++) {
      if (!/^:?-+:?$/.test(cells[i])) return false;
    }
    return true;
  }

  function alignOf(cell) {
    var left = cell.charAt(0) === ":";
    var right = cell.charAt(cell.length - 1) === ":";
    if (left && right) return "center";
    if (left) return "left";
    if (right) return "right";
    return "";
  }

  function isTableStart(lines, index) {
    if (index + 1 >= lines.length) return false;
    if (!splitRow(lines[index].text)) return false;
    return isDelimiterRow(lines[index + 1].text);
  }

  function imageOnlyHtml(text) {
    var t = String(text || "").trim();
    if (!t) return null;
    var linked = parseLinkedMarkdownImageAt(t, 0);
    if (linked && linked.end === t.length) return linkedImageHtml(linked.href, linked.url, linked.alt, linked.title);
    var img = parseMarkdownImageAt(t, 0);
    if (img && img.end === t.length) return imageHtml(img.url, img.alt, img.title);
    return null;
  }

  function isCommentOnly(text) {
    return /^[ \t]*<!--[\s\S]*-->[ \t]*$/.test(text);
  }

  function blockTagAt(text) {
    var m = /^[ \t]*/.exec(text);
    var i = m ? m[0].length : 0;
    if (text.charAt(i) !== "<") return null;
    if (text.startsWith("<!--", i)) return null;
    if (/^<(?:https?:\/\/[^>\s]+|mailto:[^>\s]+)>/i.test(text.slice(i))) return null;
    var tag = parseHtmlTagAt(text, i);
    if (!tag || tag.closing) return null;
    if (INLINE_TAGS[tag.name.toLowerCase()]) return null;
    return tag;
  }

  function unwrapSingleParagraph(html) {
    var m = /^<p>([\s\S]*)<\/p>\n?$/.exec(html);
    if (!m || /<\/p>/.test(m[1])) return html;
    return m[1];
  }

  function collectDefs(src) {
    var defs = {};
    var lines = String(src || "").split("\n");
    for (var i = 0; i < lines.length; i++) {
      var m = /^[ \t]{0,3}\[([^\]]+)\]:[ \t]+(\S+)/.exec(lines[i]);
      if (m) defs[m[1].toLowerCase()] = m[2];
    }
    return defs;
  }

  function renderFence(lines, index) {
    var open = fenceInfo(lines[index].text);
    var body = [];
    var i = index + 1;
    while (i < lines.length && !isFenceClose(lines[i].text, open)) {
      body.push(lines[i]);
      i++;
    }
    if (i < lines.length && isFenceClose(lines[i].text, open)) i++;
    var text = "";
    for (var k = 0; k < body.length; k++) {
      text += body[k].text;
      if (body[k].nl) text += "\n";
    }
    return { html: "<pre><code>" + escapeText(text) + "</code></pre>\n", next: i };
  }

  function renderIndented(lines, index) {
    var body = [];
    var i = index;
    while (i < lines.length && isIndentedCodeText(lines[i].text)) {
      body.push(lines[i]);
      i++;
    }
    var text = "";
    for (var k = 0; k < body.length; k++) {
      text += body[k].text.replace(/^(?: {4}|\t)/, "");
      if (body[k].nl) text += "\n";
    }
    return { html: "<pre><code>" + escapeText(text) + "</code></pre>\n", next: i };
  }

  function renderTable(lines, index, defs) {
    var header = splitRow(lines[index].text);
    var delim = splitRow(lines[index + 1].text);
    var aligns = [];
    var col;
    for (col = 0; col < header.length; col++) aligns.push(alignOf(delim[col] || ""));
    var rows = [];
    var i = index + 2;
    while (i < lines.length && splitRow(lines[i].text) && !isDelimiterRow(lines[i].text) && !isBlankText(lines[i].text)) {
      rows.push(splitRow(lines[i].text));
      i++;
    }
    function cell(tag, text, align) {
      var inner = renderInline(text || "", defs);
      if (align) return "<" + tag + ' align="' + align + '">' + inner + "</" + tag + ">";
      return "<" + tag + ">" + inner + "</" + tag + ">";
    }
    var html = "<table>\n<thead>\n<tr>\n";
    for (col = 0; col < header.length; col++) html += cell("th", header[col], aligns[col]) + "\n";
    html += "</tr>\n</thead>\n";
    if (rows.length) {
      html += "<tbody>\n";
      for (var r = 0; r < rows.length; r++) {
        html += "<tr>\n";
        for (col = 0; col < header.length; col++) html += cell("td", rows[r][col] || "", aligns[col] || "") + "\n";
        html += "</tr>\n";
      }
      html += "</tbody>\n";
    }
    html += "</table>\n";
    return { html: html, next: i };
  }

  function renderQuote(lines, index, defs) {
    var parts = [];
    var i = index;
    while (i < lines.length && !isBlankText(lines[i].text)) {
      parts.push(isQuoteLine(lines[i].text) ? stripQuote(lines[i].text) : lines[i].text);
      i++;
    }
    var inner = renderBlocks(parts.join("\n"), defs);
    return { html: "<blockquote>\n" + inner + "</blockquote>\n", next: i };
  }

  function interruptsList(lines, index) {
    var text = lines[index].text;
    if (fenceInfo(text) || parseAtx(text) || isQuoteLine(text) || isThematic(text)) return true;
    if (isCommentOnly(text) || isDefLine(text) || blockTagAt(text)) return true;
    if (isTableStart(lines, index)) return true;
    return false;
  }

  function dedentSpaces(text, n) {
    var i = 0;
    while (i < n && i < text.length && text.charAt(i) === " ") i++;
    if (i < n && text.charAt(i) === "\t") i++;
    return text.slice(i);
  }

  function linesHaveBlock(rawLines) {
    for (var i = 0; i < rawLines.length; i++) {
      var t = rawLines[i];
      if (!t) continue;
      if (fenceInfo(t) || parseAtx(t) || isQuoteLine(t) || isThematic(t) || blockTagAt(t) || isIndentedCodeText(t)) {
        return true;
      }
      if (i + 1 < rawLines.length && splitRow(t) && isDelimiterRow(rawLines[i + 1])) return true;
    }
    return false;
  }

  function renderList(lines, index, defs) {
    var first = parseListMarker(lines[index].text);
    var base = first.indent;
    var ordered = /^\d/.test(first.marker);
    var startNum = ordered ? parseInt(first.marker, 10) : 1;
    var items = [];
    var loose = false;
    var i = index;
    while (i < lines.length) {
      if (isBlankText(lines[i].text)) {
        var j = i + 1;
        while (j < lines.length && isBlankText(lines[j].text)) j++;
        var peek = j < lines.length ? parseListMarker(lines[j].text) : null;
        if (!peek || peek.indent < base) break;
        if (peek.indent === base && ordered === /^\d/.test(peek.marker)) {
          loose = true;
          i = j;
          continue;
        }
        break;
      }
      var mark = parseListMarker(lines[i].text);
      if (!mark || mark.indent !== base || ordered !== /^\d/.test(mark.marker)) break;
      var content = mark.content;
      var task = /^\[([ xX])\][ \t]*/.exec(content);
      if (task) content = content.slice(task[0].length);
      var contentIndent = base + mark.marker.length + 1;
      var plain = [content];
      var raw = [content];
      var nested = "";
      i++;
      while (i < lines.length) {
        if (isBlankText(lines[i].text)) break;
        var sub = parseListMarker(lines[i].text);
        if (sub && sub.indent > base) {
          var child = renderList(lines, i, defs);
          nested += child.html;
          i = child.next;
          continue;
        }
        if (sub && sub.indent <= base) break;
        var lead = /^[ \t]*/.exec(lines[i].text)[0].length;
        if (lead > base) {
          var dedented = dedentSpaces(lines[i].text, contentIndent);
          plain.push(dedented.trim());
          raw.push(dedented);
          i++;
          continue;
        }
        if (!interruptsList(lines, i)) {
          var lazy = lines[i].text.trim();
          plain.push(lazy);
          raw.push(lazy);
          i++;
          continue;
        }
        break;
      }
      items.push({ plain: plain, raw: raw, nested: nested });
    }
    var open = !ordered ? "<ul>" : startNum === 1 ? "<ol>" : '<ol start="' + startNum + '">';
    var close = ordered ? "</ol>" : "</ul>";
    var html = open + "\n";
    for (var n = 0; n < items.length; n++) {
      var body;
      if (linesHaveBlock(items[n].raw)) {
        body = renderBlocks(items[n].raw.join("\n"), defs).replace(/\n$/, "");
      } else {
        var inline = renderInline(items[n].plain.join("\n"), defs);
        body = loose ? "<p>" + inline + "</p>" : inline;
      }
      html += "<li>" + body + items[n].nested + "</li>\n";
    }
    html += close + "\n";
    return { html: html, next: i };
  }

  function renderHtmlAt(lines, index, defs) {
    var src = joinFrom(lines, index);
    var lead = /^[ \t]*/.exec(lines[index].text)[0].length;
    var tag = parseHtmlTagAt(src, lead);
    if (!tag) return null;
    var el = finishElement(src, tag, defs);
    if (!el) return null;
    var html = el.html;
    var left = el.end;
    var line = index;
    var col = 0;
    while (line < lines.length) {
      var len = lines[line].text.length + (lines[line].nl ? 1 : 0);
      if (left <= lines[line].text.length) {
        col = left;
        break;
      }
      left -= len;
      line++;
    }
    if (line < lines.length && col < lines[line].text.length) {
      var rest = lines[line].text.slice(col);
      if (rest) html += renderInline(rest, defs);
    }
    if (!/\n$/.test(html)) html += "\n";
    var next = line < lines.length ? line + 1 : lines.length;
    return { html: html, next: next };
  }

  function renderBlocks(src, defs, insideHtml) {
    var lines = splitLines(src);
    var out = "";
    var i = 0;
    while (i < lines.length) {
      var text = lines[i].text;
      if (isBlankText(text)) {
        i++;
        continue;
      }
      if (isDefLine(text)) {
        i++;
        continue;
      }
      if (fenceInfo(text)) {
        var fence = renderFence(lines, i);
        out += fence.html;
        i = fence.next;
        continue;
      }
      if (isTableStart(lines, i)) {
        var table = renderTable(lines, i, defs);
        out += table.html;
        i = table.next;
        continue;
      }
      var heading = parseAtx(text);
      if (heading) {
        out += "<h" + heading.level + ">" + renderInline(heading.text, defs) + "</h" + heading.level + ">\n";
        i++;
        continue;
      }
      if (isQuoteLine(text)) {
        var quote = renderQuote(lines, i, defs);
        out += quote.html;
        i = quote.next;
        continue;
      }
      if (isThematic(text)) {
        out += "<hr>\n";
        i++;
        continue;
      }
      var listMark = parseListMarker(text);
      if (listMark && listMark.indent <= 3) {
        var list = renderList(lines, i, defs);
        out += list.html;
        i = list.next;
        continue;
      }
      if (!insideHtml && indentedCodeAt(lines, i)) {
        var code = renderIndented(lines, i);
        out += code.html;
        i = code.next;
        continue;
      }
      if (isStrayCloseLine(text)) {
        i++;
        continue;
      }
      if (isCommentOnly(text)) {
        out += text + "\n";
        i++;
        continue;
      }
      var onlyImage = imageOnlyHtml(text);
      if (onlyImage !== null) {
        if (onlyImage) out += onlyImage + "\n";
        i++;
        continue;
      }
      if (blockTagAt(text)) {
        var block = renderHtmlAt(lines, i, defs);
        if (block) {
          out += block.html;
          i = block.next;
          continue;
        }
      }
      var buf = [!insideHtml && isIndentedCodeText(text) ? dedentCodeIndent(text) : text];
      var start = i;
      i++;
      while (i < lines.length && !isBlankText(lines[i].text)) {
        if (buf.length === 1 && isSetextUnderline(lines[i].text) && looksLikeSetextText(buf[0])) {
          var level = lines[i].text.trim().charAt(0) === "=" ? 1 : 2;
          out += "<h" + level + ">" + renderInline(buf[0].trim(), defs) + "</h" + level + ">\n";
          buf = null;
          i++;
          break;
        }
        if (isStrayCloseLine(lines[i].text)) {
          i++;
          continue;
        }
        if (
          fenceInfo(lines[i].text) ||
          isTableStart(lines, i) ||
          parseAtx(lines[i].text) ||
          isQuoteLine(lines[i].text) ||
          (parseListMarker(lines[i].text) && parseListMarker(lines[i].text).indent <= 3) ||
          (!insideHtml && indentedCodeAt(lines, i)) ||
          isCommentOnly(lines[i].text) ||
          imageOnlyHtml(lines[i].text) !== null ||
          isThematic(lines[i].text) ||
          blockTagAt(lines[i].text) ||
          isDefLine(lines[i].text)
        ) {
          break;
        }
        var continued = lines[i].text;
        if (!insideHtml && isIndentedCodeText(continued)) continued = dedentCodeIndent(continued);
        buf.push(continued);
        i++;
      }
      if (buf) out += "<p>" + renderInline(buf.join("\n"), defs) + "</p>\n";
      if (i === start) i++;
    }
    return out;
  }

  function render(src) {
    var text = String(src == null ? "" : src).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    if (!text) return "";
    return renderBlocks(text, collectDefs(text));
  }

  global.Markdown = { render: render };
})(typeof window !== "undefined" ? window : globalThis);
