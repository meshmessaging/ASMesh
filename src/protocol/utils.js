const assert = (cond, ...msg) => {
    if (cond) {
        return;
    }
    console.error(...msg);
    throw new Error(msg[0]);
};

export {assert};
