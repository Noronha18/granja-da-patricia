export function timestampForBusinessDate(date:string,now=new Date()):string{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new RangeError('Invalid business date');
 const selected=new Date(`${date}T12:00:00-03:00`);
 if(!Number.isFinite(selected.getTime())||selected.toISOString().slice(0,10)!==date)throw new RangeError('Invalid business date');
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Recife'}).format(now);
 // Same-day entries must not move a morning payment into an artificial future.
 return date===today?now.toISOString():selected.toISOString();
}
