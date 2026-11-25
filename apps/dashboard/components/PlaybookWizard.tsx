"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import PlaybookAssistant from "./PlaybookAssistant";
import type { ComponentProps, FormEvent, ReactNode } from "react";
import { SARVAM_VOICE_LANGUAGES, type Playbook, type PlaybookRow } from "@/lib/types";
import { playbookTemplates } from "@/lib/playbook-templates";
import { Pill, post } from "./ui";

const stages = [
  { title: "What fails", lead: "Pick the alert that starts this playbook and describe it for the investigator." },
  { title: "Who is affected", lead: "Choose how customers are grouped. Only the failing group is moved to the fallback." },
  { title: "Safe fallback", lead: "Choose the flag that moves a group to the safe route, and its two states." },
  { title: "Recovery and guardrails", lead: "How traffic returns, and when the controller rolls back on its own." },
  { title: "Probe", lead: "A synthetic request tells the controller when the failing route is healthy again." },
  { title: "Review", lead: "Check the dry run, then save. Nothing changes in Flagsmith until an incident is approved." },
];
type Draft = Omit<Playbook, "version">;
type WizardError = { message: string; reasons?: string[] };
type Readiness = Pick<PlaybookRow, "readiness" | "reasons">;
type ProbeResult = { healthy: boolean; status: number | null; error: string | null };
type Catalog = { flags: string[]; segments: string[]; alerts: string[]; metrics: string[]; labels: string[]; eventFields: string[]; unavailable: string[]; approvalCallAvailable?: boolean };

const jsonText = (value: unknown) => value === undefined ? "" : JSON.stringify(value, null, 2);
const lines = (value: string) => [...new Set(value.split(/[\n,]/).map((line) => line.trim()).filter(Boolean))];
const durationRe = /^[0-9]+(ms|s|m|h)$/;
const indianMobile = /^[6-9][0-9]{9}$/;
const internationalPhone = /^\+[1-9][0-9]{6,14}$/;
const voiceLanguageOptions = Object.fromEntries(SARVAM_VOICE_LANGUAGES.map((language) => [language, language]));
const labelName = /^[A-Za-z_][A-Za-z0-9_]*$/;
const slug = (text: string) => text.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const deliveryProbe = "${SHOP_URL}/api/orders";
const paymentProbe = "${SHOP_URL}/api/payments";
const probeTargets: Record<string, { label: string; body: object }> = {
  [deliveryProbe]: { label: "Shop orders", body: { customerId: "{probe_identity}", mode: "delivery", synthetic: true } },
  [paymentProbe]: { label: "Shop payments", body: { provider: "{value}", customerId: "{probe_identity}", amount: 1000, synthetic: true } },
};
// Generic field-name guesses for the order event; every guess stays editable.
const guessField = (fields: string[], patterns: RegExp[]) => {
  for (const pattern of patterns) {
    const hit = fields.find((name) => pattern.test(name));
    if (hit) return hit;
  }
  return "";
};
const identityPatterns = [/^(customer|user|account|client|member|buyer)[-_]?id$/i, /^(customer|user|account|client)$/i];
const outcomePatterns = [/^outcome$/i, /^(result|status)$/i];
const amountPatterns = [/^amount$/i, /^(total|price|value)$/i];

function useWizardRequest<T>(helper: string) {
  const [state, setState] = useState<{ pending?: boolean; data?: T; error?: WizardError }>({});
  const sequence = useRef(0);
  const clear = useCallback(() => { sequence.current++; setState({}); }, []);
  const run = useCallback(async (body: unknown) => {
    const request = ++sequence.current;
    setState({ pending: true });
    const result = await post(`playbook-wizard/${helper}`, body);
    if (request !== sequence.current) return;
    if (result.ok && result.json) setState({ data: result.json });
    else setState({ error: {
      message: result.json?.message ?? result.json?.error ?? `Controller returned HTTP ${result.status}.`,
      reasons: Array.isArray(result.json?.reasons) ? result.json.reasons : undefined,
    } });
  }, [helper]);
  return { ...state, clear, run };
}

