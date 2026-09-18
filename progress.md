# SI-PANDU POLRI Development Progress

## 2026-09-17
- Fixed duplicate DB index & column initialization errors in `server.ts`. Wrapped `ALTER TABLE` operations inside a `safeAlterQuery` helper function to cleanly catch and ignore `ER_DUP_KEYNAME` / `errno: 1061` and `ER_DUP_FIELDNAME` / `errno: 1060` errors during `initializeDatabase()` execution.
