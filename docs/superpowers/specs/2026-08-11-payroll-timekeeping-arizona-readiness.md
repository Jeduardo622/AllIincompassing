# Arizona Payroll Timekeeping Readiness

## Status

- Research snapshot: 2026-08-11
- Activation: inactive
- Relationship: extension of `2026-08-11-payroll-grade-timekeeping-design.md`
- Purpose: document future Arizona policy requirements and implementation gaps

This document is engineering research, not legal advice. Re-verify all sources and obtain qualified payroll/legal review before activation.

## Official Sources

- [Arizona minimum wage and earned paid sick time program](https://www.azica.gov/labor-minimum-wage-main-page)
- [A.R.S. section 23-351, paydays](https://www.azleg.gov/ars/23/00351.htm)
- [A.R.S. section 23-364, records and enforcement](https://www.azleg.gov/ars/23/00364.htm)
- [A.R.S. section 23-372, earned paid sick time accrual](https://www.azleg.gov/ars/23/00372.htm)
- [A.R.S. section 23-373, earned paid sick time use](https://www.azleg.gov/ars/23/00373.htm)
- [Federal FLSA recordkeeping](https://www.dol.gov/agencies/whd/fact-sheets/21-flsa-recordkeeping)
- [Federal FLSA hours worked](https://www.dol.gov/agencies/whd/fact-sheets/22-flsa-hours-worked)

## Preliminary Rule Map

### Hours and overtime

- Arizona generally uses the federal FLSA overtime framework for the in-scope ordinary nonexempt population.
- The baseline overtime rule is time and one-half after 40 hours in a fixed seven-day workweek.
- Arizona does not add California-style daily overtime or double-time rules for the ordinary population.
- Specialized federal exceptions require separate policy activation.

### Breaks

- No general Arizona adult meal/rest timing policy was identified for the ordinary population in the reviewed state sources.
- Federal short-break and bona fide meal compensability rules still apply.
- The product should retain manual meal punches and never auto-deduct.

### Pay frequency

- Arizona generally requires two or more fixed paydays per month, not more than 16 days apart.
- Weekly and biweekly pay groups can be supported when payday timing is compliant.
- A monthly pay group must be rejected for the in-scope Arizona nonexempt employee population unless a qualified reviewer confirms a specific lawful exception.

### Recordkeeping and employee access

- Employers must maintain payroll records showing hours worked for each day, wages paid, and earned paid sick time for four years.
- Employees or their designated representatives must be allowed to inspect and copy payroll records pertaining to the employee.
- The shared four-year retention and self-service record-access design is suitable as a baseline.

### Earned paid sick time

- Arizona requires earned paid sick time accrual for covered employees.
- The statutory baseline is one hour for every 30 hours worked.
- The annual cap differs based on whether the employer has at least 15 employees: 40 hours for employers with 15 or more employees and 24 hours for smaller employers, unless the employer provides more.
- Sick-time use and balances affect payroll-ready output, but leave accrual was not approved for California v1 and is therefore a future Arizona subsystem, not a hidden extension of the punch calculator.
- The payroll provider boundary must be explicit: this app may calculate/export accrual and usage only after a separate design determines which system is authoritative.

## Policy Interface Mapping

Future Arizona activation should configure:

- `jurisdiction_code = US-AZ`
- weekly overtime threshold of 40 hours
- daily overtime disabled for the ordinary population
- double time disabled for the ordinary population
- seventh-day premium disabled for the ordinary population
- state meal timing/premium rules disabled
- federal short-break and bona fide meal compensability enabled
- nonexempt monthly pay-group assignment blocked
- four-year payroll retention enabled
- employee self-service payroll-record access enabled
- earned paid sick time policy unavailable until its separate authority design is approved

Values above are design inputs, not production configuration, until legally reviewed and implemented.

## Required Future Work

- confirm the employee population and applicable industry exceptions
- verify current Arizona statutes, Industrial Commission rules, minimum wage, and sick-time guidance immediately before implementation
- decide whether this app or the external payroll provider owns sick-time accrual, balance, usage, and wage-statement output
- define Arizona payday validation and termination-pay boundaries with the external provider
- add Arizona policy fixtures and golden earnings cases
- add four-year retention and employee-access tests
- add sick-time accrual/use tests only after the authority decision is approved
- run security, Supabase, payroll-domain, and legal/operations review

## Activation Gate

Arizona remains inactive until a separate critical-lane implementation spec defines exact policy versions, sick-time authority, fixtures, migration/RLS impact, external-provider responsibilities, verification evidence, and human approval.