function WizardFeedback({ error }: { error?: WizardError }) {
  return error && <div className="notice err" role="alert">
    {error.message}
    {!!error.reasons?.length && <ul className="plain">{error.reasons.map((reason, i) => <li key={i}>{reason}</li>)}</ul>}
  </div>;
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

function initialFields(p: Draft | undefined, defaultOwner: string | undefined, editing: boolean) {
  const url = p?.probe.request.url ?? deliveryProbe;
  const configuredBody = p?.probe.request.body;
  const body = configuredBody === undefined && !editing ? probeTargets[url]?.body : configuredBody;
  return {
    id: p?.id ?? "", owner: p?.owner || defaultOwner || "", description: p?.description ?? "",
    alerts: p?.match.alerts.join("\n") ?? "", cause: (p?.match.cause ?? "external") as string,
    dimension: p?.dimension.name ?? "", trait: p?.dimension.trait ?? "",
    label: p?.dimension.label ?? "", values: p?.dimension.values.join("\n") ?? "",
    flag: p?.flag.key ?? "", normal: String(p?.flag.normal.enabled ?? true),
    fallback: String(p?.flag.fallback.enabled ?? false),
    normalValue: jsonText(p?.flag.normal.value), fallbackValue: jsonText(p?.flag.fallback.value),
    fallbackSegment: p?.segments.fallback ?? "{value}-fallback", recoverySegment: p?.segments.recovery ?? "{value}-recovery",
    dimensionField: p?.events.dimension_field ?? "", identityField: p?.events.identity_field ?? "",
    outcomeField: p?.events.outcome_field ?? "", amountField: p?.events.amount_field ?? "",
    filters: jsonText(p?.events.canary_filter), healthErrors: p?.health?.errors ?? "", healthTotal: p?.health?.total ?? "",
    steps: p?.recovery.steps.join(", ") ?? "5, 10, 50, 100", autoAdvance: String(p?.recovery.auto_advance ?? true),
    samples: String(p?.recovery.guardrail.min_samples ?? 10), errorRate: String(p?.recovery.guardrail.max_error_rate ?? 0.05),
    consecutive: String(p?.recovery.guardrail.max_consecutive_errors ?? 3),
    window: p?.recovery.guardrail.window ?? "20s", cooldown: p?.recovery.cooldown_after_rollback ?? "60s",
    approvalCall: p?.approval_call ? "on" : "off", approvalPhone: p?.approval_call?.phone_number ?? "",
    approvalDelay: String(p?.approval_call?.delay_minutes ?? 5), approvalLanguage: p?.approval_call?.language ?? "English",
    every: p?.probe.every ?? "10s", healthyFor: p?.probe.healthy_for ?? "60s",
    requestMethod: p?.probe.request.method ?? "POST", url,
    body: jsonText(body), healthyStatus: String(p?.probe.expect.healthy.status ?? 201),
    fallbackStatus: String(p?.probe.expect.fallback_active.status ?? 409),
  };
}
type Fields = ReturnType<typeof initialFields>;
type Key = keyof Fields;

function parseJson(text: string, label: string): unknown {
  if (!text.trim()) return undefined;
  try { return JSON.parse(text); } catch { throw new Error(`${label} is not valid JSON.`); }
}

function flagState(enabled: string, text: string, label: string) {
  const value = parseJson(text, label);
  if (value !== undefined && typeof value !== "string" && typeof value !== "number")
    throw new Error(`${label} must be a JSON string or number.`);
  return { enabled: enabled === "true", value };
}

function approvalCall(f: Fields): Playbook["approval_call"] {
  if (f.approvalCall !== "on") return undefined;
  const enteredPhone = f.approvalPhone.trim();
  const phone_number = indianMobile.test(enteredPhone) ? `+91${enteredPhone}` : enteredPhone;
  if (!internationalPhone.test(phone_number))
    throw new Error("Enter a mobile number with its country code or a 10-digit Indian mobile number.");
  const delay_minutes = Number(f.approvalDelay);
  if (!Number.isInteger(delay_minutes) || delay_minutes < 1 || delay_minutes > 1440)
    throw new Error("Enter an approval wait time from 1 to 1440 minutes.");
  const language = SARVAM_VOICE_LANGUAGES.find((language) => language === f.approvalLanguage);
  if (!language) throw new Error("Choose a language for the approval call.");
  return { phone_number, delay_minutes, language };
}

function draftPlaybook(f: Fields, identities: Record<string, string>, includeApprovalCall = true): Draft {
  const filters = parseJson(f.filters, "Canary filter");
  if (filters !== undefined && (filters === null || typeof filters !== "object" || Array.isArray(filters)))
    throw new Error("Canary filter must be a JSON object.");
  return {
    id: f.id.trim(), owner: f.owner.trim(), description: f.description.trim(),
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
      steps: f.steps.split(",").map((step) => Number(step.trim())),
      auto_advance: f.autoAdvance === "true",
      guardrail: {
        min_samples: Number(f.samples), max_error_rate: Number(f.errorRate),
        max_consecutive_errors: Number(f.consecutive), window: f.window.trim(),
      },
      cooldown_after_rollback: f.cooldown.trim(),
    },
    ...(includeApprovalCall && { approval_call: approvalCall(f) }),
    events: {
      dimension_field: f.dimensionField.trim(), identity_field: f.identityField.trim(),
      outcome_field: f.outcomeField.trim(), amount_field: f.amountField.trim() || undefined,
      canary_filter: filters as Record<string, unknown> | undefined,
    },
    health: f.healthErrors.trim() ? { errors: f.healthErrors, total: f.healthTotal } : undefined,
    probe: {
      every: f.every.trim(), healthy_for: f.healthyFor.trim(),
      identities: Object.fromEntries(lines(f.values).map((value) => [value, (identities[value] ?? "").trim()])),
      request: { method: f.requestMethod.trim(), url: f.url.trim(), body: parseJson(f.body, "Probe request body") },
      expect: { healthy: { status: Number(f.healthyStatus) }, fallback_active: { status: Number(f.fallbackStatus) } },
    },
  };
}

