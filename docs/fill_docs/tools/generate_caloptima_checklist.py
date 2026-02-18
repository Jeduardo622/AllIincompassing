import json
from pathlib import Path


MAPPING_PATH = Path("docs/fill_docs/caloptima_fba_template_field_map.json")
OUT_MD_PATH = Path("docs/fill_docs/CALOPTIMA_FBA_FIELD_EXTRACTION_CHECKLIST.md")
OUT_JSON_PATH = Path("docs/fill_docs/caloptima_fba_field_extraction_checklist.json")


SECTION_ORDER = [
    "identification_admin",
    "data_sources_interviews",
    "background_school_history",
    "coordination_adaptive_testing",
    "diagnostic_behavior_analysis",
    "goals_treatment_planning",
    "summary_recommendations_signatures",
]


SECTION_TITLES = {
    "identification_admin": "Identification and Administrative Intake",
    "data_sources_interviews": "Data Sources and Interviews",
    "background_school_history": "Background, School, and Intervention History",
    "coordination_adaptive_testing": "Coordination of Care and Adaptive Testing",
    "diagnostic_behavior_analysis": "Diagnostic and Behavior Analysis",
    "goals_treatment_planning": "Goals and Treatment Planning",
    "summary_recommendations_signatures": "Summary, Recommendations, and Signatures",
}


SECTION_KEY_MAP = {
    "identification_admin": {
        "CALOPTIMA_FBA_MEMBER_NAME",
        "CALOPTIMA_FBA_MEMBER_DOB",
        "CALOPTIMA_FBA_CIN",
        "CALOPTIMA_FBA_DIAGNOSES_ICD",
        "CALOPTIMA_FBA_GUARDIAN_NAME",
        "CALOPTIMA_FBA_CONTACT_PHONE",
        "CALOPTIMA_FBA_PCP",
        "CALOPTIMA_FBA_KNOWN_ALLERGIES",
        "CALOPTIMA_FBA_MEDICATIONS",
        "CALOPTIMA_FBA_DIETARY_RESTRICTIONS",
        "CALOPTIMA_FBA_SERVICE_INITIATION_DATE",
        "CALOPTIMA_FBA_DATE_ABA_FIRST_BEGAN",
        "CALOPTIMA_FBA_PRIOR_ABH_AGENCIES",
        "CALOPTIMA_FBA_ADMIN_CONTACT_NAME_TITLE",
        "CALOPTIMA_FBA_ADMIN_CONTACT_PHONE",
        "CALOPTIMA_FBA_ADMIN_CONTACT_FAX",
        "CALOPTIMA_FBA_CHIEF_COMPLAINT",
    },
    "data_sources_interviews": {
        "CALOPTIMA_FBA_RECORDS_REVIEWED",
        "CALOPTIMA_FBA_INITIAL_INTERVIEW_OBSERVATION",
        "CALOPTIMA_FBA_SECOND_INTERVIEW_OBSERVATION",
    },
    "background_school_history": {
        "CALOPTIMA_FBA_DAILY_ACTIVITY_SCHEDULE",
        "CALOPTIMA_FBA_SCHOOL_SCHEDULE",
        "CALOPTIMA_FBA_HAS_IEP",
        "CALOPTIMA_FBA_IEP_DATE",
        "CALOPTIMA_FBA_PREVIOUS_INTERVENTIONS",
    },
    "coordination_adaptive_testing": {
        "CALOPTIMA_FBA_COORDINATION_OF_CARE",
        "CALOPTIMA_FBA_VINELAND_DOMAIN_SCORES",
    },
    "diagnostic_behavior_analysis": {
        "CALOPTIMA_FBA_CURRENT_DIAGNOSIS_CODES",
        "CALOPTIMA_FBA_TARGET_BEHAVIOR_BLOCKS",
        "CALOPTIMA_FBA_BIP_BLOCKS",
        "CALOPTIMA_FBA_CRISIS_PLAN",
    },
    "goals_treatment_planning": {
        "CALOPTIMA_FBA_TARGET_REPLACEMENT_GOALS",
        "CALOPTIMA_FBA_SKILL_ACQUISITION_GOALS",
        "CALOPTIMA_FBA_PARENT_GOALS",
        "CALOPTIMA_FBA_GENERALIZATION_MAINTENANCE_PLAN",
        "CALOPTIMA_FBA_TRANSITION_PLAN",
    },
    "summary_recommendations_signatures": {
        "CALOPTIMA_FBA_SUMMARY_RECOMMENDATIONS",
        "CALOPTIMA_FBA_HCPCS_RECOMMENDATION_ROWS",
        "CALOPTIMA_FBA_TELEHEALTH_CONSENT",
        "CALOPTIMA_FBA_PARENT_INVOLVEMENT",
        "CALOPTIMA_FBA_REPORT_WRITTEN_BY",
        "CALOPTIMA_FBA_WRITER_CREDENTIALS",
        "CALOPTIMA_FBA_REPORT_COMPLETED_DATE",
        "CALOPTIMA_FBA_SIGNATURES",
    },
}


def infer_section(placeholder_key: str) -> str:
    for section_id, keys in SECTION_KEY_MAP.items():
        if placeholder_key in keys:
            return section_id
    return "summary_recommendations_signatures"


