// Hive signing, memos, and transaction serialization.
import { bytesToHex, cbc, hexToBytes, ripemd160, secp256k1, sha256, sha512 } from "./vendor/noble.js?v=2.4.0";

// Chain id and address prefix. Node choice and failover live in HiveApi.hiveRpc.
const config = {
  chain_id: "beeab0de00000000000000000000000000000000000000000000000000000000",
  address_prefix: "STM",
};

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE = 58;
const LEADER = ALPHABET[0];
const FACTOR = Math.log(256) / Math.log(BASE);
const IFACTOR = Math.log(BASE) / Math.log(256);

const MAP = new Int16Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) {
  MAP[ALPHABET.charCodeAt(i)] = i;
}

function encodeBase58(source) {
  if (source.length === 0) return "";

  let zeroes = 0;
  let length = 0;
  let pbegin = 0;
  const pend = source.length;
  while (pbegin !== pend && source[pbegin] === 0) {
    pbegin++;
    zeroes++;
  }

  const size = ((pend - pbegin) * FACTOR + 1) >>> 0;
  const b58 = new Uint8Array(size);

  while (pbegin !== pend) {
    let carry = source[pbegin];
    let i = 0;
    for (let it = size - 1; (carry !== 0 || i < length) && it !== -1; it--, i++) {
      carry += (256 * b58[it]) >>> 0;
      b58[it] = (carry % BASE) >>> 0;
      carry = (carry / BASE) >>> 0;
    }
    if (carry !== 0) throw new Error("Non-zero carry");
    length = i;
    pbegin++;
  }

  let it = size - length;
  while (it !== size && b58[it] === 0) it++;

  let str = LEADER.repeat(zeroes);
  for (; it < size; ++it) str += ALPHABET.charAt(b58[it]);
  return str;
}

function decodeBase58(source) {
  if (source.length === 0) return new Uint8Array();

  let psz = 0;
  let zeroes = 0;
  let length = 0;
  while (source[psz] === LEADER) {
    zeroes++;
    psz++;
  }

  const size = ((source.length - psz) * IFACTOR + 1) >>> 0;
  const b256 = new Uint8Array(size);

  while (psz < source.length) {
    const ch = source.charCodeAt(psz);
    const digit = ch < 128 ? MAP[ch] : -1;
    if (digit === -1) {
      throw new Error("Non-base58 character: " + JSON.stringify(source[psz]));
    }

    let carry = digit;
    let i = 0;
    for (let it = size - 1; (carry !== 0 || i < length) && it !== -1; it--, i++) {
      carry += (BASE * b256[it]) >>> 0;
      b256[it] = (carry % 256) >>> 0;
      carry = (carry / 256) >>> 0;
    }
    if (carry !== 0) throw new Error("Non-zero carry");
    length = i;
    psz++;
  }

  let it = size - length;
  while (it !== size && b256[it] === 0) it++;

  const out = new Uint8Array(zeroes + (size - it));
  let j = zeroes;
  while (it !== size) out[j++] = b256[it++];
  return out;
}

// ByteBuffer behavior is derived from bytebuffer.js, Apache License 2.0, Copyright 2015 Daniel Wirtz. Used for Hive binary serialization.

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

class ByteBuffer {
  static DEFAULT_CAPACITY = 16;

  constructor(capacity = 16) {
    this.buffer = new ArrayBuffer(capacity);
    this.view = new DataView(this.buffer);
    this.offset = 0;
    this.limit = capacity;
  }

