# Vendored TradingAgents

`vendor/TradingAgents/` is a snapshot copy of
`C:\Users\fuyuh\projects\TradingAgents` (excluding `.git`, `.venv`, caches, and
any `.env*` files).

## Why vendored

Local dev used `tradingagents = { path = "../../TradingAgents", editable = true }`
in `backend/pyproject.toml` — fast iteration when both repos were checked out
side-by-side. For Docker builds the image needs to be self-contained, so we
vendor a snapshot here and the path-dep points at this directory.

## Refreshing

When upstream TradingAgents has changes worth pulling in:

```powershell
cd backend
robocopy C:\Users\fuyuh\projects\TradingAgents vendor\TradingAgents `
    /MIR /XD .git .venv __pycache__ logs cache `
    .pytest_cache .mypy_cache node_modules `
    /XF *.pyc .env .env.enterprise.example
```

Then commit. `/MIR` mirrors deletes too — anything removed upstream is
removed here.

⚠️ Always re-check that no `.env` file slipped in:

```powershell
Get-ChildItem vendor\TradingAgents -Recurse -Filter ".env*" -Force
# should print only `.env.example`
```
