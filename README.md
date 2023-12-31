# ASMesh: Anonymous and Secure Messaging in Mesh Networks

This codebase contains a proof-of-concept implementation of the ASMesh protocol introduced in the paper "ASMesh: Anonymous and Secure Messaging in Mesh Networks Using Stronger, Anonymous Double Ratchet."

## `src/protocol`

Implementation of the protocol as a JavaScript library.

Files:
- `main.js`: measuring performance of the implementation
- `demo.js`: demo showing how to use the library
- other files: library source codes

## `src/meshnet`

Simulation of the protocol in mesh networks.

Files:
- `main.js`: measuring performance in simulated mesh networks
- `index.html`: GUI frontend with similar functionalities to `main.js`
- other files: simulation source codes

## `plot/`

Files:
- `plot.py`, `plot-mem.py`: plotting data in `out/`, generated by `src/meshnet/main.js`