  #ensure(size) {
    const needed = this.offset + size;
    if (needed <= this.buffer.byteLength) return;
    let capacity = this.buffer.byteLength || 1;
    while (capacity < needed) capacity *= 2;
    const next = new ArrayBuffer(capacity);
    new Uint8Array(next).set(new Uint8Array(this.buffer));
    this.buffer = next;
    this.view = new DataView(next);
  }

  writeByte(n) {
    this.#ensure(1);
    this.view.setUint8(this.offset, n);
    this.offset += 1;
  }

  writeUint8(n) {
    this.writeByte(n);
  }

  writeInt16(n) {
    if (!Number.isInteger(n) || n < -32768 || n > 32767) {
      throw new Error("Int16 out of range");
    }
    this.#ensure(2);
    this.view.setInt16(this.offset, n, true);
    this.offset += 2;
  }

  writeUint16(n) {
    if (!Number.isInteger(n) || n < 0 || n > 65535) {
      throw new Error("UInt16 out of range");
    }
    this.#ensure(2);
    this.view.setUint16(this.offset, n, true);
    this.offset += 2;
  }

  writeUint32(n) {
    if (!Number.isInteger(n) || n < 0 || n > 4294967295) {
      throw new Error("UInt32 out of range");
    }
    this.#ensure(4);
    this.view.setUint32(this.offset, n, true);
    this.offset += 4;
  }

  writeInt64(n) {
    const value = typeof n === "bigint" ? n : BigInt(n);
    this.#ensure(8);
    this.view.setBigInt64(this.offset, value, true);
    this.offset += 8;
  }

  writeUint64(n) {
    const value = typeof n === "bigint" ? n : BigInt(n);
    this.#ensure(8);
    this.view.setBigUint64(this.offset, value, true);
    this.offset += 8;
  }

  calculateVarint32(value) {
    value >>>= 0;
    if (value < 1 << 7) return 1;
    if (value < 1 << 14) return 2;
    if (value < 1 << 21) return 3;
    if (value < 1 << 28) return 4;
    return 5;
  }

  writeVarint32(value) {
    const size = this.calculateVarint32(value);
    this.#ensure(size);
    value >>>= 0;
    let offset = this.offset;
    while (value >= 0x80) {
      this.view.setUint8(offset++, (value & 0x7f) | 0x80);
      value >>>= 7;
    }
    this.view.setUint8(offset++, value);
    this.offset = offset;
  }

  readVarint32(offset) {
    const relative = offset === undefined;
    let pos = relative ? this.offset : offset;
    let value = 0 >>> 0;
    let length = 0;
    let byte;
    do {
      byte = this.view.getUint8(pos++);
      if (length < 5) value |= (byte & 0x7f) << (7 * length);
      length++;
    } while ((byte & 0x80) !== 0);
    value |= 0;
    if (relative) {
      this.offset = pos;
      return value;
    }
    return { value, length };
  }

  writeVString(str) {
    // Undefined must not become the UTF-8 bytes of the word "undefined".
    if (typeof str !== "string") throw new Error("Expected string");
    const encoded = textEncoder.encode(str);
    this.writeVarint32(encoded.length);
    this.append(encoded);
  }

  readVString() {
    const start = this.offset;
    const header = this.readVarint32(start);
    const byteStart = start + header.length;
    const bytes = new Uint8Array(this.buffer, byteStart, header.value);
    this.offset = byteStart + header.value;
    return textDecoder.decode(bytes);
  }

  append(source) {
    const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
    if (bytes.length === 0) return;
    this.#ensure(bytes.length);
    new Uint8Array(this.buffer).set(bytes, this.offset);
    this.offset += bytes.length;
  }

  copy(begin, end) {
    const bytes = new Uint8Array(this.buffer).subarray(begin, end);
    const copy = new ByteBuffer(bytes.length);
    if (bytes.length > 0) new Uint8Array(copy.buffer).set(bytes);
    copy.offset = 0;
    copy.limit = bytes.length;
    return copy;
  }

  flip() {
    this.limit = this.offset;
    this.offset = 0;
    return this;
  }

  toBuffer() {
    if (this.offset === 0 && this.limit === this.buffer.byteLength) return this.buffer;
    if (this.offset === this.limit) return new ArrayBuffer(0);
    return this.buffer.slice(this.offset, this.limit);
  }
}


// Hive still serializes HIVE as STEEM and HBD as SBD.
const SYMBOLS = new Set(["STEEM", "VESTS", "SBD", "TESTS", "TBD", "HIVE", "HBD"]);

class Asset {
  constructor(amount, symbol) {
    this.amount = amount;
    this.symbol = symbol === "HIVE" ? "STEEM" : symbol === "HBD" ? "SBD" : symbol;
  }

