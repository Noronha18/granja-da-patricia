import {describe,expect,it} from 'vitest';
import {navigationUrl} from './navigation';
describe('navegação da parada',()=>{
 it('codifica acentos e & sem transformar endereço em parâmetros',()=>{
  const url=new URL(navigationUrl({address:'Rua João & Maria, 25 — João Pessoa'}));
  expect(url.origin).toBe('https://www.google.com');
  expect(url.pathname).toBe('/maps/dir/');
  expect(url.searchParams.get('api')).toBe('1');
  expect(url.searchParams.get('destination')).toBe('Rua João & Maria, 25 — João Pessoa');
  expect(url.searchParams.get('travelmode')).toBe('driving');
  expect(url.searchParams.get('dir_action')).toBe('navigate');
  expect(url.searchParams.has('key')).toBe(false);
 });
 it('aceita coordenadas conferidas sem usar localização contínua',()=>{
  expect(new URL(navigationUrl({lat:-7.1,lng:-34.8})).searchParams.get('destination')).toBe('-7.1,-34.8');
 });
 it.each([{address:''},{address:'  '},{lat:91,lng:0},{lat:0,lng:-181},{lat:NaN,lng:0},{lat:0,lng:Infinity}])('recusa destino inválido %j',destination=>{
  expect(()=>navigationUrl(destination)).toThrow(RangeError);
 });
});
