# Approval reminder calls

The controller places an outbound reminder when an enabled playbook has an actionable approval waiting longer than its configured delay. Configure it in the wizard using a mobile number, a delay in minutes, and a call language. Each continuously pending approval can generate one attempt. The operator makes the approval in the dashboard.

## Sarvam workspace setup

Publish an outbound agent in Sarvam Voice Agents and attach an outbound-capable caller number. Enable the languages the operators will select and declare the `incident_id` input variable. The controller supplies the pending action in the opening message. Configure the agent to direct the recipient to FestReady and end the call. Give the agent no incident-changing tools.

Set these values in the environment or the repo's ignored `.env`. The Kubernetes secrets script puts them in the `sarvam-voice` Secret consumed by the controller.

| Variable | Value |
| --- | --- |
| `SARVAM_VOICE_API_KEY` | Voice Agents workspace API key |
| `SARVAM_VOICE_ORG_ID` | Organization ID |
| `SARVAM_VOICE_WORKSPACE_ID` | Workspace ID |
| `SARVAM_VOICE_APP_ID` | Published voice agent ID |
| `SARVAM_VOICE_APP_VERSION` | Published voice agent version number |
| `SARVAM_VOICE_CONNECTION_ID` | Connection for the caller number |
| `SARVAM_VOICE_FROM_NUMBER` | Connected caller number in E.164 format |

See the [Sarvam outbound call API](https://docs.sarvam.ai/voice-agents/api/instant-outbound/create) and [telephony setup](https://docs.sarvam.ai/voice-agents/deploy/telephony).

The controller logs whether Sarvam accepted the request. Acceptance identifies a dial attempt. Answered calls can be checked in the Sarvam workspace. The Kubernetes controller uses an ephemeral database, so redeploy it only when resetting the demo is safe.
