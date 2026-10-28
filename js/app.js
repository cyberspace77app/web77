/**
 * CyberSpace77 — main javascript for router, feed, post, comments, and page processing.
 */

// filter low rep, honor mutes, api mod flags, cs77 blacklist
let CS77_ENABLE_CONTENT_MODERATION = true;
let CS77_FILTER_LOW_REP = 20;
(function () {
  "use strict";

  const APP_ID = "cyberspace77.com";
  const APP_VERSION = "0.18";
  const FEED_TARGET = 20;
  const MAX_PAGES_PER_LOAD = 12;
  // Load the next page once the third-from-last card is this close to the
  // viewport, so the request finishes before the reader reaches the end.
  const FEED_INFINITE_LEAD = 3;
  const FEED_INFINITE_MARGIN = 720;
  // One page of a profile follow list. 48 fills 16 rows of the 3-column grid.
  const FOLLOW_PAGE = 48;
  // Hivemind list_subscribers accepts at most 100 names.
  const COMMUNITY_SUBSCRIBER_PAGE = 100;
  const SESSION_KEY = "cs77_user";
  const KEYCHAIN_USER_KEY = "cs77_keychain_user";
  const KEYCHAIN_PERSIST_KEY = "cs77_keychain_persist";
  const FEED_VIEW_KEY = "cs77_feed_view";
  const FEED_SORTS = ["feed", "latest", "trending"];
  const VOTE_WEIGHT_KEYS = {
    post: "cs77_vote_weight_post",
    comment: "cs77_vote_weight_comment",
  };
  const DEFAULT_VOTE_WEIGHT_KEYS = {
    post: "cs77_default_vote_weight_post",
    comment: "cs77_default_vote_weight_comment",
  };
  const DOWNVOTE_WEIGHT_KEYS = {
    post: "cs77_downvote_weight_post",
    comment: "cs77_downvote_weight_comment",
  };
  const VOTERS_PAGE = 40;
  const VOTERS_SCROLL_PX = 72;
  const IMAGE_HOST = "https://images.hive.blog";
  const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
  const MAX_TAGS = 10;
  const PUBLISH_DESC_MAX = 160;
  // comment_operation allows at most HIVE_COMMENT_TITLE_LIMIT - 1 bytes.
  const HIVE_COMMENT_TITLE_LIMIT = 256;
  const PUBLISH_TITLE_MAX = HIVE_COMMENT_TITLE_LIMIT - 1;
  const PUBLISH_TITLE_RING_AT = 128;
  const MAX_BENEFICIARIES = 8;
  const FAVORITE_TAGS_KEY = "cs77_favorite_tags";
  const MAX_FAVORITE_TAGS = 40;
  const FAVORITE_USERS_KEY = "cs77_favorite_users";
  const MAX_FAVORITE_USERS = 40;
  const FAVORITE_COMMUNITIES_KEY = "cs77_favorite_communities";
  const WELCOME_SEEN_KEY = "cs77_welcome_seen";
  const PROFILE_IMAGE_KEY = "cs77_profile_image";
  const PROFILE_FIELDS = ["name", "about", "location", "website", "profile_image", "cover_image"];
  const SETTINGS_METADATA_MAX = 16384;
  const AVATAR_DEFAULT_LARGE = "/assets/satoshi.png";
  const AVATAR_DEFAULT_SMALL = "/assets/satoshi-small.png";
  const MAX_FAVORITE_COMMUNITIES = 40;
  const COMMUNITY_BROWSE_LIMIT = 100;
  const COMMUNITY_BROWSE_SCROLL_PX = 280;
  const TRENDING_TAGS_MS = 5 * 60 * 1000;
  const PUBLISH_DRAFT_KEY = "cs77_publish_draft";
  const PUBLISH_DRAFT_SAVE_MS = 2000;
  // One unfinished comment or reply per account. A newer box replaces it.
  const COMMENT_DRAFT_KEY = "cs77_comment_draft";
  const COMMENT_DRAFT_SAVE_MS = 1000;
  const COMMENT_DRAFT_INTERVAL_MS = 2000;
  const LOGO_FAVORITES_SHOW = 10;
  const SUGGESTED_TAGS_SHOW = 24;
  const PINNED_SUGGESTED_TAGS = ["bitcoin", "crypto"];
  const NOTIF_LIMIT = 100;
  const NOTIF_SCROLL_PX = 72;
  const NOTIF_POLL_MS = 60000;
  const ACCOUNT_STATE_FRESH_MS = 60000;
  const BLOCK_EXPLORER = "https://hivescan.info/";

  const $ = (sel) => document.querySelector(sel);
  const view = $("#view");
  const errorBanner = $("#errorBanner");
  const errorText = $("#errorText");
  const sessionSlot = $("#sessionSlot");
  const overlay = $("#loginOverlay");
  const queueSlot = $("#queueSlot");

  const localVotes = new Map();
  const votesCache = new Map();
  const localReblogs = new Map();
  const reblogsCache = new Map();
  const payoutByKey = new Map();
  const contentByKey = new Map();
  let pendingCommentsScroll = false;
  let pendingPublish = false;
  let publishDest = { type: "blog", name: "", title: "My cyberspace" };
  // Warning under Publish in when this account cannot post in the subspace.
  // Publish still sends. Hivemind mutes that post in the subspace.
  let publishDestNote = "";
  let publishAccessSeq = 0;
  // Load of the selected subspace account's required beneficiary.
  let publishBeneficiarySeq = 0;
  // Account last applied for the selected subspace. Choosing another subspace
  // or My cyberspace removes that one row. Other beneficiary rows stay.
  // Kept after the author removes the row, so reopening the draft does not
  // put it back. Choosing that subspace again loads it once more.
  let publishCommunityBeneficiary = null;
  // Silent council comment check. The note warns when a comment would be muted.
  // Comment and Reply still send.
  let commentAccessSeq = 0;
  let commentAccessWait = null;
  let commentAccessCommunity = "";
  let commentAccessUser = "";
  let commentAccessMessage = "";
  let commentAccessSettled = false;
  // Set by the subspace ··· menu. Applied once the publish dialog opens.
  let publishDestRequest = null;
  // Community chosen from that menu, kept in Publish in even when unsubscribed.
  let publishPinnedCommunity = null;
  let publishTags = [];
  let publishSubs = [];
  let publishSubsUser = "";
  let lastNonPublishPath = "/";
  let publishNavPushed = false;
  let settingsProfileDraft = null;
  let settingsProfileBaseline = null;
  let settingsBusy = false;
  let communityEditDraft = null;
  let communityEditBaseline = null;
  let communityEditSettings = null;
  let communityEditOwner = null;
  let communityEditTags = [];
  let communityEditBusy = false;
  let ownerSignSession = null;
  let ownerSignBusy = false;
  // Decrypted transfer memos for this tab. The key is the # ciphertext.
  const walletMemoPlain = new Map();
  let walletMemoBusy = false;
  let communityMemberContext = null;
  let communityRoleBusy = false;
  let communityRoleSession = null;
  let communityTitleSession = null;
  let communityRoleToken = 0;
  let settingsNodeToken = 0;
  let settingsKeysToken = 0;
  let settingsNodeBusy = false;
  let currentViewKey = "";
  const searchPages = {
    users: { query: "", looked: false, loading: false, loadingMore: false, error: "", results: [], done: false, cursor: "" },
    spaces: { query: "", looked: false, loading: false, loadingMore: false, error: "", results: [], done: false, cursor: "" },
    subspaces: { query: "", looked: false, loading: false, loadingMore: false, error: "", results: [], done: false, cursor: "" },
  };
  const SEARCH_USER_LIMIT = 100;
  const SEARCH_TAG_LIMIT = 100;
  const SEARCH_COMMUNITY_LIMIT = 100;
  let searchGen = 0;
  let searchBox = "";
  let trendingTagNamesCache = null;
  let trendingTagNamesAt = 0;
  // History entry id for the feed currently mounted in #view. A profile opened
  // from that feed parks the list under this id and Back mounts it again.
  let liveFeedNav = 0;
  let historyNavSeq = 0;
  const feedParks = new Map();
  const FEED_PARK_MAX = 8;
  // Steps from the current history entry back to the feed parked under a profile.
  let profileReturnNav = 0;
  let profileReturnSteps = 0;
  let profileReturnOpen = false;
  let parkedForProfile = false;
  // Post entries pushed over the live feed. A profile opened from one of them
  // counts those entries so the logo lands on the feed.
  let feedStackDepth = 0;
  let routeFromPop = false;
  let routePushed = false;
  let initialPageLoad = true;
  // Set for a click on the profile nav. route() clears it. Those switches
  // keep the scroll position; session and logo links still go to the top.
  let profileNavSwitch = false;
  // Set for a click on the subspace nav. route() clears it. Those switches
  // keep the header and the scroll position.
  let communityNavSwitch = false;
  // Session-menu Comments / Replies / Wallet. Mobile hides the profile banner
  // and scrolls to the top. Desktop scrolls to .profile-nav only when that
  // nav is already painted and not fully in the viewport.
  let accountMenuSubNav = false;
  // Session-menu Profile shows the banner again. Profile-nav tabs keep it hidden.
  let accountMenuProfile = false;
  let welcomeHold = false;
  let currentPost = null;
  let metaDefaults = null;
  const postLayer = {
    open: false,
    author: "",
    permlink: "",
    gen: 0,
    scrollY: 0,
    heldScroll: false,
    hadWelcome: false,
  };
  const postSnaps = new Map();
  const cardContentStamps = new Map();
  const originalPostCache = new Map();
  const revealedMuted = new Set();
  const POST_SNAP_MAX = 6;
  const communityState = {
    name: "",
    info: null,
    subscribed: false,
    pending: false,
  };
  const communityDirState = {
    gen: 0,
    subs: [],
    subsError: "",
    searchQuery: "",
    search: [],
    searchError: "",
    searchLooked: false,
    searchLoading: false,
    browse: [],
    browseLast: "",
    browseDone: false,
    browseLoading: false,
    browseError: "",
  };
  const subspaceCreateDraft = {
    title: "",
    about: "",
    typeId: 1,
    digits: "",
    password: "",
    created: "",
  };
  let subspaceCreateBusy = false;
  let subspaceNameCheck = 0;
  const profileState = {
    author: "",
    page: "posts",
    profile: null,
    followed: false,
    muted: false,
    pending: false,
    mutePending: false,
    claimPending: false,
    wallet: null,
    walletTx: null,
  };
  const peopleList = {
    gen: 0,
    open: false,
    kind: "",
    id: "",
    query: "",
    prefixChecked: false,
    names: [],
    seen: new Set(),
    cursor: "",
    done: true,
    loading: false,
    holdAuto: false,
    error: "",
  };
  let peopleSearchTimer = 0;
  let peopleChainGen = 0;
  // The open panel is its own history entry so the browser back button closes it.
  let peopleHistoryOn = false;
  let peopleHistoryPop = false;
  let pendingPeopleNav = null;
  const walletOpState = {
    kind: "",
    max: 0,
    symbol: "hive",
    pending: false,
  };
  const delegationView = {
    loadGen: 0,
    account: "",
    open: false,
    loading: false,
    loaded: false,
    hasError: false,
    outgoingHp: null,
    incomingHp: null,
    outgoingRc: null,
    incomingRc: null,
    hpTruncated: false,
    rcTruncated: false,
    errors: {},
    rcAccount: null,
    receivedRc: null,
  };
  let delegationLoadPromise = null;
  const delegateState = {
    mode: "",
    asset: "hp",
    pending: false,
    target: "",
    amount: "",
  };
  let publishEdit = null;
  let publishStash = null;
  let publishDraftTimer = 0;
  let publishDraftSaveSoon = 0;
  let commentDraftTimer = 0;
  let commentDraftInterval = 0;
  let commentDraftGen = 0;
  let commentDraftComposer = null;
  let commentDraftURL = "";
  let notifGen = 0;
  let notifTimer = 0;
  const notifState = {
    user: "",
    unread: 0,
    lastread: "",
    items: [],
    error: "",
    loaded: false,
    markedAt: 0,
    cursor: "",
    done: false,
    loadingMore: false,
    seen: new Set(),
  };

  // One list backs every post stream. kind says which stream it is:
  // following (accounts you follow), ranked (latest / trending / hot),
  // tag (those sorts for one tag), profile (posts / comments / replies),
  // community (latest / trending / hot inside one community).
  // tag is only a ranked tag. scope is the profile account or community name.
  const feedState = {
    kind: "ranked",
    sort: "latest",
    tag: "",
    scope: "",
    items: [],
    seen: new Set(),
    cursor: null,
    loading: false,
    done: false,
    // A failed page leaves the Load more button. Auto-scroll stays quiet until
    // that button is used, so a dead request is not repeated on every scroll.
    holdAuto: false,
    gen: 0,
  };
  let feedFillBusy = false;
  let feedFillToken = 0;
  let feedInfiniteQueued = false;

  // Post cards whose excerpt was opened inline. Cleared when the feed changes.
  // Profile comments and replies stay on the long preview and are not tracked.
  const expandedCardExcerpts = new Set();

  function observer() {
    return sessionStorage.getItem(SESSION_KEY) || "";
  }

  function normalizeLoginUser(name) {
    return String(name || "")
      .trim()
      .replace(/^@/, "")
      .toLowerCase();
  }

  function validLoginUser(name) {
    return /^[a-z0-9.\-]{3,16}$/.test(name);
  }

  function readKeychainUser() {
    try {
      const name = normalizeLoginUser(localStorage.getItem(KEYCHAIN_USER_KEY));
      return validLoginUser(name) ? name : "";
    } catch {
      return "";
    }
  }

  function keychainPersistStarted() {
    try {
      return localStorage.getItem(KEYCHAIN_PERSIST_KEY) === "1";
    } catch {
      return false;
    }
  }

  function writeKeychainUser(username) {
    try {
      localStorage.setItem(KEYCHAIN_USER_KEY, username);
      localStorage.setItem(KEYCHAIN_PERSIST_KEY, "1");
    } catch {
      /* ignore quota / private mode */
    }
  }

  function clearKeychainUser() {
    try {
      localStorage.removeItem(KEYCHAIN_USER_KEY);
    } catch {
      /* ignore */
    }
  }

  function restoreRememberedSession() {
    const postingUser = (window.HiveAuth && HiveAuth.user()) || "";
    let sessionUser = normalizeLoginUser(sessionStorage.getItem(SESSION_KEY));
    if (!validLoginUser(sessionUser)) sessionUser = "";
    if (!sessionUser) {
      const user = postingUser || readKeychainUser();
      if (user) sessionStorage.setItem(SESSION_KEY, user);
      return;
    }
    // Remember a Keychain username already held by this tab. The marker survives logout,
    // so a stale tab cannot write that username back.
    if (!postingUser && !keychainPersistStarted()) writeKeychainUser(sessionUser);
  }

  function hasSigner(username) {
    const user = username || observer();
    if (window.HiveAuth && HiveAuth.hasKey(user)) return true;
    return Boolean(window.hive_keychain);
  }

  function signerNeededMessage() {
    return "Connect with Hive Keychain or a posting key to continue.";
  }

  function signingLabel(kind) {
    return kind === "image"
      ? "Signing image…"
      : "Publishing……";
  }

  function isOwnAuthor(author) {
    const user = observer();
    return Boolean(user && author && user === String(author).toLowerCase());
  }
  
  let mousePointerSeen = false;
  
  function hoverFine() {
    return mousePointerSeen;
  }

  function syncHasMouseClass() {
    document.documentElement.classList.toggle("has-mouse", hoverFine());
  }
  
  window.addEventListener(
  "pointermove",
  (e) => {
    if (e.pointerType !== "mouse") return;
    if (mousePointerSeen) return;
    mousePointerSeen = true;
    syncHasMouseClass();
  },
  { once: true }
  );

  function nodeMenuLabel(url) {
    try {
      const parsed = new URL(url);
      const path = parsed.pathname.replace(/\/+$/, "");
      return parsed.host + (path && path !== "/" ? path : "");
    } catch {
      return url;
    }
  }

  function setNodeLabel() {
    const active = HiveApi.getActiveNode();
    const label = nodeMenuLabel(active);
    document.querySelectorAll(".status-pill").forEach((el) => {
      el.title = active;
    });
    document.querySelectorAll(".status-pill .node-label").forEach((el) => {
      el.textContent = label;
    });
    document.querySelectorAll(".node-option").forEach((el) => {
      if (el.classList.contains("node-option-custom")) return;
      const selected = el.getAttribute("data-node") === active;
      el.classList.toggle("is-active", selected);
      el.setAttribute("aria-selected", selected ? "true" : "false");
    });
  }

  function closeNodeMenus() {
    document.querySelectorAll(".node-menu.is-open").forEach((menu) => {
      menu.classList.remove("is-open");
      const trigger = menu.querySelector(".status-pill");
      if (trigger) trigger.setAttribute("aria-expanded", "false");
    });
  }

  function paintNodeMenus() {
    const nodes = HiveApi.getKnownNodes ? HiveApi.getKnownNodes() : [];
    const active = HiveApi.getActiveNode();
    const options = nodes
      .map((url) => {
        const selected = url === active;
        const host = HiveMd.escapeHtml(nodeMenuLabel(url));
        const href = HiveMd.escapeHtml(url);
        return (
          `<button type="button" class="node-option${selected ? " is-active" : ""}" role="option" aria-selected="${selected ? "true" : "false"}" data-node="${href}" title="${href}">` +
          host +
          `</button>`
        );
      })
      .join("");
    const custom =
      `<button type="button" class="node-option node-option-custom" aria-haspopup="dialog">custom…</button>`;
    document.querySelectorAll(".node-dropdown-panel").forEach((panel) => {
      panel.innerHTML = options + custom;
    });
  }

  let nodeTestToken = 0;

  function nodeOverlayOpen() {
    const el = $("#nodeOverlay");
    return Boolean(el && !el.hidden);
  }

  function setNodeStatus(msg, isError) {
    const el = $("#nodeStatus");
    if (!el) return;
    el.textContent = msg || "";
    el.classList.toggle("is-error", Boolean(isError && msg));
  }

  function resetNodeForm() {
    const button = $("#nodeTest");
    const input = $("#nodeServer");
    if (button) button.disabled = false;
    if (input) input.disabled = false;
  }

  function hideNodeOverlay() {
    const el = $("#nodeOverlay");
    if (el) el.hidden = true;
    resetNodeForm();
  }

  function closeNodeOverlay() {
    nodeTestToken += 1;
    hideNodeOverlay();
    setNodeStatus("");
  }

  function openNodeOverlay() {
    const el = $("#nodeOverlay");
    if (!el) return;
    closeLogoMenu();
    el.hidden = false;
    setNodeStatus("");
    resetNodeForm();
    const input = $("#nodeServer");
    if (input) {
      input.focus();
      input.select();
    }
  }

  async function submitCustomNode() {
    if (!nodeOverlayOpen()) return;
    const button = $("#nodeTest");
    const input = $("#nodeServer");
    if (!input || (button && button.disabled)) return;
    const raw = input.value;
    const token = nodeTestToken;
    if (button) button.disabled = true;
    input.disabled = true;
    setNodeStatus("Testing…");
    try {
      const node = await HiveApi.testNode(raw);
      if (token !== nodeTestToken) return;
      if (!HiveApi.saveCustomNode(node)) {
        throw new Error("Could not save that server.");
      }
      paintNodeMenus();
      setNodeLabel();
      paintSettingsNodeRows();
      input.value = "";
      hideNodeOverlay();
      setNodeStatus("");
    } catch (err) {
      if (token !== nodeTestToken) return;
      setNodeStatus((err && err.message) || "Could not use that server.", true);
      resetNodeForm();
      input.focus();
    }
  }

  function bindNodeMenus() {
    paintNodeMenus();
    setNodeLabel();

    document.querySelectorAll(".node-menu").forEach((menu) => {
      const trigger = menu.querySelector(".status-pill");
      if (!trigger) return;
      trigger.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const open = !menu.classList.contains("is-open");
        closeNodeMenus();
        menu.classList.toggle("is-open", open);
        trigger.setAttribute("aria-expanded", open ? "true" : "false");
      });
    });

    document.addEventListener("click", (e) => {
      const custom = e.target.closest(".node-option-custom");
      if (custom) {
        e.preventDefault();
        e.stopPropagation();
        openNodeOverlay();
        return;
      }
      const option = e.target.closest(".node-option");
      if (option) {
        e.preventDefault();
        e.stopPropagation();
        const url = option.getAttribute("data-node");
        if (url && HiveApi.setActiveNode(url)) {
          setNodeLabel();
        }
        closeNodeMenus();
        return;
      }
      if (!e.target.closest(".node-menu")) closeNodeMenus();
    });

    const nodeOverlay = $("#nodeOverlay");
    const nodeServer = $("#nodeServer");
    const nodeTest = $("#nodeTest");
    const nodeCancel = $("#nodeCancel");
    if (nodeTest) nodeTest.addEventListener("click", submitCustomNode);
    if (nodeCancel) nodeCancel.addEventListener("click", closeNodeOverlay);
    if (nodeServer) {
      nodeServer.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          submitCustomNode();
        }
      });
    }
    if (nodeOverlay) {
      nodeOverlay.addEventListener("click", (e) => {
        if (e.target === nodeOverlay) {
          const active = document.activeElement;
          if (!active || !nodeOverlay.contains(active)) {
            closeNodeOverlay();
          }
        }
      });
    }
  }

  let errorHideTimer = 0;

  function showError(msg) {
    errorText.textContent = msg;
    errorBanner.hidden = false;
    window.clearTimeout(errorHideTimer);
    errorHideTimer = window.setTimeout(clearError, 3000);
  }

  function clearError() {
    window.clearTimeout(errorHideTimer);
    errorHideTimer = 0;
    errorBanner.hidden = true;
    errorText.textContent = "";
  }

  errorBanner.addEventListener("click", clearError);

  function parseCreatedTs(created) {
    if (!created) return NaN;
    const s = String(created);
    if (/Z$/i.test(s) || /[+-]\d{2}:\d{2}$/.test(s)) return Date.parse(s);
    return Date.parse(s + "Z");
  }

  function timeAgo(created) {
    const ts = parseCreatedTs(created);
    if (!Number.isFinite(ts)) return "";
    const sec = Math.round((Date.now() - ts) / 1000);
    const abs = Math.abs(sec);
    const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
    const steps = [
      [60, "second"],
      [60, "minute"],
      [24, "hour"],
      [7, "day"],
      [4.345, "week"],
      [12, "month"],
      [Infinity, "year"],
    ];
    let value = abs;
    let unit = "second";
    let cursor = sec < 0 ? -1 : 1;
    for (const [div, name] of steps) {
      if (value < div) {
        unit = name;
        break;
      }
      value = value / div;
    }
    return rtf.format(-cursor * Math.round(value), unit);
  }

  function formatCreated(created) {
    const ts = parseCreatedTs(created);
    if (!Number.isFinite(ts)) return "";
    try {
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(ts));
    } catch {
      return new Date(ts).toLocaleString();
    }
  }

  function formatCreatedUtc(created) {
    const ts = parseCreatedTs(created);
    if (!Number.isFinite(ts)) return "";
    const iso = new Date(ts).toISOString();
    return iso.slice(0, 10) + " " + iso.slice(11, 19) + " UTC";
  }

  function metaTimeHtml(created, href) {
    const rel = timeAgo(created);
    if (!rel) return "";
    const abs = formatCreated(created);
    const pop = abs
      ? `<span class="meta-time-pop" role="tooltip">${HiveMd.escapeHtml(abs)}</span>`
      : "";
    const text = HiveMd.escapeHtml(rel) + pop;
    if (!href) return `<span class="meta-time">${text}</span>`;
    return `<a class="meta-time" href="${HiveMd.escapeHtml(href)}">${text}</a>`;
  }

  function profileJoinedHtml(created) {
    const ts = parseCreatedTs(created);
    if (!Number.isFinite(ts)) return "";
    let month = "";
    try {
      month = new Intl.DateTimeFormat("en", {
        month: "long",
        year: "numeric",
      }).format(new Date(ts));
    } catch {
      month = "";
    }
    if (!month) return "";
    const abs = formatCreated(created);
    const pop = abs
      ? `<span class="meta-time-pop" role="tooltip">${HiveMd.escapeHtml(abs)}</span>`
      : "";
    return `<span class="meta-time profile-joined">joined ${HiveMd.escapeHtml(month)}${pop}</span>`;
  }

  function commentAnchorId(author, permlink) {
    return "@" + String(author || "") + "/" + String(permlink || "");
  }

  function decodeHashFragment(hash) {
    let raw = String(hash == null ? "" : hash);
    if (!raw) return "";
    if (raw.charAt(0) === "#") raw = raw.slice(1);
    if (!raw || raw.charAt(0) === "/") return "";
    try {
      raw = decodeURIComponent(raw);
    } catch {
      /* keep raw */
    }
    return raw;
  }

  function parseCommentFragment(hash) {
    const raw = decodeHashFragment(hash);
    if (!raw) return null;
    const m = raw.match(/^@([a-z0-9.\-]{3,16})\/([^#?\s]+)/i);
    if (!m) return null;
    const author = m[1].toLowerCase();
    const permlink = m[2];
    return { author, permlink, id: commentAnchorId(author, permlink) };
  }

  function commentHashFromLocation() {
    if (HASH_ROUTING || /^#\//.test(location.hash || "")) return "";
    const parsed = parseCommentFragment(location.hash);
    return parsed ? "#" + parsed.id : "";
  }

  function commentPath(node) {
    if (!node || !node.author || !node.permlink) return "";
    const id = commentAnchorId(node.author, node.permlink);
    if (HASH_ROUTING) return "#" + id;
    const root = currentPost;
    if (root && root.author && root.permlink) return postPath(root) + "#" + id;
    return "#" + id;
  }

  // Bridge comment `url` is /category/@root/permlink#@commenter/permlink.
  // The title on a comment's own page links to that comment in the root post.
  function commentOnRootHref(post) {
    if (!post || isRootPost(post)) return "";
    const author = String(post.author || "")
      .replace(/^@/, "")
      .trim();
    const permlink = String(post.permlink || "").trim();
    if (!author || !permlink) return "";
    let raw = String(post.url || "").trim();
    if (!raw) return "";
    raw = raw.replace(/^https?:\/\/(?:www\.)?(?:hive\.blog|peakd\.com|ecency\.com)\//i, "");
    raw = raw.replace(/^\//, "");
    const at = raw.indexOf("@");
    if (at < 0) return "";
    const rest = raw.slice(at);
    const hashIdx = rest.indexOf("#");
    const pathPart = (hashIdx >= 0 ? rest.slice(0, hashIdx) : rest)
      .split("?")[0]
      .replace(/\/+$/, "");
    if (!pathPart) return "";
    const self = "@" + author.toLowerCase() + "/" + permlink.toLowerCase();
    if (pathPart.toLowerCase() === self) return "";
    const parsed = parseCommentFragment(hashIdx >= 0 ? rest.slice(hashIdx) : "");
    const same =
      parsed &&
      parsed.author === author.toLowerCase() &&
      String(parsed.permlink).toLowerCase() === permlink.toLowerCase();
    const hash = "#" + (same ? parsed.id : commentAnchorId(author, permlink));
    if (HASH_ROUTING) return appHref("/" + pathPart);
    return appHref("/" + pathPart) + hash;
  }

  function parsePayoutAmount(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (!value) return NaN;
    const m = String(value).match(/-?[\d.]+/);
    return m ? Number(m[0]) : NaN;
  }

  function payoutAmount(post) {
    const n = parsePayoutAmount(post && post.payout);
    if (Number.isFinite(n)) return n;
    const pending = parsePayoutAmount(post && post.pending_payout_value);
    if (Number.isFinite(pending)) return pending;
    const total = parsePayoutAmount(post && post.total_payout_value);
    const curator = parsePayoutAmount(post && post.curator_payout_value);
    const paid = (Number.isFinite(total) ? total : 0) + (Number.isFinite(curator) ? curator : 0);
    return paid;
  }

  function formatHiveAmount(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "H 0.00";
    return `H ${Math.abs(n).toFixed(2)}`;
  }

  function formatPayout(post) {
    return formatHiveAmount(payoutAmount(post));
  }

  function roundHbd(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.round(n * 100) / 100;
  }

  function payoutBeneficiaryList(post) {
    const list = post && post.beneficiaries;
    if (!Array.isArray(list)) return [];
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const row = list[i];
      const account = String((row && row.account) || "")
        .replace(/^@/, "")
        .trim()
        .toLowerCase();
      const weight = Number(row && row.weight);
      if (!account || !Number.isFinite(weight) || weight <= 0) continue;
      out.push({ account, weight });
    }
    return out;
  }

  function payoutDeclined(post) {
    if (!post || post.max_accepted_payout == null || post.max_accepted_payout === "") return false;
    const max = parsePayoutAmount(post.max_accepted_payout);
    return Number.isFinite(max) && max <= 0;
  }

  function payoutBurned(post) {
    const list = payoutBeneficiaryList(post);
    for (let i = 0; i < list.length; i++) {
      if (list[i].account === "null" && list[i].weight >= 10000) return true;
    }
    return false;
  }

  function payoutIsPaid(post) {
    if (!post) return false;
    if (post.is_paidout) return true;
    return String(post.cashout_time || "").indexOf("1969") === 0;
  }

  function payoutAuthorValue(post) {
    const author = parsePayoutAmount(post && post.author_payout_value);
    if (Number.isFinite(author)) return author;
    const total = parsePayoutAmount(post && post.total_payout_value);
    return Number.isFinite(total) ? total : 0;
  }

  function formatWeightPercent(weight) {
    const text = ((Number(weight) || 0) / 100).toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
    return text + "%";
  }

  function payoutRewardNote(post) {
    const pct = Number(post && post.percent_hbd);
    if (!Number.isFinite(pct)) return "";
    if (pct <= 0) return "100% HP";
    if (pct >= 10000) return "50% HP and 50% liquid";
    const liquid = (pct / 100).toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
    return liquid + "% liquid, the rest HP";
  }

  function payoutWhenParts(post) {
    const paid = payoutIsPaid(post);
    let raw = paid ? post.last_payout || post.payout_at || "" : post.payout_at || post.cashout_time || "";
    if (String(raw).indexOf("1969") === 0) raw = post.payout_at || "";
    if (!raw || String(raw).indexOf("1969") === 0) {
      return { rel: paid ? "Paid out" : "", abs: "" };
    }
    const relTime = timeAgo(raw);
    const abs = formatCreated(raw);
    const rel = paid
      ? relTime
        ? "Paid " + relTime
        : "Paid out"
      : relTime
        ? "Payout " + relTime
        : "";
    return { rel, abs };
  }

  function payoutFigures(post) {
    const source = post || {};
    const declined = payoutDeclined(source);
    const burned = !declined && payoutBurned(source);
    const paid = payoutIsPaid(source);
    const total = roundHbd(payoutAmount(source));
    const beneficiaries = payoutBeneficiaryList(source);
    let author = 0;
    let curators = 0;
    const benefRows = [];
    if (!declined && paid) {
      author = roundHbd(payoutAuthorValue(source));
      curators = roundHbd(parsePayoutAmount(source.curator_payout_value));
      for (let i = 0; i < beneficiaries.length; i++) {
        const row = beneficiaries[i];
        benefRows.push({
          account: row.account,
          weight: row.weight,
          amount: roundHbd(curators * (row.weight / 10000)),
        });
      }
    } else if (!declined) {
      curators = roundHbd(total / 2);
      const authorPool = roundHbd(total - curators);
      let benefSum = 0;
      for (let i = 0; i < beneficiaries.length; i++) {
        const row = beneficiaries[i];
        const amount = roundHbd(authorPool * (row.weight / 10000));
        benefSum += amount;
        benefRows.push({ account: row.account, weight: row.weight, amount });
      }
      author = roundHbd(authorPool - benefSum);
    } else {
      for (let i = 0; i < beneficiaries.length; i++) {
        benefRows.push({
          account: beneficiaries[i].account,
          weight: beneficiaries[i].weight,
          amount: 0,
        });
      }
    }
    const max = parsePayoutAmount(source.max_accepted_payout);
    const promoted = roundHbd(parsePayoutAmount(source.promoted));
    return {
      declined,
      burned,
      paid,
      total,
      author,
      curators,
      beneficiaries: benefRows,
      reward: declined ? "" : payoutRewardNote(source),
      when: payoutWhenParts(source),
      belowMin: !paid && !declined && total > 0 && total < 0.02,
      maxLabel: Number.isFinite(max) && max > 0 && max < 1000000 ? roundHbd(max) : 0,
      promoted,
    };
  }

  function payoutTotalHtml(figures) {
    const n = figures.total.toFixed(2);
    if (figures.burned) {
      return `<span class="payout-mark" aria-hidden="true">🔥</span><span class="payout-amount">${n}</span>`;
    }
    return `<span class="payout-amount">H ${n}</span>`;
  }

  function payoutHtml(post, pill) {
    const author = HiveMd.escapeHtml(post.author || "");
    const permlink = HiveMd.escapeHtml(post.permlink || "");
    const figures = payoutFigures(post);
    const cls = pill ? "payout stat-pill" : "payout";
    const mode = figures.burned ? " is-burned" : figures.declined ? " is-declined" : "";
    const label = figures.burned ? "Burned payout" : figures.declined ? "Declined payout" : "Payout";
    const attrs = `type="button" class="${cls}${mode}" data-payout-author="${author}" data-payout-permlink="${permlink}" aria-label="${label} ${figures.total.toFixed(2)}"`;
    const inner = `<span class="payout-value">${payoutTotalHtml(figures)}</span>`;
    return `<button ${attrs}>${inner}</button>`;
  }

  function applyPayoutEl(el, post) {
    if (!el) return;
    const source = post || {};
    const known = Array.isArray(source.beneficiaries) || source.max_accepted_payout != null;
    const figures = payoutFigures(source);
    if (!known) {
      figures.burned = el.classList.contains("is-burned");
      figures.declined = !figures.burned && el.classList.contains("is-declined");
    } else {
      el.classList.toggle("is-burned", figures.burned);
      el.classList.toggle("is-declined", figures.declined);
    }
    const label = figures.burned ? "Burned payout" : figures.declined ? "Declined payout" : "Payout";
    el.setAttribute("aria-label", label + " " + figures.total.toFixed(2));
    let value = el.querySelector(".payout-value");
    if (!value) {
      value = document.createElement("span");
      value.className = "payout-value";
      el.textContent = "";
      el.appendChild(value);
    }
    value.innerHTML = payoutTotalHtml(figures);
  }

  function rememberPayout(post) {
    if (!post || !post.author || !post.permlink) return;
    const net = Number(post.net_rshares);
    payoutByKey.set(postKey(post.author, post.permlink), {
      payout: payoutAmount(post),
      netRshares: Number.isFinite(net) ? net : 0,
    });
  }

  let openPayout = null;
  let payoutShowTimer = 0;
  let payoutHideTimer = 0;
  let payoutPanelNode = null;

  function payoutPostFor(author, permlink) {
    const item = findLoadedPost(author, permlink);
    if (item) {
      const shown = cardDisplayPost(item);
      if (shown && samePostId(shown, author, permlink)) return shown;
      if (samePostId(item, author, permlink)) return item;
    }
    if (currentPost && samePostId(currentPost, author, permlink)) return currentPost;
    return findContentNode(author, permlink);
  }

  function payoutPanelRow(label, amount) {
    return `<div class="payout-panel-row"><span>${HiveMd.escapeHtml(label)}</span><span class="payout-panel-amt">${HiveMd.escapeHtml(formatHiveAmount(amount))}</span></div>`;
  }

  function payoutPanelHtml(author, permlink) {
    const post = payoutPostFor(author, permlink) || { author, permlink };
    const figures = payoutFigures(post);
    const caption = figures.declined ? "Payout declined" : figures.paid ? "Past payout" : "Pending payout";
    let rows = "";
    if (!figures.declined) {
      rows += payoutPanelRow("Author", figures.author);
      rows += payoutPanelRow("Curators", figures.curators);
    }
    if (figures.promoted > 0) rows += payoutPanelRow("Promoted", figures.promoted);
    let benef = "";
    if (figures.beneficiaries.length) {
      const lines = figures.beneficiaries
        .map((row) => {
          const href = HiveMd.escapeHtml(profilePath(row.account));
          const name = HiveMd.escapeHtml("@" + row.account);
          const pct = HiveMd.escapeHtml(formatWeightPercent(row.weight));
          const amt = HiveMd.escapeHtml(formatHiveAmount(row.amount));
          return `<div class="payout-panel-row"><a href="${href}">${name} <span class="payout-panel-pct">${pct}</span></a><span class="payout-panel-amt">${amt}</span></div>`;
        })
        .join("");
      benef = `<p class="payout-panel-caption payout-panel-sub">Beneficiaries</p>${lines}`;
    }
    const notes = [];
    if (figures.declined) notes.push("Declined payout leaves it in the reward pool.");
    else if (figures.burned) notes.push(figures.paid ? "The author reward was burned." : "The author reward is burned.");
    if (figures.reward) notes.push(figures.reward);
    if (figures.belowMin) notes.push("Below the 0.02 minimum payout.");
    if (figures.maxLabel) notes.push("Max payout " + formatHiveAmount(figures.maxLabel));
    const noteHtml = notes
      .map((line) => `<p class="payout-panel-note">${HiveMd.escapeHtml(line)}</p>`)
      .join("");
    const when = figures.when || { rel: "", abs: "" };
    const whenHtml = when.rel
      ? `<p class="payout-panel-when">${HiveMd.escapeHtml(when.rel)}${
          when.abs ? `<span class="payout-panel-abs">${HiveMd.escapeHtml(when.abs)}</span>` : ""
        }</p>`
      : "";
    return `<p class="payout-panel-caption">${caption}</p>${rows}${benef}${noteHtml}${whenHtml}`;
  }

  function payoutPanelEl() {
    if (payoutPanelNode && payoutPanelNode.isConnected) return payoutPanelNode;
    let el = document.getElementById("payoutPanel");
    if (!el) {
      el = document.createElement("div");
      el.id = "payoutPanel";
      el.className = "payout-panel";
      el.hidden = true;
      el.setAttribute("role", "dialog");
      el.setAttribute("aria-label", "Payout details");
      document.body.appendChild(el);
      el.addEventListener("pointerenter", () => {
        window.clearTimeout(payoutHideTimer);
        payoutHideTimer = 0;
      });
      el.addEventListener("pointerleave", scheduleHidePayout);
    }
    payoutPanelNode = el;
    return el;
  }

  function placePayoutPanel(anchor, panel) {
    if (!anchor || !panel || panel.hidden) return;
    const rect = anchor.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) {
      hidePayoutPanel();
      return;
    }
    panel.style.position = "fixed";
    panel.style.zIndex = "70";
    panel.style.right = "auto";
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const spaceAbove = rect.top - 12;
    const contentH = panel.scrollHeight;
    const placeAbove = contentH > spaceBelow && spaceAbove > spaceBelow;
    const maxH = Math.max(80, Math.round(placeAbove ? spaceAbove : spaceBelow));
    panel.style.maxHeight = maxH + "px";
    panel.style.left = Math.round(rect.left) + "px";
    if (placeAbove) {
      panel.style.top = Math.max(8, Math.round(rect.top - Math.min(contentH, maxH) - 8)) + "px";
    } else {
      panel.style.top = Math.round(rect.bottom + 8) + "px";
    }
    const box = panel.getBoundingClientRect();
    const maxRight = window.innerWidth - 8;
    if (box.right > maxRight) {
      panel.style.left = Math.max(8, Math.round(maxRight - box.width)) + "px";
    }
    if (panel.getBoundingClientRect().left < 8) panel.style.left = "8px";
  }

  function hidePayoutPanel() {
    window.clearTimeout(payoutShowTimer);
    window.clearTimeout(payoutHideTimer);
    payoutShowTimer = 0;
    payoutHideTimer = 0;
    openPayout = null;
    const panel = payoutPanelNode || document.getElementById("payoutPanel");
    if (!panel) return;
    panel.hidden = true;
    panel.innerHTML = "";
    panel.style.top = "";
    panel.style.left = "";
    panel.style.maxHeight = "";
  }

  function scheduleHidePayout(e) {
    if (e && e.pointerType && e.pointerType !== "mouse") return;
    if (!hoverFine()) return;
    window.clearTimeout(payoutShowTimer);
    window.clearTimeout(payoutHideTimer);
    payoutShowTimer = 0;
    payoutHideTimer = window.setTimeout(hidePayoutPanel, 180);
  }

  function showPayoutPanel(el) {
    if (!el || !el.isConnected || !el.classList.contains("payout")) return;
    const author = el.getAttribute("data-payout-author");
    const permlink = el.getAttribute("data-payout-permlink");
    if (!author || !permlink) return;
    window.clearTimeout(payoutHideTimer);
    payoutHideTimer = 0;
    hideVoteVoters();
    hideReblogConfirm();
    const panel = payoutPanelEl();
    openPayout = { el, author, permlink };
    panel.innerHTML = payoutPanelHtml(author, permlink);
    panel.hidden = false;
    document.body.appendChild(panel);
    placePayoutPanel(el, panel);
  }

  function onPayoutEnter(el) {
    if (!hoverFine() || !el) return;
    window.clearTimeout(payoutHideTimer);
    window.clearTimeout(payoutShowTimer);
    payoutHideTimer = 0;
    if (openPayout && openPayout.el === el && payoutPanelNode && !payoutPanelNode.hidden) {
      showPayoutPanel(el);
      return;
    }
    payoutShowTimer = window.setTimeout(() => {
      payoutShowTimer = 0;
      showPayoutPanel(el);
    }, 80);
  }

  function togglePayoutPanel(el) {
    if (openPayout && openPayout.el === el && payoutPanelNode && !payoutPanelNode.hidden) {
      hidePayoutPanel();
      return;
    }
    showPayoutPanel(el);
  }

  function voteCount(post) {
    if (post && post.stats && post.stats.total_votes != null) {
      return Number(post.stats.total_votes) || 0;
    }
    return Array.isArray(post && post.active_votes) ? post.active_votes.length : 0;
  }

  function votePolarity(vote) {
    if (!vote || typeof vote !== "object") return 0;
    if (vote.percent != null && vote.percent !== "") {
      const p = Number(vote.percent);
      if (Number.isFinite(p) && p !== 0) return p < 0 ? -1 : 1;
    }
    const r = Number(vote.rshares);
    if (Number.isFinite(r) && r !== 0) return r < 0 ? -1 : 1;
    return 0;
  }

  function downvoteCountOf(post) {
    const votes = post && post.active_votes;
    if (!Array.isArray(votes)) return 0;
    let n = 0;
    for (let i = 0; i < votes.length; i++) {
      if (votePolarity(votes[i]) === -1) n += 1;
    }
    return n;
  }

  function upvoteCountOf(post) {
    const down = downvoteCountOf(post);
    if (post && post.stats && post.stats.total_votes != null) {
      return Math.max(0, (Number(post.stats.total_votes) || 0) - down);
    }
    const votes = post && post.active_votes;
    if (Array.isArray(votes)) {
      let n = 0;
      for (let i = 0; i < votes.length; i++) {
        if (votePolarity(votes[i]) === 1) n += 1;
      }
      return n;
    }
    return voteCount(post);
  }

  function postKey(author, permlink) {
    return `${author}/${permlink}`;
  }

  function rememberContent(node) {
    if (!node || !node.author || !node.permlink) return;
    contentByKey.set(postKey(node.author, node.permlink), {
      author: node.author,
      permlink: node.permlink,
      title: node.title || "",
      body: node.body || "",
      parent_author: node.parent_author || "",
      parent_permlink: node.parent_permlink || "",
      json_metadata: node.json_metadata,
    });
  }

  function contentOf(author, permlink) {
    return contentByKey.get(postKey(author, permlink)) || null;
  }

  function contentMayDelete(author, children) {
    if (!isOwnAuthor(author)) return false;
    const n = Number(children);
    return Number.isFinite(n) && n <= 0;
  }

  function contentDeleteItemHtml() {
    return `<button type="button" class="content-more-item content-more-delete" role="menuitem">Delete</button>`;
  }

  function contentMoreHtml(author, permlink, kind, children) {
    const name = String(author || "").replace(/^@/, "");
    const link = String(permlink || "");
    if (!name || !link) return "";
    const safeKind = kind === "comment" || kind === "post" ? kind : "card";
    const items = [];
    if (isOwnAuthor(name)) {
      items.push(
        `<button type="button" class="content-more-item content-more-edit" role="menuitem">Edit</button>`
      );
      if (contentMayDelete(name, children)) items.push(contentDeleteItemHtml());
    }
    items.push(
      `<button type="button" class="content-more-item content-more-copy" role="menuitem">Copy link</button>`,
      `<a class="content-more-item content-more-explorer" role="menuitem" href="${HiveMd.escapeHtml(blockExplorerContentUrl(name, link))}" target="_blank" rel="noopener noreferrer">Block Explorer</a>`
    );
    return `
      <div class="content-more" data-author="${HiveMd.escapeHtml(name)}" data-permlink="${HiveMd.escapeHtml(link)}" data-content-kind="${safeKind}">
        <button type="button" class="content-more-btn" aria-label="More actions" aria-haspopup="menu" aria-expanded="false">\u00b7\u00b7\u00b7</button>
        <div class="content-more-menu" role="menu" hidden>
          ${items.join("")}
        </div>
      </div>`;
  }

  function findUserVote(votes, user) {
    const name = String(user || "")
      .replace(/^@/, "")
      .toLowerCase();
    if (!name || !Array.isArray(votes)) return null;
    for (let i = 0; i < votes.length; i++) {
      const v = votes[i];
      const voter = String((v && v.voter) || "")
        .replace(/^@/, "")
        .toLowerCase();
      if (voter === name) return v;
    }
    return null;
  }

  function userVoteSign(post) {
    const user = observer();
    if (!user || !post) return 0;
    const mine = findUserVote(post.active_votes, user);
    return mine ? votePolarity(mine) : 0;
  }

  function voteView(post) {
    const key = postKey(post.author, post.permlink);
    const serverUp = upvoteCountOf(post);
    const serverDown = downvoteCountOf(post);
    const serverSign = userVoteSign(post);
    const local = localVotes.get(key);
    if (!local) {
      return {
        key,
        upCount: serverUp,
        downCount: serverDown,
        sign: serverSign,
        pending: false,
      };
    }
    let upCount = serverUp;
    let downCount = serverDown;
    if (local.sign !== serverSign) {
      if (serverSign === 1) upCount -= 1;
      else if (serverSign === -1) downCount -= 1;
      if (local.sign === 1) upCount += 1;
      else if (local.sign === -1) downCount += 1;
    }
    return {
      key,
      upCount: Math.max(0, upCount),
      downCount: Math.max(0, downCount),
      sign: local.sign,
      pending: Boolean(local.pending),
    };
  }

  function plainVoteHtml(author, permlink, upCount, downCount) {
    return `<span class="vote-counts" data-vote-author="${author}" data-vote-permlink="${permlink}"><span class="vote-count vote-hit" data-vote-author="${author}" data-vote-permlink="${permlink}" data-vote-dir="up">▲ <span class="vote-n">${upCount}</span></span><span class="vote-count downvote-count vote-hit" data-vote-author="${author}" data-vote-permlink="${permlink}" data-vote-dir="down">▼ <span class="downvote-n">${downCount}</span></span></span>`;
  }

  function voteSliderHtml(kind, author, permlink, pct, downPct) {
    return `<span class="vote-slider-panel" hidden data-vote-kind="${kind}"><label class="vote-weight"><span class="vote-slider-slot"><span class="vote-weight-caption">weight</span><span class="vote-slider-line" style="--vote-pct: ${pct}%; --p: ${Number(pct) / 100}"><input class="vote-slider" type="range" min="0" max="100" step="1" value="${pct}" aria-label="Vote weight"></span></span><span class="vote-weight-value">${pct}%</span></label></span><span class="downvote-slider-panel" hidden data-vote-kind="${kind}"><div class="vote-weight downvote-weight"><span class="vote-slider-slot"><span class="vote-weight-caption">weight</span><span class="vote-slider-line" style="--vote-pct: ${downPct}%; --p: ${Number(downPct) / 100}"><input class="vote-slider downvote-slider" type="range" min="0" max="100" step="1" value="${downPct}" aria-label="Downvote weight"></span></span><span class="vote-weight-value">${downPct}%</span><button type="button" class="downvote-confirm" data-vote-author="${author}" data-vote-permlink="${permlink}" data-vote-kind="${kind}">Downvote</button></div></span>`;
  }

  function voteControlHtml(post, variant) {
    rememberPayout(post);
    const viewState = voteView(post);
    const user = observer();
    const upCount = viewState.upCount;
    const downCount = viewState.downCount;
    const author = HiveMd.escapeHtml(post.author);
    const permlink = HiveMd.escapeHtml(post.permlink);
    if (variant === "plain" || (!user && variant !== "pills")) {
      return plainVoteHtml(author, permlink, upCount, downCount);
    }
    const kind = voteKindFromPost(post);
    const pct = upvoteStartPercent(kind);
    const downPct = readStoredDownvoteWeight(kind);
    const pending = user && viewState.pending ? "disabled" : "";
    const pill = variant === "pills" ? "stat-pill" : "";
    const upClasses = ["vote-btn", pill, viewState.sign === 1 ? "is-voted" : "", user && viewState.pending ? "is-pending" : ""]
      .filter(Boolean)
      .join(" ");
    const downClasses = ["downvote-btn", pill, viewState.sign === -1 ? "is-voted" : "", user && viewState.pending ? "is-pending" : ""]
      .filter(Boolean)
      .join(" ");
    const upLabel = viewState.sign === 1 ? "Remove upvote" : "Upvote";
    const downLabel = viewState.sign === -1 ? "Remove downvote" : "Downvote";
    const sliders = user ? voteSliderHtml(kind, author, permlink, pct, downPct) : "";
    const upBtn = `<button type="button" class="${upClasses}" data-vote-author="${author}" data-vote-permlink="${permlink}" data-vote-key="${author}/${permlink}" data-vote-kind="${kind}" data-vote-dir="up" aria-pressed="${viewState.sign === 1 ? "true" : "false"}" aria-label="${upLabel}" ${pending}>▲</button>`;
    const downBtn = `<button type="button" class="${downClasses}" data-vote-author="${author}" data-vote-permlink="${permlink}" data-vote-key="${author}/${permlink}" data-vote-kind="${kind}" data-vote-dir="down" aria-pressed="${viewState.sign === -1 ? "true" : "false"}" aria-label="${downLabel}" ${pending}>▼</button>`;
    if (variant === "pills") {
      return `<span class="vote-wrap vote-pills" data-vote-kind="${kind}" data-vote-author="${author}" data-vote-permlink="${permlink}"><span class="vote-pair">${upBtn}<button type="button" class="vote-count-btn stat-pill vote-hit" data-vote-author="${author}" data-vote-permlink="${permlink}" data-vote-dir="up" aria-label="Upvotes"><span class="vote-n">${upCount}</span></button></span><span class="vote-pair">${downBtn}<button type="button" class="vote-count-btn stat-pill vote-hit" data-vote-author="${author}" data-vote-permlink="${permlink}" data-vote-dir="down" aria-label="Downvotes"><span class="downvote-n">${downCount}</span></button></span>${sliders}</span>`;
    }
    const upCountHtml = `▲ <span class="vote-n vote-hit" data-vote-author="${author}" data-vote-permlink="${permlink}" data-vote-dir="up">${upCount}</span>`;
    const downCountHtml = `▼ <span class="downvote-n vote-hit" data-vote-author="${author}" data-vote-permlink="${permlink}" data-vote-dir="down">${downCount}</span>`;
    return `<span class="vote-wrap" data-vote-kind="${kind}" data-vote-author="${author}" data-vote-permlink="${permlink}">${upBtn.replace("▲", upCountHtml)}${downBtn.replace("▼", downCountHtml)}${sliders}</span>`;
  }

  function voteRootsFor(author, permlink) {
    return Array.from(document.querySelectorAll(".vote-wrap, .vote-counts")).filter(
      (el) =>
        el.getAttribute("data-vote-author") === author &&
        el.getAttribute("data-vote-permlink") === permlink
    );
  }

  function voteWrapsFor(author, permlink) {
    return voteRootsFor(author, permlink).filter((el) => el.classList.contains("vote-wrap"));
  }

  function releaseVoteColor(btn) {
    if (!btn) return;
    btn.classList.remove("is-rest");
    btn.removeAttribute("data-vote-left");
    btn.removeAttribute("data-vote-rest-armed");
  }

  function restVoteColor(btn) {
    if (!btn) return;
    btn.classList.add("is-rest");
    btn.removeAttribute("data-vote-left");
    if (!btn.matches(":hover")) {
      btn.setAttribute("data-vote-rest-armed", "1");
      btn.setAttribute("data-vote-left", "1");
      return;
    }
    btn.removeAttribute("data-vote-rest-armed");
    window.setTimeout(() => {
      if (!btn.classList.contains("is-rest")) return;
      btn.setAttribute("data-vote-rest-armed", "1");
      if (!btn.matches(":hover")) btn.setAttribute("data-vote-left", "1");
    }, 0);
  }

  function syncVoteArrow(btn, voted, pending, votedLabel, idleLabel) {
    if (!btn) return;
    const wasVoted = btn.classList.contains("is-voted");
    btn.classList.toggle("is-voted", voted);
    btn.classList.toggle("is-pending", pending);
    btn.disabled = pending;
    btn.setAttribute("aria-pressed", voted ? "true" : "false");
    btn.setAttribute("aria-label", voted ? votedLabel : idleLabel);
    if (voted) releaseVoteColor(btn);
    else if (wasVoted) restVoteColor(btn);
  }

  function syncVoteButtons(author, permlink, state) {
    const pending = Boolean(state.pending);
    const upvoted = state.sign === 1;
    const downvoted = state.sign === -1;
    voteRootsFor(author, permlink).forEach((root) => {
      const upBtn = root.querySelector(".vote-btn");
      const downBtn = root.querySelector(".downvote-btn");
      syncVoteArrow(upBtn, upvoted, pending, "Remove upvote", "Upvote");
      syncVoteArrow(downBtn, downvoted, pending, "Remove downvote", "Downvote");
      root.querySelectorAll(".vote-n").forEach((el) => {
        el.textContent = String(state.upCount);
      });
      root.querySelectorAll(".downvote-n").forEach((el) => {
        el.textContent = String(state.downCount);
      });
    });
  }

  function voteKindFromPost(post) {
    return isRootPost(post) ? "post" : "comment";
  }

  function normalizeVoteKind(kind) {
    return kind === "comment" ? "comment" : "post";
  }

  function voteKindFromEl(el) {
    const node = el && el.closest("[data-vote-kind]");
    return normalizeVoteKind(node && node.getAttribute("data-vote-kind"));
  }

  function parseStoredWeight(raw) {
    if (raw == null || raw === "") return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  function readStoredWeight(kind) {
    kind = normalizeVoteKind(kind);
    const specific = parseStoredWeight(localStorage.getItem(VOTE_WEIGHT_KEYS[kind]));
    if (specific != null) return specific;
    return 100;
  }

  function storeWeight(percent, kind) {
    kind = normalizeVoteKind(kind);
    const pct = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
    localStorage.setItem(VOTE_WEIGHT_KEYS[kind], String(pct));
    return pct;
  }

  // A default above 0 replaces the last-used weight when a new upvote opens.
  // 0 and an empty value mean "not set", so the last vote weight is used.
  function readDefaultVoteWeight(kind) {
    kind = normalizeVoteKind(kind);
    let raw = null;
    try {
      raw = localStorage.getItem(DEFAULT_VOTE_WEIGHT_KEYS[kind]);
    } catch {
      return null;
    }
    if (raw == null) return null;
    const text = String(raw).trim();
    if (!text) return null;
    const n = Number(text);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.max(1, Math.min(100, Math.round(n)));
  }

  function storeDefaultVoteWeight(percent, kind) {
    kind = normalizeVoteKind(kind);
    const text = String(percent == null ? "" : percent).trim();
    const n = text === "" ? 0 : Number(text);
    const clear = !text || !Number.isFinite(n) || n <= 0;
    try {
      if (clear) {
        localStorage.removeItem(DEFAULT_VOTE_WEIGHT_KEYS[kind]);
        return null;
      }
      const pct = Math.max(1, Math.min(100, Math.round(n)));
      localStorage.setItem(DEFAULT_VOTE_WEIGHT_KEYS[kind], String(pct));
      return pct;
    } catch {
      return null;
    }
  }

  function upvoteStartPercent(kind) {
    const preset = readDefaultVoteWeight(kind);
    if (preset != null) return preset;
    return readStoredWeight(kind);
  }

  function readStoredDownvoteWeight(kind) {
    kind = normalizeVoteKind(kind);
    const specific = parseStoredWeight(localStorage.getItem(DOWNVOTE_WEIGHT_KEYS[kind]));
    if (specific != null) return specific;
    return 100;
  }

  function storeDownvoteWeight(percent, kind) {
    kind = normalizeVoteKind(kind);
    const pct = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
    localStorage.setItem(DOWNVOTE_WEIGHT_KEYS[kind], String(pct));
    return pct;
  }

  let openSlider = null;
  // Set for the keyboard upvote so the panel docks when it would sit off screen.
  let feedKeyDockSlider = false;

  function sliderModeForBtn(btn) {
    return btn && btn.classList.contains("downvote-btn") ? "down" : "up";
  }

  function sliderPanelFor(btn) {
    const wrap = btn && btn.closest(".vote-wrap");
    if (!wrap) return null;
    const mode = sliderModeForBtn(btn);
    if (openSlider && openSlider.wrap === wrap && openSlider.mode === mode) {
      return openSlider.panel;
    }
    return wrap.querySelector(mode === "down" ? ".downvote-slider-panel" : ".vote-slider-panel");
  }

  function paintVoteSlider(slider, valueEl) {
    if (!slider) return;
    const pct = Math.max(0, Math.min(100, Number(slider.value) || 0));
    const line = slider.closest(".vote-slider-line");
    if (line) {
      line.style.setProperty("--vote-pct", pct + "%");
      line.style.setProperty("--p", String(pct / 100));
    }
    if (valueEl) valueEl.textContent = pct + "%";
  }

  const VOTE_TOUCH_STEP = 5;
  let touchVoteSlider = null;
  let touchVotePointerId = null;

  function snapVotePercent(value) {
    const n = Math.round((Number(value) || 0) / VOTE_TOUCH_STEP) * VOTE_TOUCH_STEP;
    return Math.max(0, Math.min(100, n));
  }

  function applyTouchVoteSnap(slider) {
    if (!slider || slider.dataset.touchStep !== "1") return;
    const snapped = snapVotePercent(slider.value);
    if (String(snapped) !== slider.value) slider.value = String(snapped);
  }

  function beginTouchVoteSnap(slider, pointerId) {
    slider.step = String(VOTE_TOUCH_STEP);
    slider.dataset.touchStep = "1";
    touchVoteSlider = slider;
    touchVotePointerId = pointerId;
    const snapped = snapVotePercent(slider.value);
    if (String(snapped) !== slider.value) {
      slider.value = String(snapped);
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  function endTouchVoteSnap(slider) {
    if (!slider) return;
    const snapped = snapVotePercent(slider.value);
    const wasTouch = slider.dataset.touchStep === "1";
    slider.step = "1";
    delete slider.dataset.touchStep;
    if (touchVoteSlider === slider) touchVoteSlider = null;
    touchVotePointerId = null;
    if (wasTouch && String(snapped) !== slider.value) {
      slider.value = String(snapped);
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  function endTouchVotePointer(e) {
    if (!touchVoteSlider) return;
    if (touchVotePointerId != null && e.pointerId !== touchVotePointerId) return;
    endTouchVoteSnap(touchVoteSlider);
  }

  function clearVoteSliderPos(panel) {
    panel.style.position = "";
    panel.style.top = "";
    panel.style.bottom = "";
    panel.style.left = "";
    panel.style.right = "";
    panel.style.transform = "";
    panel.style.zIndex = "";
  }

  function dockVoteSlider(panel) {
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    panel.style.top = "auto";
    panel.style.bottom = "16px";
    panel.style.left = "0px";
    const width = panel.offsetWidth || panel.getBoundingClientRect().width;
    const left = Math.max(8, Math.round((vw - width) / 2));
    panel.style.left = Math.min(left, Math.max(8, vw - width - 8)) + "px";
  }

  // The anchored panel is in view when its border box sits inside the viewport.
  function votePanelFits(panel) {
    const box = panel.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) return false;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    return box.top >= -1 && box.bottom <= vh + 1;
  }

  function placeVoteSlider(btn, panel) {
    const rect = btn.getBoundingClientRect();
    const keyboardDock =
      openSlider &&
      openSlider.panel === panel &&
      openSlider.dockWhenHidden;
    panel.style.position = "fixed";
    panel.style.zIndex = "64";
    panel.style.transform = "";
    panel.style.right = "auto";
    panel.style.bottom = "";
    panel.style.top = Math.round(rect.bottom + 18) + "px";
    panel.style.left = Math.round(rect.left + 6) + "px";
    const box = panel.getBoundingClientRect();
    const maxRight = window.innerWidth - 8;
    if (box.right > maxRight) {
      panel.style.left = Math.max(8, Math.round(maxRight - box.width)) + "px";
    }
    if (panel.getBoundingClientRect().left < 8) panel.style.left = "8px";
    // A partly visible arrow still anchors the panel under itself, which can
    // leave the panel below the fold. Keyboard upvote docks it instead.
    if (keyboardDock && !votePanelFits(panel)) dockVoteSlider(panel);
  }

  function repositionOpenSlider(e) {
    if (e && e.type === "scroll") {
      const t = e.target;
      if (votersPanelNode && (t === votersPanelNode || (t && t.nodeType === 1 && votersPanelNode.contains(t)))) {
        return;
      }
      if (payoutPanelNode && (t === payoutPanelNode || (t && t.nodeType === 1 && payoutPanelNode.contains(t)))) {
        return;
      }
      const profileMoreMenu = document.querySelector("body > .profile-more-menu");
      if (
        profileMoreMenu &&
        (t === profileMoreMenu || (t && t.nodeType === 1 && profileMoreMenu.contains(t)))
      ) {
        return;
      }
      const contentMoreMenu = document.querySelector("body > .content-more-menu");
      if (
        contentMoreMenu &&
        (t === contentMoreMenu || (t && t.nodeType === 1 && contentMoreMenu.contains(t)))
      ) {
        return;
      }
    }
    if (openSlider && !openSlider.panel.hidden) {
      placeVoteSlider(openSlider.btn, openSlider.panel);
    }
    if (openVoters && openVoters.el && openVoters.el.isConnected) {
      placeVoteVoters(openVoters.el, votersPanelEl());
    } else if (openVoters) {
      hideVoteVoters();
    }
    if (openReblog && openReblog.btn && openReblog.btn.isConnected && openReblog.panel) {
      placeReblogConfirm(openReblog.btn, openReblog.panel);
    } else if (openReblog) {
      hideReblogConfirm();
    }
    if (openPayout && openPayout.el && openPayout.el.isConnected) {
      placePayoutPanel(openPayout.el, payoutPanelEl());
    } else if (openPayout) {
      hidePayoutPanel();
    }
    const profileMoreRoot = view.querySelector(".profile-more.is-open");
    const profileMoreMenu = document.querySelector("body > .profile-more-menu");
    if (profileMoreRoot && profileMoreMenu && !profileMoreMenu.hidden) {
      placeProfileMore(profileMoreRoot.querySelector(".profile-more-btn"), profileMoreMenu);
    } else if (profileMoreMenu) {
      closeProfileMore();
    }
    const contentMoreRoot = document.querySelector(".content-more.is-open");
    const contentMoreMenu = document.querySelector("body > .content-more-menu");
    if (contentMoreRoot && contentMoreMenu && !contentMoreMenu.hidden) {
      placeAnchoredMenu(
        contentMoreRoot.querySelector(".content-more-btn"),
        contentMoreMenu,
        closeContentMore
      );
    } else if (contentMoreMenu) {
      closeContentMore();
    }
  }

  function clearUpvoteConfirmStyle() {
    document.querySelectorAll(".vote-btn.is-confirming").forEach((el) => {
      el.classList.remove("is-confirming");
    });
  }

  function hideVoteSlider() {
    hideVoteVoters();
    clearUpvoteConfirmStyle();
    if (openSlider) {
      const { wrap, panel } = openSlider;
      const active = document.activeElement;
      if (active && panel.contains(active) && active.blur) active.blur();
      const liveSlider = panel.querySelector(".vote-slider");
      if (liveSlider) endTouchVoteSnap(liveSlider);
      panel.hidden = true;
      clearVoteSliderPos(panel);
      if (wrap && panel.parentNode !== wrap) wrap.appendChild(panel);
      if (wrap) wrap.classList.remove("is-open");
      openSlider = null;
    }
    document.querySelectorAll(".vote-wrap.is-open").forEach((wrap) => {
      wrap.classList.remove("is-open");
    });
    hideReblogConfirm();
  }

  function hideVoteUi() {
    hideVoteSlider();
  }

  let openVoters = null;
  let votersGen = 0;
  let votersShowTimer = 0;
  let votersHideTimer = 0;
  let votersPanelNode = null;
  let votersTouching = false;
  let openReblog = null;
  let reblogConfirmGen = 0;

  function voteHitFrom(target) {
    return target && target.closest ? target.closest(".vote-hit") : null;
  }

  function voteDirFromEl(el) {
    if (!el) return "up";
    if (el.getAttribute("data-vote-dir") === "down") return "down";
    if (el.classList.contains("downvote-btn") || el.classList.contains("downvote-count")) {
      return "down";
    }
    return "up";
  }

  function votersPanelEl() {
    if (votersPanelNode && votersPanelNode.isConnected) return votersPanelNode;
    let el = document.getElementById("voteVotersPanel");
    if (!el) {
      el = document.createElement("div");
      el.id = "voteVotersPanel";
      el.className = "vote-voters-panel";
      el.hidden = true;
      el.setAttribute("role", "tooltip");
      document.body.appendChild(el);
      el.addEventListener("pointerenter", () => {
        window.clearTimeout(votersHideTimer);
        votersHideTimer = 0;
      });
      el.addEventListener("pointerdown", (e) => {
        window.clearTimeout(votersHideTimer);
        votersHideTimer = 0;
        if (e.pointerType !== "mouse") votersTouching = true;
      });
      let touchUnlockTimer = 0;
      const endVotersTouch = () => {
        window.clearTimeout(touchUnlockTimer);
        touchUnlockTimer = window.setTimeout(() => {
          votersTouching = false;
        }, 350);
      };
      el.addEventListener("pointerup", endVotersTouch);
      el.addEventListener("pointercancel", endVotersTouch);
      el.addEventListener("pointerleave", scheduleHideVoters);
      el.addEventListener(
        "scroll",
        () => {
          maybeLoadMoreVoters();
        },
        { passive: true }
      );
      el.addEventListener(
        "wheel",
        (e) => {
          if (e.deltaY > 0) maybeLoadMoreVoters();
          const max = el.scrollHeight - el.clientHeight;
          if (max <= 0) {
            e.preventDefault();
            return;
          }
          if (
            (e.deltaY < 0 && el.scrollTop <= 0) ||
            (e.deltaY > 0 && el.scrollTop >= max - 0.5)
          ) {
            e.preventDefault();
          }
        },
        { passive: false }
      );
    }
    votersPanelNode = el;
    return el;
  }

  function placeVoteVoters(anchor, panel) {
    if (!anchor || !panel || panel.hidden) return;
    const rect = anchor.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) {
      if (votersTouching) return;
      hideVoteVoters();
      return;
    }
    const scrollTop = panel.scrollTop;
    panel.style.position = "fixed";
    panel.style.zIndex = "70";
    panel.style.right = "auto";
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const spaceAbove = rect.top - 12;
    const contentH = panel.scrollHeight;
    const placeAbove = contentH > spaceBelow && spaceAbove > spaceBelow;
    const maxH = Math.max(80, Math.round(placeAbove ? spaceAbove : spaceBelow));
    panel.style.maxHeight = maxH + "px";
    panel.style.left = Math.round(rect.left) + "px";
    if (placeAbove) {
      panel.style.top =
        Math.max(8, Math.round(rect.top - Math.min(contentH, maxH) - 8)) + "px";
    } else {
      panel.style.top = Math.round(rect.bottom + 8) + "px";
    }
    const box = panel.getBoundingClientRect();
    const maxRight = window.innerWidth - 8;
    if (box.right > maxRight) {
      panel.style.left = Math.max(8, Math.round(maxRight - box.width)) + "px";
    }
    if (panel.getBoundingClientRect().left < 8) panel.style.left = "8px";
    if (panel.scrollTop !== scrollTop) panel.scrollTop = scrollTop;
  }

  function hideVoteVoters() {
    window.clearTimeout(votersShowTimer);
    window.clearTimeout(votersHideTimer);
    votersShowTimer = 0;
    votersHideTimer = 0;
    votersGen += 1;
    votersTouching = false;
    openVoters = null;
    const panel = votersPanelNode || document.getElementById("voteVotersPanel");
    if (!panel) return;
    panel.hidden = true;
    panel.innerHTML = "";
    panel.classList.remove("is-down");
    panel.style.top = "";
    panel.style.left = "";
    panel.style.maxHeight = "";
  }

  function scheduleHideVoters(e) {
    if (votersTouching) return;
    if (e && e.pointerType && e.pointerType !== "mouse") return;
    if (!hoverFine()) return;
    window.clearTimeout(votersShowTimer);
    window.clearTimeout(votersHideTimer);
    votersShowTimer = 0;
    votersHideTimer = window.setTimeout(hideVoteVoters, 180);
  }

  function voteRshares(vote) {
    const r = Number(vote && vote.rshares);
    return Number.isFinite(r) ? r : 0;
  }

  function totalVoteRshares(votes) {
    let sum = 0;
    const list = Array.isArray(votes) ? votes : [];
    for (let i = 0; i < list.length; i++) sum += voteRshares(list[i]);
    return sum;
  }

  function votePayoutValue(vote, totalPayout, totalRshares) {
    if (!totalRshares || !totalPayout) return 0;
    return totalPayout * (voteRshares(vote) / totalRshares);
  }

  function loadActiveVotes(author, permlink) {
    const key = postKey(author, permlink);
    const hit = votesCache.get(key);
    if (hit && Array.isArray(hit.votes)) return Promise.resolve(hit.votes);
    if (hit && hit.promise) return hit.promise;
    const promise = HiveApi.getActiveVotes(author, permlink)
      .then((votes) => {
        votesCache.set(key, { votes });
        return votes;
      })
      .catch((err) => {
        votesCache.delete(key);
        throw err;
      });
    votesCache.set(key, { promise });
    return promise;
  }

  function mergeLocalVoter(list, author, permlink, dir) {
    const user = observer();
    if (!user) return list;
    const local = localVotes.get(postKey(author, permlink));
    const want = dir === "down" ? -1 : 1;
    const source = Array.isArray(list) ? list : [];
    const withoutUser = source.filter(
      (v) => String((v && v.voter) || "").replace(/^@/, "").toLowerCase() !== user
    );
    if (!local) return source;
    if (local.sign !== want) return withoutUser;
    const unknown = local.rshares == null;
    const real = source.find(
      (v) => String((v && v.voter) || "").replace(/^@/, "").toLowerCase() === user
    );
    const fromChain = real ? voteRshares(real) : 0;
    const rshares = unknown ? 0 : fromChain !== 0 ? fromChain : Number(local.rshares) || 0;
    return [
      {
        voter: user,
        rshares,
        percent: want > 0 ? 10000 : -10000,
        pending: unknown,
      },
      ...withoutUser,
    ];
  }

  function voteVoterRowHtml(v, totalPayout, totalRshares) {
    const name = String((v && v.voter) || "").replace(/^@/, "").toLowerCase();
    if (!name) return "";
    const href = HiveMd.escapeHtml(appHref("/@" + name));
    const safe = HiveMd.escapeHtml(name);
    const pendingRow = Boolean(v && v.pending);
    const pay = pendingRow
      ? "…"
      : HiveMd.escapeHtml(formatHiveAmount(votePayoutValue(v, totalPayout, totalRshares)));
    return `<li><a class="vote-voter" href="${href}"><span class="vote-voter-name">@${safe}</span><span class="vote-voter-payout${
      pendingRow ? " is-pending" : ""
    }">${pay}</span></a></li>`;
  }

  function votersHasMore() {
    return Boolean(
      openVoters &&
        Array.isArray(openVoters.list) &&
        openVoters.shown < openVoters.list.length
    );
  }

  function syncVotersFooter(panel) {
    if (!panel) return;
    let more = panel.querySelector(".vote-voters-more");
    if (!votersHasMore()) {
      if (more) more.remove();
      return;
    }
    const left = openVoters.list.length - openVoters.shown;
    const html = `and ${left} more`;
    if (more) {
      more.textContent = html;
      return;
    }
    panel.insertAdjacentHTML("beforeend", `<p class="vote-voters-more">${html}</p>`);
  }

  function appendVoterRows(n) {
    const panel = votersPanelNode;
    if (!panel || !openVoters || !Array.isArray(openVoters.list)) return 0;
    const ul = panel.querySelector(".vote-voters-list");
    if (!ul) return 0;
    const start = openVoters.shown || 0;
    const end = Math.min(openVoters.list.length, start + Math.max(1, n || VOTERS_PAGE));
    if (end <= start) return 0;
    let html = "";
    for (let i = start; i < end; i++) {
      html +=
        openVoters.kind === "reblog"
          ? rebloggerRowHtml(openVoters.list[i])
          : voteVoterRowHtml(openVoters.list[i], openVoters.totalPayout, openVoters.totalRshares);
    }
    ul.insertAdjacentHTML("beforeend", html);
    openVoters.shown = end;
    syncVotersFooter(panel);
    return end - start;
  }

  function votersNearBottom(panel) {
    if (!panel) return false;
    return panel.scrollTop + panel.clientHeight >= panel.scrollHeight - VOTERS_SCROLL_PX;
  }

  function maybeLoadMoreVoters() {
    const panel = votersPanelNode;
    if (!panel || panel.hidden || !votersHasMore()) return;
    if (panel.clientHeight < 8) return;
    let guard = 0;
    while (votersHasMore() && guard++ < 40) {
      const overflow = panel.scrollHeight > panel.clientHeight + VOTERS_SCROLL_PX;
      if (overflow && !votersNearBottom(panel)) break;
      const added = appendVoterRows(VOTERS_PAGE);
      if (!added) break;
    }
  }

  function renderVoteVoters(panel, votes, dir, author, permlink) {
    const want = dir === "down" ? -1 : 1;
    const caption = dir === "down" ? "Downvotes" : "Upvotes";
    const ctx = payoutByKey.get(postKey(author, permlink));
    const totalPayout = ctx && Number.isFinite(ctx.payout) ? ctx.payout : 0;
    let totalRshares = ctx && ctx.netRshares ? ctx.netRshares : 0;
    if (!totalRshares) totalRshares = totalVoteRshares(votes);
    let list = (Array.isArray(votes) ? votes : []).filter((v) => votePolarity(v) === want);
    list.sort((a, b) => Math.abs(voteRshares(b)) - Math.abs(voteRshares(a)));
    list = mergeLocalVoter(list, author, permlink, dir);
    const keepShown =
      openVoters &&
      openVoters.author === author &&
      openVoters.permlink === permlink &&
      openVoters.dir === dir &&
      openVoters.shown
        ? openVoters.shown
        : 0;
    if (openVoters) {
      openVoters.list = list;
      openVoters.totalPayout = totalPayout;
      openVoters.totalRshares = totalRshares;
      openVoters.shown = 0;
    }
    if (!list.length) {
      panel.innerHTML = `<p class="vote-voters-caption">${caption}</p><p class="vote-voters-status">${
        dir === "down" ? "No downvotes yet." : "No upvotes yet."
      }</p>`;
      return;
    }
    panel.innerHTML = `<p class="vote-voters-caption">${caption}</p><ul class="vote-voters-list"></ul>`;
    appendVoterRows(Math.max(VOTERS_PAGE, keepShown));
    maybeLoadMoreVoters();
  }

  function showVoteVoters(el, force) {
    if ((!force && !hoverFine()) || !el || !el.isConnected) return;
    if (openSlider) return;
    hidePayoutPanel();
    if (openReblog) hideReblogConfirm();
    const author = el.getAttribute("data-vote-author");
    const permlink = el.getAttribute("data-vote-permlink");
    const dir = voteDirFromEl(el);
    if (!author || !permlink) return;
    window.clearTimeout(votersHideTimer);
    votersHideTimer = 0;
    const panel = votersPanelEl();
    if (
      openVoters &&
      openVoters.kind === "vote" &&
      openVoters.author === author &&
      openVoters.permlink === permlink &&
      openVoters.dir === dir
    ) {
      openVoters.el = el;
      panel.hidden = false;
      placeVoteVoters(el, panel);
      return;
    }
    const gen = ++votersGen;
    openVoters = { el, author, permlink, dir, kind: "vote", gen };
    panel.classList.toggle("is-down", dir === "down");
    panel.innerHTML = `<p class="vote-voters-caption">${
      dir === "down" ? "Downvotes" : "Upvotes"
    }</p><p class="vote-voters-status">Loading…</p>`;
    panel.hidden = false;
    document.body.appendChild(panel);
    placeVoteVoters(el, panel);
    loadActiveVotes(author, permlink)
      .then((votes) => {
        if (!openVoters || openVoters.gen !== gen) return;
        renderVoteVoters(panel, votes, dir, author, permlink);
        placeVoteVoters(el, panel);
      })
      .catch(() => {
        if (!openVoters || openVoters.gen !== gen) return;
        panel.innerHTML = `<p class="vote-voters-status">Could not load votes.</p>`;
        placeVoteVoters(el, panel);
      });
  }

  function onVoteHitEnter(el) {
    if (!hoverFine() || !el) return;
    window.clearTimeout(votersHideTimer);
    window.clearTimeout(votersShowTimer);
    votersHideTimer = 0;
    if (
      openVoters &&
      openVoters.el === el &&
      votersPanelEl() &&
      !votersPanelEl().hidden
    ) {
      showVoteVoters(el);
      return;
    }
    votersShowTimer = window.setTimeout(() => {
      votersShowTimer = 0;
      showVoteVoters(el);
    }, 80);
  }

  function normalizeReblogName(name) {
    return String(name || "")
      .replace(/^@/, "")
      .trim()
      .toLowerCase();
  }

  function reblogCountOf(post) {
    const n = Number(post && post.reblogs);
    if (Number.isFinite(n) && n >= 0) return n;
    const list = post && post.reblogged_by;
    if (Array.isArray(list)) return list.length;
    return 0;
  }

  function reblogPostFor(author, permlink) {
    const item = findLoadedPost(author, permlink);
    if (item) {
      const shown = cardDisplayPost(item);
      if (shown && shown.author) return shown;
    }
    if (currentPost && samePostId(currentPost, author, permlink)) return currentPost;
    const node = findContentNode(author, permlink);
    return node || { author, permlink, reblogs: 0 };
  }

  function reblogView(post) {
    const author = post && post.author;
    const permlink = post && post.permlink;
    if (!author || !permlink) {
      return { count: 0, mine: false, pending: false };
    }
    const key = postKey(author, permlink);
    const serverCount = reblogCountOf(post);
    const local = localReblogs.get(key);
    const cache = reblogsCache.get(key);
    const user = observer();
    let mine = false;
    if (user && cache && Array.isArray(cache.names)) {
      mine = cache.names.indexOf(user) !== -1;
    }
    if (local) {
      return {
        count: Math.max(0, local.count != null ? local.count : serverCount),
        mine: Boolean(local.mine),
        pending: Boolean(local.pending),
      };
    }
    return { count: serverCount, mine, pending: false };
  }

  function loadRebloggedBy(author, permlink) {
    const key = postKey(author, permlink);
    const hit = reblogsCache.get(key);
    if (hit && Array.isArray(hit.names)) return Promise.resolve(hit.names);
    if (hit && hit.promise) return hit.promise;
    const promise = HiveApi.getRebloggedBy(author, permlink)
      .then((names) => {
        reblogsCache.set(key, { names });
        return names;
      })
      .catch((err) => {
        reblogsCache.delete(key);
        throw err;
      });
    reblogsCache.set(key, { promise });
    return promise;
  }

  function mergeLocalRebloggers(names, author, permlink) {
    const user = observer();
    const list = Array.isArray(names) ? names.slice() : [];
    const local = localReblogs.get(postKey(author, permlink));
    if (!user) return list;
    const hasUser = list.indexOf(user) !== -1;
    if (local && local.mine && !hasUser) list.unshift(user);
    if (local && local.mine === false && hasUser) {
      return list.filter((n) => n !== user);
    }
    return list;
  }

  function rebloggerRowHtml(name) {
    const n = normalizeReblogName(name);
    if (!n) return "";
    const href = HiveMd.escapeHtml(appHref("/@" + n));
    const safe = HiveMd.escapeHtml(n);
    return `<li><a class="vote-voter" href="${href}"><span class="vote-voter-name">@${safe}</span></a></li>`;
  }

  function renderReblogUsers(panel, names, author, permlink) {
    const list = mergeLocalRebloggers(names, author, permlink);
    const keepShown =
      openVoters &&
      openVoters.kind === "reblog" &&
      openVoters.author === author &&
      openVoters.permlink === permlink &&
      openVoters.shown
        ? openVoters.shown
        : 0;
    if (openVoters) {
      openVoters.list = list;
      openVoters.shown = 0;
    }
    if (!list.length) {
      panel.innerHTML =
        `<p class="vote-voters-caption">Reblogs</p><p class="vote-voters-status">No reblogs yet.</p>`;
      return;
    }
    panel.innerHTML = `<p class="vote-voters-caption">Reblogs</p><ul class="vote-voters-list"></ul>`;
    appendVoterRows(Math.max(VOTERS_PAGE, keepShown));
    maybeLoadMoreVoters();
  }

  function showReblogUsers(el, force) {
    if ((!force && !hoverFine()) || !el || !el.isConnected) return;
    if (openSlider || openReblog) return;
    hidePayoutPanel();
    const author = el.getAttribute("data-reblog-author");
    const permlink = el.getAttribute("data-reblog-permlink");
    if (!author || !permlink) return;
    window.clearTimeout(votersHideTimer);
    votersHideTimer = 0;
    const panel = votersPanelEl();
    if (
      openVoters &&
      openVoters.kind === "reblog" &&
      openVoters.author === author &&
      openVoters.permlink === permlink
    ) {
      openVoters.el = el;
      panel.hidden = false;
      placeVoteVoters(el, panel);
      return;
    }
    const gen = ++votersGen;
    openVoters = { el, author, permlink, dir: "reblog", kind: "reblog", gen };
    panel.classList.remove("is-down");
    panel.innerHTML =
      `<p class="vote-voters-caption">Reblogs</p><p class="vote-voters-status">Loading…</p>`;
    panel.hidden = false;
    document.body.appendChild(panel);
    placeVoteVoters(el, panel);
    loadRebloggedBy(author, permlink)
      .then((names) => {
        if (!openVoters || openVoters.gen !== gen) return;
        renderReblogUsers(panel, names, author, permlink);
        placeVoteVoters(el, panel);
        syncReblogButtons(author, permlink, reblogView(reblogPostFor(author, permlink)));
      })
      .catch(() => {
        if (!openVoters || openVoters.gen !== gen) return;
        panel.innerHTML = `<p class="vote-voters-status">Could not load reblogs.</p>`;
        placeVoteVoters(el, panel);
      });
  }

  function onReblogHitEnter(el) {
    if (!hoverFine() || !el) return;
    if (openReblog) return;
    window.clearTimeout(votersHideTimer);
    window.clearTimeout(votersShowTimer);
    votersHideTimer = 0;
    if (
      openVoters &&
      openVoters.kind === "reblog" &&
      openVoters.el === el &&
      votersPanelEl() &&
      !votersPanelEl().hidden
    ) {
      showReblogUsers(el);
      return;
    }
    votersShowTimer = window.setTimeout(() => {
      votersShowTimer = 0;
      showReblogUsers(el);
    }, 80);
  }

  function placeReblogConfirm(btn, panel) {
    if (!btn || !panel || panel.hidden) return;
    const rect = btn.getBoundingClientRect();
    panel.style.position = "fixed";
    panel.style.zIndex = "64";
    panel.style.top = Math.round(rect.bottom + 8) + "px";
    panel.style.left = Math.round(rect.left) + "px";
    panel.style.right = "auto";
    const box = panel.getBoundingClientRect();
    const maxRight = window.innerWidth - 8;
    if (box.right > maxRight) {
      panel.style.left = Math.max(8, Math.round(maxRight - box.width)) + "px";
    }
    if (panel.getBoundingClientRect().left < 8) panel.style.left = "8px";
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    if (box.height > spaceBelow && rect.top - 12 > spaceBelow) {
      panel.style.top =
        Math.max(8, Math.round(rect.top - box.height - 8)) + "px";
    }
  }

  function setReblogConfirmStatus(text, warn) {
    if (!openReblog || !openReblog.panel) return;
    const status = openReblog.panel.querySelector(".reblog-confirm-status");
    if (!status) return;
    if (!text) {
      status.hidden = true;
      status.textContent = "";
      status.classList.remove("is-warn");
      return;
    }
    status.hidden = false;
    status.textContent = text;
    status.classList.toggle("is-warn", Boolean(warn));
  }

  function setReblogConfirmReady(ready) {
    if (!openReblog || !openReblog.panel) return;
    const confirm = openReblog.panel.querySelector(".reblog-confirm");
    if (confirm) confirm.disabled = !ready;
  }

  function setReblogConfirmCaption(own, undo) {
    if (!openReblog || !openReblog.panel) return;
    const caption = openReblog.panel.querySelector(".reblog-confirm-caption");
    if (!caption) return;
    caption.textContent = undo
      ? "Undo reblog?"
      : own
        ? "Reblog your post?"
        : "Reblog this post?";
  }

  function setReblogConfirmAction(undo) {
    if (!openReblog || !openReblog.panel) return;
    const confirm = openReblog.panel.querySelector(".reblog-confirm");
    if (!confirm) return;
    confirm.textContent = undo ? "Undo" : "Reblog";
    confirm.classList.toggle("is-undo", Boolean(undo));
  }

  function hideReblogConfirm() {
    if (!openReblog) return;
    const { wrap, panel } = openReblog;
    openReblog = null;
    if (!panel) return;
    panel.hidden = true;
    panel.style.position = "";
    panel.style.top = "";
    panel.style.left = "";
    panel.style.right = "";
    panel.style.zIndex = "";
    if (wrap && panel.parentNode !== wrap) wrap.appendChild(panel);
    if (wrap) wrap.classList.remove("is-open");
  }

  function showReblogConfirm(btn) {
    hideVoteVoters();
    hideVoteSlider();
    hidePayoutPanel();
    const wrap = btn.closest(".reblog-wrap");
    const panel = wrap && wrap.querySelector(".reblog-confirm-panel");
    if (!wrap || !panel) return;
    wrap.classList.add("is-open");
    openReblog = {
      wrap,
      btn,
      panel,
      author: btn.getAttribute("data-reblog-author"),
      permlink: btn.getAttribute("data-reblog-permlink"),
      gen: ++reblogConfirmGen,
      already: false,
      own: observer() === normalizeReblogName(btn.getAttribute("data-reblog-author")),
    };
    setReblogConfirmCaption(openReblog.own, false);
    setReblogConfirmAction(false);
    setReblogConfirmStatus("", false);
    setReblogConfirmReady(false);
    document.body.appendChild(panel);
    panel.hidden = false;
    placeReblogConfirm(btn, panel);
  }

  function reblogWrapsFor(author, permlink) {
    return Array.from(document.querySelectorAll(".reblog-wrap")).filter(
      (el) =>
        el.getAttribute("data-reblog-author") === author &&
        el.getAttribute("data-reblog-permlink") === permlink
    );
  }

  function syncReblogButtons(author, permlink, state) {
    const pending = Boolean(state && state.pending);
    const mine = Boolean(state && state.mine);
    const count = state && state.count != null ? String(state.count) : "0";
    reblogWrapsFor(author, permlink).forEach((root) => {
      const btn = root.querySelector(".reblog-btn");
      if (!btn) return;
      btn.classList.toggle("is-reblogged", mine);
      btn.classList.toggle("is-pending", pending);
      btn.disabled = pending;
      btn.setAttribute("aria-pressed", mine ? "true" : "false");
      btn.setAttribute("aria-label", mine ? "Undo reblog" : "Reblog");
      const n = btn.querySelector(".reblog-n");
      if (n) n.textContent = count;
    });
  }

  function queueReblog(author, permlink, undo) {
    const user = observer();
    if (!user) return;
    const key = postKey(author, permlink);
    const post = reblogPostFor(author, permlink);
    const shown = reblogView(post);
    if (shown.pending) return;
    if (undo && !shown.mine) return;
    if (!undo && shown.mine) return;
    const mine = !undo;
    const nextCount = Math.max(0, shown.count + (undo ? -1 : 1));
    const previous = localReblogs.get(key);
    localReblogs.set(key, { mine, pending: true, count: nextCount });
    syncReblogButtons(author, permlink, { mine, pending: true, count: nextCount });
    hideReblogConfirm();
    const body = { account: user, author, permlink };
    if (undo) body.delete = "delete";
    const { promise } = ChainQueue.enqueue({
      username: user,
      key: "Posting",
      operations: [
        [
          "custom_json",
          {
            required_auths: [],
            required_posting_auths: [user],
            id: "follow",
            json: JSON.stringify(["reblog", body]),
          },
        ],
      ],
      meta: { type: undo ? "unreblog" : "reblog", author, permlink },
    });
    promise
      .then(() => {
        localReblogs.set(key, { mine, pending: false, count: nextCount });
        const cache = reblogsCache.get(key);
        if (cache && Array.isArray(cache.names)) {
          if (undo) cache.names = cache.names.filter((n) => n !== user);
          else if (cache.names.indexOf(user) === -1) cache.names = [user].concat(cache.names);
        } else if (!undo && (!cache || !cache.promise)) {
          reblogsCache.set(key, { names: [user] });
        }
        if (post && post.author) {
          post.reblogs = nextCount;
        }
        if (currentPost && samePostId(currentPost, author, permlink)) {
          currentPost.reblogs = nextCount;
        }
        syncReblogButtons(author, permlink, { mine, pending: false, count: nextCount });
        if (
          openVoters &&
          openVoters.kind === "reblog" &&
          openVoters.author === author &&
          openVoters.permlink === permlink
        ) {
          const panel = votersPanelEl();
          const names =
            (reblogsCache.get(key) && reblogsCache.get(key).names) || (undo ? [] : [user]);
          renderReblogUsers(panel, names, author, permlink);
          placeVoteVoters(openVoters.el, panel);
        }
      })
      .catch((err) => {
        if (previous) localReblogs.set(key, previous);
        else localReblogs.delete(key);
        syncReblogButtons(author, permlink, reblogView(reblogPostFor(author, permlink)));
        showError(err.message || String(err));
      });
  }

  async function onReblogClick(btn) {
    if (!btn) return;
    if (btn.classList.contains("is-pending") || btn.disabled) return;
    const user = observer();
    if (!user) {
      openLogin();
      return;
    }
    const author = btn.getAttribute("data-reblog-author");
    const permlink = btn.getAttribute("data-reblog-permlink");
    if (!author || !permlink) return;
    if (openReblog && openReblog.btn === btn) {
      hideReblogConfirm();
      return;
    }
    showReblogConfirm(btn);
    const gen = openReblog && openReblog.gen;
    setReblogConfirmStatus("Checking…", false);
    setReblogConfirmReady(false);
    try {
      const names = await loadRebloggedBy(author, permlink);
      if (!openReblog || openReblog.gen !== gen) return;
      const viewState = reblogView(reblogPostFor(author, permlink));
      const own = user === normalizeReblogName(author);
      const local = localReblogs.get(postKey(author, permlink));
      const already =
        names.indexOf(user) !== -1 ||
        viewState.mine ||
        Boolean(local && local.mine);
      openReblog.already = already;
      openReblog.own = own;
      setReblogConfirmCaption(own, already);
      setReblogConfirmAction(already);
      syncReblogButtons(author, permlink, viewState);
      if (already) {
        setReblogConfirmStatus("This post is on your blog.", false);
        setReblogConfirmReady(true);
      } else {
        setReblogConfirmStatus("", false);
        setReblogConfirmReady(true);
      }
      placeReblogConfirm(btn, openReblog.panel);
    } catch {
      if (!openReblog || openReblog.gen !== gen) return;
      setReblogConfirmStatus("Could not check reblogs.", true);
      setReblogConfirmReady(true);
      placeReblogConfirm(btn, openReblog.panel);
    }
  }

  function onReblogList(listBtn) {
    const wrap = (openReblog && openReblog.wrap) || (listBtn && listBtn.closest(".reblog-wrap"));
    const btn = (openReblog && openReblog.btn) || (wrap && wrap.querySelector(".reblog-btn"));
    hideReblogConfirm();
    if (btn && btn.isConnected) showReblogUsers(btn, true);
  }

  function onReblogConfirm(confirmBtn) {
    const author =
      (openReblog && openReblog.author) ||
      confirmBtn.getAttribute("data-reblog-author");
    const permlink =
      (openReblog && openReblog.permlink) ||
      confirmBtn.getAttribute("data-reblog-permlink");
    if (!author || !permlink) return;
    const user = observer();
    if (!user) {
      openLogin();
      return;
    }
    if (!hasSigner(user)) {
      showError(signerNeededMessage());
      return;
    }
    queueReblog(author, permlink, Boolean(openReblog && openReblog.already));
  }

  function showVotePanel(btn, mode) {
    const dockWhenHidden = feedKeyDockSlider;
    feedKeyDockSlider = false;
    hideReblogConfirm();
    hideVoteVoters();
    hideVoteSlider();
    const wrap = btn.closest(".vote-wrap");
    const panel =
      wrap &&
      wrap.querySelector(mode === "down" ? ".downvote-slider-panel" : ".vote-slider-panel");
    if (!wrap || !panel) return;
    const slider = panel.querySelector(".vote-slider");
    const valueEl = panel.querySelector(".vote-weight-value");
    const pct =
      mode === "down"
        ? readStoredDownvoteWeight(voteKindFromEl(wrap))
        : upvoteStartPercent(voteKindFromEl(wrap));
    if (slider) {
      slider.value = String(pct);
      paintVoteSlider(slider, valueEl);
    }
    wrap.classList.add("is-open");
    if (mode === "up") {
      releaseVoteColor(btn);
      btn.classList.add("is-confirming");
    }
    openSlider = { wrap, btn, panel, mode, dockWhenHidden };
    document.body.appendChild(panel);
    panel.hidden = false;
    placeVoteSlider(btn, panel);
    focusVoteSlider(panel);
  }

  function focusVoteSlider(panel) {
    const slider = panel && panel.querySelector(".vote-slider");
    if (!slider) return;
    try {
      slider.focus({ preventScroll: true, focusVisible: false });
    } catch {
      slider.focus();
    }
  }

  function castVoteFromSliderKey(e) {
    if (e.repeat || e.isComposing) return;
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const slider = e.target && e.target.closest && e.target.closest(".vote-slider");
    if (!slider || !openSlider || openSlider.panel.hidden || !openSlider.panel.contains(slider)) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (openSlider.mode === "down") {
      const confirmBtn = openSlider.panel.querySelector(".downvote-confirm");
      if (confirmBtn) onDownvoteConfirm(confirmBtn);
      return;
    }
    if (openSlider.btn) onVoteClick(openSlider.btn);
  }

  function showVoteSlider(btn) {
    showVotePanel(btn, "up");
  }

  function showDownvoteSlider(btn) {
    showVotePanel(btn, "down");
  }

  function currentVotePercent(btn) {
    const panel = sliderPanelFor(btn);
    if (panel && !panel.hidden) {
      const slider = panel.querySelector(".vote-slider");
      if (slider) return Math.max(0, Math.min(100, Number(slider.value) || 0));
    }
    return upvoteStartPercent(voteKindFromEl(btn));
  }

  function currentDownvotePercent(el) {
    let panel = null;
    if (openSlider && openSlider.mode === "down" && !openSlider.panel.hidden) {
      panel = openSlider.panel;
    } else if (el) {
      const wrap = el.closest(".vote-wrap");
      panel = wrap && wrap.querySelector(".downvote-slider-panel");
    }
    if (panel && !panel.hidden) {
      const slider = panel.querySelector(".vote-slider");
      if (slider) return Math.max(0, Math.min(100, Number(slider.value) || 0));
    }
    return readStoredDownvoteWeight(voteKindFromEl(el));
  }

  function renderQueueStatus(size) {
    if (!queueSlot) return;
    const n = typeof size === "number" ? size : ChainQueue.size();
    if (!n) {
      queueSlot.hidden = true;
      queueSlot.innerHTML = "";
      return;
    }
    queueSlot.hidden = false;
    queueSlot.innerHTML = `<span class="queue-pill"><span class="dot"></span>${n} queued</span>`;
  }

  const voteRefreshGen = new Map();

  function waitMs(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function cachedVoteList(author, permlink) {
    const hit = votesCache.get(postKey(author, permlink));
    return hit && Array.isArray(hit.votes) ? hit.votes : [];
  }

  function repaintOpenVoters(author, permlink) {
    if (!openVoters || openVoters.author !== author || openVoters.permlink !== permlink) return;
    const panel = votersPanelNode;
    if (!panel || panel.hidden) return;
    renderVoteVoters(panel, cachedVoteList(author, permlink), openVoters.dir, author, permlink);
    if (openVoters.el && openVoters.el.isConnected) placeVoteVoters(openVoters.el, panel);
  }

  function payoutNodesFor(author, permlink) {
    return Array.from(document.querySelectorAll(".payout")).filter(
      (el) =>
        el.getAttribute("data-payout-author") === author &&
        el.getAttribute("data-payout-permlink") === permlink
    );
  }

  function eachContentNode(author, permlink, fn) {
    const items = feedState.items || [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item && item.author === author && item.permlink === permlink) fn(item);
    }
    const walk = (node) => {
      if (!node) return;
      if (node.author === author && node.permlink === permlink) fn(node);
      const replies = node._replies || [];
      for (let i = 0; i < replies.length; i++) walk(replies[i]);
    };
    walk(currentPost);
  }

  function findContentNode(author, permlink) {
    let found = null;
    eachContentNode(author, permlink, (node) => {
      if (!found) found = node;
    });
    return found;
  }

  function payoutIsMutable(node) {
    if (!node) return true;
    if (node.is_paidout) return false;
    const cashout = String(node.cashout_time || "");
    if (cashout.indexOf("1969") === 0) return false;
    if (node.max_accepted_payout != null && node.max_accepted_payout !== "") {
      const max = parsePayoutAmount(node.max_accepted_payout);
      if (Number.isFinite(max) && max <= 0) return false;
    }
    return true;
  }

  function setDisplayedPayout(author, permlink, amount, netRshares) {
    const n = Number(amount);
    if (!Number.isFinite(n)) return;
    const net = Number(netRshares);
    const write = (node) => {
      if (!node) return;
      node.payout = n;
      if (!node.is_paidout) node.pending_payout_value = n.toFixed(3) + " HBD";
      if (Number.isFinite(net)) node.net_rshares = net;
    };
    eachContentNode(author, permlink, write);
    const items = feedState.items || [];
    for (let i = 0; i < items.length; i++) {
      const entry = items[i] && items[i].original_entry;
      if (entry && entry.author === author && entry.permlink === permlink) write(entry);
    }
    payoutByKey.set(postKey(author, permlink), {
      payout: n,
      netRshares: Number.isFinite(net) ? net : 0,
    });
    const post = payoutPostFor(author, permlink) || { author, permlink, payout: n };
    payoutNodesFor(author, permlink).forEach((el) => applyPayoutEl(el, post));
    if (openPayout && openPayout.author === author && openPayout.permlink === permlink && openPayout.el) {
      showPayoutPanel(openPayout.el);
    }
    repaintOpenVoters(author, permlink);
  }

  function shownVoteState(author, permlink) {
    const roots = voteRootsFor(author, permlink);
    let up = null;
    let down = null;
    let sign = null;
    for (let i = 0; i < roots.length; i++) {
      const root = roots[i];
      if (up == null) {
        const upN = root.querySelector(".vote-n");
        if (upN) up = Number(upN.textContent) || 0;
      }
      if (down == null) {
        const downN = root.querySelector(".downvote-n");
        if (downN) down = Number(downN.textContent) || 0;
      }
      if (sign == null) {
        const upBtn = root.querySelector(".vote-btn");
        const downBtn = root.querySelector(".downvote-btn");
        if (upBtn || downBtn) {
          sign =
            upBtn && upBtn.classList.contains("is-voted")
              ? 1
              : downBtn && downBtn.classList.contains("is-voted")
                ? -1
                : 0;
        }
      }
    }
    return {
      up: up == null ? 0 : up,
      down: down == null ? 0 : down,
      sign: sign == null ? 0 : sign,
    };
  }

  function snapshotVoteBasis(author, permlink, user) {
    const node = findContentNode(author, permlink);
    let payout = node ? payoutAmount(node) : NaN;
    if (!Number.isFinite(payout)) {
      const el = payoutNodesFor(author, permlink)[0];
      payout = el ? parsePayoutAmount(el.textContent) : 0;
    }
    if (!Number.isFinite(payout)) payout = 0;
    const cached = cachedVoteList(author, permlink);
    const votes = cached.length ? cached : (node && node.active_votes) || [];
    const mine = findUserVote(votes, user);
    const net = Number(node && node.net_rshares);
    return {
      payout,
      rshares: mine ? voteRshares(mine) : 0,
      netRshares: Number.isFinite(net) ? net : 0,
      maxPayout: node && node.max_accepted_payout,
      mutable: payoutIsMutable(node),
    };
  }

  function loadVoteBasis(username) {
    return Promise.all([
      HiveApi.getAccounts([username]),
      HiveApi.getDynamicGlobalProperties(),
      HiveApi.getRewardFund(),
      HiveApi.getMedianHistoryPrice(),
    ]).then((rows) => ({
      account: rows[0] && rows[0][0],
      props: rows[1],
      fund: rows[2],
      price: rows[3],
    }));
  }

  function payoutAfterRshares(before, newRshares, fund, price) {
    const oldR = before && before.rshares ? before.rshares : 0;
    const base = before && Number.isFinite(before.payout) ? before.payout : 0;
    let next = base + HiveApi.rsharesToHbd(newRshares - oldR, fund, price);
    if (!Number.isFinite(next) || next < 0) next = 0;
    const max = parsePayoutAmount(before && before.maxPayout);
    if (Number.isFinite(max) && max > 0 && next > max) next = max;
    return next;
  }

  function applyEstimatedPayout(author, permlink, weight, before, basis) {
    if (!basis || !basis.fund || !basis.price) return null;
    let est = 0;
    if (weight) {
      if (!basis.account || !basis.props) return null;
      est = HiveApi.estimateVoteRshares(basis.account, basis.props, weight);
    }
    if (before && before.mutable !== false) {
      const next = payoutAfterRshares(before, est, basis.fund, basis.price);
      const net = (before && before.netRshares ? before.netRshares : 0) + (est - (before.rshares || 0));
      setDisplayedPayout(author, permlink, next, net);
    }
    return est;
  }

  function chainPayoutAmount(content) {
    if (!content || typeof content !== "object") return NaN;
    const cashout = String(content.cashout_time || "");
    if (cashout.indexOf("1969") === 0) {
      const total = parsePayoutAmount(content.total_payout_value);
      const curator = parsePayoutAmount(content.curator_payout_value);
      return (Number.isFinite(total) ? total : 0) + (Number.isFinite(curator) ? curator : 0);
    }
    const pending = parsePayoutAmount(content.pending_payout_value);
    return Number.isFinite(pending) ? pending : NaN;
  }

  function chainVoteReady(content, user, expectSign, before, weight) {
    const list = content && content.active_votes;
    const mine = findUserVote(list, user);
    const sign = mine ? votePolarity(mine) : 0;
    if (sign !== expectSign) return false;
    if (expectSign !== 0 && voteRshares(mine) === 0) return false;
    if (before && weight && before.rshares && mine && voteRshares(mine) === before.rshares) {
      return false;
    }
    return true;
  }

  function refreshVoteValue(author, permlink, expectSign, before, weight, basis) {
    const key = postKey(author, permlink);
    const user = observer();
    if (!user) return;
    const gen = (voteRefreshGen.get(key) || 0) + 1;
    voteRefreshGen.set(key, gen);
    const run = async () => {
      for (let attempt = 0; attempt < 8; attempt++) {
        if (voteRefreshGen.get(key) !== gen) return;
        if (attempt) await waitMs(3000);
        if (voteRefreshGen.get(key) !== gen) return;
        const local = localVotes.get(key);
        if (!local || local.sign !== expectSign) return;
        let content = null;
        try {
          content = await HiveApi.getContent(author, permlink);
        } catch (err) {
          continue;
        }
        if (voteRefreshGen.get(key) !== gen) return;
        if (!content || !content.author) continue;
        if (!chainVoteReady(content, user, expectSign, before, weight)) {
          if (attempt < 7) continue;
          return;
        }
        const list = Array.isArray(content.active_votes) ? content.active_votes : [];
        const mine = findUserVote(list, user);
        votesCache.set(key, { votes: list });
        const chainAmount = chainPayoutAmount(content);
        const chainMoved =
          before && Number.isFinite(chainAmount) && Math.abs(chainAmount - before.payout) >= 0.005;
        if (before && before.mutable !== false && chainMoved) {
          setDisplayedPayout(author, permlink, chainAmount, Number(content.net_rshares));
        } else if (before && before.mutable !== false && basis && basis.fund && basis.price) {
          const mineRshares = mine ? voteRshares(mine) : 0;
          const adjusted = payoutAfterRshares(before, mineRshares, basis.fund, basis.price);
          const net =
            (before && before.netRshares ? before.netRshares : 0) +
            (mineRshares - (before && before.rshares ? before.rshares : 0));
          setDisplayedPayout(author, permlink, adjusted, net);
        }
        eachContentNode(author, permlink, (node) => {
          node.active_votes = list;
          node.stats = Object.assign({}, node.stats || {}, { total_votes: list.length });
          if (content.total_payout_value != null) node.total_payout_value = content.total_payout_value;
          if (content.curator_payout_value != null) node.curator_payout_value = content.curator_payout_value;
        });
        const still = localVotes.get(key);
        if (!still || still.sign !== expectSign || voteRefreshGen.get(key) !== gen) return;
        const postLike = {
          author,
          permlink,
          active_votes: list,
          stats: { total_votes: list.length },
        };
        const next = {
          sign: expectSign,
          pending: false,
          upCount: upvoteCountOf(postLike),
          downCount: downvoteCountOf(postLike),
          rshares: mine ? voteRshares(mine) : 0,
        };
        localVotes.set(key, next);
        syncVoteButtons(author, permlink, next);
        repaintOpenVoters(author, permlink);
        if (!chainMoved && attempt < 7) continue;
        return;
      }
    };
    run();
  }

  function queueVote(author, permlink, percent) {
    const user = observer();
    if (!user) return;
    const key = postKey(author, permlink);
    const queuedGen = (voteRefreshGen.get(key) || 0) + 1;
    voteRefreshGen.set(key, queuedGen);
    const shown = shownVoteState(author, permlink);
    const currentUp = shown.up;
    const currentDown = shown.down;
    const currentSign = shown.sign;
    const nextSign = percent > 0 ? 1 : percent < 0 ? -1 : 0;
    let nextUp = currentUp;
    let nextDown = currentDown;
    if (currentSign !== nextSign) {
      if (currentSign === 1) nextUp -= 1;
      else if (currentSign === -1) nextDown -= 1;
      if (nextSign === 1) nextUp += 1;
      else if (nextSign === -1) nextDown += 1;
    }
    nextUp = Math.max(0, nextUp);
    nextDown = Math.max(0, nextDown);
    const previous = localVotes.get(key);
    const before = snapshotVoteBasis(author, permlink, user);
    const pendingState = {
      sign: nextSign,
      pending: true,
      upCount: nextUp,
      downCount: nextDown,
      rshares: null,
    };
    localVotes.set(key, pendingState);
    syncVoteButtons(author, permlink, pendingState);
    repaintOpenVoters(author, permlink);

    const weight = Math.round(Math.max(-100, Math.min(100, Number(percent) || 0)) * 100);
    const basisPromise = loadVoteBasis(user);
    const { promise } = ChainQueue.vote({
      voter: user,
      author,
      permlink,
      weight,
    });
    promise
      .then(async () => {
        if (voteRefreshGen.get(key) !== queuedGen) return;
        let basis = null;
        try {
          basis = await basisPromise;
        } catch (err) {
          basis = null;
        }
        if (voteRefreshGen.get(key) !== queuedGen) return;
        const est = applyEstimatedPayout(author, permlink, weight, before, basis);
        const done = {
          sign: nextSign,
          pending: false,
          upCount: nextUp,
          downCount: nextDown,
          rshares: est == null ? null : est,
        };
        localVotes.set(key, done);
        syncVoteButtons(author, permlink, done);
        repaintOpenVoters(author, permlink);
        refreshVoteValue(author, permlink, nextSign, before, weight, basis);
      })
      .catch((err) => {
        if (voteRefreshGen.get(key) !== queuedGen) {
          showError(err.message || String(err));
          return;
        }
        voteRefreshGen.set(key, queuedGen + 1);
        if (previous) {
          localVotes.set(key, {
            sign: previous.sign,
            pending: false,
            upCount: previous.upCount != null ? previous.upCount : currentUp,
            downCount: previous.downCount != null ? previous.downCount : currentDown,
            rshares: previous.rshares == null ? null : previous.rshares,
          });
        } else {
          localVotes.delete(key);
        }
        const restored = localVotes.get(key);
        syncVoteButtons(author, permlink, restored || {
          sign: currentSign,
          pending: false,
          upCount: currentUp,
          downCount: currentDown,
        });
        if (before && Number.isFinite(before.payout)) {
          setDisplayedPayout(author, permlink, before.payout, before.netRshares);
        }
        repaintOpenVoters(author, permlink);
        showError(err.message || String(err));
      });
  }

  async function ensureVoteReady(btn) {
    const user = observer();
    if (!user) return false;
    if (btn.classList.contains("is-pending") || btn.disabled) return false;
    if (!hasSigner(user)) {
      showError(signerNeededMessage());
      return false;
    }
    if (!btn.isConnected) return false;
    if (btn.classList.contains("is-pending") || btn.disabled) return false;
    return true;
  }

  let voteClickBusy = false;

  async function onVoteClick(btn) {
    if (!btn || voteClickBusy) return;
    if (!observer()) {
      openLogin();
      return;
    }
    const author = btn.getAttribute("data-vote-author");
    const permlink = btn.getAttribute("data-vote-permlink");
    if (!author || !permlink) return;
    voteClickBusy = true;
    try {
      if (!(await ensureVoteReady(btn))) return;
      if (!btn.isConnected) return;

      if (btn.classList.contains("is-voted")) {
        hideVoteSlider();
        queueVote(author, permlink, 0);
        return;
      }
      const panel = sliderPanelFor(btn);
      const open = Boolean(panel && !panel.hidden);
      if (!open) {
        showVoteSlider(btn);
        return;
      }
      const percent = storeWeight(currentVotePercent(btn), voteKindFromEl(btn));
      hideVoteSlider();
      queueVote(author, permlink, percent);
    } finally {
      voteClickBusy = false;
      feedKeyDockSlider = false;
    }
  }

  function onVoteCountClick(btn) {
    const panel = votersPanelNode;
    if (openVoters && openVoters.el === btn && panel && !panel.hidden) {
      hideVoteVoters();
      return;
    }
    showVoteVoters(btn, true);
  }

  async function onDownvoteClick(btn) {
    const user = observer();
    if (!user) {
      openLogin();
      return;
    }
    const author = btn.getAttribute("data-vote-author");
    const permlink = btn.getAttribute("data-vote-permlink");
    if (!author || !permlink) return;
    if (btn.classList.contains("is-pending") || btn.disabled) return;

    if (btn.classList.contains("is-voted")) {
      if (!(await ensureVoteReady(btn))) return;
      hideVoteSlider();
      queueVote(author, permlink, 0);
      return;
    }

    const panel = sliderPanelFor(btn);
    const open = Boolean(panel && !panel.hidden);
    if (open) {
      hideVoteSlider();
      return;
    }
    showDownvoteSlider(btn);
  }

  async function onDownvoteConfirm(confirmBtn) {
    const author = confirmBtn.getAttribute("data-vote-author");
    const permlink = confirmBtn.getAttribute("data-vote-permlink");
    if (!author || !permlink) return;
    const wrap =
      (openSlider && openSlider.wrap) ||
      confirmBtn.closest(".vote-wrap") ||
      voteWrapsFor(author, permlink)[0];
    const downBtn = wrap && wrap.querySelector(".downvote-btn");
    const readyBtn = downBtn || confirmBtn;
    if (!(await ensureVoteReady(readyBtn))) return;
    const percent = storeDownvoteWeight(
      currentDownvotePercent(downBtn || confirmBtn),
      voteKindFromEl(confirmBtn)
    );
    hideVoteSlider();
    queueVote(author, permlink, -percent);
  }

  function mutedKey(author, permlink) {
    return snapKey(author, permlink);
  }

  function isLowReputation(rep) {
    return Math.floor(HiveMd.displayReputation(rep)) < CS77_FILTER_LOW_REP;
  }

  function isModerated(node) {
    const stats = node && node.stats;
    return CS77_ENABLE_CONTENT_MODERATION && Boolean(stats && (stats.gray || stats.hide));
  }

  function isMutedRevealed(author, permlink) {
    return revealedMuted.has(mutedKey(author, permlink));
  }

  function markMutedRevealed(author, permlink) {
    revealedMuted.add(mutedKey(author, permlink));
  }

  function isMutedHidden(node) {
    if (!CS77_ENABLE_CONTENT_MODERATION) return false;
    if (!node || !node.author) return false;
    if (isOwnAuthor(node.author)) return false;
    if (isMutedRevealed(node.author, node.permlink)) return false;
    return isLowReputation(node.author_reputation) || isModerated(node);
  }

  function mutedNoticeHtml(kind, node) {
    const label = kind === "comment" ? "show comment" : "show post";
    const reason = isLowReputation(node && node.author_reputation)
      ? "content hidden due to low reputation"
      : "content hidden due to moderation";
    return `<p class="muted-notice"><span>${reason}</span><span class="show-muted">${label}</span></p>`;
  }

  function revealMuted(btn) {
    const card = btn.closest("article.post-card");
    if (card) {
      const author = card.getAttribute("data-author");
      const permlink = card.getAttribute("data-permlink");
      if (!author || !permlink) return;
      markMutedRevealed(author, permlink);
      const post = findLoadedPost(author, permlink) || findContentNode(author, permlink);
      if (!post) return;
      replaceFeedCard(card, post);
      return;
    }
    const comment = btn.closest("article.comment");
    if (!comment) return;
    const author = comment.getAttribute("data-author");
    const permlink = comment.getAttribute("data-permlink");
    if (!author || !permlink) return;
    markMutedRevealed(author, permlink);
    const node = findContentNode(author, permlink);
    if (!node) return;
    const paint = () => {
      if (!comment.isConnected) return;
      const wrap = document.createElement("div");
      wrap.innerHTML = String(renderComment(node) || "").trim();
      const next = wrap.firstElementChild;
      if (next) comment.replaceWith(next);
      restoreCommentDraft();
    };
    HiveMd.whenMarkdownReady().then(paint, paint);
  }

  function isBlacklistedUser(name) {
    return CS77_ENABLE_CONTENT_MODERATION && typeof Cs77Blacklist !== "undefined" && Cs77Blacklist.user(name);
  }

  function isBlacklistedPost(post, permlink) {
    if (CS77_ENABLE_CONTENT_MODERATION)
    {
      if (typeof Cs77Blacklist === "undefined") return false;
      if (post && typeof post === "object") {
        return Cs77Blacklist.post(post.author, post.permlink);
      }
      return Cs77Blacklist.post(post, permlink);
    }
    else return false;
  }

  function isRootPost(post) {
    if (!post || typeof post !== "object") return false;
    const parent = post.parent_author;
    if (parent != null && String(parent).length > 0) return false;
    if (typeof post.depth === "number" && post.depth > 0) return false;
    return Boolean(post.author && post.permlink);
  }

  function postPath(post) {
    return appHref(`/@${post.author}/${post.permlink}`);
  }

  function commentCountHtml(count, href) {
    const n = Number(count) || 0;
    return `<a class="comment-n comment-count-link" href="${HiveMd.escapeHtml(href)}">C ${n}</a>`;
  }

  function eventElement(target) {
    if (!target) return null;
    if (target.nodeType === 1) return target;
    return target.parentElement || null;
  }

  function inInteractiveSurface(target) {
    const el = eventElement(target);
    if (!el) return false;
    if (view && view.contains(el)) return true;
    const layer = document.getElementById("postLayer");
    return Boolean(layer && !layer.hidden && layer.contains(el));
  }

  function scrollTargetIntoView(el, behavior) {
    if (!el) return false;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const chosen = behavior || (reduce.matches ? "auto" : "smooth");
    quietSmartHeader();
    const layer = document.getElementById("postLayer");
    if (layer && postLayer.open && layer.contains(el)) {
      const top = Math.max(0, window.scrollY + el.getBoundingClientRect().top - 8);
      if (chosen === "auto") scrollWindowInstant(top);
      else window.scrollTo({ top, left: 0, behavior: chosen });
      return true;
    }
    el.scrollIntoView({ behavior: chosen, block: "start" });
    return true;
  }

  function scrollToComments(behavior) {
    const el = document.getElementById("comments");
    if (!el) return false;
    return scrollTargetIntoView(el, behavior);
  }

  function rootCommentComposerInput() {
    if (!commentsAreShowing()) return null;
    const section = document.getElementById("comments");
    if (!section) return null;
    return section.querySelector(":scope > .comment-composer .composer-input");
  }

  function focusRootCommentComposer() {
    const input = rootCommentComposerInput();
    if (!input) return false;
    input.focus({ preventScroll: true });
    return true;
  }

  function anchorElIsVisible(el) {
    if (!el) return false;
    if (el.closest("[hidden]")) return false;
    const layer = document.getElementById("postLayer");
    if (layer && layer.contains(el) && (layer.hidden || !postLayer.open)) return false;
    return true;
  }

  function scrollToAnchor(hash, behavior) {
    const raw = decodeHashFragment(hash == null ? location.hash : hash);
    if (!raw) return false;
    if (raw === "comments") {
      const el = document.getElementById("comments");
      if (!anchorElIsVisible(el)) return false;
      return scrollToComments(behavior);
    }
    const el = findCommentAnchorEl(hash == null ? location.hash : hash);
    if (!anchorElIsVisible(el)) return false;
    return scrollTargetIntoView(el, behavior);
  }

  function tagsOf(post) {
    const meta = HiveMd.parseJsonMetadata(post.json_metadata);
    let tags = meta.tags;
    if (typeof tags === "string") tags = tags.split(/[\s,]+/);
    if (!Array.isArray(tags)) tags = [];
    const cat = post.category || post.community;
    if (cat && !tags.includes(cat)) tags = [cat, ...tags];
    return tags
      .map((t) => String(t).replace(/^#/, "").trim())
      .filter((t, i, arr) => t && arr.indexOf(t) === i)
      .slice(0, 10);
  }

  function metadataTags(post) {
    const meta = HiveMd.parseJsonMetadata(post && post.json_metadata);
    let tags = meta.tags;
    if (typeof tags === "string") tags = tags.split(/[\s,]+/);
    if (!Array.isArray(tags)) tags = [];
    return tags
      .map((t) => String(t).replace(/^#/, "").trim().toLowerCase())
      .filter((t, i, arr) => t && arr.indexOf(t) === i)
      .slice(0, MAX_TAGS);
  }

  function tagsForEdit(post) {
    const tags = metadataTags(post);
    const parent = String((post && (post.parent_permlink || post.category)) || "")
      .replace(/^#/, "")
      .trim()
      .toLowerCase();
    if (parent && tags.indexOf(parent) === -1) tags.unshift(parent);
    return tags.slice(0, MAX_TAGS);
  }

  function mergeJsonMetadata(prevRaw, body, tags) {
    const prev = HiveMd.parseJsonMetadata(prevRaw);
    const images = imagesFromMarkdown(body);
    const next = Object.assign({}, prev, {
      app: APP_ID + "/" + APP_VERSION,
      format: prev.format || "markdown",
      tags,
    });
    if (images.length) next.image = images;
    return next;
  }

  function applyDescriptionMetadata(jsonMetadata, description) {
    if (!jsonMetadata) return;
    if (description) jsonMetadata.description = description;
    else delete jsonMetadata.description;
  }

  /* ─── Router ─── */
  const HASH_ROUTING = Boolean(window.__CS77_HASH__);
  const APP_ROUTE_HEADS = {
    feed: true,
    created: true,
    latest: true,
    space: true,
    trending: true,
    hot: true,
    spaces: true,
    subspaces: true,
    publish: true,
    welcome: true,
    about: true,
    imprint: true,
    settings: true,
    c: true,
  };

  function appHref(path) {
    let p = path || "/";
    if (p.startsWith("#")) {
      const h = p.slice(1);
      p = h ? (h.startsWith("/") ? h : "/" + h) : "/";
    }
    if (!p.startsWith("/")) p = "/" + p;
    p = p.split("#")[0].split("?")[0] || "/";
    return HASH_ROUTING ? "#" + p : p;
  }

  function currentPath() {
    if (HASH_ROUTING || /^#\//.test(location.hash || "")) {
      const raw = (location.hash || "#/").replace(/^#/, "") || "/";
      try {
        return decodeURIComponent(raw.startsWith("/") ? raw : "/" + raw);
      } catch {
        return raw.startsWith("/") ? raw : "/" + raw;
      }
    }
    let path = location.pathname || "/";
    try {
      path = decodeURIComponent(path);
    } catch {
      /* keep raw */
    }
    return path;
  }

  function hrefToPath(href) {
    if (!href) return "/";
    if (href.startsWith("#")) {
      const h = href.slice(1);
      return h ? (h.startsWith("/") ? h : "/" + h) : "/";
    }
    if (href.startsWith("/") && !href.startsWith("//")) {
      return href.split("#")[0].split("?")[0] || "/";
    }
    try {
      const u = new URL(href, location.href);
      if (u.hash && /^#\//.test(u.hash)) {
        const h = u.hash.slice(1);
        return h.startsWith("/") ? h : "/" + h;
      }
      if (HASH_ROUTING) return "/";
      return u.pathname || "/";
    } catch {
      return "/";
    }
  }

  function normalizeRouteTag(raw) {
    const tag = String(raw || "")
      .replace(/^#/, "")
      .trim()
      .toLowerCase();
    if (!tag || tag.length > 24) return "";
    if (!/^[a-z0-9][a-z0-9-]*$/.test(tag)) return "";
    return tag;
  }

  function isCommunityName(raw) {
    if (window.HiveApi && typeof HiveApi.isCommunityName === "function") {
      return HiveApi.isCommunityName(raw);
    }
    return /^hive-\d+$/i.test(String(raw || "").trim());
  }

  function normalizeCommunityName(raw) {
    const name = String(raw || "")
      .trim()
      .replace(/^@/, "")
      .replace(/^c\//i, "")
      .toLowerCase();
    return isCommunityName(name) ? name : "";
  }

  function normalizeCommunityPage(raw) {
    const page = String(raw || "")
      .trim()
      .toLowerCase();
    if (!page || page === "created" || page === "latest") return "latest";
    if (page === "trending" || page === "hot") return page;
    if (page === "about") return "about";
    if (page === "members" || page === "roles") return "members";
    if (page === "edit") return "edit";
    return "";
  }

  function communityNumber(name) {
    const n = normalizeCommunityName(name);
    const m = /^hive-(\d+)$/.exec(n);
    return m ? m[1] : "";
  }

  // hive-121566 or the bare community number 121566.
  function communityFromToken(raw) {
    const named = normalizeCommunityName(raw);
    if (named) return named;
    const s = String(raw || "").trim();
    if (!/^\d+$/.test(s)) return "";
    const id = "hive-" + s;
    return isCommunityName(id) ? id : "";
  }

  // Latest is /subspace/121566. Other pages keep a suffix, /subspace/121566/trending.
  function pathForCommunity(name, page) {
    const num = communityNumber(name);
    if (!num) return "/";
    const p = normalizeCommunityPage(page) || "latest";
    if (p === "latest") return "/subspace/" + num;
    return "/subspace/" + num + "/" + p;
  }

  // /c/hive-121566 still opens the community and stays on that path.
  function pathForOldCommunity(name, page) {
    const n = normalizeCommunityName(name);
    if (!n) return "/";
    const p = normalizeCommunityPage(page) || "latest";
    return "/c/" + n + "/" + p;
  }

  function communityHref(name, page) {
    return appHref(pathForCommunity(name, page));
  }

  // /c/hive-<number> keeps its own canonical path. A bare /<number>, /subspace/
  // aliases, and older sort-prefixed community URLs are replaced with /subspace/<number>.
  function communityRedirectTarget(pathname, route) {
    const parts = String(pathname || "/")
      .split("/")
      .filter(Boolean);
    if (parts[0] === "index.html") parts.shift();
    const here = parts.length ? "/" + parts.join("/") : "/";
    const first = (parts[0] || "").toLowerCase();
    if (first === "c") {
      const oldPath = pathForOldCommunity(route.community, route.page);
      return here === oldPath ? "" : oldPath;
    }
    const canonical = pathForCommunity(route.community, route.page);
    return here === canonical ? "" : canonical;
  }

  function normalizeProfilePage(raw) {
    const page = String(raw || "")
      .trim()
      .toLowerCase();
    if (!page || page === "posts" || page === "blog") return "posts";
    if (page === "comments") return "comments";
    if (page === "replies") return "replies";
    if (page === "wallet") return "wallet";
    return "";
  }

  function pathForProfile(author, page) {
    const a = String(author || "")
      .replace(/^@/, "")
      .toLowerCase();
    if (!a) return "/";
    const p = normalizeProfilePage(page) || "posts";
    if (p === "posts") return "/@" + a;
    return "/@" + a + "/" + p;
  }

  function profileHref(author, page) {
    return appHref(pathForProfile(author, page));
  }

  function normalizeSettingsPage(raw) {
    const page = String(raw || "")
      .trim()
      .toLowerCase();
    if (!page || page === "general") return "general";
    if (page === "profile") return "profile";
    if (page === "keys") return "keys";
    if (page === "nodes") return "nodes";
    return "";
  }

  function pathForSettings(page) {
    const p = normalizeSettingsPage(page) || "general";
    if (p === "profile") return "/settings/profile";
    if (p === "keys") return "/settings/keys";
    if (p === "nodes") return "/settings/nodes";
    return "/settings";
  }

  function normalizeSearchPage(raw) {
    const page = String(raw || "")
      .trim()
      .toLowerCase();
    if (!page || page === "users") return "users";
    if (page === "spaces") return "spaces";
    if (page === "subspaces") return "subspaces";
    return "";
  }

  function pathForSearch(page) {
    const p = normalizeSearchPage(page) || "users";
    if (p === "spaces") return "/search/spaces";
    if (p === "subspaces") return "/search/subspaces";
    return "/search";
  }

  function normalizeSubspacesPage(raw) {
    const page = String(raw || "")
      .trim()
      .toLowerCase();
    if (page === "browse") return "browse";
    if (page === "newest") return "newest";
    if (page === "search") return "search";
    if (page === "create") return "create";
    return "";
  }

  function pathForSubspaces(page) {
    const p = normalizeSubspacesPage(page);
    if (p === "browse") return "/subspaces/browse";
    if (p === "newest") return "/subspaces/newest";
    if (p === "create") return "/subspaces/create";
    return "/subspaces";
  }

  function sessionProfilePath(href) {
    const raw =
      typeof href === "string" ? href : href && href.getAttribute ? href.getAttribute("href") : "";
    const user = observer();
    if (!raw || !user) return "";
    return hrefToPath(raw).replace(/\/+$/, "") || "/";
  }

  function isSessionProfileSubLink(href) {
    const path = sessionProfilePath(href);
    const user = observer();
    if (!path || !user) return false;
    return (
      path === pathForProfile(user, "comments") ||
      path === pathForProfile(user, "replies") ||
      path === pathForProfile(user, "wallet")
    );
  }

  function isSessionProfileLink(href) {
    const path = sessionProfilePath(href);
    const user = observer();
    if (!path || !user) return false;
    return path === pathForProfile(user);
  }

  function isMobileViewport() {
    return window.matchMedia("(max-width: 720px)").matches;
  }

  // "hide" collapses the banner on mobile. "show" removes that collapse.
  // "keep" leaves it, so profile-nav Posts stays collapsed.
  function syncAccountMenuBanner(mode) {
    if (mode === "keep") return;
    if (mode === "hide") {
      if (isMobileViewport()) document.body.classList.add("is-account-sub");
      return;
    }
    document.body.classList.remove("is-account-sub");
  }

  function accountBannerMode(r, fromAccountMenu, fromAccountProfile, fromProfileNav) {
    if (fromAccountProfile) return "show";
    if (fromAccountMenu) return "hide";
    if (fromProfileNav && r && r.name === "profile") return "keep";
    if (r && r.name === "profile" && document.body.classList.contains("is-account-sub")) {
      const author = String(r.author || "")
        .replace(/^@/, "")
        .toLowerCase();
      if (author && author === String(observer() || "").toLowerCase()) return "keep";
    }
    // A post or comment opened from the collapsed profile. Back keeps the banner hidden.
    if (r && r.name === "post" && document.body.classList.contains("is-account-sub")) return "keep";
    return "show";
  }

  // Desktop only, and only when .profile-nav is already painted. A 1rem gap
  // matches the earlier snap. Off-screen means not fully inside the viewport.
  function scrollProfileNavIntoView() {
    const nav =
      (view && view.querySelector(".profile-nav")) ||
      document.querySelector("#view .profile-nav");
    if (!nav) return;
    const rect = nav.getBoundingClientRect();
    if (rect.height <= 0) return;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    if (rect.top > 0 && rect.bottom < vh) return;
    const y = window.scrollY || window.pageYOffset || 0;
    const fs = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const rem = Number.isFinite(fs) && fs > 0 ? fs : 16;
    const target = Math.max(0, y + rect.top - rem);
    if (Math.abs(y - target) <= 0.5) return;
    scrollWindowInstant(target);
  }

  function settleAccountMenuSub() {
    if (isMobileViewport()) {
      scrollWindowInstant(0);
      return;
    }
    if (view && view.querySelector(".profile-nav")) scrollProfileNavIntoView();
    else scrollWindowInstant(0);
  }

  function parseRoute(pathname) {
    let path = pathname == null ? currentPath() : pathname;
    try {
      path = decodeURIComponent(path);
    } catch {
      /* keep raw */
    }
    const parts = path.split("/").filter(Boolean);
    if (parts[0] === "index.html") parts.shift();

    if (parts.length === 0) {
      return { name: "feed", sort: "latest", tag: "" };
    }

    const first = parts[0].toLowerCase();
    if (parts.length === 1 && first === "publish") {
      return { name: "publish" };
    }
    if (parts.length === 1 && first === "spaces") {
      return { name: "tags" };
    }
    if (first === "subspaces") {
      if (parts.length === 1) return { name: "communities", page: "search" };
      if (parts.length === 2) {
        const page = normalizeSubspacesPage(parts[1]);
        if (page) return { name: "communities", page };
      }
      return { name: "notfound" };
    }
    if (parts.length === 1 && first === "welcome") {
      return { name: "welcome" };
    }
    if (parts.length === 1 && first === "about") {
      return { name: "about" };
    }
    if (parts.length === 1 && first === "imprint") {
      return { name: "imprint" };
    }
    if (first === "settings") {
      if (parts.length === 1) return { name: "settings", page: "general" };
      if (parts.length === 2) {
        const page = normalizeSettingsPage(parts[1]);
        if (page) return { name: "settings", page };
      }
      return { name: "notfound" };
    }
    if (first === "search") {
      if (parts.length === 1) return { name: "search", page: "users" };
      if (parts.length === 2) {
        const page = normalizeSearchPage(parts[1]);
        if (page) return { name: "search", page };
      }
      return { name: "notfound" };
    }

    if (first === "c" && parts.length >= 2) {
      const community = normalizeCommunityName(parts[1]);
      if (!community) return { name: "notfound" };
      if (parts.length === 2) {
        return { name: "community", community, page: "latest" };
      }
      if (parts.length === 3) {
        const page = normalizeCommunityPage(parts[2]);
        if (page) return { name: "community", community, page };
      }
      return { name: "notfound" };
    }

    if (first === "subspace") {
      if (parts.length < 2 || parts.length > 3) return { name: "notfound" };
      const community = communityFromToken(parts[1]);
      if (!community) return { name: "notfound" };
      if (parts.length === 2) {
        return { name: "community", community, page: "latest" };
      }
      const page = normalizeCommunityPage(parts[2]);
      if (page) return { name: "community", community, page };
      return { name: "notfound" };
    }

    let sort = "";
    if (first === "created" || first === "latest") sort = "latest";
    // /space/<tag> is the neutral tag URL. Same latest feed as /latest/<tag> and /created/<tag>.
    else if (first === "space" && parts.length >= 2) sort = "latest";
    else if (first === "feed") sort = "feed";
    else if (first === "trending" || first === "hot") sort = first;

    if (sort) {
      if (parts.length === 1) {
        return { name: "feed", sort, tag: "" };
      }
      if (parts.length === 2 && sort !== "feed") {
        const tag = normalizeRouteTag(parts[1]);
        if (tag) {
          const community = normalizeCommunityName(tag);
          if (community) return { name: "community", community, page: sort };
          return { name: "feed", sort, tag };
        }
      }
      return { name: "notfound" };
    }

    // /121566 is the community page and is redirected to /subspace/121566.
    if (/^\d+$/.test(first) && parts.length <= 2) {
      const community = communityFromToken(first);
      const page = parts.length === 1 ? "latest" : normalizeCommunityPage(parts[1]);
      if (community && page) return { name: "community", community, page };
    }

    const at = parts.findIndex((p) => p.startsWith("@"));
    if (at >= 0) {
      const author = parts[at].slice(1).toLowerCase();
      if (!/^[a-z0-9.\-]{3,16}$/.test(author)) {
        return { name: "notfound" };
      }
      if (at === 0 && parts.length <= 2) {
        if (parts.length === 1) return { name: "profile", author, page: "posts" };
        const rawPage = String(parts[1] || "").trim().toLowerCase();
        if (rawPage === "followers" || rawPage === "following") return { name: "notfound" };
        const page = normalizeProfilePage(parts[1]);
        if (page) return { name: "profile", author, page };
      }
      const permlink = parts[at + 1];
      if (permlink) return { name: "post", author, permlink };
      return { name: "profile", author, page: "posts" };
    }

    return { name: "notfound" };
  }

  function routeKey(r) {
    if (!r) return "";
    if (r.name === "feed") {
      return r.tag ? "feed:" + r.sort + ":" + r.tag : "feed:" + r.sort;
    }
    if (r.name === "post") return "post:" + r.author + "/" + r.permlink;
    if (r.name === "profile") return "profile:" + r.author + ":" + (r.page || "posts");
    if (r.name === "community") return "community:" + r.community + ":" + r.page;
    if (r.name === "settings") return "settings:" + (r.page || "general");
    if (r.name === "search") return "search:" + (r.page || "users");
    if (r.name === "communities") {
      const page =
        r.page === "browse" || r.page === "newest" || r.page === "create" ? r.page : "search";
      return "communities:" + page;
    }
    return r.name || "";
  }

  function pathFromViewKey(key) {
    if (!key || key === "notfound") return "/";
    if (key === "welcome") return "/welcome";
    if (key === "about") return "/about";
    if (key === "imprint") return "/imprint";
    if (key === "settings" || key.indexOf("settings:") === 0) {
      return pathForSettings(key.indexOf("settings:") === 0 ? key.slice(9) : "general");
    }
    if (key === "search" || key.indexOf("search:") === 0) {
      return pathForSearch(key.indexOf("search:") === 0 ? key.slice(7) : "users");
    }
    if (key === "tags") return "/spaces";
    if (key === "communities" || key.indexOf("communities:") === 0) {
      const page = key.indexOf("communities:") === 0 ? key.slice(12) : "search";
      return pathForSubspaces(page);
    }
    if (key.indexOf("feed:") === 0) {
      const rest = key.slice(5);
      const colon = rest.indexOf(":");
      if (colon >= 0) return pathForFeedSort(rest.slice(0, colon), rest.slice(colon + 1));
      return pathForFeedSort(rest);
    }
    if (key.indexOf("post:") === 0) return "/@" + key.slice(5);
    if (key.indexOf("profile:") === 0) {
      const rest = key.slice(8);
      const colon = rest.lastIndexOf(":");
      if (colon >= 0) return pathForProfile(rest.slice(0, colon), rest.slice(colon + 1));
      return pathForProfile(rest);
    }
    if (key.indexOf("community:") === 0) {
      const rest = key.slice(11);
      const colon = rest.lastIndexOf(":");
      if (colon >= 0) return pathForCommunity(rest.slice(0, colon), rest.slice(colon + 1));
      return pathForCommunity(rest);
    }
    return "/";
  }

  function isHomePath(pathname) {
    let path = pathname == null ? currentPath() : pathname;
    try {
      path = decodeURIComponent(path);
    } catch {
      /* keep raw */
    }
    const parts = path.split("/").filter(Boolean);
    if (parts[0] === "index.html") parts.shift();
    return parts.length === 0;
  }

  function pathForFeedSort(sort, tag) {
    const t = normalizeRouteTag(tag);
    if (t) {
      if (sort === "trending") return "/trending/" + t;
      if (sort === "hot") return "/hot/" + t;
      return "/space/" + t;
    }
    if (sort === "feed") return "/feed";
    if (sort === "trending") return "/trending";
    if (sort === "hot") return "/hot";
    if (sort === "latest") return observer() ? "/latest" : "/";
    return "/";
  }

  function tagFeedHref(tag, sort) {
    const t = normalizeRouteTag(tag);
    if (!t) return appHref("/");
    const s = sort === "hot" || sort === "trending" ? sort : "latest";
    if (isCommunityName(t)) return communityHref(t, s);
    return appHref(pathForFeedSort(s, t));
  }

  function tagChipHtml(tag) {
    const t = normalizeRouteTag(tag) || String(tag || "").replace(/^#/, "").trim().toLowerCase();
    if (!t) return "";
    const href = isCommunityName(t) ? communityHref(t, "latest") : appHref("/space/" + t);
    return `<a class="tag" href="${HiveMd.escapeHtml(href)}">#${HiveMd.escapeHtml(t)}</a>`;
  }

  function readStoredFeedView() {
    try {
      const raw = localStorage.getItem(FEED_VIEW_KEY);
      if (FEED_SORTS.indexOf(raw) >= 0) return raw;
    } catch {
      /* private mode */
    }
    return null;
  }

  function storeFeedView(sort) {
    if (!observer() || FEED_SORTS.indexOf(sort) < 0) return;
    try {
      localStorage.setItem(FEED_VIEW_KEY, sort);
    } catch {
      /* ignore quota / private mode */
    }
  }

  function readFavoriteTags() {
    try {
      const raw = localStorage.getItem(FAVORITE_TAGS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((t) => normalizeRouteTag(t) || normalizeTag(t))
        .filter((t, i, arr) => t && arr.indexOf(t) === i)
        .slice(0, MAX_FAVORITE_TAGS);
    } catch {
      return [];
    }
  }

  function storeFavoriteTags(tags) {
    try {
      localStorage.setItem(FAVORITE_TAGS_KEY, JSON.stringify(tags));
    } catch {
      /* ignore quota / private mode */
    }
  }

  function communityIdFromInput(raw) {
    const s = String(raw || "")
      .trim()
      .replace(/^@/, "")
      .replace(/^c\//i, "");
    if (/^hive-\d+$/i.test(s)) return s.toLowerCase();
    if (/^\d+$/.test(s)) return "hive-" + s;
    return "";
  }

  function favoriteCommunityRecord(row) {
    if (typeof row === "string") {
      const name = normalizeCommunityName(row) || communityIdFromInput(row);
      return name ? { name, title: name } : null;
    }
    if (!row || typeof row !== "object") return null;
    const name = normalizeCommunityName(row.name) || communityIdFromInput(row.name);
    if (!name) return null;
    const title = String(row.title || name).trim() || name;
    return { name, title };
  }

  function readFavoriteCommunities() {
    try {
      const raw = localStorage.getItem(FAVORITE_COMMUNITIES_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      const out = [];
      const seen = new Set();
      parsed.forEach((row) => {
        const rec = favoriteCommunityRecord(row);
        if (!rec || seen.has(rec.name)) return;
        seen.add(rec.name);
        out.push(rec);
      });
      return out.slice(0, MAX_FAVORITE_COMMUNITIES);
    } catch {
      return [];
    }
  }

  function storeFavoriteCommunities(list) {
    try {
      localStorage.setItem(
        FAVORITE_COMMUNITIES_KEY,
        JSON.stringify(
          list.map((row) => ({
            name: row.name,
            title: row.title || row.name,
          }))
        )
      );
    } catch {
      /* ignore quota / private mode */
    }
  }

  function normalizeUserName(raw) {
    const name = String(raw || "")
      .trim()
      .replace(/^@/, "")
      .toLowerCase();
    if (!/^[a-z0-9.\-]{3,16}$/.test(name)) return "";
    return name;
  }

  function readFavoriteUsers() {
    try {
      const raw = localStorage.getItem(FAVORITE_USERS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((name) => normalizeUserName(name))
        .filter((name, i, arr) => name && arr.indexOf(name) === i)
        .slice(0, MAX_FAVORITE_USERS);
    } catch {
      return [];
    }
  }

  function storeFavoriteUsers(users) {
    try {
      localStorage.setItem(FAVORITE_USERS_KEY, JSON.stringify(users));
    } catch {
      /* ignore quota / private mode */
    }
  }

  function isFavoriteUser(name) {
    const id = normalizeUserName(name);
    if (!id) return false;
    return readFavoriteUsers().indexOf(id) !== -1;
  }

  function isFavoriteCommunity(name) {
    const id = normalizeCommunityName(name);
    if (!id) return false;
    return readFavoriteCommunities().some((c) => c.name === id);
  }

  function defaultFeedSort() {
    if (!observer()) return "latest";
    return readStoredFeedView() || "feed";
  }

  function rememberNonPublishPath() {
    const here = currentPath();
    if (parseRoute(here).name !== "publish") lastNonPublishPath = here || "/";
  }

  function hashFragment(href) {
    if (!href) return "";
    try {
      const u = new URL(href, location.href);
      if (u.hash && !/^#\//.test(u.hash)) return u.hash;
    } catch {
      const i = String(href).indexOf("#");
      if (i >= 0) {
        const h = href.slice(i);
        if (h && !h.startsWith("#/")) return h;
      }
    }
    return "";
  }

  function navigate(href, replace) {
    if (peopleList.open || peopleHistoryOn) {
      const hadHistory = peopleHistoryOn;
      closePeoplePanel({ skipHistory: true });
      peopleHistoryOn = false;
      if (hadHistory && !replace) {
        pendingPeopleNav = { href: href, replace: false };
        history.back();
        return;
      }
    }
    const path = hrefToPath(href);
    hidePayoutPanel();
    if (parseRoute(path).name === "publish") rememberNonPublishPath();
    if (HASH_ROUTING) {
      const next = "#" + (path.startsWith("/") ? path : "/" + path);
      const url = location.pathname + location.search + next;
      if (replace) {
        history.replaceState(null, "", url);
        route();
        return;
      }
      if (location.hash === next) {
        route();
        return;
      }
      location.hash = next.slice(1);
      return;
    }
    const url = appHref(path) + hashFragment(href);
    const nav = replace ? historyNavId() || nextHistoryNav() : nextHistoryNav();
    routePushed = !replace;
    if (replace) history.replaceState({ nav }, "", url);
    else history.pushState({ nav }, "", url);
    publishNavPushed = parseRoute(path).name === "publish" && !replace;
    route();
  }

  function commentsAreShowing() {
    const el = document.getElementById("comments");
    if (!el || el.closest("[hidden]")) return false;
    const layer = document.getElementById("postLayer");
    if (layer && layer.contains(el)) return !layer.hidden;
    return true;
  }

  function commentLinkStaysOnPage(href) {
    if (!href) return false;
    if (href === "#comments") return true;
    try {
      const u = new URL(href, location.href);
      return (
        u.pathname === location.pathname &&
        u.search === location.search &&
        (u.hash === "#comments" || /#comments$/.test(u.hash))
      );
    } catch {
      return false;
    }
  }

  function isInternalHref(href) {
    if (!href) return false;
    if (href.startsWith("#/")) return true;
    if (href.startsWith("#")) return false;
    if (href.startsWith("/") && !href.startsWith("//")) return true;
    try {
      const u = new URL(href, location.href);
      if (location.protocol === "file:") return u.protocol === "file:";
      return u.origin === location.origin;
    } catch {
      return false;
    }
  }

  // pointerdown runs before the FAB takes focus, so this still sees the comment box.
  let publishFabCommentDown = false;
  let publishFabTouchOpen = null;
  let publishFabSuppressClick = false;

  function publishFabPressIgnored(e) {
    return !e || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
  }

  function bindPublishFabCommentGate() {
    const fab = $("#publishFab");
    if (!fab) return;
    fab.addEventListener("pointerdown", (e) => {
      publishFabCommentDown = false;
      publishFabTouchOpen = null;
      if (publishFabPressIgnored(e) || !isMobileViewport()) return;
      const input = rootCommentComposerInput();
      if (!input || document.activeElement !== input) return;
      publishFabCommentDown = true;
      // A touch that dismisses the keyboard often never clicks the FAB.
      // Hold the gesture and open publish on pointerup instead.
      if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
      publishFabTouchOpen = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
      e.preventDefault();
    });
    fab.addEventListener("pointerup", (e) => {
      const start = publishFabTouchOpen;
      publishFabTouchOpen = null;
      if (!start || e.pointerId !== start.pointerId) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (dx * dx + dy * dy > 100) return;
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      if (!hit || (hit !== fab && !fab.contains(hit))) return;
      publishFabSuppressClick = true;
      publishFabCommentDown = false;
      navigate(appHref("/publish"));
      setTimeout(() => {
        publishFabSuppressClick = false;
      }, 0);
    });
    fab.addEventListener("pointercancel", () => {
      publishFabTouchOpen = null;
      publishFabCommentDown = false;
    });
  }

  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }
    const peopleBtn = e.target.closest && e.target.closest("[data-people]");
    if (peopleBtn) {
      e.preventDefault();
      const kind = peopleBtn.getAttribute("data-people") || "";
      const rawId = peopleBtn.getAttribute("data-people-id") || "";
      const id =
        kind === "subscribers"
          ? normalizeCommunityName(rawId)
          : String(rawId).replace(/^@/, "").trim().toLowerCase();
      if (peopleList.open && peopleList.kind === kind && peopleList.id === id) closePeoplePanel();
      else openPeoplePanel(kind, rawId);
      return;
    }
    if (expandClampedCardExcerpt(e)) return;
    const a = e.target.closest("a[href]");
    if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
    const href = a.getAttribute("href");
    if (a.id === "publishFab") {
      if (publishFabSuppressClick) {
        publishFabSuppressClick = false;
        e.preventDefault();
        return;
      }
      const fromComment = publishFabCommentDown;
      publishFabCommentDown = false;
      // On a post, the first mobile press jumps to the new-comment box.
      // A press while that box is focused opens the publish dialog.
      if (!fromComment && isMobileViewport() && rootCommentComposerInput()) {
        e.preventDefault();
        scrollToComments();
        focusRootCommentComposer();
        return;
      }
    } else {
      publishFabCommentDown = false;
    }
    const commentFrag = hashFragment(href);
    if (
      parseCommentFragment(commentFrag) &&
      (isInternalHref(href) || href.startsWith("#"))
    ) {
      e.preventDefault();
      try {
        const u = new URL(href, location.href);
        const samePage =
          !HASH_ROUTING &&
          u.pathname === location.pathname &&
          u.search === location.search;
        if (samePage && commentsAreShowing() && scrollToAnchor(commentFrag)) {
          if (location.hash !== u.hash) {
            history.pushState(history.state, "", u.pathname + u.search + u.hash);
          }
          return;
        }
        if (samePage) {
          if (location.hash !== u.hash) {
            history.pushState(history.state, "", u.pathname + u.search + u.hash);
          }
          const pv = postViewEl();
          settlePostAnchor(
            { anchor: u.hash },
            Boolean(pv && !htmlHasPendingComments(pv.innerHTML))
          );
          return;
        }
        navigate(u.pathname + u.search + u.hash);
      } catch {
        navigate(href);
      }
      return;
    }
    const toComments =
      a.classList.contains("comment-count-link") || href === "#comments" || /#comments$/.test(href);
    // A feed card's comment count points at the post. Only an in-page
    // #comments link should scroll, and only while that section is visible.
    // A previously opened post leaves #comments in the hidden layer.
    if (toComments && commentsAreShowing() && commentLinkStaysOnPage(href)) {
      e.preventDefault();
      pendingCommentsScroll = false;
      scrollToComments();
      if (a.closest(".post-stats-bar")) focusRootCommentComposer();
      return;
    }
    if (toComments) pendingCommentsScroll = true;
    if (!isInternalHref(href)) return;
    if (a.closest("#logoBrand")) {
      const here = parseRoute();
      const returnSteps = Number(history.state && history.state.profileReturnSteps) || 0;
      const returnNav = Number(history.state && history.state.profileReturnNav) || 0;
      // A profile opened from a feed steps back to that feed, same as Back.
      if (
        here.name === "profile" &&
        returnSteps > 0 &&
        returnSteps < history.length &&
        feedParks.has(returnNav)
      ) {
        e.preventDefault();
        history.go(-returnSteps);
        return;
      }
      // A post opened over a feed steps back onto that feed. Navigating to
      // the feed URL would add another entry and leave the saved list behind.
      if (here.name === "post" && liveFeedNav && isRestorableFeedKey(currentViewKey)) {
        const depth = Math.max(
          feedStackDepth,
          Number(history.state && history.state.feedStackDepth) || 0,
          1
        );
        if (depth < history.length) {
          e.preventDefault();
          history.go(-depth);
          return;
        }
      }
      if (logoUsesTopFeed(here)) {
        e.preventDefault();
        if (isOnTopLevelFeed(here)) scrollActiveToTop();
        else navigate(appHref(pathForFeedSort(defaultFeedSort())));
        return;
      }
    }
    if (a.closest("#sessionAccountMenu") && isSessionProfileSubLink(href)) {
      accountMenuSubNav = true;
    } else if (isSessionProfileLink(href) && !a.closest(".profile-nav")) {
      // Account-menu Profile, and any other direct link to one's account while
      // a profile or subpage is already open. Profile-nav tabs stay collapsed.
      const here = parseRoute();
      if (a.closest("#sessionAccountMenu") || (here && here.name === "profile")) {
        accountMenuProfile = true;
      }
    }
    if (HASH_ROUTING) {
      if (href.startsWith("#/") || href === "#") return;
      e.preventDefault();
      profileNavSwitch = Boolean(a.closest(".profile-nav"));
      communityNavSwitch = Boolean(a.closest(".community-nav"));
      navigate(appHref(hrefToPath(href)));
      return;
    }
    try {
      const u = new URL(href, location.href);
      if (u.pathname === location.pathname && u.hash && !/^#\//.test(u.hash)) return;
      if (u.pathname === location.pathname && u.search === location.search && !u.hash) {
        e.preventDefault();
        // A same-path click while the address is still /publish and the
        // composer is closed opens it again.
        if (parseRoute().name === "publish") {
          const pub = $("#publishOverlay");
          if (!pub || pub.hidden) openPublishOverlay();
          return;
        }
        // Already on this profile section. Session name / Profile still
        // go to the top. Comments, Replies, and Wallet use the account-menu
        // subpage behavior.
        if (accountMenuSubNav) {
          syncAccountMenuBanner("hide");
          settleAccountMenuSub();
          accountMenuSubNav = false;
        } else if (accountMenuProfile) {
          syncAccountMenuBanner("show");
          accountMenuProfile = false;
          window.scrollTo(0, 0);
        } else if (
          a.classList.contains("session-name") ||
          a.closest("#sessionAccountMenu")
        ) {
          window.scrollTo(0, 0);
        }
        return;
      }
      e.preventDefault();
      profileNavSwitch = Boolean(a.closest(".profile-nav"));
      communityNavSwitch = Boolean(a.closest(".community-nav"));
      navigate(u.pathname + u.search + u.hash);
    } catch {
      e.preventDefault();
      profileNavSwitch = Boolean(a.closest(".profile-nav"));
      communityNavSwitch = Boolean(a.closest(".community-nav"));
      navigate(href);
    }
  });

  window.addEventListener("popstate", () => {
    if (pendingPeopleNav) {
      const job = pendingPeopleNav;
      pendingPeopleNav = null;
      closePeoplePanel({ skipHistory: true });
      peopleHistoryOn = false;
      navigate(job.href, job.replace);
      return;
    }
    if (peopleHistoryPop) {
      peopleHistoryPop = false;
      return;
    }
    if (history.state && history.state.peoplePanel) {
      if (!peopleList.open) {
        openPeoplePanel(history.state.peopleKind, history.state.peopleId, { fromHistory: true });
      }
      return;
    }
    if (peopleList.open) {
      closePeoplePanel({ skipHistory: true });
      peopleHistoryOn = false;
      return;
    }
    if (!HASH_ROUTING) {
      routeFromPop = true;
      routePushed = false;
      route();
    }
  });
  window.addEventListener("hashchange", () => {
    if (HASH_ROUTING || /^#\//.test(location.hash || "")) {
      route();
      return;
    }
    if (!postLayer.open) return;
    if (location.hash === "#comments") {
      settlePostAnchor({ jumpComments: true }, true);
      if (currentPost) setPostTitle(currentPost);
      return;
    }
    if (parseCommentFragment(location.hash)) {
      const pv = postViewEl();
      settlePostAnchor(
        { anchor: location.hash },
        Boolean(pv && !htmlHasPendingComments(pv.innerHTML))
      );
      if (currentPost) setPostTitle(currentPost);
      return;
    }
    if (currentPost) setPostTitle(currentPost);
  });

  /* ─── Session / login ─── */
  function resetNotifs() {
    notifGen += 1;
    notifState.user = "";
    notifState.unread = 0;
    notifState.lastread = "";
    notifState.items = [];
    notifState.error = "";
    notifState.loaded = false;
    notifState.markedAt = 0;
    notifState.cursor = "";
    notifState.done = false;
    notifState.loadingMore = false;
    notifState.seen = new Set();
  }

  let resourceGen = 0;
  let accountLoad = null;
  // Logged-in hive account state from condenser_api.get_accounts, plus mana and RC, get hive power (hp) by hivePowerFromAccount. check via ownAccountReady if loaded. loaded/refreshed by loadAccountResources.
  const accountState = {
    user: "",
    account: null,
    metadata: null,
    profileImage: "",
    props: null,
    votingMana: null,
    downvoteMana: null,
    voteValue: null,
    rc: null,
    social: null,
    loaded: false,
    loadedAt: 0,
  };

  function resetAccountState() {
    resourceGen += 1;
    accountLoad = null;
    accountState.user = "";
    accountState.account = null;
    accountState.metadata = null;
    accountState.profileImage = "";
    accountState.props = null;
    accountState.votingMana = null;
    accountState.downvoteMana = null;
    accountState.voteValue = null;
    accountState.rc = null;
    accountState.social = null;
    accountState.loaded = false;
    accountState.loadedAt = 0;
  }

  // One record for the signed-in user. Empty image is stored so the next
  // login can show the satoshi fallback immediately.
  function readStoredProfileImage(user) {
    if (!user) return null;
    try {
      const raw = localStorage.getItem(PROFILE_IMAGE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || typeof data !== "object" || Array.isArray(data)) return null;
      if (String(data.user || "") !== user) return null;
      if (!Object.prototype.hasOwnProperty.call(data, "image")) return null;
      return String(data.image || "");
    } catch {
      return null;
    }
  }

  function writeStoredProfileImage(user, image) {
    if (!user) return;
    try {
      localStorage.setItem(
        PROFILE_IMAGE_KEY,
        JSON.stringify({ user: String(user), image: String(image || "") })
      );
    } catch {
      /* ignore quota / private mode */
    }
  }

  function metadataFromAccount(account) {
    const posting = HiveMd.parseJsonMetadata(account && account.posting_json_metadata);
    const legacy = HiveMd.parseJsonMetadata(account && account.json_metadata);
    const postingOk = posting && typeof posting === "object" && !Array.isArray(posting);
    const legacyOk = legacy && typeof legacy === "object" && !Array.isArray(legacy);
    const postingProfile =
      postingOk &&
      posting.profile &&
      typeof posting.profile === "object" &&
      !Array.isArray(posting.profile)
        ? posting.profile
        : null;
    const legacyProfile =
      legacyOk && legacy.profile && typeof legacy.profile === "object" && !Array.isArray(legacy.profile)
        ? legacy.profile
        : {};
    const profile = Object.assign({}, legacyProfile, postingProfile || {});
    // Once posting metadata has a profile, its name, about, pictures, and the
    // other edited fields are the profile. Missing ones stay cleared instead
    // of coming back from the older json_metadata copy.
    if (postingProfile) {
      PROFILE_FIELDS.forEach((key) => {
        if (!Object.prototype.hasOwnProperty.call(postingProfile, key)) delete profile[key];
      });
    }
    return Object.assign({}, legacyOk ? legacy : {}, postingOk ? posting : {}, {
      profile,
    });
  }

  function profileImageFromMetadata(metadata) {
    const profile = metadata && metadata.profile;
    return String((profile && profile.profile_image) || "").trim();
  }

  function knownProfileImage(user) {
    if (accountState.loaded && accountState.user === user) {
      return accountState.profileImage || "";
    }
    return readStoredProfileImage(user);
  }

  function avatarSrcFromImage(user, image, size) {
    if (image != null && !String(image).trim()) {
      return (size === "large") ? AVATAR_DEFAULT_LARGE : AVATAR_DEFAULT_SMALL;
    }
    return HiveMd.avatarUrl(user, size);
  }

  function sessionAvatarSrc(user) {
    return avatarSrcFromImage(user, knownProfileImage(user), "small");
  }

  function ownAccountReady(name) {
    return Boolean(
      name && accountState.loaded && accountState.user === name && accountState.account
    );
  }

  function accountStateFresh(name) {
    if (!ownAccountReady(name) || !accountState.props || !accountState.loadedAt) return false;
    return Date.now() - accountState.loadedAt < ACCOUNT_STATE_FRESH_MS;
  }

  function accountReputation(user) {
    if (!ownAccountReady(user)) return 0;
    const raw = accountState.account.reputation;
    const n = Number(raw);
    if (!Number.isFinite(n) || n === 0) return 0;
    return raw;
  }

  function hivePowerFromAccount(account, props) {
    if (!account || !props) return null;
    const vests =
      HiveApi.parseAsset(account.vesting_shares) +
      HiveApi.parseAsset(account.received_vesting_shares) -
      HiveApi.parseAsset(account.delegated_vesting_shares);
    return HiveApi.vestsToHive(Math.max(0, vests), props);
  }

  function profileFromAccountState() {
    const account = accountState.account;
    if (!account) return null;
    const metadata = accountState.metadata || metadataFromAccount(account);
    const social = accountState.social;
    return {
      name: account.name,
      created: account.created,
      post_count: account.post_count,
      reputation: account.reputation,
      metadata,
      profile_image: accountState.profileImage || "",
      stats: {
        post_count: Number(account.post_count) || 0,
        followers: social ? Number(social.followers) || 0 : 0,
        following: social ? Number(social.following) || 0 : 0,
      },
      context: social ? { followed: Boolean(social.followed) } : {},
      statsPending: !social,
    };
  }

  function roundedResourcePercent(value) {
    return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  }

  function formatResourcePercent(value) {
    return roundedResourcePercent(value) + "%";
  }

  function formatResourceAmount(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "0.00";
    return Math.abs(n).toFixed(2);
  }

  function paintSessionAvatar() {
    const user = observer();
    const img = document.querySelector("#sessionMenu .session-avatar-btn img");
    if (img && user) {
      const src = sessionAvatarSrc(user);
      if (img.getAttribute("src") !== src) img.setAttribute("src", src);
    }
    paintPublishBlogAvatar();
  }

  function paintDownvoteManaStat(el, ready) {
    const value = el.querySelector("[data-stat='downmana']");
    const stat = value && value.closest(".session-stat");
    if (!stat) return;
    const raw = accountState.downvoteMana;
    const pct = raw == null ? null : roundedResourcePercent(raw);
    const show = Boolean(ready && pct != null && pct < 100);
    stat.hidden = !show;
    if (!show) {
      stat.classList.remove("is-low");
      return;
    }
    value.textContent = pct + "%";
    stat.classList.toggle("is-low", pct <= 20);
  }

  function paintAccountResources() {
    paintSessionAvatar();
    const el = $("#sessionAccountStats");
    if (!el) return;
    const mana = el.querySelector("[data-stat='mana']");
    const vote = el.querySelector("[data-stat='vote']");
    const rc = el.querySelector("[data-stat='rc']");
    if (!mana || !vote || !rc) return;
    const manaStat = mana.closest(".session-stat");
    const rcStat = rc.closest(".session-stat");
    const ready = accountState.loaded && accountState.user === observer() && accountState.account;
    paintDownvoteManaStat(el, ready);
    if (!ready) {
      mana.textContent = "…";
      vote.textContent = "…";
      rc.textContent = "…";
      if (manaStat) manaStat.classList.remove("is-low");
      if (rcStat) rcStat.classList.remove("is-low");
      el.classList.add("is-loading");
      return;
    }
    mana.textContent = formatResourcePercent(accountState.votingMana);
    vote.textContent = formatResourceAmount(accountState.voteValue);
    rc.textContent = accountState.rc == null ? "—" : formatResourcePercent(accountState.rc);
    if (manaStat) manaStat.classList.toggle("is-low", roundedResourcePercent(accountState.votingMana) <= 20);
    if (rcStat) {
      rcStat.classList.toggle(
        "is-low",
        accountState.rc != null && roundedResourcePercent(accountState.rc) <= 20
      );
    }
    el.classList.remove("is-loading");
  }

  function assignAccountState(user, info) {
    const account = info && info.account;
    if (!account) return;
    const metadata = metadataFromAccount(account);
    const profileImage = profileImageFromMetadata(metadata);
    const sameUser = accountState.user === user;
    accountState.user = user;
    accountState.account = account;
    accountState.metadata = metadata;
    accountState.profileImage = profileImage;
    accountState.props = info.props || null;
    accountState.votingMana = info.votingMana;
    accountState.downvoteMana = info.downvoteMana == null ? null : info.downvoteMana;
    accountState.voteValue = info.voteValue;
    accountState.rc = info.rc;
    if (!sameUser) accountState.social = null;
    accountState.loaded = true;
    accountState.loadedAt = Date.now();
    writeStoredProfileImage(user, profileImage);
    //const hp = hivePowerFromAccount(account, accountState.props);
    paintAccountResources();
    syncOwnProfileBanner();
  }

  function clearAccountForUser(user) {
    accountState.user = user;
    accountState.account = null;
    accountState.metadata = null;
    accountState.profileImage = "";
    accountState.props = null;
    accountState.votingMana = null;
    accountState.downvoteMana = null;
    accountState.voteValue = null;
    accountState.rc = null;
    accountState.social = null;
    accountState.loaded = false;
    accountState.loadedAt = 0;
    paintAccountResources();
  }

  async function loadAccountResources() {
    const user = observer();
    if (!user) return null;
    if (accountLoad && accountLoad.user === user) return accountLoad.promise;
    const gen = ++resourceGen;
    if (accountState.user !== user) clearAccountForUser(user);
    let resolveLoad;
    const promise = new Promise((resolve) => {
      resolveLoad = resolve;
    });
    accountLoad = { user, gen, promise };
    (async () => {
      try {
        const info = await HiveApi.getAccountResources(user);
        if (gen !== resourceGen || observer() !== user || !info || !info.account) {
          resolveLoad(null);
          return;
        }
        assignAccountState(user, info);
        resolveLoad(accountState);
      } catch {
        resolveLoad(null);
      } finally {
        if (accountLoad && accountLoad.gen === gen) accountLoad = null;
      }
    })();
    return promise;
  }

  function stopNotifPoll() {
    if (notifTimer) {
      window.clearInterval(notifTimer);
      notifTimer = 0;
    }
  }

  function startNotifPoll() {
    stopNotifPoll();
    notifTimer = window.setInterval(() => {
      if (observer()) {
        loadNotifications();
        loadAccountResources();
      } else stopNotifPoll();
    }, NOTIF_POLL_MS);
  }

  function notificationType(item) {
    return String((item && item.type) || "")
      .trim()
      .toLowerCase();
  }

  function notificationHref(url) {
    let raw = String(url || "").trim();
    if (!raw) return "";
    raw = raw.replace(/^https?:\/\/(?:www\.)?(?:hive\.blog|peakd\.com|ecency\.com)\//i, "");
    raw = raw.replace(/^\//, "");
    const community =
      raw.match(/(?:^|\/)(?:trending|hot|created|latest|space)\/(hive-\d+)\b/i) ||
      raw.match(/^(?:c\/)?(hive-\d+)\b/i);
    if (community) return communityHref(community[1]);
    const at = raw.indexOf("@");
    if (at < 0) return "";
    const rest = raw.slice(at);
    const hashIdx = rest.indexOf("#");
    const pathPart = hashIdx >= 0 ? rest.slice(0, hashIdx) : rest;
    const frag = hashIdx >= 0 ? rest.slice(hashIdx) : "";
    return appHref("/" + pathPart) + (parseCommentFragment(frag) ? frag : hashFragment(frag));
  }

  function notificationActor(item) {
    const m = String((item && item.msg) || "").match(/^@([a-z0-9.\-]{3,16})/i);
    if (m) return m[1].toLowerCase();
    if (notificationType(item) === "follow") {
      const fromUrl = String((item && item.url) || "").match(/@([a-z0-9.\-]{3,16})/i);
      if (fromUrl) return fromUrl[1].toLowerCase();
    }
    return "";
  }

  function notificationItemHref(item) {
    const href = notificationHref(item && item.url);
    if (href) return href;
    if (notificationType(item) === "follow") {
      const actor = notificationActor(item);
      if (actor) return appHref("/@" + actor);
    }
    return "";
  }

  function notificationPayoutText(msg) {
    return String(msg).replace(
      /\(\s*(-)?\s*\$\s*(-)?(\d+(?:\.\d*)?)\s*\)/g,
      function (_full, lead, inner, amount) {
        return "(H\u00a0" + (lead || inner ? "-" : "") + amount + ")";
      }
    );
  }

  function notificationMessage(item) {
    let msg = String((item && item.msg) || "");
    const t = notificationType(item);
    if (t === "vote" && msg && !/\(-/.test(msg)) {
      msg = msg.replace(" voted on ", " upvoted ");
    }
    if (t === "follow" && !msg) {
      const actor = notificationActor(item);
      msg = actor ? "@" + actor + " followed you" : "Someone followed you";
    }
    return notificationPayoutText(msg);
  }

  function notificationMessageHtml(item, actor, href) {
    const msg = notificationMessage(item);
    const restHref = href ? HiveMd.escapeHtml(href) : "";
    function wrapRest(text) {
      const body = HiveMd.escapeHtml(text);
      if (!body) return "";
      if (!restHref) return body;
      return `<a class="session-notif-text" href="${restHref}">${body}</a>`;
    }
    if (!actor) return wrapRest(msg) || HiveMd.escapeHtml(msg);
    const re = new RegExp("^@(" + actor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "i");
    const m = msg.match(re);
    const profile = HiveMd.escapeHtml(profileHref(actor));
    if (!m) {
      return (
        `<a class="session-notif-user" href="${profile}">@${HiveMd.escapeHtml(actor)}</a>` +
        wrapRest(msg ? " " + msg : "")
      );
    }
    return (
      `<a class="session-notif-user" href="${profile}">${HiveMd.escapeHtml(m[0])}</a>` +
      wrapRest(msg.slice(m[0].length))
    );
  }

  function notificationKindLabel(item) {
    const t = notificationType(item);
    if (t === "vote") {
      return /\(-/.test(String((item && item.msg) || "")) ? "downvote" : "upvote";
    }
    if (t === "reply" || t === "reply_comment") return "reply";
    if (t === "reblog") return "reblog";
    if (t === "mention") return "mention";
    if (t === "follow") return "follow";
    if (t === "subscribe") return "subscribe";
    if (t === "set_role") return "role";
    if (t === "set_title" || t === "set_label") return "title";
    if (t === "set_props") return "settings";
    if (t === "pin_post") return "pin";
    if (t === "unpin_post") return "unpin";
    if (t === "flag_post") return "flag";
    if (t === "new_community") return "community";
    return t ? t.replace(/_/g, " ") : "";
  }

  const NOTIF_HIDDEN_TYPES = {
    unfollow: true,
    mute: true,
    unmute: true,
    ignore: true,
    mute_post: true,
    unmute_post: true,
  };

  function isHiddenNotif(item) {
    const t = notificationType(item);
    if (NOTIF_HIDDEN_TYPES[t]) return true;
    const msg = String((item && item.msg) || "").toLowerCase();
    if (/\bunfollowed\b/.test(msg)) return true;
    if (/\b(?:muted|unmuted|ignored) you\b/.test(msg)) return true;
    if (t === "follow" && /\b(?:muted|unmuted|unfollowed|ignored)\b/.test(msg)) return true;
    return false;
  }

  function notificationId(item) {
    return item && item.id != null ? String(item.id) : "";
  }

  function filterNotificationItems(items, seen) {
    const list = Array.isArray(items) ? items : [];
    const known = seen || new Set();
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      if (!item || isHiddenNotif(item)) continue;
      if (!isNotifUnread(item, notifState.lastread)) continue;
      const id = notificationId(item);
      if (id) {
        if (known.has(id)) continue;
        known.add(id);
      }
      out.push(item);
    }
    return out;
  }

  function notifBatchReachedRead(batch) {
    if (!Array.isArray(batch) || !batch.length) return true;
    return !isNotifUnread(batch[batch.length - 1], notifState.lastread);
  }

  function renderNotifItem(item) {
    const actor = notificationActor(item);
    const href = notificationItemHref(item);
    const unread = isNotifUnread(item, notifState.lastread);
    const type = notificationType(item);
    const typeCls = type && /^[a-z0-9_]+$/.test(type) ? " is-" + type.replace(/_/g, "-") : "";
    const cls = "session-notif" + (unread ? " is-unread" : "") + typeCls;
    const profile = actor ? profileHref(actor) : "";
    const avatar = actor
      ? (profile
          ? `<a class="session-notif-actor" href="${HiveMd.escapeHtml(profile)}" aria-label="@${HiveMd.escapeHtml(actor)}"><img class="session-notif-avatar" src="${HiveMd.avatarUrl(actor, "small")}" alt=""></a>`
          : `<img class="session-notif-avatar" src="${HiveMd.avatarUrl(actor, "small")}" alt="">`)
      : "";
    const kind = notificationKindLabel(item);
    const time = timeAgo(item.date);
    const meta = kind ? kind + (time ? " · " + time : "") : time;
    const timeHtml = `<span class="session-notif-time">${HiveMd.escapeHtml(meta)}</span>`;
    const hrefAttr = href ? ` data-href="${HiveMd.escapeHtml(href)}"` : "";
    return (
      `<div class="${cls}"${hrefAttr}>` +
      avatar +
      `<span class="session-notif-body">` +
      `<span class="session-notif-msg">${notificationMessageHtml(item, actor, href)}</span>` +
      timeHtml +
      `</span></div>`
    );
  }

  function notifFooterHtml() {
    if (notifState.loadingMore) {
      return `<p class="session-notifs-empty session-notifs-more">Loading…</p>`;
    }
    return "";
  }

  function syncNotifFooter(wrap) {
    const el = wrap || $("#sessionNotifs");
    if (!el) return;
    const old = el.querySelector(".session-notifs-more");
    if (old) old.remove();
    const html = notifFooterHtml();
    if (html) el.insertAdjacentHTML("beforeend", html);
  }

  function notifsPanelOpen() {
    const menu = $("#sessionMenu");
    return Boolean(menu && menu.classList.contains("is-open"));
  }

  function notifsNearBottom(wrap) {
    if (!wrap) return false;
    return wrap.scrollTop + wrap.clientHeight >= wrap.scrollHeight - NOTIF_SCROLL_PX;
  }

  function maybeLoadMoreNotifs() {
    if (!notifsPanelOpen() || !notifState.loaded || notifState.done || notifState.loadingMore) return;
    const wrap = $("#sessionNotifs");
    if (!wrap) return;
    if (wrap.clientHeight < 8) return;
    if (notifsNearBottom(wrap)) loadMoreNotifications();
  }

  function bindNotifScroll() {
    const wrap = $("#sessionNotifs");
    if (!wrap || wrap.dataset.scrollBound === "1") return;
    wrap.dataset.scrollBound = "1";
    wrap.addEventListener(
      "scroll",
      () => {
        maybeLoadMoreNotifs();
      },
      { passive: true }
    );
    wrap.addEventListener("click", (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
        return;
      }
      if (e.target.closest("a[href]")) return;
      const row = e.target.closest(".session-notif");
      if (!row || !wrap.contains(row)) return;
      const href = row.getAttribute("data-href");
      if (!href) return;
      e.preventDefault();
      navigate(href);
    });
  }

  function prependNotifDom(items) {
    const wrap = $("#sessionNotifs");
    if (!wrap || !items.length) return;
    const first = wrap.querySelector(".session-notif");
    if (!first) {
      paintNotifs();
      return;
    }
    const before = wrap.scrollHeight;
    const top = wrap.scrollTop;
    first.insertAdjacentHTML("beforebegin", items.map(renderNotifItem).join(""));
    if (top > 0) wrap.scrollTop = top + (wrap.scrollHeight - before);
  }

  function appendNotifDom(items) {
    const wrap = $("#sessionNotifs");
    if (!wrap || !items.length) return;
    if (!wrap.querySelector(".session-notif")) {
      paintNotifs();
      return;
    }
    const footer = wrap.querySelector(".session-notifs-more");
    const html = items.map(renderNotifItem).join("");
    if (footer) footer.insertAdjacentHTML("beforebegin", html);
    else wrap.insertAdjacentHTML("beforeend", html);
    syncNotifFooter(wrap);
  }

  function isNotifUnread(item, lastread) {
    if (!lastread) return true;
    const itemTs = parseCreatedTs(item && item.date);
    const readTs = parseCreatedTs(String(lastread).replace(" ", "T"));
    if (!Number.isFinite(itemTs) || !Number.isFinite(readTs)) return false;
    return itemTs > readTs;
  }

  function notificationButtonLabel() {
    const n = notifState.unread;
    if (!n) return "Notifications";
    return n + " unread notification" + (n === 1 ? "" : "s");
  }

  function paintBadge() {
    const badge = $("#sessionBadge");
    const btn = document.querySelector(".session-avatar-btn");
    const label = notificationButtonLabel();
    if (btn) btn.setAttribute("aria-label", label);
    if (badge) {
      const n = notifState.unread;
      if (!n) {
        badge.hidden = true;
        badge.textContent = "";
        badge.removeAttribute("aria-label");
      } else {
        badge.hidden = false;
        badge.textContent = n > 99 ? "99+" : String(n);
        badge.setAttribute("aria-label", label);
      }
    }
    paintMarkRead();
  }

  function hiveUtcDate() {
    return new Date().toISOString().slice(0, 19);
  }

  function paintMarkRead() {
    const btn = $("#markReadBtn");
    if (!btn || btn.dataset.pending === "1") return;
    btn.disabled = !(notifState.loaded && notifState.unread > 0);
  }

  function paintNotifs() {
    const wrap = $("#sessionNotifs");
    if (!wrap) return;
    const top = wrap.scrollTop;
    if (!notifState.loaded && !notifState.error) {
      wrap.innerHTML = `<p class="session-notifs-empty">Loading…</p>`;
      return;
    }
    if (notifState.error && !notifState.items.length) {
      wrap.innerHTML = `<p class="session-notifs-empty">${HiveMd.escapeHtml(notifState.error)}</p>`;
      return;
    }
    if (!notifState.items.length) {
      wrap.innerHTML = `<p class="session-notifs-empty">No notifications</p>`;
      return;
    }
    wrap.innerHTML = notifState.items.map(renderNotifItem).join("") + notifFooterHtml();
    wrap.scrollTop = top;
  }

  async function loadMoreNotifications() {
    const user = observer();
    if (!user || !notifState.loaded || notifState.loadingMore || notifState.done) return;
    if (!notifsPanelOpen()) return;
    const cursor = notifState.cursor;
    if (!cursor) {
      notifState.done = true;
      syncNotifFooter();
      return;
    }
    const gen = notifGen;
    notifState.loadingMore = true;
    syncNotifFooter();
    try {
      const batch = await HiveApi.accountNotifications(user, {
        limit: NOTIF_LIMIT,
        lastId: cursor,
      });
      if (gen !== notifGen || observer() !== user) return;
      const lastId = notificationId(batch[batch.length - 1]);
      notifState.cursor = lastId;
      if (
        !batch.length ||
        batch.length < NOTIF_LIMIT ||
        !lastId ||
        lastId === cursor ||
        notifBatchReachedRead(batch)
      ) {
        notifState.done = true;
      }
      const more = filterNotificationItems(batch, notifState.seen);
      if (more.length) {
        notifState.items = notifState.items.concat(more);
        appendNotifDom(more);
      }
    } catch {
      /* keep the cursor so the next scroll retries */
    } finally {
      if (gen !== notifGen) return;
      notifState.loadingMore = false;
      syncNotifFooter();
      maybeLoadMoreNotifs();
    }
  }

  async function loadNotifications() {
    const user = observer();
    if (!user) return;
    const gen = ++notifGen;
    notifState.user = user;
    notifState.loadingMore = false;
    try {
      const [unread, batch] = await Promise.all([
        HiveApi.unreadNotifications(user),
        HiveApi.accountNotifications(user, { limit: NOTIF_LIMIT }),
      ]);
      if (gen !== notifGen || observer() !== user) return;
      const markedFresh = notifState.markedAt && Date.now() - notifState.markedAt < 45000;
      if (markedFresh && unread.unread > 0) {
        notifState.unread = 0;
      } else {
        notifState.unread = unread.unread;
        notifState.lastread = unread.lastread || "";
        notifState.markedAt = 0;
      }
      const items = Array.isArray(batch) ? batch : [];
      const lastId = notificationId(items[items.length - 1]);
      const reachedRead = notifBatchReachedRead(items);
      if (!notifState.loaded) {
        notifState.seen = new Set();
        notifState.items = filterNotificationItems(items, notifState.seen);
        notifState.cursor = lastId;
        notifState.done = !items.length || items.length < NOTIF_LIMIT || !lastId || reachedRead;
        notifState.loaded = true;
        notifState.error = "";
        paintNotifs();
      } else {
        const kept = notifState.items.filter((item) => isNotifUnread(item, notifState.lastread));
        if (kept.length !== notifState.items.length) {
          notifState.items = kept;
          paintNotifs();
        }
        const fresh = filterNotificationItems(items, notifState.seen);
        notifState.error = "";
        if (fresh.length) {
          notifState.items = fresh.concat(notifState.items);
          prependNotifDom(fresh);
        }
        if (reachedRead) notifState.done = true;
      }
      paintBadge();
      maybeLoadMoreNotifs();
    } catch (err) {
      if (gen !== notifGen) return;
      notifState.error = (err && err.message) || "Could not load notifications.";
      if (!notifState.loaded) paintNotifs();
    }
  }

  function markNotificationsRead() {
    const user = observer();
    if (!user) return;
    const btn = $("#markReadBtn");
    if (btn && (btn.disabled || btn.dataset.pending === "1")) return;
    if (!hasSigner(user)) {
      showError(signerNeededMessage());
      return;
    }
    const date = hiveUtcDate();
    if (btn) {
      btn.dataset.pending = "1";
      btn.disabled = true;
      btn.textContent = "Marking…";
    }
    const { promise } = ChainQueue.enqueue({
      username: user,
      key: "Posting",
      operations: [
        [
          "custom_json",
          {
            required_auths: [],
            required_posting_auths: [user],
            id: "notify",
            json: JSON.stringify(["setLastRead", { date }]),
          },
        ],
      ],
      meta: { type: "notify", action: "setLastRead" },
    });
    promise
      .then(() => {
        notifState.unread = 0;
        notifState.lastread = date;
        notifState.markedAt = Date.now();
        notifState.items = [];
        notifState.seen = new Set();
        notifState.cursor = "";
        notifState.done = true;
        paintBadge();
        paintNotifs();
      })
      .catch((err) => {
        showError(err.message || String(err));
      })
      .finally(() => {
        const el = $("#markReadBtn");
        if (!el) return;
        el.dataset.pending = "";
        el.textContent = "Mark as read";
        paintMarkRead();
      });
  }

  function logout() {
    stopPublishDraftAutosave();
    clearStoredPublishDraft();
    clearStoredCommentDraft();
    const loginKey = $("#loginKey");
    if (loginKey) loginKey.value = "";
    const ownerKey = $("#ownerSignKey");
    if (ownerKey) ownerKey.value = "";
    closeLogoMenu();
    if (window.HiveAuth) HiveAuth.clear();
    sessionStorage.removeItem(SESSION_KEY);
    clearKeychainUser();
    walletMemoPlain.clear();
    localVotes.clear();
    votesCache.clear();
    localReblogs.clear();
    reblogsCache.clear();
    payoutByKey.clear();
    voteRefreshGen.clear();
    hideVoteUi();
    pendingPublish = false;
    publishSubs = [];
    publishSubsUser = "";
    resetPublishForm();
    hidePublishOverlay({ persist: false });
    stopNotifPoll();
    resetNotifs();
    resetAccountState();
    clearSettingsProfileScratch();
    clearSettingsKeys();
    clearCommunityEditScratch();
    clearSubspaceCreateDraft();
    renderSession();
    currentViewKey = "";
    if (parseRoute().name === "publish") navigate(appHref("/"), true);
    else route();
  }

  function logoFeedHref() {
    return appHref(pathForFeedSort(observer() ? "feed" : "latest"));
  }

  function logoUsesTopFeed(route) {
    if (!route) return false;
    return route.name === "feed" || route.name === "community" || route.name === "welcome" || route.name === "profile";
  }

  function isOnTopLevelFeed(route) {
    return Boolean(route && route.name === "feed" && !route.tag && route.sort === defaultFeedSort());
  }

  function paintLogoMenu() {
    const about = $("#logoAboutLink");
    const welcome = $("#logoWelcomeLink");
    const feed = $("#logoFeedLink");
    const search = $("#logoSearchLink");
    const tags = $("#logoTagsLink");
    const communities = $("#logoCommunitiesLink");
    const favUsers = $("#logoFavUsers");
    const favs = $("#logoFavTags");
    const favComms = $("#logoFavCommunities");
    const trigger = $("#logoTrigger");
    const panel = document.querySelector("#logoDropdown .logo-dropdown-panel");
    const menuLabel = "welcome, feed, search, spaces, subspaces, and about";
    if (trigger) trigger.setAttribute("aria-label", "Open " + menuLabel.toLowerCase());
    if (panel) panel.setAttribute("aria-label", menuLabel);
    if (about) about.setAttribute("href", appHref("/about"));
    if (welcome) welcome.setAttribute("href", appHref("/welcome"));
    if (feed) feed.setAttribute("href", logoFeedHref());
    if (search) search.setAttribute("href", appHref("/search"));
    if (tags) tags.setAttribute("href", appHref("/spaces"));
    if (communities) communities.setAttribute("href", appHref("/subspaces"));
    if (favUsers) {
      const list = readFavoriteUsers().slice(0, LOGO_FAVORITES_SHOW);
      if (!list.length) {
        favUsers.hidden = true;
        favUsers.innerHTML = "";
      } else {
        favUsers.hidden = false;
        favUsers.innerHTML = list
          .map((name) => {
            const safe = HiveMd.escapeHtml(name);
            return `<a class="logo-dropdown-link" href="${HiveMd.escapeHtml(profileHref(name))}">@${safe}</a>`;
          })
          .join("");
      }
    }
    if (favs) {
      const list = readFavoriteTags().slice(0, LOGO_FAVORITES_SHOW);
      if (!list.length) {
        favs.hidden = true;
        favs.innerHTML = "";
      } else {
        favs.hidden = false;
        favs.innerHTML = list
          .map((t) => {
            const safe = HiveMd.escapeHtml(t);
            return `<a class="logo-dropdown-link" href="${HiveMd.escapeHtml(tagFeedHref(t))}">#${safe}</a>`;
          })
          .join("");
      }
    }
    if (!favComms) return;
    const comms = readFavoriteCommunities().slice(0, LOGO_FAVORITES_SHOW);
    if (!comms.length) {
      favComms.hidden = true;
      favComms.innerHTML = "";
      return;
    }
    favComms.hidden = false;
    favComms.innerHTML = comms
      .map((c) => {
        const title = HiveMd.escapeHtml(c.title || c.name);
        return `<a class="logo-dropdown-link" href="${HiveMd.escapeHtml(communityHref(c.name))}">${title}</a>`;
      })
      .join("");
  }

  function closeLogoMenu() {
    const logoWrap = $("#logoWrap");
    const trigger = $("#logoTrigger");
    if (logoWrap) logoWrap.classList.remove("is-open");
    if (trigger) trigger.setAttribute("aria-expanded", "false");
    closeNodeMenus();
  }

  function renderSession() {
    paintLogoMenu();
    const user = observer();
    if (user) {
      const profileUrl = HiveMd.escapeHtml(profileHref(user));
      const commentsUrl = HiveMd.escapeHtml(profileHref(user, "comments"));
      const repliesUrl = HiveMd.escapeHtml(profileHref(user, "replies"));
      const walletUrl = HiveMd.escapeHtml(profileHref(user, "wallet"));
      sessionSlot.innerHTML = `
        <div class="session-menu" id="sessionMenu">
          <div class="session-chip">
            <button type="button" class="session-avatar-btn" aria-haspopup="true" aria-expanded="false" aria-controls="sessionDropdown" aria-label="Notifications">
              <span class="session-avatar-wrap">
                <img src="${sessionAvatarSrc(user)}" alt="" width="24" height="24">
                <span class="session-badge" id="sessionBadge" hidden></span>
              </span>
            </button>
            <div class="session-account" id="sessionAccount">
              <a class="session-name" href="${profileUrl}" aria-haspopup="true" aria-expanded="false" aria-controls="sessionAccountMenu">@${HiveMd.escapeHtml(user)}</a>
              <div class="session-account-menu" id="sessionAccountMenu">
                <nav class="session-account-panel" aria-label="Account">
                  <a class="session-account-link" href="${profileUrl}">Profile</a>
                  <a class="session-account-link" href="${commentsUrl}">Comments</a>
                  <a class="session-account-link" href="${repliesUrl}">Replies</a>
                  <a class="session-account-link" href="${walletUrl}">Wallet</a>
                  <a class="session-account-link" href="${HiveMd.escapeHtml(appHref("/settings"))}">Settings</a>
                  <button type="button" class="session-account-link" id="accountLogoutBtn">Logout</button>
                </nav>
              </div>
            </div>
          </div>
          <div class="session-dropdown" id="sessionDropdown">
            <div class="session-dropdown-panel">
              <div class="session-account-stats is-loading" id="sessionAccountStats" aria-label="Voting mana, downvote mana, vote value, and resource credits">
                <span class="session-account-stats-main">
                  <span class="session-stat" tabindex="0"><span class="session-stat-label">▲</span><span class="session-stat-value" data-stat="mana">…</span><span class="session-stat-tip" role="tooltip">Voting Mana</span></span>
                  <span class="session-stat" data-stat-wrap="downmana" tabindex="0" hidden><span class="session-stat-label">▼</span><span class="session-stat-value" data-stat="downmana"></span><span class="session-stat-tip" role="tooltip">Downvote Mana</span></span>
                  <span class="session-stat" tabindex="0"><span class="session-stat-label">H</span><span class="session-stat-value" data-stat="vote">…</span><span class="session-stat-tip" role="tooltip">Estimated Vote Value</span></span>
                </span>
                <span class="session-stat session-stat-rc" tabindex="0"><span class="session-stat-label">RC</span><span class="session-stat-value" data-stat="rc">…</span><span class="session-stat-tip" role="tooltip">Resource Credits</span></span>
              </div>
              <div class="session-notifs" id="sessionNotifs" aria-label="Notifications"></div>
              <div class="session-menu-actions">
                <button type="button" class="session-mark-read" id="markReadBtn">Mark as read</button>
                <button type="button" class="session-logout" id="logoutBtn">Logout</button>
              </div>
            </div>
          </div>
        </div>
      `;
      $("#logoutBtn").addEventListener("click", logout);
      $("#accountLogoutBtn").addEventListener("click", logout);
      $("#markReadBtn").addEventListener("click", markNotificationsRead);
      bindSessionAccount();
      bindNotifScroll();
      paintBadge();
      paintNotifs();
      paintAccountResources();
      loadNotifications();
      loadAccountResources();
      startNotifPoll();
    } else {
      stopNotifPoll();
      resetNotifs();
      resetAccountState();
      sessionSlot.innerHTML = `<button type="button" class="btn-login" id="loginBtn">Login</button>`;
      $("#loginBtn").addEventListener("click", openLogin);
    }
  }

  function setAccountMenuOpen(open) {
    const account = $("#sessionAccount");
    if (!account) return;
    if (open) account.classList.remove("is-dismissed");
    account.classList.toggle("is-open", Boolean(open));
    const name = account.querySelector(".session-name");
    if (name) name.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function dismissAccountMenu() {
    const account = $("#sessionAccount");
    if (!account) return;
    account.classList.add("is-dismissed");
    setAccountMenuOpen(false);
    const focused = document.activeElement;
    if (focused && focused.closest && focused.closest("#sessionAccount")) focused.blur();
  }

  function bindSessionAccount() {
    const account = $("#sessionAccount");
    if (!account) return;
    const name = account.querySelector(".session-name");
    const expanded = (open) => {
      if (name) name.setAttribute("aria-expanded", open ? "true" : "false");
    };
    account.addEventListener("pointerenter", () => {
      if (!hoverFine()) return;
      setSessionMenuOpen(false);
      closeNodeMenus();
      expanded(true);
    });
    account.addEventListener("pointerleave", (e) => {
      if (e.relatedTarget && account.contains(e.relatedTarget)) return;
      account.classList.remove("is-dismissed");
      if (!hoverFine()) return;
      if (!account.classList.contains("is-open")) expanded(false);
    });
    account.addEventListener("focusin", () => {
      setSessionMenuOpen(false);
      expanded(true);
    });
    account.addEventListener("focusout", (e) => {
      if (e.relatedTarget && account.contains(e.relatedTarget)) return;
      if (!account.classList.contains("is-open")) expanded(false);
    });
  }

  function setSessionMenuOpen(open) {
    const menu = $("#sessionMenu");
    if (!menu) return;
    menu.classList.toggle("is-open", Boolean(open));
    const btn = menu.querySelector(".session-avatar-btn");
    if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      setAccountMenuOpen(false);
      loadAccountResources();
      maybeLoadMoreNotifs();
    }
  }

  document.addEventListener(
    "click",
    (e) => {
      const menu = $("#sessionMenu");
      if (!menu) return;
      const avatarBtn = e.target.closest(".session-avatar-btn");
      if (avatarBtn && menu.contains(avatarBtn)) {
        e.preventDefault();
        setSessionMenuOpen(!menu.classList.contains("is-open"));
        return;
      }
      const account = $("#sessionAccount");
      const nameLink = e.target.closest(".session-name");
      if (nameLink && account && account.contains(nameLink)) {
        if (!hoverFine()) {
          e.preventDefault();
          const open = !account.classList.contains("is-open");
          setSessionMenuOpen(false);
          setAccountMenuOpen(open);
          return;
        }
        dismissAccountMenu();
      }
      if (e.target.closest(".session-account-link")) {
        if (hoverFine()) dismissAccountMenu();
        else setAccountMenuOpen(false);
        setSessionMenuOpen(false);
        const focused = document.activeElement;
        if (focused && focused.closest && focused.closest("#sessionAccount")) focused.blur();
        return;
      }
      if (
        e.target.closest(".session-name") ||
        e.target.closest(".session-notif") ||
        !menu.contains(e.target)
      ) {
        setSessionMenuOpen(false);
      }
      if (account && !account.contains(e.target)) setAccountMenuOpen(false);
    },
    true
  );

  document.addEventListener("keydown", (e) => {
    if (e.key === " " || e.code === "Space") {
      if (scrollPeoplePanel(e)) return;
    }
    if (e.key !== "Escape") return;
    if (contentDeleteOpen()) {
      hideContentDelete();
      return;
    }
    if (publishDiscardOpen()) {
      hidePublishDiscard();
      return;
    }
    if (ownerSignOpen()) {
      cancelOwnerSign();
      return;
    }
    if (communityRoleDialogOpen()) {
      if (!communityRoleBusy) dismissCommunityRoleDialog();
      return;
    }
    if (communityTitleDialogOpen()) {
      if (!communityRoleBusy) dismissCommunityTitleDialog();
      return;
    }
    if (overlay && !overlay.hidden) {
      closeLogin();
      return;
    }
    const delegateOv = $("#delegateOverlay");
    if (delegateOv && !delegateOv.hidden) {
      closeDelegateOverlay();
      return;
    }
    const walletOv = $("#walletOverlay");
    if (walletOv && !walletOv.hidden) {
      closeWalletOverlay();
      return;
    }
    if (nodeOverlayOpen()) {
      closeNodeOverlay();
      return;
    }
    const peopleOv = $("#peopleOverlay");
    if (peopleOv && !peopleOv.hidden) {
      closePeoplePanel();
      return;
    }
    setSessionMenuOpen(false);
    closeProfileMore();
    closeContentMore();
    const account = $("#sessionAccount");
    if (account && document.activeElement && account.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    setAccountMenuOpen(false);
    closeNodeMenus();
    closeLogoMenu();
  });

  function defaultAuthMethod() {
    return isMobileViewport() ? "password" : "keychain";
  }

  function authMethod(root) {
    if (!root) return "keychain";
    const active = root.querySelector("[data-auth-method].is-active");
    return active && active.getAttribute("data-auth-method") === "password" ? "password" : "keychain";
  }

  function setAuthMethod(root, method) {
    if (!root) return;
    const next = method === "password" ? "password" : "keychain";
    const previous = authMethod(root);
    root.querySelectorAll("[data-auth-method]").forEach((btn) => {
      const on = btn.getAttribute("data-auth-method") === next;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
    const card = root.closest(".login-card");
    const keyBlock = card && card.querySelector("[data-auth-key]");
    if (keyBlock) keyBlock.hidden = next !== "password";
    if (previous === "password" && next !== "password") {
      const keyInput = keyBlock && keyBlock.querySelector("input");
      if (keyInput) keyInput.value = "";
    }
    if (previous !== next) {
      const status = card && card.querySelector("[id$='Status']");
      if (status && status.textContent) {
        status.textContent = "";
        status.classList.remove("is-error");
      }
    }
    if (root.id === "loginMethod") resetLoginMasterPrompt();
  }

  function bindAuthMethod(root) {
    if (!root || root.dataset.authBound === "1") return;
    root.dataset.authBound = "1";
    root.querySelectorAll("[data-auth-method]").forEach((btn) => {
      btn.addEventListener("click", () => {
        setAuthMethod(root, btn.getAttribute("data-auth-method"));
      });
    });
  }

  let loginMasterArmed = false;

  function resetLoginMasterPrompt() {
    loginMasterArmed = false;
    const warn = $("#loginMasterWarn");
    if (warn) warn.hidden = true;
  }

  function armLoginMasterPrompt() {
    loginMasterArmed = true;
    const warn = $("#loginMasterWarn");
    if (warn) warn.hidden = false;
    const status = $("#loginStatus");
    if (status) status.textContent = "";
  }

  function openLogin() {
    const status = $("#loginStatus");
    if (status) status.textContent = "";
    resetLoginMasterPrompt();
    setAuthMethod($("#loginMethod"), defaultAuthMethod());
    overlay.hidden = false;
    const input = $("#loginUser");
    if (input) input.focus();
  }

  let loginBusy = false;

  function closeLogin() {
    overlay.hidden = true;
    pendingPublish = false;
    loginBusy = false;
    const keyInput = $("#loginKey");
    if (keyInput) keyInput.value = "";
    resetLoginMasterPrompt();
    const status = $("#loginStatus");
    if (status) status.textContent = "";
    const connectBtn = $("#loginConnect");
    if (connectBtn) connectBtn.disabled = false;
  }

  function finishLogin(username, method) {
    const resumePublish = pendingPublish;
    sessionStorage.setItem(SESSION_KEY, username);
    if (method === "keychain") writeKeychainUser(username);
    else clearKeychainUser();
    closeLogin();
    clearCommunityEditScratch();
    renderSession();
    // Publish was clicked while logged out. The composer is still open, so
    // continue that click now that the session exists.
    if (resumePublish) {
      const pub = $("#publishOverlay");
      if (pub && !pub.hidden) {
        paintPublishDest();
        renderDestMenu();
        loadPublishSubs();
        syncPublishCommunityAccess();
        submitPublish();
        return;
      }
      currentViewKey = "";
      navigate(appHref("/publish"));
      return;
    }
    currentViewKey = "";
    if (isHomePath()) {
      navigate(appHref(pathForFeedSort(defaultFeedSort())), true);
    } else {
      route();
    }
  }

  function randomLoginToken() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return (
      hex.slice(0, 8) +
      "-" +
      hex.slice(8, 12) +
      "-" +
      hex.slice(12, 16) +
      "-" +
      hex.slice(16, 20) +
      "-" +
      hex.slice(20)
    );
  }

  function keychainLoginMessage() {
    return JSON.stringify({
      token: randomLoginToken(),
      title: "Login request for CyberSpace77",
    });
  }

  function connectKeychain(username, status) {
    if (!window.hive_keychain) {
      loginBusy = false;
      status.textContent =
        "hive keychain is not available. Choose Password to sign in with a posting key.";
      return;
    }
    status.textContent = "Waiting for Keychain…";
    window.hive_keychain.requestSignBuffer(
      username,
      keychainLoginMessage(),
      "Posting",
      (res) => {
        if (res && res.success) {
          const done = window.HiveAuth ? HiveAuth.clear() : Promise.resolve();
          Promise.resolve(done)
            .catch(() => {})
            .then(() => {
              loginBusy = false;
              finishLogin(username, "keychain");
            });
        } else {
          loginBusy = false;
          status.textContent = (res && res.message) || "Keychain login was cancelled.";
        }
      },
      null,
      "Login"
    );
  }

  async function connectLogin() {
    if (loginBusy) return;
    const username = normalizeLoginUser($("#loginUser").value);
    const status = $("#loginStatus");
    const keyInput = $("#loginKey");
    const connectBtn = $("#loginConnect");
    const method = authMethod($("#loginMethod"));
    if (!status) return;
    if (!validLoginUser(username)) {
      status.textContent = "Enter a valid Hive username.";
      return;
    }
    if (method === "password") {
      let secret = (keyInput && keyInput.value) || "";
      let password = "";
      if (!secret.replace(/\s+/g, "")) {
        if (keyInput) keyInput.value = "";
        secret = "";
        resetLoginMasterPrompt();
        status.textContent = "Enter a posting key.";
        return;
      }
      if (
        !window.HiveAuth ||
        typeof HiveAuth.secretKind !== "function" ||
        typeof HiveAuth.login !== "function"
      ) {
        secret = "";
        status.textContent = "Could not use that key in this browser.";
        return;
      }
      loginBusy = true;
      if (connectBtn) connectBtn.disabled = true;
      status.textContent = loginMasterArmed ? "Deriving the posting key…" : "Checking key…";
      try {
        if (loginMasterArmed) {
          password = secret.trim();
          secret = "";
          if (keyInput) keyInput.value = "";
          resetLoginMasterPrompt();
          if (typeof HiveAuth.loginMaster !== "function") {
            throw new Error("Could not derive the posting key.");
          }
          const loginJob = HiveAuth.loginMaster(username, password);
          password = "";
          await loginJob;
          finishLogin(username, "posting");
          return;
        }
        const kind = await HiveAuth.secretKind(secret);
        if (overlay.hidden) return;
        if (kind === "invalid") {
          if (keyInput) keyInput.value = "";
          secret = "";
          status.textContent = "That key is not valid.";
          return;
        }
        if (kind === "wif") {
          let wif = secret.replace(/\s+/g, "");
          secret = "";
          if (keyInput) keyInput.value = "";
          status.textContent = "Checking posting key…";
          const loginJob = HiveAuth.login(username, wif);
          wif = "";
          await loginJob;
          finishLogin(username, "posting");
          return;
        }
        secret = "";
        armLoginMasterPrompt();
      } catch (err) {
        if (!overlay.hidden) status.textContent = (err && err.message) || String(err);
      } finally {
        secret = "";
        password = "";
        loginBusy = false;
        if (connectBtn && !overlay.hidden) connectBtn.disabled = false;
        if (loginMasterArmed && connectBtn && !overlay.hidden) connectBtn.focus();
      }
      return;
    }
    if (!window.hive_keychain) {
      status.textContent =
        "hive keychain is not available. Choose Password to sign in with a posting key.";
      return;
    }
    loginBusy = true;
    connectKeychain(username, status);
  }

  /* ─── Publish ─── */
  function setPublishStatus(msg, isError, busy) {
    const el = $("#publishStatus");
    if (!el) return;
    if (!msg) {
      el.hidden = true;
      el.textContent = "";
      el.classList.remove("is-error", "is-publishing");
      return;
    }
    el.hidden = false;
    el.textContent = msg;
    el.classList.toggle("is-error", Boolean(isError));
    el.classList.toggle("is-publishing", Boolean(busy) && !isError);
  }

  function editingComment() {
    return Boolean(publishEdit && publishEdit.comment);
  }

  function paintPublishChrome() {
    const editing = Boolean(publishEdit);
    const comment = editingComment();
    const h2 = $("#publishPage h2");
    const submit = $("#publishSubmit");
    const dest = $("#publishDest");
    const pageEl = $("#publishPage");
    const title = $("#publishTitle");
    const body = $("#publishBody");
    const tagsHead = document.querySelector("#publishPage .publish-tags-head");
    const tagsWrap = $("#publishTagsWrap");
    if (h2) h2.textContent = comment ? "Edit comment" : editing ? "Edit post" : "New post";
    if (submit) submit.textContent = editing ? "Save" : "Publish";
    if (dest) dest.hidden = editing;
    if (title) {
      title.hidden = comment;
      title.maxLength = PUBLISH_TITLE_MAX;
    }
    if (tagsHead) tagsHead.hidden = comment;
    if (tagsWrap) tagsWrap.hidden = comment;
    if (body) body.placeholder = comment ? "Write your comment…" : "Write your post…";
    if (pageEl) {
      pageEl.classList.toggle("is-editing", editing);
      pageEl.classList.toggle("is-editing-comment", comment);
    }
    paintPublishTitleCount();
  }

  function paintPublishTitleCount() {
    const el = $("#publishTitleCount");
    if (!el) return;
    const comment = editingComment();
    const title = $("#publishTitle");
    const used = title ? utf8Size(title.value) : 0;
    const max = PUBLISH_TITLE_MAX;
    const ratio = max > 0 ? Math.min(1, Math.max(0, used / max)) : 0;
    const atLimit = max > 0 && used >= max;
    const showRing = !comment && used > PUBLISH_TITLE_RING_AT;
    el.hidden = !showRing;
    el.classList.toggle("is-limit", atLimit && showRing);
    const arc = el.querySelector(".publish-title-count-arc");
    const radius = 8;
    const turn = 2 * Math.PI * radius;
    if (arc) {
      arc.style.strokeDasharray = turn.toFixed(3);
      arc.style.strokeDashoffset = (turn * (1 - ratio)).toFixed(3);
      arc.style.opacity = showRing ? "1" : "0";
    }
    const label = used + " of " + max + " title bytes";
    el.setAttribute("aria-label", label);
    el.title = label;
  }

  function focusPublishField() {
    const comment = editingComment();
    const field = comment ? $("#publishBody") : $("#publishTitle");
    if (!field) return;
    field.focus();
    if (!comment || typeof field.setSelectionRange !== "function") return;
    const n = field.value.length;
    field.setSelectionRange(n, n);
  }

  function snapshotPublishForm() {
    savePublishDraft();
    const tagInput = $("#publishTagInput");
    const advanced = publishAdvancedState();
    return {
      title: publishTitleDraft,
      body: publishBodyDraft,
      tags: publishTags.slice(),
      dest: {
        type: publishDest.type,
        name: publishDest.name,
        title: publishDest.title,
      },
      tagInput: tagInput ? tagInput.value : "",
      description: advanced.description,
      reward: advanced.reward,
      beneficiaries: advanced.beneficiaries,
      communityBeneficiary:
        publishCommunityBeneficiary &&
        publishDest.type === "community" &&
        publishCommunityBeneficiary.community === normalizeCommunityName(publishDest.name)
          ? publishCommunityBeneficiary.account
          : "",
    };
  }

  function utf8Size(text) {
    const value = String(text || "");
    if (typeof TextEncoder === "function") return new TextEncoder().encode(value).length;
    return value.length;
  }

  // Hive counts title bytes. Keep whole characters and stop at PUBLISH_TITLE_MAX.
  function clampPublishTitle(text) {
    const value = String(text || "").replace(/\r\n|\r|\n/g, " ");
    if (!value || utf8Size(value) <= PUBLISH_TITLE_MAX) return value;
    let out = "";
    let bytes = 0;
    for (const ch of value) {
      const n = utf8Size(ch);
      if (bytes + n > PUBLISH_TITLE_MAX) break;
      out += ch;
      bytes += n;
    }
    return out;
  }

  function enforcePublishTitleLimit(input) {
    if (!input) return "";
    const raw = String(input.value || "");
    const next = clampPublishTitle(raw);
    if (next !== raw) {
      const start = input.selectionStart;
      const end = input.selectionEnd;
      input.value = next;
      if (typeof input.setSelectionRange === "function") {
        const caret = Math.min(start == null ? next.length : start, next.length);
        const caretEnd = Math.min(end == null ? caret : end, next.length);
        input.setSelectionRange(Math.min(caret, caretEnd), Math.max(caret, caretEnd));
      }
    }
    fitPublishTitle(input);
    paintPublishTitleCount();
    return next;
  }

  let publishTitleMirror = null;

  function publishTitleLineHeight(el) {
    const line = parseFloat(getComputedStyle(el).lineHeight);
    return line > 0 ? line : 0;
  }

  function publishTitleContentWidth(el) {
    const cs = getComputedStyle(el);
    const padL = parseFloat(cs.paddingLeft) || 0;
    const padR = parseFloat(cs.paddingRight) || 0;
    return Math.max(0, el.clientWidth - padL - padR);
  }

  function publishTitleLastLineWidth(el) {
    const value = String(el.value || "");
    const width = publishTitleContentWidth(el);
    if (!value || width <= 0) return 0;
    const cs = getComputedStyle(el);
    let mirror = publishTitleMirror;
    if (!mirror) {
      mirror = document.createElement("div");
      mirror.setAttribute("aria-hidden", "true");
      mirror.style.position = "fixed";
      mirror.style.left = "0";
      mirror.style.top = "0";
      mirror.style.visibility = "hidden";
      mirror.style.pointerEvents = "none";
      mirror.style.boxSizing = "content-box";
      mirror.style.padding = "0";
      mirror.style.border = "0";
      mirror.style.minHeight = "0";
      mirror.style.whiteSpace = "pre-wrap";
      document.body.appendChild(mirror);
      publishTitleMirror = mirror;
    }
    mirror.style.width = width + "px";
    mirror.style.font = cs.font;
    mirror.style.letterSpacing = cs.letterSpacing;
    mirror.style.wordSpacing = cs.wordSpacing;
    mirror.style.lineHeight = cs.lineHeight;
    mirror.style.whiteSpace = cs.whiteSpace || "pre-wrap";
    mirror.style.overflowWrap = cs.overflowWrap || "break-word";
    mirror.style.wordBreak = cs.wordBreak || "normal";
    mirror.textContent = value;
    const range = document.createRange();
    range.selectNodeContents(mirror);
    const rects = range.getClientRects();
    if (!rects.length) return 0;
    let lineTop = rects[0].top;
    for (let i = 1; i < rects.length; i++) {
      if (rects[i].top > lineTop) lineTop = rects[i].top;
    }
    let left = Infinity;
    let right = -Infinity;
    for (let i = 0; i < rects.length; i++) {
      const rect = rects[i];
      if (rect.top < lineTop - 1) continue;
      if (rect.left < left) left = rect.left;
      if (rect.right > right) right = rect.right;
    }
    return right > left ? right - left : 0;
  }

  // Distance from the content's right edge to where the last line should stop
  // so it stays clear of the ring. Zero while the ring is hidden.
  function publishTitleRingKeepClear(el) {
    const ring = $("#publishTitleCount");
    if (!ring || ring.hidden) return 0;
    const ringRect = ring.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    if (ringRect.width <= 0 || elRect.width <= 0) return 0;
    const cs = getComputedStyle(el);
    const padR = parseFloat(cs.paddingRight) || 0;
    const borderRight = Math.max(0, el.offsetWidth - el.clientWidth - el.clientLeft);
    const contentRight = elRect.right - borderRight - padR;
    const gap = (parseFloat(cs.fontSize) || 16) * 0.45;
    const clear = contentRight - ringRect.left + gap;
    return clear > 0 ? clear : 0;
  }

  function fitPublishTitle(input) {
    const el = input || $("#publishTitle");
    if (!el || el.hidden) return;
    const overlay = $("#publishOverlay");
    if (overlay && overlay.hidden) return;
    const line = publishTitleLineHeight(el);
    const before = el.offsetHeight;
    el.style.height = "auto";
    let border = el.offsetHeight - el.clientHeight;
    if (border < 0) border = 0;
    el.style.height = el.scrollHeight + border + "px";
    if (el.scrollHeight > el.clientHeight) {
      el.style.height = el.offsetHeight + (el.scrollHeight - el.clientHeight) + "px";
    }
    const fitted = el.offsetHeight;
    const hadExtra = line > 0 && before >= fitted + line - 1;
    paintPublishTitleCount();
    const ring = $("#publishTitleCount");
    const showRing = Boolean(ring && !ring.hidden);
    const value = String(el.value || "");
    const contentWidth = publishTitleContentWidth(el);
    const last = showRing ? publishTitleLastLineWidth(el) : 0;
    const keep = showRing ? publishTitleRingKeepClear(el) : 0;
    const slack = hadExtra && showRing ? 6 : 0;
    const extra = showRing && contentWidth > 0 && keep > 0 && last > contentWidth - keep - slack;
    el.classList.toggle("is-ring-line", extra);
    if (extra && line > 0) el.style.height = fitted + line + "px";
  }

  function applyPublishForm(state) {
    publishTitleDraft = clampPublishTitle((state && state.title) || "");
    publishBodyDraft = (state && state.body) || "";
    publishTags = Array.isArray(state && state.tags) ? state.tags.slice() : [];
    if (state && state.dest) {
      publishDest = {
        type: state.dest.type === "community" && state.dest.name ? "community" : "blog",
        name: state.dest.type === "community" ? state.dest.name : "",
        title:
          state.dest.title ||
          (state.dest.type === "community" ? state.dest.name : "My cyberspace"),
      };
      if (!publishEdit && publishDest.type !== "community") {
        cancelPublishCommunityCheck();
        setPublishDestNote("");
      }
    }
    const title = $("#publishTitle");
    const body = $("#publishBody");
    const tagInput = $("#publishTagInput");
    if (title) {
      title.value = publishTitleDraft;
      fitPublishTitle(title);
    }
    paintPublishTitleCount();
    if (body) body.value = publishBodyDraft;
    if (tagInput) tagInput.value = (state && state.tagInput) || "";
    applyPublishAdvanced(state);
    const savedBeneficiary = normalizeLoginUser(state && state.communityBeneficiary);
    if (
      !publishEdit &&
      publishDest.type === "community" &&
      validLoginUser(savedBeneficiary)
    ) {
      publishCommunityBeneficiary = {
        community: normalizeCommunityName(publishDest.name),
        account: savedBeneficiary,
      };
    }
    paintPublishDest();
    paintPublishTags();
    setPublishStatus("");
    updatePublishPreview();
  }

  function normalizeTag(raw) {
    return String(raw || "")
      .trim()
      .toLowerCase()
      .replace(/^#/, "")
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 24);
  }

  function isValidTag(tag) {
    return /^[a-z][a-z0-9-]{1,23}$/.test(tag);
  }

  function postPermlink(title) {
    let slug = String(title || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
    if (!slug) slug = "post";
    return slug + "-" + Date.now().toString(36);
  }

  // My cyberspace uses the account avatar. No profile picture, and no
  // signed-in account, both use the small satoshi mark.
  function blogDestAvatarSrc() {
    const user = observer();
    return user ? sessionAvatarSrc(user) : AVATAR_DEFAULT_SMALL;
  }

  function paintPublishBlogAvatar() {
    const src = blogDestAvatarSrc();
    const onBlog = !(publishDest.type === "community" && publishDest.name);
    const btnImg = $("#publishDestAvatar");
    if (btnImg && onBlog && btnImg.getAttribute("src") !== src) btnImg.src = src;
    const menu = $("#publishDestMenu");
    if (!menu) return;
    const opt = menu.querySelector('.publish-dest-option[data-dest-type="blog"] .avatar');
    if (opt && opt.getAttribute("src") !== src) opt.src = src;
  }

  function paintPublishDest() {
    const img = $("#publishDestAvatar");
    const nameEl = $("#publishDestName");
    if (!img || !nameEl) return;
    if (publishDest.type === "community" && publishDest.name) {
      img.src = HiveMd.avatarUrl(publishDest.name, "small");
      nameEl.textContent = publishDest.title || publishDest.name;
    } else {
      img.src = blogDestAvatarSrc();
      nameEl.textContent = "My cyberspace";
    }
  }

  function destOptionHtml(name, title, avatarSrc, selected) {
    return `<button type="button" class="publish-dest-option${selected ? " is-selected" : ""}" data-dest-type="${name ? "community" : "blog"}" data-dest-name="${HiveMd.escapeHtml(name)}" data-dest-title="${HiveMd.escapeHtml(title)}" role="option">
        <img class="avatar" src="${HiveMd.escapeHtml(avatarSrc)}" alt="" width="24" height="24">
        <span>${HiveMd.escapeHtml(title)}</span>
      </button>`;
  }

  function notePublishCommunityTitle(id, title) {
    const next = String(title || "").trim();
    if (!id || !next) return;
    if (publishDest.type === "community" && normalizeCommunityName(publishDest.name) === id) {
      if (publishDest.title !== next || publishDest.name !== id) {
        publishDest = { type: "community", name: id, title: next };
        paintPublishDest();
      }
    }
    if (
      publishPinnedCommunity &&
      normalizeCommunityName(publishPinnedCommunity.name) === id &&
      publishPinnedCommunity.title !== next
    ) {
      publishPinnedCommunity = { name: id, title: next };
    }
  }

  function renderDestMenu() {
    const menu = $("#publishDestMenu");
    if (!menu) return;
    const selectedName =
      publishDest.type === "community" ? normalizeCommunityName(publishDest.name) : "";
    publishSubs.forEach((c) => {
      const id = normalizeCommunityName(c.name);
      const pinnedId = publishPinnedCommunity
        ? normalizeCommunityName(publishPinnedCommunity.name)
        : "";
      if (id && c.title && (id === selectedName || id === pinnedId)) {
        notePublishCommunityTitle(id, c.title);
      }
    });
    const blogSelected = publishDest.type !== "community";
    const parts = [destOptionHtml("", "My cyberspace", blogDestAvatarSrc(), blogSelected)];
    const seen = new Set();
    publishSubs.forEach((c) => {
      const id = normalizeCommunityName(c.name);
      if (id) seen.add(id);
      const selected = Boolean(selectedName) && id === selectedName;
      parts.push(destOptionHtml(c.name, c.title || c.name, HiveMd.avatarUrl(c.name, "small"), selected));
    });
    const extras = [];
    function pushExtra(name, title) {
      const id = normalizeCommunityName(name);
      if (!id || seen.has(id)) return;
      seen.add(id);
      extras.push(destOptionHtml(id, title || id, HiveMd.avatarUrl(id, "small"), selectedName === id));
    }
    if (publishPinnedCommunity) {
      pushExtra(publishPinnedCommunity.name, publishPinnedCommunity.title);
    }
    if (selectedName) pushExtra(publishDest.name, publishDest.title);
    if (extras.length) parts.splice(1, 0, extras.join(""));
    menu.innerHTML = parts.join("");
  }

  async function loadPublishSubs() {
    const user = observer();
    if (!user) {
      publishSubs = [];
      publishSubsUser = "";
      renderDestMenu();
      return;
    }
    if (publishSubsUser === user) {
      renderDestMenu();
      return;
    }
    const menu = $("#publishDestMenu");
    if (menu && !publishSubs.length) {
      const pinned =
        publishPinnedCommunity ||
        (publishDest.type === "community" && publishDest.name);
      if (pinned) renderDestMenu();
      else menu.innerHTML = `<p class="publish-dest-empty">Loading communities…</p>`;
    }
    try {
      const list = await HiveApi.listAllSubscriptions(user);
      if (observer() !== user) return;
      publishSubs = list.slice().sort((a, b) =>
        String(a.title || a.name).localeCompare(String(b.title || b.name))
      );
      publishSubsUser = user;
    } catch {
      if (observer() !== user) return;
      publishSubs = [];
      publishSubsUser = "";
    }
    renderDestMenu();
  }

  function destMenuOpen() {
    const menu = $("#publishDestMenu");
    return Boolean(menu && !menu.hidden);
  }

  function closeDestMenu() {
    const menu = $("#publishDestMenu");
    const btn = $("#publishDestBtn");
    if (menu) menu.hidden = true;
    if (btn) btn.setAttribute("aria-expanded", "false");
  }

  function toggleDestMenu() {
    if (publishEdit) return;
    const menu = $("#publishDestMenu");
    const btn = $("#publishDestBtn");
    if (!menu || !btn) return;
    const open = menu.hidden;
    if (open) closeMdMenu();
    menu.hidden = !open;
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) loadPublishSubs();
  }

  function blogPublishDest() {
    return { type: "blog", name: "", title: "My cyberspace" };
  }

  function copyPublishDest(dest) {
    const name = dest && dest.type === "community" ? normalizeCommunityName(dest.name) : "";
    if (!name) return blogPublishDest();
    const label = String((dest && dest.title) || "").trim() || name;
    return { type: "community", name: name, title: label };
  }

  function cancelPublishCommunityCheck() {
    publishAccessSeq += 1;
  }

  function paintPublishDestNote() {
    const note = $("#publishDestNote");
    if (!note) return;
    const show = Boolean(publishDestNote) && !publishEdit;
    note.hidden = !show;
    note.textContent = show ? publishDestNote : "";
    note.classList.remove("is-error");
  }

  function setPublishDestNote(message) {
    publishDestNote = String(message || "");
    paintPublishDestNote();
  }

  // The subspace stays selected. The note under it is a warning. Publish still sends.
  function holdPublishCommunity(id, title, message) {
    const label = String(title || "").trim() || id;
    publishDest = { type: "community", name: id, title: label };
    notePublishCommunityTitle(id, label);
    paintPublishDest();
    renderDestMenu();
    schedulePublishDraftSave();
    setPublishStatus("");
    setPublishDestNote(message);
  }

  // Topic posts are open. Journal and council posts need a member role or higher.
  // One request per selection. A refusal only paints the note. Publish still sends.
  function ensurePublishCommunity(name, title) {
    const id = normalizeCommunityName(name);
    const user = observer();
    const seq = ++publishAccessSeq;
    if (!id || !user || publishEdit) return Promise.resolve(false);
    const fallbackTitle = String(title || "").trim() || id;
    // The rights check stays silent. A refusal paints the gray note when the call returns.
    setPublishDestNote("");
    setPublishStatus("");
    return HiveApi.getCommunity(id, user)
      .then((info) => {
        if (seq !== publishAccessSeq) return false;
        if (observer() !== user) return false;
        if (!info || !info.name) {
          holdPublishCommunity(
            id,
            fallbackTitle,
            "Could not check whether you can post in " + fallbackTitle + "."
          );
          return false;
        }
        const nextTitle = String(info.title || "").trim() || fallbackTitle;
        if (!communityAllowsPost(info)) {
          holdPublishCommunity(id, nextTitle, communityPostDeniedMessage(info, nextTitle));
          return false;
        }
        publishDest = { type: "community", name: id, title: nextTitle };
        notePublishCommunityTitle(id, nextTitle);
        paintPublishDest();
        renderDestMenu();
        schedulePublishDraftSave();
        setPublishDestNote("");
        setPublishStatus("");
        return true;
      })
      .catch(() => {
        if (seq !== publishAccessSeq) return false;
        holdPublishCommunity(
          id,
          fallbackTitle,
          "Could not check whether you can post in " + fallbackTitle + "."
        );
        return false;
      });
  }

  function syncPublishCommunityAccess() {
    if (publishEdit) return;
    const id = publishDest.type === "community" ? normalizeCommunityName(publishDest.name) : "";
    if (!id) {
      cancelPublishCommunityCheck();
      publishDest = blogPublishDest();
      paintPublishDest();
      setPublishDestNote("");
      return;
    }
    ensurePublishCommunity(id, publishDest.title);
  }

  function forgetPublishCommunityBeneficiary() {
    publishBeneficiarySeq += 1;
    publishCommunityBeneficiary = null;
  }

  function publishBeneficiaryRowsEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i].account !== b[i].account || a[i].percent !== b[i].percent) return false;
    }
    return true;
  }

  // Drop the required-beneficiary row from the subspace we just left.
  function clearPublishCommunityBeneficiary() {
    const tracked = publishCommunityBeneficiary;
    publishBeneficiarySeq += 1;
    publishCommunityBeneficiary = null;
    if (!tracked || !tracked.account || publishEdit) return;
    const rows = readPublishBeneficiaryRows();
    let removed = false;
    const next = [];
    for (let i = 0; i < rows.length; i++) {
      if (!removed && normalizeLoginUser(rows[i].account) === tracked.account) {
        removed = true;
        continue;
      }
      next.push(rows[i]);
    }
    if (!removed) return;
    paintPublishBeneficiaries(next);
    schedulePublishDraftSave();
  }

  function placePublishCommunityBeneficiary(community, account, percent) {
    if (publishEdit) return;
    if (publishDest.type !== "community" || normalizeCommunityName(publishDest.name) !== community) return;
    const rows = readPublishBeneficiaryRows();
    const tracked = publishCommunityBeneficiary;
    const drop = tracked && tracked.account && tracked.account !== account ? tracked.account : "";
    const list = [];
    let removed = false;
    for (let i = 0; i < rows.length; i++) {
      if (drop && !removed && normalizeLoginUser(rows[i].account) === drop) {
        removed = true;
        continue;
      }
      list.push({ account: rows[i].account, percent: rows[i].percent });
    }
    const idx = list.findIndex((row) => normalizeLoginUser(row.account) === account);
    if (idx === -1) list.unshift({ account: account, percent: percent });
    else if (idx > 0) {
      const row = list[idx];
      if (!String(row.percent || "").trim()) row.percent = percent;
      list.splice(idx, 1);
      list.unshift(row);
    } else if (!String(list[0].percent || "").trim()) {
      list[0] = { account: list[0].account || account, percent: percent };
    }
    publishCommunityBeneficiary = { community: community, account: account };
    if (publishBeneficiaryRowsEqual(rows, list)) return;
    paintPublishBeneficiaries(list);
    schedulePublishDraftSave();
  }

  // posting_json_metadata.profile.beneficiary on the subspace account.
  // Silent. A late reply is dropped when the selection has already changed.
  function requestPublishCommunityBeneficiary(communityId, opts) {
    const force = Boolean(opts && opts.force);
    if (publishEdit) return;
    const id = normalizeCommunityName(communityId);
    if (!id) {
      clearPublishCommunityBeneficiary();
      return;
    }
    if (
      !force &&
      publishCommunityBeneficiary &&
      publishCommunityBeneficiary.community === id
    ) {
      return;
    }
    if (publishCommunityBeneficiary && publishCommunityBeneficiary.community !== id) {
      clearPublishCommunityBeneficiary();
    }
    const seq = ++publishBeneficiarySeq;
    if (!window.HiveApi || typeof HiveApi.getAccounts !== "function") return;
    HiveApi.getAccounts([id])
      .then((accounts) => {
        if (seq !== publishBeneficiarySeq || publishEdit) return;
        if (publishDest.type !== "community" || normalizeCommunityName(publishDest.name) !== id) return;
        const row = accounts && accounts[0];
        if (!row || normalizeLoginUser(row.name) !== id) {
          clearPublishCommunityBeneficiary();
          return;
        }
        const fields = communityBeneficiaryFields(communityPostingMetadata(row));
        if (!fields.beneficiary_account) {
          clearPublishCommunityBeneficiary();
          return;
        }
        placePublishCommunityBeneficiary(id, fields.beneficiary_account, fields.beneficiary_percent);
      })
      .catch(() => {
        /* Leave the rows already on the form. */
      });
  }

  function selectPublishDest(type, name, title) {
    if (publishEdit) return;
    closeDestMenu();
    const id = type === "community" ? normalizeCommunityName(name) : "";
    if (!id) {
      cancelPublishCommunityCheck();
      publishDest = blogPublishDest();
      paintPublishDest();
      renderDestMenu();
      schedulePublishDraftSave();
      setPublishStatus("");
      setPublishDestNote("");
      requestPublishCommunityBeneficiary("");
      return;
    }
    const pendingTitle = String(title || "").trim() || id;
    publishDest = { type: "community", name: id, title: pendingTitle };
    paintPublishDest();
    renderDestMenu();
    ensurePublishCommunity(id, pendingTitle);
    requestPublishCommunityBeneficiary(id, { force: true });
  }

  function paintPublishTags() {
    const chips = $("#publishTagChips");
    const count = $("#publishTagCount");
    const input = $("#publishTagInput");
    if (chips) {
      chips.innerHTML = publishTags
        .map(
          (t) =>
            `<button type="button" class="publish-tag-chip" data-tag="${HiveMd.escapeHtml(t)}">${HiveMd.escapeHtml(t)} <span aria-hidden="true">×</span></button>`
        )
        .join("");
    }
    if (count) count.textContent = publishTags.length + "/" + MAX_TAGS;
    if (input) {
      input.disabled = publishTags.length >= MAX_TAGS;
      if (publishTags.length >= MAX_TAGS) input.placeholder = "Tag limit reached";
      else input.placeholder = "Add a tag";
    }
  }

  function addPublishTag(raw) {
    const tag = normalizeTag(raw);
    if (!tag) return false;
    if (!isValidTag(tag)) {
      setPublishStatus("Tags use 2–24 letters, numbers, or hyphens.", true);
      return false;
    }
    if (publishTags.indexOf(tag) !== -1) return false;
    if (publishTags.length >= MAX_TAGS) {
      setPublishStatus("You can add up to 10 tags.", true);
      return false;
    }
    publishTags.push(tag);
    setPublishStatus("");
    paintPublishTags();
    schedulePublishDraftSave();
    return true;
  }

  function takeTagsFromInput() {
    const input = $("#publishTagInput");
    if (!input) return;
    const parts = String(input.value || "").split(/[,\s]+/);
    input.value = "";
    parts.forEach((p) => addPublishTag(p));
  }

  function collapsePublishAdvanced() {
    const el = $("#publishAdvanced");
    if (el) el.open = false;
  }

  function openPublishAdvanced() {
    const el = $("#publishAdvanced");
    if (el) el.open = true;
  }

  function readPublishDescription() {
    const el = $("#publishDescription");
    return el ? String(el.value || "") : "";
  }

  function normalizedPublishDescription() {
    return readPublishDescription().replace(/\s+/g, " ").trim().slice(0, PUBLISH_DESC_MAX);
  }

  function descriptionFromPost(post) {
    const meta = HiveMd.parseJsonMetadata(post && post.json_metadata);
    const text = meta && typeof meta.description === "string" ? meta.description : "";
    return text.replace(/\s+/g, " ").trim().slice(0, PUBLISH_DESC_MAX);
  }

  function normalizePublishReward(value) {
    if (value === "hp" || value === "burned" || value === "decline") return value;
    return "default";
  }

  function readPublishReward() {
    const el = $("#publishReward");
    return normalizePublishReward(el ? el.value : "default");
  }

  function publishRewardNoteText(value) {
    const reward = normalizePublishReward(value);
    if (reward === "hp") return "All author rewards are paid in hive power (staked hive).";
    if (reward === "burned") {
      return "Author rewards are burned, curators can still earn curation rewards.";
    }
    if (reward === "decline") return "Both author and curation rewards are declined.";
    return "* Author rewards are paid as 50% HP and 50% liquid hbd or hive.";
  }

  function paintPublishRewardNote() {
    const note = document.querySelector(".publish-reward-note");
    if (note) note.textContent = publishRewardNoteText(readPublishReward());
  }

  function readPublishBeneficiaryRows() {
    const root = $("#publishBeneficiaryRows");
    if (!root) return [];
    return Array.from(root.querySelectorAll(".publish-beneficiary-row")).map((row) => {
      const user = row.querySelector(".publish-beneficiary-user");
      const pct = row.querySelector(".publish-beneficiary-pct");
      return {
        account: user ? String(user.value || "") : "",
        percent: pct ? String(pct.value || "") : "",
      };
    });
  }

  function beneficiariesFromStored(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    raw.forEach((item) => {
      // One past the chain limit so a subspace beneficiary can be prepended
      // in front of eight rows that were already filled in.
      if (!item || typeof item !== "object" || out.length >= MAX_BENEFICIARIES + 1) return;
      const account = typeof item.account === "string" ? item.account : "";
      let percent = "";
      if (typeof item.percent === "string") percent = item.percent;
      else if (typeof item.percent === "number" && Number.isFinite(item.percent)) percent = String(item.percent);
      out.push({ account: account.slice(0, 16), percent: percent.slice(0, 8) });
    });
    return out;
  }

  function paintPublishBeneficiaries(rows) {
    const root = $("#publishBeneficiaryRows");
    const add = $("#publishBeneficiaryAdd");
    if (!root) return;
    const list = beneficiariesFromStored(rows);
    root.innerHTML = list
      .map((row, i) => {
        const n = i + 1;
        return `<div class="publish-beneficiary-row">
          <input class="publish-beneficiary-user" type="text" maxlength="16" placeholder="Username" autocomplete="off" spellcheck="false" autocapitalize="off" value="${HiveMd.escapeHtml(row.account)}" aria-label="Beneficiary username ${n}">
          <input class="publish-beneficiary-pct" type="text" inputmode="decimal" maxlength="8" placeholder="Reward (%)" autocomplete="off" spellcheck="false" value="${HiveMd.escapeHtml(row.percent)}" aria-label="Reward percent ${n}">
          <button type="button" class="publish-beneficiary-remove" aria-label="Remove beneficiary">×</button>
        </div>`;
      })
      .join("");
    if (add) add.disabled = list.length >= MAX_BENEFICIARIES;
  }

  function publishAdvancedState() {
    return {
      description: readPublishDescription(),
      reward: readPublishReward(),
      beneficiaries: readPublishBeneficiaryRows(),
    };
  }

  function applyPublishAdvanced(state) {
    forgetPublishCommunityBeneficiary();
    const desc = $("#publishDescription");
    if (desc) {
      const text = state && typeof state.description === "string" ? state.description : "";
      desc.value = text.slice(0, PUBLISH_DESC_MAX);
    }
    const reward = $("#publishReward");
    if (reward) {
      const value = normalizePublishReward(state && state.reward);
      reward.value = value;
    }
    paintPublishRewardNote();
    paintPublishBeneficiaries(state && state.beneficiaries);
  }

  function publishAdvancedDirty() {
    if (normalizedPublishDescription()) return true;
    if (readPublishReward() !== "default") return true;
    return readPublishBeneficiaryRows().some((row) => {
      return String(row.account || "").trim() || String(row.percent || "").trim();
    });
  }

  function addPublishBeneficiaryRow() {
    const rows = readPublishBeneficiaryRows();
    if (rows.length >= MAX_BENEFICIARIES) {
      openPublishAdvanced();
      setPublishStatus("You can add up to 8 beneficiaries.", true);
      return;
    }
    rows.push({ account: "", percent: "" });
    paintPublishBeneficiaries(rows);
    const inputs = document.querySelectorAll("#publishBeneficiaryRows .publish-beneficiary-user");
    const last = inputs[inputs.length - 1];
    if (last) last.focus();
    setPublishStatus("");
    schedulePublishDraftSave();
  }

  function removePublishBeneficiaryRow(btn) {
    const row = btn && btn.closest ? btn.closest(".publish-beneficiary-row") : null;
    if (row) row.remove();
    const add = $("#publishBeneficiaryAdd");
    const rows = readPublishBeneficiaryRows();
    if (add) {
      add.disabled = rows.length >= MAX_BENEFICIARIES;
      if (!rows.length) add.focus();
    }
    setPublishStatus("");
    schedulePublishDraftSave();
  }

  function parseBeneficiaryPercent(raw) {
    let text = String(raw || "")
      .trim()
      .replace(/%/g, "");
    if (text.indexOf(",") !== -1 && text.indexOf(".") === -1) text = text.replace(",", ".");
    text = text.trim();
    if (!/^(?:\d{1,3}(?:\.\d{1,2})?|\.\d{1,2})$/.test(text)) return null;
    const n = Number(text);
    if (!Number.isFinite(n) || n <= 0 || n > 100) return null;
    const weight = Math.round(n * 100);
    if (weight < 1 || weight > 10000) return null;
    return weight;
  }

  function collectPublishBeneficiaries(author) {
    const rows = readPublishBeneficiaryRows();
    const out = [];
    const seen = new Set();
    let sum = 0;
    for (let i = 0; i < rows.length; i++) {
      const accountRaw = String(rows[i].account || "").trim();
      const percentRaw = String(rows[i].percent || "").trim();
      if (!accountRaw && !percentRaw) continue;
      if (!accountRaw || !percentRaw) {
        return { error: "Enter a username and a reward percent for each beneficiary." };
      }
      const account = normalizeLoginUser(accountRaw);
      if (!validLoginUser(account)) {
        return { error: "Enter a valid Hive username for each beneficiary." };
      }
      if (author && account === author) {
        return { error: "You cannot be a beneficiary of your own post." };
      }
      if (seen.has(account)) {
        return { error: "Each beneficiary can only be listed once." };
      }
      const weight = parseBeneficiaryPercent(percentRaw);
      if (weight == null) {
        return {
          error: "Reward percent must be greater than 0 and at most 100, with up to two decimals.",
        };
      }
      seen.add(account);
      sum += weight;
      if (sum > 10000) {
        return { error: "Beneficiary rewards cannot add up to more than 100%." };
      }
      out.push({ account, weight });
    }
    if (out.length > MAX_BENEFICIARIES) {
      return { error: "You can add up to 8 beneficiaries." };
    }
    return { beneficiaries: out };
  }

  function buildCommentOptions(author, permlink, reward, beneficiaries) {
    const burned = reward === "burned";
    const decline = reward === "decline";
    const hp = reward === "hp";
    const routes = Array.isArray(beneficiaries) ? beneficiaries.slice() : [];
    if (burned) routes.push({ account: "null", weight: 10000 });
    if (!burned && !decline && !hp && !routes.length) return null;
    const options = {
      author,
      permlink,
      max_accepted_payout: decline ? "0.000 HBD" : "1000000.000 HBD",
      percent_hbd: hp ? 0 : 10000,
      allow_votes: true,
      allow_curation_rewards: true,
      extensions: [],
    };
    if (routes.length) {
      const sorted = routes
        .slice()
        .sort((a, b) => (a.account < b.account ? -1 : a.account > b.account ? 1 : 0));
      options.extensions = [
        [
          0,
          {
            beneficiaries: sorted.map((row) => ({
              account: row.account,
              weight: row.weight,
            })),
          },
        ],
      ];
    }
    return options;
  }

  let publishTitleDraft = "";
  let publishBodyDraft = "";
  let locSession = 0;
  let locCenter = { lat: 20, lng: 0 };
  let locView = { lat: 20, lng: 0 };
  let locZoom = 2;
  let locPicked = false;
  let locDescAuto = true;
  let locRevSeq = 0;
  let locHadSaved = false;
  let locSearchAbort = null;
  let locSuggests = [];
  let locSuggestActive = -1;
  let locMap = null;
  let locMarker = null;
  let locMapLibre = null;
  let maplibrePromise = null;
  const LOCATION_MIN_ZOOM = -2;
  const LOCATION_MAX_ZOOM = 18;
  // Northern edge kept inside the empty world frame so Canada and Russia stay visible.
  const LOCATION_WORLD_NORTH = 74;
  const LOCATION_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
  const MAPLIBRE_JS = "https://cdn.jsdelivr.net/npm/maplibre-gl@6.13.0/dist/maplibre-gl.mjs";
  const MAPLIBRE_CSS = "https://cdn.jsdelivr.net/npm/maplibre-gl@6.13.0/dist/maplibre-gl.css";

  function savePublishDraft() {
    const title = $("#publishTitle");
    const body = $("#publishBody");
    if (title) publishTitleDraft = title.value;
    if (body) publishBodyDraft = body.value;
  }

  function publishDraftStorageKey() {
    const user = observer();
    return user ? PUBLISH_DRAFT_KEY + ":" + user : "";
  }

  function publishFormHasContent() {
    savePublishDraft();
    const tagInput = $("#publishTagInput");
    const tagDraft = tagInput ? String(tagInput.value || "").trim() : "";
    return Boolean(
      String(publishTitleDraft || "").trim() ||
        String(publishBodyDraft || "").trim() ||
        publishTags.length ||
        tagDraft ||
        publishAdvancedDirty()
    );
  }

  function readStoredPublishDraft() {
    const key = publishDraftStorageKey();
    if (!key) return null;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      const title = typeof parsed.title === "string" ? parsed.title : "";
      const body = typeof parsed.body === "string" ? parsed.body : "";
      const tagInput = typeof parsed.tagInput === "string" ? parsed.tagInput : "";
      const tags = Array.isArray(parsed.tags)
        ? parsed.tags.filter((t) => typeof t === "string" && t)
        : [];
      const dest =
        parsed.dest && typeof parsed.dest === "object"
          ? {
              type: parsed.dest.type,
              name: parsed.dest.name,
              title: parsed.dest.title,
            }
          : null;
      const description = typeof parsed.description === "string" ? parsed.description : "";
      const reward = normalizePublishReward(parsed.reward);
      const beneficiaries = beneficiariesFromStored(parsed.beneficiaries);
      const communityBeneficiary = normalizeLoginUser(parsed.communityBeneficiary);
      if (
        !title &&
        !body &&
        !tagInput &&
        !tags.length &&
        !dest &&
        !description.trim() &&
        reward === "default" &&
        !beneficiaries.length
      ) {
        return null;
      }
      return {
        title,
        body,
        tags,
        dest,
        tagInput,
        description,
        reward,
        beneficiaries,
        communityBeneficiary: validLoginUser(communityBeneficiary) ? communityBeneficiary : "",
      };
    } catch {
      return null;
    }
  }

  function storePublishDraft(state) {
    const key = publishDraftStorageKey();
    if (!key || !state) return;
    try {
      localStorage.setItem(
        key,
        JSON.stringify({
          title: state.title || "",
          body: state.body || "",
          tags: Array.isArray(state.tags) ? state.tags : [],
          dest: state.dest || null,
          tagInput: state.tagInput || "",
          description: state.description || "",
          reward: normalizePublishReward(state.reward),
          beneficiaries: Array.isArray(state.beneficiaries) ? state.beneficiaries : [],
          communityBeneficiary: validLoginUser(normalizeLoginUser(state.communityBeneficiary))
            ? normalizeLoginUser(state.communityBeneficiary)
            : "",
        })
      );
    } catch {
      /* ignore quota / private mode */
    }
  }

  function clearStoredPublishDraft() {
    const key = publishDraftStorageKey();
    if (!key) return;
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }

  function persistPublishDraftNow() {
    if (publishEdit) return;
    savePublishDraft();
    if (!publishFormHasContent()) {
      const ov = $("#publishOverlay");
      if (ov && !ov.hidden) clearStoredPublishDraft();
      return;
    }
    storePublishDraft(snapshotPublishForm());
  }

  function schedulePublishDraftSave() {
    if (publishEdit) return;
    if (publishDraftSaveSoon) clearTimeout(publishDraftSaveSoon);
    publishDraftSaveSoon = setTimeout(() => {
      publishDraftSaveSoon = 0;
      persistPublishDraftNow();
    }, 1000);
  }

  function stopPublishDraftAutosave() {
    if (publishDraftTimer) {
      clearInterval(publishDraftTimer);
      publishDraftTimer = 0;
    }
    if (publishDraftSaveSoon) {
      clearTimeout(publishDraftSaveSoon);
      publishDraftSaveSoon = 0;
    }
  }

  function startPublishDraftAutosave() {
    stopPublishDraftAutosave();
    if (publishEdit) return;
    publishDraftTimer = setInterval(persistPublishDraftNow, PUBLISH_DRAFT_SAVE_MS);
  }

  function hydratePublishDraftFromStorage() {
    if (publishEdit) return;
    const stored = readStoredPublishDraft();
    if (stored) applyPublishForm(stored);
  }

  function commentDraftStorageKey() {
    const user = observer();
    return user ? COMMENT_DRAFT_KEY + ":" + user : "";
  }

  function commentDraftPageUrl() {
    let path = currentPath() || "/";
    path = path.split("#")[0].split("?")[0];
    if (path.length > 1) path = path.replace(/\/+$/, "");
    return path || "/";
  }

  function isRootCommentComposer(composer) {
    const section = document.getElementById("comments");
    return Boolean(composer && section && composer.parentElement === section);
  }

  function commentDraftTarget(composer) {
    const parentAuthor = String((composer && composer.getAttribute("data-parent-author")) || "")
      .replace(/^@/, "")
      .trim();
    const parentPermlink = String((composer && composer.getAttribute("data-parent-permlink")) || "").trim();
    let position = "";
    if (isRootCommentComposer(composer)) position = "root";
    else if (parentAuthor && parentPermlink) position = "@" + parentAuthor + "/" + parentPermlink;
    return { position, parentAuthor, parentPermlink };
  }

  function sameDraftParent(stored, target) {
    if (!stored || !target || stored.position !== target.position) return false;
    const storedAuthor = String(stored.parentAuthor || "").replace(/^@/, "").toLowerCase();
    const targetAuthor = String(target.parentAuthor || "").replace(/^@/, "").toLowerCase();
    if (!storedAuthor || storedAuthor !== targetAuthor) return false;
    const storedPerm = String(stored.parentPermlink || "");
    const targetPerm = String(target.parentPermlink || "");
    return storedPerm === targetPerm || storedPerm.toLowerCase() === targetPerm.toLowerCase();
  }

  function commentDraftMatchesPage(draft) {
    if (!draft || !draft.url) return false;
    const here = commentDraftPageUrl();
    if (draft.url === here) return true;
    const route = parseRoute();
    const saved = parseRoute(draft.url);
    if (!route || route.name !== "post" || !saved || saved.name !== "post") return false;
    return saved.author === route.author && String(saved.permlink) === String(route.permlink);
  }

  function readStoredCommentDraft() {
    const key = commentDraftStorageKey();
    if (!key) return null;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      const url = typeof parsed.url === "string" ? parsed.url : "";
      const position = parsed.position === "root" ? "root" : typeof parsed.position === "string" ? parsed.position : "";
      const parentAuthor = String(parsed.parentAuthor || "").replace(/^@/, "").trim();
      const parentPermlink = String(parsed.parentPermlink || "").trim();
      const body = typeof parsed.body === "string" ? parsed.body : "";
      if (!url || !body.trim() || !parentAuthor || !parentPermlink) return null;
      if (position !== "root" && position.charAt(0) !== "@") return null;
      return { url, position, parentAuthor, parentPermlink, body };
    } catch {
      return null;
    }
  }

  function storeCommentDraft(state) {
    const key = commentDraftStorageKey();
    if (!key || !state || !String(state.body || "").trim()) return;
    try {
      localStorage.setItem(
        key,
        JSON.stringify({
          url: state.url || "",
          position: state.position || "",
          parentAuthor: state.parentAuthor || "",
          parentPermlink: state.parentPermlink || "",
          body: state.body,
        })
      );
    } catch {
      /* ignore quota / private mode */
    }
  }

  function stopCommentDraftAutosave() {
    if (commentDraftTimer) {
      clearTimeout(commentDraftTimer);
      commentDraftTimer = 0;
    }
    if (commentDraftInterval) {
      clearInterval(commentDraftInterval);
      commentDraftInterval = 0;
    }
  }

  function clearStoredCommentDraft() {
    commentDraftGen += 1;
    stopCommentDraftAutosave();
    commentDraftComposer = null;
    commentDraftURL = "";
    const key = commentDraftStorageKey();
    if (!key) return;
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }

  function startCommentDraftAutosave() {
    if (commentDraftInterval) return;
    commentDraftInterval = setInterval(persistCommentDraftNow, COMMENT_DRAFT_INTERVAL_MS);
  }

  function commentDraftUrlForSave() {
    if (commentDraftURL) return commentDraftURL;
    const route = parseRoute();
    if (!route || route.name !== "post") return "";
    return commentDraftPageUrl();
  }

  function persistCommentDraftNow() {
    const composer = commentDraftComposer;
    if (!composer || !composer.isConnected) {
      if (commentDraftInterval || commentDraftTimer) stopCommentDraftAutosave();
      commentDraftComposer = null;
      return;
    }
    if (composer.getAttribute("data-edit-author") || composer.id === "publishComposer") return;
    const target = commentDraftTarget(composer);
    const textarea = composer.querySelector(".composer-input");
    const body = textarea ? String(textarea.value || "") : "";
    const url = commentDraftUrlForSave();
    if (!target.position || !body.trim()) {
      const stored = readStoredCommentDraft();
      if (url && stored && stored.url === url && sameDraftParent(stored, target)) clearStoredCommentDraft();
      else stopCommentDraftAutosave();
      return;
    }
    if (!url) return;
    storeCommentDraft({
      url,
      position: target.position,
      parentAuthor: target.parentAuthor,
      parentPermlink: target.parentPermlink,
      body,
    });
  }

  function scheduleCommentDraftSave(composer) {
    if (!composer || composer.getAttribute("data-edit-author") || composer.id === "publishComposer") return;
    const section = document.getElementById("comments");
    if (!section || !section.contains(composer)) return;
    commentDraftComposer = composer;
    commentDraftURL = commentDraftPageUrl();
    startCommentDraftAutosave();
    if (commentDraftTimer) clearTimeout(commentDraftTimer);
    const gen = ++commentDraftGen;
    commentDraftTimer = setTimeout(() => {
      commentDraftTimer = 0;
      if (gen !== commentDraftGen) return;
      persistCommentDraftNow();
    }, COMMENT_DRAFT_SAVE_MS);
  }

  function findDraftComment(author, permlink) {
    const comments = document.getElementById("comments");
    if (!comments) return null;
    const wantAuthor = String(author || "").replace(/^@/, "").toLowerCase();
    const wantPerm = String(permlink || "");
    const nodes = comments.querySelectorAll(".comment");
    let loose = null;
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      if (String(el.getAttribute("data-author") || "").replace(/^@/, "").toLowerCase() !== wantAuthor) continue;
      const perm = String(el.getAttribute("data-permlink") || "");
      if (perm === wantPerm) return el;
      if (!loose && perm.toLowerCase() === wantPerm.toLowerCase()) loose = el;
    }
    return loose;
  }

  function applyCommentDraftBody(composer, body) {
    if (!composer || composer.getAttribute("data-edit-author")) return false;
    if (composer.classList.contains("is-pending") || composer.classList.contains("is-uploading")) return false;
    const textarea = composer.querySelector(".composer-input");
    if (!textarea || textarea.value) return false;
    textarea.value = body;
    return true;
  }

  function commentDraftScrollBlocked() {
    if (location.hash === "#comments") return true;
    return Boolean(commentHashFromLocation());
  }

  function revealRestoredComposer(composer) {
    if (!composer || commentDraftScrollBlocked()) return;
    const layer = document.getElementById("postLayer");
    if (layer && layer.contains(composer) && (layer.hidden || !postLayer.open)) return;
    requestAnimationFrame(() => {
      if (!composer.isConnected) return;
      try {
        composer.scrollIntoView({ block: "nearest" });
      } catch {
        composer.scrollIntoView();
      }
    });
  }

  function openDraftReply(comment, body) {
    const slot = comment.querySelector(":scope > .comment-reply-slot");
    if (!slot) return null;
    const author = comment.getAttribute("data-author");
    const permlink = comment.getAttribute("data-permlink");
    if (!author || !permlink) return null;
    let composer = slot.querySelector(":scope > .comment-composer");
    if (slot.hidden || !composer) {
      slot.innerHTML = composerHtml(author, permlink, {
        placeholder: "Write a reply…",
        submitLabel: "Reply",
      });
      composer = slot.querySelector(":scope > .comment-composer");
      if (!composer) {
        slot.hidden = true;
        slot.innerHTML = "";
        return null;
      }
      slot.hidden = false;
      const btn = comment.querySelector(":scope > .comment-actions .comment-reply-btn");
      if (btn) btn.classList.add("is-open");
    }
    const filled = applyCommentDraftBody(composer, body);
    beginCommentCouncilCheck(composer);
    if (filled) revealRestoredComposer(composer);
    return composer;
  }

  function restoreCommentDraft() {
    const draft = readStoredCommentDraft();
    if (!draft || !commentDraftMatchesPage(draft)) return;
    const section = document.getElementById("comments");
    if (!section) return;
    if (draft.position === "root") {
      const rootAuthor = String(section.getAttribute("data-root-author") || "").replace(/^@/, "").toLowerCase();
      const rootPerm = String(section.getAttribute("data-root-permlink") || "");
      const sameAuthor = draft.parentAuthor.replace(/^@/, "").toLowerCase() === rootAuthor;
      const samePerm =
        draft.parentPermlink === rootPerm || draft.parentPermlink.toLowerCase() === rootPerm.toLowerCase();
      if (!sameAuthor || !samePerm) return;
      applyCommentDraftBody(section.querySelector(":scope > .comment-composer"), draft.body);
      return;
    }
    const comment = findDraftComment(draft.parentAuthor, draft.parentPermlink);
    if (!comment || !section.contains(comment)) return;
    openDraftReply(comment, draft.body);
  }

  function publishDiscardOpen() {
    const el = $("#publishDiscard");
    return Boolean(el && !el.hidden);
  }

  function hidePublishDiscard() {
    const el = $("#publishDiscard");
    if (el) el.hidden = true;
  }

  function showPublishDiscard() {
    const el = $("#publishDiscard");
    if (!el) return;
    const title = $("#publishDiscardTitle");
    const lead = $("#publishDiscardLead");
    if (title) title.textContent = publishEdit ? "Discard edits" : "Discard post";
    if (lead) {
      lead.textContent = publishEdit
        ? "Your edits will be discarded."
        : "This unpublished post will be deleted.";
    }
    el.hidden = false;
    const keep = $("#publishDiscardKeep");
    if (keep) keep.focus();
  }

  function cancelPublish() {
    if (publishDiscardOpen()) return;
    if (publishFormHasContent()) {
      showPublishDiscard();
      return;
    }
    discardPublishAndClose();
  }

  function discardPublishAndClose() {
    hidePublishDiscard();
    if (!publishEdit) {
      clearStoredPublishDraft();
      resetPublishForm();
    }
    closePublish({ persist: false });
  }

  let publishPreviewToken = 0;

  function updatePublishPreview() {
    const preview = $("#publishPreview");
    if (!preview) return;
    const token = ++publishPreviewToken;
    const title = (($("#publishTitle") && $("#publishTitle").value) || "").trim();
    const body = ($("#publishBody") && $("#publishBody").value) || "";
    const heading = !editingComment() && title ? `<h1>${HiveMd.escapeHtml(title)}</h1>` : "";
    const paint = () => {
      if (token !== publishPreviewToken || !preview.isConnected) return;
      const html = body.trim()
        ? HiveMd.renderMarkdown(body)
        : `<p class="feed-hint">Start writing to see a preview.</p>`;
      preview.innerHTML = heading + html;
      paintPublishLocationBtn();
    };
    if (!body.trim() || HiveMd.markdownReady()) {
      paint();
      return;
    }
    preview.innerHTML = heading + `<p class="feed-hint">Loading preview…</p>`;
    paintPublishLocationBtn();
    HiveMd.whenMarkdownReady().then(paint, paint);
  }

  const WORLDMAPPIN_INNER =
    "!(?:worldmappin|pinmapple)\\s+(-?\\d+(?:\\.\\d+)?)\\s+lat\\s+(-?\\d+(?:\\.\\d+)?)\\s+long\\s*(.*?)\\s*d3scr";

  function parsePublishLocation(body) {
    const m = String(body || "").match(new RegExp(WORLDMAPPIN_INNER, "i"));
    if (!m) return null;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    let description = String(m[3] || "").trim();
    if (!description || description === "<DESCRIPTION GOES HERE>") description = "";
    return { lat, lng, description };
  }

  function stripPublishLocation(src) {
    return String(src || "")
      .replace(new RegExp("\\[\\/\\/\\]:\\s*#\\s*\\(" + WORLDMAPPIN_INNER + "\\)", "gi"), "")
      .replace(new RegExp("<!--\\s*" + WORLDMAPPIN_INNER + "\\s*-->", "gi"), "")
      .replace(new RegExp("(^|\\n)[ \\t]*" + WORLDMAPPIN_INNER + "[ \\t]*(?=\\n|$)", "gi"), "$1")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function locationMarkerText(lat, lng, description) {
    const address = String(description || "")
      .replace(/[()]/g, "")
      .replace(/[\r\n]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 250);
    return (
      "[//]:# (!worldmappin " +
      Number(lat).toFixed(6) +
      " lat " +
      Number(lng).toFixed(6) +
      " long " +
      address +
      " d3scr)"
    );
  }

  function bodyWithLocation(body, loc) {
    const base = stripPublishLocation(body);
    if (!loc) return base;
    const marker = locationMarkerText(loc.lat, loc.lng, loc.description);
    return base ? base + "\n\n" + marker : marker;
  }

  function applyLocationMetadata(jsonMetadata, body) {
    const loc = parsePublishLocation(body);
    if (!loc) {
      delete jsonMetadata.location;
      return jsonMetadata;
    }
    jsonMetadata.location = {
      coordinates: {
        lat: Number(loc.lat.toFixed(3)),
        lng: Number(loc.lng.toFixed(3)),
      },
      address: loc.description || loc.lat.toFixed(5) + ", " + loc.lng.toFixed(5),
    };
    return jsonMetadata;
  }

  function paintPublishLocationBtn() {
    const btn = $("#publishLocationBtn");
    if (!btn) return;
    const loc = parsePublishLocation(($("#publishBody") && $("#publishBody").value) || "");
    btn.classList.toggle("is-set", Boolean(loc));
    btn.setAttribute("aria-pressed", loc ? "true" : "false");
    if (loc) {
      const label = loc.description || loc.lat.toFixed(4) + ", " + loc.lng.toFixed(4);
      btn.title = label;
    } else {
      btn.title = "Add location";
    }
  }

  function locationDialogOpen() {
    const el = $("#locationOverlay");
    return Boolean(el && !el.hidden);
  }

  function hideLocationDialog() {
    locSession++;
    if (locSearchAbort) {
      locSearchAbort.abort();
      locSearchAbort = null;
    }
    const ov = $("#locationOverlay");
    if (ov) ov.hidden = true;
  }

  function closeLocationDialog() {
    hideLocationDialog();
    const btn = $("#publishLocationBtn");
    if (btn && !isMobileViewport()) btn.focus();
  }

  function setLocationStatus(msg, isError) {
    const el = $("#locationStatus");
    if (!el) return;
    if (!msg) {
      el.hidden = true;
      el.textContent = "";
      el.classList.remove("is-error");
      return;
    }
    el.hidden = false;
    el.textContent = msg;
    el.classList.toggle("is-error", Boolean(isError));
  }

  function clampLocLat(lat) {
    return Math.max(-85, Math.min(85, lat));
  }

  function wrapLocLng(lng) {
    return ((((lng + 180) % 360) + 360) % 360) - 180;
  }

  function clampLocationZoom(zoom) {
    return Math.max(LOCATION_MIN_ZOOM, Math.min(LOCATION_MAX_ZOOM, zoom));
  }

  // Shift an equator-centered world view north until LOCATION_WORLD_NORTH
  // sits on the top edge. A tall frame already includes it and stays centered.
  function locationWorldCamera(width, height) {
    const zoom = width > 2 ? clampLocationZoom(Math.log2(width / 512)) : 0;
    const worldPx = 512 * Math.pow(2, zoom);
    let lat = 0;
    if (height > 2 && worldPx > 2) {
      const delta = (height / 2) * (Math.PI * 2) / worldPx;
      const north = Math.log(Math.tan(Math.PI / 4 + (LOCATION_WORLD_NORTH * Math.PI) / 360));
      if (delta < north) {
        const y = north - delta;
        lat = (Math.atan(Math.exp(y)) * 2 - Math.PI / 2) * (180 / Math.PI);
        if (lat < 0) lat = 0;
      }
    }
    return { lat: lat, lng: 0, zoom: zoom };
  }

  function loadMapLibre() {
    if (locMapLibre) return Promise.resolve(locMapLibre);
    if (maplibrePromise) return maplibrePromise;
    maplibrePromise = new Promise((resolve, reject) => {
      if (!document.querySelector("link[data-maplibre]")) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = MAPLIBRE_CSS;
        link.dataset.maplibre = "1";
        document.head.appendChild(link);
      }
      import(MAPLIBRE_JS).then(resolve, reject);
    })
      .then((mod) => {
        locMapLibre = mod;
        return mod;
      })
      .catch((err) => {
        maplibrePromise = null;
        throw err;
      });
    return maplibrePromise;
  }

  function locationPinElement() {
    const el = document.createElement("div");
    el.className = "location-pin";
    el.innerHTML =
      '<svg viewBox="0 0 30 42" width="30" height="42" aria-hidden="true">' +
      '<path d="M15 0C6.7 0 0 6.7 0 15c0 10.5 13.4 25.4 14 26.1a1.4 1.4 0 0 0 2 0c.6-.7 14-15.6 14-26.1C30 6.7 23.3 0 15 0z" fill="#e31337"/>' +
      '<circle cx="15" cy="15" r="6" fill="#fff"/></svg>';
    return el;
  }

  function syncLocationMarker() {
    if (!locMap || !locMapLibre) return;
    if (!locPicked) {
      if (locMarker) {
        locMarker.remove();
        locMarker = null;
      }
      return;
    }
    const ll = [locCenter.lng, locCenter.lat];
    if (!locMarker) {
      locMarker = new locMapLibre.Marker({
        element: locationPinElement(),
        anchor: "bottom",
      })
        .setLngLat(ll)
        .addTo(locMap);
    } else {
      locMarker.setLngLat(ll);
    }
  }

  function applyLocationCamera(animate) {
    if (!locMap) return;
    const camera = { center: [locView.lng, locView.lat], zoom: locZoom };
    if (animate) locMap.flyTo(Object.assign({ duration: 750, essential: true }, camera));
    else locMap.jumpTo(camera);
  }

  function frameLocationWorld() {
    if (!locMap) return;
    const canvas = locMap.getContainer();
    const camera = locationWorldCamera(
      canvas ? canvas.clientWidth : 0,
      canvas ? canvas.clientHeight : 0
    );
    locView = { lat: camera.lat, lng: 0 };
    locZoom = camera.zoom;
    applyLocationCamera(false);
  }

  function resizeLocationMap() {
    if (!locMap) return;
    // resize() stops an in-flight flyTo and moveend would keep the interrupted
    // center. Remember the requested camera and put it back.
    const camera = { center: [locView.lng, locView.lat], zoom: locZoom };
    locMap.resize();
    locMap.jumpTo(camera);
  }

  function showLocationMap(session) {
    const canvas = $("#locationMapCanvas");
    const box = $("#locationMap");
    if (!canvas) return Promise.resolve();
    if (box && !locMap) box.dataset.state = "loading";
    return loadMapLibre()
      .then((ml) => {
        if (session !== locSession || !locationDialogOpen()) return;
        if (!locMap) {
          let ready = false;
          locMap = new ml.Map({
            container: canvas,
            style: LOCATION_STYLE_URL,
            center: [locView.lng, locView.lat],
            zoom: locZoom,
            minZoom: LOCATION_MIN_ZOOM,
            maxZoom: LOCATION_MAX_ZOOM,
            attributionControl: false,
            dragRotate: false,
            pitchWithRotate: false,
          });
          locMap.addControl(new ml.AttributionControl({ compact: true }), "bottom-left");
          locMap.dragRotate.disable();
          locMap.touchZoomRotate.disableRotation();
          locMap.keyboard.disableRotation();
          locMap.on("click", (e) => {
            if (!locationDialogOpen()) return;
            moveLocationPin({ lat: e.lngLat.lat, lng: e.lngLat.lng }, 0, "", true);
          });
          locMap.on("moveend", () => {
            if (!locMap) return;
            const c = locMap.getCenter();
            locView = { lat: c.lat, lng: wrapLocLng(c.lng) };
            locZoom = locMap.getZoom();
          });
          locMap.on("load", () => {
            ready = true;
            if (box) box.dataset.state = "ready";
            if (!locMap || session !== locSession) return;
            resizeLocationMap();
            syncLocationMarker();
          });
          locMap.on("error", (ev) => {
            if (ready || (ev && ev.sourceId)) return;
            if (box) box.dataset.state = "error";
            setLocationStatus("Couldn't load the map. Check your connection and try again.", true);
          });
        } else if (box && box.dataset.state !== "error") {
          box.dataset.state = "ready";
        }
        if (locPicked) applyLocationCamera(false);
        else frameLocationWorld();
        syncLocationMarker();
        requestAnimationFrame(() => {
          if (locMap && session === locSession) resizeLocationMap();
        });
      })
      .catch(() => {
        if (session !== locSession) return;
        if (box) box.dataset.state = "error";
        setLocationStatus("Couldn't load the map. Check your connection and try again.", true);
      });
  }

  function paintLocationChrome() {
    syncLocationMarker();
    const coords = $("#locationCoords");
    if (coords) {
      coords.textContent = locPicked
        ? locCenter.lat.toFixed(5) + ", " + locCenter.lng.toFixed(5)
        : "";
    }
    const save = $("#locationSave");
    if (save) save.disabled = !locPicked;
    const remove = $("#locationRemove");
    if (remove) remove.hidden = !locHadSaved;
  }

  function photonText(value) {
    return value == null ? "" : String(value).trim();
  }

  function photonSuggestion(feature, i) {
    const coords = feature && feature.geometry && feature.geometry.coordinates;
    if (!coords || coords.length < 2) return null;
    const lng = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const p = feature.properties || {};
    const houseAndStreet = [photonText(p.street), photonText(p.housenumber)].filter(Boolean).join(" ");
    const label =
      photonText(p.name) ||
      houseAndStreet ||
      photonText(p.city) ||
      photonText(p.county) ||
      photonText(p.state);
    if (!label) return null;
    const hintParts = [
      houseAndStreet && houseAndStreet !== label ? houseAndStreet : "",
      photonText(p.city) && photonText(p.city) !== label ? photonText(p.city) : "",
      photonText(p.state) && photonText(p.state) !== label ? photonText(p.state) : "",
      photonText(p.country),
    ].filter(Boolean);
    const hint = hintParts.filter((part, idx) => part !== hintParts[idx - 1]).join(", ");
    return { id: String(p.osm_id || i) + ":" + i, label, hint, lat, lng };
  }

  function placeLabelFromFeature(feature) {
    const suggestion = photonSuggestion(feature, 0);
    return suggestion ? [suggestion.label, suggestion.hint].filter(Boolean).join(", ") : "";
  }

  function photonFeatures(json) {
    return (json && json.features) || [];
  }

  function fillDescriptionFor(lat, lng) {
    const desc = $("#locationDescription");
    if (!desc || !locDescAuto) return;
    const seq = ++locRevSeq;
    const session = locSession;
    const url =
      "https://photon.komoot.io/reverse?lat=" +
      encodeURIComponent(lat) +
      "&lon=" +
      encodeURIComponent(lng) +
      "&lang=en";
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 8000);
    fetch(url, { signal: ctrl.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (seq !== locRevSeq || session !== locSession || !locDescAuto) return;
        const feature = photonFeatures(json)[0];
        const label = feature ? placeLabelFromFeature(feature) : "";
        // Coordinates stay in #locationCoords. The description is a place name only.
        desc.value = label;
      })
      .catch(() => {})
      .finally(() => clearTimeout(timer));
  }

  function moveLocationPin(ll, zoom, address, keepView) {
    locCenter = { lat: clampLocLat(ll.lat), lng: wrapLocLng(ll.lng) };
    if (!keepView) {
      locView = { lat: locCenter.lat, lng: locCenter.lng };
      if (zoom) locZoom = clampLocationZoom(zoom);
    }
    locPicked = true;
    const desc = $("#locationDescription");
    if (address && locDescAuto && desc) {
      locRevSeq++;
      desc.value = address;
    } else if (!address) {
      fillDescriptionFor(locCenter.lat, locCenter.lng);
    }
    paintLocationChrome();
    if (!keepView) applyLocationCamera(true);
  }

  function setLocationZoom(next) {
    locZoom = clampLocationZoom(next);
    if (locMap) locMap.easeTo({ zoom: locZoom, duration: 200 });
  }

  function closeLocationSuggestions() {
    const box = $("#locationSuggestions");
    const input = $("#locationSearch");
    if (box) box.hidden = true;
    if (input) input.setAttribute("aria-expanded", "false");
    locSuggestActive = -1;
  }

  function paintLocationSuggestions(state) {
    const box = $("#locationSuggestions");
    const input = $("#locationSearch");
    if (!box) return;
    if (state === "closed") {
      closeLocationSuggestions();
      return;
    }
    box.hidden = false;
    if (input) input.setAttribute("aria-expanded", "true");
    if (state === "busy") {
      box.innerHTML = '<div class="location-suggest-empty">Searching…</div>';
      return;
    }
    if (!locSuggests.length) {
      box.innerHTML = '<div class="location-suggest-empty">No matches found.</div>';
      return;
    }
    if (locSuggestActive >= locSuggests.length) locSuggestActive = locSuggests.length - 1;
    box.innerHTML = locSuggests
      .map((s, i) => {
        const hint = s.hint
          ? '<small>' + HiveMd.escapeHtml(s.hint) + "</small>"
          : "";
        return (
          '<button type="button" class="location-suggestion' +
          (i === locSuggestActive ? " is-active" : "") +
          '" role="option" data-loc-index="' +
          i +
          '" id="locationSuggest' +
          i +
          '">' +
          HiveMd.escapeHtml(s.label) +
          hint +
          "</button>"
        );
      })
      .join("");
    if (input) {
      input.setAttribute(
        "aria-activedescendant",
        locSuggestActive >= 0 ? "locationSuggest" + locSuggestActive : ""
      );
    }
  }

  function selectLocationSuggestion(index) {
    const s = locSuggests[index];
    if (!s) return;
    const input = $("#locationSearch");
    const address = [s.label, s.hint].filter(Boolean).join(", ");
    if (input) input.value = address;
    closeLocationSuggestions();
    const zoom = Math.max(locMap ? locMap.getZoom() : locZoom, 15);
    moveLocationPin({ lat: s.lat, lng: s.lng }, zoom, address);
    setLocationStatus("");
  }

  function runLocationSearch(query) {
    if (locSearchAbort) locSearchAbort.abort();
    const q = String(query || "").trim();
    if (q.length < 2) {
      locSuggests = [];
      closeLocationSuggestions();
      return;
    }
    const ctrl = new AbortController();
    locSearchAbort = ctrl;
    const session = locSession;
    const timer = window.setTimeout(() => ctrl.abort(), 8000);
    setLocationStatus("");
    paintLocationSuggestions("busy");
    fetch(
      "https://photon.komoot.io/api/?limit=6&lang=en&q=" + encodeURIComponent(q),
      { signal: ctrl.signal }
    )
      .then((res) => {
        if (!res.ok) throw new Error("search");
        return res.json();
      })
      .then((json) => {
        if (session !== locSession || ctrl.signal.aborted) return;
        const current = (($("#locationSearch") && $("#locationSearch").value) || "").trim();
        if (current !== q) return;
        locSuggests = photonFeatures(json)
          .map((feature, i) => photonSuggestion(feature, i))
          .filter(Boolean);
        locSuggestActive = locSuggests.length ? 0 : -1;
        paintLocationSuggestions(locSuggests.length ? "list" : "empty");
      })
      .catch((err) => {
        if (session !== locSession) return;
        if (err && err.name === "AbortError") {
          if (locSearchAbort !== ctrl) return;
          locSuggests = [];
          paintLocationSuggestions("empty");
          setLocationStatus("Address search timed out. Try again.", true);
          return;
        }
        locSuggests = [];
        paintLocationSuggestions("empty");
      })
      .finally(() => clearTimeout(timer));
  }

  function useDeviceLocation() {
    if (!navigator.geolocation) {
      setLocationStatus("This browser can't read the device location.", true);
      return;
    }
    const btn = $("#locationLocate");
    if (btn) btn.disabled = true;
    setLocationStatus("Locating…");
    const session = locSession;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (session !== locSession) return;
        if (btn) btn.disabled = false;
        setLocationStatus("");
        const input = $("#locationSearch");
        if (input) input.value = "";
        closeLocationSuggestions();
        const zoom = Math.max(locMap ? locMap.getZoom() : locZoom, 15);
        moveLocationPin(
          { lat: pos.coords.latitude, lng: pos.coords.longitude },
          zoom
        );
      },
      () => {
        if (session !== locSession) return;
        if (btn) btn.disabled = false;
        setLocationStatus(
          "Couldn't access your location. Check the browser's location permission and try again.",
          true
        );
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }

  function openLocationDialog() {
    if (editingComment() || publishDiscardOpen()) return;
    closeMdMenu();
    const ov = $("#locationOverlay");
    const body = $("#publishBody");
    if (!ov || !body) return;
    const existing = parsePublishLocation(body.value);
    locSession++;
    locHadSaved = Boolean(existing);
    locPicked = Boolean(existing);
    locCenter = existing
      ? { lat: existing.lat, lng: existing.lng }
      : { lat: 20, lng: 0 };
    locView = existing ? { lat: locCenter.lat, lng: locCenter.lng } : { lat: 0, lng: 0 };
    locZoom = existing ? 14 : 0;
    locDescAuto = !(existing && existing.description);
    locSuggests = [];
    locSuggestActive = -1;
    const search = $("#locationSearch");
    const desc = $("#locationDescription");
    const locate = $("#locationLocate");
    if (search) search.value = "";
    if (desc) desc.value = existing ? existing.description : "";
    if (locate) locate.disabled = false;
    closeLocationSuggestions();
    setLocationStatus("");
    ov.hidden = false;
    if (!existing) {
      const box = $("#locationMap");
      const camera = locationWorldCamera(
        box ? box.clientWidth : 0,
        box ? box.clientHeight : 0
      );
      locView = { lat: camera.lat, lng: 0 };
      locZoom = camera.zoom;
    }
    paintLocationChrome();
    const session = locSession;
    showLocationMap(session);
    if (locPicked && locDescAuto) fillDescriptionFor(locCenter.lat, locCenter.lng);
    if (!isMobileViewport() && search) search.focus();
  }

  function saveLocationFromDialog() {
    if (!locPicked) return;
    const body = $("#publishBody");
    const desc = $("#locationDescription");
    if (!body) return;
    body.value = bodyWithLocation(body.value, {
      lat: locCenter.lat,
      lng: locCenter.lng,
      description: desc ? desc.value : "",
    });
    savePublishDraft();
    updatePublishPreview();
    schedulePublishDraftSave();
    closeLocationDialog();
  }

  function removeLocationFromPost() {
    const body = $("#publishBody");
    if (!body) return;
    body.value = bodyWithLocation(body.value, null);
    savePublishDraft();
    updatePublishPreview();
    schedulePublishDraftSave();
    closeLocationDialog();
  }

  function bindLocationDialog() {
    const ov = $("#locationOverlay");
    if (!ov || ov.dataset.bound === "1") return;
    ov.dataset.bound = "1";
    ov.addEventListener("click", (e) => {
      if (e.target === ov) {
        const active = document.activeElement;
        if (!active || !ov.contains(active)) {
          e.preventDefault();
          closeLocationDialog();
        }
        return;
      }
      if (e.target.closest("#locationCancel")) {
        e.preventDefault();
        closeLocationDialog();
        return;
      }
      if (e.target.closest("#locationSave")) {
        e.preventDefault();
        saveLocationFromDialog();
        return;
      }
      if (e.target.closest("#locationRemove")) {
        e.preventDefault();
        removeLocationFromPost();
        return;
      }
      if (e.target.closest("#locationLocate")) {
        e.preventDefault();
        useDeviceLocation();
        return;
      }
      if (e.target.closest("#locationZoomIn")) {
        e.preventDefault();
        setLocationZoom((locMap ? locMap.getZoom() : locZoom) + 1);
        return;
      }
      if (e.target.closest("#locationZoomOut")) {
        e.preventDefault();
        setLocationZoom((locMap ? locMap.getZoom() : locZoom) - 1);
      }
    });
    ov.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      const box = $("#locationSuggestions");
      if (box && !box.hidden) {
        e.preventDefault();
        e.stopPropagation();
        closeLocationSuggestions();
        return;
      }
      e.preventDefault();
      closeLocationDialog();
    });
    const search = $("#locationSearch");
    if (search) {
      search.addEventListener("input", () => {
        if (locSearchAbort) {
          locSearchAbort.abort();
          locSearchAbort = null;
        }
        locSuggests = [];
        closeLocationSuggestions();
        setLocationStatus("");
      });
      search.addEventListener("search", () => {
        if (search.value.trim()) return;
        if (locSearchAbort) {
          locSearchAbort.abort();
          locSearchAbort = null;
        }
        locSuggests = [];
        closeLocationSuggestions();
        setLocationStatus("");
      });
      search.addEventListener("keydown", (e) => {
        const box = $("#locationSuggestions");
        const open = box && !box.hidden && locSuggests.length;
        if (e.key === "ArrowDown") {
          if (!open) return;
          e.preventDefault();
          locSuggestActive = (locSuggestActive + 1) % locSuggests.length;
          paintLocationSuggestions("list");
          return;
        }
        if (e.key === "ArrowUp") {
          if (!open) return;
          e.preventDefault();
          locSuggestActive = (locSuggestActive - 1 + locSuggests.length) % locSuggests.length;
          paintLocationSuggestions("list");
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          if (open && locSuggestActive >= 0) {
            e.stopPropagation();
            selectLocationSuggestion(locSuggestActive);
            return;
          }
          runLocationSearch(search.value);
          return;
        }
        if (e.key === "Escape" && box && !box.hidden) {
          e.preventDefault();
          e.stopPropagation();
          closeLocationSuggestions();
        }
      });
    }
    const suggestions = $("#locationSuggestions");
    if (suggestions) {
      suggestions.addEventListener("mousedown", (e) => {
        const btn = e.target.closest("[data-loc-index]");
        if (!btn) return;
        e.preventDefault();
        selectLocationSuggestion(Number(btn.getAttribute("data-loc-index")));
      });
    }
    const desc = $("#locationDescription");
    if (desc) {
      desc.addEventListener("input", () => {
        locDescAuto = !String(desc.value || "").trim();
        locRevSeq++;
      });
    }
  }

  function applyPublishDestRequest() {
    const req = publishDestRequest;
    publishDestRequest = null;
    if (!req) {
      publishPinnedCommunity = null;
      return false;
    }
    const name = normalizeCommunityName(req.name);
    if (!name || publishEdit) {
      publishPinnedCommunity = null;
      return false;
    }
    const title = String(req.title || "").trim() || name;
    publishPinnedCommunity = { name, title };
    publishDest = { type: "community", name, title };
    return true;
  }

  function resetPublishForm() {
    cancelPublishCommunityCheck();
    publishEdit = null;
    publishStash = null;
    publishDestRequest = null;
    publishPinnedCommunity = null;
    publishDest = blogPublishDest();
    setPublishDestNote("");
    publishTags = [];
    publishTitleDraft = "";
    publishBodyDraft = "";
    const title = $("#publishTitle");
    const body = $("#publishBody");
    const tagInput = $("#publishTagInput");
    if (title) {
      title.value = "";
      fitPublishTitle(title);
    }
    paintPublishTitleCount();
    if (body) body.value = "";
    if (tagInput) tagInput.value = "";
    applyPublishAdvanced(null);
    collapsePublishAdvanced();
    paintPublishDest();
    paintPublishTags();
    setPublishStatus("");
    updatePublishPreview();
    const composer = $("#publishComposer");
    if (composer) {
      composer.classList.remove("is-pending", "is-uploading", "is-dragover");
      composerStatus(composer, "");
    }
    const submit = $("#publishSubmit");
    if (submit) submit.disabled = false;
    const pageEl = $("#publishPage");
    if (pageEl) pageEl.classList.remove("is-pending");
    closeDestMenu();
    closeMdMenu();
    paintPublishChrome();
  }

  function hidePublishOverlay(opts) {
    stopPublishDraftAutosave();
    hidePublishDiscard();
    hideLocationDialog();
    const persist = !opts || opts.persist !== false;
    if (persist && !publishEdit) persistPublishDraftNow();
    const ov = $("#publishOverlay");
    if (ov) ov.hidden = true;
    closeDestMenu();
    closeMdMenu();
    setPublishFabHidden(false);
    if (publishEdit) {
      publishEdit = null;
      const stash = publishStash;
      publishStash = null;
      if (stash) applyPublishForm(stash);
      paintPublishChrome();
    }
  }

  function replaceOffPublish() {
    let back = lastNonPublishPath || "/";
    if (parseRoute(back).name === "publish") back = "/";
    navigate(appHref(back.startsWith("/") ? back : "/" + back), true);
  }

  function closePublish(opts) {
    pendingPublish = false;
    hidePublishOverlay(opts);
    if (parseRoute().name !== "publish") return;
    // Publish was pushed on top of the open page. Pop that entry so a post
    // opened from the feed stays open, instead of replacing it with the feed.
    if (publishNavPushed) {
      publishNavPushed = false;
      const href = location.href;
      history.back();
      window.setTimeout(() => {
        if (location.href === href && parseRoute().name === "publish") replaceOffPublish();
      }, 250);
      return;
    }
    replaceOffPublish();
  }

  function openPublishOverlay() {
    const ov = $("#publishOverlay");
    if (!ov) return;
    setPageMeta("Publish — CyberSpace77");
    const alreadyOpen = !ov.hidden;
    setPublishFabHidden(true);
    pendingPublish = false;
    if (publishEdit) {
      publishEdit = null;
      const stash = publishStash;
      publishStash = null;
      if (stash) applyPublishForm(stash);
    }
    if (!alreadyOpen) {
      hydratePublishDraftFromStorage();
      collapsePublishAdvanced();
    }
    const fromCommunityWrite = applyPublishDestRequest();
    paintPublishDest();
    ov.hidden = false;
    HiveMd.whenMarkdownReady();
    paintPublishChrome();
    fitPublishTitle();
    requestAnimationFrame(() => fitPublishTitle());
    paintPublishDest();
    paintPublishTags();
    renderDestMenu();
    updatePublishPreview();
    loadPublishSubs();
    startPublishDraftAutosave();
    focusPublishField();
    syncPublishCommunityAccess();
    if (fromCommunityWrite && publishDest.type === "community") {
      requestPublishCommunityBeneficiary(publishDest.name, { force: true });
    }
  }

  async function submitPublish() {
    const user = observer();
    if (!user) {
      pendingPublish = true;
      openLogin();
      return;
    }
    const pageEl = $("#publishPage");
    const submitBtn = $("#publishSubmit");
    const composer = $("#publishComposer");
    if (composer && composer.classList.contains("is-uploading")) {
      setPublishStatus("Wait for the image upload to finish.", true);
      return;
    }
    if (pageEl && pageEl.classList.contains("is-pending")) return;
    const commentEdit = editingComment();
    const titleEl = $("#publishTitle");
    if (!commentEdit && titleEl) enforcePublishTitleLimit(titleEl);
    const title = commentEdit
      ? String((publishEdit && publishEdit.title) || "").trim()
      : clampPublishTitle(((titleEl && titleEl.value) || "").trim());
    const body = (($("#publishBody") && $("#publishBody").value) || "").trim();
    if (!commentEdit) takeTagsFromInput();
    if (!commentEdit && !title) {
      setPublishStatus("Add a title.", true);
      return;
    }
    if (!body) {
      setPublishStatus(commentEdit ? "Write the comment." : "Write the post body.", true);
      return;
    }
    if (!hasSigner(user)) {
      setPublishStatus(signerNeededMessage(), true);
      return;
    }

    const editing = Boolean(publishEdit);
    if (editing && !isOwnAuthor(publishEdit.author)) {
      setPublishStatus(
        commentEdit ? "You can only edit your own comments." : "You can only edit your own posts.",
        true
      );
      return;
    }

    let tags = commentEdit ? (publishEdit.tags || []).slice() : publishTags.slice();
    let parentAuthor = "";
    let parentPermlink;
    let permlink;
    if (editing) {
      parentAuthor = publishEdit.parentAuthor || "";
      parentPermlink = publishEdit.parentPermlink;
      permlink = publishEdit.permlink;
      if (!commentEdit && parentPermlink && tags.indexOf(parentPermlink) === -1) {
        tags.unshift(parentPermlink);
        tags = tags.slice(0, MAX_TAGS);
      }
      if (!commentEdit && !parentAuthor && !tags.length) {
        setPublishStatus("Add at least one tag for your blog post.", true);
        return;
      }
    } else if (publishDest.type === "community" && publishDest.name) {
      parentPermlink = publishDest.name;
      if (tags.indexOf(parentPermlink) === -1) tags.unshift(parentPermlink);
      tags = tags.slice(0, MAX_TAGS);
    } else {
      if (!tags.length) {
        setPublishStatus("Add at least one tag for your blog post.", true);
        return;
      }
      parentPermlink = tags[0];
    }

    let jsonMetadata;
    if (editing) {
      jsonMetadata = mergeJsonMetadata(publishEdit.jsonMetadata, body, tags);
    } else {
      const images = imagesFromMarkdown(body);
      jsonMetadata = {
        app: APP_ID + "/" + APP_VERSION,
        format: "markdown",
        tags,
      };
      if (images.length) jsonMetadata.image = images;
      if (publishDest.type === "community" && publishDest.name) {
        jsonMetadata.community = publishDest.name;
      }
    }
    if (!commentEdit) {
      applyLocationMetadata(jsonMetadata, body);
      applyDescriptionMetadata(jsonMetadata, normalizedPublishDescription());
    }

    if (!editing) permlink = postPermlink(title);
    let commentOptions = null;
    if (!editing) {
      const collected = collectPublishBeneficiaries(user);
      if (collected.error) {
        openPublishAdvanced();
        setPublishStatus(collected.error, true);
        return;
      }
      const reward = readPublishReward();
      if (reward === "burned" && collected.beneficiaries.length) {
        openPublishAdvanced();
        setPublishStatus("Burn sends the whole payout to null. Remove the other beneficiaries.", true);
        return;
      }
      commentOptions = buildCommentOptions(
        user,
        permlink,
        reward,
        collected.beneficiaries
      );
    }
    if (pageEl) pageEl.classList.add("is-pending");
    if (submitBtn) submitBtn.disabled = true;
    setPublishStatus("Publishing", false, true);

    const { promise } = ChainQueue.comment({
      author: user,
      parentAuthor,
      parentPermlink,
      permlink,
      title,
      body,
      jsonMetadata,
      commentOptions,
    });

    try {
      await promise;

      // Wait for the post to actually exist on the blockchain
      let postExists = false;
      let retries = 0;
      const maxRetries = 120; // ~120 seconds with 1 second intervals

      while (!postExists && retries < maxRetries) {
        try {
          const post = await HiveApi.getContent(user, permlink);
          if (post && post.author) {
            postExists = true;
            break;
          }
        } catch (err) {
          // Post doesn't exist yet, continue retrying
        }

        if (!postExists) {
          retries++;
          // Wait 1 second before retrying
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      if (!postExists) {
        // Post never appeared - show error but don't navigate
        setPublishStatus("Post was submitted but failed to appear on blockchain. Refresh the page to check.", true);
        return;
      }

      if (editing) {
        if (currentPost && currentPost.permlink === permlink && isOwnAuthor(currentPost.author)) {
          currentPost.title = title;
          currentPost.body = body;
          currentPost.json_metadata = jsonMetadata;
          rememberContent(currentPost);
        }
        applyPostEditToView(title, body);
        hidePublishOverlay();
        // The dialog locks the page where the reader left it. Bring the
        // edited post back to the top once that lock is gone.
        scrollWindowInstant(0);
        requestAnimationFrame(() => scrollWindowInstant(0));
      } else {
        clearStoredPublishDraft();
        resetPublishForm();
        hidePublishOverlay({ persist: false });
        navigate(appHref("/@" + user + "/" + permlink));
      }
    } catch (err) {
      setPublishStatus(err.message || String(err), true);
    } finally {
      if (pageEl) pageEl.classList.remove("is-pending");
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  function activeArticle() {
    const pv = document.getElementById("postView");
    if (postLayer.open && pv) {
      const article = pv.querySelector("article.article");
      if (article) return article;
    }
    return view ? view.querySelector("article.article") : null;
  }

  function applyPostEditToView(title, body) {
    const article = activeArticle();
    if (!article) return;
    paintArticleTitle(article, Object.assign({}, currentPost || {}, { title: title || "" }));
    const bodyEl = article.querySelector(":scope > .post-body");
    const paintBody = () => {
      if (!bodyEl || !bodyEl.isConnected) return;
      bodyEl.innerHTML = HiveMd.renderMarkdown(body || "");
    };
    if (bodyEl && !HiveMd.markdownReady()) HiveMd.whenMarkdownReady().then(paintBody, paintBody);
    else paintBody();
    syncArticleTags(article, currentPost);
    if (currentPost) setPostTitle(currentPost);
    else setPageMeta(`${title || "Post"} — CyberSpace77`);
  }

  let contentEditToken = 0;

  function openEditorForPost(post) {
    if (!post || !post.author || !post.permlink) return;
    const user = observer();
    if (!user) {
      openLogin();
      return;
    }
    if (!isOwnAuthor(post.author)) return;
    const ov = $("#publishOverlay");
    if (!ov) return;
    if (!publishEdit) {
      persistPublishDraftNow();
      publishStash = snapshotPublishForm();
      stopPublishDraftAutosave();
    }
    cancelPublishCommunityCheck();
    setPublishDestNote("");
    const comment = !isRootPost(post);
    publishEdit = {
      author: post.author,
      permlink: post.permlink,
      parentAuthor: post.parent_author || "",
      parentPermlink: post.parent_permlink || post.category || "",
      jsonMetadata: post.json_metadata,
      comment,
      title: post.title || "",
      tags: comment ? metadataTags(post) : null,
    };
    applyPublishForm({
      title: post.title || "",
      body: post.body || "",
      tags: comment ? publishEdit.tags.slice() : tagsForEdit(post),
      dest: publishDest,
      tagInput: "",
      description: comment ? "" : descriptionFromPost(post),
      reward: "default",
      beneficiaries: [],
    });
    collapsePublishAdvanced();
    paintPublishChrome();
    setPublishFabHidden(true);
    pendingPublish = false;
    ov.hidden = false;
    fitPublishTitle();
    requestAnimationFrame(() => fitPublishTitle());
    focusPublishField();
  }

  function openPostEditor() {
    openEditorForPost(currentPost);
  }

  function postRecordForEdit(author, permlink) {
    if (currentPost && samePostId(currentPost, author, permlink) && currentPost.body != null) {
      return currentPost;
    }
    const loaded = findLoadedPost(author, permlink);
    if (loaded) {
      const shown = cardDisplayPost(loaded);
      if (shown && samePostId(shown, author, permlink) && shown.body != null) return shown;
      if (samePostId(loaded, author, permlink) && loaded.body != null) return loaded;
    }
    const remembered = contentOf(author, permlink);
    if (remembered && remembered.body != null) return remembered;
    return null;
  }

  function editContentFromMore(root) {
    const author = (root && root.getAttribute("data-author")) || "";
    const permlink = (root && root.getAttribute("data-permlink")) || "";
    const kind = (root && root.getAttribute("data-content-kind")) || "";
    if (!author || !permlink || !isOwnAuthor(author)) return;
    if (kind === "comment") {
      const comment = findCommentEl(author, permlink);
      if (comment) toggleCommentEditor(comment);
      return;
    }
    const ready = postRecordForEdit(author, permlink);
    if (ready) {
      contentEditToken += 1;
      openEditorForPost(ready);
      return;
    }
    const token = ++contentEditToken;
    HiveApi.getPost(author, permlink)
      .then((post) => {
        if (token !== contentEditToken) return;
        if (!post) {
          showError("Couldn't open this post for editing.");
          return;
        }
        openEditorForPost(post);
      })
      .catch((err) => {
        if (token !== contentEditToken) return;
        showError(err.message || String(err));
      });
  }

  let contentDeleteTarget = null;
  let contentDeleteBusy = false;

  function contentDeleteOpen() {
    const el = $("#contentDelete");
    return Boolean(el && !el.hidden);
  }

  function setContentDeleteStatus(message, isError) {
    const el = $("#contentDeleteStatus");
    if (!el) return;
    el.textContent = message || "";
    el.hidden = !message;
    el.classList.toggle("is-error", Boolean(isError && message));
  }

  function hideContentDelete(force) {
    if (contentDeleteBusy && !force) return;
    const el = $("#contentDelete");
    if (el) el.hidden = true;
    contentDeleteTarget = null;
    setContentDeleteStatus("");
    const confirmBtn = $("#contentDeleteConfirm");
    const cancelBtn = $("#contentDeleteCancel");
    if (confirmBtn) confirmBtn.disabled = false;
    if (cancelBtn) cancelBtn.disabled = false;
  }

  function contentRecord(author, permlink) {
    const node = findContentNode(author, permlink) || findLoadedPost(author, permlink);
    if (node) return node;
    if (currentPost && samePostId(currentPost, author, permlink)) return currentPost;
    return null;
  }

  function liveReplyCount(author, permlink) {
    const section = document.getElementById("comments");
    if (
      section &&
      samePostId(
        {
          author: section.getAttribute("data-root-author"),
          permlink: section.getAttribute("data-root-permlink"),
        },
        author,
        permlink
      )
    ) {
      const shown = Number(section.getAttribute("data-count"));
      if (Number.isFinite(shown)) return Math.max(0, shown);
    }
    const node = contentRecord(author, permlink);
    if (node && node.children != null && node.children !== "") {
      const n = Number(node.children);
      if (Number.isFinite(n)) return Math.max(0, n);
    }
    const comment = findCommentEl(author, permlink);
    if (comment) return comment.querySelectorAll(":scope > .comment-replies > .comment").length;
    return null;
  }

  function contentNetRshares(node) {
    if (!node) return null;
    if (node.net_rshares != null && node.net_rshares !== "") {
      const n = Number(node.net_rshares);
      if (Number.isFinite(n)) return n;
    }
    const votes = node.active_votes;
    if (!Array.isArray(votes)) return null;
    let sum = 0;
    let any = false;
    for (let i = 0; i < votes.length; i++) {
      const rshares = Number(votes[i] && votes[i].rshares);
      if (!Number.isFinite(rshares)) continue;
      any = true;
      sum += rshares;
    }
    return any ? sum : null;
  }

  function syncDeleteOffers(author, permlink, children) {
    if (!author || !permlink) return;
    const show = contentMayDelete(author, children);
    document.querySelectorAll(".content-more").forEach((more) => {
      if (
        !samePostId(
          {
            author: more.getAttribute("data-author"),
            permlink: more.getAttribute("data-permlink"),
          },
          author,
          permlink
        )
      ) {
        return;
      }
      const menus = [];
      const inline = more.querySelector(".content-more-menu");
      if (inline) menus.push(inline);
      if (more.classList.contains("is-open")) {
        const portaled = document.querySelector("body > .content-more-menu");
        if (portaled && menus.indexOf(portaled) < 0) menus.push(portaled);
      }
      menus.forEach((menu) => {
        const existing = menu.querySelector(".content-more-delete");
        if (show && !existing) {
          const edit = menu.querySelector(".content-more-edit");
          if (edit) edit.insertAdjacentHTML("afterend", contentDeleteItemHtml());
          else menu.insertAdjacentHTML("afterbegin", contentDeleteItemHtml());
        } else if (!show && existing) {
          existing.remove();
        }
      });
    });
  }

  function openContentDelete(author, permlink, kind) {
    if (!author || !permlink || !isOwnAuthor(author)) return;
    const count = liveReplyCount(author, permlink);
    if (count == null) {
      showError("Couldn't check replies for this post.");
      return;
    }
    if (count > 0) {
      showError("Hive can only delete a post or comment that has no replies.");
      return;
    }
    const node = contentRecord(author, permlink);
    const comment = kind === "comment" || Boolean(node && !isRootPost(node));
    contentDeleteTarget = { author: author, permlink: permlink, kind: kind || "" };
    const title = $("#contentDeleteTitle");
    if (title) title.textContent = comment ? "Delete comment" : "Delete post";
    setContentDeleteStatus("");
    const confirmBtn = $("#contentDeleteConfirm");
    const cancelBtn = $("#contentDeleteCancel");
    if (confirmBtn) confirmBtn.disabled = false;
    if (cancelBtn) cancelBtn.disabled = false;
    const ov = $("#contentDelete");
    if (!ov) return;
    ov.hidden = false;
    if (cancelBtn) cancelBtn.focus();
  }

  function dropReplyNode(node, author, permlink) {
    if (!node || !Array.isArray(node._replies)) return null;
    for (let i = 0; i < node._replies.length; i++) {
      if (samePostId(node._replies[i], author, permlink)) {
        node._replies.splice(i, 1);
        return node;
      }
      const found = dropReplyNode(node._replies[i], author, permlink);
      if (found) return found;
    }
    return null;
  }

  function removeDeletedCards(author, permlink) {
    const items = feedState.items || [];
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      if (!item) continue;
      if (samePostId(item, author, permlink)) items.splice(i, 1);
      else if (item.original_entry && samePostId(item.original_entry, author, permlink)) {
        items.splice(i, 1);
      }
    }
    document.querySelectorAll("article.post-card").forEach((card) => {
      if (
        samePostId(
          {
            author: card.getAttribute("data-author"),
            permlink: card.getAttribute("data-permlink"),
          },
          author,
          permlink
        )
      ) {
        const wrap = card.closest(".feed-item") || card;
        wrap.remove();
      }
    });
  }

  function leaveDeletedPost(author, permlink) {
    postSnaps.delete(snapKey(author, permlink));
    const pv = postViewEl();
    if (pv) pv.innerHTML = "";
    if (currentPost && samePostId(currentPost, author, permlink)) currentPost = null;
    const href = location.href;
    const profile = appHref("/@" + String(author || "").replace(/^@/, ""));
    if (window.history.length > 1) {
      history.back();
      window.setTimeout(() => {
        if (location.href === href) navigate(profile, true);
      }, 300);
      return;
    }
    navigate(profile, true);
  }

  function noteParentReply(parentAuthor, parentPermlink, delta) {
    const section = $("#comments");
    const rootAuthor = section && section.getAttribute("data-root-author");
    const rootPermlink = section && section.getAttribute("data-root-permlink");
    if (
      section &&
      samePostId({ author: parentAuthor, permlink: parentPermlink }, rootAuthor, rootPermlink)
    ) {
      return;
    }
    const parentNode = findContentNode(parentAuthor, parentPermlink);
    let next = delta > 0 ? 1 : 0;
    if (parentNode && parentNode.children != null && parentNode.children !== "") {
      next = Math.max(0, (Number(parentNode.children) || 0) + delta);
    }
    if (parentNode) parentNode.children = next;
    syncDeleteOffers(parentAuthor, parentPermlink, next);
  }

  function applyDeletedContent(author, permlink) {
    removeDeletedCards(author, permlink);
    postSnaps.delete(snapKey(author, permlink));
    const commentEl = findCommentEl(author, permlink);
    if (commentEl) {
      const parentAuthor = commentEl.getAttribute("data-parent-author") || "";
      const parentPermlink = commentEl.getAttribute("data-parent-permlink") || "";
      const replies = commentEl.parentElement;
      commentEl.remove();
      if (
        replies &&
        replies.classList.contains("comment-replies") &&
        !replies.querySelector(":scope > .comment")
      ) {
        replies.remove();
      }
      dropReplyNode(currentPost, author, permlink);
      noteParentReply(parentAuthor, parentPermlink, -1);
      const section = $("#comments");
      if (section) {
        bumpCommentCount(-1);
        const list = section.querySelector(".comment-list");
        if (list && !list.querySelector(".comment") && !list.querySelector(".feed-hint")) {
          list.insertAdjacentHTML("beforeend", `<p class="feed-hint">No comments yet.</p>`);
        }
      }
      return;
    }
    const routeNow = parseRoute();
    const viewing =
      (postLayer.open &&
        samePostId({ author: postLayer.author, permlink: postLayer.permlink }, author, permlink)) ||
      (routeNow.name === "post" &&
        samePostId({ author: routeNow.author, permlink: routeNow.permlink }, author, permlink));
    if (viewing) leaveDeletedPost(author, permlink);
  }

  async function confirmContentDelete() {
    const target = contentDeleteTarget;
    if (!target || contentDeleteBusy) return;
    const user = observer();
    if (!user || !isOwnAuthor(target.author)) {
      hideContentDelete();
      return;
    }
    if (!hasSigner(user)) {
      setContentDeleteStatus(signerNeededMessage(), true);
      return;
    }
    const count = liveReplyCount(target.author, target.permlink);
    if (count == null) {
      setContentDeleteStatus("Couldn't check replies for this post.", true);
      return;
    }
    if (count > 0) {
      setContentDeleteStatus("Hive can only delete a post or comment that has no replies.", true);
      return;
    }
    const node = contentRecord(target.author, target.permlink);
    if (node && payoutIsPaid(node)) {
      setContentDeleteStatus("Hive cannot delete a post after it pays out.", true);
      return;
    }
    const net = contentNetRshares(node);
    if (net != null && net > 0) {
      setContentDeleteStatus("Hive cannot delete a post that still has upvotes.", true);
      return;
    }
    if (!window.ChainQueue || typeof ChainQueue.deleteComment !== "function") {
      setContentDeleteStatus("Couldn't send the delete.", true);
      return;
    }
    contentDeleteBusy = true;
    const confirmBtn = $("#contentDeleteConfirm");
    const cancelBtn = $("#contentDeleteCancel");
    if (confirmBtn) confirmBtn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;
    setContentDeleteStatus("Deleting……", false);
    try {
      const queued = ChainQueue.deleteComment({
        author: target.author,
        permlink: target.permlink,
      });
      await queued.promise;
      contentDeleteBusy = false;
      hideContentDelete();
      applyDeletedContent(target.author, target.permlink);
    } catch (err) {
      contentDeleteBusy = false;
      if (confirmBtn) confirmBtn.disabled = false;
      if (cancelBtn) cancelBtn.disabled = false;
      setContentDeleteStatus((err && err.message) || String(err), true);
    }
  }

  function contentPageUrl(author, permlink) {
    try {
      return new URL(postPath({ author: author, permlink: permlink }), location.href).href;
    } catch {
      return postPath({ author: author, permlink: permlink });
    }
  }

  function contentShareUrl(author, permlink, kind) {
    if (kind === "comment") {
      const id = commentAnchorId(author, permlink);
      if (HASH_ROUTING) {
        try {
          return new URL("#" + id, location.href).href;
        } catch {
          return "#" + id;
        }
      }
      if (currentPost && currentPost.author && currentPost.permlink) {
        return contentPageUrl(currentPost.author, currentPost.permlink) + "#" + id;
      }
    }
    return contentPageUrl(author, permlink);
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise((resolve, reject) => {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.left = "-9999px";
      document.body.appendChild(area);
      area.select();
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch (err) {
        area.remove();
        reject(err);
        return;
      }
      area.remove();
      if (ok) resolve();
      else reject(new Error("Couldn't copy the link."));
    });
  }

  function copyContentLink(root) {
    const author = (root && root.getAttribute("data-author")) || "";
    const permlink = (root && root.getAttribute("data-permlink")) || "";
    const kind = (root && root.getAttribute("data-content-kind")) || "";
    if (!author || !permlink) return;
    const url = contentShareUrl(author, permlink, kind);
    copyToClipboard(url).catch((err) => {
      showError((err && err.message) || "Couldn't copy the link.");
    });
  }

  /* ─── Feed ─── */
  function feedSpecForRoute(sort, tag) {
    const t = normalizeRouteTag(tag) || "";
    let s = sort === "trending" || sort === "hot" || sort === "feed" ? sort : "latest";
    if (s === "feed" && t) s = "latest";
    if (s === "feed") return { kind: "following", sort: "feed", tag: "", scope: "" };
    if (t) return { kind: "tag", sort: s, tag: t, scope: "" };
    return { kind: "ranked", sort: s, tag: "", scope: "" };
  }

  function feedSpecForProfile(author, page) {
    const sort = page === "comments" || page === "replies" ? page : "posts";
    return {
      kind: "profile",
      sort,
      tag: "",
      scope: String(author || "")
        .replace(/^@/, "")
        .toLowerCase(),
    };
  }

  function feedSpecForCommunity(name, page) {
    const sort = page === "trending" || page === "hot" ? page : "latest";
    return {
      kind: "community",
      sort,
      tag: "",
      scope: normalizeCommunityName(name),
    };
  }

  function feedSpecKey(spec) {
    const s = spec || {};
    return [s.kind || "", s.sort || "", s.tag || "", s.scope || ""].join("\n");
  }

  function currentFeedKey() {
    return feedSpecKey(feedState);
  }

  function feedStill(gen) {
    return gen === feedState.gen;
  }

  function resetFeed(spec) {
    const next = spec || feedSpecForRoute("latest");
    feedState.kind = next.kind || "ranked";
    feedState.sort = next.sort || "latest";
    feedState.tag = next.tag || "";
    feedState.scope = next.scope || "";
    feedState.items = [];
    feedState.seen = new Set();
    feedState.cursor = null;
    feedState.loading = false;
    feedState.done = false;
    feedState.holdAuto = false;
    feedState.gen += 1;
    expandedCardExcerpts.clear();
  }

  function isFollowingFeed() {
    return feedState.kind === "following";
  }

  function isFeedSurface(kind) {
    return kind === "following" || kind === "ranked" || kind === "tag" || kind === "community";
  }

  async function loadFeedPage() {
    if (feedState.loading || feedState.done) return;
    const kind = feedState.kind;
    if (!isFeedSurface(kind)) return;
    const gen = feedState.gen;
    const following = kind === "following";
    const sort = feedState.sort;
    const tag = kind === "community" ? feedState.scope : kind === "tag" ? feedState.tag : "";
    const user = observer();

    if (following && !user) {
      if (!feedStill(gen)) return;
      feedState.done = true;
      return;
    }

    feedState.loading = true;
    let pages = 0;
    const startCount = feedState.items.length;

    try {
      while (
        feedStill(gen) &&
        pages < MAX_PAGES_PER_LOAD &&
        feedState.items.length < startCount + FEED_TARGET
      ) {
        const cursor = {
          startAuthor: feedState.cursor && feedState.cursor.author,
          startPermlink: feedState.cursor && feedState.cursor.permlink,
          observer: user,
          limit: HiveApi.PAGE_SIZE,
        };
        const batch = following
          ? await HiveApi.getAccountPosts({
              account: user,
              sort: "feed",
              ...cursor,
            })
          : await HiveApi.getRankedPosts({
              sort,
              tag: tag || "",
              ...cursor,
            });
        if (!feedStill(gen)) return;
        setNodeLabel();
        pages++;

        if (!batch.length) {
          feedState.done = true;
          break;
        }

        let added = 0;
        const incoming = [];
        for (const post of batch) {
          if (!isRootPost(post)) continue;
          const key = `${post.author}/${post.permlink}`;
          if (feedState.seen.has(key)) continue;
          feedState.seen.add(key);
          added++;
          if (isBlacklistedPost(post)) continue;
          // Following keeps posts and reblogs. Cross-post shells stay on the other feeds.
          if (following && crossPostRef(post)) continue;
          incoming.push(post);
        }
        await resolveCrossPosts(incoming);
        if (!feedStill(gen)) return;
        for (let i = 0; i < incoming.length; i++) {
          if (!keepHydratedPost(incoming[i])) continue;
          feedState.items.push(incoming[i]);
        }

        const last = batch[batch.length - 1];
        if (
          !last ||
          (feedState.cursor &&
            last.author === feedState.cursor.author &&
            last.permlink === feedState.cursor.permlink)
        ) {
          feedState.done = true;
          break;
        }
        feedState.cursor = { author: last.author, permlink: last.permlink };
        if (batch.length < HiveApi.PAGE_SIZE) {
          feedState.done = true;
          break;
        }
        if (added === 0 && pages > 1) {
          feedState.done = true;
          break;
        }
      }
    } finally {
      if (feedStill(gen)) feedState.loading = false;
    }
  }

  function profilePath(name) {
    return appHref("/@" + name);
  }

  function authorLinkHtml(name, size, opts) {
    const href = HiveMd.escapeHtml(profilePath(name));
    const safe = HiveMd.escapeHtml(name);
    const avatar =
      opts && opts.avatar === false
        ? ""
        : `<img class="avatar" src="${HiveMd.avatarUrl(name, size)}" alt="">`;
    return `<a class="author-link" href="${href}">${avatar}<span class="author-name">@${safe}</span></a>`;
  }

  function communityNameOf(post) {
    const community = normalizeCommunityName(post && post.community);
    if (community) return community;
    return normalizeCommunityName(post && post.category);
  }

  function communityLabelHtml(post, className) {
    const cls = className || "community";
    const name = communityNameOf(post);
    const label = String(
      (post && (post.community_title || post.community || post.category)) || ""
    ).trim();
    if (name) {
      const text = (post && post.community_title) || name;
      return `<a class="${cls}" href="${HiveMd.escapeHtml(communityHref(name))}">${HiveMd.escapeHtml(text)}</a>`;
    }
    // A root post's category is its first tag. Link it to /space/<tag>.
    const tag =
      normalizeRouteTag(post && post.category) ||
      normalizeRouteTag(post && post.community) ||
      normalizeRouteTag(label);
    if (tag && !isCommunityName(tag)) {
      return `<a class="${cls}" href="${HiveMd.escapeHtml(appHref("/space/" + tag))}">${HiveMd.escapeHtml(label || tag)}</a>`;
    }
    if (!label) return "";
    return `<span class="${cls}">${HiveMd.escapeHtml(label)}</span>`;
  }

  function originalCacheKey(author, permlink) {
    return (
      String(author || "")
        .replace(/^@/, "")
        .toLowerCase() +
      "/" +
      String(permlink || "").toLowerCase()
    );
  }

  function crossPostRef(post) {
    if (!post) return null;
    const meta = HiveMd.parseJsonMetadata(post.json_metadata);
    const author = String(meta.original_author || "")
      .replace(/^@/, "")
      .trim();
    const permlink = String(meta.original_permlink || "").trim();
    if (!author || !permlink) return null;
    if (samePostId(post, author, permlink)) return null;
    const tags = Array.isArray(meta.tags) ? meta.tags : [];
    const first = String(tags[0] || "")
      .replace(/^#/, "")
      .trim()
      .toLowerCase();
    if (first === "cross-post") return { author, permlink };
    const body = String(post.body || "").trim();
    if (/^this is a cross post of\b/i.test(body)) return { author, permlink };
    return null;
  }

  function cardDisplayPost(post) {
    if (post && post.original_entry && post.original_entry.author && post.original_entry.permlink) {
      return post.original_entry;
    }
    return post;
  }

  function rebloggerOf(post) {
    let list = post && post.reblogged_by;
    if (typeof list === "string" && list) list = [list];
    if (!Array.isArray(list) || !list.length) {
      const first = post && post.first_reblogged_by;
      if (first) list = [first];
      else return "";
    }
    const author = String((post && post.author) || "")
      .replace(/^@/, "")
      .toLowerCase();
    for (let i = 0; i < list.length; i++) {
      const name = String(list[i] || "")
        .replace(/^@/, "")
        .trim();
      if (name && name.toLowerCase() !== author) return name;
    }
    return "";
  }

  function handleLinkHtml(name) {
    const n = String(name || "").replace(/^@/, "");
    if (!n) return "";
    return `<a class="feed-share-user" href="${HiveMd.escapeHtml(profilePath(n))}">@${HiveMd.escapeHtml(n)}</a>`;
  }

  function isPinnedPost(post) {
    if (!post) return false;
    if (post.is_pinned) return true;
    return Boolean(post.stats && post.stats.is_pinned);
  }

  function shareIconHtml(kind, className) {
    let paths;
    if (kind === "crosspost") {
      paths = `<polygon points="21.4,12 16.8,20.2 7.2,20.2 2.6,12 7.2,3.8 16.8,3.8"/>`;
    } else if (kind === "pin") {
      paths = `<polygon points="12,2.6 18.8,9.4 12,21.4 5.2,9.4"/>
           <polygon fill="currentColor" stroke="none" points="12,2.6 18.8,9.4 5.2,9.4"/>`;
    } else {
      paths = `<polyline points="5,12 5,4.4 18.2,4.4"/>
           <polyline points="14.6,1.2 18.2,4.4 14.6,7.6"/>
           <polyline points="19,12 19,19.6 5.8,19.6"/>
           <polyline points="9.4,22.8 5.8,19.6 9.4,16.4"/>`;
    }
    const cls = className || "feed-share-icon";
    return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="miter" stroke-linecap="square">${paths}</g></svg>`;
  }

  function reblogIconHtml() {
    return shareIconHtml("reblog", "reblog-icon");
  }

  function reblogControlHtml(post) {
    if (!isRootPost(post)) return "";
    const viewState = reblogView(post);
    const author = HiveMd.escapeHtml(post.author);
    const permlink = HiveMd.escapeHtml(post.permlink);
    const classes = [
      "reblog-btn",
      "stat-pill",
      "reblog-hit",
      viewState.mine ? "is-reblogged" : "",
      viewState.pending ? "is-pending" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const pending = viewState.pending ? "disabled" : "";
    const label = viewState.mine ? "Undo reblog" : "Reblog";
    return `<span class="reblog-wrap" data-reblog-author="${author}" data-reblog-permlink="${permlink}"><button type="button" class="${classes}" data-reblog-author="${author}" data-reblog-permlink="${permlink}" aria-pressed="${viewState.mine ? "true" : "false"}" aria-label="${label}" ${pending}>${reblogIconHtml()}<span class="reblog-n">${viewState.count}</span></button><span class="reblog-confirm-panel" hidden><p class="reblog-confirm-caption">Reblog this post?</p><p class="reblog-confirm-status" hidden></p><span class="reblog-confirm-actions"><button type="button" class="reblog-confirm" data-reblog-author="${author}" data-reblog-permlink="${permlink}">Reblog</button><button type="button" class="reblog-cancel">Cancel</button><button type="button" class="reblog-list">List</button></span></span></span>`;
  }

  function shareLineHtml(post) {
    if (!post) return "";
    const lines = [];
    if (isPinnedPost(post)) {
      lines.push(
        `<span class="feed-share-line">${shareIconHtml("pin")}pinned</span>`
      );
    }
    const reblogger = rebloggerOf(post);
    if (reblogger) {
      lines.push(
        `<span class="feed-share-line">${shareIconHtml("reblog")}${handleLinkHtml(reblogger)} reblogged</span>`
      );
    }
    if (crossPostRef(post)) {
      const destName = communityNameOf(post);
      const destTitle = (post && post.community_title) || destName;
      let extra = "";
      if (destName && destTitle) {
        extra = ` to <a class="feed-share-community" href="${HiveMd.escapeHtml(
          communityHref(destName)
        )}">${HiveMd.escapeHtml(destTitle)}</a>`;
      }
      lines.push(
        `<span class="feed-share-line">${shareIconHtml("crosspost")}<span class="feed-share-cp">${handleLinkHtml(post.author)} cross-posted${extra}</span></span>`
      );
    }
    if (!lines.length) return "";
    return `<p class="feed-share">${lines.join("")}</p>`;
  }

  function fetchOriginalPost(author, permlink) {
    const key = originalCacheKey(author, permlink);
    if (originalPostCache.has(key)) return originalPostCache.get(key);
    const pending = HiveApi.getPost(author, permlink)
      .then((post) => (post && post.author && post.permlink ? post : null))
      .catch(() => null);
    originalPostCache.set(key, pending);
    return pending;
  }

  async function resolveCrossPosts(posts) {
    const list = Array.isArray(posts) ? posts : [];
    const jobs = [];
    for (let i = 0; i < list.length; i++) {
      const post = list[i];
      if (!post || post.original_entry) continue;
      const ref = crossPostRef(post);
      if (!ref) continue;
      jobs.push(
        fetchOriginalPost(ref.author, ref.permlink).then((orig) => {
          if (orig) post.original_entry = orig;
        })
      );
    }
    if (jobs.length) await Promise.all(jobs);
  }

  function keepHydratedPost(post) {
    if (!post) return false;
    const shown = cardDisplayPost(post);
    if (shown && isBlacklistedPost(shown)) return false;
    return true;
  }

  function isCommentsOrRepliesFeed() {
    return (
      feedState.kind === "profile" &&
      (feedState.sort === "comments" || feedState.sort === "replies")
    );
  }

  function cardExcerptKey(post) {
    if (!post || !post.author || !post.permlink) return "";
    return snapKey(post.author, post.permlink);
  }

  function cardExcerptShort(post) {
    return HiveMd.excerpt(post, 200, {
      preserveLineBreaks: false,
      maxLines: 3,
    });
  }

  function cardExcerptLong(post) {
    return HiveMd.excerpt(post, 1000, { preserveLineBreaks: true });
  }

  function cardExcerptLongHtml(post) {
    return `<p class="card-excerpt card-excerpt-pre-wrap">${cardExcerptLong(post).html}</p>`;
  }

  function cardExcerptHtml(post) {
    if (isCommentsOrRepliesFeed() || expandedCardExcerpts.has(cardExcerptKey(post))) {
      return cardExcerptLongHtml(post);
    }
    return `<p class="card-excerpt card-excerpt-clamp">${cardExcerptShort(post).html}</p>`;
  }

  // The line clamp is a max. A short post stays shorter than three lines.
  function clampCssAbbreviates(el) {
    if (!el || !el.parentNode) return false;
    const shown = el.offsetHeight;
    const width = el.getBoundingClientRect().width;
    if (!shown || !width) return false;
    const clone = el.cloneNode(true);
    clone.classList.remove("card-excerpt-clamp");
    clone.setAttribute("aria-hidden", "true");
    clone.style.position = "absolute";
    clone.style.left = "0";
    clone.style.top = "0";
    clone.style.visibility = "hidden";
    clone.style.pointerEvents = "none";
    clone.style.boxSizing = "border-box";
    clone.style.width = width + "px";
    clone.style.height = "auto";
    clone.style.maxHeight = "none";
    clone.style.overflow = "visible";
    clone.style.display = "block";
    clone.style.webkitLineClamp = "unset";
    clone.style.webkitBoxOrient = "unset";
    el.parentNode.appendChild(clone);
    const full = clone.offsetHeight;
    clone.remove();
    return full > shown + 1;
  }

  function showCardExcerptPreview(excerpt, post) {
    expandedCardExcerpts.add(cardExcerptKey(post));
    excerpt.classList.remove("card-excerpt-clamp");
    excerpt.classList.add("card-excerpt-pre-wrap");
    excerpt.innerHTML = cardExcerptLong(post).html;
  }

  function openCardPost(card) {
    const hit = card.querySelector("a.card-hit");
    const href = hit && hit.getAttribute("href");
    if (!href) return false;
    navigate(href);
    return true;
  }

  // A clamped excerpt opens the longer preview when text is still hidden.
  // The excerpt flag covers the character and line clip. The clamp check
  // covers wrapping. A full post opens immediately. Mentions keep their links.
  function expandClampedCardExcerpt(e) {
    const el = eventElement(e.target);
    if (!el || el.closest("a[href]")) return false;
    const excerpt = el.closest(".card-excerpt-clamp");
    if (!excerpt) return false;
    const card = excerpt.closest("article.post-card");
    if (!card) return false;
    const loaded = findLoadedPost(
      card.getAttribute("data-author"),
      card.getAttribute("data-permlink")
    );
    const shown = cardDisplayPost(loaded);
    if (!shown) return false;
    e.preventDefault();
    const shortExcerpt = cardExcerptShort(shown);
    if (shortExcerpt.abbreviated || clampCssAbbreviates(excerpt)) {
      showCardExcerptPreview(excerpt, shown);
      return true;
    }
    openCardPost(card);
    return true;
  }

  function cardHtml(post) {
    const shown = cardDisplayPost(post) || post;
    const share = shareLineHtml(post);
    const authorAttr = HiveMd.escapeHtml(shown.author);
    const permlinkAttr = HiveMd.escapeHtml(shown.permlink);
    const rep = Math.floor(HiveMd.displayReputation(shown.author_reputation));
    const muted = isMutedHidden(shown);
    // Collapsed muted cards keep the author and time. The community pill and
    // the first-tag pill stay off until the post is revealed.
    const community = muted ? "" : communityLabelHtml(shown);
    const meta = `
        <div class="card-meta">
          ${authorLinkHtml(shown.author, "small", muted ? { avatar: false } : null)}
          <span class="meta-sep">·</span>
          <span>${rep}</span>
          ${community}
          ${metaTimeHtml(shown.created, postPath(shown))}
        </div>`;
    let card;
    if (muted) {
      card = `
      <article class="post-card is-muted" data-author="${authorAttr}" data-permlink="${permlinkAttr}">
        ${meta}
        ${mutedNoticeHtml("post", shown)}
      </article>
    `;
    } else {
      const img = HiveMd.extractImage(shown);
      const thumb = img
        ? `<img class="card-thumb" src="${HiveMd.escapeHtml(HiveMd.proxyImage(img, 480))}" alt="">`
        : "";
      card = `
      <article class="post-card${img ? " has-image" : " no-thumb"}" data-author="${authorAttr}" data-permlink="${permlinkAttr}">
        ${meta}
        <a class="card-hit" href="${HiveMd.escapeHtml(postPath(shown))}">
          <h2>${HiveMd.escapeHtml(shown.title || "(untitled)")}</h2>
        </a>
        ${cardExcerptHtml(shown)}
        ${thumb ? `<a class="card-thumb-link" href="${HiveMd.escapeHtml(postPath(shown))}">${thumb}</a>` : ""}
        <div class="card-stats">
          ${voteControlHtml(shown, "pills")}
          ${commentCountHtml(shown.children, postPath(shown))}
          ${reblogControlHtml(shown)}
          ${payoutHtml(shown, true)}
          ${contentMoreHtml(shown.author, shown.permlink, "card", shown.children)}
        </div>
      </article>
    `;
    }
    return `<div class="feed-item">${share}${card}</div>`;
  }

  function feedNavHtml(sort, tag) {
    const t = normalizeRouteTag(tag);
    const items = [];
    if (!t && observer()) {
      items.push(["feed", "Feed", appHref("/feed")]);
    }
    items.push(
      ["latest", "Latest", appHref(pathForFeedSort("latest", t))],
      ["trending", "Trending", appHref(pathForFeedSort("trending", t))]    );
    const tagHead = t
      ? `<div class="tag-feed-head">
          <h2 class="tag-feed-title">#${HiveMd.escapeHtml(t)}</h2>
        </div>`
      : "";
    return `
      ${tagHead}
      <nav class="feed-nav" aria-label="Feed sort">
        ${items
          .map(
            ([id, label, href]) =>
              `<a href="${href}" class="${id === sort ? "is-active" : ""}">${label}</a>`
          )
          .join("")}
      </nav>
    `;
  }

  function showFeedLoading(status) {
    if (!status) return;
    const more = feedState.items.length > 0;
    status.classList.toggle("is-feed-more", more);
    if (more) status.innerHTML = `<span class="btn-loader" aria-hidden="true"></span>`;
    status.hidden = false;
  }

  function feedTailNearView(list) {
    if (!list || postLayer.open) return false;
    const children = list.children;
    const items = [];
    for (let i = 0; i < children.length; i++) {
      if (children[i].classList.contains("feed-item")) items.push(children[i]);
    }
    if (!items.length) return false;
    const tail = items[Math.max(0, items.length - FEED_INFINITE_LEAD)];
    const rect = tail.getBoundingClientRect();
    if (rect.height < 1) return false;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    return rect.top <= vh + FEED_INFINITE_MARGIN;
  }

  function maybeLoadMoreFeed() {
    if (feedFillBusy || feedState.holdAuto || feedState.loading || feedState.done) return;
    const list = document.getElementById("feedList");
    const moreBtn = document.getElementById("moreBtn");
    if (!list || !moreBtn || !feedTailNearView(list)) return;
    moreBtn.click();
  }

  // A feed restored while another fill is still finishing checks again when
  // that fill releases the lock.
  function queueFeedInfinite() {
    if (!feedFillBusy) {
      maybeLoadMoreFeed();
      return;
    }
    feedInfiniteQueued = true;
  }

  // work() returns true when another page should load if the tail is already
  // in range (a short first page, or a fast scroll). A newer fill invalidates
  // this one so a route change does not clear the busy flag early.
  async function runFeedFill(work) {
    const token = ++feedFillToken;
    feedFillBusy = true;
    let chain = false;
    try {
      chain = await work();
    } catch (err) {
      chain = false;
      if (token === feedFillToken) {
        feedState.holdAuto = true;
        const status = document.getElementById("feedStatus");
        const moreBtn = document.getElementById("moreBtn");
        if (status) status.hidden = true;
        if (moreBtn) moreBtn.hidden = false;
        showError((err && err.message) || String(err));
      }
    } finally {
      if (token === feedFillToken) feedFillBusy = false;
    }
    if (token !== feedFillToken) return;
    const queued = feedInfiniteQueued;
    feedInfiniteQueued = false;
    if (chain || queued) maybeLoadMoreFeed();
  }

  function finishFeedPage(status, moreBtn, failed, before) {
    if (status) status.hidden = true;
    const stalled = !failed && !feedState.done && feedState.items.length === before;
    if (failed || stalled) {
      feedState.holdAuto = true;
      if (moreBtn) moreBtn.hidden = false;
      return false;
    }
    feedState.holdAuto = false;
    if (moreBtn) moreBtn.hidden = true;
    return !feedState.done;
  }

  function bindFeedMore(moreBtn, fill) {
    moreBtn.addEventListener("click", () => {
      if (feedFillBusy) return;
      feedState.holdAuto = false;
      fill();
    });
  }

  async function renderFeed(sort, reset, tag) {
    const t = normalizeRouteTag(tag) || "";
    const spec = feedSpecForRoute(sort, t);
    if (reset || currentFeedKey() !== feedSpecKey(spec)) resetFeed(spec);
    const loadingMsg =
      spec.kind === "following"
        ? "Loading your feed…"
        : t
          ? "Loading #" + t + "…"
          : "Loading feed…";
    view.innerHTML = `
      ${feedNavHtml(sort, t)}
      <div id="feedList" class="feed"></div>
      <div id="feedStatus" class="loading-row"><span class="btn-loader" aria-hidden="true"></span> ${HiveMd.escapeHtml(
        loadingMsg
      )}</div>
      <div class="feed-actions">
        <button type="button" class="btn-primary" id="moreBtn" hidden>Load more</button>
      </div>
    `;
    const list = $("#feedList");
    const status = $("#feedStatus");
    const moreBtn = $("#moreBtn");

    async function fill() {
      await runFeedFill(async () => {
        const gen = feedState.gen;
        hideVoteSlider();
        moreBtn.hidden = true;
        showFeedLoading(status);
        let failed = false;
        const before = feedState.items.length;
        try {
          await loadFeedPage();
        } catch (err) {
          if (!feedStill(gen)) return false;
          failed = true;
          showError(err.message || String(err));
        }
        if (!feedStill(gen) || !list.isConnected) return false;
        if (!failed) clearError();
        paintFeedCards(list, cardHtml);
        if (!feedState.items.length && feedState.done) {
          status.hidden = true;
          const following = isFollowingFeed();
          list.innerHTML = following
            ? `
          <div class="panel empty-state">
            <h2>Your feed is empty</h2>
            <p>Posts from accounts you follow will show up here.</p>
          </div>`
            : t
              ? `
          <div class="panel empty-state">
            <h2>No posts for #${HiveMd.escapeHtml(t)}</h2>
            <p>Try another sort, or check back later.</p>
          </div>`
              : `
          <div class="panel empty-state">
            <h2>No posts matched the filter</h2>
            <p>Try a different filter, or load again in a moment.</p>
          </div>`;
          return false;
        }
        return finishFeedPage(status, moreBtn, failed, before);
      });
    }

    bindFeedMore(moreBtn, fill);
    await fill();
  }

  /* ─── Favorite tags ─── */
  function favoriteTagHref(tag) {
    const t = normalizeRouteTag(tag);
    if (!t) return appHref("/");
    return appHref("/space/" + t);
  }

  function setTagsStatus(msg, isError) {
    const el = $("#favTagsStatus") || (parseRoute().name === "search" ? $("#searchStatus") : null);
    if (!el) return;
    if (!msg) {
      el.hidden = true;
      el.textContent = "";
      el.classList.remove("is-error");
      return;
    }
    el.hidden = false;
    el.textContent = msg;
    el.classList.toggle("is-error", Boolean(isError));
  }

  function paintFavoriteTags() {
    const list = $("#favTagsList");
    if (!list) return;
    const tags = readFavoriteTags();
    if (!tags.length) {
      list.innerHTML = `<p class="feed-hint tags-empty">No favorite tags yet. Add one below, or pick a suggestion.</p>`;
      return;
    }
    list.innerHTML = tags
      .map((t) => {
        const safe = HiveMd.escapeHtml(t);
        return `<span class="fav-tag-chip">
          <a class="tag" href="${HiveMd.escapeHtml(favoriteTagHref(t))}">#${safe}</a>
          <button type="button" class="fav-tag-remove" data-remove-tag="${safe}" aria-label="Remove ${safe}">×</button>
        </span>`;
      })
      .join("");
  }

  function tagsFromFeedItems(items) {
    const counts = new Map();
    const fav = new Set(readFavoriteTags());
    (items || []).forEach((post) => {
      tagsOf(post).forEach((raw) => {
        const t = normalizeRouteTag(raw);
        if (!t || t.length < 2 || fav.has(t) || isCommunityName(t)) return;
        counts.set(t, (counts.get(t) || 0) + 1);
      });
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, SUGGESTED_TAGS_SHOW)
      .map(([t]) => t);
  }

  function suggestedTags() {
    const fav = new Set(readFavoriteTags());
    const pinned = PINNED_SUGGESTED_TAGS.filter((t) => !fav.has(t));
    const skip = new Set(pinned);
    const fromFeed = tagsFromFeedItems(feedState.items).filter((t) => !skip.has(t));
    return pinned.concat(fromFeed);
  }

  function paintSuggestedTags(loading) {
    const list = $("#suggestTagsList");
    if (!list) return;
    if (loading) {
      list.innerHTML = `<div class="loading-row tags-suggest-loading"><span class="btn-loader" aria-hidden="true"></span> Loading suggested tags…</div>`;
      return;
    }
    const tags = suggestedTags();
    if (!tags.length) {
      const emptyFeed = !feedState.items.length;
      list.innerHTML = emptyFeed
        ? `<p class="feed-hint tags-empty">No tags in the current feed.</p>`
        : `<p class="feed-hint tags-empty">No more suggestions from this feed.</p>`;
      return;
    }
    list.innerHTML = tags
      .map((t) => {
        const safe = HiveMd.escapeHtml(t);
        return `<span class="fav-tag-chip">
          <a class="tag" href="${HiveMd.escapeHtml(favoriteTagHref(t))}">#${safe}</a>
          <button type="button" class="fav-tag-add" data-add-tag="${safe}" aria-label="Add ${safe} to favorites">++</button>
        </span>`;
      })
      .join("");
  }

  async function ensureSuggestionFeed() {
    if (feedState.items.length) return;
    const user = observer();
    if (user) {
      resetFeed(feedSpecForRoute("feed"));
      await loadFeedPage();
      if (feedState.items.length) return;
    }
    resetFeed(feedSpecForRoute("trending"));
    await loadFeedPage();
  }

  function addFavoriteTag(raw) {
    const tag = normalizeTag(raw) || normalizeRouteTag(raw);
    if (!tag || tag.length < 2 || !normalizeRouteTag(tag)) {
      setTagsStatus("Tags use 2–24 letters, numbers, or hyphens.", true);
      return false;
    }
    const tags = readFavoriteTags();
    if (tags.indexOf(tag) !== -1) {
      setTagsStatus("Already in your list.");
      return false;
    }
    if (tags.length >= MAX_FAVORITE_TAGS) {
      setTagsStatus("You can save up to " + MAX_FAVORITE_TAGS + " favorite tags.", true);
      return false;
    }
    tags.push(tag);
    storeFavoriteTags(tags);
    setTagsStatus("");
    paintFavoriteTags();
    paintLogoMenu();
    paintSearchResults();
    if (!$(".tags-suggest-loading")) paintSuggestedTags();
    return true;
  }

  function removeFavoriteTag(raw) {
    const tag = normalizeRouteTag(raw) || normalizeTag(raw);
    if (!tag) return;
    storeFavoriteTags(readFavoriteTags().filter((t) => t !== tag));
    setTagsStatus("");
    paintFavoriteTags();
    paintLogoMenu();
    paintSearchResults();
    if (!$(".tags-suggest-loading")) paintSuggestedTags();
  }

  function addFavoriteFromInput() {
    const input = $("#favTagInput");
    if (!input) return;
    const parts = String(input.value || "").split(/[,\s]+/).filter(Boolean);
    input.value = "";
    if (!parts.length) {
      setTagsStatus("Enter a tag to add.", true);
      return;
    }
    parts.forEach((p) => addFavoriteTag(p));
    input.focus();
  }

  async function renderTagsPage() {
    setPageMeta("Spaces — CyberSpace77");
    view.innerHTML = `
      <section class="cs77-page tags-page">
        <h2 class="page-title">Spaces</h2>
        <h2 class="tags-page-title">Favorite tags</h2>
        <p class="feed-hint">Saved in this browser.</p>
        <div class="tags-fav-list" id="favTagsList"></div>
        <form class="tags-add" id="favTagsForm">
          <input id="favTagInput" type="text" maxlength="24" placeholder="Add a tag" autocomplete="off" spellcheck="false" autocapitalize="off">
          <button type="submit" class="btn-primary btn-compact">Add</button>
        </form>
        <p class="tags-status" id="favTagsStatus" hidden></p>
        <h2 class="tags-page-title">Suggested tags</h2>
        <p class="feed-hint">From the current feed.</p>
        <div class="tags-suggest-list" id="suggestTagsList"></div>
      </section>
    `;
    paintFavoriteTags();
    const needFeed = !feedState.items.length;
    paintSuggestedTags(needFeed);
    const input = $("#favTagInput");
    if (input && !isMobileViewport()) input.focus();
    if (!needFeed) return;
    try {
      await ensureSuggestionFeed();
      clearError();
    } catch (err) {
      showError(err.message || String(err));
    }
    if (parseRoute().name !== "tags") return;
    paintSuggestedTags();
  }

  /* ─── Communities directory ─── */
  function subspacesPageName() {
    const r = parseRoute();
    if (r.name !== "communities") return "";
    if (r.page === "browse" || r.page === "newest" || r.page === "create") return r.page;
    return "search";
  }

  function isCommunityRankPage() {
    const page = subspacesPageName();
    return page === "browse" || page === "newest";
  }

  function setCommunitiesStatus(id, msg, isError) {
    const el =
      $(id) ||
      (isCommunityRankPage() ? $("#communityBrowseMsg") : null) ||
      (parseRoute().name === "search" ? $("#searchStatus") : null);
    if (!el) return;
    if (!msg) {
      el.hidden = true;
      el.textContent = "";
      el.classList.remove("is-error");
      return;
    }
    el.hidden = false;
    el.textContent = msg;
    el.classList.toggle("is-error", Boolean(isError));
  }

  function communityDirRecord(row) {
    if (!row) return null;
    const name =
      normalizeCommunityName(row.name) || communityIdFromInput(row.name);
    if (!name) return null;
    return {
      name,
      title: String(row.title || name).trim() || name,
      about: String(row.about || "").trim(),
      subscribers: Number(row.subscribers || 0),
      created: String(row.created_at || row.created || "").trim(),
    };
  }

  function communityCountText(count) {
    const n = Number(count);
    const whole = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    try {
      return whole.toLocaleString("en-US");
    } catch {
      return String(whole);
    }
  }

  function communitySubscriberLabel(count) {
    const n = Number(count);
    if (!Number.isFinite(n) || n < 0) return "";
    const whole = Math.floor(n);
    return communityCountText(whole) + (whole === 1 ? " subscriber" : " subscribers");
  }

  function communityDirRowHtml(row, mode) {
    const rec = communityDirRecord(row);
    if (!rec) return "";
    const name = HiveMd.escapeHtml(rec.name);
    const title = HiveMd.escapeHtml(rec.title);
    let metaHtml = "";
    let metaLabel = "";
    if (mode === "newest" || mode === "browse") {
      metaLabel = communitySubscriberLabel(rec.subscribers);
    }
    if (metaLabel) {
      metaHtml = `<span class="community-row-meta">${HiveMd.escapeHtml(metaLabel)}</span>`;
    }
    const fav = isFavoriteCommunity(rec.name);
    const action =
      mode === "favorite"
        ? `<button type="button" class="fav-tag-remove" data-remove-community="${name}" aria-label="Remove ${title}">×</button>`
        : `<button type="button" class="community-fav-btn${fav ? " is-saved" : ""}" data-toggle-community="${name}" data-community-title="${title}" aria-pressed="${fav ? "true" : "false"}" aria-label="${fav ? "Remove " + title + " from favorites" : "Add " + title + " to favorites"}">${fav ? "Favorite" : "Add"}</button>`;
    return `<div class="community-row">
        <a class="community-row-main" href="${HiveMd.escapeHtml(communityHref(rec.name))}">
          <img class="avatar" src="${HiveMd.avatarUrl(rec.name, "small")}" alt="">
          <span class="community-row-text">
            <span class="community-row-title">${title}</span>
            ${metaHtml}
          </span>
        </a>
        ${action}
      </div>`;
  }

  function paintBrowseFavoriteButtons() {
    const list = $("#communityBrowseList");
    if (!list) return;
    const buttons = list.querySelectorAll("[data-toggle-community]");
    for (let i = 0; i < buttons.length; i++) {
      const btn = buttons[i];
      const raw = btn.getAttribute("data-toggle-community") || "";
      const title = btn.getAttribute("data-community-title") || raw;
      const fav = isFavoriteCommunity(raw);
      btn.classList.toggle("is-saved", fav);
      btn.setAttribute("aria-pressed", fav ? "true" : "false");
      btn.textContent = fav ? "Favorite" : "Add";
      btn.setAttribute(
        "aria-label",
        fav ? "Remove " + title + " from favorites" : "Add " + title + " to favorites"
      );
    }
  }

  function paintFavoriteCommunities() {
    const list = $("#favCommunitiesList");
    if (!list) return;
    const rows = readFavoriteCommunities();
    if (!rows.length) {
      list.innerHTML = `<p class="feed-hint tags-empty">No favorite communities yet.</p>`;
      return;
    }
    list.innerHTML = rows.map((row) => communityDirRowHtml(row, "favorite")).join("");
  }

  function paintSubscribedCommunities() {
    const list = $("#subscribedCommunitiesList");
    if (!list) return;
    if (communityDirState.subsError) {
      list.innerHTML = `<p class="feed-hint tags-empty">${HiveMd.escapeHtml(communityDirState.subsError)}</p>`;
      return;
    }
    if (!communityDirState.subs.length) {
      list.innerHTML = `<p class="feed-hint tags-empty">You are not subscribed to any communities yet.</p>`;
      return;
    }
    list.innerHTML = communityDirState.subs
      .map((row) => communityDirRowHtml(row, "toggle"))
      .join("");
  }

  function paintCommunitySearch(loading) {
    const list = $("#communitySearchList");
    if (!list) return;
    if (loading || communityDirState.searchLoading) {
      list.innerHTML = `<div class="loading-row"><span class="btn-loader" aria-hidden="true"></span> Searching communities…</div>`;
      return;
    }
    if (!communityDirState.searchLooked) {
      list.innerHTML = "";
      return;
    }
    if (communityDirState.searchError) {
      list.innerHTML = `<p class="feed-hint tags-empty">${HiveMd.escapeHtml(communityDirState.searchError)}</p>`;
      return;
    }
    if (!communityDirState.search.length) {
      list.innerHTML = `<p class="feed-hint tags-empty">No communities matched that search.</p>`;
      return;
    }
    list.innerHTML = communityDirState.search
      .map((row) => communityDirRowHtml(row, "toggle"))
      .join("");
  }

  function refreshCommunityDirectory() {
    paintFavoriteCommunities();
    paintSubscribedCommunities();
    paintCommunitySearch();
    paintBrowseFavoriteButtons();
    paintLogoMenu();
    paintSearchResults();
  }

  function addFavoriteCommunityRecord(row) {
    const rec = favoriteCommunityRecord(row);
    if (!rec) {
      setCommunitiesStatus("#communitySearchStatus", "Enter a community name or hive-id.", true);
      return false;
    }
    const list = readFavoriteCommunities();
    if (list.some((c) => c.name === rec.name)) {
      setCommunitiesStatus("#communitySearchStatus", "Already in your list.");
      return false;
    }
    if (list.length >= MAX_FAVORITE_COMMUNITIES) {
      setCommunitiesStatus(
        "#communitySearchStatus",
        "You can save up to " + MAX_FAVORITE_COMMUNITIES + " favorite communities.",
        true
      );
      return false;
    }
    list.push(rec);
    storeFavoriteCommunities(list);
    setCommunitiesStatus("#communitySearchStatus", "");
    refreshCommunityDirectory();
    return true;
  }

  function removeFavoriteCommunity(raw) {
    const name = normalizeCommunityName(raw) || communityIdFromInput(raw);
    if (!name) return;
    storeFavoriteCommunities(readFavoriteCommunities().filter((c) => c.name !== name));
    setCommunitiesStatus("#communitySearchStatus", "");
    refreshCommunityDirectory();
  }

  function toggleFavoriteCommunity(raw, title) {
    const name = normalizeCommunityName(raw) || communityIdFromInput(raw);
    if (!name) return;
    if (isFavoriteCommunity(name)) {
      removeFavoriteCommunity(name);
      return;
    }
    addFavoriteCommunityRecord({ name, title: title || name });
  }

  function mergeCommunityResults(rows) {
    const out = [];
    const seen = new Set();
    (rows || []).forEach((row) => {
      const rec = communityDirRecord(row);
      if (!rec || seen.has(rec.name)) return;
      seen.add(rec.name);
      out.push({
        name: rec.name,
        title: rec.title,
        about: rec.about,
        subscribers: rec.subscribers,
        created: rec.created,
      });
    });
    return out;
  }

  async function lookupCommunityById(id, observerName) {
    const name = normalizeCommunityName(id) || communityIdFromInput(id);
    if (!name) return null;
    try {
      const info = await HiveApi.getCommunity(name, observerName || "");
      return communityDirRecord(info);
    } catch {
      return null;
    }
  }

  async function searchCommunitiesByQuery(raw) {
    const q = String(raw || "").trim();
    if (!q) return [];
    const observerName = observer();
    const id = communityIdFromInput(q);
    const rows = [];
    if (id) {
      const info = await lookupCommunityById(id, observerName);
      if (info) rows.push(info);
      return mergeCommunityResults(rows);
    }
    const list = await HiveApi.listCommunities({
      query: q,
      limit: SUGGESTED_TAGS_SHOW,
      observer: observerName,
    });
    return mergeCommunityResults(list);
  }

  async function runCommunitySearch() {
    const input = $("#communitySearchInput");
    if (!input) return;
    const raw = String(input.value || "").trim();
    if (!raw) {
      communityDirState.searchQuery = "";
      communityDirState.search = [];
      communityDirState.searchError = "";
      communityDirState.searchLooked = false;
      communityDirState.searchLoading = false;
      setCommunitiesStatus("#communitySearchStatus", "Enter a name, hive-id, or number.", true);
      paintCommunitySearch();
      return;
    }
    const gen = communityDirState.gen;
    communityDirState.searchQuery = raw;
    communityDirState.searchLooked = true;
    communityDirState.searchLoading = true;
    communityDirState.searchError = "";
    setCommunitiesStatus("#communitySearchStatus", "");
    paintCommunitySearch(true);
    try {
      const matches = await searchCommunitiesByQuery(raw);
      if (communityDirState.gen !== gen || subspacesPageName() !== "search") return;
      communityDirState.search = matches;
      communityDirState.searchError = "";
      communityDirState.searchLoading = false;
      paintCommunitySearch();
    } catch (err) {
      if (communityDirState.gen !== gen || subspacesPageName() !== "search") return;
      communityDirState.search = [];
      communityDirState.searchError = err.message || String(err);
      communityDirState.searchLoading = false;
      paintCommunitySearch();
    }
  }

  async function loadSubscribedCommunities(gen) {
    const user = observer();
    const list = $("#subscribedCommunitiesList");
    if (!user || !list) return;
    list.innerHTML = `<div class="loading-row"><span class="btn-loader" aria-hidden="true"></span> Loading subscriptions…</div>`;
    try {
      const rows = await HiveApi.listAllSubscriptions(user);
      if (communityDirState.gen !== gen || subspacesPageName() !== "search") return;
      communityDirState.subs = mergeCommunityResults(rows).sort((a, b) =>
        String(a.title || a.name).localeCompare(String(b.title || b.name))
      );
      communityDirState.subsError = "";
    } catch (err) {
      if (communityDirState.gen !== gen || subspacesPageName() !== "search") return;
      communityDirState.subs = [];
      communityDirState.subsError = err.message || String(err);
    }
    paintSubscribedCommunities();
  }

  function resetCommunityDirectory() {
    communityDirState.subs = [];
    communityDirState.subsError = "";
    communityDirState.searchQuery = "";
    communityDirState.search = [];
    communityDirState.searchError = "";
    communityDirState.searchLooked = false;
    communityDirState.searchLoading = false;
    communityDirState.browse = [];
    communityDirState.browseLast = "";
    communityDirState.browseDone = false;
    communityDirState.browseLoading = false;
    communityDirState.browseError = "";
  }

  function subspacesShellHtml(tab) {
    const page = tab === "browse" || tab === "newest" || tab === "create" ? tab : "search";
    const searchHref = HiveMd.escapeHtml(appHref(pathForSubspaces("search")));
    const browseHref = HiveMd.escapeHtml(appHref(pathForSubspaces("browse")));
    const newestHref = HiveMd.escapeHtml(appHref(pathForSubspaces("newest")));
    const createHref = HiveMd.escapeHtml(appHref(pathForSubspaces("create")));
    return `
      <section class="cs77-page communities-page">
        <h2 class="page-title">Subspaces</h2>
        <nav class="feed-nav subpage-nav" aria-label="Subspaces">
          <a href="${searchHref}" class="${page === "search" ? "is-active" : ""}">Search</a>
          <a href="${browseHref}" class="${page === "browse" ? "is-active" : ""}">Browse</a>
          <a href="${newestHref}" class="${page === "newest" ? "is-active" : ""}">Newest</a>
          <a href="${createHref}" class="${page === "create" ? "is-active" : ""}">Create...</a>
        </nav>
        <div id="subspacesPanel"></div>
      </section>
    `;
  }

  function searchGlassHtml() {
    return `<button type="submit" class="community-search-glass" aria-label="Search"><svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter"><path d="M3.9 7.15V3.9h3.25"/><path d="M12.85 3.9h3.25v3.25"/><path d="M7.15 16.1H3.9v-3.25"/><circle cx="10" cy="10" r="5.15"/><path d="M10 6.55v1.25M10 12.2v1.25M6.55 10h1.25M12.2 10h1.25"/><circle cx="10" cy="10" r="0.7" fill="currentColor" stroke="none"/></g><path class="community-search-handle" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="square" d="M16 16 21.15 21.15"/></svg></button>`;
  }

  function subspacesSearchHtml() {
    const user = observer();
    const subscribedBlock = user
      ? `
        <h2 class="tags-page-title">Subscribed</h2>
        <p class="feed-hint">Communities you follow on Hive.</p>
        <div class="community-list" id="subscribedCommunitiesList"></div>`
      : "";
    return `
      <h2 class="tags-page-title">Search communities</h2>
      <p class="feed-hint">Find communities by title, hive-id, or number.</p>
      <form class="tags-add community-search-form" id="communitySearchForm">
        <input id="communitySearchInput" type="text" maxlength="80" placeholder="Search" autocomplete="off" spellcheck="false" autocapitalize="off" enterkeyhint="search" aria-label="Search">
        ${searchGlassHtml()}
      </form>
      <p class="tags-status" id="communitySearchStatus" hidden></p>
      <div class="community-list" id="communitySearchList"></div>
      <h2 class="tags-page-title">Favorite communities</h2>
      <p class="feed-hint">Saved in this browser.</p>
      <div class="community-list" id="favCommunitiesList"></div>
      ${subscribedBlock}
    `;
  }

  function subspacesBrowseHtml(tab) {
    const hint = tab === "newest" ? "Newly created subspaces." : "Ranked by subscribers.";
    return `
      <p class="feed-hint">${hint}</p>
      <p class="tags-status" id="communityBrowseMsg" hidden></p>
      <div class="community-list" id="communityBrowseList"></div>
      <div id="communityBrowseMore" class="loading-row" hidden></div>
    `;
  }

  function browseListNearEnd() {
    const list = $("#communityBrowseList");
    if (!list) return false;
    const rect = list.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    return rect.bottom - vh <= COMMUNITY_BROWSE_SCROLL_PX;
  }

  function maybeLoadMoreBrowse() {
    if (!isCommunityRankPage()) return;
    if (communityDirState.browseLoading || communityDirState.browseDone) return;
    if (!$("#communityBrowseList")) return;
    if (browseListNearEnd()) loadMoreBrowseCommunities();
  }

  function setBrowseMoreLoading(on) {
    const more = $("#communityBrowseMore");
    if (!more) return;
    if (!on) {
      more.hidden = true;
      more.innerHTML = "";
      return;
    }
    more.hidden = false;
    more.innerHTML = `<span class="btn-loader" aria-hidden="true"></span> Loading Subspaces…`;
  }

  async function loadMoreBrowseCommunities() {
    if (!isCommunityRankPage()) return;
    if (communityDirState.browseLoading || communityDirState.browseDone) return;
    const gen = communityDirState.gen;
    const last = communityDirState.browseLast;
    const page = subspacesPageName();
    const sort = page === "newest" ? "new" : "subs";
    const mode = page === "newest" ? "newest" : "browse";
    communityDirState.browseLoading = true;
    const list = $("#communityBrowseList");
    if (!communityDirState.browse.length) {
      if (list) {
        list.innerHTML = `<div class="loading-row"><span class="btn-loader" aria-hidden="true"></span> Loading subspaces…</div>`;
      }
    } else {
      setBrowseMoreLoading(true);
    }
    let batch = [];
    let error = "";
    try {
      // "subs" is subscriber count. "new" is creation time, newest first.
      // last is the previous community name; hivemind does not repeat that row.
      batch = await HiveApi.listCommunities({
        sort,
        limit: COMMUNITY_BROWSE_LIMIT,
        last,
        observer: observer(),
      });
    } catch (err) {
      error = err.message || String(err);
    }
    if (communityDirState.gen !== gen) return;
    communityDirState.browseLoading = false;
    setBrowseMoreLoading(false);
    if (subspacesPageName() !== page) return;
    if (error) {
      communityDirState.browseError = error;
      communityDirState.browseDone = true;
      if (!communityDirState.browse.length && list) {
        list.innerHTML = `<p class="feed-hint tags-empty">${HiveMd.escapeHtml(error)}</p>`;
      } else {
        setCommunitiesStatus("#communityBrowseMsg", error, true);
      }
      return;
    }
    const rows = mergeCommunityResults(batch);
    const seen = new Set(communityDirState.browse.map((row) => row.name));
    const added = [];
    rows.forEach((row) => {
      if (!row || seen.has(row.name)) return;
      seen.add(row.name);
      added.push(row);
    });
    const nextLast = rows.length ? rows[rows.length - 1].name : "";
    if (
      !batch.length ||
      !added.length ||
      !nextLast ||
      nextLast === last ||
      batch.length < COMMUNITY_BROWSE_LIMIT
    ) {
      communityDirState.browseDone = true;
    } else {
      communityDirState.browseLast = nextLast;
    }
    if (added.length) communityDirState.browse = communityDirState.browse.concat(added);
    communityDirState.browseError = "";
    const host = $("#communityBrowseList");
    if (!host) return;
    if (!communityDirState.browse.length) {
      host.innerHTML = `<p class="feed-hint tags-empty">No subspaces yet.</p>`;
      return;
    }
    const html = added.map((row) => communityDirRowHtml(row, mode)).join("");
    if (!host.querySelector(".community-row")) host.innerHTML = html;
    else if (html) host.insertAdjacentHTML("beforeend", html);
    maybeLoadMoreBrowse();
  }

  function clearSubspaceCreateDraft() {
    subspaceCreateDraft.title = "";
    subspaceCreateDraft.about = "";
    subspaceCreateDraft.typeId = 1;
    subspaceCreateDraft.digits = "";
    subspaceCreateDraft.password = "";
    subspaceCreateDraft.created = "";
    subspaceCreateBusy = false;
    subspaceNameCheck += 1;
  }

  function rememberSubspaceCreateDraft() {
    const title = $("#subspaceCreateTitle");
    const about = $("#subspaceCreateAbout");
    const type = $("#subspaceCreateType");
    const name = $("#subspaceCreateName");
    const key = $("#subspaceCreateKey");
    if (title) subspaceCreateDraft.title = title.value;
    if (about) subspaceCreateDraft.about = about.value;
    if (type) subspaceCreateDraft.typeId = communityTypeId(type.value) || 1;
    if (name) subspaceCreateDraft.digits = subspaceOwnerDigits(name.value);
    if (key && key.value) subspaceCreateDraft.password = key.value;
  }

  function subspaceCreateStill(gen) {
    return communityDirState.gen === gen && subspacesPageName() === "create" && Boolean($("#subspaceCreateForm"));
  }

  function setSubspaceCreateStatus(message, isError) {
    const el = $("#subspaceCreateStatus");
    if (!el) return;
    el.textContent = message || "";
    el.classList.toggle("is-error", Boolean(isError) && Boolean(message));
  }

  function paintSubspaceCreateLock() {
    const busy = subspaceCreateBusy;
    const fixedName = Boolean(subspaceCreateDraft.created);
    const title = $("#subspaceCreateTitle");
    const about = $("#subspaceCreateAbout");
    const type = $("#subspaceCreateType");
    const name = $("#subspaceCreateName");
    const saved = $("#subspaceCreateSaved");
    const submit = $("#subspaceCreateSubmit");
    if (title) title.disabled = busy;
    if (about) about.disabled = busy;
    if (type) type.disabled = busy || fixedName;
    if (name) name.disabled = busy || fixedName;
    if (saved) saved.disabled = busy;
    if (submit) submit.disabled = busy;
  }

  function subspaceOwnerName(typeId, digits) {
    return "hive-" + String(typeId) + String(digits || "");
  }

  function subspaceOwnerDigits(value) {
    const raw = String(value || "")
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/^@/, "");
    const rest = raw.startsWith("hive-") ? raw.slice(5) : raw.replace(/^hive-?/, "");
    const digits = rest.replace(/\D/g, "");
    if (!digits) return "";
    if (raw.startsWith("hive-") || digits.length > 5) return digits.slice(1, 6);
    return digits.slice(0, 5);
  }

  function subspaceNameOk(name, typeId) {
    return new RegExp("^hive-" + String(typeId) + "\\d{5}$").test(name);
  }

  function randomSubspaceDigits() {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return String(buf[0] % 100000).padStart(5, "0");
  }

  const SUBSPACE_B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

  function subspaceBase58(source) {
    if (!source || !source.length) return "";
    let zeroes = 0;
    let pbegin = 0;
    while (pbegin < source.length && source[pbegin] === 0) {
      zeroes += 1;
      pbegin += 1;
    }
    const size = (((source.length - pbegin) * 138) / 100 + 1) | 0;
    const b58 = new Uint8Array(size);
    let length = 0;
    for (let i = pbegin; i < source.length; i++) {
      let carry = source[i];
      let j = 0;
      for (let it = size - 1; (carry !== 0 || j < length) && it >= 0; it--, j++) {
        carry += 256 * b58[it];
        b58[it] = carry % 58;
        carry = (carry / 58) | 0;
      }
      length = j;
    }
    let it = size - length;
    while (it < size && b58[it] === 0) it += 1;
    let str = "1".repeat(zeroes);
    for (; it < size; it++) str += SUBSPACE_B58.charAt(b58[it]);
    return str;
  }

  function randomSubspaceMasterKey() {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return "P" + subspaceBase58(bytes);
  }

  function formatHiveFee(raw) {
    if (raw == null) return "";
    if (typeof raw === "string") {
      const match = raw.trim().match(/^(\d+(?:\.\d+)?)\s+([A-Za-z]+)$/);
      if (!match) return "";
      const amount = Number(match[1]);
      if (!Number.isFinite(amount) || amount < 0) return "";
      return amount.toFixed(3) + " " + match[2].toUpperCase();
    }
    if (typeof raw === "object") {
      const amount = Number(raw.amount);
      const precision = Number(raw.precision);
      const places = Number.isFinite(precision) ? precision : 3;
      if (!Number.isFinite(amount) || amount < 0) return "";
      return (amount / Math.pow(10, places)).toFixed(3) + " HIVE";
    }
    return "";
  }

  function subspaceClaimedTokens(account) {
    const n = Number(account && account.pending_claimed_accounts);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }

  function subspaceFeeWords(text) {
    return String(text || "").replace(/\bHIVE\b/g, "hive");
  }

  function subspaceFeeLine(fee, account) {
    const user = observer();
    if (!user) {
      return fee ? subspaceFeeWords("Account creation fee: " + fee + ".") : "Could not load the account creation fee.";
    }
    const tokens = subspaceClaimedTokens(account);
    if (tokens > 0) {
      const noun = tokens === 1 ? "account creation token" : "account creation tokens";
      const usual = fee ? " The usual fee is " + fee + "." : "";
      return subspaceFeeWords("You have " + tokens + " " + noun + ". This creation uses one token instead of paying that fee." + usual);
    }
    if (!fee) return "Could not load the account creation fee.";
    let line = "Account creation fee: " + fee + ".";
    const balance = account ? HiveApi.parseAsset(account.balance) : NaN;
    const cost = HiveApi.parseAsset(fee);
    if (account && Number.isFinite(balance) && Number.isFinite(cost) && balance < cost) {
      const held = String(account.balance || "").trim();
      if (held) line += " This account has " + held + ".";
    }
    return subspaceFeeWords(line);
  }

  function paintSubspaceNameStatus(kind, text) {
    const el = $("#subspaceCreateNameStatus");
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("is-ok", kind === "ok");
    el.classList.toggle("is-bad", kind === "taken" || kind === "invalid" || kind === "error");
  }

  function paintSubspaceCreateType() {
    const typeId = communityTypeId(($("#subspaceCreateType") || {}).value) || 1;
    const input = $("#subspaceCreateName");
    const note = $("#subspaceCreateTypeNote");
    const nameNote = $("#subspaceCreateNameNote");
    if (input && !input.disabled) {
      const name = subspaceOwnerName(typeId, subspaceOwnerDigits(input.value));
      if (input.value !== name) input.value = name;
    }
    if (note) note.textContent = communityTypeNote(typeId);
    if (nameNote) {
      nameNote.textContent =
        "hive-" + typeId + "xxxxx. The first digit is the subspace type. The username must be free.";
    }
    return typeId;
  }

  async function hiveAccountRecord(name) {
    const rows = await HiveApi.getAccounts([name]);
    const account = rows && rows[0];
    if (!account || String(account.name || "").toLowerCase() !== name) return null;
    return account;
  }

  async function checkSubspaceOwnerName() {
    const token = (subspaceNameCheck += 1);
    const typeId = paintSubspaceCreateType();
    const input = $("#subspaceCreateName");
    const digits = subspaceOwnerDigits(input && input.value);
    const name = subspaceOwnerName(typeId, digits);
    if (input && !input.disabled && input.value !== name) input.value = name;
    subspaceCreateDraft.digits = digits;
    subspaceCreateDraft.typeId = typeId;
    if (!subspaceNameOk(name, typeId)) {
      paintSubspaceNameStatus("invalid", "Use a name like hive-" + typeId + "xxxxx.");
      return { ok: false, name: "", taken: false };
    }
    paintSubspaceNameStatus("checking", "Checking whether that username is free…");
    try {
      const account = await hiveAccountRecord(name);
      if (token !== subspaceNameCheck || subspacesPageName() !== "create") {
        return { ok: false, name: name, taken: false, stale: true };
      }
      if (account && subspaceCreateDraft.created === name) {
        paintSubspaceNameStatus("ok", name + " is created. Press Create to finish setting it up.");
        return { ok: true, name: name, taken: false };
      }
      if (account) {
        paintSubspaceNameStatus("taken", name + " is already taken.");
        return { ok: false, name: name, taken: true };
      }
      paintSubspaceNameStatus("ok", name + " is available.");
      return { ok: true, name: name, taken: false };
    } catch (err) {
      if (token !== subspaceNameCheck || subspacesPageName() !== "create") {
        return { ok: false, name: name, taken: false, stale: true };
      }
      paintSubspaceNameStatus("error", (err && err.message) || "Could not check that username.");
      return { ok: false, name: name, taken: false };
    }
  }

  function scheduleSubspaceNameCheck() {
    window.clearTimeout(scheduleSubspaceNameCheck.timer);
    scheduleSubspaceNameCheck.timer = window.setTimeout(() => {
      if (subspaceCreateBusy) return;
      checkSubspaceOwnerName();
    }, 400);
  }

  async function fillFreeSubspaceNumber(gen) {
    const input = $("#subspaceCreateName");
    if (!input) return;
    if (/^\d{5}$/.test(subspaceOwnerDigits(input.value))) {
      if (!subspaceCreateBusy) await checkSubspaceOwnerName();
      return;
    }
    paintSubspaceNameStatus("checking", "Looking for a free username…");
    for (let i = 0; i < 12; i++) {
      if (subspaceCreateBusy || !subspaceCreateStill(gen)) return;
      if (subspaceOwnerDigits(input.value)) {
        await checkSubspaceOwnerName();
        return;
      }
      const typeId = communityTypeId(($("#subspaceCreateType") || {}).value) || 1;
      const digits = randomSubspaceDigits();
      const name = subspaceOwnerName(typeId, digits);
      let record = null;
      try {
        record = await hiveAccountRecord(name);
      } catch {
        if (subspaceCreateBusy || !subspaceCreateStill(gen)) return;
        continue;
      }
      if (subspaceCreateBusy || !subspaceCreateStill(gen)) return;
      if (subspaceOwnerDigits(input.value)) {
        await checkSubspaceOwnerName();
        return;
      }
      if (!record) {
        input.value = name;
        subspaceCreateDraft.digits = digits;
        await checkSubspaceOwnerName();
        return;
      }
    }
    if (subspaceCreateBusy || !subspaceCreateStill(gen) || subspaceOwnerDigits(input.value)) return;
    const typeId = communityTypeId(($("#subspaceCreateType") || {}).value) || 1;
    input.value = subspaceOwnerName(typeId, randomSubspaceDigits());
    await checkSubspaceOwnerName();
  }

  async function loadSubspaceCreateFee(gen) {
    const el = $("#subspaceCreateFee");
    if (el) el.textContent = "Checking the account creation fee…";
    let fee = "";
    let account = null;
    try {
      const props = await HiveApi.hiveRpc("condenser_api.get_chain_properties", []);
      fee = formatHiveFee(props && props.account_creation_fee);
    } catch {
      fee = "";
    }
    const user = normalizeLoginUser(observer());
    if (user) {
      try {
        account = await hiveAccountRecord(user);
      } catch {
        account = null;
      }
    }
    if (!subspaceCreateStill(gen)) return;
    const node = $("#subspaceCreateFee");
    if (node) node.textContent = subspaceFeeLine(fee, account);
  }

  function subspaceCreateHtml() {
    const esc = HiveMd.escapeHtml;
    const typeId = communityTypeId(subspaceCreateDraft.typeId) || 1;
    const digits = /^\d{5}$/.test(subspaceCreateDraft.digits) ? subspaceCreateDraft.digits : "";
    if (!subspaceCreateDraft.password) subspaceCreateDraft.password = randomSubspaceMasterKey();
    return `
      <form class="settings-form" id="subspaceCreateForm" autocomplete="off" novalidate>
        <div class="community-panel subspace-create">
          <h2 class="settings-section-title">Create new subspace</h2>
          <div class="settings-field">
            <label class="settings-label" for="subspaceCreateTitle">Title</label>
            <input id="subspaceCreateTitle" name="title" type="text" maxlength="20" autocomplete="off" spellcheck="false" value="${esc(subspaceCreateDraft.title || "")}">
          </div>
          <div class="settings-field">
            <label class="settings-label" for="subspaceCreateAbout">About</label>
            <textarea id="subspaceCreateAbout" class="settings-about" name="about" rows="3" maxlength="120">${esc(subspaceCreateDraft.about || "")}</textarea>
          </div>
          <div class="settings-field">
            <label class="settings-label" for="subspaceCreateType">Subspace type</label>
            <select id="subspaceCreateType" name="type_id">${communityTypeOptionsHtml(typeId)}</select>
            <p class="settings-note" id="subspaceCreateTypeNote">${esc(communityTypeNote(typeId))}</p>
          </div>
          <div class="settings-field subspace-account-start">
            <label class="settings-label settings-section-line" for="subspaceCreateName"><span>Subspace username (owner)</span></label>
            <div class="subspace-key-line">
              <input id="subspaceCreateName" name="username" type="text" maxlength="16" autocomplete="off" spellcheck="false" autocapitalize="off" aria-describedby="subspaceCreateNameNote" value="${esc(subspaceOwnerName(typeId, digits))}">
              <button type="button" class="btn-ghost btn-compact" id="subspaceCreateNameCopy" aria-label="Copy username">Copy</button>
            </div>
            <p class="settings-note" id="subspaceCreateNameNote">hive-${typeId}xxxxx. The first digit is the subspace type. The username must be free.</p>
            <p class="settings-note subspace-name-status" id="subspaceCreateNameStatus"></p>
          </div>
          <div class="settings-field subspace-account-end">
            <label class="settings-label" for="subspaceCreateKey">Master key</label>
            <div class="subspace-key-line">
              <input id="subspaceCreateKey" type="text" readonly spellcheck="false" autocomplete="off" autocapitalize="off" value="${esc(subspaceCreateDraft.password)}">
              <button type="button" class="btn-ghost btn-compact" id="subspaceCreateCopy" aria-label="Copy master key">Copy</button>
            </div>
            <p class="settings-note">Owner password for this account. CyberSpace77 does not store it.</p>
          </div>
          <div class="settings-field">
            <label class="cyber-toggle">
              <input id="subspaceCreateSaved" type="checkbox">
              <span class="cyber-toggle-track" aria-hidden="true"></span>
              <span class="cyber-toggle-copy">
                <span class="cyber-toggle-title">Backup confirmation</span>
                <span class="cyber-toggle-sub">I have securely saved the owner username and password.</span>
              </span>
            </label>
          </div>
          <p class="settings-note" id="subspaceCreateFee">Checking the account creation fee…</p>
          <div class="settings-actions">
            <button type="submit" class="btn-primary" id="subspaceCreateSubmit">Create</button>
          </div>
          <p class="settings-status" id="subspaceCreateStatus"></p>
        </div>
      </form>
    `;
  }

  function subspaceAuthority(pub) {
    return {
      weight_threshold: 1,
      account_auths: [],
      key_auths: [[pub, 1]],
    };
  }

  function subspaceCreateOperation(creator, name, keys, choice) {
    const body = {
      creator: creator,
      new_account_name: name,
      owner: subspaceAuthority(keys.ownerPub),
      active: subspaceAuthority(keys.activePub),
      posting: subspaceAuthority(keys.postingPub),
      memo_key: keys.memoPub,
      json_metadata: "",
    };
    if (choice.mode === "token") {
      body.extensions = [];
      return ["create_claimed_account", body];
    }
    return ["account_create", Object.assign({ fee: choice.fee }, body)];
  }

  function subspaceSetupOperations(name, admin, title, about, typeId) {
    return [
      communityCustomOp(name, "setRole", {
        community: name,
        account: admin,
        role: "admin",
      }),
      communityCustomOp(name, "updateProps", {
        community: name,
        props: {
          title: title,
          about: about,
          lang: "en",
          is_nsfw: false,
          description: "",
          flag_text: "",
          type_id: typeId,
        },
      }),
    ];
  }

  function subspaceWait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function subspaceCreationChoice(user) {
    let fee = "";
    try {
      const props = await HiveApi.hiveRpc("condenser_api.get_chain_properties", []);
      fee = formatHiveFee(props && props.account_creation_fee);
    } catch {
      fee = "";
    }
    const account = await hiveAccountRecord(user);
    if (!account) throw new Error("Could not load @" + user + ".");
    if (subspaceClaimedTokens(account) > 0) return { mode: "token", fee: fee, account: account };
    if (!fee) throw new Error("Could not load the account creation fee.");
    return { mode: "fee", fee: fee, account: account };
  }

  async function waitForSubspaceAccount(name) {
    let last = null;
    for (let i = 0; i < 20; i++) {
      try {
        last = await hiveAccountRecord(name);
      } catch (err) {
        last = null;
        if (i === 19) throw err;
      }
      if (last) return last;
      await subspaceWait(1500);
    }
    throw new Error("The subspace account was created, but the network has not shown it yet. Press Create to finish setting it up.");
  }

  async function copySubspaceMasterKey(input, button) {
    if (!input || !button) return;
    const value = String(input.value || "");
    if (!value) return;
    let copied = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(value);
        copied = true;
      }
    } catch {
      copied = false;
    }
    if (!copied && input) {
      input.focus();
      input.select();
      try {
        copied = document.execCommand("copy");
      } catch {
        copied = false;
      }
    }
    if (!button) return;
    button.textContent = copied ? "Copied" : "Copy";
    window.setTimeout(() => {
      if (button.isConnected) button.textContent = "Copy";
    }, 1600);
  }

  async function submitSubspaceCreate(event) {
    if (event) event.preventDefault();
    if (subspaceCreateBusy) return;
    rememberSubspaceCreateDraft();
    const title = String(($("#subspaceCreateTitle") || {}).value || "").trim();
    const about = String(($("#subspaceCreateAbout") || {}).value || "").trim();
    const typeId = communityTypeId(($("#subspaceCreateType") || {}).value);
    const digits = subspaceOwnerDigits(($("#subspaceCreateName") || {}).value);
    const password = String(($("#subspaceCreateKey") || {}).value || "");
    const saved = Boolean(($("#subspaceCreateSaved") || {}).checked);
    const name = subspaceOwnerName(typeId, digits);
    if (title.length < 3 || title.length > 20) {
      setSubspaceCreateStatus("Title must be 3 to 20 characters.", true);
      return;
    }
    if (title[0] === "@" || title[0] === "#") {
      setSubspaceCreateStatus("Title cannot start with @ or #.", true);
      return;
    }
    if (about.length > 120) {
      setSubspaceCreateStatus("About must be 120 characters or less.", true);
      return;
    }
    if (!typeId) {
      setSubspaceCreateStatus("Choose a subspace type.", true);
      return;
    }
    if (!subspaceNameOk(name, typeId)) {
      setSubspaceCreateStatus("The subspace owner username must look like hive-" + typeId + "xxxxx.", true);
      return;
    }
    if (!password) {
      setSubspaceCreateStatus("The master key is missing. Reload this page.", true);
      return;
    }
    if (!saved) {
      setSubspaceCreateStatus("Confirm that you have securely saved the subspace owner username and password.", true);
      return;
    }
    const user = normalizeLoginUser(observer());
    if (!user) {
      setSubspaceCreateStatus("", false);
      openLogin();
      return;
    }
    const created = subspaceCreateDraft.created;
    if (created && created !== name) {
      setSubspaceCreateStatus("The account " + created + " was already created. Set that username again to finish setting it up.", true);
      return;
    }
    window.clearTimeout(scheduleSubspaceNameCheck.timer);
    subspaceCreateBusy = true;
    paintSubspaceCreateLock();
    setSubspaceCreateStatus("Checking that username…", false);
    let keys = null;
    try {
      const checked = await checkSubspaceOwnerName();
      if (checked.stale) {
        if (subspacesPageName() === "create") {
          setSubspaceCreateStatus("Could not check that username. Try again.", true);
        }
        return;
      }
      if (!checked.ok || checked.name !== name) {
        setSubspaceCreateStatus(
          checked.taken ? name + " is already taken." : "Choose a username that is still available.",
          true
        );
        return;
      }
      if (!window.HiveAuth || typeof HiveAuth.keysFromLogin !== "function" || typeof HiveAuth.broadcastWif !== "function") {
        throw new Error("Could not prepare the subspace keys.");
      }
      keys = await HiveAuth.keysFromLogin(name, password);
      if (created !== name) {
        const choice = await subspaceCreationChoice(user);
        const operation = subspaceCreateOperation(user, name, keys, choice);
        const feeNote = choice.mode === "token" ? "Uses one account creation token." : "Fee " + subspaceFeeWords(choice.fee) + ".";
        if ($("#subspaceCreateFee")) {
          $("#subspaceCreateFee").textContent = subspaceFeeLine(choice.fee, choice.account);
        }
        setSubspaceCreateStatus("Creating the subspace account…", false);
        await signWithDialog(user, [operation], {
          source: "create",
          authority: "Active",
          title: "Create subspace",
          lead: "Use hive keychain (recommended) or enter the active key of @" + user + ". " + feeNote,
          cancelMessage: "Creation was cancelled.",
          failMessage: "Could not create the subspace account.",
          onKeychain: function () {
            setSubspaceCreateStatus("Waiting for Keychain…", false);
          },
        });
        subspaceCreateDraft.created = name;
        paintSubspaceCreateLock();
      }
      setSubspaceCreateStatus("Waiting for the new account…", false);
      await waitForSubspaceAccount(name);
      setSubspaceCreateStatus("Setting up the subspace…", false);
      await HiveAuth.broadcastWif(
        keys.posting,
        subspaceSetupOperations(name, user, title, about, typeId)
      );
      setSubspaceCreateStatus("Opening the subspace…", false);
      for (let i = 0; i < 12; i++) {
        try {
          const info = await HiveApi.getCommunity(name, user);
          if (info && info.name) break;
        } catch {
          /* Hivemind may still be indexing the new subspace. */
        }
        await subspaceWait(2000);
      }
      clearSubspaceCreateDraft();
      navigate(communityHref(name));
    } catch (err) {
      const cancelled = Boolean(err && err.ownerCancel);
      const detail = (err && err.message) || "Could not create this subspace.";
      if (subspaceCreateDraft.created === name) {
        setSubspaceCreateStatus(
          "The subspace account " + name + " was created. Setting it up did not finish. " + detail + " Press Create to try the setup again.",
          true
        );
      } else {
        setSubspaceCreateStatus(cancelled ? "Creation was cancelled." : detail, !cancelled);
      }
    } finally {
      if (keys) {
        keys.owner = "";
        keys.active = "";
        keys.posting = "";
        keys.memo = "";
      }
      keys = null;
      subspaceCreateBusy = false;
      paintSubspaceCreateLock();
    }
  }

  function bindSubspaceCreate(gen) {
    paintSubspaceCreateType();
    paintSubspaceCreateLock();
    const form = $("#subspaceCreateForm");
    const type = $("#subspaceCreateType");
    const name = $("#subspaceCreateName");
    const nameCopy = $("#subspaceCreateNameCopy");
    const copy = $("#subspaceCreateCopy");
    const title = $("#subspaceCreateTitle");
    const about = $("#subspaceCreateAbout");
    if (form) form.addEventListener("submit", submitSubspaceCreate);
    if (type) {
      type.addEventListener("change", () => {
        rememberSubspaceCreateDraft();
        paintSubspaceCreateType();
        scheduleSubspaceNameCheck();
      });
    }
    if (name) {
      name.addEventListener("input", () => {
        const typeId = communityTypeId((type && type.value) || 1) || 1;
        const next = subspaceOwnerName(typeId, subspaceOwnerDigits(name.value));
        if (name.value !== next) {
          name.value = next;
          if (name.setSelectionRange) name.setSelectionRange(next.length, next.length);
        }
        rememberSubspaceCreateDraft();
        scheduleSubspaceNameCheck();
      });
    }
    if (title) title.addEventListener("input", rememberSubspaceCreateDraft);
    if (about) about.addEventListener("input", rememberSubspaceCreateDraft);
    if (nameCopy) {
      nameCopy.addEventListener("click", () => copySubspaceMasterKey(name, nameCopy));
    }
    if (copy) copy.addEventListener("click", () => copySubspaceMasterKey($("#subspaceCreateKey"), copy));
    if (title && !isMobileViewport()) title.focus();
    loadSubspaceCreateFee(gen);
    fillFreeSubspaceNumber(gen);
  }

  async function renderCommunitiesPage(page) {
    const tab = page === "browse" || page === "newest" || page === "create" ? page : "search";
    setPageMeta(tab === "create" ? "Create subspace — CyberSpace77" : "Subspaces — CyberSpace77");
    communityDirState.gen += 1;
    const gen = communityDirState.gen;
    resetCommunityDirectory();
    view.innerHTML = subspacesShellHtml(tab);
    const host = $("#subspacesPanel");
    if (!host) return;
    if (tab === "create") {
      host.innerHTML = subspaceCreateHtml();
      bindSubspaceCreate(gen);
      return;
    }
    if (tab === "browse" || tab === "newest") {
      host.innerHTML = subspacesBrowseHtml(tab);
      await loadMoreBrowseCommunities();
      return;
    }
    host.innerHTML = subspacesSearchHtml();
    paintFavoriteCommunities();
    const searchInput = $("#communitySearchInput");
    if (searchInput && !isMobileViewport()) searchInput.focus();
    if (observer()) await loadSubscribedCommunities(gen);
  }

  /* ─── Search ─── */
  function searchPageName() {
    const r = parseRoute();
    if (r.name !== "search") return "";
    return r.page === "spaces" || r.page === "subspaces" ? r.page : "users";
  }

  function setSearchStatus(msg, isError) {
    const el = $("#searchStatus");
    if (!el) return;
    if (!msg) {
      el.hidden = true;
      el.textContent = "";
      el.classList.remove("is-error");
      return;
    }
    el.hidden = false;
    el.textContent = msg;
    el.classList.toggle("is-error", Boolean(isError));
  }

  function addFavoriteUser(raw) {
    const name = normalizeUserName(raw);
    if (!name) {
      setSearchStatus("Usernames are 3–16 letters, numbers, dots, or hyphens.", true);
      return false;
    }
    const users = readFavoriteUsers();
    if (users.indexOf(name) !== -1) {
      setSearchStatus("Already in your list.");
      return false;
    }
    if (users.length >= MAX_FAVORITE_USERS) {
      setSearchStatus("You can save up to " + MAX_FAVORITE_USERS + " favorite users.", true);
      return false;
    }
    users.push(name);
    storeFavoriteUsers(users);
    setSearchStatus("");
    paintSearchResults();
    paintLogoMenu();
    return true;
  }

  function removeFavoriteUser(raw) {
    const name = normalizeUserName(raw);
    if (!name) return;
    storeFavoriteUsers(readFavoriteUsers().filter((n) => n !== name));
    setSearchStatus("");
    paintSearchResults();
    paintLogoMenu();
  }

  function toggleFavoriteUser(raw) {
    const name = normalizeUserName(raw);
    if (!name) return;
    if (isFavoriteUser(name)) removeFavoriteUser(name);
    else addFavoriteUser(name);
  }

  function searchUserRowHtml(name, mode) {
    const safe = HiveMd.escapeHtml(name);
    const fav = isFavoriteUser(name);
    const action =
      mode === "favorite"
        ? `<button type="button" class="fav-tag-remove" data-toggle-user="${safe}" aria-label="Remove @${safe}">×</button>`
        : `<button type="button" class="community-fav-btn${fav ? " is-saved" : ""}" data-toggle-user="${safe}" aria-pressed="${fav ? "true" : "false"}" aria-label="${fav ? "Remove @" + safe + " from favorites" : "Add @" + safe + " to favorites"}">${fav ? "Favorite" : "Add"}</button>`;
    return `<div class="community-row search-user-row">
        <a class="community-row-main" href="${HiveMd.escapeHtml(profileHref(name))}">
          <img class="avatar" src="${HiveMd.avatarUrl(name, "small")}" alt="">
          <span class="community-row-text">
            <span class="community-row-title">@${safe}</span>
          </span>
        </a>
        ${action}
      </div>`;
  }

  function searchTagChipHtml(tag) {
    const safe = HiveMd.escapeHtml(tag);
    const fav = readFavoriteTags().indexOf(tag) !== -1;
    const button = fav
      ? `<button type="button" class="fav-tag-remove" data-remove-tag="${safe}" aria-label="Remove ${safe}">×</button>`
      : `<button type="button" class="fav-tag-add" data-add-tag="${safe}" aria-label="Add ${safe} to favorites">++</button>`;
    return `<span class="fav-tag-chip">
        <a class="tag" href="${HiveMd.escapeHtml(favoriteTagHref(tag))}">#${safe}</a>
        ${button}
      </span>`;
  }

  function paintSearchFavorites(list, page) {
    if (page === "spaces") {
      const tags = readFavoriteTags();
      if (!tags.length) {
        list.className = "community-list";
        list.innerHTML = `<p class="feed-hint tags-empty">No favorite tags yet.</p>`;
        return;
      }
      list.className = "tags-fav-list";
      list.innerHTML = tags.map((tag) => searchTagChipHtml(tag)).join("");
      return;
    }
    if (page === "users") {
      const users = readFavoriteUsers();
      list.className = "community-list";
      if (!users.length) {
        list.innerHTML = `<p class="feed-hint tags-empty">No favorite users yet.</p>`;
        return;
      }
      list.innerHTML = users.map((name) => searchUserRowHtml(name, "favorite")).join("");
      return;
    }
    const rows = readFavoriteCommunities();
    list.className = "community-list";
    if (!rows.length) {
      list.innerHTML = `<p class="feed-hint tags-empty">No favorite communities yet.</p>`;
      return;
    }
    list.innerHTML = rows.map((row) => communityDirRowHtml(row, "favorite")).join("");
  }

  function paintSearchResults() {
    const list = $("#searchResults");
    const page = searchPageName();
    if (!list || !page) return;
    const state = searchPages[page];
    if (state.loading) {
      list.className = "community-list";
      list.innerHTML = `<div class="loading-row"><span class="btn-loader" aria-hidden="true"></span> Searching…</div>`;
      return;
    }
    if (!state.looked) {
      paintSearchFavorites(list, page);
      return;
    }
    if (state.error && !state.results.length) {
      list.className = "community-list";
      list.innerHTML = `<p class="feed-hint tags-empty">${HiveMd.escapeHtml(state.error)}</p>`;
      return;
    }
    if (!state.results.length) {
      list.className = "community-list";
      if (!state.done) {
        list.innerHTML = `<div class="loading-row"><span class="btn-loader" aria-hidden="true"></span> Searching…</div>`;
        return;
      }
      const empty =
        page === "users"
          ? "No users matched that search."
          : page === "spaces"
            ? "No spaces matched that search."
            : "No subspaces matched that search.";
      list.innerHTML = `<p class="feed-hint tags-empty">${empty}</p>`;
      return;
    }
    if (page === "spaces") {
      list.className = "tags-fav-list";
      list.innerHTML = state.results.map((tag) => searchTagChipHtml(tag)).join("");
      return;
    }
    list.className = "community-list";
    if (page === "users") {
      list.innerHTML = state.results.map((name) => searchUserRowHtml(name)).join("");
      return;
    }
    list.innerHTML = state.results.map((row) => communityDirRowHtml(row, "toggle")).join("");
  }

  function resetSearchPageState(state) {
    state.query = "";
    state.looked = false;
    state.loading = false;
    state.loadingMore = false;
    state.error = "";
    state.results = [];
    state.done = false;
    state.cursor = "";
  }

  function searchResultHtml(page, item) {
    if (page === "spaces") return searchTagChipHtml(item);
    if (page === "users") return searchUserRowHtml(item);
    return communityDirRowHtml(item, "toggle");
  }

  function appendSearchResults(page, items) {
    const list = $("#searchResults");
    if (!list || !items || !items.length) return;
    list.className = page === "spaces" ? "tags-fav-list" : "community-list";
    const html = items.map((item) => searchResultHtml(page, item)).join("");
    const hasRows = list.querySelector(".community-row, .fav-tag-chip");
    if (!hasRows) list.innerHTML = html;
    else list.insertAdjacentHTML("beforeend", html);
  }

  function setSearchMore(on) {
    const more = $("#searchMore");
    if (!more) return;
    if (!on) {
      more.hidden = true;
      more.innerHTML = "";
      return;
    }
    more.hidden = false;
    more.innerHTML = `<span class="btn-loader" aria-hidden="true"></span> Searching…`;
  }

  function searchListNearEnd() {
    const list = $("#searchResults");
    if (!list) return false;
    const rect = list.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    return rect.bottom - vh <= COMMUNITY_BROWSE_SCROLL_PX;
  }

  async function fetchUserSearchPage(query, cursor) {
    const q = String(query || "")
      .trim()
      .replace(/^@/, "")
      .toLowerCase();
    if (!/^[a-z0-9.\-]{1,16}$/.test(q)) return { items: [], done: true, cursor: "" };
    const names = await HiveApi.lookupAccounts(cursor || q, SEARCH_USER_LIMIT);
    const items = [];
    let lastSeen = cursor || "";
    let passedPrefix = false;
    for (let i = 0; i < names.length; i++) {
      const name = String(names[i] || "").toLowerCase();
      if (!name) continue;
      lastSeen = name;
      if (cursor && name === cursor) continue;
      if (!name.startsWith(q)) {
        passedPrefix = true;
        break;
      }
      if (!normalizeUserName(name)) continue;
      items.push(name);
    }
    return {
      items,
      done: passedPrefix || names.length < SEARCH_USER_LIMIT,
      cursor: lastSeen,
    };
  }

  async function fetchSpaceSearchPage(query, cursor, existing) {
    const key = normalizeTag(query);
    const typed = key && key.length >= 2 && normalizeRouteTag(key) ? normalizeRouteTag(key) : "";
    if (!key || key.length < 2) return { items: [], done: true, cursor: "" };
    const rows = await HiveApi.getTrendingTags(cursor || "", SEARCH_TAG_LIMIT);
    const seen = new Set(existing || []);
    const prefix = [];
    const contains = [];
    rows.forEach((row) => {
      const name = normalizeRouteTag(row && row.name);
      if (!name || name.length < 2 || seen.has(name) || isCommunityName(name) || name === typed) return;
      if (name.startsWith(key)) prefix.push(name);
      else if (name.indexOf(key) !== -1) contains.push(name);
    });
    const items = [];
    if (!cursor && typed && !seen.has(typed)) items.push(typed);
    prefix.concat(contains).forEach((name) => items.push(name));
    const next = rows.length ? String(rows[rows.length - 1].name || "") : cursor || "";
    return {
      items,
      done: rows.length < SEARCH_TAG_LIMIT || !next || next === cursor,
      cursor: next,
    };
  }

  async function fetchSubspaceSearchPage(query, cursor) {
    const q = String(query || "").trim();
    if (!q) return { items: [], done: true, cursor: "" };
    const id = communityIdFromInput(q);
    if (id) {
      if (cursor) return { items: [], done: true, cursor };
      const info = await lookupCommunityById(id, observer());
      return { items: info ? mergeCommunityResults([info]) : [], done: true, cursor: id };
    }
    const list = await HiveApi.listCommunities({
      query: q,
      limit: SEARCH_COMMUNITY_LIMIT,
      last: cursor || "",
      observer: observer(),
    });
    const items = mergeCommunityResults(list);
    const next = items.length ? items[items.length - 1].name : cursor || "";
    return {
      items,
      done: list.length < SEARCH_COMMUNITY_LIMIT || !next || next === cursor,
      cursor: next,
    };
  }

  function takeNewSearchItems(page, existing, items) {
    const seen = new Set();
    existing.forEach((item) => {
      seen.add(page === "subspaces" ? item.name : item);
    });
    const out = [];
    items.forEach((item) => {
      const key = page === "subspaces" ? item && item.name : item;
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push(item);
    });
    return out;
  }

  async function loadTrendingTagNames() {
    if (trendingTagNamesCache && Date.now() - trendingTagNamesAt < TRENDING_TAGS_MS) {
      return trendingTagNamesCache;
    }
    const rows = await HiveApi.getTrendingTags("", 250);
    const names = [];
    const seen = new Set();
    (rows || []).forEach((row) => {
      const name = normalizeRouteTag(row && row.name);
      if (!name || name.length < 2 || seen.has(name) || isCommunityName(name)) return;
      seen.add(name);
      names.push(name);
    });
    trendingTagNamesCache = names;
    trendingTagNamesAt = Date.now();
    return names;
  }

  function maybeLoadMoreSearch() {
    const page = searchPageName();
    if (!page) return;
    const state = searchPages[page];
    if (!state.looked || state.loading || state.loadingMore || state.done) return;
    if (!$("#searchResults")) return;
    if (searchListNearEnd()) fillSearchPage(page, searchGen, false);
  }

  async function fillSearchPage(page, gen, first) {
    const state = searchPages[page];
    if (!state || gen !== searchGen) return;
    if (state.done || state.loadingMore) return;
    if (!first && state.loading) return;
    if (first) state.loading = true;
    else state.loadingMore = true;
    if (!first) setSearchMore(true);
    try {
      let added = [];
      let loops = 0;
      const maxLoops = page === "spaces" ? 4 : 1;
      while (loops < maxLoops && !state.done) {
        loops += 1;
        const seen = state.results.concat(added);
        const batch =
          page === "users"
            ? await fetchUserSearchPage(state.query, state.cursor)
            : page === "spaces"
              ? await fetchSpaceSearchPage(state.query, state.cursor, seen)
              : await fetchSubspaceSearchPage(state.query, state.cursor);
        if (gen !== searchGen) return;
        state.cursor = batch.cursor || "";
        state.done = Boolean(batch.done);
        const fresh = takeNewSearchItems(page, seen, batch.items || []);
        if (!fresh.length && page !== "spaces") state.done = true;
        added = added.concat(fresh);
        if (added.length || state.done || page !== "spaces") break;
      }
      if (gen !== searchGen) return;
      const hadRows = state.results.length > 0;
      if (added.length) state.results = state.results.concat(added);
      state.error = "";
      state.loading = false;
      state.loadingMore = false;
      setSearchMore(false);
      if (searchPageName() !== page) return;
      if (!hadRows || !added.length) paintSearchResults();
      else appendSearchResults(page, added);
      maybeLoadMoreSearch();
    } catch (err) {
      if (gen !== searchGen) return;
      state.loading = false;
      state.loadingMore = false;
      state.done = true;
      setSearchMore(false);
      if (!state.results.length) state.error = err.message || String(err);
      else setSearchStatus(err.message || String(err), true);
      if (searchPageName() === page) paintSearchResults();
    }
  }

  async function runSearch() {
    const input = $("#searchInput");
    const page = searchPageName();
    if (!input || !page) return;
    searchBox = input.value;
    const raw = String(input.value || "").trim();
    const state = searchPages[page];
    searchGen += 1;
    const gen = searchGen;
    if (!raw) {
      searchBox = "";
      input.value = "";
      resetSearchPageState(state);
      setSearchStatus("");
      setSearchMore(false);
      paintSearchResults();
      return;
    }
    resetSearchPageState(state);
    state.query = raw;
    state.looked = true;
    state.loading = true;
    setSearchStatus("");
    setSearchMore(false);
    paintSearchResults();
    await fillSearchPage(page, gen, true);
  }

  function searchShellHtml(tab) {
    const page = tab === "spaces" || tab === "subspaces" ? tab : "users";
    const usersHref = HiveMd.escapeHtml(appHref(pathForSearch("users")));
    const spacesHref = HiveMd.escapeHtml(appHref(pathForSearch("spaces")));
    const subspacesHref = HiveMd.escapeHtml(appHref(pathForSearch("subspaces")));
    const value = HiveMd.escapeHtml(searchBox);
    return `
      <section class="cs77-page">
        <h2 class="page-title">Search</h2>
        <nav class="feed-nav subpage-nav" aria-label="Search">
          <a href="${usersHref}" class="${page === "users" ? "is-active" : ""}">Users</a>
          <a href="${spacesHref}" class="${page === "spaces" ? "is-active" : ""}">Spaces</a>
          <a href="${subspacesHref}" class="${page === "subspaces" ? "is-active" : ""}">Subspaces</a>
        </nav>
        <form class="tags-add search-form" id="searchForm">
          <input id="searchInput" type="text" maxlength="80" placeholder="Search" value="${value}" autocomplete="off" spellcheck="false" autocapitalize="off" enterkeyhint="search" aria-label="Search">
          ${searchGlassHtml()}
        </form>
        <p class="tags-status" id="searchStatus" hidden></p>
        <div id="searchResults"></div>
        <div id="searchMore" class="loading-row" hidden></div>
      </section>
    `;
  }

  function renderSearchPage(page) {
    setPageMeta("Search — CyberSpace77");
    view.innerHTML = searchShellHtml(page);
    paintSearchResults();
    maybeLoadMoreSearch();
    const input = $("#searchInput");
    if (input && !isMobileViewport()) {
      input.focus();
      const end = input.value.length;
      try {
        input.setSelectionRange(end, end);
      } catch {
        /* unsupported input type */
      }
    }
  }

  /* ─── Post + comments ─── */
  function buildCommentTree(discussion, author, permlink) {
    const nodes = Object.values(discussion || {});
    const byKey = {};
    for (const n of nodes) {
      n._replies = [];
      byKey[`${n.author}/${n.permlink}`] = n;
    }
    const rootKey = `${author}/${permlink}`;
    for (const n of nodes) {
      const key = `${n.author}/${n.permlink}`;
      if (key === rootKey) continue;
      const parent = byKey[`${n.parent_author}/${n.parent_permlink}`];
      if (parent) parent._replies.push(n);
    }
    for (const n of nodes) {
      n._replies.sort((a, b) => parseCreatedTs(a.created) - parseCreatedTs(b.created));
    }
    return byKey[rootKey] || null;
  }

  function commentPermlink(parentAuthor, parentPermlink) {
    const stamp = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 8);
    const parent = String(parentAuthor || "").replace(/\./g, "");
    let slug = `re-${parent}-${parentPermlink}-${stamp}${rand}`;
    slug = slug.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");
    if (slug.length > 255) slug = slug.slice(0, 255).replace(/-+$/, "");
    return slug;
  }

  function imagesFromMarkdown(body) {
    const urls = [];
    const re =
      /!\[[^\]]*\]\(\s*<?([^\s)>]+)>?(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
    let m;
    while ((m = re.exec(String(body || "")))) {
      if (urls.indexOf(m[1]) === -1) urls.push(m[1]);
    }
    return urls;
  }

  function isImageFile(file) {
    if (!file) return false;
    if (file.type && /^image\//i.test(file.type)) return true;
    return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file.name || "");
  }

  function imageFilesFrom(dt) {
    const out = [];
    if (!dt || !dt.files) return out;
    for (let i = 0; i < dt.files.length; i++) {
      const file = dt.files[i];
      if (isImageFile(file)) out.push(file);
    }
    return out;
  }

  function isFileDrag(e) {
    const types = e.dataTransfer && e.dataTransfer.types;
    if (!types) return false;
    return Array.from(types).indexOf("Files") !== -1;
  }

  function bufferJson(bytes) {
    return JSON.stringify({ type: "Buffer", data: Array.from(bytes) });
  }

  function signImageBuffer(username, bytes) {
    const prefix = new TextEncoder().encode("ImageSigningChallenge");
    const combined = new Uint8Array(prefix.length + bytes.length);
    combined.set(prefix, 0);
    combined.set(bytes, prefix.length);
    if (window.HiveAuth && HiveAuth.hasKey(username)) {
      return HiveAuth.signBytes(combined, username);
    }
    return new Promise((resolve, reject) => {
      if (!window.hive_keychain) {
        reject(new Error(signerNeededMessage()));
        return;
      }
      window.hive_keychain.requestSignBuffer(
        username,
        bufferJson(combined),
        "Posting",
        (res) => {
          if (res && res.success && res.result) resolve(res.result);
          else {
            reject(
              new Error(
                (res && (res.message || res.error)) || "Image signing was cancelled."
              )
            );
          }
        },
        null,
        "Upload image"
      );
    });
  }

  async function uploadHiveImage(file, username) {
    if (!file) throw new Error("No image selected.");
    if (file.size > MAX_IMAGE_BYTES) {
      throw new Error("Image is too large (max 8 MB).");
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const signature = await signImageBuffer(username, bytes);
    const form = new FormData();
    form.append("file", file, file.name || "image.png");
    const res = await fetch(`${IMAGE_HOST}/${encodeURIComponent(username)}/${signature}`, {
      method: "POST",
      body: form,
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON */
    }
    if (!res.ok) {
      const detail =
        (data && (data.error || data.message || data.reason)) ||
        text.slice(0, 200) ||
        res.statusText;
      throw new Error(detail || "Image upload failed.");
    }
    const url = data && (data.url || data.secure_url);
    if (!url) throw new Error("Image hoster did not return a URL.");
    return url;
  }

  function markdownImage(file, url) {
    const name = String((file && file.name) || "image")
      .replace(/[\[\]]/g, "")
      .replace(/\s+/g, " ")
      .trim() || "image";
    return `![${name}](${url})`;
  }

  function insertInTextarea(textarea, text) {
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const before = textarea.value.slice(0, start);
    const after = textarea.value.slice(end);
    const prefix = before && !/\n$/.test(before) ? "\n" : "";
    const suffix = after && !/^\n/.test(after) ? "\n" : "";
    const chunk = prefix + text + suffix;
    textarea.value = before + chunk + after;
    const pos = (before + chunk).length;
    textarea.selectionStart = textarea.selectionEnd = pos;
    textarea.focus();
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function composerStatus(composer, msg, isError) {
    const el = composer && composer.querySelector(".composer-status");
    if (!el) return;
    if (!msg) {
      el.hidden = true;
      el.textContent = "";
      el.classList.remove("is-error");
      return;
    }
    el.hidden = false;
    el.textContent = msg;
    el.classList.toggle("is-error", Boolean(isError));
  }

  function composerHtml(parentAuthor, parentPermlink, opts) {
    const user = observer();
    if (!user) return "";
    const placeholder = (opts && opts.placeholder) || "Write a comment…";
    const submit = (opts && opts.submitLabel) || "Comment";
    const author = HiveMd.escapeHtml(parentAuthor);
    const permlink = HiveMd.escapeHtml(parentPermlink);
    const body = opts && opts.body != null ? String(opts.body) : "";
    const editAuthor = opts && opts.editAuthor ? HiveMd.escapeHtml(opts.editAuthor) : "";
    const editPermlink = opts && opts.editPermlink ? HiveMd.escapeHtml(opts.editPermlink) : "";
    const editAttrs = editAuthor
      ? ` data-edit-author="${editAuthor}" data-edit-permlink="${editPermlink}"`
      : "";
    const cancel =
      opts && opts.cancelLabel
        ? `<button type="button" class="composer-cancel">${HiveMd.escapeHtml(opts.cancelLabel)}</button>`
        : "";
    return `
      <div class="comment-composer" data-parent-author="${author}" data-parent-permlink="${permlink}"${editAttrs}>
        <div class="composer-drop-layer" aria-hidden="true">Drop image to upload</div>
        <textarea class="composer-input" rows="4" placeholder="${HiveMd.escapeHtml(placeholder)}">${HiveMd.escapeHtml(body)}</textarea>
        <input class="composer-file" type="file" accept="image/*" multiple hidden>
        <div class="composer-bar">
          <button type="button" class="composer-attach" title="Attach image">Attach image</button>
          <span class="composer-hint"></span>
          <span class="composer-actions">
            ${cancel}
            <button type="button" class="btn-primary btn-compact composer-submit">${HiveMd.escapeHtml(submit)}</button>
          </span>
        </div>
        <p class="composer-status" hidden></p>
      </div>
    `;
  }

  function renderComment(node) {
    if (!node) return "";
    if (isBlacklistedPost(node)) return "";
    rememberContent(node);
    const replies = (node._replies || []).map(renderComment).join("");
    const user = observer();
    const author = HiveMd.escapeHtml(node.author);
    const permlink = HiveMd.escapeHtml(node.permlink);
    const parentAuthor = HiveMd.escapeHtml(node.parent_author || "");
    const parentPermlink = HiveMd.escapeHtml(node.parent_permlink || "");
    const head = `
        <div class="comment-head">
          ${authorLinkHtml(node.author, "small")}
          <span>· ${Math.floor(HiveMd.displayReputation(node.author_reputation))}</span>
          <span>· ${metaTimeHtml(node.created, commentPath(node))}</span>
        </div>`;
    if (isMutedHidden(node)) {
      return `
      <article class="comment is-muted" data-author="${author}" data-permlink="${permlink}" data-parent-author="${parentAuthor}" data-parent-permlink="${parentPermlink}" id="@${author}/${permlink}">
        ${mutedNoticeHtml("comment", node)}
        ${replies ? `<div class="comment-replies">${replies}</div>` : ""}
      </article>
    `;
    }
    const body = HiveMd.renderMarkdown(node.body || "");
    const replyBtn = user
      ? `<button type="button" class="comment-reply-btn" data-reply-author="${author}" data-reply-permlink="${permlink}">Reply</button>`
      : "";
    return `
      <article class="comment" data-author="${author}" data-permlink="${permlink}" data-parent-author="${parentAuthor}" data-parent-permlink="${parentPermlink}" id="@${author}/${permlink}">
        ${head}
        <div class="comment-body">${body}</div>
        <div class="comment-actions">
          ${voteControlHtml(node, "pills")}
          ${payoutHtml(node, true)}
          ${replyBtn}
          ${contentMoreHtml(node.author, node.permlink, "comment", node.children)}
        </div>
        ${user ? `<div class="comment-reply-slot" hidden></div>` : ""}
        ${replies ? `<div class="comment-replies">${replies}</div>` : ""}
      </article>
    `;
  }

  function findCommentEl(author, permlink) {
    const comments = $("#comments");
    if (!comments) return null;
    const nodes = comments.querySelectorAll(".comment");
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      if (
        el.getAttribute("data-author") === author &&
        el.getAttribute("data-permlink") === permlink
      ) {
        return el;
      }
    }
    return null;
  }

  function findCommentAnchorEl(hash) {
    const comments = document.getElementById("comments");
    if (!comments) return null;
    const parsed = parseCommentFragment(hash);
    if (parsed) {
      const author = parsed.author;
      const permlink = String(parsed.permlink || "").toLowerCase();
      const nodes = comments.querySelectorAll(".comment");
      for (let i = 0; i < nodes.length; i++) {
        const el = nodes[i];
        if (
          String(el.getAttribute("data-author") || "").toLowerCase() === author &&
          String(el.getAttribute("data-permlink") || "").toLowerCase() === permlink
        ) {
          return el;
        }
      }
      const byId = document.getElementById(parsed.id);
      if (byId && comments.contains(byId)) return byId;
    }
    const raw = decodeHashFragment(hash);
    if (!raw) return null;
    let el = document.getElementById(raw);
    if (!el) {
      try {
        el = document.getElementById(decodeURIComponent(raw));
      } catch {
        el = null;
      }
    }
    if (el && comments.contains(el)) return el;
    return null;
  }

  function bumpCommentCount(delta) {
    const section = $("#comments");
    if (!section) return;
    const n = Math.max(0, (Number(section.getAttribute("data-count")) || 0) + delta);
    setCommentCount(n);
    const author = section.getAttribute("data-root-author");
    const permlink = section.getAttribute("data-root-permlink");
    if (!author || !permlink) return;
    const needle = ("/@" + author + "/" + permlink).toLowerCase();
    document.querySelectorAll(".post-card .comment-count-link").forEach((el) => {
      const link = String(el.getAttribute("href") || "").toLowerCase();
      if (link.indexOf(needle) === -1) return;
      const cur = Number(String(el.textContent || "").replace(/[^0-9]/g, "")) || 0;
      el.textContent = "C " + Math.max(0, cur + delta);
    });
    const item = findLoadedPost(author, permlink);
    if (item && item.children != null) {
      item.children = Math.max(0, (Number(item.children) || 0) + delta);
    }
  }

  function appendPostedComment(parentAuthor, parentPermlink, html) {
    const section = $("#comments");
    if (!section) return;
    const rootAuthor = section.getAttribute("data-root-author");
    const rootPermlink = section.getAttribute("data-root-permlink");
    if (parentAuthor === rootAuthor && parentPermlink === rootPermlink) {
      let list = section.querySelector(".comment-list");
      if (!list) return;
      const hint = list.querySelector(":scope > .feed-hint");
      if (hint) hint.remove();
      list.insertAdjacentHTML("beforeend", html);
      return;
    }
    const parent = findCommentEl(parentAuthor, parentPermlink);
    if (!parent) return;
    let replies = parent.querySelector(":scope > .comment-replies");
    if (!replies) {
      replies = document.createElement("div");
      replies.className = "comment-replies";
      parent.appendChild(replies);
    }
    replies.insertAdjacentHTML("beforeend", html);
    noteParentReply(parentAuthor, parentPermlink, 1);
  }

  function toggleReplyComposer(btn) {
    const comment = btn.closest(".comment");
    if (!comment) return;
    if (comment.classList.contains("is-editing")) closeCommentEditor(comment);
    const slot = comment.querySelector(":scope > .comment-reply-slot");
    if (!slot) return;
    const open = !slot.hidden && slot.innerHTML.trim();
    if (open) {
      slot.hidden = true;
      slot.innerHTML = "";
      btn.classList.remove("is-open");
      return;
    }
    const author = btn.getAttribute("data-reply-author");
    const permlink = btn.getAttribute("data-reply-permlink");
    slot.innerHTML = composerHtml(author, permlink, {
      placeholder: "Write a reply…",
      submitLabel: "Reply",
    });
    slot.hidden = false;
    btn.classList.add("is-open");
    beginCommentCouncilCheck(slot.querySelector(".comment-composer"));
    const ta = slot.querySelector("textarea");
    if (ta) ta.focus();
  }

  function closeCommentEditor(comment) {
    if (!comment) return;
    const slot = comment.querySelector(":scope > .comment-edit-slot");
    if (slot) {
      slot.hidden = true;
      slot.innerHTML = "";
    }
    const bodyEl = comment.querySelector(":scope > .comment-body");
    if (bodyEl) bodyEl.hidden = false;
    comment.classList.remove("is-editing");
  }

  function toggleCommentEditor(comment) {
    if (!comment) return;
    const author = comment.getAttribute("data-author");
    const permlink = comment.getAttribute("data-permlink");
    if (!isOwnAuthor(author)) return;
    const open = comment.classList.contains("is-editing");
    if (open) {
      closeCommentEditor(comment);
      return;
    }
    const replySlot = comment.querySelector(":scope > .comment-reply-slot");
    if (replySlot && !replySlot.hidden) {
      replySlot.hidden = true;
      replySlot.innerHTML = "";
      const replyBtn = comment.querySelector(":scope > .comment-actions .comment-reply-btn");
      if (replyBtn) replyBtn.classList.remove("is-open");
    }
    const src = contentOf(author, permlink) || {
      body: "",
      parent_author: comment.getAttribute("data-parent-author") || "",
      parent_permlink: comment.getAttribute("data-parent-permlink") || "",
    };
    const bodyEl = comment.querySelector(":scope > .comment-body");
    if (bodyEl) bodyEl.hidden = true;
    let slot = comment.querySelector(":scope > .comment-edit-slot");
    if (!slot) {
      slot = document.createElement("div");
      slot.className = "comment-edit-slot";
      if (bodyEl && bodyEl.parentNode) bodyEl.insertAdjacentElement("afterend", slot);
      else comment.appendChild(slot);
    }
    slot.innerHTML = composerHtml(src.parent_author, src.parent_permlink, {
      placeholder: "Edit your comment…",
      submitLabel: "Save",
      cancelLabel: "Cancel",
      body: src.body || "",
      editAuthor: author,
      editPermlink: permlink,
    });
    slot.hidden = false;
    comment.classList.add("is-editing");
    const ta = slot.querySelector("textarea");
    if (ta) ta.focus();
  }

  async function uploadImagesToComposer(composer, files) {
    const user = observer();
    if (!user) {
      showError("Log in to upload images.");
      return;
    }
    if (composer.classList.contains("is-pending") || composer.classList.contains("is-uploading")) {
      return;
    }
    const textarea = composer.querySelector(".composer-input");
    const list = Array.from(files || []).filter(isImageFile);
    if (!list.length) {
      composerStatus(composer, "Drop an image file (png, jpg, gif, webp).", true);
      return;
    }
    if (!hasSigner(user)) {
      composerStatus(composer, signerNeededMessage(), true);
      return;
    }
    composer.classList.add("is-uploading");
    try {
      for (let i = 0; i < list.length; i++) {
        const file = list[i];
        const label = list.length > 1 ? ` (${i + 1}/${list.length})` : "";
        composerStatus(composer, signingLabel("image") + (label ? " " + label.trim() : ""));
        const url = await uploadHiveImage(file, user);
        insertInTextarea(textarea, markdownImage(file, url));
        composerStatus(composer, "Image uploaded" + label + ".");
      }
      savePublishDraft();
      updatePublishPreview();
      persistPublishDraftNow();
    } catch (err) {
      composerStatus(composer, err.message || String(err), true);
    } finally {
      composer.classList.remove("is-uploading");
    }
  }

  let publishBodySel = null;

  function rememberPublishBodySel() {
    const body = $("#publishBody");
    if (!body) return;
    publishBodySel = {
      start: body.selectionStart,
      end: body.selectionEnd,
      direction: body.selectionDirection || "none",
    };
  }

  // The menu button takes focus on click, which can collapse the textarea
  // selection. Prefer a still-open range, then the range saved before that.
  function publishBodyRange(body) {
    const live = {
      start: body.selectionStart,
      end: body.selectionEnd,
      direction: body.selectionDirection || "none",
    };
    if (document.activeElement === body || live.start !== live.end) return live;
    if (!publishBodySel) return live;
    const end = Math.min(publishBodySel.end, body.value.length);
    const start = Math.min(publishBodySel.start, end);
    return { start: start, end: end, direction: publishBodySel.direction || "none" };
  }

  function mdMenuOpen() {
    const menu = $("#publishMdMenu");
    return Boolean(menu && !menu.hidden);
  }

  function closeMdMenu() {
    const menu = $("#publishMdMenu");
    const btn = $("#publishMdBtn");
    const wrap = $("#publishMd");
    if (menu) {
      menu.hidden = true;
      menu.classList.remove("is-up");
      menu.style.left = "";
    }
    if (btn) btn.setAttribute("aria-expanded", "false");
    if (wrap) wrap.classList.remove("is-open");
  }

  function placeMdMenu() {
    const menu = $("#publishMdMenu");
    const btn = $("#publishMdBtn");
    if (!menu || !btn) return;
    menu.classList.remove("is-up");
    menu.style.left = "0px";
    const btnRect = btn.getBoundingClientRect();
    const height = menu.offsetHeight;
    const spaceBelow = window.innerHeight - btnRect.bottom;
    const spaceAbove = btnRect.top;
    if (spaceBelow < height + 12 && spaceAbove > spaceBelow) menu.classList.add("is-up");
    const rect = menu.getBoundingClientRect();
    const overflow = rect.right - window.innerWidth + 8;
    if (overflow > 0) menu.style.left = -overflow + "px";
  }

  function toggleMdMenu() {
    const menu = $("#publishMdMenu");
    const btn = $("#publishMdBtn");
    const wrap = $("#publishMd");
    if (!menu || !btn) return;
    const open = menu.hidden;
    if (!open) {
      closeMdMenu();
      return;
    }
    closeDestMenu();
    menu.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    if (wrap) wrap.classList.add("is-open");
    placeMdMenu();
  }

  function prefixMarkdownLines(text, prefix) {
    return String(text).split("\n").map((line) => prefix + line).join("\n");
  }

  function markdownCodeFence(selected) {
    let fence = "```";
    while (selected.indexOf(fence) !== -1) fence += "`";
    const inner = selected.charAt(selected.length - 1) === "\n" ? selected : selected + "\n";
    return fence + "\n" + inner + fence;
  }

  function markdownCodeSnippet(selected) {
    if (selected.indexOf("\n") === -1 && selected.indexOf("`") === -1) {
      return { snippet: "`" + selected + "`", block: false };
    }
    return { snippet: markdownCodeFence(selected), block: true };
  }

  function markdownInsert(kind, selected) {
    const video = '<video controls>\n<source src="self-hosted video url">\n</video>';
    const table = "|column1|column2|column3|\n|-|-|-|\n|content1|content2|content3|";
    if (kind === "video") return { snippet: video, block: true, replace: false };
    if (kind === "table") return { snippet: table, block: true, replace: false };
    const has = selected.trim().length > 0;
    if (!has) {
      if (kind === "heading") return { snippet: "## heading", block: true, replace: true };
      if (kind === "bold") return { snippet: "**bold**", block: false, replace: true };
      if (kind === "italic") return { snippet: "*italic*", block: false, replace: true };
      if (kind === "strike") return { snippet: "~~strike~~", block: false, replace: true };
      if (kind === "quote") return { snippet: "> quote", block: true, replace: true };
      if (kind === "link") return { snippet: "[link text](url)", block: false, replace: true };
      if (kind === "image") return { snippet: "![alt text](url)", block: false, replace: true };
      if (kind === "code") return { snippet: "`code`", block: false, replace: true };
      if (kind === "codeblock") return { snippet: "```\ncode\n```", block: true, replace: true };
      return null;
    }
    if (kind === "heading") return { snippet: prefixMarkdownLines(selected, "## "), block: true, replace: true };
    if (kind === "bold") return { snippet: "**" + selected + "**", block: false, replace: true };
    if (kind === "italic") return { snippet: "*" + selected + "*", block: false, replace: true };
    if (kind === "strike") return { snippet: "~~" + selected + "~~", block: false, replace: true };
    if (kind === "quote") return { snippet: prefixMarkdownLines(selected, "> "), block: true, replace: true };
    if (kind === "link") return { snippet: "[" + selected + "](url)", block: false, replace: true };
    if (kind === "image") return { snippet: "![alt text](" + selected.trim() + ")", block: false, replace: true };
    if (kind === "code") {
      const code = markdownCodeSnippet(selected);
      return { snippet: code.snippet, block: code.block, replace: true };
    }
    if (kind === "codeblock") return { snippet: markdownCodeFence(selected), block: true, replace: true };
    return null;
  }

  function applyPublishMarkdown(kind) {
    const body = $("#publishBody");
    if (!body || !kind) return;
    const value = body.value;
    const range = publishBodyRange(body);
    const selStart = Math.max(0, Math.min(range.start, value.length));
    const selEnd = Math.max(selStart, Math.min(range.end, value.length));
    const selected = value.slice(selStart, selEnd);
    const plan = markdownInsert(kind, selected);
    if (!plan) return;
    let from = selStart;
    let to = selEnd;
    if (!plan.replace) {
      from = range.direction === "backward" ? selStart : selEnd;
      to = from;
    }
    let lead = "";
    let trail = "";
    if (plan.block) {
      const before = value.slice(0, from);
      const after = value.slice(to);
      if (before && !/\n$/.test(before)) lead = "\n";
      if (after && !/^\n/.test(after)) trail = "\n";
    }
    const text = lead + plan.snippet + trail;
    const beforeValue = value;
    body.focus();
    body.setSelectionRange(from, to);
    let used = false;
    try {
      used = document.execCommand("insertText", false, text);
    } catch (err) {
      used = false;
    }
    if (!used || body.value === beforeValue) {
      body.value = beforeValue.slice(0, from) + text + beforeValue.slice(to);
      body.dispatchEvent(new Event("input", { bubbles: true }));
    }
    const caret = from + lead.length + plan.snippet.length;
    body.setSelectionRange(caret, caret);
    publishBodySel = { start: caret, end: caret, direction: "none" };
    closeMdMenu();
  }

  // A new post uses Publish in. An edit keeps the post's parent community.
  function publishFileCommunity() {
    if (editingComment()) return "";
    if (publishEdit) return normalizeCommunityName(publishEdit.parentPermlink || "");
    if (publishDest.type === "community") return normalizeCommunityName(publishDest.name);
    return "";
  }

  function publishPostPayload() {
    savePublishDraft();
    const comment = editingComment();
    const title = comment
      ? String((publishEdit && publishEdit.title) || "")
      : publishTitleDraft;
    const tags = (comment ? (publishEdit && publishEdit.tags) || [] : publishTags).slice();
    const community = publishFileCommunity();
    const payload = {
      app: "CyberSpace77",
      url: "cyberspace77.com",
      version: APP_VERSION,
      date: new Date().toISOString(),
      title: title,
    };
    if (community) payload.community = community;
    payload.post = publishBodyDraft;
    payload.tags = tags;
    if (!comment) {
      const advanced = publishAdvancedState();
      const description = String(advanced.description || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, PUBLISH_DESC_MAX);
      const beneficiaries = advanced.beneficiaries.filter((row) => {
        return String(row.account || "").trim() || String(row.percent || "").trim();
      });
      if (description) payload.description = description;
      if (advanced.reward !== "default") payload.reward = advanced.reward;
      if (beneficiaries.length) {
        payload.beneficiaries = beneficiaries.map((row) => ({
          account: String(row.account || ""),
          percent: String(row.percent || ""),
        }));
      }
    }
    return payload;
  }

  function publishPostFilename(title) {
    const clean = String(title || "")
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
      .replace(/\s+/g, " ")
      .slice(0, 80)
      .trim();
    return (clean || "post") + ".json";
  }

  function savePublishPostFile() {
    const payload = publishPostPayload();
    let url = "";
    try {
      const blob = new Blob([JSON.stringify(payload, null, 2) + "\n"], {
        type: "application/json",
      });
      url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = publishPostFilename(payload.title);
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      setPublishStatus("Could not save the post.", true);
      return;
    } finally {
      if (url) window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    }
    setPublishStatus("Post saved.");
  }

  function tagsFromPublishFile(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    raw.forEach((item) => {
      const tag = normalizeTag(item);
      if (!isValidTag(tag) || out.indexOf(tag) !== -1 || out.length >= MAX_TAGS) return;
      out.push(tag);
    });
    return out;
  }

  function applyLoadedPublishPost(text) {
    let data;
    try {
      data = JSON.parse(String(text || "").replace(/^\uFEFF/, ""));
    } catch (err) {
      setPublishStatus("That file is not valid JSON.", true);
      return;
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      setPublishStatus("That file is not a post.", true);
      return;
    }
    if (typeof data.title !== "string" && typeof data.post !== "string") {
      setPublishStatus("That file is not a post.", true);
      return;
    }
    const title = typeof data.title === "string" ? data.title : "";
    const post = typeof data.post === "string" ? data.post : "";
    const comment = editingComment();
    if (!comment) {
      const titleEl = $("#publishTitle");
      if (titleEl) {
        titleEl.value = clampPublishTitle(title);
        fitPublishTitle(titleEl);
        paintPublishTitleCount();
      }
      publishTags = tagsFromPublishFile(data.tags);
      const tagInput = $("#publishTagInput");
      if (tagInput) tagInput.value = "";
      paintPublishTags();
      const description = typeof data.description === "string" ? data.description : "";
      const reward = normalizePublishReward(data.reward);
      const beneficiaries = publishEdit ? [] : beneficiariesFromStored(data.beneficiaries);
      applyPublishAdvanced({
        description,
        reward: publishEdit ? "default" : reward,
        beneficiaries,
      });
      if (
        description.trim() ||
        (!publishEdit && (reward !== "default" || beneficiaries.length))
      ) {
        openPublishAdvanced();
      }
    }
    const body = $("#publishBody");
    if (body) body.value = post;
    publishBodySel = null;
    let skippedCommunity = false;
    let loadedCommunity = "";
    let loadedCommunityTitle = "";
    if (!publishEdit) {
      const rawCommunity = data.community;
      const community =
        typeof rawCommunity === "string" ? normalizeCommunityName(rawCommunity) : "";
      if (community) {
        const found = publishSubs.find((c) => normalizeCommunityName(c.name) === community);
        loadedCommunity = found ? normalizeCommunityName(found.name) : community;
        loadedCommunityTitle = (found && found.title) || loadedCommunity;
        publishDest = {
          type: "community",
          name: loadedCommunity,
          title: loadedCommunityTitle,
        };
      } else {
        if (typeof rawCommunity === "string" && rawCommunity.trim()) skippedCommunity = true;
        cancelPublishCommunityCheck();
        publishDest = blogPublishDest();
      }
      paintPublishDest();
      renderDestMenu();
    }
    savePublishDraft();
    updatePublishPreview();
    schedulePublishDraftSave();
    if (!comment) {
      fitPublishTitle();
      requestAnimationFrame(() => fitPublishTitle());
    }
    if (loadedCommunity) {
      ensurePublishCommunity(loadedCommunity, loadedCommunityTitle).then((ok) => {
        if (ok) setPublishStatus("Post loaded.");
      });
      requestPublishCommunityBeneficiary(loadedCommunity, { force: true });
      return;
    }
    setPublishStatus(
      skippedCommunity
        ? "Post loaded. The community was not a hive id, so this publishes to your blog."
        : "Post loaded."
    );
  }

  function loadPublishPostFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      applyLoadedPublishPost(typeof reader.result === "string" ? reader.result : "");
    };
    reader.onerror = () => {
      setPublishStatus("Could not read that file.", true);
    };
    reader.readAsText(file);
  }

  function bindComposerMedia(root) {
    if (!root) return;
    root.addEventListener("click", (e) => {
      const attachBtn = e.target.closest(".composer-attach");
      if (
        !attachBtn ||
        attachBtn.id === "publishLocationBtn" ||
        attachBtn.id === "publishMdBtn" ||
        !root.contains(attachBtn)
      ) return;
      e.preventDefault();
      const composer = attachBtn.closest(".comment-composer");
      const input = composer && composer.querySelector(".composer-file");
      if (input) input.click();
    });
    root.addEventListener("change", (e) => {
      const input = e.target.closest(".composer-file");
      if (!input || !root.contains(input)) return;
      const composer = input.closest(".comment-composer");
      const files = input.files ? Array.from(input.files) : [];
      input.value = "";
      if (composer && files.length) uploadImagesToComposer(composer, files);
    });
    root.addEventListener("dragenter", (e) => {
      const composer = e.target.closest(".comment-composer");
      if (!composer || !root.contains(composer) || !isFileDrag(e)) return;
      e.preventDefault();
      composer.classList.add("is-dragover");
    });
    root.addEventListener("dragover", (e) => {
      const composer = e.target.closest(".comment-composer");
      if (!composer || !root.contains(composer) || !isFileDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      composer.classList.add("is-dragover");
    });
    root.addEventListener("dragleave", (e) => {
      const composer = e.target.closest(".comment-composer");
      if (!composer) return;
      if (e.relatedTarget && composer.contains(e.relatedTarget)) return;
      composer.classList.remove("is-dragover");
    });
    root.addEventListener("drop", (e) => {
      const composer = e.target.closest(".comment-composer");
      if (!composer || !root.contains(composer)) return;
      e.preventDefault();
      composer.classList.remove("is-dragover");
      const files = imageFilesFrom(e.dataTransfer);
      if (files.length) uploadImagesToComposer(composer, files);
      else composerStatus(composer, "Drop an image file (png, jpg, gif, webp).", true);
    });
    root.addEventListener("paste", (e) => {
      const composer = e.target.closest(".comment-composer");
      if (!composer || !root.contains(composer)) return;
      const clip = e.clipboardData;
      const files = clip && clip.files ? Array.from(clip.files).filter(isImageFile) : [];
      if (!files.length) return;
      e.preventDefault();
      uploadImagesToComposer(composer, files);
    });
  }

  // Council comments need member, mod, admin, or owner. Topic and journal stay open.
  function commentCouncilDenial(info, fallbackTitle) {
    const title = String((info && info.title) || fallbackTitle || "this subspace").trim();
    if (!info || !info.name || Number(info.type_id) !== 3) return "";
    const role = communityViewerRole(info);
    if (role === "muted") return "You are muted in " + title + ".";
    if (role === "member" || role === "mod" || role === "admin" || role === "owner") return "";
    return "Only members can comment in " + title + ".";
  }

  function commentAccessComposer(target) {
    const el = eventElement(target);
    if (!el) return null;
    const composer = el.closest(".comment-composer");
    if (!composer || composer.getAttribute("data-edit-author") || composer.id === "publishComposer") return null;
    const section = document.getElementById("comments");
    if (!section || !section.contains(composer)) return null;
    return composer;
  }

  // One request per subspace. Focus, activation, and Reply share it.
  function ensureCommentCouncil(post) {
    const id = communityNameOf(post);
    const user = observer();
    if (!id || !user) return Promise.resolve("");
    if (
      commentAccessCommunity === id &&
      commentAccessUser === user &&
      (commentAccessWait || commentAccessSettled)
    ) {
      return commentAccessWait || Promise.resolve(commentAccessMessage);
    }
    const seq = ++commentAccessSeq;
    const fallbackTitle = (post && (post.community_title || post.community)) || id;
    commentAccessCommunity = id;
    commentAccessUser = user;
    commentAccessMessage = "";
    commentAccessSettled = false;
    const wait = HiveApi.getCommunity(id, user)
      .then((info) => {
        if (seq !== commentAccessSeq || observer() !== user) return "";
        commentAccessMessage = commentCouncilDenial(info, fallbackTitle);
        commentAccessSettled = true;
        return commentAccessMessage;
      })
      .catch(() => {
        if (seq !== commentAccessSeq) return "";
        commentAccessMessage = "";
        commentAccessSettled = true;
        return "";
      })
      .finally(() => {
        if (seq !== commentAccessSeq) return;
        commentAccessWait = null;
      });
    commentAccessWait = wait;
    return wait;
  }

  function beginCommentCouncilCheck(composer) {
    const id = communityNameOf(currentPost);
    const target = composer && composer.nodeType === 1 ? composer : null;
    ensureCommentCouncil(currentPost).then((denial) => {
      if (!denial || !target || !target.isConnected) return;
      if (communityNameOf(currentPost) !== id) return;
      if (target.classList.contains("is-pending") || target.classList.contains("is-uploading")) return;
      const status = target.querySelector(".composer-status");
      if (status && status.classList.contains("is-error")) return;
      composerStatus(target, denial, false);
    });
  }

  async function submitComment(composer) {
    const user = observer();
    if (!user) {
      showError("Log in to write a comment.");
      return;
    }
    if (composer.classList.contains("is-pending") || composer.classList.contains("is-uploading")) {
      return;
    }
    if (composer.getAttribute("data-edit-author")) {
      await submitCommentEdit(composer);
      return;
    }
    const textarea = composer.querySelector(".composer-input");
    const submitBtn = composer.querySelector(".composer-submit");
    const body = textarea ? textarea.value.trim() : "";
    if (!body) {
      composerStatus(composer, "Write a comment first.", true);
      return;
    }
    if (!hasSigner(user)) {
      composerStatus(composer, signerNeededMessage(), true);
      return;
    }
    const parentAuthor = composer.getAttribute("data-parent-author");
    const parentPermlink = composer.getAttribute("data-parent-permlink");
    if (!parentAuthor || !parentPermlink) return;
    const permlink = commentPermlink(parentAuthor, parentPermlink);
    const images = imagesFromMarkdown(body);
    const jsonMetadata = {
      app: APP_ID + "/" + APP_VERSION,
      format: "markdown",
      tags: ["cyberspace77"],
    };
    if (images.length) jsonMetadata.image = images;

    composer.classList.add("is-pending");
    if (submitBtn) submitBtn.disabled = true;
    composerStatus(composer, signingLabel());

    const { promise } = ChainQueue.comment({
      author: user,
      parentAuthor,
      parentPermlink,
      permlink,
      title: "",
      body,
      jsonMetadata,
    });

    try {
      await promise;
      clearStoredCommentDraft();
      if (textarea) textarea.value = "";
      if (!accountReputation(user)) await loadAccountResources();
      try {
        await HiveMd.whenMarkdownReady();
      } catch {
        // renderComment escapes the body when the markdown scripts fail.
      }
      const html = renderComment({
        author: user,
        permlink,
        body,
        created: new Date().toISOString(),
        author_reputation: accountReputation(user),
        payout: 0,
        json_metadata: JSON.stringify(jsonMetadata),
        parent_author: parentAuthor,
        parent_permlink: parentPermlink,
        children: 0,
        _replies: [],
      });
      appendPostedComment(parentAuthor, parentPermlink, html);
      bumpCommentCount(1);
      composerStatus(composer, "");
      const slot = composer.closest(".comment-reply-slot");
      if (slot) {
        slot.hidden = true;
        slot.innerHTML = "";
        const comment = slot.closest(".comment");
        const replyBtn = comment && comment.querySelector(":scope > .comment-actions .comment-reply-btn");
        if (replyBtn) replyBtn.classList.remove("is-open");
      }
    } catch (err) {
      composerStatus(composer, err.message || String(err), true);
    } finally {
      composer.classList.remove("is-pending");
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  async function submitCommentEdit(composer) {
    const user = observer();
    const editAuthor = composer.getAttribute("data-edit-author");
    const editPermlink = composer.getAttribute("data-edit-permlink");
    if (!isOwnAuthor(editAuthor) || user !== String(editAuthor).toLowerCase()) {
      composerStatus(composer, "You can only edit your own comments.", true);
      return;
    }
    const textarea = composer.querySelector(".composer-input");
    const submitBtn = composer.querySelector(".composer-submit");
    const body = textarea ? textarea.value.trim() : "";
    if (!body) {
      composerStatus(composer, "Write a comment first.", true);
      return;
    }
    if (!hasSigner(user)) {
      composerStatus(composer, signerNeededMessage(), true);
      return;
    }
    const src = contentOf(editAuthor, editPermlink) || {};
    const parentAuthor =
      composer.getAttribute("data-parent-author") || src.parent_author || "";
    const parentPermlink =
      composer.getAttribute("data-parent-permlink") || src.parent_permlink || "";
    if (!parentAuthor || !parentPermlink) {
      composerStatus(composer, "Could not find this comment's parent.", true);
      return;
    }
    if (body === String(src.body || "").trim()) {
      closeCommentEditor(composer.closest(".comment"));
      return;
    }
    const prevMeta = HiveMd.parseJsonMetadata(src.json_metadata);
    let tags = prevMeta.tags;
    if (typeof tags === "string") tags = tags.split(/[\s,]+/);
    if (!Array.isArray(tags) || !tags.length) tags = ["cyberspace77"];
    const jsonMetadata = mergeJsonMetadata(src.json_metadata, body, tags);

    composer.classList.add("is-pending");
    if (submitBtn) submitBtn.disabled = true;
    composerStatus(composer, signingLabel());

    const { promise } = ChainQueue.comment({
      author: user,
      parentAuthor,
      parentPermlink,
      permlink: editPermlink,
      title: src.title || "",
      body,
      jsonMetadata,
    });

    try {
      await promise;
      rememberContent({
        author: user,
        permlink: editPermlink,
        title: src.title || "",
        body,
        parent_author: parentAuthor,
        parent_permlink: parentPermlink,
        json_metadata: jsonMetadata,
      });
      const comment = composer.closest(".comment");
      const bodyEl = comment && comment.querySelector(":scope > .comment-body");
      if (bodyEl) {
        try {
          await HiveMd.whenMarkdownReady();
        } catch {
          // renderMarkdown escapes the source when the CDN scripts fail.
        }
        bodyEl.innerHTML = HiveMd.renderMarkdown(body);
      }
      closeCommentEditor(comment);
    } catch (err) {
      composerStatus(composer, err.message || String(err), true);
    } finally {
      composer.classList.remove("is-pending");
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  /* ─── Post layer ─── */
  function postLayerEl() {
    return document.getElementById("postLayer");
  }

  function postViewEl() {
    return document.getElementById("postView");
  }

  function snapKey(author, permlink) {
    return (
      String(author || "")
        .replace(/^@/, "")
        .toLowerCase() +
      "/" +
      String(permlink || "").toLowerCase()
    );
  }

  function samePostId(post, author, permlink) {
    if (!post) return false;
    return (
      String(post.author || "")
        .replace(/^@/, "")
        .toLowerCase() ===
        String(author || "")
          .replace(/^@/, "")
          .toLowerCase() &&
      String(post.permlink || "").toLowerCase() === String(permlink || "").toLowerCase()
    );
  }

  function findLoadedPost(author, permlink) {
    const items = feedState.items || [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (samePostId(item, author, permlink)) return item;
      if (item && item.original_entry && samePostId(item.original_entry, author, permlink)) {
        return item;
      }
    }
    if (samePostId(currentPost, author, permlink)) return currentPost;
    return null;
  }

  function commentsPendingHtml() {
    return `<div class="loading-row post-comments-pending"><span class="btn-loader" aria-hidden="true"></span> Loading comments…</div>`;
  }

  function commentsErrorHtml(msg) {
    return `<p class="feed-hint post-comments-error">${HiveMd.escapeHtml(msg || "Couldn't load comments.")}</p>`;
  }

  function countThreadedReplies(node) {
    const replies = node && node._replies;
    if (!Array.isArray(replies) || !replies.length) return 0;
    let n = 0;
    for (let i = 0; i < replies.length; i++) {
      if (isBlacklistedPost(replies[i])) continue;
      n += 1 + countThreadedReplies(replies[i]);
    }
    return n;
  }

  function discussionCommentCount(discussion, root) {
    // Replies under the opened post. A comment opened from a profile feed is
    // depth 1 in its own discussion, so a depth check would count it.
    if (root && Array.isArray(root._replies)) return countThreadedReplies(root);
    if (discussion && typeof discussion === "object") {
      const self =
        root && root.author
          ? String(root.author).toLowerCase() + "/" + String(root.permlink).toLowerCase()
          : "";
      return Object.values(discussion).filter((node) => {
        if (!node || !node.author || !node.permlink) return false;
        if (Number(node.depth) === 0) return false;
        if (isBlacklistedPost(node)) return false;
        if (!self) return true;
        const key = String(node.author).toLowerCase() + "/" + String(node.permlink).toLowerCase();
        return key !== self;
      }).length;
    }
    return Number(root && root.children) || 0;
  }

  function articleTitleText(post) {
    const title = post && post.title != null ? String(post.title) : "";
    return title || "(untitled)";
  }

  function articleTitleHtml(post) {
    const title = HiveMd.escapeHtml(articleTitleText(post));
    const href = commentOnRootHref(post);
    if (!href) return title;
    return `<a href="${HiveMd.escapeHtml(href)}">${title}</a>`;
  }

  function paintArticleTitle(article, post) {
    if (!article) return;
    const h1 = article.querySelector(":scope > h1");
    if (!h1) return;
    const title = articleTitleText(post);
    const href = commentOnRootHref(post);
    const link = h1.querySelector(":scope > a");
    if (href) {
      if (
        link &&
        h1.childNodes.length === 1 &&
        link.getAttribute("href") === href &&
        link.textContent === title
      ) {
        return;
      }
      h1.innerHTML = articleTitleHtml(post);
      return;
    }
    if (!link && h1.textContent === title) return;
    h1.textContent = title;
  }

  // The community link above the title already names the subspace, so the
  // matching hive-id tag is not repeated in the tag row.
  function articleTagsOf(post) {
    const tags = tagsOf(post);
    const community = communityNameOf(post);
    if (!community) return tags;
    const skip = tags.findIndex((tag) => normalizeCommunityName(tag) === community);
    if (skip < 0) return tags;
    return tags.filter((_, i) => i !== skip);
  }

  function articleTagsHtml(root) {
    if (!isRootPost(root)) return "";
    const chips = articleTagsOf(root).map(tagChipHtml).join("");
    if (!chips) return "";
    return `
        <div class="tags">
          ${chips}
        </div>`;
  }

  function syncArticleTags(article, root) {
    if (!article || !root) return;
    const tagsEl = article.querySelector(":scope > .tags");
    if (!isRootPost(root)) {
      if (tagsEl) tagsEl.remove();
      return;
    }
    const html = articleTagsOf(root).map(tagChipHtml).join("");
    if (!html) {
      if (tagsEl) tagsEl.remove();
      return;
    }
    if (!tagsEl) {
      const bodyEl = article.querySelector(":scope > .post-body");
      if (!bodyEl) return;
      const wrap = document.createElement("div");
      wrap.className = "tags";
      wrap.innerHTML = html;
      bodyEl.insertAdjacentElement("beforebegin", wrap);
      return;
    }
    tagsEl.innerHTML = html;
  }

  function articleHtml(root, opts) {
    const options = opts || {};
    const community = communityLabelHtml(root, "article-community");
    const commentCount =
      options.commentCount != null ? options.commentCount : Number(root.children) || 0;
    const user = observer();
    const composer = user
      ? composerHtml(root.author, root.permlink, {
          placeholder: "Write a comment…",
          submitLabel: "Comment",
        })
      : "";
    const commentsBody =
      options.commentsHtml != null ? options.commentsHtml : commentsPendingHtml();
    return `
      <article class="article">
        ${community}
        <h1>${articleTitleHtml(root)}</h1>
        <div class="article-byline">
          ${authorLinkHtml(root.author, "medium")}
          <span>· ${Math.floor(HiveMd.displayReputation(root.author_reputation))}</span>
          <span>· ${metaTimeHtml(root.created, postPath(root))}</span>
          <div class="article-stats">
            ${voteControlHtml(root, "plain")}
            ${commentCountHtml(commentCount, "#comments")}
            ${payoutHtml(root, false)}
            ${contentMoreHtml(root.author, root.permlink, "post", commentCount)}
          </div>
        </div>
        ${articleTagsHtml(root)}
        <div class="post-body">${HiveMd.renderMarkdown(root.body || "")}</div>
        <div class="post-stats-bar" id="stats">
          ${voteControlHtml(root, "pills")}
          ${commentCountHtml(commentCount, "#comments")}
          ${reblogControlHtml(root)}
          ${payoutHtml(root, true)}
          ${contentMoreHtml(root.author, root.permlink, "post", commentCount)}
        </div>
        <section class="comments" id="comments" data-root-author="${HiveMd.escapeHtml(root.author)}" data-root-permlink="${HiveMd.escapeHtml(root.permlink)}" data-count="${commentCount}">
          ${composer}
          <div class="comment-list">
            ${commentsBody}
          </div>
        </section>
      </article>
    `;
  }

  function renderedCommentsHtml(root) {
    const comments = (root._replies || []).map(renderComment).join("");
    return comments || `<p class="feed-hint">No comments yet.</p>`;
  }

  function paintPostMessage(html) {
    const pv = postViewEl();
    if (!pv) return;
    pv.innerHTML = html;
  }

  function pageMetaDefaults() {
    if (metaDefaults) return metaDefaults;
    const desc = document.querySelector('meta[name="description"]');
    const image = document.querySelector('meta[property="og:image"]');
    metaDefaults = {
      description:
        (desc && String(desc.getAttribute("content") || "").trim()) ||
        "Own your voice. Create, earn, and connect without censorship, gatekeepers, and algos.",
      image:
        (image && String(image.getAttribute("content") || "").trim()) ||
        "/assets/cyberspace77.png",
    };
    return metaDefaults;
  }

  function setMetaContent(selector, value) {
    const el = document.querySelector(selector);
    if (el) el.setAttribute("content", value);
  }

  function absoluteMetaUrl(url) {
    const raw = String(url || "").trim();
    if (!raw) return "";
    try {
      return new URL(raw, location.href).href;
    } catch (err) {
      return raw;
    }
  }

  const authorImageCache = new Map();
  const authorImageLoads = new Map();
  let pageMetaGen = 0;

  // Title, description, and image move together. An omitted description or
  // image falls back to the tags from index.html. Profile and subspace pages
  // pass allowEmptyDescription so a missing about stays blank.
  function setPageMeta(title, description, image, options) {
    const defaults = pageMetaDefaults();
    const allowEmpty = Boolean(options && options.allowEmptyDescription);
    const nextTitle = String(title || "").trim() || "CyberSpace77";
    let nextDescription = String(description || "").replace(/\s+/g, " ").trim();
    if (!nextDescription && !allowEmpty) nextDescription = defaults.description;
    const nextImage = absoluteMetaUrl(image || defaults.image);
    const gen = ++pageMetaGen;
    document.title = nextTitle;
    setMetaContent('meta[name="description"]', nextDescription);
    setMetaContent('meta[property="og:title"]', nextTitle);
    setMetaContent('meta[property="og:description"]', nextDescription);
    if (nextImage) setMetaContent('meta[property="og:image"]', nextImage);
    return gen;
  }

  function profileImageOf(profile) {
    const meta = (profile && (profile.metadata || profile.posting_json_metadata)) || {};
    const info = meta && typeof meta.profile === "object" && meta.profile ? meta.profile : {};
    return String((info && info.profile_image) || (profile && profile.profile_image) || "").trim();
  }

  function authorImageKey(author) {
    return String(author || "")
      .replace(/^@/, "")
      .toLowerCase();
  }

  // null means the picture is not known yet. An empty string means the
  // account has no profile image set.
  function knownAuthorImage(author) {
    const name = authorImageKey(author);
    if (!name) return "";
    if (accountState.loaded && accountState.user === name) {
      return accountState.profileImage || "";
    }
    if (profileState.author === name && profileState.profile) {
      return profileImageOf(profileState.profile);
    }
    if (authorImageCache.has(name)) return authorImageCache.get(name);
    return null;
  }

  function rememberAuthorImage(author, image) {
    const name = authorImageKey(author);
    if (!name) return;
    authorImageCache.set(name, String(image || "").trim());
  }

  function authorImage(author) {
    const name = authorImageKey(author);
    if (!name) return Promise.resolve("");
    const known = knownAuthorImage(name);
    if (known != null) return Promise.resolve(known);
    if (authorImageLoads.has(name)) return authorImageLoads.get(name);
    const load = HiveApi.getProfile(name, observer())
      .then((profile) => {
        const image = profileImageOf(profile);
        rememberAuthorImage(name, image);
        return image;
      })
      .catch(() => {
        authorImageLoads.delete(name);
        return "";
      });
    authorImageLoads.set(name, load);
    return load;
  }

  function loadedProfileFor(author) {
    const name = authorImageKey(author);
    if (!name) return null;
    if (profileState.author === name && profileState.profile) return profileState.profile;
    if (ownAccountReady(name)) return profileFromAccountState();
    return null;
  }

  function setProfileMeta(author, page, profile) {
    const name = authorImageKey(author);
    const loaded = profile || loadedProfileFor(name);
    const about = loaded ? profileAboutText(loaded) : "";
    const image = loaded ? profileImageOf(loaded) : knownAuthorImage(name) || "";
    if (loaded) rememberAuthorImage(name, profileImageOf(loaded));
    setPageMeta(profilePageTitle(name, page), about, image || AVATAR_DEFAULT_LARGE, {
      allowEmptyDescription: true,
    });
  }

  function setCommunityMeta(name, page, info) {
    const id = String(name || "").toLowerCase();
    const loaded = info || (communityState.name === id ? communityState.info : null);
    const about = loaded ? communityAboutText(loaded) : "";
    const known = knownAuthorImage(id);
    const gen = setPageMeta(
      communityPageTitle(loaded, id, page),
      about,
      known || pageMetaDefaults().image,
      { allowEmptyDescription: true }
    );
    if (known != null) return;
    authorImage(id).then((picture) => {
      if (gen !== pageMetaGen) return;
      const route = parseRoute();
      if (!route || route.name !== "community" || String(route.community || "").toLowerCase() !== id) {
        return;
      }
      setPageMeta(
        communityPageTitle(loaded, id, page),
        about,
        picture || pageMetaDefaults().image,
        { allowEmptyDescription: true }
      );
    });
  }

  function profileAboutText(profile) {
    const meta = (profile && (profile.metadata || profile.posting_json_metadata)) || {};
    const info = meta && typeof meta.profile === "object" && meta.profile ? meta.profile : {};
    return String((info && info.about) || (profile && profile.about) || "").trim();
  }

  function communityAboutText(info) {
    return String((info && info.about) || "").trim();
  }

  function textFromExcerptHtml(html) {
    const raw = String(html || "");
    if (!raw) return "";
    const el = document.createElement("div");
    el.innerHTML = raw;
    return String(el.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function postMetaDescription(post) {
    if (post && window.HiveMd && typeof HiveMd.parseJsonMetadata === "function") {
      const meta = HiveMd.parseJsonMetadata(post.json_metadata);
      if (meta && typeof meta.description === "string") {
        const authored = meta.description.trim();
        if (authored) return authored;
      }
    }
    if (!post || !window.HiveMd || typeof HiveMd.excerpt !== "function") return "";
    const result = HiveMd.excerpt(post, 280, {
      firstSentence: true,
      preserveLineBreaks: false,
    });
    return textFromExcerptHtml(result && result.html);
  }

  function postMetaImage(post) {
    if (!post || !window.HiveMd) return "";
    const meta = HiveMd.parseJsonMetadata(post.json_metadata);
    const list = meta && meta.image;
    if (!Array.isArray(list)) return "";
    for (let i = 0; i < list.length; i++) {
      const url = typeof list[i] === "string" ? list[i].trim() : "";
      if (url) return url;
    }
    return "";
  }

  function repliedPostTitle(comment, article) {
    const rootTitle = String((comment && comment.root_title) || "").trim();
    if (rootTitle) return rootTitle;
    if (article && isRootPost(article)) {
      const title = String(article.title || "").trim();
      if (title) return title;
    }
    const raw = String((comment && comment.title) || "").trim();
    const stripped = raw.replace(/^(?:re:\s*)+/i, "").trim();
    return stripped || raw || "Post";
  }

  function commentPageTitle(comment, article) {
    const author = "@" + authorImageKey(comment && comment.author);
    return author + " replied to: " + repliedPostTitle(comment, article) + " — CyberSpace77";
  }

  function commentMetaDescription(comment) {
    if (!comment || !window.HiveMd || typeof HiveMd.excerpt !== "function") return "";
    const result = HiveMd.excerpt(comment, 280, {
      firstSentence: true,
      preserveLineBreaks: false,
    });
    return textFromExcerptHtml(result && result.html);
  }

  function findLoadedComment(author, permlink) {
    const name = authorImageKey(author);
    const link = String(permlink || "").toLowerCase();
    if (!name || !link) return null;
    let found = null;
    const walk = (node) => {
      if (!node || found) return;
      if (
        authorImageKey(node.author) === name &&
        String(node.permlink || "").toLowerCase() === link
      ) {
        found = node;
        return;
      }
      const replies = node._replies || [];
      for (let i = 0; i < replies.length; i++) walk(replies[i]);
    };
    walk(currentPost);
    if (found) return found;
    const cached = contentOf(name, permlink) || contentOf(author, permlink);
    return cached || null;
  }

  function samePostRoute(author, permlink) {
    const route = parseRoute();
    return Boolean(
      route &&
        route.name === "post" &&
        authorImageKey(route.author) === authorImageKey(author) &&
        String(route.permlink || "") === String(permlink || "")
    );
  }

  function setNodeMeta(node, title, description, routeAuthor, routePermlink, hash) {
    const apply = (image) => setPageMeta(title, description, image);
    const fromNode = postMetaImage(node);
    if (fromNode) {
      apply(fromNode);
      return;
    }
    const author = authorImageKey(node && node.author);
    const known = knownAuthorImage(author);
    if (known != null) {
      apply(known || AVATAR_DEFAULT_LARGE);
      return;
    }
    const gen = apply(AVATAR_DEFAULT_LARGE);
    authorImage(author).then((image) => {
      if (gen !== pageMetaGen) return;
      if (!samePostRoute(routeAuthor, routePermlink)) return;
      if ((location.hash || "") !== hash) return;
      apply(image || AVATAR_DEFAULT_LARGE);
    });
  }

  function setPostTitle(root) {
    const routeAuthor = authorImageKey((root && root.author) || "");
    const routePermlink = String((root && root.permlink) || "");
    const hash = location.hash || "";
    const frag = parseCommentFragment(hash);
    const fragOnArticle =
      frag &&
      root &&
      isRootPost(root) &&
      !(
        authorImageKey(root.author) === frag.author &&
        String(root.permlink || "") === String(frag.permlink || "")
      );
    if (fragOnArticle) {
      const comment = findLoadedComment(frag.author, frag.permlink);
      if (comment) {
        setNodeMeta(
          comment,
          commentPageTitle(comment, root),
          commentMetaDescription(comment),
          routeAuthor,
          routePermlink,
          hash
        );
        return;
      }
      const gen = setPageMeta(
        commentPageTitle({ author: frag.author }, root),
        "",
        AVATAR_DEFAULT_LARGE
      );
      if (!window.HiveApi || typeof HiveApi.getPost !== "function") return;
      HiveApi.getPost(frag.author, frag.permlink)
        .then((comment) => {
          if (gen !== pageMetaGen || !comment || !comment.author) return;
          const still = parseCommentFragment(location.hash);
          if (!still || still.author !== frag.author || String(still.permlink) !== String(frag.permlink)) {
            return;
          }
          if (!samePostRoute(routeAuthor, routePermlink)) return;
          setNodeMeta(
            comment,
            commentPageTitle(comment, root),
            commentMetaDescription(comment),
            routeAuthor,
            routePermlink,
            location.hash || ""
          );
        })
        .catch(() => {});
      return;
    }
    if (root && !isRootPost(root)) {
      setNodeMeta(
        root,
        commentPageTitle(root, null),
        commentMetaDescription(root),
        routeAuthor,
        routePermlink,
        hash
      );
      return;
    }
    setNodeMeta(
      root,
      `${(root && root.title) || "Post"} — CyberSpace77`,
      postMetaDescription(root),
      routeAuthor,
      routePermlink,
      hash
    );
  }

  function setCommentCount(n) {
    const section = document.getElementById("comments");
    if (!section) return;
    section.setAttribute("data-count", String(n));
    const article = section.closest(".article");
    if (article) {
      article.querySelectorAll(".comment-n").forEach((el) => {
        el.textContent = "C " + n;
      });
    }
    syncDeleteOffers(
      section.getAttribute("data-root-author"),
      section.getAttribute("data-root-permlink"),
      n
    );
  }

  function fillCommentList(html) {
    const section = document.getElementById("comments");
    if (!section || !postLayer.open) return;
    persistCommentDraftNow();
    const openMore = document.querySelector(".content-more.is-open");
    if (openMore && section.contains(openMore)) closeContentMore();
    const list = section.querySelector(".comment-list");
    if (list) list.innerHTML = html;
    restoreCommentDraft();
  }

  function refreshArticleCommunity(root) {
    const article = activeArticle();
    if (!article) return;
    const html = communityLabelHtml(root, "article-community");
    const existing = article.querySelector(":scope > .article-community");
    if (!html) return;
    const wrap = document.createElement("div");
    wrap.innerHTML = html;
    const next = wrap.firstElementChild;
    if (!next) return;
    if (!existing) {
      const h1 = article.querySelector(":scope > h1");
      if (h1) h1.insertAdjacentElement("beforebegin", next);
      return;
    }
    if (
      existing.textContent !== next.textContent ||
      existing.getAttribute("href") !== next.getAttribute("href")
    ) {
      existing.replaceWith(next);
    }
  }

  function refreshArticleVotes(root) {
    if (!root || openSlider) return;
    const article = activeArticle();
    if (!article) return;
    const viewState = voteView(root);
    article.querySelectorAll(".vote-n").forEach((el) => {
      el.textContent = String(viewState.upCount);
    });
    article.querySelectorAll(".downvote-n").forEach((el) => {
      el.textContent = String(viewState.downCount);
    });
    article.querySelectorAll(".payout").forEach((el) => {
      applyPayoutEl(el, root);
    });
    rememberPayout(root);
  }

  function patchOpenArticle(prev, root) {
    const article = activeArticle();
    if (!article) return false;
    paintArticleTitle(article, root);
    if (String((prev && prev.body) || "") !== String(root.body || "")) {
      const bodyEl = article.querySelector(":scope > .post-body");
      if (bodyEl) bodyEl.innerHTML = HiveMd.renderMarkdown(root.body || "");
    }
    if (
      !isRootPost(root) ||
      !prev ||
      articleTagsOf(prev).join("\n") !== articleTagsOf(root).join("\n")
    ) {
      syncArticleTags(article, root);
    }
    refreshArticleCommunity(root);
    refreshArticleVotes(root);
    setPostTitle(root);
    return true;
  }

  function paintArticle(root, opts) {
    const pv = postViewEl();
    if (!pv || !root) return false;
    persistCommentDraftNow();
    const options = opts || {};
    currentPost = root;
    rememberContent(root);
    pv.innerHTML = articleHtml(root, options);
    setPostTitle(root);
    restoreCommentDraft();
    return true;
  }

  function htmlHasPendingComments(html) {
    return String(html || "").indexOf("post-comments-pending") !== -1;
  }

  function rememberPostSnap() {
    if (!postLayer.author || !postLayer.permlink) return;
    const pv = postViewEl();
    if (!pv || !pv.innerHTML.trim()) return;
    const html = pv.innerHTML;
    const key = snapKey(postLayer.author, postLayer.permlink);
    const pending = htmlHasPendingComments(html);
    const prev = postSnaps.get(key);
    if (pending && prev && !htmlHasPendingComments(prev.html)) return;
    postSnaps.delete(key);
    postSnaps.set(key, {
      html,
      scroll: window.scrollY || window.pageYOffset || 0,
      title: document.title,
      root: currentPost,
    });
    while (postSnaps.size > POST_SNAP_MAX) {
      const oldest = postSnaps.keys().next().value;
      postSnaps.delete(oldest);
    }
  }

  function showPostSnap(snap) {
    const pv = postViewEl();
    if (!pv || !snap || !snap.html) return false;
    persistCommentDraftNow();
    pv.innerHTML = snap.html;
    if (snap.root) {
      currentPost = snap.root;
      rememberContent(snap.root);
      setPostTitle(snap.root);
    } else if (snap.title) {
      setPageMeta(snap.title);
    }
    restoreCommentDraft();
    return true;
  }

  let instantScrollGen = 0;

  function armInstantScroll() {
    const root = document.documentElement;
    const gen = ++instantScrollGen;
    // html { scroll-behavior: smooth } would ease the jump to the top of a
    // post, and putting smooth back in the same turn starts that animation.
    root.style.scrollBehavior = "auto";
    root.style.overflowAnchor = "none";
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (gen !== instantScrollGen) return;
        root.style.scrollBehavior = "";
        root.style.overflowAnchor = "";
      });
    });
  }

  function scrollWindowInstant(y) {
    armInstantScroll();
    const root = document.documentElement;
    const top = y || 0;
    try {
      window.scrollTo({ top, left: 0, behavior: "instant" });
    } catch (err) {
      window.scrollTo(0, top);
    }
    root.scrollTop = top;
    quietSmartHeader();
  }

  function setPostBackgroundHidden(hidden) {
    const app = document.querySelector(".app");
    const flyer = document.getElementById("welcomeFlyer");
    [app, flyer].forEach((el) => {
      if (!el) return;
      if (hidden) el.setAttribute("aria-hidden", "true");
      else el.removeAttribute("aria-hidden");
    });
  }

  function ensurePostHistory() {
    const state = history.state;
    // Capture the feed offset once, before the feed is taken out of flow.
    // Later post-to-post opens keep that offset for Back.
    if (!postLayer.heldScroll) {
      if (state && state.cs77 === "post" && Number.isFinite(Number(state.underScroll))) {
        postLayer.scrollY = Number(state.underScroll);
      } else {
        postLayer.scrollY = window.scrollY || window.pageYOffset || 0;
      }
      if (state && state.cs77 === "post" && typeof state.underWelcome === "boolean") {
        postLayer.hadWelcome = state.underWelcome;
      } else {
        postLayer.hadWelcome = document.body.classList.contains("has-welcome");
      }
      postLayer.heldScroll = true;
    }
    const underKey =
      (state && state.cs77 === "post" && state.underKey) || currentViewKey || "";
    const prevNav = state && Number(state.nav);
    history.replaceState(
      Object.assign(
        {
          cs77: "post",
          underScroll: postLayer.scrollY || 0,
          underKey,
          underWelcome: !!postLayer.hadWelcome,
          nav: Number.isFinite(prevNav) && prevNav > 0 ? prevNav : nextHistoryNav(),
        },
        carriedHistoryFields(state)
      ),
      "",
      location.href
    );
  }

  function closeWelcomeForPost() {
    if (!postLayer.hadWelcome) return;
    document.body.classList.remove("has-welcome");
    const flyer = document.getElementById("welcomeFlyer");
    if (flyer) flyer.hidden = true;
  }

  function revealPostLayer() {
    const layer = postLayerEl();
    if (!layer) return null;
    ensurePostHistory();
    quietSmartHeader();
    armInstantScroll();
    closeWelcomeForPost();
    const active = document.activeElement;
    if (active && active !== document.body && active.blur) active.blur();
    document.body.classList.add("is-post-open");
    layer.hidden = false;
    setPostBackgroundHidden(true);
    postLayer.open = true;
    updateScrollTopBtn();
    return layer;
  }

  function cardContentKey(author, permlink) {
    return snapKey(author, permlink);
  }

  function cardContentStamp(post) {
    const tags = tagsOf(post)
      .map((t) => String(t).toLowerCase())
      .sort()
      .join("\n");
    return [
      String(post.title || ""),
      String(post.body || ""),
      HiveMd.extractImage(post) || "",
      tags,
    ].join("\u0001");
  }

  function rememberCardContent(post) {
    if (!post || !post.author || !post.permlink) return;
    cardContentStamps.set(cardContentKey(post.author, post.permlink), cardContentStamp(post));
  }

  function feedItemDomKey(el) {
    const card = el.querySelector("article.post-card");
    if (!card) return "";
    return snapKey(card.getAttribute("data-author"), card.getAttribute("data-permlink"));
  }

  function feedItemPostKey(post) {
    const shown = cardDisplayPost(post) || post;
    return snapKey(shown.author, shown.permlink);
  }

  function paintFeedCards(list, mapFn) {
    const items = feedState.items || [];
    const following = isFollowingFeed();
    const visible = [];
    for (let i = 0; i < items.length; i++) {
      const post = items[i];
      if (following && crossPostRef(post)) continue;
      rememberCardContent(cardDisplayPost(post));
      visible.push(post);
    }
    const existing = [];
    const children = list.children;
    for (let i = 0; i < children.length; i++) {
      if (children[i].classList.contains("feed-item")) existing.push(children[i]);
    }
    // Appending keeps the cards already on screen. Rebuilding the list on
    // every page reloads images and can jump the scroll position.
    if (existing.length && existing.length <= visible.length) {
      let prefix = true;
      for (let i = 0; i < existing.length; i++) {
        if (feedItemDomKey(existing[i]) !== feedItemPostKey(visible[i])) {
          prefix = false;
          break;
        }
      }
      if (prefix) {
        if (existing.length === visible.length) return;
        list.insertAdjacentHTML("beforeend", visible.slice(existing.length).map(mapFn).join(""));
        return;
      }
    }
    list.innerHTML = visible.map(mapFn).join("");
  }

  function feedCardHrefMatches(href, author, permlink) {
    const path = String(href || "")
      .split("#")[0]
      .split("?")[0]
      .toLowerCase();
    const needle =
      "/@" +
      String(author || "")
        .replace(/^@/, "")
        .toLowerCase() +
      "/" +
      String(permlink || "").toLowerCase();
    return path.endsWith(needle);
  }

  function findFeedCard(author, permlink) {
    const cards = document.querySelectorAll("#view article.post-card");
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      if (
        samePostId(
          {
            author: card.getAttribute("data-author"),
            permlink: card.getAttribute("data-permlink"),
          },
          author,
          permlink
        )
      ) {
        return card;
      }
      const hit = card.querySelector("a.card-hit");
      if (hit && feedCardHrefMatches(hit.getAttribute("href"), author, permlink)) {
        return card;
      }
    }
    return null;
  }

  function postContentEdited(prev, next) {
    if (!prev || !next || prev === next) return false;
    return cardContentStamp(prev) !== cardContentStamp(next);
  }

  function cardContentChanged(post) {
    if (!post || !post.author || !post.permlink) return false;
    const prev = cardContentStamps.get(cardContentKey(post.author, post.permlink));
    if (prev != null) return prev !== cardContentStamp(post);
    const item = findLoadedPost(post.author, post.permlink);
    const shown = cardDisplayPost(item);
    if (!shown || shown === post) return false;
    return postContentEdited(shown, post);
  }

  function commentCountForReturn(post) {
    const section = document.getElementById("comments");
    if (
      section &&
      samePostId(
        {
          author: section.getAttribute("data-root-author"),
          permlink: section.getAttribute("data-root-permlink"),
        },
        post.author,
        post.permlink
      )
    ) {
      const shown = Number(section.getAttribute("data-count"));
      if (Number.isFinite(shown)) return Math.max(0, shown);
    }
    return Number(post && post.children) || 0;
  }

  function copyDefinedFields(dest, src, keys) {
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (src[key] !== undefined) dest[key] = src[key];
    }
  }

  function copyPostContent(dest, src) {
    copyDefinedFields(dest, src, [
      "title",
      "body",
      "json_metadata",
      "updated",
      "category",
      "community",
      "community_title",
    ]);
  }

  function copyPostStats(dest, src, commentCount) {
    copyDefinedFields(dest, src, [
      "active_votes",
      "stats",
      "payout",
      "pending_payout_value",
      "total_payout_value",
      "curator_payout_value",
      "author_payout_value",
      "net_rshares",
      "is_paidout",
      "cashout_time",
      "payout_at",
      "max_accepted_payout",
      "percent_hbd",
      "beneficiaries",
      "promoted",
      "reblogs",
      "reblogged_by",
    ]);
    dest.children = commentCount;
  }

  function replaceFeedCard(card, post) {
    const shown = cardDisplayPost(post);
    const html =
      profileState.author && !isRootPost(shown) ? profileCardHtml(post) : cardHtml(post);
    const wrap = document.createElement("div");
    wrap.innerHTML = String(html || "").trim();
    const next = wrap.firstElementChild;
    const root = (card && card.closest && card.closest(".feed-item")) || card;
    if (next && root) root.replaceWith(next);
  }

  function patchFeedCardStats(card, post, commentCount) {
    syncVoteButtons(post.author, post.permlink, voteView(post));
    syncReblogButtons(post.author, post.permlink, reblogView(post));
    card.querySelectorAll(".payout").forEach((el) => {
      applyPayoutEl(el, post);
    });
    const label = "C " + commentCount;
    card.querySelectorAll(".comment-n").forEach((el) => {
      el.textContent = label;
    });
    syncDeleteOffers(post.author, post.permlink, commentCount);
  }

  // The list under a post stays mounted. On the way back, rebuild the card
  // when the post content changed, and otherwise refresh only its figures.
  function syncFeedCardOnReturn() {
    const post = currentPost;
    if (!post || !post.author || !post.permlink) return;
    const item = findLoadedPost(post.author, post.permlink);
    const card = findFeedCard(post.author, post.permlink);
    if (!item && !card) return;
    const target = item ? cardDisplayPost(item) : null;
    const edited = cardContentChanged(post);
    const comments = commentCountForReturn(post);
    if (target && target !== post) {
      if (edited) copyPostContent(target, post);
      copyPostStats(target, post, comments);
    } else if (target) {
      target.children = comments;
    }
    rememberCardContent(target && edited ? target : post);
    if (!card) return;
    if (edited) {
      replaceFeedCard(card, item || post);
      return;
    }
    patchFeedCardStats(card, target || post, comments);
  }

  function suspendPostLayer(opts) {
    if (!postLayer.open) return;
    stopCommentJump();
    rememberPostSnap();
    postLayer.gen += 1;
    const layer = postLayerEl();
    if (layer) layer.hidden = true;
    postLayer.open = false;
    postLayer.author = "";
    postLayer.permlink = "";
    const y = postLayer.scrollY || 0;
    const restore = !(opts && opts.restoreScroll === false);
    const bringWelcome = restore && postLayer.hadWelcome;
    postLayer.heldScroll = false;
    postLayer.hadWelcome = false;
    quietSmartHeader();
    armInstantScroll();
    document.body.classList.remove("is-post-open");
    setPostBackgroundHidden(false);
    if (bringWelcome) {
      document.body.classList.add("has-welcome");
      const flyer = document.getElementById("welcomeFlyer");
      if (flyer) flyer.hidden = false;
    }
    scrollWindowInstant(restore ? y : 0);
    updateScrollTopBtn();
  }

  function postStill(gen, author, permlink) {
    return (
      postLayer.gen === gen &&
      postLayer.open &&
      postLayer.author === author &&
      postLayer.permlink === permlink
    );
  }

  function stopCommentJump() {
    if (postLayer.jumpCleanup) {
      postLayer.jumpCleanup();
      postLayer.jumpCleanup = null;
    }
    if (postLayer.jumpObserver) {
      postLayer.jumpObserver.disconnect();
      postLayer.jumpObserver = null;
    }
    if (postLayer.jumpTimer) {
      clearTimeout(postLayer.jumpTimer);
      postLayer.jumpTimer = 0;
    }
  }

  function armPostAnchorJump(getEl) {
    stopCommentJump();
    const layer = postLayerEl();
    const article = document.querySelector("#postView .article");
    if (!layer || !article || typeof getEl !== "function") return;
    const gen = postLayer.gen;
    let ignore = false;
    const onUser = () => {
      ignore = true;
      stopCommentJump();
    };
    window.addEventListener("wheel", onUser, { passive: true });
    window.addEventListener("touchstart", onUser, { passive: true });
    const realign = () => {
      if (ignore || !postLayer.open || postLayer.gen !== gen) return;
      const el = getEl();
      if (el) scrollTargetIntoView(el, "auto");
    };
    if (typeof ResizeObserver === "function") {
      const observer = new ResizeObserver(realign);
      observer.observe(article);
      postLayer.jumpObserver = observer;
    }
    postLayer.jumpCleanup = () => {
      window.removeEventListener("wheel", onUser);
      window.removeEventListener("touchstart", onUser);
    };
    postLayer.jumpTimer = setTimeout(stopCommentJump, 4000);
    article.querySelectorAll("img").forEach((img) => {
      if (!img.complete) img.addEventListener("load", realign, { once: true });
    });
    requestAnimationFrame(realign);
  }

  function settlePostAnchor(opts, commentsReady) {
    if (!postLayer.open) return;
    const jumpComments =
      Boolean(opts && opts.jumpComments) ||
      (!HASH_ROUTING && location.hash === "#comments");
    const anchor =
      (opts && opts.anchor) || commentHashFromLocation();
    if (jumpComments) {
      // The post can grow after the first paint (images, then the thread).
      // Keep the comments section in view until that settles, unless the
      // reader has already scrolled away.
      scrollToComments("auto");
      armPostAnchorJump(() => document.getElementById("comments"));
      return;
    }
    if (!anchor) return;
    if (!commentsReady) return;
    const target = () => findCommentAnchorEl(anchor);
    if (target()) {
      scrollToAnchor(anchor, "auto");
      armPostAnchorJump(target);
      return;
    }
    // Thread is in, but this reply may paint a tick later.
    armPostAnchorJump(target);
  }

  async function presentPost(author, permlink, opts) {
    const a = String(author || "")
      .replace(/^@/, "")
      .toLowerCase();
    const p = String(permlink || "");
    const options = opts || {};
    const layer = postLayerEl();
    const pv = postViewEl();
    if (!layer || !pv) {
      view.innerHTML = notFoundHtml("Could not open this post.");
      return;
    }

    if (isBlacklistedPost(a, p)) {
      if (postLayer.open) rememberPostSnap();
      postLayer.gen += 1;
      postLayer.author = a;
      postLayer.permlink = p;
      currentPost = null;
      setPageMeta("Not found — CyberSpace77");
      paintPostMessage(notFoundHtml("This post was blacklisted."));
      revealPostLayer();
      scrollWindowInstant(0);
      return;
    }

    if (postLayer.open && postLayer.author === a && postLayer.permlink === p && pv.innerHTML.trim()) {
      if (currentPost) setPostTitle(currentPost);
      settlePostAnchor(options, !htmlHasPendingComments(pv.innerHTML));
      return;
    }

    if (postLayer.open) rememberPostSnap();

    const gen = ++postLayer.gen;
    postLayer.author = a;
    postLayer.permlink = p;
    const snap = postSnaps.get(snapKey(a, p));
    const useSnap = Boolean(snap && snap.html);
    // Overlap the CDN scripts with the discussion request. A cached body waits
    // so author HTML is not inserted before DOMPurify is loaded.
    const markdownReady = HiveMd.whenMarkdownReady();
    let restoreScroll = null;
    if (useSnap) {
      showPostSnap(snap);
      if (!options.jumpComments && !options.anchor) restoreScroll = snap.scroll || 0;
    } else {
      const cached = HiveMd.markdownReady() ? findLoadedPost(a, p) : null;
      if (cached && (cached.title || cached.body)) {
        paintArticle(cached, {
          commentCount: Number(cached.children) || 0,
          commentsHtml: commentsPendingHtml(),
        });
      } else {
        paintPostMessage(
          `<div class="loading-row"><span class="btn-loader" aria-hidden="true"></span> Opening post…</div>`
        );
        currentPost = null;
        setPageMeta("Post — CyberSpace77");
      }
    }

    revealPostLayer();
    scrollWindowInstant(restoreScroll != null ? restoreScroll : 0);
    const shown = postViewEl();
    const articleShown = Boolean(shown && shown.querySelector("article.article"));
    // "Opening post…" has no article yet. A cached card does, with a pending
    // comment list. Either one still needs the discussion.
    const pendingNow = !articleShown || htmlHasPendingComments(shown.innerHTML);
    const finishAnchor = (commentsReady) => {
      requestAnimationFrame(() => {
        if (!postStill(gen, a, p)) return;
        settlePostAnchor(options, commentsReady);
      });
    };
    if (!pendingNow) {
      finishAnchor(true);
      return;
    }

    try {
      const discussionPromise = HiveApi.getDiscussion(a, p, observer());
      if (!useSnap && !activeArticle()) {
        const cachedNow = findLoadedPost(a, p);
        if (cachedNow && (cachedNow.title || cachedNow.body)) {
          markdownReady.then(() => {
            if (!postStill(gen, a, p) || activeArticle()) return;
            paintArticle(cachedNow, {
              commentCount: Number(cachedNow.children) || 0,
              commentsHtml: commentsPendingHtml(),
            });
          }, () => {});
        }
      }
      const discussion = await discussionPromise;
      if (!postStill(gen, a, p)) return;
      setNodeLabel();
      const root = buildCommentTree(discussion, a, p);
      if (!root) {
        if (!activeArticle()) {
          currentPost = null;
          setPageMeta("Not found — CyberSpace77");
          paintPostMessage(notFoundHtml("This post could not be found on Hive."));
        } else {
          fillCommentList(commentsErrorHtml("Couldn't load comments."));
        }
        return;
      }
      clearError();
      const prev = currentPost;
      currentPost = root;
      rememberContent(root);
      const count = discussionCommentCount(discussion, root);
      try {
        await markdownReady;
      } catch {
        // renderMarkdown escapes the source when the CDN scripts fail.
      }
      if (!postStill(gen, a, p)) return;
      const commentsHtml = renderedCommentsHtml(root);
      const article = activeArticle();
      if (!article) {
        paintArticle(root, { commentCount: count, commentsHtml });
      } else {
        patchOpenArticle(prev, root);
        setCommentCount(count);
        fillCommentList(commentsHtml);
      }
      finishAnchor(true);
    } catch (err) {
      if (!postStill(gen, a, p)) return;
      const msg = err.message || String(err);
      if (!activeArticle()) {
        currentPost = null;
        setPageMeta("Not found — CyberSpace77");
        paintPostMessage(notFoundHtml(msg || "Could not load this post."));
      } else {
        fillCommentList(commentsErrorHtml(msg));
      }
    }
  }

  /* ─── Profile ─── */
  function resetProfileState() {
    profileState.author = "";
    profileState.page = "posts";
    profileState.profile = null;
    profileState.followed = false;
    profileState.muted = false;
    profileState.pending = false;
    profileState.mutePending = false;
    profileState.claimPending = false;
    claimAnimToken += 1;
    profileState.wallet = null;
    profileState.walletTx = null;
    closePeoplePanel();
    clearDelegationView();
    closeDelegateOverlay();
  }

  function profileFollowed(profile) {
    const ctx = profile && profile.context;
    if (!ctx || typeof ctx !== "object") return false;
    return Boolean(ctx.followed || ctx.follow);
  }

  function profileFollowLabel() {
    if (profileState.pending) {
      return profileState.followed ? "Unfollowing…" : "Following…";
    }
    return profileState.followed ? "Unfollow" : "Follow";
  }

  function profileMuted(profile) {
    const ctx = profile && profile.context;
    if (!ctx || typeof ctx !== "object") return false;
    return Boolean(ctx.muted);
  }

  function profileMuteLabel() {
    if (profileState.mutePending) return profileState.muted ? "Unmuting…" : "Muting…";
    return profileState.muted ? "Unmute" : "Mute";
  }

  function blockExplorerAccountUrl(name) {
    const account = String(name || "")
      .replace(/^@/, "")
      .trim()
      .toLowerCase();
    return BLOCK_EXPLORER + "@" + account;
  }

  function blockExplorerContentUrl(author, permlink) {
    const name = String(author || "")
      .replace(/^@/, "")
      .trim()
      .toLowerCase();
    const link = String(permlink || "").trim();
    return BLOCK_EXPLORER + "@" + name + "/" + link;
  }

  function profileMoreMenuHtml(author) {
    const items = [];
    if (isOwnAuthor(author)) {
      items.push(
        `<a class="profile-more-item" role="menuitem" href="${HiveMd.escapeHtml(appHref("/settings/profile"))}">Edit</a>`
      );
    } else {
      const disabled = profileState.mutePending || profileState.pending ? " disabled" : "";
      items.push(
        `<button type="button" class="profile-more-item profile-mute-btn" role="menuitem" data-author="${HiveMd.escapeHtml(author)}"${disabled}>${profileMuteLabel()}</button>`
      );
    }
    items.push(
      `<a class="profile-more-item" role="menuitem" href="${HiveMd.escapeHtml(blockExplorerAccountUrl(author))}" target="_blank" rel="noopener noreferrer">Block Explorer</a>`
    );
    return items.join("");
  }

  function profileMoreHtml(author) {
    return `
      <div class="profile-more">
        <button type="button" class="profile-more-btn" aria-label="More actions" aria-haspopup="menu" aria-expanded="false">\u00b7\u00b7\u00b7</button>
        <div class="profile-more-menu" role="menu" hidden>
          ${profileMoreMenuHtml(author)}
        </div>
      </div>`;
  }

  function clearAnchoredMenuStyle(menu) {
    menu.style.position = "";
    menu.style.top = "";
    menu.style.left = "";
    menu.style.right = "";
    menu.style.zIndex = "";
    menu.style.maxHeight = "";
    menu.style.maxWidth = "";
    menu.style.overflowX = "";
    menu.style.overflowY = "";
    menu.style.overscrollBehavior = "";
  }

  function closeProfileMore() {
    const root = view.querySelector(".profile-more.is-open");
    const menu =
      document.querySelector("body > .profile-more-menu") ||
      (root && root.querySelector(".profile-more-menu"));
    if (root) {
      root.classList.remove("is-open");
      const btn = root.querySelector(".profile-more-btn");
      if (btn) btn.setAttribute("aria-expanded", "false");
    }
    if (!menu) return;
    menu.hidden = true;
    clearAnchoredMenuStyle(menu);
    if (root && menu.parentNode !== root) root.appendChild(menu);
    else if (!root && menu.parentNode === document.body) menu.remove();
  }

  function placeAnchoredMenu(anchor, menu, closeMenu) {
    if (!anchor || !menu || menu.hidden) return;
    if (!anchor.isConnected) {
      closeMenu();
      return;
    }
    const rect = anchor.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) {
      closeMenu();
      return;
    }
    const scrollTop = menu.scrollTop;
    menu.style.position = "fixed";
    menu.style.zIndex = "70";
    menu.style.right = "auto";
    menu.style.maxWidth = Math.max(120, window.innerWidth - 16) + "px";
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const spaceAbove = rect.top - 12;
    const contentH = menu.scrollHeight;
    const placeAbove = contentH > spaceBelow && spaceAbove > spaceBelow;
    const maxH = Math.max(80, Math.round(placeAbove ? spaceAbove : spaceBelow));
    menu.style.maxHeight = maxH + "px";
    menu.style.overflowY = contentH > maxH ? "auto" : "";
    menu.style.overscrollBehavior = contentH > maxH ? "contain" : "";
    menu.style.left = Math.round(rect.left) + "px";
    if (placeAbove) {
      menu.style.top = Math.max(8, Math.round(rect.top - Math.min(contentH, maxH) - 8)) + "px";
    } else {
      menu.style.top = Math.round(rect.bottom + 8) + "px";
    }
    let box = menu.getBoundingClientRect();
    const maxRight = window.innerWidth - 8;
    if (box.right > maxRight) {
      menu.style.left = Math.max(8, Math.round(maxRight - box.width)) + "px";
      box = menu.getBoundingClientRect();
    }
    if (box.left < 8) {
      menu.style.left = "8px";
      box = menu.getBoundingClientRect();
    }
    if (box.right > maxRight) {
      menu.style.maxWidth = Math.max(80, Math.round(maxRight - 8)) + "px";
      menu.style.overflowX = "auto";
    }
    if (menu.scrollTop !== scrollTop) menu.scrollTop = scrollTop;
  }

  function placeProfileMore(anchor, menu) {
    placeAnchoredMenu(anchor, menu, closeProfileMore);
  }

  function closeContentMore() {
    const root = document.querySelector(".content-more.is-open");
    const menu =
      document.querySelector("body > .content-more-menu") ||
      (root && root.querySelector(".content-more-menu"));
    if (root) {
      root.classList.remove("is-open");
      const btn = root.querySelector(".content-more-btn");
      if (btn) btn.setAttribute("aria-expanded", "false");
    }
    if (!menu) return;
    menu.hidden = true;
    clearAnchoredMenuStyle(menu);
    if (root && menu.parentNode !== root) root.appendChild(menu);
    else if (!root && menu.parentNode === document.body) menu.remove();
  }

  function toggleContentMore(btn) {
    const root = btn && btn.closest(".content-more");
    if (!root) return;
    const willOpen = !root.classList.contains("is-open");
    closeContentMore();
    closeProfileMore();
    if (!willOpen) return;
    const menu = root.querySelector(".content-more-menu");
    if (!menu) return;
    root.classList.add("is-open");
    btn.setAttribute("aria-expanded", "true");
    document.body.appendChild(menu);
    menu.hidden = false;
    placeAnchoredMenu(btn, menu, closeContentMore);
  }

  function toggleProfileMore(btn) {
    const root = btn && btn.closest(".profile-more");
    if (!root) return;
    const willOpen = !root.classList.contains("is-open");
    closeProfileMore();
    closeContentMore();
    if (!willOpen) return;
    const menu = root.querySelector(".profile-more-menu");
    if (!menu) return;
    root.classList.add("is-open");
    btn.setAttribute("aria-expanded", "true");
    document.body.appendChild(menu);
    menu.hidden = false;
    placeProfileMore(btn, menu);
  }

  function profilePageTitle(author, page) {
    const a = "@" + author;
    if (page === "comments") return "Comments · " + a + " — CyberSpace77";
    if (page === "replies") return "Replies · " + a + " — CyberSpace77";
    if (page === "wallet") return "Wallet · " + a + " — CyberSpace77";
    return a + " — CyberSpace77";
  }

  function peopleCountOpen(kind, id) {
    const key = String(id || "").replace(/^@/, "").toLowerCase();
    return Boolean(peopleList.open && peopleList.kind === kind && peopleList.id === key);
  }

  function profileCountButton(author, kind, text) {
    const cls = kind === "followers" ? "profile-follower-count" : "profile-following-count";
    const id = String(author || "").replace(/^@/, "").toLowerCase();
    const active = peopleCountOpen(kind, id);
    return `<button type="button" class="${cls}${active ? " is-active" : ""}" data-people="${kind}" data-people-id="${HiveMd.escapeHtml(id)}" aria-expanded="${active ? "true" : "false"}">${text}</button>`;
  }

  function profileNavHtml(author, page) {
    const items = [
      ["posts", "Posts", profileHref(author, "posts")],
      ["comments", "Comments", profileHref(author, "comments")],
      ["replies", "Replies", profileHref(author, "replies")],
      ["wallet", "Wallet", profileHref(author, "wallet")],
    ];
    return `
      <nav class="feed-nav profile-nav" aria-label="Profile">
        ${items
          .map(
            ([id, label, href]) =>
              `<a href="${href}" class="${id === page ? "is-active" : ""}">${label}</a>`
          )
          .join("")}
      </nav>
    `;
  }

  function profileWebsiteLink(raw) {
    const text = String(raw || "").trim();
    if (!text) return null;
    let candidate = text;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(candidate)) {
      candidate = "https://" + candidate.replace(/^\/\//, "");
    }
    try {
      const url = new URL(candidate);
      if (
        (url.protocol === "http:" || url.protocol === "https:") &&
        url.hostname &&
        url.hostname.includes(".")
      ) {
        const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
        const label = url.hostname.replace(/^www\./i, "") + path;
        return { href: url.href, label: label || url.hostname };
      }
    } catch {
      return null;
    }
    return null;
  }

  function profileDetailsHtml(profile) {
    const meta =
      (profile && (profile.metadata || profile.posting_json_metadata)) || {};
    const info = meta && typeof meta.profile === "object" && meta.profile ? meta.profile : {};
    const location = String(info.location || "").trim();
    const site = profileWebsiteLink(info.website);
    const parts = [];
    if (site) {
      parts.push(
        `<p class="profile-website"><a href="${HiveMd.escapeHtml(site.href)}" target="_blank" rel="noopener noreferrer">${HiveMd.escapeHtml(site.label)}</a></p>`
      );
    }
    if (location) parts.push(`<p class="profile-location">${HiveMd.escapeHtml(location)}</p>`);
    return parts.join("");
  }

  function formatProfileHp(amount) {
    if (amount == null || amount === "") return "";
    const n = Number(amount);
    if (!Number.isFinite(n)) return "";
    const rounded = Math.max(0, Math.round(n));
    if (rounded >= 100000) {
      if (rounded >= 999500) {
        const millions = Math.round((rounded / 1000000) * 10) / 10;
        const text = Number.isInteger(millions) ? String(millions) : millions.toFixed(1);
        return "HP " + text + "M";
      }
      return "HP " + Math.round(rounded / 1000) + "K";
    }
    return "HP " + formatGroupedNumber(rounded, 0);
  }

  function profileBannerHtml(author, profile, hivePower) {
    const meta =
      (profile && (profile.metadata || profile.posting_json_metadata)) || {};
    const info = meta && typeof meta.profile === "object" && meta.profile ? meta.profile : {};
    const profileImage = String(
      (info && info.profile_image) || (profile && profile.profile_image) || ""
    ).trim();
    const avatarSrc = avatarSrcFromImage(author, profileImage, "large");
    const about = profileAboutText(profile);
    const display =
      (info && info.name) || (profile && profile.name) || author;
    const stats = (profile && profile.stats) || {};
    const statsPending = Boolean(profile && profile.statsPending);
    const posts = Number((profile && profile.post_count) || stats.post_count || 0);
    const followers = Number(stats.followers || 0);
    const following = Number(stats.following || 0);
    const followerText = statsPending ? "… followers" : followers + " followers";
    const followingText = statsPending ? "… following" : following + " following";
    const hp = formatProfileHp(hivePower);
    const rep = Math.floor(
      HiveMd.displayReputation((profile && profile.reputation) || 0)
    );
    const href = HiveMd.escapeHtml(profileHref(author, "posts"));
    const own = isOwnAuthor(author);
    const followBusy = profileState.pending || profileState.mutePending;
    const followBtn = own
      ? ""
      : `<button type="button" class="btn-primary btn-compact profile-follow-btn" data-author="${HiveMd.escapeHtml(author)}" data-followed="${profileState.followed ? "1" : "0"}"${followBusy ? " disabled" : ""}>${profileFollowLabel()}</button>`;
    const handle = `<p class="profile-handle"><a href="${href}">@${HiveMd.escapeHtml(author)}</a> · <span class="profile-rep">${rep}</span></p>`;
    const title = own
      ? `<div class="profile-title-line"><h1>${HiveMd.escapeHtml(display)}</h1>${profileMoreHtml(author)}</div>`
      : `<h1>${HiveMd.escapeHtml(display)}</h1>`;
    const actions = own
      ? ""
      : `<div class="profile-head-actions">${followBtn}${profileMoreHtml(author)}</div>`;
    return `
      <div class="profile-banner">
        <div class="profile-head">
          <img class="avatar" src="${avatarSrc}" alt="">
          <div>
            ${title}
            ${handle}
            ${about ? `<p class="profile-about">${HiveMd.escapeHtml(about)}</p>` : ""}
            ${profileDetailsHtml(profile)}
            <div class="profile-stats">
              <span class="profile-post-count">${posts} posts</span>
              ${profileCountButton(author, "followers", followerText)}
              ${profileCountButton(author, "following", followingText)}
              ${hp ? `<span class="profile-hp">${HiveMd.escapeHtml(hp)}</span>` : ""}
              ${profileJoinedHtml(profile && profile.created)}
            </div>
            ${actions}
          </div>
        </div>
      </div>
    `;
  }

  function paintProfileChrome() {
    const btn = view.querySelector(".profile-follow-btn");
    if (btn) {
      btn.disabled = profileState.pending || profileState.mutePending;
      btn.textContent = profileFollowLabel();
      btn.setAttribute("data-followed", profileState.followed ? "1" : "0");
      btn.classList.toggle("is-joined", profileState.followed);
    }
    const muteBtn = view.querySelector(".profile-mute-btn");
    if (muteBtn) {
      muteBtn.disabled = profileState.mutePending || profileState.pending;
      muteBtn.textContent = profileMuteLabel();
    }
    const profile = profileState.profile;
    const stats = profile && profile.stats;
    if (!profile || !stats || profile.statsPending) return;
    const count = view.querySelector(".profile-follower-count");
    if (count) count.textContent = Number(stats.followers || 0) + " followers";
    const following = view.querySelector(".profile-following-count");
    if (following) following.textContent = Number(stats.following || 0) + " following";
  }

  function applyOwnProfileSocial(bridge) {
    if (!bridge || !accountState.loaded || accountState.user !== profileState.author) return;
    const stats = bridge.stats || {};
    accountState.social = {
      followers: Number(stats.followers) || 0,
      following: Number(stats.following) || 0,
      followed: profileFollowed(bridge),
    };
    const profile = profileState.profile;
    if (!profile) return;
    if (!profile.stats) profile.stats = {};
    profile.stats.followers = accountState.social.followers;
    profile.stats.following = accountState.social.following;
    profile.statsPending = false;
    if (!profile.context) profile.context = {};
    profile.context.followed = accountState.social.followed;
    // get_accounts reputation is 0. Prefer the raw score already stored on
    // the account; otherwise use the display score from the profile API.
    const raw = accountState.account && accountState.account.reputation;
    const rawNumber = Number(raw);
    if ((!Number.isFinite(rawNumber) || rawNumber === 0) && bridge.reputation != null && bridge.reputation !== "") {
      if (accountState.account) accountState.account.reputation = bridge.reputation;
      profile.reputation = bridge.reputation;
    }
    paintProfileChrome();
    paintProfileRep();
  }

  function syncOwnProfileBanner() {
    if (!accountState.loaded || profileState.author !== accountState.user) return;
    const profile = profileState.profile;
    const account = accountState.account;
    if (!profile || !account) return;
    const metadata = accountState.metadata || metadataFromAccount(account);
    profile.metadata = metadata;
    profile.profile_image = accountState.profileImage || "";
    profile.reputation = account.reputation;
    profile.created = account.created;
    profile.post_count = account.post_count;
    if (profile.stats) profile.stats.post_count = Number(account.post_count) || 0;
    const banner = view.querySelector(".profile-banner");
    if (!banner) return;
    const img = banner.querySelector(".profile-head .avatar");
    if (img) {
      const src = avatarSrcFromImage(accountState.user, accountState.profileImage || "", "large");
      if (img.getAttribute("src") !== src) img.setAttribute("src", src);
    }
    const info = metadata && metadata.profile;
    const display = (info && info.name) || account.name || accountState.user;
    const heading = banner.querySelector("h1");
    if (heading && display) heading.textContent = display;
    const about = String((info && info.about) || "").trim();
    const aboutEl = banner.querySelector(".profile-about");
    if (aboutEl) aboutEl.textContent = about;
    if (!postLayer.open && parseRoute().name === "profile" && profileState.author) {
      setProfileMeta(profileState.author, profileState.page, profile);
    }
    const postsEl = banner.querySelector(".profile-post-count");
    if (postsEl) postsEl.textContent = (Number(account.post_count) || 0) + " posts";
    const hpText = formatProfileHp(hivePowerFromAccount(account, accountState.props));
    const hpEl = banner.querySelector(".profile-hp");
    if (hpEl && hpText) hpEl.textContent = hpText;
    paintProfileRep();
  }

  function paintProfileRep() {
    const el = view.querySelector(".profile-banner .profile-rep");
    const profile = profileState.profile;
    if (!el || !profile) return;
    el.textContent = String(Math.floor(HiveMd.displayReputation(profile.reputation || 0)));
  }

  function profileCardHtml(post) {
    if (isRootPost(cardDisplayPost(post))) return cardHtml(post);
    const rootTitle = String((post && (post.root_title || post.title)) || "").trim();
    const title = rootTitle
      ? String((post && post.title) || "").trim() || "RE: " + rootTitle
      : String((post && post.title) || "").trim() || "Comment";
    return cardHtml(Object.assign({}, post, { title }));
  }

  function toggleProfileFollow() {
    const user = observer();
    const name = profileState.author;
    if (!name) return;
    if (isOwnAuthor(name)) return;
    if (!user) {
      openLogin();
      return;
    }
    if (!hasSigner(user)) {
      showError(signerNeededMessage());
      return;
    }
    if (profileState.pending) return;
    const follow = !profileState.followed;
    profileState.pending = true;
    paintProfileChrome();
    const { promise } = ChainQueue.enqueue({
      username: user,
      key: "Posting",
      operations: [
        [
          "custom_json",
          {
            required_auths: [],
            required_posting_auths: [user],
            id: "follow",
            json: JSON.stringify([
              "follow",
              {
                follower: user,
                following: name,
                what: follow ? ["blog"] : [],
              },
            ]),
          },
        ],
      ],
      meta: { type: "follow", action: follow ? "follow" : "unfollow", following: name },
    });
    promise
      .then(() => {
        if (profileState.author !== name) return;
        profileState.followed = follow;
        if (follow) profileState.muted = false;
        if (profileState.profile) {
          if (!profileState.profile.stats) profileState.profile.stats = {};
          const n = Number(profileState.profile.stats.followers || 0);
          profileState.profile.stats.followers = Math.max(0, n + (follow ? 1 : -1));
          if (!profileState.profile.context) profileState.profile.context = {};
          profileState.profile.context.followed = follow;
          if (follow) profileState.profile.context.muted = false;
        }
        paintProfileChrome();
      })
      .catch((err) => {
        if (profileState.author !== name) return;
        showError(err.message || String(err));
      })
      .finally(() => {
        if (profileState.author !== name) return;
        profileState.pending = false;
        paintProfileChrome();
      });
  }

  function toggleProfileMute() {
    const user = observer();
    const name = profileState.author;
    if (!name || isOwnAuthor(name)) return;
    if (!user) {
      openLogin();
      return;
    }
    if (!hasSigner(user)) {
      showError(signerNeededMessage());
      return;
    }
    if (profileState.pending || profileState.mutePending) return;
    const mute = !profileState.muted;
    const wasFollowed = profileState.followed;
    profileState.mutePending = true;
    paintProfileChrome();
    const { promise } = ChainQueue.enqueue({
      username: user,
      key: "Posting",
      operations: [
        [
          "custom_json",
          {
            required_auths: [],
            required_posting_auths: [user],
            id: "follow",
            json: JSON.stringify([
              "follow",
              {
                follower: user,
                following: name,
                what: mute ? ["ignore"] : [],
              },
            ]),
          },
        ],
      ],
      meta: { type: "follow", action: mute ? "mute" : "unmute", following: name },
    });
    promise
      .then(() => {
        if (profileState.author !== name) return;
        profileState.muted = mute;
        if (mute && wasFollowed) profileState.followed = false;
        if (profileState.profile) {
          if (!profileState.profile.context) profileState.profile.context = {};
          profileState.profile.context.muted = mute;
          if (mute && wasFollowed) {
            profileState.profile.context.followed = false;
            if (!profileState.profile.stats) profileState.profile.stats = {};
            const n = Number(profileState.profile.stats.followers || 0);
            profileState.profile.stats.followers = Math.max(0, n - 1);
          }
        }
        paintProfileChrome();
      })
      .catch((err) => {
        if (profileState.author !== name) return;
        showError(err.message || String(err));
      })
      .finally(() => {
        if (profileState.author !== name) return;
        profileState.mutePending = false;
        paintProfileChrome();
      });
  }

  function formatGroupedNumber(amount, decimals) {
    const n = Number(amount);
    const x = Number.isFinite(n) ? n : 0;
    const d = decimals == null ? 3 : decimals;
    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    }).format(x);
  }

  function formatLowerAsset(amount, symbol) {
    const dec = symbol === "vests" ? 6 : 3;
    return formatGroupedNumber(amount, dec) + " " + symbol;
  }

  function formatHiveLike(amount, symbol) {
    return formatLowerAsset(amount, symbol);
  }

  function parseAmountInput(raw) {
    const s = String(raw || "")
      .trim()
      .replace(",", ".");
    const n = Number(s);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return n;
  }

  function roundAsset(n, decimals) {
    const f = Math.pow(10, decimals);
    return Math.round((Number(n) || 0) * f) / f;
  }

  function formatChainAmount(n, symbol, decimals) {
    const d = decimals == null ? 3 : decimals;
    return roundAsset(n, d).toFixed(d) + " " + symbol;
  }

  function chainAssetToLower(val, props) {
    const s = String(val || "").trim();
    if (!s) return "";
    const m = s.match(/(-?[\d.]+)\s*([A-Za-z]+)/);
    if (!m) {
      const n = HiveApi.parseAsset(s);
      return n ? n.toFixed(3) : "";
    }
    const amount = Number(m[1]);
    const sym = String(m[2] || "").toUpperCase();
    if (!Number.isFinite(amount)) return "";
    if (sym === "VESTS") {
      const hive = HiveApi.vestsToHive(amount, props);
      return formatHiveLike(hive, "hp");
    }
    if (sym === "HIVE" || sym === "TESTS") return formatHiveLike(amount, "hive");
    if (sym === "HBD" || sym === "TBD") return formatHiveLike(amount, "hbd");
    return formatHiveLike(amount, String(m[2] || "").toLowerCase());
  }

  function walletHasRewards(wallet) {
    if (!wallet) return false;
    return wallet.rewardHive > 0 || wallet.rewardHbd > 0 || wallet.rewardVests > 0;
  }

  // Keep these names aligned with WALLET_HISTORY_OP_IDS in api.js.
  const WALLET_TX_TYPES = {
    transfer: "transfer",
    transfer_to_vesting: "staked hive",
    withdraw_vesting: "unstake hive",
    fill_vesting_withdraw: "unstake paid",
    transfer_to_savings: "staked",
    transfer_from_savings: "unstake requested",
    fill_transfer_from_savings: "unstake paid",
    claim_reward_balance: "claimed rewards",
    delegate_vesting_shares: "delegation",
    //author_reward: "author reward",
    //curation_reward: "curation reward",
    //comment_benefactor_reward: "benefactor reward",
    interest: "hbd interest",
  };

  function walletTxAmounts(type, payload, props) {
    if (!payload) return "";
    const parts = [];
    function push(val) {
      const t = chainAssetToLower(val, props);
      if (t) parts.push(t);
    }
    if (type === "transfer" || type === "transfer_to_vesting" || type === "transfer_to_savings" || type === "transfer_from_savings" || type === "fill_transfer_from_savings") {
      push(payload.amount);
    } else if (type === "withdraw_vesting") {
      push(payload.vesting_shares);
    } else if (type === "fill_vesting_withdraw") {
      push(payload.deposited || payload.withdrawn);
    } else if (type === "claim_reward_balance") {
      push(payload.reward_hive);
      push(payload.reward_hbd);
      push(payload.reward_vests);
    } else if (type === "delegate_vesting_shares") {
      push(payload.vesting_shares);
    } else if (type === "author_reward" || type === "comment_benefactor_reward") {
      push(payload.hive_payout);
      push(payload.hbd_payout);
      push(payload.vesting_payout);
    } else if (type === "curation_reward") {
      push(payload.reward);
    } else if (type === "interest") {
      push(payload.interest);
    }
    return parts.filter(Boolean).join(" · ");
  }

  function walletHiveName(name) {
    const raw = String(name || "")
      .trim()
      .replace(/^@/, "");
    if (raw.length < 3 || raw.length > 16) return "";
    if (!/^[a-z][a-z0-9.-]*[a-z0-9]$/i.test(raw)) return "";
    return raw.toLowerCase();
  }

  function walletSameAccount(a, b) {
    const left = walletHiveName(a) || String(a || "").trim().toLowerCase();
    const right = walletHiveName(b) || String(b || "").trim().toLowerCase();
    return Boolean(left) && left === right;
  }

  // `at` keeps the memo's own @ character and spelling. Chain fields use the canonical name.
  function walletAccountHtml(name, at) {
    const raw = String(name || "")
      .trim()
      .replace(/^@/, "");
    if (!raw) return "";
    const user = walletHiveName(raw);
    const mark = at || "@";
    if (!user) return HiveMd.escapeHtml(mark + raw);
    const href = HiveMd.escapeHtml(profileHref(user));
    const label = at ? raw : user;
    return `<a class="mention" href="${href}">${HiveMd.escapeHtml(mark + label)}</a>`;
  }

  function walletAccountPair(left, right) {
    const a = walletAccountHtml(left);
    const b = walletAccountHtml(right);
    if (a && b) return a + " → " + b;
    return a || b;
  }

  function walletOtherAccount(payload) {
    if (!payload || payload.to == null || payload.to === "") return "";
    if (walletSameAccount(payload.to, payload.from)) return "";
    return walletAccountHtml(payload.to);
  }

  function walletMemoPermlink(s, index) {
    if (s.charAt(index) !== "/") return "";
    const m = /^[a-z0-9](?:[a-z0-9-]{0,254}[a-z0-9])?/i.exec(s.slice(index + 1));
    if (!m) return "";
    const perm = m[0];
    const next = s.charAt(index + 1 + perm.length);
    if (next && /[a-z0-9_-]/i.test(next)) return "";
    return perm;
  }

  function walletPostHtml(name, permlink, at) {
    const user = walletHiveName(name);
    const perm = String(permlink || "");
    if (!user || !perm) return walletAccountHtml(name, at);
    const href = HiveMd.escapeHtml(appHref("/@" + user + "/" + perm.toLowerCase()));
    const mark = at || "@";
    const raw = String(name || "")
      .trim()
      .replace(/^@/, "");
    return `<a class="mention" href="${href}">${HiveMd.escapeHtml(mark + raw + "/" + perm)}</a>`;
  }

  function walletMemoEncrypted(text) {
    return String(text || "").charAt(0) === "#";
  }

  function walletMemoDisplay(text) {
    const s = String(text || "");
    return s.charAt(0) === "#" ? s.slice(1) : s;
  }

  function walletMemoLockSvg(open) {
    const shackle = open
      ? '<path d="M5.2 6.15V4.15a2.8 2.8 0 0 1 5.6 0" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>'
      : '<path d="M5.2 7.1V5.05a2.8 2.8 0 0 1 5.6 0V7.1" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>';
    return (
      '<svg class="wallet-memo-lock' +
      (open ? " wallet-memo-lock-open" : "") +
      '" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">' +
      '<rect x="3.15" y="7.1" width="9.7" height="6.4" rx="1.3" fill="none" stroke="currentColor" stroke-width="1.4"/>' +
      shackle +
      "</svg>"
    );
  }

  function walletMemoRevealedHtml(plain) {
    return (
      '<span class="wallet-tx-memo wallet-tx-memo-open">' +
      walletMemoLockSvg(true) +
      '<span class="wallet-memo-cipher">' +
      walletMemoHtml(plain) +
      "</span></span>"
    );
  }

  function walletMemoHtml(text) {
    const s = String(text || "");
    if (!s) return "";
    let out = "";
    let i = 0;
    while (i < s.length) {
      const at = s.charAt(i);
      const prev = i > 0 ? s.charAt(i - 1) : "";
      const boundary = !prev || !/[a-zA-Z0-9@＠/]/.test(prev);
      if ((at === "@" || at === "＠") && boundary) {
        const m = /^([a-z][a-z0-9.\-]*[a-z0-9])/i.exec(s.slice(i + 1));
        if (m && walletHiveName(m[1])) {
          const perm = walletMemoPermlink(s, i + 1 + m[1].length);
          if (perm) {
            out += walletPostHtml(m[1], perm, at);
            i += 1 + m[1].length + 1 + perm.length;
            continue;
          }
          out += walletAccountHtml(m[1], at);
          i += 1 + m[1].length;
          continue;
        }
      }
      const next = s.slice(i + 1).search(/[@＠]/);
      const end = next < 0 ? s.length : i + 1 + next;
      out += HiveMd.escapeHtml(s.slice(i, end));
      i = end;
    }
    return out;
  }

  function walletTxDetail(type, payload) {
    if (!payload) return "";
    if (type === "transfer") return walletAccountPair(payload.from, payload.to);
    if (type === "transfer_to_vesting") {
      const who = walletOtherAccount(payload);
      return who ? "staked hive for " + who : "staked hive";
    }
    if (type === "withdraw_vesting") return "power down";
    if (type === "fill_vesting_withdraw") {
      return walletAccountPair(payload.from_account, payload.to_account);
    }
    if (
      type === "transfer_to_savings" ||
      type === "transfer_from_savings" ||
      type === "fill_transfer_from_savings"
    ) {
      const unit = /hbd/i.test(String(payload.amount || "")) ? "hbd" : "hive";
      const verb = type === "transfer_to_savings" ? "staked" : "unstake";
      const who = walletOtherAccount(payload);
      if (!who) return verb + " " + unit;
      return type === "transfer_to_savings" ? verb + " " + unit + " for " + who : verb + " " + unit + " to " + who;
    }
    if (type === "delegate_vesting_shares") {
      return walletAccountPair(payload.delegator, payload.delegatee);
    }
    if (type === "author_reward") {
      return payload.permlink ? HiveMd.escapeHtml(String(payload.permlink)) : "";
    }
    if (type === "curation_reward") {
      return payload.comment_author ? walletAccountHtml(payload.comment_author) : "";
    }
    if (type === "claim_reward_balance") return "pending rewards claimed";
    return "";
  }

  function walletTxMemo(type, payload) {
    if (
      type !== "transfer" &&
      type !== "transfer_to_savings" &&
      type !== "transfer_from_savings" &&
      type !== "fill_transfer_from_savings"
    ) {
      return "";
    }
    return String((payload && payload.memo) || "").trim();
  }

  function walletTxMemoHtml(type, payload) {
    const raw = walletTxMemo(type, payload);
    if (!raw) return "";
    if (!walletMemoEncrypted(raw)) {
      return `<span class="wallet-tx-memo">${walletMemoHtml(raw)}</span>`;
    }
    if (walletMemoPlain.has(raw)) {
      const plain = walletMemoPlain.get(raw);
      if (!plain) return "";
      return walletMemoRevealedHtml(plain);
    }
    const to = HiveMd.escapeHtml(String((payload && payload.to) || ""));
    const from = HiveMd.escapeHtml(String((payload && payload.from) || ""));
    return (
      `<button type="button" class="wallet-tx-memo wallet-tx-memo-locked" data-memo="${HiveMd.escapeHtml(raw)}" data-memo-to="${to}" data-memo-from="${from}" aria-label="Decrypt memo">` +
      walletMemoLockSvg() +
      `<span class="wallet-memo-cipher">${HiveMd.escapeHtml(raw)}</span>` +
      "</button>"
    );
  }

  function walletTxUrl(rec) {
    const id = String((rec && rec.trx_id) || "")
      .trim()
      .toLowerCase();
    if (!/^[0-9a-f]{40}$/.test(id) || /^0+$/.test(id)) return "";
    return BLOCK_EXPLORER + "tx/" + id;
  }

  const WALLET_TX_PAGE = 30;

  function blankWalletTx() {
    return {
      items: [],
      cursor: -1,
      done: false,
      loading: false,
      started: false,
      error: "",
      holdAuto: false,
      seen: new Set(),
      pageGoal: WALLET_TX_PAGE,
    };
  }

  function historyRowIndex(rec) {
    const idx = Array.isArray(rec) ? Number(rec[0]) : NaN;
    return Number.isFinite(idx) ? idx : NaN;
  }

  function consumeWalletHistoryBatch(tx, batch) {
    if (!batch.length) {
      tx.done = true;
      return;
    }
    let oldest = NaN;
    for (let i = 0; i < batch.length; i++) {
      const idx = historyRowIndex(batch[i]);
      if (!Number.isFinite(idx)) continue;
      if (!Number.isFinite(oldest) || idx < oldest) oldest = idx;
    }
    let stopAt = NaN;
    for (let j = batch.length - 1; j >= 0; j--) {
      const rec = batch[j];
      const idx = historyRowIndex(rec);
      if (!Number.isFinite(idx) || tx.seen.has(idx)) continue;
      tx.seen.add(idx);
      const op = rec[1] && rec[1].op;
      const type = Array.isArray(op) ? String(op[0] || "") : "";
      if (WALLET_TX_TYPES[type]) tx.items.push(rec);
      if (tx.items.length >= tx.pageGoal) {
        stopAt = idx;
        break;
      }
    }
    const reachedOldest = Number.isFinite(stopAt) && stopAt === oldest;
    if (Number.isFinite(stopAt)) {
      if (stopAt <= 0 || (reachedOldest && batch.length < WALLET_TX_PAGE)) {
        tx.done = true;
      } else {
        tx.cursor = stopAt - 1;
      }
      return;
    }
    if (!Number.isFinite(oldest) || oldest <= 0 || batch.length < WALLET_TX_PAGE) {
      tx.done = true;
      return;
    }
    tx.cursor = oldest - 1;
  }

  async function appendWalletHistory(account, tx) {
    if (tx.done || profileState.walletTx !== tx) return;
    tx.pageGoal = tx.items.length + WALLET_TX_PAGE;
    const batch = await HiveApi.getWalletHistory(account, tx.cursor, WALLET_TX_PAGE);
    if (profileState.walletTx !== tx) return;
    consumeWalletHistoryBatch(tx, batch);
  }

  function walletHistoryHtml(tx, props) {
    const state = tx || blankWalletTx();
    const rows = (state.items || []).map((row) => walletTxHtml(row, props)).filter(Boolean);
    let body = "";
    if (rows.length) {
      body = `<div class="wallet-tx-list">${rows.join("")}</div>`;
    } else if (state.started && !state.loading && state.error) {
      body = `<div class="panel empty-state"><h2>Transactions unavailable</h2><p>${HiveMd.escapeHtml(state.error)}</p></div>`;
    } else if (state.started && !state.loading && state.done) {
      body = `<div class="panel empty-state"><h2>No recent transactions</h2><p>Wallet activity for this account will show up here.</p></div>`;
    }
    const note =
      rows.length && state.error && !state.loading
        ? `<p class="wallet-note">${HiveMd.escapeHtml(state.error)}</p>`
        : "";
    const loading =
      !state.started || state.loading
        ? `<div class="wallet-tx-status"><span class="btn-loader" aria-hidden="true"></span> Loading…</div>`
        : "";
    const more =
      state.started && !state.done && !state.loading && state.holdAuto
        ? `<div class="feed-actions"><button type="button" class="btn-primary" id="walletMoreBtn">Load more</button></div>`
        : "";
    return body + note + loading + more;
  }

  function paintWalletHistory() {
    const el = $("#walletTxBody");
    if (!el) return;
    const props = profileState.wallet && profileState.wallet.props;
    el.innerHTML = walletHistoryHtml(profileState.walletTx, props);
  }

  // Same lead and margin as the feed. Load more stays for a page that fails
  // or adds nothing, and scrolling does not retry until that button is used.
  function walletTailNearView() {
    const list = document.querySelector("#walletTxBody .wallet-tx-list");
    if (!list) return false;
    const items = list.querySelectorAll(".wallet-tx");
    if (!items.length) return false;
    const tail = items[Math.max(0, items.length - FEED_INFINITE_LEAD)];
    const rect = tail.getBoundingClientRect();
    if (rect.height < 1) return false;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    return rect.top <= vh + FEED_INFINITE_MARGIN;
  }

  function maybeLoadMoreWallet() {
    const tx = profileState.walletTx;
    if (!tx || tx.holdAuto || tx.loading || tx.done || !tx.started) return;
    if (!walletTailNearView()) return;
    loadMoreWalletHistory();
  }

  async function loadMoreWalletHistory() {
    const tx = profileState.walletTx;
    const name = profileState.author;
    const tab = profileState.page;
    if (!tx || tx.loading || tx.done || !name) return;
    const before = tx.items.length;
    tx.loading = true;
    tx.error = "";
    paintWalletHistory();
    let failed = false;
    try {
      await appendWalletHistory(name, tx);
    } catch (err) {
      if (profileState.walletTx !== tx) return;
      failed = true;
      tx.error = (err && err.message) || String(err);
    } finally {
      if (profileState.walletTx === tx) {
        tx.loading = false;
        tx.started = true;
      }
    }
    if (profileState.walletTx !== tx || !profileRouteStill(name, tab)) return;
    const stalled = !failed && !tx.done && tx.items.length === before;
    tx.holdAuto = failed || stalled;
    paintWalletHistory();
    if (!tx.holdAuto) maybeLoadMoreWallet();
  }

  function walletTxHtml(entry, props) {
    if (!Array.isArray(entry) || !entry[1]) return "";
    const rec = entry[1];
    const op = rec.op;
    if (!Array.isArray(op) || op.length < 2) return "";
    const type = String(op[0] || "");
    if (!WALLET_TX_TYPES[type]) return "";
    const payload = op[1] || {};
    const amount = walletTxAmounts(type, payload, props);
    const detail = walletTxDetail(type, payload);
    const memo = walletTxMemoHtml(type, payload);
    const when = rec.timestamp ? timeAgo(rec.timestamp) : "";
    const abs = rec.timestamp ? formatCreatedUtc(rec.timestamp) : "";
    const pop = abs
      ? `<span class="session-stat-tip" role="tooltip">${HiveMd.escapeHtml(abs)}</span>`
      : "";
    const txUrl = walletTxUrl(rec);
    const timeHtml = when
      ? txUrl
        ? `<a class="wallet-tx-time" href="${HiveMd.escapeHtml(txUrl)}" target="_blank" rel="noopener noreferrer">${HiveMd.escapeHtml(when)}${pop}</a>`
        : `<span class="wallet-tx-time">${HiveMd.escapeHtml(when)}${pop}</span>`
      : "";
    return `<div class="wallet-tx">
      <div class="wallet-tx-main">
        <span class="wallet-tx-type">${HiveMd.escapeHtml(WALLET_TX_TYPES[type])}</span>
        ${detail ? `<span class="wallet-tx-detail">${detail}</span>` : ""}
        ${memo || ""}
      </div>
      <div class="wallet-tx-side">
        ${amount ? `<span class="wallet-tx-amount">${HiveMd.escapeHtml(amount)}</span>` : ""}
        ${timeHtml}
      </div>
    </div>`;
  }

  // A Keychain login can decrypt memos sent to that account without typing the key.
  function keychainLoginActive() {
    const user = observer();
    if (!user || !window.hive_keychain) return "";
    if (window.HiveAuth && HiveAuth.hasKey(user)) return "";
    return readKeychainUser() === user ? user : "";
  }

  function walletMemoDialogAccount(to, from) {
    const user = observer();
    if (user && (walletSameAccount(to, user) || walletSameAccount(from, user))) return user;
    const page = walletHiveName(profileState.author);
    if (page && (walletSameAccount(to, page) || walletSameAccount(from, page))) return page;
    return walletHiveName(to) || walletHiveName(from) || "";
  }

  // The extension object is hive_keychain. Decrypt is requestVerifyKey, which sends type "decode". There is no requestDecode on the injected API.
  function keychainCanDecodeMemo() {
    const kc = window.hive_keychain;
    if (!kc) return false;
    return typeof kc.requestVerifyKey === "function" || typeof kc.requestDecode === "function";
  }

  function requestKeychainMemoDecode(username, cipher) {
    return new Promise((resolve, reject) => {
      const kc = window.hive_keychain;
      const done = (res) => {
        if (res && res.success && typeof res.result === "string") resolve(res.result);
        else reject(new Error((res && (res.message || res.error)) || "Decrypt was cancelled."));
      };
      if (kc && typeof kc.requestVerifyKey === "function") {
        kc.requestVerifyKey(username, cipher, "Memo", done);
        return;
      }
      if (kc && typeof kc.requestDecode === "function") {
        kc.requestDecode(username, cipher, "Memo", done);
        return;
      }
      reject(new Error("hive keychain is not available. Choose Password and enter the memo key."));
    });
  }

  function revealWalletMemo(cipher, decoded) {
    const plain = walletMemoDisplay(decoded).trim();
    walletMemoPlain.set(cipher, plain);
    const nodes = document.querySelectorAll(".wallet-tx-memo-locked");
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node.getAttribute("data-memo") !== cipher) continue;
      if (!plain) {
        node.remove();
        continue;
      }
      const span = document.createElement("span");
      span.className = "wallet-tx-memo wallet-tx-memo-open";
      span.innerHTML =
        walletMemoLockSvg(true) +
        '<span class="wallet-memo-cipher">' +
        walletMemoHtml(plain) +
        "</span>";
      node.replaceWith(span);
    }
  }

  async function decryptWalletMemo(btn) {
    if (walletMemoBusy || ownerSignBusy || ownerSignOpen()) return;
    const cipher = btn.getAttribute("data-memo") || "";
    if (!walletMemoEncrypted(cipher)) return;
    const to = btn.getAttribute("data-memo-to") || "";
    const from = btn.getAttribute("data-memo-from") || "";
    const keychainUser = keychainLoginActive();
    const account = walletMemoDialogAccount(to, from);
    walletMemoBusy = true;
    btn.disabled = true;
    try {
      let decoded;
      if (!account) throw new Error("Could not decrypt this memo.");
      decoded = await signWithDialog(account, [], {
        source: "memo",
        mode: "decrypt",
        memo: cipher,
        authority: "Memo",
        title: "Decrypt memo",
        action: "Decrypt",
        lead: "Use hive keychain (recommended) or enter the memo key.",
        cancelMessage: "The memo was not decrypted.",
        failMessage: "Could not decrypt this memo.",
        preferKeychain:
          Boolean(keychainUser) &&
          walletSameAccount(to, keychainUser) &&
          keychainCanDecodeMemo(),
      });
      revealWalletMemo(cipher, decoded);
    } catch (err) {
      if (!(err && err.ownerCancel)) {
        showError((err && err.message) || "Could not decrypt this memo.");
      }
    } finally {
      walletMemoBusy = false;
      if (btn.isConnected) btn.disabled = false;
    }
  }

  function walletRewardsHtml(wallet, own) {
    if (!own || !walletHasRewards(wallet)) return "";
    const rows = [];
    if (wallet.rewardHive > 0) {
      rows.push(
        `<div class="wallet-row"><span class="wallet-label">hive</span><span class="wallet-value">${HiveMd.escapeHtml(formatHiveLike(wallet.rewardHive, "hive"))}</span></div>`
      );
    }
    if (wallet.rewardHbd > 0) {
      rows.push(
        `<div class="wallet-row"><span class="wallet-label">hbd</span><span class="wallet-value">${HiveMd.escapeHtml(formatHiveLike(wallet.rewardHbd, "hbd"))}</span></div>`
      );
    }
    if (wallet.rewardVests > 0) {
      rows.push(
        `<div class="wallet-row"><span class="wallet-label">staked hive</span><span class="wallet-value">${HiveMd.escapeHtml(formatHiveLike(wallet.rewardVestingHive, "hive"))}</span></div>`
      );
    }
    return `
      <section class="wallet-section wallet-rewards">
        <h2>Pending rewards</h2>
        ${rows.join("")}
        <div class="wallet-row-actions wallet-claim-actions">
          <button type="button" class="btn-primary btn-compact wallet-claim-btn">Claim</button>
        </div>
      </section>
    `;
  }

  function formatAssetNumber(amount) {
    return formatGroupedNumber(amount, 3);
  }

  function applyClaimedRewards(wallet) {
    const hive = Number(wallet.rewardHive) || 0;
    const hbd = Number(wallet.rewardHbd) || 0;
    const staked = Number(wallet.rewardVestingHive) || 0;
    const vests = Number(wallet.rewardVests) || 0;
    wallet.hive = roundAsset((Number(wallet.hive) || 0) + hive, 3);
    wallet.hbd = roundAsset((Number(wallet.hbd) || 0) + hbd, 3);
    wallet.stakedHive = roundAsset((Number(wallet.stakedHive) || 0) + staked, 3);
    wallet.vestingShares = roundAsset((Number(wallet.vestingShares) || 0) + vests, 6);
    wallet.availableVests = Math.max(0, wallet.vestingShares - (Number(wallet.delegatedVests) || 0));
    wallet.rewardHive = 0;
    wallet.rewardHbd = 0;
    wallet.rewardVests = 0;
    wallet.rewardVestingHive = 0;
    wallet.rewardHiveStr = "0.000 HIVE";
    wallet.rewardHbdStr = "0.000 HBD";
    wallet.rewardVestsStr = "0.000000 VESTS";
    wallet.hiveStr = formatChainAmount(wallet.hive, "HIVE", 3);
    wallet.hbdStr = formatChainAmount(wallet.hbd, "HBD", 3);
    const accounts = [];
    if (wallet.account) accounts.push(wallet.account);
    if (
      accountState.account &&
      accountState.account !== wallet.account &&
      accountState.user === wallet.name
    ) {
      accounts.push(accountState.account);
    }
    for (let i = 0; i < accounts.length; i++) {
      const account = accounts[i];
      account.balance = wallet.hiveStr;
      account.hbd_balance = wallet.hbdStr;
      account.vesting_shares = formatChainAmount(wallet.vestingShares, "VESTS", 6);
      account.reward_hive_balance = "0.000 HIVE";
      account.reward_hbd_balance = "0.000 HBD";
      account.reward_vesting_balance = "0.000000 VESTS";
      account.reward_vesting_hive = "0.000 HIVE";
    }
  }

  function paintWalletBalanceAmounts(wallet) {
    const rows = view.querySelectorAll(".wallet-table tr");
    for (let i = 0; i < rows.length; i++) {
      const value = rows[i].querySelector(".wallet-value");
      const name = rows[i].getAttribute("data-balance");
      if (!value || !name) continue;
      if (name === "hive") value.textContent = formatAssetNumber(wallet.hive);
      else if (name === "staked hive") value.textContent = formatAssetNumber(wallet.stakedHive);
      else if (name === "delegated hive") value.textContent = formatAssetNumber(wallet.delegatedHive);
      else if (name === "hbd") value.textContent = formatAssetNumber(wallet.hbd);
      else if (name === "staked hbd") value.textContent = formatAssetNumber(wallet.stakedHbd);
    }
  }

  function walletBalanceTableRow(label) {
    return view.querySelector('.wallet-table tr[data-balance="' + label + '"]');
  }

  function rewardBalanceRows(wallet) {
    const labels = [];
    if ((Number(wallet.rewardHive) || 0) > 0) labels.push("hive");
    if ((Number(wallet.rewardHbd) || 0) > 0) labels.push("hbd");
    if ((Number(wallet.rewardVests) || 0) > 0) labels.push("staked hive");
    const rows = [];
    for (let i = 0; i < labels.length; i++) {
      const row = walletBalanceTableRow(labels[i]);
      if (row) rows.push(row);
    }
    return rows;
  }

  let claimAnimToken = 0;

  function claimedBalanceTargets(wallet) {
    return {
      hive: roundAsset((Number(wallet.hive) || 0) + (Number(wallet.rewardHive) || 0), 3),
      hbd: roundAsset((Number(wallet.hbd) || 0) + (Number(wallet.rewardHbd) || 0), 3),
      stakedHive: roundAsset(
        (Number(wallet.stakedHive) || 0) + (Number(wallet.rewardVestingHive) || 0),
        3
      ),
    };
  }

  function countWalletBalances(from, to, ms, token) {
    const fields = [
      ["hive", from.hive, to.hive],
      ["hbd", from.hbd, to.hbd],
      ["staked hive", from.stakedHive, to.stakedHive],
    ];
    if (ms <= 0) {
      paintWalletBalanceAmounts(to);
      return;
    }
    const started = performance.now();
    function frame(now) {
      if (token !== claimAnimToken) return;
      const t = Math.min(1, (now - started) / ms);
      const eased = t === 1 ? 1 : 1 - Math.pow(1 - t, 2);
      for (let i = 0; i < fields.length; i++) {
        const fromValue = fields[i][1];
        const toValue = fields[i][2];
        if (fromValue === toValue) continue;
        const row = walletBalanceTableRow(fields[i][0]);
        const el = row && row.querySelector(".wallet-value");
        if (!el || !el.isConnected) continue;
        el.textContent = formatAssetNumber(t === 1 ? toValue : fromValue + (toValue - fromValue) * eased);
      }
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function animateClaimRewards(wallet) {
    const token = ++claimAnimToken;
    const rewards = view.querySelector(".wallet-rewards");
    const rows = rewardBalanceRows(wallet);
    const from = {
      hive: Number(wallet.hive) || 0,
      hbd: Number(wallet.hbd) || 0,
      stakedHive: Number(wallet.stakedHive) || 0,
    };
    const targets = claimedBalanceTargets(wallet);
    if (!rewards) {
      applyClaimedRewards(wallet);
      profileState.claimPending = false;
      paintWalletBalanceAmounts(wallet);
      return;
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const countMs = reduced ? 0 : 1500;
    rewards.remove();
    for (let i = 0; i < rows.length; i++) {
      rows[i].classList.remove("is-reward-in");
      void rows[i].offsetWidth;
      rows[i].classList.add("is-reward-in");
    }
    applyClaimedRewards(wallet);
    profileState.claimPending = false;
    countWalletBalances(from, targets, countMs, token);
    window.setTimeout(() => {
      if (token !== claimAnimToken || profileState.wallet !== wallet) return;
      for (let i = 0; i < rows.length; i++) rows[i].classList.remove("is-reward-in");
      if (accountState.account && accountState.user === wallet.name) syncOwnProfileBanner();
    }, countMs + (reduced ? 0 : 240));
  }

  function formatAprPercent(rate) {
    return rate.toFixed(2);
  }

  function walletShownRates(wallet) {
    if (wallet && wallet.stakeApr) return wallet.stakeApr;
    const interest = wallet && wallet.props ? Number(wallet.props.hbd_interest_rate) : NaN;
    if (!Number.isFinite(interest) || interest < 0 || interest > 10000) return null;
    return { hbdApr: interest / 100 };
  }

  function walletAprTip(text) {
    return `<span class="session-stat-tip" role="tooltip">${HiveMd.escapeHtml(text)}</span>`;
  }

  function walletHiveAprHtml(rates) {
    if (!rates || !Number.isFinite(rates.hiveAprHigh)) return "";
    const high = formatAprPercent(rates.hiveAprHigh);
    const low = Number.isFinite(rates.hiveAprLow) ? formatAprPercent(rates.hiveAprLow) : high;
    const tip =
      "Estimated staked hive apr. Staked hive currently earns about " +
      low +
      "% annual inflation rewards, including curation rewards, the total would approx. " +
      high +
      "% if the stake would vote in proportion to all staked hive. Active curators may earn more when other stake does not vote.";
    return `<span class="wallet-apr" tabindex="0">~${high}%${walletAprTip(tip)}</span>`;
  }

  function walletHbdAprHtml(rates) {
    if (!rates || !Number.isFinite(rates.hbdApr)) return "";
    const shown = formatAprPercent(rates.hbdApr);
    return `<span class="wallet-apr" tabindex="0">${shown}%${walletAprTip("Current staked hbd apr. This rate is set by witnesses.")}</span>`;
  }

  function setWalletRowApr(row, html) {
    if (!row) return;
    const label = row.querySelector(".wallet-label");
    if (!label) return;
    const old = label.querySelector(".wallet-apr");
    if (old) old.remove();
    if (html) label.insertAdjacentHTML("beforeend", html);
  }

  function paintWalletApr(rates) {
    setWalletRowApr(walletBalanceTableRow("staked hive"), walletHiveAprHtml(rates));
    setWalletRowApr(walletBalanceTableRow("staked hbd"), walletHbdAprHtml(rates));
  }

  function walletBalanceRow(label, amount, symbol, actionsHtml, noteHtml) {
    return `<tr data-balance="${HiveMd.escapeHtml(label)}">
      <td class="wallet-label">${HiveMd.escapeHtml(label)}${noteHtml || ""}</td>
      <td class="wallet-value">${HiveMd.escapeHtml(formatAssetNumber(amount))}</td>
      <td class="wallet-unit">${HiveMd.escapeHtml(symbol)}</td>
      <td class="wallet-actions wallet-actions-inline">${
        actionsHtml ? `<div class="wallet-actions-inner">${actionsHtml}</div>` : ""
      }</td>
    </tr>`;
  }

  function walletActionsUnderRow(actionsHtml) {
    if (!actionsHtml) return "";
    return `<tr class="wallet-actions-under">
      <td class="wallet-actions" colspan="4"><div class="wallet-actions-inner">${actionsHtml}</div></td>
    </tr>`;
  }

  function walletStakeButton(kind, op) {
    const stake = op === "stake";
    const cls = stake ? "btn-primary" : "btn-ghost";
    const label = stake ? "Stake" : "Unstake";
    return `<button type="button" class="${cls} btn-compact wallet-stake-btn" data-wallet-op="${op}-${kind}">${label}</button>`;
  }

  function walletPowerDownNote(wallet) {
    if (!wallet || wallet.toWithdrawVests <= 0) return "";
    const total = HiveApi.vestsToHive(wallet.toWithdrawVests, wallet.props);
    const done = HiveApi.vestsToHive(wallet.withdrawnVests, wallet.props);
    const left = Math.max(0, total - done);
    if (left <= 0) return "";
    return `<p class="wallet-note">Powering down ${formatHiveLike(left, "hive")} remaining.</p>`;
  }

  function clearDelegationView() {
    delegationView.loadGen += 1;
    delegationView.account = "";
    delegationView.open = false;
    delegationView.loading = false;
    delegationView.loaded = false;
    delegationView.hasError = false;
    delegationView.outgoingHp = null;
    delegationView.incomingHp = null;
    delegationView.outgoingRc = null;
    delegationView.incomingRc = null;
    delegationView.hpTruncated = false;
    delegationView.rcTruncated = false;
    delegationView.errors = {};
    delegationView.rcAccount = null;
    delegationView.receivedRc = null;
    delegationLoadPromise = null;
  }

  function rcToBig(value) {
    if (typeof value === "bigint") return value > 0n ? value : 0n;
    if (typeof value === "number") {
      if (!Number.isFinite(value) || value <= 0) return 0n;
      return BigInt(Math.trunc(value));
    }
    const s = String(value == null ? "" : value).trim().replace(/[, ]/g, "");
    if (!s) return 0n;
    if (/e/i.test(s)) {
      const n = Number(s);
      if (!Number.isFinite(n) || n <= 0) return 0n;
      return BigInt(Math.trunc(n));
    }
    if (!/^\d+$/.test(s)) return 0n;
    try {
      return BigInt(s);
    } catch {
      return 0n;
    }
  }

  function parseRcInput(raw) {
    const s = String(raw || "")
      .trim()
      .replace(/[, ]/g, "");
    if (!s || !/^\d+$/.test(s)) return null;
    try {
      return BigInt(s);
    } catch {
      return null;
    }
  }

  function delegateRcScale() {
    const el = $("#delegateRcUnit");
    if (!el || el.hidden) return 1n;
    try {
      const n = BigInt(el.value);
      return n > 0n ? n : 1n;
    } catch {
      return 1n;
    }
  }

  function parseDelegateRcAmount(raw) {
    const scale = delegateRcScale();
    const s = String(raw || "")
      .trim()
      .replace(/ /g, "")
      .replace(",", ".");
    if (!s) return null;
    if (scale === 1n) return parseRcInput(s);
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    const bits = s.split(".");
    const exp = scale.toString().length - 1;
    const frac = bits[1] || "";
    if (frac.length > exp) return null;
    const digits = (bits[0] + frac.padEnd(exp, "0")).replace(/^0+/, "") || "0";
    try {
      return BigInt(digits);
    } catch {
      return null;
    }
  }

  function setDelegateRcAmount(total, keepValue) {
    const input = $("#delegateAmount");
    const unit = $("#delegateRcUnit");
    if (!input) return "";
    const parts = delegationRcParts(total);
    const text = String(parts.value).replace(/,/g, "");
    const previous = input.value;
    input.value = text;
    if (unit) {
      const scales = { rc: "1", "M rc": "1000000", "B rc": "1000000000", "T rc": "1000000000000", "Q rc": "1000000000000000", "Qi rc": "1000000000000000000" };
      unit.value = scales[parts.unit] || "1";
    }
    syncDelegateRcInputMode();
    if (keepValue) input.value = previous;
    return text;
  }

  function syncDelegateRcInputMode() {
    const amount = $("#delegateAmount");
    if (!amount || delegateState.asset !== "rc") return;
    const scaled = delegateRcScale() > 1n;
    amount.inputMode = scaled ? "decimal" : "numeric";
    amount.placeholder = scaled ? "0.00" : "0";
  }

  function delegationRcParts(value) {
    const n = rcToBig(value);
    const scales = [
      [1000000000000000000n, 10000000000000000n, "Qi rc"],
      [1000000000000000n, 10000000000000n, "Q rc"],
      [1000000000000n, 10000000000n, "T rc"],
      [1000000000n, 10000000n, "B rc"],
      [1000000n, 10000n, "M rc"],
    ];
    for (let i = 0; i < scales.length; i++) {
      if (n >= scales[i][0]) {
        return { value: formatGroupedNumber(Number(n / scales[i][1]) / 100, 2), unit: scales[i][2] };
      }
    }
    return { value: formatGroupedNumber(Number(n), 0), unit: "rc" };
  }

  function formatRcAmount(value) {
    const parts = delegationRcParts(value);
    if (parts.unit === "rc") return parts.value;
    return parts.value + " " + parts.unit.replace(/ rc$/, "");
  }

  function delegationHiveParts(vests, props) {
    const hive = HiveApi.vestsToHive(vests, props);
    const shown = roundAsset(hive, 3);
    if (!(shown > 0) && Number(vests) > 0) return { value: "<0.001", unit: "hive" };
    return { value: formatAssetNumber(shown), unit: "hive" };
  }

  function formatDelegationHive(vests, props) {
    const parts = delegationHiveParts(vests, props);
    return parts.value + " " + parts.unit;
  }

  function floorAsset(n, decimals) {
    const f = Math.pow(10, decimals);
    const x = Number(n) || 0;
    if (!(x > 0) || !Number.isFinite(x)) return 0;
    return Math.floor(x * f + 1e-9) / f;
  }

  function hiveToDelegatedVests(hive, props) {
    const raw = HiveApi.hiveToVests(hive, props);
    if (!(raw > 0) || !Number.isFinite(raw)) return 0;
    return Math.floor(raw * 1e6 + 1e-9) / 1e6;
  }

  function vestsEqual(a, b) {
    return Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.0000005;
  }

  function walletDelegableVests(wallet) {
    if (!wallet) return 0;
    const powering = Math.max(0, (Number(wallet.toWithdrawVests) || 0) - (Number(wallet.withdrawnVests) || 0));
    return Math.max(0, (Number(wallet.availableVests) || 0) - powering);
  }

  function outgoingHpVests(name) {
    const user = walletHiveName(name);
    const rows = delegationView.outgoingHp || [];
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].delegatee === user) return Number(rows[i].vests) || 0;
    }
    return 0;
  }

  function outgoingRcAmount(name) {
    const user = walletHiveName(name);
    const rows = delegationView.outgoingRc || [];
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].to === user) return rcToBig(rows[i].rc);
    }
    return 0n;
  }

  function delegationStatusHtml(text, isError) {
    return (
      '<p class="wallet-delegation-status' +
      (isError ? " is-error" : "") +
      '">' +
      HiveMd.escapeHtml(text) +
      "</p>"
    );
  }

  function delegationStatusRow(text, isError) {
    return '<tr class="wallet-delegation-note"><td colspan="4">' + delegationStatusHtml(text, isError) + "</td></tr>";
  }

  function delegationHeadingRow(label) {
    return (
      '<tr class="wallet-delegation-heading"><td class="wallet-label" colspan="4"><h3>' +
      HiveMd.escapeHtml(label) +
      "</h3></td></tr>"
    );
  }

  function delegationDirectionRow(label) {
    return (
      '<tr class="wallet-delegation-direction"><td class="wallet-label" colspan="4">' +
      HiveMd.escapeHtml(label) +
      "</td></tr>"
    );
  }

  function delegationWhoHtml(direction, name) {
    const arrow = direction === "out" ? "\u2192" : "\u2190";
    return (
      '<span class="wallet-delegation-who"><span class="wallet-delegation-arrow">' +
      arrow +
      "</span>" +
      walletAccountHtml(name) +
      "</span>"
    );
  }

  function delegationRowHtml(direction, name, valueText, unit, asset, amountRaw, removable) {
    const button = removable
      ? '<button type="button" class="btn-ghost btn-compact wallet-undelegate-btn" data-delegate-asset="' +
        asset +
        '" data-delegate-account="' +
        HiveMd.escapeHtml(name) +
        '" data-delegate-amount="' +
        HiveMd.escapeHtml(String(amountRaw)) +
        '" aria-label="Edit delegation to @' +
        HiveMd.escapeHtml(name) +
        '">\u2212</button>'
      : "";
    return (
      '<tr class="wallet-delegation-row">' +
      '<td class="wallet-label">' +
      delegationWhoHtml(direction, name) +
      "</td>" +
      '<td class="wallet-value">' +
      HiveMd.escapeHtml(valueText) +
      "</td>" +
      '<td class="wallet-unit">' +
      HiveMd.escapeHtml(unit) +
      "</td>" +
      '<td class="wallet-actions wallet-actions-inline">' +
      (button ? '<div class="wallet-actions-inner">' + button + "</div>" : "") +
      "</td></tr>" +
      walletActionsUnderRow(button)
    );
  }

  function delegationGrouped(title, emptyText, outgoingHtml, incomingHtml) {
    let body = "";
    if (outgoingHtml) body += delegationDirectionRow("outgoing") + outgoingHtml;
    if (incomingHtml) body += delegationDirectionRow("incoming") + incomingHtml;
    if (!body) body = delegationStatusRow(emptyText, false);
    return delegationHeadingRow(title) + body;
  }

  function sortedHpRows(rows, key) {
    return rows.slice().sort(function (a, b) {
      const diff = (Number(b.vests) || 0) - (Number(a.vests) || 0);
      if (diff) return diff;
      return String(a[key] || "").localeCompare(String(b[key] || ""));
    });
  }

  function sortedRcRows(rows, key) {
    return rows.slice().sort(function (a, b) {
      const diff = rcToBig(b.rc) - rcToBig(a.rc);
      if (diff > 0n) return 1;
      if (diff < 0n) return -1;
      return String(a[key] || "").localeCompare(String(b[key] || ""));
    });
  }

  function delegationHpHtml(props, own) {
    let outgoing = "";
    if (delegationView.errors.outgoingHp) {
      outgoing = delegationStatusRow(delegationView.errors.outgoingHp, true);
    } else if (delegationView.outgoingHp && delegationView.outgoingHp.length) {
      const rows = sortedHpRows(delegationView.outgoingHp, "delegatee");
      for (let i = 0; i < rows.length; i++) {
        const amount = delegationHiveParts(rows[i].vests, props);
        outgoing += delegationRowHtml(
          "out",
          rows[i].delegatee,
          amount.value,
          amount.unit,
          "hp",
          rows[i].vests,
          own
        );
      }
      if (delegationView.hpTruncated) {
        outgoing += delegationStatusRow("Some outgoing hive power delegations are not listed.", false);
      }
    }
    let incoming = "";
    if (delegationView.errors.incomingHp) {
      incoming = delegationStatusRow(delegationView.errors.incomingHp, true);
    } else if (delegationView.incomingHp && delegationView.incomingHp.length) {
      const rows = sortedHpRows(delegationView.incomingHp, "delegator");
      for (let i = 0; i < rows.length; i++) {
        const amount = delegationHiveParts(rows[i].vests, props);
        incoming += delegationRowHtml(
          "in",
          rows[i].delegator,
          amount.value,
          amount.unit,
          "hp",
          rows[i].vests,
          false
        );
      }
    }
    return delegationGrouped("hp delegations", "No hive power delegations.", outgoing, incoming);
  }

  function incomingRcErrorText() {
    let text = delegationView.errors.incomingRc || "Incoming resource credit names could not be loaded.";
    const total = rcToBig(delegationView.receivedRc);
    if (total > 0n) text += " Received total: " + formatRcAmount(total) + " rc.";
    return text;
  }

  function delegationRcHtml(own) {
    let outgoing = "";
    if (delegationView.errors.outgoingRc) {
      outgoing = delegationStatusRow(delegationView.errors.outgoingRc, true);
    } else if (delegationView.outgoingRc && delegationView.outgoingRc.length) {
      const rows = sortedRcRows(delegationView.outgoingRc, "to");
      for (let i = 0; i < rows.length; i++) {
        const amount = delegationRcParts(rows[i].rc);
        outgoing += delegationRowHtml("out", rows[i].to, amount.value, amount.unit, "rc", rows[i].rc, own);
      }
      if (delegationView.rcTruncated) {
        outgoing += delegationStatusRow("Some outgoing resource credit delegations are not listed.", false);
      }
    }
    let incoming = "";
    if (delegationView.errors.incomingRc) {
      incoming = delegationStatusRow(incomingRcErrorText(), true);
    } else if (delegationView.incomingRc && delegationView.incomingRc.length) {
      const rows = sortedRcRows(delegationView.incomingRc, "from");
      for (let i = 0; i < rows.length; i++) {
        const amount = delegationRcParts(rows[i].rc);
        incoming += delegationRowHtml("in", rows[i].from, amount.value, amount.unit, "rc", rows[i].rc, false);
      }
    }
    return delegationGrouped("rc delegations", "No resource credit delegations.", outgoing, incoming);
  }

  function paintDelegationPanel() {
    const body = $("#walletDelegatedPanel");
    if (!body) return;
    if (delegationView.loading && !delegationView.loaded) {
      body.innerHTML =
        '<tr class="wallet-delegation-note"><td colspan="4">' +
        delegationStatusHtml("Loading delegations\u2026", false) +
        "</td></tr>";
      return;
    }
    const props = profileState.wallet && profileState.wallet.props;
    const own = isOwnAuthor(profileState.author);
    body.innerHTML = delegationHpHtml(props, own) + delegationRcHtml(own);
  }

  function walletDelegateButton() {
    return '<button type="button" class="btn-primary btn-compact wallet-delegate-btn">Delegate</button>';
  }

  function walletDelegatedRows(wallet, own) {
    const amount = formatAssetNumber(wallet && wallet.delegatedHive);
    const action = own ? walletDelegateButton() : "";
    return (
      '<tr data-balance="delegated hive">' +
      '<td class="wallet-label"><button type="button" class="wallet-delegated-toggle" aria-expanded="false" aria-controls="walletDelegatedPanel">' +
      '<span class="wallet-delegated-caret" aria-hidden="true">\u25b8</span>delegated hive</button></td>' +
      '<td class="wallet-value">' +
      HiveMd.escapeHtml(amount) +
      "</td>" +
      '<td class="wallet-unit">hive</td>' +
      '<td class="wallet-actions wallet-actions-inline">' +
      (action ? '<div class="wallet-actions-inner">' + action + "</div>" : "") +
      "</td></tr>" +
      walletActionsUnderRow(action) +
      "</tbody>" +
      '<tbody class="wallet-delegated-panel" id="walletDelegatedPanel" hidden></tbody>' +
      "<tbody>"
    );
  }

  async function loadDelegationLists(name) {
    if (delegationLoadPromise && delegationView.loading && delegationView.account === name) {
      return delegationLoadPromise;
    }
    const gen = ++delegationView.loadGen;
    delegationView.account = name;
    delegationView.loading = true;
    delegationView.loaded = false;
    delegationView.hasError = false;
    delegationView.errors = {};
    if (delegationView.open) paintDelegationPanel();
    delegationLoadPromise = (async function () {
      const [hpOut, hpIn, rcOut, rcAccount, rcIn] = await Promise.allSettled([
        HiveApi.getOutgoingVestingDelegations(name),
        HiveApi.getIncomingHpDelegations(name),
        HiveApi.getOutgoingRcDelegations(name),
        HiveApi.findRcAccount(name),
        HiveApi.getIncomingRcDelegations(name),
      ]);
      if (gen !== delegationView.loadGen || !profileState.wallet || profileState.wallet.name !== name) return;
      const errors = {};
      if (hpOut.status === "fulfilled") {
        delegationView.outgoingHp = (hpOut.value && hpOut.value.rows) || [];
        delegationView.hpTruncated = Boolean(hpOut.value && hpOut.value.truncated);
      } else {
        delegationView.outgoingHp = null;
        errors.outgoingHp = "Outgoing hive power could not be loaded.";
      }
      if (hpIn.status === "fulfilled") delegationView.incomingHp = hpIn.value || [];
      else {
        delegationView.incomingHp = null;
        errors.incomingHp = "Incoming hive power could not be loaded.";
      }
      if (rcOut.status === "fulfilled") {
        delegationView.outgoingRc = (rcOut.value && rcOut.value.rows) || [];
        delegationView.rcTruncated = Boolean(rcOut.value && rcOut.value.truncated);
      } else {
        delegationView.outgoingRc = null;
        errors.outgoingRc = "Outgoing resource credits could not be loaded.";
      }
      if (rcAccount.status === "fulfilled" && rcAccount.value) {
        delegationView.rcAccount = rcAccount.value;
        delegationView.receivedRc = String(
          rcAccount.value.received_delegated_rc == null ? "0" : rcAccount.value.received_delegated_rc
        );
      } else {
        delegationView.rcAccount = null;
        delegationView.receivedRc = null;
      }
      if (rcIn.status === "fulfilled") delegationView.incomingRc = rcIn.value || [];
      else {
        delegationView.incomingRc = null;
        errors.incomingRc = "Incoming resource credit names could not be loaded.";
      }
      delegationView.errors = errors;
      delegationView.hasError = Boolean(
        errors.outgoingHp || errors.incomingHp || errors.outgoingRc || errors.incomingRc
      );
      delegationView.loading = false;
      delegationView.loaded = true;
      if (delegationView.open) paintDelegationPanel();
      if (delegateState.mode === "delegate") updateDelegateHint();
    })().finally(function () {
      if (delegationView.loadGen === gen) delegationLoadPromise = null;
    });
    return delegationLoadPromise;
  }

  function setDelegatedToggle(open) {
    const btn = view.querySelector(".wallet-delegated-toggle");
    const panel = $("#walletDelegatedPanel");
    delegationView.open = open;
    if (panel) panel.hidden = !open;
    if (!btn) return;
    btn.classList.toggle("is-open", open);
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    const caret = btn.querySelector(".wallet-delegated-caret");
    if (caret) caret.textContent = open ? "\u25be" : "\u25b8";
  }

  function toggleDelegatedHive() {
    const name = profileState.author;
    const wallet = profileState.wallet;
    if (!name || !wallet || wallet.name !== name) return;
    if (delegationView.open) {
      setDelegatedToggle(false);
      return;
    }
    delegationView.account = name;
    setDelegatedToggle(true);
    if (!delegationView.loaded || delegationView.hasError || delegationView.account !== name) {
      loadDelegationLists(name);
      return;
    }
    paintDelegationPanel();
  }

  function walletPageHtml(wallet, own) {
    const w = wallet || {};
    const props = w.props;
    const rates = walletShownRates(w);
    const hiveStake = own ? walletStakeButton("hive", "stake") : "";
    const hiveUnstake = own ? walletStakeButton("hive", "unstake") : "";
    const hbdStake = own ? walletStakeButton("hbd", "stake") : "";
    const hbdUnstake = own ? walletStakeButton("hbd", "unstake") : "";
    return `
      <div class="wallet-page">
        ${walletRewardsHtml(w, own)}
        <section class="wallet-section">
          <h2>Balances</h2>
          <div class="wallet-table-wrap">
            <table class="wallet-table">
              <colgroup>
                <col class="wallet-col-label">
                <col class="wallet-col-amount">
                <col class="wallet-col-unit">
                <col class="wallet-col-actions">
              </colgroup>
              <tbody>
                ${walletBalanceRow("hive", w.hive, "hive", hiveStake)}
                ${walletActionsUnderRow(hiveStake)}
                ${walletBalanceRow("staked hive", w.stakedHive, "hive", hiveUnstake, walletHiveAprHtml(rates))}
                ${walletActionsUnderRow(hiveUnstake)}
                ${walletDelegatedRows(w, own)}
                ${walletBalanceRow("hbd", w.hbd, "hbd", hbdStake)}
                ${walletActionsUnderRow(hbdStake)}
                ${walletBalanceRow("staked hbd", w.stakedHbd, "hbd", hbdUnstake, walletHbdAprHtml(rates))}
                ${walletActionsUnderRow(hbdUnstake)}
              </tbody>
            </table>
          </div>
          ${walletPowerDownNote(w)}
        </section>
        <section class="wallet-section">
          <h2>Transactions</h2>
          <div id="walletTxBody">${walletHistoryHtml(profileState.walletTx, props)}</div>
        </section>
      </div>
    `;
  }

  function walletOpCopy(kind) {
    if (kind === "stake-hive") {
      return {
        title: "Stake hive",
        lead: "Move liquid hive into staked hive.",
        symbol: "hive",
      };
    }
    if (kind === "unstake-hive") {
      return {
        title: "Unstake hive",
        lead: "Power down staked hive. This takes 13 weeks.",
        symbol: "hive",
      };
    }
    if (kind === "stake-hbd") {
      return {
        title: "Stake hbd",
        lead: "Move liquid hbd into staked hbd.",
        symbol: "hbd",
      };
    }
    return {
      title: "Unstake hbd",
      lead: "Withdraw staked hbd. This takes 3 days.",
      symbol: "hbd",
    };
  }

  function walletSignCopy(kind, user, amount) {
    const unstake = kind.indexOf("unstake") === 0;
    const symbol = kind.indexOf("hbd") === -1 ? "hive" : "hbd";
    const shown = formatHiveLike(amount, symbol);
    let detail = "Moves " + shown + " into staked hive.";
    if (kind === "unstake-hive") detail = "Powers down " + shown + ". This takes 13 weeks.";
    else if (kind === "stake-hbd") detail = "Moves " + shown + " into staked hbd.";
    else if (kind === "unstake-hbd") detail = "Withdraws " + shown + " from staked hbd. This takes 3 days.";
    const action = unstake ? "unstake" : "stake";
    return {
      title: unstake ? "Sign unstake" : "Sign stake",
      lead: "Use hive keychain (recommended) or enter the active key of @" + user + ". " + detail,
      cancelMessage: "The " + action + " was cancelled.",
      failMessage: "Could not sign this " + action + ".",
    };
  }

  function walletAccounts(wallet) {
    const accounts = [];
    if (wallet && wallet.account) accounts.push(wallet.account);
    if (
      wallet &&
      accountState.account &&
      accountState.account !== wallet.account &&
      accountState.user === wallet.name
    ) {
      accounts.push(accountState.account);
    }
    return accounts;
  }

  // Stake moves liquid hive or hbd immediately. The chain account can still
  // show the old balances for a moment, so the table is updated here.
  function applyWalletStake(wallet, kind, amount) {
    if (!wallet || wallet !== profileState.wallet) return;
    const moved = roundAsset(amount, 3);
    if (!(moved >= 0.001)) return;
    const accounts = walletAccounts(wallet);
    if (kind === "stake-hive") {
      const vests = HiveApi.hiveToVests(moved, wallet.props);
      wallet.hive = roundAsset(Math.max(0, (Number(wallet.hive) || 0) - moved), 3);
      wallet.stakedHive = roundAsset((Number(wallet.stakedHive) || 0) + moved, 3);
      wallet.vestingShares = roundAsset((Number(wallet.vestingShares) || 0) + vests, 6);
      wallet.availableVests = Math.max(0, wallet.vestingShares - (Number(wallet.delegatedVests) || 0));
      wallet.hiveStr = formatChainAmount(wallet.hive, "HIVE", 3);
      const vestsStr = formatChainAmount(wallet.vestingShares, "VESTS", 6);
      for (let i = 0; i < accounts.length; i++) {
        accounts[i].balance = wallet.hiveStr;
        accounts[i].vesting_shares = vestsStr;
      }
    } else if (kind === "stake-hbd") {
      wallet.hbd = roundAsset(Math.max(0, (Number(wallet.hbd) || 0) - moved), 3);
      wallet.stakedHbd = roundAsset((Number(wallet.stakedHbd) || 0) + moved, 3);
      wallet.hbdStr = formatChainAmount(wallet.hbd, "HBD", 3);
      const savingsStr = formatChainAmount(wallet.stakedHbd, "HBD", 3);
      for (let i = 0; i < accounts.length; i++) {
        accounts[i].hbd_balance = wallet.hbdStr;
        accounts[i].savings_hbd_balance = savingsStr;
      }
    } else {
      return;
    }
    claimAnimToken += 1;
    paintWalletBalanceAmounts(wallet);
    if (kind === "stake-hive" && accountState.user === wallet.name) syncOwnProfileBanner();
  }

  function walletMaxFor(kind, wallet) {
    if (!wallet) return 0;
    if (kind === "stake-hive") return wallet.hive;
    if (kind === "unstake-hive") return HiveApi.vestsToHive(wallet.availableVests, wallet.props);
    if (kind === "stake-hbd") return wallet.hbd;
    if (kind === "unstake-hbd") return wallet.stakedHbd;
    return 0;
  }

  function setWalletOpStatus(msg, isError) {
    const el = $("#walletOpStatus");
    if (!el) return;
    el.textContent = msg || "";
    el.classList.toggle("is-error", Boolean(isError));
  }

  function closeWalletOverlay() {
    if (ownerSignSession && ownerSignSession.source === "wallet") return;
    const ov = $("#walletOverlay");
    if (ov) ov.hidden = true;
    walletOpState.kind = "";
    walletOpState.max = 0;
    walletOpState.pending = false;
    const input = $("#walletAmount");
    if (input) input.value = "";
    const available = $("#walletOpAvailable");
    if (available) available.textContent = "";
    setWalletOpStatus("");
    const submit = $("#walletOpSubmit");
    if (submit) submit.disabled = false;
  }

  function openWalletOverlay(kind) {
    if (
      kind !== "stake-hive" &&
      kind !== "unstake-hive" &&
      kind !== "stake-hbd" &&
      kind !== "unstake-hbd"
    ) {
      return;
    }
    const wallet = profileState.wallet;
    if (!wallet || !isOwnAuthor(profileState.author)) return;
    const user = observer();
    if (!user) {
      openLogin();
      return;
    }
    const copy = walletOpCopy(kind);
    const max = walletMaxFor(kind, wallet);
    if (max <= 0) {
      showError("No " + copy.symbol + " available for this.");
      return;
    }
    walletOpState.kind = kind;
    walletOpState.max = max;
    walletOpState.symbol = copy.symbol;
    walletOpState.pending = false;
    const title = $("#walletOpTitle");
    if (title) title.textContent = copy.title;
    const lead = $("#walletOpLead");
    if (lead) lead.textContent = copy.lead;
    const available = $("#walletOpAvailable");
    if (available) {
      available.textContent = "Available: " + formatHiveLike(max, copy.symbol) + ".";
    }
    const input = $("#walletAmount");
    if (input) {
      input.value = "";
      input.placeholder = "0.000";
    }
    setWalletOpStatus("");
    const submit = $("#walletOpSubmit");
    if (submit) submit.disabled = false;
    const ov = $("#walletOverlay");
    if (ov) ov.hidden = false;
    if (input) input.focus();
  }

  function fillWalletMax() {
    const input = $("#walletAmount");
    if (!input || !walletOpState.max) return;
    input.value = roundAsset(walletOpState.max, 3).toFixed(3);
  }

  async function nextSavingsRequestId(account) {
    let rows = [];
    try {
      rows = await HiveApi.getSavingsWithdrawFrom(account);
    } catch {
      rows = [];
    }
    const used = new Set(
      rows.map((row) => Number(row && row.request_id)).filter((n) => Number.isFinite(n))
    );
    let id = Math.floor(Date.now() / 1000);
    while (used.has(id)) id += 1;
    return id >>> 0;
  }

  async function submitWalletOp() {
    const kind = walletOpState.kind;
    const wallet = profileState.wallet;
    const user = observer();
    if (!kind || !wallet || !user || !isOwnAuthor(profileState.author)) return;
    if (walletOpState.pending || ownerSignOpen()) return;
    const amount = roundAsset(parseAmountInput($("#walletAmount") && $("#walletAmount").value), 3);
    if (amount < 0.001) {
      setWalletOpStatus("Enter an amount of at least 0.001.", true);
      return;
    }
    const max = roundAsset(walletMaxFor(kind, wallet), 3);
    if (amount > max + 0.0000001) {
      setWalletOpStatus("That is more than " + formatHiveLike(max, walletOpState.symbol) + ".", true);
      return;
    }
    walletOpState.pending = true;
    const submit = $("#walletOpSubmit");
    if (submit) submit.disabled = true;
    setWalletOpStatus("");
    let operations;
    try {
      if (kind === "stake-hive") {
        operations = [
          [
            "transfer_to_vesting",
            { from: user, to: user, amount: formatChainAmount(amount, "HIVE", 3) },
          ],
        ];
      } else if (kind === "unstake-hive") {
        const vests = Math.min(
          HiveApi.hiveToVests(amount, wallet.props),
          wallet.availableVests
        );
        operations = [
          [
            "withdraw_vesting",
            { account: user, vesting_shares: formatChainAmount(vests, "VESTS", 6) },
          ],
        ];
      } else if (kind === "stake-hbd") {
        operations = [
          [
            "transfer_to_savings",
            {
              from: user,
              to: user,
              amount: formatChainAmount(amount, "HBD", 3),
              memo: "",
            },
          ],
        ];
      } else if (kind === "unstake-hbd") {
        const requestId = await nextSavingsRequestId(user);
        operations = [
          [
            "transfer_from_savings",
            {
              from: user,
              request_id: requestId,
              to: user,
              amount: formatChainAmount(amount, "HBD", 3),
              memo: "",
            },
          ],
        ];
      } else {
        throw new Error("Unknown wallet action.");
      }
    } catch (err) {
      setWalletOpStatus((err && err.message) || String(err), true);
      walletOpState.pending = false;
      if (submit) submit.disabled = false;
      return;
    }
    if (walletOpState.kind !== kind || observer() !== user || !isOwnAuthor(profileState.author)) {
      if (walletOpState.kind === kind) closeWalletOverlay();
      return;
    }
    const copy = walletSignCopy(kind, user, amount);
    try {
      await signWithDialog(user, operations, {
        source: "wallet",
        authority: "Active",
        title: copy.title,
        lead: copy.lead,
        cancelMessage: copy.cancelMessage,
        failMessage: copy.failMessage,
        onKeychain: function () {
          setWalletOpStatus("Waiting for Keychain…", false);
        },
      });
      closeWalletOverlay();
      if (kind === "stake-hive" || kind === "stake-hbd") {
        // Drop a refresh that started before this signature so it cannot
        // paint the pre-stake account over the balances just applied.
        resourceGen += 1;
        applyWalletStake(profileState.wallet, kind, amount);
        return;
      }
      currentViewKey = "";
      route();
    } catch (err) {
      const cancelled = Boolean(err && err.ownerCancel);
      setWalletOpStatus(
        cancelled ? (err && err.message) || copy.cancelMessage : (err && err.message) || copy.failMessage,
        !cancelled
      );
      walletOpState.pending = false;
      if (submit) submit.disabled = false;
    }
  }

  function setDelegateStatus(msg, isError) {
    const el = $("#delegateStatus");
    if (!el) return;
    el.textContent = msg || "";
    el.classList.toggle("is-error", Boolean(isError) && Boolean(msg));
  }

  function closeDelegateOverlay() {
    if (ownerSignSession && ownerSignSession.source === "wallet") {
      const ov = $("#delegateOverlay");
      if (ov && !ov.hidden) return;
    }
    const ov = $("#delegateOverlay");
    if (ov) ov.hidden = true;
    delegateState.mode = "";
    delegateState.pending = false;
    delegateState.target = "";
    delegateState.amount = "";
    const submit = $("#delegateSubmit");
    if (submit) {
      submit.disabled = false;
      submit.textContent = "Confirm";
    }
    setDelegateStatus("");
  }

  function showDelegateForm(show) {
    const asset = $("#delegateAsset");
    const form = $("#delegateForm");
    if (asset) asset.hidden = !show;
    if (form) form.hidden = !show;
  }

  function rcHiveHint(rc, props) {
    const n = rcToBig(rc);
    if (n <= 0n || !props) return "";
    const vests = Number(n) / 1e6;
    if (!Number.isFinite(vests) || vests <= 0) return "";
    const hive = HiveApi.vestsToHive(vests, props);
    if (!(hive >= 0.001)) return "";
    return "About " + formatHiveLike(hive, "hive") + ".";
  }

  function delegateHpCapVests(target) {
    const wallet = profileState.wallet;
    if (!wallet) return 0;
    const current = target ? outgoingHpVests(target) : 0;
    return walletDelegableVests(wallet) + current;
  }

  function delegateRcMax(target) {
    const extra = HiveApi.rcDelegable
      ? HiveApi.rcDelegable(delegationView.rcAccount, Math.floor(Date.now() / 1000))
      : 0n;
    const current = target ? outgoingRcAmount(target) : 0n;
    const more = typeof extra === "bigint" ? extra : rcToBig(extra);
    return more + current;
  }

  function updateDelegateHint() {
    const hint = $("#delegateHint");
    if (!hint || delegateState.mode !== "delegate") return;
    const wallet = profileState.wallet;
    const target = walletHiveName($("#delegateUser") && $("#delegateUser").value);
    if (delegateState.asset === "rc") {
      if (!delegationView.loaded || !delegationView.rcAccount || delegationView.outgoingRc == null) {
        hint.textContent = "";
        return;
      }
      const max = delegateRcMax(target);
      let text = "Available: " + formatRcAmount(max) + " rc.";
      const about = rcHiveHint(max, wallet && wallet.props);
      if (about) text += " " + about;
      if (target) {
        const current = outgoingRcAmount(target);
        if (current > 0n) {
          text += " This includes " + formatRcAmount(current) + " rc already delegated to @" + target + ".";
        }
      }
      hint.textContent = text;
      return;
    }
    if (!wallet || !delegationView.loaded || delegationView.outgoingHp == null) {
      hint.textContent = "";
      return;
    }
    const maxHive = HiveApi.vestsToHive(delegateHpCapVests(target), wallet.props);
    let text = "Available: " + formatHiveLike(floorAsset(maxHive, 3), "hive") + ".";
    if (target) {
      const current = outgoingHpVests(target);
      if (current > 0) {
        text += " This includes " + formatDelegationHive(current, wallet.props) + " already delegated to @" + target + ".";
      }
    }
    hint.textContent = text;
  }

  function applyDelegatedAmountPlaceholder() {
    const target = walletHiveName($("#delegateUser") && $("#delegateUser").value);
    const input = $("#delegateAmount");
    if (!target || !input) return false;
    let text = "";
    if (delegateState.asset === "rc") {
      const rc = outgoingRcAmount(target);
      if (!(rc > 0n)) return false;
      text = setDelegateRcAmount(rc, true);
    } else {
      const wallet = profileState.wallet;
      if (!wallet || !wallet.props) return false;
      const hive = roundAsset(HiveApi.vestsToHive(outgoingHpVests(target), wallet.props), 3);
      if (!(hive >= 0.001)) return false;
      text = hive.toFixed(3);
    }
    if (!text) return false;
    input.placeholder = text;
    return true;
  }

  function setDelegateAsset(asset) {
    const next = asset === "rc" ? "rc" : "hp";
    delegateState.asset = next;
    const root = $("#delegateAsset");
    if (root) {
      root.querySelectorAll("[data-delegate-asset]").forEach(function (btn) {
        const on = btn.getAttribute("data-delegate-asset") === next;
        btn.classList.toggle("is-active", on);
        btn.setAttribute("aria-pressed", on ? "true" : "false");
      });
    }
    const label = $("#delegateAmountLabel");
    if (label) label.textContent = next === "rc" ? "Resource credits" : "Hive power";
    const amount = $("#delegateAmount");
    if (amount) {
      amount.inputMode = next === "rc" ? "numeric" : "decimal";
      amount.placeholder = next === "rc" ? "0" : "0.000";
      amount.value = "";
    }
    const unit = $("#delegateRcUnit");
    if (unit) {
      unit.hidden = next !== "rc";
      unit.value = "1";
      unit.disabled = false;
    }
    const lead = $("#delegateLead");
    if (lead && delegateState.mode === "delegate") {
      lead.textContent =
        next === "rc"
          ? "Delegate resource credits. This sets the outgoing amount, so an existing delegation to that account is replaced. Lowering it is immediate, and unused resource credits are not returned."
          : "Delegate hive power. This sets the outgoing amount, so an existing delegation to that account is replaced. Lowering it returns the difference after 5 days.";
    }
    setDelegateStatus("");
    updateDelegateHint();
  }

  function delegateDialogBusy(on) {
    delegateState.pending = on;
    const submit = $("#delegateSubmit");
    const cancel = $("#delegateCancel");
    const max = $("#delegateMax");
    const unit = $("#delegateRcUnit");
    if (submit) submit.disabled = on;
    if (cancel) cancel.disabled = on;
    if (max) max.disabled = on;
    if (unit) unit.disabled = on;
  }

  function openDelegateDialog(prefill) {
    if (!isOwnAuthor(profileState.author)) return;
    const user = observer();
    if (!user) {
      openLogin();
      return;
    }
    if (ownerSignOpen() || delegateState.pending) return;
    const target = prefill ? walletHiveName(prefill.account) : "";
    if (prefill && (!target || target === user)) return;
    const kind = prefill && prefill.asset === "rc" ? "rc" : "hp";
    delegateState.mode = "delegate";
    delegateState.pending = false;
    delegateState.target = target;
    delegateState.amount = prefill ? "0" : "";
    const title = $("#delegateTitle");
    if (title) title.textContent = "Delegate";
    showDelegateForm(true);
    setDelegateAsset(kind);
    const userInput = $("#delegateUser");
    if (userInput) userInput.value = target;
    const amountInput = $("#delegateAmount");
    if (amountInput) amountInput.value = prefill ? "0" : "";
    if (prefill) applyDelegatedAmountPlaceholder();
    updateDelegateHint();
    const submit = $("#delegateSubmit");
    if (submit) {
      submit.disabled = false;
      submit.textContent = "Confirm";
    }
    const ov = $("#delegateOverlay");
    if (ov) ov.hidden = false;
    const focusEl = prefill ? amountInput : userInput;
    if (focusEl && !isMobileViewport()) {
      focusEl.focus();
      if (prefill && amountInput && typeof amountInput.setSelectionRange === "function") {
        const end = amountInput.value.length;
        try {
          amountInput.setSelectionRange(end, end);
        } catch (err) {
          /* ignore */
        }
      }
    }
    if (!delegationView.loaded || delegationView.hasError) loadDelegationLists(user);
  }

  async function ensureDelegationLoaded(name) {
    if (
      delegationView.account !== name ||
      !delegationView.loaded ||
      delegationView.hasError ||
      delegationView.loading
    ) {
      await loadDelegationLists(name);
    }
    return Boolean(
      profileState.wallet &&
        profileState.wallet.name === name &&
        delegationView.account === name &&
        delegationView.loaded
    );
  }

  function hpDelegateOp(delegator, delegatee, vests) {
    return [
      "delegate_vesting_shares",
      {
        delegator: delegator,
        delegatee: delegatee,
        vesting_shares: formatChainAmount(vests, "VESTS", 6),
      },
    ];
  }

  function rcDelegateOp(from, to, maxRc) {
    const n = (typeof maxRc === "bigint" ? maxRc : rcToBig(maxRc)).toString();
    return [
      "custom_json",
      {
        required_auths: [],
        required_posting_auths: [from],
        id: "rc",
        json:
          '["delegate_rc",{"from":' +
          JSON.stringify(from) +
          ',"delegatees":[' +
          JSON.stringify(to) +
          '],"max_rc":' +
          n +
          "}]",
      },
    ];
  }

  function delegateSignCopy(kind, user, detail) {
    // Hive power is an active-authority operation. Resource credits are a
    // custom_json whose inner delegate_rc requires posting authority, and the
    // chain rejects an active signature for that operation.
    const posting = delegateState.asset === "rc";
    const removing = kind === "remove";
    const role = posting ? "posting" : "active";
    return {
      authority: posting ? "Posting" : "Active",
      title: removing ? "Sign removal" : "Sign delegation",
      lead:
        "Use hive keychain (recommended) or enter the " +
        role +
        " key of @" +
        user +
        ". " +
        detail,
      cancelMessage: removing ? "The removal was cancelled." : "The delegation was cancelled.",
      failMessage: removing ? "Could not sign this removal." : "Could not sign this delegation.",
    };
  }

  function applyHpDelegation(wallet, delegatee, prevVests, nextVests) {
    if (!wallet || wallet !== profileState.wallet) return;
    const prev = Number(prevVests) || 0;
    const next = Number(nextVests) || 0;
    const delta = next - prev;
    wallet.delegatedVests = roundAsset(Math.max(0, (Number(wallet.delegatedVests) || 0) + delta), 6);
    wallet.delegatedHive = HiveApi.vestsToHive(wallet.delegatedVests, wallet.props);
    // A removed or reduced delegation returns after 5 days. Those vests are
    // not spendable, so available stake does not rise until the chain says so.
    if (delta > 0) wallet.availableVests = Math.max(0, (Number(wallet.availableVests) || 0) - delta);
    const vestsStr = formatChainAmount(wallet.delegatedVests, "VESTS", 6);
    const accounts = walletAccounts(wallet);
    for (let i = 0; i < accounts.length; i++) accounts[i].delegated_vesting_shares = vestsStr;
    paintWalletBalanceAmounts(wallet);
    if (accountState.user === wallet.name) syncOwnProfileBanner();
    const name = walletHiveName(delegatee);
    const list = delegationView.outgoingHp || [];
    let found = false;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].delegatee !== name) continue;
      found = true;
      if (next <= 0) list.splice(i, 1);
      else list[i].vests = next;
    }
    if (!found && next > 0 && name) list.push({ delegator: wallet.name, delegatee: name, vests: next });
    delegationView.outgoingHp = list;
    paintDelegationPanel();
  }

  function applyRcDelegation(delegatee, prevRc, nextRc) {
    const prev = rcToBig(prevRc);
    const next = rcToBig(nextRc);
    const delta = next - prev;
    const account = delegationView.rcAccount;
    if (account) {
      const delegated = rcToBig(account.delegated_rc) + delta;
      account.delegated_rc = (delegated < 0n ? 0n : delegated).toString();
      const max = rcToBig(account.max_rc) - delta;
      account.max_rc = (max < 0n ? 0n : max).toString();
      if (delta > 0 && account.rc_manabar) {
        const mana = rcToBig(account.rc_manabar.current_mana) - delta;
        account.rc_manabar.current_mana = (mana < 0n ? 0n : mana).toString();
      }
    }
    const name = walletHiveName(delegatee);
    const list = delegationView.outgoingRc || [];
    let found = false;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].to !== name) continue;
      found = true;
      if (next <= 0n) list.splice(i, 1);
      else list[i].rc = next.toString();
    }
    if (!found && next > 0n && name) list.push({ from: profileState.author, to: name, rc: next.toString() });
    delegationView.outgoingRc = list;
    paintDelegationPanel();
  }

  async function accountExists(name) {
    const accounts = await HiveApi.getAccounts([name]);
    const row = accounts && accounts[0];
    return Boolean(row && walletHiveName(row.name) === name);
  }

  async function fillDelegateMax() {
    if (delegateState.mode !== "delegate" || delegateState.pending) return;
    const user = observer();
    const wallet = profileState.wallet;
    if (!user || !wallet || !isOwnAuthor(wallet.name)) return;
    setDelegateStatus("");
    const ready = await ensureDelegationLoaded(user);
    if (!ready || delegateState.mode !== "delegate") return;
    const target = walletHiveName($("#delegateUser") && $("#delegateUser").value);
    const input = $("#delegateAmount");
    if (!input) return;
    if (delegateState.asset === "rc") {
      if (delegationView.outgoingRc == null || !delegationView.rcAccount) {
        setDelegateStatus("Resource credits could not be loaded.", true);
        return;
      }
      setDelegateRcAmount(delegateRcMax(target));
      updateDelegateHint();
      return;
    } else {
      if (delegationView.outgoingHp == null) {
        setDelegateStatus("Hive power delegations could not be loaded.", true);
        return;
      }
      const maxHive = floorAsset(HiveApi.vestsToHive(delegateHpCapVests(target), wallet.props), 3);
      input.value = maxHive.toFixed(3);
    }
    updateDelegateHint();
  }

  async function submitDelegate() {
    if (delegateState.pending || ownerSignOpen()) return;
    const user = observer();
    const wallet = profileState.wallet;
    if (!user || !wallet || !isOwnAuthor(wallet.name) || wallet.name !== user) return;
    if (delegateState.mode !== "delegate") return;
    const target = walletHiveName($("#delegateUser") && $("#delegateUser").value);
    if (!target) {
      setDelegateStatus("Enter a hive username.", true);
      return;
    }
    if (target === user) {
      setDelegateStatus("You cannot delegate to yourself.", true);
      return;
    }
    delegateDialogBusy(true);
    setDelegateStatus("");
    let ready = false;
    try {
      ready = await ensureDelegationLoaded(user);
    } catch (err) {
      ready = false;
    }
    if (!ready || delegateState.mode !== "delegate" || observer() !== user) {
      if (delegateState.mode === "delegate") {
        delegateDialogBusy(false);
        setDelegateStatus("Delegations could not be loaded.", true);
      }
      return;
    }
    const asset = delegateState.asset;
    let operations;
    let removing = false;
    let prevVests = 0;
    let nextVests = 0;
    let prevRc = 0n;
    let nextRc = 0n;
    let detail = "";
    if (asset === "hp") {
      if (delegationView.outgoingHp == null) {
        delegateDialogBusy(false);
        setDelegateStatus("Outgoing hive power could not be loaded.", true);
        return;
      }
      if (delegationView.hpTruncated && outgoingHpVests(target) <= 0) {
        delegateDialogBusy(false);
        setDelegateStatus("Not all outgoing delegations were loaded, so this account cannot be updated yet.", true);
        return;
      }
      const rawHive = String(($("#delegateAmount") && $("#delegateAmount").value) || "")
        .trim()
        .replace(",", ".");
      if (!rawHive || !/^\d+(\.\d+)?$/.test(rawHive)) {
        delegateDialogBusy(false);
        setDelegateStatus("Enter a hive power amount.", true);
        return;
      }
      const amount = roundAsset(Number(rawHive), 3);
      prevVests = outgoingHpVests(target);
      if (amount < 0.001) {
        if (amount === 0 && prevVests > 0) {
          removing = true;
          nextVests = 0;
          detail =
            "Removes the hive power delegation to @" +
            target +
            " (" +
            formatDelegationHive(prevVests, wallet.props) +
            "). Hive power returns after 5 days.";
          operations = [hpDelegateOp(user, target, 0)];
        } else {
          delegateDialogBusy(false);
          setDelegateStatus("Enter at least 0.001 hive.", true);
          return;
        }
      } else {
        const cap = delegateHpCapVests(target);
        const maxHive = floorAsset(HiveApi.vestsToHive(cap, wallet.props), 3);
        if (amount > maxHive + 0.0000001) {
          delegateDialogBusy(false);
          setDelegateStatus("That is more than " + formatHiveLike(maxHive, "hive") + ".", true);
          return;
        }
        nextVests = Math.min(hiveToDelegatedVests(amount, wallet.props), floorAsset(cap, 6));
        if (!(nextVests > 0)) {
          delegateDialogBusy(false);
          setDelegateStatus("Enter at least 0.001 hive.", true);
          return;
        }
        const currentHive = roundAsset(HiveApi.vestsToHive(prevVests, wallet.props), 3);
        if ((prevVests > 0 && amount === currentHive) || vestsEqual(nextVests, prevVests)) {
          delegateDialogBusy(false);
          setDelegateStatus("That matches the current delegation to @" + target + ".", true);
          return;
        }
        detail = "Sets the hive power delegation to @" + target + " to " + formatHiveLike(amount, "hive") + ".";
        if (nextVests < prevVests) detail += " The difference returns after 5 days.";
        operations = [hpDelegateOp(user, target, nextVests)];
      }
    } else {
      if (delegationView.outgoingRc == null || !delegationView.rcAccount) {
        delegateDialogBusy(false);
        setDelegateStatus("Resource credits could not be loaded.", true);
        return;
      }
      if (delegationView.rcTruncated && outgoingRcAmount(target) <= 0n) {
        delegateDialogBusy(false);
        setDelegateStatus("Not all outgoing delegations were loaded, so this account cannot be updated yet.", true);
        return;
      }
      const amount = parseDelegateRcAmount($("#delegateAmount") && $("#delegateAmount").value);
      if (amount == null) {
        delegateDialogBusy(false);
        setDelegateStatus(
          delegateRcScale() > 1n ? "Enter a resource credit amount." : "Enter a whole number of resource credits.",
          true
        );
        return;
      }
      prevRc = outgoingRcAmount(target);
      if (amount <= 0n) {
        if (amount === 0n && prevRc > 0n) {
          removing = true;
          nextRc = 0n;
          detail =
            "Removes the resource credit delegation to @" +
            target +
            " (" +
            formatRcAmount(prevRc) +
            " rc). This takes effect immediately. Unused delegated resource credits are not returned.";
          operations = [rcDelegateOp(user, target, 0)];
        } else {
          delegateDialogBusy(false);
          setDelegateStatus("Enter an amount above 0.", true);
          return;
        }
      } else {
        const max = delegateRcMax(target);
        if (amount > max) {
          delegateDialogBusy(false);
          setDelegateStatus("That is more than " + formatRcAmount(max) + " rc.", true);
          return;
        }
        nextRc = amount;
        if (nextRc === prevRc) {
          delegateDialogBusy(false);
          setDelegateStatus("That matches the current delegation to @" + target + ".", true);
          return;
        }
        detail = "Sets the resource credit delegation to @" + target + " to " + formatRcAmount(nextRc) + " rc.";
        operations = [rcDelegateOp(user, target, nextRc)];
      }
    }
    let exists = false;
    try {
      exists = await accountExists(target);
    } catch (err) {
      delegateDialogBusy(false);
      setDelegateStatus((err && err.message) || "Could not look up that account.", true);
      return;
    }
    if (delegateState.mode !== "delegate" || observer() !== user || !isOwnAuthor(profileState.author)) {
      delegateDialogBusy(false);
      return;
    }
    if (!exists) {
      delegateDialogBusy(false);
      setDelegateStatus("That hive account does not exist.", true);
      return;
    }
    const copy = delegateSignCopy(removing ? "remove" : "delegate", user, detail);
    try {
      await signWithDialog(user, operations, {
        source: "wallet",
        authority: copy.authority,
        title: copy.title,
        lead: copy.lead,
        cancelMessage: copy.cancelMessage,
        failMessage: copy.failMessage,
        requireSession: copy.authority === "Posting",
        onKeychain:
          copy.authority === "Active"
            ? function () {
                setDelegateStatus("Waiting for Keychain…", false);
              }
            : null,
      });
      closeDelegateOverlay();
      if (asset === "hp") {
        resourceGen += 1;
        applyHpDelegation(profileState.wallet, target, prevVests, nextVests);
      } else {
        applyRcDelegation(target, prevRc, nextRc);
      }
    } catch (err) {
      const cancelled = Boolean(err && err.ownerCancel);
      setDelegateStatus(
        cancelled ? (err && err.message) || copy.cancelMessage : (err && err.message) || copy.failMessage,
        !cancelled
      );
      delegateDialogBusy(false);
    }
  }

  function claimProfileRewards() {
    const user = observer();
    const wallet = profileState.wallet;
    const name = profileState.author;
    if (!wallet || !isOwnAuthor(name)) return;
    if (!user) {
      openLogin();
      return;
    }
    if (!hasSigner(user)) {
      showError(signerNeededMessage());
      return;
    }
    if (!walletHasRewards(wallet) || profileState.claimPending) return;
    profileState.claimPending = true;
    const rewards = view.querySelector(".wallet-rewards");
    showClaimPending(rewards);
    const { promise } = ChainQueue.enqueue({
      username: user,
      key: "Posting",
      operations: [
        [
          "claim_reward_balance",
          {
            account: user,
            reward_hive: wallet.rewardHiveStr,
            reward_hbd: wallet.rewardHbdStr,
            reward_vests: wallet.rewardVestsStr,
          },
        ],
      ],
      meta: { type: "wallet", action: "claim" },
    });
    promise
      .then(() => {
        if (profileState.wallet !== wallet) return;
        animateClaimRewards(wallet);
      })
      .catch((err) => {
        if (profileState.author !== name) return;
        profileState.claimPending = false;
        const box = view.querySelector(".wallet-rewards");
        if (box) {
          box.hidden = false;
          restoreClaimButton(box);
        }
        showError(err.message || String(err));
      });
  }

  function showClaimPending(rewards) {
    const btn = rewards && rewards.querySelector(".wallet-claim-btn");
    if (!btn) return;
    const height = btn.getBoundingClientRect().height;
    const status = document.createElement("span");
    status.className = "wallet-claiming";
    status.setAttribute("role", "status");
    status.textContent = "claiming...";
    if (height) status.style.height = height + "px";
    btn.replaceWith(status);
  }

  function restoreClaimButton(rewards) {
    const status = rewards && rewards.querySelector(".wallet-claiming");
    if (!status) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-primary btn-compact wallet-claim-btn";
    btn.textContent = "Claim";
    status.replaceWith(btn);
  }

  async function renderProfileFeed(author, page) {
    const sort = page === "comments" ? "comments" : page === "replies" ? "replies" : "posts";
    if (!profileRouteStill(author, sort)) return;
    resetFeed(feedSpecForProfile(author, sort));
    const emptyTitle =
      page === "comments" ? "No comments" : page === "replies" ? "No replies" : "No posts";
    const emptyDetail =
      page === "comments"
        ? "This account has not written comments yet."
        : page === "replies"
          ? "Nobody has replied to this account yet."
          : "This account has no posts yet.";
    const feedShell = `
        <div id="feedList" class="feed"></div>
        <div id="feedStatus" class="loading-row"><span class="btn-loader" aria-hidden="true"></span> Loading…</div>
        <div class="feed-actions">
          <button type="button" class="btn-primary" id="moreBtn" hidden>Load more</button>
        </div>
      `;
    const section = profileSectionEl();
    if (section) section.insertAdjacentHTML("beforeend", feedShell);
    else view.insertAdjacentHTML("beforeend", feedShell);
    const list = $("#feedList");
    const status = $("#feedStatus");
    const moreBtn = $("#moreBtn");

    async function loadPage() {
      if (feedState.loading || feedState.done) return;
      if (feedState.kind !== "profile" || feedState.scope !== author || feedState.sort !== sort) return;
      const gen = feedState.gen;
      feedState.loading = true;
      let pages = 0;
      const startCount = feedState.items.length;
      const user = observer();
      try {
        while (
          feedStill(gen) &&
          pages < MAX_PAGES_PER_LOAD &&
          feedState.items.length < startCount + FEED_TARGET
        ) {
          const batch = await HiveApi.getAccountPosts({
            account: author,
            sort,
            limit: HiveApi.PAGE_SIZE,
            startAuthor: feedState.cursor && feedState.cursor.author,
            startPermlink: feedState.cursor && feedState.cursor.permlink,
            observer: user,
          });
          if (!feedStill(gen)) return;
          setNodeLabel();
          pages++;
          if (!batch.length) {
            feedState.done = true;
            break;
          }
          let added = 0;
          const incoming = [];
          for (const post of batch) {
            const key = `${post.author}/${post.permlink}`;
            if (feedState.seen.has(key)) continue;
            feedState.seen.add(key);
            added++;
            if (sort === "posts" && !isRootPost(post)) continue;
            if (isBlacklistedPost(post)) continue;
            incoming.push(post);
          }
          await resolveCrossPosts(incoming);
          if (!feedStill(gen)) return;
          for (let i = 0; i < incoming.length; i++) {
            if (!keepHydratedPost(incoming[i])) continue;
            feedState.items.push(incoming[i]);
          }
          const last = batch[batch.length - 1];
          if (
            !last ||
            (feedState.cursor &&
              last.author === feedState.cursor.author &&
              last.permlink === feedState.cursor.permlink)
          ) {
            feedState.done = true;
            break;
          }
          feedState.cursor = { author: last.author, permlink: last.permlink };
          if (batch.length < HiveApi.PAGE_SIZE) {
            feedState.done = true;
            break;
          }
          if (added === 0 && pages > 1) {
            feedState.done = true;
            break;
          }
        }
      } finally {
        if (feedStill(gen)) feedState.loading = false;
      }
    }

    async function fill() {
      await runFeedFill(async () => {
        const gen = feedState.gen;
        if (!profileRouteStill(author, sort) || !feedStill(gen)) return false;
        hideVoteSlider();
        moreBtn.hidden = true;
        showFeedLoading(status);
        let failed = false;
        const before = feedState.items.length;
        try {
          await loadPage();
        } catch (err) {
          if (!profileRouteStill(author, sort) || !feedStill(gen)) return false;
          failed = true;
          showError(err.message || String(err));
        }
        if (!profileRouteStill(author, sort) || !feedStill(gen) || !list.isConnected) return false;
        if (!failed) clearError();
        paintFeedCards(list, profileCardHtml);
        if (!feedState.items.length && feedState.done) {
          status.hidden = true;
          list.innerHTML = `
          <div class="panel empty-state">
            <h2>${HiveMd.escapeHtml(emptyTitle)}</h2>
            <p>${HiveMd.escapeHtml(emptyDetail)}</p>
          </div>`;
          return false;
        }
        return finishFeedPage(status, moreBtn, failed, before);
      });
    }

    bindFeedMore(moreBtn, fill);
    await fill();
    if (profileRouteStill(author, sort)) releaseProfileSectionHold();
  }

  function profileRouteStill(name, tab) {
    const r = parseRoute();
    if (!r || r.name !== "profile") return false;
    const author = String(r.author || "")
      .replace(/^@/, "")
      .toLowerCase();
    const page = normalizeProfilePage(r.page) || "posts";
    return author === name && page === tab;
  }

  function profileSectionHtml(html) {
    const status = $("#profileSectionStatus");
    if (status) status.outerHTML = html;
    else view.insertAdjacentHTML("beforeend", html);
  }

  function profileSectionLoadingHtml() {
    return `<div class="loading-row" id="profileSectionStatus"><span class="btn-loader" aria-hidden="true"></span> Loading…</div>`;
  }

  // The banner stays when this author is already on screen. A new profile
  // still loads the account first, then the posts, comments, replies, or wallet.
  function profileBannerReady(name) {
    if (profileState.author !== name || !profileState.profile) return false;
    const banner = view.querySelector(".profile-banner");
    if (!banner || banner.classList.contains("community-banner")) return false;
    return Boolean(view.querySelector(".profile-nav"));
  }

  function paintPeopleCounts() {
    const buttons = document.querySelectorAll("[data-people]");
    for (let i = 0; i < buttons.length; i++) {
      const btn = buttons[i];
      const on = peopleCountOpen(btn.getAttribute("data-people"), btn.getAttribute("data-people-id"));
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-expanded", on ? "true" : "false");
    }
  }

  function paintProfileNavActive(page) {
    const nav = view.querySelector(".profile-nav");
    if (nav) {
      const ids = ["posts", "comments", "replies", "wallet"];
      const links = nav.querySelectorAll("a");
      for (let i = 0; i < links.length; i++) {
        links[i].classList.toggle("is-active", ids[i] === page);
      }
    }
    paintPeopleCounts();
  }

  function clearProfileSection() {
    const nav = view.querySelector(".profile-nav");
    if (!nav) return;
    let el = nav.nextElementSibling;
    while (el) {
      const next = el.nextElementSibling;
      el.remove();
      el = next;
    }
  }

  function profileSectionEl() {
    return document.getElementById("profileSection");
  }

  function releaseProfileSectionHold() {
    const section = profileSectionEl();
    if (section) section.style.minHeight = "";
  }

  function showProfileSectionLoading() {
    let section = profileSectionEl();
    if (!section) {
      clearProfileSection();
      view.insertAdjacentHTML(
        "beforeend",
        `<div id="profileSection">${profileSectionLoadingHtml()}</div>`
      );
      return;
    }
    // Keep the old section height so a short loader does not pull the page up.
    const hold = section.offsetHeight;
    section.innerHTML = profileSectionLoadingHtml();
    if (hold > 40) section.style.minHeight = hold + "px";
  }

  // Keep Hive's order. get_followers and get_following are already alphabetical.
  function followNamesFromRows(rows, kind, start) {
    const field = kind === "following" ? "following" : "follower";
    const skip = String(start || "").toLowerCase();
    const names = [];
    const list = Array.isArray(rows) ? rows : [];
    for (let i = 0; i < list.length; i++) {
      const name = String((list[i] && list[i][field]) || "")
        .replace(/^@/, "")
        .trim()
        .toLowerCase();
      if (!name || (skip && name === skip)) continue;
      names.push(name);
    }
    return names;
  }

  function followAccountHtml(name) {
    const safe = HiveMd.escapeHtml(name);
    const src = HiveMd.escapeHtml(HiveMd.avatarUrl(name, "small"));
    return `<a class="follow-account" href="${HiveMd.escapeHtml(profileHref(name))}"><img class="avatar" src="${src}" alt="" width="28" height="28"><span>@${safe}</span></a>`;
  }

  function peopleTitle(kind) {
    if (kind === "following") return "Following";
    if (kind === "subscribers") return "Subscribers";
    return "Followers";
  }

  function peopleQueryFromRaw(raw) {
    return String(raw || "")
      .trim()
      .replace(/^@+/, "")
      .toLowerCase()
      .replace(/[^a-z0-9.\-]/g, "")
      .slice(0, 16);
  }

  // Names are alphabetical. A query keeps names that start with it and stops
  // once a later name shows the prefix is finished.
  function peopleNamesForQuery(names, query) {
    const kept = [];
    let past = false;
    const q = query || "";
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      if (!q || name.indexOf(q) === 0) kept.push(name);
      else if (name > q) {
        past = true;
        break;
      }
    }
    return { kept, past };
  }

  // No Hive account can start with this text, so the open list cannot either.
  async function peoplePrefixExists(query, gen) {
    if (!query) return true;
    if (!/^[a-z][a-z0-9.\-]{0,15}$/.test(query)) return false;
    try {
      const found = await HiveApi.lookupAccounts(query, 1);
      if (peopleList.gen !== gen || !peopleList.open) return false;
      const name = String((found && found[0]) || "").toLowerCase();
      return name.indexOf(query) === 0;
    } catch (err) {
      if (peopleList.gen !== gen || !peopleList.open) return false;
      return true;
    }
  }

  function peopleEmptyHtml(kind, error, query) {
    if (!error) {
      if (query) return `<p class="people-empty">No matching usernames.</p>`;
      const note =
        kind === "following"
          ? "Not following anyone yet."
          : kind === "subscribers"
            ? "No subscribers yet."
            : "No followers yet.";
      return `<p class="people-empty">${note}</p>`;
    }
    const title =
      kind === "following"
        ? "Following unavailable"
        : kind === "subscribers"
          ? "Subscribers unavailable"
          : "Followers unavailable";
    return `<div class="panel empty-state"><h2>${HiveMd.escapeHtml(title)}</h2><p>${HiveMd.escapeHtml(error)}</p></div>`;
  }

  function peopleSubscriberNames(rows, cursor, seen) {
    const skip = String(cursor || "");
    const names = [];
    const list = Array.isArray(rows) ? rows : [];
    let last = "";
    for (let i = 0; i < list.length; i++) {
      const name = normalizeLoginUser(list[i] && list[i].name);
      if (name) last = name;
      if (!name || name === skip || seen.has(name) || isBlacklistedUser(name)) continue;
      seen.add(name);
      names.push(name);
    }
    return { names, last };
  }

  function paintPeopleList() {
    const list = document.getElementById("peopleList");
    const status = document.getElementById("peopleStatus");
    const more = document.getElementById("peopleMoreBtn");
    const state = peopleList;
    if (!list || !status) return;
    if (!state.names.length && !state.loading) {
      if (state.query && !state.done && !state.error) {
        list.className = "follow-list";
        list.innerHTML = "";
        status.className = "loading-row";
        status.hidden = false;
        status.innerHTML = state.holdAuto
          ? ""
          : `<span class="btn-loader" aria-hidden="true"></span> Loading…`;
        if (more) more.hidden = !state.holdAuto;
        return;
      }
      list.className = "";
      list.innerHTML = peopleEmptyHtml(state.kind, state.error, state.query);
      status.hidden = true;
      status.textContent = "";
      if (more) more.hidden = !state.error;
      return;
    }
    if (state.loading && !state.names.length) {
      list.className = "follow-list";
      list.innerHTML = "";
      status.className = "loading-row";
      status.hidden = false;
      status.innerHTML = `<span class="btn-loader" aria-hidden="true"></span> Loading…`;
      if (more) more.hidden = true;
      return;
    }
    if (list.className !== "follow-list") list.className = "follow-list";
    if (state.loading) {
      status.className = "loading-row is-feed-more";
      status.hidden = false;
      status.innerHTML = `<span class="btn-loader" aria-hidden="true"></span>`;
      if (more) more.hidden = true;
      return;
    }
    if (state.error) {
      status.className = "loading-row";
      status.hidden = false;
      status.textContent = state.error;
      if (more) more.hidden = false;
      return;
    }
    status.hidden = true;
    status.textContent = "";
    if (more) more.hidden = !(state.holdAuto && state.query && !state.done);
  }

  function appendPeopleAccounts(names) {
    const list = document.getElementById("peopleList");
    if (!list || !names.length) return;
    if (list.className !== "follow-list") {
      list.className = "follow-list";
      list.innerHTML = "";
    }
    list.insertAdjacentHTML("beforeend", names.map(followAccountHtml).join(""));
  }

  function peopleTailNearView() {
    const scroller = document.getElementById("peopleScroll");
    const list = document.getElementById("peopleList");
    if (!scroller || !list || !peopleList.open) return false;
    const items = list.querySelectorAll(".follow-account");
    if (!items.length) return false;
    const tail = items[Math.max(0, items.length - FEED_INFINITE_LEAD)];
    const rect = tail.getBoundingClientRect();
    const box = scroller.getBoundingClientRect();
    if (rect.height < 1) return false;
    return rect.top <= box.bottom + 280;
  }

  async function fillPeoplePage() {
    const state = peopleList;
    const gen = state.gen;
    const kind = state.kind;
    const id = state.id;
    if (!state.open || state.loading || state.done || state.holdAuto) return false;
    state.loading = true;
    state.error = "";
    paintPeopleList();
    const before = state.names.length;
    let failed = false;
    try {
      if (state.query && !state.cursor && !state.names.length && !state.prefixChecked) {
        state.prefixChecked = true;
        const exists = await peoplePrefixExists(state.query, gen);
        if (state.gen !== gen || !state.open) return false;
        if (!exists) state.done = true;
      }
      if (!state.done && kind === "subscribers") {
        let guard = 0;
        const pageGuard = state.query ? 1 : 30;
        while (guard++ < pageGuard && state.gen === gen && state.open && !state.done) {
          const previous = state.cursor;
          const rows = await HiveApi.listSubscribers(id, previous, COMMUNITY_SUBSCRIBER_PAGE);
          if (state.gen !== gen || !state.open) return false;
          setNodeLabel();
          const step = peopleSubscriberNames(rows, previous, state.seen);
          const picked = peopleNamesForQuery(step.names, state.query);
          for (let i = 0; i < picked.kept.length; i++) state.names.push(picked.kept[i]);
          if (step.last && step.last !== previous) state.cursor = step.last;
          if (
            picked.past ||
            !rows.length ||
            rows.length < COMMUNITY_SUBSCRIBER_PAGE ||
            !step.last ||
            step.last === previous
          ) {
            state.done = true;
          }
          if (picked.kept.length) {
            appendPeopleAccounts(picked.kept);
            break;
          }
        }
      } else if (!state.done) {
        const followLimit = state.query ? 1000 : FOLLOW_PAGE;
        const rows =
          kind === "following"
            ? await HiveApi.getFollowing(id, state.cursor, followLimit)
            : await HiveApi.getFollowers(id, state.cursor, followLimit);
        if (state.gen !== gen || !state.open) return false;
        setNodeLabel();
        const names = followNamesFromRows(rows, kind, state.cursor);
        const picked = peopleNamesForQuery(names, state.query);
        for (let i = 0; i < picked.kept.length; i++) state.names.push(picked.kept[i]);
        if (names.length) state.cursor = names[names.length - 1];
        if (picked.past || !rows.length || rows.length < followLimit || !names.length) state.done = true;
        appendPeopleAccounts(picked.kept);
      }
    } catch (err) {
      if (state.gen !== gen || !state.open) return false;
      failed = true;
      state.error = (err && err.message) || String(err);
      state.holdAuto = true;
    } finally {
      if (state.gen === gen) state.loading = false;
    }
    if (state.gen !== gen || !state.open) return false;
    paintPeopleList();
    if (failed || state.done) return false;
    if (state.query) return true;
    return state.names.length > before;
  }

  function peopleListNeedsMore() {
    const state = peopleList;
    if (!state.open || state.done || state.holdAuto || state.loading || !state.id) return false;
    if (state.query && state.names.length < 24) return true;
    return peopleTailNearView();
  }

  async function fillAndChainPeople() {
    const gen = peopleList.gen;
    if (peopleChainGen === gen) return;
    peopleChainGen = gen;
    try {
      let chain = await fillPeoplePage();
      let guard = 0;
      const guardLimit = peopleList.query ? (peopleList.kind === "subscribers" ? 80 : 40) : 12;
      while (
        chain &&
        guard++ < guardLimit &&
        peopleList.gen === gen &&
        peopleList.open &&
        peopleListNeedsMore()
      ) {
        chain = await fillPeoplePage();
      }
      if (
        peopleList.gen === gen &&
        peopleList.open &&
        peopleList.query &&
        !peopleList.done &&
        !peopleList.error &&
        peopleList.names.length < 24
      ) {
        peopleList.holdAuto = true;
        paintPeopleList();
      }
    } finally {
      if (peopleChainGen === gen) peopleChainGen = 0;
    }
  }

  function maybeLoadMorePeople() {
    if (!peopleListNeedsMore()) return;
    fillAndChainPeople();
  }

  function applyPeopleSearch(raw) {
    if (!peopleList.open) return;
    const next = peopleQueryFromRaw(raw);
    if (next === peopleList.query) return;
    if (peopleSearchTimer) {
      clearTimeout(peopleSearchTimer);
      peopleSearchTimer = 0;
    }
    peopleList.gen += 1;
    peopleList.query = next;
    peopleList.prefixChecked = false;
    peopleList.names = [];
    peopleList.seen = new Set();
    peopleList.cursor = "";
    peopleList.done = false;
    peopleList.loading = false;
    peopleList.holdAuto = false;
    peopleList.error = "";
    const list = document.getElementById("peopleList");
    if (list) {
      list.className = "follow-list";
      list.innerHTML = "";
    }
    const status = document.getElementById("peopleStatus");
    if (status) {
      status.hidden = false;
      status.className = "loading-row";
      status.innerHTML = `<span class="btn-loader" aria-hidden="true"></span> Loading…`;
    }
    const more = document.getElementById("peopleMoreBtn");
    if (more) more.hidden = true;
    const scroller = document.getElementById("peopleScroll");
    if (scroller) scroller.scrollTop = 0;
    fillAndChainPeople();
  }

  function schedulePeopleSearch(raw) {
    if (peopleSearchTimer) clearTimeout(peopleSearchTimer);
    const next = peopleQueryFromRaw(raw);
    if (!next || next === peopleList.query) {
      peopleSearchTimer = 0;
      if (next !== peopleList.query) applyPeopleSearch(raw);
      return;
    }
    peopleSearchTimer = setTimeout(() => {
      peopleSearchTimer = 0;
      applyPeopleSearch(raw);
    }, 200);
  }

  function peopleHistoryState(kind, id) {
    const prev = history.state && typeof history.state === "object" ? history.state : {};
    return Object.assign({}, prev, {
      peoplePanel: true,
      peopleKind: kind,
      peopleId: id,
    });
  }

  function closePeoplePanel(opts) {
    const skipHistory = !!(opts && opts.skipHistory);
    const overlayEl = $("#peopleOverlay");
    if (!peopleList.open) {
      if (overlayEl) overlayEl.hidden = true;
      return;
    }
    if (peopleSearchTimer) {
      clearTimeout(peopleSearchTimer);
      peopleSearchTimer = 0;
    }
    peopleList.gen += 1;
    peopleList.open = false;
    peopleList.kind = "";
    peopleList.id = "";
    peopleList.query = "";
    peopleList.prefixChecked = false;
    peopleList.names = [];
    peopleList.seen = new Set();
    peopleList.cursor = "";
    peopleList.done = true;
    peopleList.loading = false;
    peopleList.holdAuto = false;
    peopleList.error = "";
    const peopleSearch = document.getElementById("peopleSearch");
    if (peopleSearch) peopleSearch.value = "";
    if (overlayEl) overlayEl.hidden = true;
    paintPeopleCounts();
    if (peopleHistoryOn && !skipHistory) {
      peopleHistoryOn = false;
      peopleHistoryPop = true;
      history.back();
    }
  }

  function openPeoplePanel(kind, rawId, opts) {
    const id =
      kind === "subscribers"
        ? normalizeCommunityName(rawId)
        : String(rawId || "").replace(/^@/, "").trim().toLowerCase();
    if (!id) return;
    if (kind !== "followers" && kind !== "following" && kind !== "subscribers") return;
    const overlayEl = $("#peopleOverlay");
    if (!overlayEl) return;
    if (peopleSearchTimer) {
      clearTimeout(peopleSearchTimer);
      peopleSearchTimer = 0;
    }
    peopleList.gen += 1;
    peopleList.open = true;
    peopleList.kind = kind;
    peopleList.id = id;
    peopleList.query = "";
    peopleList.prefixChecked = false;
    peopleList.names = [];
    peopleList.seen = new Set();
    peopleList.cursor = "";
    peopleList.done = false;
    peopleList.loading = false;
    peopleList.holdAuto = false;
    peopleList.error = "";
    const peopleSearch = document.getElementById("peopleSearch");
    if (peopleSearch) peopleSearch.value = "";
    const title = $("#peopleTitle");
    if (title) title.textContent = peopleTitle(kind);
    const list = document.getElementById("peopleList");
    if (list) {
      list.className = "follow-list";
      list.innerHTML = "";
    }
    const status = document.getElementById("peopleStatus");
    if (status) {
      status.hidden = false;
      status.className = "loading-row";
      status.innerHTML = `<span class="btn-loader" aria-hidden="true"></span> Loading…`;
    }
    const more = document.getElementById("peopleMoreBtn");
    if (more) more.hidden = true;
    const scroller = document.getElementById("peopleScroll");
    if (scroller) scroller.scrollTop = 0;
    overlayEl.hidden = false;
    paintPeopleCounts();
    const opener = document.activeElement;
    if (opener && opener.closest && opener.closest("[data-people]")) opener.blur();
    if (opts && opts.fromHistory) {
      peopleHistoryOn = true;
    } else if (peopleHistoryOn) {
      history.replaceState(peopleHistoryState(kind, id), "", location.href);
    } else {
      history.pushState(peopleHistoryState(kind, id), "", location.href);
      peopleHistoryOn = true;
    }
    fillAndChainPeople();
  }

  // The page behind the panel does not scroll, so Space moves the name list.
  function scrollPeoplePanel(e) {
    const overlayEl = $("#peopleOverlay");
    if (!overlayEl || overlayEl.hidden || !peopleList.open) return false;
    if (e.altKey || e.ctrlKey || e.metaKey || e.isComposing) return false;
    const target = e.target;
    if (target && target.closest && target.closest("input, textarea, select, [contenteditable]")) return false;
    if (target && target.closest && target.closest("#peopleOverlay a, #peopleOverlay button")) return false;
    const scroller = document.getElementById("peopleScroll");
    if (!scroller) return false;
    e.preventDefault();
    const distance = Math.max(48, Math.round(scroller.clientHeight * 0.88));
    scroller.scrollBy(0, e.shiftKey ? -distance : distance);
    return true;
  }

  async function renderProfileSection(name, tab, pageLoad) {
    if (!profileRouteStill(name, tab)) return;
    if (tab === "wallet") {
      await fillProfileWallet(name, tab, pageLoad);
      return;
    }
    const status = $("#profileSectionStatus");
    if (status && profileRouteStill(name, tab)) status.remove();
    if (!profileRouteStill(name, tab)) return;
    await renderProfileFeed(name, tab);
  }

  // A page load reuses a fresh account snapshot, or waits for the boot load.
  // Opening the wallet later refreshes that snapshot before balances paint.
  async function resolveWalletBalances(name, pageLoad) {
    if (isOwnAuthor(name)) {
      if (pageLoad) {
        if (!accountStateFresh(name)) await loadAccountResources();
      } else {
        await loadAccountResources();
      }
      if (accountStateFresh(name)) {
        return HiveApi.walletFromAccount(accountState.account, accountState.props);
      }
    }
    return HiveApi.getWallet(name);
  }

  function isMissingAccountError(err) {
    const msg = (err && err.message) || String(err || "");
    return /account does not exist|invalid account name/i.test(msg);
  }

  function showMissingProfile(msg) {
    accountMenuSubNav = false;
    accountMenuProfile = false;
    document.body.classList.remove("is-account-sub");
    resetProfileState();
    clearError();
    document.body.classList.remove("is-profile");
    setPageMeta("Not found — CyberSpace77");
    view.innerHTML = notFoundHtml(msg || "Failed to load account.");
  }

  async function fillProfileWallet(name, tab, pageLoad) {
    let stakeRates = null;
    let stakeRatesReady = false;
    const ratesPromise = HiveApi.getStakeApr()
      .then(function (value) {
        stakeRates = value;
        return value;
      })
      .catch(function () {
        return null;
      })
      .then(function (value) {
        stakeRatesReady = true;
        return value;
      });
    let wallet = null;
    try {
      wallet = await resolveWalletBalances(name, pageLoad);
    } catch (err) {
      if (!profileRouteStill(name, tab)) return;
      showError(err.message || String(err));
    }
    if (!profileRouteStill(name, tab)) return;
    if (!wallet) {
      profileSectionHtml(
        `<div class="wallet-page"><div class="panel empty-state"><h2>Wallet unavailable</h2><p>Could not load balances for this account.</p></div></div>`
      );
      releaseProfileSectionHold();
      return;
    }
    if (stakeRatesReady && stakeRates) wallet.stakeApr = stakeRates;
    if (delegationView.account && delegationView.account !== wallet.name) clearDelegationView();
    delegationView.open = false;
    profileState.wallet = wallet;
    profileState.walletTx = blankWalletTx();
    profileSectionHtml(walletPageHtml(wallet, isOwnAuthor(name)));
    releaseProfileSectionHold();
    const historyPromise = loadMoreWalletHistory();
    if (!stakeRatesReady) {
      const loaded = await ratesPromise;
      if (profileRouteStill(name, tab) && profileState.wallet === wallet && loaded) {
        wallet.stakeApr = loaded;
        paintWalletApr(loaded);
      }
    }
    await historyPromise;
  }

  async function renderProfile(author, page) {
    const pageLoad = initialPageLoad;
    const name = String(author || "")
      .replace(/^@/, "")
      .toLowerCase();
    if (isBlacklistedUser(name)) {
      showMissingProfile("This user was blacklisted.");
      return;
    }
    const tab = normalizeProfilePage(page) || "posts";
    setProfileMeta(name, tab);
    const own = isOwnAuthor(name);
    if (profileBannerReady(name)) {
      profileState.page = tab;
      profileState.claimPending = false;
      claimAnimToken += 1;
      profileState.wallet = null;
      profileState.walletTx = null;
      setProfileMeta(name, tab, profileState.profile);
      paintProfileNavActive(tab);
      showProfileSectionLoading();
      try {
        await renderProfileSection(name, tab, pageLoad);
      } catch (err) {
        if (!profileRouteStill(name, tab)) return;
        showError(err.message || String(err));
      }
      return;
    }
    if (!(own && ownAccountReady(name))) {
      view.innerHTML = `<div class="loading-row"><span class="btn-loader" aria-hidden="true"></span> Loading @${HiveMd.escapeHtml(name)}…</div>`;
    }
    try {
      let profile = null;
      let power = null;
      if (own) {
        if (!ownAccountReady(name)) {
          await loadAccountResources();
          if (!profileRouteStill(name, tab)) return;
        }
        if (ownAccountReady(name)) {
          profile = profileFromAccountState();
          power = hivePowerFromAccount(accountState.account, accountState.props);
        }
      }
      if (!profile) {
        const [bridge, hp] = await Promise.all([
          HiveApi.getProfile(name, observer()),
          HiveApi.getHivePower(name).catch(() => null),
        ]);
        if (!profileRouteStill(name, tab)) return;
        profile = bridge;
        power = hp;
      }
      if (!profile || !profile.name) {
        showMissingProfile();
        return;
      }
      setNodeLabel();
      clearError();
      profileState.author = name;
      profileState.page = tab;
      profileState.profile = profile;
      profileState.followed = profileFollowed(profile);
      profileState.muted = profileMuted(profile);
      profileState.pending = false;
      profileState.mutePending = false;
      profileState.claimPending = false;
      claimAnimToken += 1;
      profileState.wallet = null;
      profileState.walletTx = null;
      const chrome = profileBannerHtml(name, profile, power) + profileNavHtml(name, tab);
      if (!profileRouteStill(name, tab)) return;
      setProfileMeta(name, tab, profile);
      view.innerHTML = chrome + `<div id="profileSection">${profileSectionLoadingHtml()}</div>`;

      if (own && accountState.user === name && accountState.account) {
        HiveApi.getProfile(name, observer())
          .then((bridge) => {
            if (profileState.author !== name) return;
            applyOwnProfileSocial(bridge);
          })
          .catch(() => {});
      }

      await renderProfileSection(name, tab, pageLoad);
    } catch (err) {
      if (!profileRouteStill(name, tab)) return;
      if (isMissingAccountError(err)) {
        showMissingProfile();
        return;
      }
      resetProfileState();
      showError(err.message || String(err));
      document.body.classList.remove("is-account-sub");
      setPageMeta("Not found — CyberSpace77");
      view.innerHTML = notFoundHtml("Could not load this account.");
    }
  }

  /* ─── Community ─── */
  function resetCommunityState() {
    communityState.name = "";
    communityState.info = null;
    communityState.subscribed = false;
    communityState.pending = false;
    closePeoplePanel();
    clearCommunityEditScratch();
  }

  function clearCommunityEditScratch() {
    communityEditDraft = null;
    communityEditBaseline = null;
    communityEditSettings = null;
    communityEditOwner = null;
    communityEditTags = [];
  }

  function communityTitleOf(info, name) {
    return (info && info.title) || name || "";
  }

  function communitySubscribed(info) {
    return Boolean(info && info.context && info.context.subscribed);
  }

  function communityNavHtml(name, page) {
    const items = [
      ["latest", "Latest", communityHref(name, "latest")],
      ["trending", "Trending", communityHref(name, "trending")],
      ["about", "About", communityHref(name, "about")],
      ["members", "Members", communityHref(name, "members")],
    ];
    return `
      <nav class="feed-nav community-nav" aria-label="Community">
        ${items
          .map(
            ([id, label, href]) =>
              `<a href="${href}" class="${id === page ? "is-active" : ""}">${label}</a>`
          )
          .join("")}
      </nav>
    `;
  }

  function communitySubscribeLabel() {
    if (communityState.pending) {
      return communityState.subscribed ? "Leaving…" : "Joining…";
    }
    return communityState.subscribed ? "Unsubscribe" : "Subscribe";
  }

  function communityMoreHtml(name, info) {
    const id = normalizeCommunityName(name);
    const edit = communityCanEdit(info)
      ? `<a class="profile-more-item" role="menuitem" href="${HiveMd.escapeHtml(communityHref(id, "edit"))}">Edit</a>`
      : "";
    return `
      <div class="profile-more">
        <button type="button" class="profile-more-btn" aria-label="More actions" aria-haspopup="menu" aria-expanded="false">\u00b7\u00b7\u00b7</button>
        <div class="profile-more-menu" role="menu" hidden>
          ${edit}
          <button type="button" class="profile-more-item community-write-btn" role="menuitem">Write a post</button>
          <a class="profile-more-item" role="menuitem" href="${HiveMd.escapeHtml(blockExplorerAccountUrl(id))}" target="_blank" rel="noopener noreferrer">Block Explorer</a>
        </div>
      </div>`;
  }

  function openCommunityPublish() {
    const name = normalizeCommunityName(communityState.name);
    if (!name) return;
    const title = communityTitleOf(communityState.info, name) || name;
    publishDestRequest = { name, title };
    if (parseRoute().name === "publish") {
      openPublishOverlay();
      return;
    }
    navigate(appHref("/publish"));
  }

  function communityKindLabel(typeId) {
    const id = communityTypeId(typeId);
    if (id === 2) return "journal";
    if (id === 3) return "council";
    return "";
  }

  function communityStatMarksHtml(info) {
    const nsfw = Boolean(info && info.is_nsfw);
    const kind = communityKindLabel(info && info.type_id);
    return (
      (nsfw ? `<span class="community-nsfw">nsfw</span>` : "") +
      (kind ? `<span class="community-kind">${kind}</span>` : "")
    );
  }

  // Keep nsfw before journal or council. Topic communities show neither word.
  function placeCommunityStatMarks(stats, info) {
    if (!stats) return;
    let nsfw = stats.querySelector(".community-nsfw");
    let kind = stats.querySelector(".community-kind");
    if (info && info.is_nsfw) {
      if (!nsfw) {
        nsfw = document.createElement("span");
        nsfw.className = "community-nsfw";
        nsfw.textContent = "nsfw";
      }
    } else if (nsfw) {
      nsfw.remove();
      nsfw = null;
    }
    const label = communityKindLabel(info && info.type_id);
    if (label) {
      if (!kind) {
        kind = document.createElement("span");
        kind.className = "community-kind";
      }
      kind.textContent = label;
    } else if (kind) {
      kind.remove();
      kind = null;
    }
    if (nsfw) stats.appendChild(nsfw);
    if (kind) stats.appendChild(kind);
  }

  function communitySubscriberCountHtml(info) {
    const name = String((info && info.name) || communityState.name || "");
    const id = normalizeCommunityName(name);
    const text = communityCountText(info && info.subscribers) + " subscribers";
    const active = peopleCountOpen("subscribers", id);
    return `<button type="button" class="community-sub-count${active ? " is-active" : ""}" data-people="subscribers" data-people-id="${HiveMd.escapeHtml(id)}" aria-expanded="${active ? "true" : "false"}">${text}</button>`;
  }

  function communityBannerHtml(info) {
    const name = String((info && info.name) || communityState.name || "");
    const title = communityTitleOf(info, name);
    const about = communityAboutText(info);
    const href = HiveMd.escapeHtml(communityHref(name));
    return `
      <div class="profile-banner community-banner">
        <div class="profile-head">
          <img class="avatar" src="${HiveMd.avatarUrl(name, "large")}" alt="">
          <div>
            <h1>${HiveMd.escapeHtml(title)}</h1>
            <p class="profile-handle"><a href="${href}">${HiveMd.escapeHtml(name)}</a></p>
            ${about ? `<p class="profile-about">${HiveMd.escapeHtml(about)}</p>` : ""}
            <div class="profile-stats">
              ${communitySubscriberCountHtml(info)}
              <span>${communityCountText(info && info.num_authors)} authors</span>
              ${communityStatMarksHtml(info)}
            </div>
            <div class="community-head-actions">
              <button type="button" class="btn-primary btn-compact community-sub-btn" data-community="${HiveMd.escapeHtml(name)}" data-subscribed="${communityState.subscribed ? "1" : "0"}"${communityState.pending ? " disabled" : ""}>${communitySubscribeLabel()}</button>
              ${communityMoreHtml(name, info)}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function paintCommunityChrome() {
    const btn = view.querySelector(".community-sub-btn");
    if (btn) {
      btn.disabled = communityState.pending;
      btn.textContent = communitySubscribeLabel();
      btn.setAttribute("data-subscribed", communityState.subscribed ? "1" : "0");
      btn.classList.toggle("is-joined", communityState.subscribed);
    }
    const count = view.querySelector(".community-sub-count");
    if (count && communityState.info) {
      count.textContent = communityCountText(communityState.info.subscribers) + " subscribers";
    }
  }

  function communityLangLabel(code) {
    const current = String(code || "").trim().toLowerCase();
    if (!current) return "";
    for (let i = 0; i < COMMUNITY_LANG_OPTIONS.length; i++) {
      if (COMMUNITY_LANG_OPTIONS[i][0] === current) return COMMUNITY_LANG_OPTIONS[i][1];
    }
    return current;
  }

  function communityAboutSection(title, bodyHtml) {
    return `<section><h2>${title}</h2>${bodyHtml}</section>`;
  }

  // Ecency and PeakD paint a subspace cover from the account profile
  // (images.hive.blog and images.ecency.com /u/<name>/cover). A stored
  // hivemind settings.cover_url is only a fallback when the profile has none.
  function communityCoverUrl(info, metadata) {
    const profile = metadata && metadata.profile;
    return communityAccountPicture(profile, "cover_image", communitySettingsObject(info), "cover_url");
  }

  function communityAccountPicture(profile, profileKey, settings, settingsKey) {
    const fromProfile = communityHttpUrl(
      profile && typeof profile[profileKey] === "string" ? profile[profileKey] : ""
    );
    if (fromProfile) return fromProfile;
    const raw = settings && settings[settingsKey];
    return communityHttpUrl(typeof raw === "string" ? raw : "") || "";
  }

  function communityAboutCoverHtml(url) {
    const text = communityHttpUrl(url);
    if (!text) return "";
    const src = HiveMd.proxyImage(text, 1280);
    return `<img class="community-about-cover" src="${HiveMd.escapeHtml(src)}" data-cover="${HiveMd.escapeHtml(text)}" alt="">`;
  }

  function bindCommunityAboutCover() {
    const img = view.querySelector(".community-about-cover");
    if (!img) return;
    img.addEventListener("error", () => {
      const raw = img.getAttribute("data-cover") || "";
      const current = img.getAttribute("src") || "";
      if (raw && current !== raw) {
        img.src = raw;
        return;
      }
      img.remove();
    });
  }

  // Description and rules come from the community. Language does too.
  // Beneficiary and preferred spaces (profile.topics) live on the subspace account
  async function communityAboutExtras(name, info) {
    const id = normalizeCommunityName(name);
    const settings = communitySettingsObject(info);
    let metadata = null;
    try {
      const rows = await HiveApi.getAccounts([id]);
      const account = rows && rows[0];
      if (account && normalizeCommunityName(account.name) === id) {
        metadata = metadataFromAccount(account);
      }
    } catch {
      metadata = null;
    }
    return {
      beneficiary: metadata
        ? communityBeneficiaryFields(metadata)
        : { beneficiary_account: "", beneficiary_percent: "" },
      tags: communityAboutTags(metadata, settings),
      cover: communityCoverUrl(info, metadata),
    };
  }

  function communityAboutHtml(info, extras) {
    const description = String((info && info.description) || "").trim();
    const rules = String((info && info.flag_text) || "").trim();
    const language = communityLangLabel(info && info.lang);
    const beneficiary = (extras && extras.beneficiary) || {};
    const account = beneficiary.beneficiary_account || "";
    const percent = beneficiary.beneficiary_percent || "";
    const tags = (extras && extras.tags) || [];
    const coverHtml = communityAboutCoverHtml(extras && extras.cover);
    const sections = [];
    if (description) {
      sections.push(
        communityAboutSection("About", `<div class="post-body">${HiveMd.renderMarkdown(description)}</div>`)
      );
    }
    if (rules) {
      sections.push(
        communityAboutSection("Rules", `<div class="post-body">${HiveMd.renderMarkdown(rules)}</div>`)
      );
    }
    if (tags.length) {
      sections.push(
        communityAboutSection("Preferred spaces", `<div class="tags">${tags.map(tagChipHtml).join("")}</div>`)
      );
    }
    if (language) {
      sections.push(
        communityAboutSection(
          "Language",
          `<div class="post-body"><p>${HiveMd.escapeHtml(language)}</p></div>`
        )
      );
    }
    if (account) {
      const href = HiveMd.escapeHtml(profilePath(account));
      const reward = HiveMd.escapeHtml(percent) + "%";
      const shareNote = percent
        ? `<div class="post-body"><p>This subspace asks for a ${reward} share on new posts.</p></div>`
        : "";
      sections.push(
        communityAboutSection(
          "Beneficiary",
          `<table class="community-about-beneficiary"><tbody><tr><td><a class="mention" href="${href}">@${HiveMd.escapeHtml(account)}</a></td><td>${reward}</td></tr></tbody></table>${shareNote}`
        )
      );
    }
    if (!sections.length) {
      return `
        <div class="community-panel community-about">
          ${coverHtml}
          <div class="panel empty-state">
            <h2>No about posted</h2>
            <p>This subspace has not published an about yet.</p>
          </div>
        </div>
      `;
    }
    return `<div class="community-panel community-about">${coverHtml}${sections.join("")}</div>`;
  }

  function communityMemberHtml(row, opts) {
    const name = normalizeLoginUser(row && row.name);
    if (!name) return "";
    const role = communityNormalizeRole(row && row.role);
    const title = String((row && row.title) || "").trim();
    const manage = Boolean(opts && opts.manage);
    const viewerRole = (opts && opts.viewerRole) || "";
    const viewer = (opts && opts.viewer) || "";
    const community = (opts && opts.community) || "";
    const section = (opts && opts.section) || "members";
    const typeId = Number(opts && opts.typeId);
    const canChange = manage && communityCanChangeRole(viewerRole, viewer, name, role, community);
    const canTitle = manage && communityCanEditTitle(viewerRole, viewer, name, role, community);
    const canApprove = manage && section === "subscriber" && typeId === 3 && role === "guest";
    const showActions = section !== "subscriber" && (manage || Boolean(opts && opts.actionsColumn));
    const safeName = HiveMd.escapeHtml(name);
    const safeTitle = HiveMd.escapeHtml(title);
    const safeRole = HiveMd.escapeHtml(role);
    // A subscription is not a role. The subscribers list is only the account,
    // plus Approve when a council still needs a mod to accept that guest.
    if (section === "subscriber") {
      const approve = canApprove
        ? `<button type="button" class="community-role-btn community-approve-btn" data-community-action="approve" data-account="${safeName}" data-title="${safeTitle}">Approve</button>`
        : "";
      return `<tr class="community-member" data-account="${safeName}" data-role="${safeRole}" data-title="${safeTitle}" data-section="subscriber">
        <td class="community-member-who">${authorLinkHtml(name, "small")}${approve}</td>
      </tr>`;
    }
    const roleCell = canApprove
      ? `<button type="button" class="community-role-btn community-approve-btn" data-community-action="approve" data-account="${safeName}" data-title="${safeTitle}">Approve</button>`
      : role === "guest"
        ? ""
        : safeRole;
    const actions = [];
    if (canChange) {
      actions.push(
        `<button type="button" class="community-role-btn community-role-remove btn-ghost" data-community-action="change" data-account="${safeName}" data-role="${safeRole}" data-title="${safeTitle}" aria-label="Change role">-</button>`
      );
    }
    const titleAttrs = `data-community-action="title" data-account="${safeName}" data-role="${safeRole}" data-title="${safeTitle}"`;
    const titleCell = canTitle
      ? title
        ? `<button type="button" class="community-title-btn" ${titleAttrs} aria-label="Edit role title">${safeTitle}</button>`
        : `<button type="button" class="community-role-btn community-role-edit" ${titleAttrs} aria-label="Edit role title">Edit</button>`
      : title
        ? safeTitle
        : "";
    const actionCell = showActions
      ? `<td class="community-member-actions">${
          actions.length ? `<div class="community-member-actions-inner">${actions.join("")}</div>` : ""
        }</td>`
      : "";
    return `<tr class="community-member" data-account="${safeName}" data-role="${safeRole}" data-title="${safeTitle}" data-section="${HiveMd.escapeHtml(section)}">
        <td class="community-member-who">${authorLinkHtml(name, "small")}</td>
        <td class="community-member-title">${titleCell}</td>
        <td class="community-member-role">${roleCell}</td>
        ${actionCell}
      </tr>`;
  }

  function communityTableHtml(bodyHtml, bodyId, withActions, kind) {
    const idAttr = bodyId ? ` id="${HiveMd.escapeHtml(bodyId)}"` : "";
    const flow = kind === "flow";
    const actionsCol = withActions ? `<col class="community-col-actions">` : "";
    const kindClass = kind === "team" ? " is-team" : flow ? " is-flow" : "";
    const cols = flow
      ? ""
      : `<colgroup>
            <col class="community-col-who">
            <col class="community-col-title">
            <col class="community-col-role">
            ${actionsCol}
          </colgroup>`;
    return `<div class="community-table-wrap">
        <table class="community-table${withActions ? " has-actions" : ""}${kindClass}">
          ${cols}
          <tbody${idAttr}>${bodyHtml || ""}</tbody>
        </table>
      </div>`;
  }

  function communityTeamRows(info) {
    const team = (info && Array.isArray(info.team) && info.team) || [];
    return team
      .map((row) => {
        if (Array.isArray(row)) {
          return { name: String(row[0] || ""), role: String(row[1] || ""), title: String(row[2] || "") };
        }
        if (row && typeof row === "object") {
          return {
            name: String(row.name || ""),
            role: String(row.role || ""),
            title: String(row.title || ""),
          };
        }
        return { name: "", role: "", title: "" };
      })
      .filter((row) => row.name);
  }

  function communityPageTitle(info, name, page) {
    const title = communityTitleOf(info, name);
    if (page === "about") return "About · " + title + " — CyberSpace77";
    if (page === "members") return "Members · " + title + " — CyberSpace77";
    if (page === "edit") return "Edit · " + title + " — CyberSpace77";
    return title + " — CyberSpace77";
  }

  // ISO 639-1 codes accepted by hivemind's updateProps lang field.
  const COMMUNITY_LANGS = (
    "ab,aa,af,ak,sq,am,ar,an,hy,as,av,ae,ay,az,bm,ba,eu,be,bn,bh,bi," +
    "bs,br,bg,my,ca,ch,ce,ny,zh,cv,kw,co,cr,hr,cs,da,dv,nl,dz,en,eo," +
    "et,ee,fo,fj,fi,fr,ff,gl,ka,de,el,gn,gu,ht,ha,he,hz,hi,ho,hu,ia," +
    "id,ie,ga,ig,ik,io,is,it,iu,ja,jv,kl,kn,kr,ks,kk,km,ki,rw,ky,kv," +
    "kg,ko,ku,kj,la,lb,lg,li,ln,lo,lt,lu,lv,gv,mk,mg,ms,ml,mt,mi,mr," +
    "mh,mn,na,nv,nd,ne,ng,nb,nn,no,ii,nr,oc,oj,cu,om,or,os,pa,pi,fa," +
    "pl,ps,pt,qu,rm,rn,ro,ru,sa,sc,sd,se,sm,sg,sr,gd,sn,si,sk,sl,so," +
    "st,es,su,sw,ss,sv,ta,te,tg,th,ti,bo,tk,tl,tn,to,tr,ts,tt,tw,ty," +
    "ug,uk,ur,uz,ve,vi,vo,wa,cy,wo,fy,xh,yi,yo,za"
  ).split(",");

  // Ecency's community settings list. Codes Hivemind does not accept are left out,
  // including Zulu (zu).
  const COMMUNITY_LANG_OPTIONS = [
    ["af", "Afrikaans"],
    ["sq", "Albanian"],
    ["am", "Amharic"],
    ["ar", "Arabic"],
    ["hy", "Armenian"],
    ["az", "Azerbaijani"],
    ["eu", "Basque"],
    ["be", "Belarusian"],
    ["bn", "Bengali"],
    ["bs", "Bosnian"],
    ["bg", "Bulgarian"],
    ["my", "Burmese"],
    ["ca", "Catalan"],
    ["ny", "Chewa"],
    ["zh", "Chinese"],
    ["co", "Corsican"],
    ["hr", "Croatian"],
    ["cs", "Czech"],
    ["da", "Danish"],
    ["nl", "Dutch"],
    ["en", "English"],
    ["eo", "Esperanto"],
    ["et", "Estonian"],
    ["fi", "Finnish"],
    ["fr", "French"],
    ["gl", "Galician"],
    ["ka", "Georgian"],
    ["de", "German"],
    ["el", "Greek"],
    ["gu", "Gujarati"],
    ["ht", "Haitian Creole"],
    ["ha", "Hausa"],
    ["he", "Hebrew"],
    ["hi", "Hindi"],
    ["hu", "Hungarian"],
    ["is", "Icelandic"],
    ["ig", "Igbo"],
    ["id", "Indonesian"],
    ["ga", "Irish"],
    ["it", "Italian"],
    ["ja", "Japanese"],
    ["jv", "Javanese"],
    ["kn", "Kannada"],
    ["kk", "Kazakh"],
    ["rw", "Kinyarwanda"],
    ["ko", "Korean"],
    ["ku", "Kurdish"],
    ["ky", "Kyrgyz"],
    ["lo", "Lao"],
    ["la", "Latin"],
    ["lv", "Latvian"],
    ["lt", "Lithuanian"],
    ["lb", "Luxembourgish"],
    ["mk", "Macedonian"],
    ["mg", "Malagasy"],
    ["ms", "Malay"],
    ["ml", "Malayalam"],
    ["mt", "Maltese"],
    ["mi", "Maori"],
    ["mr", "Marathi"],
    ["mn", "Mongolian"],
    ["ne", "Nepali"],
    ["nb", "Norwegian (Bokmål)"],
    ["ps", "Pashto"],
    ["fa", "Persian"],
    ["pl", "Polish"],
    ["pt", "Portuguese"],
    ["pa", "Punjabi (Gurmukhi)"],
    ["ro", "Romanian"],
    ["ru", "Russian"],
    ["sm", "Samoan"],
    ["sr", "Serbian"],
    ["sn", "Shona"],
    ["sd", "Sindhi"],
    ["si", "Sinhala"],
    ["sk", "Slovak"],
    ["sl", "Slovenian"],
    ["so", "Somali"],
    ["es", "Spanish"],
    ["su", "Sundanese"],
    ["sw", "Swahili"],
    ["sv", "Swedish"],
    ["tg", "Tajik"],
    ["ta", "Tamil"],
    ["tt", "Tatar"],
    ["te", "Telugu"],
    ["th", "Thai"],
    ["tr", "Turkish"],
    ["tk", "Turkmen"],
    ["uk", "Ukrainian"],
    ["ur", "Urdu"],
    ["ug", "Uyghur"],
    ["uz", "Uzbek"],
    ["vi", "Vietnamese"],
    ["cy", "Welsh"],
    ["xh", "Xhosa"],
    ["yi", "Yiddish"],
    ["yo", "Yoruba"],
    ["zu", "Zulu"],
  ].filter((row) => COMMUNITY_LANGS.indexOf(row[0]) !== -1);

  const COMMUNITY_MAX_SPACES = 20;

  function noteCommunityEditCommunity(id) {
    if (communityEditDraft && communityEditDraft.community !== id) communityEditDraft = null;
    if (communityEditBaseline && communityEditBaseline.community !== id) {
      communityEditBaseline = null;
      communityEditSettings = null;
    }
    if (communityEditOwner && communityEditOwner.community !== id) communityEditOwner = null;
  }

  function communityViewerRole(info) {
    const ctx = info && info.context;
    if (ctx && typeof ctx.role === "string" && ctx.role.trim()) {
      return ctx.role.trim().toLowerCase();
    }
    const user = observer();
    if (!user || !info) return "";
    const team = communityTeamRows(info);
    for (let i = 0; i < team.length; i++) {
      const name = String(team[i].name || "")
        .replace(/^@/, "")
        .toLowerCase();
      if (name && name === user) return String(team[i].role || "").trim().toLowerCase();
    }
    return "";
  }

  // update_community_props allows owner and admin. Moderators cannot edit.
  function communityCanEdit(info) {
    if (!observer()) return false;
    const role = communityViewerRole(info);
    return role === "owner" || role === "admin";
  }

  // Topic (type_id 1): anyone except a muted account. Journal (2) and council (3):
  // member, mod, admin, or owner. Guests are subscribed or not; they still cannot post.
  function communityAllowsPost(info) {
    if (!info || !observer()) return false;
    const typeId = Number(info.type_id);
    const role = communityViewerRole(info);
    if (role === "muted") return false;
    if (typeId === 1) return true;
    if (typeId === 2 || typeId === 3) {
      return role === "member" || role === "mod" || role === "admin" || role === "owner";
    }
    return false;
  }

  function communityPostDeniedMessage(info, fallbackTitle) {
    const title = String(
      (info && info.title) || fallbackTitle || (info && info.name) || "this subspace"
    ).trim();
    if (communityViewerRole(info) === "muted") return "You are muted in " + title + ".";
    const typeId = Number(info && info.type_id);
    if (typeId === 2 || typeId === 3) return "Only members can post in " + title + ".";
    return "You cannot post in " + title + ".";
  }

  function communityText(value) {
    return typeof value === "string" ? value : "";
  }

  function communitySettingsObject(info) {
    let raw = info && info.settings;
    if (typeof raw === "string") {
      const text = raw.trim();
      if (!text) return {};
      try {
        raw = JSON.parse(text);
      } catch {
        return {};
      }
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const settings = {};
    Object.keys(raw).forEach((key) => {
      if (key === "__proto__" || key === "constructor" || key === "prototype") return;
      settings[key] = raw[key];
    });
    return settings;
  }

  // account_update2 replaces posting_json_metadata. The owner custom JSON is
  // that object minus the picture, beneficiary, and preferred-space keys this
  // form writes itself. Legacy json_metadata is not included.
  function communityOwnerCustomObject(metadata) {
    const out = copyJsonKeys(metadata, { profile: true, beneficiary: true });
    const profile =
      metadata && metadata.profile && typeof metadata.profile === "object" && !Array.isArray(metadata.profile)
        ? metadata.profile
        : null;
    if (!profile) return out;
    const extra = copyJsonKeys(profile, {
      profile_image: true,
      cover_image: true,
      version: true,
      beneficiary: true,
      preferred_tags: true,
    });
    if (Object.keys(extra).length) out.profile = extra;
    return out;
  }

  function parseCommunityCustom(raw, label) {
    const text = String(raw || "").trim();
    if (!text) return {};
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(label + " custom settings are not valid JSON.");
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error(label + " custom settings must be a JSON object.");
    }
    const out = copyJsonKeys(data);
    if (out.profile && typeof out.profile === "object" && !Array.isArray(out.profile)) {
      out.profile = copyJsonKeys(out.profile);
    }
    return out;
  }

  function communityCustomText(raw, label) {
    try {
      return formatSettingsCustom(parseCommunityCustom(raw, label));
    } catch {
      const text = String(raw || "").trim();
      return text || "{}";
    }
  }

  function communitySameCustom(a, b) {
    try {
      return (
        JSON.stringify(parseCommunityCustom(a, "Custom")) === JSON.stringify(parseCommunityCustom(b, "Custom"))
      );
    } catch {
      return false;
    }
  }

  function communityCustomProblem(raw, label) {
    try {
      parseCommunityCustom(raw, label);
      return "";
    } catch (err) {
      return (err && err.message) || label + " custom settings are not valid JSON.";
    }
  }

  function communityStoredSettings(name) {
    if (
      communityEditSettings &&
      communityEditSettings.community === name &&
      communityEditSettings.settings &&
      typeof communityEditSettings.settings === "object" &&
      !Array.isArray(communityEditSettings.settings)
    ) {
      return communityEditSettings.settings;
    }
    if (communityState.name === name) return communitySettingsObject(communityState.info);
    return {};
  }

  function communityStoredPicture(stored, key) {
    const value = stored && stored[key];
    return typeof value === "string" ? value.trim() : "";
  }

  // Hivemind replaces the stored settings object. Subspace and cover pictures
  // belong on the account profile, so avatar_url and cover_url are rewritten
  // only when that subspace already stored them. Preferred spaces come from
  // the form when the subspace account loaded, and stay as stored otherwise.
  function communitySettingsPayload(fields, options) {
    const stored = (options && options.stored) || {};
    const settings = copyJsonKeys(stored, {
      preferred_tags: true,
    });
    let changed = false;
    [
      ["avatar_url", fields.avatar_url],
      ["cover_url", fields.cover_url],
    ].forEach((pair) => {
      const current = communityStoredPicture(stored, pair[0]);
      if (!current) return;
      // An empty settings object is rejected by hivemind, so a cleared
      // picture stays as an empty string instead of dropping the last key.
      settings[pair[0]] = pair[1] || "";
      if (current !== (pair[1] || "")) changed = true;
    });
    if (options && options.tagsFromForm) {
      const previous = Array.isArray(stored.preferred_tags) ? stored.preferred_tags : [];
      if (!communitySameTags(previous, fields.tags || [])) changed = true;
      if (fields.tags && fields.tags.length) settings.preferred_tags = fields.tags.slice();
      else delete settings.preferred_tags;
    } else if (Array.isArray(stored.preferred_tags)) {
      settings.preferred_tags = stored.preferred_tags.slice();
    }
    // Hivemind rejects an empty settings object. A cleared tag list is [].
    if (changed && !Object.keys(settings).length) settings.preferred_tags = [];
    return { settings: settings, changed: changed };
  }

  function communityHttpUrl(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    if (text.length >= 1024) return null;
    if (text.slice(0, 7) !== "http://" && text.slice(0, 8) !== "https://") return null;
    return text;
  }

  function communityPictureSrc(url) {
    const text = communityHttpUrl(url);
    if (!text) return "";
    return HiveMd.proxyImage(text, 960);
  }

  function communityTypeId(value) {
    const id = Number(value);
    return id === 1 || id === 2 || id === 3 ? id : 0;
  }

  function communityTypeNote(typeId) {
    if (typeId === 1) return "Anyone can post and comment, except a muted account.";
    if (typeId === 2) return "Only members can post. Guests can still comment.";
    if (typeId === 3) return "Only members can post or comment.";
    return "Topic, journal, and council decide who can post and comment.";
  }

  function communityOwnerReady(name) {
    return Boolean(
      communityEditOwner && communityEditOwner.community === name && communityEditOwner.loaded
    );
  }

  function communityPostingMetadata(account) {
    const posting = HiveMd.parseJsonMetadata(account && account.posting_json_metadata);
    if (!posting || typeof posting !== "object" || Array.isArray(posting)) return {};
    return posting;
  }

  function communityCloneObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    try {
      const cloned = JSON.parse(JSON.stringify(value));
      if (cloned && typeof cloned === "object" && !Array.isArray(cloned)) return cloned;
    } catch {
      return {};
    }
    return {};
  }

  function communityCollectTags(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    raw.forEach((item) => {
      const tag = normalizeTag(item);
      if (!isValidTag(tag) || out.indexOf(tag) !== -1 || out.length >= COMMUNITY_MAX_SPACES) return;
      out.push(tag);
    });
    return out;
  }

  function communityPreferredTags(metadata, settings) {
    const profile = metadata && metadata.profile;
    let raw = profile && profile.preferred_tags;
    if (!Array.isArray(raw)) raw = settings && settings.preferred_tags;
    return communityCollectTags(raw);
  }

  // About shows the subspace's own preferred spaces (tags), then hivemind's copy, then PeakD's profile.topics when neither of those is set.
  function communityAboutTags(metadata, settings) {
    const profile = metadata && metadata.profile;
    const own = profile && profile.preferred_tags;
    if (Array.isArray(own)) return communityCollectTags(own);
    const stored = settings && settings.preferred_tags;
    if (Array.isArray(stored)) return communityCollectTags(stored);
    return communityCollectTags(profile && profile.topics);
  }

  function communityBeneficiaryFields(metadata) {
    const profile =
      metadata && metadata.profile && typeof metadata.profile === "object" && !Array.isArray(metadata.profile)
        ? metadata.profile
        : null;
    const raw = (profile && profile.beneficiary) || (metadata && metadata.beneficiary) || null;
    const account = normalizeLoginUser(raw && raw.account);
    const weight = Number(raw && raw.weight);
    if (!validLoginUser(account) || !Number.isFinite(weight) || weight < 1 || weight > 10000) {
      return { beneficiary_account: "", beneficiary_percent: "" };
    }
    const percent = weight / 100;
    return {
      beneficiary_account: account,
      beneficiary_percent: Number.isInteger(percent) ? String(percent) : String(percent),
    };
  }

  function communityPercentText(value) {
    const text = String(value == null ? "" : value).trim();
    if (!text) return "";
    const n = Number(text);
    if (!Number.isFinite(n)) return text;
    const weight = Math.round(n * 100);
    if (weight < 1 || weight > 10000) return text;
    const percent = weight / 100;
    return Number.isInteger(percent) ? String(percent) : String(percent);
  }

  function communitySameTags(a, b) {
    const left = Array.isArray(a) ? a : [];
    const right = Array.isArray(b) ? b : [];
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i++) {
      if (left[i] !== right[i]) return false;
    }
    return true;
  }

  function communityEditFieldsFromInfo(info) {
    const settings = communitySettingsObject(info);
    const name = normalizeCommunityName((info && info.name) || communityState.name);
    const ready = communityOwnerReady(name);
    const metadata = ready ? communityEditOwner.metadata : null;
    const posting = ready && communityEditOwner.posting ? communityEditOwner.posting : null;
    const profile = metadata && metadata.profile;
    const avatar = communityAccountPicture(profile, "profile_image", settings, "avatar_url");
    const cover = communityAccountPicture(profile, "cover_image", settings, "cover_url");
    const beneficiary = metadata ? communityBeneficiaryFields(metadata) : { beneficiary_account: "", beneficiary_percent: "" };
    return {
      title: communityText(info && info.title),
      about: communityText(info && info.about),
      avatar_url: avatar,
      cover_url: cover,
      description: communityText(info && info.description),
      flag_text: communityText(info && info.flag_text),
      lang: communityText(info && info.lang).trim().toLowerCase(),
      nsfw: Boolean(info && info.is_nsfw),
      type_id: communityTypeId(info && info.type_id),
      beneficiary_account: beneficiary.beneficiary_account,
      beneficiary_percent: beneficiary.beneficiary_percent,
      tags: communityPreferredTags(metadata, settings),
      owner_custom: formatSettingsCustom(posting ? communityOwnerCustomObject(posting) : {}),
    };
  }

  function communityEditFieldsFor(info) {
    const id = normalizeCommunityName((info && info.name) || communityState.name);
    const user = observer();
    if (
      !communityEditBaseline ||
      communityEditBaseline.community !== id ||
      communityEditBaseline.user !== user
    ) {
      communityEditBaseline = Object.assign({ community: id, user }, communityEditFieldsFromInfo(info));
      communityEditSettings = { community: id, settings: communitySettingsObject(info) };
    }
    if (
      communityEditDraft &&
      communityEditDraft.community === id &&
      communityEditDraft.user === user
    ) {
      return communityEditDraft;
    }
    return communityEditBaseline;
  }

  function communityLangOptionsHtml(selected) {
    const current = String(selected || "").trim().toLowerCase();
    const rows = COMMUNITY_LANG_OPTIONS.slice().sort(
      (a, b) => a[1].localeCompare(b[1], "en") || a[0].localeCompare(b[0])
    );
    const known = rows.some((row) => row[0] === current);
    const esc = HiveMd.escapeHtml;
    let html = "";
    if (!known) {
      html += `<option value=""${current ? "" : " selected"}>Choose</option>`;
      if (current) html += `<option value="${esc(current)}" selected>${esc(current)}</option>`;
    }
    html += rows
      .map((row) => {
        const selectedAttr = row[0] === current ? " selected" : "";
        return `<option value="${esc(row[0])}"${selectedAttr}>${esc(row[1])}</option>`;
      })
      .join("");
    return html;
  }

  function communityTypeOptionsHtml(typeId) {
    const current = communityTypeId(typeId);
    let html = current ? "" : `<option value="" selected>Choose</option>`;
    html += [
      [1, "Topic"],
      [2, "Journal"],
      [3, "Council"],
    ]
      .map((row) => {
        const selected = row[0] === current ? " selected" : "";
        return `<option value="${row[0]}"${selected}>${row[1]}</option>`;
      })
      .join("");
    return html;
  }

  function communityTagChipsHtml() {
    const esc = HiveMd.escapeHtml;
    return communityEditTags
      .map(
        (tag) =>
          `<button type="button" class="publish-tag-chip" data-tag="${esc(tag)}">${esc(tag)} <span aria-hidden="true">×</span></button>`
      )
      .join("");
  }

  function communityEditFormHtml(fields) {
    const esc = HiveMd.escapeHtml;
    const avatarSrc = communityPictureSrc(fields.avatar_url) || AVATAR_DEFAULT_LARGE;
    const coverSrc = communityPictureSrc(fields.cover_url);
    const typeId = communityTypeId(fields.type_id);
    const ownerReady = communityOwnerReady(communityState.name);
    const ownerLock = ownerReady ? "" : " disabled";
    communityEditTags = Array.isArray(fields.tags) ? fields.tags.slice() : [];
    const account = esc(communityState.name || "");
    return `
      <div class="community-panel community-edit">
        <form class="settings-form" id="communityEditForm" autocomplete="off" novalidate>
          <h2 class="settings-section-title">Subspace Admin settings</h2>
          <div class="settings-field">
            <label class="settings-label" for="communityTitle">Title</label>
            <input id="communityTitle" name="title" type="text" maxlength="20" autocomplete="off" value="${esc(fields.title || "")}">
          </div>
          <div class="settings-field">
            <label class="settings-label" for="communityAbout">About</label>
            <textarea id="communityAbout" class="settings-about" name="about" rows="3" maxlength="120">${esc(fields.about || "")}</textarea>
          </div>
          <div class="settings-field">
            <label class="settings-label" for="communityDescription">Description</label>
            <textarea id="communityDescription" class="settings-about" name="description" rows="8" maxlength="1000">${esc(fields.description || "")}</textarea>
          </div>
          <div class="settings-field">
            <label class="settings-label" for="communityRules">Rules</label>
            <textarea id="communityRules" class="settings-about" name="flag_text" rows="8" maxlength="1000">${esc(fields.flag_text || "")}</textarea>
          </div>
          <div class="settings-field">
            <label class="settings-label" for="communityLang">Language</label>
            <select id="communityLang" name="lang">${communityLangOptionsHtml(fields.lang)}</select>
          </div>
          <div class="settings-field">
            <label class="settings-label" for="communityType">Subspace type</label>
            <select id="communityType" name="type_id">${communityTypeOptionsHtml(typeId)}</select>
            <p class="settings-note" id="communityTypeNote">${esc(communityTypeNote(typeId))}</p>
          </div>
          <div class="settings-field">
            <label class="settings-label settings-label-white" for="communityNsfw">NSFW</label>
            <label class="cyber-toggle">
              <input id="communityNsfw" name="is_nsfw" type="checkbox"${fields.nsfw ? " checked" : ""}>
              <span class="cyber-toggle-track" aria-hidden="true"></span>
              <span class="cyber-toggle-copy">
                <span class="cyber-toggle-title">NSFW</span>
                <span class="cyber-toggle-sub">Mark this subspace as not safe for work.</span>
              </span>
            </label>
          </div>
          <h2 class="settings-section-title settings-section-line"><span>Subspace Owner settings</span></h2>
          <p class="settings-note" id="communityOwnerNote">Posting key of ${account} required</p>
          <div class="settings-field">
            <label class="settings-label" for="communityAvatar">Subspace picture</label>
            <p class="settings-note">Avatar updates may take up to 10 minutes to appear due to caching.</p>
            <div class="settings-media">
              <img id="communityAvatarPreview" class="settings-avatar-preview" src="${esc(avatarSrc)}" alt="" width="72" height="72">
              <div class="settings-media-main">
                <input id="communityAvatar" name="avatar_url" type="text" inputmode="url" autocomplete="off" maxlength="1023" placeholder="https://" value="${esc(fields.avatar_url || "")}">
                <div class="settings-media-actions">
                  <button type="button" class="settings-upload" id="communityAvatarUpload">Upload</button>
                  <input id="communityAvatarFile" type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/bmp,image/svg+xml" hidden>
                </div>
              </div>
            </div>
          </div>
          <div class="settings-field">
            <label class="settings-label" for="communityCover">Cover picture</label>
            <p class="settings-note">Profile cover of this subspace account. Shown on the about page.</p>
            <img id="communityCoverPreview" class="settings-cover-preview" alt="" ${coverSrc ? `src="${esc(coverSrc)}"` : "hidden"}>
            <input id="communityCover" name="cover_url" type="text" inputmode="url" autocomplete="off" maxlength="1023" placeholder="https://" value="${esc(fields.cover_url || "")}">
            <div class="settings-media-actions">
              <button type="button" class="settings-upload" id="communityCoverUpload">Upload</button>
              <input id="communityCoverFile" type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/bmp,image/svg+xml" hidden>
            </div>
          </div>
          <div class="settings-field">
            <label class="settings-label" for="communityBeneficiary">Required beneficiary</label>
            <p class="settings-note">One account. Auto added to new posts in the subspace.</p>
            <div class="settings-beneficiary">
              <input id="communityBeneficiary" name="beneficiary" type="text" autocomplete="off" spellcheck="false" autocapitalize="off" maxlength="16" placeholder="username" value="${esc(fields.beneficiary_account || "")}"${ownerLock}>
              <div class="settings-weight">
                <input id="communityBeneficiaryPercent" name="beneficiary_percent" type="number" inputmode="decimal" min="0.01" max="100" step="0.01" autocomplete="off" placeholder="" value="${esc(fields.beneficiary_percent || "")}"${ownerLock}>
                <span class="settings-weight-unit">%</span>
              </div>
            </div>
          </div>
          <div class="settings-field">
            <div class="publish-tags-head">
              <label class="settings-label" for="communityTagInput">Preferred spaces</label>
              <span id="communityTagCount">${communityEditTags.length}/${COMMUNITY_MAX_SPACES}</span>
            </div>
            <p class="settings-note">Up to ${COMMUNITY_MAX_SPACES} tags.</p>
            <div class="publish-tags community-tags" id="communityTagsWrap">
              <div class="publish-tag-chips" id="communityTagChips">${communityTagChipsHtml()}</div>
              <input id="communityTagInput" type="text" maxlength="24" placeholder="${communityEditTags.length >= COMMUNITY_MAX_SPACES ? "Tag limit reached" : "Add a space"}" autocomplete="off" spellcheck="false"${ownerLock}${communityEditTags.length >= COMMUNITY_MAX_SPACES ? " disabled" : ""}>
            </div>
          </div>
          <div class="settings-field">
            <label class="settings-label" for="communityOwnerCustom">Custom</label>
            <p class="settings-note">Other settings stored on this subspace account. Expert mode (keep as is recommended).</p>
            <textarea id="communityOwnerCustom" class="settings-custom" name="owner_custom" rows="12" spellcheck="false"${ownerLock}>${esc(fields.owner_custom || "{}")}</textarea>
          </div>
          <div class="settings-actions">
            <button type="submit" class="btn-primary" id="communityEditSave">Save</button>
            <button type="button" class="btn-ghost" id="communityEditReset">Reset</button>
          </div>
          <p class="settings-status" id="communityEditStatus" role="status"></p>
        </form>
      </div>
    `;
  }

  function communityEditGuestHtml() {
    return `
      <div class="community-panel community-edit">
        <div class="panel empty-state">
          <h2>Log in to edit this subspace</h2>
          <p>Title, about, and pictures are stored on Hive.</p>
          <button type="button" class="btn-primary" id="communityEditLogin">Login</button>
        </div>
      </div>
    `;
  }

  function communityEditDeniedHtml() {
    return `
      <div class="community-panel community-edit">
        <div class="panel empty-state">
          <h2>Only the owner and admins can edit this subspace</h2>
          <p>An owner or an admin can change it.</p>
        </div>
      </div>
    `;
  }

  function communityEditBodyHtml(info) {
    if (!observer()) return communityEditGuestHtml();
    if (!communityCanEdit(info)) return communityEditDeniedHtml();
    return communityEditFormHtml(communityEditFieldsFor(info));
  }

  function readCommunityEditFields() {
    if (!$("#communityEditForm")) return null;
    return {
      title: ($("#communityTitle") && $("#communityTitle").value) || "",
      about: ($("#communityAbout") && $("#communityAbout").value) || "",
      avatar_url: ($("#communityAvatar") && $("#communityAvatar").value) || "",
      cover_url: ($("#communityCover") && $("#communityCover").value) || "",
      description: ($("#communityDescription") && $("#communityDescription").value) || "",
      flag_text: ($("#communityRules") && $("#communityRules").value) || "",
      lang: ($("#communityLang") && $("#communityLang").value) || "",
      nsfw: Boolean($("#communityNsfw") && $("#communityNsfw").checked),
      type_id: ($("#communityType") && $("#communityType").value) || "",
      beneficiary_account: ($("#communityBeneficiary") && $("#communityBeneficiary").value) || "",
      beneficiary_percent: ($("#communityBeneficiaryPercent") && $("#communityBeneficiaryPercent").value) || "",
      tags: communityEditTags.slice(),
      owner_custom: ($("#communityOwnerCustom") && $("#communityOwnerCustom").value) || "",
    };
  }

  function rememberCommunityEditDraft() {
    const user = observer();
    const fields = readCommunityEditFields();
    if (!user || !fields || !communityState.name) return;
    communityEditDraft = Object.assign({ community: communityState.name, user }, fields);
  }

  function writeCommunityEditFields(fields) {
    const set = (id, value) => {
      const el = $(id);
      if (el) el.value = value;
    };
    set("#communityTitle", fields.title || "");
    set("#communityAbout", fields.about || "");
    set("#communityAvatar", fields.avatar_url || "");
    set("#communityCover", fields.cover_url || "");
    set("#communityDescription", fields.description || "");
    set("#communityRules", fields.flag_text || "");
    set("#communityLang", fields.lang || "");
    set("#communityType", fields.type_id ? String(fields.type_id) : "");
    set("#communityBeneficiary", fields.beneficiary_account || "");
    set("#communityBeneficiaryPercent", fields.beneficiary_percent || "");
    set("#communityOwnerCustom", fields.owner_custom || "{}");
    const nsfw = $("#communityNsfw");
    if (nsfw) nsfw.checked = Boolean(fields.nsfw);
    const typeNote = $("#communityTypeNote");
    if (typeNote) typeNote.textContent = communityTypeNote(communityTypeId(fields.type_id));
    communityEditTags = Array.isArray(fields.tags) ? fields.tags.slice() : [];
    paintCommunityTags();
    paintCommunityPicture("avatar", fields.avatar_url || "");
    paintCommunityPicture("cover", fields.cover_url || "");
  }

  function setCommunityEditStatus(message, isError) {
    const el = $("#communityEditStatus");
    if (!el) return;
    el.textContent = message || "";
    el.classList.toggle("is-error", Boolean(isError) && Boolean(message));
  }

  function setCommunityEditLocked(locked) {
    const form = $("#communityEditForm");
    if (!form) return;
    form.querySelectorAll("input, textarea, select, button").forEach((el) => {
      el.disabled = locked;
    });
    if (!locked) paintCommunityTags();
  }

  function paintCommunityPicture(kind, url) {
    const src = communityPictureSrc(url);
    if (kind === "cover") {
      const img = $("#communityCoverPreview");
      if (!img) return;
      if (!src) {
        img.hidden = true;
        img.removeAttribute("src");
        return;
      }
      img.hidden = false;
      img.src = src;
      return;
    }
    const img = $("#communityAvatarPreview");
    if (!img) return;
    img.hidden = false;
    img.src = src || AVATAR_DEFAULT_LARGE;
  }

  function communityEditStill(name) {
    const route = parseRoute();
    return Boolean(
      route &&
        route.name === "community" &&
        route.page === "edit" &&
        normalizeCommunityName(route.community) === name &&
        communityState.name === name
    );
  }

  function bindCommunityPicture(kind) {
    const cover = kind === "cover";
    const input = $(cover ? "#communityCover" : "#communityAvatar");
    const file = $(cover ? "#communityCoverFile" : "#communityAvatarFile");
    const button = $(cover ? "#communityCoverUpload" : "#communityAvatarUpload");
    const preview = $(cover ? "#communityCoverPreview" : "#communityAvatarPreview");
    if (button && file) {
      button.addEventListener("click", () => {
        if (!communityEditBusy) file.click();
      });
    }
    if (file) {
      file.addEventListener("change", () => {
        const picked = file.files && file.files[0];
        file.value = "";
        if (picked) uploadCommunityPicture(kind, picked);
      });
    }
    if (input) {
      input.addEventListener("input", () => {
        paintCommunityPicture(kind, input.value);
        rememberCommunityEditDraft();
      });
    }
    if (preview) {
      preview.addEventListener("error", () => {
        const raw = communityHttpUrl(input && input.value) || "";
        const current = preview.getAttribute("src") || "";
        if (raw && current !== raw) {
          preview.hidden = false;
          preview.src = raw;
          return;
        }
        if (cover) {
          preview.hidden = true;
          preview.removeAttribute("src");
          return;
        }
        if (current !== AVATAR_DEFAULT_LARGE) preview.src = AVATAR_DEFAULT_LARGE;
      });
    }
  }

  function paintCommunityTags() {
    const chips = $("#communityTagChips");
    const count = $("#communityTagCount");
    const input = $("#communityTagInput");
    const ownerReady = communityOwnerReady(communityState.name);
    if (chips) chips.innerHTML = communityTagChipsHtml();
    if (count) count.textContent = communityEditTags.length + "/" + COMMUNITY_MAX_SPACES;
    if (input) {
      const full = communityEditTags.length >= COMMUNITY_MAX_SPACES;
      input.disabled = communityEditBusy || !ownerReady || full;
      input.placeholder = full ? "Tag limit reached" : "Add a space";
    }
    const account = $("#communityBeneficiary");
    const percent = $("#communityBeneficiaryPercent");
    const ownerCustom = $("#communityOwnerCustom");
    if (account) account.disabled = communityEditBusy || !ownerReady;
    if (percent) percent.disabled = communityEditBusy || !ownerReady;
    if (ownerCustom) ownerCustom.disabled = communityEditBusy || !ownerReady;
  }

  function addCommunityTag(raw) {
    const tag = normalizeTag(raw);
    if (!tag) return false;
    if (!communityOwnerReady(communityState.name)) return false;
    if (!isValidTag(tag)) {
      setCommunityEditStatus("Spaces use 2–24 letters, numbers, or hyphens.", true);
      return false;
    }
    if (communityEditTags.indexOf(tag) !== -1) return false;
    if (communityEditTags.length >= COMMUNITY_MAX_SPACES) {
      setCommunityEditStatus("Preferred spaces can include " + COMMUNITY_MAX_SPACES + " tags.", true);
      return false;
    }
    communityEditTags.push(tag);
    setCommunityEditStatus("", false);
    paintCommunityTags();
    rememberCommunityEditDraft();
    return true;
  }

  function takeCommunityTagsFromInput() {
    const input = $("#communityTagInput");
    if (!input || input.disabled) return;
    const parts = String(input.value || "").split(/[,\s]+/);
    input.value = "";
    parts.forEach((part) => addCommunityTag(part));
  }

  function bindCommunityTags() {
    const wrap = $("#communityTagsWrap");
    const input = $("#communityTagInput");
    if (wrap) {
      wrap.addEventListener("click", (e) => {
        const chip = e.target.closest(".publish-tag-chip");
        if (!chip || communityEditBusy || !communityOwnerReady(communityState.name)) return;
        e.preventDefault();
        const tag = chip.getAttribute("data-tag");
        communityEditTags = communityEditTags.filter((item) => item !== tag);
        paintCommunityTags();
        rememberCommunityEditDraft();
      });
    }
    if (input) {
      input.addEventListener("keydown", (e) => {
        if (e.key === " " || e.key === "Enter" || e.key === "," || e.key === "Tab") {
          if (e.key !== "Tab" || input.value.trim()) e.preventDefault();
          takeCommunityTagsFromInput();
          return;
        }
        if (e.key === "Backspace" && !input.value && communityEditTags.length && !input.disabled) {
          communityEditTags.pop();
          paintCommunityTags();
          rememberCommunityEditDraft();
        }
      });
    }
  }

  function bindCommunityEdit() {
    const login = $("#communityEditLogin");
    if (login) login.addEventListener("click", openLogin);
    const form = $("#communityEditForm");
    if (!form) return;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      saveCommunityEdit();
    });
    form.addEventListener("input", (e) => {
      const target = e.target;
      if (!target || target.id === "communityAvatar" || target.id === "communityCover") return;
      if (target.id === "communityTagInput") return;
      rememberCommunityEditDraft();
    });
    form.addEventListener("change", (e) => {
      const target = e.target;
      if (!target || target.id === "communityAvatar" || target.id === "communityCover") return;
      if (target.id === "communityType") {
        const note = $("#communityTypeNote");
        if (note) note.textContent = communityTypeNote(communityTypeId(target.value));
      }
      rememberCommunityEditDraft();
    });
    bindCommunityPicture("avatar");
    bindCommunityPicture("cover");
    bindCommunityTags();
    const reset = $("#communityEditReset");
    if (reset) {
      reset.addEventListener("click", () => {
        resetCommunityEdit();
      });
    }
  }

  function resetCommunityEdit() {
    const user = observer();
    const base = communityEditBaseline;
    if (communityEditBusy || !user || !base || base.user !== user || base.community !== communityState.name) return;
    writeCommunityEditFields(base);
    communityEditDraft = Object.assign({}, base);
    setCommunityEditStatus("", false);
  }

  function preparedCommunityEditFields(raw) {
    const tags = [];
    (Array.isArray(raw && raw.tags) ? raw.tags : []).forEach((item) => {
      const tag = normalizeTag(item);
      if (!isValidTag(tag) || tags.indexOf(tag) !== -1 || tags.length >= COMMUNITY_MAX_SPACES) return;
      tags.push(tag);
    });
    return {
      title: String((raw && raw.title) || "").trim(),
      about: String((raw && raw.about) || "").trim(),
      avatar_url: String((raw && raw.avatar_url) || "").trim(),
      cover_url: String((raw && raw.cover_url) || "").trim(),
      description: String((raw && raw.description) || "").trim(),
      flag_text: String((raw && raw.flag_text) || "").trim(),
      lang: String((raw && raw.lang) || "").trim().toLowerCase(),
      nsfw: Boolean(raw && raw.nsfw),
      type_id: communityTypeId(raw && raw.type_id),
      beneficiary_account: normalizeLoginUser(raw && raw.beneficiary_account),
      beneficiary_percent: communityPercentText(raw && raw.beneficiary_percent),
      tags: tags,
      owner_custom: String(raw && raw.owner_custom != null ? raw.owner_custom : "").trim(),
    };
  }

  function communityEditError(fields, ownerReady) {
    if (fields.title.length < 3 || fields.title.length > 20) return "Title must be 3 to 20 characters.";
    if (fields.title[0] === "@" || fields.title[0] === "#") return "Title cannot start with @ or #.";
    if (fields.about.length > 120) return "About must be 120 characters or fewer.";
    if (fields.description.length > 1000) return "Description must be 1000 characters or fewer.";
    if (fields.flag_text.length > 1000) return "Rules must be 1000 characters or fewer.";
    if (COMMUNITY_LANGS.indexOf(fields.lang) === -1) return "Choose a language.";
    if (!fields.type_id) return "Choose a subspace type.";
    if (communityHttpUrl(fields.avatar_url) === null) return "Subspace picture must be an http or https link.";
    if (communityHttpUrl(fields.cover_url) === null) return "Cover picture must be an http or https link.";
    if (ownerReady && (fields.beneficiary_account || fields.beneficiary_percent)) {
      if (!validLoginUser(fields.beneficiary_account)) return "Enter a Hive account for the required beneficiary.";
      const weight = Math.round(Number(fields.beneficiary_percent) * 100);
      if (!fields.beneficiary_percent || weight < 1 || weight > 10000) {
        return "Beneficiary percent must be between 0.01 and 100.";
      }
    }
    if (ownerReady && fields.tags.length > COMMUNITY_MAX_SPACES) {
      return "Preferred spaces can include " + COMMUNITY_MAX_SPACES + " tags.";
    }
    if (ownerReady) {
      const ownerCustom = communityCustomProblem(fields.owner_custom, "Owner");
      if (ownerCustom) return ownerCustom;
    }
    return "";
  }

  async function uploadCommunityPicture(kind, file) {
    const user = observer();
    const name = communityState.name;
    if (!user) {
      openLogin();
      return;
    }
    if (communityEditBusy) return;
    if (!isImageFile(file)) {
      setCommunityEditStatus("Choose an image file (png, jpg, gif, webp).", true);
      return;
    }
    if (!hasSigner(user)) {
      setCommunityEditStatus(signerNeededMessage(), true);
      return;
    }
    communityEditBusy = true;
    setCommunityEditLocked(true);
    setCommunityEditStatus(signingLabel("image"), false);
    try {
      const url = await uploadHiveImage(file, user);
      if (!communityEditStill(name)) return;
      const input = $(kind === "cover" ? "#communityCover" : "#communityAvatar");
      if (input) {
        input.value = url;
        paintCommunityPicture(kind, url);
        rememberCommunityEditDraft();
      }
      setCommunityEditStatus("Image uploaded.", false);
    } catch (err) {
      if (communityEditStill(name)) {
        setCommunityEditStatus((err && err.message) || "Image upload failed.", true);
      }
    } finally {
      communityEditBusy = false;
      if (communityEditStill(name)) setCommunityEditLocked(false);
    }
  }

  function paintCommunityEditBanner(fields, bustAvatar) {
    const banner = view && view.querySelector(".community-banner");
    if (!banner) return;
    const h1 = banner.querySelector("h1");
    if (h1) h1.textContent = fields.title || communityState.name;
    let aboutEl = banner.querySelector(".profile-about");
    if (fields.about) {
      if (!aboutEl) {
        aboutEl = document.createElement("p");
        aboutEl.className = "profile-about";
        const handle = banner.querySelector(".profile-handle");
        if (handle) handle.insertAdjacentElement("afterend", aboutEl);
      }
      if (aboutEl) aboutEl.textContent = fields.about;
    } else if (aboutEl) {
      aboutEl.remove();
    }
    placeCommunityStatMarks(banner.querySelector(".profile-stats"), {
      is_nsfw: fields.nsfw,
      type_id: fields.type_id,
    });
    if (bustAvatar) {
      const img = banner.querySelector(".avatar");
      if (img) {
        const src = HiveMd.avatarUrl(communityState.name, "large");
        img.src = src + (src.indexOf("?") < 0 ? "?v=" : "&v=") + Date.now();
      }
    }
  }

  function communityAdminChanged(fields, base) {
    return (
      fields.title !== base.title ||
      fields.about !== base.about ||
      fields.description !== base.description ||
      fields.flag_text !== base.flag_text ||
      fields.lang !== base.lang ||
      Boolean(fields.nsfw) !== Boolean(base.nsfw) ||
      Number(fields.type_id) !== Number(base.type_id)
    );
  }

  // images.hive.blog and images.ecency.com ignore posting_json_metadata
  // until profile.version is set, then they serve profile_image and cover_image.
  function communityProfileNeedsVersion() {
    if (!communityOwnerReady(communityState.name)) return false;
    const posting = communityEditOwner.posting;
    const profile = posting && posting.profile;
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) return false;
    return !profile.version;
  }

  function communityOwnerChanged(fields, base, ownerReady) {
    if (fields.avatar_url !== base.avatar_url || fields.cover_url !== base.cover_url) return true;
    if (communityProfileNeedsVersion()) return true;
    if (!ownerReady) return false;
    return (
      fields.beneficiary_account !== (base.beneficiary_account || "") ||
      fields.beneficiary_percent !== (base.beneficiary_percent || "") ||
      !communitySameTags(fields.tags, base.tags) ||
      !communitySameCustom(fields.owner_custom, base.owner_custom)
    );
  }

  function applyCommunityEditPart(fields, which) {
    const info = communityState.info;
    if (!info || !communityEditBaseline) return;
    if (which.admin) {
      info.title = fields.title;
      info.about = fields.about;
      info.lang = fields.lang;
      info.is_nsfw = Boolean(fields.nsfw);
      info.description = fields.description;
      info.flag_text = fields.flag_text;
      info.type_id = fields.type_id;
      paintCommunityEditBanner(fields, false);
      setCommunityMeta(communityState.name, "edit", info);
    }
    const storedBefore = communityStoredSettings(communityState.name);
    const ownerReadyNow = communityOwnerReady(communityState.name);
    if (which.settings) {
      info.settings = which.settings;
      communityEditSettings = { community: communityState.name, settings: which.settings };
    }
    if (which.owner && which.avatarChanged) paintCommunityEditBanner(fields, true);
    if (which.owner && communityEditOwner && communityEditOwner.community === communityState.name) {
      const posting =
        communityEditOwner.posting && typeof communityEditOwner.posting === "object" && !Array.isArray(communityEditOwner.posting)
          ? communityEditOwner.posting
          : {};
      if (!posting.profile || typeof posting.profile !== "object" || Array.isArray(posting.profile)) {
        posting.profile = {};
      }
      posting.profile.version = 2;
      if (fields.avatar_url) posting.profile.profile_image = fields.avatar_url;
      else if (ownerReadyNow || communityStoredPicture(storedBefore, "avatar_url")) delete posting.profile.profile_image;
      if (fields.cover_url) posting.profile.cover_image = fields.cover_url;
      else if (ownerReadyNow || communityStoredPicture(storedBefore, "cover_url")) delete posting.profile.cover_image;
      communityEditOwner.posting = posting;
    }
    const patch = {};
    if (which.admin) {
      patch.title = fields.title;
      patch.about = fields.about;
      patch.description = fields.description;
      patch.flag_text = fields.flag_text;
      patch.lang = fields.lang;
      patch.nsfw = Boolean(fields.nsfw);
      patch.type_id = fields.type_id;
    }
    if (which.owner) {
      patch.avatar_url = fields.avatar_url;
      patch.cover_url = fields.cover_url;
      patch.beneficiary_account = fields.beneficiary_account;
      patch.beneficiary_percent = fields.beneficiary_percent;
      patch.tags = fields.tags.slice();
      patch.owner_custom = communityCustomText(fields.owner_custom, "Owner");
      const ownerCustom = $("#communityOwnerCustom");
      if (ownerCustom) ownerCustom.value = patch.owner_custom;
    }
    const next = Object.assign({}, communityEditBaseline, patch);
    if (patch.tags) next.tags = patch.tags.slice();
    communityEditBaseline = next;
    const live = readCommunityEditFields();
    if (live) {
      communityEditDraft = Object.assign({ community: communityState.name, user: observer() }, live);
    }
  }

  // Beneficiary stored as posting_json_metadata.profile.beneficiary
  // as {account, weight} with weight in basis points. Preferred spaces are stored as profile.preferred_tags
  // and copied into hivemind settings. The subspace picture and cover are the
  // account profile_image and cover_image. Ecency's updateProfile and PeakD
  // both set profile.version to 2 so the image servers use that profile.
  // When the account loaded, the owner custom JSON is the rest of
  // posting_json_metadata, and an empty picture field clears that image.
  // When it did not, posting metadata is kept. An empty field clears an image
  // only when hivemind already showed that URL in the form. A picture that
  // stayed on the account and was never shown is left in place.
  function communityOwnerMetadata(baseMeta, fields, ownerReady, stored) {
    const source = ownerReady ? parseCommunityCustom(fields.owner_custom, "Owner") : baseMeta;
    const meta = communityCloneObject(source);
    if (ownerReady) {
      delete meta.beneficiary;
      if (meta.profile && typeof meta.profile === "object" && !Array.isArray(meta.profile)) {
        delete meta.profile.profile_image;
        delete meta.profile.cover_image;
        delete meta.profile.version;
        delete meta.profile.beneficiary;
        delete meta.profile.preferred_tags;
      }
    }
    if (!meta.profile || typeof meta.profile !== "object" || Array.isArray(meta.profile)) {
      meta.profile = {};
    }
    const profile = meta.profile;
    if (fields.avatar_url) profile.profile_image = fields.avatar_url;
    else if (ownerReady || communityStoredPicture(stored, "avatar_url")) delete profile.profile_image;
    if (fields.cover_url) profile.cover_image = fields.cover_url;
    else if (ownerReady || communityStoredPicture(stored, "cover_url")) delete profile.cover_image;
    profile.version = 2;
    if (ownerReady) {
      if (fields.beneficiary_account) {
        profile.beneficiary = {
          account: fields.beneficiary_account,
          weight: Math.round(Number(fields.beneficiary_percent) * 100),
        };
      } else {
        delete profile.beneficiary;
      }
      delete meta.beneficiary;
      if (fields.tags.length) profile.preferred_tags = fields.tags.slice();
      else delete profile.preferred_tags;
    }
    return meta;
  }

  async function communityOwnerOperations(name, fields, ownerReady) {
    const accounts = await HiveApi.getAccounts([name]);
    const account = accounts && accounts[0];
    if (!account || String(account.name || "").toLowerCase() !== name) {
      throw new Error("Could not load the subspace account.");
    }
    // Rebuild settings from the stored object instead of a fresh get_community.
    // Hivemind may not have reindexed an admin save from earlier in this submit.
    const stored = communityStoredSettings(name);
    const prepared = communitySettingsPayload(fields, {
      tagsFromForm: ownerReady,
      stored: stored,
    });
    const settings = prepared.settings;
    const metadata = communityOwnerMetadata(
      ownerReady ? null : communityPostingMetadata(account),
      fields,
      ownerReady,
      stored
    );
    let propsJson = "";
    let metaJson = "";
    try {
      propsJson = JSON.stringify(["updateProps", { community: name, props: { settings: settings } }]);
      metaJson = JSON.stringify(metadata);
    } catch {
      throw new Error("Could not prepare these settings.");
    }
    if (
      (prepared.changed && new TextEncoder().encode(propsJson).length > 8192) ||
      metaJson.length > SETTINGS_METADATA_MAX
    ) {
      throw new Error("These settings are too long to save.");
    }
    const operations = [];
    if (prepared.changed) {
      operations.push([
        "custom_json",
        {
          required_auths: [],
          required_posting_auths: [name],
          id: "community",
          json: propsJson,
        },
      ]);
    }
    operations.push([
      "account_update2",
      {
        account: name,
        json_metadata: "",
        posting_json_metadata: metaJson,
        extensions: [],
      },
    ]);
    return {
      settings: settings,
      settingsChanged: prepared.changed,
      operations: operations,
    };
  }

  function ownerSignOpen() {
    const el = $("#ownerSignOverlay");
    return Boolean(el && !el.hidden);
  }

  function setOwnerSignStatus(message, isError) {
    const status = $("#ownerSignStatus");
    if (!status) return;
    status.textContent = message || "";
    status.classList.toggle("is-error", Boolean(isError) && Boolean(message));
  }

  function ownerSignAuthority(opts) {
    const raw = String((opts && opts.authority) || "Posting")
      .trim()
      .toLowerCase();
    if (raw === "active") return "Active";
    if (raw === "owner") return "Owner";
    if (raw === "memo") return "Memo";
    return "Posting";
  }

  function ownerSignRoleName(authority) {
    if (authority === "Active") return "active";
    if (authority === "Owner") return "owner";
    if (authority === "Memo") return "memo";
    return "posting";
  }

  function ownerSignEnterPhrase(authority) {
    return "the " + ownerSignRoleName(authority) + " key";
  }

  function ownerSignDefaultLead(authority) {
    const role = ownerSignRoleName(authority);
    if (authority === "Posting") {
      return "Use hive keychain (recommended) or enter the posting key of this subspace account.";
    }
    return "Use hive keychain (recommended) or enter the " + role + " key.";
  }

  function applyOwnerSignChrome(opts) {
    const authority = ownerSignAuthority(opts);
    const role = ownerSignRoleName(authority);
    const title = $("#ownerSignTitle");
    const lead = $("#ownerSignLead");
    const label = $("#ownerSignKeyLabel");
    const hint = $("#ownerSignHint");
    const key = $("#ownerSignKey");
    const connect = $("#ownerSignConnect");
    if (title) title.textContent = (opts && opts.title) || "Sign owner settings";
    if (lead) lead.textContent = (opts && opts.lead) || ownerSignDefaultLead(authority);
    if (label) label.textContent = role.charAt(0).toUpperCase() + role.slice(1) + " key";
    if (hint) hint.textContent = "The " + role + " key is used once and is not saved.";
    if (key) key.placeholder = role + " key";
    if (connect) connect.textContent = (opts && opts.action) || "Sign";
    const method = $("#ownerSignMethod");
    if (method) method.hidden = false;
    setAuthMethod(method, opts ? ownerSignStartMethod() : defaultAuthMethod());
  }

  // A password login already chose that method. When the dialog asks that
  // same account for a key, start on Password. Keychain stays on the switch.
  // Signing a different account keeps the usual desktop Keychain default.
  function ownerSignStartMethod() {
    const account = normalizeLoginUser($("#ownerSignUser") && $("#ownerSignUser").value);
    if (account && observer() === account && window.HiveAuth && HiveAuth.hasKey(account)) {
      return "password";
    }
    return defaultAuthMethod();
  }

  function restoreOwnerSignCopy() {
    applyOwnerSignChrome(null);
  }

  function hideOwnerSign() {
    const el = $("#ownerSignOverlay");
    if (el) el.hidden = true;
    const key = $("#ownerSignKey");
    if (key) key.value = "";
    setOwnerSignStatus("", false);
    restoreOwnerSignCopy();
    ownerSignBusy = false;
    const connect = $("#ownerSignConnect");
    const cancel = $("#ownerSignCancel");
    if (connect) connect.disabled = false;
    if (cancel) cancel.disabled = false;
  }

  function requestKeychainBroadcast(username, operations, authority) {
    return new Promise((resolve, reject) => {
      const kc = window.hive_keychain;
      if (!kc || typeof kc.requestBroadcast !== "function") {
        reject(new Error("hive keychain is not available."));
        return;
      }
      kc.requestBroadcast(username, operations, authority, (res) => {
        if (res && res.success) {
          resolve(res);
          return;
        }
        const message = (res && (res.message || res.error)) || "Broadcast was cancelled.";
        const err = new Error(typeof message === "string" ? message : "Broadcast was cancelled.");
        const blob = String((res && res.error) || "") + " " + String((res && res.message) || "");
        if (/cancel/i.test(blob)) err.ownerCancel = true;
        reject(err);
      });
    });
  }

  // "posting" when the stored posting key can sign, "keychain" when this login
  // is Keychain for the same account, otherwise "".
  function signSessionKind(account, authority) {
    const name = normalizeLoginUser(account);
    if (!name) return "";
    if (keychainLoginActive() === name) return "keychain";
    if (authority === "Posting" && window.HiveAuth && HiveAuth.hasKey(name)) return "posting";
    return "";
  }

  function openOwnerSignDialog(name, operations, opts) {
    return new Promise((resolve, reject) => {
      const el = $("#ownerSignOverlay");
      const user = $("#ownerSignUser");
      if (!el || !user) {
        reject(new Error("Could not open the sign dialog."));
        return;
      }
      hideOwnerSign();
      user.value = name;
      applyOwnerSignChrome(opts);
      el.hidden = false;
      // Desktop focus stays on the account, or on the key when Password is
      // the selected method. Mobile leaves the inputs unfocused so the
      // keyboard stays closed.
      if (!isMobileViewport()) {
        const key = $("#ownerSignKey");
        if (authMethod($("#ownerSignMethod")) === "password" && key) key.focus();
        else user.focus();
      }
      ownerSignSession = {
        name,
        operations,
        resolve,
        reject,
        source: opts.source || "",
        authority: ownerSignAuthority(opts),
        failMessage: opts.failMessage || "",
        cancelMessage: opts.cancelMessage || "",
        mode: opts.mode === "decrypt" ? "decrypt" : "broadcast",
        memo: opts.mode === "decrypt" ? String(opts.memo || "") : "",
      };
    });
  }

  // One signer for subspace owner settings, role changes, creating a subspace,
  // wallet stake or unstake, delegations, and decrypting a transfer memo.
  // Pass the account, operations, authority, and the dialog copy. A login that
  // can already sign that authority does so without the dialog: a stored
  // posting key for Posting, or Hive Keychain for the role this login can
  // sign. Anything else opens the dialog with both Keychain and Password.
  // A stored posting key starts that dialog on Password when the account is
  // the signed-in user. The password field accepts that role key or the
  // master password. Decrypt mode resolves with the plaintext.
  function signWithDialog(name, operations, copy) {
    const opts = copy || {};
    const authority = ownerSignAuthority(opts);
    const mode = opts.mode === "decrypt" ? "decrypt" : "broadcast";
    const account = normalizeLoginUser(name);
    if (mode === "decrypt") {
      if (
        opts.preferKeychain !== false &&
        keychainLoginActive() === account &&
        keychainCanDecodeMemo()
      ) {
        return requestKeychainMemoDecode(account, String(opts.memo || ""));
      }
      return openOwnerSignDialog(name, operations, opts);
    }
    if (opts.authority) {
      const kind = signSessionKind(account, authority);
      if (kind === "posting") {
        if (!window.HiveAuth || typeof HiveAuth.broadcast !== "function") {
          return Promise.reject(new Error(opts.failMessage || "Could not sign."));
        }
        return HiveAuth.broadcast(account, operations);
      }
      if (kind === "keychain") {
        if (typeof opts.onKeychain === "function") opts.onKeychain();
        return requestKeychainBroadcast(account, operations, authority);
      }
      if (opts.requireSession) return Promise.reject(new Error(signerNeededMessage()));
    }
    return openOwnerSignDialog(name, operations, opts);
  }

  async function decryptOwnerSignMemo(session, method, secret) {
    if (method === "password") {
      setOwnerSignStatus("Decrypting…", false);
      if (!window.HiveAuth || typeof HiveAuth.decodeMemo !== "function") {
        secret = "";
        throw new Error("Could not decrypt with that key.");
      }
      const job = HiveAuth.decodeMemo(session.name, secret, session.memo);
      secret = "";
      return job;
    }
    secret = "";
    setOwnerSignStatus("Waiting for Keychain…", false);
    if (!keychainCanDecodeMemo()) {
      throw new Error("hive keychain is not available. Choose Password and enter the memo key.");
    }
    return requestKeychainMemoDecode(session.name, session.memo);
  }

  async function submitOwnerSign() {
    const session = ownerSignSession;
    if (!session || ownerSignBusy) return;
    const key = $("#ownerSignKey");
    const connect = $("#ownerSignConnect");
    const cancel = $("#ownerSignCancel");
    const roleName = ownerSignRoleName(session.authority);
    const method = authMethod($("#ownerSignMethod"));
    let secret = "";
    if (method === "password") {
      secret = (key && key.value) || "";
      if (!secret.replace(/\s+/g, "")) {
        if (key) key.value = "";
        secret = "";
        setOwnerSignStatus("Enter " + ownerSignEnterPhrase(session.authority) + ".", true);
        return;
      }
      if (key) key.value = "";
    } else if (!window.hive_keychain) {
      setOwnerSignStatus(
        "hive keychain is not available. Choose Password and enter the " + roleName + " key.",
        true
      );
      return;
    }
    ownerSignBusy = true;
    if (connect) connect.disabled = true;
    if (cancel) cancel.disabled = true;
    try {
      if (session.mode === "decrypt") {
        const decoded = await decryptOwnerSignMemo(session, method, secret);
        secret = "";
        const done = session;
        ownerSignSession = null;
        hideOwnerSign();
        done.resolve(decoded);
        return;
      }
      if (method === "password") {
        setOwnerSignStatus("Signing…", false);
        if (!window.HiveAuth || typeof HiveAuth.broadcastRoleSecret !== "function") {
          throw new Error("Could not sign with that key.");
        }
        const signJob = HiveAuth.broadcastRoleSecret(
          session.name,
          secret,
          session.authority,
          session.operations
        );
        secret = "";
        await signJob;
      } else {
        setOwnerSignStatus("Waiting for Keychain…", false);
        await requestKeychainBroadcast(session.name, session.operations, session.authority);
      }
      const done = session;
      ownerSignSession = null;
      hideOwnerSign();
      done.resolve();
    } catch (err) {
      setOwnerSignStatus((err && err.message) || session.failMessage || "Could not sign these settings.", true);
    } finally {
      secret = "";
      ownerSignBusy = false;
      if (ownerSignSession) {
        if (connect) connect.disabled = false;
        if (cancel) cancel.disabled = false;
      }
    }
  }

  function cancelOwnerSign() {
    if (ownerSignBusy) return;
    const session = ownerSignSession;
    ownerSignSession = null;
    hideOwnerSign();
    if (!session) return;
    const err = new Error(session.cancelMessage || "Owner settings were not signed.");
    err.ownerCancel = true;
    session.reject(err);
  }

  function communityOwnerHoldMessage(adminSaved, detail) {
    if (adminSaved && detail) return "Admin settings saved. " + detail;
    if (adminSaved) return "Admin settings saved. Owner settings were not signed.";
    return detail || "Owner settings were not signed.";
  }

  async function saveCommunityEdit() {
    if (communityEditBusy) return;
    const user = observer();
    const name = normalizeCommunityName(communityState.name);
    if (!user) {
      openLogin();
      return;
    }
    if (!name || !communityCanEdit(communityState.info)) return;
    const raw = readCommunityEditFields();
    if (!raw) return;
    const ownerReady = communityOwnerReady(name);
    const fields = preparedCommunityEditFields(raw);
    const problem = communityEditError(fields, ownerReady);
    if (problem) {
      setCommunityEditStatus(problem, true);
      return;
    }
    fields.avatar_url = communityHttpUrl(fields.avatar_url) || "";
    fields.cover_url = communityHttpUrl(fields.cover_url) || "";
    const base = communityEditBaseline;
    if (!base || base.community !== name || base.user !== user) return;
    const adminDirty = communityAdminChanged(fields, base);
    const ownerDirty = communityOwnerChanged(fields, base, ownerReady);
    writeCommunityEditFields(fields);
    rememberCommunityEditDraft();
    if (!adminDirty && !ownerDirty) {
      setCommunityEditStatus("Nothing to save.", false);
      return;
    }
    if (adminDirty && !hasSigner(user)) {
      setCommunityEditStatus(signerNeededMessage(), true);
      return;
    }
    if (adminDirty && (!window.ChainQueue || typeof ChainQueue.enqueue !== "function")) {
      setCommunityEditStatus("Could not save this subspace.", true);
      return;
    }
    let adminJson = "";
    if (adminDirty) {
      const props = {
        title: fields.title,
        about: fields.about,
        lang: fields.lang,
        is_nsfw: fields.nsfw,
        description: fields.description,
        flag_text: fields.flag_text,
        type_id: fields.type_id,
      };
      try {
        adminJson = JSON.stringify(["updateProps", { community: name, props: props }]);
      } catch {
        setCommunityEditStatus("Could not prepare these settings.", true);
        return;
      }
      if (new TextEncoder().encode(adminJson).length > 8192) {
        setCommunityEditStatus("These settings are too long to save.", true);
        return;
      }
    }
    communityEditBusy = true;
    setCommunityEditLocked(true);
    let adminSaved = false;
    try {
      if (adminDirty) {
        setCommunityEditStatus("Saving…", false);
        const queued = ChainQueue.enqueue({
          username: user,
          key: "Posting",
          operations: [
            [
              "custom_json",
              {
                required_auths: [],
                required_posting_auths: [user],
                id: "community",
                json: adminJson,
              },
            ],
          ],
          meta: { type: "community", action: "updateProps", community: name },
        });
        await queued.promise;
        if (communityState.name !== name || observer() !== user) return;
        adminSaved = true;
        applyCommunityEditPart(fields, { admin: true });
      }
      if (!ownerDirty) {
        if (communityEditStill(name)) setCommunityEditStatus("Saved.", false);
        return;
      }
      if (!communityEditStill(name) || observer() !== user) return;
      setCommunityEditStatus(adminSaved ? "Admin settings saved. Preparing owner settings…" : "Preparing owner settings…", false);
      let ownerOps;
      try {
        ownerOps = await communityOwnerOperations(name, fields, ownerReady);
      } catch (err) {
        if (communityEditStill(name)) {
          setCommunityEditStatus(
            communityOwnerHoldMessage(adminSaved, (err && err.message) || "Could not prepare the owner settings."),
            true
          );
        }
        return;
      }
      if (!communityEditStill(name) || observer() !== user) return;
      try {
        await signWithDialog(name, ownerOps.operations, {
          source: "owner",
          authority: "Posting",
          onKeychain: function () {
            if (communityEditStill(name)) setCommunityEditStatus("Waiting for Keychain…", false);
          },
        });
      } catch (err) {
        if (communityEditStill(name)) {
          const cancelled = Boolean(err && err.ownerCancel);
          const detail = cancelled ? "" : (err && err.message) || "Could not sign the owner settings.";
          setCommunityEditStatus(communityOwnerHoldMessage(adminSaved, detail), !cancelled);
        }
        return;
      }
      if (communityState.name !== name || observer() !== user) return;
      applyCommunityEditPart(fields, {
        owner: true,
        settings: ownerOps.settingsChanged ? ownerOps.settings : null,
        avatarChanged: fields.avatar_url !== (base.avatar_url || ""),
      });
      if (communityEditStill(name)) setCommunityEditStatus("Saved.", false);
    } catch (err) {
      if (communityEditStill(name)) {
        setCommunityEditStatus((err && err.message) || "Could not save this subspace.", true);
      }
    } finally {
      communityEditBusy = false;
      if (communityEditStill(name)) setCommunityEditLocked(false);
      if (!communityEditStill(name) && ownerSignOpen() && !ownerSignBusy) cancelOwnerSign();
    }
  }

  function toggleCommunitySubscription() {
    const user = observer();
    const name = communityState.name;
    if (!name) return;
    if (!user) {
      openLogin();
      return;
    }
    if (!hasSigner(user)) {
      showError(signerNeededMessage());
      return;
    }
    if (communityState.pending) return;
    const subscribe = !communityState.subscribed;
    const action = subscribe ? "subscribe" : "unsubscribe";
    communityState.pending = true;
    paintCommunityChrome();
    const { promise } = ChainQueue.enqueue({
      username: user,
      key: "Posting",
      operations: [
        [
          "custom_json",
          {
            required_auths: [],
            required_posting_auths: [user],
            id: "community",
            json: JSON.stringify([action, { community: name }]),
          },
        ],
      ],
      meta: { type: "community", action, community: name },
    });
    promise
      .then(() => {
        publishSubs = [];
        publishSubsUser = "";
        if (communityState.name !== name) return;
        communityState.subscribed = subscribe;
        if (communityState.info) {
          const n = Number(communityState.info.subscribers || 0);
          communityState.info.subscribers = Math.max(0, n + (subscribe ? 1 : -1));
          if (!communityState.info.context) communityState.info.context = {};
          communityState.info.context.subscribed = subscribe;
        }
        paintCommunityChrome();
      })
      .catch((err) => {
        if (communityState.name !== name) return;
        showError(err.message || String(err));
      })
      .finally(() => {
        if (communityState.name !== name) return;
        communityState.pending = false;
        paintCommunityChrome();
      });
  }

  const COMMUNITY_ROLE_RANK = { owner: 8, admin: 6, mod: 4, member: 2, guest: 0, muted: -2 };

  function communityNormalizeRole(role) {
    const key = String(role || "guest").trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(COMMUNITY_ROLE_RANK, key)) return key;
    return "guest";
  }

  function communityRoleRank(role) {
    return COMMUNITY_ROLE_RANK[communityNormalizeRole(role)];
  }

  function communityRoleLabel(role) {
    const raw = String(role || "").trim().toLowerCase();
    if (raw === "remove") return "Remove";
    const key = communityNormalizeRole(raw);
    if (key === "owner") return "Owner";
    if (key === "admin") return "Admin";
    if (key === "mod") return "Mod";
    if (key === "member") return "Member";
    if (key === "guest") return "Subscriber";
    return "Muted";
  }

  function communityRoleChoice(value) {
    const raw = String(value || "").trim().toLowerCase();
    return raw === "remove" ? "remove" : communityNormalizeRole(raw);
  }

  function communityCanManageMembers(info) {
    const role = communityViewerRole(info);
    return role === "owner" || role === "admin" || role === "mod";
  }

  // Hivemind only accepts a role below the signer's rank. Admin is included for
  // an admin viewer; that change is signed by the subspace owner.
  function communityAssignableRoles(viewerRole) {
    if (viewerRole === "owner" || viewerRole === "admin") return ["admin", "mod", "member", "muted"];
    if (viewerRole === "mod") return ["member", "muted"];
    return [];
  }

  // Remove is a dialog choice, not a Hivemind role. It broadcasts setRole guest.
  function communityRoleIsRemovable(role) {
    const key = communityNormalizeRole(role);
    return key === "admin" || key === "mod" || key === "member" || key === "muted";
  }

  function communityRoleChoices(viewerRole, mode, currentRole) {
    const roles = communityAssignableRoles(viewerRole).slice();
    if (mode === "change" && communityRoleIsRemovable(currentRole)) roles.push("remove");
    return roles;
  }

  function communityCanChangeRole(viewerRole, viewer, target, targetRole, communityName) {
    if (!communityAssignableRoles(viewerRole).length) return false;
    const account = normalizeLoginUser(target);
    const actor = normalizeLoginUser(viewer);
    const community = normalizeLoginUser(communityName);
    if (!account || !actor) return false;
    if (community && account === community) return false;
    if (communityRoleRank(targetRole) >= 8) return false;
    // An admin can demote or remove themself. Hivemind only accepts that from a
    // higher rank, so the subspace account signs it.
    if (account === actor) return viewerRole === "admin" && communityNormalizeRole(targetRole) === "admin";
    const targetRank = communityRoleRank(targetRole);
    const viewerRank = communityRoleRank(viewerRole);
    if (targetRank > viewerRank) return false;
    if (targetRank === viewerRank) return viewerRole === "admin" && communityNormalizeRole(targetRole) === "admin";
    return true;
  }

  function communityCanEditTitle(viewerRole, viewer, target, targetRole, communityName) {
    if (communityRoleRank(viewerRole) < 4) return false;
    const account = normalizeLoginUser(target);
    const actor = normalizeLoginUser(viewer);
    const community = normalizeLoginUser(communityName);
    if (!account || !actor) return false;
    if (account === actor) return true;
    if ((community && account === community) || communityRoleRank(targetRole) >= 8) return viewerRole === "owner";
    return communityCanChangeRole(viewerRole, actor, account, targetRole, community);
  }

  // Assigning admin, or changing an admin (including the signed-in admin),
  // is signed by the subspace account.
  function communityRoleNeedsOwner(viewerRole, currentRole, nextRole) {
    if (viewerRole === "owner") return false;
    const next = communityNormalizeRole(nextRole);
    const current = communityNormalizeRole(currentRole);
    if (next === "admin") return true;
    return viewerRole === "admin" && current === "admin";
  }

  function communityCustomOp(signer, action, payload) {
    return [
      "custom_json",
      {
        required_auths: [],
        required_posting_auths: [signer],
        id: "community",
        json: JSON.stringify([action, payload]),
      },
    ];
  }

  function communityMemberSelector(account, section) {
    const name = normalizeLoginUser(account);
    if (!name) return "";
    const safe = window.CSS && CSS.escape ? CSS.escape(name) : name;
    let sel = 'tr.community-member[data-account="' + safe + '"]';
    if (section) {
      const safeSection = window.CSS && CSS.escape ? CSS.escape(section) : section;
      sel += '[data-section="' + safeSection + '"]';
    }
    return sel;
  }

  function communityMemberRows(account) {
    const selector = communityMemberSelector(account);
    return selector ? Array.from(document.querySelectorAll(selector)) : [];
  }

  // A subscribed owner, admin, mod, or member has a role row and a subscriber row.
  // Role lookups use the role row. Guest subscribers have only the subscriber row.
  function communityListedRole(account) {
    const rows = communityMemberRows(account);
    let row = null;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].getAttribute("data-section") !== "subscriber") {
        row = rows[i];
        break;
      }
      if (!row) row = rows[i];
    }
    if (row) {
      return {
        role: communityNormalizeRole(row.getAttribute("data-role")),
        title: row.getAttribute("data-title") || "",
      };
    }
    const key = normalizeLoginUser(account);
    const team = communityTeamRows(communityState.info);
    for (let i = 0; i < team.length; i++) {
      if (normalizeLoginUser(team[i].name) === key) {
        return {
          role: communityNormalizeRole(team[i].role),
          title: String(team[i].title || ""),
        };
      }
    }
    return { role: "guest", title: "" };
  }

  function communityUpdateTeamEntry(account, role, title) {
    const info = communityState.info;
    if (!info) return;
    if (!Array.isArray(info.team)) info.team = [];
    const key = normalizeLoginUser(account);
    const nextRole = communityNormalizeRole(role);
    const nextTitle = String(title || "");
    const keep = communityRoleRank(nextRole) >= 4;
    let found = false;
    const next = [];
    info.team.forEach((row) => {
      const parsed = communityTeamRows({ team: [row] })[0];
      if (!parsed || normalizeLoginUser(parsed.name) !== key) {
        next.push(row);
        return;
      }
      found = true;
      if (!keep) return;
      if (Array.isArray(row)) next.push([key, nextRole, nextTitle]);
      else next.push(Object.assign({}, row, { name: key, role: nextRole, title: nextTitle }));
    });
    if (!found && keep) next.push([key, nextRole, nextTitle]);
    info.team = next;
  }

  function communityMembersStill(name) {
    const route = parseRoute();
    return Boolean(
      communityMemberContext &&
        communityMemberContext.name === name &&
        communityState.name === name &&
        route &&
        route.name === "community" &&
        normalizeCommunityPage(route.page) === "members"
    );
  }

  const COMMUNITY_PEOPLE_SECTIONS = ["owner", "admin", "mod", "member", "subscriber", "muted"];

  function communitySectionId(role) {
    const key = communityNormalizeRole(role);
    if (key === "owner" || key === "admin" || key === "mod" || key === "member" || key === "muted") return key;
    return "subscriber";
  }

  function communitySectionTitle(section) {
    if (section === "owner") return "Owner";
    if (section === "admin") return "Admins";
    if (section === "mod") return "Mods";
    if (section === "member") return "Members";
    if (section === "muted") return "Muted";
    return "Subscribers";
  }

  function communitySectionListId(section) {
    if (section === "owner") return "communityOwnerList";
    if (section === "admin") return "communityAdminList";
    if (section === "mod") return "communityModList";
    if (section === "member") return "communityMemberList";
    if (section === "muted") return "communityMutedList";
    return "communitySubscriberList";
  }

  function communityPeopleSectionDomId(section) {
    if (section === "owner") return "communityOwnerSection";
    if (section === "admin") return "communityAdminSection";
    if (section === "mod") return "communityModSection";
    if (section === "member") return "communityMemberSection";
    if (section === "muted") return "communityMutedSection";
    return "communitySubscriberSection";
  }

  // On a narrow screen these sections share the admin row: role beside the name,
  // title on the next line, and the taller padding. Subscribers stay a name list.
  function communitySectionIsTeam(section) {
    return section === "owner" || section === "admin" || section === "mod" || section === "member" || section === "muted";
  }

  function communityAddLead(role) {
    const raw = String(role || "").trim().toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(COMMUNITY_ROLE_RANK, raw)) return "Add an account and choose a role.";
    const section = communitySectionId(raw);
    if (section === "admin") return "Add an account as an admin.";
    if (section === "mod") return "Add an account as a mod.";
    if (section === "member") return "Add an account as a member.";
    if (section === "muted") return "Add an account as muted.";
    if (section === "subscriber") return "Add an account as a subscriber.";
    return "Add an account and choose a role.";
  }

  function communitySectionHasRows(section) {
    const list = $("#" + communitySectionListId(section));
    return Boolean(list && list.querySelector("tr.community-member"));
  }

  // Managers always see every category. Everyone else only sees a category that has people.
  function communitySyncPeopleSections() {
    const ctx = communityMemberContext;
    if (!ctx) return;
    let any = false;
    COMMUNITY_PEOPLE_SECTIONS.forEach((section) => {
      const el = $("#" + communityPeopleSectionDomId(section));
      if (!el) return;
      const has = communitySectionHasRows(section);
      if (has) any = true;
      el.hidden = ctx.manage ? false : !has;
    });
    const empty = $("#communityPeopleEmpty");
    if (empty) empty.hidden = Boolean(ctx.manage) || !ctx.done || any;
  }

  function communityPeopleSectionHtml(section, bodyHtml, ctx) {
    const title = communitySectionTitle(section);
    const role = section === "subscriber" ? "guest" : section;
    const canAdd = Boolean(ctx && ctx.manage) && communityAssignableRoles(ctx.viewerRole).indexOf(role) !== -1;
    const hidden = ctx && ctx.manage ? "" : bodyHtml ? "" : " hidden";
    const note =
      section === "subscriber" && Number(ctx && ctx.typeId) === 3
        ? `<p class="community-people-note">Subscribers stay guests until a mod approves them as members.</p>`
        : "";
    const add = canAdd
      ? `<button type="button" class="btn-ghost btn-compact" data-community-add="${HiveMd.escapeHtml(role)}" aria-label="Add to ${HiveMd.escapeHtml(title)}">Add</button>`
      : "";
    const flow = section === "subscriber";
    const kind = flow ? "flow" : communitySectionIsTeam(section) ? "team" : "";
    return `<section class="community-people-section" id="${communityPeopleSectionDomId(section)}"${hidden}>
        <div class="community-people-head">
          <h2>${title}</h2>
          ${add}
        </div>
        ${note}
        ${communityTableHtml(bodyHtml, communitySectionListId(section), Boolean(ctx && ctx.manage) && !flow, kind)}
        <div class="community-section-more">
          <div class="loading-row" data-community-loading="${section}" hidden><span class="btn-loader" aria-hidden="true"></span> Loading…</div>
          <div class="feed-actions">
            <button type="button" class="btn-primary" data-community-more="${section}" aria-label="Load more ${HiveMd.escapeHtml(title)}" hidden>Load more</button>
          </div>
        </div>
      </section>`;
  }

  function placeCommunityMemberRow(name, html, listId) {
    const list = listId ? $("#" + listId) : null;
    if (!list) return;
    const selector = communityMemberSelector(name);
    const row = selector ? list.querySelector(selector) : null;
    if (row) row.outerHTML = html;
    else {
      const empty = list.querySelector("tr.community-table-empty");
      if (empty) empty.remove();
      list.insertAdjacentHTML("beforeend", html);
    }
  }

  function communityRowSection(row) {
    if (!row) return "";
    return row.getAttribute("data-section") || communitySectionId(row.getAttribute("data-role"));
  }

  // `opts.subscribed` forces the subscriber row on or off. When it is omitted,
  // a subscriber row that is already on screen stays, including after a mute.
  function paintCommunityMember(account, role, title, opts) {
    const ctx = communityMemberContext;
    const name = normalizeLoginUser(account);
    if (!ctx || !name) return;
    if (isBlacklistedUser(name)) {
      communityMemberRows(name).forEach((row) => row.remove());
      communitySyncPeopleSections();
      return;
    }
    const nextRole = communityNormalizeRole(role);
    const nextTitle = String(title || "");
    communityUpdateTeamEntry(name, nextRole, nextTitle);
    const roleSection = communitySectionId(nextRole);
    const rows = communityMemberRows(name);
    const hadSubscriber = rows.some((row) => communityRowSection(row) === "subscriber");
    const explicit = Boolean(opts && Object.prototype.hasOwnProperty.call(opts, "subscribed"));
    const subscribed = explicit ? Boolean(opts.subscribed) : hadSubscriber || Boolean(ctx.subscribed && ctx.subscribed.has(name));
    if (explicit && ctx.subscribed) {
      if (opts.subscribed) ctx.subscribed.add(name);
      else ctx.subscribed.delete(name);
    }
    const showSubscriber = subscribed;
    rows.forEach((row) => {
      const section = communityRowSection(row);
      const keepRole = section === roleSection && roleSection !== "subscriber";
      const keepSub = section === "subscriber" && showSubscriber;
      if (!keepRole && !keepSub) row.remove();
    });
    function paintOne(section) {
      const html = communityMemberHtml(
        { name, role: nextRole, title: nextTitle },
        Object.assign({}, ctx, { section })
      );
      placeCommunityMemberRow(name, html, communitySectionListId(section));
    }
    if (roleSection !== "subscriber") paintOne(roleSection);
    if (showSubscriber) paintOne("subscriber");
    communitySyncPeopleSections();
  }

  function dropCommunityMember(account) {
    const name = normalizeLoginUser(account);
    if (!name) return;
    communityUpdateTeamEntry(name, "guest", "");
    if (communityMemberContext && communityMemberContext.subscribed) communityMemberContext.subscribed.delete(name);
    communityMemberRows(name).forEach((row) => row.remove());
    communitySyncPeopleSections();
  }

  // After the signed-in admin changes their own role, the members page and the
  // Edit item follow the new rank. The action column stays so the table does not shift.
  function communityApplyViewerRole(role) {
    const next = communityNormalizeRole(role);
    const info = communityState.info;
    if (info) {
      if (!info.context || typeof info.context !== "object") info.context = {};
      info.context.role = next;
    }
    const ctx = communityMemberContext;
    if (ctx) {
      ctx.viewerRole = next;
      ctx.manage = next === "owner" || next === "admin" || next === "mod";
    }
    closeProfileMore();
    const more = view.querySelector(".community-head-actions .profile-more");
    if (more && info) {
      const wrap = document.createElement("div");
      wrap.innerHTML = communityMoreHtml((info && info.name) || (ctx && ctx.name) || "", info);
      const fresh = wrap.firstElementChild;
      if (fresh) more.replaceWith(fresh);
    }
    if (!ctx) return;
    const root = $("#communityMembers");
    if (root) {
      root.querySelectorAll("tr.community-member").forEach((row) => {
        const table = row.closest("table");
        const account = row.getAttribute("data-account");
        const rowRole = communityNormalizeRole(row.getAttribute("data-role"));
        const title = row.getAttribute("data-title") || "";
        const section = communityRowSection(row);
        const html = communityMemberHtml(
          { name: account, role: rowRole, title },
          Object.assign({}, ctx, {
            section,
            actionsColumn: Boolean(table && table.classList.contains("has-actions")),
          })
        );
        if (html) row.outerHTML = html;
      });
      COMMUNITY_PEOPLE_SECTIONS.forEach((section) => {
        const head = document.querySelector("#" + communityPeopleSectionDomId(section) + " .community-people-head");
        if (!head) return;
        const sectionRole = section === "subscriber" ? "guest" : section;
        const canAdd = ctx.manage && communityAssignableRoles(ctx.viewerRole).indexOf(sectionRole) !== -1;
        const existing = head.querySelector("[data-community-add]");
        if (canAdd && !existing) {
          const title = communitySectionTitle(section);
          head.insertAdjacentHTML(
            "beforeend",
            `<button type="button" class="btn-ghost btn-compact" data-community-add="${HiveMd.escapeHtml(sectionRole)}" aria-label="Add to ${HiveMd.escapeHtml(title)}">Add</button>`
          );
        } else if (!canAdd && existing) existing.remove();
      });
    }
    communitySyncPeopleSections();
  }

  async function communityAccountSubscribed(account, community) {
    const name = normalizeLoginUser(account);
    const id = normalizeCommunityName(community);
    if (!name || !id || !window.HiveApi || typeof HiveApi.listAllSubscriptions !== "function") return false;
    const list = await HiveApi.listAllSubscriptions(name);
    for (let i = 0; i < list.length; i++) {
      if (normalizeCommunityName(list[i] && list[i].name) === id) return true;
    }
    return false;
  }

  function setCommunityPeopleStatus(message, isError) {
    const status = $("#communityPeopleStatus");
    if (!status) return;
    const text = message || "";
    status.hidden = !text;
    status.textContent = text;
    status.classList.toggle("is-error", Boolean(isError) && Boolean(text));
  }

  function setCommunityDialogStatus(id, message, isError) {
    const status = $(id);
    if (!status) return;
    status.textContent = message || "";
    status.classList.toggle("is-error", Boolean(isError) && Boolean(message));
  }

  function setCommunityMemberControlsLocked(locked) {
    const root = $("#communityMembers");
    if (!root) return;
    root.querySelectorAll("button").forEach((btn) => {
      if (locked) {
        if (!btn.disabled) btn.setAttribute("data-role-lock", "1");
        btn.disabled = true;
      } else if (btn.getAttribute("data-role-lock") === "1") {
        btn.removeAttribute("data-role-lock");
        btn.disabled = false;
      }
    });
  }

  function setCommunityRoleDialogLocked(locked) {
    const save = $("#communityRoleSave");
    const cancel = $("#communityRoleCancel");
    const user = $("#communityRoleUser");
    const select = $("#communityRoleSelect");
    if (save) save.disabled = locked;
    if (cancel) cancel.disabled = locked;
    if (user) user.disabled = locked;
    if (select) select.disabled = locked;
  }

  function setCommunityTitleDialogLocked(locked) {
    const save = $("#communityTitleSave");
    const cancel = $("#communityTitleCancel");
    const input = $("#communityTitleInput");
    if (save) save.disabled = locked;
    if (cancel) cancel.disabled = locked;
    if (input) input.disabled = locked;
  }

  function communityRoleDialogOpen() {
    const el = $("#communityRoleOverlay");
    return Boolean(el && !el.hidden);
  }

  function communityTitleDialogOpen() {
    const el = $("#communityTitleOverlay");
    return Boolean(el && !el.hidden);
  }

  function dismissCommunityRoleDialog() {
    const el = $("#communityRoleOverlay");
    if (el) el.hidden = true;
    communityRoleSession = null;
    setCommunityDialogStatus("#communityRoleStatus", "", false);
    setCommunityRoleDialogLocked(false);
  }

  function dismissCommunityTitleDialog() {
    const el = $("#communityTitleOverlay");
    if (el) el.hidden = true;
    communityTitleSession = null;
    setCommunityDialogStatus("#communityTitleStatus", "", false);
    setCommunityTitleDialogLocked(false);
  }

  function invalidateCommunityRoleWork() {
    communityRoleToken += 1;
    dismissCommunityRoleDialog();
    dismissCommunityTitleDialog();
  }

  function paintCommunityRoleHint() {
    const hint = $("#communityRoleHint");
    const select = $("#communityRoleSelect");
    const user = $("#communityRoleUser");
    const ctx = communityMemberContext;
    if (!hint || !select || !ctx) return;
    const choice = communityRoleChoice(select.value);
    const removing = choice === "remove";
    const next = removing ? "guest" : choice;
    const account = normalizeLoginUser(user && user.value);
    const current = account ? communityListedRole(account).role : "guest";
    const needsOwner = next !== current && communityRoleNeedsOwner(ctx.viewerRole, current, next);
    hint.textContent = needsOwner ? "The owner account " + ctx.name + " must sign this." : "";
  }

  function openCommunityRoleDialog(opts) {
    if (communityRoleBusy || !communityMemberContext || !communityMemberContext.manage) return;
    const ctx = communityMemberContext;
    const roles = communityAssignableRoles(ctx.viewerRole);
    const el = $("#communityRoleOverlay");
    const user = $("#communityRoleUser");
    const select = $("#communityRoleSelect");
    const heading = $("#communityRoleTitle");
    const lead = $("#communityRoleLead");
    if (!roles.length || !el || !user || !select) return;
    dismissCommunityTitleDialog();
    const mode = opts && opts.mode === "change" ? "change" : "add";
    const account = mode === "change" ? normalizeLoginUser(opts && opts.account) : "";
    const role = communityNormalizeRole(opts && opts.role);
    communityRoleSession = { mode, account, role, title: String((opts && opts.title) || "") };
    if (heading) heading.textContent = mode === "add" ? "Add user" : "Change role";
    if (lead) {
      lead.textContent =
        mode === "add"
          ? communityAddLead(opts && opts.role)
          : "Choose a role.";
    }
    user.readOnly = mode === "change";
    user.disabled = false;
    user.value = account;
    select.disabled = false;
    const choices = communityRoleChoices(ctx.viewerRole, mode, role);
    select.innerHTML = choices
      .map((item) => `<option value="${item}">${HiveMd.escapeHtml(communityRoleLabel(item))}</option>`)
      .join("");
    select.value = roles.indexOf(role) !== -1 ? role : roles.indexOf("member") !== -1 ? "member" : roles[0];
    setCommunityDialogStatus("#communityRoleStatus", "", false);
    paintCommunityRoleHint();
    el.hidden = false;
    if (mode === "add") user.focus();
    else select.focus();
  }

  function openCommunityTitleDialog(opts) {
    if (communityRoleBusy || !communityMemberContext || !communityMemberContext.manage) return;
    const account = normalizeLoginUser(opts && opts.account);
    const el = $("#communityTitleOverlay");
    const user = $("#communityTitleUser");
    const input = $("#communityTitleInput");
    if (!account || !el || !user || !input) return;
    dismissCommunityRoleDialog();
    communityTitleSession = {
      account,
      role: communityNormalizeRole(opts && opts.role),
      title: String((opts && opts.title) || ""),
    };
    user.value = account;
    input.disabled = false;
    input.value = communityTitleSession.title;
    setCommunityDialogStatus("#communityTitleStatus", "", false);
    el.hidden = false;
    input.focus();
    input.select();
  }

  function communityCleanTitle(value) {
    const title = String(value == null ? "" : value).trim();
    if (title.length > 32) return { error: "Title must be 32 characters or less.", title: "" };
    return { error: "", title };
  }

  async function submitCommunityRole() {
    if (communityRoleBusy || !communityRoleSession || !communityMemberContext) return;
    const ctx = communityMemberContext;
    const session = communityRoleSession;
    const token = communityRoleToken;
    const userInput = $("#communityRoleUser");
    const select = $("#communityRoleSelect");
    const account = normalizeLoginUser(userInput && userInput.value);
    const choice = communityRoleChoice(select && select.value);
    const removing = choice === "remove";
    const nextRole = removing ? "guest" : choice;
    if (!validLoginUser(account)) {
      setCommunityDialogStatus("#communityRoleStatus", "Enter a Hive account name.", true);
      if (userInput && !userInput.readOnly) userInput.focus();
      return;
    }
    const listed = communityListedRole(account);
    if (communityRoleChoices(ctx.viewerRole, session.mode, listed.role).indexOf(choice) === -1) {
      setCommunityDialogStatus(
        "#communityRoleStatus",
        removing || nextRole === "guest" ? "Only that account can subscribe or leave." : "You cannot change that role.",
        true
      );
      return;
    }
    if (account === ctx.name) {
      setCommunityDialogStatus("#communityRoleStatus", "The subspace account is the owner.", true);
      return;
    }
    if (
      account === ctx.viewer &&
      !communityCanChangeRole(ctx.viewerRole, ctx.viewer, account, listed.role, ctx.name)
    ) {
      setCommunityDialogStatus("#communityRoleStatus", "You cannot change your own role.", true);
      return;
    }
    if (listed.role === nextRole) {
      setCommunityDialogStatus("#communityRoleStatus", "That role is already set.", true);
      return;
    }
    if (!communityCanChangeRole(ctx.viewerRole, ctx.viewer, account, listed.role, ctx.name)) {
      setCommunityDialogStatus("#communityRoleStatus", "You cannot change that role.", true);
      return;
    }
    const needsOwner = communityRoleNeedsOwner(ctx.viewerRole, listed.role, nextRole);
    if (!ctx.viewer) {
      openLogin();
      return;
    }
    if (!needsOwner && !hasSigner(ctx.viewer)) {
      setCommunityDialogStatus("#communityRoleStatus", signerNeededMessage(), true);
      return;
    }
    communityRoleBusy = true;
    setCommunityRoleDialogLocked(true);
    setCommunityMemberControlsLocked(true);
    try {
      let canonical = account;
      if (session.mode === "add") {
        setCommunityDialogStatus("#communityRoleStatus", "Checking account…", false);
        let rows;
        try {
          rows = await HiveApi.getAccounts([account]);
        } catch (err) {
          throw new Error((err && err.message) || "Could not look up that account.");
        }
        if (token !== communityRoleToken || !communityMembersStill(ctx.name)) return;
        const found = (rows || []).find((row) => row && normalizeLoginUser(row.name) === account);
        if (!found) throw new Error("No such account.");
        canonical = normalizeLoginUser(found.name);
      }
      if (token !== communityRoleToken || !communityMembersStill(ctx.name)) return;
      const fresh = communityListedRole(canonical);
      if (communityRoleChoices(ctx.viewerRole, session.mode, fresh.role).indexOf(choice) === -1) {
        throw new Error(
          removing || nextRole === "guest" ? "Only that account can subscribe or leave." : "You cannot change that role."
        );
      }
      if (fresh.role === nextRole) throw new Error("That role is already set.");
      if (!communityCanChangeRole(ctx.viewerRole, ctx.viewer, canonical, fresh.role, ctx.name)) {
        throw new Error("You cannot change that role.");
      }
      const needs = communityRoleNeedsOwner(ctx.viewerRole, fresh.role, nextRole);
      const opSigner = needs ? ctx.name : ctx.viewer;
      const op = communityCustomOp(opSigner, "setRole", {
        community: ctx.name,
        account: canonical,
        role: nextRole,
      });
      dismissCommunityRoleDialog();
      setCommunityPeopleStatus(needs ? "Waiting for the owner signature…" : "Saving…", false);
      if (needs) {
        await signWithDialog(ctx.name, [op], {
          source: "role",
          authority: "Posting",
          title: "Sign owner change",
          lead: "The owner account must sign this role change. Use hive keychain or enter the posting key of this subspace account.",
          cancelMessage: "The owner did not sign this change.",
          failMessage: "Could not sign this role change.",
          onKeychain: function () {
            setCommunityPeopleStatus("Waiting for Keychain…", false);
          },
        });
      } else {
        if (!window.ChainQueue || typeof ChainQueue.enqueue !== "function") {
          throw new Error("Could not sign this role change.");
        }
        const queued = ChainQueue.enqueue({
          username: opSigner,
          key: "Posting",
          operations: [op],
          meta: { type: "community", action: "setRole", community: ctx.name },
        });
        await queued.promise;
      }
      if (token !== communityRoleToken || !communityMembersStill(ctx.name)) return;
      if (removing) {
        let subscribed = false;
        try {
          subscribed = await communityAccountSubscribed(canonical, ctx.name);
        } catch {
          subscribed = false;
        }
        if (token !== communityRoleToken || !communityMembersStill(ctx.name)) return;
        if (subscribed) paintCommunityMember(canonical, "guest", fresh.title, { subscribed: true });
        else dropCommunityMember(canonical);
      } else {
        paintCommunityMember(canonical, nextRole, fresh.title);
      }
      if (canonical === normalizeLoginUser(ctx.viewer)) {
        communityApplyViewerRole(removing ? "guest" : nextRole);
      }
      setCommunityPeopleStatus("Saved.", false);
    } catch (err) {
      if (token !== communityRoleToken || !communityMembersStill(ctx.name)) return;
      const message = (err && err.message) || "Could not change that role.";
      if (communityRoleDialogOpen()) setCommunityDialogStatus("#communityRoleStatus", message, true);
      else setCommunityPeopleStatus(message, true);
    } finally {
      communityRoleBusy = false;
      setCommunityRoleDialogLocked(false);
      setCommunityMemberControlsLocked(false);
    }
  }

  async function submitCommunityTitle() {
    if (communityRoleBusy || !communityTitleSession || !communityMemberContext) return;
    const ctx = communityMemberContext;
    const session = communityTitleSession;
    const token = communityRoleToken;
    const input = $("#communityTitleInput");
    const cleaned = communityCleanTitle(input && input.value);
    if (cleaned.error) {
      setCommunityDialogStatus("#communityTitleStatus", cleaned.error, true);
      return;
    }
    const listed = communityListedRole(session.account);
    if (String(listed.title || "").trim() === cleaned.title) {
      setCommunityDialogStatus("#communityTitleStatus", "That title is already set.", true);
      return;
    }
    if (!communityCanEditTitle(ctx.viewerRole, ctx.viewer, session.account, listed.role, ctx.name)) {
      setCommunityDialogStatus("#communityTitleStatus", "You cannot edit that title.", true);
      return;
    }
    if (!ctx.viewer) {
      openLogin();
      return;
    }
    if (!hasSigner(ctx.viewer)) {
      setCommunityDialogStatus("#communityTitleStatus", signerNeededMessage(), true);
      return;
    }
    communityRoleBusy = true;
    setCommunityTitleDialogLocked(true);
    setCommunityMemberControlsLocked(true);
    try {
      const op = communityCustomOp(ctx.viewer, "setUserTitle", {
        community: ctx.name,
        account: session.account,
        title: cleaned.title,
      });
      dismissCommunityTitleDialog();
      setCommunityPeopleStatus("Saving…", false);
      if (!window.ChainQueue || typeof ChainQueue.enqueue !== "function") {
        throw new Error("Could not sign this title.");
      }
      const queued = ChainQueue.enqueue({
        username: ctx.viewer,
        key: "Posting",
        operations: [op],
        meta: { type: "community", action: "setUserTitle", community: ctx.name },
      });
      await queued.promise;
      if (token !== communityRoleToken || !communityMembersStill(ctx.name)) return;
      const fresh = communityListedRole(session.account);
      paintCommunityMember(session.account, fresh.role || session.role, cleaned.title);
      setCommunityPeopleStatus("Saved.", false);
    } catch (err) {
      if (token !== communityRoleToken || !communityMembersStill(ctx.name)) return;
      const message = (err && err.message) || "Could not edit that title.";
      if (communityTitleDialogOpen()) setCommunityDialogStatus("#communityTitleStatus", message, true);
      else setCommunityPeopleStatus(message, true);
    } finally {
      communityRoleBusy = false;
      setCommunityTitleDialogLocked(false);
      setCommunityMemberControlsLocked(false);
    }
  }

  async function approveCommunityMember(account, title) {
    if (communityRoleBusy || !communityMemberContext) return;
    const ctx = communityMemberContext;
    const name = normalizeLoginUser(account);
    const token = communityRoleToken;
    if (!name || ctx.typeId !== 3 || communityRoleRank(ctx.viewerRole) < 4) return;
    const listed = communityListedRole(name);
    if (listed.role !== "guest") return;
    if (!ctx.viewer) {
      openLogin();
      return;
    }
    if (!hasSigner(ctx.viewer)) {
      setCommunityPeopleStatus(signerNeededMessage(), true);
      return;
    }
    communityRoleBusy = true;
    setCommunityMemberControlsLocked(true);
    setCommunityPeopleStatus("Approving…", false);
    try {
      if (!window.ChainQueue || typeof ChainQueue.enqueue !== "function") {
        throw new Error("Could not approve that subscriber.");
      }
      const queued = ChainQueue.enqueue({
        username: ctx.viewer,
        key: "Posting",
        operations: [
          communityCustomOp(ctx.viewer, "setRole", {
            community: ctx.name,
            account: name,
            role: "member",
          }),
        ],
        meta: { type: "community", action: "setRole", community: ctx.name },
      });
      await queued.promise;
      if (token !== communityRoleToken || !communityMembersStill(ctx.name)) return;
      paintCommunityMember(name, "member", title || listed.title);
      setCommunityPeopleStatus("Saved.", false);
    } catch (err) {
      if (token !== communityRoleToken || !communityMembersStill(ctx.name)) return;
      setCommunityPeopleStatus((err && err.message) || "Could not approve that subscriber.", true);
    } finally {
      communityRoleBusy = false;
      setCommunityMemberControlsLocked(false);
    }
  }

  async function renderCommunityMembers(info) {
    const name = normalizeCommunityName((info && info.name) || communityState.name || "");
    const viewer = observer() || "";
    const viewerRole = communityViewerRole(info);
    const ctx = {
      name,
      community: name,
      viewer,
      viewerRole,
      typeId: Number(info && info.type_id) || 0,
      manage: communityCanManageMembers(info),
      done: false,
      subscribed: new Set(),
    };
    communityMemberContext = ctx;
    const team = communityTeamRows(info);
    const groups = { owner: [], admin: [], mod: [], member: [], subscriber: [], muted: [] };
    team.forEach((row) => {
      const account = normalizeLoginUser(row.name);
      if (!account || isBlacklistedUser(account)) return;
      const section = communitySectionId(row.role);
      groups[section].push(communityMemberHtml(row, Object.assign({}, ctx, { section })));
    });
    const host = view.querySelector("#communityMembers");
    if (!host) return;
    const sectionsHtml = COMMUNITY_PEOPLE_SECTIONS.map((section) =>
      communityPeopleSectionHtml(section, groups[section].join(""), ctx)
    ).join("");
    host.innerHTML = `
      <p id="communityPeopleStatus" class="community-people-status" hidden></p>
      ${sectionsHtml}
      <div id="communityPeopleEmpty" class="panel empty-state" hidden>
        <h2>No members yet</h2>
        <p>Be the first to subscribe.</p>
      </div>
      <div class="community-people-more">
        <div id="communityMemberStatus" class="loading-row"><span class="btn-loader" aria-hidden="true"></span> Loading…</div>
      </div>
    `;
    const status = $("#communityMemberStatus");
    let roleLast = "";
    let roleMore = "";
    let rolesDone = false;
    let rolesBusy = false;
    let subLast = "";
    let subMore = false;
    let subsDone = false;
    let subsBusy = false;
    let opening = true;

    function sectionHasAccount(section, account) {
      const list = document.getElementById(communitySectionListId(section));
      if (!list) return false;
      const selector = communityMemberSelector(account);
      return Boolean(selector && list.querySelector(selector));
    }

    function placeMemberBatch(batch, room, listKind) {
      const buckets = {};
      const cap = room > 0 ? room : 0;
      const subscribers = listKind === "subscribers";
      const queued = new Set();
      let placed = 0;
      let scanned = 0;
      let lastName = "";
      let lastRole = "";
      for (const row of batch) {
        if (cap && placed >= cap) break;
        scanned += 1;
        const key = normalizeLoginUser(row.name);
        if (key) lastName = key;
        lastRole = String((row && row.role) || "");
        if (!key || isBlacklistedUser(key)) continue;
        const role = communityNormalizeRole(row.role);
        const section = subscribers ? "subscriber" : communitySectionId(role);
        if (subscribers && ctx.subscribed) ctx.subscribed.add(key);
        const token = section + "\n" + key;
        // The team is already on screen, and a cursor page can repeat its boundary account.
        if (queued.has(token) || sectionHasAccount(section, key)) continue;
        queued.add(token);
        if (!buckets[section]) buckets[section] = [];
        buckets[section].push(communityMemberHtml(row, Object.assign({}, ctx, { section })));
        placed += 1;
      }
      COMMUNITY_PEOPLE_SECTIONS.forEach((section) => {
        const parts = buckets[section];
        if (!parts || !parts.length) return;
        const list = $("#" + communitySectionListId(section));
        if (list) list.insertAdjacentHTML("beforeend", parts.join(""));
      });
      if (placed) communitySyncPeopleSections();
      return { placed, scanned, lastName, lastRole };
    }

    function pageAdvanced(batch, previous) {
      if (!batch.length || batch.length < 100) return "";
      const nextLast = normalizeLoginUser(batch[batch.length - 1].name);
      if (!nextLast || nextLast === previous) return "";
      return nextLast;
    }

    function roleFrontier(batch) {
      if (!batch.length) return "";
      const section = communitySectionId(batch[batch.length - 1].role);
      if (section === "owner" || section === "admin" || section === "mod" || section === "member" || section === "muted") {
        return section;
      }
      return "";
    }

    function paintSectionMore() {
      COMMUNITY_PEOPLE_SECTIONS.forEach((section) => {
        const btn = host.querySelector('[data-community-more="' + section + '"]');
        const loading = host.querySelector('[data-community-loading="' + section + '"]');
        const more = section === "subscriber" ? subMore : roleMore === section;
        const busy = !opening && (section === "subscriber" ? subsBusy : rolesBusy && roleMore === section);
        if (loading) loading.hidden = !busy;
        if (btn) btn.hidden = busy || !more;
      });
    }

    function finishOpening() {
      if (communityMemberContext !== ctx) return;
      opening = false;
      rolesBusy = false;
      subsBusy = false;
      ctx.done = true;
      if (status) status.hidden = true;
      communitySyncPeopleSections();
      paintSectionMore();
    }

    // Roles are one Hivemind cursor (owner through muted). Subscribers are a second cursor.
    // A subscribed account is listed under Subscribers with its role, including muted.
    // Blacklisted accounts are left out only while content moderation is on.
    // Hivemind returns at most 100 names per request. `want` is how many new rows to add.
    async function pullRoles(want) {
      if (rolesDone || communityMemberContext !== ctx) return;
      const goal = want > 0 ? want : 1;
      let gained = 0;
      let guard = 0;
      let frontier = roleMore;
      const maxPages = Math.ceil(goal / 100) + 30;
      while (guard++ < maxPages && gained < goal) {
        const roles = await HiveApi.listCommunityRoles(name, roleLast, 100);
        if (communityMemberContext !== ctx) return;
        const room = goal > 1 ? goal - gained : 0;
        const step = placeMemberBatch(roles, room, "roles");
        gained += step.placed;
        if (room && step.scanned < roles.length) {
          if (step.lastName) roleLast = step.lastName;
          roleMore = roleFrontier([{ role: step.lastRole }]) || frontier;
          return;
        }
        const next = pageAdvanced(roles, roleLast);
        if (!next) {
          rolesDone = true;
          roleMore = "";
          return;
        }
        roleLast = next;
        frontier = roleFrontier(roles) || frontier;
        if (gained >= goal) {
          roleMore = frontier;
          return;
        }
      }
      roleMore = frontier || "";
    }

    function takeSubsPage(batch, room) {
      const step = placeMemberBatch(batch, room, "subscribers");
      if (room > 0 && step.scanned < batch.length) {
        if (step.lastName) subLast = step.lastName;
        subMore = true;
        return { status: "more", placed: step.placed };
      }
      const next = pageAdvanced(batch, subLast);
      if (!next) {
        subsDone = true;
        subMore = false;
        return { status: "done", placed: step.placed };
      }
      subLast = next;
      subMore = true;
      return { status: step.placed > 0 ? "more" : "skip", placed: step.placed };
    }

    async function pullSubs(want) {
      if (subsDone || communityMemberContext !== ctx) return;
      const goal = want > 0 ? want : 1;
      let gained = 0;
      let guard = 0;
      const maxPages = Math.ceil(goal / 100) + 30;
      while (guard++ < maxPages && gained < goal) {
        const batch = await HiveApi.listSubscribers(name, subLast, 100);
        if (communityMemberContext !== ctx) return;
        const room = goal > 1 ? goal - gained : 0;
        const step = takeSubsPage(batch, room);
        gained += step.placed;
        if (step.status === "done" || (goal > 1 ? gained >= goal : step.status !== "skip")) return;
      }
      subMore = true;
    }

    async function loadMoreRoles() {
      if (rolesBusy || rolesDone || !roleMore || communityMemberContext !== ctx) return;
      rolesBusy = true;
      paintSectionMore();
      try {
        clearError();
        setCommunityPeopleStatus("", false);
        await pullRoles(1000);
      } catch (err) {
        if (communityMemberContext !== ctx) return;
        showError(err.message || String(err));
        setCommunityPeopleStatus("Could not load members. Try again in a moment.", true);
      }
      if (communityMemberContext !== ctx) return;
      rolesBusy = false;
      communitySyncPeopleSections();
      paintSectionMore();
    }

    async function loadMoreSubs() {
      if (subsBusy || subsDone || !subMore || communityMemberContext !== ctx) return;
      subsBusy = true;
      paintSectionMore();
      try {
        clearError();
        setCommunityPeopleStatus("", false);
        await pullSubs(1000);
      } catch (err) {
        if (communityMemberContext !== ctx) return;
        showError(err.message || String(err));
        setCommunityPeopleStatus("Could not load subscribers. Try again in a moment.", true);
      }
      if (communityMemberContext !== ctx) return;
      subsBusy = false;
      communitySyncPeopleSections();
      paintSectionMore();
    }

    host.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-community-more]");
      if (!btn || btn.hidden || btn.disabled || !host.contains(btn)) return;
      e.preventDefault();
      const section = btn.getAttribute("data-community-more");
      if (section === "subscriber") loadMoreSubs();
      else loadMoreRoles();
    });

    rolesBusy = true;
    subsBusy = true;
    const subsTask = HiveApi.listSubscribers(name, "", 100).then(
      (batch) => ({ ok: true, batch }),
      (err) => ({ ok: false, err })
    );
    let rolesError = null;
    try {
      await pullRoles();
    } catch (err) {
      rolesError = err;
    }
    const subsResult = await subsTask;
    if (communityMemberContext !== ctx) return;
    if (subsResult.ok && takeSubsPage(subsResult.batch).status === "skip") await pullSubs();
    if (communityMemberContext !== ctx) return;
    if (rolesError || !subsResult.ok) {
      const err = rolesError || subsResult.err;
      showError((err && err.message) || String(err || "Could not load members."));
      if (rolesError && !subsResult.ok) {
        setCommunityPeopleStatus("Could not load members. Try again in a moment.", true);
      } else if (!subsResult.ok) {
        setCommunityPeopleStatus("Could not load subscribers. Try again in a moment.", true);
        subMore = true;
      } else {
        setCommunityPeopleStatus("Could not load members. Try again in a moment.", true);
      }
    }
    finishOpening();
  }

  function communityRouteStill(name, tab) {
    const r = parseRoute();
    if (!r || r.name !== "community") return false;
    const id = normalizeCommunityName(r.community);
    const page = normalizeCommunityPage(r.page) || "latest";
    return id === name && page === tab;
  }

  function communitySubpageHtml(html) {
    const status = $("#communitySubpageStatus");
    if (status) status.outerHTML = html;
    else {
      const section = communitySubpageEl();
      if (section) section.insertAdjacentHTML("beforeend", html);
      else view.insertAdjacentHTML("beforeend", html);
    }
  }

  function communitySubpageLoadingHtml() {
    return `<div class="loading-row" id="communitySubpageStatus"><span class="btn-loader" aria-hidden="true"></span> Loading…</div>`;
  }

  // The banner stays when this subspace is already on screen. A new subspace
  // still loads the community first, then the posts, about, members, or edit page.
  function communityBannerReady(name) {
    if (communityState.name !== name || !communityState.info) return false;
    const banner = view.querySelector(".community-banner");
    if (!banner || !view.querySelector(".community-nav")) return false;
    const btn = banner.querySelector(".community-sub-btn");
    return Boolean(btn && normalizeCommunityName(btn.getAttribute("data-community")) === name);
  }

  function paintCommunityNavActive(page) {
    const nav = view.querySelector(".community-nav");
    if (nav) {
      const ids = ["latest", "trending", "about", "members"];
      const links = nav.querySelectorAll("a");
      for (let i = 0; i < links.length; i++) {
        links[i].classList.toggle("is-active", ids[i] === page);
      }
    }
    paintPeopleCounts();
  }

  function clearCommunitySubpage() {
    const nav = view.querySelector(".community-nav");
    if (!nav) return;
    let el = nav.nextElementSibling;
    while (el) {
      const next = el.nextElementSibling;
      el.remove();
      el = next;
    }
  }

  function communitySubpageEl() {
    return document.getElementById("communitySubpage");
  }

  function releaseCommunitySubpageHold() {
    const section = communitySubpageEl();
    if (section) section.style.minHeight = "";
  }

  function showCommunitySubpageLoading() {
    let section = communitySubpageEl();
    if (!section) {
      clearCommunitySubpage();
      view.insertAdjacentHTML(
        "beforeend",
        `<div id="communitySubpage">${communitySubpageLoadingHtml()}</div>`
      );
      return;
    }
    // Keep the old section height so a short loader does not pull the page up.
    const hold = section.offsetHeight;
    section.innerHTML = communitySubpageLoadingHtml();
    if (hold > 40) section.style.minHeight = hold + "px";
  }

  async function renderCommunityFeed(name, tab) {
    if (!communityRouteStill(name, tab)) return;
    resetFeed(feedSpecForCommunity(name, tab));
    const status = $("#communitySubpageStatus");
    if (status && communityRouteStill(name, tab)) status.remove();
    if (!communityRouteStill(name, tab)) return;
    const feedShell = `
        <div id="feedList" class="feed"></div>
        <div id="feedStatus" class="loading-row"><span class="btn-loader" aria-hidden="true"></span> Loading posts…</div>
        <div class="feed-actions">
          <button type="button" class="btn-primary" id="moreBtn" hidden>Load more</button>
        </div>
      `;
    const section = communitySubpageEl();
    if (section) section.insertAdjacentHTML("beforeend", feedShell);
    else view.insertAdjacentHTML("beforeend", feedShell);
    const list = $("#feedList");
    const feedStatus = $("#feedStatus");
    const moreBtn = $("#moreBtn");
    if (!list || !feedStatus || !moreBtn) return;

    async function fill() {
      await runFeedFill(async () => {
        const gen = feedState.gen;
        if (!communityRouteStill(name, tab) || !feedStill(gen)) return false;
        hideVoteSlider();
        moreBtn.hidden = true;
        showFeedLoading(feedStatus);
        let failed = false;
        const before = feedState.items.length;
        try {
          await loadFeedPage();
        } catch (err) {
          if (!communityRouteStill(name, tab) || !feedStill(gen)) return false;
          failed = true;
          showError(err.message || String(err));
        }
        if (!communityRouteStill(name, tab) || !feedStill(gen) || !list.isConnected) return false;
        if (!failed) clearError();
        paintFeedCards(list, cardHtml);
        if (!feedState.items.length && feedState.done) {
          feedStatus.hidden = true;
          list.innerHTML = `
            <div class="panel empty-state">
              <h2>No posts in this subspace</h2>
              <p>Try another sort, or check back later.</p>
            </div>`;
          return false;
        }
        return finishFeedPage(feedStatus, moreBtn, failed, before);
      });
    }

    bindFeedMore(moreBtn, fill);
    await fill();
    if (communityRouteStill(name, tab)) releaseCommunitySubpageHold();
  }

  async function renderCommunitySubpage(id, tab) {
    if (!communityRouteStill(id, tab) || communityState.name !== id) return;
    const info = communityState.info;
    if (!info) return;

    if (tab === "about") {
      const markdownReady = HiveMd.whenMarkdownReady();
      const extras = await communityAboutExtras(id, info);
      if (!communityRouteStill(id, tab) || communityState.name !== id) return;
      try {
        await markdownReady;
      } catch {
        // communityAboutHtml escapes description and rules when the scripts fail.
      }
      if (!communityRouteStill(id, tab) || communityState.name !== id) return;
      communitySubpageHtml(communityAboutHtml(info, extras));
      bindCommunityAboutCover();
      releaseCommunitySubpageHold();
      return;
    }

    if (tab === "members") {
      communitySubpageHtml(`<div class="community-panel" id="communityMembers"></div>`);
      await renderCommunityMembers(info);
      if (communityRouteStill(id, tab)) releaseCommunitySubpageHold();
      return;
    }

    if (tab === "edit") {
      communityEditOwner = { community: communityState.name, metadata: {}, loaded: false };
      try {
        const rows = await HiveApi.getAccounts([communityState.name]);
        if (!communityRouteStill(id, tab) || communityState.name !== id) return;
        const account = rows && rows[0];
        if (account && String(account.name || "").toLowerCase() === communityState.name) {
          communityEditOwner = {
            community: communityState.name,
            metadata: metadataFromAccount(account),
            posting: communityPostingMetadata(account),
            loaded: true,
          };
        }
      } catch {
        if (!communityRouteStill(id, tab) || communityState.name !== id) return;
      }
      if (!communityRouteStill(id, tab) || communityState.name !== id) return;
      communitySubpageHtml(communityEditBodyHtml(info));
      releaseCommunitySubpageHold();
      bindCommunityEdit();
      if (!communityOwnerReady(communityState.name) && $("#communityEditForm")) {
        setCommunityEditStatus(
          "Could not load the subspace account. Beneficiary, preferred spaces, and owner custom settings stay unchanged until it loads.",
          true
        );
      }
      return;
    }

    await renderCommunityFeed(id, tab);
  }

  async function renderCommunity(name, page) {
    invalidateCommunityRoleWork();
    if (ownerSignSession && ownerSignSession.source === "role" && !ownerSignBusy) cancelOwnerSign();
    communityMemberContext = null;
    const id = normalizeCommunityName(name);
    const tab = normalizeCommunityPage(page) || "latest";
    noteCommunityEditCommunity(id);
    const known = communityState.name === id ? communityState.info : null;
    setCommunityMeta(id, tab, known);
    if (communityBannerReady(id)) {
      paintCommunityNavActive(tab);
      showCommunitySubpageLoading();
      try {
        await renderCommunitySubpage(id, tab);
      } catch (err) {
        if (!communityRouteStill(id, tab)) return;
        showError(err.message || String(err));
      }
      return;
    }
    view.innerHTML = `<div class="loading-row"><span class="btn-loader" aria-hidden="true"></span> Loading subspace…</div>`;
    try {
      const info = await HiveApi.getCommunity(id, observer());
      if (!communityRouteStill(id, tab)) return;
      setNodeLabel();
      if (!info || !info.name) {
        resetCommunityState();
        setPageMeta("Not found — CyberSpace77");
        view.innerHTML = notFoundHtml("This community could not be found on Hive.");
        return;
      }
      clearError();
      const loadedName = String(info.name || id).toLowerCase();
      communityState.name = loadedName;
      communityState.info = info;
      communityState.subscribed = communitySubscribed(info);
      communityState.pending = false;
      setCommunityMeta(loadedName, tab, info);
      if (!communityRouteStill(id, tab)) return;
      const chrome = communityBannerHtml(info) + communityNavHtml(loadedName, tab);
      view.innerHTML =
        chrome + `<div id="communitySubpage">${communitySubpageLoadingHtml()}</div>`;
      await renderCommunitySubpage(id, tab);
    } catch (err) {
      if (!communityRouteStill(id, tab)) return;
      if (communityBannerReady(id)) {
        showError(err.message || String(err));
        return;
      }
      resetCommunityState();
      showError(err.message || String(err));
      setPageMeta("Not found — CyberSpace77");
      view.innerHTML = notFoundHtml("Could not load this community.");
    }
  }

  function settingsShellHtml(tab) {
    const page = tab === "profile" || tab === "keys" || tab === "nodes" ? tab : "general";
    const generalHref = HiveMd.escapeHtml(appHref(pathForSettings("general")));
    const profileHref = HiveMd.escapeHtml(appHref(pathForSettings("profile")));
    const keysHref = HiveMd.escapeHtml(appHref(pathForSettings("keys")));
    const nodesHref = HiveMd.escapeHtml(appHref(pathForSettings("nodes")));
    return `
      <section class="cs77-page settings-page">
        <h2 class="page-title">Settings</h2>
        <nav class="feed-nav subpage-nav" aria-label="Settings">
          <a href="${generalHref}" class="${page === "general" ? "is-active" : ""}">General</a>
          <a href="${profileHref}" class="${page === "profile" ? "is-active" : ""}">Profile</a>
          <a href="${keysHref}" class="${page === "keys" ? "is-active" : ""}">Keys</a>
          <a href="${nodesHref}" class="${page === "nodes" ? "is-active" : ""}">Nodes</a>
        </nav>
        <div id="settingsPanel"></div>
      </section>
    `;
  }

  function settingsGeneralHtml() {
    return `
      <form class="settings-form" id="settingsGeneralForm" autocomplete="off">
        <div class="settings-field">
          <label class="settings-label" for="settingsVotePost">Default vote weight for posts</label>
          <div class="settings-weight">
            <input id="settingsVotePost" type="number" min="0" max="100" step="1" inputmode="numeric" autocomplete="off" aria-describedby="settingsWeightNote">
            <span class="settings-weight-unit">%</span>
          </div>
        </div>
        <div class="settings-field">
          <label class="settings-label" for="settingsVoteComment">Default vote weight for comments</label>
          <div class="settings-weight">
            <input id="settingsVoteComment" type="number" min="0" max="100" step="1" inputmode="numeric" autocomplete="off" aria-describedby="settingsWeightNote">
            <span class="settings-weight-unit">%</span>
          </div>
        </div>
        <p class="settings-note" id="settingsWeightNote">Saved in this browser. Empty or 0 uses the last vote weight.</p>
      </form>
    `;
  }

  function fillSettingsWeights() {
    const post = $("#settingsVotePost");
    const comment = $("#settingsVoteComment");
    if (post) {
      const stored = readDefaultVoteWeight("post");
      post.value = stored == null ? "" : String(stored);
    }
    if (comment) {
      const stored = readDefaultVoteWeight("comment");
      comment.value = stored == null ? "" : String(stored);
    }
  }

  function commitSettingsWeightInput(input) {
    if (!input) return;
    const kind = input.id === "settingsVoteComment" ? "comment" : "post";
    const stored = storeDefaultVoteWeight(input.value, kind);
    const next = stored == null ? "" : String(stored);
    if (input.value !== next) input.value = next;
  }

  function bindSettingsGeneral() {
    const form = $("#settingsGeneralForm");
    if (!form) return;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      commitSettingsWeightInput($("#settingsVotePost"));
      commitSettingsWeightInput($("#settingsVoteComment"));
    });
    fillSettingsWeights();
  }

  function profileObject(metadata) {
    const meta = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {};
    const profile =
      meta.profile && typeof meta.profile === "object" && !Array.isArray(meta.profile) ? meta.profile : {};
    return { meta, profile };
  }

  function profileFieldText(profile, key) {
    const value = profile ? profile[key] : "";
    return typeof value === "string" ? value : "";
  }

  function copyJsonKeys(obj, skip) {
    const out = {};
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return out;
    Object.keys(obj).forEach((key) => {
      if (key === "__proto__" || key === "constructor" || key === "prototype") return;
      if (skip && skip[key]) return;
      out[key] = obj[key];
    });
    return out;
  }

  function customSettingsFromMetadata(metadata) {
    const { meta, profile } = profileObject(metadata);
    const out = copyJsonKeys(meta, { profile: true });
    const extra = {};
    Object.keys(profile).forEach((key) => {
      if (key === "__proto__" || key === "constructor" || key === "prototype") return;
      // Image servers use profile.version. The save sets it, so Custom does not.
      if (key === "version") return;
      if (PROFILE_FIELDS.indexOf(key) !== -1 && (profile[key] == null || typeof profile[key] === "string")) {
        return;
      }
      extra[key] = profile[key];
    });
    if (Object.keys(extra).length) out.profile = extra;
    return out;
  }

  function formatSettingsCustom(obj) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj) || !Object.keys(obj).length) return "{}";
    return JSON.stringify(obj, null, 2);
  }

  function parseSettingsCustom(raw) {
    const text = String(raw || "").trim();
    if (!text) return {};
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("Custom settings are not valid JSON.");
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("Custom settings must be a JSON object.");
    }
    return data;
  }

  function settingsProfileFieldsFromMetadata(metadata) {
    const { profile } = profileObject(metadata);
    const fields = {
      custom: formatSettingsCustom(customSettingsFromMetadata(metadata)),
    };
    PROFILE_FIELDS.forEach((key) => {
      fields[key] = profileFieldText(profile, key);
    });
    return fields;
  }

  // images.hive.blog and images.ecency.com ignore posting_json_metadata
  // until profile.version is set. Ecency writes 2 on every profile update.
  function composeProfileMetadata(fields, custom) {
    const meta = copyJsonKeys(custom, { profile: true });
    const src =
      custom.profile && typeof custom.profile === "object" && !Array.isArray(custom.profile)
        ? custom.profile
        : {};
    const profile = {};
    Object.keys(src).forEach((key) => {
      if (key === "__proto__" || key === "constructor" || key === "prototype") return;
      if (key === "version") return;
      if (PROFILE_FIELDS.indexOf(key) !== -1 && (src[key] == null || typeof src[key] === "string")) return;
      profile[key] = src[key];
    });
    PROFILE_FIELDS.forEach((key) => {
      const text = String(fields[key] == null ? "" : fields[key]).trim();
      if (text) profile[key] = text;
    });
    profile.version = 2;
    meta.profile = profile;
    return meta;
  }

  function settingsPictureSrc(url) {
    const text = String(url || "").trim();
    if (!/^https?:\/\//i.test(text)) return "";
    return HiveMd.proxyImage(text, 960);
  }

  function settingsProfileFormHtml(fields) {
    const esc = HiveMd.escapeHtml;
    const avatarSrc = settingsPictureSrc(fields.profile_image) || AVATAR_DEFAULT_LARGE;
    const coverSrc = settingsPictureSrc(fields.cover_image);
    return `
      <form class="settings-form" id="settingsProfileForm" autocomplete="off">
        <div class="settings-field">
          <label class="settings-label" for="settingsName">Name</label>
          <input id="settingsName" name="name" type="text" autocomplete="nickname" value="${esc(fields.name || "")}">
        </div>
        <div class="settings-field">
          <label class="settings-label" for="settingsAbout">About</label>
          <textarea id="settingsAbout" class="settings-about" name="about" rows="4">${esc(fields.about || "")}</textarea>
        </div>
        <div class="settings-field">
          <label class="settings-label" for="settingsLocation">Location</label>
          <input id="settingsLocation" name="location" type="text" autocomplete="off" value="${esc(fields.location || "")}">
        </div>
        <div class="settings-field">
          <label class="settings-label" for="settingsWebsite">Website</label>
          <input id="settingsWebsite" name="website" type="text" inputmode="url" autocomplete="url" placeholder="https://" value="${esc(fields.website || "")}">
        </div>
        <div class="settings-field">
          <label class="settings-label" for="settingsAvatar">Avatar picture</label>
          <p class="settings-note">Avatar updates may take up to 10 minutes to appear due to caching.</p>
          <div class="settings-media">
            <img id="settingsAvatarPreview" class="settings-avatar-preview" src="${esc(avatarSrc)}" alt="" width="72" height="72">
            <div class="settings-media-main">
              <input id="settingsAvatar" name="profile_image" type="text" inputmode="url" autocomplete="off" placeholder="https://" value="${esc(fields.profile_image || "")}">
              <div class="settings-media-actions">
                <button type="button" class="settings-upload" id="settingsAvatarUpload">Upload</button>
                <input id="settingsAvatarFile" type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/bmp,image/svg+xml" hidden>
              </div>
            </div>
          </div>
        </div>
        <div class="settings-field">
          <label class="settings-label" for="settingsCover">Cover background</label>
          <p class="settings-note">Used in other frontends.</p>
          <img id="settingsCoverPreview" class="settings-cover-preview" alt="" ${coverSrc ? `src="${esc(coverSrc)}"` : "hidden"}>
          <input id="settingsCover" name="cover_image" type="text" inputmode="url" autocomplete="off" placeholder="https://" value="${esc(fields.cover_image || "")}">
          <div class="settings-media-actions">
            <button type="button" class="settings-upload" id="settingsCoverUpload">Upload</button>
            <input id="settingsCoverFile" type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/bmp,image/svg+xml" hidden>
          </div>
        </div>
        <div class="settings-field">
          <label class="settings-label" for="settingsCustom">Custom</label>
          <p class="settings-note">Other settings stored in your profile. Expert mode (keep as is recommended).</p>
          <textarea id="settingsCustom" class="settings-custom" name="custom" rows="12" spellcheck="false">${esc(fields.custom || "{}")}</textarea>
        </div>
        <div class="settings-actions">
          <button type="submit" class="btn-primary" id="settingsSaveBtn">Save</button>
          <button type="button" class="btn-ghost" id="settingsResetBtn">Reset</button>
        </div>
        <p class="settings-status" id="settingsStatus" role="status"></p>
      </form>
    `;
  }

  function settingsProfileGuestHtml() {
    return `
      <div class="panel empty-state">
        <h2>Log in to edit your profile</h2>
        <p>Name, about, and pictures are stored on Hive.</p>
        <button type="button" class="btn-primary" id="settingsLoginBtn">Login</button>
      </div>
    `;
  }

  function readSettingsProfileFields() {
    const form = $("#settingsProfileForm");
    if (!form) return null;
    return {
      name: ($("#settingsName") && $("#settingsName").value) || "",
      about: ($("#settingsAbout") && $("#settingsAbout").value) || "",
      location: ($("#settingsLocation") && $("#settingsLocation").value) || "",
      website: ($("#settingsWebsite") && $("#settingsWebsite").value) || "",
      profile_image: ($("#settingsAvatar") && $("#settingsAvatar").value) || "",
      cover_image: ($("#settingsCover") && $("#settingsCover").value) || "",
      custom: ($("#settingsCustom") && $("#settingsCustom").value) || "",
    };
  }

  function copySettingsProfileFields(fields) {
    return {
      name: (fields && fields.name) || "",
      about: (fields && fields.about) || "",
      location: (fields && fields.location) || "",
      website: (fields && fields.website) || "",
      profile_image: (fields && fields.profile_image) || "",
      cover_image: (fields && fields.cover_image) || "",
      custom: (fields && fields.custom) || "{}",
    };
  }

  function clearSettingsProfileScratch() {
    settingsProfileDraft = null;
    settingsProfileBaseline = null;
  }

  function rememberSettingsProfileDraft() {
    const user = observer();
    const fields = readSettingsProfileFields();
    if (!user || !fields) return;
    settingsProfileDraft = Object.assign({ user }, copySettingsProfileFields(fields));
  }

  function writeSettingsProfileFields(fields) {
    const values = copySettingsProfileFields(fields);
    const set = (id, value) => {
      const el = $(id);
      if (el) el.value = value;
    };
    set("#settingsName", values.name);
    set("#settingsAbout", values.about);
    set("#settingsLocation", values.location);
    set("#settingsWebsite", values.website);
    set("#settingsAvatar", values.profile_image);
    set("#settingsCover", values.cover_image);
    set("#settingsCustom", values.custom);
    paintSettingsPicture("avatar", values.profile_image);
    paintSettingsPicture("cover", values.cover_image);
    return values;
  }

  function resetSettingsProfile() {
    const user = observer();
    const base = settingsProfileBaseline;
    if (settingsBusy || !user || !base || base.user !== user) return;
    const values = writeSettingsProfileFields(base);
    settingsProfileDraft = Object.assign({ user }, values);
    setSettingsStatus("", false);
  }

  function setSettingsStatus(message, isError) {
    const el = $("#settingsStatus");
    if (!el) return;
    el.textContent = message || "";
    el.classList.toggle("is-error", Boolean(isError) && Boolean(message));
  }

  function setSettingsFormLocked(locked) {
    const save = $("#settingsSaveBtn");
    const reset = $("#settingsResetBtn");
    const avatar = $("#settingsAvatarUpload");
    const cover = $("#settingsCoverUpload");
    if (save) save.disabled = locked;
    if (reset) reset.disabled = locked;
    if (avatar) avatar.disabled = locked;
    if (cover) cover.disabled = locked;
  }

  function paintSettingsPicture(kind, url) {
    if (kind === "cover") {
      const img = $("#settingsCoverPreview");
      if (!img) return;
      const src = settingsPictureSrc(url);
      if (!src) {
        img.hidden = true;
        img.removeAttribute("src");
        return;
      }
      img.hidden = false;
      img.src = src;
      return;
    }
    const img = $("#settingsAvatarPreview");
    if (!img) return;
    img.hidden = false;
    img.src = settingsPictureSrc(url) || AVATAR_DEFAULT_LARGE;
  }

  function bindSettingsPicture(kind) {
    const input = $(kind === "cover" ? "#settingsCover" : "#settingsAvatar");
    const file = $(kind === "cover" ? "#settingsCoverFile" : "#settingsAvatarFile");
    const button = $(kind === "cover" ? "#settingsCoverUpload" : "#settingsAvatarUpload");
    const preview = $(kind === "cover" ? "#settingsCoverPreview" : "#settingsAvatarPreview");
    if (button && file) {
      button.addEventListener("click", () => {
        if (!settingsBusy) file.click();
      });
    }
    if (input) {
      input.addEventListener("input", () => paintSettingsPicture(kind, input.value));
    }
    if (preview) {
      preview.addEventListener("error", () => {
        const raw = (input && input.value && String(input.value).trim()) || "";
        const current = preview.getAttribute("src") || "";
        if (raw && current !== raw && /^https?:\/\//i.test(raw)) {
          preview.hidden = false;
          preview.src = raw;
          return;
        }
        if (kind === "cover") {
          preview.hidden = true;
          return;
        }
        if (current !== AVATAR_DEFAULT_LARGE) preview.src = AVATAR_DEFAULT_LARGE;
      });
    }
  }

  function bindSettingsProfileForm() {
    const form = $("#settingsProfileForm");
    if (!form) return;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      saveSettingsProfile();
    });
    bindSettingsPicture("avatar");
    bindSettingsPicture("cover");
    const reset = $("#settingsResetBtn");
    if (reset) {
      reset.addEventListener("click", () => {
        resetSettingsProfile();
      });
    }
  }

  async function uploadSettingsPicture(kind, file) {
    const user = observer();
    if (!user) {
      openLogin();
      return;
    }
    if (settingsBusy) return;
    if (!isImageFile(file)) {
      setSettingsStatus("Choose an image file (png, jpg, gif, webp).", true);
      return;
    }
    if (!hasSigner(user)) {
      setSettingsStatus(signerNeededMessage(), true);
      return;
    }
    settingsBusy = true;
    setSettingsFormLocked(true);
    setSettingsStatus(signingLabel("image"), false);
    try {
      const url = await uploadHiveImage(file, user);
      if (parseRoute().name !== "settings") return;
      const input = $(kind === "cover" ? "#settingsCover" : "#settingsAvatar");
      if (input) {
        input.value = url;
        paintSettingsPicture(kind, url);
        rememberSettingsProfileDraft();
      }
      setSettingsStatus("Image uploaded.", false);
    } catch (err) {
      if (parseRoute().name === "settings") {
        setSettingsStatus((err && err.message) || "Image upload failed.", true);
      }
    } finally {
      settingsBusy = false;
      setSettingsFormLocked(false);
    }
  }

  function applySavedProfile(user, metadata, json) {
    const image = profileImageFromMetadata(metadata);
    writeStoredProfileImage(user, image);
    if (accountState.user === user && accountState.account) {
      accountState.account.posting_json_metadata = json;
      accountState.metadata = metadata;
      accountState.profileImage = image;
    }
    paintSessionAvatar();
    if (profileState.author === user && profileState.profile) {
      profileState.profile.metadata = metadata;
      profileState.profile.profile_image = image;
      syncOwnProfileBanner();
    }
  }

  async function saveSettingsProfile() {
    if (settingsBusy) return;
    const user = observer();
    if (!user) {
      openLogin();
      return;
    }
    rememberSettingsProfileDraft();
    const fields = readSettingsProfileFields();
    if (!fields) return;
    let custom;
    try {
      custom = parseSettingsCustom(fields.custom);
    } catch (err) {
      setSettingsStatus((err && err.message) || "Custom settings are not valid JSON.", true);
      return;
    }
    const metadata = composeProfileMetadata(fields, custom);
    const json = JSON.stringify(metadata);
    if (json.length > SETTINGS_METADATA_MAX) {
      setSettingsStatus("Profile settings are too long to save.", true);
      return;
    }
    if (!hasSigner(user)) {
      setSettingsStatus(signerNeededMessage(), true);
      return;
    }
    settingsBusy = true;
    setSettingsFormLocked(true);
    setSettingsStatus("Saving…", false);
    const { promise } = ChainQueue.enqueue({
      username: user,
      key: "Posting",
      operations: [
        [
          "account_update2",
          {
            account: user,
            json_metadata: "",
            posting_json_metadata: json,
            extensions: [],
          },
        ],
      ],
      meta: { type: "profile" },
    });
    try {
      await promise;
      if (observer() !== user) return;
      applySavedProfile(user, metadata, json);
      const saved = copySettingsProfileFields(fields);
      settingsProfileBaseline = Object.assign({ user }, saved);
      settingsProfileDraft = Object.assign({ user }, saved);
      setSettingsStatus("Saved.", false);
    } catch (err) {
      if (parseRoute().name === "settings") {
        setSettingsStatus((err && err.message) || "Could not save profile.", true);
      }
    } finally {
      settingsBusy = false;
      setSettingsFormLocked(false);
    }
  }

  async function loadSettingsMetadata(user) {
    if (!ownAccountReady(user)) await loadAccountResources();
    if (observer() !== user) return null;
    if (ownAccountReady(user)) return accountState.metadata || metadataFromAccount(accountState.account);
    const rows = await HiveApi.getAccounts([user]);
    const account = rows && rows[0];
    if (!account || String(account.name || "").toLowerCase() !== user) {
      throw new Error("Could not load this account.");
    }
    return metadataFromAccount(account);
  }

  async function fillSettingsProfile() {
    const panel = $("#settingsPanel");
    if (!panel) return;
    const user = observer();
    if (!user) {
      panel.innerHTML = settingsProfileGuestHtml();
      const login = $("#settingsLoginBtn");
      if (login) login.addEventListener("click", openLogin);
      return;
    }
    const key = routeKey(parseRoute());
    if (settingsProfileDraft && settingsProfileDraft.user !== user) settingsProfileDraft = null;
    if (settingsProfileBaseline && settingsProfileBaseline.user !== user) settingsProfileBaseline = null;
    const draft = settingsProfileDraft && settingsProfileDraft.user === user ? settingsProfileDraft : null;
    if (!settingsProfileBaseline) {
      if (!draft && !ownAccountReady(user)) {
        panel.innerHTML = `<div class="loading-row"><span class="btn-loader" aria-hidden="true"></span> Loading profile…</div>`;
      }
      let metadata = null;
      try {
        metadata = await loadSettingsMetadata(user);
      } catch (err) {
        if (!routeStill(key)) return;
        panel.innerHTML = `
          <div class="panel empty-state">
            <h2>Could not load profile</h2>
            <p>${HiveMd.escapeHtml((err && err.message) || "Could not load this account.")}</p>
          </div>
        `;
        return;
      }
      if (!routeStill(key) || !metadata) return;
      settingsProfileBaseline = Object.assign({ user }, copySettingsProfileFields(settingsProfileFieldsFromMetadata(metadata)));
    }
    if (!routeStill(key)) return;
    const fields = draft || settingsProfileBaseline;
    panel.innerHTML = settingsProfileFormHtml(fields);
    bindSettingsProfileForm();
  }

  function settingsNodesHtml() {
    return `
      <form class="settings-form" id="settingsNodesForm" autocomplete="off">
        <div class="settings-field">
          <div class="settings-label" id="settingsNodesLabel">Custom nodes</div>
          <div id="settingsNodeRows"></div>
          <div class="settings-node-row" id="settingsNodeDraft">
            <input id="settingsNodeInput" type="text" inputmode="url" autocomplete="off" placeholder="api.hive.blog" spellcheck="false" autocapitalize="off" aria-label="Hive API server" aria-describedby="settingsNodesNote">
          </div>
          <button type="submit" class="settings-node-add" id="settingsNodeAdd">Add</button>
        </div>
        <p class="settings-note" id="settingsNodesNote">Saved in this browser.</p>
        <p class="settings-status" id="settingsNodeStatus" role="status"></p>
      </form>
    `;
  }

  function setSettingsNodeStatus(message, isError) {
    const el = $("#settingsNodeStatus");
    if (!el) return;
    el.textContent = message || "";
    el.classList.toggle("is-error", Boolean(isError) && Boolean(message));
  }

  function settingsNodeLimit() {
    const limit = HiveApi.CUSTOM_NODE_LIMIT;
    return Number.isFinite(limit) && limit > 0 ? limit : 8;
  }

  function paintSettingsNodeRows() {
    const root = $("#settingsNodeRows");
    if (!root) return;
    const list = HiveApi.getCustomNodes ? HiveApi.getCustomNodes() : [];
    const full = list.length >= settingsNodeLimit();
    root.innerHTML = list
      .map((url, i) => {
        const esc = HiveMd.escapeHtml(url);
        return `<div class="settings-node-row">
          <input class="settings-node-url" type="text" readonly value="${esc}" aria-label="Custom node ${i + 1}" spellcheck="false">
          <button type="button" class="settings-node-remove" data-node="${esc}" aria-label="Remove custom node"${settingsNodeBusy ? " disabled" : ""}>×</button>
        </div>`;
      })
      .join("");
    const add = $("#settingsNodeAdd");
    const input = $("#settingsNodeInput");
    if (add) add.disabled = settingsNodeBusy || full;
    if (input) input.disabled = settingsNodeBusy;
  }

  function setSettingsNodeBusy(busy) {
    settingsNodeBusy = busy;
    const input = $("#settingsNodeInput");
    if (input) input.disabled = busy;
    paintSettingsNodeRows();
  }

  async function addSettingsNode() {
    if (settingsNodeBusy) return;
    const input = $("#settingsNodeInput");
    const button = $("#settingsNodeAdd");
    if (!input) return;
    if (button && button.disabled) {
      setSettingsNodeStatus("You can add up to " + settingsNodeLimit() + " custom nodes.", true);
      return;
    }
    const raw = input.value;
    const token = settingsNodeToken;
    setSettingsNodeBusy(true);
    setSettingsNodeStatus("Testing…");
    try {
      const node = await HiveApi.testNode(raw);
      if (token !== settingsNodeToken || !input.isConnected) return;
      const customs = HiveApi.getCustomNodes();
      if (customs.indexOf(node) !== -1) {
        throw new Error("That server is already in the list.");
      }
      const known = HiveApi.getKnownNodes();
      if (known.indexOf(node) !== -1) {
        throw new Error("That server is already a public node.");
      }
      if (customs.length >= settingsNodeLimit()) {
        throw new Error("You can add up to " + settingsNodeLimit() + " custom nodes.");
      }
      if (!HiveApi.addCustomNode(node)) {
        throw new Error("Could not save that server.");
      }
      input.value = "";
      paintNodeMenus();
      setNodeLabel();
      setSettingsNodeStatus("");
    } catch (err) {
      if (token !== settingsNodeToken || !input.isConnected) return;
      setSettingsNodeStatus((err && err.message) || "Could not use that server.", true);
    } finally {
      if (token === settingsNodeToken && input.isConnected) {
        setSettingsNodeBusy(false);
        if (!input.disabled) input.focus();
      }
    }
  }

  function removeSettingsNode(btn) {
    if (settingsNodeBusy || !btn) return;
    const url = btn.getAttribute("data-node") || "";
    if (!url || !HiveApi.removeCustomNode(url)) {
      setSettingsNodeStatus("Could not remove that server.", true);
      return;
    }
    paintSettingsNodeRows();
    paintNodeMenus();
    setNodeLabel();
    setSettingsNodeStatus("");
    const input = $("#settingsNodeInput");
    if (input) input.focus();
  }

  function bindSettingsNodes() {
    settingsNodeBusy = false;
    const form = $("#settingsNodesForm");
    if (!form) return;
    paintSettingsNodeRows();
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      addSettingsNode();
    });
    form.addEventListener("click", (e) => {
      const remove = e.target.closest(".settings-node-remove");
      if (!remove) return;
      e.preventDefault();
      removeSettingsNode(remove);
    });
  }

  const SETTINGS_KEY_FIELDS = [
    ["owner", "settingsKeysOwner"],
    ["active", "settingsKeysActive"],
    ["memo", "settingsKeysMemo"],
    ["posting", "settingsKeysPosting"],
  ];

  function settingsKeysHtml(username) {
    const esc = HiveMd.escapeHtml;
    const user = esc(username || "");
    const rows = SETTINGS_KEY_FIELDS.map((row) => {
      const role = row[0];
      const id = row[1];
      const label = role.charAt(0).toUpperCase() + role.slice(1);
      return `
        <div class="settings-field">
          <label class="settings-label" for="${id}">${label}</label>
          <div class="subspace-key-line">
            <input id="${id}" type="text" readonly autocomplete="off" spellcheck="false">
            <button type="button" class="btn-ghost btn-compact" data-settings-key-copy="${id}" aria-label="Copy ${label} key">Copy</button>
          </div>
        </div>
      `;
    }).join("");
    return `
      <form class="settings-form" id="settingsKeysForm" autocomplete="off">
        <h2 class="settings-section-title settings-section-line"><span>Key generation tool</span></h2>
        <p class="settings-note">Generate the Owner, Active, Memo and  Posting key locally from the master password.</p>
        <div class="settings-field">
          <label class="settings-label" for="settingsKeysUser">Username</label>
          <input id="settingsKeysUser" type="text" autocomplete="off" spellcheck="false" autocapitalize="off" value="${user}">
        </div>
        <div class="settings-field">
          <label class="settings-label" for="settingsKeysPass">Master password</label>
          <input id="settingsKeysPass" type="password" autocomplete="off" spellcheck="false">
        </div>
        <div class="settings-actions">
          <button type="submit" class="btn-primary" id="settingsKeysGenerate">Generate</button>
          <button type="button" class="btn-ghost" id="settingsKeysClear">Clear</button>
        </div>
        <p class="settings-note settings-keys-hint" id="settingsKeysHint" hidden>Click Clear after you copied the keys to clear the keys from memory and the clipboard.</p>
        <div class="settings-keys-fields" id="settingsKeysBox" hidden>
          ${rows}
        </div>
        <p class="settings-status" id="settingsKeysStatus" role="status"></p>
      </form>
    `;
  }

  function blankSettingsControl(id) {
    const el = document.getElementById(id);
    if (el) el.value = "";
  }

  function clearSettingsKeys() {
    settingsKeysToken += 1;
    blankSettingsControl("settingsKeysUser");
    blankSettingsControl("settingsKeysPass");
    for (let i = 0; i < SETTINGS_KEY_FIELDS.length; i++) {
      blankSettingsControl(SETTINGS_KEY_FIELDS[i][1]);
    }
    setSettingsKeysHint(false);
    setSettingsKeysBox(false);
    clearSettingsKeyCopyButtons();
  }

  function setSettingsKeysStatus(message, isError) {
    const status = $("#settingsKeysStatus");
    if (!status) return;
    status.textContent = message || "";
    status.classList.toggle("is-error", Boolean(isError) && Boolean(message));
  }

  function setSettingsKeysHint(show) {
    const hint = $("#settingsKeysHint");
    if (hint) hint.hidden = !show;
  }

  function setSettingsKeysBox(show) {
    const box = $("#settingsKeysBox");
    if (box) box.hidden = !show;
  }

  function clearSettingsKeyCopyButtons() {
    const buttons = document.querySelectorAll("#settingsKeysForm [data-settings-key-copy]");
    for (let i = 0; i < buttons.length; i++) buttons[i].textContent = "Copy";
  }

  async function clearSettingsClipboard() {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText("");
        return;
      }
    } catch {
      /* A rejected write still tries the selection fallback. */
    }
    const sink = document.createElement("textarea");
    sink.value = "";
    sink.setAttribute("readonly", "");
    sink.setAttribute("aria-hidden", "true");
    sink.style.position = "fixed";
    sink.style.left = "-9999px";
    document.body.appendChild(sink);
    sink.focus();
    sink.select();
    try {
      document.execCommand("copy");
    } catch {
      /* ignore */
    }
    sink.remove();
  }

  async function generateSettingsKeys(e) {
    if (e) e.preventDefault();
    const token = ++settingsKeysToken;
    const user = normalizeLoginUser(($("#settingsKeysUser") && $("#settingsKeysUser").value) || "");
    const passEl = $("#settingsKeysPass");
    let password = (passEl && passEl.value) || "";
    const jobs = [];
    setSettingsKeysHint(false);
    setSettingsKeysBox(false);
    clearSettingsKeyCopyButtons();
    for (let i = 0; i < SETTINGS_KEY_FIELDS.length; i++) {
      blankSettingsControl(SETTINGS_KEY_FIELDS[i][1]);
    }
    if (!validLoginUser(user)) {
      password = "";
      setSettingsKeysStatus("Enter a valid Hive username.", true);
      return;
    }
    if (!password) {
      setSettingsKeysStatus("Enter the master password.", true);
      return;
    }
    if (!window.HiveAuth || typeof HiveAuth.wifFromLogin !== "function") {
      password = "";
      setSettingsKeysStatus("Could not derive the keys in this browser.", true);
      return;
    }
    setSettingsKeysStatus("");
    try {
      for (let i = 0; i < SETTINGS_KEY_FIELDS.length; i++) {
        jobs.push(HiveAuth.wifFromLogin(user, password, SETTINGS_KEY_FIELDS[i][0]));
      }
      password = "";
      for (let i = 0; i < jobs.length; i++) {
        let wif = await jobs[i];
        jobs[i] = null;
        if (token !== settingsKeysToken) {
          wif = "";
          for (let j = i + 1; j < jobs.length; j++) jobs[j] = null;
          return;
        }
        const field = document.getElementById(SETTINGS_KEY_FIELDS[i][1]);
        if (field) field.value = wif;
        wif = "";
      }
      if (token === settingsKeysToken) {
        setSettingsKeysHint(true);
        setSettingsKeysBox(true);
      }
    } catch (err) {
      for (let i = 0; i < jobs.length; i++) jobs[i] = null;
      if (token === settingsKeysToken) {
        for (let i = 0; i < SETTINGS_KEY_FIELDS.length; i++) {
          blankSettingsControl(SETTINGS_KEY_FIELDS[i][1]);
        }
        setSettingsKeysHint(false);
        setSettingsKeysBox(false);
        setSettingsKeysStatus((err && err.message) || "Could not derive the keys.", true);
      }
    } finally {
      password = "";
    }
  }

  function bindSettingsKeys() {
    const form = $("#settingsKeysForm");
    const clear = $("#settingsKeysClear");
    if (form) {
      form.addEventListener("submit", generateSettingsKeys);
      const copies = form.querySelectorAll("[data-settings-key-copy]");
      for (let i = 0; i < copies.length; i++) {
        copies[i].addEventListener("click", () => {
          const input = document.getElementById(copies[i].getAttribute("data-settings-key-copy"));
          copySubspaceMasterKey(input, copies[i]);
        });
      }
    }
    if (clear) {
      clear.addEventListener("click", () => {
        clearSettingsKeys();
        setSettingsKeysStatus("");
        clearSettingsClipboard();
      });
    }
  }

  async function renderSettings(page) {
    settingsNodeToken += 1;
    clearSettingsKeys();
    const tab = page === "profile" || page === "keys" || page === "nodes" ? page : "general";
    setPageMeta("Settings — CyberSpace77");
    view.innerHTML = settingsShellHtml(tab);
    if (tab === "general") {
      const panel = $("#settingsPanel");
      if (panel) panel.innerHTML = settingsGeneralHtml();
      bindSettingsGeneral();
      return;
    }
    if (tab === "nodes") {
      const panel = $("#settingsPanel");
      if (panel) panel.innerHTML = settingsNodesHtml();
      bindSettingsNodes();
      return;
    }
    if (tab === "keys") {
      const panel = $("#settingsPanel");
      if (panel) panel.innerHTML = settingsKeysHtml(observer() || "");
      bindSettingsKeys();
      return;
    }
    await fillSettingsProfile();
  }

  function renderAbout() {
    setPageMeta("About — CyberSpace77");
    view.innerHTML = `
      <section class="about">
        <h2 class="about-title">About</h2>
        <p>cyberspace77 is a modern, fast and lightweight, open-source social media app for the hive blockchain, the world's first blockchain-powered, decentralized social network.</p>
        <p>The <a href="https://hive.io/">hive blockchain</a> is a web3 ecosystem with zero transaction fees, built for social media and dapps.</p>
        <h3>developed by</h3>
        <div class="social-links about-social">
          <a class="btn-social btn-social-red" href="${HiveMd.escapeHtml(appHref("/@vikisecrets"))}">@vikisecrets</a>
          <a class="btn-social btn-social-yellow" href="https://vikisecrets.com/">vikisecrets.com</a>
        </div>
        <h3>social</h3>
        <div class="social-links about-social">
          <a class="btn-social btn-social-gray" href="${HiveMd.escapeHtml(appHref("/@cyberspace77"))}">hive</a>
          <a class="btn-social btn-social-gray" href="https://x.com/cyberspace77x">X</a>
          <a class="btn-social btn-social-gray" href="https://instagram.com/cryptospace77com">instagram</a>
        </div>
        <h3>source code (MIT license)</h3>
         <div class="social-links about-social">
           <a class="btn-social btn-social-gray" href="https://github.com/cyberspace77app/web77">github</a>
        </div>
        <h3><a href="${HiveMd.escapeHtml(appHref("/imprint"))}">imprint</a></h3>
      </section>
    `;
  }

  function renderImprint() {
    setPageMeta("Imprint — CyberSpace77");
    view.innerHTML = `
      <section class="imprint">
        <h2 class="imprint-title">Imprint</h2>
        <p>This is a local open-source web app running entirely in the user's browser. No user data is stored or processed on or by cyberspace77.com. The site does not use cookies.</p>
        <p>Developed by DI Viktor Krammer<br>
        Vienna, Austria<br>
        in the European Union
        </p>
        <h3>Disclaimer</h3>
        <p>CyberSpace77 is experimental alpha software.</p>
        <p>This software is provided "as is" without warranties or conditions of any kind, express or implied.</p>
        <p>This application acts as a client for the hive blockchain network, similar to an email client or web browser. It does not host, process or store any user content on its server.</p>
        <p>Users are solely responsible for any content they create, publish, or distribute using this software. The authors and contributors assume no responsibility for user-generated content or activities on the hive network.</p>
        <p>Powered by the <a href="https://hive.io/">hive blockchain</a>.</p>
      </section>
    `;
  }

  function notFoundHtml(msg) {
    return `
      <div class="panel empty-state">
        <h2>Signal lost</h2>
        <p>${HiveMd.escapeHtml(msg || "Nothing at this URL.")}</p>
        <p style="margin-top:1rem"><a href="${appHref("/")}">Return to the feed</a></p>
      </div>
    `;
  }

  function setPublishFabHidden(hidden) {
    const fab = $("#publishFab");
    if (fab) fab.hidden = hidden;
  }

  function welcomeSeen() {
    try {
      return localStorage.getItem(WELCOME_SEEN_KEY) === "1";
    } catch {
      return false;
    }
  }

  function markWelcomeSeen() {
    try {
      localStorage.setItem(WELCOME_SEEN_KEY, "1");
    } catch {
      /* ignore quota / private mode */
    }
  }

  function isHomeIndex(r) {
    return Boolean(r && r.name === "feed" && !r.tag && isHomePath());
  }

  function resolveWelcome(r) {
    if (r && r.name === "publish") {
      return document.body.classList.contains("has-welcome");
    }
    if (r && r.name === "welcome") {
      welcomeHold = false;
      return true;
    }
    if (!isHomeIndex(r)) {
      welcomeHold = false;
      return false;
    }
    // Logged-out visitors always get the flyer on the index. The seen flag
    // only suppresses it after a signed-in visit.
    if (!observer()) {
      welcomeHold = true;
      return true;
    }
    if (welcomeHold || !welcomeSeen()) {
      welcomeHold = true;
      markWelcomeSeen();
      return true;
    }
    return false;
  }

  function applyWelcome(show) {
    const flyer = $("#welcomeFlyer");
    const was = document.body.classList.contains("has-welcome");
    document.body.classList.toggle("has-welcome", show);
    if (flyer) flyer.hidden = !show;
    if (was && !show) window.scrollTo(0, 0);
  }

  function scrollToFeed() {
    const feed = document.querySelector("#view .feed-nav") || $("#view");
    if (!feed) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    feed.scrollIntoView({ behavior: reduce.matches ? "auto" : "smooth", block: "start" });
  }

  function bindWelcome() {
    const btn = $("#welcomeDown");
    if (btn) btn.addEventListener("click", scrollToFeed);
  }

  function applyRouteTitle(r) {
    if (!r) return;
    if (r.name === "feed") {
      setPageMeta(
        r.tag
          ? "#" + r.tag + " — CyberSpace77"
          : r.sort === "feed"
            ? "Feed — CyberSpace77"
            : "CyberSpace77"
      );
    } else if (r.name === "profile") {
      setProfileMeta(r.author, r.page);
    } else if (r.name === "community") {
      setCommunityMeta(r.community, r.page);
    } else if (r.name === "tags") {
      setPageMeta("Spaces — CyberSpace77");
    } else if (r.name === "communities") {
      setPageMeta(r.page === "create" ? "Create subspace — CyberSpace77" : "Subspaces — CyberSpace77");
    } else if (r.name === "welcome") {
      setPageMeta("CyberSpace77");
    } else if (r.name === "about") {
      setPageMeta("About — CyberSpace77");
    } else if (r.name === "settings") {
      setPageMeta("Settings — CyberSpace77");
    } else if (r.name === "search") {
      setPageMeta("Search — CyberSpace77");
    } else if (r.name === "imprint") {
      setPageMeta("Imprint — CyberSpace77");
    }
  }

  function historyNavId() {
    const state = history.state;
    const nav = state && Number(state.nav);
    return Number.isFinite(nav) && nav > 0 ? nav : 0;
  }

  // A reloaded document keeps the entry's nav but starts the counter at 0.
  // Seed from that id so the next entry does not reuse the parked feed's id.
  function nextHistoryNav() {
    const existing = historyNavId();
    if (existing > historyNavSeq) historyNavSeq = existing;
    historyNavSeq += 1;
    return historyNavSeq;
  }

  function ensureHistoryNav() {
    const existing = historyNavId();
    if (existing) {
      if (existing > historyNavSeq) historyNavSeq = existing;
      return existing;
    }
    const nav = nextHistoryNav();
    const prev = history.state && typeof history.state === "object" ? history.state : {};
    history.replaceState(Object.assign({}, prev, { nav }), "", location.href);
    return nav;
  }

  function isRestorableFeedKey(key) {
    return (
      !!key &&
      (key === "welcome" || key.indexOf("feed:") === 0 || key.indexOf("community:") === 0)
    );
  }

  function canParkLiveFeed() {
    return Boolean(
      liveFeedNav &&
      isRestorableFeedKey(currentViewKey) &&
      view &&
      view.firstElementChild &&
      !feedParks.has(liveFeedNav)
    );
  }

  function carriedHistoryFields(state) {
    const src = state && typeof state === "object" ? state : {};
    const out = {};
    const steps = Number(src.profileReturnSteps) || 0;
    const returnNav = Number(src.profileReturnNav) || 0;
    if (steps > 0 && returnNav > 0) {
      out.profileReturnSteps = steps;
      out.profileReturnNav = returnNav;
    }
    const depth = Number(src.feedStackDepth) || 0;
    if (depth > 0) out.feedStackDepth = depth;
    return out;
  }

  function stampHistoryFields(fields) {
    const prev = history.state && typeof history.state === "object" ? history.state : {};
    const nav = Number(prev.nav) || historyNavId() || nextHistoryNav();
    const next = Object.assign({}, prev, fields, { nav });
    const keys = Object.keys(next);
    for (let i = 0; i < keys.length; i++) {
      if (prev[keys[i]] !== next[keys[i]]) {
        history.replaceState(next, "", location.href);
        return;
      }
    }
  }

  function stampProfileReturn() {
    if (!profileReturnSteps || !profileReturnNav) return;
    stampHistoryFields({
      profileReturnNav: profileReturnNav,
      profileReturnSteps: profileReturnSteps,
    });
  }

  function stampFeedStack() {
    if (!feedStackDepth) return;
    stampHistoryFields({ feedStackDepth: feedStackDepth });
  }

  function syncProfileReturnFromHistory() {
    const state = history.state || {};
    const steps = Number(state.profileReturnSteps) || 0;
    const returnNav = Number(state.profileReturnNav) || 0;
    if (steps > 0 && returnNav > 0) {
      profileReturnNav = returnNav;
      profileReturnSteps = steps;
      return;
    }
    profileReturnNav = 0;
    profileReturnSteps = 0;
  }

  // Profile tabs and posts opened on top of a parked feed share one return.
  // Leaving that stack drops it, so a later profile does not jump past the feed.
  function noteProfileReturnStep(fromPop, pushed, routeName) {
    const onStack = routeName === "profile" || routeName === "post";
    if (fromPop) {
      profileReturnOpen = profileReturnSteps > 0 && onStack;
      return;
    }
    if (!profileReturnNav || !feedParks.has(profileReturnNav)) {
      profileReturnNav = 0;
      profileReturnSteps = 0;
      profileReturnOpen = false;
      return;
    }
    if (!onStack) {
      profileReturnNav = 0;
      profileReturnSteps = 0;
      profileReturnOpen = false;
      return;
    }
    if (pushed && !parkedForProfile && profileReturnOpen) profileReturnSteps += 1;
    profileReturnOpen = true;
    stampProfileReturn();
  }

  function noteFeedStack(fromPop, pushed, routeName) {
    if (routeName === "feed" || routeName === "community" || routeName === "welcome") {
      feedStackDepth = 0;
      return;
    }
    if (routeName !== "post") return;
    if (fromPop) {
      feedStackDepth = Number(history.state && history.state.feedStackDepth) || 0;
      return;
    }
    if (pushed && liveFeedNav && !profileReturnNav) feedStackDepth += 1;
    stampFeedStack();
  }

  function snapshotFeedState() {
    return {
      kind: feedState.kind,
      sort: feedState.sort,
      tag: feedState.tag,
      scope: feedState.scope,
      items: feedState.items.slice(),
      seen: new Set(feedState.seen),
      cursor: feedState.cursor
        ? { author: feedState.cursor.author, permlink: feedState.cursor.permlink }
        : null,
      done: feedState.done,
      loading: feedState.loading,
    };
  }

  function applyFeedSnapshot(snap) {
    feedState.kind = snap.kind;
    feedState.sort = snap.sort;
    feedState.tag = snap.tag;
    feedState.scope = snap.scope;
    feedState.items = snap.items;
    feedState.seen = snap.seen;
    feedState.cursor = snap.cursor;
    feedState.loading = false;
    feedState.done = snap.done;
    // Stay ahead of a profile load that captured the previous generation.
    feedState.gen += 1;
  }

  function discardFeedPark(park) {
    if (park && park.holder) park.holder.replaceChildren();
  }

  function rememberFeedPark(park) {
    feedParks.set(park.nav, park);
    while (feedParks.size > FEED_PARK_MAX) {
      const oldest = feedParks.keys().next().value;
      if (oldest === park.nav) break;
      discardFeedPark(feedParks.get(oldest));
      feedParks.delete(oldest);
    }
  }

  // The profile page uses #view and the shared feed list. Detach the feed
  // instead of serializing it, so Load more and the painted cards survive.
  function parkLiveFeed(fromPop) {
    const nav = liveFeedNav;
    const holder = document.createElement("div");
    const feed = snapshotFeedState();
    const expanded = new Set(expandedCardExcerpts);
    // Read this before the list leaves the document. Detaching it shrinks the
    // page and the browser clamps the window back to the top.
    const scrollY = postLayer.open && postLayer.heldScroll ? Number(postLayer.scrollY) || 0 : scrollYNow();
    armInstantScroll();
    feedState.gen += 1;
    feedState.loading = false;
    while (view.firstChild) holder.appendChild(view.firstChild);
    rememberFeedPark({
      nav,
      key: currentViewKey,
      holder,
      scrollY,
      hadWelcome:
        document.body.classList.contains("has-welcome") ||
        Boolean(postLayer.open && postLayer.hadWelcome),
      feed,
      community: {
        name: communityState.name,
        info: communityState.info,
        subscribed: communityState.subscribed,
        pending: communityState.pending,
      },
      expanded,
    });
    liveFeedNav = 0;
    const between = postLayer.open ? feedStackDepth : 0;
    feedStackDepth = 0;
    if (fromPop) return;
    profileReturnNav = nav;
    profileReturnSteps = 1 + between;
    profileReturnOpen = true;
    parkedForProfile = true;
  }

  function takeFeedPark(nav, key) {
    const park = feedParks.get(nav);
    if (!park || park.key !== key) return null;
    feedParks.delete(nav);
    if (!park.holder.firstElementChild) {
      discardFeedPark(park);
      return null;
    }
    return park;
  }

  function mountFeedPark(park) {
    while (view.firstChild) view.removeChild(view.firstChild);
    while (park.holder.firstChild) view.appendChild(park.holder.firstChild);
    applyFeedSnapshot(park.feed);
    communityState.name = park.community.name;
    communityState.info = park.community.info;
    communityState.subscribed = park.community.subscribed;
    communityState.pending = park.community.pending;
    expandedCardExcerpts.clear();
    park.expanded.forEach((k) => expandedCardExcerpts.add(k));
  }

  function revealParkedWelcome() {
    document.body.classList.add("has-welcome");
    const flyer = document.getElementById("welcomeFlyer");
    if (flyer) flyer.hidden = false;
  }

  function resumeParkedFeedLoad() {
    const status = document.getElementById("feedStatus");
    const moreBtn = document.getElementById("moreBtn");
    if (!status || status.hidden || !moreBtn || feedState.done) return;
    feedState.loading = false;
    feedState.holdAuto = false;
    // Drop a fill that belonged to the page we just left so this click starts
    // the parked list again.
    feedFillBusy = false;
    feedFillToken += 1;
    moreBtn.click();
  }

  function routeStill(key) {
    return routeKey(parseRoute()) === key;
  }

  async function route() {
    if (peopleList.open || peopleHistoryOn) {
      closePeoplePanel({ skipHistory: true });
      peopleHistoryOn = false;
      if (history.state && history.state.peoplePanel) {
        const prev = Object.assign({}, history.state);
        delete prev.peoplePanel;
        delete prev.peopleKind;
        delete prev.peopleId;
        history.replaceState(prev, "", location.href);
      }
    }
    persistCommentDraftNow();
    const fromPop = routeFromPop;
    const pushed = routePushed;
    routeFromPop = false;
    routePushed = false;
    contentEditToken += 1;
    if (fromPop) syncProfileReturnFromHistory();
    parkedForProfile = false;
    const fromProfileNav = profileNavSwitch;
    profileNavSwitch = false;
    const fromCommunityNav = communityNavSwitch;
    communityNavSwitch = false;
    closeLogoMenu();
    hideVoteSlider();
    closeProfileMore();
    closeContentMore();
    hideContentDelete(true);
    clearError();
    if (ownerSignSession && !ownerSignBusy) {
      const signSource = ownerSignSession.source;
      if (signSource === "wallet" || signSource === "memo") {
        cancelOwnerSign();
        if (signSource === "wallet") closeWalletOverlay();
      }
    }
    if (!ownerSignBusy) closeDelegateOverlay();
    quietSmartHeader();
    const r = parseRoute();
    // Account-menu comments, replies, and wallet collapse the banner on mobile.
    // Profile-nav tabs keep that collapse. A direct link to one's account, and
    // account-menu Profile, show the banner again.
    const fromAccountMenu =
      accountMenuSubNav && !fromProfileNav && isSessionProfileSubLink(currentPath());
    const fromAccountProfile =
      accountMenuProfile && !fromProfileNav && isSessionProfileLink(currentPath());
    if (!fromAccountMenu) accountMenuSubNav = false;
    if (!fromAccountProfile) accountMenuProfile = false;
    syncAccountMenuBanner(accountBannerMode(r, fromAccountMenu, fromAccountProfile, fromProfileNav));
    if (r.name === "post") {
      HiveMd.whenMarkdownReady();
      ensureHistoryNav();
      noteProfileReturnStep(fromPop, pushed, "post");
      noteFeedStack(fromPop, pushed, "post");
      publishNavPushed = false;
      const jumpComments =
        pendingCommentsScroll || (!HASH_ROUTING && location.hash === "#comments");
      const anchor = !jumpComments ? commentHashFromLocation() : "";
      pendingCommentsScroll = false;
      hidePublishOverlay();
      await presentPost(r.author, r.permlink, { jumpComments, anchor });
      return;
    }
    // Capture the feed before welcome teardown scrolls the window to the top.
    if (r.name === "profile" && canParkLiveFeed()) parkLiveFeed(fromPop);
    noteProfileReturnStep(fromPop, pushed, r.name);
    noteFeedStack(fromPop, pushed, r.name);
    const showWelcome = resolveWelcome(r);
    applyWelcome(showWelcome);
    if (isHomePath() && observer() && !showWelcome) {
      navigate(appHref(pathForFeedSort(defaultFeedSort())), true);
      return;
    }
    if (r.name === "feed" && r.sort === "feed" && !observer()) {
      navigate(appHref("/"), true);
      return;
    }
    const key = routeKey(r);
    if (r.name === "community") {
      const here = currentPath().replace(/\/+$/, "") || "/";
      const target = communityRedirectTarget(here, r);
      if (target) {
        communityNavSwitch = fromCommunityNav;
        navigate(appHref(target), true);
        return;
      }
    }
    const nav = ensureHistoryNav();
    const restored = takeFeedPark(nav, key);
    // A post opened from the feed stays up under the publish dialog. Closing
    // the dialog returns to that post instead of the feed underneath.
    const keepPost = r.name === "publish" && postLayer.open;
    // Publish opens over the subspace page. Keep subscribe state for when it closes.
    const keepCommunity =
      r.name === "publish" &&
      currentViewKey.startsWith("community:") &&
      !currentViewKey.startsWith("communities:");
    if (r.name !== "community" && !keepCommunity) resetCommunityState();
    if (r.name !== "profile") resetProfileState();
    if (r.name !== "settings") {
      clearSettingsProfileScratch();
      clearSettingsKeys();
    }
    if (r.name !== "publish") {
      document.body.classList.toggle(
        "is-profile",
        r.name === "profile" || r.name === "community"
      );
      document.body.classList.toggle("is-community", r.name === "community");
    }
    if (restored) {
      mountFeedPark(restored);
      currentViewKey = key;
      liveFeedNav = nav;
    }
    const sameView = Boolean(key && key === currentViewKey && view.innerHTML.trim());
    if (postLayer.open && !keepPost) {
      if (sameView) syncFeedCardOnReturn();
      // The parked feed applies its own offset after the post layer closes.
      suspendPostLayer({ restoreScroll: sameView && !restored });
    }
    if (!keepPost) currentPost = null;
    pendingCommentsScroll = false;

    if (r.name !== "publish") publishNavPushed = false;

    if (r.name === "publish") {
      const remembered = String(lastNonPublishPath || "").replace(/\/+$/, "") || "/";
      const rememberedName = parseRoute(remembered).name;
      const keepRemembered =
        remembered === "/" || rememberedName === "welcome" || rememberedName === "post";
      if (currentViewKey && !keepRemembered) lastNonPublishPath = pathFromViewKey(currentViewKey);
      else if (!currentViewKey && (!lastNonPublishPath || parseRoute(lastNonPublishPath).name === "publish")) {
        lastNonPublishPath = "/";
      }
      if (!currentViewKey) {
        window.scrollTo(0, 0);
        const sort = defaultFeedSort();
        setPageMeta(sort === "feed" ? "Feed — CyberSpace77" : "CyberSpace77");
        await renderFeed(sort, true);
        currentViewKey = "feed:" + sort;
        storeFeedView(sort);
      }
      openPublishOverlay();
      return;
    }

    hidePublishOverlay();
    if (sameView) {
      applyRouteTitle(r);
      if (fromAccountMenu) {
        settleAccountMenuSub();
        accountMenuSubNav = false;
      }
      if (fromAccountProfile) accountMenuProfile = false;
      if (restored) {
        if (restored.hadWelcome) revealParkedWelcome();
        scrollWindowInstant(restored.scrollY);
        if (restored.feed.loading) resumeParkedFeedLoad();
        else queueFeedInfinite();
      } else if (isRestorableFeedKey(key)) {
        // This entry now shows the mounted feed. A profile opened next parks
        // under this id, so Back and the logo find the same list.
        liveFeedNav = nav;
      }
      return;
    }

    if (
      !(fromProfileNav && r.name === "profile") &&
      !(fromCommunityNav && r.name === "community")
    ) {
      if (fromAccountMenu) settleAccountMenuSub();
      else window.scrollTo(0, 0);
    }
    if (r.name === "welcome") {
      setPageMeta("CyberSpace77");
      currentViewKey = key;
      liveFeedNav = nav;
      await renderFeed("latest", true, "");
      if (!routeStill(key)) return;
      currentViewKey = key;
      liveFeedNav = nav;
      return;
    }
    if (r.name === "feed") {
      if (!r.tag && !(showWelcome && isHomePath())) storeFeedView(r.sort);
      if (r.tag) {
        setPageMeta("#" + r.tag + " — CyberSpace77");
      } else {
        setPageMeta(r.sort === "feed" ? "Feed — CyberSpace77" : "CyberSpace77");
      }
      currentViewKey = key;
      liveFeedNav = nav;
      await renderFeed(r.sort, true, r.tag || "");
      if (!routeStill(key)) return;
      currentViewKey = key;
      liveFeedNav = nav;
      return;
    }
    if (r.name === "profile") {
      const canonical = pathForProfile(r.author, r.page);
      const here = currentPath().replace(/\/+$/, "") || "/";
      if (here !== canonical) {
        profileNavSwitch = fromProfileNav;
        navigate(appHref(canonical), true);
        return;
      }
      currentViewKey = key;
      liveFeedNav = 0;
      accountMenuSubNav = false;
      accountMenuProfile = false;
      await renderProfile(r.author, r.page);
      if (!routeStill(key)) return;
      currentViewKey = key;
      liveFeedNav = 0;
      return;
    }
    if (r.name === "community") {
      currentViewKey = key;
      liveFeedNav = nav;
      await renderCommunity(r.community, r.page);
      if (!routeStill(key)) return;
      currentViewKey = key;
      liveFeedNav = nav;
      return;
    }
    if (r.name === "tags") {
      liveFeedNav = 0;
      currentViewKey = key;
      await renderTagsPage();
      if (!routeStill(key)) return;
      currentViewKey = key;
      return;
    }
    if (r.name === "communities") {
      const canonical = pathForSubspaces(r.page);
      const here = currentPath().replace(/\/+$/, "") || "/";
      if (here !== canonical) {
        navigate(appHref(canonical), true);
        return;
      }
      liveFeedNav = 0;
      currentViewKey = key;
      await renderCommunitiesPage(r.page);
      if (!routeStill(key)) return;
      currentViewKey = key;
      return;
    }
    if (r.name === "settings") {
      const canonical = pathForSettings(r.page);
      const here = currentPath().replace(/\/+$/, "") || "/";
      if (here !== canonical) {
        navigate(appHref(canonical), true);
        return;
      }
      liveFeedNav = 0;
      currentViewKey = key;
      await renderSettings(r.page);
      if (!routeStill(key)) return;
      currentViewKey = key;
      return;
    }
    if (r.name === "search") {
      const canonical = pathForSearch(r.page);
      const here = currentPath().replace(/\/+$/, "") || "/";
      if (here !== canonical) {
        navigate(appHref(canonical), true);
        return;
      }
      liveFeedNav = 0;
      currentViewKey = key;
      renderSearchPage(r.page);
      if (!routeStill(key)) return;
      currentViewKey = key;
      return;
    }
    if (r.name === "about") {
      liveFeedNav = 0;
      renderAbout();
      currentViewKey = key;
      return;
    }
    if (r.name === "imprint") {
      liveFeedNav = 0;
      renderImprint();
      currentViewKey = key;
      return;
    }
    setPageMeta("Not found — CyberSpace77");
    liveFeedNav = 0;
    view.innerHTML = notFoundHtml();
    currentViewKey = "notfound";
  }

  function updateScrollTopBtn() {
    const btn = document.getElementById("scrollTopBtn");
    if (!btn) return;
    const top = window.scrollY || window.pageYOffset || 0;
    btn.classList.toggle("is-visible", top > 320);
  }

  function scrollActiveToTop() {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const behavior = reduce.matches ? "auto" : "smooth";
    window.scrollTo({ top: 0, behavior });
  }

  function bindScrollTop() {
    const btn = $("#scrollTopBtn");
    if (!btn) return;
    window.addEventListener("scroll", updateScrollTopBtn, { passive: true });
    btn.addEventListener("click", scrollActiveToTop);
    updateScrollTopBtn();
  }

  let lastSmartHeaderY = 0;
  let smartHeaderTick = 0;
  let smartHeaderDir = 0;
  let smartHeaderShowGen = 0;
  let smartHeaderRevealPending = false;
  let smartHeaderUser = false;
  let smartHeaderUserTimer = 0;

  function siteHeaderEl() {
    return $("#siteHeader") || document.querySelector(".header");
  }

  function headerSlotEl() {
    return $("#headerSlot") || document.querySelector(".header-slot");
  }

  function scrollYNow() {
    return window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;
  }

  function pageAllowsSmartHeader(headerH) {
    const extra = Math.max((headerH || 0) * 2, 240);
    return document.documentElement.scrollHeight > window.innerHeight + extra;
  }

  function syncSmartHeaderSlot() {
    const header = siteHeaderEl();
    const slot = headerSlotEl();
    if (!header || !slot) return;
    if (header.classList.contains("is-smart")) {
      slot.style.height = header.offsetHeight + "px";
    } else {
      slot.style.height = "";
    }
  }

  function releaseSmartHeader() {
    const header = siteHeaderEl();
    const slot = headerSlotEl();
    smartHeaderShowGen += 1;
    smartHeaderRevealPending = false;
    if (!header) return;
    if (!header.classList.contains("is-smart")) {
      if (slot) slot.style.height = "";
      return;
    }
    header.classList.add("is-unhooking");
    header.classList.remove("is-shown", "is-smart");
    if (slot) slot.style.height = "";
    void header.offsetWidth;
    header.classList.remove("is-unhooking");
  }

  function quietSmartHeader() {
    smartHeaderUser = false;
    if (smartHeaderUserTimer) {
      clearTimeout(smartHeaderUserTimer);
      smartHeaderUserTimer = 0;
    }
    smartHeaderDir = 0;
    releaseSmartHeader();
    lastSmartHeaderY = scrollYNow();
  }

  function markSmartHeaderUser(e) {
    if (e && e.type === "keydown") {
      const k = e.key;
      if (
        k !== "ArrowUp" &&
        k !== "ArrowDown" &&
        k !== "PageUp" &&
        k !== "PageDown" &&
        k !== "Home" &&
        k !== "End" &&
        k !== " "
      ) {
        return;
      }
      const t = e.target;
      if (t && t.closest && t.closest("input, textarea, select, [contenteditable]")) {
        return;
      }
    }
    smartHeaderUser = true;
    if (smartHeaderUserTimer) clearTimeout(smartHeaderUserTimer);
    smartHeaderUserTimer = setTimeout(() => {
      smartHeaderUser = false;
      smartHeaderUserTimer = 0;
    }, 180);
  }

  function scheduleSmartHeaderReveal(header) {
    const gen = ++smartHeaderShowGen;
    smartHeaderRevealPending = true;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (gen !== smartHeaderShowGen) return;
        smartHeaderRevealPending = false;
        if (!header.classList.contains("is-smart")) return;
        header.classList.add("is-shown");
      });
    });
  }

  function pinSmartHeader(show) {
    const header = siteHeaderEl();
    const slot = headerSlotEl();
    if (!header || !slot) return;
    const wasSmart = header.classList.contains("is-smart");
    if (!wasSmart) {
      // Snap to a fixed, hidden bar with transitions off. The in-flow header
      // is already opacity 1; without this the first show has nothing to fade from.
      slot.style.height = header.offsetHeight + "px";
      header.classList.add("is-unhooking", "is-smart");
      header.classList.remove("is-shown");
      void header.offsetWidth;
      header.classList.remove("is-unhooking");
      if (show) scheduleSmartHeaderReveal(header);
    } else if (show && !smartHeaderRevealPending) {
      header.classList.add("is-shown");
    }
    if (!show) {
      smartHeaderShowGen += 1;
      smartHeaderRevealPending = false;
      header.classList.remove("is-shown");
      closeLogoMenu();
      closeNodeMenus();
      setSessionMenuOpen(false);
      setAccountMenuOpen(false);
    }
    if (header.classList.contains("is-smart")) {
      slot.style.height = header.offsetHeight + "px";
    }
  }

  function updateSmartHeader() {
    const header = siteHeaderEl();
    if (!header) return;
    const y = Math.max(0, scrollYNow());
    const h = header.offsetHeight || 0;
    const dy = y - lastSmartHeaderY;
    lastSmartHeaderY = y;
    const long = pageAllowsSmartHeader(h);
    const atTop = y <= 2;
    const past = y > h + 8;

    if (atTop || !long) {
      releaseSmartHeader();
      smartHeaderDir = 0;
      return;
    }

    if (y <= h && !header.classList.contains("is-shown")) {
      releaseSmartHeader();
      smartHeaderDir = 0;
      return;
    }

    if (!smartHeaderUser) {
      smartHeaderDir = 0;
      return;
    }

    smartHeaderDir += dy;
    /* smart header treshold */
    if (Math.abs(smartHeaderDir) < 32) return;

    if (smartHeaderDir < 0 && past) pinSmartHeader(true);
    else if (smartHeaderDir > 0 && past && header.classList.contains("is-smart")) {
      pinSmartHeader(false);
    }
    smartHeaderDir = 0;
  }

  function bindSmartHeader() {
    lastSmartHeaderY = scrollYNow();
    window.addEventListener("wheel", markSmartHeaderUser, { passive: true, capture: true });
    window.addEventListener("touchmove", markSmartHeaderUser, { passive: true, capture: true });
    window.addEventListener("keydown", markSmartHeaderUser, { capture: true });
    window.addEventListener(
      "scroll",
      () => {
        if (smartHeaderTick) return;
        smartHeaderTick = requestAnimationFrame(() => {
          smartHeaderTick = 0;
          updateSmartHeader();
        });
      },
      { passive: true }
    );
    window.addEventListener("resize", () => {
      syncSmartHeaderSlot();
      updateSmartHeader();
    });
    updateSmartHeader();
  }

  function bindLogoSpin() {
    const logo = $(".app-logo");
    if (!logo) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let angle = 0;

    logo.addEventListener("pointerenter", () => {
      if (reduce.matches) return;
      logo.classList.add("is-spinning");
    });

    logo.addEventListener("pointermove", (e) => {
      if (reduce.matches) return;
      angle += e.movementX;
      logo.style.transform = "rotate(" + angle + "deg)";
    });

    logo.addEventListener("pointerleave", () => {
      angle = 0;
      logo.classList.remove("is-spinning");
      logo.style.transform = "rotate(0deg)";
    });
  }

  function bindLogoMenu() {
    paintLogoMenu();
    const logoWrap = $("#logoWrap");
    const trigger = $("#logoTrigger");
    if (!logoWrap || !trigger) return;

    trigger.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const open = !logoWrap.classList.contains("is-open");
      logoWrap.classList.toggle("is-open", open);
      trigger.setAttribute("aria-expanded", open ? "true" : "false");
    });

    document.addEventListener("click", (e) => {
      if (!logoWrap.classList.contains("is-open")) return;
      if (e.target.closest("#logoMenu")) {
        if (e.target.closest(".logo-dropdown-link")) closeLogoMenu();
        return;
      }
      closeLogoMenu();
    });
  }

  function bindRootLinks() {
    document.querySelectorAll("a[href]").forEach((a) => {
      const href = a.getAttribute("href");
      if (!href || !href.startsWith("/") || href.startsWith("//")) return;
      a.setAttribute("href", appHref(href));
    });
  }

  // j and k move through the feed. Enter opens that card when it is focused.
  // l opens the upvote panel, and l again casts it. Enter still casts while the panel is open.
  // A text field or an open dialog keeps those keys. The vote slider does not.
  const FEED_KEY_GAP = 12;
  const FEED_KEY_SLACK = 24;
  let feedKeyItem = null;
  let feedKeyNavigating = false;
  let feedKeyNavTimer = 0;

  function feedKeyTyping(e) {
    const nodes = [eventElement(e.target), eventElement(document.activeElement)];
    for (let n = 0; n < nodes.length; n++) {
      let el = nodes[n];
      while (el && el !== document.body && el !== document.documentElement) {
        const tag = el.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "FORM") return true;
        if (el.isContentEditable) return true;
        const role = el.getAttribute("role");
        if (role === "textbox" || role === "searchbox") return true;
        el = el.parentElement;
      }
    }
    return false;
  }

  function feedKeySliderFocused(e) {
    const nodes = [eventElement(e.target), eventElement(document.activeElement)];
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      if (el && el.closest && el.closest(".vote-slider-panel, .downvote-slider-panel")) return true;
    }
    return false;
  }

  function feedKeyDialogOpen() {
    const overlays = document.querySelectorAll(".overlay");
    for (let i = 0; i < overlays.length; i++) {
      if (!overlays[i].hidden) return true;
    }
    const el = eventElement(document.activeElement);
    return Boolean(el && el.closest("[role='dialog'], [aria-modal='true']"));
  }

  function feedKeyItems() {
    if (document.body.classList.contains("is-post-open")) return [];
    const list = document.getElementById("feedList");
    if (!list) return [];
    const nodes = list.children;
    const items = [];
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      if (!el.classList || !el.classList.contains("feed-item")) continue;
      if (el.closest("[hidden]")) continue;
      const rect = el.getBoundingClientRect();
      if (rect.height < 1 || rect.width < 1) continue;
      items.push(el);
    }
    return items;
  }

  function feedKeyAnchor() {
    const header = siteHeaderEl();
    if (
      header &&
      header.classList.contains("is-smart") &&
      header.classList.contains("is-shown")
    ) {
      const bottom = header.getBoundingClientRect().bottom;
      if (bottom > 0) return bottom + FEED_KEY_GAP;
    }
    return FEED_KEY_GAP;
  }

  function feedKeyCard(el) {
    if (!el) return null;
    return el.querySelector("article.post-card") || el;
  }

  function clearFeedKeyCurrent() {
    const item = feedKeyItem;
    feedKeyItem = null;
    if (!item) return;
    const active = document.activeElement;
    const card = feedKeyCard(item);
    if (active && (active === card || active === item) && active.blur) active.blur();
  }

  function markFeedKeyCurrent(el) {
    if (!el) return;
    feedKeyItem = el;
    const card = feedKeyCard(el);
    if (!card) return;
    if (card.getAttribute("tabindex") !== "-1") card.setAttribute("tabindex", "-1");
    beginOwnedFeedScroll();
    try {
      card.focus({ preventScroll: true });
    } catch (err) {
      try {
        card.focus();
      } catch (err2) {
        /* ignore */
      }
    }
  }

  function beginOwnedFeedScroll() {
    feedKeyNavigating = true;
    if (feedKeyNavTimer) clearTimeout(feedKeyNavTimer);
    feedKeyNavTimer = setTimeout(() => {
      feedKeyNavigating = false;
      feedKeyNavTimer = 0;
    }, 200);
  }

  function onFeedKeyPageScroll() {
    if (!feedKeyNavigating) {
      clearFeedKeyCurrent();
      return;
    }
    if (feedKeyNavTimer) clearTimeout(feedKeyNavTimer);
    feedKeyNavTimer = setTimeout(() => {
      feedKeyNavigating = false;
      feedKeyNavTimer = 0;
    }, 180);
  }

  function scrollFeedItemToAnchor(el, behavior) {
    if (!el) return;
    beginOwnedFeedScroll();
    quietSmartHeader();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const chosen = behavior || (reduce ? "instant" : "smooth");
    const top = Math.max(0, scrollYNow() + el.getBoundingClientRect().top - FEED_KEY_GAP);
    try {
      window.scrollTo({
        top: top,
        left: 0,
        behavior: chosen === "instant" ? "instant" : "smooth",
      });
    } catch (err) {
      window.scrollTo(0, top);
    }
  }

  function feedKeyLocked(items) {
    if (!feedKeyItem || !feedKeyItem.isConnected) return null;
    for (let i = 0; i < items.length; i++) {
      if (items[i] === feedKeyItem) return feedKeyItem;
    }
    return null;
  }

  function feedKeyNextItem(items) {
    const line = feedKeyAnchor() + FEED_KEY_SLACK;
    for (let i = 0; i < items.length; i++) {
      if (items[i].getBoundingClientRect().top > line) return items[i];
    }
    return null;
  }

  function feedKeyPrevItem(items) {
    const line = feedKeyAnchor() + FEED_KEY_SLACK;
    let current = -1;
    for (let i = 0; i < items.length; i++) {
      if (items[i].getBoundingClientRect().top <= line) current = i;
      else break;
    }
    if (current <= 0) return null;
    return items[current - 1];
  }

  function feedKeyCurrentItem(items) {
    const anchor = feedKeyAnchor();
    const line = anchor + FEED_KEY_SLACK;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    let current = null;
    for (let i = 0; i < items.length; i++) {
      const rect = items[i].getBoundingClientRect();
      if (rect.bottom <= anchor) continue;
      if (rect.top <= line) current = items[i];
      else break;
    }
    if (current) return current;
    for (let i = 0; i < items.length; i++) {
      const rect = items[i].getBoundingClientRect();
      if (rect.bottom > anchor && rect.top < vh) return items[i];
    }
    return null;
  }

  function feedKeyMove(dir) {
    const items = feedKeyItems();
    if (!items.length) return false;
    const locked = feedKeyLocked(items);
    let target = null;
    if (locked) {
      let idx = -1;
      for (let i = 0; i < items.length; i++) {
        if (items[i] === locked) {
          idx = i;
          break;
        }
      }
      const next = idx + dir;
      if (next < 0 || next >= items.length) return false;
      target = items[next];
    } else {
      target = dir > 0 ? feedKeyNextItem(items) : feedKeyPrevItem(items);
    }
    if (!target || target === locked) return false;
    markFeedKeyCurrent(target);
    scrollFeedItemToAnchor(target);
    return true;
  }

  function feedKeyUpvote() {
    const items = feedKeyItems();
    if (!items.length) return false;
    const item = feedKeyLocked(items) || feedKeyCurrentItem(items);
    if (!item) return false;
    const card = item.querySelector("article.post-card");
    const btn = card && card.querySelector(".vote-btn");
    markFeedKeyCurrent(item);
    if (
      !btn ||
      btn.disabled ||
      btn.classList.contains("is-pending") ||
      btn.classList.contains("is-voted")
    ) {
      return true;
    }
    if (
      openSlider &&
      openSlider.mode === "up" &&
      openSlider.btn === btn &&
      openSlider.panel &&
      !openSlider.panel.hidden
    ) {
      onVoteClick(btn);
      return true;
    }
    feedKeyDockSlider = true;
    onVoteClick(btn);
    return true;
  }

  function feedKeyVotePanelOpen() {
    return Boolean(openSlider && openSlider.panel && !openSlider.panel.hidden);
  }

  function feedKeyOpenCurrent() {
    if (feedKeyVotePanelOpen()) return false;
    const item = feedKeyLocked(feedKeyItems());
    if (!item) return false;
    const card = feedKeyCard(item);
    if (!card || card !== document.activeElement) return false;
    if (!card.classList || !card.classList.contains("post-card")) return false;
    return openCardPost(card);
  }

  function onFeedKeyDown(e) {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.isComposing) return;
    const key = String(e.key || "").toLowerCase();
    if (key !== "j" && key !== "k" && key !== "l" && key !== "enter") return;
    if (e.repeat && (key === "l" || key === "enter")) return;
    if (feedKeyDialogOpen()) return;
    if (feedKeyTyping(e) && !feedKeySliderFocused(e)) return;
    if (!feedKeyItems().length) return;
    if (key === "enter") {
      if (!feedKeyOpenCurrent()) return;
    } else if (key === "j" || key === "k") {
      if (openSlider) hideVoteSlider();
      feedKeyMove(key === "j" ? 1 : -1);
    } else feedKeyUpvote();
    e.preventDefault();
    e.stopPropagation();
  }

  function onFeedKeyUserScroll(e) {
    const el = eventElement(e.target);
    if (
      el &&
      el.closest(
        ".vote-voters-panel, .vote-slider-panel, .downvote-slider-panel, .reblog-confirm-panel, .overlay"
      )
    ) {
      return;
    }
    feedKeyNavigating = false;
    if (feedKeyNavTimer) {
      clearTimeout(feedKeyNavTimer);
      feedKeyNavTimer = 0;
    }
    clearFeedKeyCurrent();
  }

  function bindFeedKeys() {
    document.addEventListener("keydown", onFeedKeyDown, true);
    window.addEventListener("scroll", onFeedKeyPageScroll, { passive: true });
    window.addEventListener("wheel", onFeedKeyUserScroll, { passive: true, capture: true });
    window.addEventListener("touchmove", onFeedKeyUserScroll, { passive: true, capture: true });
  }

  function boot() {
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    bindRootLinks();
    bindLogoSpin();
    bindLogoMenu();
    bindNodeMenus();
    bindScrollTop();
    window.addEventListener("scroll", maybeLoadMoreBrowse, { passive: true });
    window.addEventListener("resize", maybeLoadMoreBrowse);
    window.addEventListener("scroll", maybeLoadMoreFeed, { passive: true });
    window.addEventListener("resize", maybeLoadMoreFeed);
    window.addEventListener("scroll", maybeLoadMoreWallet, { passive: true });
    window.addEventListener("resize", maybeLoadMoreWallet);
    const peopleScroll = document.getElementById("peopleScroll");
    if (peopleScroll) {
      peopleScroll.addEventListener("scroll", maybeLoadMorePeople, { passive: true });
    }
    window.addEventListener("resize", maybeLoadMorePeople);
    window.addEventListener("resize", () => fitPublishTitle());
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => fitPublishTitle());
    }
    window.addEventListener("scroll", maybeLoadMoreSearch, { passive: true });
    window.addEventListener("resize", maybeLoadMoreSearch);
    bindSmartHeader();
    bindFeedKeys();
    bindWelcome();
    const versionEl = document.getElementById("appVersion");
    if (versionEl) versionEl.textContent = "version " + APP_VERSION;

    document.addEventListener(
      "pointerdown",
      (e) => {
        const slider = e.target && e.target.closest && e.target.closest(".vote-slider");
        if (!slider || e.pointerType !== "touch" || !isMobileViewport()) return;
        beginTouchVoteSnap(slider, e.pointerId);
      },
      true
    );
    document.addEventListener("pointerup", endTouchVotePointer, true);
    document.addEventListener("pointercancel", endTouchVotePointer, true);

    document.addEventListener("input", (e) => {
      if (e.target && e.target.id === "searchInput") {
        searchBox = e.target.value;
        return;
      }
      const slider = e.target.closest(".vote-slider");
      if (slider) {
        const panel =
          slider.closest(".downvote-slider-panel") || slider.closest(".vote-slider-panel");
        if (!panel) return;
        applyTouchVoteSnap(slider);
        const valueEl = panel.querySelector(".vote-weight-value");
        const isDown = Boolean(slider.closest(".downvote-slider-panel"));
        paintVoteSlider(slider, valueEl);
        if (isDown) storeDownvoteWeight(slider.value, voteKindFromEl(slider));
        else storeWeight(slider.value, voteKindFromEl(slider));
        return;
      }
      if (e.target && e.target.classList && e.target.classList.contains("composer-input")) {
        const composer = e.target.closest(".comment-composer");
        if (composer) scheduleCommentDraftSave(composer);
      }
      if (e.target && e.target.closest && e.target.closest("#settingsProfileForm")) {
        rememberSettingsProfileDraft();
      }
      if (
        e.target.id === "publishTitle" ||
        e.target.id === "publishBody" ||
        e.target.id === "publishTagInput" ||
        e.target.id === "publishDescription" ||
        e.target.id === "publishReward" ||
        (e.target.closest && e.target.closest(".publish-beneficiary-row"))
      ) {
        if (e.target.id === "publishTitle") {
          // Predictive text keeps the word in composition. Refresh the ring
          // and the height, and leave the byte cap until the word is committed.
          if (e.isComposing) fitPublishTitle(e.target);
          else enforcePublishTitleLimit(e.target);
        }
        if (e.target.id === "publishTitle" || e.target.id === "publishBody") {
          savePublishDraft();
          updatePublishPreview();
        }
        if (e.target.id === "publishReward") paintPublishRewardNote();
        schedulePublishDraftSave();
      }
    });

    let publishTitleComposeTimer = 0;
    const settlePublishTitle = (input) => {
      enforcePublishTitleLimit(input);
      savePublishDraft();
      updatePublishPreview();
      schedulePublishDraftSave();
    };
    // Gboard updates the underlined word through compositionupdate, and writes
    // the tapped suggestion after compositionend.
    document.addEventListener("compositionupdate", (e) => {
      if (!e.target || e.target.id !== "publishTitle") return;
      fitPublishTitle(e.target);
      savePublishDraft();
      updatePublishPreview();
      schedulePublishDraftSave();
    });
    document.addEventListener("compositionend", (e) => {
      if (!e.target || e.target.id !== "publishTitle") return;
      const input = e.target;
      settlePublishTitle(input);
      if (publishTitleComposeTimer) clearTimeout(publishTitleComposeTimer);
      publishTitleComposeTimer = setTimeout(() => {
        publishTitleComposeTimer = 0;
        if (!input.isConnected) return;
        settlePublishTitle(input);
      }, 0);
    });

    document.addEventListener("change", (e) => {
      if (e.target && e.target.id === "publishReward") {
        paintPublishRewardNote();
        schedulePublishDraftSave();
      }
      if (e.target && (e.target.id === "settingsVotePost" || e.target.id === "settingsVoteComment")) {
        commitSettingsWeightInput(e.target);
        return;
      }
      if (e.target && (e.target.id === "settingsAvatarFile" || e.target.id === "settingsCoverFile")) {
        const input = e.target;
        const file = input.files && input.files[0];
        const kind = input.id === "settingsCoverFile" ? "cover" : "avatar";
        input.value = "";
        if (file) uploadSettingsPicture(kind, file);
      }
    });

    document.addEventListener(
      "click",
      (e) => {
        const payoutHit = e.target.closest(".payout");
        if (payoutHit && inInteractiveSurface(payoutHit)) {
          e.preventDefault();
          e.stopPropagation();
          togglePayoutPanel(payoutHit);
          return;
        }
        if (!e.target.closest(".payout-panel")) hidePayoutPanel();
        const reblogConfirm = e.target.closest(".reblog-confirm");
        if (reblogConfirm) {
          e.preventDefault();
          e.stopPropagation();
          onReblogConfirm(reblogConfirm);
          return;
        }
        const reblogCancel = e.target.closest(".reblog-cancel");
        if (reblogCancel) {
          e.preventDefault();
          e.stopPropagation();
          hideReblogConfirm();
          return;
        }
        const reblogList = e.target.closest(".reblog-list");
        if (reblogList) {
          e.preventDefault();
          e.stopPropagation();
          onReblogList(reblogList);
          return;
        }
        if (e.target.closest(".reblog-confirm-panel")) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        const reblogBtn = e.target.closest(".reblog-btn");
        if (reblogBtn && inInteractiveSurface(reblogBtn)) {
          e.preventDefault();
          e.stopPropagation();
          onReblogClick(reblogBtn);
          return;
        }
        const confirm = e.target.closest(".downvote-confirm");
        if (confirm) {
          e.preventDefault();
          e.stopPropagation();
          onDownvoteConfirm(confirm);
          return;
        }
        if (
          e.target.closest(".vote-slider-panel") ||
          e.target.closest(".downvote-slider-panel")
        ) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        const downBtn = e.target.closest(".downvote-btn");
        if (downBtn && inInteractiveSurface(downBtn)) {
          e.preventDefault();
          e.stopPropagation();
          onDownvoteClick(downBtn);
          return;
        }
        const countBtn = e.target.closest(".vote-count-btn");
        if (countBtn && inInteractiveSurface(countBtn)) {
          e.preventDefault();
          e.stopPropagation();
          onVoteCountClick(countBtn);
          return;
        }
        const btn = e.target.closest(".vote-btn");
        if (btn && inInteractiveSurface(btn)) {
          e.preventDefault();
          e.stopPropagation();
          onVoteClick(btn);
          return;
        }
        if (
          !e.target.closest(".vote-wrap") &&
          !e.target.closest(".vote-voters-panel") &&
          !e.target.closest(".reblog-wrap")
        ) {
          hideVoteUi();
        }
      },
      true
    );

    document.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        castVoteFromSliderKey(e);
        return;
      }
      if (e.key !== "Escape") return;
      if (openPayout) {
        hidePayoutPanel();
        return;
      }
      if (openReblog) {
        hideReblogConfirm();
        return;
      }
      if (!openSlider) return;
      hideVoteSlider();
    });

    document.addEventListener("click", (e) => {
      const profileMoreEl = eventElement(e.target);
      const inProfileMoreMenu = Boolean(profileMoreEl && profileMoreEl.closest(".profile-more-menu"));
      const inProfileMore = Boolean(
        profileMoreEl && (profileMoreEl.closest(".profile-more") || inProfileMoreMenu)
      );
      if (!inProfileMore) closeProfileMore();
      if (inProfileMoreMenu) {
        const profileMuteBtn = profileMoreEl.closest(".profile-mute-btn");
        if (profileMuteBtn) {
          e.preventDefault();
          closeProfileMore();
          toggleProfileMute();
          return;
        }
        const writeBtn = profileMoreEl.closest(".community-write-btn");
        if (writeBtn) {
          e.preventDefault();
          closeProfileMore();
          openCommunityPublish();
          return;
        }
        if (profileMoreEl.closest(".profile-more-item")) closeProfileMore();
        return;
      }
      const inContentMoreMenu = Boolean(
        profileMoreEl && profileMoreEl.closest(".content-more-menu")
      );
      const inContentMore = Boolean(
        profileMoreEl && (profileMoreEl.closest(".content-more") || inContentMoreMenu)
      );
      if (!inContentMore) closeContentMore();
      if (inContentMoreMenu) {
        const editItem = profileMoreEl.closest(".content-more-edit");
        const copyItem = profileMoreEl.closest(".content-more-copy");
        const deleteItem = profileMoreEl.closest(".content-more-delete");
        if (editItem || copyItem || deleteItem) {
          e.preventDefault();
          const root = document.querySelector(".content-more.is-open");
          const deleteAuthor = root && root.getAttribute("data-author");
          const deletePermlink = root && root.getAttribute("data-permlink");
          const deleteKind = root && root.getAttribute("data-content-kind");
          closeContentMore();
          if (root && deleteItem) openContentDelete(deleteAuthor, deletePermlink, deleteKind);
          else if (root && editItem) editContentFromMore(root);
          else if (root) copyContentLink(root);
          return;
        }
        if (profileMoreEl.closest(".content-more-item")) closeContentMore();
        return;
      }
      if (inContentMore) {
        const contentMoreBtn = profileMoreEl.closest(".content-more-btn");
        if (contentMoreBtn) {
          e.preventDefault();
          toggleContentMore(contentMoreBtn);
        }
        return;
      }
      if (!inInteractiveSurface(e.target)) return;
      const profileMoreBtn = e.target.closest(".profile-more-btn");
      if (profileMoreBtn && inInteractiveSurface(profileMoreBtn)) {
        e.preventDefault();
        toggleProfileMore(profileMoreBtn);
        return;
      }
      const removeTag = e.target.closest("[data-remove-tag]");
      if (removeTag && inInteractiveSurface(removeTag)) {
        e.preventDefault();
        removeFavoriteTag(removeTag.getAttribute("data-remove-tag"));
        return;
      }
      const addTag = e.target.closest("[data-add-tag]");
      if (addTag && inInteractiveSurface(addTag)) {
        e.preventDefault();
        addFavoriteTag(addTag.getAttribute("data-add-tag"));
        return;
      }
      const removeCommunity = e.target.closest("[data-remove-community]");
      if (removeCommunity && inInteractiveSurface(removeCommunity)) {
        e.preventDefault();
        removeFavoriteCommunity(removeCommunity.getAttribute("data-remove-community"));
        return;
      }
      const toggleCommunity = e.target.closest("[data-toggle-community]");
      if (toggleCommunity && inInteractiveSurface(toggleCommunity)) {
        e.preventDefault();
        toggleFavoriteCommunity(
          toggleCommunity.getAttribute("data-toggle-community"),
          toggleCommunity.getAttribute("data-community-title")
        );
        return;
      }
      const toggleUser = e.target.closest("[data-toggle-user]");
      if (toggleUser && inInteractiveSurface(toggleUser)) {
        e.preventDefault();
        toggleFavoriteUser(toggleUser.getAttribute("data-toggle-user"));
        return;
      }
      const subBtn = e.target.closest(".community-sub-btn");
      if (subBtn && inInteractiveSurface(subBtn)) {
        e.preventDefault();
        toggleCommunitySubscription();
        return;
      }
      const addMember = e.target.closest("[data-community-add]");
      if (addMember && inInteractiveSurface(addMember)) {
        e.preventDefault();
        openCommunityRoleDialog({ mode: "add", role: addMember.getAttribute("data-community-add") || "" });
        return;
      }
      const memberAction = e.target.closest("[data-community-action]");
      if (memberAction && inInteractiveSurface(memberAction)) {
        e.preventDefault();
        const action = memberAction.getAttribute("data-community-action");
        const account = memberAction.getAttribute("data-account") || "";
        const role = memberAction.getAttribute("data-role") || "";
        const title = memberAction.getAttribute("data-title") || "";
        if (action === "change") openCommunityRoleDialog({ mode: "change", account, role, title });
        else if (action === "title") openCommunityTitleDialog({ account, role, title });
        else if (action === "approve") approveCommunityMember(account, title);
        return;
      }
      const followBtn = e.target.closest(".profile-follow-btn");
      if (followBtn && inInteractiveSurface(followBtn)) {
        e.preventDefault();
        toggleProfileFollow();
        return;
      }
      const moreWallet = e.target.closest("#walletMoreBtn");
      if (moreWallet && inInteractiveSurface(moreWallet)) {
        e.preventDefault();
        if (profileState.walletTx) profileState.walletTx.holdAuto = false;
        loadMoreWalletHistory();
        return;
      }
      const lockedMemo = e.target.closest(".wallet-tx-memo-locked");
      if (lockedMemo && inInteractiveSurface(lockedMemo)) {
        e.preventDefault();
        decryptWalletMemo(lockedMemo);
        return;
      }
      const claimBtn = e.target.closest(".wallet-claim-btn");
      if (claimBtn && inInteractiveSurface(claimBtn)) {
        e.preventDefault();
        claimProfileRewards();
        return;
      }
      const stakeBtn = e.target.closest(".wallet-stake-btn");
      if (stakeBtn && inInteractiveSurface(stakeBtn)) {
        e.preventDefault();
        openWalletOverlay(stakeBtn.getAttribute("data-wallet-op") || "");
        return;
      }
      const delegatedToggle = e.target.closest(".wallet-delegated-toggle");
      if (delegatedToggle && inInteractiveSurface(delegatedToggle)) {
        e.preventDefault();
        toggleDelegatedHive();
        return;
      }
      const delegateBtn = e.target.closest(".wallet-delegate-btn");
      if (delegateBtn && inInteractiveSurface(delegateBtn)) {
        e.preventDefault();
        openDelegateDialog();
        return;
      }
      const undelegateBtn = e.target.closest(".wallet-undelegate-btn");
      if (undelegateBtn && inInteractiveSurface(undelegateBtn)) {
        e.preventDefault();
        openDelegateDialog({
          asset: undelegateBtn.getAttribute("data-delegate-asset") || "",
          account: undelegateBtn.getAttribute("data-delegate-account") || "",
        });
        return;
      }
      const showMuted = e.target.closest(".show-muted");
      if (showMuted && inInteractiveSurface(showMuted)) {
        e.preventDefault();
        revealMuted(showMuted);
        return;
      }
      const cancelBtn = e.target.closest(".composer-cancel");
      if (cancelBtn && inInteractiveSurface(cancelBtn)) {
        e.preventDefault();
        const comment = cancelBtn.closest(".comment");
        if (comment) closeCommentEditor(comment);
        return;
      }
      const replyBtn = e.target.closest(".comment-reply-btn");
      if (replyBtn && inInteractiveSurface(replyBtn)) {
        e.preventDefault();
        toggleReplyComposer(replyBtn);
        return;
      }
      const attachBtn = e.target.closest(".composer-attach");
      if (
        attachBtn &&
        attachBtn.id !== "publishLocationBtn" &&
        attachBtn.id !== "publishMdBtn" &&
        inInteractiveSurface(attachBtn)
      ) {
        e.preventDefault();
        const composer = attachBtn.closest(".comment-composer");
        const input = composer && composer.querySelector(".composer-file");
        if (input) input.click();
        return;
      }
      const submitBtn = e.target.closest(".composer-submit");
      if (submitBtn && inInteractiveSurface(submitBtn)) {
        e.preventDefault();
        const composer = submitBtn.closest(".comment-composer");
        if (composer) submitComment(composer);
      }
    });

    document.addEventListener("submit", (e) => {
      if (!e.target || !inInteractiveSurface(e.target)) return;
      if (e.target.id === "favTagsForm") {
        e.preventDefault();
        addFavoriteFromInput();
        return;
      }
      if (e.target.id === "communitySearchForm") {
        e.preventDefault();
        runCommunitySearch();
        return;
      }
      if (e.target.id === "searchForm") {
        e.preventDefault();
        runSearch();
      }
    });

    document.addEventListener("change", (e) => {
      const input = e.target.closest(".composer-file");
      if (!input || !inInteractiveSurface(input)) return;
      const composer = input.closest(".comment-composer");
      const files = input.files ? Array.from(input.files) : [];
      input.value = "";
      if (composer && files.length) uploadImagesToComposer(composer, files);
    });

    document.addEventListener("pointerdown", (e) => {
      const input = eventElement(e.target);
      if (!input || !input.closest(".composer-input")) return;
      const composer = commentAccessComposer(input);
      if (!composer) return;
      beginCommentCouncilCheck(composer);
    });
    document.addEventListener("focusin", (e) => {
      const input = eventElement(e.target);
      if (!input || !input.closest(".composer-input")) return;
      const composer = commentAccessComposer(input);
      if (!composer) return;
      beginCommentCouncilCheck(composer);
    });

    document.addEventListener("keydown", (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.key !== "Enter") return;
      const composer = e.target.closest(".comment-composer");
      if (!composer || !inInteractiveSurface(composer)) return;
      e.preventDefault();
      submitComment(composer);
    });

    document.addEventListener("dragenter", (e) => {
      const composer = e.target.closest(".comment-composer");
      if (!composer || !inInteractiveSurface(composer) || !isFileDrag(e)) return;
      e.preventDefault();
      composer.classList.add("is-dragover");
    });

    document.addEventListener("dragover", (e) => {
      const composer = e.target.closest(".comment-composer");
      if (!composer || !inInteractiveSurface(composer) || !isFileDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      composer.classList.add("is-dragover");
    });

    document.addEventListener("dragleave", (e) => {
      const composer = e.target.closest && e.target.closest(".comment-composer");
      if (!composer || !inInteractiveSurface(composer)) return;
      if (e.relatedTarget && composer.contains(e.relatedTarget)) return;
      composer.classList.remove("is-dragover");
    });

    document.addEventListener("drop", (e) => {
      const composer = e.target.closest(".comment-composer");
      if (!composer || !inInteractiveSurface(composer)) return;
      e.preventDefault();
      composer.classList.remove("is-dragover");
      const files = imageFilesFrom(e.dataTransfer);
      if (files.length) uploadImagesToComposer(composer, files);
      else composerStatus(composer, "Drop an image file (png, jpg, gif, webp).", true);
    });

    document.addEventListener("paste", (e) => {
      const composer = e.target.closest(".comment-composer");
      if (!composer || !inInteractiveSurface(composer)) return;
      const clip = e.clipboardData;
      const files = clip && clip.files ? Array.from(clip.files).filter(isImageFile) : [];
      if (!files.length) return;
      e.preventDefault();
      uploadImagesToComposer(composer, files);
    });

    document.addEventListener("pointerover", (e) => {
      const arrow = e.target.closest && e.target.closest(".vote-btn, .downvote-btn");
      if (arrow && arrow.getAttribute("data-vote-left") === "1") {
        const fromArrow = e.relatedTarget;
        if (!fromArrow || !arrow.contains(fromArrow)) releaseVoteColor(arrow);
      }
      if (!hoverFine()) return;
      const payoutHit = e.target.closest && e.target.closest(".payout");
      if (payoutHit && inInteractiveSurface(payoutHit)) {
        const fromPayout = e.relatedTarget;
        if (fromPayout && payoutHit.contains(fromPayout)) return;
        onPayoutEnter(payoutHit);
        return;
      }
      const reblogHit = e.target.closest && e.target.closest(".reblog-hit");
      if (reblogHit && inInteractiveSurface(reblogHit)) {
        const fromReblog = e.relatedTarget;
        if (fromReblog && reblogHit.contains(fromReblog)) return;
        onReblogHitEnter(reblogHit);
        return;
      }
      const hit = voteHitFrom(e.target);
      if (!hit || !inInteractiveSurface(hit)) return;
      const from = e.relatedTarget;
      if (from && hit.contains(from)) return;
      onVoteHitEnter(hit);
    });
    document.addEventListener("pointerout", (e) => {
      const arrow = e.target.closest && e.target.closest(".vote-btn, .downvote-btn");
      if (arrow && arrow.classList.contains("is-rest") && arrow.getAttribute("data-vote-rest-armed") === "1") {
        const toArrow = e.relatedTarget;
        if (!toArrow || !arrow.contains(toArrow)) arrow.setAttribute("data-vote-left", "1");
      }
      const panel = votersPanelNode;
      const payoutHit = e.target.closest && e.target.closest(".payout");
      if (payoutHit) {
        const toPayout = e.relatedTarget;
        if (toPayout && payoutHit.contains(toPayout)) return;
        if (toPayout && payoutPanelNode && payoutPanelNode.contains(toPayout)) return;
        scheduleHidePayout(e);
        return;
      }
      const reblogHit = e.target.closest && e.target.closest(".reblog-hit");
      if (reblogHit) {
        const toReblog = e.relatedTarget;
        if (toReblog && reblogHit.contains(toReblog)) return;
        if (toReblog && panel && panel.contains(toReblog)) return;
        scheduleHideVoters(e);
        return;
      }
      const hit = voteHitFrom(e.target);
      if (!hit) return;
      const to = e.relatedTarget;
      if (to && hit.contains(to)) return;
      if (to && panel && panel.contains(to)) return;
      scheduleHideVoters(e);
    });

    window.addEventListener("scroll", repositionOpenSlider, true);
    window.addEventListener("resize", () => {
      repositionOpenSlider();
    });

    ChainQueue.subscribe((event) => {
      if (event && typeof event.size === "number") renderQueueStatus(event.size);
    });

    $("#loginCancel").addEventListener("click", closeLogin);
    $("#loginConnect").addEventListener("click", connectLogin);
    const loginUserInput = $("#loginUser");
    const loginKeyInput = $("#loginKey");
    if (loginUserInput) {
      loginUserInput.addEventListener("input", () => {
        if (loginMasterArmed) resetLoginMasterPrompt();
      });
    }
    if (loginKeyInput) {
      loginKeyInput.addEventListener("input", () => {
        if (loginMasterArmed) resetLoginMasterPrompt();
      });
    }
    bindAuthMethod($("#loginMethod"));
    bindAuthMethod($("#ownerSignMethod"));
    const ownerSignConnect = $("#ownerSignConnect");
    const ownerSignCancel = $("#ownerSignCancel");
    const ownerSignKey = $("#ownerSignKey");
    if (ownerSignConnect) ownerSignConnect.addEventListener("click", submitOwnerSign);
    if (ownerSignCancel) ownerSignCancel.addEventListener("click", cancelOwnerSign);
    if (ownerSignKey) {
      ownerSignKey.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          submitOwnerSign();
        }
      });
    }
    const communityRoleUser = $("#communityRoleUser");
    const communityRoleSelect = $("#communityRoleSelect");
    const communityRoleSave = $("#communityRoleSave");
    const communityRoleCancel = $("#communityRoleCancel");
    const communityTitleInput = $("#communityTitleInput");
    const communityTitleSave = $("#communityTitleSave");
    const communityTitleCancel = $("#communityTitleCancel");
    if (communityRoleUser) {
      communityRoleUser.addEventListener("input", paintCommunityRoleHint);
      communityRoleUser.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          submitCommunityRole();
        }
      });
    }
    if (communityRoleSelect) communityRoleSelect.addEventListener("change", paintCommunityRoleHint);
    if (communityRoleSave) communityRoleSave.addEventListener("click", submitCommunityRole);
    if (communityRoleCancel) communityRoleCancel.addEventListener("click", () => {
      if (!communityRoleBusy) dismissCommunityRoleDialog();
    });
    if (communityTitleInput) {
      communityTitleInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          submitCommunityTitle();
        }
      });
    }
    if (communityTitleSave) communityTitleSave.addEventListener("click", submitCommunityTitle);
    if (communityTitleCancel) communityTitleCancel.addEventListener("click", () => {
      if (!communityRoleBusy) dismissCommunityTitleDialog();
    });
    ["#communityRoleOverlay", "#communityTitleOverlay"].forEach((id) => {
      const ov = $(id);
      if (!ov) return;
      ov.addEventListener("click", (e) => {
        if (e.target !== ov || communityRoleBusy) return;
        const active = document.activeElement;
        if (active && ov.contains(active)) return;
        if (id === "#communityRoleOverlay") dismissCommunityRoleDialog();
        else dismissCommunityTitleDialog();
      });
    });
    $("#loginUser").addEventListener("keydown", (e) => {
      if (e.key === "Enter") connectLogin();
    });
    const loginKey = $("#loginKey");
    if (loginKey) {
      loginKey.addEventListener("keydown", (e) => {
        if (e.key === "Enter") connectLogin();
      });
    }
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        const active = document.activeElement;
        if (!active || !overlay.contains(active)) {
          closeLogin();
        }
      }
    });

    const peopleOverlay = $("#peopleOverlay");
    const peopleClose = $("#peopleClose");
    const peopleMore = $("#peopleMoreBtn");
    if (peopleClose) peopleClose.addEventListener("click", closePeoplePanel);
    const peopleSearchForm = $("#peopleSearchForm");
    const peopleSearch = $("#peopleSearch");
    if (peopleSearchForm) {
      peopleSearchForm.addEventListener("submit", (e) => {
        e.preventDefault();
        if (peopleSearchTimer) {
          clearTimeout(peopleSearchTimer);
          peopleSearchTimer = 0;
        }
        applyPeopleSearch(peopleSearch ? peopleSearch.value : "");
      });
    }
    if (peopleSearch) {
      peopleSearch.addEventListener("input", () => {
        schedulePeopleSearch(peopleSearch.value);
      });
    }
    if (peopleMore) {
      peopleMore.addEventListener("click", () => {
        if (peopleList.loading) return;
        peopleList.holdAuto = false;
        peopleList.error = "";
        fillAndChainPeople();
      });
    }
    if (peopleOverlay) {
      peopleOverlay.addEventListener("click", (e) => {
        if (e.target === peopleOverlay) closePeoplePanel();
      });
    }

    const walletOverlay = $("#walletOverlay");
    if (walletOverlay) {
      const walletCancel = $("#walletOpCancel");
      const walletSubmit = $("#walletOpSubmit");
      const walletMax = $("#walletOpMax");
      const walletAmount = $("#walletAmount");
      if (walletCancel) walletCancel.addEventListener("click", closeWalletOverlay);
      if (walletSubmit) walletSubmit.addEventListener("click", submitWalletOp);
      if (walletMax) walletMax.addEventListener("click", fillWalletMax);
      if (walletAmount) {
        walletAmount.addEventListener("keydown", (e) => {
          if (e.key === "Enter") submitWalletOp();
        });
      }
      walletOverlay.addEventListener("click", (e) => {
        if (e.target === walletOverlay) closeWalletOverlay();
      });
    }

    const delegateOverlay = $("#delegateOverlay");
    if (delegateOverlay) {
      const delegateCancel = $("#delegateCancel");
      const delegateSubmit = $("#delegateSubmit");
      const delegateMax = $("#delegateMax");
      const delegateUser = $("#delegateUser");
      const delegateAmount = $("#delegateAmount");
      const delegateAsset = $("#delegateAsset");
      if (delegateCancel) delegateCancel.addEventListener("click", closeDelegateOverlay);
      if (delegateSubmit) delegateSubmit.addEventListener("click", submitDelegate);
      if (delegateMax) delegateMax.addEventListener("click", fillDelegateMax);
      if (delegateUser) {
        delegateUser.addEventListener("input", updateDelegateHint);
        delegateUser.addEventListener("keydown", (e) => {
          if (e.key === "Enter") submitDelegate();
        });
      }
      const delegateRcUnit = $("#delegateRcUnit");
      if (delegateAmount) {
        delegateAmount.addEventListener("keydown", (e) => {
          if (e.key === "Enter") submitDelegate();
        });
      }
      if (delegateRcUnit) delegateRcUnit.addEventListener("change", syncDelegateRcInputMode);
      if (delegateAsset) {
        delegateAsset.addEventListener("click", (e) => {
          const tab = e.target.closest("[data-delegate-asset]");
          if (!tab || delegateState.pending || delegateState.mode !== "delegate") return;
          setDelegateAsset(tab.getAttribute("data-delegate-asset") || "hp");
        });
      }
      delegateOverlay.addEventListener("click", (e) => {
        if (e.target !== delegateOverlay) return;
        const active = document.activeElement;
        if (active && delegateOverlay.contains(active)) return;
        closeDelegateOverlay();
      });
    }

    const publishFab = $("#publishFab");
    if (publishFab) publishFab.setAttribute("href", appHref("/publish"));
    bindPublishFabCommentGate();
    const publishOverlay = $("#publishOverlay");
    if (publishOverlay) {
      bindComposerMedia(publishOverlay);
      bindLocationDialog();
      const publishBody = $("#publishBody");
      if (publishBody) {
        publishBody.addEventListener("keyup", rememberPublishBodySel);
        publishBody.addEventListener("mouseup", rememberPublishBodySel);
        publishBody.addEventListener("select", rememberPublishBodySel);
        publishBody.addEventListener("pointerup", rememberPublishBodySel);
      }
      const publishMd = $("#publishMd");
      if (publishMd) {
        publishMd.addEventListener("pointerdown", (e) => {
          if (e.target.closest("#publishMdBtn")) rememberPublishBodySel();
        });
      }
      const publishPostFile = $("#publishPostFile");
      if (publishPostFile) {
        publishPostFile.addEventListener("change", () => {
          const file = publishPostFile.files && publishPostFile.files[0];
          publishPostFile.value = "";
          if (file) loadPublishPostFile(file);
        });
      }
      publishOverlay.addEventListener("click", (e) => {
        if (e.target === publishOverlay) {
          const active = document.activeElement;
          if (!active || !publishOverlay.contains(active)) {
            closePublish();
          }
          return;
        }
        if (e.target.closest("#publishCancel")) {
          e.preventDefault();
          cancelPublish();
          return;
        }
        if (e.target.closest("#publishLocationBtn")) {
          e.preventDefault();
          openLocationDialog();
          return;
        }
        if (e.target.closest("#publishMdBtn")) {
          e.preventDefault();
          toggleMdMenu();
          return;
        }
        const mdItem = e.target.closest(".publish-md-item");
        if (mdItem) {
          e.preventDefault();
          const kind = mdItem.getAttribute("data-md") || "";
          if (kind === "load") {
            closeMdMenu();
            const input = $("#publishPostFile");
            if (input) {
              input.value = "";
              input.click();
            }
            return;
          }
          if (kind === "save") {
            closeMdMenu();
            savePublishPostFile();
            return;
          }
          applyPublishMarkdown(kind);
          return;
        }
        if (e.target.closest("#publishSubmit")) {
          e.preventDefault();
          submitPublish();
          return;
        }
        if (e.target.closest("#publishDestBtn")) {
          e.preventDefault();
          e.stopPropagation();
          toggleDestMenu();
          return;
        }
        const destOpt = e.target.closest(".publish-dest-option");
        if (destOpt) {
          e.preventDefault();
          selectPublishDest(
            destOpt.getAttribute("data-dest-type"),
            destOpt.getAttribute("data-dest-name") || "",
            destOpt.getAttribute("data-dest-title") || ""
          );
          return;
        }
        if (e.target.closest("#publishBeneficiaryAdd")) {
          e.preventDefault();
          addPublishBeneficiaryRow();
          return;
        }
        const removeBen = e.target.closest(".publish-beneficiary-remove");
        if (removeBen) {
          e.preventDefault();
          removePublishBeneficiaryRow(removeBen);
          return;
        }
        const chip = e.target.closest(".publish-tag-chip");
        if (chip) {
          e.preventDefault();
          const tag = chip.getAttribute("data-tag");
          publishTags = publishTags.filter((t) => t !== tag);
          paintPublishTags();
          schedulePublishDraftSave();
        }
      });
      publishOverlay.addEventListener("keydown", (e) => {
        if (locationDialogOpen()) {
          if (e.key === "Escape") {
            e.preventDefault();
            closeLocationDialog();
          }
          return;
        }
        if (e.key === "Escape" && mdMenuOpen()) {
          e.preventDefault();
          closeMdMenu();
          const mdBtn = $("#publishMdBtn");
          if (mdBtn) mdBtn.focus();
          return;
        }
        if (e.target.id === "publishTitle" && e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.isComposing) {
          e.preventDefault();
          return;
        }
        if (e.target.id === "publishTagInput") {
          if (e.key === " " || e.key === "Enter" || e.key === "," || e.key === "Tab") {
            if (e.key !== "Tab" || e.target.value.trim()) e.preventDefault();
            takeTagsFromInput();
            return;
          }
          if (e.key === "Backspace" && !e.target.value && publishTags.length) {
            publishTags.pop();
            paintPublishTags();
            schedulePublishDraftSave();
          }
          return;
        }
        if (e.key === "Escape") {
          if (publishDiscardOpen()) {
            hidePublishDiscard();
            return;
          }
          if (destMenuOpen()) {
            closeDestMenu();
            return;
          }
          closePublish();
          return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
          e.preventDefault();
          submitPublish();
        }
      });
      publishOverlay.addEventListener("focusout", (e) => {
        if (e.target && e.target.id === "publishTagInput") takeTagsFromInput();
      });
    }
    const contentDelete = $("#contentDelete");
    if (contentDelete) {
      contentDelete.addEventListener("click", (e) => {
        if (contentDeleteBusy) return;
        if (e.target === contentDelete || e.target.closest("#contentDeleteCancel")) {
          hideContentDelete();
          return;
        }
        if (e.target.closest("#contentDeleteConfirm")) {
          e.preventDefault();
          confirmContentDelete();
        }
      });
    }
    const publishDiscard = $("#publishDiscard");
    if (publishDiscard) {
      publishDiscard.addEventListener("click", (e) => {
        if (e.target === publishDiscard || e.target.closest("#publishDiscardKeep")) {
          hidePublishDiscard();
          return;
        }
        if (e.target.closest("#publishDiscardConfirm")) {
          e.preventDefault();
          discardPublishAndClose();
        }
      });
    }
    window.addEventListener("pagehide", () => {
      persistPublishDraftNow();
      persistCommentDraftNow();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "hidden") return;
      persistPublishDraftNow();
      persistCommentDraftNow();
    });
    document.addEventListener("click", (e) => {
      if (mdMenuOpen() && !e.target.closest("#publishMd")) closeMdMenu();
      if (!destMenuOpen()) return;
      if (e.target.closest("#publishDest")) return;
      closeDestMenu();
    });

    function start() {
      restoreRememberedSession();
      renderSession();
      hydratePublishDraftFromStorage();
      renderQueueStatus(ChainQueue.size());
      try {
        route();
      } finally {
        initialPageLoad = false;
      }
    }

    if (window.HiveAuth && typeof HiveAuth.ready === "function") {
      HiveAuth.ready().then(start, start);
    } else {
      start();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
