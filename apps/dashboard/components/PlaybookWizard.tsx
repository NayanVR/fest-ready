"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ComponentProps, FormEvent } from "react";
import type { Playbook, PlaybookRow } from "@/lib/types";
import { Pill, post } from "./ui";

const stages = ["Basics", "Scope", "Signals", "Recovery", "Probe", "Review"];
const jsonText = (value: unknown) => value === undefined ? "" : JSON.stringify(value, null, 2);
const lines = (value: string) => value.split("\n").map((line) => line.trim()).filter(Boolean);
const mergeLines = (value: string, additions: string[]) => [...new Set([...lines(value), ...additions])].join("\n");
const duration = "[0-9]+(ms|s|m|h)";
const labelName = /^[A-Za-z_][A-Za-z0-9_]*$/;
const metricName = /^[A-Za-z_:][A-Za-z0-9_:]*$/;
const deliveryProbe = "${SHOP_URL}/api/orders";
const paymentProbe = "${SHOP_URL}/api/payments";
const probeTargets: Record<string, { label: string; body: object }> = {
  [deliveryProbe]: { label: "Shop orders", body: { customerId: "{probe_identity}", mode: "delivery", synthetic: true } },
  [paymentProbe]: { label: "Shop payments", body: { provider: "{value}", customerId: "{probe_identity}", amount: 1000, synthetic: true } },
};
type WizardError = { message: string; reasons?: string[] };
type Readiness = Pick<PlaybookRow, "readiness" | "reasons">;
type ProbeResult = { healthy: boolean; status: number | null; error: string | null };
type Catalog = { flags: string[]; segments: string[]; alerts: string[]; metrics: string[]; labels: string[]; eventFields: string[]; unavailable: string[] };
type Helper = "catalog" | "flags" | "label-values" | "readiness" | "probe";

function useWizardRequest<T>(helper: Helper) {
  const [state, setState] = useState<{ pending?: boolean; data?: T; error?: WizardError }>({});
  const sequence = useRef(0);

  const clear = useCallback(() => {
    sequence.current++;
    setState({});
  }, []);

  const run = useCallback(async (body: unknown) => {
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
  }, [helper]);

  return { ...state, clear, run };
}

function WizardFeedback({ error }: { error?: WizardError }) {
  return error && <div className="notice err" role="alert">
    {error.message}
    {!!error.reasons?.length && <ul className="plain">{error.reasons.map((reason, i) => <li key={i}>{reason}</li>)}</ul>}
  </div>;
}

function Choose({ label, choices, onChoose, labels }: { label: string; choices: string[]; onChoose: (value: string) => void; labels?: Record<string, string> }) {
  return <label>{label}
    <select value="" onChange={(event) => onChoose(event.target.value)}>
      <option value="" disabled>Choose a value</option>
      {choices.map((value) => <option key={value} value={value}>{labels?.[value] ?? value}</option>)}
    </select>
  </label>;
}

function segmentGroups(segments: string[]) {
  const names = new Set(segments);
  const groups = new Map<string, string[]>();
  for (const name of segments) {
    const match = /^(.*-)?([^-]+)-fallback$/.exec(name);
    if (!match) continue;
    const [, prefix = "", value] = match;
    if (!names.has(`${prefix}${value}-recovery`)) continue;
    const key = `${prefix}{value}`;
    const values = groups.get(key) ?? [];
    values.push(value);
    groups.set(key, values);
  }
  return groups;
}

function segmentTemplates(segments: string[], values: string[]) {
  if (!values.length) return [];
  const names = new Set(segments);
  // Replace whole components so a short cohort cannot match part of an unrelated segment name.
  const first = values[0];
  const templates = new Set<string>();
  for (const name of segments) {
    for (let start = name.indexOf(first); start >= 0; start = name.indexOf(first, start + 1)) {
      const before = name.slice(0, start);
      const after = name.slice(start + first.length);
      if ((before && !before.endsWith("-")) || (after && !after.startsWith("-"))) continue;
      if (values.every((value) => names.has(before + value + after))) templates.add(`${before}{value}${after}`);
    }
  }
  return [...templates];
}

