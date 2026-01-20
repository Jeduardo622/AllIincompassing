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


XML_PARTS = [
    "word/document.xml",
    "word/header1.xml",
    "word/header2.xml",
    "word/header3.xml",
    "word/footer1.xml",
    "word/footer2.xml",
    "word/footer3.xml",
]


TOKEN_PATTERNS: dict[str, re.Pattern[str]] = {
    "curly": re.compile(r"\{\{[^}]+\}\}"),
    "angle": re.compile(r"«[^»]+»"),
    "bracket": re.compile(r"\[[A-Z0-9_ -]{2,}\]"),
}


def strip_xml_text(text: str) -> str:
    # Very lightweight XML entity decoding for common entities in WordprocessingML
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


def extract_structured_text(xml: str) -> str:
    """
    Best-effort readable text extraction from WordprocessingML.
    Inserts newlines/tabs around paragraphs and table cells.
    """
    root = ET.fromstring(xml)
    out: list[str] = []

    def emit(s: str) -> None:
        if not s:
            return
        out.append(s)

    for el in root.iter():
        tag = el.tag.split("}")[-1]  # localname

        if tag == "t" and el.text:
            emit(strip_xml_text(el.text))
        elif tag == "tab":
            emit("\t")
        elif tag == "br":
            emit("\n")
        elif tag in ("p", "tr"):
            emit("\n")
        elif tag == "tc":
            emit("\t")

    text = "".join(out)
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip() + "\n"


def main() -> None:
    out_dir = Path("tmp/docx_extracted")
    out_dir.mkdir(parents=True, exist_ok=True)

    summary: dict[str, object] = {}

    for filename in DOCX_FILES:
        p = Path(filename)
        if not p.exists():
            raise FileNotFoundError(filename)

        with zipfile.ZipFile(p, "r") as zf:
            present_parts = [name for name in XML_PARTS if name in zf.namelist()]
            xml_concat = ""
            text_concat = ""
            for part in present_parts:
                xml = zf.read(part).decode("utf-8", errors="replace")
                xml_concat += f"\n\n==== {part} ====\n{xml}"
                text_concat += f"\n\n==== {part} ====\n{extract_text(xml)}"

        tokens: dict[str, list[str]] = {}
        for key, pattern in TOKEN_PATTERNS.items():
            tokens[key] = sorted(set(pattern.findall(xml_concat)))

        summary[filename] = {
            "parts": present_parts,
            "token_counts": {k: len(v) for k, v in tokens.items()},
            "tokens": tokens,
        }

        structured_concat = ""
        with zipfile.ZipFile(p, "r") as zf:
            present_parts = [name for name in XML_PARTS if name in zf.namelist()]
            for part in present_parts:
                xml = zf.read(part).decode("utf-8", errors="replace")
                structured_concat += f"\n\n==== {part} ====\n{extract_structured_text(xml)}"

        (out_dir / f"{p.stem}.xml.txt").write_text(xml_concat, encoding="utf-8")
        (out_dir / f"{p.stem}.text.txt").write_text(text_concat, encoding="utf-8")
        (out_dir / f"{p.stem}.structured.txt").write_text(structured_concat, encoding="utf-8")

    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(f"Wrote: {out_dir / 'summary.json'}")


if __name__ == "__main__":
    main()

