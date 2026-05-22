# Hash-Chain Test Vectors

Fixtures for ordered Sphere event hash-chain verification.

- `valid-basic-chain.json` — two linked events with valid hashes, sequence, chain ID, and previous hash.
- `invalid-broken-previous-hash.json` — second event is internally hashed but points at the wrong previous hash.
