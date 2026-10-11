"use client";

import { useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, LockKeyhole, PlaneTakeoff, X } from "lucide-react";

type Props = {
  onClose: () => void;
  onSaved: () => void | Promise<void>;
};

type FormFields = {
  date: string; departure: string; arrival: string;
  model: string; registration: string; type: "DUAL" | "SOLO" | "SPIC" | "SIM";
  picName: string; instructor: string; total: string; ifr: string; night: string;
  off: string; on: string; takeoffsDay: string; takeoffsNight: string;
  landingsDay: string; landingsNight: string; remarks: string;
  multiEngine: boolean;
};

const empty = (): FormFields => ({
  date: new Date().toISOString().slice(0, 10),
  departure: "", arrival: "", model: "", registration: "", type: "DUAL",
  picName: "", instructor: "", total: "1:00", ifr: "0:00", night: "0:00",
  off: "", on: "", takeoffsDay: "1", takeoffsNight: "0",
  landingsDay: "1", landingsNight: "0", remarks: "", multiEngine: false,
});

function parseDuration(value: string, label: string): number {
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(value.trim());
  if (!match) throw new Error("Usa o formato h:mm em " + label + " (por exemplo 1:25).");
  return Number(match[1]) * 60 + Number(match[2]);
}

function timeUtc(date: string, hour: string, nextDay = false): string | null {
  if (!hour) return null;
  const stamp = new Date(date + "T" + hour + ":00Z");
  if (Number.isNaN(stamp.getTime())) throw new Error("Indica uma hora UTC válida.");
  if (nextDay) stamp.setUTCDate(stamp.getUTCDate() + 1);
  return stamp.toISOString();
}

