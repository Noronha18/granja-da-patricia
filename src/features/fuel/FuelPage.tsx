import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useSession } from '../../app/Session';
import { formatCents, parseBrlToCents } from '../finance/types';
import { correctFuel, loadFuel, recordFuel, recoverFuelRequest, type FuelHistoryEvent, type FuelInput } from './api';
import { measureConsumption } from './consumption';

const fuelNames: Record<string, string> = { gasoline: 'Gasolina', ethanol: 'Etanol', diesel: 'Diesel', diesel_s10: 'Diesel S10', cng: 'GNV' };
export default function FuelPage() {
  const { userId, role } = useSession();
  const [events, setEvents] = useState<FuelHistoryEvent[]>([]);
  const [vehicles, setVehicles] = useState<{ id: string; name: string }[]>([]);
  const [vehicle, setVehicle] = useState('');
  const [busy, setBusy] = useState(false);
  const [stale,setStale]=useState(false);const formRef=useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [editing, setEditing] = useState<FuelHistoryEvent | null>(null);
  const key = `granja:${userId}:fuel-request`;
  async function refresh() {
    const result = await loadFuel(); setEvents(result.events); setVehicles(result.vehicles);
    setVehicle(current => current || result.vehicles[0]?.id || '');setStale(false);
  }
  useEffect(() => {
    setPending(sessionStorage.getItem(key));
    refresh().catch(() => {setStale(true);setMessage('Não foi possível carregar abastecimentos. Use Atualizar abastecimentos.');});
  }, [key]);
  function resetConfirmedForm(){setEditing(null);formRef.current?.reset();setStale(true);}
  async function refreshConfirmed(prefix:string){try{await refresh();}catch{setMessage(`${prefix} Não foi possível atualizar o histórico. Use Atualizar abastecimentos antes de registrar outro.`);}}
  async function recover() {
    const requestId = pending ?? sessionStorage.getItem(key); if (!requestId) return;
    setBusy(true);
    try {
      const operation = sessionStorage.getItem(`${key}:operation`) === 'correct_fuel' ? 'correct_fuel' : 'record_fuel';
      const result = await recoverFuelRequest(requestId, operation);
      sessionStorage.removeItem(key); sessionStorage.removeItem(`${key}:operation`); setPending(null);
      if(result.status==='saved')resetConfirmedForm();
      const status=result.status==='saved'?'Abastecimento confirmado.':'Tentativa encerrada sem salvar. Confira e registre novamente.';setMessage(status);
      await refreshConfirmed(status);
    } catch { setMessage('Confirmação indisponível. Mantenha esta tentativa e confira novamente com internet.'); }
    finally { setBusy(false); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || pending || stale) return;
    const form = event.currentTarget; const data = new FormData(form);
    let input: FuelInput;
    try {
      const odometerKm = Number(data.get('odometer')); const rawLitres=String(data.get('litres')).replace(',', '.'); const litres = Number(rawLitres);
      if(!/^\d+(\.\d{1,3})?$/.test(rawLitres))throw new Error();
      if (!Number.isSafeInteger(odometerKm) || odometerKm < 0 || !Number.isFinite(litres) || litres <= 0) throw new Error();
      input = { vehicleId: vehicle, occurredAt: new Date(`${String(data.get('date'))}-03:00`).toISOString(), odometerKm, litres, totalCents: parseBrlToCents(String(data.get('total'))), fuelType: String(data.get('type')), fullTank: data.get('full') === 'on', note: String(data.get('note')) };
    } catch { setMessage('Confira data, hodômetro, litros e valor pago.'); return; }
    const reason = String(data.get('reason') ?? '').trim();
    if (editing && !reason) { setMessage('Informe motivo da correção.'); return; }
    const requestId = crypto.randomUUID(); sessionStorage.setItem(key, requestId); sessionStorage.setItem(`${key}:operation`, editing ? 'correct_fuel' : 'record_fuel'); setPending(requestId); setBusy(true);
    try {
      if (editing) await correctFuel(editing.id, data.get('reverse') === 'on' ? null : input, reason, requestId);
      else await recordFuel(input, requestId);
      sessionStorage.removeItem(key); sessionStorage.removeItem(`${key}:operation`); setPending(null); resetConfirmedForm();
      const status='Abastecimento salvo. Despesa registrada uma única vez.';setMessage(status);await refreshConfirmed(status);
    } catch (failure) { const code=(failure as {code?:string}).code; if(code&&/^[0-9A-Z]{5}$/.test(code)){sessionStorage.removeItem(key);sessionStorage.removeItem(`${key}:operation`);setPending(null);setMessage((failure as {message?:string}).message==='ODOMETER_ORDER'?'O hodômetro não corresponde aos abastecimentos anteriores ou posteriores. Confira data e quilometragem.':'Confira os dados do abastecimento e tente novamente.');}else setMessage('Abastecimento ainda não confirmado. Confira a tentativa antes de registrar novamente.'); }
    finally { setBusy(false); }
  }
  const selected = events.filter(event => event.vehicleId === vehicle);
  const consumption = role === 'owner' ? measureConsumption(selected) : null;
  const latest = selected.filter(event => !event.reversed).at(-1);
  return <section className={`page-stack fuel-page ${role==='driver'?'driver-fuel':''}`}>
    <header><h1>Combustível</h1><p>Registre abastecimento e valor realmente pago.</p><button className="secondary" disabled={busy} onClick={async()=>{setBusy(true);try{await refresh();setMessage('Histórico atualizado.');}catch{setStale(true);setMessage('Não foi possível atualizar o histórico. Tente novamente com internet.');}finally{setBusy(false);}}}>Atualizar abastecimentos</button></header>
    {message && <p role="status">{message}</p>}
    {pending && <div className="card"><p>Tentativa pendente. Confira com internet antes de registrar outra.</p><button disabled={busy} onClick={recover}>Conferir tentativa</button></div>}
    <label>Veículo<select aria-label="Veículo" disabled={busy||!!pending||!!editing} value={vehicle} onChange={event => setVehicle(event.target.value)}>{vehicles.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    {!vehicles.length && <p>Cadastre veículo nas configurações para registrar abastecimentos.</p>}
    {role === 'owner' && <div className="card"><h2>Consumo medido</h2>{consumption ? <p>{consumption.kmPerLitre.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} km/L · {fuelNames[consumption.fuelType]} · {new Date(consumption.from).toLocaleDateString('pt-BR')} até {new Date(consumption.to).toLocaleDateString('pt-BR')}</p> : <p>Aguardando histórico: dois tanques cheios com intervalo válido.</p>}
      <p>{latest ? `Preço do último abastecimento: ${formatCents(Math.round(latest.totalCents / latest.litres))}/L em ${new Date(latest.occurredAt).toLocaleDateString('pt-BR')}.` : 'Preço: aguardando histórico.'}</p></div>}
    <form ref={formRef} key={editing?.id ?? 'new'} className="card form-grid" onSubmit={submit}><h2>{editing ? 'Corrigir abastecimento' : 'Novo abastecimento'}</h2>
      <label>Data e hora<input name="date" type="datetime-local" defaultValue={editing ? new Date(new Date(editing.occurredAt).getTime() - new Date(editing.occurredAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''} required /></label>
      <label>Hodômetro (km)<input name="odometer" type="number" inputMode="numeric" defaultValue={editing?.odometerKm} min="0" step="1" required /></label>
      <label>Litros<input name="litres" type="text" inputMode="decimal" defaultValue={editing?.litres} min="0.001" step="0.001" required /></label>
      <label>Valor pago (R$)<input name="total" defaultValue={editing ? (editing.totalCents / 100).toFixed(2).replace('.', ',') : ''} inputMode="decimal" required /></label>
      <label>Combustível<select aria-label="Combustível" name="type" defaultValue={editing?.fuelType}>{Object.entries(fuelNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>
      <label className="checkbox"><input name="full" type="checkbox" defaultChecked={editing?.fullTank} /> Tanque cheio</label>
      <label>Observação<input name="note" defaultValue={editing?.note} maxLength={1000} /></label>
      {editing && <><label>Motivo<input name="reason" maxLength={1000} required /></label><label className="checkbox"><input name="reverse" type="checkbox" /> Somente estornar, sem substituto</label><p>Data do abastecimento preserva medição. Compensação financeira entra na data atual.</p><button type="button" onClick={() => setEditing(null)} disabled={busy}>Cancelar correção</button></>}
      <button disabled={busy || stale || !!pending || !vehicle}>Registrar abastecimento</button>
    </form>
    <div className="card"><h2>Histórico {role === 'driver' && 'dos seus lançamentos'}</h2>{selected.length ? <ul>{[...selected].reverse().map(event => <li key={event.id}>{new Date(event.occurredAt).toLocaleString('pt-BR')} · {event.odometerKm} km · {event.litres} L · {formatCents(event.totalCents)} · {fuelNames[event.fuelType]}{event.fullTank ? ' · Cheio' : ' · Parcial'}{event.reversed ? ' · Estornado' : ''}{role === 'owner' && !event.reversed && <button disabled={busy || stale || !!pending} onClick={() => setEditing(event)}>Corrigir ou estornar</button>}</li>)}</ul> : <p>Nenhum abastecimento registrado.</p>}</div>
  </section>;
}
