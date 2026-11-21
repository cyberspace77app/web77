/**
 * SVG QR codes for a link, plain text, or a Lightning invoice.
 * Dark modules are squares or circles. The backdrop is a color,
 * or left out so the page shows through.
 *
 *   var code = new cs77Qr("https://cyberspace77.com", {
 *     color: "#d7d7d7",
 *     shape: "round",
 *     background: "transparent",
 *     level: "L"
 *   });
 *   code.toSvg(document);
 *
 * cs77Qr.link, cs77Qr.text, and cs77Qr.invoice prepare those payloads.
 * A BOLT11 invoice or LNURL is encoded as LIGHTNING: plus the uppercase
 * bech32. The scheme and the invoice are case-insensitive, and uppercase
 * fits the QR alphanumeric set, so the symbol stays smaller.
 *
 * Scan a picture, or the frames from a camera:
 *   cs77Qr.scanImage(file).then(function (hit) { hit.data; });
 *   var scanner = new cs77Qr.Scanner(video, function (hit) {
 *     hit.data; hit.cornerPoints;
 *   });
 *   scanner.start();
 *
 * The browser BarcodeDetector is used when it can read QR codes. Otherwise
 * each frame is copied off the camera and decoded here. cornerPoints are
 * in the picture's pixels, clockwise from the code's top left.
 *
 * Hive Keychain's one-account export:
 *   cs77Qr.keychainAccount(text, role);
 * text is keychain://add_account= plus { name, keys }, or that JSON alone.
 * role is posting, active, memo, or owner. The result is
 * { ok, name, wif, error }. error is "", "format", "plural", or "role".
 * name is the JSON value unchanged. The page checks the Hive username.
 *
 * A private key by itself:
 *   cs77Qr.privateKeyText(wif);  // the text to encode, or ""
 *   cs77Qr.privateKey(text);     // { ok, wif, error: "" | "format" }
 * The symbol is only the WIF. It has no username.
 *
 * A CyberSpace profile QR from the profile dialog:
 *   cs77Qr.profileUser(text);    // { ok, name, error: "" | "format" }
 * text is https://cyberspace77.com/@username. name has no @.
 */