// Plain-language problems for one step; Next stays blocked until the list is empty.
function problems(stage: number, f: Fields, identities: Record<string, string>, takenIds: string[]): string[] {
  const out: string[] = [];
  const need = (value: string, text: string) => { if (!value.trim()) out.push(text); };
  const values = lines(f.values);
  const json = (text: string, label: string) => { try { parseJson(text, label); } catch (e) { out.push((e as Error).message); } };
  if (stage === 0) {
    if (!/^[a-z0-9-]+$/.test(f.id)) out.push("Playbook ID can use only lowercase letters, numbers and hyphens.");
    if (takenIds.includes(f.id)) out.push(`A playbook called ${f.id} already exists. Choose another ID.`);
    need(f.owner, "Add an owner.");
    need(f.description, "Add a description so the investigator knows what this playbook is for.");
    if (!lines(f.alerts).length) out.push("Add at least one alert.");
  }
  if (stage === 1) {
    need(f.dimension, "Choose how customers are grouped.");
    if (f.label && !labelName.test(f.label.trim())) out.push("The Prometheus label can use only letters, numbers and underscores.");
    need(f.label, "Add the Prometheus label for the group.");
    need(f.trait, "Add the Flagsmith trait for the group.");
    need(f.dimensionField, "Add the order-event field that holds the group.");
    if (!values.length) out.push("Add at least one value.");
  }
  if (stage === 2) {
    need(f.flag, "Choose a flag.");
    if (f.normal === f.fallback && f.normalValue.trim() === f.fallbackValue.trim()) out.push("The normal and fallback states must differ.");
    for (const [name, text] of [["fallbackSegment", "Fallback"], ["recoverySegment", "Recovery"]] as const)
      if (!f[name].includes("{value}")) out.push(`${text} segment pattern must contain {value}.`);
    json(f.normalValue, "Normal flag value");
    json(f.fallbackValue, "Fallback flag value");
  }
  if (stage === 3) {
    const steps = f.steps.split(",").map((step) => Number(step.trim()));
    if (steps.some((step) => !Number.isInteger(step))) out.push("Steps must be whole percentages separated by commas.");
    else {
      if (steps[0] > 10) out.push("The first step can be at most 10%.");
      if (steps.at(-1) !== 100) out.push("The last step must be 100%.");
      if (steps.some((step, i) => i > 0 && step <= steps[i - 1])) out.push("Each step must be larger than the one before.");
    }
    if (!(Number.isInteger(Number(f.samples)) && Number(f.samples) >= 10)) out.push("Minimum samples must be a whole number, 10 or more.");
    if (!(Number(f.errorRate) > 0 && Number(f.errorRate) <= 0.2)) out.push("Maximum error rate must be above 0 and at most 0.2 (20%).");
    if (!(Number.isInteger(Number(f.consecutive)) && Number(f.consecutive) >= 1)) out.push("Maximum consecutive errors must be 1 or more.");
    if (!durationRe.test(f.window.trim())) out.push("Window must be a duration such as 20s or 1m.");
    if (!durationRe.test(f.cooldown.trim())) out.push("Cooldown must be a duration such as 60s.");
    try { approvalCall(f); } catch (e) { out.push((e as Error).message); }
    need(f.identityField, "Add the order-event field that identifies the customer.");
    need(f.outcomeField, "Add the order-event field that holds the outcome.");
    json(f.filters, "Canary filter");
    if (Boolean(f.healthErrors.trim()) !== Boolean(f.healthTotal.trim())) out.push("Fill both PromQL queries or clear both.");
  }
  if (stage === 4) {
    if (!durationRe.test(f.every.trim())) out.push("Probe interval must be a duration such as 10s.");
    if (!durationRe.test(f.healthyFor.trim())) out.push("Healthy duration must be a duration such as 60s.");
    const missing = values.filter((value) => !identities[value]?.trim());
    if (missing.length) out.push(`Add a synthetic identity for ${missing.join(", ")}.`);
    for (const [name, text] of [["healthyStatus", "Healthy"], ["fallbackStatus", "Fallback"]] as const) {
      const status = Number(f[name]);
      if (!(Number.isInteger(status) && status >= 100 && status <= 599)) out.push(`${text} status must be an HTTP status between 100 and 599.`);
    }
    json(f.body, "Probe request body");
  }
  return out;
}

const Hint = ({ from }: { from?: string }) => from ? <span className="wz-auto">Auto-filled from {from}</span> : null;

