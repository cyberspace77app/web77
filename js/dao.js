/**
 * DAO pages. Loaded only for /dao, /witnesses, /proposals, and /witness/@name.
 * Witness pay follows database::process_funds after HF28: inflation is minted
 * from HIVE supply plus non-treasury HBD, and the witness slice is multiplied
 * by 21 before the schedule weight is applied.
 */
(function (global) {
  "use strict";

  var BLOCKS_PER_YEAR = 10512000n;
  var BLOCKS_PER_DAY = 28800n;
  var WITNESS_ROUND = 21n;
  var PERCENT = 10000n;
  var INFLATION_START_BP = 978n;
  var INFLATION_FLOOR_BP = 95n;
  var INFLATION_NARROWING = 250000n;
  var NULL_KEY = "STM1111111111111111111111111111111114T1Anm";
  var RANK_PAGE = 30;
  var SEARCH_PAGE = 20;
  var RANK_SCAN_PAGE = 100;
  var RANK_SCAN_PAGES = 5;
  var NEAR_PX = 700;

  var state = {
    host: null,
    gen: 0,
    listGen: 0,
    mode: "",
    listMode: "rank",
    props: null,
    schedule: null,
    rewards: null,
    interest: null,
    majority: "",
    ranked: emptyBucket(),
    search: emptyBucket(),
    votes: emptyVotes(),
    pending: new Set(),
    searchTimer: 0,
    composing: false,
    detailName: "",
    detailWitness: null,
    detailAccount: null,
  };

  function emptyBucket() {
    return {
      query: "",
      rows: [],
      cursor: "",
      done: false,
      loading: false,
      hold: false,
      error: "",
    };
  }

  function emptyVotes() {
    return { user: "", names: new Set(), proxy: "", expired: false, ready: true };
  }

  function md() {
    return global.HiveMd;
  }

  function api() {
    return global.HiveApi;
  }

  function esc(value) {
    return md().escapeHtml(value == null ? "" : String(value));
  }

  function alive(gen, listGen) {
    if (!state.host || !state.host.still()) return false;
    if (gen != null && state.gen !== gen) return false;
    if (listGen != null && state.listGen !== listGen) return false;
    return true;
  }

  function writeView(gen, html) {
    if (!alive(gen)) return false;
    var view = document.getElementById("view");
    if (!view) return false;
    view.innerHTML = html;
    return true;
  }

  function assetInt(raw, decimals) {
    var s = String(raw == null ? "" : raw).trim();
    var matched = s.match(/-?\d+(?:\.\d+)?/);
    if (!matched) return 0n;
    var neg = matched[0].charAt(0) === "-";
    var body = neg ? matched[0].slice(1) : matched[0];
    var bits = body.split(".");
    var whole = bits[0] || "0";
    var frac = bits[1] || "";
    var places = decimals > 0 ? decimals : 0;
    if (frac.length > places) frac = frac.slice(0, places);
    while (frac.length < places) frac += "0";
    try {
      var n = BigInt(whole + (places ? frac : ""));
      return neg ? -n : n;
    } catch (err) {
      return 0n;
    }
  }

  function divRound(n, d) {
    if (d === 0n) return 0n;
    var neg = (n < 0n) !== (d < 0n);
    var a = n < 0n ? -n : n;
    var b = d < 0n ? -d : d;
    var q = (a + b / 2n) / b;
    return neg ? -q : q;
  }

  function bigIntOf(value, fallback) {
    if (typeof value === "bigint") return value;
    var s = String(value == null ? "" : value).trim();
    if (/^-?\d+$/.test(s)) return BigInt(s);
    var n = Number(value);
    if (Number.isFinite(n)) return BigInt(Math.trunc(n));
    return fallback;
  }

  function formatHiveMilli(milli) {
    var neg = milli < 0n;
    var n = neg ? -milli : milli;
    var whole = (n / 1000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    var frac = (n % 1000n).toString();
    while (frac.length < 3) frac = "0" + frac;
    return (neg ? "-" : "") + whole + "." + frac;
  }

  function compactHp(milli) {
    if (milli == null) return "—";
    var neg = milli < 0n;
    var v = Number(neg ? -milli : milli) / 1000;
    if (!Number.isFinite(v)) return "—";
    var text;
    if (v >= 1e9) text = (v / 1e9).toFixed(2) + "B";
    else if (v >= 1e6) text = (v / 1e6).toFixed(1) + "M";
    else if (v >= 1e4) text = (v / 1e3).toFixed(1) + "K";
    else if (v >= 100) text = String(Math.round(v));
    else text = v.toFixed(1);
    return (neg ? "-" : "") + text;
  }

  function formatCount(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) return "—";
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
  }

  function hiveTime(created) {
    if (!created) return NaN;
    var s = String(created);
    if (s.indexOf("1970-01-01") === 0) return NaN;
    if (/Z$/i.test(s) || /[+-]\d{2}:\d{2}$/.test(s)) return Date.parse(s);
    return Date.parse(s + "Z");
  }

  function ageLabel(sec) {
    var n = sec < 0 ? 0 : Math.round(sec);
    if (n < 60) return n + "s";
    if (n < 3600) return Math.floor(n / 60) + "m";
    if (n < 86400) return Math.floor(n / 3600) + "h";
    return Math.floor(n / 86400) + "d";
  }

  function assetSymbol(raw) {
    var s = String(raw || "").toUpperCase();
    if (s.indexOf("HBD") !== -1) return "HBD";
    if (s.indexOf("HIVE") !== -1) return "HIVE";
    return "";
  }

  function hbdToHiveMilli(hbdMilli, price) {
    if (!price) return null;
    if (hbdMilli <= 0n) return 0n;
    var baseSym = assetSymbol(price.base);
    var quoteSym = assetSymbol(price.quote);
    var base = assetInt(price.base, 3);
    var quote = assetInt(price.quote, 3);
    if (base <= 0n || quote <= 0n) return null;
    if (baseSym === "HIVE" && quoteSym === "HBD") {
      var swap = base;
      base = quote;
      quote = swap;
    }
    return (hbdMilli * quote) / base;
  }

  function versionParts(value) {
    var matched = String(value || "").match(/\d+/g);
    if (!matched) return [];
    return matched.map(function (part) {
      return Number(part);
    });
  }

  function versionBehind(running, majority) {
    if (!majority) return false;
    var a = versionParts(running);
    var b = versionParts(majority);
    if (!a.length || !b.length) return false;
    var n = Math.max(a.length, b.length);
    var i;
    for (i = 0; i < n; i += 1) {
      var av = a[i] || 0;
      var bv = b[i] || 0;
      if (av < bv) return true;
      if (av > bv) return false;
    }
    return false;
  }

  function isDisabled(witness) {
    var key = String((witness && witness.signing_key) || "");
    return !key || key === NULL_KEY;
  }

  function witnessName(witness) {
    return String((witness && witness.owner) || "").toLowerCase();
  }

  function normalizeQuery(raw) {
    return String(raw || "")
      .trim()
      .replace(/^@+/, "")
      .toLowerCase();
  }

  function validQuery(query) {
    return /^[a-z0-9.\-]{1,16}$/.test(query);
  }

  function accountName(raw) {
    var name = normalizeQuery(raw);
    return /^[a-z0-9.\-]{3,16}$/.test(name) ? name : "";
  }

  function percentText(rate) {
    var n = Number(rate);
    if (!Number.isFinite(n)) return "—";
    var pct = n / 100;
    var text = Math.abs(pct - Math.round(pct)) < 0.05 ? String(Math.round(pct)) : pct.toFixed(1);
    return text + "%";
  }

  function glassHtml() {
    return '<button type="submit" class="community-search-glass" aria-label="Search"><svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter"><path d="M3.9 7.15V3.9h3.25"/><path d="M12.85 3.9h3.25v3.25"/><path d="M7.15 16.1H3.9v-3.25"/><circle cx="10" cy="10" r="5.15"/><path d="M10 6.55v1.25M10 12.2v1.25M6.55 10h1.25M12.2 10h1.25"/><circle cx="10" cy="10" r="0.7" fill="currentColor" stroke="none"/></g><path class="community-search-handle" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="square" d="M16 16 21.15 21.15"/></svg></button>';
  }

  function navHtml(active) {
    var current = active === "witness" ? "witnesses" : active;
    var items = [
      ["dao", "/dao", "DAO"],
      ["witnesses", "/witnesses", "Witnesses"],
      ["proposals", "/proposals", "Proposals"],
    ];
    return (
      '<nav class="feed-nav subpage-nav" aria-label="DAO">' +
      items
        .map(function (item) {
          var on = item[0] === current;
          return (
            '<a href="' +
            esc(state.host.appHref(item[1])) +
            '"' +
            (on ? ' class="is-active" aria-current="page"' : "") +
            ">" +
            item[2] +
            "</a>"
          );
        })
        .join("") +
      "</nav>"
    );
  }

  function defaultSchedule() {
    return {
      elected: 1n,
      timeshare: 5n,
      miner: 1n,
      norm: 25n,
      top: 20n,
      runners: 1n,
      miners: 0n,
      majority: "",
    };
  }

  function normalizeSchedule(raw) {
    var row = raw && typeof raw === "object" ? raw : {};
    var schedule = defaultSchedule();
    if (row.elected_weight != null) schedule.elected = bigIntOf(row.elected_weight, 1n);
    if (row.timeshare_weight != null) schedule.timeshare = bigIntOf(row.timeshare_weight, 5n);
    if (row.miner_weight != null) schedule.miner = bigIntOf(row.miner_weight, 1n);
    if (row.witness_pay_normalization_factor != null) {
      schedule.norm = bigIntOf(row.witness_pay_normalization_factor, 25n);
    }
    if (row.max_voted_witnesses != null) schedule.top = bigIntOf(row.max_voted_witnesses, 20n);
    if (row.max_runner_witnesses != null) schedule.runners = bigIntOf(row.max_runner_witnesses, 1n);
    if (row.max_miner_witnesses != null) schedule.miners = bigIntOf(row.max_miner_witnesses, 0n);
    if (!schedule.norm) schedule.norm = 25n;
    schedule.majority = String(row.majority_version || "");
    return schedule;
  }

  function computeRewards(props, fundAccount, price, schedule) {
    var head = bigIntOf(props && props.head_block_number, 0n);
    var rate = INFLATION_START_BP - head / INFLATION_NARROWING;
    if (rate < INFLATION_FLOOR_BP) rate = INFLATION_FLOOR_BP;
    var supply = assetInt(props && props.current_supply, 3);
    var hbd = assetInt(props && props.current_hbd_supply, 3);
    var treasury = assetInt(fundAccount && fundAccount.hbd_balance, 3);
    var excess = hbd - treasury;
    if (excess < 0n) excess = 0n;
    var virtual = assetInt(props && props.virtual_supply, 3);
    if (price) {
      var converted = hbdToHiveMilli(excess, price);
      if (converted != null) virtual = supply + converted;
    }
    var minted = (virtual * rate) / (PERCENT * BLOCKS_PER_YEAR);
    var contentPct = bigIntOf(props && props.content_reward_percent, 0n);
    var vestPct = bigIntOf(props && props.vesting_reward_percent, 0n);
    var dhfRaw = props && props.proposal_fund_percent != null ? props.proposal_fund_percent : props && props.sps_fund_percent;
    var dhfPct = bigIntOf(dhfRaw, 0n);
    var content = (minted * contentPct) / PERCENT;
    var vesting = (minted * vestPct) / PERCENT;
    var dhf = (minted * dhfPct) / PERCENT;
    var witness = minted - content - vesting - dhf;
    if (witness < 0n) witness = 0n;
    witness *= WITNESS_ROUND;
    var norm = schedule.norm || 25n;
    var elected = (witness * schedule.elected) / norm;
    var timeshare = (witness * schedule.timeshare) / norm;
    var miner = (witness * schedule.miner) / norm;
    var perRound = elected * schedule.top + timeshare * schedule.runners + miner * schedule.miners;
    return {
      elected: elected,
      daily: divRound(perRound * BLOCKS_PER_DAY, WITNESS_ROUND),
      avg: divRound(elected * BLOCKS_PER_DAY, WITNESS_ROUND),
    };
  }

  function hpOf(votesRaw) {
    var micro = assetInt(votesRaw, 0);
    var props = state.props;
    if (!props) return { compact: "—", full: "", milli: null };
    var fund = assetInt(props.total_vesting_fund_hive || props.total_vesting_fund, 3);
    var vest = assetInt(props.total_vesting_shares, 6);
    if (fund <= 0n || vest <= 0n) return { compact: "—", full: "", milli: null };
    var milli = divRound(micro * fund, vest);
    var full = formatHiveMilli(milli) + " HP";
    return { compact: compactHp(milli), full: full, milli: milli };
  }

  function lastBlockOf(witness) {
    var props = state.props;
    var last = Number(witness && witness.last_aslot);
    var head = Number(props && props.head_block_number);
    var slot = Number(props && props.current_aslot);
    if (!props || !last || !head || !slot) return { label: "—", title: "No block produced" };
    var gap = slot - last;
    if (gap < 0) gap = 0;
    var num = head - gap;
    if (num < 1) return { label: "—", title: "No block produced" };
    return {
      label: ageLabel(gap * 3),
      title: "Block " + formatCount(num),
      text: formatCount(num) + " · " + ageLabel(gap * 3),
    };
  }

  function feedOf(witness) {
    var rate = witness && witness.hbd_exchange_rate;
    var base = rate && rate.base;
    var quote = rate && rate.quote;
    var baseAmt = assetInt(base, 3);
    var quoteAmt = assetInt(quote, 3);
    if (baseAmt <= 0n || quoteAmt <= 0n) return { label: "—", title: "" };
    var baseSym = assetSymbol(base);
    var quoteSym = assetSymbol(quote);
    var hbd = baseAmt;
    var hive = quoteAmt;
    if (baseSym === "HIVE" && quoteSym === "HBD") {
      hbd = quoteAmt;
      hive = baseAmt;
    }
    var price = Number(hbd) / Number(hive);
    if (!Number.isFinite(price) || price <= 0) return { label: "—", title: "" };
    var label = "$" + price.toFixed(3);
    var updated = hiveTime(witness.last_hbd_exchange_update);
    var title = String(base || "") + " / " + String(quote || "");
    var age = "";
    if (Number.isFinite(updated)) {
      age = ageLabel((Date.now() - updated) / 1000);
      title += " · " + age + " ago";
    }
    return { label: label, title: title, text: age ? label + " · " + age : label };
  }

  function aprOf(witness) {
    var props = witness && witness.props;
    return percentText(props && props.hbd_interest_rate);
  }

  function aboutOf(account) {
    var posting = md().parseJsonMetadata(account && account.posting_json_metadata);
    var legacy = md().parseJsonMetadata(account && account.json_metadata);
    var info = (posting && posting.profile) || (legacy && legacy.profile) || {};
    return String((info && info.about) || "").trim();
  }

  function httpUrl(witness) {
    var url = String((witness && witness.url) || "").trim();
    if (!/^https?:\/\//i.test(url)) return "";
    return url;
  }

  function monthYear(created) {
    var ts = hiveTime(created);
    if (!Number.isFinite(ts)) return "";
    try {
      return new Intl.DateTimeFormat("en", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(ts));
    } catch (err) {
      return "";
    }
  }

  function voteButtonHtml(name) {
    var user = state.votes.user;
    var proxy = user && state.votes.proxy;
    var voted = !proxy && state.votes.names.has(name);
    var pending = state.pending.has(name);
    var waiting = Boolean(user) && !state.votes.ready;
    var disabled = Boolean(proxy) || pending || waiting;
    var label = proxy ? "Proxy" : voted ? "Voted" : "Vote";
    var aria = proxy
      ? "Witness votes follow @" + proxy
      : (voted ? "Remove vote for @" : "Vote for @") + name;
    return (
      '<button type="button" class="btn-primary btn-compact witness-vote' +
      (voted ? " is-voted" : "") +
      '" data-vote="' +
      esc(name) +
      '" aria-pressed="' +
      (voted ? "true" : "false") +
      '" aria-label="' +
      esc(aria) +
      '"' +
      (proxy ? ' title="Witness votes follow @' + esc(proxy) + '"' : "") +
      (pending ? ' aria-busy="true"' : "") +
      (disabled ? " disabled" : "") +
      ">" +
      label +
      "</button>"
    );
  }

  function rowHtml(witness, rank, listMode) {
    var name = witnessName(witness);
    var top = listMode === "rank" && rank > 0 && rank <= 20;
    var disabled = isDisabled(witness);
    var version = String(witness.running_version || "—");
    var behind = !disabled && versionBehind(version, state.majority);
    var hp = hpOf(witness.votes);
    var last = lastBlockOf(witness);
    var feed = feedOf(witness);
    var versionClass = disabled ? " is-disabled" : behind ? " is-behind" : "";
    var versionText = disabled ? "disabled" : version;
    var versionTitle = behind && state.majority ? "Majority is " + state.majority : "";
    return (
      '<article class="witness-row' +
      (top ? " is-top" : "") +
      '" data-witness="' +
      esc(name) +
      '">' +
      '<span class="witness-rank">' +
      (listMode === "rank" && rank > 0 ? esc(String(rank)) : "") +
      "</span>" +
      '<a class="witness-who" href="' +
      esc(state.host.appHref("/witness/@" + name)) +
      '">' +
      '<img class="avatar" src="' +
      esc(md().avatarUrl(name, "small")) +
      '" alt="" width="28" height="28" onerror="this.onerror=null;this.src=\'/assets/satoshi-small.png\'">' +
      '<span class="witness-name">@' +
      esc(name) +
      "</span></a>" +
      '<span class="witness-cells">' +
      '<span class="witness-cell" data-label="Votes"' +
      (hp.full ? ' title="' + esc(hp.full) + '"' : "") +
      ">" +
      esc(hp.compact) +
      "</span>" +
      '<span class="witness-cell" data-label="Last block"' +
      (last.title ? ' title="' + esc(last.title) + '"' : "") +
      ">" +
      esc(last.label) +
      "</span>" +
      '<span class="witness-cell" data-label="Missed">' +
      esc(formatCount(witness.total_missed)) +
      "</span>" +
      '<span class="witness-cell" data-label="Price feed"' +
      (feed.title ? ' title="' + esc(feed.title) + '"' : "") +
      ">" +
      esc(feed.label) +
      "</span>" +
      '<span class="witness-cell' +
      versionClass +
      '" data-label="Version"' +
      (versionTitle ? ' title="' + esc(versionTitle) + '"' : "") +
      ">" +
      esc(versionText) +
      "</span>" +
      '<span class="witness-cell" data-label="APR" title="HBD interest this witness votes for">' +
      esc(aprOf(witness)) +
      "</span></span>" +
      voteButtonHtml(name) +
      "</article>"
    );
  }

  function rowsHtml(rows, listMode) {
    var html = [];
    rows.forEach(function (witness, index) {
      var rank = listMode === "rank" ? index + 1 : 0;
      if (listMode === "rank" && rank === 21) {
        html.push(
          '<p class="witness-split">Below the top 20, one backup witness produces the next block in each round.</p>'
        );
      }
      html.push(rowHtml(witness, rank, listMode));
    });
    return html.join("");
  }

  function setStatus(message, isError) {
    var el = document.getElementById("daoStatus");
    if (!el) return;
    if (!message) {
      el.hidden = true;
      el.textContent = "";
      el.classList.remove("is-error");
      return;
    }
    el.hidden = false;
    el.textContent = message;
    el.classList.toggle("is-error", Boolean(isError));
  }

  function setMore(on) {
    var el = document.getElementById("witnessMore");
    if (el) el.hidden = !on;
  }

  function setRetry(on) {
    var el = document.getElementById("witnessRetry");
    if (el) el.hidden = !on;
  }

  function paintStats() {
    var rewards = state.rewards;
    var block = document.getElementById("daoBlock");
    var daily = document.getElementById("daoDaily");
    var avg = document.getElementById("daoAvg");
    if (!block || !daily || !avg || !rewards) return;
    block.textContent = formatHiveMilli(rewards.elected);
    daily.textContent = formatHiveMilli(rewards.daily);
    avg.textContent = formatHiveMilli(rewards.avg);
  }

  function paintInterest() {
    var el = document.getElementById("witnessInterest");
    if (!el) return;
    if (state.interest == null) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.textContent =
      "The HBD savings rate is the median of the top 20. It is " +
      percentText(state.interest) +
      " now. The APR column is the rate each witness is voting for.";
  }

  function voteNoteText() {
    if (!state.votes.user || !state.votes.ready) return "";
    var lines = [];
    if (state.votes.proxy) lines.push("Witness votes follow @" + state.votes.proxy + ".");
    else lines.push("Voting for " + state.votes.names.size + " of 30 witnesses.");
    if (state.votes.expired) {
      lines.push("This account's governance vote has expired. Voting for a witness restores its weight.");
    }
    return lines.join(" ");
  }

  function paintVoteNote() {
    var el = document.getElementById("daoVoteNote");
    if (!el) return;
    var text = voteNoteText();
    el.hidden = !text;
    el.textContent = text;
  }

  function paintVoteButtons() {
    var buttons = document.querySelectorAll(".witness-vote[data-vote]");
    buttons.forEach(function (btn) {
      var name = btn.getAttribute("data-vote") || "";
      var user = state.votes.user;
      var proxy = user && state.votes.proxy;
      var voted = !proxy && state.votes.names.has(name);
      var pending = state.pending.has(name);
      var waiting = Boolean(user) && !state.votes.ready;
      btn.disabled = Boolean(proxy) || pending || waiting;
      btn.classList.toggle("is-voted", Boolean(voted));
      btn.setAttribute("aria-pressed", voted ? "true" : "false");
      if (pending) btn.setAttribute("aria-busy", "true");
      else btn.removeAttribute("aria-busy");
      if (proxy) {
        btn.textContent = "Proxy";
        btn.title = "Witness votes follow @" + proxy;
        btn.setAttribute("aria-label", btn.title);
      } else {
        btn.textContent = voted ? "Voted" : "Vote";
        btn.removeAttribute("title");
        btn.setAttribute("aria-label", (voted ? "Remove vote for @" : "Vote for @") + name);
      }
    });
  }

  function paintCurrentList() {
    if (state.mode !== "witnesses") return;
    var list = document.getElementById("witnessList");
    if (!list) return;
    var mode = state.listMode === "search" ? "search" : "rank";
    var bucket = mode === "search" ? state.search : state.ranked;
    if (bucket.error && !bucket.rows.length) {
      list.innerHTML = "";
      return;
    }
    if (!bucket.rows.length && bucket.done && mode === "search") {
      list.innerHTML = '<p class="feed-hint witness-empty">No witnesses matched that search.</p>';
      return;
    }
    list.innerHTML = rowsHtml(bucket.rows, mode);
    paintVoteButtons();
  }

  function listNearEnd() {
    var list = document.getElementById("witnessList");
    if (!list || state.mode !== "witnesses") return false;
    var probe = list.lastElementChild || document.getElementById("witnessTable");
    if (!probe) return false;
    return probe.getBoundingClientRect().bottom <= window.innerHeight + NEAR_PX;
  }

  function maybeMore() {
    if (state.mode !== "witnesses" || !document.getElementById("witnessList")) return;
    var bucket = state.listMode === "search" ? state.search : state.ranked;
    if (bucket.loading || bucket.done || bucket.hold) return;
    if (!listNearEnd()) return;
    if (state.listMode === "search") fillSearch(state.gen, state.listGen, false);
    else fillRank(state.gen, state.listGen, false);
  }

  function resetVotes() {
    var user = state.host && state.host.user ? state.host.user() || "" : "";
    state.votes = {
      user: user,
      names: new Set(),
      proxy: "",
      expired: false,
      ready: !user,
    };
  }

  function begin(ctx) {
    state.host = ctx;
    state.gen += 1;
    state.listGen += 1;
    state.props = null;
    state.schedule = null;
    state.rewards = null;
    state.interest = null;
    state.majority = "";
    state.ranked = emptyBucket();
    state.search = emptyBucket();
    state.pending = new Set();
    state.detailName = "";
    state.detailWitness = null;
    state.detailAccount = null;
    state.composing = false;
    if (state.searchTimer) {
      clearTimeout(state.searchTimer);
      state.searchTimer = 0;
    }
    resetVotes();
  }

  async function loadChain(gen) {
    try {
      var pack = await Promise.all([
        api().getDynamicGlobalProperties(),
        api().hiveRpc("condenser_api.get_witness_schedule", []).catch(function () {
          return null;
        }),
        api().getMedianHistoryPrice().catch(function () {
          return null;
        }),
        api().getAccounts(["hive.fund"]).catch(function () {
          return [];
        }),
      ]);
      if (!alive(gen)) return;
      var props = pack[0];
      if (!props) throw new Error("Could not load chain data.");
      state.props = props;
      state.schedule = normalizeSchedule(pack[1]);
      state.majority = state.schedule.majority;
      var fund = Array.isArray(pack[3]) ? pack[3][0] : null;
      state.rewards = computeRewards(props, fund, pack[2], state.schedule);
      var interest = Number(props.hbd_interest_rate);
      state.interest = Number.isFinite(interest) ? interest : null;
      paintStats();
      paintInterest();
      if (state.mode === "witnesses") paintCurrentList();
      if (state.mode === "witness" && state.detailWitness) paintDetailFacts();
    } catch (err) {
      if (!alive(gen)) return;
      var status = document.getElementById("daoStatus");
      if (status && status.hidden) setStatus((err && err.message) || "Could not load chain data.", true);
    }
  }

  async function loadVotes(gen) {
    var user = state.host.user() || "";
    state.votes.user = user;
    if (!user) {
      state.votes.ready = true;
      paintVoteNote();
      paintVoteButtons();
      return;
    }
    try {
      var rows = await api().getAccounts([user]);
      if (!alive(gen) || (state.host.user() || "") !== user) return;
      var account = rows && rows[0];
      var names = account && Array.isArray(account.witness_votes) ? account.witness_votes : [];
      var set = new Set();
      names.forEach(function (name) {
        var key = String(name || "").toLowerCase();
        if (key) set.add(key);
      });
      state.votes.names = set;
      state.votes.proxy = String((account && account.proxy) || "").toLowerCase();
      var expires = hiveTime(account && account.governance_vote_expiration_ts);
      state.votes.expired = Number.isFinite(expires) && expires < Date.now();
      state.votes.ready = true;
    } catch (err) {
      if (!alive(gen)) return;
      state.votes.ready = true;
    }
    paintVoteNote();
    paintVoteButtons();
  }

  async function fillRank(gen, listGen, first) {
    var bucket = state.ranked;
    if (!alive(gen, listGen) || state.listMode !== "rank") return;
    if (bucket.done || bucket.loading || bucket.hold) return;
    bucket.loading = true;
    setMore(true);
    try {
      var batch = await api().hiveRpc(
        "condenser_api.get_witnesses_by_vote",
        [bucket.cursor || "", RANK_PAGE],
        true
      );
      if (!alive(gen, listGen) || state.listMode !== "rank") {
        bucket.loading = false;
        return;
      }
      var list = Array.isArray(batch) ? batch : [];
      var added = [];
      list.forEach(function (witness) {
        var owner = witnessName(witness);
        if (!owner || owner === bucket.cursor) return;
        added.push(witness);
      });
      if (!added.length || list.length < RANK_PAGE) bucket.done = true;
      if (added.length) {
        bucket.rows = bucket.rows.concat(added);
        bucket.cursor = witnessName(added[added.length - 1]);
      }
      bucket.error = "";
      bucket.hold = false;
      bucket.loading = false;
      setMore(false);
      setRetry(false);
      setStatus("", false);
      paintCurrentList();
      if (alive(gen, listGen)) maybeMore();
    } catch (err) {
      if (!alive(gen, listGen) || state.listMode !== "rank") return;
      bucket.loading = false;
      setMore(false);
      var message = (err && err.message) || "Could not load witnesses.";
      if (!bucket.rows.length) {
        bucket.error = message;
        var list = document.getElementById("witnessList");
        if (list) list.innerHTML = "";
        setStatus(message, true);
        setRetry(true);
      } else {
        bucket.hold = true;
        setStatus(message, true);
        setRetry(true);
      }
    }
  }

  async function fillSearch(gen, listGen, first) {
    var bucket = state.search;
    if (!alive(gen, listGen) || state.listMode !== "search") return;
    if (bucket.done || bucket.loading || bucket.hold) return;
    if (!validQuery(bucket.query)) return;
    bucket.loading = true;
    setMore(true);
    try {
      var names = await api().hiveRpc("condenser_api.lookup_witness_accounts", [
        bucket.cursor || bucket.query,
        SEARCH_PAGE,
      ]);
      if (!alive(gen, listGen) || state.listMode !== "search") {
        bucket.loading = false;
        return;
      }
      var found = [];
      var passed = false;
      (Array.isArray(names) ? names : []).forEach(function (raw) {
        var name = String(raw || "").toLowerCase();
        if (!name || passed) return;
        if (name === bucket.cursor) return;
        if (name.indexOf(bucket.query) !== 0) {
          passed = true;
          return;
        }
        found.push(name);
      });
      var witnesses = found.length
        ? await Promise.all(
            found.map(function (name) {
              return api().hiveRpc("condenser_api.get_witness_by_account", [name], true);
            })
          )
        : [];
      if (!alive(gen, listGen) || state.listMode !== "search" || state.search.query !== bucket.query) {
        bucket.loading = false;
        return;
      }
      var added = [];
      witnesses.forEach(function (witness) {
        var owner = witnessName(witness);
        if (owner && owner.indexOf(bucket.query) === 0) added.push(witness);
      });
      if (passed || !found.length || (Array.isArray(names) ? names.length : 0) < SEARCH_PAGE) bucket.done = true;
      if (!added.length) bucket.done = true;
      if (added.length) {
        bucket.rows = bucket.rows.concat(added);
        bucket.cursor = witnessName(added[added.length - 1]);
      }
      bucket.error = "";
      bucket.hold = false;
      bucket.loading = false;
      setMore(false);
      setRetry(false);
      if (!bucket.error) setStatus("", false);
      paintCurrentList();
      if (alive(gen, listGen) && state.listMode === "search") maybeMore();
    } catch (err) {
      if (!alive(gen, listGen) || state.listMode !== "search") return;
      bucket.loading = false;
      setMore(false);
      var message = (err && err.message) || "Could not search witnesses.";
      if (!bucket.rows.length) {
        bucket.error = message;
        bucket.done = true;
        var list = document.getElementById("witnessList");
        if (list) list.innerHTML = "";
        setStatus(message, true);
        setRetry(true);
      } else {
        bucket.hold = true;
        setStatus(message, true);
        setRetry(true);
      }
    }
  }

  function applyQuery(raw, force) {
    if (state.mode !== "witnesses") return;
    var query = normalizeQuery(raw);
    if (!query) {
      if (state.listMode === "rank" && !state.search.query) return;
      state.search = emptyBucket();
      state.listMode = "rank";
      state.listGen += 1;
      setStatus("", false);
      setRetry(false);
      paintCurrentList();
      if (!state.ranked.rows.length && !state.ranked.loading) fillRank(state.gen, state.listGen, true);
      else {
        setMore(false);
        maybeMore();
      }
      return;
    }
    if (!validQuery(query)) {
      setStatus("Witness names use letters, numbers, dots, or hyphens.", true);
      return;
    }
    if (
      !force &&
      state.listMode === "search" &&
      state.search.query === query &&
      (state.search.loading || state.search.rows.length || state.search.done)
    ) {
      return;
    }
    state.listMode = "search";
    state.search = emptyBucket();
    state.search.query = query;
    state.listGen += 1;
    setStatus("", false);
    setRetry(false);
    var list = document.getElementById("witnessList");
    if (list) list.innerHTML = "";
    setMore(true);
    fillSearch(state.gen, state.listGen, true);
  }

  function scheduleSearch() {
    if (state.searchTimer) clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(function () {
      state.searchTimer = 0;
      if (state.composing || state.mode !== "witnesses") return;
      var input = document.getElementById("witnessSearch");
      if (!input) return;
      applyQuery(input.value, false);
    }, 200);
  }

  function retryList() {
    var bucket = state.listMode === "search" ? state.search : state.ranked;
    bucket.hold = false;
    bucket.done = false;
    bucket.error = "";
    setStatus("", false);
    setRetry(false);
    if (state.listMode === "search") fillSearch(state.gen, state.listGen, !bucket.rows.length);
    else fillRank(state.gen, state.listGen, !bucket.rows.length);
  }

  async function castVote(name) {
    var host = state.host;
    if (!host || !accountName(name)) return;
    var user = host.user() || "";
    if (!user) {
      host.openLogin();
      return;
    }
    if (!state.votes.ready || state.votes.proxy || state.pending.has(name)) return;
    var voted = state.votes.names.has(name);
    if (!voted && state.votes.names.size >= 30) {
      host.showError("This account is already voting for 30 witnesses. Remove one before adding another.");
      return;
    }
    var gen = state.gen;
    state.pending.add(name);
    paintVoteButtons();
    try {
      await host.signActive(
        user,
        [
          [
            "account_witness_vote",
            {
              account: user,
              witness: name,
              approve: !voted,
            },
          ],
        ],
        {
          title: voted ? "Remove witness vote" : "Vote witness",
          lead: "Use hive keychain (recommended) or enter the active key of @" + user + ".",
          cancelMessage: voted ? "Witness vote stays." : "Witness vote was not cast.",
          failMessage: voted ? "Could not remove that witness vote." : "Could not vote for that witness.",
        }
      );
      if (!alive(gen)) return;
      if (voted) state.votes.names.delete(name);
      else state.votes.names.add(name);
      state.votes.expired = false;
      paintVoteNote();
    } catch (err) {
      if (!(err && err.ownerCancel) && host.still()) {
        host.showError((err && err.message) || (voted ? "Could not remove that witness vote." : "Could not vote for that witness."));
      }
    } finally {
      state.pending.delete(name);
      if (alive(gen)) paintVoteButtons();
    }
  }

  async function copyWitnessLink() {
    var name = state.detailName;
    if (!name || !state.host) return;
    var url = location.origin + "/witness/@" + name;
    try {
      if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error("copy failed");
      await navigator.clipboard.writeText(url);
      if (state.mode === "witness" && state.detailName === name && state.host.still()) {
        setStatus("Link copied.", false);
      }
    } catch (err) {
      if (state.host.still()) state.host.showError("Could not copy the witness link.");
    }
  }

  function fact(label, value) {
    if (!value) return "";
    return "<div><dt>" + esc(label) + "</dt><dd>" + value + "</dd></div>";
  }

  function paintDetailFacts() {
    var box = document.getElementById("witnessFacts");
    var witness = state.detailWitness;
    if (!box || !witness) return;
    var hp = hpOf(witness.votes);
    var last = lastBlockOf(witness);
    var feed = feedOf(witness);
    var version = String(witness.running_version || "—");
    var behind = !isDisabled(witness) && versionBehind(version, state.majority);
    var versionHtml = esc(version);
    if (behind && state.majority) versionHtml += " · behind " + esc(state.majority);
    var url = httpUrl(witness);
    var urlHtml = url
      ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(url) + "</a>"
      : "";
    var fee = String(witness.account_creation_fee || witness.props && witness.props.account_creation_fee || "").trim();
    var size = witness.props && witness.props.maximum_block_size;
    box.innerHTML = [
      fact("Votes", esc(hp.full || "—")),
      fact("Version", versionHtml),
      fact("Missed", esc(formatCount(witness.total_missed))),
      fact("Last block", esc(last.text || last.label || "—")),
      fact("Price feed", esc(feed.text || feed.label || "—")),
      fact("APR", esc(aprOf(witness))),
      fact("Block size", size ? esc(formatCount(size)) : ""),
      fact("Account fee", fee ? esc(fee) : ""),
      fact("Witness since", esc(monthYear(witness.created))),
      fact("Site", urlHtml),
    ].join("");
  }

  function witnessShell(gen, query) {
    return (
      '<section class="cs77-page dao-page">' +
      navHtml("witnesses") +
      '<h2 class="page-title">Witnesses</h2>' +
      '<p class="dao-kicker">Block producers</p>' +
      '<div class="dao-copy">' +
      "<p>Witnesses are the block producers. They run the consensus nodes, publish a price feed, and vote on chain parameters such as the HBD interest rate.</p>" +
      "<p>Each round is 21 blocks. The top 20 witnesses each produce one block. The extra block goes to one backup witness, picked at random in proportion to the votes outside the top 20.</p>" +
      "<p>An account can vote for up to 30 witnesses. The weight of each vote is that account's Hive Power, counted in full for every witness. It is not split across the 30.</p>" +
      "</div>" +
      '<p class="dao-note" id="witnessInterest" hidden></p>' +
      '<div class="dao-stats">' +
      '<div class="dao-stat"><span class="dao-stat-label">Block reward</span><strong id="daoBlock">—</strong><span class="dao-stat-unit">HIVE</span></div>' +
      '<div class="dao-stat"><span class="dao-stat-label">Daily rewards</span><strong id="daoDaily">—</strong><span class="dao-stat-unit">HIVE</span></div>' +
      '<div class="dao-stat"><span class="dao-stat-label">Avg top 20 daily</span><strong id="daoAvg">—</strong><span class="dao-stat-unit">HIVE</span></div>' +
      "</div>" +
      '<p class="dao-note">A top-20 witness earns the block reward about once every 21 blocks. Daily rewards add up every producer in that round. The average is one top witness who misses none. A backup witness earns more for each block and produces far fewer blocks. Rewards are paid as Hive Power and shown in HIVE.</p>' +
      '<p class="dao-note" id="daoVoteNote" hidden></p>' +
      '<form class="tags-add search-form" id="witnessSearchForm">' +
      '<input id="witnessSearch" type="text" maxlength="32" placeholder="Search witnesses" value="' +
      esc(query || "") +
      '" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" aria-label="Search witnesses">' +
      glassHtml() +
      "</form>" +
      '<p class="tags-status" id="daoStatus" hidden></p>' +
      '<div class="witness-table" id="witnessTable">' +
      '<div class="witness-head"><span>Rank</span><span>Witness</span><span>Votes</span><span title="Last block produced">Last</span><span>Miss</span><span>Feed</span><span>Version</span><span title="HBD interest this witness votes for">APR</span><span></span></div>' +
      '<div id="witnessList"></div>' +
      "</div>" +
      '<div id="witnessMore" class="loading-row is-feed-more" hidden><span class="btn-loader" role="status" aria-label="Loading witnesses"></span></div>' +
      '<button type="button" class="btn-ghost" id="witnessRetry" hidden>Try again</button>' +
      "</section>"
    );
  }

  function renderWitnesses(gen) {
    state.mode = "witnesses";
    state.listMode = "rank";
    state.host.setPageMeta(
      "Witnesses — CyberSpace77",
      "Hive witnesses are the block producers. Each account can vote for 30 of them with its Hive Power."
    );
    if (!writeView(gen, witnessShell(gen, ""))) return;
    var input = document.getElementById("witnessSearch");
    if (input) state.host.focus(input);
    loadChain(gen);
    loadVotes(gen);
    fillRank(gen, state.listGen, true);
  }

  function renderHub(gen) {
    state.mode = "dao";
    state.host.setPageMeta(
      "DAO — CyberSpace77",
      "Witnesses produce Hive blocks. Proposals spend the decentralized fund."
    );
    writeView(
      gen,
      '<section class="cs77-page dao-page">' +
        navHtml("dao") +
        '<h2 class="page-title">DAO</h2>' +
        '<div class="dao-copy"><p>Witnesses produce the blocks. Proposals are how the decentralized fund pays for work.</p></div>' +
        '<div class="dao-choices">' +
        '<a class="dao-choice" href="' +
        esc(state.host.appHref("/witnesses")) +
        '"><span>Witnesses</span><small>Block producers</small></a>' +
        '<a class="dao-choice" href="' +
        esc(state.host.appHref("/proposals")) +
        '"><span>Proposals</span><small>Decentralized fund</small></a>' +
        "</div></section>"
    );
  }

  function renderProposals(gen) {
    state.mode = "proposals";
    state.host.setPageMeta(
      "Proposals — CyberSpace77",
      "Proposals are how the decentralized Hive Fund pays for work the stakeholders approve."
    );
    writeView(
      gen,
      '<section class="cs77-page dao-page">' +
        navHtml("proposals") +
        '<h2 class="page-title">Proposals</h2>' +
        '<p class="dao-kicker">Decentralized fund</p>' +
        '<div class="dao-copy"><p>Proposals are how the decentralized Hive Fund pays for work the stakeholders approve. This page will list them later.</p></div>' +
        "</section>"
    );
  }

  function detailShell(name, body) {
    return (
      '<section class="cs77-page dao-page dao-detail">' +
      navHtml("witness") +
      '<h2 class="page-title">@' +
      esc(name) +
      "</h2>" +
      '<p class="dao-kicker">Witness</p>' +
      body +
      "</section>"
    );
  }

  function paintNotWitness(gen, name) {
    state.detailWitness = null;
    writeView(
      gen,
      detailShell(
        name,
        '<p class="dao-copy">This account is not a witness.</p><p class="dao-actions"><a class="btn-ghost" href="' +
          esc(state.host.profileHref(name)) +
          '">Profile</a></p>'
      )
    );
  }

  function paintDetail(gen) {
    var witness = state.detailWitness;
    var name = state.detailName;
    if (!witness || !alive(gen)) return;
    var about = aboutOf(state.detailAccount);
    var disabled = isDisabled(witness);
    writeView(
      gen,
      detailShell(
        name,
        '<p class="dao-rank" id="witnessRank">Checking rank…</p>' +
          '<div class="dao-actions">' +
          voteButtonHtml(name) +
          '<button type="button" class="btn-ghost" id="witnessCopy">Copy link</button>' +
          '<a class="btn-ghost" href="' +
          esc(state.host.profileHref(name)) +
          '">Profile</a></div>' +
          '<p class="dao-note" id="daoVoteNote" hidden></p>' +
          '<p class="tags-status" id="daoStatus" hidden></p>' +
          (about ? '<p class="dao-about">' + esc(about) + "</p>" : "") +
          (disabled ? '<p class="dao-note dao-disabled">This witness is not signing blocks.</p>' : "") +
          '<dl class="dao-facts" id="witnessFacts"></dl>'
      )
    );
    paintDetailFacts();
    paintVoteNote();
    paintVoteButtons();
  }

  async function scanRank(gen, name) {
    var start = "";
    var rank = 0;
    var page;
    for (page = 0; page < RANK_SCAN_PAGES; page += 1) {
      var batch = await api().hiveRpc("condenser_api.get_witnesses_by_vote", [start, RANK_SCAN_PAGE], true);
      if (!alive(gen) || state.mode !== "witness" || state.detailName !== name || !state.detailWitness) return;
      var list = Array.isArray(batch) ? batch : [];
      var added = 0;
      var i;
      for (i = 0; i < list.length; i += 1) {
        var owner = witnessName(list[i]);
        if (!owner || owner === start) continue;
        added += 1;
        rank += 1;
        start = owner;
        if (owner === name) {
          var el = document.getElementById("witnessRank");
          if (el) el.textContent = rank <= 20 ? "Rank " + rank + " · top 20" : "Rank " + rank;
          return;
        }
      }
      if (!added || list.length < RANK_SCAN_PAGE) break;
    }
    if (!alive(gen) || state.detailName !== name) return;
    var rankEl = document.getElementById("witnessRank");
    if (rankEl) rankEl.textContent = "Outside the top 500";
  }

  async function renderWitness(gen, name) {
    state.mode = "witness";
    state.detailName = name;
    state.host.setPageMeta(
      "@" + name + " — Witness — CyberSpace77",
      "Vote for @" + name + " as a Hive block producer."
    );
    if (
      !writeView(
        gen,
        detailShell(name, '<p class="feed-hint" id="daoStatus">Loading witness…</p>')
      )
    ) {
      return;
    }
    loadChain(gen);
    loadVotes(gen);
    try {
      var pack = await Promise.all([
        api().hiveRpc("condenser_api.get_witness_by_account", [name], true),
        api().getAccounts([name]).catch(function () {
          return [];
        }),
      ]);
      if (!alive(gen) || state.detailName !== name) return;
      var witness = pack[0];
      var owner = witnessName(witness);
      if (!witness || owner !== name) {
        state.host.setPageMeta("@" + name + " — Witness — CyberSpace77", "This account is not a witness.");
        paintNotWitness(gen, name);
        return;
      }
      state.detailWitness = witness;
      state.detailAccount = pack[1] && pack[1][0];
      paintDetail(gen);
      scanRank(gen, name);
    } catch (err) {
      if (!alive(gen) || state.detailName !== name) return;
      writeView(
        gen,
        detailShell(
          name,
          '<p class="tags-status is-error" id="daoStatus">' +
            esc((err && err.message) || "Could not load this witness.") +
            "</p>"
        )
      );
    }
  }

  function onClick(event) {
    var retry = event.target.closest && event.target.closest("#witnessRetry");
    if (retry) {
      event.preventDefault();
      retryList();
      return;
    }
    var copy = event.target.closest && event.target.closest("#witnessCopy");
    if (copy) {
      event.preventDefault();
      copyWitnessLink();
      return;
    }
    var vote = event.target.closest && event.target.closest(".witness-vote[data-vote]");
    if (!vote) return;
    event.preventDefault();
    castVote(vote.getAttribute("data-vote") || "");
  }

  function onSubmit(event) {
    var form = event.target && event.target.closest && event.target.closest("#witnessSearchForm");
    if (!form) return;
    event.preventDefault();
    if (state.searchTimer) {
      clearTimeout(state.searchTimer);
      state.searchTimer = 0;
    }
    var input = document.getElementById("witnessSearch");
    if (input) applyQuery(input.value, true);
  }

  function onInput(event) {
    if (!event.target || event.target.id !== "witnessSearch") return;
    if (state.composing || event.isComposing) return;
    scheduleSearch();
  }

  function onComposeStart(event) {
    if (event.target && event.target.id === "witnessSearch") state.composing = true;
  }

  function onComposeEnd(event) {
    if (!event.target || event.target.id !== "witnessSearch") return;
    state.composing = false;
    scheduleSearch();
  }

  function onScroll() {
    if (!document.getElementById("witnessList") || state.mode !== "witnesses") return;
    maybeMore();
  }

  var bound = false;
  function bind() {
    if (bound) return;
    var view = document.getElementById("view");
    if (!view) return;
    bound = true;
    view.addEventListener("click", onClick);
    view.addEventListener("submit", onSubmit);
    view.addEventListener("input", onInput);
    view.addEventListener("compositionstart", onComposeStart);
    view.addEventListener("compositionend", onComposeEnd);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
  }

  async function render(ctx) {
    begin(ctx);
    bind();
    var gen = state.gen;
    var route = (ctx && ctx.route) || {};
    if (route.name === "dao") {
      renderHub(gen);
      return;
    }
    if (route.name === "proposals") {
      renderProposals(gen);
      return;
    }
    if (route.name === "witness") {
      await renderWitness(gen, route.author || "");
      return;
    }
    renderWitnesses(gen);
  }

  global.DaoPage = { render: render };
})(window);
