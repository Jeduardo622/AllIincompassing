import json
import re
from pathlib import Path


FIELD_LABELS_PATH = Path("tmp/docx_extracted/field_labels.json")


def slugify(label: str) -> str:
    label = label.strip()
    label = re.sub(r"[^A-Za-z0-9]+", "_", label)
    label = re.sub(r"_+", "_", label).strip("_")
    return label.upper()


KNOWN_SOURCES: dict[str, dict[str, str]] = {
    # Shared demographics
    "First Name": {"source": "clients.first_name", "notes": "Fallback: split clients.full_name if first_name is null."},
    "Last Name": {"source": "clients.last_name", "notes": "Fallback: split clients.full_name if last_name is null."},
    "Birth Date": {"source": "clients.date_of_birth", "notes": "Format MM/DD/YYYY."},
    "IEHP Member ID#": {
        "source": "authorizations.member_id || clients.cin_number || clients.client_id",
        "notes": "Prefer active authorization.member_id for the payer; fallback to clients.cin_number.",
    },
    "Present Address": {
        "source": "clients.address_line1/2 + clients.city/state/zip_code",
        "notes": "Concatenate; omit null parts.",
    },
    "Parent/Guardian": {
        "source": "clients.parent1_first_name/last_name (+ relationship) (fallback parent2_*)",
        "notes": "Template often expects primary guardian; include relationship if present.",
    },
    "Guardian(s)": {
        "source": "clients.parent1_* + clients.parent2_* (and/or client_guardians links)",
        "notes": "If using guardian portal links, expand from public.client_guardians.",
    },
    "Phone": {
        "source": "clients.phone || clients.parent1_phone",
        "notes": "If template expects guardian phone, prefer parent1_phone.",
    },
    "Language": {"source": "clients.preferred_language", "notes": ""},
    # Dates
    "Referral Date": {"source": "NEW: clients.insurance_info.referral_date", "notes": "Not currently a dedicated column."},
    "Date Referred": {"source": "NEW: clients.insurance_info.referral_date", "notes": "Not currently a dedicated column."},
    "Report Date": {"source": "today (server)", "notes": "Generated at time of report."},
    "Letter Date": {"source": "today (server)", "notes": "Generated at time of letter."},
    "REPORT DATE": {"source": "today (server)", "notes": "Generated at time of report."},
    # Provider / org
    "Agency Name": {"source": "company_settings.company_name", "notes": ""},
    "Provider name/Certification": {
        "source": "therapists.full_name + therapists.title + (bcba_number/rbt_number/license_number)",
        "notes": "Choose credential string per payer.",
    },
    "Assessor/Certification": {
        "source": "therapists.full_name + therapists.title + (bcba_number/license_number)",
        "notes": "",
    },
    "Assessor’s phone number": {"source": "therapists.phone", "notes": "Or clinic phone if assessor phone missing."},
    "Report Written By": {"source": "therapists.full_name + credentials", "notes": ""},
    "Report completed by": {"source": "therapists.full_name + credentials", "notes": ""},
    "Letter completed by": {"source": "therapists.full_name + credentials", "notes": ""},
    "Program Supervisor": {"source": "therapists.supervisor (text)", "notes": "If supervisor is another user, model as relation later."},
    "Supervising BCBA": {"source": "therapists.bcba_number / supervisor name (NEW if separate)", "notes": "Likely needs explicit supervisor table."},
    "Supervising Clinicians Phone Number": {"source": "NEW: supervisor phone", "notes": "Not currently modeled."},
    # Reporting
    "Reporting Period": {"source": "selected reporting window", "notes": "Derived from authorization or therapist-selected dates."},
    # School info (not currently first-class modeled; recommend capturing on client)
    "School Name": {"source": "NEW: clients.insurance_info.school.name", "notes": ""},
    "School District": {"source": "NEW: clients.insurance_info.school.district", "notes": ""},
    "Grade": {"source": "NEW: clients.insurance_info.school.grade", "notes": ""},
    "Teachers Name": {"source": "NEW: clients.insurance_info.school.teacher_name", "notes": ""},
    "School Start and End Time": {"source": "NEW: clients.insurance_info.school.start_end_time", "notes": ""},
    "Date of Last IEP": {"source": "NEW: clients.insurance_info.school.last_iep_date", "notes": "Format MM/DD/YYYY."},
    "School Placement": {"source": "NEW: clients.insurance_info.school.placement", "notes": ""},
    "School Services": {"source": "NEW: clients.insurance_info.school.services", "notes": "e.g., OT/ST/PT/counseling/ABA; array or text."},
    # Household / living situation
    "Persons in Household and Relationship to IEHP Member": {
        "source": "NEW: clients.insurance_info.household_members[]",
        "notes": "Long-term: normalize into a client_household_members table.",
    },
    "Additional Information": {"source": "NEW: clients.insurance_info.additional_background_info", "notes": ""},
    # Service setting
    "Location of Service": {"source": "clients.in_home/in_clinic/in_school + per-session location", "notes": "If multiple, list mix."},
    "Location": {"source": "NEW: report.context.location", "notes": "Template-specific (e.g., assessment location)."},
    # Staffing
    "Behavior Technician (s)": {
        "source": "derived from sessions in reporting window (distinct therapists) OR NEW: report.staffing.behavior_techs",
        "notes": "If your BTs are separate roles, model as a join table.",
    },
}


