/**
 * Posting-key login. A master password is derived into one role key and
 * then dropped. Login stores only the posting private key, wrapped with a
 * non-extractable AES-GCM CryptoKey in IndexedDB.
 */
(function (global) {
  "use strict";

  const DB_NAME = "cs77-auth";
  const DB_VERSION = 1;
  const STORE = "keys";
  const RECORD_ID = "posting";
  // Set before the IndexedDB delete so a reload mid-logout still drops the key.
  const AUTH_LOGOUT_KEY = "cs77_auth_logout";
  const HIVE_TX_URL = "https://cdn.jsdelivr.net/npm/hive-tx@7.2/dist/index.mjs";

  let sessionBytes = null;
  let sessionUser = "";
  let hiveTxMod = null;
  let hiveTxPromise = null;
  let readyPromise = null;
  let clearPromise = null;

  function wipe(bytes) {
    if (bytes && bytes.fill) bytes.fill(0);
  }

  function unlockMemory(username, bytes) {
    wipe(sessionBytes);
    sessionBytes = bytes;
    sessionUser = String(username || "")
      .trim()
      .replace(/^@/, "")
      .toLowerCase();
  }

  function lockMemory() {
    wipe(sessionBytes);
    sessionBytes = null;
    sessionUser = "";
  }

  function hasSubtle() {
    return Boolean(global.crypto && crypto.subtle);
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      if (!global.indexedDB) {
        reject(new Error("IndexedDB is unavailable in this browser."));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () =>
        reject(req.error || new Error("IndexedDB could not be opened."));
    });
  }

  function idbRequest(mode, fn) {
    return openDb().then((db) => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        let req;
        try {
          req = fn(tx.objectStore(STORE));
        } catch (err) {
          db.close();
          reject(err);
          return;
        }
        tx.oncomplete = () => {
          db.close();
          resolve(req ? req.result : undefined);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error || new Error("IndexedDB transaction failed."));
        };
        tx.onabort = () => {
          db.close();
          reject(tx.error || new Error("IndexedDB transaction aborted."));
        };
      });
    });
  }

  function idbGet() {
    return idbRequest("readonly", (store) => store.get(RECORD_ID)).then(
      (record) => record || null
    );
  }

  function idbPut(record) {
    return idbRequest("readwrite", (store) => store.put(record));
  }

  function idbDelete() {
    return idbRequest("readwrite", (store) => store.delete(RECORD_ID));
  }

  function markAuthLogout() {
    try {
      localStorage.setItem(AUTH_LOGOUT_KEY, "1");
    } catch {
      /* ignore quota / private mode */
    }
  }

  function authLogoutMarked() {
    try {
      return localStorage.getItem(AUTH_LOGOUT_KEY) === "1";
    } catch {
      return false;
    }
  }

  function unmarkAuthLogout() {
    try {
      localStorage.removeItem(AUTH_LOGOUT_KEY);
    } catch {
      /* ignore */
    }
  }

  async function wrapBytes(bytes) {
    if (!hasSubtle()) {
      throw new Error(
        "This page needs HTTPS or localhost to store a posting key."
      );
    }
    const wrappingKey = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      wrappingKey,
      bytes
    );
    return { wrappingKey, iv: iv.buffer, ciphertext };
  }

  async function unwrapBytes(record) {
    const ivSrc = record.iv;
    const iv = ivSrc instanceof Uint8Array ? ivSrc : new Uint8Array(ivSrc);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      record.wrappingKey,
      record.ciphertext
    );
    return new Uint8Array(plain);
  }

  function hiveNodes() {
    if (global.HiveApi && typeof HiveApi.getNodes === "function") {
      return HiveApi.getNodes();
    }
    return ["https://api.hive.blog"];
  }

  function loadHiveTx() {
    if (hiveTxMod) return Promise.resolve(hiveTxMod);
    if (!hiveTxPromise) {
      hiveTxPromise = import(HIVE_TX_URL)
        .then((mod) => {
          hiveTxMod = mod;
          if (mod.config && Array.isArray(mod.config.nodes)) {
            const nodes = hiveNodes();
            mod.config.nodes = [...new Set(nodes.concat(mod.config.nodes))];
          }
          return mod;
        })
        .catch((err) => {
          hiveTxPromise = null;
          throw new Error(
            (err && err.message) || "Could not load the Hive signer."
          );
        });
    }
    return hiveTxPromise;
  }

  function authorityPubs(account, role) {
    const auth = account && account[role];
    const auths = (auth && auth.key_auths) || [];
    const out = [];
    for (let i = 0; i < auths.length; i++) {
      const row = auths[i];
      const pub = Array.isArray(row) ? row[0] : row && row[0];
      if (pub) out.push(String(pub));
    }
    return out;
  }

  function postingPubs(account) {
    return authorityPubs(account, "posting");
  }

  function normalizeRole(role) {
    const key = String(role || "")
      .trim()
      .toLowerCase();
    if (key === "owner" || key === "active" || key === "posting" || key === "memo") return key;
    throw new Error("Unknown key role.");
  }

  function rolePubs(account, role) {
    if (role === "memo") {
      const memo = account && account.memo_key;
      return memo ? [String(memo)] : [];
    }
    return authorityPubs(account, role);
  }

  // A Hive WIF is base58, starts with 5, and is 51 characters. Master
  // passwords generated for Hive accounts start with P.
  function looksLikeWif(compact) {
    return /^5[1-9A-HJ-NP-Za-km-z]{49,52}$/.test(compact);
  }

  function roleEnterPhrase(role) {
    return "the " + role + " key";
  }

  function accountName(username) {
    return String(username || "")
      .trim()
      .replace(/^@/, "")
      .toLowerCase();
  }

  function requireSession(username) {
    if (!sessionBytes || sessionBytes.length !== 32 || !sessionUser) {
      throw new Error("No posting key is stored in this browser.");
    }
    if (username && sessionUser !== String(username).toLowerCase().replace(/^@/, "")) {
      throw new Error("Stored posting key belongs to a different account.");
    }
    return sessionBytes;
  }

  function hasKey(username) {
    if (!sessionBytes || sessionBytes.length !== 32 || !sessionUser) return false;
    if (!username) return true;
    return sessionUser === String(username).toLowerCase().replace(/^@/, "");
  }

  async function persist(username, bytes) {
    const wrapped = await wrapBytes(bytes);
    await idbPut({
      id: RECORD_ID,
      username,
      wrappingKey: wrapped.wrappingKey,
      iv: wrapped.iv,
      ciphertext: wrapped.ciphertext,
    });
  }

  async function checkedPostingKey(username, wif) {
    const name = accountName(username);
    const secret = String(wif || "").replace(/\s+/g, "");
    if (!/^[a-z0-9.\-]{3,16}$/.test(name)) {
      throw new Error("Enter a valid Hive username.");
    }
    if (!secret) throw new Error("Enter a posting key.");

    const lib = await loadHiveTx();
    let pk;
    try {
      pk = lib.PrivateKey.from(secret);
    } catch {
      throw new Error("That posting key is not valid.");
    }
    const pub = pk.createPublic().toString();
    const bytes = pk.key.slice();
    wipe(pk.key);

    let accounts;
    try {
      accounts = await HiveApi.getAccounts([name]);
    } catch (err) {
      wipe(bytes);
      throw err;
    }
    const account = accounts && accounts[0];
    if (!account) {
      wipe(bytes);
      throw new Error("Unknown Hive account @" + name + ".");
    }
    if (postingPubs(account).indexOf(pub) < 0) {
      wipe(bytes);
      throw new Error("This posting key does not match @" + name + ".");
    }
    return { name, bytes };
  }

  async function storePostingBytes(name, bytes) {
    try {
      if (clearPromise) await clearPromise.catch(() => {});
      unmarkAuthLogout();
      await persist(name, bytes);
    } catch (err) {
      wipe(bytes);
      throw new Error(
        (err && err.message) || "Could not store the posting key in this browser."
      );
    }
    unlockMemory(name, bytes);
    return name;
  }

  async function login(username, wif) {
    const checked = await checkedPostingKey(username, wif);
    return storePostingBytes(checked.name, checked.bytes);
  }

  // "wif", "master", "invalid", or "empty". A master password is not parsed.
  async function secretKind(secret) {
    const compact = String(secret == null ? "" : secret).replace(/\s+/g, "");
    if (!compact) return "empty";
    if (!looksLikeWif(compact)) return "master";
    const lib = await loadHiveTx();
    try {
      const pk = lib.PrivateKey.from(compact);
      wipe(pk.key);
      return "wif";
    } catch {
      return "invalid";
    }
  }

  // Hive master-password derivation for one role: sha256(username + role + password)
  // with the same whitespace collapsing as Hive account creation. The password
  // is not retained. The caller owns bytes and must wipe them.
  async function deriveRoleKey(username, password, role) {
    const name = accountName(username);
    const roleName = normalizeRole(role);
    let pass = String(password == null ? "" : password);
    password = "";
    if (!/^[a-z0-9.\-]{3,16}$/.test(name)) {
      pass = "";
      throw new Error("Enter a valid Hive username.");
    }
    if (!pass) throw new Error("Enter a key.");
    const libPromise = loadHiveTx();
    let seed = (name + roleName + pass).trim().split(/[\t\n\v\f\r ]+/).join(" ");
    pass = "";
    const subtle = hasSubtle();
    let raw = null;
    if (subtle) {
      raw = new TextEncoder().encode(seed);
      seed = "";
    }
    let lib;
    try {
      lib = await libPromise;
    } catch (err) {
      if (raw) raw.fill(0);
      seed = "";
      throw err;
    }
    let pk;
    if (subtle) {
      let digest;
      try {
        digest = new Uint8Array(await crypto.subtle.digest("SHA-256", raw));
      } finally {
        raw.fill(0);
      }
      try {
        pk = lib.PrivateKey.from(digest);
      } catch {
        digest.fill(0);
        throw new Error("Could not derive the " + roleName + " key.");
      }
    } else if (/^[0-9a-fA-F]+$/.test(seed)) {
      seed = "";
      throw new Error("This page needs HTTPS or localhost to derive that key.");
    } else {
      try {
        pk = lib.PrivateKey.fromSeed(seed);
      } catch {
        seed = "";
        throw new Error("Could not derive the " + roleName + " key.");
      }
      seed = "";
    }
    const pub = pk.createPublic().toString();
    const bytes = pk.key.slice();
    wipe(pk.key);
    return { role: roleName, pub: pub, bytes: bytes };
  }

  async function loginMaster(username, password) {
    const name = accountName(username);
    const derivedJob = deriveRoleKey(name, password, "posting");
    password = "";
    const derived = await derivedJob;
    try {
      const accounts = await HiveApi.getAccounts([name]);
      const account = accounts && accounts[0];
      if (!account || accountName(account.name) !== name) {
        throw new Error("Unknown Hive account @" + name + ".");
      }
      if (rolePubs(account, "posting").indexOf(derived.pub) < 0) {
        throw new Error("This key does not match @" + name + ".");
      }
    } catch (err) {
      wipe(derived.bytes);
      throw err;
    }
    return storePostingBytes(name, derived.bytes);
  }

  async function ready() {
    if (readyPromise) return readyPromise;
    readyPromise = (async () => {
      if (authLogoutMarked()) {
        lockMemory();
        try {
          await idbDelete();
          unmarkAuthLogout();
        } catch {
          /* marker stays so the next load tries the delete again */
        }
        return;
      }
      let record;
      try {
        record = await idbGet();
      } catch {
        return;
      }
      if (!record || !record.wrappingKey || !record.ciphertext || !record.username) {
        return;
      }
      try {
        const bytes = await unwrapBytes(record);
        if (!bytes || bytes.length !== 32) {
          wipe(bytes);
          await idbDelete().catch(() => {});
          return;
        }
        unlockMemory(record.username, bytes);
      } catch {
        lockMemory();
        await idbDelete().catch(() => {});
      }
    })();
    return readyPromise;
  }

  function clear() {
    lockMemory();
    markAuthLogout();
    const job = idbDelete()
      .then(() => {
        if (!sessionUser) unmarkAuthLogout();
      })
      .catch(() => {});
    clearPromise = job;
    return job;
  }

  async function signBytes(bytes, username) {
    const lib = await loadHiveTx();
    const keyBytes = requireSession(username);
    const pk = lib.PrivateKey.from(keyBytes);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const sig = pk.sign(digest);
    if (sig && typeof sig.customToString === "function") return sig.customToString();
    if (sig && typeof sig.toString === "function") return sig.toString();
    throw new Error("Could not encode the Hive signature.");
  }

  async function broadcastKeyBytes(keyBytes, operations) {
    if (!Array.isArray(operations) || !operations.length) {
      throw new Error("Invalid blockchain operation.");
    }
    const lib = await loadHiveTx();
    if (lib.config && Array.isArray(lib.config.nodes)) {
      lib.config.nodes = hiveNodes();
    }
    const pk = lib.PrivateKey.from(keyBytes);
    try {
      const tx = new lib.Transaction();
      for (let i = 0; i < operations.length; i++) {
        const op = operations[i];
        if (!Array.isArray(op) || op.length < 2) {
          throw new Error("Invalid blockchain operation.");
        }
        await tx.addOperation(op[0], op[1]);
      }
      tx.sign(pk);
      const result = await tx.broadcast();
      return { success: true, result: result || null };
    } finally {
      if (pk && pk.key && pk.key !== keyBytes) wipe(pk.key);
    }
  }

  async function broadcast(username, operations) {
    const keyBytes = requireSession(username);
    return broadcastKeyBytes(keyBytes, operations);
  }

  // One role key, from a WIF or a master password. Checked, used, discarded.
  async function materializeRoleKey(username, secret, role) {
    const name = accountName(username);
    const roleName = normalizeRole(role);
    if (!/^[a-z0-9.\-]{3,16}$/.test(name)) {
      throw new Error("Enter a valid Hive username.");
    }
    let raw = String(secret == null ? "" : secret);
    secret = "";
    let compact = raw.replace(/\s+/g, "");
    if (!compact) {
      raw = "";
      throw new Error("Enter " + roleEnterPhrase(roleName) + ".");
    }
    let bytes = null;
    let pub = "";
    if (looksLikeWif(compact)) {
      raw = "";
      const lib = await loadHiveTx();
      let pk;
      try {
        pk = lib.PrivateKey.from(compact);
      } catch {
        compact = "";
        throw new Error("That key is not valid.");
      }
      compact = "";
      pub = pk.createPublic().toString();
      bytes = pk.key.slice();
      wipe(pk.key);
    } else {
      let password = raw.trim();
      raw = "";
      compact = "";
      const derivedJob = deriveRoleKey(name, password, roleName);
      password = "";
      const derived = await derivedJob;
      bytes = derived.bytes;
      pub = derived.pub;
    }
    try {
      const accounts = await HiveApi.getAccounts([name]);
      const account = accounts && accounts[0];
      if (!account || accountName(account.name) !== name) {
        throw new Error("Unknown Hive account @" + name + ".");
      }
      if (rolePubs(account, roleName).indexOf(pub) < 0) {
        throw new Error(
          "This " + roleName + " key does not match @" + name + "."
        );
      }
      return { name: name, role: roleName, bytes: bytes };
    } catch (err) {
      wipe(bytes);
      throw err;
    }
  }

  async function broadcastRoleSecret(username, secret, role, operations) {
    const openedJob = materializeRoleKey(username, secret, role);
    secret = "";
    const opened = await openedJob;
    try {
      return await broadcastKeyBytes(opened.bytes, operations);
    } finally {
      wipe(opened.bytes);
    }
  }

  async function broadcastWithKey(username, wif, operations) {
    return broadcastRoleSecret(username, wif, "posting", operations);
  }

  async function openWif(wif) {
    const secret = String(wif || "").replace(/\s+/g, "");
    if (!secret) throw new Error("Enter a key.");
    const lib = await loadHiveTx();
    let pk;
    try {
      pk = lib.PrivateKey.from(secret);
    } catch {
      throw new Error("That key is not valid.");
    }
    const pub = pk.createPublic().toString();
    const bytes = pk.key.slice();
    wipe(pk.key);
    return { pub, bytes };
  }

  async function broadcastActiveKey(username, wif, operations) {
    return broadcastRoleSecret(username, wif, "active", operations);
  }

  // Sign with a key this page derived. The caller discards the WIF.
  async function broadcastWif(wif, operations) {
    const opened = await openWif(wif);
    try {
      return await broadcastKeyBytes(opened.bytes, operations);
    } finally {
      wipe(opened.bytes);
    }
  }

  // One private key in WIF form. The password and the raw key bytes are dropped.
  async function wifFromLogin(username, password, role) {
    const derivedJob = deriveRoleKey(username, password, role);
    password = "";
    const derived = await derivedJob;
    const lib = await loadHiveTx();
    try {
      const pk = lib.PrivateKey.from(derived.bytes);
      return pk.toString();
    } finally {
      wipe(derived.bytes);
    }
  }

  // Public keys for a new account, plus the posting private key used to
  // finish setup. Owner, active, and memo private keys are wiped here.
  async function keysFromLogin(username, password) {
    const name = accountName(username);
    let pass = String(password == null ? "" : password);
    password = "";
    if (!/^[a-z0-9.\-]{3,16}$/.test(name)) {
      pass = "";
      throw new Error("Enter a valid Hive username.");
    }
    if (!pass) throw new Error("Missing master key.");
    const lib = await loadHiveTx();
    const roles = ["owner", "active", "posting", "memo"];
    const out = {};
    try {
      for (let i = 0; i < roles.length; i++) {
        const role = roles[i];
        const derivedJob = deriveRoleKey(name, pass, role);
        const derived = await derivedJob;
        try {
          out[role + "Pub"] = derived.pub;
          if (role === "posting") {
            const pk = lib.PrivateKey.from(derived.bytes);
            out.posting = pk.toString();
          }
        } finally {
          wipe(derived.bytes);
        }
      }
    } catch (err) {
      pass = "";
      out.owner = "";
      out.active = "";
      out.posting = "";
      out.memo = "";
      throw err;
    }
    pass = "";
    return out;
  }

  global.HiveAuth = {
    ready,
    login,
    clear,
    hasKey,
    user: function () {
      return sessionUser;
    },
    signBytes,
    broadcast,
    secretKind,
    deriveRoleKey,
    wifFromLogin,
    loginMaster,
    broadcastRoleSecret,
    broadcastWithKey,
    broadcastActiveKey,
    broadcastWif,
    keysFromLogin,
  };
})(window);
