import csv
import json
from datetime import datetime
from pathlib import Path
from typing import Dict, List

RAW_PATH = Path("data/client_raw.csv")
CLEAN_PATH = Path("data/client_cleaned.csv")
REPORT_PATH = Path("data/client_import_report.json")
PLACEHOLDER_DOMAIN = "clients.placeholder.local"

STATE_MAP = {
    "ALABAMA": "AL",
    "ALASKA": "AK",
    "ARIZONA": "AZ",
    "ARKANSAS": "AR",
    "CALIFORNIA": "CA",
    "COLORADO": "CO",
    "CONNECTICUT": "CT",
    "DELAWARE": "DE",
    "DISTRICT OF COLUMBIA": "DC",
    "FLORIDA": "FL",
    "GEORGIA": "GA",
    "HAWAII": "HI",
    "IDAHO": "ID",
    "ILLINOIS": "IL",
    "INDIANA": "IN",
    "IOWA": "IA",
    "KANSAS": "KS",
    "KENTUCKY": "KY",
    "LOUISIANA": "LA",
    "MAINE": "ME",
    "MARYLAND": "MD",
    "MASSACHUSETTS": "MA",
    "MICHIGAN": "MI",
    "MINNESOTA": "MN",
    "MISSISSIPPI": "MS",
    "MISSOURI": "MO",
    "MONTANA": "MT",
    "NEBRASKA": "NE",
    "NEVADA": "NV",
    "NEW HAMPSHIRE": "NH",
    "NEW JERSEY": "NJ",
    "NEW MEXICO": "NM",
    "NEW YORK": "NY",
    "NORTH CAROLINA": "NC",
    "NORTH DAKOTA": "ND",
    "OHIO": "OH",
    "OKLAHOMA": "OK",
    "OREGON": "OR",
    "PENNSYLVANIA": "PA",
    "RHODE ISLAND": "RI",
    "SOUTH CAROLINA": "SC",
    "SOUTH DAKOTA": "SD",
    "TENNESSEE": "TN",
    "TEXAS": "TX",
    "UTAH": "UT",
    "VERMONT": "VT",
    "VIRGINIA": "VA",
    "WASHINGTON": "WA",
    "WEST VIRGINIA": "WV",
    "WISCONSIN": "WI",
    "WYOMING": "WY",
}


def scrub_cell(value: str) -> str:
    return value.replace("\r", " ").replace("\n", " ").strip()


def normalize_state(value: str) -> str:
    trimmed = scrub_cell(value)
    if not trimmed:
        return ""
    if len(trimmed) == 2:
        return trimmed.upper()
    return STATE_MAP.get(trimmed.upper(), trimmed)


def normalize_dob(value: str) -> str:
    trimmed = scrub_cell(value)
    if not trimmed:
        return ""
    for fmt in ("%m/%d/%Y", "%m/%d/%y"):
        try:
            as_date = datetime.strptime(trimmed, fmt)
            return as_date.strftime("%Y-%m-%d")
        except ValueError:
            continue
    return trimmed


