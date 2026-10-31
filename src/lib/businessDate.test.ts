import {describe,expect,it} from 'vitest';
import {timestampForBusinessDate} from './businessDate';
describe('data de negócio em Recife',()=>{
 it('não desloca recebimento de hoje para o futuro ao registrar de manhã',()=>{expect(timestampForBusinessDate('2026-10-29',new Date('2026-10-29T12:00:00Z'))).toBe('2026-10-29T12:00:00.000Z');});
 it('usa Recife mesmo quando UTC já está no dia seguinte',()=>{expect(timestampForBusinessDate('2026-10-29',new Date('2026-10-30T01:00:00Z'))).toBe('2026-10-30T01:00:00.000Z');});
 it('mantém a data selecionada para um registro anterior',()=>{expect(timestampForBusinessDate('2026-09-01',new Date('2026-10-29T12:00:00Z'))).toBe('2026-09-01T15:00:00.000Z');});
 it.each(['','2026-02-30','2026-13-01','amanhã'])('rejeita data inválida %s',date=>{expect(()=>timestampForBusinessDate(date)).toThrow();});
});