  static from(value) {
    if (typeof value !== "string") throw new Error("Expected asset");
    const match = /^(\d+)\.(\d+) ([A-Z]+)$/.exec(value);
    if (!match) throw new Error("Invalid asset: " + value);
    const whole = match[1];
    const fraction = match[2];
    const symbol = match[3];
    if (!SYMBOLS.has(symbol)) throw new Error("Invalid asset symbol: " + symbol);
    if (whole.length > 1 && whole.charCodeAt(0) === 48) {
      throw new Error("Invalid asset amount: " + value);
    }
    const precision = symbol === "VESTS" ? 6 : 3;
    if (fraction.length !== precision) {
      throw new Error("Invalid asset precision: " + value);
    }
    const amount = BigInt(whole + fraction);
    if (amount > 9223372036854775807n) throw new Error("Invalid asset amount: " + value);
    return new Asset(amount, symbol);
  }

  getPrecision() {
    if (this.symbol === "VESTS") return 6;
    return 3;
  }
}

class PublicKey {
  constructor(key, prefix) {
    if (!(key instanceof Uint8Array) || key.length !== 33) {
      throw new Error("Expected 33-byte public key");
    }
    this.key = key;
    this.prefix = prefix ?? config.address_prefix;
  }

  static fromString(encoded) {
    const prefix = encoded.slice(0, 3);
    const decoded = decodeBase58(encoded.slice(3));
    // hive-tx keeps the key bytes and does not check this checksum.
    const key = decoded.subarray(0, -4);
    return new PublicKey(key, prefix);
  }

  static from(value) {
    if (value instanceof PublicKey) return value;
    return PublicKey.fromString(value);
  }

  toString() {
    const checksum = ripemd160(this.key).subarray(0, 4);
    const data = new Uint8Array(this.key.length + checksum.length);
    data.set(this.key, 0);
    data.set(checksum, this.key.length);
    return this.prefix + encodeBase58(data);
  }
}

class Signature {
  constructor(data, recovery) {
    this.data = data;
    this.recovery = recovery;
  }

  static from(hexString) {
    if (typeof hexString !== "string") throw new Error("Expected string for data");
    const bytes = hexToBytes(hexString);
    // Hive stores a compressed key as 31 plus the recovery id.
    return new Signature(bytes.subarray(1), bytes[0] - 31);
  }

  toBuffer() {
    const buffer = new Uint8Array(65);
    buffer[0] = (this.recovery + 31) & 0xff;
    buffer.set(this.data, 1);
    return buffer;
  }

  customToString() {
    return bytesToHex(this.toBuffer());
  }
}

function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

class PrivateKey {
  constructor(key) {
    this.key = key;
    try {
      secp256k1.getPublicKey(key);
    } catch {
      throw new Error("invalid private key");
    }
  }

  static from(value) {
    if (typeof value === "string") return PrivateKey.fromString(value);
    return new PrivateKey(value);
  }

  static fromString(wif) {
    const decoded = decodeBase58(wif);
    if (decoded[0] !== 0x80) throw new Error("Private key network id mismatch");
    const payload = decoded.subarray(0, -4);
    const checksum = decoded.subarray(-4);
    const expect = sha256(sha256(payload)).subarray(0, 4);
    if (!sameBytes(checksum, expect)) throw new Error("Private key checksum mismatch");
    // 32-byte secret shares the decoded buffer. Do not copy.
    return new PrivateKey(payload.subarray(1));
  }

  static fromSeed(seed) {
    return new PrivateKey(sha256(new TextEncoder().encode(seed)));
  }

  sign(message) {
    // The message is already a 32-byte hash. Hive's header is 31 plus the recovery id.
    const signed = secp256k1.sign(message, this.key, {
      extraEntropy: true,
      format: "recovered",
      prehash: false,
    });
    const hive = new Uint8Array(65);
    hive[0] = (signed[0] + 31) & 0xff;
    hive.set(signed.subarray(1), 1);
    return Signature.from(bytesToHex(hive));
  }