def main() -> None:
    payload = json.loads(FIELD_LABELS_PATH.read_text(encoding="utf-8"))

    out_dir = Path("docs/fill_docs")
    out_dir.mkdir(parents=True, exist_ok=True)

    mapping_json: dict[str, object] = {}
    md_lines: list[str] = []
    md_lines.append("# IEHP Template Field Map (ER / FBA / PR)")
    md_lines.append("")
    md_lines.append("These IEHP templates currently **do not contain `{{PLACEHOLDER}}` tokens**, so auto-fill requires adding placeholders to the `.docx` files (recommended keys below).")
    md_lines.append("")
    md_lines.append("## Conventions")
    md_lines.append("- **placeholder_key**: recommended `{{PLACEHOLDER_KEY}}` token to embed in the Word template")
    md_lines.append("- **source**: where the value should come from (DB column, derived metric, or NEW field to capture)")
    md_lines.append("- **notes**: formatting or precedence rules")
    md_lines.append("")

    for template_key in ("ER", "FBA", "PR"):
        entry = payload.get(template_key, {})
        labels: list[str] = entry.get("field_labels", [])
        placeholders: list[str] = entry.get("placeholders", [])

        md_lines.append(f"## {template_key}")
        md_lines.append("")
        if placeholders:
            md_lines.append("### Existing bracket placeholders detected in template")
            for ph in placeholders:
                md_lines.append(f"- `{ph}`")
            md_lines.append("")

        md_lines.append("### Field mapping")
        md_lines.append("")
        md_lines.append("| Template field label | Recommended placeholder_key | Source | Notes |")
        md_lines.append("| --- | --- | --- | --- |")

        template_map: list[dict[str, str]] = []
        for label in labels:
            source_info = KNOWN_SOURCES.get(
                label,
                {"source": "TBD (not yet mapped)", "notes": "Likely clinician-entered or requires new data capture."},
            )
            placeholder_key = f"{template_key}_{slugify(label)}"

            md_lines.append(f"| {label} | `{placeholder_key}` | {source_info['source']} | {source_info.get('notes','')} |")
            template_map.append(
                {
                    "label": label,
                    "placeholder_key": placeholder_key,
                    "source": source_info["source"],
                    "notes": source_info.get("notes", ""),
                }
            )

        md_lines.append("")
        mapping_json[template_key] = {
            "labels": template_map,
            "existing_placeholders": placeholders,
        }

    (out_dir / "IEHP_TEMPLATE_FIELD_MAP.md").write_text("\n".join(md_lines) + "\n", encoding="utf-8")
    (out_dir / "iehp_template_field_map.json").write_text(json.dumps(mapping_json, indent=2), encoding="utf-8")
    print("Wrote docs/fill_docs/IEHP_TEMPLATE_FIELD_MAP.md and docs/fill_docs/iehp_template_field_map.json")


if __name__ == "__main__":
    main()