def infer_validation_rule(label: str, placeholder_key: str) -> str:
    text = f"{label} {placeholder_key}".lower()
    if "dob" in text or "date" in text:
        return "date_mm_dd_yyyy_or_na"
    if "phone" in text or "fax" in text:
        return "phone_us_or_e164_or_na"
    if "cin" in text or "member_id" in text:
        return "non_empty_identifier"
    if "consent" in text or "involvement" in text or "has_iep" in text:
        return "checkbox_yes_no_or_na"
    if "table" in text or "rows" in text or "goals" in text or "blocks" in text:
        return "structured_payload_required"
    if "signature" in text:
        return "signature_and_date_present"
    return "non_empty_text"


def infer_extraction_method(mode: str) -> str:
    if mode == "AUTO":
        return "database_prefill"
    if mode == "ASSISTED":
        return "assisted_draft_plus_review"
    return "clinician_manual_entry"


def infer_required(mode: str, source: str) -> bool:
    if mode in {"ASSISTED", "MANUAL"}:
        return True
    return source.strip().upper() != "N/A"


def infer_owners(mode: str) -> tuple[str, str]:
    if mode == "AUTO":
        return ("IntakeCoordinator", "ClinicalReviewer")
    if mode == "ASSISTED":
        return ("ClinicalAuthor", "BCBAReviewer")
    return ("ClinicalAuthor", "BCBAReviewer")


def build_rows(labels: list[dict[str, str]]) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for item in labels:
        label = item["label"]
        placeholder_key = item["placeholder_key"]
        mode = item["mode"]
        source = item["source"]
        section_id = infer_section(placeholder_key)
        extraction_owner, review_owner = infer_owners(mode)
        rows.append(
            {
                "section": section_id,
                "label": label,
                "placeholder_key": placeholder_key,
                "mode": mode,
                "source": source,
                "required": infer_required(mode, source),
                "extraction_method": infer_extraction_method(mode),
                "validation_rule": infer_validation_rule(label, placeholder_key),
                "status": "not_started",
                "extraction_owner": extraction_owner,
                "review_owner": review_owner,
                "review_notes": item.get("notes", ""),
            }
        )
    return rows


def render_markdown(rows: list[dict[str, object]], template_name: str, source_document: str) -> str:
    lines: list[str] = []
    lines.append("# CalOptima FBA Field-Level Extraction Checklist")
    lines.append("")
    lines.append(f"Template: `{template_name}`")
    lines.append(f"")
    lines.append(f"Source mapping: `{MAPPING_PATH.as_posix()}`")
    lines.append(f"Source document reviewed: `{source_document}`")
    lines.append("")
    lines.append("## Checklist schema and workflow rules")
    lines.append("")
    lines.append("- `status` lifecycle: `not_started` -> `drafted` -> `verified` -> `approved`.")
    lines.append("- Requiredness defaults:")
    lines.append("  - `AUTO`: required when a source is defined.")
    lines.append("  - `ASSISTED`: required and must be clinician-verified.")
    lines.append("  - `MANUAL`: required clinician entry unless explicitly marked optional.")
    lines.append("- Parity rule: every `placeholder_key` in mapping must appear exactly once in this checklist.")
    lines.append("")
    lines.append("## How to use")
    lines.append("")
    lines.append("1. Extractor sets `status` to `drafted` after initial population.")
    lines.append("2. Reviewer validates format/source and sets `status` to `verified`.")
    lines.append("3. BCBA or final approver sets `status` to `approved` with any sign-off notes.")
    lines.append("")

    sectioned: dict[str, list[dict[str, object]]] = {section: [] for section in SECTION_ORDER}
    for row in rows:
        section_key = str(row["section"])
        sectioned[section_key].append(row)

    for section_id in SECTION_ORDER:
        section_rows = sectioned.get(section_id, [])
        if not section_rows:
            continue

        lines.append(f"## {SECTION_TITLES[section_id]}")
        lines.append("")
        lines.append(
            "| Label | Placeholder key | Mode | Required | Extraction method | Validation rule | Extraction owner | Review owner | Status | Review notes |"
        )
        lines.append("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |")
        for row in section_rows:
            lines.append(
                f"| {row['label']} | `{row['placeholder_key']}` | {row['mode']} | {str(row['required']).lower()} | "
                f"{row['extraction_method']} | {row['validation_rule']} | {row['extraction_owner']} | "
                f"{row['review_owner']} | {row['status']} | {row['review_notes']} |"
            )
        lines.append("")

    return "\n".join(lines) + "\n"


def main() -> None:
    payload = json.loads(MAPPING_PATH.read_text(encoding="utf-8"))
    fba = payload.get("FBA", {})
    labels = fba.get("labels", [])
    template_name = fba.get("template", "CalOptima FBA")
    source_document = fba.get("source_document", "")

    rows = build_rows(labels)
    checklist_payload = {
        "template": template_name,
        "source_mapping_file": MAPPING_PATH.as_posix(),
        "source_document": source_document,
        "status_lifecycle": ["not_started", "drafted", "verified", "approved"],
        "requiredness_rules": {
            "AUTO": "required when source exists",
            "ASSISTED": "required, clinician verification required",
            "MANUAL": "required clinician entry unless explicitly optional",
        },
        "rows": rows,
    }

    OUT_JSON_PATH.write_text(json.dumps(checklist_payload, indent=2), encoding="utf-8")
    OUT_MD_PATH.write_text(render_markdown(rows, template_name, source_document), encoding="utf-8")
    print(f"Wrote {OUT_MD_PATH}")
    print(f"Wrote {OUT_JSON_PATH}")


if __name__ == "__main__":
    main()