  createPublic() {
    return new PublicKey(secp256k1.getPublicKey(this.key));
  }

  toString() {
    const payload = new Uint8Array(1 + this.key.length);
    payload[0] = 0x80;
    payload.set(this.key, 1);
    const checksum = sha256(sha256(payload)).subarray(0, 4);
    const full = new Uint8Array(payload.length + checksum.length);
    full.set(payload, 0);
    full.set(checksum, payload.length);
    return encodeBase58(full);
  }

  getSharedSecret(publicKey) {
    const shared = secp256k1.getSharedSecret(this.key, publicKey.key);
    return sha512(shared.subarray(1));
  }
}

const NULL_PUBLIC_KEY_SUFFIX = "1111111111111111111111111111111114T1Anm";

function VoidSerializer() {
  throw new Error("Void can not be serialized");
}

function StringSerializer(buffer, data) {
  buffer.writeVString(data);
}

function Int16Serializer(buffer, data) {
  buffer.writeInt16(data);
}

function UInt16Serializer(buffer, data) {
  buffer.writeUint16(data);
}

function UInt32Serializer(buffer, data) {
  buffer.writeUint32(data);
}

function UInt64Serializer(buffer, data) {
  buffer.writeUint64(data);
}

function Int64Serializer(buffer, data) {
  buffer.writeInt64(data);
}

function BooleanSerializer(buffer, data) {
  buffer.writeByte(data ? 1 : 0);
}

// Callers pass "YYYY-MM-DDTHH:MM:SS" with no zone. hive-tx always appends Z.
function DateSerializer(buffer, data) {
  buffer.writeUint32(Math.floor(new Date(data + "Z").getTime() / 1000));
}

function AssetSerializer(buffer, data) {
  const asset = Asset.from(data);
  buffer.writeInt64(asset.amount);
  buffer.writeUint8(asset.getPrecision());
  const symbol = asset.symbol;
  for (let i = 0; i < 7; i++) buffer.writeUint8(symbol.charCodeAt(i) || 0);
}

function PublicKeySerializer(buffer, data) {
  if (
    data === null ||
    (typeof data === "string" && data.slice(-39) === NULL_PUBLIC_KEY_SUFFIX)
  ) {
    buffer.append(new Uint8Array(33));
    return;
  }
  buffer.append(PublicKey.from(data).key);
}

function BytesSerializer(buffer, data) {
  if (!(data instanceof Uint8Array)) throw new Error("Expected bytes");
  buffer.writeVarint32(data.length);
  buffer.append(data);
}

function ArraySerializer(itemSerializer) {
  return (buffer, data) => {
    if (!Array.isArray(data)) throw new Error("Expected array");
    buffer.writeVarint32(data.length);
    for (let i = 0; i < data.length; i++) itemSerializer(buffer, data[i]);
  };
}

function FlatMapSerializer(keySerializer, valueSerializer) {
  return (buffer, data) => {
    if (!Array.isArray(data)) throw new Error("Expected array");
    buffer.writeVarint32(data.length);
    for (let i = 0; i < data.length; i++) {
      keySerializer(buffer, data[i][0]);
      valueSerializer(buffer, data[i][1]);
    }
  };
}

function OptionalSerializer(valueSerializer) {
  return (buffer, data) => {
    if (data === undefined) {
      buffer.writeByte(0);
      return;
    }
    buffer.writeByte(1);
    valueSerializer(buffer, data);
  };
}

function StaticVariantSerializer(itemSerializers) {
  return (buffer, data) => {
    const id = data[0];
    buffer.writeVarint32(id);
    itemSerializers[id](buffer, data[1]);
  };
}

function ObjectSerializer(fields) {
  return (buffer, data) => {
    for (let i = 0; i < fields.length; i++) {
      const key = fields[i][0];
      try {
        fields[i][1](buffer, data[key]);
      } catch (error) {
        error.message = key + ": " + error.message;
        throw error;
      }
    }
  };
}