(function (global) {
  "use strict";

  var ALNUM = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
  var ALNUM_VAL = new Int8Array(128);
  var i;
  for (i = 0; i < ALNUM_VAL.length; i++) ALNUM_VAL[i] = -1;
  for (i = 0; i < ALNUM.length; i++) ALNUM_VAL[ALNUM.charCodeAt(i)] = i;

  // ISO/IEC 18004 Table 9. Index 0 is version 1.
  var ECC_WORDS = {
    L: [7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    M: [10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    Q: [13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    H: [17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
  };
  var ECC_BLOCKS = {
    L: [1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    M: [1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    Q: [1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    H: [1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]
  };
  var EC_BITS = { L: 1, M: 0, Q: 3, H: 2 };
  var MODE_BITS = { numeric: 1, alphanumeric: 2, byte: 4 };
  var COUNT_BITS = {
    numeric: [10, 12, 14],
    alphanumeric: [9, 11, 13],
    byte: [8, 16, 16]
  };

  // GF(2^8) with the QR primitive polynomial 0x11d. EXP is doubled so a
  // product of two logs can index it without wrapping.
  var EXP = new Uint8Array(512);
  var LOG = new Uint8Array(256);
  (function () {
    var x = 1;
    var n;
    for (n = 0; n < 255; n++) {
      EXP[n] = x;
      EXP[n + 255] = x;
      LOG[x] = n;
      x <<= 1;
      if (x & 256) x ^= 0x11d;
    }
  })();

  var RS_GEN = [];

  function rsGenerator(nsym) {
    var cached = RS_GEN[nsym];
    if (cached) return cached;
    var poly = [1];
    var root;
    var next;
    var j;
    for (root = 0; root < nsym; root++) {
      next = [];
      for (j = 0; j <= poly.length; j++) next.push(0);
      for (j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        if (poly[j]) next[j + 1] ^= EXP[LOG[poly[j]] + root];
      }
      poly = next;
    }
    RS_GEN[nsym] = poly;
    return poly;
  }

  function rsRemainder(data, nsym) {
    var gen = rsGenerator(nsym);
    var msg = new Uint8Array(data.length + nsym);
    var i;
    var j;
    var coef;
    msg.set(data);
    for (i = 0; i < data.length; i++) {
      coef = msg[i];
      if (!coef) continue;
      for (j = 1; j < gen.length; j++) {
        msg[i + j] ^= EXP[LOG[gen[j]] + LOG[coef]];
      }
    }
    return msg.subarray(data.length);
  }

  function totalBytes(ver) {
    var bits = (16 * ver + 128) * ver + 64;
    var align;
    if (ver >= 2) {
      align = Math.floor(ver / 7) + 2;
      bits -= (25 * align - 10) * align - 55;
      if (ver >= 7) bits -= 36;
    }
    return bits >>> 3;
  }

  function capacity(ver, level) {
    var total = totalBytes(ver);
    var words = ECC_WORDS[level][ver - 1];
    var blocks = ECC_BLOCKS[level][ver - 1];
    var dataBytes = total - words * blocks;
    return {
      words: words,
      blocks: blocks,
      blockLen: Math.floor(total / blocks) - words,
      shortBlocks: blocks - (total % blocks),
      dataBytes: dataBytes
    };
  }

  function countGroup(ver) {
    if (ver <= 9) return 0;
    if (ver <= 26) return 1;
    return 2;
  }

  function detectMode(text) {
    var mode = "numeric";
    var i;
    var code;
    var val;
    for (i = 0; i < text.length; i++) {
      code = text.charCodeAt(i);
      if (code > 127) return "byte";
      val = ALNUM_VAL[code];
      if (val < 0) return "byte";
      if (val > 9) mode = "alphanumeric";
    }
    return mode;
  }

  function utf8Bytes(text) {
    if (typeof TextEncoder !== "function") {
      throw new Error("This browser cannot encode this text.");
    }
    return new TextEncoder().encode(text);
  }

  function payloadBits(text, mode, bytes, ver) {
    var count = mode === "byte" ? bytes.length : text.length;
    var bits = 4 + COUNT_BITS[mode][countGroup(ver)];
    var n;
    var rest;
    if (mode === "numeric") {
      n = Math.floor(text.length / 3);
      rest = text.length % 3;
      bits += n * 10 + (rest === 1 ? 4 : rest === 2 ? 7 : 0);
    } else if (mode === "alphanumeric") {
      bits += 11 * Math.floor(text.length / 2) + (text.length % 2 ? 6 : 0);
    } else {
      bits += bytes.length * 8;
    }
    return { bits: bits, count: count };
  }

  function chooseVersion(text, mode, bytes, level) {
    var ver;
    var info;
    var payload;
    var countBits;
    for (ver = 1; ver <= 40; ver++) {
      info = capacity(ver, level);
      payload = payloadBits(text, mode, bytes, ver);
      countBits = COUNT_BITS[mode][countGroup(ver)];
      if (payload.count >= (1 << countBits)) continue;
      if (payload.bits <= info.dataBytes * 8) {
        return { version: ver, level: level, info: info, payload: payload };
      }
    }
    throw new Error("This is too long for a QR code.");
  }

  function writeBits(bytes, state, value, len) {
    var width = state.n + len;
    state.acc = ((state.acc << len) | (value & ((1 << len) - 1))) & ((1 << width) - 1);
    state.n = width;
    while (state.n >= 8) {
      state.n -= 8;
      bytes[state.pos++] = (state.acc >>> state.n) & 255;
      state.acc &= state.n ? (1 << state.n) - 1 : 0;
    }
  }

  function encodeData(text, mode, bytes, ver, info) {
    var out = new Uint8Array(info.dataBytes);
    var state = { acc: 0, n: 0, pos: 0 };
    var countBits = COUNT_BITS[mode][countGroup(ver)];
    var count = mode === "byte" ? bytes.length : text.length;
    var i;
    var n;
    var used;
    var term;
    var pad;
    writeBits(out, state, MODE_BITS[mode], 4);
    writeBits(out, state, count, countBits);
    if (mode === "numeric") {
      for (i = 0; i < text.length; i += 3) {
        n = Math.min(3, text.length - i);
        writeBits(out, state, Number(text.slice(i, i + n)), n === 1 ? 4 : n === 2 ? 7 : 10);
      }
    } else if (mode === "alphanumeric") {
      for (i = 0; i + 1 < text.length; i += 2) {
        writeBits(
          out,
          state,
          ALNUM_VAL[text.charCodeAt(i)] * 45 + ALNUM_VAL[text.charCodeAt(i + 1)],
          11
        );
      }
      if (text.length % 2) writeBits(out, state, ALNUM_VAL[text.charCodeAt(text.length - 1)], 6);
    } else {
      for (i = 0; i < bytes.length; i++) writeBits(out, state, bytes[i], 8);
    }
    used = state.pos * 8 + state.n;
    term = info.dataBytes * 8 - used;
    if (term > 4) term = 4;
    if (term > 0) writeBits(out, state, 0, term);
    if (state.n) writeBits(out, state, 0, 8 - state.n);
    pad = 0;
    for (i = state.pos; i < out.length; i++) {
      out[i] = pad ? 0x11 : 0xec;
      pad ^= 1;
    }
    return out;
  }

  function interleave(data, info) {
    var blocks = [];
    var ecc = [];
    var pos = 0;
    var i;
    var len;
    var b;
    var maxLen;
    var out;
    var p;
    for (i = 0; i < info.blocks; i++) {
      len = info.blockLen + (i < info.shortBlocks ? 0 : 1);
      blocks.push(data.subarray(pos, pos + len));
      ecc.push(rsRemainder(blocks[i], info.words));
      pos += len;
    }
    out = new Uint8Array(data.length + info.words * info.blocks);
    p = 0;
    maxLen = info.blockLen + 1;
    for (i = 0; i < maxLen; i++) {
      for (b = 0; b < blocks.length; b++) {
        if (i < blocks[b].length) out[p++] = blocks[b][i];
      }
    }
    for (i = 0; i < info.words; i++) {
      for (b = 0; b < ecc.length; b++) out[p++] = ecc[b][i];
    }
    return out;
  }

  function alignmentCenters(ver) {
    var size;
    var last;
    var count;
    var interval;
    var res;
    var m;
    if (ver === 1) return [];
    size = 17 + 4 * ver;
    last = size - 7;
    count = Math.ceil((last - 6) / 28);
    interval = Math.floor((last - 6) / count);
    if (interval % 2) interval += 1;
    else if (((last - 6) % count) * 2 >= count) interval += 2;
    res = [6];
    for (m = 1; m < count; m++) res.push(last - (count - m) * interval);
    res.push(last);
    return res;
  }

  function maskOn(mask, x, y) {
    if (mask === 0) return ((x + y) & 1) === 0;
    if (mask === 1) return (y & 1) === 0;
    if (mask === 2) return x % 3 === 0;
    if (mask === 3) return (x + y) % 3 === 0;
    if (mask === 4) return ((Math.floor(y / 2) + Math.floor(x / 3)) & 1) === 0;
    if (mask === 5) return ((x * y) % 2) + ((x * y) % 3) === 0;
    if (mask === 6) return ((((x * y) % 2) + ((x * y) % 3)) & 1) === 0;
    return ((((x + y) & 1) + ((x * y) % 3)) & 1) === 0;
  }

  function formatBits(level, mask) {
    var data = (EC_BITS[level] << 3) | mask;
    var rem = data;
    var i;
    for (i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    return ((data << 10) | (rem & 0x3ff)) ^ 0x5412;
  }

  function versionBits(ver) {
    var rem = ver;
    var i;
    for (i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    return (ver << 12) | (rem & 0xfff);
  }

  function drawTemplate(ver) {
    var size = 17 + 4 * ver;
    var modules = new Uint8Array(size * size);
    var func = new Uint8Array(size * size);
    // Finder and alignment cells stay square when the data modules are circles.
    var blocks = new Uint8Array(size * size);
    var centers;
    var c;
    var a;
    var b;
    var dx;
    var dy;
    var x;
    var y;

    function setFunc(x, y, bit, block) {
      var i = y * size + x;
      modules[i] = bit ? 1 : 0;
      func[i] = 1;
      if (block) blocks[i] = 1;
    }

    function finder(ox, oy) {
      var dy;
      var dx;
      var x;
      var y;
      var on;
      for (dy = -1; dy <= 7; dy++) {
        for (dx = -1; dx <= 7; dx++) {
          x = ox + dx;
          y = oy + dy;
          if (x < 0 || y < 0 || x >= size || y >= size) continue;
          on = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6 &&
            (dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4));
          setFunc(x, y, on ? 1 : 0, dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6);
        }
      }
    }

    finder(0, 0);
    finder(size - 7, 0);
    finder(0, size - 7);

    centers = alignmentCenters(ver);
    for (a = 0; a < centers.length; a++) {
      for (b = 0; b < centers.length; b++) {
        if (func[centers[a] * size + centers[b]]) continue;
        for (dy = -2; dy <= 2; dy++) {
          for (dx = -2; dx <= 2; dx++) {
            setFunc(centers[b] + dx, centers[a] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1 ? 1 : 0, true);
          }
        }
      }
    }

    for (c = 0; c < size; c++) {
      if (!func[6 * size + c]) setFunc(c, 6, c % 2 === 0 ? 1 : 0);
      if (!func[c * size + 6]) setFunc(6, c, c % 2 === 0 ? 1 : 0);
    }

    for (c = 0; c < 9; c++) {
      if (c !== 6) {
        setFunc(8, c, 0);
        setFunc(c, 8, 0);
      }
    }
    for (c = 0; c < 8; c++) {
      setFunc(size - 1 - c, 8, 0);
      setFunc(8, size - 1 - c, 0);
    }
    modules[(size - 8) * size + 8] = 1;

    if (ver >= 7) {
      for (c = 0; c < 18; c++) {
        x = size - 11 + (c % 3);
        y = (c / 3) | 0;
        setFunc(x, y, 0);
        setFunc(y, x, 0);
      }
    }

    return { size: size, modules: modules, func: func, blocks: blocks };
  }

  function placeData(modules, func, codewords) {
    var size = Math.sqrt(modules.length) | 0;
    var bit = 0;
    var total = codewords.length * 8;
    var upward = true;
    var right;
    var vert;
    var y;
    var j;
    var x;
    var i;
    var value;
    for (right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (vert = 0; vert < size; vert++) {
        y = upward ? size - 1 - vert : vert;
        for (j = 0; j < 2; j++) {
          x = right - j;
          i = y * size + x;
          if (func[i]) continue;
          value = 0;
          if (bit < total) {
            value = (codewords[bit >>> 3] >>> (7 - (bit & 7))) & 1;
            bit++;
          }
          modules[i] = value;
        }
      }
      upward = !upward;
    }
  }

  function writeFormat(modules, size, level, mask) {
    var bits = formatBits(level, mask);
    var i;
    var bit;
    for (i = 0; i < 15; i++) {
      bit = (bits >>> i) & 1;
      if (i < 6) modules[i * size + 8] = bit;
      else if (i < 8) modules[(i + 1) * size + 8] = bit;
      else if (i === 8) modules[8 * size + 7] = bit;
      else modules[8 * size + (14 - i)] = bit;
      if (i < 8) modules[8 * size + (size - 1 - i)] = bit;
      else modules[(size - 15 + i) * size + 8] = bit;
    }
    modules[(size - 8) * size + 8] = 1;
  }

  function writeVersion(modules, size, ver) {
    var bits;
    var i;
    var bit;
    var x;
    var y;
    if (ver < 7) return;
    bits = versionBits(ver);
    for (i = 0; i < 18; i++) {
      bit = (bits >>> i) & 1;
      x = size - 11 + (i % 3);
      y = (i / 3) | 0;
      modules[y * size + x] = bit;
      modules[x * size + y] = bit;
    }
  }

  function runPenalty(modules, size, vertical) {
    var score = 0;
    var a;
    var b;
    var run;
    var prev;
    var v;
    var i;
    for (a = 0; a < size; a++) {
      prev = vertical ? modules[a] : modules[a * size];
      run = 1;
      for (b = 1; b < size; b++) {
        i = vertical ? b * size + a : a * size + b;
        v = modules[i];
        if (v === prev) {
          run++;
          if (run >= 5) score += run === 5 ? 3 : 1;
        } else {
          run = 1;
          prev = v;
        }
      }
    }
    return score;
  }

  function finderPenalty(modules, size, vertical) {
    var score = 0;
    var a;
    var b;
    var bits;
    var i;
    var bit;
    for (a = 0; a < size; a++) {
      for (b = 0; b <= size - 11; b++) {
        bits = 0;
        for (i = 0; i < 11; i++) {
          bit = vertical ? modules[(b + i) * size + a] : modules[a * size + (b + i)];
          bits = (bits << 1) | bit;
        }
        if (bits === 0x5d0 || bits === 0x5d) score += 40;
      }
    }
    return score;
  }

  function penalty(modules, size) {
    var score = runPenalty(modules, size, false) + runPenalty(modules, size, true);
    var boxes = 0;
    var dark = 0;
    var y;
    var x;
    var v;
    var i;
    var percent;
    for (y = 0; y < size; y++) {
      for (x = 0; x < size; x++) {
        i = y * size + x;
        v = modules[i];
        dark += v;
        if (x < size - 1 && y < size - 1 &&
          v === modules[i + 1] &&
          v === modules[i + size] &&
          v === modules[i + size + 1]) boxes++;
      }
    }
    score += boxes * 3;
    percent = Math.floor((dark * 100) / (size * size));
    score += Math.floor(Math.abs(percent - 50) / 5) * 10;
    score += finderPenalty(modules, size, false) + finderPenalty(modules, size, true);
    return score;
  }

  function buildSymbol(text, level) {
    var mode = detectMode(text);
    var bytes = mode === "byte" ? utf8Bytes(text) : null;
    var chosen = chooseVersion(text, mode, bytes, level);
    var data = encodeData(text, mode, bytes, chosen.version, chosen.info);
    var codewords = interleave(data, chosen.info);
    var drawn = drawTemplate(chosen.version);
    var best = null;
    var bestScore = Infinity;
    var mask;
    var modules;
    var y;
    var x;
    var i;
    var score;
    placeData(drawn.modules, drawn.func, codewords);
    writeVersion(drawn.modules, drawn.size, chosen.version);
    for (mask = 0; mask < 8; mask++) {
      modules = new Uint8Array(drawn.modules);
      for (y = 0; y < drawn.size; y++) {
        for (x = 0; x < drawn.size; x++) {
          i = y * drawn.size + x;
          if (drawn.func[i]) continue;
          if (maskOn(mask, x, y)) modules[i] ^= 1;
        }
      }
      writeFormat(modules, drawn.size, chosen.level, mask);
      score = penalty(modules, drawn.size);
      if (score < bestScore) {
        bestScore = score;
        best = modules;
      }
    }
    return {
      text: text,
      mode: mode,
      version: chosen.version,
      level: chosen.level,
      size: drawn.size,
      modules: best,
      blocks: drawn.blocks
    };
  }

  function normalizeLevel(level) {
    var key;
    if (level == null || level === "") return "M";
    key = String(level).toLowerCase();
    if (key === "l" || key === "low") return "L";
    if (key === "m" || key === "medium") return "M";
    if (key === "q" || key === "quartile") return "Q";
    if (key === "h" || key === "high") return "H";
    throw new Error("Unknown QR correction level.");
  }

  function readPaint(options) {
    var opts = options || {};
    var shape = String(opts.shape || "rect").toLowerCase();
    var background = opts.background !== undefined ? opts.background : opts.off;
    var pad = opts.pad == null ? 4 : Number(opts.pad);
    var scale = opts.scale == null ? 1 : Number(opts.scale);
    if (shape === "circle") shape = "round";
    if (shape === "square") shape = "rect";
    if (shape !== "round" && shape !== "rect") shape = "rect";
    if (background == null || background === "" || background === "transparent" || background === "none") {
      background = "";
    } else {
      background = String(background);
    }
    if (!isFinite(pad) || pad < 0) pad = 4;
    pad = Math.min(32, Math.floor(pad));
    if (!isFinite(scale) || scale <= 0) scale = 1;
    return {
      color: String(opts.color || opts.on || "#000000"),
      shape: shape,
      background: background,
      pad: pad,
      scale: scale,
      label: opts.label ? String(opts.label) : "QR code"
    };
  }

  function escAttr(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  }

  // A little under half a module, so neighboring points stay separate.
  var ROUND_R = 0.42;

  function eachPaintRun(code, visitRect, visitCircle) {
    var size = code.size;
    var round = code.shape === "round";
    var y;
    var x;
    var start;
    var i;
    for (y = 0; y < size; y++) {
      x = 0;
      while (x < size) {
        i = y * size + x;
        if (!code.modules[i]) {
          x++;
          continue;
        }
        if (round && !(code.blocks && code.blocks[i])) {
          visitCircle(x + 0.5, y + 0.5);
          x++;
          continue;
        }
        start = x;
        x++;
        while (x < size && code.modules[y * size + x] && (!round || (code.blocks && code.blocks[y * size + x]))) x++;
        visitRect(start, y, x - start);
      }
    }
  }

  function appendShapes(parent, doc, code) {
    var NS = "http://www.w3.org/2000/svg";
    var g = doc.createElementNS(NS, "g");
    g.setAttribute("fill", code.color);
    if (code.shape !== "round") g.setAttribute("shape-rendering", "crispEdges");
    eachPaintRun(code, function (x, y, w) {
      var rect = doc.createElementNS(NS, "rect");
      rect.setAttribute("x", String(x));
      rect.setAttribute("y", String(y));
      rect.setAttribute("width", String(w));
      rect.setAttribute("height", "1");
      if (code.shape === "round") rect.setAttribute("shape-rendering", "crispEdges");
      g.appendChild(rect);
    }, function (cx, cy) {
      var circle = doc.createElementNS(NS, "circle");
      circle.setAttribute("cx", String(cx));
      circle.setAttribute("cy", String(cy));
      circle.setAttribute("r", String(ROUND_R));
      g.appendChild(circle);
    });
    parent.appendChild(g);
  }

  function svgSource(code) {
    var span = code.size + code.pad * 2;
    var body = "";
    var shapes = [];
    if (code.background) {
      body += '<rect x="' + (-code.pad) + '" y="' + (-code.pad) +
        '" width="' + span + '" height="' + span + '" fill="' + escAttr(code.background) + '"/>';
    }
    eachPaintRun(code, function (x, y, w) {
      shapes.push('<rect x="' + x + '" y="' + y + '" width="' + w + '" height="1"' +
        (code.shape === "round" ? ' shape-rendering="crispEdges"' : "") + "/>");
    }, function (cx, cy) {
      shapes.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + ROUND_R + '"/>');
    });
    body += '<g fill="' + escAttr(code.color) + '"' +
      (code.shape === "round" ? "" : ' shape-rendering="crispEdges"') + ">" +
      shapes.join("") + "</g>";
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + (-code.pad) + " " + (-code.pad) +
      " " + span + " " + span + '" width="' + (span * code.scale) + '" height="' + (span * code.scale) +
      '" role="img" aria-label="' + escAttr(code.label) + '" class="qr-code">' + body + "</svg>";
  }

  function paint(code, doc) {
    var NS = "http://www.w3.org/2000/svg";
    var span = code.size + code.pad * 2;
    var svg;
    var rect;
    if (!doc || typeof doc.createElementNS !== "function") {
      throw new Error("Pass a document to build the SVG element.");
    }
    svg = doc.createElementNS(NS, "svg");
    svg.setAttribute("xmlns", NS);
    svg.setAttribute("viewBox", (-code.pad) + " " + (-code.pad) + " " + span + " " + span);
    svg.setAttribute("width", String(span * code.scale));
    svg.setAttribute("height", String(span * code.scale));
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", code.label);
    svg.setAttribute("class", "qr-code");
    if (code.background) {
      rect = doc.createElementNS(NS, "rect");
      rect.setAttribute("x", String(-code.pad));
      rect.setAttribute("y", String(-code.pad));
      rect.setAttribute("width", String(span));
      rect.setAttribute("height", String(span));
      rect.setAttribute("fill", code.background);
      svg.appendChild(rect);
    }
    appendShapes(svg, doc, code);
    return svg;
  }

  function requireText(value) {
    var text = value == null ? "" : String(value);
    if (!text) throw new Error("Nothing to encode.");
    return text;
  }

  function linkPayload(value) {
    var text = String(value == null ? "" : value).trim();
    if (!text) throw new Error("Nothing to encode.");
    if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return text;
    if (/\s/.test(text)) throw new Error("This is not a link.");
    return "https://" + text;
  }

  // lightning: plus a BOLT11 invoice or an LNURL. Uppercase keeps the
  // symbol in alphanumeric mode. Anything else with that scheme is kept
  // as written, so a wallet still receives the original text.
  function invoicePayload(value) {
    var raw = String(value == null ? "" : value).replace(/\s+/g, "");
    var body;
    var bolt;
    var lnurl;
    if (!raw) throw new Error("Nothing to encode.");
    body = raw.replace(/^lightning:/i, "");
    bolt = /^ln(bcrt|bc|tb)\d*[munp]?1[02-9ac-hj-np-z]+$/i.test(body);
    lnurl = /^lnurl1[02-9ac-hj-np-z]+$/i.test(body);
    if (bolt || lnurl) return "LIGHTNING:" + body.toUpperCase();
    if (/^lightning:/i.test(raw)) return raw;
    throw new Error("This is not a Lightning invoice.");
  }

  function cs77Qr(text, options) {
    var paintOpts;
    var symbol;
    if (!(this instanceof cs77Qr)) return new cs77Qr(text, options);
    paintOpts = readPaint(options);
    symbol = buildSymbol(requireText(text), normalizeLevel(options && options.level));
    this.text = symbol.text;
    this.mode = symbol.mode;
    this.version = symbol.version;
    this.level = symbol.level;
    this.size = symbol.size;
    this.modules = symbol.modules;
    this.blocks = symbol.blocks;
    this.color = paintOpts.color;
    this.shape = paintOpts.shape;
    this.background = paintOpts.background;
    this.pad = paintOpts.pad;
    this.scale = paintOpts.scale;
    this.label = paintOpts.label;
  }

  cs77Qr.prototype.get = function (x, y) {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return false;
    return this.modules[y * this.size + x] === 1;
  };

  cs77Qr.prototype.toSvg = function (doc) {
    var target = doc;
    if (!target && typeof document !== "undefined") target = document;
    return paint(this, target);
  };

  cs77Qr.prototype.toSvgSource = function () {
    return svgSource(this);
  };

  cs77Qr.link = function (url, options) {
    var opts = Object.assign({ label: "Link" }, options || {});
    return new cs77Qr(linkPayload(url), opts);
  };

  cs77Qr.text = function (value, options) {
    var opts = Object.assign({ label: "Text" }, options || {});
    return new cs77Qr(requireText(value), opts);
  };

  cs77Qr.invoice = function (value, options) {
    var opts = Object.assign({ label: "Lightning invoice" }, options || {});
    return new cs77Qr(invoicePayload(value), opts);
  };

  var NO_QR = "No QR code found.";
  // Format BCH can correct 3 of the 15 bits. Farther than that is a bad sample.
  var FORMAT_MAX_ERRORS = 3;
  var VERSION_MAX_ERRORS = 3;
  var KANJI_COUNT_BITS = [8, 10, 12];
  var LEVEL_FROM_EC = ["M", "L", "H", "Q"];

  function noQrError() {
    var err = new Error(NO_QR);
    err.code = "NO_QR";
    return err;
  }

  function gfMul(a, b) {
    if (!a || !b) return 0;
    return EXP[(LOG[a] + LOG[b]) % 255];
  }

  function gfInv(a) {
    return EXP[255 - LOG[a]];
  }

  function hamming(a, b) {
    var x = (a ^ b) >>> 0;
    var n = 0;
    while (x) {
      n += x & 1;
      x >>>= 1;
    }
    return n;
  }

  function pointDist(a, b) {
    var dx = a.x - b.x;
    var dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // The encoder's remainder is systematic: the first byte is the high term,
  // and a valid word evaluates to 0 at α^0 .. α^(nsym-1). The error magnitude
  // needs the extra factor of X. Without it, a damaged word is "fixed" to
  // the wrong bytes and still fails the syndrome check.
  function rsSyndromes(msg, nsym) {
    var syn = new Uint8Array(nsym);
    var i;
    var j;
    var y;
    var root;
    for (i = 0; i < nsym; i++) {
      y = 0;
      root = EXP[i];
      for (j = 0; j < msg.length; j++) {
        if (y) y = EXP[(LOG[y] + LOG[root]) % 255];
        y ^= msg[j];
      }
      syn[i] = y;
    }
    return syn;
  }

  function rsClean(syn) {
    var i;
    for (i = 0; i < syn.length; i++) if (syn[i]) return false;
    return true;
  }

  function rsCorrect(msg, nsym) {
    var syn = rsSyndromes(msg, nsym);
    var C;
    var B;
    var T;
    var L;
    var m;
    var b;
    var n;
    var i;
    var delta;
    var coef;
    var pos;
    var p;
    var exp;
    var x;
    var sum;
    var xp;
    var j;
    var X;
    var Xinv;
    var num;
    var den;
    var mag;
    var omega;
    var s;
    if (rsClean(syn)) return true;
    C = new Uint8Array(nsym * 2);
    B = new Uint8Array(nsym * 2);
    C[0] = 1;
    B[0] = 1;
    L = 0;
    m = 1;
    b = 1;
    for (n = 0; n < nsym; n++) {
      delta = syn[n];
      for (i = 1; i <= L; i++) delta ^= gfMul(C[i], syn[n - i]);
      if (!delta) {
        m++;
        continue;
      }
      T = C.slice();
      coef = gfMul(delta, gfInv(b));
      for (i = 0; i + m < C.length; i++) C[i + m] ^= gfMul(B[i], coef);
      if (2 * L <= n) {
        L = n + 1 - L;
        B = T;
        b = delta;
        m = 1;
      } else {
        m++;
      }
    }
    if (!L || L * 2 > nsym || !C[L]) return false;
    pos = [];
    for (p = 0; p < msg.length; p++) {
      exp = (msg.length - 1 - p) % 255;
      x = exp ? EXP[(255 - exp) % 255] : 1;
      sum = 0;
      xp = 1;
      for (j = 0; j <= L; j++) {
        sum ^= gfMul(C[j], xp);
        xp = gfMul(xp, x);
      }
      if (!sum) pos.push(p);
    }
    if (pos.length !== L) return false;
    omega = new Uint8Array(L);
    for (i = 0; i < L; i++) {
      s = 0;
      for (j = 0; j <= L && j <= i; j++) s ^= gfMul(C[j], syn[i - j]);
      omega[i] = s;
    }
    for (i = 0; i < pos.length; i++) {
      p = pos[i];
      exp = (msg.length - 1 - p) % 255;
      X = EXP[exp];
      Xinv = exp ? EXP[(255 - exp) % 255] : 1;
      num = 0;
      xp = 1;
      for (j = 0; j < L; j++) {
        num ^= gfMul(omega[j], xp);
        xp = gfMul(xp, Xinv);
      }
      den = 0;
      xp = 1;
      x = gfMul(Xinv, Xinv);
      for (j = 1; j <= L; j += 2) {
        den ^= gfMul(C[j], xp);
        xp = gfMul(xp, x);
      }
      if (!den) return false;
      mag = gfMul(gfMul(num, gfInv(den)), X);
      msg[p] ^= mag;
    }
    return rsClean(rsSyndromes(msg, nsym));
  }

  function splitBlocks(codewords, info) {
    var dataLens = [];
    var blocks = [];
    var i;
    var b;
    var p;
    var maxLen;
    for (i = 0; i < info.blocks; i++) {
      dataLens.push(info.blockLen + (i < info.shortBlocks ? 0 : 1));
      blocks.push(new Uint8Array(dataLens[i] + info.words));
    }
    p = 0;
    maxLen = info.blockLen + 1;
    for (i = 0; i < maxLen; i++) {
      for (b = 0; b < info.blocks; b++) {
        if (i < dataLens[b]) blocks[b][i] = codewords[p++];
      }
    }
    for (i = 0; i < info.words; i++) {
      for (b = 0; b < info.blocks; b++) blocks[b][dataLens[b] + i] = codewords[p++];
    }
    if (p !== codewords.length) return null;
    return { blocks: blocks, dataLens: dataLens };
  }

  function readCodewords(modules, func, size) {
    var total = totalBytes((size - 17) / 4);
    var out = new Uint8Array(total);
    var bit = 0;
    var limit = total * 8;
    var upward = true;
    var right;
    var vert;
    var y;
    var j;
    var x;
    var i;
    for (right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (vert = 0; vert < size; vert++) {
        y = upward ? size - 1 - vert : vert;
        for (j = 0; j < 2; j++) {
          x = right - j;
          i = y * size + x;
          if (func[i]) continue;
          if (bit < limit && modules[i]) out[bit >>> 3] |= 1 << (7 - (bit & 7));
          bit++;
        }
      }
      upward = !upward;
    }
    return out;
  }

  function readFormat(modules, size) {
    var a = 0;
    var b = 0;
    var i;
    var best;
    var bestDist;
    var mask;
    var level;
    var code;
    var dist;
    for (i = 0; i < 15; i++) {
      if (i < 6) { if (modules[i * size + 8]) a |= 1 << i; }
      else if (i < 8) { if (modules[(i + 1) * size + 8]) a |= 1 << i; }
      else if (i === 8) { if (modules[8 * size + 7]) a |= 1 << i; }
      else if (modules[8 * size + (14 - i)]) a |= 1 << i;
      if (i < 8) { if (modules[8 * size + (size - 1 - i)]) b |= 1 << i; }
      else if (modules[(size - 15 + i) * size + 8]) b |= 1 << i;
    }
    best = null;
    bestDist = FORMAT_MAX_ERRORS + 1;
    for (mask = 0; mask < 8; mask++) {
      for (i = 0; i < 4; i++) {
        level = LEVEL_FROM_EC[i];
        code = formatBits(level, mask);
        dist = hamming(a, code);
        if (hamming(b, code) < dist) dist = hamming(b, code);
        if (dist < bestDist) {
          bestDist = dist;
          best = { level: level, mask: mask };
        }
      }
    }
    return best;
  }

  function readVersionInfo(modules, size) {
    var bitsA;
    var bitsB;
    var i;
    var x;
    var y;
    var ver;
    var code;
    var dist;
    var best;
    var bestDist;
    var ties;
    if (size < 45) return 0;
    bitsA = 0;
    bitsB = 0;
    for (i = 0; i < 18; i++) {
      x = size - 11 + (i % 3);
      y = (i / 3) | 0;
      if (modules[y * size + x]) bitsA |= 1 << i;
      if (modules[x * size + y]) bitsB |= 1 << i;
    }
    best = 0;
    bestDist = VERSION_MAX_ERRORS + 1;
    ties = 0;
    for (ver = 7; ver <= 40; ver++) {
      code = versionBits(ver);
      dist = hamming(bitsA, code);
      if (hamming(bitsB, code) < dist) dist = hamming(bitsB, code);
      if (dist < bestDist) {
        bestDist = dist;
        best = ver;
        ties = 1;
      } else if (dist === bestDist) ties++;
    }
    if (!best || (ties > 1 && bestDist > 0)) return 0;
    return best;
  }

  function padDigits(value, width) {
    var s = String(value);
    while (s.length < width) s = "0" + s;
    return s;
  }

  function bytesToText(bytes, eci) {
    var encoding = "utf-8";
    if (eci === 1 || eci === 2 || eci === 3) encoding = "iso-8859-1";
    else if (eci === 20 || eci === 21) encoding = "shift_jis";
    else if (eci === 4) encoding = "iso-8859-2";
    try {
      return new TextDecoder(encoding).decode(bytes);
    } catch (err) {
      if (encoding === "utf-8") return null;
      try {
        return new TextDecoder("utf-8").decode(bytes);
      } catch (err2) {
        return null;
      }
    }
  }

  function parsePayload(bytes, version) {
    var bit = 0;
    var limit = bytes.length * 8;
    var text = "";
    var eci = null;
    var guard = 0;
    var mode;
    var group;
    var count;
    var val;
    var i;
    var high;
    var low;
    var sj;
    var chunk;
    var pair;
    var raw;

    function read(len) {
      var v = 0;
      var k;
      var pos;
      if (bit + len > limit) return -1;
      for (k = 0; k < len; k++) {
        pos = bit++;
        v = (v << 1) | ((bytes[pos >>> 3] >>> (7 - (pos & 7))) & 1);
      }
      return v;
    }

    group = countGroup(version);
    while (bit + 4 <= limit && guard++ < 64) {
      mode = read(4);
      if (mode <= 0) break;
      if (mode === 7) {
        val = read(8);
        if (val < 0) return null;
        if (val <= 0x7f) eci = val;
        else if (val <= 0xbf) {
          low = read(8);
          if (low < 0) return null;
          eci = ((val & 0x3f) << 8) | low;
        } else {
          high = read(8);
          low = read(8);
          if (high < 0 || low < 0) return null;
          eci = ((val & 0x1f) << 16) | (high << 8) | low;
        }
        continue;
      }
      if (mode === 5) continue;
      if (mode === 9) {
        if (read(8) < 0) return null;
        continue;
      }
      if (mode === 3) {
        if (read(16) < 0) return null;
        continue;
      }
      if (mode === 1) {
        count = read(COUNT_BITS.numeric[group]);
        if (count < 0) return null;
        while (count > 0) {
          if (count >= 3) {
            val = read(10);
            if (val < 0 || val > 999) return null;
            text += padDigits(val, 3);
            count -= 3;
          } else if (count === 2) {
            val = read(7);
            if (val < 0 || val > 99) return null;
            text += padDigits(val, 2);
            count = 0;
          } else {
            val = read(4);
            if (val < 0 || val > 9) return null;
            text += String(val);
            count = 0;
          }
        }
      } else if (mode === 2) {
        count = read(COUNT_BITS.alphanumeric[group]);
        if (count < 0) return null;
        while (count > 0) {
          if (count >= 2) {
            val = read(11);
            if (val < 0) return null;
            high = (val / 45) | 0;
            low = val % 45;
            if (high > 44 || low > 44) return null;
            text += ALNUM.charAt(high) + ALNUM.charAt(low);
            count -= 2;
          } else {
            val = read(6);
            if (val < 0 || val > 44) return null;
            text += ALNUM.charAt(val);
            count = 0;
          }
        }
      } else if (mode === 4) {
        count = read(COUNT_BITS.byte[group]);
        if (count < 0 || bit + count * 8 > limit) return null;
        chunk = new Uint8Array(count);
        for (i = 0; i < count; i++) chunk[i] = read(8);
        pair = bytesToText(chunk, eci);
        if (pair == null) return null;
        text += pair;
      } else if (mode === 8) {
        count = read(KANJI_COUNT_BITS[group]);
        if (count < 0) return null;
        raw = [];
        for (i = 0; i < count; i++) {
          val = read(13);
          if (val < 0) return null;
          high = (val / 0xc0) | 0;
          low = val % 0xc0;
          sj = high * 0x100 + low;
          sj += sj < 0x1f00 ? 0x8140 : 0xc140;
          raw.push((sj >>> 8) & 255, sj & 255);
        }
        chunk = new Uint8Array(raw);
        pair = bytesToText(chunk, 20);
        if (pair == null) return null;
        text += pair;
      } else return null;
    }
    return text;
  }

  function decodeGrid(modules, version) {
    var size = 17 + 4 * version;
    var stated;
    var format;
    var drawn;
    var unmasked;
    var y;
    var x;
    var i;
    var codewords;
    var parts;
    var data;
    var pos;
    var b;
    var text;
    if (modules.length !== size * size) return null;
    stated = readVersionInfo(modules, size);
    format = readFormat(modules, size);
    if (!format) return stated && stated !== version ? { redirect: stated } : null;
    drawn = drawTemplate(version);
    unmasked = new Uint8Array(modules);
    for (y = 0; y < size; y++) {
      for (x = 0; x < size; x++) {
        i = y * size + x;
        if (drawn.func[i]) continue;
        if (maskOn(format.mask, x, y)) unmasked[i] ^= 1;
      }
    }
    codewords = readCodewords(unmasked, drawn.func, size);
    parts = splitBlocks(codewords, capacity(version, format.level));
    if (!parts) return null;
    data = new Uint8Array(capacity(version, format.level).dataBytes);
    pos = 0;
    for (b = 0; b < parts.blocks.length; b++) {
      if (!rsCorrect(parts.blocks[b], capacity(version, format.level).words)) {
        return stated && stated !== version ? { redirect: stated } : null;
      }
      data.set(parts.blocks[b].subarray(0, parts.dataLens[b]), pos);
      pos += parts.dataLens[b];
    }
    text = parsePayload(data, version);
    if (text == null) return stated && stated !== version ? { redirect: stated } : null;
    return { text: text, level: format.level, version: version };
  }

  function solveLinear(rows, values) {
    var n = values.length;
    var M = [];
    var col;
    var i;
    var j;
    var max;
    var tmp;
    var factor;
    var x;
    var sum;
    for (i = 0; i < n; i++) {
      M[i] = rows[i].slice();
      M[i].push(values[i]);
    }
    for (col = 0; col < n; col++) {
      max = col;
      for (i = col + 1; i < n; i++) {
        if (Math.abs(M[i][col]) > Math.abs(M[max][col])) max = i;
      }
      tmp = M[col];
      M[col] = M[max];
      M[max] = tmp;
      if (Math.abs(M[col][col]) < 1e-10) return null;
      for (i = col + 1; i < n; i++) {
        factor = M[i][col] / M[col][col];
        if (!factor) continue;
        for (j = col; j <= n; j++) M[i][j] -= factor * M[col][j];
      }
    }
    x = new Array(n);
    for (i = n - 1; i >= 0; i--) {
      sum = M[i][n];
      for (j = i + 1; j < n; j++) sum -= M[i][j] * x[j];
      x[i] = sum / M[i][i];
    }
    return x;
  }

  function affineMap(src, dst) {
    var rows = [];
    var values = [];
    var i;
    var h;
    for (i = 0; i < 3; i++) {
      rows.push([src[i].x, src[i].y, 1, 0, 0, 0]);
      values.push(dst[i].x);
      rows.push([0, 0, 0, src[i].x, src[i].y, 1]);
      values.push(dst[i].y);
    }
    h = solveLinear(rows, values);
    if (!h) return null;
    return function (x, y) {
      return { x: h[0] * x + h[1] * y + h[2], y: h[3] * x + h[4] * y + h[5] };
    };
  }

  function perspectiveMap(src, dst) {
    var rows = [];
    var values = [];
    var i;
    var h;
    for (i = 0; i < 4; i++) {
      rows.push([src[i].x, src[i].y, 1, 0, 0, 0, -dst[i].x * src[i].x, -dst[i].x * src[i].y]);
      values.push(dst[i].x);
      rows.push([0, 0, 0, src[i].x, src[i].y, 1, -dst[i].y * src[i].x, -dst[i].y * src[i].y]);
      values.push(dst[i].y);
    }
    h = solveLinear(rows, values);
    if (!h) return null;
    return function (x, y) {
      var den = h[6] * x + h[7] * y + 1;
      if (Math.abs(den) < 1e-8) return { x: -1, y: -1 };
      return {
        x: (h[0] * x + h[1] * y + h[2]) / den,
        y: (h[3] * x + h[4] * y + h[5]) / den
      };
    };
  }

  function integralImage(gray, w, h) {
    var iw = w + 1;
    var out = new Uint32Array(iw * (h + 1));
    var y;
    var x;
    var row;
    for (y = 0; y < h; y++) {
      row = 0;
      for (x = 0; x < w; x++) {
        row += gray[y * w + x];
        out[(y + 1) * iw + (x + 1)] = out[y * iw + (x + 1)] + row;
      }
    }
    return out;
  }

  function rectSum(sum, iw, x0, y0, x1, y1) {
    return sum[(y1 + 1) * iw + (x1 + 1)] - sum[y0 * iw + (x1 + 1)] -
      sum[(y1 + 1) * iw + x0] + sum[y0 * iw + x0];
  }

  function localMean(sum, w, h, x, y, radius) {
    var x0 = x - radius;
    var y0 = y - radius;
    var x1 = x + radius;
    var y1 = y + radius;
    var area;
    if (x0 < 0) x0 = 0;
    if (y0 < 0) y0 = 0;
    if (x1 >= w) x1 = w - 1;
    if (y1 >= h) y1 = h - 1;
    area = (x1 - x0 + 1) * (y1 - y0 + 1);
    if (!area) return 127;
    return rectSum(sum, w + 1, x0, y0, x1, y1) / area;
  }

  // A pixel is a dark module when it is clearly darker than the window
  // around it, so a shadow across the photo does not flip the whole code.
  // Inverted codes (light modules on a dark page) flip that test.
  function pixelDark(gray, sum, w, h, x, y, radius, invert) {
    var ix = x | 0;
    var iy = y | 0;
    var g;
    var mean;
    if (ix < 0 || iy < 0 || ix >= w || iy >= h) return false;
    g = gray[iy * w + ix];
    mean = localMean(sum, w, h, ix, iy, radius);
    if (invert) return g * 4 > mean * 5;
    return g * 5 < mean * 4;
  }

  function sampleGray(gray, w, h, x, y) {
    var x0;
    var y0;
    var x1;
    var y1;
    var fx;
    var fy;
    var g00;
    var g10;
    var g01;
    var g11;
    if (x < 0 || y < 0 || x > w - 1 || y > h - 1) return 255;
    x0 = x | 0;
    y0 = y | 0;
    x1 = x0 + 1;
    y1 = y0 + 1;
    if (x1 >= w) x1 = w - 1;
    if (y1 >= h) y1 = h - 1;
    fx = x - x0;
    fy = y - y0;
    g00 = gray[y0 * w + x0];
    g10 = gray[y0 * w + x1];
    g01 = gray[y1 * w + x0];
    g11 = gray[y1 * w + x1];
    return (g00 * (1 - fx) + g10 * fx) * (1 - fy) + (g01 * (1 - fx) + g11 * fx) * fy;
  }

  function sampleDark(gray, sum, w, h, x, y, radius, invert) {
    var g;
    var mean;
    if (x < 0 || y < 0 || x > w - 1 || y > h - 1) return false;
    g = sampleGray(gray, w, h, x, y);
    mean = localMean(sum, w, h, x | 0, y | 0, radius);
    if (invert) return g * 4 > mean * 5;
    return g * 5 < mean * 4;
  }

  function binarize(gray, sum, w, h, radius, invert) {
    var bin = new Uint8Array(w * h);
    var y;
    var x;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        if (pixelDark(gray, sum, w, h, x, y, radius, invert)) bin[y * w + x] = 1;
      }
    }
    return bin;
  }

  function ratioOk(a, b, c, d, e) {
    var total = a + b + c + d + e;
    var m;
    var t;
    if (total < 7) return false;
    m = total / 7;
    t = m / 2;
    return Math.abs(a - m) <= t &&
      Math.abs(b - m) <= t &&
      Math.abs(c - 3 * m) <= 3 * t &&
      Math.abs(d - m) <= t &&
      Math.abs(e - m) <= t;
  }

  // Alignment sits in the data, so the outer black ring can merge with
  // several neighboring modules. Judge the inner white-black-white, and
  // only require the outer runs to be present and not enormous.
  function alignMeasure(a, b, c, d, e) {
    var m = (b + c + d) / 3;
    var t;
    if (m < 1) return 0;
    t = m * 0.75;
    if (Math.abs(b - m) > t || Math.abs(c - m) > t || Math.abs(d - m) > t) return 0;
    if (a < m * 0.35 || e < m * 0.35 || a > m * 8 || e > m * 8) return 0;
    return m;
  }

  // The horizontal scan hits every row of the center module. The pattern's
  // center is the middle of the black run through that hit.
  function blackRunCenter(bin, w, h, x, y) {
    var ix = x | 0;
    var iy = y | 0;
    var up = 0;
    var down = 0;
    var yy;
    if (ix < 0 || iy < 0 || ix >= w || iy >= h || !bin[iy * w + ix]) return y;
    for (yy = iy - 1; yy >= 0 && bin[yy * w + ix]; yy--) {
      up++;
      if (up > 48) break;
    }
    for (yy = iy + 1; yy < h && bin[yy * w + ix]; yy++) {
      down++;
      if (down > 48) break;
    }
    return iy + (down - up) / 2;
  }

  // Walk one line through a black pixel and rebuild the five finder runs.
  function crossAt(bin, w, h, x, y, dx, dy) {
    var back0 = 0;
    var back1 = 0;
    var leftCenter = 0;
    var rightCenter = 0;
    var fwd1 = 0;
    var fwd0 = 0;
    var nx;
    var ny;
    var sx;
    var sy;
    var bit;
    var state;
    var want;
    var c2;
    var total;
    var shift;
    x = x | 0;
    y = y | 0;
    if (x < 0 || y < 0 || x >= w || y >= h || !bin[y * w + x]) return null;
    nx = x;
    ny = y;
    state = 2;
    want = 1;
    while (state >= 0) {
      sx = nx - dx;
      sy = ny - dy;
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) break;
      bit = bin[sy * w + sx] ? 1 : 0;
      if (bit !== want) {
        state--;
        want = want ? 0 : 1;
        continue;
      }
      if (state === 2) leftCenter++;
      else if (state === 1) back1++;
      else back0++;
      nx = sx;
      ny = sy;
    }
    if (!back0 || !back1) return null;
    nx = x;
    ny = y;
    state = 2;
    want = 1;
    while (state <= 4) {
      sx = nx + dx;
      sy = ny + dy;
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) break;
      bit = bin[sy * w + sx] ? 1 : 0;
      if (bit !== want) {
        state++;
        want = want ? 0 : 1;
        continue;
      }
      if (state === 2) rightCenter++;
      else if (state === 3) fwd1++;
      else fwd0++;
      nx = sx;
      ny = sy;
    }
    if (!fwd1 || !fwd0) return null;
    c2 = leftCenter + 1 + rightCenter;
    if (!ratioOk(back0, back1, c2, fwd1, fwd0)) return null;
    total = back0 + back1 + c2 + fwd1 + fwd0;
    shift = (rightCenter - leftCenter) / 2;
    return {
      x: x + dx * shift,
      y: y + dy * shift,
      total: total,
      moduleSize: total / 7
    };
  }

  function addFinder(list, found) {
    var i;
    var item;
    var d;
    var n;
    for (i = 0; i < list.length; i++) {
      item = list[i];
      d = pointDist(item, found);
      if (d < Math.max(item.moduleSize, found.moduleSize) * 2) {
        n = item.count + 1;
        item.x = (item.x * item.count + found.x) / n;
        item.y = (item.y * item.count + found.y) / n;
        item.moduleSize = (item.moduleSize * item.count + found.moduleSize) / n;
        item.count = n;
        return;
      }
    }
    found.count = 1;
    list.push(found);
  }

  function maybeFinder(bin, w, h, c0, c1, c2, c3, c4, x, y, list) {
    var total;
    var centerX;
    var ix;
    var vert;
    var iy;
    var diag;
    if (!ratioOk(c0, c1, c2, c3, c4)) return false;
    total = c0 + c1 + c2 + c3 + c4;
    centerX = x - c4 - c3 - c2 / 2;
    ix = centerX | 0;
    if (ix < 0 || ix >= w) return true;
    vert = crossAt(bin, w, h, ix, y | 0, 0, 1);
    if (!vert) return true;
    if (Math.abs(vert.total - total) > total * 0.45) return true;
    iy = vert.y | 0;
    diag = crossAt(bin, w, h, ix, iy, 1, 1);
    if (!diag) return true;
    addFinder(list, {
      x: centerX,
      y: vert.y,
      moduleSize: (total / 7 + vert.moduleSize) / 2
    });
    return true;
  }

  function findFinders(bin, w, h) {
    var list = [];
    var y;
    var x;
    var counts;
    var state;
    var row;
    var rowHits;
    for (y = 0; y < h; y++) {
      counts = [0, 0, 0, 0, 0];
      state = 0;
      row = y * w;
      rowHits = 0;
      for (x = 0; x < w; x++) {
        if (bin[row + x]) {
          if (state & 1) {
            state++;
            counts[state] = 1;
          } else counts[state]++;
        } else if (state & 1) {
          counts[state]++;
        } else if (state === 4) {
          // A noisy row can look like a finder many times. Cap the expensive
          // cross-checks, but keep scanning later rows so a low finder is not dropped.
          if (rowHits < 12 && maybeFinder(bin, w, h, counts[0], counts[1], counts[2], counts[3], counts[4], x, y, list)) {
            rowHits++;
          }
          counts[0] = counts[2];
          counts[1] = counts[3];
          counts[2] = counts[4];
          counts[3] = 1;
          counts[4] = 0;
          state = 3;
        } else {
          state++;
          counts[state] = 1;
        }
      }
      if (state === 4) {
        maybeFinder(bin, w, h, counts[0], counts[1], counts[2], counts[3], counts[4], w, y, list);
      }
    }
    return list;
  }

  function orderFinders(a, b, c) {
    var ab = pointDist(a, b);
    var ac = pointDist(a, c);
    var bc = pointDist(b, c);
    var tl;
    var p1;
    var p2;
    var cross;
    if (bc >= ab && bc >= ac) {
      tl = a;
      p1 = b;
      p2 = c;
    } else if (ac >= ab && ac >= bc) {
      tl = b;
      p1 = a;
      p2 = c;
    } else {
      tl = c;
      p1 = a;
      p2 = b;
    }
    if (pointDist(tl, p1) < (tl.moduleSize + p1.moduleSize) * 4) return null;
    if (pointDist(tl, p2) < (tl.moduleSize + p2.moduleSize) * 4) return null;
    // Screen y grows downward, so a negative cross puts p1 at the bottom left.
    cross = (p1.x - tl.x) * (p2.y - tl.y) - (p1.y - tl.y) * (p2.x - tl.x);
    if (cross < 0) return { tl: tl, tr: p2, bl: p1 };
    if (cross > 0) return { tl: tl, tr: p1, bl: p2 };
    return null;
  }

  function finderTriplets(list) {
    var src = list.slice().sort(function (a, b) { return b.count - a.count; });
    var out = [];
    var i;
    var j;
    var k;
    if (src.length > 5) src.length = 5;
    for (i = 0; i < src.length; i++) {
      for (j = i + 1; j < src.length; j++) {
        for (k = j + 1; k < src.length; k++) out.push([src[i], src[j], src[k]]);
      }
    }
    out.sort(function (a, b) {
      return (b[0].count + b[1].count + b[2].count) - (a[0].count + a[1].count + a[2].count);
    });
    if (out.length > 8) out.length = 8;
    return out;
  }

  function estimateVersion(tl, tr, bl) {
    var mod = (tl.moduleSize + tr.moduleSize + bl.moduleSize) / 3;
    var size;
    var ver;
    if (!(mod > 0)) return 1;
    size = (pointDist(tl, tr) + pointDist(tl, bl)) / 2 / mod + 7;
    ver = Math.round((size - 17) / 4);
    if (ver < 1) return 1;
    if (ver > 40) return 40;
    return ver;
  }

  function crossAlign(bin, w, h, x, y, dx, dy) {
    var runs = [0, 0, 0, 0, 0];
    var nx = x | 0;
    var ny = y | 0;
    var state;
    var want;
    var sx;
    var sy;
    var bit;
    var i;
    if (nx < 0 || ny < 0 || nx >= w || ny >= h || !bin[ny * w + nx]) return 0;
    runs[2] = 1;
    state = 2;
    want = 1;
    nx = x | 0;
    ny = y | 0;
    while (state >= 0) {
      sx = nx - dx;
      sy = ny - dy;
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) break;
      bit = bin[sy * w + sx] ? 1 : 0;
      if (bit !== want) {
        state--;
        want = want ? 0 : 1;
        continue;
      }
      runs[state]++;
      nx = sx;
      ny = sy;
    }
    state = 2;
    want = 1;
    nx = x | 0;
    ny = y | 0;
    while (state <= 4) {
      sx = nx + dx;
      sy = ny + dy;
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) break;
      bit = bin[sy * w + sx] ? 1 : 0;
      if (bit !== want) {
        state++;
        want = want ? 0 : 1;
        continue;
      }
      runs[state]++;
      nx = sx;
      ny = sy;
    }
    for (i = 0; i < 5; i++) if (!runs[i]) return 0;
    return alignMeasure(runs[0], runs[1], runs[2], runs[3], runs[4]);
  }

  function findAlignment(bin, w, h, expectX, expectY, modulePx) {
    var reach = Math.max(3, modulePx * 6);
    var x0 = Math.max(0, Math.floor(expectX - reach));
    var y0 = Math.max(0, Math.floor(expectY - reach));
    var x1 = Math.min(w - 1, Math.ceil(expectX + reach));
    var y1 = Math.min(h - 1, Math.ceil(expectY + reach));
    var best = null;
    var bestD = modulePx * 4;
    var y;
    var x;
    var counts;
    var state;
    var row;
    var total;
    var centerX;
    var ix;
    var iy;
    var mod;
    var d;
    for (y = y0; y <= y1; y++) {
      counts = [0, 0, 0, 0, 0];
      state = 0;
      row = y * w;
      // Scan the whole row. Starting at the window edge cuts a run in half
      // and the alignment pattern never forms.
      for (x = 0; x < w; x++) {
        if (bin[row + x]) {
          if (state & 1) {
            state++;
            counts[state] = 1;
          } else counts[state]++;
        } else if (state & 1) {
          counts[state]++;
        } else if (state === 4) {
          total = alignMeasure(counts[0], counts[1], counts[2], counts[3], counts[4]);
          centerX = x - counts[4] - counts[3] - counts[2] / 2;
          if (total && centerX >= x0 && centerX <= x1 && Math.abs(total - modulePx) <= modulePx * 0.85) {
            ix = centerX | 0;
            iy = blackRunCenter(bin, w, h, ix, y);
            mod = crossAlign(bin, w, h, ix, iy | 0, 0, 1);
            d = Math.hypot(centerX - expectX, iy - expectY);
            // A skewed photo bends the vertical run. A hit that lands on the
            // affine estimate is kept even when that cross-check misses.
            if (d < bestD && ((mod && Math.abs(mod - modulePx) <= modulePx * 0.85) || d < modulePx * 2)) {
              bestD = d;
              best = { x: centerX, y: iy };
            }
          }
          counts[0] = counts[2];
          counts[1] = counts[3];
          counts[2] = counts[4];
          counts[3] = 1;
          counts[4] = 0;
          state = 3;
        } else {
          state++;
          counts[state] = 1;
        }
      }
    }
    return best;
  }

  function sampleGrid(transform, size, gray, sum, w, h, radius, invert) {
    var modules = new Uint8Array(size * size);
    var y;
    var x;
    var p;
    for (y = 0; y < size; y++) {
      for (x = 0; x < size; x++) {
        p = transform(x + 0.5, y + 0.5);
        if (sampleDark(gray, sum, w, h, p.x, p.y, radius, invert)) modules[y * size + x] = 1;
      }
    }
    return modules;
  }

  function gridCorners(transform, size) {
    return [
      transform(0, 0),
      transform(size, 0),
      transform(size, size),
      transform(0, size)
    ];
  }

  function mapGrid(map, size, gray, sum, w, h, radius, invert, version) {
    var modules = sampleGrid(map, size, gray, sum, w, h, radius, invert);
    var decoded = decodeGrid(modules, version);
    if (!decoded) return null;
    if (decoded.redirect) return decoded;
    return {
      data: decoded.text,
      version: decoded.version,
      level: decoded.level,
      cornerPoints: gridCorners(map, size)
    };
  }

  function tryVersion(bin, gray, sum, w, h, radius, invert, tl, tr, bl, version, redirected) {
    var size = 17 + 4 * version;
    var src = [
      { x: 3.5, y: 3.5 },
      { x: size - 3.5, y: 3.5 },
      { x: 3.5, y: size - 3.5 }
    ];
    var dst = [tl, tr, bl];
    var map = affineMap(src, dst);
    var hit;
    var redirect;
    var modulePx;
    var centers;
    var expect;
    var align;
    var persp;
    if (!map) return null;
    // A flat photo decodes from the three finders. Perspective is only a
    // second try, so a jittery alignment target cannot warp a good sample.
    hit = mapGrid(map, size, gray, sum, w, h, radius, invert, version);
    if (hit && hit.data != null) return hit;
    redirect = hit && hit.redirect;
    if (version >= 2) {
      modulePx = pointDist(tl, tr) / (size - 7);
      centers = alignmentCenters(version);
      expect = map(centers[centers.length - 1] + 0.5, centers[centers.length - 1] + 0.5);
      align = findAlignment(bin, w, h, expect.x, expect.y, modulePx);
      if (align) {
        persp = perspectiveMap(
          src.concat([{ x: centers[centers.length - 1] + 0.5, y: centers[centers.length - 1] + 0.5 }]),
          dst.concat([align])
        );
        if (persp) {
          hit = mapGrid(persp, size, gray, sum, w, h, radius, invert, version);
          if (hit && hit.data != null) return hit;
          if (hit && hit.redirect) redirect = hit.redirect;
        }
      }
    }
    if (!redirected && redirect && redirect !== version && redirect >= 1 && redirect <= 40) {
      return tryVersion(bin, gray, sum, w, h, radius, invert, tl, tr, bl, redirect, true);
    }
    return null;
  }

  function decodeTriplet(bin, gray, sum, w, h, radius, invert, trio) {
    var ordered = orderFinders(trio[0], trio[1], trio[2]);
    var ver;
    var delta;
    var version;
    var hit;
    if (!ordered) return null;
    ver = estimateVersion(ordered.tl, ordered.tr, ordered.bl);
    for (delta = 0; delta <= 1; delta++) {
      version = delta ? ver - 1 : ver;
      if (version < 1 || version > 40) continue;
      hit = tryVersion(bin, gray, sum, w, h, radius, invert, ordered.tl, ordered.tr, ordered.bl, version, false);
      if (hit) return hit;
      if (!delta) {
        version = ver + 1;
        if (version <= 40) {
          hit = tryVersion(bin, gray, sum, w, h, radius, invert, ordered.tl, ordered.tr, ordered.bl, version, false);
          if (hit) return hit;
        }
      }
    }
    return null;
  }

  function decodeBinary(bin, gray, sum, w, h, radius, invert) {
    var found = findFinders(bin, w, h);
    var trips;
    var i;
    var hit;
    if (found.length < 3) return null;
    trips = finderTriplets(found);
    for (i = 0; i < trips.length; i++) {
      hit = decodeTriplet(bin, gray, sum, w, h, radius, invert, trips[i]);
      if (hit) return hit;
    }
    return null;
  }

  function grayWeights(options) {
    var w = options && (options.weights || options.grayscaleWeights);
    var r = 76;
    var g = 150;
    var b = 30;
    if (w && typeof w === "object") {
      r = Number(w.r != null ? w.r : w.red);
      g = Number(w.g != null ? w.g : w.green);
      b = Number(w.b != null ? w.b : w.blue);
    } else if (options && options.red != null) {
      r = Number(options.red);
      g = Number(options.green);
      b = Number(options.blue);
    }
    if (!(r >= 0) || !(g >= 0) || !(b >= 0)) return { r: 76, g: 150, b: 30 };
    if (r <= 1 && g <= 1 && b <= 1 && r + g + b <= 1.01) {
      return { r: Math.round(r * 256), g: Math.round(g * 256), b: Math.round(b * 256) };
    }
    return { r: r, g: g, b: b };
  }

  function toGray(data, w, h, weights) {
    var gray = new Uint8Array(w * h);
    var i;
    var o;
    var r;
    var g;
    var b;
    var a;
    var y;
    for (i = 0, o = 0; i < data.length; i += 4, o++) {
      r = data[i];
      g = data[i + 1];
      b = data[i + 2];
      a = data[i + 3];
      if (a < 255) {
        r = (r * a + 255 * (255 - a)) / 255;
        g = (g * a + 255 * (255 - a)) / 255;
        b = (b * a + 255 * (255 - a)) / 255;
      }
      y = (weights.r * r + weights.g * g + weights.b * b + 128) >> 8;
      gray[o] = y > 255 ? 255 : y;
    }
    return gray;
  }

  function downscaleRgba(data, w, h, maxSide) {
    var scale = Math.max(w, h) / maxSide;
    var nw = Math.max(1, Math.round(w / scale));
    var nh = Math.max(1, Math.round(h / scale));
    var out = new Uint8ClampedArray(nw * nh * 4);
    var y;
    var x;
    var sy0;
    var sy1;
    var sx0;
    var sx1;
    var yy;
    var xx;
    var r;
    var g;
    var b;
    var a;
    var n;
    var si;
    var di;
    for (y = 0; y < nh; y++) {
      sy0 = (y * h / nh) | 0;
      sy1 = ((y + 1) * h / nh) | 0;
      if (sy1 <= sy0) sy1 = sy0 + 1;
      for (x = 0; x < nw; x++) {
        sx0 = (x * w / nw) | 0;
        sx1 = ((x + 1) * w / nw) | 0;
        if (sx1 <= sx0) sx1 = sx0 + 1;
        r = 0;
        g = 0;
        b = 0;
        a = 0;
        n = 0;
        for (yy = sy0; yy < sy1 && yy < h; yy++) {
          for (xx = sx0; xx < sx1 && xx < w; xx++) {
            si = (yy * w + xx) * 4;
            r += data[si];
            g += data[si + 1];
            b += data[si + 2];
            a += data[si + 3];
            n++;
          }
        }
        di = (y * nw + x) * 4;
        out[di] = r / n;
        out[di + 1] = g / n;
        out[di + 2] = b / n;
        out[di + 3] = a / n;
      }
    }
    return { data: out, width: nw, height: nh, scaleX: w / nw, scaleY: h / nh };
  }

  function inversionList(options) {
    var mode = options && (options.inversionMode || options.inversion);
    if (mode === "invert" || mode === "inverted") return ["invert"];
    if (mode === "original" || mode === "none") return ["original"];
    return ["original", "invert"];
  }

  function radiiFor(w, h) {
    var small = w < h ? w : h;
    var primary = Math.max(2, Math.round(small / 10));
    var tight = Math.max(2, Math.round(small / 18));
    if (tight === primary) return [primary];
    return [primary, tight];
  }

  function scalePoints(points, scaleX, scaleY) {
    var i;
    if (scaleX === 1 && scaleY === 1) return points;
    for (i = 0; i < points.length; i++) {
      points[i] = { x: points[i].x * scaleX, y: points[i].y * scaleY };
    }
    return points;
  }

  function decodePrepared(rgba, width, height, options) {
    var packed;
    var scaleX = 1;
    var scaleY = 1;
    var weights;
    var gray;
    var sum;
    var modes;
    var radii;
    var mi;
    var ri;
    var invert;
    var bin;
    var hit;
    if (width > 720 || height > 720) {
      packed = downscaleRgba(rgba, width, height, 720);
      rgba = packed.data;
      width = packed.width;
      height = packed.height;
      scaleX = packed.scaleX;
      scaleY = packed.scaleY;
    }
    weights = grayWeights(options);
    gray = toGray(rgba, width, height, weights);
    sum = integralImage(gray, width, height);
    modes = inversionList(options);
    radii = radiiFor(width, height);
    for (mi = 0; mi < modes.length; mi++) {
      invert = modes[mi] === "invert";
      for (ri = 0; ri < radii.length; ri++) {
        bin = binarize(gray, sum, width, height, radii[ri], invert);
        hit = decodeBinary(bin, gray, sum, width, height, radii[ri], invert);
        if (hit) {
          hit.cornerPoints = scalePoints(hit.cornerPoints, scaleX, scaleY);
          return hit;
        }
      }
    }
    return null;
  }

  function isImageData(src) {
    return !!src && src.data && typeof src.width === "number" && typeof src.height === "number" &&
      src.data.length >= src.width * src.height * 4 && typeof src.getContext !== "function" &&
      typeof src.play !== "function";
  }

  // Synchronous read of a screenshot. imageData is { data, width, height }
  // with RGBA bytes. Returns { data, cornerPoints } or null.
  function decodeImageData(imageData, options) {
    if (!isImageData(imageData) || imageData.width < 11 || imageData.height < 11) return null;
    return decodePrepared(imageData.data, imageData.width | 0, imageData.height | 0, options || null);
  }

  var detectorState = { disabled: false, promise: null };

  function disableDetector() {
    detectorState.disabled = true;
    detectorState.promise = Promise.resolve(null);
  }

  // Chromium on an Apple Silicon Mac running macOS Ventura reports a
  // BarcodeDetector that never returns a code. The software decoder is
  // used there instead. Same failure nimiq/qr-scanner works around.
  function macDetectorBroken() {
    var ua = typeof navigator !== "undefined" ? navigator.userAgentData : null;
    if (!ua || !ua.brands || typeof ua.getHighEntropyValues !== "function") return Promise.resolve(false);
    var chromium = false;
    var i;
    for (i = 0; i < ua.brands.length; i++) {
      if (/Chromium/i.test(ua.brands[i].brand || "")) chromium = true;
    }
    if (!chromium || !/mac ?OS/i.test(ua.platform || "")) return Promise.resolve(false);
    return ua.getHighEntropyValues(["architecture", "platformVersion"]).then(function (info) {
      var arch = info && info.architecture ? info.architecture : "arm";
      var version = parseInt(info && info.platformVersion ? info.platformVersion : "13", 10);
      return /arm/i.test(arch) && version >= 13;
    }, function () {
      return true;
    });
  }

  function probeDetector() {
    if (detectorState.disabled) return Promise.resolve(null);
    if (typeof BarcodeDetector !== "function" || typeof BarcodeDetector.getSupportedFormats !== "function") {
      return Promise.resolve(null);
    }
    return BarcodeDetector.getSupportedFormats().then(function (formats) {
      if (!formats || formats.indexOf("qr_code") < 0) return false;
      return macDetectorBroken().then(function (broken) { return !broken; });
    }).then(function (ok) {
      if (!ok) return null;
      try {
        return new BarcodeDetector({ formats: ["qr_code"] });
      } catch (err) {
        return null;
      }
    }, function () {
      return null;
    });
  }

  function loadDetector() {
    if (detectorState.disabled) return Promise.resolve(null);
    if (!detectorState.promise) detectorState.promise = probeDetector();
    return detectorState.promise;
  }

  function detectorFailed(err) {
    var msg = String(err && err.message ? err.message : err || "");
    return /not implemented|service unavailable|not supported/i.test(msg);
  }

  function copyPoints(points) {
    var out = [];
    var i;
    var p;
    if (!points || !points.length) return out;
    for (i = 0; i < points.length; i++) {
      p = points[i];
      out.push({ x: Number(p.x) || 0, y: Number(p.y) || 0 });
    }
    return out;
  }

  function sourceSize(src) {
    if (src && typeof src.videoWidth === "number" && src.videoWidth > 0) {
      return { width: src.videoWidth, height: src.videoHeight };
    }
    if (src && typeof src.naturalWidth === "number" && src.naturalWidth > 0) {
      return { width: src.naturalWidth, height: src.naturalHeight };
    }
    if (src && src.width > 0 && src.height > 0) return { width: src.width, height: src.height };
    return null;
  }

  function clampRegion(region, sw, sh) {
    var x = Math.max(0, Math.round(region && region.x ? region.x : 0));
    var y = Math.max(0, Math.round(region && region.y ? region.y : 0));
    var w = region && region.width ? Math.round(region.width) : sw - x;
    var h = region && region.height ? Math.round(region.height) : sh - y;
    var dw;
    var dh;
    if (x >= sw || y >= sh) return null;
    if (x + w > sw) w = sw - x;
    if (y + h > sh) h = sh - y;
    if (w < 11 || h < 11) return null;
    dw = region && region.downScaledWidth ? Math.round(region.downScaledWidth) : w;
    dh = region && region.downScaledHeight ? Math.round(region.downScaledHeight) : h;
    if (dw > w) dw = w;
    if (dh > h) dh = h;
    if (Math.abs(dw / dh - w / h) > 0.02) dh = Math.max(1, Math.round(dw * h / w));
    return { x: x, y: y, width: w, height: h, downScaledWidth: dw, downScaledHeight: dh };
  }

  function mapPoints(points, region) {
    var sx;
    var sy;
    var out = [];
    var i;
    if (!region) return points;
    sx = region.width / region.downScaledWidth;
    sy = region.height / region.downScaledHeight;
    for (i = 0; i < points.length; i++) {
      out.push({ x: points[i].x * sx + region.x, y: points[i].y * sy + region.y });
    }
    return out;
  }

  function makeCanvas(canvas) {
    if (canvas && typeof canvas.getContext === "function") return canvas;
    if (typeof document === "undefined" || typeof document.createElement !== "function") return null;
    return document.createElement("canvas");
  }

  function drawSource(src, region, canvas) {
    var view = sourceSize(src);
    var box;
    var ctx;
    var shot;
    if (!view) return null;
    box = clampRegion(region || { x: 0, y: 0, width: view.width, height: view.height }, view.width, view.height);
    if (!box) return null;
    canvas = makeCanvas(canvas);
    if (!canvas) return null;
    canvas.width = box.downScaledWidth;
    canvas.height = box.downScaledHeight;
    ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(src, box.x, box.y, box.width, box.height, 0, 0, box.downScaledWidth, box.downScaledHeight);
    shot = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return { canvas: canvas, imageData: shot, region: box };
  }

  function loadUrl(url, revoke) {
    return new Promise(function (resolve, reject) {
      var img;
      if (typeof Image !== "function") {
        reject(new Error("This browser cannot load that image."));
        return;
      }
      img = new Image();
      img.onload = function () {
        if (revoke) URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = function () {
        if (revoke) URL.revokeObjectURL(url);
        reject(new Error("Could not load that image."));
      };
      if (!revoke) img.crossOrigin = "anonymous";
      img.src = url;
    });
  }

  function loadSource(src) {
    if (isImageData(src)) return Promise.resolve(src);
    if (src && (typeof src.videoWidth === "number" || typeof src.naturalWidth === "number" ||
      typeof src.getContext === "function" || (typeof ImageBitmap !== "undefined" && src instanceof ImageBitmap))) {
      return Promise.resolve(src);
    }
    if (typeof Blob !== "undefined" && src instanceof Blob) {
      return loadUrl(URL.createObjectURL(src), true);
    }
    if (typeof src === "string" || (typeof URL !== "undefined" && src instanceof URL)) {
      return loadUrl(String(src), false);
    }
    return Promise.reject(new Error("Cannot read a QR code from that."));
  }

  function detectOnCanvas(canvas) {
    return loadDetector().then(function (detector) {
      if (!detector || !canvas) return null;
      return detector.detect(canvas).then(function (found) {
        if (!found || !found.length) return null;
        return { data: String(found[0].rawValue || ""), cornerPoints: copyPoints(found[0].cornerPoints) };
      }, function (err) {
        if (detectorFailed(err)) disableDetector();
        return null;
      });
    });
  }

  function finishHit(hit, region) {
    if (!hit) return null;
    return {
      data: hit.data,
      cornerPoints: mapPoints(hit.cornerPoints || [], region),
      version: hit.version,
      level: hit.level
    };
  }

  // Picture, video frame, canvas, blob, or URL. Rejects when nothing is found.
  // BarcodeDetector runs first. A miss falls through to the software decoder
  // so an inverted code still reads when the native detector skips it.
  function scanImage(source, options) {
    var opts = options || {};
    var forceSoftware = opts.engine === "software" || opts.decoder === "software";
    return loadSource(source).then(function (loaded) {
      var region = opts.scanRegion || null;
      if (isImageData(loaded) && (forceSoftware || typeof document === "undefined")) {
        var direct = decodeImageData(loaded, opts);
        if (!direct) throw noQrError();
        return finishHit(direct, null);
      }
      var frame = drawSource(isImageData(loaded) ? imageDataCanvas(loaded) : loaded, region, opts.canvas);
      if (!frame) {
        if (isImageData(loaded)) {
          var fallback = decodeImageData(loaded, opts);
          if (!fallback) throw noQrError();
          return finishHit(fallback, null);
        }
        throw noQrError();
      }
      var native = forceSoftware ? Promise.resolve(null) : detectOnCanvas(frame.canvas);
      return native.then(function (hit) {
        if (hit) return finishHit(hit, frame.region);
        var soft = decodeImageData(frame.imageData, opts);
        if (soft) return finishHit(soft, frame.region);
        if (region && opts.alsoTryWithoutScanRegion) {
          return scanImage(loaded, {
            engine: forceSoftware ? "software" : opts.engine,
            decoder: opts.decoder,
            canvas: opts.canvas,
            inversionMode: opts.inversionMode || opts.inversion,
            weights: opts.weights,
            grayscaleWeights: opts.grayscaleWeights,
            red: opts.red,
            green: opts.green,
            blue: opts.blue
          });
        }
        throw noQrError();
      });
    });
  }

  function imageDataCanvas(imageData) {
    var canvas = makeCanvas(null);
    var ctx;
    if (!canvas) return null;
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  function stopTracks(stream) {
    var tracks;
    var i;
    if (!stream || typeof stream.getTracks !== "function") return;
    tracks = stream.getTracks();
    for (i = 0; i < tracks.length; i++) {
      try { tracks[i].stop(); } catch (err) { /* already ended */ }
    }
  }

  function cameraAttempts(preferred) {
    var bases = [{ width: { min: 1024 } }, { width: { min: 768 } }, {}];
    var exact = [];
    var plain = [];
    var i;
    var video;
    var key = preferred === "environment" || preferred === "user" ? "facingMode" : "deviceId";
    for (i = 0; i < bases.length; i++) {
      plain.push(bases[i]);
      if (!preferred) continue;
      video = {};
      if (bases[i].width) video.width = bases[i].width;
      video[key] = { exact: preferred };
      exact.push(video);
    }
    return exact.concat(plain);
  }

  function facingOf(stream, preferred) {
    var track = stream.getVideoTracks()[0];
    var settings = track && track.getSettings ? track.getSettings() : null;
    if (settings && (settings.facingMode === "user" || settings.facingMode === "environment")) {
      return settings.facingMode;
    }
    if (preferred === "user" || preferred === "environment") return preferred;
    return "environment";
  }

  function openCamera(preferred) {
    var videos;
    var i;
    if (typeof navigator === "undefined" || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return Promise.reject(new Error("This browser has no camera."));
    }
    videos = cameraAttempts(preferred);
    i = 0;
    function next() {
      if (i >= videos.length) return Promise.reject(new Error("Camera not found."));
      return navigator.mediaDevices.getUserMedia({ audio: false, video: videos[i++] }).then(function (stream) {
        return { stream: stream, facing: facingOf(stream, preferred) };
      }, function () {
        return next();
      });
    }
    return next();
  }

  function defaultScanRegion(video) {
    var vw = video.videoWidth || 0;
    var vh = video.videoHeight || 0;
    var small;
    var side;
    var down;
    if (!vw || !vh) return null;
    small = vw < vh ? vw : vh;
    side = Math.round(small * 2 / 3);
    if (side < 32) side = small;
    down = side > 450 ? 450 : side;
    return {
      x: Math.round((vw - side) / 2),
      y: Math.round((vh - side) / 2),
      width: side,
      height: side,
      downScaledWidth: down,
      downScaledHeight: down
    };
  }

  function trackHasTorch(track) {
    var caps;
    if (!track) return false;
    if (typeof track.getCapabilities === "function") {
      caps = track.getCapabilities();
      if (caps && caps.torch) return true;
    }
    if (typeof track.getSettings === "function" && track.getSettings() && ("torch" in track.getSettings())) return true;
    return false;
  }

  // Live scan. onResult is called with { data, cornerPoints } for each hit.
  // start() asks for the camera. stop() releases it.
  function Scanner(video, onResult, options) {
    var opts = options || {};
    if (!(this instanceof Scanner)) return new Scanner(video, onResult, options);
    if (!video || typeof video.play !== "function") throw new Error("Pass a video element.");
    this.video = video;
    this.canvas = makeCanvas(opts.canvas);
    this._onResult = typeof onResult === "function" ? onResult : function () {};
    this._onError = typeof opts.onDecodeError === "function" ? opts.onDecodeError : null;
    this._preferred = opts.preferredCamera || "environment";
    this._maxScans = opts.maxScansPerSecond > 0 ? opts.maxScansPerSecond : 25;
    this._regionFn = typeof opts.calculateScanRegion === "function" ? opts.calculateScanRegion : null;
    this._inversion = opts.inversionMode || opts.inversion || "both";
    this._weights = grayWeights(opts);
    this._active = false;
    this._destroyed = false;
    this._pumping = false;
    this._epoch = 0;
    this._last = 0;
    this._flash = false;
    this._facing = "environment";
    video.playsInline = true;
    video.muted = true;
    if (typeof video.setAttribute === "function") {
      video.setAttribute("playsinline", "");
      video.setAttribute("muted", "");
    }
    var self = this;
    this._onVis = function () {
      if (typeof document === "undefined") return;
      if (document.hidden) self._hold();
      else if (self._active) self.start();
    };
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", this._onVis);
  }

  Scanner.prototype._region = function () {
    if (this._regionFn) {
      try {
        return this._regionFn(this.video) || defaultScanRegion(this.video);
      } catch (err) {
        return defaultScanRegion(this.video);
      }
    }
    return defaultScanRegion(this.video);
  };

  Scanner.prototype._dropStream = function () {
    if (this.video.srcObject && typeof this.video.srcObject.getTracks === "function") {
      stopTracks(this.video.srcObject);
    }
    this.video.srcObject = null;
  };

  Scanner.prototype._hold = function () {
    try { this.video.pause(); } catch (err) { /* not playing */ }
    this._dropStream();
  };

  Scanner.prototype._fail = function (err) {
    if (!err || err.code === "NO_QR" || String(err.message || err) === NO_QR) return;
    if (this._onError) this._onError(err);
  };

  Scanner.prototype._pump = function () {
    var self = this;
    var request;
    if (self._pumping || !self._active || self._destroyed) return;
    self._pumping = true;
    request = typeof self.video.requestVideoFrameCallback === "function"
      ? function (fn) { self.video.requestVideoFrameCallback(function () { fn(); }); }
      : function (fn) { requestAnimationFrame(fn); };
    function idle() {
      return !self._active || self._destroyed || (typeof document !== "undefined" && document.hidden);
    }
    function schedule() {
      if (idle()) {
        self._pumping = false;
        return;
      }
      request(function () {
        var wait;
        if (idle()) {
          self._pumping = false;
          return;
        }
        if (self.video.readyState <= 1) {
          schedule();
          return;
        }
        wait = (1000 / self._maxScans) - (Date.now() - self._last);
        if (wait > 5) {
          setTimeout(run, wait);
          return;
        }
        run();
      });
    }
    function run() {
      var region;
      var frame;
      if (idle()) {
        self._pumping = false;
        return;
      }
      self._last = Date.now();
      region = self._region();
      if (!region) {
        schedule();
        return;
      }
      try {
        frame = drawSource(self.video, region, self.canvas);
      } catch (err) {
        self._fail(err);
        schedule();
        return;
      }
      if (!frame) {
        schedule();
        return;
      }
      self.canvas = frame.canvas;
      detectOnCanvas(frame.canvas).then(function (hit) {
        if (!hit) hit = decodeImageData(frame.imageData, {
          inversionMode: self._inversion,
          weights: self._weights
        });
        if (hit && self._active) self._onResult(finishHit(hit, frame.region));
        schedule();
      }, function (err) {
        self._fail(err);
        schedule();
      });
    }
    schedule();
  };

  Scanner.prototype.start = function () {
    var self = this;
    var epoch;
    if (self._destroyed) return Promise.reject(new Error("This scanner has been closed."));
    self._active = true;
    if (typeof document !== "undefined" && document.hidden) return Promise.resolve();
    if (self.video.srcObject) {
      return self.video.play().then(function () {
        self._pump();
      });
    }
    epoch = ++self._epoch;
    if (typeof location !== "undefined" && location.protocol && location.protocol !== "https:" && location.hostname !== "localhost") {
      if (typeof console !== "undefined") console.warn("The camera stream is only available over https.");
    }
    return openCamera(self._preferred).then(function (opened) {
      if (!self._active || self._epoch !== epoch || self._destroyed) {
        stopTracks(opened.stream);
        return;
      }
      self._dropStream();
      self._facing = opened.facing;
      self.video.srcObject = opened.stream;
      return self.video.play().then(function () {
        self._pump();
        if (self._flash) return self.turnFlashOn();
      });
    }).catch(function (err) {
      if (self._epoch === epoch) self._active = false;
      throw err;
    });
  };

  Scanner.prototype.stop = function () {
    var self = this;
    self._active = false;
    self._epoch++;
    self._flash = false;
    try { self.video.pause(); } catch (err) { /* not playing */ }
    setTimeout(function () {
      if (!self._active) self._dropStream();
    }, 300);
  };

  Scanner.prototype.destroy = function () {
    this._destroyed = true;
    this.stop();
    if (typeof document !== "undefined" && this._onVis) {
      document.removeEventListener("visibilitychange", this._onVis);
    }
  };

  Scanner.prototype.setCamera = function (facingModeOrDeviceId) {
    if (!facingModeOrDeviceId || facingModeOrDeviceId === this._preferred) return Promise.resolve();
    this._preferred = facingModeOrDeviceId;
    if (!this._active) return Promise.resolve();
    this._dropStream();
    this._epoch++;
    return this.start();
  };

  Scanner.prototype.setInversionMode = function (mode) {
    if (mode === "invert" || mode === "inverted" || mode === "original" || mode === "both" || mode === "none") {
      this._inversion = mode === "none" ? "original" : mode;
    }
  };

  Scanner.prototype.setGrayscaleWeights = function (red, green, blue) {
    this._weights = grayWeights({ red: red, green: green, blue: blue });
  };

  Scanner.prototype.facingMode = function () {
    return this._facing;
  };

  Scanner.prototype.hasFlash = function () {
    var stream = this.video.srcObject;
    var track;
    if (!stream || typeof stream.getVideoTracks !== "function") return Promise.resolve(false);
    track = stream.getVideoTracks()[0];
    return Promise.resolve(trackHasTorch(track));
  };

  Scanner.prototype.isFlashOn = function () {
    return this._flash;
  };

  // torch:false does not turn the lamp off on every browser, so the
  // stream is reopened instead.
  Scanner.prototype.turnFlashOff = function () {
    var was = this._active;
    this._flash = false;
    if (!was || !this.video.srcObject) return Promise.resolve();
    this._dropStream();
    this._epoch++;
    return this.start();
  };

  Scanner.prototype.turnFlashOn = function () {
    var self = this;
    var stream;
    var track;
    if (self._destroyed) return Promise.resolve();
    self._flash = true;
    stream = self.video.srcObject;
    if (!stream || typeof stream.getVideoTracks !== "function") return Promise.resolve();
    track = stream.getVideoTracks()[0];
    if (!trackHasTorch(track)) {
      self._flash = false;
      return Promise.reject(new Error("This camera has no flash."));
    }
    return track.applyConstraints({ advanced: [{ torch: true }] }).catch(function (err) {
      self._flash = false;
      throw err;
    });
  };

  Scanner.prototype.toggleFlash = function () {
    if (this._flash) return this.turnFlashOff();
    return this.turnFlashOn();
  };

  function listCameras(requestLabels) {
    function listed() {
      return navigator.mediaDevices.enumerateDevices().then(function (devices) {
        var out = [];
        var i;
        var cam;
        var n = 0;
        for (i = 0; i < devices.length; i++) {
          if (devices[i].kind !== "videoinput") continue;
          n++;
          cam = devices[i];
          out.push({
            id: cam.deviceId,
            label: cam.label || (n === 1 ? "Default Camera" : "Camera " + n)
          });
        }
        return out;
      });
    }
    if (typeof navigator === "undefined" || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      return Promise.resolve([]);
    }
    if (!requestLabels) return listed().catch(function () { return []; });
    return listed().then(function (cams) {
      var labeled = false;
      var i;
      for (i = 0; i < cams.length; i++) if (cams[i].label && cams[i].label.indexOf("Camera") !== 0 && cams[i].label !== "Default Camera") labeled = true;
      if (!cams.length || labeled) return cams;
      return navigator.mediaDevices.getUserMedia({ audio: false, video: true }).then(function (opened) {
        return listed().then(function (full) {
          stopTracks(opened);
          return full;
        }, function () {
          stopTracks(opened);
          return cams;
        });
      }, function () {
        return cams;
      });
    }).catch(function () { return []; });
  }

  cs77Qr.decode = function (imageData, options) {
    return decodeImageData(imageData, options || null);
  };

  cs77Qr.scanImage = function (source, options) {
    return scanImage(source, options || null);
  };

  cs77Qr.hasCamera = function () {
    return listCameras(false).then(function (cams) { return cams.length > 0; }, function () { return false; });
  };

  cs77Qr.listCameras = function (requestLabels) {
    return listCameras(!!requestLabels);
  };

  cs77Qr.Scanner = Scanner;
  cs77Qr.NO_QR = NO_QR;

  // Hive WIF shape only. The checksum is checked when the page uses the key.
  function looksLikeHiveWif(compact) {
    return /^5[1-9A-HJ-NP-Za-km-z]{49,52}$/.test(compact);
  }

  function keychainRoleKey(keys, role) {
    var pub;
    var compact;
    if (!keys || (role !== "posting" && role !== "active" && role !== "memo" && role !== "owner")) return "";
    pub = keys[role + "Pubkey"];
    if (typeof pub === "string" && pub.trim().charAt(0) === "@") return "";
    if (typeof keys[role] !== "string") return "";
    compact = keys[role].replace(/\s+/g, "");
    if (!compact || compact.charAt(0) === "#" || compact.charAt(0) === "@") return "";
    if (!looksLikeHiveWif(compact)) return "";
    return compact;
  }

  // One Keychain account QR. The bulk add_accounts export is rejected.
  function keychainAccount(text, role) {
    var raw = String(text || "").trim();
    var lower;
    var prefix = "keychain://add_account=";
    var json = "";
    var data;
    var keys;
    var name;
    var wif;
    var empty = { ok: false, name: "", wif: "", error: "format" };
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1).trim();
    lower = raw.toLowerCase();
    if (lower.indexOf("keychain://add_accounts=") === 0) {
      return { ok: false, name: "", wif: "", error: "plural" };
    }
    if (lower.indexOf(prefix) === 0) json = raw.slice(prefix.length);
    else if (raw.charAt(0) === "{") json = raw;
    else return empty;
    try {
      data = JSON.parse(json);
    } catch (err) {
      return empty;
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) return empty;
    keys = data.keys;
    if (!keys || typeof keys !== "object" || Array.isArray(keys)) return empty;
    name = typeof data.name === "string" ? data.name : "";
    wif = keychainRoleKey(keys, role);
    if (!wif) return { ok: false, name: name, wif: "", error: "role" };
    return { ok: true, name: name, wif: wif, error: "" };
  }

  cs77Qr.keychainAccount = keychainAccount;

  function compactPrivateKey(text) {
    var compact = String(text || "").replace(/^\uFEFF/, "").replace(/\s+/g, "");
    if (!looksLikeHiveWif(compact)) return "";
    return compact;
  }

  // The text painted into a private-key symbol. Empty when it is not a WIF.
  function privateKeyText(text) {
    return compactPrivateKey(text);
  }

  // A scanned symbol that contains only a private key.
  function privateKey(text) {
    var wif = compactPrivateKey(text);
    if (!wif) return { ok: false, wif: "", error: "format" };
    return { ok: true, wif: wif, error: "" };
  }

  cs77Qr.privateKeyText = privateKeyText;
  cs77Qr.privateKey = privateKey;

  // The username in a CyberSpace profile URL. The profile dialog encodes
  // https://cyberspace77.com/@username and nothing after the name.
  function profileUser(text) {
    var raw = String(text || "").trim();
    var url;
    var host;
    var path;
    var name;
    var empty = { ok: false, name: "", error: "format" };
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1).trim();
    if (!raw) return empty;
    try {
      url = new URL(raw);
    } catch (err) {
      return empty;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return empty;
    host = String(url.hostname || "").replace(/\.$/, "").toLowerCase();
    if (host !== "cyberspace77.com" && host !== "www.cyberspace77.com" && host !== "alpha.cyberspace77.com") {
      return empty;
    }
    path = String(url.pathname || "");
    try {
      path = decodeURIComponent(path);
    } catch (err) {
      return empty;
    }
    if (path.length > 1) path = path.replace(/\/+$/, "");
    if (path.charAt(0) !== "/" || path.charAt(1) !== "@") return empty;
    name = path.slice(2).toLowerCase();
    if (!name || name.indexOf("/") !== -1) return empty;
    if (name.length < 3 || name.length > 16) return empty;
    if (!/^[a-z][a-z0-9.-]*[a-z0-9]$/.test(name)) return empty;
    return { ok: true, name: name, error: "" };
  }

  cs77Qr.profileUser = profileUser;

  global.cs77Qr = cs77Qr;
})(typeof window !== "undefined" ? window : globalThis);