def main() -> None:
    if not RAW_PATH.exists():
        raise FileNotFoundError(f"Source CSV not found at {RAW_PATH}")

    with RAW_PATH.open("r", encoding="utf-8-sig", newline="") as src:
        reader = list(csv.reader(src))

    header_idx = None
    for idx, row in enumerate(reader):
        normalized = [scrub_cell(cell) for cell in row]
        if "First Name" in normalized and "Last Name" in normalized:
            header_idx = idx
            break

    if header_idx is None:
        raise ValueError("Unable to locate header row in client CSV.")

    headers = [scrub_cell(cell) for cell in reader[header_idx]]
    rows = reader[header_idx + 1 :]

    added_email_column = False
    if not any(header.lower() == "email" for header in headers):
        headers.append("Email")
        added_email_column = True

    header_index: Dict[str, int] = {}
    for idx, header in enumerate(headers):
        normalized = header.strip()
        if normalized not in header_index:
            header_index[normalized] = idx

    state_index = header_index.get("State")
    dob_index = header_index.get("DOB")
    first_name_index = header_index.get("First Name")
    last_name_index = header_index.get("Last Name")
    email_index = header_index.get("Email")

    client_id_index = None
    for name in headers:
        if "client id" in name.lower():
            client_id_index = header_index.get(name.strip())
            break

    processed_rows: List[List[str]] = []
    duplicate_emails: Dict[str, List[int]] = {}
    duplicate_client_ids: Dict[str, List[int]] = {}
    missing_required_rows: List[Dict[str, int]] = []
    missing_email_rows: List[int] = []
    placeholder_assignments: List[Dict[str, str]] = []
    used_emails: Dict[str, int] = {}

    for row_num, row in enumerate(rows, start=header_idx + 2):
        if not any(scrub_cell(cell) for cell in row):
            continue

        if len(row) < len(headers):
            row = row + [""] * (len(headers) - len(row))
        elif len(row) > len(headers):
            row = row[: len(headers)]

        row = [scrub_cell(cell) for cell in row]

        if state_index is not None:
            row[state_index] = normalize_state(row[state_index])

        if dob_index is not None:
            row[dob_index] = normalize_dob(row[dob_index])

        email_value = row[email_index].lower() if email_index is not None else ""
        if email_value:
            duplicate_emails.setdefault(email_value, []).append(row_num)
        else:
            if email_index is not None:
                base_candidate = ""
                if client_id_index is not None:
                    base_candidate = row[client_id_index]
                if not base_candidate and first_name_index is not None and last_name_index is not None:
                    first = row[first_name_index].lower().replace(" ", "")
                    last = row[last_name_index].lower().replace(" ", "")
                    base_candidate = f"{first}.{last}".strip(".")
                if not base_candidate:
                    base_candidate = f"row{row_num}"

                sanitized = (
                    base_candidate.lower()
                    .replace(" ", "")
                    .replace("/", "")
                    .replace("#", "")
                    .replace("@", "")
                    .replace(",", "")
                )
                if not sanitized:
                    sanitized = f"row{row_num}"

                count = used_emails.get(sanitized, 0)
                used_emails[sanitized] = count + 1
                if count > 0:
                    sanitized = f"{sanitized}-{count}"

                placeholder_email = f"{sanitized}@{PLACEHOLDER_DOMAIN}"
                row[email_index] = placeholder_email
                placeholder_assignments.append({"row": str(row_num), "email": placeholder_email})
                duplicate_emails.setdefault(placeholder_email, []).append(row_num)
            else:
                missing_email_rows.append(row_num)

        if client_id_index is not None:
            client_value = row[client_id_index]
            if client_value:
                duplicate_client_ids.setdefault(client_value, []).append(row_num)

        missing_fields = []
        if first_name_index is not None and not row[first_name_index]:
            missing_fields.append("first_name")
        if last_name_index is not None and not row[last_name_index]:
            missing_fields.append("last_name")
        if email_index is not None and not row[email_index]:
            missing_fields.append("email")
        if dob_index is not None and not row[dob_index]:
            missing_fields.append("date_of_birth")

        # recompute email value for missing-field detection (placeholders count as present)
        if email_index is not None and row[email_index]:
            if "email" in missing_fields:
                missing_fields.remove("email")

        if missing_fields:
            missing_required_rows.append({"row": row_num, "fields": missing_fields})

        processed_rows.append(row)

    with CLEAN_PATH.open("w", encoding="utf-8", newline="") as dst:
        writer = csv.writer(dst)
        writer.writerow(headers)
        writer.writerows(processed_rows)

    report = {
        "rows_written": len(processed_rows),
        "added_email_column": added_email_column,
        "missing_required_rows": missing_required_rows,
        "missing_email_rows": missing_email_rows,
        "duplicate_emails": {
            email: nums for email, nums in duplicate_emails.items() if len(nums) > 1
        },
        "duplicate_client_ids": {
            cid: nums for cid, nums in duplicate_client_ids.items() if len(nums) > 1
        },
        "placeholder_emails_assigned": placeholder_assignments,
    }

    REPORT_PATH.write_text(json.dumps(report, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()