const AuthoritySerializer = ObjectSerializer([
  ["weight_threshold", UInt32Serializer],
  ["account_auths", FlatMapSerializer(StringSerializer, UInt16Serializer)],
  ["key_auths", FlatMapSerializer(PublicKeySerializer, UInt16Serializer)],
]);

const BeneficiarySerializer = ObjectSerializer([
  ["account", StringSerializer],
  ["weight", UInt16Serializer],
]);

function operation(id, fields) {
  const body = ObjectSerializer(fields);
  return (buffer, data) => {
    buffer.writeVarint32(id);
    body(buffer, data);
  };
}

const operationSerializers = {
  vote: operation(0, [
    ["voter", StringSerializer],
    ["author", StringSerializer],
    ["permlink", StringSerializer],
    ["weight", Int16Serializer],
  ]),
  comment: operation(1, [
    ["parent_author", StringSerializer],
    ["parent_permlink", StringSerializer],
    ["author", StringSerializer],
    ["permlink", StringSerializer],
    ["title", StringSerializer],
    ["body", StringSerializer],
    ["json_metadata", StringSerializer],
  ]),
  transfer: operation(2, [
    ["from", StringSerializer],
    ["to", StringSerializer],
    ["amount", AssetSerializer],
    ["memo", StringSerializer],
  ]),
  transfer_to_vesting: operation(3, [
    ["from", StringSerializer],
    ["to", StringSerializer],
    ["amount", AssetSerializer],
  ]),
  withdraw_vesting: operation(4, [
    ["account", StringSerializer],
    ["vesting_shares", AssetSerializer],
  ]),
  convert: operation(8, [
    ["owner", StringSerializer],
    ["requestid", UInt32Serializer],
    ["amount", AssetSerializer],
  ]),
  account_create: operation(9, [
    ["fee", AssetSerializer],
    ["creator", StringSerializer],
    ["new_account_name", StringSerializer],
    ["owner", AuthoritySerializer],
    ["active", AuthoritySerializer],
    ["posting", AuthoritySerializer],
    ["memo_key", PublicKeySerializer],
    ["json_metadata", StringSerializer],
  ]),
  account_witness_vote: operation(12, [
    ["account", StringSerializer],
    ["witness", StringSerializer],
    ["approve", BooleanSerializer],
  ]),
  account_witness_proxy: operation(13, [
    ["account", StringSerializer],
    ["proxy", StringSerializer],
  ]),
  delete_comment: operation(17, [
    ["author", StringSerializer],
    ["permlink", StringSerializer],
  ]),
  custom_json: operation(18, [
    ["required_auths", ArraySerializer(StringSerializer)],
    ["required_posting_auths", ArraySerializer(StringSerializer)],
    ["id", StringSerializer],
    ["json", StringSerializer],
  ]),
  comment_options: operation(19, [
    ["author", StringSerializer],
    ["permlink", StringSerializer],
    ["max_accepted_payout", AssetSerializer],
    ["percent_hbd", UInt16Serializer],
    ["allow_votes", BooleanSerializer],
    ["allow_curation_rewards", BooleanSerializer],
    [
      "extensions",
      ArraySerializer(
        StaticVariantSerializer([
          ObjectSerializer([["beneficiaries", ArraySerializer(BeneficiarySerializer)]]),
        ])
      ),
    ],
  ]),
  claim_account: operation(22, [
    ["creator", StringSerializer],
    ["fee", AssetSerializer],
    ["extensions", ArraySerializer(VoidSerializer)],
  ]),
  create_claimed_account: operation(23, [
    ["creator", StringSerializer],
    ["new_account_name", StringSerializer],
    ["owner", AuthoritySerializer],
    ["active", AuthoritySerializer],
    ["posting", AuthoritySerializer],
    ["memo_key", PublicKeySerializer],
    ["json_metadata", StringSerializer],
    ["extensions", ArraySerializer(VoidSerializer)],
  ]),
  transfer_to_savings: operation(32, [
    ["from", StringSerializer],
    ["to", StringSerializer],
    ["amount", AssetSerializer],
    ["memo", StringSerializer],
  ]),
  transfer_from_savings: operation(33, [
    ["from", StringSerializer],
    ["request_id", UInt32Serializer],
    ["to", StringSerializer],
    ["amount", AssetSerializer],
    ["memo", StringSerializer],
  ]),
  cancel_transfer_from_savings: operation(34, [
    ["from", StringSerializer],
    ["request_id", UInt32Serializer],
  ]),
  claim_reward_balance: operation(39, [
    ["account", StringSerializer],
    ["reward_hive", AssetSerializer],
    ["reward_hbd", AssetSerializer],
    ["reward_vests", AssetSerializer],
  ]),
  delegate_vesting_shares: operation(40, [
    ["delegator", StringSerializer],
    ["delegatee", StringSerializer],
    ["vesting_shares", AssetSerializer],
  ]),
  account_update2: operation(43, [
    ["account", StringSerializer],
    ["owner", OptionalSerializer(AuthoritySerializer)],
    ["active", OptionalSerializer(AuthoritySerializer)],
    ["posting", OptionalSerializer(AuthoritySerializer)],
    ["memo_key", OptionalSerializer(PublicKeySerializer)],
    ["json_metadata", StringSerializer],
    ["posting_json_metadata", StringSerializer],
    ["extensions", ArraySerializer(VoidSerializer)],
  ]),
  create_proposal: operation(44, [
    ["creator", StringSerializer],
    ["receiver", StringSerializer],
    ["start_date", DateSerializer],
    ["end_date", DateSerializer],
    ["daily_pay", AssetSerializer],
    ["subject", StringSerializer],
    ["permlink", StringSerializer],
    ["extensions", ArraySerializer(VoidSerializer)],
  ]),
  update_proposal_votes: operation(45, [
    ["voter", StringSerializer],
    ["proposal_ids", ArraySerializer(Int64Serializer)],
    ["approve", BooleanSerializer],
    ["extensions", ArraySerializer(VoidSerializer)],
  ]),
  remove_proposal: operation(46, [
    ["proposal_owner", StringSerializer],
    ["proposal_ids", ArraySerializer(Int64Serializer)],
    ["extensions", ArraySerializer(VoidSerializer)],
  ]),
  update_proposal: operation(47, [
    ["proposal_id", UInt64Serializer],
    ["creator", StringSerializer],
    ["daily_pay", AssetSerializer],
    ["subject", StringSerializer],
    ["permlink", StringSerializer],
    [
      "extensions",
      ArraySerializer(
        StaticVariantSerializer([
          VoidSerializer,
          ObjectSerializer([["end_date", DateSerializer]]),
        ])
      ),
    ],
  ]),
  collateralized_convert: operation(48, [
    ["owner", StringSerializer],
    ["requestid", UInt32Serializer],
    ["amount", AssetSerializer],
  ]),
};

