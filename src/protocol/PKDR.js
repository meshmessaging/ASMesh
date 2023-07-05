import {assert} from './utils.js';

class PKDR {
    constructor(hash, cka, acka, lambda = 32) {
        this.hash = hash;
        this.cka = cka;
        this.acka = acka;
        this.lambda = lambda;
    }

    async init(k) {
        const [kRoot, kChain, kCKA, kACKA] = await this.hash.io([this.lambda, this.lambda, this.cka.keyLength, this.acka.keyLength], 'PKDR0', k);
        const [stA_CKA, stB_CKA] = await this.cka.init(kCKA);
        const [stA_ACKA, stB_ACKA] = await this.acka.init(kACKA);
        const stA = {
            kRoot, kChainDict: [kChain], kSeedDict: [null],
            stCKA: stA_CKA, cCKA: '', stACKA: stA_ACKA,
            parity: 0, t: 0, iSend: 0, iRecvDict: [null],
        };
        const stB = {
            kRoot, kChainDict: [kChain], kSeedDict: [[]],
            stCKA: stB_CKA, cCKA: '', stACKA: stB_ACKA,
            parity: 1, t: 0, iSend: null, iRecvDict: [0],
        };
        return [stA, stB];
    }

    async send(st) {
        let {kRoot, kChainDict, kSeedDict, stCKA, cCKA, stACKA, parity, t, iSend, iRecvDict} = st;
        let sCKA = null;
        if (t % 2 !== parity) {
            ++t;
            [stCKA, sCKA, cCKA] = await this.cka.send(stCKA);
            const [kRootNew, kChain] = await this.hash.io([this.lambda, this.lambda], 'PKDR1', kRoot, sCKA);
            kRoot = kRootNew;
            kChainDict[t] = kChain;
            kSeedDict[t] = null;
            iSend = 0;
            iRecvDict[t] = null;
        }
        const [kChainNew, kSeed] = await this.hash.io([this.lambda, this.lambda], 'PKDR2', kChainDict[t]);
        kChainDict[t] = kChainNew;
        const [stACKANew, sACKA, cACKA, infoACKA] = await this.acka.send(stACKA);
        stACKA = stACKANew;
        const c = [cACKA];
        const info = [infoACKA, iSend, cCKA];
        const k = await this.hash.io(this.lambda, 'PKDR3', kSeed, sACKA, ...c, ...info);
        ++iSend;
        const stNew = {kRoot, kChainDict, kSeedDict, stCKA, cCKA, stACKA, parity, t, iSend, iRecvDict};
        return [stNew, sCKA, k, c, info, [t, iSend-1]];
    }

    async recv(st, c, info) {
        let {kRoot, kChainDict, kSeedDict, stCKA, cCKA, stACKA, parity, t, iSend, iRecvDict} = st;
        const [cACKA] = c;
        const [infoACKA, i, cCKANew] = info;
        const [stACKANew, sACKA, [tt, ll]] = await this.acka.recv(stACKA, cACKA, infoACKA);
        stACKA = stACKANew;
        let sCKA = null;
        if (tt > t) {
            assert(tt === t+1, 'PKDR: out of sync', {t, tt});
            kChainDict[t] = null;
            if (t > 0) {
                assert(kSeedDict[t-1].length <= ll, 'PKDR: chain too long', {l: kSeedDict[t-1].length, ll, dict: kSeedDict[t-1]});
                kSeedDict[t-1].lengthMax = ll;
            }
            ++t;
            [stCKA, sCKA] = await this.cka.recv(stCKA, cCKANew);
            const [kRootNew, kChain] = await this.hash.io([this.lambda, this.lambda], 'PKDR1', kRoot, sCKA);
            kRoot = kRootNew;
            kChainDict[t] = kChain;
            kSeedDict[t] = [];
            iSend = null;
            iRecvDict[t] = 0;
        }
        assert(!(i >= kSeedDict[tt].lengthMax), 'PKDR: out of range', {i, l: kSeedDict[tt].length, ll: kSeedDict[tt].lengthMax, dict: kSeedDict[t-1]});
        let kSeed = kSeedDict[tt][i];
        kSeedDict[tt][i] = null;
        if (kSeed == null && i < iRecvDict[tt]) {
            return null;
        } else if (kSeed == null && i >= iRecvDict[tt]) {
            let kChain = kChainDict[tt];
            for (let j = iRecvDict[tt]; j <= i; ++j) {
                [kChain, kSeed] = await this.hash.io([this.lambda, this.lambda], 'PKDR2', kChain);
                kSeedDict[tt][j] = j < i ? kSeed : null;
            }
            kChainDict[tt] = kChain;
            iRecvDict[tt] = i+1;
            if (i+1 === kSeedDict[tt].lengthMax) {
                kChainDict[tt] = null;
            }
        }
        const k = await this.hash.io(this.lambda, 'PKDR3', kSeed, sACKA, ...c, ...info);
        const stNew = {kRoot, kChainDict, kSeedDict, stCKA, cCKA, stACKA, parity, t, iSend, iRecvDict};
        return [stNew, sCKA, k, [tt, i]];
    }
}

export default PKDR;
