# Observability

## MVP

The application is locally observable through:

- structured process events;
- run state;
- exit codes;
- PID;
- memory / CPU snapshots;
- local debug logs during development.

No remote telemetry is part of the initial product.

## Future

An explicit opt-in telemetry model may capture only aggregated application reliability signals. Environment values, command contents and repository paths must never be collected by default.
