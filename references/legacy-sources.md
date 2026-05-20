# Legacy Sources

The initial Sphere Core implementation is informed by existing prototypes:

```text
/data/tenants/sphere/discord-infrastructure/sphere-system
/data/tenants/sphere/web3-infrastructure/alpha_v0.1_firstprototype/sphere-graph
/data/tenants/sphere/web3-infrastructure/alpha_v0.1_firstprototype/sphere-web
```

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
