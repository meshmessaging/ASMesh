import json
import numpy as np
import matplotlib.pyplot as plt

def plot(var, label):
    data = json.load(open('out/%s.json' % var))
    key = 't'
    ts = list(set(entry[key] for entry in data if key in entry))
    ts.sort()
    ss = [[entry['s'] for entry in data if key in entry and entry[key] == t] for t in ts]
    mean = np.mean(ss, axis = 1)
    std = np.std(ss, axis = 1)

    plt.semilogy(ts, mean, label = label)
    plt.fill_between(ts, mean - std, mean + std, alpha = 0.125)

_, ax = plt.subplots(tight_layout = True, figsize = (3.2, 2.4))
ax.set_xlabel('Time Step')
ax.set_ylabel('Memory Usage per User')

plot('M1', 'ASMesh 1')
plot('M2', 'ASMesh 2')

plt.legend()
plt.show()
