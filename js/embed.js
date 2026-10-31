/* Host-page widget. Replaces blockquote.cyberspace77-embed with an iframe
   and sets its height from { type: "cs77-embed-size", height }. */
(function () {
  if (window.CyberSpace77Embed) return;

  var TYPE = "cs77-embed-size";
  var SELECTOR = "blockquote.cyberspace77-embed";

  function pageOrigin() {
    var node = document.currentScript;
    if (node && node.src) {
      try {
        return new URL(node.src).origin;
      } catch (err) {}
    }
    var nodes = document.querySelectorAll("script[src]");
    var i;
    for (i = nodes.length - 1; i >= 0; i--) {
      var src = nodes[i].getAttribute("src") || "";
      if (src.indexOf("/js/embed.js") === -1) continue;
      try {
        return new URL(nodes[i].src).origin;
      } catch (err) {}
    }
    return "";
  }

  var origin = pageOrigin();

  var frames = [];

  function routePath(url) {
    var hash = url.hash || "";
    if (hash.charAt(0) === "#" && hash.charAt(1) === "/") return hash.slice(1).split("?")[0];
    return url.pathname || "";
  }

  function frameUrl(href) {
    if (!origin || !href) return "";
    var url;
    try {
      url = new URL(href, origin + "/");
    } catch (err) {
      return "";
    }
    if (url.origin !== origin) return "";
    var path = routePath(url);
    var embed = path.match(/^\/embed\/@([a-z0-9.\-]{3,16})\/([^/?#]+)$/i);
    var author = "";
    var permlink = "";
    var commentHash = (url.hash || "").match(/^#@([a-z0-9.\-]{3,16})\/([^/?#]+)$/i);
    if (embed) {
      author = embed[1];
      permlink = embed[2];
    } else if (commentHash) {
      author = commentHash[1];
      permlink = commentHash[2];
    } else {
      var post = path.match(/^\/@([a-z0-9.\-]{3,16})\/([^/?#]+)$/i);
      if (!post) return "";
      author = post[1];
      permlink = post[2];
    }
    if (!permlink || permlink.indexOf("..") !== -1) return "";
    return origin + "/embed/@" + author.toLowerCase() + "/" + permlink;
  }

  function quoteLink(quote) {
    var links = quote.querySelectorAll("a[href]");
    var i;
    for (i = 0; i < links.length; i++) {
      if (frameUrl(links[i].getAttribute("href"))) return links[i];
    }
    return null;
  }

  function mount(quote) {
    if (!quote || quote.nodeType !== 1 || quote.getAttribute("data-cs77-mounted") === "1") return;
    var link = quoteLink(quote);
    var src = link ? frameUrl(link.getAttribute("href")) : "";
    if (!src) return;
    quote.setAttribute("data-cs77-mounted", "1");
    var iframe = document.createElement("iframe");
    var heading = quote.querySelector("p");
    var title = heading ? heading.textContent || "" : "";
    title = title.replace(/\s+/g, " ").trim();
    if (!title) title = ((link && link.textContent) || "").replace(/\s+/g, " ").trim();
    if (!title) title = "CyberSpace77";
    iframe.className = "cyberspace77-embed-frame";
    iframe.src = src;
    iframe.title = title;
    iframe.scrolling = "no";
    iframe.setAttribute("allowtransparency", "true");
    iframe.setAttribute("allow", "fullscreen");
    iframe.style.border = "0";
    iframe.style.display = "block";
    iframe.style.width = "100%";
    iframe.style.maxWidth = "100%";
    iframe.style.height = "180px";
    iframe.style.overflow = "hidden";
    iframe.style.background = "transparent";
    iframe.style.colorScheme = "normal";
    frames.push({ iframe: iframe, origin: origin });
    quote.replaceWith(iframe);
  }

  function scan(root) {
    var scope = root && root.querySelectorAll ? root : document;
    if (scope.matches && scope.matches(SELECTOR)) mount(scope);
    if (!scope.querySelectorAll) return;
    var nodes = scope.querySelectorAll(SELECTOR);
    var i;
    for (i = 0; i < nodes.length; i++) mount(nodes[i]);
  }

  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || data.type !== TYPE || event.origin !== origin) return;
    var height = Number(data.height);
    if (!isFinite(height)) return;
    height = Math.ceil(height);
    if (height < 40 || height > 2000) return;
    var i;
    for (i = 0; i < frames.length; i++) {
      if (frames[i].iframe.contentWindow !== event.source) continue;
      frames[i].iframe.style.height = height + "px";
      frames[i].iframe.height = String(height);
      return;
    }
  });

  function boot() {
    scan(document);
    if (typeof MutationObserver !== "function" || !document.documentElement) return;
    var observer = new MutationObserver(function (records) {
      var i;
      var j;
      for (i = 0; i < records.length; i++) {
        var added = records[i].addedNodes;
        for (j = 0; j < added.length; j++) {
          if (added[j].nodeType === 1) scan(added[j]);
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  window.CyberSpace77Embed = { load: scan };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
