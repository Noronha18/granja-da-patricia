import type { PaymentReceipt } from './api';

type Props = {
  receipts: PaymentReceipt[];
  links: Record<string, { url: string; expiresIn: number }>;
  busy: boolean;
  onPrepare: (receiptId: string) => void;
};

function dateLabel(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'America/Recife' }).format(new Date(value));
}

export default function Receipts({ receipts, links, busy, onPrepare }: Props) {
  if (!receipts.length) return null;
  return <ul className="receipt-list">{receipts.map(receipt => <li key={receipt.id}>
    <span>Comprovante · {receipt.mime === 'application/pdf' ? 'PDF' : receipt.mime === 'image/png' ? 'PNG' : 'JPEG'} · {dateLabel(receipt.createdAt)}</span>
    {links[receipt.id] ? <a href={links[receipt.id].url} target="_blank" rel="noreferrer">Baixar comprovante</a> : <button type="button" className="secondary" disabled={busy} onClick={() => onPrepare(receipt.id)}>Preparar download</button>}
    {links[receipt.id] && <small>Link temporário, válido por {Math.floor(links[receipt.id].expiresIn / 60)} minutos.</small>}
  </li>)}</ul>;
}
