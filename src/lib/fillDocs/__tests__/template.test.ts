import { describe, expect, it } from 'vitest';

import { applyPlaceholderFieldsToXml, escapeXmlText } from '../template';

describe('fillDocs template helpers', () => {
  it('escapes XML special characters', () => {
    expect(escapeXmlText(`Tom & "Jerry" <tag>'`)).toBe('Tom &amp; &quot;Jerry&quot; &lt;tag&gt;&apos;');
  });

  it('replaces {{KEY}} tokens with escaped values', () => {
    const xml = '<w:t>Hello {{CLIENT_NAME}}</w:t><w:t>{{NOTE}}</w:t>';
    const out = applyPlaceholderFieldsToXml(xml, {
      CLIENT_NAME: 'Jane & John',
      NOTE: '<ok>',
    });

    expect(out).toContain('Hello Jane &amp; John');
    expect(out).toContain('&lt;ok&gt;');
  });
});

