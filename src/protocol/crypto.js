import {assert} from './utils.js';

const isIntX = (bits, n) => Number.isSafeInteger(n) && -(1<<(bits-2))*2 <= n && n < (1<<(bits-2))*2;
const isUIntX = (bits, n) => Number.isSafeInteger(n) && 0 <= n && n < (1<<(bits-2))*4;

const encodeRec = function * (data) { // any mixed type of number, string, array and uint8 array
    if (typeof data === 'number') { // number
        assert(isIntX(32, data), 'Encode: out of int32', {data});
        const buf = new DataView(new ArrayBuffer(5));
        buf.setUint8(0, 0);
        buf.setInt32(1, data);
        yield new Uint8Array(buf.buffer);
    } else if (Array.isArray(data)) {
        if (data.length < 32) { // short array
            yield Uint8Array.of(data.length + 32);
        } else { // long array
            assert(isUIntX(16, data.length), 'Encode: array too long', {l: data.length, data});
            const bufLen = new DataView(new ArrayBuffer(3));
            bufLen.setUint8(0, 1);
            bufLen.setUint16(1, data.length);
            yield new Uint8Array(bufLen.buffer);
        }
        for (const item of data) {
            yield * encodeRec(item);
        }
    } else if (data instanceof Uint8Array) {
        if (data.length < 64) { // short typed array
            yield Uint8Array.of(data.length + 64);
        } else { // long typed array
            assert(isUIntX(16, data.length), 'Encode: typed array too long', {l: data.length, data});
            const bufLen = new DataView(new ArrayBuffer(3));
            bufLen.setUint8(0, 2);
            bufLen.setUint16(1, data.length);
            yield new Uint8Array(bufLen.buffer);
        }
        yield data;
    } else if (typeof data === 'string') {
        const buf = new TextEncoder().encode(data);
        if (buf.length < 128) { // short string
            yield Uint8Array.of(buf.length + 128);
        } else { // long string
            assert(isUIntX(16, buf.length), 'Encode: UTF-8 string too long', {l: buf.length, buf, data});
            const bufLen = new DataView(new ArrayBuffer(3));
            bufLen.setUint8(0, 3);
            bufLen.setUint16(1, buf.length);
            yield new Uint8Array(bufLen.buffer);
        }
        yield new Uint8Array(buf.buffer);
    } else {
        assert(false, 'Encode: invalid type', {data});
    }
};
const encode = data => {
    const uint8s = [...encodeRec(data)];
    const l = uint8s.reduce((s, uint8) => s + uint8.byteLength, 0);
    const bufConcat = new Uint8Array(l);
    let offset = 0;
    for (const uint8 of uint8s) {
        bufConcat.set(uint8, offset);
        offset += uint8.byteLength;
    }
    return bufConcat.buffer;
};

const decodeRec = (buf, offset = 0, type = -1, length = -1) => {
    const view = new DataView(buf, offset);
    if (type < 0) {
        const [data, l] = decodeRec(buf, offset + 1, view.getUint8(0));
        return [data, l+1];
    }
    if (type === 0) { // number
        return [view.getInt32(0), 4];
    } else if (1 <= type && type <= 3) {
        if (length < 0) {
            const [data, l] = decodeRec(buf, offset + 2, type, view.getUint16(0));
            return [data, l + 2];
        }
        switch (type) {
            case 1: { // long array
                const data = Array(length);
                let l = 0;
                for (let i = 0; i < length; ++i) {
                    const [item, ll] = decodeRec(buf, offset + l);
                    data[i] = item;
                    l += ll;
                }
                return [data, l];
            }
            case 2: { // long typed array
                return [new Uint8Array(buf.slice(offset, offset + length)), length];
            }
            case 3: { // long string
                return [new TextDecoder().decode(buf.slice(offset, offset + length)), length];
            }
        }
    } else if (32 <= type && type < 64) { // short array
        return decodeRec(buf, offset, 1, type - 32);
    } else if (64 <= type && type < 128) { // short typed array
        return decodeRec(buf, offset, 2, type - 64);
    } else if (128 <= type) { // short string
        return decodeRec(buf, offset, 3, type - 128);
    }
};
const decode = buf => {
    const [data, l] = decodeRec(buf);
    assert(l === buf.byteLength, 'Encode: broken decoded length', {l, L: buf.byteLength, data, buf});
    return data;
};

export {encode, decode};

const SHA512 = {
    async hash(data) {
        return await crypto.subtle.digest('SHA-512', data);
    },

    async expand(data, l) {
        const output = new Uint8Array(l);
        let chain = data;
        for (let i = 0; i < l; ) {
            const hash = await this.hash(chain);
            assert(hash.byteLength === 64, 'Crypto: broken SHA-512', {L: hash.byteLength});
            const d = Math.min(32, l - i);
            output.set(new Uint8Array(hash, 0, d), i);
            i += d;
            chain = new Uint8Array(hash, d);
        }
        return [output, chain];
    },

    async io(ls, ...entropy) {
        const data = encode(entropy);
        if (typeof ls === 'number') {
            const l = ls;
            return (await this.expand(data, l))[0];
        }
        const result = Array(ls.length);
        for (let i = 0, chain = data; i < ls.length; ++i) {
            [result[i], chain] = await this.expand(chain, ls[i]);
        }
        return result;
    },
};

export {SHA512};

