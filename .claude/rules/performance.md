# Performance

## Parse Time Budgets

- <5MB: <1s | 10MB: <3s | 20MB+: <5s

## Rules

- No sync ops >50ms blocking extension host
- Progress indicators for ops >100ms
- Test with large logs from sample-app/
