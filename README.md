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

# Remove macOS quarantine flag (unsigned binary)
xattr -d com.apple.quarantine cra-payroll

sudo mv cra-payroll /usr/local/bin/
```

> **Requires Google Chrome** — uses your system Chrome, no extra browser install needed.

Or use the one-liner:

```bash
curl -fsSL https://raw.githubusercontent.com/SeeThruHead/cra-payroll/main/install.sh | bash
```

## Usage

```bash
# Interactive — prompts for missing values
cra-payroll

# CLI args
cra-payroll --salary 120000 --province "British Columbia"

# Per-paycheck table for the year (tracks CPP/EI maxout)
cra-payroll --salary 150000 --table

# Annual totals
cra-payroll --salary 100000 --annual

# Monthly averages
cra-payroll --salary 100000 --monthly

# Combine them
cra-payroll --salary 150000 --table --annual --monthly

# Verbose logging
cra-payroll -v --salary 100000

# Check version
cra-payroll --version

# Self-update to latest release
cra-payroll --update
```

### Example output (`--table`)

```
📊 Per-Paycheck Table (2026)
══════════════════════════════════════════════════════════════════════════════════════════════
  #  │     Gross │   Fed Tax │  Prov Tax │       CPP │        EI │   Net Pay │ Cum CPP/EI
──────────────────────────────────────────────────────────────────────────────────────────────
  1  │  6,250.00 │  1,028.37 │    612.45 │    382.51 │    102.08 │  4,124.59 │    484.59
  2  │  6,250.00 │  1,028.37 │    612.45 │    382.51 │    102.08 │  4,124.59 │    969.18
 ... │       ... │       ... │       ... │       ... │       ... │       ... │       ...
 11  │  6,250.00 │  1,028.37 │    612.45 │    112.50 │     19.37 │  4,477.31 │  5,353.52 ← partial
 12  │  6,250.00 │  1,028.37 │    612.45 │      0.00 │      0.00 │  4,609.18 │  5,353.52 ✓ maxed
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
| Self-update | `--update` | — | — |
| Show version | `--version` | — | — |
| Headless | `--headless` | — | `false` |
| Config path | `-c`, `--config` | — | — |

### 2026 CPP/EI Maximums (used for `--table`)

| | Amount |
|---|---|
| CPP max contribution | $4,230.45 |
| CPP2 max (additional) | $416.00 |
| EI max premium | $1,123.07 |

## Run from source

If you'd rather not download a binary, you can clone and run directly. You'll need [Google Chrome](https://www.google.com/chrome/) installed.

### With Bun

```bash
git clone https://github.com/SeeThruHead/cra-payroll.git
cd cra-payroll
bun install
bun run dev -- --salary 100000
bun run dev -- --salary 150000 --table
```

### With Node

```bash
git clone https://github.com/SeeThruHead/cra-payroll.git
cd cra-payroll
npm install
npx tsx src/cli.ts --salary 100000
npx tsx src/cli.ts --salary 150000 --table
```

## Development

```bash
# Run directly
bun run dev -- --salary 100000

# Build standalone binary
bun run build

# Unit tests (fast, no browser)
bun test

# Integration tests (hits CRA, needs Chrome, may be flaky)
bun run test:integration

# All tests
bun run test:all
```

## How it works

1. Launches your system Chrome via Puppeteer (headed by default — CRA blocks headless)
2. Fills out the PDOC wizard: province, pay period, salary, RRSP contributions
3. Sets CPP/EI status and hits Calculate
4. Scrapes the results page for taxes, deductions, and net pay
5. For `--table` mode: runs twice (with/without CPP/EI) and simulates each paycheck using the 2026 maximums

## License

MIT
