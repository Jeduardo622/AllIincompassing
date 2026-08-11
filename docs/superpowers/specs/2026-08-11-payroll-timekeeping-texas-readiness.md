# Texas Payroll Timekeeping Readiness

## Status

- Research snapshot: 2026-08-11
- Activation: inactive
- Relationship: extension of `2026-08-11-payroll-grade-timekeeping-design.md`
- Purpose: document future Texas policy requirements and implementation gaps

This document is engineering research, not legal advice. Re-verify all sources and obtain qualified payroll/legal review before activation.

## Official Sources

- [Texas Payday Law overview](https://www.twc.texas.gov/programs/wage-and-hour/texas-payday-law)
- [Texas Workforce Commission hours-worked guidance](https://efte.twc.texas.gov/hours_general.html)
- [Texas Workforce Commission recordkeeping guidance](https://efte.twc.texas.gov/recordkeeping_general.html)
- [Texas unemployment-tax payroll record requirements](https://www.twc.texas.gov/programs/unemployment-tax/responsibilities-liable-employer)
- [Texas pay-frequency guidance](https://efte.twc.texas.gov/frequency_of_pay.html)
- [Federal FLSA recordkeeping](https://www.dol.gov/agencies/whd/fact-sheets/21-flsa-recordkeeping)
- [Federal FLSA hours worked](https://www.dol.gov/agencies/whd/fact-sheets/22-flsa-hours-worked)

## Preliminary Rule Map

### Hours and overtime

- Texas generally uses the federal FLSA hours-worked and overtime framework for the in-scope ordinary nonexempt population.
- The baseline overtime rule is time and one-half after 40 hours in a fixed seven-day workweek.
- Texas does not add California-style daily overtime or double-time rules for the ordinary population.
- Specialized federal exceptions, including a valid health-care 8/80 arrangement, are outside the baseline and require separate activation.

### Breaks

- Texas does not generally require adult meal or rest breaks.
- When short breaks are provided, federal compensability rules apply.
- A bona fide unpaid meal requires the employee to be fully relieved of duty.
- The product should retain manual meal punches and never auto-deduct, even though the California timing/premium policy would be inactive.

### Pay frequency

- Nonexempt employees must generally be paid at least twice per month on scheduled paydays.
- Weekly and biweekly pay groups can be supported when payday timing is compliant.
- A monthly pay group must be rejected for the in-scope Texas nonexempt employee population unless a qualified reviewer confirms a specific lawful exception.
- Pay-period cadence remains separate from the fixed FLSA workweek used for overtime.

### Recordkeeping

- Preserve employee identity, pay basis/rate, workweek, daily and weekly hours, straight-time earnings, overtime, additions/deductions, wages, pay periods, and payment dates as applicable.
- Texas unemployment-tax guidance requires covered employers to retain specified employment/payroll records for four years.
- The shared four-year minimum retention design is suitable as a baseline, subject to longer organizational or litigation-hold requirements.

### Wage payment and corrections

- Wages must be paid in full, on time, and on scheduled paydays.
- Timekeeping policy cannot erase compensation for work the employer suffered or permitted.
- Append-only corrections, adjustment exports, and reconstruction from source events remain required product controls.

## Policy Interface Mapping

Future Texas activation should configure:

- `jurisdiction_code = US-TX`
- weekly overtime threshold of 40 hours
- daily overtime disabled for the ordinary population
- double time disabled for the ordinary population
- seventh-day premium disabled for the ordinary population
- state meal timing/premium rules disabled
- federal short-break and bona fide meal compensability enabled
- nonexempt monthly pay-group assignment blocked
- four-year baseline retention enabled

Values above are design inputs, not production configuration, until legally reviewed and implemented.

## Required Future Work

- confirm the employee population and applicable industry exceptions
- verify current Texas Payday Law and TWC rules immediately before implementation
- define Texas payday validation and termination-pay handling boundaries with the external payroll provider
- add Texas policy fixtures and golden earnings cases
- add pay-group validation tests for at-least-twice-monthly payment
- verify employee record-access and wage-statement requirements for the intended export/provider workflow
- run security, Supabase, payroll-domain, and legal/operations review

## Activation Gate

Texas remains inactive until a separate critical-lane implementation spec defines exact policy versions, fixtures, migration/RLS impact, external-provider responsibilities, verification evidence, and human approval.
