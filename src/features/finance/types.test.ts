import { describe, expect, it } from 'vitest';
import { formatCents, parseBrlToCents, parseEggCount } from './types';

describe('valores de estoque', () => {
  it('interpreta reais com vírgula sem transformar custo em outra escala', () => {
    expect(parseBrlToCents('300,00')).toBe(30000);
    expect(parseBrlToCents('12,5')).toBe(1250);
    expect(formatCents(parseBrlToCents('300,00'))).toBe('R$ 300,00');
  });

  it('rejeita valores ambíguos ou além da faixa segura', () => {
    expect(() => parseBrlToCents('1.200,00')).toThrow();
    expect(() => parseBrlToCents('-2,00')).toThrow();
    expect(() => parseBrlToCents('1,234')).toThrow();
    expect(() => parseBrlToCents('90071992547410,00')).toThrow();
  });

  it('aceita somente contagens inteiras positivas de ovos', () => {
    expect(parseEggCount('300')).toBe(300);
    expect(() => parseEggCount('0')).toThrow();
    expect(() => parseEggCount('2,5')).toThrow();
    expect(() => parseEggCount('2147483648')).toThrow();
  });
});
