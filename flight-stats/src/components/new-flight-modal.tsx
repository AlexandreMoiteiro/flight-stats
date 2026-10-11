"use client";

import { useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, PlaneTakeoff, X } from "lucide-react";

type Props = { onClose: () => void; onSaved: () => void | Promise<void> };

type FormFields = {
  date: string;
  departure: string; arrival: string; off: string; on: string;
  model: string; registration: string; engine: "SE" | "ME"; multiPilot: boolean;
  simulator: boolean; picName: string;
  total: string; night: string; ifr: string;
  pic: string; copilot: string; dual: string; instructor: string;
  takeoffsDay: string; takeoffsNight: string; landingsDay: string; landingsNight: string;
  fstdType: string; fstdModel: string; remarks: string;
};

function initialFields(): FormFields {
  return {
    date: new Date().toISOString().slice(0, 10),
    departure: "", arrival: "", off: "", on: "",
    model: "", registration: "", engine: "SE", multiPilot: false,
    simulator: false, picName: "", total: "1:00", night: "0:00", ifr: "0:00",
    pic: "0:00", copilot: "0:00", dual: "1:00", instructor: "0:00",
    takeoffsDay: "1", takeoffsNight: "0", landingsDay: "1", landingsNight: "0",
    fstdType: "", fstdModel: "", remarks: "",
  };
}

function duration(value: string, label: string): number {
  const match = /^(\d{1,3}):([0-5]\d)$/.exec(value.trim());
  if (!match) throw new Error("Formato h:mm inválido: " + label + ".");
  return Number(match[1]) * 60 + Number(match[2]);
}

