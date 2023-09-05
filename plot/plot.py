import json
import numpy as np
import matplotlib.pyplot as plt

# avoid Type 3 font
plt.rcParams['ps.fonttype'] = 42
plt.rcParams['pdf.fonttype'] = 42

def plot(var, key, label = None):
    data = json.load(open('out/%s.json' % var))
    ks = list(set(entry[key] for entry in data if key in entry))
    ks.sort()
    rs = [[entry['r'] for entry in data if key in entry and entry[key] == k] for k in ks]
    mean = np.mean(rs, axis = 1)
    std = np.std(rs, axis = 1)

    _, ax = plt.subplots(tight_layout = True, figsize = (3.2, 2.4))
    plt.plot(ks, mean)
    plt.fill_between(ks, mean - std, mean + std, alpha = 0.125)
    if label == None:
        label = var
    ax.set_xlabel(label)
    ax.set_ylabel('Delivery Rate')

plot('pt', 'nHop')
plot('nd', 'nRep')
plot('l', 'pSend', 'λ')
plot('r', 'dMove')

plt.show()
