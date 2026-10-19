# Platform

Cross-cutting infrastructure shared by the feature modules (L2 §5). Modules depend on platform, never the reverse.

| Folder           | Content                                                                          |
| ---------------- | -------------------------------------------------------------------------------- |
| `db/`            | Prisma client and `withTenant()` (sets `app.org_id`, `app.user_id`, `app.role`). |
| `crypto/`        | AES-256-GCM for data at rest, token hashing, random identifiers.                 |
| `cache/`         | Redis client and helpers.                                                        |
| `outbox/`        | Transactional outbox and its BullMQ publisher.                                   |
| `audit/`         | Fire-and-forget audit events (`noun.verb.outcome`).                              |
| `observability/` | Pino logger, request id, metrics.                                                |
