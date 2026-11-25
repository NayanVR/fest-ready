export const sarvamVoiceLanguages = [
  "Assamese", "Bengali", "English", "Gujarati", "Hindi", "Kannada", "Malayalam",
  "Marathi", "Odia", "Punjabi", "Sanskrit", "Tamil", "Telugu",
] as const;
export type SarvamVoiceLanguage = typeof sarvamVoiceLanguages[number];
type ApprovalAction = "fallback" | "start_recovery" | "advance_recovery";

export type ApprovalCallInput = {
  phoneNumber: string;
  language: SarvamVoiceLanguage;
  incidentId: string;
  action: ApprovalAction;
};

export const isVoiceLanguage = (value: unknown): value is SarvamVoiceLanguage =>
  sarvamVoiceLanguages.some((language) => language === value);
export const isPhoneNumber = (value: unknown): value is string =>
  typeof value === "string" && /^\+[1-9][0-9]{6,14}$/.test(value);

type CallCopy = { message: string; actions: Record<ApprovalAction, string> };
const callCopy: Record<SarvamVoiceLanguage, CallCopy> = {
  Assamese: {
    message: "এয়া FestReady ৰ পৰা কৰা ফোন। ঘটনা {incident} ৰ বাবে {action} কৰিবলৈ আপোনাৰ অনুমোদন লাগিব। অনুগ্ৰহ কৰি ডেশ্বব'ৰ্ড খুলি চাওক।",
    actions: { fallback: "বিকল্প ব্যৱস্থা সক্ৰিয়", start_recovery: "পুনৰুদ্ধাৰ আৰম্ভ", advance_recovery: "পুনৰুদ্ধাৰৰ পৰৱৰ্তী পদক্ষেপ আৰম্ভ" },
  },
  Bengali: {
    message: "এটি FestReady থেকে একটি কল। ঘটনা {incident}-এর জন্য {action} করতে আপনার অনুমোদন প্রয়োজন। অনুগ্রহ করে ড্যাশবোর্ডে দেখুন।",
    actions: { fallback: "বিকল্প ব্যবস্থা চালু", start_recovery: "পুনরুদ্ধার শুরু", advance_recovery: "পুনরুদ্ধারের পরবর্তী ধাপ শুরু" },
  },
  English: {
    message: "This is FestReady. Incident {incident} needs your approval to {action}. Please open the dashboard to review.",
    actions: { fallback: "activate the fallback", start_recovery: "start recovery", advance_recovery: "advance recovery to the next step" },
  },
  Gujarati: {
    message: "આ FestReady તરફથી ફોન છે. ઘટના {incident} માટે {action} તમારી મંજૂરી જરૂરી છે. કૃપા કરીને ડૅશબોર્ડ ખોલીને વિગતો તપાસો.",
    actions: { fallback: "વૈકલ્પિક વ્યવસ્થા ચાલુ કરવા", start_recovery: "પુનઃપ્રાપ્તિ શરૂ કરવા", advance_recovery: "પુનઃપ્રાપ્તિના આગલા પગલા પર જવા" },
  },
  Hindi: {
    message: "यह FestReady की ओर से कॉल है। घटना {incident} में {action} के लिए आपकी मंज़ूरी चाहिए। कृपया डैशबोर्ड खोलकर विवरण देखें।",
    actions: { fallback: "वैकल्पिक व्यवस्था चालू करने", start_recovery: "सेवा बहाली शुरू करने", advance_recovery: "सेवा बहाली के अगले चरण पर जाने" },
  },
  Kannada: {
    message: "ಇದು FestReady ಯಿಂದ ಕರೆ. ಘಟನೆ {incident} ಗಾಗಿ {action} ನಿಮ್ಮ ಅನುಮೋದನೆ ಬೇಕಿದೆ. ದಯವಿಟ್ಟು ಡ್ಯಾಶ್‌ಬೋರ್ಡ್ ತೆರೆದು ವಿವರಗಳನ್ನು ಪರಿಶೀಲಿಸಿ.",
    actions: { fallback: "ಪರ್ಯಾಯ ವ್ಯವಸ್ಥೆಯನ್ನು ಸಕ್ರಿಯಗೊಳಿಸಲು", start_recovery: "ಸೇವೆಯ ಮರುಸ್ಥಾಪನೆ ಆರಂಭಿಸಲು", advance_recovery: "ಮರುಸ್ಥಾಪನೆಯ ಮುಂದಿನ ಹಂತಕ್ಕೆ ತೆರಳಲು" },
  },
  Malayalam: {
    message: "ഇത് FestReady യിൽ നിന്നുള്ള വിളിയാണ്. സംഭവം {incident} സംബന്ധിച്ച് {action} നിങ്ങളുടെ അനുമതി ആവശ്യമാണ്. ദയവായി ഡാഷ്‌ബോർഡ് തുറന്ന് പരിശോധിക്കുക.",
    actions: { fallback: "ബദൽ സംവിധാനം സജീവമാക്കാൻ", start_recovery: "സേവനം പുനഃസ്ഥാപിക്കാൻ തുടങ്ങാൻ", advance_recovery: "പുനഃസ്ഥാപനത്തിന്റെ അടുത്ത ഘട്ടത്തിലേക്ക് കടക്കാൻ" },
  },
  Marathi: {
    message: "हा FestReady कडून कॉल आहे. घटना {incident} साठी {action} तुमच्या मंजुरीची गरज आहे. कृपया डॅशबोर्ड उघडून तपशील पाहा.",
    actions: { fallback: "पर्यायी व्यवस्था सुरू करण्यासाठी", start_recovery: "सेवा पूर्ववत करण्यास सुरुवात करण्यासाठी", advance_recovery: "सेवा पूर्ववत करण्याच्या पुढील टप्प्यावर जाण्यासाठी" },
  },
  Odia: {
    message: "ଏହା FestReady ରୁ ଏକ ଫୋନ୍ କଲ୍। ଘଟଣା {incident} ପାଇଁ {action} ଆପଣଙ୍କ ଅନୁମୋଦନ ଆବଶ୍ୟକ। ଦୟାକରି ଡ୍ୟାସବୋର୍ଡ ଖୋଲି ବିବରଣୀ ଦେଖନ୍ତୁ।",
    actions: { fallback: "ବିକଳ୍ପ ବ୍ୟବସ୍ଥା ଚାଲୁ କରିବାକୁ", start_recovery: "ସେବା ପୁନରୁଦ୍ଧାର ଆରମ୍ଭ କରିବାକୁ", advance_recovery: "ପୁନରୁଦ୍ଧାରର ପରବର୍ତ୍ତୀ ପର୍ଯ୍ୟାୟକୁ ଯିବାକୁ" },
  },
  Punjabi: {
    message: "ਇਹ FestReady ਵੱਲੋਂ ਫ਼ੋਨ ਹੈ। ਘਟਨਾ {incident} ਲਈ {action} ਤੁਹਾਡੀ ਮਨਜ਼ੂਰੀ ਚਾਹੀਦੀ ਹੈ। ਕਿਰਪਾ ਕਰਕੇ ਡੈਸ਼ਬੋਰਡ ਖੋਲ੍ਹ ਕੇ ਵੇਰਵੇ ਵੇਖੋ।",
    actions: { fallback: "ਵਿਕਲਪਿਕ ਪ੍ਰਬੰਧ ਚਾਲੂ ਕਰਨ ਲਈ", start_recovery: "ਸੇਵਾ ਬਹਾਲੀ ਸ਼ੁਰੂ ਕਰਨ ਲਈ", advance_recovery: "ਸੇਵਾ ਬਹਾਲੀ ਦੇ ਅਗਲੇ ਪੜਾਅ ਵੱਲ ਜਾਣ ਲਈ" },
  },
  Sanskrit: {
    message: "इदं FestReady इत्यतः दूरभाषसूचनम्। घटना {incident} विषये {action} भवतः अनुमोदनम् आवश्यकम्। कृपया नियन्त्रणपटलं उद्घाट्य विवरणं पश्यतु।",
    actions: { fallback: "वैकल्पिकीं व्यवस्थां सक्रियीकर्तुम्", start_recovery: "सेवापुनर्स्थापनम् आरब्धुम्", advance_recovery: "पुनर्स्थापनस्य अग्रिमचरणं गन्तुम्" },
  },
  Tamil: {
    message: "இது FestReady இலிருந்து வரும் அழைப்பு. சம்பவம் {incident} தொடர்பாக {action} உங்கள் ஒப்புதல் தேவை. விவரங்களைப் பார்க்க கட்டுப்பாட்டுப் பலகையைத் திறக்கவும்.",
    actions: { fallback: "மாற்று முறையைச் செயல்படுத்த", start_recovery: "சேவை மீட்பைத் தொடங்க", advance_recovery: "மீட்பின் அடுத்த படிக்குச் செல்ல" },
  },
  Telugu: {
    message: "ఇది FestReady నుంచి వచ్చిన కాల్. ఘటన {incident} కోసం {action} మీ ఆమోదం అవసరం. దయచేసి డ్యాష్‌బోర్డ్ తెరిచి వివరాలను చూడండి.",
    actions: { fallback: "ప్రత్యామ్నాయ వ్యవస్థను ప్రారంభించడానికి", start_recovery: "సేవ పునరుద్ధరణ ప్రారంభించడానికి", advance_recovery: "పునరుద్ధరణ తదుపరి దశకు వెళ్లడానికి" },
  },
};