const AES256GCM = {
    keyLength: 32,

    async enc(k, m, ad) {
        const r = crypto.getRandomValues(new Uint8Array(12));
        return [r, new Uint8Array(await crypto.subtle.encrypt({
            name: 'AES-GCM',
            iv: r,
            additionalData: encode(ad),
        }, await crypto.subtle.importKey('raw', k, {name: 'AES-GCM'}, false, ['encrypt']), encode(m)))];
    },

    async dec(k, c, ad) {
        const [r, cc] = c;
        return decode(await crypto.subtle.decrypt({
            name: 'AES-GCM',
            iv: r,
            additionalData: encode(ad),
        }, await crypto.subtle.importKey('raw', k, {name: 'AES-GCM'}, false, ['decrypt']), cc));
    },
};

export {AES256GCM};

import {getPublicKey, getSharedSecret, Point, utils, CURVE} from 'https://cdn.jsdelivr.net/npm/@noble/ed25519@latest/lib/esm/index.js';
const hexes = Array.from({length: 256}, (_, i) => i.toString(16).padStart(2, '0'));
const bytes_to_hex = bytes => {
    let hex = '';
    for (const x of bytes) {
        hex += hexes[x];
    }
    return hex;
};
const hex_to_bytes = hex => {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; ++i) {
        const j = i * 2;
        const byte = Number.parseInt(hex.slice(j, j + 2), 16);
        bytes[i] = byte;
    }
    return bytes;
};
const bytes_to_int256 = bytes => BigInt('0x' + bytes_to_hex(bytes));
const int256_to_bytes = n => hex_to_bytes(n.toString(16).padStart(64, '0'));

const Curve25519DH = {
    async gen() {
        const sk = utils.randomPrivateKey();
        const pk = await getPublicKey(sk);
        return [sk, pk];
    },

    async eval(sk, pk) {
        return await getSharedSecret(sk, pk);
    },
};

export {Curve25519DH};

const Curve25519CKA = {
    keyLength: 32,

    async init(k) {
        const {scalar, pointBytes: pk} = await utils.getExtendedPublicKey(k);
        const sk = int256_to_bytes(scalar);
        return [sk, pk];
    },

    async send(st) {
        const pk = st;
        const r = crypto.getRandomValues(new Uint8Array(this.keyLength));
        const {scalar: x, pointBytes: c} = await utils.getExtendedPublicKey(r);
        const k = Point.fromHex(pk).multiply(x).toRawBytes();
        const y = utils.hashToPrivateScalar(await utils.sha512(k));
        const stNew = int256_to_bytes(utils.mod(x * y, CURVE.l));
        return [stNew, k, c];
    },

    async recv(st, c) {
        const sk = st;
        const k = Point.fromHex(c).multiply(bytes_to_int256(sk)).toRawBytes();;
        const y = utils.hashToPrivateScalar(await utils.sha512(k));
        const stNew = Point.fromHex(c).multiply(y).toRawBytes();
        return [stNew, k];
    },
};

export {Curve25519CKA};

const Curve25519ACKA = {
    keyLength: 64,

    async init(k) {
        const {scalar: skA, pointBytes: pkA} = await utils.getExtendedPublicKey(k.slice(0, this.keyLength / 2));
        const {scalar: skB, pointBytes: pkB} = await utils.getExtendedPublicKey(k.slice(this.keyLength / 2));
        const stA = {
            skDict: [int256_to_bytes(skA)], pk: pkB,
            parity: 0, t: 0, i: 0, iSk: 0, iPk: 0, l: 0,
        };
        const stB = {
            skDict: [int256_to_bytes(skB)], pk: pkA,
            parity: 1, t: 0, i: 0, iSk: 0, iPk: 0, l: 0,
        };
        return [stA, stB];
    },

    async send(st) {
        let {skDict, pk, parity, t, i, iSk, iPk, l} = st;
        if (t % 2 !== parity) {
            ++t;
            i = 0;
        }
        const r = crypto.getRandomValues(new Uint8Array(this.keyLength / 2));
        const {scalar: x, pointBytes: c} = await utils.getExtendedPublicKey(r);
        const k = Point.fromHex(pk).multiply(x).toRawBytes();
        const y = utils.hashToPrivateScalar(await utils.sha512(k));
        ++iSk;
        skDict[iSk] = int256_to_bytes(utils.mod(x * y, CURVE.l));
        ++i;
        const info = [t, iSk, iPk, l];
        const stNew = {skDict, pk, parity, t, i, iSk, iPk, l};
        return [stNew, k, c, info];
    },

    async recv(st, c, info) {
        let {skDict, pk, parity, t, i, iSk, iPk, l} = st;
        const [tt, iiSk, iiPk, ll] = info;
        if (tt > t) {
            console.assert(tt === t+1, 'ACKA: out of sync', {t, tt});
            // end by ll
            ++t;
            l = i;
        }
        const k = Point.fromHex(c).multiply(bytes_to_int256(skDict[iiPk])).toRawBytes();
        if (iiSk > iPk) {
            iPk = iiSk;
            const y = utils.hashToPrivateScalar(await utils.sha512(k));
            pk = Point.fromHex(c).multiply(y).toRawBytes();
        }
        const stNew = {skDict, pk, parity, t, i, iSk, iPk, l};
        return [stNew, k, [tt, ll]];
    },
};

export {Curve25519ACKA};
