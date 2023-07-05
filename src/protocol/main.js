#!/usr/bin/env -S deno run --importmap=importmap.json

import {SHA512, AES256GCM, Curve25519DH, Curve25519CKA, Curve25519ACKA} from './crypto.js';

import PKDR from './PKDR.js';
import MA from './MA.js';
import MM from './MM.js';

const mm = new MM(
    SHA512, AES256GCM, Curve25519DH,
    new PKDR(SHA512, Curve25519CKA, Curve25519ACKA),
    new MA(SHA512, AES256GCM, 10),
);

const pingpong = async (N, M) => {
    let stA = await mm.gen(), stB = await mm.gen();
    [stA, stB] = await mm.initSession(stA, stB);

    const m = crypto.getRandomValues(new Uint8Array(M));
    let c, t, i, mAll;
    [stA, c, [t, i]] = await mm.enc(stA, stB.pkId, m);
    [stB, mAll] = await mm.decAll(stB, c);
    console.log({overhead: 32 + 4 + 12 + 60 + 12 + c[2][1].length - M});

    console.time();
    for (const _ of Array(N)) {
        [stA, stB] = [stB, stA];
        [stA, c, [t, i]] = await mm.enc(stA, stB.pkId, m);
        [stB, mAll] = await mm.decAll(stB, c);
    }
    console.timeEnd();
    console.log({N, M});
};

const reenc = async (N, M, D = 10) => {
    let stA = await mm.gen(), stB = await mm.gen();
    [stA, stB] = await mm.initSession(stA, stB);

    const m = crypto.getRandomValues(new Uint8Array(M));
    let c, t, i, mAll;
    [stA, c, [t, i]] = await mm.enc(stA, stB.pkId, m);
    for (const _ of Array(D-1)) {
        [stA, c, [t, i]] = await mm.pack(stA, stB.pkId, c);
        console.log({overhead: 32 + 4 + 12 + 60 + 12 + c[2][1].length - M});
    }
    [stB, mAll] = await mm.decAll(stB, c);

    console.time();
    for (const _ of Array(N)) {
        [stA, stB] = [stB, stA];
        [stA, c, [t, i]] = await mm.enc(stA, stB.pkId, m);
        for (const _ of Array(D-1)) {
            [stA, c, [t, i]] = await mm.pack(stA, stB.pkId, c);
        }
        [stB, mAll] = await mm.decAll(stB, c);
    }
    console.timeEnd();
    console.log({N, M});
};

// await pingpong(100, 1);
// await pingpong(100, 255);
// await pingpong(100, 65535);
// await reenc(100, 1);
// await reenc(100, 255);