function initialFields(p: Omit<Playbook, "version"> | undefined, defaultOwner: string | undefined, editing: boolean) {
  const url = p?.probe.request.url ?? deliveryProbe;
  const configuredBody = p?.probe.request.body;
  const body = configuredBody === undefined && !editing ? probeTargets[url]?.body : configuredBody;
  return {
    id: p?.id ?? "", owner: p?.owner || defaultOwner || "", description: p?.description ?? "",
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
    steps: p?.recovery.steps.join(", ") ?? "5, 10, 50, 100",
    samples: String(p?.recovery.guardrail.min_samples ?? 10), errorRate: String(p?.recovery.guardrail.max_error_rate ?? 0.05),
    consecutive: String(p?.recovery.guardrail.max_consecutive_errors ?? 3),
    window: p?.recovery.guardrail.window ?? "20s", cooldown: p?.recovery.cooldown_after_rollback ?? "60s",
    every: p?.probe.every ?? "10s", healthyFor: p?.probe.healthy_for ?? "60s",
    requestMethod: p?.probe.request.method ?? "POST", url,
    body: jsonText(body), healthyStatus: String(p?.probe.expect.healthy.status ?? 201),
    fallbackStatus: String(p?.probe.expect.fallback_active.status ?? 409),
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

function draftPlaybook(f: Fields, identities: Record<string, string>, autoAdvance?: boolean): Omit<Playbook, "version"> {
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
      auto_advance: autoAdvance,
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

export default function PlaybookWizard({ playbook, draft, defaultOwner, paymentProbeEnabled, onCancel, onSave }: {
  playbook?: Playbook;
  draft?: Omit<Playbook, "version">;
  defaultOwner?: string;
  paymentProbeEnabled?: boolean;
  onCancel: () => void;
  onSave: (saved: Playbook) => void;
}) {
  const initial = playbook ?? draft;
  const [fields, setFields] = useState(() => initialFields(initial, defaultOwner, Boolean(playbook)));
  const [identities, setIdentities] = useState(() => initial?.probe.identities ?? {});
  const [stage, setStage] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<WizardError>();
  const [search, setSearch] = useState("");
  const [metric, setMetric] = useState("");
  const [queryMetric, setQueryMetric] = useState<string>();
  const [probeValue, setProbeValue] = useState("");
  const listId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const review = stage === stages.length - 1;
  const flags = useWizardRequest<{ flags: string[] }>("flags");
  const labelValues = useWizardRequest<{ values: string[] }>("label-values");
  const catalog = useWizardRequest<Catalog>("catalog");
  const readiness = useWizardRequest<Readiness>("readiness");
  const probe = useWizardRequest<ProbeResult>("probe");
  const { run: loadCatalog } = catalog;
  const { run: loadValues, clear: clearValues } = labelValues;
  const selectedLabel = fields.label.trim();
  const selectedMetric = metric.trim();

  useEffect(() => { heading.current?.focus(); }, [stage]);
  useEffect(() => { void loadCatalog({}); }, [loadCatalog]);
  useEffect(() => {
    clearValues();
    if (stage !== 1 || selectedLabel.length > 128 || !labelName.test(selectedLabel)) return;
    if (selectedMetric && (selectedMetric.length > 128 || !metricName.test(selectedMetric))) return;
    const timer = setTimeout(() => {
      void loadValues({ label: selectedLabel, ...(selectedMetric ? { metric: selectedMetric } : {}) });
    }, 300);
    return () => clearTimeout(timer);
  }, [stage, selectedLabel, selectedMetric, clearValues, loadValues]);

  function draftChanged() {
    setError(undefined);
    readiness.clear();
    probe.clear();
  }

  function changeField(name: keyof Fields, value: string) {
    draftChanged();
    if (name === "label") clearValues();
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

  function input(name: keyof Fields, label: string, props: ComponentProps<"input"> = {}, options: string[] = []) {
    const id = `${listId}-${name}`;
    return <label>{label}
      <input required list={options.length ? id : undefined} placeholder={options.length ? "Choose or type" : undefined} {...bind(name)} {...props} />
      {options.length > 0 && <datalist id={id}>{options.map((value) => <option key={value} value={value} />)}</datalist>}
    </label>;
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

  function useProbeTarget(url: string) {
    const target = probeTargets[url];
    if (!target) return;
    draftChanged();
    setFields((current) => {
      const previous = probeTargets[current.url];
      const usePreset = !current.body.trim() || (previous && jsonText(previous.body) === current.body);
      return { ...current, url, requestMethod: "POST", body: usePreset ? jsonText(target.body) : current.body };
    });
  }

  function readDraft() {
    setError(undefined);
    try {
      return draftPlaybook(fields, identities, initial?.recovery.auto_advance);
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
      draft,
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
  const observed = catalog.data?.eventFields ?? [];
  const alerts = catalog.data?.alerts.filter((alert) => !lines(fields.alerts).includes(alert)) ?? [];
  const flagKeys = [...new Set([...(catalog.data?.flags ?? []), ...(flags.data?.flags ?? [])])].sort();
  const segments = catalog.data?.segments ?? [];
  const groups = segmentGroups(segments);
  const groupChoices = [...groups.keys()].filter((key) => {
    const groupValues = groups.get(key)!;
    return values.every((value) => groupValues.includes(value)) &&
      (!fields.fallbackSegment.trim() || fields.fallbackSegment === `${key}-fallback`) &&
      (!fields.recoverySegment.trim() || fields.recoverySegment === `${key}-recovery`) &&
      (!fields.fallbackSegment || !fields.recoverySegment || groupValues.some((value) => !values.includes(value)));
  });
  const templates = segmentTemplates(segments, values);
  const unavailable = catalog.data?.unavailable.filter((source) => {
    const name = source.toLowerCase();
    if (stage === 0) return name.includes("alert");
    if (stage === 2) return name.includes("metric") || name.includes("event");
    return !name.includes("alert");
  }) ?? [];
  const catalogProblem = catalog.error ? "Discovery is unavailable. Enter values manually." :
    unavailable.length ? `Could not load ${unavailable.join(", ")}. Enter missing values manually.` : "";
  const selectedQueryMetric = (queryMetric ?? metric).trim();
  const metricSelector = metricName.test(selectedQueryMetric)
    ? `${selectedQueryMetric}${labelName.test(selectedLabel) ? `{${selectedLabel}="{value}"}` : ""}`
    : "";

  function metricInput(label: string, forQuery = false) {
    const metrics = catalog.data?.metrics ?? [];
    return <label>{label}
      <input list={metrics.length ? `${listId}-metrics` : undefined}
        placeholder={metrics.length ? "Choose or type" : undefined} value={forQuery ? queryMetric ?? metric : metric}
        autoComplete="off" onChange={(event) => {
          if (forQuery) {
            setQueryMetric(event.target.value);
            return;
          }
          clearValues();
          setMetric(event.target.value);
        }} />
      {metrics.length > 0 && <datalist id={`${listId}-metrics`}>{metrics.map((name) => <option key={name} value={name} />)}</datalist>}
    </label>;
  }
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
        {stage <= 2 && (catalog.pending || catalogProblem) && <div className="wizard-discovery" role="status">
          <span>{catalog.pending ? "Loading suggestions…" : catalogProblem}</span>
          {catalog.error && <button type="button" onClick={() => void catalog.run({})}>Retry discovery</button>}
        </div>}
        <div className="wizard-fields" key={stage}>
          {stage === 0 && <>
            {input("id", "Playbook ID", { pattern: "[a-z0-9\\-]+", title: "Lowercase letters, numbers and hyphens", readOnly: Boolean(playbook) })}
            {input("owner", "Owner")}
            <div className="wizard-wide">{area("description", "Description")}</div>
            <div className="wizard-source">
              {alerts.length > 0 && <Choose label="Add an existing alert" choices={alerts} onChoose={(alert) => {
                draftChanged();
                const slug = alert.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
                setFields((current) => ({ ...current, id: current.id || slug, alerts: mergeLines(current.alerts, [alert]) }));
              }} />}
              {area("alerts", "Alert names (one per line)")}
            </div>
            {select("cause", "Cause", { external: "External", internal: "Internal" })}
          </>}
          {stage === 1 && <>
            <div className="wizard-source">
              {input("flag", "Flagsmith flag key", { autoComplete: "off" }, flagKeys)}
              <details className="wizard-options">
                <summary>Search more flags</summary>
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
              </details>
            </div>
            {metricInput("Narrow label values by metric (optional)")}
            <div className="wizard-source">
              {input("label", "Prometheus label", { autoComplete: "off" }, catalog.data?.labels ?? [])}
              {!!selectedLabel && (!fields.dimension || !fields.trait) && <button type="button" onClick={() => {
                draftChanged();
                setFields((current) => ({
                  ...current, dimension: current.dimension || selectedLabel, trait: current.trait || selectedLabel,
                  dimensionField: current.dimensionField || (observed.includes(selectedLabel) ? selectedLabel : ""),
                }));
              }}>Use label for scope</button>}
            </div>
            <div className="wizard-source">
              {input("dimension", "Dimension name", {}, observed)}
              {input("trait", "Flagsmith trait", {}, [...new Set([fields.dimension, selectedLabel].filter(Boolean))])}
            </div>
            <div className="wizard-source wizard-wide">
              {groupChoices.length > 0 && <Choose label="Use an existing segment group" choices={groupChoices}
                labels={Object.fromEntries(groupChoices.map((key) => [key, `${key} · ${groups.get(key)!.join(", ")}`]))}
                onChoose={(key) => {
                  draftChanged();
                  setFields((current) => ({
                    ...current, values: mergeLines(current.values, groups.get(key)!),
                    fallbackSegment: current.fallbackSegment || `${key}-fallback`, recoverySegment: current.recoverySegment || `${key}-recovery`,
                  }));
                }} />}
              {area("values", "Dimension values (one per line)", { rows: 2 })}
              {labelValues.pending && <p className="muted" role="status">Looking up label values…</p>}
              {labelValues.error && <p className="muted" role="status">Could not load label values. Add dimension values above.</p>}
              {labelValues.data && (availableValues.length > 0 ? <div className="row wizard-probe-row">
                <Choose label="Add Prometheus label value" choices={availableValues}
                  onChoose={(value) => changeField("values", mergeLines(fields.values, [value]))} />
                <button type="button" onClick={() => changeField("values", mergeLines(fields.values, availableValues))}>Add all label values</button>
              </div> : <p className="muted" role="status">
                {labelValues.data.values.length ? "All discovered values are included." : "No recent values for this label."}
              </p>)}
            </div>
            {input("fallbackSegment", "Fallback segment template", { placeholder: "{value}-fallback" }, templates.filter((name) => name.endsWith("-fallback")))}
            {input("recoverySegment", "Recovery segment template", { placeholder: "{value}-recovery" }, templates.filter((name) => name.endsWith("-recovery")))}
            {select("normal", "Normal flag state", { true: "Enabled", false: "Disabled" })}
            {input("normalValue", "Normal flag value (optional JSON)", { required: false, placeholder: '"primary"' })}
            {select("fallback", "Fallback flag state", { true: "Enabled", false: "Disabled" })}
            {input("fallbackValue", "Fallback flag value (optional JSON)", { required: false, placeholder: '"secondary"' })}
          </>}
          {stage === 2 && <>
            {catalog.data && !observed.length && <p className="muted wizard-wide">No recent event fields found. Enter the field names your service sends.</p>}
            {([
              ["dimensionField", "Dimension event field"],
              ["identityField", "Identity event field"],
              ["outcomeField", "Outcome event field"],
              ["amountField", "Amount event field (optional)"],
            ] as const).map(([name, label]) => (
              <div className="wizard-source" key={name}>{input(name, label, { required: name !== "amountField", autoComplete: "off" }, observed)}</div>
            ))}
            <div className="wizard-wide">{area("filters", "Canary filter (optional JSON object)", { required: false })}</div>
            <div className="wizard-source wizard-wide">
              {metricInput("Prometheus metric for queries (optional)", true)}
              {metricSelector && <div className="row">
                <button type="button" disabled={!!fields.healthErrors.trim()} onClick={() => changeField("healthErrors", metricSelector)}>Start errors query</button>
                <button type="button" disabled={!!fields.healthTotal.trim()} onClick={() => changeField("healthTotal", metricSelector)}>Start total query</button>
              </div>}
              <p className="muted">Metric selectors are a starting point for PromQL. The recovery guardrail uses events.</p>
            </div>
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
            <label>Probe endpoint
              <select required value={fields.requestMethod === "POST" ? fields.url : ""} onChange={(event) => useProbeTarget(event.target.value)}>
                {fields.requestMethod !== "POST" && <option value="" disabled>Choose a POST endpoint</option>}
                {!probeTargets[fields.url] && <option value={fields.url} disabled>{fields.url}</option>}
                <option value={deliveryProbe}>{probeTargets[deliveryProbe].label}</option>
                {(paymentProbeEnabled || initial?.probe.request.url === paymentProbe) &&
                  <option value={paymentProbe}>{probeTargets[paymentProbe].label}</option>}
              </select>
            </label>
            <p className="muted">The probe sends <code>{fields.requestMethod} {fields.url}</code>.</p>
            {input("every", "Probe interval", { pattern: duration, placeholder: "10s" })}
            {input("healthyFor", "Required healthy duration", { pattern: duration, placeholder: "60s" })}
            <p className="muted wizard-wide">Use a dedicated synthetic identity for each cohort.</p>
            {values.map((value, i) => (
              <label key={i}>Probe identity for {value}
                <input required value={Object.hasOwn(identities, value) ? identities[value] : ""} onChange={(event) => {
                  draftChanged();
                  const identity = event.target.value;
                  setIdentities((current) => ({ ...current, [value]: identity }));
                }} />
              </label>
            ))}
            <div className="wizard-wide">{area("body", "Request body (optional JSON)", { required: false })}</div>
            {input("healthyStatus", "Expected healthy status", { type: "number", min: 100, max: 599 })}
            {input("fallbackStatus", "Expected fallback status", { type: "number", min: 100, max: 599 })}
            <div className="wizard-lookup wizard-wide">
              <p className="muted" id="test-probe-help">Send one synthetic request for the selected cohort. The draft stays unsaved.</p>
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
