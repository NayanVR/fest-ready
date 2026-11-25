import { expect, test } from "bun:test";
import {
  isPhoneNumber, isVoiceLanguage, placeApprovalCall, sarvamVoiceConfigured, sarvamVoiceLanguages, type ApprovalCallInput,
} from "../src/sarvam-voice.ts";

const config = {
  SARVAM_VOICE_API_KEY: "fixture-key",
  SARVAM_VOICE_ORG_ID: "fixture-org",
  SARVAM_VOICE_WORKSPACE_ID: "fixture-workspace",
  SARVAM_VOICE_APP_ID: "fixture-agent",
  SARVAM_VOICE_APP_VERSION: "3",
  SARVAM_VOICE_CONNECTION_ID: "fixture-connection",
  SARVAM_VOICE_FROM_NUMBER: "+12025550101",
};
const call: ApprovalCallInput = {
  phoneNumber: "+12025550102",
  incidentId: "INC-0007",
  language: "Gujarati",
  action: "advance_recovery",
};

test("uses Sarvam Instant Outbound with the selected starting language and localized notification", async () => {
  const request = async (url: string, init: RequestInit) => {
    expect(url).toBe("https://apps.sarvam.ai/api/outbounds/v1/orgs/fixture-org/workspaces/fixture-workspace/outbounds");
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(new Headers(init.headers).get("x-api-key")).toBe("fixture-key");
    expect(JSON.parse(init.body as string)).toEqual({
      app_config: {
        app_id: "fixture-agent",
        app_version: 3,
        connection_config: { connection_id: "fixture-connection", agent_phone_number: "+12025550101" },
        agent_variables: { incident_id: "INC-0007" },
        app_overrides: {
          initial_language_name: "Gujarati",
          initial_bot_message: expect.stringMatching(/INC-0007.*પુનઃપ્રાપ્તિના આગલા પગલા.*ડૅશબોર્ડ/),
        },
      },
      user_config: { user_phone_number: "+12025550102" },
    });
    return Response.json({ attempt_id: "fixture-attempt" });
  };
  expect(await placeApprovalCall(call, request, config)).toBe("fixture-attempt");
});

test("each supported language carries the incident ID and sends only the declared agent variable", async () => {
  for (const language of sarvamVoiceLanguages) {
    for (const action of ["fallback", "start_recovery", "advance_recovery"] as const) {
      await placeApprovalCall({ ...call, action, language }, async (_url, init) => {
        const { app_config } = JSON.parse(init.body as string);
        expect(app_config.app_overrides.initial_language_name).toBe(language);
        expect(app_config.app_overrides.initial_bot_message).toContain("INC-0007");
        expect(app_config.app_overrides.initial_bot_message).not.toMatch(/[{}]/);
        expect(app_config.agent_variables).toEqual({ incident_id: "INC-0007" });
        return Response.json({ attempt_id: "fixture-attempt" });
      }, config);
    }
  }
});

test("invalid configuration or call details produce no network request", async () => {
  let requests = 0;
  const send = async () => { requests++; return Response.json({}); };
  expect(sarvamVoiceConfigured(config)).toBe(true);
  expect(sarvamVoiceConfigured({ SARVAM_API_KEY: "fixture-model-key" })).toBe(false);
  expect(sarvamVoiceConfigured({ ...config, SARVAM_VOICE_ORG_ID: ".." })).toBe(false);
  expect(sarvamVoiceConfigured({ ...config, SARVAM_VOICE_APP_VERSION: "1.5" })).toBe(false);
  expect(isVoiceLanguage("Spanish")).toBe(false);
  expect(isPhoneNumber("2025550102")).toBe(false);
  await expect(placeApprovalCall(call, send, {})).rejects.toThrow("Sarvam Voice Agents is not configured");
  await expect(placeApprovalCall({ ...call, phoneNumber: "2025550102" }, send, config))
    .rejects.toThrow("Invalid approval call details");
  await expect(placeApprovalCall({ ...call, incidentId: "INC-0007 with injected text" }, send, config))
    .rejects.toThrow("Invalid approval call details");
  expect(requests).toBe(0);
});

test("failed and ambiguous responses are sanitized and never retried", async () => {
  let requests = 0;
  await expect(placeApprovalCall(call, async () => {
    requests++;
    return Response.json({ echo: "fixture-key and recipient +12025550102" }, { status: 422 });
  }, config)).rejects.toThrow(/^Sarvam voice request failed \(HTTP 422\)$/);
  expect(requests).toBe(1);
  await expect(placeApprovalCall(call, async () => {
    requests++;
    throw new Error("private connection details");
  }, config)).rejects.toThrow(/^Sarvam voice request failed$/);
  expect(requests).toBe(2);
  await expect(placeApprovalCall(call, async () => {
    requests++;
    return Response.json({ unrelated: "fixture-body" });
  }, config)).rejects.toThrow(/^Sarvam voice response did not contain an attempt ID$/);
  expect(requests).toBe(3);
});