function OperationSerializer(buffer, operation) {
  const name = operation[0];
  const serializer = operationSerializers[name];
  if (!serializer) throw new Error("No serializer for operation: " + name);
  try {
    serializer(buffer, operation[1]);
  } catch (error) {
    error.message = name + ": " + error.message;
    throw error;
  }
}

// Signatures are not part of the signed bytes.
const TransactionSerializer = ObjectSerializer([
  ["ref_block_num", UInt16Serializer],
  ["ref_block_prefix", UInt32Serializer],
  ["expiration", DateSerializer],
  ["operations", ArraySerializer(OperationSerializer)],
  ["extensions", ArraySerializer(StringSerializer)],
]);

const MemoSerializer = ObjectSerializer([
  ["from", PublicKeySerializer],
  ["to", PublicKeySerializer],
  ["nonce", UInt64Serializer],
  ["check", UInt32Serializer],
  ["encrypted", BytesSerializer],
]);

const Serializer = {
  Memo: MemoSerializer,
  Transaction: TransactionSerializer,
};

let uniqueNonceEntropy = null;

function uniqueNonce() {
  if (uniqueNonceEntropy === null) {
    const randomKey = secp256k1.utils.randomSecretKey();
    uniqueNonceEntropy = Math.round((randomKey[0] << 8) | randomKey[1]);
  }
  const entropy = ++uniqueNonceEntropy % 0xffff;
  return (BigInt(Date.now()) << 16n) | BigInt(entropy);
}

