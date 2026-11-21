/**
 * Posting-key login and the Nostr Wallet Connect secret.
 * A master password is derived into one role key and then dropped.
 * Login stores only the posting private key. One non-extractable
 * AES-GCM CryptoKey in IndexedDB wraps every stored key and wallet
 * connection. Each record keeps its own IV and ciphertext.
 * Logout removes the posting key and leaves the wallet connection.
 */
(function (global) {
  "use strict";

  const DB_NAME = "cs77-auth";
  const DB_VERSION = 2;
  const STORE = "keys";
  // One wrapping key, id "wrap", encrypts every secret in this store.
  // Records are one role per account: "posting:alice", and later "active:alice"
  // and "memo:alice". The wallet connection is "nwc:alice". Each of those
  // stores a fresh IV and ciphertext, not its own key. Active and memo use
  // this same wrap and stay stored until a later change saves them. Only the
  // posting key of the active account is unwrapped into memory.
  const WRAP_ID = "wrap";
  const STORED_KEY_ROLES = ["posting", "active", "memo"];
  // Username whose posting key a reload must still delete.
  const AUTH_LOGOUT_KEY = "cs77_auth_logout";
  // Local signer. Absolute so a classic script on /@name still loads it.
  const HIVE_TX_URL = "/js/tx.js?v=0.22.8";

  let sessionBytes = null;
  let sessionUser = "";
  // Account the page is acting as. A Keychain login sets this and leaves the
  // posting key locked, so another account's stored key stays in the database.
  let activeUser = "";
  let hiveTxMod = null;
  let hiveTxPromise = null;
  let readyPromise = null;
  let clearPromise = null;
  let nwcPresent = false;
  let wrappingKeyPromise = null;

  function wipe(bytes) {
    if (bytes && bytes.fill) bytes.fill(0);
  }

  function unlockMemory(username, bytes) {
    wipe(sessionBytes);
    sessionBytes = bytes;
    sessionUser = accountName(username);
    activeUser = sessionUser;
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

  function idbGet(id) {
    return idbRequest("readonly", (store) => store.get(id)).then(
      (record) => record || null
    );
  }

  function idbPut(record) {
    return idbRequest("readwrite", (store) => store.put(record));
  }

  function idbDelete(id) {
    return idbRequest("readwrite", (store) => store.delete(id));
  }

  function idbAll() {
    return idbRequest("readonly", (store) => store.getAll()).then((rows) => rows || []);
  }

  function validStoredName(name) {
    return global.HiveApi.validAccountName(name);
  }

  function recordId(role, username) {
    return role + ":" + accountName(username);
  }

  function markAuthLogout(username) {
    const name = accountName(username);
    if (!validStoredName(name)) return;
    try {
      localStorage.setItem(AUTH_LOGOUT_KEY, name);
    } catch {
      /* ignore quota / private mode */
    }
  }

  function readLogoutMark() {
    try {
      const name = accountName(localStorage.getItem(AUTH_LOGOUT_KEY) || "");
      return validStoredName(name) ? name : "";
    } catch {
      return "";
    }
  }

  function unmarkAuthLogout() {
    try {
      localStorage.removeItem(AUTH_LOGOUT_KEY);
    } catch {
      /* ignore */
    }
  }

  function isWrappingKey(value) {
    return Boolean(
      value &&
        value.type === "secret" &&
        value.algorithm &&
        value.algorithm.name === "AES-GCM"
    );
  }

  // Two tabs can both see an empty store. The write transaction takes the
  // store lock, and the tab that arrives second keeps the key already stored.
  function storeWrappingKey(created) {
    return openDb().then((db) => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        const req = store.get(WRAP_ID);
        let chosen = created;
        req.onsuccess = () => {
          const record = req.result;
          if (record && isWrappingKey(record.wrappingKey)) {
            chosen = record.wrappingKey;
            return;
          }
          chosen = created;
          store.put({ id: WRAP_ID, wrappingKey: created });
        };
        tx.oncomplete = () => {
          db.close();
          resolve(chosen);
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

  function loadOrCreateWrappingKey() {
    return idbGet(WRAP_ID).then((record) => {
      if (record && isWrappingKey(record.wrappingKey)) return record.wrappingKey;
      if (!hasSubtle()) {
        throw new Error(
          "This page needs HTTPS or localhost to store a posting key."
        );
      }
      return crypto.subtle
        .generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"])
        .then((created) => storeWrappingKey(created));
    });
  }

  function getWrappingKey() {
    if (!wrappingKeyPromise) {
      wrappingKeyPromise = loadOrCreateWrappingKey().catch((err) => {
        wrappingKeyPromise = null;
        throw err;
      });
    }
    return wrappingKeyPromise;
  }

  async function wrapBytes(bytes) {
    if (!hasSubtle()) {
      throw new Error(
        "This page needs HTTPS or localhost to store a posting key."
      );
    }
    const wrappingKey = await getWrappingKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      wrappingKey,
      bytes
    );
    return { iv: iv.buffer, ciphertext };
  }

  async function unwrapBytes(record) {
    const wrappingKey = await getWrappingKey();
    const ivSrc = record.iv;
    const iv = ivSrc instanceof Uint8Array ? ivSrc : new Uint8Array(ivSrc);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      wrappingKey,
      record.ciphertext
    );
    return new Uint8Array(plain);
  }

  function loadHiveTx() {
    if (hiveTxMod) return Promise.resolve(hiveTxMod);
    if (!hiveTxPromise) {
      hiveTxPromise = import(HIVE_TX_URL)
        .then((mod) => {
          hiveTxMod = mod;
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
    return global.HiveApi.accountName(username);
  }

  function requireSession(username) {
    if (!sessionBytes || sessionBytes.length !== 32 || !sessionUser) {
      throw new Error("No posting key is stored in this browser.");
    }
    if (username && sessionUser !== accountName(username)) {
      throw new Error("Stored posting key belongs to a different account.");
    }
    return sessionBytes;
  }

  function hasKey(username) {
    if (!sessionBytes || sessionBytes.length !== 32 || !sessionUser) return false;
    if (!username) return true;
    return sessionUser === accountName(username);
  }

  async function persistRole(role, username, bytes) {
    const roleName = normalizeRole(role);
    if (STORED_KEY_ROLES.indexOf(roleName) < 0) {
      throw new Error("Unknown key role.");
    }
    const name = accountName(username);
    if (!validStoredName(name)) throw new Error("Enter a valid Hive username.");
    const wrapped = await wrapBytes(bytes);
    await idbPut({
      id: recordId(roleName, name),
      role: roleName,
      username: name,
      iv: wrapped.iv,
      ciphertext: wrapped.ciphertext,
    });
  }

  async function persist(username, bytes) {
    await persistRole("posting", username, bytes);
  }

  function storedRoleOf(row) {
    if (row && STORED_KEY_ROLES.indexOf(row.role) >= 0) return row.role;
    const id = String((row && row.id) || "");
    const colon = id.indexOf(":");
    if (colon < 1) return "";
    const role = id.slice(0, colon);
    return STORED_KEY_ROLES.indexOf(role) >= 0 ? role : "";
  }

  // Roles saved in this browser. No key bytes.
  async function listStoredKeys() {
    const rows = await idbAll();
    const order = { posting: 0, active: 1, memo: 2 };
    const out = [];
    const seen = {};
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const role = storedRoleOf(row);
      if (!role || !recordWrapped(row)) continue;
      const name = accountName(row.username || String(row.id || "").slice(role.length + 1));
      if (!validStoredName(name)) continue;
      const key = role + ":" + name;
      if (seen[key]) continue;
      seen[key] = true;
      out.push({ username: name, role: role });
    }
    out.sort((a, b) => {
      if (a.username !== b.username) return a.username < b.username ? -1 : 1;
      return order[a.role] - order[b.role];
    });
    return out;
  }

  // One stored private key, as a WIF, for a QR code. Empty when it is missing.
  async function storedKeyWif(username, role) {
    let roleName = "";
    try {
      roleName = normalizeRole(role);
    } catch {
      return "";
    }
    if (STORED_KEY_ROLES.indexOf(roleName) < 0) return "";
    const name = accountName(username);
    if (!validStoredName(name)) return "";
    let record = null;
    try {
      record = await idbGet(recordId(roleName, name));
    } catch {
      return "";
    }
    if (!recordWrapped(record)) return "";
    let bytes = null;
    try {
      bytes = await unwrapBytes(record);
      if (!bytes || bytes.length !== 32) return "";
      const lib = await loadHiveTx();
      const pk = lib.PrivateKey.from(bytes);
      try {
        return pk.toString();
      } finally {
        if (pk.key && pk.key !== bytes) wipe(pk.key);
      }
    } catch {
      return "";
    } finally {
      wipe(bytes);
    }
  }

  // Removes one posting, active, or memo record. The wallet connection stays.
  // Deleting the posting key that is unlocked in this tab wipes those bytes.
  // The account stays the signed-in user until the page logs it out.
  async function deleteStoredKey(username, role) {
    let roleName = "";
    try {
      roleName = normalizeRole(role);
    } catch {
      throw new Error("Unknown key role.");
    }
    if (STORED_KEY_ROLES.indexOf(roleName) < 0) throw new Error("Unknown key role.");
    const name = accountName(username);
    if (!validStoredName(name)) throw new Error("Enter a valid Hive username.");
    await idbDelete(recordId(roleName, name));
    if (roleName === "posting" && sessionUser === name) lockMemory();
  }

  async function checkedPostingKey(username, wif) {
    const name = accountName(username);
    const secret = String(wif || "").replace(/\s+/g, "");
    if (!validStoredName(name)) {
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
      if (readLogoutMark() === name) unmarkAuthLogout();
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
    if (!validStoredName(name)) {
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

  function recordWrapped(record) {
    return Boolean(record && record.iv && record.ciphertext);
  }

  // Presence only. The connection string stays encrypted until a payment reads it.
  async function noteNwc() {
    if (!activeUser) {
      nwcPresent = false;
      return false;
    }
    try {
      const record = await idbGet(recordId("nwc", activeUser));
      nwcPresent = recordWrapped(record);
    } catch {
      nwcPresent = false;
    }
    return nwcPresent;
  }

  async function ready() {
    if (readyPromise) return readyPromise;
    readyPromise = (async () => {
      const mark = readLogoutMark();
      if (!mark) return;
      try {
        if (sessionUser === mark) lockMemory();
        if (activeUser === mark) activeUser = "";
        await idbDelete(recordId("posting", mark));
        unmarkAuthLogout();
      } catch {
        /* marker stays so the next load tries the delete again */
      }
    })();
    return readyPromise;
  }

  // Unlock this account's posting key, or leave the key locked when the
  // account signs with Keychain. Other accounts' keys stay stored.
  async function activate(username, opts) {
    const name = accountName(username);
    const keychain = Boolean(opts && opts.keychain);
    if (!validStoredName(name)) {
      lockMemory();
      activeUser = "";
      nwcPresent = false;
      return "";
    }
    activeUser = name;
    if (!keychain && sessionUser === name && sessionBytes && sessionBytes.length === 32) {
      await noteNwc();
      return name;
    }
    lockMemory();
    activeUser = name;
    if (!keychain) {
      let record = null;
      try {
        record = await idbGet(recordId("posting", name));
      } catch {
        record = null;
      }
      if (recordWrapped(record)) {
        try {
          const bytes = await unwrapBytes(record);
          if (bytes && bytes.length === 32) unlockMemory(name, bytes);
          else wipe(bytes);
        } catch {
          lockMemory();
          activeUser = name;
        }
      }
    }
    await noteNwc();
    return sessionUser === name ? name : "";
  }

  function clear(username) {
    const name = accountName(username || activeUser || sessionUser);
    if (!validStoredName(name)) {
      lockMemory();
      activeUser = "";
      nwcPresent = false;
      return Promise.resolve();
    }
    if (sessionUser === name) lockMemory();
    if (activeUser === name) activeUser = "";
    markAuthLogout(name);
    const job = idbDelete(recordId("posting", name))
      .then(() => {
        if (readLogoutMark() === name) unmarkAuthLogout();
      })
      .catch(() => {});
    clearPromise = job;
    return job;
  }

  // The connection string can spend from the linked wallet. Same wrap as
  // the posting key: the one non-extractable AES-GCM key in this database.
  // Same-origin script can still decrypt it. There is no separate password.
  async function saveNwc(url) {
    const text = String(url || "");
    if (!text) {
      await clearNwc();
      return;
    }
    const bytes = new TextEncoder().encode(text);
    let wrapped;
    try {
      wrapped = await wrapBytes(bytes);
    } catch (err) {
      const msg = err && err.message ? String(err.message) : "";
      if (msg.indexOf("HTTPS") !== -1) {
        throw new Error("This page needs HTTPS or localhost to store the wallet connection.");
      }
      throw new Error("Could not store the wallet connection in this browser.");
    } finally {
      wipe(bytes);
    }
    const name = activeUser;
    if (!validStoredName(name)) {
      throw new Error("Log in before saving the wallet connection.");
    }
    try {
      await idbPut({
        id: recordId("nwc", name),
        role: "nwc",
        username: name,
        iv: wrapped.iv,
        ciphertext: wrapped.ciphertext,
      });
    } catch {
      throw new Error("Could not store the wallet connection in this browser.");
    }
    nwcPresent = true;
  }

  async function readNwc() {
    if (!validStoredName(activeUser)) {
      nwcPresent = false;
      return "";
    }
    const id = recordId("nwc", activeUser);
    let record;
    try {
      record = await idbGet(id);
    } catch {
      nwcPresent = false;
      return "";
    }
    if (!recordWrapped(record)) {
      nwcPresent = false;
      return "";
    }
    let bytes;
    try {
      bytes = await unwrapBytes(record);
      const text = new TextDecoder().decode(bytes);
      nwcPresent = Boolean(text);
      return text;
    } catch (err) {
      nwcPresent = false;
      const name = err && err.name;
      if (name === "OperationError" || name === "DataError") {
        await idbDelete(id).catch(() => {});
      }
      return "";
    } finally {
      wipe(bytes);
    }
  }

  async function clearNwc() {
    nwcPresent = false;
    if (!validStoredName(activeUser)) return;
    await idbDelete(recordId("nwc", activeUser));
  }

  function hasNwc() {
    return nwcPresent;
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

  async function broadcastKeyList(keyList, operations) {
    if (!Array.isArray(keyList) || !keyList.length || !Array.isArray(operations) || !operations.length) {
      throw new Error("Invalid blockchain operation.");
    }
    const lib = await loadHiveTx();
    const keys = [];
    try {
      for (let i = 0; i < keyList.length; i++) keys.push(lib.PrivateKey.from(keyList[i]));
      const tx = new lib.Transaction();
      for (let i = 0; i < operations.length; i++) {
        const op = operations[i];
        if (!Array.isArray(op) || op.length < 2) {
          throw new Error("Invalid blockchain operation.");
        }
        await tx.addOperation(op[0], op[1]);
      }
      tx.sign(keys);
      const result = await tx.broadcast();
      return { success: true, result: result || null };
    } finally {
      for (let i = 0; i < keys.length; i++) {
        const pk = keys[i];
        if (pk && pk.key && pk.key !== keyList[i]) wipe(pk.key);
      }
    }
  }

  async function broadcastKeyBytes(keyBytes, operations) {
    return broadcastKeyList([keyBytes], operations);
  }

  async function broadcast(username, operations) {
    const keyBytes = requireSession(username);
    return broadcastKeyBytes(keyBytes, operations);
  }

  // Sign with the posting key stored for this account, including an account
  // that is not the one unlocked in this tab. The unlocked key stays put.
  // A missing record throws with missingKey so the caller can ask instead.
  async function broadcastStored(username, operations) {
    const name = accountName(username);
    if (sessionUser === name && sessionBytes && sessionBytes.length === 32) {
      return broadcast(name, operations);
    }
    if (!validStoredName(name)) {
      const err = new Error("Enter a valid Hive username.");
      err.missingKey = true;
      throw err;
    }
    let record = null;
    try {
      record = await idbGet(recordId("posting", name));
    } catch {
      record = null;
    }
    if (!recordWrapped(record)) {
      const err = new Error("No posting key is stored for this account.");
      err.missingKey = true;
      throw err;
    }
    let bytes = null;
    try {
      bytes = await unwrapBytes(record);
    } catch {
      bytes = null;
    }
    if (!bytes || bytes.length !== 32) {
      wipe(bytes);
      const err = new Error("No posting key is stored for this account.");
      err.missingKey = true;
      throw err;
    }
    try {
      return await broadcastKeyBytes(bytes, operations);
    } finally {
      wipe(bytes);
    }
  }

  // A WIF is that key. Anything else is a master password and is derived
  // into the role. The caller owns bytes and must wipe them.
  async function openRoleSecret(username, secret, role) {
    const name = accountName(username);
    const roleName = normalizeRole(role);
    if (!validStoredName(name)) {
      throw new Error("Enter a valid Hive username.");
    }
    let raw = String(secret == null ? "" : secret);
    secret = "";
    let compact = raw.replace(/\s+/g, "");
    if (!compact) {
      raw = "";
      throw new Error("Enter " + roleEnterPhrase(roleName) + ".");
    }
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
      const pub = pk.createPublic().toString();
      const bytes = pk.key.slice();
      wipe(pk.key);
      return { name: name, role: roleName, bytes: bytes, pub: pub };
    }
    let password = raw.trim();
    raw = "";
    compact = "";
    const derivedJob = deriveRoleKey(name, password, roleName);
    password = "";
    const derived = await derivedJob;
    return { name: name, role: roleName, bytes: derived.bytes, pub: derived.pub };
  }

  // One role key, from a WIF or a master password. Checked, used, discarded.
  async function materializeRoleKey(username, secret, role) {
    const openedJob = openRoleSecret(username, secret, role);
    secret = "";
    const opened = await openedJob;
    try {
      const accounts = await HiveApi.getAccounts([opened.name]);
      const account = accounts && accounts[0];
      if (!account || accountName(account.name) !== opened.name) {
        throw new Error("Unknown Hive account @" + opened.name + ".");
      }
      if (rolePubs(account, opened.role).indexOf(opened.pub) < 0) {
        throw new Error(
          "This " + opened.role + " key does not match @" + opened.name + "."
        );
      }
      return { name: opened.name, role: opened.role, bytes: opened.bytes };
    } catch (err) {
      wipe(opened.bytes);
      throw err;
    }
  }

  // Public key for a WIF or a master password. The private key is wiped.
  async function publicFromSecret(username, secret, role) {
    const openedJob = openRoleSecret(username, secret, role);
    secret = "";
    const opened = await openedJob;
    wipe(opened.bytes);
    return opened.pub;
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

  // Two owner secrets for recover_account. Neither is checked against the
  // current owner. The recent key is an old owner, and the new key is not
  // on the account yet. Both are used once and wiped.
  async function broadcastRecoverySecrets(username, recentSecret, newSecret, operations) {
    const recentJob = openRoleSecret(username, recentSecret, "owner");
    recentSecret = "";
    let recent = null;
    try {
      recent = await recentJob;
    } catch (err) {
      newSecret = "";
      throw err;
    }
    let fresh = null;
    try {
      fresh = await openRoleSecret(username, newSecret, "owner");
      newSecret = "";
    } catch (err) {
      newSecret = "";
      wipe(recent.bytes);
      throw err;
    }
    if (recent.pub === fresh.pub) {
      wipe(recent.bytes);
      wipe(fresh.bytes);
      throw new Error("The new owner key must be different from the recent owner key.");
    }
    try {
      return await broadcastKeyList([recent.bytes, fresh.bytes], operations);
    } finally {
      wipe(recent.bytes);
      wipe(fresh.bytes);
    }
  }

  // Encrypt a Hive memo with a memo key or master password. The text must
  // start with #. Memo.encode strips that flag, encrypts the rest for the
  // recipient memo key, and returns # plus base58. The secret is checked
  // against the account, used once, and wiped.
  async function encodeMemo(username, secret, recipientMemoKey, memo) {
    const text = String(memo || "");
    const pub = String(recipientMemoKey || "");
    if (!text.startsWith("#") || !pub || pub.slice(-39) === "1111111111111111111111111111111114T1Anm") {
      secret = "";
      throw new Error("Could not encrypt this memo.");
    }
    const openedJob = materializeRoleKey(username, secret, "memo");
    secret = "";
    const opened = await openedJob;
    try {
      const lib = await loadHiveTx();
      const pk = lib.PrivateKey.from(opened.bytes);
      try {
        return lib.Memo.encode(pk, pub, text);
      } catch {
        throw new Error("Could not encrypt this memo.");
      } finally {
        if (pk && pk.key) wipe(pk.key);
      }
    } finally {
      wipe(opened.bytes);
    }
  }

  // Decrypt a Hive memo (#…) with a memo key or master password. The secret
  // is checked against the account, used once, and wiped.
  async function decodeMemo(username, secret, memo) {
    const openedJob = materializeRoleKey(username, secret, "memo");
    secret = "";
    const opened = await openedJob;
    try {
      const lib = await loadHiveTx();
      const pk = lib.PrivateKey.from(opened.bytes);
      try {
        return lib.Memo.decode(pk, String(memo || ""));
      } catch {
        throw new Error("Could not decrypt this memo.");
      } finally {
        if (pk && pk.key) wipe(pk.key);
      }
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
    if (!validStoredName(name)) {
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

  global.cs77Auth = {
    ready,
    activate,
    login,
    clear,
    hasKey,
    listStoredKeys,
    storedKeyWif,
    deleteStoredKey,
    saveNwc,
    readNwc,
    clearNwc,
    hasNwc,
    peekNwc: noteNwc,
    user: function () {
      return activeUser || sessionUser;
    },
    signBytes,
    broadcast,
    broadcastStored,
    secretKind,
    deriveRoleKey,
    publicFromSecret,
    wifFromLogin,
    loginMaster,
    broadcastRoleSecret,
    broadcastRecoverySecrets,
    encodeMemo,
    decodeMemo,
    broadcastWithKey,
    broadcastActiveKey,
    broadcastWif,
    keysFromLogin,
  };
})(window);
