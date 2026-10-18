import { describe, expect, it } from 'vitest';
import { AcceptLanguageSchema, resolveLanguage } from '../src/index.js';

describe('resolveLanguage (Accept-Language header)', () => {
  it.each([
    ['fr-FR,fr;q=0.9', 'fr'],
    ['en-US,en', 'en'],
    ['fr', 'fr'],
    ['en', 'en'],
    ['EN-us', 'en'],
    ['  en-GB ; q=0.8 , fr', 'en'],
    ['en;q=0.5', 'en'],
    ['zh-Hant-TW,en;q=0.9', 'fr'],
  ])('reads the first range of %j as %s', (header, expected) => {
    expect(resolveLanguage(header)).toBe(expected);
  });

  it('uses only the first range, ignoring quality values', () => {
    // A supported language later in the list does not win over an unsupported first one.
    expect(resolveLanguage('de-DE,en;q=0.9')).toBe('fr');
    expect(resolveLanguage('fr;q=0.1,en;q=1')).toBe('fr');
  });

  it.each([
    ['undefined', undefined],
    ['empty', ''],
    ['blank', '   '],
    ['wildcard', '*'],
    ['unsupported language', 'de'],
    ['not a language tag', 'english'],
    ['underscore', 'en_US'],
    ['subtag too long', 'en-abcdefghi'],
    ['leading comma', ',en'],
    ['digits only', '123'],
    ['script injection', '<script>alert(1)</script>'],
    ['CRLF injection', 'en\r\nSet-Cookie: x=1'],
    ['NUL byte', 'en\u0000'],
    ['bidi override', '\u202Een'],
  ])('falls back to French for %s', (_case, header) => {
    expect(resolveLanguage(header)).toBe('fr');
  });

  it('never throws, even for values that are not strings at runtime', () => {
    for (const value of [null, 42, {}, [], ['en'], Symbol('x')]) {
      expect(() => resolveLanguage(value as unknown as string)).not.toThrow();
      expect(resolveLanguage(value as unknown as string)).toBe('fr');
    }
  });

  it('caps the input at 256 characters before parsing', () => {
    // The first range is read inside the cap; anything after it is never parsed.
    expect(resolveLanguage(`en,${'x'.repeat(1_000_000)}`)).toBe('en');
    // A first range that only ends after the cap is cut and therefore malformed.
    expect(resolveLanguage(`${' '.repeat(255)}en`)).toBe('fr');
    expect(resolveLanguage(`${' '.repeat(254)}en`)).toBe('en');
  });

  it('stays fast on long and adversarial headers', () => {
    const adversarial: [string, string][] = [
      // Ends on "-" after the cap: an empty last subtag, so malformed.
      ['a-'.repeat(200_000), 'fr'],
      // Cut at 256 characters on a complete subtag: still a valid "en" range.
      [`en${'-a'.repeat(200_000)}!`, 'en'],
      [`${'-abcdefgh'.repeat(50_000)}`, 'fr'],
      ['x'.repeat(1_000_000), 'fr'],
    ];
    const start = performance.now();
    for (const [header, expected] of adversarial) expect(resolveLanguage(header)).toBe(expected);
    expect(performance.now() - start).toBeLessThan(100);
  });

  it('keeps AcceptLanguageSchema strict for explicit settings', () => {
    expect(AcceptLanguageSchema.safeParse('fr-FR,fr;q=0.9').success).toBe(false);
    expect(AcceptLanguageSchema.parse('en')).toBe('en');
  });
});
