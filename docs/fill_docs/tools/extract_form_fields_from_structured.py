import json
import re
from pathlib import Path


FILES = [
    ("ER", Path("tmp/docx_extracted/Updated ER - IEHP.structured.txt")),
    ("FBA", Path("tmp/docx_extracted/Updated FBA -IEHP.structured.txt")),
    ("PR", Path("tmp/docx_extracted/Updated PR -IEHP.structured.txt")),
]


PLACEHOLDER_RE = re.compile(r"\[[^\]]+\]")  # [XX], [MM/DD/YYYY], etc


def normalize_label(label: str) -> str:
    return re.sub(r"\s+", " ", label.strip())


def main() -> None:
    report: dict[str, object] = {}
    for key, path in FILES:
        text = path.read_text(encoding="utf-8", errors="replace")
        lines = [line.rstrip() for line in text.splitlines()]

        fields: list[str] = []
        for line in lines:
            s = normalize_label(line)
            if not s.endswith(":"):
                continue
            fields.append(s[:-1])

        placeholders = sorted(set(PLACEHOLDER_RE.findall(text)))

        report[key] = {
            "structured_path": str(path),
            "field_labels": sorted(set(fields)),
            "placeholders": placeholders,
        }

    out = Path("tmp/docx_extracted/field_labels.json")
    out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"Wrote: {out}")


if __name__ == "__main__":
    main()

