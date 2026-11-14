/**
 * DAO pages. /witnesses, /proposals, /proposals/id, and /witness/@name.
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
  var SUPPORTER_PAGE = 1000;
  var PROPOSAL_PAGE = 100;
  var NEAR_PX = 700;

  var state = {
    host: null,
    gen: 0,
    listGen: 0,
    mode: "",
    listMode: "rank",
    witnessFilter: "all",
    votedKey: "",
    votedRows: [],
    votedLoading: false,
    voteRanks: new Map(),
    voteRankAt: 0,
    voteRankCursor: "",
    voteRankDone: false,
    voteRankLoading: false,
    voteRankAgain: false,
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
    detailProposalId: null,
    detailProposal: null,
    detailReturnVotes: null,
    proposalSupportersPartial: false,
    proposalSupporterCount: null,
    supporterLoading: false,
    supporterSerial: 0,
    supporterRows: [],
    supporterReady: false,
    supporterError: "",
    fund: null,
    proposalFilter: "active",
    proposalQuery: "",
    proposalExcludeStabilizer: false,
    proposalSortAll: "paid",
    proposalSortPast: "end",
    proposalSortActive: "hp",
    proposalSortUpcoming: "hp",
    proposalSearchTimer: 0,
    proposalSerial: 0,
    proposals: emptyProposals(),
    proposalVotes: emptyProposalVotes(),
    proposalPending: new Set(),
    proposalCreateTicket: 0,
    proposalCreateBusy: false,
    proposalEditId: null,
    proposalCancelId: null,
    proposalCancelBusy: false,
    proposalCancelTicket: 0,
    votesSerial: 0,
    votesInflight: null,
    proxyBusy: false,
    proxyTicket: 0,
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
    return { user: "", names: new Set(), proxy: "", proxyVoter: "", expired: false, ready: true };
  }

  function emptyProposals() {
    return {
      rows: [],
      paid: new Map(),
      paidReady: false,
      loading: false,
      done: false,
      error: "",
    };
  }

  function emptyProposalVotes() {
    return { user: "", ids: new Set(), ready: true };
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
    return api().hiveTimeMs(created);
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

  // PeakD's Active filter. A node is running when its signing key is set and
  // its last block is within 7 days times (floor(rank / 100) + 1). No last
  // block is not stale. Rank 0 means the vote rank is not loaded yet.
  function isStale(witness, rank) {
    if (!rank || rank < 1 || isDisabled(witness)) return false;
    var props = state.props;
    var head = Number(props && props.head_block_number);
    var last = Number(witness && witness.last_confirmed_block_num);
    if (!head || !last) return false;
    var days = 7 * (Math.floor(rank / 100) + 1);
    return 3 * (head - last) > days * 86400;
  }

  function isRunning(witness, rank) {
    return !isDisabled(witness) && !isStale(witness, rank);
  }

  function rankOf(witness, listMode, index) {
    if (listMode === "rank") return index + 1;
    var name = witnessName(witness);
    if (name && state.voteRanks.has(name)) return state.voteRanks.get(name);
    var rows = state.ranked.rows;
    var i;
    for (i = 0; i < rows.length; i += 1) {
      if (witnessName(rows[i]) === name) return i + 1;
    }
    return 0;
  }

  function votedRankMissing() {
    var missing = false;
    state.votes.names.forEach(function (name) {
      if (name && !state.voteRanks.has(name)) missing = true;
    });
    return missing;
  }

  // The ranked list is only the pages already scrolled in. Voted witnesses
  // past that window still need the same get_witnesses_by_vote position.
  function seedVoteRanksFromRanked() {
    if (state.voteRankAt > 0 || state.voteRankDone) return;
    var rows = state.ranked.rows;
    var i;
    for (i = 0; i < rows.length; i += 1) {
      var owner = witnessName(rows[i]);
      if (!owner) return;
      state.voteRanks.set(owner, i + 1);
      state.voteRankAt = i + 1;
      state.voteRankCursor = owner;
    }
    if (rows.length && state.ranked.done) state.voteRankDone = true;
  }

  async function ensureVoteRanks(gen) {
    if (!state.votes.user || !state.votes.ready) return;
    if (state.voteRankLoading) {
      state.voteRankAgain = true;
      return;
    }
    state.voteRankLoading = true;
    try {
      do {
        state.voteRankAgain = false;
        seedVoteRanksFromRanked();
        var page;
        for (page = 0; page < 50 && !state.voteRankDone && votedRankMissing(); page += 1) {
          var batch = await api().hiveRpc(
            "condenser_api.get_witnesses_by_vote",
            [state.voteRankCursor, RANK_SCAN_PAGE],
            true
          );
          if (!alive(gen)) return;
          var list = Array.isArray(batch) ? batch : [];
          var added = 0;
          var start = state.voteRankCursor;
          var i;
          for (i = 0; i < list.length; i += 1) {
            var owner = witnessName(list[i]);
            if (!owner || owner === start) continue;
            added += 1;
            state.voteRankAt += 1;
            state.voteRankCursor = owner;
            state.voteRanks.set(owner, state.voteRankAt);
            start = owner;
          }
          if (!added || list.length < RANK_SCAN_PAGE) state.voteRankDone = true;
        }
      } while (alive(gen) && state.voteRankAgain && !state.voteRankDone && votedRankMissing());
    } catch (err) {
      /* voted rows keep any ranks already found */
    } finally {
      state.voteRankLoading = false;
    }
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
    return api().accountNameOrEmpty(raw);
  }

  function percentText(rate) {
    var n = Number(rate);
    if (!Number.isFinite(n)) return "—";
    var pct = n / 100;
    var text = Math.abs(pct - Math.round(pct)) < 0.05 ? String(Math.round(pct)) : pct.toFixed(1);
    return text + "%";
  }

  // Chain hbd_interest_rate is basis points. Same scale and bounds as the wallet staked hbd apr.
  function hbdAprText(rate) {
    var n = Number(rate);
    if (!Number.isFinite(n) || n < 0 || n > 10000) return "—";
    return (n / 100).toFixed(2);
  }

  function glassHtml() {
    return '<button type="submit" class="community-search-glass" aria-label="Search"><svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter"><path d="M3.9 7.15V3.9h3.25"/><path d="M12.85 3.9h3.25v3.25"/><path d="M7.15 16.1H3.9v-3.25"/><circle cx="10" cy="10" r="5.15"/><path d="M10 6.55v1.25M10 12.2v1.25M6.55 10h1.25M12.2 10h1.25"/><circle cx="10" cy="10" r="0.7" fill="currentColor" stroke="none"/></g><path class="community-search-handle" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="square" d="M16 16 21.15 21.15"/></svg></button>';
  }

  function navHtml(active) {
    var current = active === "witness" ? "witnesses" : active;
    var items = [
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
    var text = formatHiveMilli(milli);
    return { compact: compactHp(milli), exact: text + " hp", milli: milli };
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

  var VOTE_CHECK_SVG =
    '<circle cx="12" cy="12" r="12" fill="currentColor"/><path fill="none" stroke="#070707" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" d="M7 12.5 10.4 15.8 17.2 8.6"/>';

  var WITNESS_VOTE_CHECK =
    '<svg class="dao-vote-check" viewBox="0 0 24 24" aria-hidden="true">' + VOTE_CHECK_SVG + "</svg>";

  function voteButtonFace(voted) {
    if (voted) return WITNESS_VOTE_CHECK;
    return "Vote";
  }

  function proxyWitnessMark(name) {
    var voter = state.votes.proxyVoter || state.votes.proxy;
    return (
      '<span class="witness-vote is-voted" role="img" aria-label="' +
      esc("@" + voter + " votes for @" + name) +
      '">' +
      WITNESS_VOTE_CHECK +
      "</span>"
    );
  }

  function voteButtonHtml(name) {
    var user = state.votes.user;
    var proxy = user && state.votes.proxy;
    var voted = state.votes.names.has(name);
    if (proxy) {
      if (!state.votes.ready || !voted) return "";
      return proxyWitnessMark(name);
    }
    var pending = state.pending.has(name);
    var waiting = Boolean(user) && !state.votes.ready;
    var disabled = pending || waiting;
    var aria = (voted ? "Remove vote for @" : "Vote for @") + name;
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
      (pending ? ' aria-busy="true"' : "") +
      (disabled ? " disabled" : "") +
      ">" +
      voteButtonFace(voted) +
      "</button>"
    );
  }

  function witnessActionHtml(name) {
    return (
      '<span class="witness-action" data-witness-action="' + esc(name) + '">' + voteButtonHtml(name) + "</span>"
    );
  }

  function prepareNames(names) {
    if (!window.Avatars) return Promise.resolve();
    return window.Avatars.prepare(names);
  }

  function avatarImg(name, size) {
    var dim = size || "small";
    if (window.Avatars) return window.Avatars.html(name, dim);
    return md().lazyAvatarHtml(md().avatarUrl(name, dim));
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
      (rank > 0 ? esc(String(rank)) : "") +
      "</span>" +
      '<a class="witness-who" href="' +
      esc(state.host.appHref("/witness/@" + name)) +
      '">' +
      avatarImg(name, "small") +
      '<span class="witness-name">@' +
      esc(name) +
      "</span></a>" +
      '<span class="witness-cells">' +
      '<span class="witness-cell witness-votes" data-label="Votes"' +
      (hp.exact ? ' tabindex="0"' : "") +
      ">" +
      esc(hp.compact) +
      (hp.exact
        ? '<span class="session-stat-tip" role="tooltip">' + esc(hp.exact) + "</span>"
        : "") +
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
      witnessActionHtml(name) +
      "</article>"
    );
  }

  function witnessFilter() {
    if (state.witnessFilter === "active" || state.witnessFilter === "voted") return state.witnessFilter;
    return "all";
  }

  function votedKeyOf() {
    return Array.from(state.votes.names).sort().join("\n");
  }

  function rowsHtml(rows, listMode) {
    var html = [];
    var filter = witnessFilter();
    var split = false;
    rows.forEach(function (witness, index) {
      var rank = listMode === "rank" ? index + 1 : listMode === "voted" ? rankOf(witness, listMode, index) : 0;
      var name = witnessName(witness);
      if (filter === "active" && !isRunning(witness, rank)) return;
      if (filter === "voted" && !state.votes.names.has(name)) return;
      if (!split && (filter === "all" || filter === "active") && listMode === "rank" && rank > 20) {
        split = true;
        html.push(
          '<p class="dao-split"><span>Below the top 20, one backup witness produces the next block in each round.</span></p>'
        );
      }
      html.push(rowHtml(witness, rank, listMode));
    });
    return html.join("");
  }

  function paintWitnessFilter() {
    var buttons = document.querySelectorAll(".dao-filter [data-witness-filter]");
    var current = witnessFilter();
    buttons.forEach(function (btn) {
      var on = btn.getAttribute("data-witness-filter") === current;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-checked", on ? "true" : "false");
    });
  }

  function emptyListHtml(message) {
    return '<p class="feed-hint dao-empty">' + esc(message) + "</p>";
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
    if (block && daily && avg && rewards) {
      block.textContent = formatHiveMilli(rewards.elected);
      daily.textContent = formatHiveMilli(rewards.daily);
      avg.textContent = formatHiveMilli(rewards.avg);
    }
    var apr = document.getElementById("daoApr");
    if (apr) apr.textContent = hbdAprText(state.interest);
  }

  function voteNoteText() {
    if (!state.votes.user || !state.votes.ready) return "";
    if (state.votes.proxy) return "@" + state.votes.proxy + " set as proxy.";
    if (state.mode !== "witnesses" && state.mode !== "witness") return "";
    var lines = ["Voting for " + state.votes.names.size + " of 30 witnesses."];
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
    var slots = document.querySelectorAll("[data-witness-action]");
    slots.forEach(function (slot) {
      slot.innerHTML = voteButtonHtml(slot.getAttribute("data-witness-action") || "");
    });
  }

  function paintVotedList(list) {
    if (!state.votes.user) {
      list.innerHTML = emptyListHtml("Log in to see the witnesses you vote for.");
      return;
    }
    if (!state.votes.ready || state.votedLoading) {
      list.innerHTML = "";
      return;
    }
    if (!state.votedRows.length) {
      list.innerHTML = emptyListHtml(
        state.votes.proxy
          ? "@" + state.votes.proxy + " is not voting for any witnesses."
          : "You are not voting for any witnesses."
      );
      return;
    }
    list.innerHTML = rowsHtml(state.votedRows, "voted");
    if (window.Avatars) window.Avatars.stamp(list);
    paintVoteButtons();
  }

  var witnessPaintGen = 0;

  function witnessNamesForPaint() {
    var names = [];
    var rows =
      witnessFilter() === "voted" && state.listMode !== "search"
        ? state.votedRows
        : (state.listMode === "search" ? state.search : state.ranked).rows;
    (rows || []).forEach(function (witness) {
      names.push(witnessName(witness));
    });
    return names;
  }

  // Draw the rows before avatar accounts return. A paint that waits on
  // prepare stays blank: the empty list looks near the end, so the next
  // witness page starts and cancels this paint before it can commit.
  function paintCurrentList() {
    if (state.mode !== "witnesses") return;
    var gen = ++witnessPaintGen;
    var names = witnessNamesForPaint();
    paintCurrentListBody();
    if (!window.Avatars || !names.some(function (name) { return !window.Avatars.has(name); })) return;
    prepareNames(names).then(function () {
      if (gen !== witnessPaintGen || state.mode !== "witnesses") return;
      paintCurrentListBody();
    });
  }

  function paintCurrentListBody() {
    if (state.mode !== "witnesses") return;
    var list = document.getElementById("witnessList");
    if (!list) return;
    paintWitnessFilter();
    if (witnessFilter() === "voted" && state.listMode !== "search") {
      paintVotedList(list);
      return;
    }
    var mode = state.listMode === "search" ? "search" : "rank";
    var bucket = mode === "search" ? state.search : state.ranked;
    if (bucket.error && !bucket.rows.length) {
      list.innerHTML = "";
      return;
    }
    var html = rowsHtml(bucket.rows, mode);
    if (!html) {
      if (bucket.done && !bucket.loading) {
        list.innerHTML = emptyListHtml(
          mode === "search" ? "No witnesses matched that search." : "No witnesses to show."
        );
      } else list.innerHTML = "";
      return;
    }
    list.innerHTML = html;
    if (window.Avatars) window.Avatars.stamp(list);
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
    if (witnessFilter() === "voted" && state.listMode !== "search") return;
    if (!listNearEnd()) return;
    if (state.listMode === "search") fillSearch(state.gen, state.listGen, false);
    else fillRank(state.gen, state.listGen, false);
  }

  function resetVotes() {
    var user = state.host && state.host.user ? state.host.user() || "" : "";
    state.votesSerial += 1;
    state.votesInflight = null;
    state.votes = {
      user: user,
      names: new Set(),
      proxy: "",
      proxyVoter: "",
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
    state.witnessFilter = "all";
    state.votedKey = "";
    state.votedRows = [];
    state.votedLoading = false;
    state.voteRanks = new Map();
    state.voteRankAt = 0;
    state.voteRankCursor = "";
    state.voteRankDone = false;
    state.voteRankLoading = false;
    state.voteRankAgain = false;
    state.pending = new Set();
    state.detailName = "";
    state.detailWitness = null;
    state.detailAccount = null;
    state.detailProposalId = null;
    state.detailProposal = null;
    state.detailReturnVotes = null;
    state.proposalSupportersPartial = false;
    state.proposalSupporterCount = null;
    state.supporterLoading = false;
    state.supporterSerial += 1;
    state.supporterRows = [];
    state.supporterReady = false;
    state.supporterError = "";
    state.fund = null;
    state.proposalFilter = "active";
    state.proposalQuery = "";
    state.proposalExcludeStabilizer = false;
    state.proposalSortAll = "paid";
    state.proposalSortPast = "end";
    state.proposalSortActive = "hp";
    state.proposalSortUpcoming = "hp";
    closeProposalSort();
    state.proposalSerial += 1;
    state.proposals = emptyProposals();
    state.proposalVotes = emptyProposalVotes();
    state.proposalPending = new Set();
    closeCreateProposal();
    closeProposalCancel();
    closeProxyDialog();
    closeProxyMenu();
    state.composing = false;
    if (state.searchTimer) {
      clearTimeout(state.searchTimer);
      state.searchTimer = 0;
    }
    if (state.proposalSearchTimer) {
      clearTimeout(state.proposalSearchTimer);
      state.proposalSearchTimer = 0;
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
      state.fund = fund || null;
      state.rewards = computeRewards(props, fund, pack[2], state.schedule);
      var interest = Number(props.hbd_interest_rate);
      state.interest = Number.isFinite(interest) ? interest : null;
      paintStats();
      if (state.mode === "witnesses") paintCurrentList();
      if (state.mode === "proposals") {
        paintProposalStats();
        paintProposalList();
      }
      if (state.mode === "witness" && state.detailWitness) {
        paintDetailFacts();
        paintSupporters();
      }
      if (state.mode === "proposal" && state.detailProposal) {
        paintProposalFigures();
        paintProposalSupporters();
      }
    } catch (err) {
      if (!alive(gen)) return;
      var status = document.getElementById("daoStatus");
      if (status && status.hidden) setStatus((err && err.message) || "Could not load chain data.", true);
    }
  }

  function witnessNamesOf(account) {
    var set = new Set();
    var names = account && Array.isArray(account.witness_votes) ? account.witness_votes : [];
    names.forEach(function (name) {
      var key = String(name || "").toLowerCase();
      if (key) set.add(key);
    });
    return set;
  }

  function votesCurrent(gen, serial, user) {
    return alive(gen) && state.votesSerial === serial && (state.host.user() || "") === user;
  }

  async function accountByName(name) {
    var rows = await api().getAccounts([name]);
    var list = rows || [];
    var i;
    for (i = 0; i < list.length; i += 1) {
      if (accountName(list[i] && list[i].name) === name) return list[i];
    }
    return null;
  }

  // The account's own witness votes stay on chain. While a proxy is set they
  // do not count, and the weight follows the proxy chain to the account that votes.
  async function resolveProxyVotes(start, current) {
    var voter = accountName(start);
    var seen = {};
    var hop;
    for (hop = 0; hop < 4 && voter; hop += 1) {
      if (seen[voter]) return { voter: voter, names: new Set() };
      seen[voter] = true;
      var account = await accountByName(voter);
      if (!current()) return null;
      if (!account) return { voter: voter, names: new Set() };
      var next = accountName(account.proxy);
      if (!next || next === voter || seen[next]) return { voter: voter, names: witnessNamesOf(account) };
      voter = next;
    }
    if (!voter || !current()) return null;
    var last = await accountByName(voter);
    if (!current()) return null;
    return { voter: voter, names: witnessNamesOf(last) };
  }

  function loadVotes(gen) {
    var user = state.host.user() || "";
    var serial = state.votesSerial;
    var inflight = state.votesInflight;
    if (inflight && inflight.gen === gen && inflight.serial === serial && inflight.user === user) {
      return inflight.promise;
    }
    var promise = loadVotesNow(gen, serial, user);
    state.votesInflight = { gen: gen, serial: serial, user: user, promise: promise };
    return promise;
  }

  async function loadVotesNow(gen, serial, user) {
    state.votes.user = user;
    if (!user) {
      state.votes.names = new Set();
      state.votes.proxy = "";
      state.votes.proxyVoter = "";
      state.votes.expired = false;
      state.votes.ready = true;
      paintVoteNote();
      paintProxyMenu();
      paintVoteButtons();
      if (witnessFilter() === "voted") paintCurrentList();
      return;
    }
    try {
      var account = await accountByName(user);
      if (!votesCurrent(gen, serial, user)) return;
      state.votes.proxy = accountName(account && account.proxy) || "";
      var expires = hiveTime(account && account.governance_vote_expiration_ts);
      state.votes.expired = Number.isFinite(expires) && expires < Date.now();
      if (state.votes.proxy) {
        var resolved = await resolveProxyVotes(state.votes.proxy, function () {
          return votesCurrent(gen, serial, user);
        });
        if (!votesCurrent(gen, serial, user)) return;
        state.votes.proxyVoter = (resolved && resolved.voter) || state.votes.proxy;
        state.votes.names = (resolved && resolved.names) || new Set();
      } else {
        state.votes.proxyVoter = "";
        state.votes.names = witnessNamesOf(account);
      }
      state.votes.ready = true;
    } catch (err) {
      if (!votesCurrent(gen, serial, user)) return;
      state.votes.ready = true;
    }
    if (!votesCurrent(gen, serial, user)) return;
    paintVoteNote();
    paintProxyMenu();
    paintVoteButtons();
    if (onProposalPage()) paintProposalActions();
    if (witnessFilter() === "voted") ensureVoted(gen);
  }

  async function ensureVoted(gen) {
    if (state.mode !== "witnesses" || witnessFilter() !== "voted") return;
    if (state.listMode === "search") {
      paintCurrentList();
      return;
    }
    if (!state.votes.user || !state.votes.ready) {
      paintCurrentList();
      return;
    }
    var key = votedKeyOf();
    if (state.votedLoading && state.votedKey === key) return;
    if (state.votedKey === key && !state.votedLoading) {
      await ensureVoteRanks(gen);
      if (alive(gen) && witnessFilter() === "voted") paintCurrentList();
      return;
    }
    var names = key ? key.split("\n") : [];
    state.votedKey = key;
    state.votedRows = [];
    state.votedLoading = true;
    paintCurrentList();
    setMore(Boolean(names.length));
    if (!names.length) {
      state.votedLoading = false;
      setMore(false);
      paintCurrentList();
      return;
    }
    try {
      var rows = await Promise.all(
        names.map(function (name) {
          return api()
            .hiveRpc("condenser_api.get_witness_by_account", [name], true)
            .catch(function () {
              return null;
            });
        })
      );
      if (!alive(gen) || state.votedKey !== key || witnessFilter() !== "voted") return;
      var list = [];
      rows.forEach(function (row) {
        if (row && witnessName(row)) list.push(row);
      });
      list.sort(function (a, b) {
        var av = bigIntOf(a.votes, 0n);
        var bv = bigIntOf(b.votes, 0n);
        if (av === bv) return 0;
        return av > bv ? -1 : 1;
      });
      state.votedRows = list;
      state.votedLoading = false;
      await ensureVoteRanks(gen);
    } catch (err) {
      if (!alive(gen) || state.votedKey !== key) return;
      state.votedLoading = false;
      state.votedRows = [];
      setStatus((err && err.message) || "Could not load voted witnesses.", true);
    }
    if (!alive(gen)) return;
    setMore(false);
    if (witnessFilter() === "voted") paintCurrentList();
  }

  function setWitnessFilter(next) {
    if (next !== "all" && next !== "active" && next !== "voted") return;
    if (witnessFilter() === next) return;
    state.witnessFilter = next;
    paintWitnessFilter();
    if (next === "voted") ensureVoted(state.gen);
    else {
      paintCurrentList();
      setMore(false);
      maybeMore();
    }
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
      if (voted) {
        state.votes.names.delete(name);
        state.votedRows = state.votedRows.filter(function (row) {
          return witnessName(row) !== name;
        });
        state.votedKey = votedKeyOf();
      } else {
        state.votes.names.add(name);
        state.votedKey = "";
      }
      state.votes.expired = false;
      paintVoteNote();
      if (witnessFilter() === "voted" && !voted) ensureVoted(gen);
    } catch (err) {
      if (!(err && err.ownerCancel) && host.still()) {
        host.showError((err && err.message) || (voted ? "Could not remove that witness vote." : "Could not vote for that witness."));
      }
    } finally {
      state.pending.delete(name);
      if (alive(gen)) {
        paintVoteButtons();
        if (witnessFilter() === "voted") paintCurrentList();
      }
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
      fact("Votes", esc(hp.exact || "—")),
      fact("Version", versionHtml),
      fact("Missed", esc(formatCount(witness.total_missed))),
      fact("Last block", esc(last.text || last.label || "—")),
      fact("Price feed", esc(feed.text || feed.label || "—")),
      fact("APR", esc(aprOf(witness))),
      fact("Block size", size ? esc(formatCount(size)) : ""),
      fact("Account fee", fee ? esc(fee.replace(/\bHIVE\b/g, "hive").replace(/\bHP\b/g, "hp")) : ""),
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
      "<p>An account can vote for up to 30 witnesses. The weight of each vote is that account's hive stake including proxies, counted in full for every witness. It is not split across the 30.</p>" +
      "</div>" +
      '<p class="dao-note" id="witnessInterest">The HBD savings rate is the median of the top 20. The APR column is the rate each witness is voting for.</p>' +
      '<div class="dao-stats">' +
      '<div class="dao-stat"><span class="dao-stat-label">block reward</span><strong id="daoBlock">—</strong><span class="dao-stat-unit">hive</span></div>' +
      '<div class="dao-stat"><span class="dao-stat-label">daily rewards</span><strong id="daoDaily">—</strong><span class="dao-stat-unit">hive</span></div>' +
      '<div class="dao-stat"><span class="dao-stat-label">avg top 20 daily</span><strong id="daoAvg">—</strong><span class="dao-stat-unit">hive</span></div>' +
      '<div class="dao-stat"><span class="dao-stat-label">hbd interest</span><strong id="daoApr">—</strong><span class="dao-stat-unit">%</span></div>' +
      "</div>" +
      '<p class="dao-note" id="daoVoteNote" hidden></p>' +
      '<div class="dao-tools">' +
      '<form class="tags-add search-form" id="witnessSearchForm">' +
      '<input id="witnessSearch" type="text" maxlength="32" placeholder="Search witnesses" value="' +
      esc(query || "") +
      '" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" aria-label="Search witnesses">' +
      glassHtml() +
      "</form>" +
      proxyMenuHtml() +
      "</div>" +
      '<div class="dao-filter" role="radiogroup" aria-label="Filter witnesses">' +
      '<button type="button" role="radio" data-witness-filter="all" aria-checked="true" class="is-active">All</button>' +
      '<button type="button" role="radio" data-witness-filter="active" aria-checked="false">Active</button>' +
      '<button type="button" role="radio" data-witness-filter="voted" aria-checked="false">Voted</button>' +
      "</div>" +
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
      "Witnesses are hive's block producers. They run consensus nodes, publish price feeds, vote on blockchain parameters, and help secure and govern the network through stakeholder voting."
    );
    if (!writeView(gen, witnessShell(gen, ""))) return;
    loadChain(gen);
    loadVotes(gen);
    fillRank(gen, state.listGen, true);
  }

  var MS_PER_DAY = 86400000n;

  function proposalId(row) {
    if (!row) return null;
    var raw = row.proposal_id != null ? row.proposal_id : row.id;
    var n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  // Proposal 0 is the return proposal. Its daily pay soaks up budget in the
  // chain record and is not a project ask, so the list never shows that amount.
  function isReturnProposal(row) {
    return proposalId(row) === 0;
  }

  function chainNow() {
    var t = hiveTime(state.props && state.props.time);
    return Number.isFinite(t) ? t : Date.now();
  }

  function proposalPhase(row, now) {
    var start = hiveTime(row && row.start_date);
    var end = hiveTime(row && row.end_date);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return "";
    if (now > end) return "past";
    if (now < start) return "upcoming";
    return "active";
  }

  function proposalFilter() {
    var filter = state.proposalFilter;
    if (filter === "all" || filter === "upcoming" || filter === "past") return filter;
    return "active";
  }

  function onProposalPage() {
    return state.mode === "proposals" || state.mode === "proposal";
  }

  // Voting stays open through the end date, including before the proposal starts.
  // A vote on a proposal that has ended is kept as the check, not a button.
  // An ended proposal that was paid uses that same slot for a dollar mark.
  function proposalCanVote(row, now) {
    var phase = proposalPhase(row, now);
    return phase === "active" || phase === "upcoming";
  }

  function voteProposalId(vote) {
    if (!vote) return null;
    if (vote.proposal) return proposalId(vote.proposal);
    if (vote.proposal_id == null) return null;
    var n = Number(vote.proposal_id);
    return Number.isFinite(n) ? n : null;
  }

  function proposalById(id) {
    if (state.detailProposal && proposalId(state.detailProposal) === id) return state.detailProposal;
    var rows = state.proposals.rows;
    var i;
    for (i = 0; i < rows.length; i += 1) {
      if (proposalId(rows[i]) === id) return rows[i];
    }
    return null;
  }

  function payOver(dailyMilli, ms) {
    if (ms <= 0n || dailyMilli <= 0n) return 0n;
    return divRound(dailyMilli * ms, MS_PER_DAY);
  }

  function groupedMilli(milli) {
    var neg = milli < 0n;
    var n = neg ? -milli : milli;
    var whole = (n / 1000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    var frac = (n % 1000n).toString();
    while (frac.length < 3) frac = "0" + frac;
    frac = frac.replace(/0+$/, "");
    return (neg ? "-" : "") + whole + (frac ? "." + frac : "");
  }

  function compactMilli(milli) {
    var neg = milli < 0n;
    var n = neg ? -milli : milli;
    var scales = [
      [1000000000000000000n, "Q"],
      [1000000000000000n, "T"],
      [1000000000000n, "B"],
      [1000000000n, "M"],
    ];
    var i;
    for (i = 0; i < scales.length; i += 1) {
      var scale = scales[i][0];
      if (n < scale) continue;
      var whole = n / scale;
      var frac = ((n % scale) * 100n) / scale;
      var fracText = frac.toString();
      if (fracText.length < 2) fracText = "0" + fracText;
      return (neg ? "-" : "") + whole.toString() + "." + fracText + scales[i][1];
    }
    return groupedMilli(milli);
  }

  function hbdCell(milli) {
    if (milli == null) return { cell: "—", exact: "" };
    var abs = milli < 0n ? -milli : milli;
    return {
      cell: abs >= 1000000000n ? compactMilli(milli) : groupedMilli(milli),
      exact: formatHiveMilli(milli) + " hbd",
    };
  }

  // Million-scale and up. Always two decimal places.
  function compactTwo(milli) {
    var n = milli < 0n ? -milli : milli;
    var scales = [
      [1000000000000000000n, "Q"],
      [1000000000000000n, "T"],
      [1000000000000n, "B"],
      [1000000000n, "M"],
    ];
    var factor = 100n;
    var i;
    for (i = 0; i < scales.length; i += 1) {
      var scale = scales[i][0];
      if (n < scale) continue;
      var scaled = (n * factor + scale / 2n) / scale;
      var whole = (scaled / factor).toString();
      var frac = (scaled % factor).toString();
      if (frac.length < 2) frac = "0" + frac;
      return whole + "." + frac + scales[i][1];
    }
    return "";
  }

  // Above zero shows three decimals. A million-scale figure always shows two. Zero stays "0".
  function proposalFigureText(milli) {
    if (milli == null || milli <= 0n) return hbdCell(milli).cell;
    return compactTwo(milli) || formatHiveMilli(milli);
  }

  function paidMilli(raw) {
    var s = String(raw == null ? "" : raw).trim();
    if (!s) return 0n;
    if (s.indexOf(".") !== -1) return assetInt(s, 3);
    return assetInt(s, 0);
  }

  function recordedPaid(row) {
    var id = proposalId(row);
    if (!state.proposals.paidReady || id == null || !state.proposals.paid.has(id)) return null;
    return state.proposals.paid.get(id);
  }

  function returnVotes() {
    if (state.detailReturnVotes != null) return state.detailReturnVotes;
    var rows = state.proposals.rows;
    var i;
    for (i = 0; i < rows.length; i += 1) {
      if (isReturnProposal(rows[i])) return bigIntOf(rows[i].total_votes, 0n);
    }
    return null;
  }

  function proposalPay(row, now, retVotes) {
    if (isReturnProposal(row)) {
      return { total: null, daily: null, paid: null, toPay: null, estimated: false };
    }
    var daily = assetInt(row.daily_pay, 3);
    var start = hiveTime(row.start_date);
    var end = hiveTime(row.end_date);
    var total = null;
    var toPay = null;
    var accrued = null;
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      var startMs = BigInt(Math.round(start));
      var endMs = BigInt(Math.round(end));
      var nowMs = BigInt(Math.round(now));
      total = payOver(daily, endMs - startMs);
      if (nowMs >= endMs) toPay = 0n;
      else if (nowMs <= startMs) toPay = total;
      else toPay = payOver(daily, endMs - nowMs);
      accrued = nowMs > startMs ? payOver(daily, (nowMs < endMs ? nowMs : endMs) - startMs) : 0n;
    }
    var recorded = recordedPaid(row);
    var phase = proposalPhase(row, now);
    var paid = recorded;
    var estimated = false;
    if (paid == null) {
      if (phase === "upcoming") paid = 0n;
      else if (phase === "past") paid = null;
      else if (retVotes != null && bigIntOf(row.total_votes, 0n) > retVotes && accrued != null) {
        paid = accrued;
        estimated = true;
      } else if (phase === "active") {
        paid = 0n;
        estimated = true;
      }
    }
    return { total: total, daily: daily, paid: paid, toPay: toPay, estimated: estimated };
  }

  function compareVotes(a, b) {
    var av = bigIntOf(a.total_votes, 0n);
    var bv = bigIntOf(b.total_votes, 0n);
    if (av !== bv) return av > bv ? -1 : 1;
    return (proposalId(b) || 0) - (proposalId(a) || 0);
  }

  // Largest amount, latest date, and highest stake first. A missing figure sorts last.
  var PROPOSAL_SORTS = [
    ["total", "Total"],
    ["paid", "Paid"],
    ["topay", "To pay"],
    ["daily", "Daily"],
    ["start", "Start date"],
    ["end", "End date"],
    ["hp", "HP"],
  ];

  function normalizeProposalSort(value, fallback) {
    var i;
    for (i = 0; i < PROPOSAL_SORTS.length; i += 1) {
      if (PROPOSAL_SORTS[i][0] === value) return value;
    }
    return fallback;
  }

  function proposalSortFallback(filter) {
    if (filter === "past") return "end";
    if (filter === "all") return "paid";
    return "hp";
  }

  function proposalSortMode() {
    var filter = proposalFilter();
    if (filter === "past") return normalizeProposalSort(state.proposalSortPast, "end");
    if (filter === "all") return normalizeProposalSort(state.proposalSortAll, "paid");
    if (filter === "upcoming") return normalizeProposalSort(state.proposalSortUpcoming, "hp");
    return normalizeProposalSort(state.proposalSortActive, "hp");
  }

  // The funding line is the HP order. Any other sort is one flat list.
  function proposalSortKeepsLine() {
    var filter = proposalFilter();
    return (filter === "active" || filter === "upcoming") && proposalSortMode() === "hp";
  }

  function compareBigDesc(a, b) {
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    if (a === b) return 0;
    return a > b ? -1 : 1;
  }

  function compareTimeDesc(a, b) {
    var aOk = Number.isFinite(a);
    var bOk = Number.isFinite(b);
    if (!aOk && !bOk) return 0;
    if (!aOk) return 1;
    if (!bOk) return -1;
    if (a === b) return 0;
    return a > b ? -1 : 1;
  }

  function compareProposalSort(a, b, key, now, line) {
    var cmp = 0;
    if (key === "start" || key === "end") {
      cmp = compareTimeDesc(
        hiveTime(key === "start" ? a.start_date : a.end_date),
        hiveTime(key === "start" ? b.start_date : b.end_date)
      );
    } else if (key === "hp") {
      cmp = compareBigDesc(bigIntOf(a.total_votes, 0n), bigIntOf(b.total_votes, 0n));
    } else {
      var ap = proposalPay(a, now, line);
      var bp = proposalPay(b, now, line);
      var av = ap.paid;
      var bv = bp.paid;
      if (key === "total") {
        av = ap.total;
        bv = bp.total;
      } else if (key === "daily") {
        av = ap.daily;
        bv = bp.daily;
      } else if (key === "topay") {
        av = ap.toPay;
        bv = bp.toPay;
      }
      cmp = compareBigDesc(av, bv);
    }
    if (cmp) return cmp;
    return compareVotes(a, b);
  }

  function proposalGroups() {
    var filter = proposalFilter();
    var now = chainNow();
    var rows = state.proposals.rows;
    var list = [];
    var i;
    var query = state.proposalQuery || "";
    var hideStabilizer = state.proposalExcludeStabilizer;
    for (i = 0; i < rows.length; i += 1) {
      if (filter !== "all" && proposalPhase(rows[i], now) !== filter) continue;
      if (query && !proposalNameHit(rows[i], query)) continue;
      if (hideStabilizer && proposalIsStabilizer(rows[i])) continue;
      list.push(rows[i]);
    }
    if (filter === "upcoming") {
      // Proposal 0 stays active, so the phase filter leaves it out. Show it
      // here as the funding line when this tab has rows, or when the username
      // search names its creator or receiver. An empty upcoming tab stays empty.
      var listed = false;
      for (i = 0; i < list.length; i += 1) {
        if (isReturnProposal(list[i])) listed = true;
      }
      if (!listed) {
        for (i = 0; i < rows.length; i += 1) {
          if (!isReturnProposal(rows[i])) continue;
          if (query && !proposalNameHit(rows[i], query)) break;
          if (!list.length && !query) break;
          list.push(rows[i]);
          break;
        }
      }
    }
    if (filter === "all" || filter === "past" || !proposalSortKeepsLine()) {
      var sortKey = proposalSortMode();
      var payLine = returnVotes();
      list.sort(function (a, b) {
        return compareProposalSort(a, b, sortKey, now, payLine);
      });
      return { above: list, threshold: null, below: [] };
    }
    var ret = null;
    for (i = 0; i < list.length; i += 1) {
      if (isReturnProposal(list[i])) ret = list[i];
    }
    if (!ret) {
      list.sort(compareVotes);
      return { above: list, threshold: null, below: [] };
    }
    var line = bigIntOf(ret.total_votes, 0n);
    var above = [];
    var below = [];
    for (i = 0; i < list.length; i += 1) {
      if (isReturnProposal(list[i])) continue;
      if (bigIntOf(list[i].total_votes, 0n) > line) above.push(list[i]);
      else below.push(list[i]);
    }
    above.sort(compareVotes);
    below.sort(compareVotes);
    return { above: above, threshold: ret, below: below };
  }

  function fundingSnapshot(now) {
    var rows = state.proposals.rows;
    var line = returnVotes();
    var daily = 0n;
    var count = 0;
    var threshold = null;
    var i;
    for (i = 0; i < rows.length; i += 1) {
      if (!isReturnProposal(rows[i])) continue;
      threshold = hpOf(rows[i].total_votes);
      break;
    }
    if (line != null) {
      for (i = 0; i < rows.length; i += 1) {
        var row = rows[i];
        if (isReturnProposal(row) || proposalPhase(row, now) !== "active") continue;
        if (bigIntOf(row.total_votes, 0n) <= line) continue;
        count += 1;
        daily += assetInt(row.daily_pay, 3);
      }
    }
    return { daily: daily, count: count, threshold: threshold };
  }

  function shortDate(ts) {
    if (!Number.isFinite(ts)) return "";
    try {
      return new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(ts));
    } catch (err) {
      return "";
    }
  }

  function dateRangeText(row) {
    var start = shortDate(hiveTime(row && row.start_date));
    var end = shortDate(hiveTime(row && row.end_date));
    if (start && end) return start + " – " + end;
    return start || end || "";
  }

  function figureHtml(shown, unit, tip) {
    var text = shown || "—";
    return (
      esc(text) +
      (text !== "—" ? ' <span class="proposal-unit">' + unit + "</span>" : "") +
      (tip ? '<span class="session-stat-tip" role="tooltip">' + esc(tip) + "</span>" : "")
    );
  }

  function moneyCell(label, milli, end) {
    var shown = hbdCell(milli);
    if (label === "Paid" || label === "To pay") shown = { cell: proposalFigureText(milli) };
    return (
      '<span class="proposal-cell' +
      (end ? " is-end" : "") +
      '" data-label="' +
      esc(label) +
      '"><span class="proposal-figure">' +
      figureHtml(shown.cell, "hbd", "") +
      "</span></span>"
    );
  }

  // Active or upcoming, and strictly above the return proposal.
  function proposalApproved(row, now, line) {
    if (isReturnProposal(row) || line == null) return false;
    var phase = proposalPhase(row, now);
    if (phase !== "active" && phase !== "upcoming") return false;
    return bigIntOf(row.total_votes, 0n) > line;
  }

  function proposalApprovedHtml() {
    return (
      '<span class="proposal-approved" tabindex="0" aria-label="approved">' +
      '<svg class="proposal-approved-check" viewBox="-2 -2 28 28" aria-hidden="true">' +
      VOTE_CHECK_SVG +
      "</svg>" +
      '<span class="session-stat-tip" role="tooltip">approved</span></span>'
    );
  }

  function proposalAccountHtml(row, size) {
    var creator = accountName(row && row.creator);
    var receiver = accountName(row && row.receiver);
    var dim = size === "medium" ? "medium" : "small";
    var px = dim === "medium" ? 40 : 28;
    var user = creator
      ? '<a class="proposal-user" href="' + esc(state.host.profileHref(creator)) + '">@' + esc(creator) + "</a>"
      : "";
    var to =
      receiver && receiver !== creator
        ? '<span class="proposal-to">to</span><a class="proposal-user" href="' +
          esc(state.host.profileHref(receiver)) +
          '">@' +
          esc(receiver) +
          "</a>"
        : "";
    var avatar = creator ? avatarImg(creator, dim) : "";
    if (avatar && dim === "medium") {
      avatar =
        '<a class="proposal-avatar" href="' +
        esc(state.host.profileHref(creator)) +
        '" aria-label="@' +
        esc(creator) +
        '">' +
        avatar +
        "</a>";
    }
    return { creator: creator, receiver: receiver, user: user, to: to, avatar: avatar };
  }

  function proposalIdentityHtml(row) {
    var who = proposalAccountHtml(row);
    var subject = String((row && row.subject) || "").trim() || "Proposal";
    var permlink = String((row && row.permlink) || "");
    var href = who.creator && permlink ? state.host.appHref("/@" + who.creator + "/" + encodeURIComponent(permlink)) : "";
    var subjectHtml = href
      ? '<a class="proposal-subject" href="' + esc(href) + '">' + esc(subject) + "</a>"
      : '<span class="proposal-subject">' + esc(subject) + "</span>";
    return (
      '<div class="proposal-who">' +
      who.avatar +
      '<span class="proposal-copy">' +
      who.user +
      who.to +
      subjectHtml +
      "</span></div>"
    );
  }

  function proposalIdHtml(id) {
    if (id == null) return '<span class="proposal-id">—</span>';
    return (
      '<a class="proposal-id" href="' +
      esc(state.host.appHref("/proposals/" + id)) +
      '" aria-label="Proposal ' +
      esc(String(id)) +
      '">#' +
      esc(String(id)) +
      "</a>"
    );
  }

  function proposalFootHtml(row, phase, filter) {
    var bits = [];
    if (isReturnProposal(row)) bits.push("sets the funding line");
    else if (filter === "all" && phase) bits.push(phase);
    var range = dateRangeText(row);
    if (range) bits.push(range);
    if (!bits.length) return "";
    var text = bits.join(" · ");
    return '<span class="proposal-foot">' + esc(text) + "</span>";
  }

  function proposalStakeHtml(hp) {
    var shown = (hp && hp.compact) || "—";
    var tip = (hp && hp.exact) || "";
    return (
      '<span class="proposal-stake"' +
      (tip ? ' tabindex="0"' : "") +
      ">" +
      figureHtml(shown, "hp", tip) +
      "</span>"
    );
  }

  // Same yellow circle as the vote check. The stroke is a dollar sign.
  var PROPOSAL_PAID_MARK =
    '<svg class="dao-vote-check" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="currentColor"/><path fill="none" stroke="#070707" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 6.1v11.8M14.9 8H10.6a2 2 0 0 0 0 4h2.8a2 2 0 0 1 0 4H8.6"/></svg>';

  function proposalExpiredPaid(row, now, line) {
    if (proposalPhase(row, now) !== "past") return false;
    var paid = proposalPay(row, now, line).paid;
    return paid != null && paid > 0n;
  }

  function proposalActionHtml(row, now, line) {
    var id = proposalId(row);
    if (id == null) return "";
    var can = proposalCanVote(row, now);
    var user = state.proposalVotes.user;
    var ready = state.proposalVotes.ready;
    var voted = Boolean(user) && ready && state.proposalVotes.ids.has(id);
    var label = "proposal #" + id;
    var proxy = user && state.votes.proxy;
    if (proxy) {
      if (!can && proposalExpiredPaid(row, now, line)) {
        return (
          '<span class="proposal-vote is-voted is-paid" role="img" aria-label="Paid ' +
          esc(label) +
          '">' +
          PROPOSAL_PAID_MARK +
          "</span>"
        );
      }
      if (!ready || !voted) return "";
      var voter = state.votes.proxyVoter || proxy;
      return (
        '<span class="proposal-vote is-voted" role="img" aria-label="' +
        esc("@" + voter + " votes for " + label) +
        '">' +
        WITNESS_VOTE_CHECK +
        "</span>"
      );
    }
    if (!can && proposalExpiredPaid(row, now, line)) {
      return (
        '<span class="proposal-vote is-voted is-paid" role="img" aria-label="Paid ' +
        esc(label) +
        '">' +
        PROPOSAL_PAID_MARK +
        "</span>"
      );
    }
    if (!can && !voted) return "";
    if (!can) {
      return (
        '<span class="proposal-vote is-voted" role="img" aria-label="Voted for ' +
        esc(label) +
        '">' +
        WITNESS_VOTE_CHECK +
        "</span>"
      );
    }
    var pending = state.proposalPending.has(id);
    var waiting = Boolean(user) && !ready;
    var aria = (voted ? "Remove vote for " : "Vote for ") + label;
    return (
      '<button type="button" class="btn-primary btn-compact proposal-vote' +
      (voted ? " is-voted" : "") +
      '" data-proposal-vote="' +
      esc(String(id)) +
      '" aria-pressed="' +
      (voted ? "true" : "false") +
      '" aria-label="' +
      esc(aria) +
      '"' +
      (pending ? ' aria-busy="true"' : "") +
      (pending || waiting ? " disabled" : "") +
      ">" +
      (voted ? WITNESS_VOTE_CHECK : "Vote") +
      "</button>"
    );
  }

  function proposalRowHtml(row, now, filter, line) {
    var pay = proposalPay(row, now, line);
    var hp = hpOf(row.total_votes);
    var id = proposalId(row);
    var phase = proposalPhase(row, now);
    return (
      '<article class="proposal-row' +
      (isReturnProposal(row) ? " is-return" : "") +
      '" data-proposal="' +
      esc(id == null ? "" : String(id)) +
      '" data-account="' +
      esc(accountName(row && row.creator)) +
      '">' +
      '<div class="proposal-body">' +
      '<div class="proposal-top">' +
      proposalIdentityHtml(row) +
      proposalIdHtml(id) +
      "</div>" +
      '<div class="proposal-cells">' +
      moneyCell("Total", pay.total, false) +
      moneyCell("Daily", pay.daily, true) +
      moneyCell("Paid", pay.paid, true) +
      moneyCell("To pay", pay.toPay, true) +
      "</div>" +
      '<div class="proposal-bottom">' +
      proposalStakeHtml(hp) +
      (proposalApproved(row, now, line) ? proposalApprovedHtml() : "") +
      proposalFootHtml(row, phase, filter) +
      "</div></div>" +
      '<div class="proposal-action" data-proposal-action="' +
      esc(id == null ? "" : String(id)) +
      '">' +
      proposalActionHtml(row, now, line) +
      "</div></article>"
    );
  }

  // Upcoming sums every project. Every other tab counts a proposal only when
  // it has already been paid, or its votes are above the return proposal.
  // The note stays with those totals, so a hidden totals row hides the note.
  function proposalTotalsHtml(groups, now, line, filter) {
    var rows = groups.above.concat(groups.threshold ? [groups.threshold] : [], groups.below);
    var total = 0n;
    var paid = 0n;
    var toPay = 0n;
    var totalKnown = true;
    var paidKnown = true;
    var toPayKnown = true;
    var projects = 0;
    var approvedOnly = filter !== "upcoming";
    var i;
    for (i = 0; i < rows.length; i += 1) {
      if (isReturnProposal(rows[i])) continue;
      var pay = proposalPay(rows[i], now, line);
      if (approvedOnly) {
        var above = line != null && bigIntOf(rows[i].total_votes, 0n) > line;
        var wasPaid = pay.paid != null && pay.paid > 0n;
        if (!above && !wasPaid) continue;
      }
      projects += 1;
      if (pay.total == null) totalKnown = false;
      else total += pay.total;
      if (pay.paid == null) paidKnown = false;
      else paid += pay.paid;
      if (pay.toPay == null) toPayKnown = false;
      else toPay += pay.toPay;
    }
    if (!projects) return "";
    return (
      '<div class="proposal-totals">' +
      moneyCell("Total", totalKnown ? total : null) +
      moneyCell("Paid", paidKnown ? paid : null, true) +
      moneyCell("To pay", toPayKnown ? toPay : null, true) +
      (approvedOnly ? '<p class="proposal-approved-note">Only approved counted.</p>' : "") +
      "</div>"
    );
  }

  function proposalRowsHtml(groups, now, filter, line) {
    var html = [];
    var i;
    for (i = 0; i < groups.above.length; i += 1) html.push(proposalRowHtml(groups.above[i], now, filter, line));
    if (groups.threshold) {
      // Active and Upcoming draw the checker on the HP sort when the username
      // field is empty. The "Currently not funded" note stays on Active.
      // Upcoming has not started paying, so the line only marks which of
      // those proposals are above it. Any other sort is a flat list.
      var showFundingLine = proposalSortKeepsLine() && !state.proposalQuery;
      if (showFundingLine) {
        html.push('<p class="dao-split proposal-threshold" aria-hidden="true"><span></span></p>');
      }
      html.push(proposalRowHtml(groups.threshold, now, filter, line));
      if (showFundingLine && filter === "active") {
        html.push('<p class="proposal-unfunded">Currently not funded</p>');
      }
    }
    for (i = 0; i < groups.below.length; i += 1) html.push(proposalRowHtml(groups.below[i], now, filter, line));
    html.push(proposalTotalsHtml(groups, now, line, filter));
    return html.join("");
  }

  function proposalNameHit(row, query) {
    var creator = normalizeQuery(row && row.creator);
    var receiver = normalizeQuery(row && row.receiver);
    return creator.indexOf(query) === 0 || receiver.indexOf(query) === 0;
  }

  // The HBD stabilizer account, as creator or receiver.
  function proposalIsStabilizer(row) {
    return normalizeQuery(row && row.creator) === "hbdstabilizer" || normalizeQuery(row && row.receiver) === "hbdstabilizer";
  }

  function proposalEmptyCopy() {
    var filter = proposalFilter();
    var named = Boolean(state.proposalQuery);
    if (filter === "active") return named ? "No active proposals for that username." : "No active proposals.";
    if (filter === "upcoming") return named ? "No upcoming proposals for that username." : "No upcoming proposals.";
    if (filter === "past") return named ? "No past proposals for that username." : "No past proposals.";
    return named ? "No proposals for that username." : "No proposals to show.";
  }

  function applyProposalQuery(raw) {
    if (state.mode !== "proposals") return;
    var query = normalizeQuery(raw);
    if (query && !validQuery(query)) {
      setStatus("Usernames use letters, numbers, dots, or hyphens.", true);
      return;
    }
    setStatus("", false);
    if (query === state.proposalQuery) return;
    state.proposalQuery = query;
    paintProposalList();
  }

  function scheduleProposalSearch() {
    if (state.proposalSearchTimer) clearTimeout(state.proposalSearchTimer);
    state.proposalSearchTimer = setTimeout(function () {
      state.proposalSearchTimer = 0;
      if (state.composing || state.mode !== "proposals") return;
      var input = document.getElementById("proposalSearch");
      if (!input) return;
      applyProposalQuery(input.value);
    }, 200);
  }

  function paintProposalFilter() {
    var buttons = document.querySelectorAll(".dao-filter [data-proposal-filter]");
    var current = proposalFilter();
    buttons.forEach(function (btn) {
      var on = btn.getAttribute("data-proposal-filter") === current;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-checked", on ? "true" : "false");
    });
    paintProposalSort();
  }

  function setProposalStat(id, text) {
    var strong = document.getElementById(id);
    if (strong) strong.textContent = text;
  }

  function paintProposalStats() {
    if (state.mode !== "proposals") return;
    if (!document.getElementById("proposalTreasury")) return;
    var treasury = state.fund ? hbdCell(assetInt(state.fund.hbd_balance, 3)) : null;
    setProposalStat("proposalTreasury", treasury ? treasury.cell : "—");
    var fundedEl = document.getElementById("proposalFunded");
    var unit = document.getElementById("proposalFundedUnit");
    if (!state.proposals.rows.length) {
      setProposalStat("proposalDaily", "—");
      setProposalStat("proposalThreshold", "—");
      if (fundedEl) fundedEl.textContent = "—";
      if (unit) unit.textContent = "projects";
      return;
    }
    var snap = fundingSnapshot(chainNow());
    var daily = hbdCell(snap.daily);
    setProposalStat("proposalDaily", daily.cell);
    if (fundedEl) fundedEl.textContent = String(snap.count);
    if (unit) unit.textContent = snap.count === 1 ? "project" : "projects";
    var hp = snap.threshold;
    setProposalStat("proposalThreshold", hp && hp.compact && hp.compact !== "—" ? hp.compact : "—");
  }

  var proposalPaintGen = 0;

  function proposalNamesForPaint() {
    var names = [];
    var groups = proposalGroups();
    var rows = groups.above.concat(groups.threshold ? [groups.threshold] : [], groups.below);
    rows.forEach(function (row) {
      if (row && row.creator) names.push(row.creator);
      if (row && row.receiver) names.push(row.receiver);
    });
    return names;
  }

  function paintProposalList() {
    if (state.mode !== "proposals") return;
    var gen = ++proposalPaintGen;
    var names = state.proposals.rows.length ? proposalNamesForPaint() : [];
    prepareNames(names).then(function () {
      if (gen !== proposalPaintGen) return;
      paintProposalListBody();
    });
  }

  function paintProposalListBody() {
    if (state.mode !== "proposals") return;
    paintProposalOwn();
    var list = document.getElementById("proposalList");
    if (!list) return;
    list.classList.toggle("is-all", proposalFilter() === "all");
    list.classList.toggle(
      "is-return-yellow",
      (proposalFilter() === "active" || proposalFilter() === "upcoming") && proposalSortMode() !== "hp"
    );
    paintProposalFilter();
    if (state.proposals.error && !state.proposals.rows.length) {
      list.innerHTML = "";
      return;
    }
    if (!state.proposals.rows.length) {
      list.innerHTML =
        state.proposals.done && !state.proposals.loading ? emptyListHtml(proposalEmptyCopy()) : "";
      return;
    }
    var groups = proposalGroups();
    var count = groups.above.length + (groups.threshold ? 1 : 0) + groups.below.length;
    if (!count) {
      list.innerHTML = emptyListHtml(proposalEmptyCopy());
      return;
    }
    list.innerHTML = proposalRowsHtml(groups, chainNow(), proposalFilter(), returnVotes());
    if (window.Avatars) window.Avatars.stamp(list);
  }

  function paintProposalActions() {
    if (!onProposalPage()) return;
    var now = chainNow();
    var line = returnVotes();
    var slots = document.querySelectorAll(".proposal-action[data-proposal-action]");
    slots.forEach(function (slot) {
      var raw = slot.getAttribute("data-proposal-action");
      if (!raw) {
        slot.innerHTML = "";
        return;
      }
      var id = Number(raw);
      var row = proposalById(id);
      slot.innerHTML = row ? proposalActionHtml(row, now, line) : "";
    });
  }

  async function fetchProposalVoteIds(user, current) {
    var ids = new Set();
    var startId = 0;
    var page;
    var name = String(user || "").toLowerCase();
    for (page = 0; page < 20; page += 1) {
      var batch = await api().hiveRpc(
        "condenser_api.list_proposal_votes",
        [[name, startId], 1000, "by_voter_proposal", "ascending", "all"],
        true
      );
      if (!current()) return null;
      var list = Array.isArray(batch) ? batch : [];
      var added = 0;
      var lastId = startId;
      var sawOther = false;
      var i;
      for (i = 0; i < list.length; i += 1) {
        var vote = list[i];
        var voter = String((vote && vote.voter) || "").toLowerCase();
        if (voter !== name) {
          sawOther = true;
          continue;
        }
        var id = voteProposalId(vote);
        if (id == null) continue;
        if (id > lastId) lastId = id;
        if (ids.has(id)) continue;
        ids.add(id);
        added += 1;
      }
      if (sawOther || list.length < 1000) break;
      if (!added || lastId === startId) break;
      startId = lastId;
    }
    return ids;
  }

  async function loadProposalVotes(gen) {
    var user = (state.host && state.host.user && state.host.user()) || "";
    var serial = state.votesSerial;
    state.proposalVotes.user = user;
    state.proposalVotes.ids = new Set();
    if (!user) {
      state.proposalVotes.ready = true;
      paintProposalActions();
      return;
    }
    state.proposalVotes.ready = false;
    paintProposalActions();
    try {
      await loadVotes(gen);
      if (!alive(gen) || state.votesSerial !== serial || state.proposalVotes.user !== user) return;
      var voter = state.votes.proxy ? state.votes.proxyVoter || state.votes.proxy : user;
      var ids = await fetchProposalVoteIds(voter, function () {
        return (
          alive(gen) &&
          state.votesSerial === serial &&
          onProposalPage() &&
          state.proposalVotes.user === user
        );
      });
      if (!ids) return;
      if (!alive(gen) || state.votesSerial !== serial) return;
      state.proposalVotes.ids = ids;
      state.proposalVotes.ready = true;
    } catch (err) {
      if (!alive(gen) || state.votesSerial !== serial || state.proposalVotes.user !== user) return;
      state.proposalVotes.ready = true;
    }
    if (alive(gen) && state.votesSerial === serial && onProposalPage()) paintProposalActions();
  }

  async function castProposalVote(raw) {
    var host = state.host;
    var id = Number(raw);
    if (!host || !Number.isFinite(id)) return;
    var user = host.user() || "";
    if (!user) {
      host.openLogin();
      return;
    }
    if (!state.proposalVotes.ready || state.votes.proxy || state.proposalPending.has(id)) return;
    var row = proposalById(id);
    if (!row || !proposalCanVote(row, chainNow())) return;
    var voted = state.proposalVotes.ids.has(id);
    var gen = state.gen;
    state.proposalPending.add(id);
    paintProposalActions();
    try {
      await host.signActive(
        user,
        [
          [
            "update_proposal_votes",
            {
              voter: user,
              proposal_ids: [id],
              approve: !voted,
              extensions: [],
            },
          ],
        ],
        {
          title: voted ? "Remove proposal vote" : "Vote proposal",
          lead: "Use hive keychain (recommended) or enter the active key of @" + user + ".",
          cancelMessage: voted ? "Proposal vote stays." : "Proposal vote was not cast.",
          failMessage: voted ? "Could not remove that proposal vote." : "Could not vote for that proposal.",
        }
      );
      if (!alive(gen)) return;
      if (voted) state.proposalVotes.ids.delete(id);
      else state.proposalVotes.ids.add(id);
    } catch (err) {
      if (!(err && err.ownerCancel) && host.still()) {
        host.showError(
          (err && err.message) ||
            (voted ? "Could not remove that proposal vote." : "Could not vote for that proposal.")
        );
      }
    } finally {
      state.proposalPending.delete(id);
      if (alive(gen) && onProposalPage()) paintProposalActions();
    }
  }

  function revealProposalFilter() {
    if (state.mode !== "proposals") return;
    var bar = document.querySelector(".dao-page .dao-filter");
    if (!bar || bar.getBoundingClientRect().top >= 0) return;
    var root = document.documentElement;
    var prev = root.style.scrollBehavior;
    root.style.scrollBehavior = "auto";
    bar.scrollIntoView({ block: "start" });
    root.style.scrollBehavior = prev;
  }

  function setProposalFilter(next) {
    if (next !== "all" && next !== "active" && next !== "upcoming" && next !== "past") return;
    if (proposalFilter() === next) return;
    state.proposalFilter = next;
    paintProposalFilter();
    paintProposalList();
    revealProposalFilter();
  }

  function setProposalBusy(on) {
    var el = document.getElementById("proposalMore");
    if (el) el.hidden = !on;
  }

  function setProposalRetry(on) {
    var el = document.getElementById("proposalRetry");
    if (el) el.hidden = !on;
  }

  async function fetchAllProposals(current) {
    var rows = [];
    var seen = new Set();
    var cursorVotes = "";
    var cursorId = 0;
    var page;
    for (page = 0; page < 30; page += 1) {
      var batch = await api().hiveRpc(
        "condenser_api.list_proposals",
        [cursorVotes ? [cursorVotes, cursorId] : [], PROPOSAL_PAGE, "by_total_votes", "descending", "all"],
        true
      );
      if (!current()) return null;
      var list = Array.isArray(batch) ? batch : [];
      var added = 0;
      var i;
      for (i = 0; i < list.length; i += 1) {
        var id = proposalId(list[i]);
        if (id == null || seen.has(id)) continue;
        seen.add(id);
        rows.push(list[i]);
        added += 1;
      }
      if (list.length < PROPOSAL_PAGE) break;
      var last = list[list.length - 1];
      var nextVotes = String(last && last.total_votes != null ? last.total_votes : "");
      var nextId = proposalId(last);
      if (!nextVotes || nextId == null || (nextVotes === cursorVotes && nextId === cursorId) || !added) break;
      cursorVotes = nextVotes;
      cursorId = nextId;
    }
    return rows;
  }

  async function fetchPaidFrom(node, current) {
    var map = new Map();
    var page;
    for (page = 1; page <= 20; page += 1) {
      if (!current()) return null;
      var res = await fetch(
        node + "/hafbe-api/proposals?page=" + page + "&page-size=1000&sort=by_total_votes&direction=desc"
      );
      if (!current()) return null;
      if (!res.ok) throw new Error("no proposals app");
      var data = await res.json();
      var list = data && Array.isArray(data.proposals) ? data.proposals : null;
      if (!list) throw new Error("no proposals app");
      var i;
      for (i = 0; i < list.length; i += 1) {
        var id = proposalId(list[i]);
        if (id == null || id === 0) continue;
        map.set(id, paidMilli(list[i].paid_amount));
      }
      var pages = Number(data && data.total_pages);
      if (!list.length || (Number.isFinite(pages) && page >= pages)) return map;
    }
    return map;
  }

  async function fetchPaidAmounts(current) {
    var nodes = voterNodes();
    var i;
    for (i = 0; i < nodes.length; i += 1) {
      if (!current()) return null;
      try {
        var map = await fetchPaidFrom(nodes[i], current);
        if (!current()) return null;
        if (map && map.size) return map;
      } catch (err) {
        /* this node has no proposal index */
      }
    }
    return null;
  }

  async function loadProposals(gen) {
    state.proposalSerial += 1;
    var serial = state.proposalSerial;
    state.proposals = emptyProposals();
    state.proposals.loading = true;
    function current() {
      return alive(gen) && state.mode === "proposals" && state.proposalSerial === serial;
    }
    setProposalBusy(true);
    setProposalRetry(false);
    setStatus("", false);
    paintProposalList();
    paintProposalStats();
    try {
      var rows = await fetchAllProposals(current);
      if (!current() || !rows) return;
      var paid = await fetchPaidAmounts(current);
      if (!current()) return;
      state.proposals.rows = rows;
      if (paid) {
        state.proposals.paid = paid;
        state.proposals.paidReady = true;
      }
      state.proposals.loading = false;
      state.proposals.done = true;
      state.proposals.error = "";
      setProposalBusy(false);
      setProposalRetry(false);
      setStatus("", false);
      paintProposalStats();
      paintProposalList();
    } catch (err) {
      if (!current()) return;
      state.proposals.loading = false;
      state.proposals.done = true;
      state.proposals.error = (err && err.message) || "Could not load proposals.";
      setProposalBusy(false);
      setStatus(state.proposals.error, true);
      setProposalRetry(true);
      paintProposalList();
    }
  }

  function fieldValue(id) {
    var el = document.getElementById(id);
    return el ? String(el.value || "") : "";
  }

  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function localInputValue(date) {
    return (
      date.getFullYear() +
      "-" +
      pad2(date.getMonth() + 1) +
      "-" +
      pad2(date.getDate()) +
      "T" +
      pad2(date.getHours()) +
      ":" +
      pad2(date.getMinutes())
    );
  }

  // Hive time_point_sec is UTC. hive-tx appends Z when it serializes the string.
  function hiveStamp(date) {
    return (
      date.getUTCFullYear() +
      "-" +
      pad2(date.getUTCMonth() + 1) +
      "-" +
      pad2(date.getUTCDate()) +
      "T" +
      pad2(date.getUTCHours()) +
      ":" +
      pad2(date.getUTCMinutes()) +
      ":" +
      pad2(date.getUTCSeconds())
    );
  }

  function readLocalDate(value) {
    if (!value) return NaN;
    var t = new Date(value).getTime();
    return Number.isFinite(t) ? t : NaN;
  }

  function utf8Bytes(text) {
    var s = String(text || "");
    var n = 0;
    var i;
    for (i = 0; i < s.length; i += 1) {
      var c = s.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xd800 && c <= 0xdbff) {
        n += 4;
        i += 1;
      } else n += 3;
    }
    return n;
  }

  function proposalSubject(raw) {
    var s = String(raw || "").trim();
    if (!s) return { error: "Enter a subject." };
    if (s.length > 80 || utf8Bytes(s) > 80) return { error: "Subject is too long." };
    return { subject: s };
  }

  // A Hive post permlink is 1–255 characters of a-z, 0-9, and hyphens.
  // create_proposal stores that string and requires the post to already exist
  // under the creator or the receiver.
  var PROPOSAL_LINK_HOSTS = {
    "cyberspace77.com": true,
    "hive.blog": true,
    "peakd.com": true,
    "ecency.com": true
  };

  function proposalLinkHost(hostname) {
    var host = String(hostname || "").toLowerCase();
    if (host.indexOf("www.") === 0) host = host.slice(4);
    return PROPOSAL_LINK_HOSTS[host] ? host : "";
  }

  function permlinkFromAuthorPath(path) {
    var clean = String(path || "");
    var re = /@([a-z0-9.\-]{3,16})\/([^/?#]+)/gi;
    var match;
    var perm = "";
    while ((match = re.exec(clean))) perm = match[2];
    if (!perm) return "";
    try {
      perm = decodeURIComponent(perm);
    } catch (err) {
      return "";
    }
    return perm.replace(/\/+$/, "").replace(/[.,)]+$/, "").toLowerCase();
  }

  function proposalPermlink(raw) {
    var original = String(raw || "").trim();
    if (!original) return { error: "Enter the permlink of the post." };
    original = original.replace(/^<+|>+$/g, "").replace(/^["']+|["']+$/g, "").trim();
    original = original.replace(/[.,)]+$/, "");
    var asUrl = original;
    if (/^\/\//.test(asUrl)) asUrl = "https:" + asUrl;
    else if (/^(?:www\.)?(?:cyberspace77\.com|hive\.blog|peakd\.com|ecency\.com)(?:[/:?#]|$)/i.test(asUrl)) {
      asUrl = "https://" + asUrl;
    }
    var s = "";
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(asUrl)) {
      var parsed = null;
      try {
        parsed = new URL(asUrl);
      } catch (err) {
        parsed = null;
      }
      if (!parsed || !proposalLinkHost(parsed.hostname)) return { error: "That permlink is not valid." };
      s = permlinkFromAuthorPath(parsed.pathname);
      if (!s) return { error: "That link has no permlink." };
    } else {
      s = permlinkFromAuthorPath(original.split("#")[0]);
      if (!s) {
        s = original.split("?")[0].split("#")[0].replace(/\/+$/, "");
        var slash = s.lastIndexOf("/");
        if (slash !== -1) s = s.slice(slash + 1);
        s = s.replace(/^@+/, "");
        try {
          s = decodeURIComponent(s);
        } catch (err) {
          return { error: "That permlink is not valid." };
        }
        s = s.replace(/[.,)]+$/, "").toLowerCase();
      }
    }
    if (!s) return { error: "Enter the permlink of the post." };
    if (s.length > 255 || !/^[a-z0-9-]+$/.test(s)) return { error: "That permlink is not valid." };
    return { permlink: s };
  }

  function writeProposalPermlink(el) {
    if (!el) return;
    var parsed = proposalPermlink(el.value);
    if (parsed.permlink) el.value = parsed.permlink;
  }

  function parseDailyMilli(raw) {
    var s = String(raw || "")
      .trim()
      .replace(/\s*hbd\s*$/i, "")
      .trim();
    if (!s || s.indexOf(",") !== -1 || !/^\d+(\.\d+)?$/.test(s)) {
      return { error: "Enter a daily amount in hbd." };
    }
    var bits = s.split(".");
    var frac = bits[1] || "";
    if (frac.length > 3) return { error: "Use at most 3 decimal places." };
    var whole = bits[0].replace(/^0+(?=\d)/, "");
    if (!whole) whole = "0";
    if (whole.length > 15) return { error: "Daily pay is too large." };
    while (frac.length < 3) frac += "0";
    var milli;
    try {
      milli = BigInt(whole + frac);
    } catch (err) {
      return { error: "Enter a daily amount in hbd." };
    }
    if (milli <= 0n) return { error: "Daily pay has to be greater than 0." };
    return { milli: milli };
  }

  function chainHbd(milli) {
    var n = milli < 0n ? -milli : milli;
    var whole = (n / 1000n).toString();
    var frac = (n % 1000n).toString();
    while (frac.length < 3) frac = "0" + frac;
    return (milli < 0n ? "-" : "") + whole + "." + frac + " HBD";
  }

  function dailyInputValue(milli) {
    return chainHbd(milli).replace(/ HBD$/, "");
  }

  // create_proposal is an active-authority operation. The fee is 10 hbd,
  // plus 1 hbd for each whole day of the scheduled length past 60 days.
  function proposalFeeHbd(startMs, endMs) {
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 10;
    var days = Math.floor((endMs - startMs) / 86400000);
    if (days <= 60) return 10;
    return 10 + (days - 60);
  }

  function setProposalCreateStatus(message, isError) {
    var el = document.getElementById("proposalCreateStatus");
    if (!el) return;
    el.textContent = message || "";
    el.classList.toggle("is-error", Boolean(isError) && Boolean(message));
  }

  function setProposalCreateLocked(on) {
    state.proposalCreateBusy = Boolean(on);
    var ids = [
      "proposalCreateSubject",
      "proposalCreatePermlink",
      "proposalCreateDaily",
      "proposalCreateStart",
      "proposalCreateEnd",
      "proposalCreateReceiver",
      "proposalCreateSubmit",
    ];
    var i;
    for (i = 0; i < ids.length; i += 1) {
      var el = document.getElementById(ids[i]);
      if (el) el.disabled = Boolean(on);
    }
    var submit = document.getElementById("proposalCreateSubmit");
    if (!submit) return;
    if (on) submit.setAttribute("aria-busy", "true");
    else submit.removeAttribute("aria-busy");
  }

  function proposalCreateCurrent(ticket, gen) {
    return ticket === state.proposalCreateTicket && alive(gen) && state.mode === "proposals";
  }

  function proposalPostMissing(err) {
    var msg = String((err && err.message) || err || "");
    return /not found|does not exist|unable to find|unknown post|no such post|could not find/i.test(msg);
  }

  async function readProposalPost(author, permlink) {
    try {
      var post = await api().getPost(author, permlink);
      if (
        post &&
        String(post.author || "").toLowerCase() === author &&
        String(post.permlink || "").toLowerCase() === permlink
      ) {
        return post;
      }
      return null;
    } catch (err) {
      if (proposalPostMissing(err)) return null;
      throw err;
    }
  }

  async function findProposalPost(creator, receiver, permlink) {
    var post = await readProposalPost(creator, permlink);
    if (post || receiver === creator) return post;
    return readProposalPost(receiver, permlink);
  }

  function paintProposalCreateFigures() {
    var startMs = readLocalDate(fieldValue("proposalCreateStart"));
    var endMs = readLocalDate(fieldValue("proposalCreateEnd"));
    var feeEl = document.getElementById("proposalCreateFee");
    if (feeEl) {
      var fee = proposalFeeHbd(startMs, endMs);
      feeEl.textContent = "Creation fee: " + formatHiveMilli(BigInt(fee) * 1000n) + " hbd";
    }
    var totalEl = document.getElementById("proposalCreateTotal");
    if (!totalEl) return;
    var daily = parseDailyMilli(fieldValue("proposalCreateDaily"));
    if (daily.error || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      totalEl.value = "";
      return;
    }
    var total = payOver(daily.milli, BigInt(Math.round(endMs - startMs)));
    totalEl.value = formatHiveMilli(total) + " hbd";
  }

  function syncProposalEndFloor() {
    var startEl = document.getElementById("proposalCreateStart");
    var endEl = document.getElementById("proposalCreateEnd");
    if (!startEl || !endEl) return;
    if (startEl.value) endEl.min = startEl.value;
    else endEl.removeAttribute("min");
    if (startEl.value && endEl.value && endEl.value <= startEl.value) endEl.value = "";
  }

  var PROPOSAL_CREATE_LEAD =
    "Fill the required details. There is a fee to create a proposal: 10 hbd, plus 1 hbd for each day it lasts over 60 days. The fee is paid in hbd by the creator.";

  // update_proposal can change the subject, the permlink, the daily pay, and
  // the end date. Daily pay cannot go up. Since HF25 the end date is an
  // extension and cannot move later. Creator, receiver, and start stay fixed.
  function applyProposalFormMode() {
    var editing = state.proposalEditId != null;
    var title = document.getElementById("proposalCreateTitle");
    if (title) title.textContent = editing ? "Edit proposal" : "Create proposal";
    var lead = document.getElementById("proposalCreateLead");
    if (lead) {
      lead.textContent = editing
        ? "The subject, proposal post, daily amount, and end can be changed. Daily pay can only be lowered, and the end can only be moved earlier."
        : PROPOSAL_CREATE_LEAD;
    }
    var submit = document.getElementById("proposalCreateSubmit");
    if (submit && !state.proposalCreateBusy) submit.textContent = editing ? "Save" : "Create";
    var start = document.getElementById("proposalCreateStart");
    if (start) {
      start.readOnly = editing;
      if (editing) start.setAttribute("aria-readonly", "true");
      else start.removeAttribute("aria-readonly");
    }
    var receiver = document.getElementById("proposalCreateReceiver");
    if (receiver) {
      receiver.readOnly = editing;
      if (editing) receiver.setAttribute("aria-readonly", "true");
      else receiver.removeAttribute("aria-readonly");
    }
    var fee = document.getElementById("proposalCreateFee");
    if (fee) fee.hidden = editing;
    var dailyHint = document.getElementById("proposalCreateDailyHint");
    if (dailyHint) dailyHint.hidden = !editing;
    var dateHint = document.getElementById("proposalCreateDateHint");
    if (dateHint) dateHint.hidden = !editing;
    var receiverHint = document.getElementById("proposalCreateReceiverHint");
    if (receiverHint) {
      receiverHint.textContent = editing
        ? "The receiver cannot be changed."
        : "Account that is paid. Leave it empty to pay the creator.";
    }
  }

  function hideHostDialog(ov) {
    if (!ov) return;
    var host = state.host;
    if (host && typeof host.hideDialog === "function") {
      host.hideDialog(ov);
      return;
    }
    ov.hidden = true;
  }

  function closeCreateProposal() {
    var sign = document.getElementById("ownerSignOverlay");
    if (sign && !sign.hidden) return;
    state.proposalCreateTicket += 1;
    state.proposalEditId = null;
    setProposalCreateLocked(false);
    applyProposalFormMode();
    var endEl = document.getElementById("proposalCreateEnd");
    if (endEl) endEl.removeAttribute("max");
    hideHostDialog(document.getElementById("proposalOverlay"));
    setProposalCreateStatus("");
  }

  function proposalDialogBlocked() {
    var sign = document.getElementById("ownerSignOverlay");
    if ((sign && !sign.hidden) || state.proposalCreateBusy || state.proposalCancelBusy || state.proxyBusy) return true;
    var proxyOv = document.getElementById("proxyOverlay");
    if (proxyOv && !proxyOv.hidden) return true;
    var cancelOv = document.getElementById("proposalCancelOverlay");
    if (cancelOv && !cancelOv.hidden) return true;
    var ov = document.getElementById("proposalOverlay");
    return Boolean(ov && !ov.hidden);
  }

  function showProposalDialog(focusEl) {
    var ov = document.getElementById("proposalOverlay");
    if (!ov) return;
    ov.hidden = false;
    var card = ov.querySelector(".overlay-card");
    if (card) card.scrollTop = 0;
    if (state.host && state.host.focus) state.host.focus(focusEl);
  }

  function openCreateProposal() {
    var host = state.host;
    if (!host) return;
    var user = host.user() || "";
    if (!user) {
      host.openLogin();
      return;
    }
    if (proposalDialogBlocked()) return;
    state.proposalEditId = null;
    state.proposalCreateTicket += 1;
    setProposalCreateLocked(false);
    applyProposalFormMode();
    var creator = document.getElementById("proposalCreateCreator");
    if (creator) creator.value = user;
    var subject = document.getElementById("proposalCreateSubject");
    if (subject) subject.value = "";
    var link = document.getElementById("proposalCreatePermlink");
    if (link) link.value = "";
    var daily = document.getElementById("proposalCreateDaily");
    if (daily) daily.value = "";
    var receiver = document.getElementById("proposalCreateReceiver");
    if (receiver) receiver.value = "";
    var total = document.getElementById("proposalCreateTotal");
    if (total) total.value = "";
    var now = new Date();
    var start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    var end = new Date(start.getTime() + 30 * 86400000);
    var startEl = document.getElementById("proposalCreateStart");
    var endEl = document.getElementById("proposalCreateEnd");
    if (startEl) startEl.value = localInputValue(start);
    if (endEl) {
      endEl.value = localInputValue(end);
      endEl.removeAttribute("max");
      if (startEl && startEl.value) endEl.min = startEl.value;
    }
    setProposalCreateStatus("");
    paintProposalCreateFigures();
    showProposalDialog(subject);
  }

  function openEditProposal(raw) {
    var host = state.host;
    if (!host) return;
    var user = signedInUser();
    if (!user) {
      host.openLogin();
      return;
    }
    var id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) return;
    if (proposalDialogBlocked()) return;
    var item = ownProposalById(id);
    if (!item) return;
    var row = item.row;
    var startMs = hiveTime(row.start_date);
    var endMs = hiveTime(row.end_date);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return;
    state.proposalEditId = id;
    state.proposalCreateTicket += 1;
    setProposalCreateLocked(false);
    applyProposalFormMode();
    var creator = document.getElementById("proposalCreateCreator");
    if (creator) creator.value = user;
    var subject = document.getElementById("proposalCreateSubject");
    if (subject) subject.value = String(row.subject || "").trim();
    var link = document.getElementById("proposalCreatePermlink");
    if (link) link.value = String(row.permlink || "");
    var daily = document.getElementById("proposalCreateDaily");
    if (daily) daily.value = dailyInputValue(assetInt(row.daily_pay, 3));
    var receiver = document.getElementById("proposalCreateReceiver");
    if (receiver) receiver.value = accountName(row.receiver) || user;
    var total = document.getElementById("proposalCreateTotal");
    if (total) total.value = "";
    var startEl = document.getElementById("proposalCreateStart");
    var endEl = document.getElementById("proposalCreateEnd");
    if (startEl) startEl.value = localInputValue(new Date(startMs));
    if (endEl) {
      endEl.value = localInputValue(new Date(endMs));
      if (startEl && startEl.value) endEl.min = startEl.value;
      endEl.max = endEl.value;
    }
    setProposalCreateStatus("");
    paintProposalCreateFigures();
    showProposalDialog(subject);
  }

  async function submitCreateProposal() {
    if (state.proposalCreateBusy) return;
    var host = state.host;
    if (!host) return;
    var user = host.user() || "";
    if (!user) {
      host.openLogin();
      return;
    }
    var subject = proposalSubject(fieldValue("proposalCreateSubject"));
    if (subject.error) {
      setProposalCreateStatus(subject.error, true);
      return;
    }
    var link = proposalPermlink(fieldValue("proposalCreatePermlink"));
    if (link.error) {
      setProposalCreateStatus(link.error, true);
      return;
    }
    var daily = parseDailyMilli(fieldValue("proposalCreateDaily"));
    if (daily.error) {
      setProposalCreateStatus(daily.error, true);
      return;
    }
    var startMs = readLocalDate(fieldValue("proposalCreateStart"));
    var endMs = readLocalDate(fieldValue("proposalCreateEnd"));
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      setProposalCreateStatus("Choose a start and an end.", true);
      return;
    }
    if (endMs <= startMs) {
      setProposalCreateStatus("The end has to be after the start.", true);
      return;
    }
    if (endMs <= chainNow()) {
      setProposalCreateStatus("The end has to be in the future.", true);
      return;
    }
    var receiverRaw = fieldValue("proposalCreateReceiver").trim();
    var receiver = user;
    if (receiverRaw) {
      receiver = accountName(receiverRaw);
      if (!receiver) {
        setProposalCreateStatus("That receiver is not a hive account name.", true);
        return;
      }
    }
    var subjectEl = document.getElementById("proposalCreateSubject");
    if (subjectEl) subjectEl.value = subject.subject;
    var linkEl = document.getElementById("proposalCreatePermlink");
    if (linkEl) linkEl.value = link.permlink;
    var ticket = state.proposalCreateTicket;
    var gen = state.gen;
    setProposalCreateLocked(true);
    setProposalCreateStatus("Checking the post…", false);
    try {
      if (receiver !== user) {
        var accounts = await api().getAccounts([receiver]);
        if (!proposalCreateCurrent(ticket, gen)) return;
        var found = false;
        var rows = accounts || [];
        var i;
        for (i = 0; i < rows.length; i += 1) {
          if (String((rows[i] && rows[i].name) || "").toLowerCase() === receiver) found = true;
        }
        if (!found) {
          setProposalCreateStatus("That receiver account was not found.", true);
          return;
        }
      }
      var post = await findProposalPost(user, receiver, link.permlink);
      if (!proposalCreateCurrent(ticket, gen)) return;
      if (!post) {
        setProposalCreateStatus("That post was not found under the creator or the receiver.", true);
        return;
      }
      setProposalCreateStatus("", false);
      await host.signActive(
        user,
        [
          [
            "create_proposal",
            {
              creator: user,
              receiver: receiver,
              start_date: hiveStamp(new Date(startMs)),
              end_date: hiveStamp(new Date(endMs)),
              daily_pay: chainHbd(daily.milli),
              subject: subject.subject,
              permlink: link.permlink,
              extensions: [],
            },
          ],
        ],
        {
          title: "Create proposal",
          lead: "Use hive keychain (recommended) or enter the active key of @" + user + ".",
          cancelMessage: "Proposal was not created.",
          failMessage: "Could not create that proposal.",
        }
      );
      if (ticket !== state.proposalCreateTicket) return;
      closeCreateProposal();
      if (!alive(gen) || state.mode !== "proposals") return;
      state.proposalQuery = "";
      var search = document.getElementById("proposalSearch");
      if (search) search.value = "";
      var now = chainNow();
      var nextFilter = "active";
      if (now < startMs) nextFilter = "upcoming";
      else if (now > endMs) nextFilter = "past";
      state.proposalFilter = nextFilter;
      paintProposalFilter();
      loadProposals(state.gen);
    } catch (err) {
      if (ticket !== state.proposalCreateTicket) return;
      if (err && err.ownerCancel) return;
      var ov = document.getElementById("proposalOverlay");
      if (!ov || ov.hidden) return;
      setProposalCreateStatus((err && err.message) || "Could not create that proposal.", true);
    } finally {
      if (ticket === state.proposalCreateTicket) setProposalCreateLocked(false);
    }
  }

  async function submitEditProposal() {
    if (state.proposalCreateBusy || state.proposalEditId == null) return;
    var host = state.host;
    if (!host) return;
    var user = signedInUser();
    var id = state.proposalEditId;
    if (!user || id == null) return;
    var item = ownProposalById(id);
    if (!item) {
      setProposalCreateStatus("That proposal is no longer open.", true);
      return;
    }
    var row = item.row;
    var subject = proposalSubject(fieldValue("proposalCreateSubject"));
    if (subject.error) {
      setProposalCreateStatus(subject.error, true);
      return;
    }
    var link = proposalPermlink(fieldValue("proposalCreatePermlink"));
    if (link.error) {
      setProposalCreateStatus(link.error, true);
      return;
    }
    var daily = parseDailyMilli(fieldValue("proposalCreateDaily"));
    if (daily.error) {
      setProposalCreateStatus(daily.error, true);
      return;
    }
    var currentDaily = assetInt(row.daily_pay, 3);
    if (daily.milli > currentDaily) {
      setProposalCreateStatus("Daily pay can only be lowered.", true);
      return;
    }
    var startMs = hiveTime(row.start_date);
    var currentEnd = hiveTime(row.end_date);
    var endRaw = fieldValue("proposalCreateEnd");
    var endMs = readLocalDate(endRaw);
    if (!Number.isFinite(startMs) || !Number.isFinite(currentEnd) || !Number.isFinite(endMs)) {
      setProposalCreateStatus("Choose an end.", true);
      return;
    }
    var endChanged = localInputValue(new Date(currentEnd)) !== endRaw;
    if (endChanged) {
      if (endMs <= startMs) {
        setProposalCreateStatus("The end has to be after the start.", true);
        return;
      }
      if (endMs > currentEnd) {
        setProposalCreateStatus("The end can only be moved earlier.", true);
        return;
      }
    }
    var currentSubject = String(row.subject || "").trim();
    var currentPermlink = String(row.permlink || "");
    if (
      subject.subject === currentSubject &&
      link.permlink === currentPermlink &&
      daily.milli === currentDaily &&
      !endChanged
    ) {
      setProposalCreateStatus("Nothing was changed.", true);
      return;
    }
    var receiver = accountName(row.receiver) || user;
    var subjectEl = document.getElementById("proposalCreateSubject");
    if (subjectEl) subjectEl.value = subject.subject;
    var linkEl = document.getElementById("proposalCreatePermlink");
    if (linkEl) linkEl.value = link.permlink;
    var ticket = state.proposalCreateTicket;
    var gen = state.gen;
    setProposalCreateLocked(true);
    try {
      if (link.permlink !== currentPermlink) {
        setProposalCreateStatus("Checking the post…", false);
        var post = await findProposalPost(user, receiver, link.permlink);
        if (!proposalCreateCurrent(ticket, gen)) return;
        if (!post) {
          setProposalCreateStatus("That post was not found under the creator or the receiver.", true);
          return;
        }
      }
      setProposalCreateStatus("", false);
      // Extension index 1 is update_proposal_end_date. hive-tx and Keychain
      // both take that static variant as [1, { end_date }].
      var extensions = endChanged ? [[1, { end_date: hiveStamp(new Date(endMs)) }]] : [];
      await host.signActive(
        user,
        [
          [
            "update_proposal",
            {
              proposal_id: id,
              creator: user,
              daily_pay: chainHbd(daily.milli),
              subject: subject.subject,
              permlink: link.permlink,
              extensions: extensions,
            },
          ],
        ],
        {
          title: "Edit proposal",
          lead: "Use hive keychain (recommended) or enter the active key of @" + user + ".",
          cancelMessage: "The proposal was not changed.",
          failMessage: "Could not update that proposal.",
        }
      );
      if (ticket !== state.proposalCreateTicket) return;
      row.subject = subject.subject;
      row.permlink = link.permlink;
      row.daily_pay = chainHbd(daily.milli);
      if (endChanged) row.end_date = hiveStamp(new Date(endMs));
      closeCreateProposal();
      if (!alive(gen) || state.mode !== "proposals") return;
      paintProposalStats();
      paintProposalList();
      loadProposals(state.gen);
    } catch (err) {
      if (ticket !== state.proposalCreateTicket) return;
      if (err && err.ownerCancel) return;
      var ov = document.getElementById("proposalOverlay");
      if (!ov || ov.hidden) return;
      setProposalCreateStatus((err && err.message) || "Could not update that proposal.", true);
    } finally {
      if (ticket === state.proposalCreateTicket) setProposalCreateLocked(false);
    }
  }

  var proposalDialogBound = false;
  function bindProposalDialog() {
    if (proposalDialogBound) return;
    var ov = document.getElementById("proposalOverlay");
    if (!ov) return;
    proposalDialogBound = true;
    ov.addEventListener("click", function (event) {
      if (event.target !== ov) return;
      var active = document.activeElement;
      if (active && ov.contains(active)) return;
      closeCreateProposal();
    });
    var cancel = document.getElementById("proposalCreateCancel");
    if (cancel) {
      cancel.addEventListener("click", function () {
        closeCreateProposal();
      });
    }
    var submit = document.getElementById("proposalCreateSubmit");
    if (submit) {
      submit.addEventListener("click", function () {
        if (state.proposalEditId != null) submitEditProposal();
        else submitCreateProposal();
      });
    }
    var startInput = document.getElementById("proposalCreateStart");
    if (startInput) {
      startInput.addEventListener("keydown", function (event) {
        if (startInput.readOnly) event.preventDefault();
      });
      startInput.addEventListener("beforeinput", function (event) {
        if (startInput.readOnly) event.preventDefault();
      });
    }
    var permInput = document.getElementById("proposalCreatePermlink");
    if (permInput) {
      permInput.addEventListener("paste", function (event) {
        var text = event.clipboardData ? event.clipboardData.getData("text") : "";
        if (!text || !text.trim()) return;
        var parsed = proposalPermlink(text);
        if (!parsed.permlink || parsed.permlink === text) return;
        event.preventDefault();
        var start = permInput.selectionStart == null ? permInput.value.length : permInput.selectionStart;
        var end = permInput.selectionEnd == null ? permInput.value.length : permInput.selectionEnd;
        var next = permInput.value.slice(0, start) + parsed.permlink + permInput.value.slice(end);
        permInput.value = next;
        var caret = start + parsed.permlink.length;
        if (permInput.setSelectionRange) permInput.setSelectionRange(caret, caret);
      });
      permInput.addEventListener("blur", function () {
        writeProposalPermlink(permInput);
      });
    }
    ov.addEventListener("input", function (event) {
      var t = event.target;
      if (!t || !t.id) return;
      if (t.id === "proposalCreateReceiver") {
        var raw = String(t.value || "");
        var next = raw.replace(/^@+/, "").toLowerCase();
        if (next !== raw) {
          var pos = t.selectionStart;
          var cut = raw.length - next.length;
          t.value = next;
          if (pos != null && t.setSelectionRange) {
            var at = pos - cut;
            if (at < 0) at = 0;
            if (at > next.length) at = next.length;
            t.setSelectionRange(at, at);
          }
        }
      }
      if (
        t.id !== "proposalCreateDaily" &&
        t.id !== "proposalCreateStart" &&
        t.id !== "proposalCreateEnd" &&
        t.id !== "proposalCreateReceiver"
      ) {
        return;
      }
      if (t.id === "proposalCreateStart" || t.id === "proposalCreateEnd") syncProposalEndFloor();
      paintProposalCreateFigures();
    });
  }

  function signedInUser() {
    var host = state.host;
    var user = host && host.user ? host.user() || "" : "";
    return accountName(user);
  }

  // remove_proposal needs the creator's active key. The chain rejects any
  // other account, including the receiver. Proposal 0 is the funding line.
  function ownProposalRows() {
    var user = signedInUser();
    if (!user) return [];
    var now = chainNow();
    var line = returnVotes();
    var rows = state.proposals.rows;
    var list = [];
    var i;
    for (i = 0; i < rows.length; i += 1) {
      var row = rows[i];
      if (!row || row.removed || isReturnProposal(row)) continue;
      if (accountName(row.creator) !== user) continue;
      var phase = proposalPhase(row, now);
      if (phase !== "active" && phase !== "upcoming") continue;
      var standing = "active";
      if (phase === "upcoming") standing = "upcoming";
      else if (line != null && bigIntOf(row.total_votes, 0n) > line) standing = "approved";
      list.push({ row: row, standing: standing, id: proposalId(row), start: hiveTime(row.start_date) });
    }
    list.sort(function (a, b) {
      var as = Number.isFinite(a.start) ? a.start : 0;
      var bs = Number.isFinite(b.start) ? b.start : 0;
      if (as !== bs) return as < bs ? -1 : 1;
      return (a.id || 0) - (b.id || 0);
    });
    return list;
  }

  function ownProposalById(id) {
    var rows = ownProposalRows();
    var i;
    for (i = 0; i < rows.length; i += 1) {
      if (rows[i].id === id) return rows[i];
    }
    return null;
  }

  function proposalOwnSubject(row) {
    return String((row && row.subject) || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function proposalOwnHtml() {
    var rows = ownProposalRows();
    if (!rows.length) return "";
    var html = "";
    var i;
    for (i = 0; i < rows.length; i += 1) {
      var item = rows[i];
      var subject = proposalOwnSubject(item.row);
      html +=
        '<div class="proposal-own-note">' +
        '<span class="proposal-own-text">' +
        '<span class="proposal-own-label">Proposal' +
        (subject ? " " : "") +
        "</span>" +
        (subject ? '<span class="proposal-own-subject">' + esc(subject) + "</span>" : "") +
        '<span class="proposal-own-meta"> #' +
        esc(String(item.id)) +
        " " +
        esc(item.standing) +
        ".</span>" +
        "</span>" +
        '<div class="dao-more proposal-own-more">' +
        '<button type="button" class="dao-more-btn" aria-label="More actions for proposal #' +
        esc(String(item.id)) +
        '" aria-haspopup="menu" aria-expanded="false">\u00b7\u00b7\u00b7</button>' +
        '<div class="dao-more-menu" role="menu" hidden>' +
        '<button type="button" class="dao-more-item" role="menuitem" data-proposal-edit="' +
        esc(String(item.id)) +
        '">Edit</button>' +
        '<button type="button" class="dao-more-item" role="menuitem" data-proposal-cancel="' +
        esc(String(item.id)) +
        '">Cancel proposal</button>' +
        "</div></div>" +
        "</div>";
    }
    return html;
  }

  function paintProposalOwn() {
    if (state.mode !== "proposals") return;
    var el = document.getElementById("proposalOwn");
    if (!el) return;
    var html = proposalOwnHtml();
    el.innerHTML = html;
    el.hidden = !html;
  }

  function setProposalCancelStatus(message, isError) {
    var el = document.getElementById("proposalCancelStatus");
    if (!el) return;
    el.textContent = message || "";
    el.classList.toggle("is-error", Boolean(isError) && Boolean(message));
  }

  function setProposalCancelLocked(on) {
    state.proposalCancelBusy = Boolean(on);
    var ids = ["proposalCancelSubmit", "proposalCancelDismiss"];
    var i;
    for (i = 0; i < ids.length; i += 1) {
      var el = document.getElementById(ids[i]);
      if (el) el.disabled = Boolean(on);
    }
    var submit = document.getElementById("proposalCancelSubmit");
    if (!submit) return;
    if (on) submit.setAttribute("aria-busy", "true");
    else submit.removeAttribute("aria-busy");
  }

  function closeProposalCancel() {
    var sign = document.getElementById("ownerSignOverlay");
    if (sign && !sign.hidden) return;
    state.proposalCancelTicket += 1;
    state.proposalCancelId = null;
    setProposalCancelLocked(false);
    hideHostDialog(document.getElementById("proposalCancelOverlay"));
    setProposalCancelStatus("");
  }

  function openProposalCancel(raw) {
    var host = state.host;
    if (!host) return;
    var user = signedInUser();
    if (!user) {
      host.openLogin();
      return;
    }
    var id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) return;
    var sign = document.getElementById("ownerSignOverlay");
    if ((sign && !sign.hidden) || state.proposalCancelBusy || state.proposalCreateBusy || state.proxyBusy) return;
    var proxyOv = document.getElementById("proxyOverlay");
    if (proxyOv && !proxyOv.hidden) return;
    var create = document.getElementById("proposalOverlay");
    if (create && !create.hidden) return;
    var ov = document.getElementById("proposalCancelOverlay");
    if (!ov || !ov.hidden) return;
    var item = null;
    var rows = ownProposalRows();
    var i;
    for (i = 0; i < rows.length; i += 1) {
      if (rows[i].id === id) item = rows[i];
    }
    if (!item) return;
    state.proposalCancelId = id;
    state.proposalCancelTicket += 1;
    setProposalCancelLocked(false);
    var lead = document.getElementById("proposalCancelLead");
    var subject = proposalOwnSubject(item.row);
    if (lead) {
      lead.textContent = subject
        ? "Cancel Proposal " + subject + " #" + id + ". The creation fee is not returned."
        : "Cancel proposal #" + id + ". The creation fee is not returned.";
    }
    setProposalCancelStatus("");
    ov.hidden = false;
    var submit = document.getElementById("proposalCancelSubmit");
    if (host.focus) host.focus(submit);
  }

  async function submitProposalCancel() {
    if (state.proposalCancelBusy) return;
    var host = state.host;
    if (!host) return;
    var user = signedInUser();
    var id = state.proposalCancelId;
    if (!user || id == null) return;
    var item = null;
    var owned = ownProposalRows();
    var i;
    for (i = 0; i < owned.length; i += 1) {
      if (owned[i].id === id) item = owned[i];
    }
    if (!item) {
      setProposalCancelStatus("That proposal is no longer open.", true);
      return;
    }
    var ticket = state.proposalCancelTicket;
    var gen = state.gen;
    setProposalCancelLocked(true);
    setProposalCancelStatus("");
    try {
      await host.signActive(
        user,
        [
          [
            "remove_proposal",
            {
              proposal_owner: user,
              proposal_ids: [id],
              extensions: [],
            },
          ],
        ],
        {
          title: "Cancel proposal",
          lead: "Use hive keychain (recommended) or enter the active key of @" + user + ".",
          cancelMessage: "The proposal was not cancelled.",
          failMessage: "Could not cancel that proposal.",
        }
      );
      if (ticket !== state.proposalCancelTicket) return;
      closeProposalCancel();
      if (!alive(gen) || state.mode !== "proposals") return;
      var next = [];
      var rows = state.proposals.rows;
      for (i = 0; i < rows.length; i += 1) {
        if (proposalId(rows[i]) !== id) next.push(rows[i]);
      }
      state.proposals.rows = next;
      paintProposalStats();
      paintProposalList();
      loadProposals(state.gen);
    } catch (err) {
      if (ticket !== state.proposalCancelTicket) return;
      if (err && err.ownerCancel) return;
      var ov = document.getElementById("proposalCancelOverlay");
      if (!ov || ov.hidden) return;
      setProposalCancelStatus((err && err.message) || "Could not cancel that proposal.", true);
    } finally {
      if (ticket === state.proposalCancelTicket) setProposalCancelLocked(false);
    }
  }

  var proposalCancelBound = false;
  function bindProposalCancel() {
    if (proposalCancelBound) return;
    var ov = document.getElementById("proposalCancelOverlay");
    if (!ov) return;
    proposalCancelBound = true;
    ov.addEventListener("click", function (event) {
      if (event.target !== ov) return;
      var active = document.activeElement;
      if (active && ov.contains(active)) return;
      closeProposalCancel();
    });
    var dismiss = document.getElementById("proposalCancelDismiss");
    if (dismiss) {
      dismiss.addEventListener("click", function () {
        closeProposalCancel();
      });
    }
    var submit = document.getElementById("proposalCancelSubmit");
    if (submit) {
      submit.addEventListener("click", function () {
        submitProposalCancel();
      });
    }
  }

  function proposalExcludeHtml() {
    return (
      '<label class="cyber-toggle cyber-toggle-compact">' +
      '<input id="proposalExcludeStabilizer" type="checkbox"' +
      (state.proposalExcludeStabilizer ? " checked" : "") +
      ">" +
      '<span class="cyber-toggle-track" aria-hidden="true"></span>' +
      '<span class="cyber-toggle-copy">' +
      '<span class="cyber-toggle-title">exclude hbd stabilizer</span>' +
      "</span></label>"
    );
  }

  var PROPOSAL_SORT_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" stroke-linejoin="miter"><path d="M7 4v16"/><path d="M3.6 7.4 7 4l3.4 3.4"/><path d="M17 20V4"/><path d="M13.6 16.6 17 20l3.4-3.4"/></g></svg>';
  var PROPOSAL_SORT_CHECK =
    '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter" d="M3.1 8.2 6.3 11.4 12.9 4.6"/></svg>';

  function proposalSortHtml() {
    var mode = proposalSortMode() || "paid";
    var items = "";
    var i;
    for (i = 0; i < PROPOSAL_SORTS.length; i += 1) {
      var on = PROPOSAL_SORTS[i][0] === mode;
      items +=
        '<button type="button" class="comment-sort-item' +
        (on ? " is-selected" : "") +
        '" role="menuitemradio" data-proposal-sort="' +
        PROPOSAL_SORTS[i][0] +
        '" aria-checked="' +
        (on ? "true" : "false") +
        '"><span class="comment-sort-check">' +
        PROPOSAL_SORT_CHECK +
        "</span>" +
        esc(PROPOSAL_SORTS[i][1]) +
        "</button>";
    }
    return (
      '<div class="comment-sort proposal-sort" data-sort="' +
      esc(mode) +
      '">' +
      '<button type="button" class="comment-sort-btn" aria-haspopup="menu" aria-expanded="false" aria-label="Sort proposals" title="Sort proposals">' +
      PROPOSAL_SORT_ICON +
      "</button>" +
      '<div class="comment-sort-menu" role="menu" hidden>' +
      items +
      "</div></div>"
    );
  }

  function proposalSortRoot() {
    return document.querySelector(".dao-page .proposal-sort");
  }

  function closeProposalSort() {
    var root = proposalSortRoot();
    if (!root) return;
    root.classList.remove("is-open");
    var menu = root.querySelector(".comment-sort-menu");
    var btn = root.querySelector(".comment-sort-btn");
    if (menu) menu.hidden = true;
    if (btn) btn.setAttribute("aria-expanded", "false");
  }

  function placeProposalSortMenu(menu, btn) {
    if (!menu || !btn) return;
    menu.classList.remove("is-up");
    var rect = btn.getBoundingClientRect();
    var needed = menu.offsetHeight + 12;
    var below = window.innerHeight - rect.bottom;
    var above = rect.top;
    if (below < needed && above > below) menu.classList.add("is-up");
  }

  function toggleProposalSort() {
    var root = proposalSortRoot();
    if (!root || root.hidden) return;
    if (root.classList.contains("is-open")) {
      closeProposalSort();
      return;
    }
    closeProxyMenu();
    root.classList.add("is-open");
    var menu = root.querySelector(".comment-sort-menu");
    var btn = root.querySelector(".comment-sort-btn");
    if (menu) menu.hidden = false;
    if (btn) btn.setAttribute("aria-expanded", "true");
    placeProposalSortMenu(menu, btn);
  }

  function paintProposalSort() {
    var root = proposalSortRoot();
    if (!root) return;
    var mode = proposalSortMode();
    root.hidden = false;
    root.setAttribute("data-sort", mode);
    var items = root.querySelectorAll(".comment-sort-item");
    items.forEach(function (btn) {
      var on = btn.getAttribute("data-proposal-sort") === mode;
      btn.classList.toggle("is-selected", on);
      btn.setAttribute("aria-checked", on ? "true" : "false");
    });
  }

  function applyProposalSort(next) {
    var filter = proposalFilter();
    var mode = normalizeProposalSort(next, proposalSortFallback(filter));
    var prev = proposalSortMode();
    if (filter === "past") state.proposalSortPast = mode;
    else if (filter === "all") state.proposalSortAll = mode;
    else if (filter === "upcoming") state.proposalSortUpcoming = mode;
    else state.proposalSortActive = mode;
    closeProposalSort();
    if (prev === mode) {
      paintProposalSort();
      return;
    }
    paintProposalList();
  }

  function proxyMenuHtml() {
    var label = state.votes.proxy ? "Remove proxy" : "Set proxy";
    var waiting = (Boolean(state.votes.user) && !state.votes.ready) || state.proxyBusy;
    return (
      '<div class="dao-more">' +
      '<button type="button" class="dao-more-btn" aria-label="More actions" aria-haspopup="menu" aria-expanded="false">\u00b7\u00b7\u00b7</button>' +
      '<div class="dao-more-menu" role="menu" hidden>' +
      '<button type="button" class="dao-more-item" role="menuitem" data-proxy-action' +
      (waiting ? " disabled" : "") +
      ">" +
      esc(label) +
      "</button></div></div>"
    );
  }

  function paintProxyMenu() {
    var label = state.votes.proxy ? "Remove proxy" : "Set proxy";
    var waiting = Boolean(state.votes.user) && !state.votes.ready;
    var buttons = document.querySelectorAll("[data-proxy-action]");
    buttons.forEach(function (btn) {
      btn.textContent = label;
      btn.disabled = waiting || state.proxyBusy;
    });
  }

  function proxyMenuOpen() {
    return Boolean(document.querySelector(".dao-more.is-open"));
  }

  function closeProxyMenu() {
    var roots = document.querySelectorAll(".dao-more.is-open");
    roots.forEach(function (root) {
      var menu = root.querySelector(".dao-more-menu");
      if (menu && state.host && typeof state.host.restoreMenu === "function") state.host.restoreMenu(menu);
      root.classList.remove("is-open");
      var btn = root.querySelector(".dao-more-btn");
      if (btn) btn.setAttribute("aria-expanded", "false");
      if (menu) menu.hidden = true;
    });
  }

  function toggleProxyMenu(btn) {
    var root = btn && btn.closest ? btn.closest(".dao-more") : null;
    if (!root) return;
    var open = root.classList.contains("is-open");
    closeProxyMenu();
    closeProposalSort();
    if (open) return;
    root.classList.add("is-open");
    btn.setAttribute("aria-expanded", "true");
    var menu = root.querySelector(".dao-more-menu");
    if (!menu) return;
    menu.hidden = false;
    if (state.host && typeof state.host.focusMenu === "function") state.host.focusMenu(menu);
  }

  function setProxyStatus(message, isError) {
    var el = document.getElementById("proxyStatus");
    if (!el) return;
    el.textContent = message || "";
    el.classList.toggle("is-error", Boolean(isError) && Boolean(message));
  }

  function setProxyLocked(on) {
    state.proxyBusy = Boolean(on);
    var ids = ["proxyUser", "proxySubmit", "proxyDismiss"];
    var i;
    for (i = 0; i < ids.length; i += 1) {
      var el = document.getElementById(ids[i]);
      if (el) el.disabled = Boolean(on);
    }
    var submit = document.getElementById("proxySubmit");
    if (!submit) return;
    if (on) submit.setAttribute("aria-busy", "true");
    else submit.removeAttribute("aria-busy");
    paintProxyMenu();
  }

  function closeProxyDialog() {
    var sign = document.getElementById("ownerSignOverlay");
    if (sign && !sign.hidden) return;
    state.proxyTicket += 1;
    setProxyLocked(false);
    hideHostDialog(document.getElementById("proxyOverlay"));
    setProxyStatus("");
    var input = document.getElementById("proxyUser");
    if (input) input.value = "";
  }

  function daoDialogOpen() {
    var sign = document.getElementById("ownerSignOverlay");
    if (sign && !sign.hidden) return true;
    var ids = ["proxyOverlay", "proposalOverlay", "proposalCancelOverlay"];
    var i;
    for (i = 0; i < ids.length; i += 1) {
      var ov = document.getElementById(ids[i]);
      if (ov && !ov.hidden) return true;
    }
    return false;
  }

  function openProxyDialog() {
    var host = state.host;
    if (!host) return;
    var user = host.user() || "";
    if (!user) {
      host.openLogin();
      return;
    }
    if (state.votes.user && !state.votes.ready) return;
    if (state.votes.proxy || state.proxyBusy || daoDialogOpen()) return;
    state.proxyTicket += 1;
    setProxyLocked(false);
    setProxyStatus("");
    var input = document.getElementById("proxyUser");
    var search = document.getElementById("proposalSearch");
    var typed = search ? String(search.value || "").trim() : "";
    if (input) input.value = typed;
    var ov = document.getElementById("proxyOverlay");
    if (ov) ov.hidden = false;
    if (host.focus) host.focus(input);
  }

  // Broadcasts land a block after the node accepts them, so the account's proxy
  // field can still be stale. Apply the signed value, then load that voter's lists.
  async function applyGovernance(gen, proxy) {
    var user = state.host.user() || "";
    state.votesSerial += 1;
    var serial = state.votesSerial;
    state.votes.user = user;
    state.votes.proxy = accountName(proxy) || "";
    state.votes.proxyVoter = state.votes.proxy;
    state.votes.ready = false;
    state.votes.names = new Set();
    state.proposalVotes.user = user;
    state.proposalVotes.ready = false;
    state.proposalVotes.ids = new Set();
    state.votedKey = "";
    paintProxyMenu();
    paintVoteNote();
    paintVoteButtons();
    if (onProposalPage()) paintProposalActions();
    try {
      if (state.votes.proxy) {
        var resolved = await resolveProxyVotes(state.votes.proxy, function () {
          return votesCurrent(gen, serial, user);
        });
        if (!votesCurrent(gen, serial, user)) return;
        state.votes.proxyVoter = (resolved && resolved.voter) || state.votes.proxy;
        state.votes.names = (resolved && resolved.names) || new Set();
      } else {
        var account = await accountByName(user);
        if (!votesCurrent(gen, serial, user)) return;
        state.votes.proxyVoter = "";
        state.votes.names = witnessNamesOf(account);
      }
      state.votes.ready = true;
    } catch (err) {
      if (!votesCurrent(gen, serial, user)) return;
      state.votes.ready = true;
    }
    if (!votesCurrent(gen, serial, user)) return;
    paintVoteNote();
    paintProxyMenu();
    paintVoteButtons();
    if (witnessFilter() === "voted" && state.mode === "witnesses") ensureVoted(gen);
    if (!onProposalPage()) return;
    try {
      var voter = state.votes.proxy ? state.votes.proxyVoter || state.votes.proxy : user;
      var ids = await fetchProposalVoteIds(voter, function () {
        return votesCurrent(gen, serial, user) && onProposalPage();
      });
      if (!ids || !votesCurrent(gen, serial, user)) return;
      state.proposalVotes.ids = ids;
      state.proposalVotes.ready = true;
    } catch (err2) {
      if (!votesCurrent(gen, serial, user)) return;
      state.proposalVotes.ready = true;
    }
    if (votesCurrent(gen, serial, user) && onProposalPage()) paintProposalActions();
  }

  async function submitProxy() {
    if (state.proxyBusy) return;
    var host = state.host;
    if (!host) return;
    var user = accountName(host.user() || "");
    if (!user) {
      host.openLogin();
      return;
    }
    var input = document.getElementById("proxyUser");
    var raw = input ? String(input.value || "") : "";
    var name = accountName(raw);
    if (!String(raw || "").trim()) {
      setProxyStatus("Enter a username.", true);
      return;
    }
    if (!name) {
      setProxyStatus("Usernames use letters, numbers, dots, or hyphens.", true);
      return;
    }
    if (input) input.value = name;
    if (name === user) {
      setProxyStatus("An account cannot be its own proxy.", true);
      return;
    }
    var ticket = state.proxyTicket;
    var gen = state.gen;
    setProxyLocked(true);
    setProxyStatus("");
    try {
      var account = await accountByName(name);
      if (ticket !== state.proxyTicket) return;
      if (!account) {
        setProxyStatus("That account was not found.", true);
        return;
      }
      await host.signActive(
        user,
        [
          [
            "account_witness_proxy",
            {
              account: user,
              proxy: name,
            },
          ],
        ],
        {
          title: "Set proxy",
          lead: "Use hive keychain (recommended) or enter the active key of @" + user + ".",
          cancelMessage: "The proxy was not set.",
          failMessage: "Could not set that proxy.",
        }
      );
      if (ticket !== state.proxyTicket) return;
      closeProxyDialog();
      if (!alive(gen)) return;
      applyGovernance(gen, name);
    } catch (err) {
      if (ticket !== state.proxyTicket) return;
      if (err && err.ownerCancel) return;
      var ov = document.getElementById("proxyOverlay");
      if (!ov || ov.hidden) return;
      setProxyStatus((err && err.message) || "Could not set that proxy.", true);
    } finally {
      if (ticket === state.proxyTicket) setProxyLocked(false);
    }
  }

  async function removeProxy() {
    var host = state.host;
    if (!host || state.proxyBusy) return;
    var user = accountName(host.user() || "");
    if (!user) {
      host.openLogin();
      return;
    }
    if (!state.votes.ready || !state.votes.proxy) return;
    if (daoDialogOpen()) return;
    var gen = state.gen;
    var serial = state.votesSerial;
    state.proxyBusy = true;
    paintProxyMenu();
    try {
      await host.signActive(
        user,
        [
          [
            "account_witness_proxy",
            {
              account: user,
              proxy: "",
            },
          ],
        ],
        {
          title: "Remove proxy",
          lead: "Use hive keychain (recommended) or enter the active key of @" + user + ".",
          cancelMessage: "The proxy was not removed.",
          failMessage: "Could not remove the proxy.",
        }
      );
      if (!alive(gen) || state.votesSerial !== serial) return;
      applyGovernance(gen, "");
    } catch (err) {
      if (!(err && err.ownerCancel) && host.still && host.still()) {
        host.showError((err && err.message) || "Could not remove the proxy.");
      }
    } finally {
      state.proxyBusy = false;
      paintProxyMenu();
    }
  }

  var proxyDialogBound = false;
  function bindProxyDialog() {
    if (proxyDialogBound) return;
    var ov = document.getElementById("proxyOverlay");
    if (!ov) return;
    proxyDialogBound = true;
    ov.addEventListener("click", function (event) {
      if (event.target !== ov) return;
      var active = document.activeElement;
      if (active && ov.contains(active)) return;
      closeProxyDialog();
    });
    ov.addEventListener("keydown", function (event) {
      if (event.key !== "Enter" || event.isComposing) return;
      if (event.target && event.target.id === "proxyUser") {
        event.preventDefault();
        submitProxy();
      }
    });
    var dismiss = document.getElementById("proxyDismiss");
    if (dismiss) {
      dismiss.addEventListener("click", function () {
        closeProxyDialog();
      });
    }
    var submit = document.getElementById("proxySubmit");
    if (submit) {
      submit.addEventListener("click", function () {
        submitProxy();
      });
    }
  }

  function proposalShell() {
    return (
      '<section class="cs77-page dao-page">' +
      navHtml("proposals") +
      '<h2 class="page-title">Proposals</h2>' +
      '<p class="dao-kicker">Decentralized fund</p>' +
      '<div class="dao-copy">' +
      "<p>Proposals are how a project asks the DAO for funding. The project names a daily amount, and that amount is paid in HBD for a set number of days if approved. Stakeholders vote with their hive stake including proxies.</p>" +
      "<p>Vote for the return proposal to have a say in the decentralized fund. A project is paid only while it has more votes than the return proposal.</p>" +
      "<p>Total is the daily amount times the length of the proposal. Paid is what has already been sent. To pay is the part of the schedule still ahead. Days spent below the return proposal are not paid later.</p>" +
      "</div>" +
      '<div class="dao-stats proposal-stats">' +
      '<a class="dao-stat dao-stat-treasury" href="' +
      esc(state.host.profileHref("hive.fund", "wallet")) +
      '"><span class="dao-stat-label">treasury</span><strong id="proposalTreasury">—</strong><span class="dao-stat-unit">hbd</span></a>' +
      '<div class="dao-stat"><span class="dao-stat-label">daily pay</span><strong id="proposalDaily">—</strong><span class="dao-stat-unit">hbd</span></div>' +
      '<div class="dao-stat"><span class="dao-stat-label">funded</span><strong id="proposalFunded">—</strong><span class="dao-stat-unit" id="proposalFundedUnit">projects</span></div>' +
      '<div class="dao-stat"><span class="dao-stat-label">return votes</span><strong id="proposalThreshold">—</strong><span class="dao-stat-unit">hp</span></div>' +
      "</div>" +
      '<p class="dao-note" id="daoVoteNote" hidden></p>' +
      '<div class="dao-create">' +
      '<button type="button" class="btn-primary btn-compact" id="proposalCreate">Create proposal</button>' +
      '<div id="proposalOwn" class="proposal-own" hidden></div>' +
      "</div>" +
      '<div class="dao-filter" role="radiogroup" aria-label="Filter proposals">' +
      '<button type="button" role="radio" data-proposal-filter="active" aria-checked="true" class="is-active">Active</button>' +
      '<button type="button" role="radio" data-proposal-filter="all" aria-checked="false">All</button>' +
      '<button type="button" role="radio" data-proposal-filter="upcoming" aria-checked="false">Upcoming</button>' +
      '<button type="button" role="radio" data-proposal-filter="past" aria-checked="false">Past</button>' +
      "</div>" +
      '<div class="dao-tools">' +
      '<form class="tags-add search-form" id="proposalSearchForm">' +
      '<input id="proposalSearch" type="text" maxlength="32" placeholder="Search username" value="' +
      esc(state.proposalQuery || "") +
      '" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" aria-label="Search proposals by username">' +
      glassHtml() +
      "</form>" +
      proxyMenuHtml() +
      '<div class="dao-proposal-side">' +
      proposalExcludeHtml() +
      proposalSortHtml() +
      "</div></div>" +
      '<p class="tags-status" id="daoStatus" hidden></p>' +
      '<div class="proposal-table" id="proposalTable">' +
      '<div id="proposalList"></div>' +
      "</div>" +
      '<div id="proposalMore" class="loading-row is-feed-more" hidden><span class="btn-loader" role="status" aria-label="Loading proposals"></span></div>' +
      '<button type="button" class="btn-ghost" id="proposalRetry" hidden>Try again</button>' +
      "</section>"
    );
  }

  function renderProposals(gen) {
    state.mode = "proposals";
    state.host.setPageMeta(
      "Proposals — CyberSpace77",
      "Proposals are funding requests to the decentralized hive fund, DHF or DAO. Projects receive daily HBD payments while they maintain enough stakeholder votes."
    );
    if (!writeView(gen, proposalShell())) return;
    loadChain(gen);
    loadProposals(gen);
    loadVotes(gen);
    loadProposalVotes(gen);
  }

  // A finished proposal is funded at 99% of the ask. Paid is milli-HBD.
  function proposalPastLabel(row, now) {
    var pay = proposalPay(row, now, returnVotes());
    if (pay.paid == null || pay.total == null) return "Past";
    if (pay.paid <= 0n) return "Past · Not funded";
    if (pay.paid * 100n >= pay.total * 99n) return "Past · Funded";
    return "Past · Partially funded";
  }

  // The detail rank names whether an open proposal sits above proposal 0.
  // A tie is not approved. The return proposal itself keeps the phase word.
  function proposalPhaseLabel(row, now) {
    var phase = proposalPhase(row, now);
    if (phase === "past") return proposalPastLabel(row, now);
    if (phase !== "active" && phase !== "upcoming") return "";
    if (isReturnProposal(row)) return phase === "upcoming" ? "Upcoming" : "Active";
    var line = returnVotes();
    if (line == null) return phase === "upcoming" ? "Upcoming" : "Active";
    var above = bigIntOf(row.total_votes, 0n) > line;
    if (phase === "upcoming") return above ? "Upcoming · Approved" : "Upcoming · Not yet approved";
    return above ? "Active · Approved" : "Active · Not approved";
  }

  function proposalStandingNote(row) {
    if (!row) return "";
    if (isReturnProposal(row)) {
      return "Sets the funding line. A project is paid only while it has more votes than this proposal.";
    }
    if (proposalPhase(row, chainNow()) !== "active") return "";
    var line = returnVotes();
    if (line == null) return "";
    if (bigIntOf(row.total_votes, 0n) > line) return "Above the return proposal.";
    return "Below the return proposal.";
  }

  function proposalStatHtml(label, milli, estimated) {
    var text = milli == null ? "—" : formatHiveMilli(milli);
    var unit = text === "—" ? "" : '<span class="dao-stat-unit">hbd</span>';
    var note = estimated && text !== "—" ? '<span class="dao-stat-unit">estimated</span>' : "";
    return (
      '<div class="dao-stat"><span class="dao-stat-label">' +
      esc(label) +
      "</span><strong>" +
      esc(text) +
      "</strong>" +
      unit +
      note +
      "</div>"
    );
  }

  function proposalDetailShell(title, kicker, body) {
    return (
      '<section class="cs77-page dao-page dao-detail">' +
      navHtml("proposals") +
      '<h2 class="page-title">' +
      esc(title) +
      "</h2>" +
      '<p class="dao-kicker">' +
      esc(kicker) +
      "</p>" +
      body +
      "</section>"
    );
  }

  function paintProposalFigures() {
    var row = state.detailProposal;
    if (state.mode !== "proposal" || !row) return;
    var box = document.getElementById("proposalFigures");
    if (!box) return;
    var now = chainNow();
    var pay = proposalPay(row, now, returnVotes());
    box.innerHTML =
      proposalStatHtml("total asked", pay.total, false) +
      proposalStatHtml("total paid", pay.paid, pay.estimated) +
      proposalStatHtml("to pay", pay.toPay, false) +
      proposalStatHtml("daily", pay.daily, false);
    var phaseEl = document.getElementById("proposalPhase");
    if (phaseEl) phaseEl.textContent = proposalPhaseLabel(row, now);
    var standing = document.getElementById("proposalStanding");
    if (standing) {
      var note = proposalStandingNote(row);
      standing.textContent = note;
      standing.hidden = !note;
    }
    var facts = document.getElementById("proposalFacts");
    if (facts) {
      var hp = hpOf(row.total_votes);
      facts.innerHTML = [
        fact("Votes", '<span id="proposalStake">' + esc(hp.exact || "—") + "</span>"),
        fact("Dates", esc(dateRangeText(row) || "—")),
      ].join("");
    }
  }

  function supporterLoadingHtml() {
    return (
      '<div class="loading-row dao-supporter-loading" role="status" aria-label="Loading supporters">' +
      '<span class="btn-loader" aria-hidden="true"></span></div>'
    );
  }

  var proposalDetailPaint = 0;

  function paintProposalDetail(gen) {
    var row = state.detailProposal;
    if (!row || !alive(gen) || state.mode !== "proposal") return;
    var token = ++proposalDetailPaint;
    prepareNames([row.creator, row.receiver]).then(function () {
      if (token !== proposalDetailPaint || !alive(gen)) return;
      paintProposalDetailBody(gen);
    });
  }

  function paintProposalDetailBody(gen) {
    var row = state.detailProposal;
    var id = state.detailProposalId;
    if (!row || !alive(gen) || state.mode !== "proposal") return;
    var who = proposalAccountHtml(row, "medium");
    var subject = String(row.subject || "").trim() || "Proposal";
    var permlink = String(row.permlink || "");
    var postHref =
      who.creator && permlink ? state.host.appHref("/@" + who.creator + "/" + encodeURIComponent(permlink)) : "";
    var postBtn = postHref ? '<a class="btn-ghost" href="' + esc(postHref) + '">Proposal description</a>' : "";
    var by = who.creator || who.receiver;
    state.host.setPageMeta(
      subject + " — CyberSpace77",
      by ? "Proposal #" + id + " by @" + by + "." : "Proposal #" + id + " in the decentralized fund."
    );
    if (
      !writeView(
        gen,
        proposalDetailShell(
          subject,
          "Proposal #" + id,
          '<div class="proposal-who">' +
            who.avatar +
            '<span class="proposal-copy">' +
            who.user +
            who.to +
            "</span></div>" +
            '<p class="dao-note" id="daoVoteNote" hidden></p>' +
            '<div class="dao-actions">' +
            '<div class="proposal-action" data-proposal-action="' +
            esc(String(id)) +
            '">' +
            proposalActionHtml(row, chainNow(), returnVotes()) +
            "</div>" +
            postBtn +
            "</div>" +
            '<p class="dao-rank" id="proposalPhase"></p>' +
            '<p class="dao-note" id="proposalStanding" hidden></p>' +
            '<div class="dao-stats proposal-stats" id="proposalFigures"></div>' +
            '<dl class="dao-facts" id="proposalFacts"></dl>' +
            '<div class="proposal-rates" id="proposalRates" hidden></div>' +
            '<section class="dao-supporters">' +
            '<h3 class="dao-kicker">Supporters</h3>' +
            proposalSupporterCountHtml() +
            '<button type="button" class="btn-ghost" id="proposalSupporterLoad">Load supporters</button>' +
            '<p class="dao-note" id="proposalSupporterStatus" hidden></p>' +
            '<div id="proposalSupporterList"></div>' +
            '<button type="button" class="btn-ghost" id="proposalSupporterRetry" hidden>Try again</button>' +
            "</section>"
        )
      )
    ) {
      return;
    }
    paintProposalFigures();
    paintVoteNote();
    loadProposalHistory(gen, id, row);
  }

  // update_proposal can only lower daily_pay, and since HF25 it can only move
  // the end date earlier. remove_proposal drops the proposal. The row keeps
  // the latest rate and end, so the earlier values come from the creator's history.
  function dailyMilliOf(asset) {
    if (asset && typeof asset === "object") return paidMilli(asset.amount);
    return paidMilli(asset);
  }

  function proposalCreateOp(ops, id) {
    var fee = null;
    var i;
    for (i = 0; i < ops.length; i += 1) {
      var feeOp = ops[i] && ops[i].op;
      var feeValue = feeOp && feeOp.value;
      if (feeOp && feeOp.type === "proposal_fee_operation" && Number(feeValue && feeValue.proposal_id) === id) {
        fee = ops[i];
      }
    }
    if (!fee) return null;
    for (i = 0; i < ops.length; i += 1) {
      var createOp = ops[i] && ops[i].op;
      if (ops[i].trx_id === fee.trx_id && createOp && createOp.type === "create_proposal_operation") return ops[i];
    }
    return null;
  }

  function proposalRateSegments(ops, row) {
    var id = proposalId(row);
    var start = hiveTime(row.start_date);
    var end = hiveTime(row.end_date);
    if (id == null || !Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
    var created = proposalCreateOp(ops, id);
    if (!created) return [];
    var original = dailyMilliOf(created.op.value && created.op.value.daily_pay);
    if (original == null) return [];
    var cuts = [];
    var i;
    for (i = 0; i < ops.length; i += 1) {
      var item = ops[i];
      var op = item && item.op;
      var value = op && op.value;
      if (!op || op.type !== "update_proposal_operation" || Number(value && value.proposal_id) !== id) continue;
      var at = hiveTime(item.timestamp);
      var next = dailyMilliOf(value.daily_pay);
      if (!Number.isFinite(at) || next == null) continue;
      cuts.push({ at: at, rate: next });
    }
    cuts.sort(function (a, b) {
      return a.at < b.at ? -1 : a.at > b.at ? 1 : 0;
    });
    var rate = original;
    var steps = [{ rate: original }];
    for (i = 0; i < cuts.length; i += 1) {
      if (cuts[i].at >= end || cuts[i].rate >= rate) continue;
      steps.push(cuts[i]);
      rate = cuts[i].rate;
    }
    return steps.length > 1 ? steps : [];
  }

  function proposalRateHistoryHtml(steps) {
    var html = "<p>The daily rate was lowered.</p><ul>";
    var i;
    for (i = 0; i < steps.length; i += 1) {
      var when = i + 1 < steps.length ? shortDate(steps[i + 1].at) : shortDate(steps[i].at);
      var verb = i + 1 < steps.length ? "until " : "from ";
      html +=
        "<li>" +
        esc(groupedMilli(steps[i].rate)) +
        " hbd <span>" +
        esc(verb + when) +
        "</span></li>";
    }
    return html + "</ul>";
  }

  // Extension index 1 is update_proposal_end_date. Account history stores it
  // as {type, value}. A broadcast form is [1, {end_date}].
  function extensionEnd(value) {
    var list = value && value.extensions;
    if (!list || !list.length) return NaN;
    var i;
    for (i = 0; i < list.length; i += 1) {
      var item = list[i];
      if (!item) continue;
      if (item.type === "update_proposal_end_date") return hiveTime(item.value && item.value.end_date);
      if (item.length && item[1] && item[1].end_date) return hiveTime(item[1].end_date);
    }
    return NaN;
  }

  function proposalEndSegments(ops, row) {
    var id = proposalId(row);
    var start = hiveTime(row.start_date);
    if (id == null || !Number.isFinite(start)) return [];
    var created = proposalCreateOp(ops, id);
    if (!created) return [];
    var original = hiveTime(created.op.value && created.op.value.end_date);
    if (!Number.isFinite(original) || original <= start) return [];
    var moves = [];
    var i;
    for (i = 0; i < ops.length; i += 1) {
      var item = ops[i];
      var op = item && item.op;
      var value = op && op.value;
      if (!op || op.type !== "update_proposal_operation" || Number(value && value.proposal_id) !== id) continue;
      var at = hiveTime(item.timestamp);
      var next = extensionEnd(value);
      if (!Number.isFinite(at) || !Number.isFinite(next)) continue;
      moves.push({ at: at, end: next });
    }
    moves.sort(function (a, b) {
      return a.at < b.at ? -1 : a.at > b.at ? 1 : 0;
    });
    var end = original;
    var steps = [{ end: original }];
    for (i = 0; i < moves.length; i += 1) {
      if (moves[i].end >= end || moves[i].end <= start) continue;
      steps.push(moves[i]);
      end = moves[i].end;
    }
    return steps.length > 1 ? steps : [];
  }

  function proposalEndHistoryHtml(steps) {
    var rows = [];
    var i;
    for (i = 0; i < steps.length; i += 1) {
      var endText = shortDate(steps[i].end);
      var when = i + 1 < steps.length ? shortDate(steps[i + 1].at) : shortDate(steps[i].at);
      if (!endText || !when) return "";
      var verb = i + 1 < steps.length ? "until " : "from ";
      rows.push("<li>" + esc(endText) + " <span>" + esc(verb + when) + "</span></li>");
    }
    if (!rows.length) return "";
    return "<p>The end date was moved earlier.</p><ul>" + rows.join("") + "</ul>";
  }

  function proposalRemovedAt(ops, id) {
    var at = NaN;
    var i;
    for (i = 0; i < ops.length; i += 1) {
      var item = ops[i];
      var op = item && item.op;
      var value = op && op.value;
      if (!op || op.type !== "remove_proposal_operation") continue;
      var ids = value && value.proposal_ids;
      if (!ids || !ids.length) continue;
      var hit = false;
      var j;
      for (j = 0; j < ids.length; j += 1) {
        if (Number(ids[j]) === id) hit = true;
      }
      if (!hit) continue;
      var t = hiveTime(item.timestamp);
      if (!Number.isFinite(t)) continue;
      if (!Number.isFinite(at) || t < at) at = t;
    }
    return at;
  }

  // An end date at or before the update stops the proposal then, ahead of the
  // end it had. That is an early cancel even when remove_proposal was not used.
  function proposalEndedEarlyAt(steps) {
    if (!steps || steps.length < 2) return NaN;
    var prev = steps[0].end;
    var at = NaN;
    var i;
    for (i = 1; i < steps.length; i += 1) {
      var step = steps[i];
      if (step.end <= step.at && step.at < prev && (!Number.isFinite(at) || step.at < at)) at = step.at;
      prev = step.end;
    }
    return at;
  }

  function proposalCancelAt(ops, row, endSteps) {
    var removed = proposalRemovedAt(ops, proposalId(row));
    if (Number.isFinite(removed)) return removed;
    return proposalEndedEarlyAt(endSteps);
  }

  function proposalCancelHtml(at) {
    var when = shortDate(at);
    if (!when) return "";
    return "<p>The proposal was cancelled.</p><ul><li>" + esc(when) + "</li></ul>";
  }

  function proposalHistoryHtml(rates, ends, canceledAt) {
    var html = "";
    if (rates && rates.length) html += proposalRateHistoryHtml(rates);
    if (ends && ends.length) html += proposalEndHistoryHtml(ends);
    if (Number.isFinite(canceledAt)) html += proposalCancelHtml(canceledAt);
    return html;
  }

  async function fetchProposalHistoryOps(creator, current) {
    var nodes = voterNodes();
    var name = encodeURIComponent(creator);
    var i;
    for (i = 0; i < nodes.length; i += 1) {
      if (!current()) return null;
      try {
        var ops = [];
        var seen = {};
        var page;
        for (page = 1; page <= 10; page += 1) {
          if (!current()) return null;
          var res = await fetch(
            nodes[i] +
              "/hafah-api/accounts/" +
              name +
              "/operations?operation-types=44,46,47,87&page-size=100&page=" +
              page
          );
          if (!current()) return null;
          if (!res.ok) throw new Error("proposal history");
          var data = await res.json();
          var list = data && Array.isArray(data.operations_result) ? data.operations_result : null;
          if (!list) throw new Error("proposal history");
          var j;
          for (j = 0; j < list.length; j += 1) {
            var key = list[j] && list[j].operation_id;
            if (key && seen[key]) continue;
            if (key) seen[key] = true;
            ops.push(list[j]);
          }
          var total = Number(data.total_operations);
          if (!list.length || (Number.isFinite(total) && ops.length >= total)) return ops;
        }
        if (ops.length) return ops;
      } catch (err) {
        /* this node has no account history */
      }
    }
    return null;
  }

  async function loadProposalHistory(gen, id, row) {
    var creator = accountName(row && row.creator);
    if (!creator) return;
    function current() {
      return alive(gen) && state.mode === "proposal" && state.detailProposalId === id;
    }
    var ops = await fetchProposalHistoryOps(creator, current);
    if (!current() || !ops) return;
    var rates = isReturnProposal(row) ? [] : proposalRateSegments(ops, row);
    var ends = proposalEndSegments(ops, row);
    var canceledAt = proposalCancelAt(ops, row, ends);
    var html = proposalHistoryHtml(rates, ends, canceledAt);
    var box = document.getElementById("proposalRates");
    if (!box || !current() || !html) return;
    box.innerHTML = html;
    box.hidden = false;
  }

  function proposalSupporterCountHtml() {
    var count = state.proposalSupporterCount;
    if (count == null) return "";
    return '<p class="dao-note" id="proposalSupporterCount">' + esc(formatCount(count)) + "</p>";
  }

  function paintProposalMissing(gen, id) {
    state.detailProposal = null;
    state.host.setPageMeta("Proposal #" + id + " — CyberSpace77", "This proposal could not be found.");
    writeView(
      gen,
      proposalDetailShell(
        "Proposal #" + id,
        "Proposal",
        '<div class="dao-copy"><p>This proposal could not be found.</p></div>'
      )
    );
  }

  // HAF daily_pay is whole thousandths of HBD ("120000" is 120.000 HBD).
  // The rest of the page reads the "120.000 HBD" form through assetInt.
  function hafDailyPay(raw) {
    var s = String(raw == null ? "" : raw).trim();
    if (!s || s.indexOf(".") !== -1 || /[a-z]/i.test(s)) return s;
    var neg = s.charAt(0) === "-";
    var digits = neg ? s.slice(1) : s;
    if (!/^\d+$/.test(digits)) return s;
    while (digits.length < 4) digits = "0" + digits;
    var whole = digits.slice(0, -3).replace(/^0+(?=\d)/, "");
    return (neg ? "-" : "") + (whole || "0") + "." + digits.slice(-3) + " HBD";
  }

  // One HAF proposal record carries the row, paid_amount, and voters_num.
  // Asking for the id and 0 together also supplies the return proposal's
  // votes. page-size must cover both ids or the node returns only one.
  // Voter rows stay on /proposals/votes until the count is opened.
  function proposalVotersOf(row) {
    var n = Number(row && row.voters_num);
    return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
  }

  async function fetchProposalDetail(id, current) {
    var ids = id === 0 ? "0" : String(id) + ",0";
    var nodes = voterNodes();
    var i;
    for (i = 0; i < nodes.length; i += 1) {
      if (!current()) return null;
      try {
        var res = await fetch(
          nodes[i] +
            "/hafbe-api/proposals?proposal-ids=" +
            encodeURIComponent(ids) +
            "&page-size=" +
            (id === 0 ? "1" : "2")
        );
        if (!current()) return null;
        if (!res.ok) continue;
        var data = await res.json();
        var list = data && Array.isArray(data.proposals) ? data.proposals : null;
        if (!list) continue;
        var row = null;
        var line = null;
        var j;
        for (j = 0; j < list.length; j += 1) {
          var itemId = proposalId(list[j]);
          if (itemId === 0) line = bigIntOf(list[j].total_votes, 0n);
          if (itemId === id) row = list[j];
        }
        if (!row) continue;
        row.daily_pay = hafDailyPay(row.daily_pay);
        return {
          row: row,
          line: line,
          paid: id === 0 ? null : paidMilli(row.paid_amount),
          voters: proposalVotersOf(row),
        };
      } catch (err) {
        /* this node has no proposal index */
      }
    }
    return null;
  }

  function paintProposalSupporters() {
    if (state.mode !== "proposal" || !state.supporterReady) return;
    var status = document.getElementById("proposalSupporterStatus");
    var list = document.getElementById("proposalSupporterList");
    var retry = document.getElementById("proposalSupporterRetry");
    var load = document.getElementById("proposalSupporterLoad");
    if (!status || !list) return;
    if (retry) retry.hidden = !state.supporterError && !state.proposalSupportersPartial;
    if (load && (state.supporterError || state.supporterRows.length || state.proposalSupportersPartial)) {
      load.hidden = true;
    }
    if (state.supporterError) {
      status.hidden = false;
      status.textContent = state.supporterError;
      list.innerHTML = "";
      return;
    }
    var rows = state.supporterRows;
    if (state.proposalSupportersPartial) {
      status.hidden = false;
      status.textContent = "Some supporters did not load.";
    } else if (!rows.length) {
      status.hidden = false;
      status.textContent = "No supporters yet.";
    } else {
      status.hidden = true;
      status.textContent = "";
    }
    if (!rows.length) {
      list.innerHTML = "";
      return;
    }
    list.innerHTML = supporterTableHtml(rows);
  }

  function proposalSupporterStatus(gen, id, serial, text) {
    if (!alive(gen) || state.mode !== "proposal" || state.detailProposalId !== id || state.supporterSerial !== serial) {
      return;
    }
    var status = document.getElementById("proposalSupporterStatus");
    if (!status) return;
    status.hidden = false;
    status.textContent = text;
  }

  // Current approvals. voter_vests is the stake that counts. A set proxy is omitted.
  // The endpoint orders by name, so the page sorts by that stake after it loads.
  // A large proposal can hit the node's statement timeout, so a failed node is skipped
  // and the node that already answered is tried once more before the others.
  async function fetchProposalSupporterPage(id, page, node, current) {
    var passes = node ? [[node], voterNodes()] : [voterNodes()];
    var pass;
    for (pass = 0; pass < passes.length; pass += 1) {
      var nodes = passes[pass];
      var i;
      for (i = 0; i < nodes.length; i += 1) {
        if (!current()) return null;
        var origin = nodes[i];
        var url =
          origin +
          "/hafbe-api/proposals/votes?proposal-id=" +
          encodeURIComponent(String(id)) +
          "&page=" +
          page +
          "&page-size=" +
          SUPPORTER_PAGE +
          "&sort=by_proposal_voter&direction=asc";
        try {
          var res = await fetch(url);
          if (!current()) return null;
          if (res.status === 500 || res.status === 503) {
            res = await fetch(url);
            if (!current()) return null;
          }
          if (!res.ok) continue;
          var data = await res.json();
          if (!data || !Array.isArray(data.votes)) continue;
          return { data: data, node: origin };
        } catch (err) {
          /* try the next Hive node */
        }
      }
    }
    throw new Error("Could not load supporters.");
  }

  async function loadProposalSupporters(gen, id) {
    if (state.supporterLoading && state.detailProposalId === id) return;
    state.supporterLoading = true;
    state.supporterSerial += 1;
    var serial = state.supporterSerial;
    state.supporterRows = [];
    state.supporterReady = false;
    state.supporterError = "";
    state.proposalSupportersPartial = false;
    function current() {
      return alive(gen) && state.mode === "proposal" && state.detailProposalId === id && state.supporterSerial === serial;
    }
    var list = document.getElementById("proposalSupporterList");
    var retry = document.getElementById("proposalSupporterRetry");
    var load = document.getElementById("proposalSupporterLoad");
    if (list) list.innerHTML = supporterLoadingHtml();
    if (retry) retry.hidden = true;
    if (load) load.hidden = true;
    proposalSupporterStatus(gen, id, serial, "Loading supporters…");
    if (!current()) return;
    try {
      var rows = [];
      var seen = new Set();
      var node = "";
      var partial = false;
      var page;
      for (page = 1; page <= 20; page += 1) {
        var pack;
        try {
          pack = await fetchProposalSupporterPage(id, page, node, current);
        } catch (err) {
          if (!rows.length) throw err;
          partial = true;
          break;
        }
        if (!current() || !pack) return;
        node = pack.node;
        var data = pack.data;
        var votes = data && Array.isArray(data.votes) ? data.votes : [];
        var reported = state.proposalSupporterCount;
        var i;
        for (i = 0; i < votes.length; i += 1) {
          var account = accountName(votes[i] && votes[i].voter_name);
          if (!account || seen.has(account)) continue;
          // A governance proxy keeps the approval, but Hive does not count it.
          if (accountName(votes[i].proxy)) continue;
          seen.add(account);
          rows.push({
            name: account,
            raw: bigIntOf(votes[i].voter_vests, 0n),
            proxied: bigIntOf(votes[i].proxied_vests, 0n),
            proxy: "",
          });
        }
        if (rows.length) {
          proposalSupporterStatus(
            gen,
            id,
            serial,
            "Loading supporters… " +
              formatCount(rows.length) +
              (Number.isFinite(reported) && reported > rows.length ? " of " + formatCount(reported) : "")
          );
        }
        var pages = Number(data && data.total_pages);
        if (!votes.length || votes.length < SUPPORTER_PAGE || (Number.isFinite(pages) && page >= pages)) break;
      }
      if (!current()) return;
      rows.sort(function (a, b) {
        if (a.raw !== b.raw) return a.raw > b.raw ? -1 : 1;
        if (a.name < b.name) return -1;
        if (a.name > b.name) return 1;
        return 0;
      });
      state.supporterRows = rows;
      state.proposalSupportersPartial = partial;
      state.supporterReady = true;
      paintProposalSupporters();
    } catch (err) {
      if (!current()) return;
      state.supporterLoading = false;
      state.supporterSerial += 1;
      state.supporterRows = [];
      state.supporterError = "Could not load supporters.";
      state.supporterReady = true;
      paintProposalSupporters();
    } finally {
      if (state.supporterSerial === serial) state.supporterLoading = false;
    }
  }

  async function renderProposal(gen, id) {
    state.mode = "proposal";
    state.detailProposalId = id;
    state.detailProposal = null;
    state.detailReturnVotes = null;
    state.host.setPageMeta(
      "Proposal #" + id + " — CyberSpace77",
      "Proposal #" + id + " in the decentralized fund."
    );
    if (
      !writeView(
        gen,
        proposalDetailShell(
          "Proposal #" + id,
          "Proposal",
          '<div class="loading-row" role="status" aria-label="Loading proposal"><span class="btn-loader" aria-hidden="true"></span></div>'
        )
      )
    ) {
      return;
    }
    loadChain(gen);
    loadProposalVotes(gen);
    function current() {
      return alive(gen) && state.mode === "proposal" && state.detailProposalId === id;
    }
    try {
      var detail = await fetchProposalDetail(id, current);
      if (!current()) return;
      if (!detail || !detail.row) {
        paintProposalMissing(gen, id);
        return;
      }
      state.detailProposal = detail.row;
      if (detail.line != null) state.detailReturnVotes = detail.line;
      if (id === 0) state.detailReturnVotes = bigIntOf(detail.row.total_votes, 0n);
      if (detail.paid != null && id !== 0) {
        var paid = new Map();
        paid.set(id, detail.paid);
        state.proposals.paid = paid;
        state.proposals.paidReady = true;
      }
      state.proposalSupporterCount = detail.voters;
      paintProposalDetail(gen);
    } catch (err) {
      if (!current()) return;
      writeView(
        gen,
        proposalDetailShell(
          "Proposal #" + id,
          "Proposal",
          '<p class="tags-status is-error" id="daoStatus">' +
            esc((err && err.message) || "Could not load this proposal.") +
            "</p>"
        )
      );
    }
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
    if (
      !writeView(
        gen,
        detailShell(
          name,
          '<p class="dao-rank" id="witnessRank">Checking rank…</p>' +
            '<div class="dao-actions">' +
            witnessActionHtml(name) +
            '<a class="btn-ghost" href="' +
            esc(state.host.profileHref(name)) +
            '">Profile</a></div>' +
            '<p class="dao-note" id="daoVoteNote" hidden></p>' +
            '<p class="tags-status" id="daoStatus" hidden></p>' +
            (about ? '<p class="dao-about">' + esc(about) + "</p>" : "") +
            (disabled ? '<p class="dao-note dao-disabled">This witness is not signing blocks.</p>' : "") +
            '<dl class="dao-facts" id="witnessFacts"></dl>' +
            '<section class="dao-supporters">' +
            '<h3 class="dao-kicker">Supporters</h3>' +
            '<p class="dao-note" id="witnessSupporterStatus">Loading supporters…</p>' +
            '<div id="witnessSupporterList">' +
            supporterLoadingHtml() +
            "</div>" +
            '<button type="button" class="btn-ghost" id="witnessSupporterRetry" hidden>Try again</button>' +
            "</section>"
        )
      )
    ) {
      return;
    }
    paintDetailFacts();
    paintVoteNote();
    paintVoteButtons();
    loadSupporters(gen, name);
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

  function supporterHtml(row, rank) {
    var hp = hpOf(row.raw);
    var notes = [];
    if (row.proxied > 0n) {
      var proxiedHp = hpOf(row.proxied);
      if (proxiedHp.exact) notes.push("includes " + proxiedHp.exact + " from proxies");
    }
    if (row.proxy) notes.push("uses @" + row.proxy);
    var who =
      '<a href="' + esc(state.host.profileHref(row.name)) + '">@' + esc(row.name) + "</a>";
    if (notes.length) who += "<small>" + esc(notes.join(" · ")) + "</small>";
    return (
      "<tr>" +
      '<td class="dao-rank">' +
      rank +
      "</td>" +
      '<td class="dao-account"><span class="dao-rank-inline">' +
      rank +
      " · </span>" +
      who +
      "</td>" +
      "<td>" +
      esc(hp.exact || "—") +
      "</td></tr>"
    );
  }

  function supporterTableHtml(rows) {
    var html = [
      '<table class="dao-table"><thead><tr><th class="dao-rank">Rank</th><th class="dao-account"><span class="dao-account-label">Account</span><span class="dao-who-label">Rank · Account</span></th><th>Stake</th></tr></thead><tbody>',
    ];
    var i;
    for (i = 0; i < rows.length; i += 1) html.push(supporterHtml(rows[i], i + 1));
    html.push("</tbody></table>");
    return html.join("");
  }

  function paintSupporters() {
    if (!state.supporterReady) return;
    var status = document.getElementById("witnessSupporterStatus");
    var list = document.getElementById("witnessSupporterList");
    var retry = document.getElementById("witnessSupporterRetry");
    if (!status || !list) return;
    status.hidden = false;
    if (retry) retry.hidden = !state.supporterError;
    if (state.supporterError) {
      status.textContent = state.supporterError;
      list.innerHTML = "";
      return;
    }
    var rows = state.supporterRows;
    var count = rows.length;
    status.textContent = count
      ? formatCount(count) + (count === 1 ? " supporter." : " supporters.")
      : "No supporters yet.";
    if (!count) {
      list.innerHTML = "";
      return;
    }
    list.innerHTML = supporterTableHtml(rows);
  }

  function supporterStatus(gen, name, serial, text) {
    if (!alive(gen) || state.mode !== "witness" || state.detailName !== name || state.supporterSerial !== serial) {
      return;
    }
    var status = document.getElementById("witnessSupporterStatus");
    if (!status) return;
    status.hidden = false;
    status.textContent = text;
  }

  function hafOrigin(node) {
    try {
      var url = new URL(node);
      if (url.protocol !== "http:" && url.protocol !== "https:") return "";
      return url.protocol + "//" + url.host;
    } catch (err) {
      return "";
    }
  }

  function voterNodes() {
    var hive = api();
    var list = hive.getNodes ? hive.getNodes() : [hive.getActiveNode()];
    var out = [];
    var i;
    for (i = 0; i < list.length; i += 1) {
      var origin = hafOrigin(list[i]);
      if (origin && out.indexOf(origin) === -1) out.push(origin);
    }
    return out;
  }

  async function fetchVoterPage(name, page, node, current) {
    var nodes = node ? [node] : voterNodes();
    var i;
    for (i = 0; i < nodes.length; i += 1) {
      if (!current()) return null;
      try {
        var res = await fetch(
          nodes[i] +
            "/hafbe-api/witnesses/" +
            encodeURIComponent(name) +
            "/voters?page=" +
            page +
            "&page-size=" +
            SUPPORTER_PAGE +
            "&sort=vests&direction=desc"
        );
        if (!current()) return null;
        if (!res.ok) continue;
        var data = await res.json();
        if (!data || !Array.isArray(data.voters)) continue;
        return { data: data, node: nodes[i] };
      } catch (err) {
        /* try the next Hive node */
      }
    }
    throw new Error("Could not load supporters.");
  }

  async function loadSupporters(gen, name) {
    state.supporterSerial += 1;
    var serial = state.supporterSerial;
    state.supporterRows = [];
    state.supporterReady = false;
    state.supporterError = "";
    function current() {
      return alive(gen) && state.mode === "witness" && state.detailName === name && state.supporterSerial === serial;
    }
    var list = document.getElementById("witnessSupporterList");
    var retry = document.getElementById("witnessSupporterRetry");
    if (list) list.innerHTML = supporterLoadingHtml();
    if (retry) retry.hidden = true;
    supporterStatus(gen, name, serial, "Loading supporters…");
    if (!current()) return;
    try {
      var rows = [];
      var seen = new Set();
      var node = "";
      var page;
      for (page = 1; page <= 20; page += 1) {
        var pack = await fetchVoterPage(name, page, node, current);
        if (!current()) return;
        node = pack.node;
        var data = pack.data;
        var voters = data && Array.isArray(data.voters) ? data.voters : [];
        var total = Number(data && data.total_votes);
        var i;
        for (i = 0; i < voters.length; i += 1) {
          var account = accountName(voters[i] && voters[i].voter_name);
          if (!account || seen.has(account)) continue;
          seen.add(account);
          rows.push({
            name: account,
            raw: bigIntOf(voters[i].vests, 0n),
            proxied: bigIntOf(voters[i].proxied_vests, 0n),
          });
        }
        if (rows.length) {
          supporterStatus(
            gen,
            name,
            serial,
            "Loading supporters… " +
              formatCount(rows.length) +
              (Number.isFinite(total) && total > rows.length ? " of " + formatCount(total) : "")
          );
        }
        var pages = Number(data && data.total_pages);
        if (!voters.length || voters.length < SUPPORTER_PAGE || (Number.isFinite(pages) && page >= pages)) break;
      }
      if (!current()) return;
      state.supporterRows = rows;
      state.supporterReady = true;
      paintSupporters();
    } catch (err) {
      if (!current()) return;
      state.supporterSerial += 1;
      state.supporterRows = [];
      state.supporterError = "Could not load supporters.";
      state.supporterReady = true;
      paintSupporters();
    }
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
    var inSort = event.target.closest && event.target.closest(".proposal-sort");
    if (inSort) {
      event.preventDefault();
      closeProxyMenu();
      var sortItem = event.target.closest("[data-proposal-sort]");
      if (sortItem) applyProposalSort(sortItem.getAttribute("data-proposal-sort") || "");
      else toggleProposalSort();
      return;
    }
    closeProposalSort();
    var proxyMenuBtn = event.target.closest && event.target.closest(".dao-more-btn");
    if (proxyMenuBtn) {
      event.preventDefault();
      toggleProxyMenu(proxyMenuBtn);
      return;
    }
    var proxyAction = event.target.closest && event.target.closest("[data-proxy-action]");
    if (proxyAction) {
      event.preventDefault();
      closeProxyMenu();
      if (state.votes.proxy) removeProxy();
      else openProxyDialog();
      return;
    }
    var createProposal = event.target.closest && event.target.closest("#proposalCreate");
    if (createProposal) {
      event.preventDefault();
      openCreateProposal();
      return;
    }
    var editProposal = event.target.closest && event.target.closest("[data-proposal-edit]");
    if (editProposal) {
      event.preventDefault();
      closeProxyMenu();
      openEditProposal(editProposal.getAttribute("data-proposal-edit") || "");
      return;
    }
    var cancelProposal = event.target.closest && event.target.closest("[data-proposal-cancel]");
    if (cancelProposal) {
      event.preventDefault();
      closeProxyMenu();
      openProposalCancel(cancelProposal.getAttribute("data-proposal-cancel") || "");
      return;
    }
    var proposalBtn = event.target.closest && event.target.closest("[data-proposal-filter]");
    if (proposalBtn && proposalBtn.closest(".dao-filter")) {
      event.preventDefault();
      setProposalFilter(proposalBtn.getAttribute("data-proposal-filter") || "");
      return;
    }
    var proposalRetry = event.target.closest && event.target.closest("#proposalRetry");
    if (proposalRetry) {
      event.preventDefault();
      if (state.mode === "proposals") loadProposals(state.gen);
      return;
    }
    var proposalSupporterLoad = event.target.closest && event.target.closest("#proposalSupporterLoad");
    if (proposalSupporterLoad) {
      event.preventDefault();
      if (state.mode === "proposal" && state.detailProposalId != null) {
        loadProposalSupporters(state.gen, state.detailProposalId);
      }
      return;
    }
    var proposalSupporterRetry = event.target.closest && event.target.closest("#proposalSupporterRetry");
    if (proposalSupporterRetry) {
      event.preventDefault();
      if (state.mode === "proposal" && state.detailProposalId != null) {
        loadProposalSupporters(state.gen, state.detailProposalId);
      }
      return;
    }
    var proposalVote = event.target.closest && event.target.closest(".proposal-vote[data-proposal-vote]");
    if (proposalVote) {
      event.preventDefault();
      castProposalVote(proposalVote.getAttribute("data-proposal-vote") || "");
      return;
    }
    var filterBtn = event.target.closest && event.target.closest("[data-witness-filter]");
    if (filterBtn && filterBtn.closest(".dao-filter")) {
      event.preventDefault();
      setWitnessFilter(filterBtn.getAttribute("data-witness-filter") || "");
      return;
    }
    var retry = event.target.closest && event.target.closest("#witnessRetry");
    if (retry) {
      event.preventDefault();
      retryList();
      return;
    }
    var supporterRetry = event.target.closest && event.target.closest("#witnessSupporterRetry");
    if (supporterRetry) {
      event.preventDefault();
      if (state.mode === "witness" && state.detailName) loadSupporters(state.gen, state.detailName);
      return;
    }
    var vote = event.target.closest && event.target.closest(".witness-vote[data-vote]");
    if (!vote) return;
    event.preventDefault();
    castVote(vote.getAttribute("data-vote") || "");
  }

  function onSubmit(event) {
    var proposalForm = event.target && event.target.closest && event.target.closest("#proposalSearchForm");
    if (proposalForm) {
      event.preventDefault();
      if (state.proposalSearchTimer) {
        clearTimeout(state.proposalSearchTimer);
        state.proposalSearchTimer = 0;
      }
      var proposalInput = document.getElementById("proposalSearch");
      if (proposalInput) applyProposalQuery(proposalInput.value);
      return;
    }
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
    if (!event.target) return;
    if (event.target.id === "proposalExcludeStabilizer") {
      state.proposalExcludeStabilizer = Boolean(event.target.checked);
      if (state.mode === "proposals") paintProposalList();
      return;
    }
    if (event.target.id === "proposalSearch") {
      if (state.composing || event.isComposing) return;
      scheduleProposalSearch();
      return;
    }
    if (event.target.id !== "witnessSearch") return;
    if (state.composing || event.isComposing) return;
    scheduleSearch();
  }

  function onComposeStart(event) {
    var id = event.target && event.target.id;
    if (id === "witnessSearch" || id === "proposalSearch") state.composing = true;
  }

  function onComposeEnd(event) {
    if (!event.target) return;
    if (event.target.id === "proposalSearch") {
      state.composing = false;
      scheduleProposalSearch();
      return;
    }
    if (event.target.id !== "witnessSearch") return;
    state.composing = false;
    scheduleSearch();
  }

  function onScroll() {
    if (!document.getElementById("witnessList") || state.mode !== "witnesses") return;
    maybeMore();
  }

  var bound = false;
  function bind() {
    if (!bound) {
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
      document.addEventListener("click", function (event) {
        var el = event.target;
        if (el && el.closest && el.closest(".proposal-sort")) return;
        closeProposalSort();
        if (el && el.closest && el.closest(".dao-more")) return;
        closeProxyMenu();
      });
    }
    bindProposalDialog();
    bindProposalCancel();
    bindProxyDialog();
  }

  async function render(ctx) {
    begin(ctx);
    bind();
    var gen = state.gen;
    var route = (ctx && ctx.route) || {};
    if (route.name === "dao") {
      renderWitnesses(gen);
      return;
    }
    if (route.name === "proposals") {
      renderProposals(gen);
      return;
    }
    if (route.name === "proposal") {
      await renderProposal(gen, Number(route.id));
      return;
    }
    if (route.name === "witness") {
      await renderWitness(gen, route.author || "");
      return;
    }
    renderWitnesses(gen);
  }

  global.DaoPage = {
    render: render,
    closeCreateProposal: closeCreateProposal,
    closeProposalCancel: closeProposalCancel,
    closeProxy: closeProxyDialog,
    closeProxyMenu: closeProxyMenu,
    proxyMenuOpen: proxyMenuOpen,
  };
})(window);
