# cra-payroll

Calculate Canadian payroll deductions using CRA's [Payroll Deductions Online Calculator (PDOC)](https://apps.cra-arc.gc.ca/ebci/rhpd/beta/entry).

Uses Playwright to automate the CRA wizard and return your net pay per pay period.

## Install

```bash
bun install
bun run build
```

This produces a standalone `cra-payroll` binary — no Node or Bun needed to run it.

## Usage

```bash
# Use config.json in current dir (or ~/.cra-payroll.json)
./cra-payroll

# Override with CLI args
./cra-payroll --salary 120000 --province "British Columbia" --cpp-maxed --ei-maxed

# Watch the browser do its thing
./cra-payroll --headed

# Dev mode (no compile step)
bun run dev -- --headed --salary 100000
```

## Config

Create `config.json` or `~/.cra-payroll.json`:

```json
{
  "province": "Ontario",
  "annualSalary": 100000,
  "payPeriod": "Semi-monthly (24 pay periods a year)",
  "rrspEmployeePercent": 4,
  "rrspEmployerPercent": 4,
  "cppMaxedOut": false,
  "eiMaxedOut": false
}
```

### Options

| Option | CLI flag | Config key | Default |
|--------|----------|------------|---------|
| Province | `-p`, `--province` | `province` | `Ontario` |
| Annual salary | `-s`, `--salary` | `annualSalary` | `100000` |
| Pay period | `--pay-period` | `payPeriod` | `Semi-monthly (24 pay periods a year)` |
| Employee RRSP % | `--rrsp-employee` | `rrspEmployeePercent` | `4` |
| Employer RRSP match % | `--rrsp-employer` | `rrspEmployerPercent` | `4` |
| CPP maxed out | `--cpp-maxed` | `cppMaxedOut` | `false` |
| EI maxed out | `--ei-maxed` | `eiMaxedOut` | `false` |
| Show browser | `--headed` | — | `false` |
| Config file path | `-c`, `--config` | — | `./config.json` |

### Pay periods

- `Daily (240 pay periods a year)`
- `Weekly (52 pay periods a year)`
- `Biweekly (26 pay periods a year)`
- `Semi-monthly (24 pay periods a year)`
- `Monthly (12 pay periods a year)`

## How it works

The tool launches a Chromium browser via Playwright and fills out the CRA PDOC wizard:

1. Selects "Salary" calculation type
2. Fills province, pay period, and date
3. Enters salary per period, employer/employee RRSP contributions
4. Sets CPP/EI status (maxed or year-to-date)
5. Hits Calculate and scrapes the result

## License

MIT
