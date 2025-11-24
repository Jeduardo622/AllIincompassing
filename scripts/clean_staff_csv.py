import csv
import json
import re
from pathlib import Path
from typing import Dict, List

RAW_PATH = Path("data/staff_raw.csv")
CLEAN_PATH = Path("data/staff_cleaned.csv")
DUP_REPORT_PATH = Path("data/staff_email_duplicates.json")

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


def normalize_state(value: str) -> str:
    trimmed = value.strip()
    if not trimmed:
        return ""
    if len(trimmed) == 2:
        return trimmed.upper()
    upper_value = trimmed.upper()
    return STATE_MAP.get(upper_value, trimmed)


def normalize_phone(value: str) -> str:
    if not value:
        return ""
    value = value.replace("x___", "")
    cleaned = re.sub(r"[^0-9+]", "", value)
    # collapse leading zeros if phone started with +0...
    if cleaned.startswith("00"):
        cleaned = "+" + cleaned[2:]
    return cleaned


def main() -> None:
    if not RAW_PATH.exists():
        raise FileNotFoundError(f"Source CSV not found at {RAW_PATH}")

    with RAW_PATH.open("r", encoding="utf-8-sig", newline="") as src:
        reader = list(csv.reader(src))

    header_idx = None
    for idx, row in enumerate(reader):
        normalized = [cell.strip() for cell in row]
        if "Account Organization Name" in normalized:
            header_idx = idx
            break

    if header_idx is None:
        raise ValueError("Unable to locate header row in staff CSV.")

    headers = [cell.strip() for cell in reader[header_idx]]
    rows = reader[header_idx + 1 :]

    processed_rows: List[List[str]] = []
    email_tracker: Dict[str, List[int]] = {}

    state_index = headers.index("State") if "State" in headers else None
    phone_index = headers.index("Phone") if "Phone" in headers else None
    email_index = headers.index("Email") if "Email" in headers else None

    for row_num, row in enumerate(rows, start=header_idx + 2):
        if not any(cell.strip() for cell in row):
            continue

        if len(row) < len(headers):
            row = row + [""] * (len(headers) - len(row))
        elif len(row) > len(headers):
            row = row[: len(headers)]

        row = [cell.strip() for cell in row]

        if state_index is not None:
            row[state_index] = normalize_state(row[state_index])

        if phone_index is not None:
            row[phone_index] = normalize_phone(row[phone_index])

        if email_index is not None:
            email_value = row[email_index].strip().lower()
            row[email_index] = email_value
            if email_value:
                email_tracker.setdefault(email_value, []).append(row_num)

        processed_rows.append(row)

    with CLEAN_PATH.open("w", encoding="utf-8", newline="") as dst:
        writer = csv.writer(dst)
        writer.writerow(headers)
        writer.writerows(processed_rows)

    duplicate_emails = {
        email: rows
        for email, rows in email_tracker.items()
        if len(rows) > 1
    }

    DUP_REPORT_PATH.write_text(
        json.dumps(duplicate_emails, indent=2), encoding="utf-8"
    )


if __name__ == "__main__":
    main()

