"use client";
import { useEffect, useRef, useState } from "react";
import type { ComponentProps, FormEvent } from "react";
import type { Playbook, PlaybookRow } from "@/lib/types";
import { operator, Pill, post } from "./ui";

const stages = ["Basics", "Scope", "Signals", "Recovery", "Probe", "Review"];
const jsonText = (value: unknown) => value === undefined ? "" : JSON.stringify(value, null, 2);
const lines = (value: string) => value.split("\n").map((line) => line.trim()).filter(Boolean);
const duration = "[0-9]+(ms|s|m|h)";
const probeUrl = "${SHOP_URL}/api/orders";
type WizardError = { message: string; reasons?: string[] };
type Readiness = Pick<PlaybookRow, "readiness" | "reasons">;
type ProbeResult = { healthy: boolean; status: number | null; error: string | null };
type Helper = "flags" | "label-values" | "event-fields" | "readiness" | "probe";

function useWizardRequest<T>(helper: Helper) {
  const [state, setState] = useState<{ pending?: boolean; data?: T; error?: WizardError }>({});
  const sequence = useRef(0);

  function clear() {
    sequence.current++;
    setState({});
  }

  async function run(body: unknown) {
    const request = ++sequence.current;
    setState({ pending: true });
    const result = await post(`playbook-wizard/${helper}`, body);
    if (request !== sequence.current) return;
    if (result.ok && result.json) {
      setState({ data: result.json });
    } else {
      setState({
        error: {
          message: result.json?.message ?? result.json?.error ?? `Controller returned HTTP ${result.status}.`,
          reasons: Array.isArray(result.json?.reasons) ? result.json.reasons : undefined,
        },
      });
    }
  }

  return { ...state, clear, run };
}

function WizardFeedback({ error }: { error?: WizardError }) {
  return error && <div className="notice err" role="alert">
    {error.message}
    {!!error.reasons?.length && <ul className="plain">{error.reasons.map((reason, i) => <li key={i}>{reason}</li>)}</ul>}
  </div>;
}

function Choose({ label, choices, onChoose }: { label: string; choices: string[]; onChoose: (value: string) => void }) {
  return <label>{label}
    <select value="" onChange={(event) => onChoose(event.target.value)}>
      <option value="" disabled>Choose a value</option>
      {choices.map((value) => <option key={value}>{value}</option>)}
    </select>
  </label>;
}

function initialFields(p?: Playbook) {
  return {
    id: p?.id ?? "", owner: p?.owner ?? "", description: p?.description ?? "",
    alerts: p?.match.alerts.join("\n") ?? "", cause: p?.match.cause ?? "external",
    dimension: p?.dimension.name ?? "", trait: p?.dimension.trait ?? "",
    label: p?.dimension.label ?? "", values: p?.dimension.values.join("\n") ?? "",
    flag: p?.flag.key ?? "", normal: String(p?.flag.normal.enabled ?? true),
    fallback: String(p?.flag.fallback.enabled ?? false),
    normalValue: jsonText(p?.flag.normal.value), fallbackValue: jsonText(p?.flag.fallback.value),
    fallbackSegment: p?.segments.fallback ?? "", recoverySegment: p?.segments.recovery ?? "",
    dimensionField: p?.events.dimension_field ?? "", identityField: p?.events.identity_field ?? "",
    outcomeField: p?.events.outcome_field ?? "", amountField: p?.events.amount_field ?? "",
    filters: jsonText(p?.events.canary_filter), healthErrors: p?.health?.errors ?? "", healthTotal: p?.health?.total ?? "",
    steps: p?.recovery.steps.join(", ") ?? "",
    samples: String(p?.recovery.guardrail.min_samples ?? ""), errorRate: String(p?.recovery.guardrail.max_error_rate ?? ""),
    consecutive: String(p?.recovery.guardrail.max_consecutive_errors ?? ""),
    window: p?.recovery.guardrail.window ?? "", cooldown: p?.recovery.cooldown_after_rollback ?? "",
    every: p?.probe.every ?? "", healthyFor: p?.probe.healthy_for ?? "",
    requestMethod: p?.probe.request.method ?? "POST", url: p?.probe.request.url ?? probeUrl,
    body: jsonText(p?.probe.request.body), healthyStatus: String(p?.probe.expect.healthy.status ?? ""),
    fallbackStatus: String(p?.probe.expect.fallback_active.status ?? ""),
  };
}

