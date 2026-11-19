import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useStore } from '../lib/store';
import type { Place } from '../lib/types';

const KINDS = [
  ['closed', 'It has closed'],
  ['moved', 'It moved'],
  ['wrong_info', 'Wrong phone, hours or other info'],
  ['other', 'Something else'],
] as const;

type Kind = (typeof KINDS)[number][0];

export default function ReportDialog({ place, onClose, initialKind = 'wrong_info', title }: { place: Place; onClose: () => void; initialKind?: Kind; title?: string }) {
  const { session, notify } = useStore();
  const [kind, setKind] = useState<Kind>(initialKind);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;
    setBusy(true);
    const { error } = await supabase.from('reports').insert({ place_id: place.id, user_id: session.user.id, kind, message: message.trim() || null });
    setBusy(false);
    if (error) return notify(error.message);
    notify('Thanks. We review every report.');
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>{title ?? `Suggest a fix for ${place.name}`}</h3>
        <fieldset className="radio-list">
          {KINDS.map(([k, label]) => (
            <label key={k}><input type="radio" name="kind" checked={kind === k} onChange={() => setKind(k)} /> {label}</label>
          ))}
        </fieldset>
        <label className="field">Details (optional)
          <textarea rows={4} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="For example: the phone number is now (713) 555-0100, and they're open Sundays" />
        </label>
        <div className="actions end">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>Send</button>
        </div>
      </form>
    </div>
  );
}
