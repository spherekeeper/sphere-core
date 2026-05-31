# Legacy Sources

The initial Sphere Core implementation is informed by earlier Sphere prototypes:

- a legacy Discord bot/runtime;
- an earlier graph-service prototype;
- an earlier web-app prototype.

Use these as source material for concepts and tests, not as code to blindly copy.

## Extraction stance

Keep:

- entity/connection/identity/event primitives;
- hash-chain event verification;
- event stream and reconciliation lessons;
- trust/vouch/circle concepts.

Translate:

- `connection` to canonical protocol `edge` where useful;
- Discord roles/channels/categories into adapter projection state;
- bot commands into app/governance workflows.

Avoid:

- copying bot-local `db.js` structure;
- embedding Discord-specific assumptions into core;
- importing real private user/member data.
