/**
 * Blockchain operation queue. Jobs run one at a time on this page.
 * Signing and broadcast use a stored posting key or Hive Keychain,
 * both of which stay on the page thread.
 */
(function (global) {
  "use strict";

  const listeners = new Set();
  const pending = new Map();
  const queue = [];
  let seq = 0;
  let inflight = null;

  function emit(event) {
    listeners.forEach((fn) => {
      try {
        fn(event);
      } catch {
        /* listener errors stay local */
      }
    });
  }

  function nextId() {
    seq += 1;
    return "cs77-op-" + seq + "-" + Date.now();
  }

  function queueSize() {
    return queue.length + (inflight ? 1 : 0);
  }

  function executeOp(op) {
    return new Promise((resolve, reject) => {
      const username = op && op.username;
      const operations = op && op.operations;
      const key = (op && op.key) || "Posting";
      const role = String(key);
      if (!username || !Array.isArray(operations) || !operations.length) {
        reject(new Error("Invalid blockchain operation."));
        return;
      }
      const auth = global.HiveAuth;
      const usePostingKey = role === "Posting" && auth && auth.hasKey(username);
      if (usePostingKey) {
        auth
          .broadcast(username, operations)
          .then((result) => resolve(result || { success: true }))
          .catch(reject);
        return;
      }
      if (!global.hive_keychain) {
        reject(
          new Error(
            role === "Active"
              ? "Hive Keychain is needed to sign this with the active key."
              : "Connect with Hive Keychain or a posting key to continue."
          )
        );
        return;
      }
      global.hive_keychain.requestBroadcast(username, operations, key, (res) => {
        if (res && res.success) resolve(res);
        else {
          reject(
            new Error(
              (res && (res.message || res.error)) || "Broadcast was cancelled."
            )
          );
        }
      });
    });
  }

  function settle(id, success, error, result) {
    const job = pending.get(id);
    if (!job) return;
    pending.delete(id);
    if (success) job.resolve(result);
    else job.reject(error instanceof Error ? error : new Error(error || "Operation failed."));
  }

  function finish(id, success, error, result) {
    if (!inflight || inflight.id !== id) return;
    inflight = null;
    const event = {
      type: success ? "done" : "failed",
      id,
      size: queueSize(),
    };
    if (success) event.result = result;
    else event.error = error || "";
    emit(event);
    settle(id, success, error, result);
    pump();
  }

  function pump() {
    if (inflight) return;
    if (!queue.length) {
      emit({ type: "idle", size: 0 });
      return;
    }
    inflight = queue.shift();
    const job = inflight;
    setTimeout(() => {
      if (inflight !== job) return;
      emit({ type: "process", id: job.id, op: job.op, size: queueSize() });
      executeOp(job.op)
        .then((result) => {
          finish(job.id, true, "", result);
        })
        .catch((err) => {
          finish(job.id, false, (err && err.message) || String(err), null);
        });
    }, 0);
  }

  function enqueue(op) {
    if (!op || typeof op !== "object") {
      return {
        id: null,
        promise: Promise.reject(new Error("Invalid blockchain operation.")),
      };
    }
    const id = nextId();
    const promise = new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, op });
    });
    queue.push({ id, op });
    emit({ type: "queued", id, size: queueSize() });
    pump();
    return { id, promise };
  }

  function vote({ voter, author, permlink, weight }) {
    const w = Math.max(-10000, Math.min(10000, Math.round(Number(weight) || 0)));
    return enqueue({
      username: voter,
      key: "Posting",
      operations: [
        [
          "vote",
          {
            voter,
            author,
            permlink,
            weight: w,
          },
        ],
      ],
      meta: { type: "vote", author, permlink, weight: w },
    });
  }

  function comment({
    author,
    parentAuthor,
    parentPermlink,
    permlink,
    title,
    body,
    jsonMetadata,
    commentOptions,
  }) {
    const meta =
      typeof jsonMetadata === "string"
        ? jsonMetadata
        : JSON.stringify(jsonMetadata || {});
    const operations = [
      [
        "comment",
        {
          parent_author: parentAuthor || "",
          parent_permlink: parentPermlink,
          author,
          permlink,
          title: title || "",
          body,
          json_metadata: meta,
        },
      ],
    ];
    if (commentOptions && typeof commentOptions === "object") {
      operations.push(["comment_options", commentOptions]);
    }
    return enqueue({
      username: author,
      key: "Posting",
      operations,
      meta: {
        type: "comment",
        author,
        permlink,
        parentAuthor: parentAuthor || "",
        parentPermlink,
      },
    });
  }

  // Hive delete_comment. The author signs with the posting key. The chain
  // accepts it only when the post or comment has no direct replies, still has
  // a cashout record, and its net rshares are not positive.
  function deleteComment({ author, permlink }) {
    return enqueue({
      username: author,
      key: "Posting",
      operations: [["delete_comment", { author, permlink }]],
      meta: { type: "delete_comment", author, permlink },
    });
  }

  function subscribe(fn) {
    if (typeof fn === "function") listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function size() {
    return queueSize();
  }

  global.ChainQueue = {
    enqueue,
    vote,
    comment,
    deleteComment,
    subscribe,
    size,
  };
})(window);
