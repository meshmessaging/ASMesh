import {SHA512, AES256GCM, Curve25519DH, Curve25519CKA, Curve25519ACKA} from './crypto.js';

import PKDR from './PKDR.js';
import MA from './MA.js';
import MM from './MM.js';

const mm = new MM(
    SHA512, AES256GCM, Curve25519DH,
    new PKDR(SHA512, Curve25519CKA, Curve25519ACKA),
    new MA(SHA512, AES256GCM, 2),
);

let stA = await mm.gen(), stB = await mm.gen(), stC = await mm.gen(), stD = await mm.gen();
console.log({stA, stB, stC, stD});

[stB, stA] = await mm.initSession(stB, stA);
[stC, stA] = await mm.initSession(stC, stA);
[stD, stA] = await mm.initSession(stD, stA);
console.log('init', {stA, stB, stC, stD});

let cB, tB, iB;
[stB, cB, [tB, iB]] = await mm.enc(stB, stA.pkId, 'hello');
console.log('enc', {cB, tB, iB});

let cC, tC, iC;
[stC, cC, [tC, iC]] = await mm.enc(stC, stA.pkId, 'world');
console.log('enc', {cC, tC, iC});

let cD, tD, iD;
[stD, cD, [tD, iD]] = await mm.pack(stD, stA.pkId, cB, cC);
console.log('re-enc', {cD, tD, iD});

let mAll;
[stA, mAll] = await mm.decAll(stA, cD);
console.log('dec', {mAll, pkB: stB.pkId, pkC: stC.pkId});