type Fields = ReturnType<typeof initialFields>;

function parseJson(text: string, label: string): unknown {
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} must contain valid JSON.`);
  }
}

function flagState(enabled: string, text: string, label: string) {
  const value = parseJson(text, label);
  if (value !== undefined && typeof value !== "string" && typeof value !== "number")
    throw new Error(`${label} must be a JSON string or number.`);
  return { enabled: enabled === "true", value };
}

function draftPlaybook(f: Fields, identities: Record<string, string>): Omit<Playbook, "version"> {
  const filters = parseJson(f.filters, "Canary filter");
  if (filters !== undefined && (filters === null || typeof filters !== "object" || Array.isArray(filters)))
    throw new Error("Canary filter must be a JSON object.");
  if (Boolean(f.healthErrors.trim()) !== Boolean(f.healthTotal.trim()))
    throw new Error("Enter both PromQL queries or clear both.");
  return {
    id: f.id, owner: f.owner.trim(), description: f.description,
    match: { alerts: lines(f.alerts), cause: f.cause === "internal" ? "internal" : "external" },
    dimension: { name: f.dimension.trim(), trait: f.trait.trim(), label: f.label.trim(), values: lines(f.values) },
    flag: {
      key: f.flag.trim(),
      normal: flagState(f.normal, f.normalValue, "Normal flag value"),
      fallback: flagState(f.fallback, f.fallbackValue, "Fallback flag value"),
    },
    segments: { fallback: f.fallbackSegment.trim(), recovery: f.recoverySegment.trim() },
    recovery: {
      method: "split",
      steps: f.steps.split(",").map(Number),
      guardrail: {
        min_samples: Number(f.samples), max_error_rate: Number(f.errorRate),
        max_consecutive_errors: Number(f.consecutive), window: f.window,
      },
      cooldown_after_rollback: f.cooldown,
    },
    events: {
      dimension_field: f.dimensionField.trim(), identity_field: f.identityField.trim(),
      outcome_field: f.outcomeField.trim(), amount_field: f.amountField.trim() || undefined,
      canary_filter: filters as Record<string, unknown> | undefined,
    },
    health: f.healthErrors.trim() ? { errors: f.healthErrors, total: f.healthTotal } : undefined,
    probe: {
      every: f.every, healthy_for: f.healthyFor,
      identities: Object.fromEntries(lines(f.values).map((value) => [
        value, Object.hasOwn(identities, value) ? identities[value].trim() : "",
      ])),
      request: { method: f.requestMethod.trim(), url: f.url.trim(), body: parseJson(f.body, "Probe request body") },
      expect: { healthy: { status: Number(f.healthyStatus) }, fallback_active: { status: Number(f.fallbackStatus) } },
    },
  };
}

export default function PlaybookWizard({ playbook, onCancel, onSave }: {
  playbook?: Playbook;
  onCancel: () => void;
  onSave: (saved: Playbook) => void;
}) {
  const [fields, setFields] = useState(() => initialFields(playbook));
  const [identities, setIdentities] = useState(() => playbook?.probe.identities ?? {});
  const [stage, setStage] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<WizardError>();
  const [search, setSearch] = useState("");
  const [probeValue, setProbeValue] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const review = stage === stages.length - 1;
  const flags = useWizardRequest<{ flags: string[] }>("flags");
  const labelValues = useWizardRequest<{ values: string[] }>("label-values");
  const eventFields = useWizardRequest<{ fields: string[] }>("event-fields");
  const readiness = useWizardRequest<Readiness>("readiness");
  const probe = useWizardRequest<ProbeResult>("probe");

  useEffect(() => { heading.current?.focus(); }, [stage]);

  function draftChanged() {
    setError(undefined);
    readiness.clear();
    probe.clear();
  }

  function changeField(name: keyof Fields, value: string) {
    draftChanged();
    if (name === "label") labelValues.clear();
    setFields((draft) => ({ ...draft, [name]: value }));
  }

  function bind(name: keyof Fields) {
    return {
      value: fields[name],
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        changeField(name, event.target.value);
      },
    };
  }

  function input(name: keyof Fields, label: string, props: ComponentProps<"input"> = {}) {
    return <label>{label}<input required {...bind(name)} {...props} /></label>;
  }

  function area(name: keyof Fields, label: string, props: ComponentProps<"textarea"> = {}) {
    return <label>{label}<textarea required rows={3} {...bind(name)} {...props} /></label>;
  }

  function select(name: keyof Fields, label: string, options: Record<string, string>) {
    return (
      <label>{label}
        <select {...bind(name)}>
          {Object.entries(options).map(([value, text]) => <option value={value} key={value}>{text}</option>)}
        </select>
      </label>
    );
  }

  function readDraft() {
    setError(undefined);
    try {
      return draftPlaybook(fields, identities);
    } catch (error) {
      setError({ message: (error as Error).message });
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || probe.pending || readiness.pending) return;
    setError(undefined);
    if (!review) {
      setStage(stage + 1);
      return;
    }

    const draft = readDraft();
    if (!draft) return;
    setSaving(true);
    const result = await post(
      playbook ? `playbooks/${encodeURIComponent(playbook.id)}` : "playbooks",
      { ...draft, actor: operator() },
      playbook ? "PUT" : "POST",
    );
    setSaving(false);
    if (result.ok && result.json?.id === draft.id && Number.isInteger(result.json?.version)) {
      onSave(result.json);
    } else {
      setError({
        message: result.json?.message ?? result.json?.error ??
          (result.ok ? "The controller did not return a saved version. Check the playbook list before retrying." : `Save failed (HTTP ${result.status}).`),
        reasons: Array.isArray(result.json?.reasons) ? result.json.reasons : undefined,
      });
    }
  }

  const values = [...new Set(lines(fields.values))];
  const availableValues = labelValues.data?.values.filter((value) => !values.includes(value)) ?? [];
  const selectedProbe = values.includes(probeValue) ? probeValue : "";
  const observed = eventFields.data?.fields ?? [];
  return (
    <section className="card playbook-wizard" aria-labelledby="wizard-title">
      <div className="cardhead">
        <h2 id="wizard-title">{playbook ? "Edit playbook" : "Create playbook"}</h2>
        {playbook && <span className="muted"><code>{playbook.id}</code> · v{playbook.version}</span>}
      </div>
      <ol className="wizard-steps" aria-label="Wizard steps">
        {stages.map((name, i) => (
          <li key={name} className={`step ${i === stage ? "now" : i < stage ? "done" : ""}`} aria-current={i === stage ? "step" : undefined}>{name}</li>
        ))}
      </ol>
      <form className="form" onSubmit={submit}>
        <h3 ref={heading} tabIndex={-1}>{stages[stage]}</h3>
        <div className="wizard-fields" key={stage}>
          {stage === 0 && <>
            {input("id", "Playbook ID", { pattern: "[a-z0-9\\-]+", title: "Lowercase letters, numbers and hyphens", readOnly: Boolean(playbook) })}
            {input("owner", "Owner")}
            <div className="wizard-wide">{area("description", "Description for NuBi")}</div>
            {area("alerts", "Alert names (one per line)")}
            {select("cause", "Cause", { external: "External", internal: "Internal" })}
          </>}
          {stage === 1 && <>
            {input("dimension", "Dimension name")}
            {input("trait", "Flagsmith trait")}
            <div className="wizard-source">
              {input("label", "Prometheus label")}
              <div className="wizard-lookup">
                <button type="button" disabled={labelValues.pending || !fields.label.trim()}
                  onClick={() => void labelValues.run({ label: fields.label.trim() })}>
                  {labelValues.pending ? "Loading…" : "Find label values"}
                </button>
                <WizardFeedback error={labelValues.error} />
                {labelValues.data && (availableValues.length ? <Choose
                  label="Add Prometheus label value" choices={availableValues}
                  onChoose={(value) => changeField("values", [...lines(fields.values), value].join("\n"))}
                /> : <p className="muted" role="status">
                  {labelValues.data.values.length ? "All returned values are included." : "No label values found. Enter values below."}
                </p>)}
              </div>
              {area("values", "Dimension values (one per line)", { rows: 2 })}
            </div>
            <div className="wizard-source">
              {input("flag", "Flagsmith flag key")}
              <div className="wizard-lookup">
                <label>Flag search term
                  <input value={search} onChange={(event) => {
                    setSearch(event.target.value);
                    flags.clear();
                  }} onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    if (search.trim() && !flags.pending) void flags.run({ search: search.trim() });
                  }} />
                </label>
                <button type="button" disabled={flags.pending || !search.trim()}
                  onClick={() => void flags.run({ search: search.trim() })}>
                  {flags.pending ? "Searching…" : "Search Flagsmith flags"}
                </button>
                <WizardFeedback error={flags.error} />
                {flags.data && (flags.data.flags.length ? <Choose
                  label="Select Flagsmith flag" choices={flags.data.flags} onChoose={(value) => changeField("flag", value)}
                /> : <p className="muted" role="status">No matching flags. Enter a key above or try another search.</p>)}
              </div>
            </div>
            {input("fallbackSegment", "Fallback segment template", { placeholder: "{value}-fallback" })}
            {input("recoverySegment", "Recovery segment template", { placeholder: "{value}-recovery" })}
            {select("normal", "Normal flag state", { true: "Enabled", false: "Disabled" })}
            {input("normalValue", "Normal flag value (optional JSON)", { required: false, placeholder: '"primary"' })}
            {select("fallback", "Fallback flag state", { true: "Enabled", false: "Disabled" })}
            {input("fallbackValue", "Fallback flag value (optional JSON)", { required: false, placeholder: '"secondary"' })}
          </>}
          {stage === 2 && <>
            <div className="wizard-lookup wizard-wide">
              <button type="button" disabled={eventFields.pending} onClick={() => void eventFields.run({})}>
                {eventFields.pending ? "Loading…" : "Find observed event fields"}
              </button>
              <WizardFeedback error={eventFields.error} />
              {eventFields.data && !observed.length && <p className="muted" role="status">No recent event fields. Enter field names below.</p>}
            </div>
            {([
              ["dimensionField", "Dimension event field"],
              ["identityField", "Identity event field"],
              ["outcomeField", "Outcome event field"],
              ["amountField", "Amount event field (optional)"],
            ] as const).map(([name, label]) => (
              <div className="wizard-source" key={name}>
                {input(name, label, { required: name !== "amountField" })}
                {observed.length > 0 && <Choose label={`Select observed ${label.toLowerCase()}`}
                  choices={observed} onChoose={(value) => changeField(name, value)} />}
              </div>
            ))}
            <div className="wizard-wide">{area("filters", "Canary filter (optional JSON object)", { required: false })}</div>
            {area("healthErrors", "PromQL errors query (optional)", { required: Boolean(fields.healthTotal.trim()) })}
            {area("healthTotal", "PromQL total query (optional)", { required: Boolean(fields.healthErrors.trim()) })}
          </>}
          {stage === 3 && <>
            {playbook?.recovery.method === "segments" && <p className="banner wizard-wide">
              This playbook uses pre-made segments. Saving it changes recovery to percentage split.
            </p>}
            <div className="wizard-wide">{input("steps", "Step percentages (comma-separated)", { placeholder: "5, 10, 50, 100" })}</div>
            <p className="muted wizard-wide">Percentage split starts at 10% or less, increases at each step, and finishes at 100%.</p>
            {input("samples", "Minimum samples", { type: "number", min: 10 })}
            {input("errorRate", "Maximum error rate (fraction)", { type: "number", min: 0, max: 0.2, step: "any" })}
            {input("consecutive", "Maximum consecutive errors", { type: "number", min: 1 })}
            {input("window", "Guardrail window", { pattern: duration, placeholder: "20s" })}
            {input("cooldown", "Cooldown after rollback", { pattern: duration, placeholder: "60s" })}
          </>}
          {stage === 4 && <>
            <p className="muted wizard-wide">The probe uses <code>POST {probeUrl}</code>.</p>
            {input("every", "Probe interval", { pattern: duration, placeholder: "10s" })}
            {input("healthyFor", "Required healthy duration", { pattern: duration, placeholder: "60s" })}
            {values.map((value, i) => (
              <label key={i}>Probe identity for {value}
                <input required value={Object.hasOwn(identities, value) ? identities[value] : ""} onChange={(event) => {
                  draftChanged();
                  const identity = event.target.value;
                  setIdentities((current) => ({ ...current, [value]: identity }));
                }} />
              </label>
            ))}
            {input("requestMethod", "Request method", { placeholder: "POST" })}
            {input("url", "Request URL", { placeholder: probeUrl })}
            <div className="wizard-wide">{area("body", "Request body (optional JSON)", { required: false })}</div>
            {input("healthyStatus", "Expected healthy status", { type: "number", min: 100, max: 599 })}
            {input("fallbackStatus", "Expected fallback status", { type: "number", min: 100, max: 599 })}
            <div className="wizard-lookup wizard-wide">
              <p className="muted" id="test-probe-help">Send one synthetic shop order for the selected cohort. The draft stays unsaved.</p>
              <div className="row wizard-probe-row">
                <label>Test cohort
                  <select value={selectedProbe} aria-describedby="test-probe-help" onChange={(event) => {
                    setProbeValue(event.target.value);
                    probe.clear();
                  }}>
                    <option value="">Choose a cohort</option>
                    {values.map((value) => <option key={value}>{value}</option>)}
                  </select>
                </label>
                <button type="button" disabled={probe.pending || !selectedProbe}
                  onClick={(event) => {
                    if (!event.currentTarget.form?.reportValidity()) return;
                    const draft = readDraft();
                    if (draft) void probe.run({ playbook: draft, value: selectedProbe });
                  }}>{probe.pending ? "Sending…" : "Send test probe"}</button>
              </div>
              <WizardFeedback error={probe.error} />
              {probe.data && <div className="wizard-result" role="status">
                <Pill kind={probe.data.healthy ? "ok" : "bad"}>{probe.data.healthy ? "Healthy" : "Unhealthy"}</Pill>
                {probe.data.status != null && <span>HTTP {probe.data.status}</span>}
                {probe.data.error && <span>{probe.data.error}</span>}
              </div>}
            </div>
          </>}
          {review && <>
            <dl className="kv wizard-wide">
              <dt>Playbook</dt><dd><code>{fields.id}</code></dd>
              <dt>Owner</dt><dd>{fields.owner}</dd>
              <dt>Alerts</dt><dd>{lines(fields.alerts).join(", ")}</dd>
              <dt>Scope</dt><dd>{fields.dimension} · {values.join(", ")}</dd>
              <dt>Flag</dt><dd><code>{fields.flag}</code></dd>
              <dt>Recovery steps</dt><dd>{fields.steps}</dd>
            </dl>
            <div className="wizard-lookup wizard-wide">
              <button type="button" disabled={saving || readiness.pending} onClick={() => {
                const draft = readDraft();
                if (draft) void readiness.run(draft);
              }}>{readiness.pending ? "Checking…" : "Preview draft readiness"}</button>
              <WizardFeedback error={readiness.error} />
              {readiness.data && <div role="status">
                <Pill kind={readiness.data.readiness === "ready" ? "ok" : "bad"}>{readiness.data.readiness}</Pill>
                {!!readiness.data.reasons.length &&
                  <ul className="plain">{readiness.data.reasons.map((reason, i) => <li key={i}>{reason}</li>)}</ul>}
              </div>}
            </div>
          </>}
        </div>
        <WizardFeedback error={error} />
        <div className="actions wizard-actions">
          <button type="button" disabled={saving} onClick={onCancel}>Cancel</button>
          {stage > 0 && <button type="button" disabled={saving} onClick={() => { setError(undefined); setStage(stage - 1); }}>Back</button>}
          <button className="primary" type="submit" disabled={saving || probe.pending || readiness.pending}>
            {saving ? "Saving…" : review ? (playbook ? "Save changes" : "Create playbook") : "Continue"}
          </button>
        </div>
      </form>
    </section>
  );
}