function Field({
  label, value, onChange, placeholder, type = "text", required = false,
}: {
  label: string; value: string; onChange: (value: string) => void;
  placeholder?: string; type?: string; required?: boolean;
}) {
  return (
    <label className="fs-entry-field">
      <span>{label}</span>
      <input
        type={type} value={value} required={required}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

export function NewFlightModal({ onClose, onSaved }: Props) {
  const [fields, setFields] = useState<FormFields>(empty);
  const [key, setKey] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function update<K extends keyof FormFields>(name: K, value: FormFields[K]) {
    setFields((previous) => ({ ...previous, [name]: value }));
  }

  useEffect(() => {
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onClose]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      const total = parseDuration(fields.total, "tempo total");
      const ifr = parseDuration(fields.ifr, "IFR");
      const night = parseDuration(fields.night, "noite");
      const simulator = fields.type === "SIM";
      if (total <= 0) throw new Error("Indica um tempo total superior a zero.");
      if (!simulator && (night > total || ifr > total)) {
        throw new Error("IFR e noite não podem ultrapassar o tempo total.");
      }
      const off = timeUtc(fields.date, fields.off);
      const onToday = timeUtc(fields.date, fields.on);
      const on = onToday && off && onToday <= off ? timeUtc(fields.date, fields.on, true) : onToday;
      const pic = fields.type === "SOLO" || fields.type === "SPIC" ? total : 0;
      const dual = fields.type === "DUAL" ? total : 0;
      const day = Math.max(0, total - night);
      const payload = {
        date: fields.date,
        departure_airport_name: fields.departure.trim().toUpperCase(),
        arrival_airport_name: fields.arrival.trim().toUpperCase(),
        off_block: off, on_block: on,
        type_of_aircraft: fields.model.trim().toUpperCase(),
        registration: fields.registration.trim().toUpperCase(),
        name_of_pilot_in_command: fields.picName.trim(),
        instructor_name: fields.instructor.trim(),
        flight_type: fields.type,
        fstd_type: simulator ? fields.model.trim().toUpperCase() || "FSTD" : null,
        fstd_model: simulator ? fields.registration.trim().toUpperCase() : null,
        total_minutes: simulator ? 0 : total,
        day_minutes: simulator ? 0 : day, night_minutes: simulator ? 0 : night,
        single_engine_vfr_minutes: simulator || fields.multiEngine ? 0 : total - ifr,
        single_engine_ifr_minutes: simulator || fields.multiEngine ? 0 : ifr,
        multi_engine_vfr_minutes: simulator || !fields.multiEngine ? 0 : total - ifr,
        multi_engine_ifr_minutes: simulator || !fields.multiEngine ? 0 : ifr,
        pilot_in_command_minutes: simulator ? 0 : pic,
        spic_minutes: simulator ? 0 : fields.type === "SPIC" ? total : 0,
        dual_minutes: simulator ? 0 : dual,
        co_pilot_minutes: 0, multi_pilot_minutes: 0, flight_instructor_minutes: 0,
        synthetic_training_minutes: simulator ? total : 0,
        instructor_synthetic_training_minutes: 0,
        if_time_minutes: simulator ? 0 : ifr,
        takeoffs_day: simulator ? 0 : Number(fields.takeoffsDay),
        takeoffs_night: simulator ? 0 : Number(fields.takeoffsNight),
        landings_day: simulator ? 0 : Number(fields.landingsDay),
        landings_night: simulator ? 0 : Number(fields.landingsNight),
        remarks_and_endorsements: fields.remarks.trim() || null,
      };
      const response = await fetch("/api/flights", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-flight-stats-editor-key": key,
        },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Não foi possível guardar o voo.");
      await onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Erro ao guardar o registo.");
    } finally {
      setSaving(false);
    }
  }

  const sim = fields.type === "SIM";
  return (
    <div className="fs-entry-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="fs-entry-modal" role="dialog" aria-modal="true" aria-labelledby="entry-title">
        <header className="fs-entry-header">
          <div className="fs-entry-icon"><PlaneTakeoff size={23} /></div>
          <div>
            <p className="fs-entry-overline">CADERNETA DE VOO</p>
            <h2 id="entry-title">Adicionar registo</h2>
            <p>Preenche os dados do voo. O novo registo entra automaticamente nos totais.</p>
          </div>
          <button className="fs-entry-close" type="button" onClick={onClose} aria-label="Fechar"><X size={21} /></button>
        </header>
        <form onSubmit={save} className="fs-entry-form">
          <section>
            <h3>01 <span>Identificação</span></h3>
            <div className="fs-entry-grid">
              <Field label="Data" type="date" value={fields.date} onChange={(v) => update("date", v)} required />
              <label className="fs-entry-field">
                <span>Tipo de registo</span>
                <select value={fields.type} onChange={(event) => update("type", event.target.value as FormFields["type"])}>
                  <option value="DUAL">Duplo comando · DUAL</option>
                  <option value="SOLO">Solo / PIC</option>
                  <option value="SPIC">SPIC</option>
                  <option value="SIM">Simulador / FSTD</option>
                </select>
              </label>
              {!sim && <>
                <Field label="Partida · ICAO" value={fields.departure} placeholder="LPSO" required onChange={(v) => update("departure", v)} />
                <Field label="Chegada · ICAO" value={fields.arrival} placeholder="LPPT" required onChange={(v) => update("arrival", v)} />
              </>}
              <Field label={sim ? "Tipo FSTD" : "Tipo de aeronave"} value={fields.model} placeholder={sim ? "FNPT II" : "P2008JC"} required={!sim} onChange={(v) => update("model", v)} />
              <Field label={sim ? "Modelo FSTD (opcional)" : "Matrícula"} value={fields.registration} placeholder={sim ? "A320" : "CS-ECC"} required={!sim} onChange={(v) => update("registration", v)} />
              {!sim && <label className="fs-entry-check">
                <input type="checkbox" checked={fields.multiEngine} onChange={(event) => update("multiEngine", event.target.checked)} />
                Aeronave multimotor
              </label>}
            </div>
          </section>
          <section>
            <h3>02 <span>Tempos e função</span></h3>
            <div className="fs-entry-grid">
              <Field label={sim ? "Tempo FSTD · h:mm" : "Tempo total · h:mm"} value={fields.total} onChange={(v) => update("total", v)} placeholder="1:15" required />
              {!sim && <>
                <Field label="Tempo IFR · h:mm" value={fields.ifr} onChange={(v) => update("ifr", v)} />
                <Field label="Tempo noite · h:mm" value={fields.night} onChange={(v) => update("night", v)} />
              </>}
              <Field label={sim ? "Instrutor" : "Nome do PIC"} value={fields.picName} onChange={(v) => update("picName", v)} placeholder="Nome do piloto" />
              <Field label="Instrutor (opcional)" value={fields.instructor} onChange={(v) => update("instructor", v)} />
            </div>
          </section>
          {!sim && <section>
            <button type="button" className="fs-entry-disclosure" onClick={() => setAdvanced((value) => !value)} aria-expanded={advanced}>
              03 <span>Horários UTC, descolagens e aterragens</span><strong>{advanced ? "−" : "+"}</strong>
            </button>
            {advanced && <div className="fs-entry-grid fs-entry-advanced">
              <Field label="Off-block UTC" type="time" value={fields.off} onChange={(v) => update("off", v)} />
              <Field label="On-block UTC" type="time" value={fields.on} onChange={(v) => update("on", v)} />
              <Field label="Descolagens dia" type="number" value={fields.takeoffsDay} onChange={(v) => update("takeoffsDay", v)} />
              <Field label="Descolagens noite" type="number" value={fields.takeoffsNight} onChange={(v) => update("takeoffsNight", v)} />
              <Field label="Aterragens dia" type="number" value={fields.landingsDay} onChange={(v) => update("landingsDay", v)} />
              <Field label="Aterragens noite" type="number" value={fields.landingsNight} onChange={(v) => update("landingsNight", v)} />
            </div>}
          </section>}
          <section>
            <h3>04 <span>Notas e segurança</span></h3>
            <label className="fs-entry-field">
              <span>Observações (opcional)</span>
              <textarea rows={2} maxLength={600} value={fields.remarks} onChange={(event) => update("remarks", event.target.value)} placeholder="Ex.: treino IFR, navegação, exercícios…" />
            </label>
            <label className="fs-entry-field fs-entry-secret">
              <span><LockKeyhole size={14} /> Chave privada para adicionar voos</span>
              <input type="password" autoComplete="off" value={key} onChange={(event) => setKey(event.target.value)} required placeholder="Chave de edição" />
              <small>Necessária apenas para guardar. Não fica guardada no browser.</small>
            </label>
          </section>
          {error && <p className="fs-entry-error" role="alert">{error}</p>}
          <footer className="fs-entry-footer">
            <button type="button" onClick={onClose} className="fs-entry-cancel">Cancelar</button>
            <button type="submit" disabled={saving} className="fs-entry-save">
              {saving ? "A guardar…" : <><CheckCircle2 size={17} /> Guardar voo</>}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
