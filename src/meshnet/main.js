#!/usr/bin/env -S deno run

import Network from './Network.js';
import Protocol from './Protocol.js';

const sum = list => list.reduce((s, x) => s + x, 0);
const mean = list => sum(list) / list.length;
const sketch = list => {
    const mean1 = mean(list);
    const mean2 = mean(list.map(x => x ** 2));
    const stddev = Math.sqrt(mean2 - mean1 ** 2);
    const min = list.reduce((s, x) => Math.min(s, x), Infinity);
    const max = list.reduce((s, x) => Math.max(s, x), -Infinity);
    return [mean1, stddev, min, max].map(x => Math.round(x * 1e3) / 1e3);
};

const run = async (options, isEncrypting = true) => {
    Object.assign(options, {
        isEncrypting,
        batch: true, reHop: 'mean', reRep: 'max', updateMeet: true, updateContactsOnly: true,
        graph: 'WS', beta: 0.5,
        send: 'poisson',
        pMove: 1,
        dLink: 1,
    });

    const net = new Network([options.size, options.size], options.number);
    const prot = new Protocol(options.nHop, options.nRep, options.isEncrypting, options.batch, options.reHop, options.reRep, options.updateMeet, options.updateContactsOnly, true);

    const graph = net.getSocialGraph(options.graph, options.pDeg, options.beta);

    const msgIds = await net.run(prot, graph, options.T, options.send, options.pSend, options.pMove, options.dMove, options.dLink);
    const {log} = prot;

    const encsRecvAll = log.recvDetail.map(message => message.encs);
    const encsRecv = new Set(encsRecvAll.flat());

    const r = Math.round(log.recv.size / msgIds.length * 1e3) / 1e3;
    const stat = {
        'Sent': msgIds.length,
        '- Received': log.recv.size,
        '- Delivery rate': r,
        '- Reaching hop limit': msgIds.filter(id => !log.recv.has(id) && log.drop.has(id)).length,
        '- Still on the way': msgIds.filter(id => !log.recv.has(id) && !log.drop.has(id)).length,
        'Hop number': sketch(log.recvDetail.map(message => message.hops.length+1)),
        'Latency': sketch(log.recvDetail.map(message => message.tRecv - message.tSend)),
        'Re-encryption number': log.encs.length,
        '- Number for received': encsRecv.size,
        '- Number per received': sketch(encsRecvAll.map(encs => encs.length)),
        // 'Re-encryption batch size': sketch(log.encs.map(enc => enc.size)),
        // '- Batch size for received': sketch(Array.from(encsRecv, enc => enc.size)),
    };

    console.warn(stat);

    return {r};
};

// table
// await run({size: 25, number:  600, nHop: 10, nRep: 20, pDeg: 0.1, T: 100, pSend: 0.01, dMove:  2});
// await run({size: 25, number:  600, nHop: 10, nRep: 20, pDeg: 0.1, T: 100, pSend: 0.01, dMove:  2}, false);
// await run({size: 25, number: 3000, nHop:  5, nRep:  5, pDeg: 0.1, T: 100, pSend: 0.01, dMove: 10});
// await run({size: 25, number: 3000, nHop:  5, nRep:  5, pDeg: 0.1, T: 100, pSend: 0.01, dMove: 10}, false);
// await run({size: 25, number:  100, nHop: 10, nRep: 25, pDeg: 0.1, T: 100, pSend: 0.01, dMove: 10});
// await run({size: 25, number:  100, nHop: 10, nRep: 25, pDeg: 0.1, T: 100, pSend: 0.01, dMove: 10}, false);

// plots
console.log('[');
const REPEAT = 8;

// for (const nHop of [5,6,7,8,10,12,15]) for (const i of Array(REPEAT).keys()) {
//     console.warn({nHop, i});
//     const {r} = await run({size: 25, number: 600, nHop, nRep: 20, pDeg: 0.1, T: 100, pSend: 0.01, dMove: 2}, false);
//     console.log(JSON.stringify({nHop, r}), ',');
// }

// for (const nRep of [5,10,15,20,25]) for (const i of Array(REPEAT).keys()) {
//     console.warn({nRep, i});
//     const {r} = await run({size: 25, number: 600, nHop: 10, nRep, pDeg: 0.1, T: 100, pSend: 0.01, dMove: 2}, false);
//     console.log(JSON.stringify({nRep, r}), ',');
// }

// for (const pSend of [0.01,0.03,0.05,0.075,0.1]) for (const i of Array(REPEAT).keys()) {
//     console.warn({pSend, i});
//     const {r} = await run({size: 25, number: 600, nHop: 10, nRep: 20, pDeg: 0.1, T: 100, pSend, dMove: 2}, false);
//     console.log(JSON.stringify({pSend, r}), ',');
// }

// for (const dMove of [1,2,3,4,5,6,7,8]) for (const i of Array(REPEAT).keys()) {
//     console.warn({dMove, i});
//     const {r} = await run({size: 25, number: 600, nHop: 10, nRep: 20, pDeg: 0.1, T: 100, pSend: 0.01, dMove}, false);
//     console.log(JSON.stringify({dMove, r}), ',');
// }

console.log('{}]');
