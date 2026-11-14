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

  global.cs77Qr = cs77Qr;
})(typeof window !== "undefined" ? window : globalThis);
