# @sphere/event-store

Event store abstractions for Sphere event chains.

The first implementation is an in-memory store intended for reference-node tests and adapter development. It verifies batches before appending and enforces that new batches continue the stored chain tip.
