import {assert} from './utils.js';

class MM {
    constructor(hash, aead, nk, pkdr, ma) {
        this.hash = hash;
        this.aead = aead;
        this.nk = nk;
        this.pkdr = pkdr;
        this.ma = ma;
    }

    async toInt(pk) {
        const _int = await this.hash.io(4, 'MMID', pk);
        const int = new DataView(_int.buffer, _int.byteOffset, _int.byteLength).getInt32(0);
        return int;
    }

    async gen() {
        const [skId, pkId] = await this.nk.gen();
        const st = {skId, pkId, stPKDRDict: new Map(), stMASendDict: new Map(), stMARecv: null};
        return st;
    }

    async _enc(pkId, stPKDRDict, stMASendDict, stMARecv, pk, m) {
        const pk_int = await this.toInt(pk);
        assert(stPKDRDict.has(pk_int), 'MM: session not initialized', {pk, stPKDRDict});
        const [stPKDRNew, kMA, kEnc, cPKDR, info, [t, i]] = await this.pkdr.send(stPKDRDict.get(pk_int));
        stPKDRDict.set(pk_int, stPKDRNew);
        if (kMA !== null) {
            stMARecv = await this.ma.update(stMARecv, pk, kMA);
        }
        assert(stMASendDict.has(pk_int), 'MM: session not initialized', {pk, stMASendDict});
        const [stMANew, cMA] = await this.ma.enc(stMASendDict.get(pk_int), info);
        stMASendDict.set(pk_int, stMANew);
        const cAEAD = await this.aead.enc(kEnc, m, [cPKDR, cMA]);
        const c = [cPKDR, cMA, cAEAD];
        return [stPKDRDict, stMASendDict, stMARecv, c, [t, i]];
    }

    async enc(st, pk, m, tagM = 1) {
        let {skId, pkId, stPKDRDict, stMASendDict, stMARecv} = st;
        let c, t, i;
        [stPKDRDict, stMASendDict, stMARecv, c, [t, i]] = await this._enc(pkId, stPKDRDict, stMASendDict, stMARecv, pk, [tagM, m]);
        const stNew = {skId, pkId, stPKDRDict, stMASendDict, stMARecv};
        return [stNew, c, [t, i]];
    }

    // broadcast() { }

    async * _decAll(pkId, stPKDRDict, stMASendDict, stMARecv, c) {
        const [cPKDR, cMA, cAEAD] = c;
        const [stMANew, pk, info] = await this.ma.dec(stMARecv, cMA);
        stMARecv = stMANew;
        const pk_int = await this.toInt(pk);
        assert(stPKDRDict.has(pk_int), 'MM: session not initialized', {pk, stPKDRDict});
        const [stPKDRNew, kMA, kEnc, [t, i]] = await this.pkdr.recv(stPKDRDict.get(pk_int), cPKDR, info);
        stPKDRDict.set(pk_int, stPKDRNew);
        const [tagM, m] = await this.aead.dec(kEnc, cAEAD, [cPKDR, cMA]);
        if (kMA !== null) {
            assert(stMASendDict.has(pk_int), 'MM: session not initialized', {pk, stMASendDict});
            const stMANew = /* await */ this.ma.recv(stMASendDict.get(pk_int), kMA);
            stMASendDict.set(pk_int, stMANew);
        }
        const res = [stPKDRDict, stMASendDict, stMARecv];
        if (tagM === 0) {
            yield [...res, null];
        } else if (tagM === 1) {
            yield [...res, [pk, m, [t, i]]];
        } else if (tagM === 2) {
            for (const c of m) {
                yield * this._decAll(pkId, stPKDRDict, stMASendDict, stMARecv, c);
            }
        } else {
            throw new RangeError(`invalid tag: ${tagM}`);
        }
    }

    async decAll(st, c) {
        let {skId, pkId, stPKDRDict, stMASendDict, stMARecv} = st;
        const res = [];
        let item;
        for await ([stPKDRDict, stMASendDict, stMARecv, item] of this._decAll(pkId, stPKDRDict, stMASendDict, stMARecv, c)) {
            if (item === null) {
                continue;
            }
            res.push(item);
        }
        const stNew = {skId, pkId, stPKDRDict, stMASendDict, stMARecv};
        return [stNew, res];
    }

    async pack(st, pk, ...cList) {
        return await this.enc(st, pk, cList, 2);
    }

    // proc() { }

    async initSession(stA, stB) {
        let {skId: skIdA, pkId: pkIdA, stPKDRDict: stPKDRDictA, stMASendDict: stMASendDictA, stMARecv: stMARecvA} = stA;
        let {skId: skIdB, pkId: pkIdB, stPKDRDict: stPKDRDictB, stMASendDict: stMASendDictB, stMARecv: stMARecvB} = stB;
        const pkIdA_int = await this.toInt(pkIdA);
        const pkIdB_int = await this.toInt(pkIdB);
        const [skEphA, pkEphA] = await this.nk.gen();
        const [skEphB, pkEphB] = await this.nk.gen();
        const kSE = await this.nk.eval(skIdA, pkEphB), _kSE = await this.nk.eval(skEphB, pkIdA);
        // console.debug(kSE, _kSE);
        const kES = await this.nk.eval(skEphA, pkIdB), _kES = await this.nk.eval(skIdB, pkEphA);
        // console.debug(kES, _kES);
        const kEE = await this.nk.eval(skEphA, pkEphB), _kEE = await this.nk.eval(skEphB, pkEphA);
        // console.debug(kEE, _kEE);
        const [kPKDR, kMASendA, kMASendB] = await this.hash.io([this.pkdr.lambda, this.ma.lambda, this.ma.lambda], 'MM', kSE, kES, kEE);
        const [stPKDRA, stPKDRB] = await this.pkdr.init(kPKDR);
        stPKDRDictA.set(pkIdB_int, stPKDRA);
        stPKDRDictB.set(pkIdA_int, stPKDRB);
        assert(!stMASendDictA.has(pkIdB_int), 'MM: repeated init', {pkIdB, stMASendDictA});
        stMASendDictA.set(pkIdB_int, /* await */ this.ma.recv(null, kMASendA));
        stMARecvB = await this.ma.update(stMARecvB, pkIdA, kMASendA);
        assert(!stMASendDictB.has(pkIdA_int), 'MM: repeated init', {pkIdA, stMASendDictB});
        stMASendDictB.set(pkIdA_int, /* await */ this.ma.recv(null, kMASendB));
        stMARecvA = await this.ma.update(stMARecvA, pkIdB, kMASendB);
        const stANew = {skId: skIdA, pkId: pkIdA, stPKDRDict: stPKDRDictA, stMASendDict: stMASendDictA, stMARecv: stMARecvA};
        const stBNew = {skId: skIdB, pkId: pkIdB, stPKDRDict: stPKDRDictB, stMASendDict: stMASendDictB, stMARecv: stMARecvB};
        return [stANew, stBNew];
    }

    async updateSession(st, pk) {
        return await this.enc(st, pk, '', 0);
    }

    // updateGlobal() { }
}

export default MM;