function crypt(privateKey, publicKey, nonce, message, checksum) {
  const nonceValue = typeof nonce === "bigint" ? nonce : BigInt(nonce);
  const secret = new Uint8Array(privateKey.getSharedSecret(publicKey));
  const seed = new Uint8Array(8 + secret.length);
  new DataView(seed.buffer).setBigUint64(0, nonceValue, true);
  seed.set(secret, 8);
  const encryptionKey = sha512(seed);
  const key = encryptionKey.subarray(0, 32);
  const iv = encryptionKey.subarray(32, 48);
  const checkBytes = sha256(encryptionKey).subarray(0, 4);
  const check32 = new DataView(checkBytes.buffer, checkBytes.byteOffset, 4).getUint32(0, true);
  if (checksum == null) {
    return {
      nonce: nonceValue,
      message: cbc(key, iv).encrypt(message),
      checksum: check32,
    };
  }
  if (check32 !== checksum) throw new Error("Invalid key");
  return {
    nonce: nonceValue,
    message: cbc(key, iv).decrypt(message),
    checksum: check32,
  };
}

function encrypt(privateKey, publicKey, message, nonce = uniqueNonce()) {
  return crypt(privateKey, publicKey, nonce, message);
}

function decrypt(privateKey, publicKey, nonce, message, checksum) {
  return crypt(privateKey, publicKey, nonce, message, checksum).message;
}

// from(33) | to(33) | nonce uint64 LE | check uint32 LE | varint length | ciphertext
let encodeTest;

function toPrivateKey(value) {
  if (typeof value === "string") return PrivateKey.fromString(value);
  return value;
}

function toPublicKey(value) {
  if (typeof value === "string") return PublicKey.fromString(value);
  return value;
}

function encode(privateKey, publicKey, memo, testNonce) {
  if (!memo.startsWith("#")) return memo;
  memo = memo.substring(1);
  checkEncryption();
  privateKey = toPrivateKey(privateKey);
  publicKey = toPublicKey(publicKey);
  const plain = new ByteBuffer(ByteBuffer.DEFAULT_CAPACITY);
  plain.writeVString(memo);
  const plaintext = new Uint8Array(plain.copy(0, plain.offset).toBuffer());
  const { nonce, message, checksum } = encrypt(privateKey, publicKey, plaintext, testNonce);
  const out = new ByteBuffer(ByteBuffer.DEFAULT_CAPACITY);
  Serializer.Memo(out, {
    from: privateKey.createPublic(),
    to: publicKey,
    nonce,
    check: checksum,
    encrypted: message,
  });
  out.flip();
  return "#" + encodeBase58(new Uint8Array(out.toBuffer()));
}

function readVarint32(bytes, offset) {
  let value = 0;
  let count = 0;
  let byte = 0;
  do {
    byte = bytes[offset++];
    value |= (byte & 0x7f) << (7 * count);
    count += 1;
  } while (byte & 0x80);
  return { value: value >>> 0, offset };
}

function decode(privateKey, memo) {
  if (!memo.startsWith("#")) return memo;
  memo = memo.substring(1);
  checkEncryption();
  privateKey = toPrivateKey(privateKey);
  const bytes = decodeBase58(memo);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fromKey = new PublicKey(bytes.slice(0, 33));
  const toKey = new PublicKey(bytes.slice(33, 66));
  const nonce = view.getBigUint64(66, true);
  const check = view.getUint32(74, true);
  const length = readVarint32(bytes, 78);
  const encrypted = bytes.subarray(length.offset, length.offset + length.value);
  const mine = privateKey.createPublic().toString();
  const other = mine === fromKey.toString() ? toKey : fromKey;
  const plaintext = decrypt(privateKey, other, nonce, encrypted, check);
  const text = new ByteBuffer(ByteBuffer.DEFAULT_CAPACITY);
  text.append(plaintext);
  text.flip();
  return "#" + text.readVString();
}

