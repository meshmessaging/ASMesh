import {assert} from './utils.js';

class MA {
    constructor(hash, aead, nFut = 1, lambda = 32) {
        this.hash = hash;
        this.aead = aead;
        this.nFut = nFut;
        this.lambda = lambda;
    }

    async hashTri(k) {
        const [kNew, kEnc, _tag] = await this.hash.io([this.lambda, this.aead.keyLength, 4], 'MA', k);
        const tag = new DataView(_tag.buffer, _tag.byteOffset, _tag.byteLength).getInt32(0);
        return [kNew, kEnc, tag];
    }

    recv(st, k) {
        let t = 0, i = 0, l = 0;
        if (st != null) {
            ({t, i, l} = st);
            ++t;
            l = i;
            i = 0;
        }
        const stNew = {t, i, l, k};
        return stNew;
    }

    async update(st, user, k) {
        let kEncDict = new Map(), userDict = new Map();
        if (st != null) {
            ({kEncDict, userDict} = st);
        }
        let tNow = -1, iNow = 0, iNext = 0, kNow = null, kNext;
        if (userDict.has(user)) {
            [tNow, iNow, iNext, kNow, kNext] = userDict.get(user);
            assert(iNext === 0 && kNext === null, 'MA: too many updates', {user, tNow, iNow, iNext, kNow, kNext});
        }
        const tNext = tNow + 1;
        kNext = k;
        for (let j = 0; j < this.nFut; ++j) {
            const [kNew, kEnc, tag] = await this.hashTri(kNext);
            kNext = kNew;
            kEncDict.set(tag, [user, kEnc, tNext, j]);
        }
        iNext = this.nFut;
        userDict.set(user, [tNow, iNow, iNext, kNow, kNext]);
        const stNew = {kEncDict, userDict};
        return stNew;
    }

    async enc(st, info) {
        let {t, i, l, k} = st;
        const [kNew, kEnc, tag] = await this.hashTri(k);
        k = kNew;
        const cc = await this.aead.enc(kEnc, [t, i, l, info], tag);
        const c = [tag, cc];
        ++i;
        const stNew = {t, i, l, k};
        return [stNew, c];
    }

    async dec(st, c) {
        const {kEncDict, userDict} = st;
        const [tag, cc] = c;
        assert(kEncDict.has(tag), 'MA: invalid tag', {tag, kEncDict}); // assume "out-of-order-ness" < nFut; e.g. nFut = 1 requires that every dec is in order
        const [user, kEnc] = kEncDict.get(tag);
        let [tNow, iNow, iNext, kNow, kNext] = userDict.get(user);
        const [t, i, l, info] = await this.aead.dec(kEnc, cc, tag);
        if (t > tNow) {
            assert(t === tNow+1, 'MA: out of sync', {user, tNow, t});
            if (iNow > l) {
                const tagDeleted = [];
                for (const [tag, [ , , tt, ii]] of kEncDict) {
                    if (tt === tNow && ii >= l) {
                        assert(ii < iNow, 'MA: out of range', {user, tNow, t, iNow, l, ii});
                        tagDeleted.push(tag);
                    }
                }
                for (const tag of tagDeleted) {
                    kEncDict.delete(tag);
                }
            } else if (iNow < l) {
                for (let j = iNow; j < l; ++j) {
                    const [kNew, kEnc, tag] = await this.hashTri(kNow);
                    kNow = kNew;
                    kEncDict.set(tag, [user, kEnc, tNow, j]);
                }
                // iNow = l;
            }
            assert(kNext !== null, 'MA: missing update', {user, tNow, t, iNow, iNext, kNow, kNext});
            ++tNow;
            iNow = iNext;
            iNext = 0;
            kNow = kNext;
            kNext = null;
        }
        if (iNow < i+1 + this.nFut) {
            for (let j = iNow; j < i+1 + this.nFut; ++j) {
                const [kNew, kEnc, tag] = await this.hashTri(kNow);
                kNow = kNew;
                kEncDict.set(tag, [user, kEnc, tNow, j]);
            }
            iNow = i+1 + this.nFut;
        }
        userDict.set(user, [tNow, iNow, iNext, kNow, kNext]);
        const stNew = {kEncDict, userDict}; // just `st`
        return [stNew, user, info];
    }
}

export default MA;
