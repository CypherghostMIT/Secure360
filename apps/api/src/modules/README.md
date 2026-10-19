# Feature modules

One folder per feature (`auth`, `incidents`, `users`, …). Each module uses these files, named after the module:

| File                   | Role                                                                          |
| ---------------------- | ----------------------------------------------------------------------------- |
| `<name>.router.ts`     | Routes: path, middleware (auth, role, validation) and the controller handler. |
| `<name>.controller.ts` | HTTP only: read the validated request, call the service, send the DTO.        |
| `<name>.service.ts`    | Business rules. Plain data in, plain data out; never imports Express.         |
| `<name>.repository.ts` | The only place with Prisma calls, always inside the request's `withTenant()`. |
| `<name>.schema.ts`     | Re-exports or composes the Zod schemas from `@secure360/shared`.              |
| `<name>.dto.ts`        | Mappers from database rows to response DTOs (never return a raw row).         |

Layer order: Router → Controller → Service → Repository. The root ESLint configuration enforces it
(a controller or router importing a repository fails `npm run lint`).
