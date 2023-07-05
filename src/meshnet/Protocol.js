const assert = (cond, ...msg) => {
    if (cond) {
        return;
    }
    console.error(...msg);
    throw new Error(msg[0]);
};

class DefaultMap extends Map {
    constructor(def) {
        super();
        this.def = def;
    }
    get(key) {
        if (this.has(key)) {
            return super.get(key);
        }
        const value = this.def(key);
        this.set(key, value);
        return value;
    }
}

const reducer = {
    max: list => list.reduce((s, x) => Math.min(s, x), Infinity),
    mean: list => list.reduce((s, x) => s + x, 0) / list.length,
    min: list => list.reduce((s, x) => Math.max(s, x), -Infinity),
    // @Note: swapped max and min due to counting consumed part
};

const split = function * (limit, ...lists) {
    const listRef = lists[0];
    if (listRef.length <= limit) {
        yield lists;
    }
    for (let start = 0; start < listRef.length; start += limit) {
        const size = Math.min(limit, listRef.length - start);
        yield lists.map(list => list.slice(start, start + size));
    }
};

const purge = (t, dict) => {
    const stale = new Set();
    for (const [id, tt] of dict) {
        if (tt <= t) {
            stale.add(id);
        }
    }
    for (const id of stale) {
        dict.delete(id);
    }
};

class Protocol {
    constructor(nHop, nRep, isEncrypting, useBatch, encHop, encRep, isUpdatingMeet, isContactsOnly, SAVE_MEMORY = false) {
        this.nHop = nHop;
        this.nRep = nRep;
        this.isEncrypting = isEncrypting;
        this.maxBatch = useBatch ? Infinity : 1;
        this.getEncHop = reducer[encHop];
        this.getEncRep = reducer[encRep];
        this.isUpdatingMeet = isUpdatingMeet;
        this.isContactsOnly = isContactsOnly;

        this.SAVE_MEMORY = SAVE_MEMORY;
        this.GLOBAL_COUNTER = 0;
        this.FILTER_MAX_AGE = nHop;

        this.userSessions = new DefaultMap(_ => new Map());
        this.userMessages = new DefaultMap(_ => new Map());
        this.userPendingMessages = new DefaultMap(_ => new Map());
        this.userFilter = new DefaultMap(_ => new Map());
        this.userEncFilter = new DefaultMap(_ => new Set());
        this.userRecvFilter = new DefaultMap(_ => new Set());
        this.log = {recv: new Set(), recvDetail: [], drop: new Set(), encs: []};
    }

    store(t, user, id, entry) {
        const messages = this.userMessages.get(user);
        const filter = this.userFilter.get(user);
        if (!messages.has(id) && !filter.has(id)) {
            messages.set(id, entry);
            filter.set(id, t);
        } else if (messages.has(id)) {
            messages.get(id).from.push(...entry.from);
        }
    }

    onSend(t, user, target, id) {
        const message = {id, type: 'plain', source: user, target, timestamp: t-1};
        const entry = {message, from: [], hops: [], rep: 0};
        this.store(t, user, id, entry);
        const session = this.userSessions.get(user);
        const encFilter = this.userEncFilter.get(user);
        assert(session.has(target), 'non-session target', {user, target, session, t});
        if (session.get(target) % 2) {
            session.set(target, session.get(target) + 1);
            encFilter.clear();
        }
        encFilter.add(id);
    }

    dec(t, message, hops, encs = []) {
        const recvFilter = this.userRecvFilter.get(message.target);
        if (recvFilter.has(message.id)) {
            return;
        }
        if (message.size > 1e2) { // save memory
            recvFilter.add(message.id);
        }
        const {source, target} = message;
        const session = this.userSessions.get(target);
        assert(session.has(source), 'non-session source', {target, session, source, t});
        if (!(session.get(source) % 2)) {
            session.set(source, session.get(source) + 1);
        }
        if (message.type === 'batch') {
            for (const {message: messageChild, hops: hopsChild} of message.batch) {
                const hopsConcat = hopsChild.slice();
                for (const i of Object.keys(hops).map(Number).sort((a, b) => a - b)) { // @Note: `hops` is sparse
                    hopsConcat.push(hops[i]);
                }
                this.dec(t, messageChild, hopsConcat, [message].concat(encs));
            }
            return;
        }
        const {id} = message;
        if (this.log.recv.has(id)) {
            return;
        }
        this.log.recv.add(id);
        if (this.SAVE_MEMORY) {
            this.log.recvDetail.push({tSend: message.timestamp, tRecv: t, hops: {length: hops.length}, encs: {length: encs.length}});
        } else {
            this.log.recvDetail.push({...message, tSend: message.timestamp, tRecv: t, hops, encs});
        }
    }

