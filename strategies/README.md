# strategies/

Mirror of the strategy lifecycle (the database is the source of truth). Regenerate with
`pnpm strategies:export`; each version is written as `<stage-folder>/<VERSION-ID>.json`:

| Folder | Stages |
|---|---|
| research/ | IDEA, RESEARCH, BACKTESTED, VALIDATING |
| incubating/ | INCUBATING |
| paper/ | PAPER, DEGRADED |
| approved/ | APPROVED |
| live/ | LIVE |
| retired/ | RETIRED |

Records are immutable: changes always create a new version (`…-v2`).