function utc(date: string, time: string, nextDay = false): string | null {
  if (!time) return null;
  const result = new Date(date + "T" + time + ":00Z");
  if (Number.isNaN(result.getTime())) throw new Error("Hora UTC inválida.");
  if (nextDay) result.setUTCDate(result.getUTCDate() + 1);
  return result.toISOString();
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
      <input type={type} value={value} required={required} placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

export function NewFlightModal({ onClose, onSaved }: Props) {
  const [fields, setFields] = useState<FormFields>(initialFields);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function update<K extends keyof FormFields>(name: K, value: FormFields[K]) {
    setFields((previous) => ({ ...previous, [name]: value }));
  }

  useEffect(() => {
    function escape(event: KeyboardEvent) { if (event.key === "Escape") onClose(); }
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onClose]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const sim = fields.simulator;
      const total = duration(fields.total, "Total");
      if (!total) throw new Error("Indica o tempo total.");
      const night = sim ? 0 : duration(fields.night, "Noite");
      const ifr = sim ? 0 : duration(fields.ifr, "IFR");
      const pic = sim ? 0 : duration(fields.pic, "PIC");
      const copilot = sim ? 0 : duration(fields.copilot, "Co-pilot");
      const dual = sim ? 0 : duration(fields.dual, "Dual");
      const instructor = sim ? 0 : duration(fields.instructor, "Instr.");
      if ([night, ifr, pic, copilot, dual, instructor].some((n) => n > total)) {
        throw new Error("Nenhum tempo pode exceder o total.");
      }
      const off = sim ? null : utc(fields.date, fields.off);
      const onSameDay = sim ? null : utc(fields.date, fields.on);
      const on = onSameDay && off && onSameDay <= off
        ? utc(fields.date, fields.on, true) : onSameDay;
      const count = (s: string) => {
        const value = Number(s);
        if (!Number.isInteger(value) || value < 0 || value > 30) {
          throw new Error("Descolagens e aterragens devem estar entre 0 e 30.");
        }
        return value;
      };

      const payload = {
        date: fields.date,
        departure_airport_name: sim ? null : fields.departure.trim().toUpperCase(),
        arrival_airport_name: sim ? null : fields.arrival.trim().toUpperCase(),
        off_block: off, on_block: on,
        type_of_aircraft: sim ? null : fields.model.trim().toUpperCase(),
        registration: sim ? null : fields.registration.trim().toUpperCase(),
        name_of_pilot_in_command: fields.picName.trim() || null,
        instructor_name: null,
        flight_type: sim ? "SIM" : null,
        fstd_type: sim ? fields.fstdType.trim().toUpperCase() : null,
        fstd_model: sim ? fields.fstdModel.trim().toUpperCase() || null : null,
        total_minutes: sim ? 0 : total,
        day_minutes: sim ? 0 : total - night,
        night_minutes: night,
        single_engine_vfr_minutes: sim || fields.engine !== "SE" ? 0 : total - ifr,
        single_engine_ifr_minutes: sim || fields.engine !== "SE" ? 0 : ifr,
        multi_engine_vfr_minutes: sim || fields.engine !== "ME" ? 0 : total - ifr,
        multi_engine_ifr_minutes: sim || fields.engine !== "ME" ? 0 : ifr,
        multi_pilot_minutes: !sim && fields.multiPilot ? total : 0,
        pilot_in_command_minutes: pic,
        co_pilot_minutes: copilot,
        dual_minutes: dual,
        flight_instructor_minutes: instructor,
        spic_minutes: 0,
        synthetic_training_minutes: sim ? total : 0,
        instructor_synthetic_training_minutes: 0,
        if_time_minutes: ifr,
        takeoffs_day: sim ? 0 : count(fields.takeoffsDay),
        takeoffs_night: sim ? 0 : count(fields.takeoffsNight),
        landings_day: sim ? 0 : count(fields.landingsDay),
        landings_night: sim ? 0 : count(fields.landingsNight),
        remarks_and_endorsements: fields.remarks.trim() || null,
      };

      const response = await fetch("/api/flights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Não foi possível guardar o voo.");
      await onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Erro ao guardar.");
    } finally {
      setSaving(false);
    }
  }

  const sim = fields.simulator;
  return (
    <div className="fs-entry-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="fs-entry-modal" role="dialog" aria-modal="true" aria-labelledby="entry-title">
        <header className="fs-entry-header">
          <div className="fs-entry-icon"><PlaneTakeoff size={23} /></div>
          <h2 id="entry-title">Novo registo</h2>
          <button className="fs-entry-close" type="button" onClick={onClose} aria-label="Fechar">
            <X size={21} />
          </button>
        </header>

        <form onSubmit={save} className="fs-entry-form">
          <div className="fs-entry-kind">
            <button type="button" className={!sim ? "is-active" : ""} onClick={() => update("simulator", false)}>Voo</button>
            <button type="button" className={sim ? "is-active" : ""} onClick={() => update("simulator", true)}>FSTD</button>
          </div>

          <section>
            <h3>1–4 <span>{sim ? "Data" : "Data · locais · aeronave"}</span></h3>
            <div className="fs-entry-grid">
              <Field label="1 · Data" type="date" required value={fields.date} onChange={(v) => update("date", v)} />
              {!sim ? <>
                <Field label="2 · Partida" required value={fields.departure} placeholder="LPPT" onChange={(v) => update("departure", v)} />
                <Field label="2 · UTC" type="time" value={fields.off} onChange={(v) => update("off", v)} />
                <Field label="3 · Chegada" required value={fields.arrival} placeholder="LPCS" onChange={(v) => update("arrival", v)} />
                <Field label="3 · UTC" type="time" value={fields.on} onChange={(v) => update("on", v)} />
                <Field label="4 · Tipo ICAO" required value={fields.model} placeholder="P208" onChange={(v) => update("model", v)} />
                <Field label="4 · Matrícula" required value={fields.registration} placeholder="CS-ECC" onChange={(v) => update("registration", v)} />
              </> : null}
            </div>
          </section>

          {!sim ? <>
            <section>
              <h3>5–7 <span>Tempos · PIC</span></h3>
              <div className="fs-entry-grid">
                <label className="fs-entry-field">
                  <span>5 · Classe</span>
                  <select value={fields.engine} onChange={(e) => update("engine", e.target.value as FormFields["engine"])}>
                    <option value="SE">SE · monomotor</option>
                    <option value="ME">ME · multimotor</option>
                  </select>
                </label>
                <label className="fs-entry-check">
                  <input type="checkbox" checked={fields.multiPilot} onChange={(e) => update("multiPilot", e.target.checked)} />
                  MP · multi-pilot
                </label>
                <Field label="6 · Total (h:mm)" required value={fields.total} onChange={(v) => update("total", v)} />
                <Field label="7 · Nome(s) PIC" value={fields.picName} onChange={(v) => update("picName", v)} />
              </div>
            </section>
            <section>
              <h3>8–9 <span>Descolagens · aterragens · condições</span></h3>
              <div className="fs-entry-grid">
                <Field label="8 · Des. dia" type="number" value={fields.takeoffsDay} onChange={(v) => update("takeoffsDay", v)} />
                <Field label="8 · Des. noite" type="number" value={fields.takeoffsNight} onChange={(v) => update("takeoffsNight", v)} />
                <Field label="8 · Aterr. dia" type="number" value={fields.landingsDay} onChange={(v) => update("landingsDay", v)} />
                <Field label="8 · Aterr. noite" type="number" value={fields.landingsNight} onChange={(v) => update("landingsNight", v)} />
                <Field label="9 · Noite (h:mm)" value={fields.night} onChange={(v) => update("night", v)} />
                <Field label="9 · IFR (h:mm)" value={fields.ifr} onChange={(v) => update("ifr", v)} />
              </div>
            </section>
            <section>
              <h3>10 <span>Função do piloto · h:mm</span></h3>
              <div className="fs-entry-grid">
                <Field label="PIC" value={fields.pic} onChange={(v) => update("pic", v)} />
                <Field label="Co-pilot" value={fields.copilot} onChange={(v) => update("copilot", v)} />
                <Field label="Dual" value={fields.dual} onChange={(v) => update("dual", v)} />
                <Field label="Instr." value={fields.instructor} onChange={(v) => update("instructor", v)} />
              </div>
            </section>
          </> : <section>
            <h3>11 <span>Treino sintético</span></h3>
            <div className="fs-entry-grid">
              <Field label="Tipo FSTD" required value={fields.fstdType} placeholder="FNPT II" onChange={(v) => update("fstdType", v)} />
              <Field label="Modelo FSTD" value={fields.fstdModel} placeholder="A320" onChange={(v) => update("fstdModel", v)} />
              <Field label="Total (h:mm)" required value={fields.total} onChange={(v) => update("total", v)} />
            </div>
          </section>}

          <section>
            <h3>12 <span>Observações</span></h3>
            <label className="fs-entry-field">
              <textarea rows={2} maxLength={600} value={fields.remarks}
                onChange={(e) => update("remarks", e.target.value)} />
            </label>
          </section>
          {error ? <p className="fs-entry-error" role="alert">{error}</p> : null}
          <footer className="fs-entry-footer">
            <button type="button" onClick={onClose} className="fs-entry-cancel">Cancelar</button>
            <button type="submit" disabled={saving} className="fs-entry-save">
              {saving ? "A guardar…" : <><CheckCircle2 size={17} /> Guardar</>}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