export default function PlaybookWizard({ playbook, existing = [], defaultOwner, paymentProbeEnabled, onCancel, onSave }: {
  playbook?: Playbook;
  existing?: PlaybookRow[];
  defaultOwner?: string;
  paymentProbeEnabled?: boolean;
  onCancel: () => void;
  onSave: (saved: Playbook) => void;
}) {
  const editing = Boolean(playbook);
  const [template, setTemplate] = useState(0);
  const [fields, setFields] = useState(() => initialFields(playbook ?? playbookTemplates[0].draft, defaultOwner, editing));
  const [identities, setIdentities] = useState<Record<string, string>>(() => playbook?.probe.identities ?? {});
  // Which fields hold a value the wizard chose, and where it came from. Editing a field removes its hint.
  const [auto, setAuto] = useState<Partial<Record<Key | `id:${string}`, string>>>(() => editing ? {} : {
    owner: "your sign-in", description: "template", normal: "template", fallback: "template",
    fallbackSegment: "platform default", recoverySegment: "platform default", steps: "platform defaults",
    samples: "platform defaults", errorRate: "platform defaults", consecutive: "platform defaults", window: "platform defaults",
    cooldown: "platform defaults", autoAdvance: "platform defaults", every: "platform defaults", healthyFor: "platform defaults",
    url: "template", body: "template", healthyStatus: "template", fallbackStatus: "template",
  });
  const [stage, setStage] = useState(0);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<WizardError>();
  const [newValue, setNewValue] = useState("");
  const [probeValue, setProbeValue] = useState("");
  const [wide, setWide] = useState(true);
  const heading = useRef<HTMLHeadingElement>(null);
  const discovered = useRef(false);
  const review = stage === stages.length - 1;
  const labelValues = useWizardRequest<{ values: string[] }>("label-values");
  const catalog = useWizardRequest<Catalog>("catalog");
  const readiness = useWizardRequest<Readiness>("readiness");
  const probe = useWizardRequest<ProbeResult>("probe");
  const { run: loadCatalog } = catalog;
  const { run: loadValues } = labelValues;
  const values = lines(fields.values);
  const takenIds = existing.map((p) => p.id).filter((id) => id !== playbook?.id);
  const stageProblems = problems(stage, fields, identities, takenIds);

  useEffect(() => { setWide(window.matchMedia("(min-width: 1100px)").matches); }, []);
  useEffect(() => { if (stage) heading.current?.focus(); }, [stage]);
  useEffect(() => { void loadCatalog({}); }, [loadCatalog]);
  useEffect(() => {
    const label = fields.label.trim();
    if (!labelName.test(label)) return;
    const timer = setTimeout(() => void loadValues({ label }), 300);
    return () => clearTimeout(timer);
  }, [fields.label, loadValues]);

  // Fill only the fields that are still empty (or still hold an earlier auto-fill), and record the source.
  const fill = useCallback((patch: Partial<Fields>, source: string, force = false) => {
    const keys = (Object.keys(patch) as Key[]).filter((key) => patch[key] && (force || !fields[key].trim() || auto[key]));
    if (!keys.length) return;
    setFields((current) => ({ ...current, ...Object.fromEntries(keys.map((key) => [key, patch[key]])) }));
    setAuto((current) => ({ ...current, ...Object.fromEntries(keys.map((key) => [key, source])) }));
  }, [auto, fields]);

  // First pass over live data for a new playbook: alert, ID, grouping, values and event fields.
  const data = catalog.data;
  useEffect(() => {
    if (!data || editing || discovered.current) return;
    discovered.current = true;
    const used = new Set(existing.flatMap((p) => p.match.alerts));
    const alert = data.alerts.find((name) => !used.has(name)) ?? data.alerts[0];
    let id = alert ? slug(alert) : "";
    for (let n = 2; id && takenIds.includes(id); n++) id = `${slug(alert!)}-${n}`;
    if (alert) fill({ alerts: alert, id }, "Prometheus alert rules");
    const fieldsSeen = data.eventFields;
    const ev = { identityField: guessField(fieldsSeen, identityPatterns), outcomeField: guessField(fieldsSeen, outcomePatterns), amountField: guessField(fieldsSeen, amountPatterns) };
    fill(ev, "recent order events");
    void (async () => {
      // A grouping is likely when its label values match the names of existing Flagsmith segments.
      let best = { name: "", score: 0, values: [] as string[] };
      for (const name of dimensionCandidates(data).slice(0, 8)) {
        const result = await post("playbook-wizard/label-values", { label: name });
        const found: string[] = result.ok ? result.json?.values ?? [] : [];
        const score = found.filter((value) => segmentTemplates(data.segments, [value]).length).length;
        if (score > best.score) best = { name, score, values: found };
      }
      if (best.name) chooseDimension(best.name, "labels that match Flagsmith segments");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // When the label's values load, add them all if the user has not typed their own.
  useEffect(() => {
    const found = labelValues.data?.values;
    if (!found?.length || editing) return;
    if (!fields.values.trim() || auto.values) {
      fill({ values: found.join("\n") }, `recent Prometheus values of ${fields.label}`, true);
      const reused: Record<string, string> = {};
      for (const value of found) {
        const owner = existing.find((p) => p.probe?.identities?.[value]);
        if (owner && !identities[value]) reused[value] = owner.probe.identities[value];
      }
      if (Object.keys(reused).length) {
        setIdentities((current) => ({ ...reused, ...current }));
        setAuto((current) => ({ ...current, ...Object.fromEntries(Object.keys(reused).map((value) => [`id:${value}`, "an existing playbook"])) }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labelValues.data]);

  function dimensionCandidates(c: Catalog | undefined) {
    if (!c) return [];
    const skip = new Set([fields.identityField, fields.outcomeField, fields.amountField].filter(Boolean));
    return c.eventFields.filter((name) => c.labels.includes(name) && !skip.has(name) &&
      !identityPatterns.some((p) => p.test(name)) && !outcomePatterns.some((p) => p.test(name)) && !amountPatterns.some((p) => p.test(name)));
  }

  function chooseDimension(name: string, source: string) {
    draftChanged();
    if (auto.values) setFields((current) => ({ ...current, values: "" }));
    fill({ dimension: name, trait: name, label: name, dimensionField: name }, source, true);
  }

  function draftChanged() {
    setError(undefined);
    readiness.clear();
    probe.clear();
  }

  function changeField(name: Key, value: string) {
    draftChanged();
    setAuto((current) => { const next = { ...current }; delete next[name]; return next; });
    setFields((draft) => ({ ...draft, [name]: value }));
  }

  function field(name: Key, label: string, opts: { help?: ReactNode; options?: string[]; props?: ComponentProps<"input">; area?: boolean } = {}) {
    const id = `wz-${name}`;
    const listId = opts.options?.length ? `${id}-list` : undefined;
    const common = { id, value: fields[name], "aria-describedby": opts.help ? `${id}-help` : undefined,
      onChange: (event: { target: { value: string } }) => changeField(name, event.target.value) };
    return <div className="wz-field">
      <label htmlFor={id}>{label}</label>
      {opts.area ? <textarea rows={3} {...common} /> : <input autoComplete="off" list={listId} {...common} {...opts.props} />}
      {listId && <datalist id={listId}>{opts.options!.map((value) => <option key={value} value={value} />)}</datalist>}
      {(opts.help || auto[name]) && <p className="wz-help" id={`${id}-help`}>{opts.help} <Hint from={auto[name]} /></p>}
    </div>;
  }

  function choice(name: Key, label: string, options: Record<string, string>) {
    return <div className="wz-field">
      <label htmlFor={`wz-${name}`}>{label}</label>
      <select id={`wz-${name}`} value={fields[name]} onChange={(event) => changeField(name, event.target.value)}>
        {Object.entries(options).map(([value, text]) => <option value={value} key={value}>{text}</option>)}
      </select>
      {auto[name] && <p className="wz-help"><Hint from={auto[name]} /></p>}
    </div>;
  }

  function chooseTemplate(index: number) {
    setTemplate(index);
    const t = playbookTemplates[index].draft;
    fill({ normal: String(t.flag.normal.enabled), fallback: String(t.flag.fallback.enabled), description: t.description }, "template");
  }

  function pickProbeTarget(url: string) {
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
    try { return draftPlaybook(fields, identities); } catch (e) { setError({ message: (e as Error).message }); }
  }

  // An AI draft fills every step, then jumps to Review so the readiness dry run checks it. The human still saves.
  function applyAI(d: object) {
    const draft = { ...(d as Draft), approval_call: undefined };
    setFields((current) => ({
      ...initialFields(draft, defaultOwner, true),
      approvalCall: current.approvalCall,
      approvalPhone: current.approvalPhone,
      approvalDelay: current.approvalDelay,
      approvalLanguage: current.approvalLanguage,
    }));
    setIdentities(draft.probe?.identities ?? {});
    setAuto({});
    setError(undefined);
    setTried(false);
    setStage(stages.length - 1);
    void readiness.run(draft);
  }

  function go(next: number) {
    setError(undefined);
    setTried(false);
    setStage(next);
    if (next === stages.length - 1) {
      try { void readiness.run(draftPlaybook(fields, identities)); } catch { /* shown on review */ }
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || probe.pending) return;
    if (!review) {
      if (stageProblems.length) { setTried(true); return; }
      go(stage + 1);
      return;
    }
    const draft = readDraft();
    if (!draft) return;
    setSaving(true);
    const result = await post(playbook ? `playbooks/${encodeURIComponent(playbook.id)}` : "playbooks", draft, playbook ? "PUT" : "POST");
    setSaving(false);
    if (result.ok && result.json?.id === draft.id && Number.isInteger(result.json?.version)) onSave(result.json);
    else setError({
      message: result.json?.message ?? result.json?.error ??
        (result.ok ? "The controller did not return a saved version. Check the playbook list before retrying." : `Save failed (HTTP ${result.status}).`),
      reasons: Array.isArray(result.json?.reasons) ? result.json.reasons : undefined,
    });
  }

  let preview = "";
  let previewError = "";
  try { preview = JSON.stringify(draftPlaybook(fields, identities), null, 2).replace(/\[\s+([^[\]{}]*?)\s+\]/g, (_, items: string) => `[${items.split(/,\s+/).join(", ")}]`); } catch (e) { previewError = (e as Error).message; }
  const blockedAt = stages.findIndex((_, i) => i < stages.length - 1 && problems(i, fields, identities, takenIds).length);
  const segments = data?.segments ?? [];
  const templates = segmentTemplates(segments, values);
  const candidates = dimensionCandidates(data);
  const discoveredValues = (labelValues.data?.values ?? []).filter((value) => !values.includes(value));
  const unavailable = data?.unavailable ?? [];
  const selectedProbe = values.includes(probeValue) ? probeValue : values[0] ?? "";
  const steps = fields.steps.split(",").map((s) => s.trim()).filter(Boolean);

  return (
    <section className="card playbook-wizard" aria-labelledby="wizard-title">
      <div className="cardhead">
        <h2 id="wizard-title">{playbook ? `Edit ${playbook.id}` : "New playbook"}</h2>
        {playbook && <span className="muted">v{playbook.version} · saving makes v{playbook.version + 1}</span>}
        <span className="sp" />
        <span className="muted" role="status">
          {catalog.pending ? "Reading live data…" : catalog.error ? "Live data unavailable, enter values by hand" :
            unavailable.length ? `Could not read ${unavailable.join(", ")}` : data ? "Suggestions from live Flagsmith, Prometheus and order events" : ""}
        </span>
        {catalog.error && <button type="button" onClick={() => void catalog.run({})}>Retry</button>}
      </div>
      <ol className="wz-progress" aria-label="Steps">
        {stages.map(({ title }, i) => {
          const reachable = i < stage || (i > stage && (blockedAt < 0 || i <= blockedAt));
          return <li key={title} className={i === stage ? "now" : i < stage ? "done" : ""} aria-current={i === stage ? "step" : undefined}>
            <button type="button" className="link" disabled={!reachable || i === stage} onClick={() => go(i)}>{title}</button>
          </li>;
        })}
      </ol>
      <div className="wz-layout">
        <form className="wz-form" onSubmit={submit} noValidate>
          <div className="wz-stagehead">
            <h3 ref={heading} tabIndex={-1}>{stages[stage].title}</h3>
            <p className="muted">{stages[stage].lead}</p>
          </div>

          {stage === 0 && <div className="wz-grid">
            {!editing && <fieldset className="wz-wide wz-options">
              <legend>Start from</legend>
              {playbookTemplates.map((t, i) => <label key={t.title} className={`wz-option ${template === i ? "on" : ""}`}>
                <input type="radio" name="template" checked={template === i} onChange={() => chooseTemplate(i)} />
                <span><strong>{t.title}</strong><span className="muted">{t.description}</span></span>
              </label>)}
            </fieldset>}
            <div className="wz-wide">{field("alerts", "Alert that starts it", {
              options: data?.alerts, area: lines(fields.alerts).length > 1,
              help: "One alert, or several separated by commas.",
            })}</div>
            {field("id", "Playbook ID", { props: { readOnly: editing }, help: "Lowercase letters, numbers and hyphens." })}
            {field("owner", "Owner")}
            <div className="wz-wide">{field("description", "Description for the investigator", { area: true, help: "NuBi reads this when it proposes the playbook. Say what the fallback does, not what the cause is." })}</div>
            {choice("cause", "Cause it handles", { external: "External (a partner or provider)", internal: "Internal (our own service)" })}
          </div>}

          {stage === 1 && <div className="wz-grid">
            {candidates.length > 0 && <fieldset className="wz-wide wz-options wz-chips">
              <legend>Group customers by</legend>
              {candidates.map((name) => <label key={name} className={`wz-chip ${fields.dimension === name ? "on" : ""}`}>
                <input type="radio" name="dimension" checked={fields.dimension === name} onChange={() => chooseDimension(name, "your choice")} />{name}
              </label>)}
              <p className="wz-help wz-wide">Fields seen both in recent order events and in Prometheus labels. <Hint from={auto.dimension} /></p>
            </fieldset>}
            <div className="wz-wide wz-field">
              <span className="wz-label" id="wz-values-label">Values</span>
              <div className="wz-values" aria-labelledby="wz-values-label">
                {values.map((value) => {
                  const covered = !segments.length || segmentTemplates(segments, [value]).length > 0;
                  return <span key={value} className="wz-value">{value}{!covered && <span className="wz-warn"> no segment yet</span>}
                    <button type="button" className="link" aria-label={`Remove ${value}`} onClick={() => changeField("values", values.filter((v) => v !== value).join("\n"))}>Remove</button>
                  </span>;
                })}
                <input aria-label="Add a value" placeholder="Add a value" value={newValue} onChange={(e) => setNewValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" || !newValue.trim()) return;
                    e.preventDefault();
                    changeField("values", [...values, ...lines(newValue)].join("\n"));
                    setNewValue("");
                  }} />
              </div>
              <p className="wz-help">
                {labelValues.pending ? "Reading recent values…" : discoveredValues.length ? <>Also seen recently: {discoveredValues.map((value) =>
                  <button key={value} type="button" className="link wz-add" onClick={() => changeField("values", [...values, value].join("\n"))}>{value}</button>)}</> :
                  "Press Enter to add a value."} <Hint from={auto.values} />
              </p>
            </div>
            <details className="wz-wide wz-more" open={!(fields.label && fields.trait && fields.dimension && fields.dimensionField)}>
              <summary>Where {fields.dimension || "the group"} lives: Prometheus label <code>{fields.label || "?"}</code>, Flagsmith trait <code>{fields.trait || "?"}</code>, event field <code>{fields.dimensionField || "?"}</code></summary>
              <div className="wz-grid">
                {field("label", "Prometheus label", { options: data?.labels })}
                {field("trait", "Flagsmith trait")}
                {field("dimension", "Name shown to operators")}
                {field("dimensionField", "Order-event field", { options: data?.eventFields })}
              </div>
            </details>
          </div>}

          {stage === 2 && <div className="wz-grid">
            {(data?.flags.length ?? 0) > 0 && (data!.flags.length <= 12) && <fieldset className="wz-wide wz-options wz-chips">
              <legend>Flag</legend>
              {data!.flags.map((key) => <label key={key} className={`wz-chip ${fields.flag === key ? "on" : ""}`}>
                <input type="radio" name="flag" checked={fields.flag === key} onChange={() => changeField("flag", key)} />{key}
              </label>)}
              <p className="wz-help wz-wide">Flags in your Flagsmith project.</p>
            </fieldset>}
            <div className="wz-wide">{field("flag", data?.flags.length ? "Or type a flag key" : "Flag key", { options: data?.flags })}</div>
            {choice("normal", "Normal state", { true: "On", false: "Off" })}
            {choice("fallback", "Fallback state", { true: "On", false: "Off" })}
            {field("fallbackSegment", "Fallback segment pattern", { options: templates.filter((t) => t.endsWith("-fallback")),
              help: <>Must contain {"{value}"}. {values[0] && <>For {values[0]}: <code>{fields.fallbackSegment.replaceAll("{value}", values[0])}</code>{segments.length > 0 && (segments.includes(fields.fallbackSegment.replaceAll("{value}", values[0])) ? " exists." : " not in Flagsmith yet.")}</>}</> })}
            {field("recoverySegment", "Recovery segment pattern", { options: templates.filter((t) => t.endsWith("-recovery")),
              help: <>Must contain {"{value}"}. {values[0] && <>For {values[0]}: <code>{fields.recoverySegment.replaceAll("{value}", values[0])}</code>{segments.length > 0 && (segments.includes(fields.recoverySegment.replaceAll("{value}", values[0])) ? " exists." : " not in Flagsmith yet.")}</>}</> })}
            <details className="wz-wide wz-more">
              <summary>Flag values (only for flags that carry a value)</summary>
              <div className="wz-grid">
                {field("normalValue", "Normal value (JSON)", { props: { placeholder: '"primary"' } })}
                {field("fallbackValue", "Fallback value (JSON)", { props: { placeholder: '"secondary"' } })}
              </div>
            </details>
          </div>}

          {stage === 3 && <div className="wz-grid">
            <div className="wz-wide">{field("steps", "Traffic steps (%)", { help: <>First step 10% or less, each step larger, last 100%. Plan: {steps.map((s) => `${s}%`).join(" → ")}</> })}</div>
            {field("samples", "Minimum orders per step", { props: { type: "number", min: 10, inputMode: "numeric" }, help: "Platform limit: 10 or more." })}
            {field("errorRate", "Maximum error rate", { props: { type: "number", min: 0, max: 0.2, step: 0.01 }, help: <>Fraction, above 0 and at most 0.2. Now {Number.isFinite(Number(fields.errorRate)) ? `${(Number(fields.errorRate) * 100).toFixed(1)}%` : "–"}.</> })}
            {field("consecutive", "Errors in a row that roll back", { props: { type: "number", min: 1 }, help: "Platform limit: 1 or more." })}
            {field("window", "Guardrail window", { help: "A duration such as 20s or 1m." })}
            {field("cooldown", "Wait after a rollback", { help: "A duration such as 60s." })}
            {choice("autoAdvance", "After the first step", { true: "Advance on its own when the guardrail passes", false: "Wait for an operator at every step" })}
            <p className="wz-wide wz-note">The operator always approves the fallback and starts recovery. Rollback is always automatic.</p>
            <h4 className="wz-wide">Approval reminder</h4>
            <p className="wz-wide wz-help">Sarvam can call once for each overdue fallback or recovery approval. Review and approve in FestReady.</p>
            {choice("approvalCall", "Call if approval is overdue", { off: "Off", on: "On" })}
            {fields.approvalCall === "on" && <>
              {data?.approvalCallAvailable === false && <p className="wz-wide wz-help">Calling requires Sarvam Voice Agents setup on the controller.</p>}
              {field("approvalDelay", "Wait time (minutes)", { props: { type: "number", min: 1, max: 1440, step: 1 } })}
              {field("approvalPhone", "Mobile number", { props: { type: "tel", autoComplete: "tel" }, help: "Use a country code such as +91 or enter a 10-digit Indian mobile number. Leave out spaces." })}
              {choice("approvalLanguage", "Call language", voiceLanguageOptions)}
            </>}
            <h4 className="wz-wide">How the guardrail reads your orders</h4>
            {field("identityField", "Customer field", { options: data?.eventFields })}
            {field("outcomeField", "Outcome field", { options: data?.eventFields, help: "Values success, error or rejected." })}
            {field("amountField", "Amount field (optional)", { options: data?.eventFields, help: "Turns on money impact." })}
            <details className="wz-wide wz-more">
              <summary>Canary filter and PromQL (optional)</summary>
              <div className="wz-grid">
                <div className="wz-wide">{field("filters", "Canary filter (JSON object)", { area: true, help: "Only events matching every field count for the guardrail." })}</div>
                {field("healthErrors", "PromQL errors query", { area: true })}
                {field("healthTotal", "PromQL total query", { area: true })}
              </div>
            </details>
          </div>}

          {stage === 4 && <div className="wz-grid">
            <div className="wz-field">
              <label htmlFor="wz-url">Probe endpoint</label>
              <select id="wz-url" value={fields.requestMethod === "POST" ? fields.url : ""} onChange={(event) => pickProbeTarget(event.target.value)}>
                {!probeTargets[fields.url] && <option value={fields.url} disabled>{fields.url}</option>}
                <option value={deliveryProbe}>{probeTargets[deliveryProbe].label}</option>
                {(paymentProbeEnabled || playbook?.probe.request.url === paymentProbe) && <option value={paymentProbe}>{probeTargets[paymentProbe].label}</option>}
              </select>
              <p className="wz-help"><code>{fields.requestMethod} {fields.url}</code> <Hint from={auto.url} /></p>
            </div>
            {field("every", "Send every", { help: "A duration such as 10s." })}
            {field("healthyFor", "Healthy for", { help: "How long the probe must pass before recovery can start." })}
            {field("healthyStatus", "Healthy status", { props: { type: "number", min: 100, max: 599 } })}
            {field("fallbackStatus", "Status while on fallback", { props: { type: "number", min: 100, max: 599 } })}
            <h4 className="wz-wide">Synthetic customer for each value</h4>
            <p className="wz-wide wz-help">Probe orders use these identities and are left out of availability, the guardrail and impact.</p>
            {values.map((value) => <div className="wz-field" key={value}>
              <label htmlFor={`wz-id-${value}`}>{value}</label>
              <input id={`wz-id-${value}`} value={identities[value] ?? ""} onChange={(event) => {
                draftChanged();
                const identity = event.target.value;
                setAuto((current) => { const next = { ...current }; delete next[`id:${value}`]; return next; });
                setIdentities((current) => ({ ...current, [value]: identity }));
              }} />
              {auto[`id:${value}`] && <p className="wz-help"><Hint from={auto[`id:${value}`]} /></p>}
            </div>)}
            <details className="wz-wide wz-more">
              <summary>Request body</summary>
              {field("body", "Request body (JSON)", { area: true, help: "May use {probe_identity} and {value}." })}
            </details>
            <div className="wz-wide wz-test">
              <label htmlFor="wz-probe-value">Try it now</label>
              <div className="row">
                <select id="wz-probe-value" value={selectedProbe} onChange={(event) => { setProbeValue(event.target.value); probe.clear(); }}>
                  {values.map((value) => <option key={value}>{value}</option>)}
                </select>
                <button type="button" disabled={probe.pending || !selectedProbe || stageProblems.length > 0}
                  onClick={() => { const draft = readDraft(); if (draft) void probe.run({ playbook: draft, value: selectedProbe }); }}>
                  {probe.pending ? "Sending…" : "Send one test probe"}
                </button>
                {probe.data && <span className="wizard-result" role="status">
                  <Pill kind={probe.data.healthy ? "ok" : "bad"}>{probe.data.healthy ? "Healthy" : "Unhealthy"}</Pill>
                  {probe.data.status != null && <span>HTTP {probe.data.status}</span>}
                  {probe.data.error && <span>{probe.data.error}</span>}
                </span>}
              </div>
              <WizardFeedback error={probe.error} />
            </div>
          </div>}

          {review && <div className="wz-review">
            <div className="wz-readiness" role="status">
              {readiness.pending && <p>Running the readiness dry run…</p>}
              {readiness.data && <>
                <p className="wz-verdict"><Pill kind={readiness.data.readiness === "ready" ? "ok" : "bad"}>{readiness.data.readiness === "ready" ? "Ready" : "Broken"}</Pill>
                  {readiness.data.readiness === "ready" ? "Flag, segments and recent orders all check out." : "It can be saved, but it cannot be applied until these are fixed:"}</p>
                {!!readiness.data.reasons.length && <ul className="plain">{readiness.data.reasons.map((reason, i) => <li key={i}>{reason}</li>)}</ul>}
              </>}
              <WizardFeedback error={readiness.error} />
              <button type="button" disabled={readiness.pending} onClick={() => { const draft = readDraft(); if (draft) void readiness.run(draft); }}>Run the dry run again</button>
            </div>
            <dl className="kv">
              <dt>When</dt><dd>{lines(fields.alerts).join(", ")} fires ({fields.cause})</dd>
              <dt>For</dt><dd>{fields.dimension}: {values.join(", ")}</dd>
              <dt>Fallback</dt><dd><code>{fields.flag}</code> {fields.normal === "true" ? "on" : "off"} → {fields.fallback === "true" ? "on" : "off"}</dd>
              <dt>Recovery</dt><dd>{steps.map((s) => `${s}%`).join(" → ")}, {fields.autoAdvance === "true" ? "advancing on its own" : "operator at each step"}; rollback above {(Number(fields.errorRate) * 100).toFixed(1)}% errors or {fields.consecutive} in a row</dd>
              <dt>Approval reminder</dt><dd>{fields.approvalCall === "on"
                ? `${fields.approvalLanguage} call to number ending in ${fields.approvalPhone.trim().slice(-4)} after ${fields.approvalDelay} ${Number(fields.approvalDelay) === 1 ? "minute" : "minutes"}`
                : "Off"}</dd>
              <dt>Probe</dt><dd>every {fields.every}, healthy for {fields.healthyFor}</dd>
              <dt>Owner</dt><dd>{fields.owner}</dd>
            </dl>
          </div>}

          {tried && stageProblems.length > 0 && <div className="notice err" role="alert">
            <ul className="plain">{stageProblems.map((p) => <li key={p}>{p}</li>)}</ul>
          </div>}
          <WizardFeedback error={error} />
          <div className="actions wizard-actions">
            <button type="button" disabled={saving} onClick={onCancel}>Cancel</button>
            {stage > 0 && <button type="button" disabled={saving} onClick={() => go(stage - 1)}>Back</button>}
            <button className="primary" type="submit" disabled={saving || probe.pending}>
              {saving ? "Saving…" : review ? (playbook ? `Save as v${playbook.version + 1}` : "Save playbook") : `Next: ${stages[stage + 1].title}`}
            </button>
          </div>
        </form>
        <div className="wz-preview">
          <PlaybookAssistant inline onApply={applyAI}
            draft={(() => { try { return draftPlaybook(fields, identities, false); } catch { return undefined; } })()} />
        </div>
      </div>
    </section>
  );
}