    cast(t, user, link, id, messages = this.userMessages.get(user), pending = false) {
        const entry = messages.get(id);
        const {message, from, hops, rep} = entry;
        if (from.includes(link)) { // @Note: avoid ping-pong, saving for `nRep`
            return;
        }
        if (rep + 1 > this.nRep) {
            messages.delete(id);
        } else {
            entry.rep += 1;
        }
        if (link === message.target) {
            return this.dec(t, message, hops);
        }
        if (hops.length + 1 > this.nHop) {
            messages.delete(id);
            this.log.drop.add(id);
            return;
        }
        const entryHop = {message, from: [user], hops: hops.concat(link), rep: 0};
        if (pending) {
            const messagesPending = this.userPendingMessages.get(link);
            if (!messagesPending.has(id)) {
                messagesPending.set(id, entryHop);
            }
            return;
        }
        this.store(t, link, id, entryHop);
    }

    onSession(user, link, graph) {
        if (this.isContactsOnly && !graph.get(link.id).includes(user.id)) {
            return;
        }
        const session = this.userSessions.get(user);
        const sessionLink = this.userSessions.get(link);
        if (!sessionLink.has(user)) {
            assert(!session.has(link), 'repeated session init', {user, link});
            session.set(link, 0);
        } else {
            if (session.has(link)) {
                if (this.isUpdatingMeet) {
                    session.set(link, session.get(link) + 2);
                }
            } else {
                session.set(link, 1);
            }
        }
    }

    beforeLink(t) {
        // process pending messages
        this.afterLink(t);
        // do batching
        for (const user of this.userMessages.keys()) {
            this.beforeLinkUser(t, user);
        }
    }

    beforeLinkUser(t, user) {
        const messages = this.userMessages.get(user);
        const sessions = this.userSessions.get(user);
        const filter = this.userFilter.get(user);
        const encFilter = this.userEncFilter.get(user);
        const messagesBatched = new Map();
        const targets = new DefaultMap(_ => ({batch: [], from: [], hop: [], rep: []}));
        if (this.isEncrypting)
        for (const [id, {message, from, hops, rep}] of messages) {
            const {target} = message;
            const isSendSession = !(sessions.get(target) % 2);
            if (sessions.has(target) && !(isSendSession && encFilter.has(id))) { // @Note: avoid repeated re-encryptions
                const entry = targets.get(target);
                entry.batch.push({message, hops});
                entry.from.push(...from); // @Note: avoid ping-pong re-encryptions
                entry.hop.push(hops.length);
                entry.rep.push(rep);
            } else {
                messagesBatched.set(id, {message, from, hops, rep});
            }
        }
        if (targets.size > 0) {
            for (const [target, {batch: batchAll, from: fromAll, hop: hopAll, rep: repAll}] of targets)
            for (const [batch, from, hop, rep] of split(this.maxBatch, batchAll, fromAll, hopAll, repAll)) {
                const id = this.SAVE_MEMORY ? `${user.id}:G${this.GLOBAL_COUNTER++}` : `${user.id}:[${batch.map(({message}) => message.id).sort()}]`;
                const size = batch.reduce((s, {message}) => s + (message.size ?? 1), 0);
                const message = {id, type: 'batch', batch, size, source: user, target, timestamp: t};
                messagesBatched.set(id, {message, from, hops: Array(Math.round(this.getEncHop(hop))), rep: this.getEncRep(rep)});
                filter.set(id, t);
                const session = this.userSessions.get(user);
                assert(session.has(target), 'non-session target for encryption', {user, target, session, batch, t});
                if (session.get(target) % 2) {
                    session.set(target, session.get(target) + 1);
                    encFilter.clear();
                }
                for (const {message: {id}} of batch) {
                    encFilter.add(id);
                }
                encFilter.add(id);
                if (!this.SAVE_MEMORY) {
                    this.log.encs.push(message);
                }
            }
            this.userMessages.set(user, messagesBatched);
        }
        purge(t - this.FILTER_MAX_AGE, filter);
    }

    onLink(t, user, links, pending = false) {
        const messages = this.userMessages.get(user);
        for (const link of links) {
            for (const id of [...messages.keys()]) { // @Note: delete during iteration
                this.cast(t, user, link, id, messages, pending);
            }
        }
    }

    afterLink(t) {
        for (const [user, messages] of this.userPendingMessages) {
            for (const [id, entry] of messages) {
                this.store(t, user, id, entry);
            }
        }
        this.userPendingMessages.clear();
    }
}

export default Protocol;
