export function escapeXmlText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function applyPlaceholderFieldsToXml(xml: string, fields: Record<string, string>): string {
  let next = xml;
  for (const [key, rawValue] of Object.entries(fields)) {
    const token = `{{${key}}}`;
    next = next.replaceAll(token, escapeXmlText(rawValue));
  }
  return next;
}

