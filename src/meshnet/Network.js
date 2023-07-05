const range = (size, start = 0) => Array(size).fill(null).map((_, i) => start + i);
const rangeTo = (start, end) => range(end - start, start);
const randInt = (size, start = 0) => start + Math.floor(Math.random() * size);
const randIntTo = (start, end) => randInt(end - start, start);

const shuffle = (list, k = list.length-1) => {
    const l = list.length;
    for (let i = 0; i < k; ++i) {
        const j = randInt(l - i, i);
        const tmp = list[i];
        list[i] = list[j];
        list[j] = tmp;
    }
    return list;
};

const parseSendNumber = (typeSend, pSend) => {
    switch (typeSend) {
        case 'poisson': {
            // inverse transform sampling
            const l = pSend, r = Math.random();
            let n = 0, p = Math.exp(-l), s = p;
            while (r > s) {
                ++n;
                p *= l / n;
                s += p;
            }
            return n;
        } break;
    }
    const n = Math.floor(pSend), p = pSend - n;
    if (Math.random() < p) {
        return n+1;
    } else {
        return n;
    }
};

class Network {
    constructor(size, number) {
        const [row, col] = Array.isArray(size) ? size : [size, size];
        this.row = row;
        this.col = col;
        this.number = number;
        this.field = Array(this.row).fill(null).map((_, row) => Array(this.col).fill(null).map((_, col) => ({row, col, users: new Set()})));
        this.users = Array(this.number).fill(null).map((_, id) => {
            const row = randInt(this.row);
            const col = randInt(this.col);
            const user = {id, row, col, links: new Set()};
            this.field[row][col].users.add(user);
            return user;
        });
        // @Note: empty links; can be viewed as dLink=-1
    }

    relink(dLink) {
        const diffs = new Map();
        for (const user of this.users) {
            const {row, col, links} = user;
            user.links = new Set();
            for (const i of rangeTo(Math.max(row - dLink, 0), Math.min(row + dLink + 1, this.row)))
            for (const j of rangeTo(Math.max(col - dLink, 0), Math.min(col + dLink + 1, this.col))) {
                for (const link of this.field[i][j].users) {
                    if (link === user) {
                        continue;
                    }
                    user.links.add(link);
                }
            }
            const diff = [...user.links].filter(link => !links.has(link));
            diffs.set(user, diff);
        }
        return diffs;
    }

    getSocialGraph(type, ...args) {
        const graph = new Map();
        switch (type) {
            case 'ER': {
                const [p] = args;
                for (const i of range(this.number)) {
                    const neighbors = [];
                    for (const j of range(i)) {
                        if (Math.random() < p) {
                            neighbors.push(j);
                            graph.get(j).push(i);
                        }
                    }
                    graph.set(i, neighbors);
                }
            } break;
            case 'WS': {
                const [p, beta] = args;
                const K = Math.ceil((this.number - 1) * p / 2);
                const perm = shuffle(range(this.number));
                const graphPos = Array(this.number);
                for (const i of range(this.number)) {
                    const neighborsPos = new Set(range(K, 1).map(k => perm[(i + k) % this.number]));
                    graphPos[perm[i]] = neighborsPos;
                    const neighbors = new Set(range(K*2+1, -K).map(k => perm[(i + k + this.number) % this.number]));
                    neighbors.delete(perm[i]);
                    graph.set(perm[i], neighbors);
                }
                for (const i of range(this.number)) {
                    const neighborsPos = graphPos[i];
                    const neighbors = graph.get(i);
                    let count = 0;
                    for (const j of neighborsPos) {
                        if (Math.random() < beta) {
                            ++count;
                            neighbors.delete(j);
                            graph.get(j).delete(i);
                        }
                    }
                    const neighborsNew = shuffle(perm.filter(j => j !== i && !neighbors.has(j)), count).slice(0, count);
                    for (const j of neighborsNew) {
                        neighbors.add(j);
                        graph.get(j).add(i);
                    }
                }
                for (const i of range(this.number)) {
                    graph.set(i, [...graph.get(i)]);
                }
            } break;
        }
        return graph;
    }

    async run(protocol, graph, T, typeSend, pSend, pMove, dMove = 1, dLink = 1, progress = null) {
        if (progress) {
            progress.max = T;
            progress.value = 0;
        }
        const messages = [];
        // 0. init sessions
        for (const [i, edges] of graph) {
            for (const j of edges) {
                protocol.onSession(this.users[i], this.users[j], graph);
            }
        }
        for (const t of range(T)) {
            // 1. generate new message(s)
            let counter = 0;
            for (const user of this.users) for (const _ of range(parseSendNumber(typeSend, pSend))) {
                const id = `${t}-${counter++}`;
                const contacts = graph.get(user.id);
                if (contacts.length === 0) {
                    console.warn('isolated user', user, graph);
                    continue;
                }
                const tt = contacts[randInt(contacts.length)];
                const target = this.users[tt];
                protocol.onSend(t, user, target, id);
                messages.push(id);
            }
            // 1.5. do batching
            protocol.beforeLink(t);
            // 2. move
            for (const user of this.users) if (Math.random() < pMove) {
                const {row, col} = user;
                user.row = randIntTo(Math.max(row - dMove, 0), Math.min(row + dMove + 1, this.row));
                user.col = randIntTo(Math.max(col - dMove, 0), Math.min(col + dMove + 1, this.col));
                // @Warn: possibly move by zero
                this.field[row][col].users.delete(user);
                this.field[user.row][user.col].users.add(user);
            }
            // 3. broadcast to new links
            const diffs = this.relink(dLink);
            for (const [user, diff] of diffs) {
                for (const link of diff) {
                    protocol.onSession(user, link, graph);
                }
            }
            const pending = true; // @Warn: simultaneous exchange instead of new links one by one
            for (const user of shuffle(this.users.slice())) {
                protocol.onLink(t, user, shuffle([...user.links]), pending);
            }

            if (progress) {
                progress.value = t+1;
            } else {
                const m = messages.length, M = Array.from(protocol.userMessages.values(), msgs => msgs.size).reduce((s, x) => s + x, 0);
                if (t % Math.round(T / 50) === 0) {
                    const r = Math.round(protocol.log.recv.size / m * 1e3) / 1e3;
                    const F = Array.from(protocol.userFilter.values(), filter => filter.size).reduce((s, x) => s + x, 0);
                    const EF = Array.from(protocol.userEncFilter.values(), filter => filter.size).reduce((s, x) => s + x, 0);
                    const S = M + F + EF;
                    console.warn(JSON.stringify({t, m, r, M, F, EF, S, s: S / this.number}), ',');
                }
            }
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        return messages;
    }
}

export default Network;