function checkEncryption() {
  if (encodeTest === undefined) {
    let plaintext;
    encodeTest = true;
    try {
      const wif = "5JdeC9P7Pbd1uGdFVEsJ41EkEnADbbHGq6p1BwFxm6txNBsQnsw";
      const ciphertext = encode(wif, "STM8m5UgaFAAYQRuaNejYdS8FVLVp9Ss3K1qAVk5de6F8s3HnVbvA", "#memo爱");
      plaintext = decode(wif, ciphertext);
    } finally {
      encodeTest = plaintext === "#memo爱";
    }
  }
  if (encodeTest === false) throw new Error("This environment does not support encryption.");
}

const Memo = { encode, decode };

// Same node list, timeout, retry, and saved-node update as the rest of the app.
function callRpc(method, params) {
  const api = globalThis.HiveApi;
  if (!api || typeof api.hiveRpc !== "function") {
    throw new Error("Hive API is not loaded.");
  }
  return api.hiveRpc(method, params);
}

// A signed transaction expires 60 seconds after it is built. The chain rounds
// that lifetime up to one hour when it prices resource credits.
const TRANSACTION_EXPIRATION_MS = 60 * 1000;

class Transaction {
  constructor() {
    this.txId = undefined;
  }

  async addOperation(name, body) {
    if (!this.transaction) await this.#createTransaction();
    this.transaction.operations.push([name, body]);
  }

  sign(keys) {
    if (!this.transaction) {
      throw new Error("First create a transaction by .addOperation()");
    }
    const list = Array.isArray(keys) ? keys : [keys];
    const { digest, txId } = this.digest();
    for (let i = 0; i < list.length; i++) {
      this.transaction.signatures.push(list[i].sign(digest).customToString());
    }
    this.txId = txId;
    return this.transaction;
  }

  async broadcast() {
    if (!this.transaction) {
      throw new Error(
        "Attempted to broadcast an empty transaction. Add operations by .addOperation()"
      );
    }
    if (!this.transaction.signatures || this.transaction.signatures.length === 0) {
      throw new Error(
        "Attempted to broadcast a transaction with no signatures. Sign using .sign(keys)"
      );
    }
    try {
      await callRpc("condenser_api.broadcast_transaction", [this.transaction]);
    } catch (error) {
      // A retry can land on a node that already accepted this transaction.
      if (!error || !String(error.message).includes("Duplicate transaction check failed")) {
        throw error;
      }
    }
    if (!this.txId) this.txId = this.digest().txId;
    return { tx_id: this.txId, status: "unknown" };
  }

  digest() {
    if (!this.transaction) {
      throw new Error("First create a transaction by .addOperation()");
    }
    const buffer = new ByteBuffer(ByteBuffer.DEFAULT_CAPACITY);
    try {
      Serializer.Transaction(buffer, this.transaction);
    } catch (cause) {
      throw new Error("Unable to serialize transaction: " + cause);
    }
    buffer.flip();
    const bytes = new Uint8Array(buffer.toBuffer());
    const txId = bytesToHex(sha256(bytes)).slice(0, 40);
    const chainId = hexToBytes(config.chain_id);
    const payload = new Uint8Array(chainId.length + bytes.length);
    payload.set(chainId, 0);
    payload.set(bytes, chainId.length);
    return { digest: sha256(payload), txId };
  }

  async #createTransaction() {
    const props = await callRpc("condenser_api.get_dynamic_global_properties", []);
    const idBytes = hexToBytes(props.head_block_id);
    // head_block_id bytes 4..7 are a little-endian uint32 ref block prefix.
    const refBlockPrefix = new DataView(
      idBytes.buffer,
      idBytes.byteOffset,
      idBytes.byteLength
    ).getUint32(4, true);
    this.transaction = {
      expiration: new Date(Date.now() + TRANSACTION_EXPIRATION_MS).toISOString().slice(0, -5),
      extensions: [],
      operations: [],
      ref_block_num: props.head_block_number & 0xffff,
      ref_block_prefix: refBlockPrefix,
      signatures: [],
    };
  }
}

export { PrivateKey, Transaction, Memo };
