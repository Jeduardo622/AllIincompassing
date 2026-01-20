import json
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET


DOCX_FILES = [
    "Updated ER - IEHP.docx",
    "Updated FBA -IEHP.docx",
    "Updated PR -IEHP.docx",
]


PART_RE = re.compile(r"^word/(document|header\d+|footer\d+)\.xml$")

TAG_RE = re.compile(r"<w:tag[^>]*w:val=\"([^\"]+)\"")
ALIAS_RE = re.compile(r"<w:alias[^>]*w:val=\"([^\"]+)\"")

# colon labels like "First Name:" "IEHP Member ID#:" etc
LABEL_RE = re.compile(r"([A-Za-z][A-Za-z0-9 /()#\-]{1,60}):")

# underscore blanks
UNDERSCORE_RE = re.compile(r"_{5,}")


def strip_xml_text(text: str) -> str:
    return (
        text.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
        .replace("&quot;", '"')
        .replace("&apos;", "'")
    )


def extract_text(xml: str) -> str:
    root = ET.fromstring(xml)
    parts: list[str] = []
    for el in root.iter():
        if el.tag.endswith("}t") and el.text is not None:
            parts.append(strip_xml_text(el.text))
    return "".join(parts)


def uniq(items: list[str]) -> list[str]:
    return sorted({item.strip() for item in items if item and item.strip()})


def main() -> None:
    out_dir = Path("tmp/docx_extracted")
    out_dir.mkdir(parents=True, exist_ok=True)

    report: dict[str, object] = {}

    for filename in DOCX_FILES:
        p = Path(filename)
        if not p.exists():
            raise FileNotFoundError(filename)

        tags: list[str] = []
        aliases: list[str] = []
        labels: list[str] = []
        underscore_count = 0
        parts: list[str] = []

        with zipfile.ZipFile(p, "r") as zf:
            for name in zf.namelist():
                if not PART_RE.match(name):
                    continue
                parts.append(name)
                xml = zf.read(name).decode("utf-8", errors="replace")
                tags.extend(TAG_RE.findall(xml))
                aliases.extend(ALIAS_RE.findall(xml))

                text = extract_text(xml)
                labels.extend(LABEL_RE.findall(text))
                underscore_count += len(UNDERSCORE_RE.findall(text))

        report[filename] = {
            "parts": sorted(parts),
            "tags": uniq(tags),
            "aliases": uniq(aliases),
            "labels": uniq(labels),
            "underscore_blank_count": underscore_count,
        }

    (out_dir / "labels.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"Wrote: {out_dir / 'labels.json'}")


if __name__ == "__main__":
    main()