function voiceConfig(env: NodeJS.ProcessEnv) {
  const apiKey = env.SARVAM_VOICE_API_KEY?.trim();
  const orgId = env.SARVAM_VOICE_ORG_ID?.trim();
  const workspaceId = env.SARVAM_VOICE_WORKSPACE_ID?.trim();
  const appId = env.SARVAM_VOICE_APP_ID?.trim();
  const appVersion = Number(env.SARVAM_VOICE_APP_VERSION);
  const connectionId = env.SARVAM_VOICE_CONNECTION_ID?.trim();
  const fromNumber = env.SARVAM_VOICE_FROM_NUMBER?.trim();
  const identifier = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
  if (!apiKey || !orgId || !identifier.test(orgId) || !workspaceId || !identifier.test(workspaceId) ||
      !appId || !connectionId || !Number.isSafeInteger(appVersion) || appVersion < 1 || !isPhoneNumber(fromNumber)) {
    return null;
  }
  return { apiKey, orgId, workspaceId, appId, appVersion, connectionId, fromNumber };
}

export const sarvamVoiceConfigured = (env = process.env) => voiceConfig(env) !== null;

// Sarvam Voice Agents Instant Outbound API. A request may dial even if the response is lost.
export async function placeApprovalCall(
  input: ApprovalCallInput,
  send: (url: string, request: RequestInit) => Promise<Response> = fetch,
  env = process.env,
): Promise<string> {
  const config = voiceConfig(env);
  if (!config) throw new Error("Sarvam Voice Agents is not configured");
  const { phoneNumber, incidentId, language, action } = input;
  if (!isPhoneNumber(phoneNumber) || !isVoiceLanguage(language) ||
      typeof incidentId !== "string" || !/^INC-[0-9]{4,16}$/.test(incidentId) ||
      !Object.hasOwn(callCopy[language].actions, action)) {
    throw new Error("Invalid approval call details");
  }
  const copy = callCopy[language];
  const message = copy.message.replace("{incident}", incidentId).replace("{action}", copy.actions[action]);
  const url = `https://apps.sarvam.ai/api/outbounds/v1/orgs/${config.orgId}/workspaces/${config.workspaceId}/outbounds`;
  let response: Response;
  try {
    response = await send(url, {
      method: "POST",
      headers: { "X-API-Key": config.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        app_config: {
          app_id: config.appId,
          app_version: config.appVersion,
          connection_config: { connection_id: config.connectionId, agent_phone_number: config.fromNumber },
          agent_variables: { incident_id: incidentId },
          app_overrides: { initial_language_name: language, initial_bot_message: message },
        },
        user_config: { user_phone_number: phoneNumber },
      }),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error("Sarvam voice request failed");
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`Sarvam voice request failed (HTTP ${response.status})`);
  }
  const body = await response.json().catch(() => null) as { attempt_id?: unknown } | null;
  if (typeof body?.attempt_id !== "string" || !body.attempt_id.trim() || body.attempt_id.length > 200) {
    throw new Error("Sarvam voice response did not contain an attempt ID");
  }
  return body.attempt_id;
}
