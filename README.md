# cra-payroll

Calculate Canadian payroll deductions using CRA's [Payroll Deductions Online Calculator (PDOC)](https://apps.cra-arc.gc.ca/ebci/rhpd/beta/entry).

Automates the CRA wizard via Playwright and returns your net pay, taxes, CPP, EI, and RRSP breakdown — per paycheck, monthly, or annually.

## Download

Grab the latest binary for your platform from [**Releases**](https://github.com/SeeThruHead/cra-payroll/releases):

| Platform | File |
|----------|------|
| macOS (Apple Silicon) | `cra-payroll-darwin-arm64` |
| macOS (Intel) | `cra-payroll-darwin-x64` |
| Linux (x64) | `cra-payroll-linux-x64` |

```bash
# Example: macOS Apple Silicon
curl -L -o cra-payroll https://github.com/SeeThruHead/cra-payroll/releases/latest/download/cra-payroll-darwin-arm64
chmod +x cra-payroll
sudo mv cra-payroll /usr/local/bin/

# Install Chromium (required)
npx playwright install chromium
```

## Usage

```bash
# Interactive — prompts for missing values
cra-payroll

# CLI args
cra-payroll --salary 120000 --province "British Columbia"

# Per-paycheck table for the year (tracks CPP/EI maxout)
cra-payroll --salary 263000 --table

# Annual totals
cra-payroll --salary 100000 --annual

# Monthly averages
cra-payroll --salary 100000 --monthly

# Combine them
cra-payroll --salary 263000 --table --annual --monthly

# Verbose logging
cra-payroll -v --salary 100000
```

### Example output (`--table`)

```
📊 Per-Paycheck Table (2026)
══════════════════════════════════════════════════════════════════════════════════════════════
  #  │     Gross │   Fed Tax │  Prov Tax │       CPP │        EI │   Net Pay │ Cum CPP/EI
──────────────────────────────────────────────────────────────────────────────────────────────
  1  │ 10,958.33 │  2,232.82 │  1,431.13 │    669.42 │    178.62 │  6,446.34 │    848.04
  2  │ 10,958.33 │  2,232.82 │  1,431.13 │    669.42 │    178.62 │  6,446.34 │  1,696.08
 ... │       ... │       ... │       ... │       ... │       ... │       ... │       ...
  7  │ 10,958.33 │  2,232.82 │  1,431.13 │    213.93 │     51.35 │  7,029.10 │  5,353.52 ← partial
  8  │ 10,958.33 │  2,232.82 │  1,431.13 │      0.00 │      0.00 │  7,294.38 │  5,353.52 ✓ maxed
 ... │       ... │       ... │       ... │       ... │       ... │       ... │       ...
```

## Config

Config is loaded from the first file found:
1. `--config <path>`
2. `./config.json`
3. `~/.config/cra-payroll.json`
4. `~/.cra-payroll.json`

CLI args override config file values. Missing values are prompted interactively.

```json
{
  "province": "Ontario",
  "annualSalary": 100000,
  "payPeriod": "Semi-monthly (24 pay periods a year)",
  "rrspEmployeePercent": 4,
  "rrspEmployerPercent": 4
}
```

### Options

| Option | CLI flag | Config key | Default |
|--------|----------|------------|---------|
| Province | `-p`, `--province` | `province` | `Ontario` |
| Annual salary | `-s`, `--salary` | `annualSalary` | _(prompted)_ |
| Pay period | `--pay-period` | `payPeriod` | `Semi-monthly (24)` |
| Employee RRSP % | `--rrsp-employee` | `rrspEmployeePercent` | `4` |
| Employer RRSP % | `--rrsp-employer` | `rrspEmployerPercent` | `4` |
| CPP maxed | `--cpp-maxed` | `cppMaxedOut` | `false` |
| EI maxed | `--ei-maxed` | `eiMaxedOut` | `false` |
| Yearly table | `-t`, `--table` | — | `false` |
| Annual totals | `-a`, `--annual` | — | `false` |
| Monthly averages | `-m`, `--monthly` | — | `false` |
| Verbose | `-v`, `--verbose` | — | `false` |
| Headless | `--headless` | — | `false` |
| Config path | `-c`, `--config` | — | — |

### 2026 CPP/EI Maximums (used for `--table`)

| | Amount |
|---|---|
| CPP max contribution | $4,230.45 |
| CPP2 max (additional) | $416.00 |
| EI max premium | $1,123.07 |

## Local Development

```bash
# Requires Bun (https://bun.sh)
bun install
npx playwright install chromium

# Run directly
bun run dev -- --salary 100000

# Build standalone binary
bun run build

# Run tests (hits CRA — may be flaky)
bun test --max-concurrency 1
```

## How it works

1. Launches Chromium via Playwright (headed by default — CRA blocks headless)
2. Fills out the PDOC wizard: province, pay period, salary, RRSP contributions
3. Sets CPP/EI status and hits Calculate
4. Scrapes the results page for taxes, deductions, and net pay
5. For `--table` mode: runs twice (with/without CPP/EI) and simulates each paycheck using the 2026 maximums

## License

MIT
