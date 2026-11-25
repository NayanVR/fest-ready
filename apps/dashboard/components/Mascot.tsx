import "./mascot.css";

export type MascotMood = "happy" | "alert" | "working" | "calm";

const LABEL: Record<MascotMood, string> = {
  happy: "FestReady mascot, smiling: all clear",
  alert: "FestReady mascot, wide-eyed: investigating",
  working: "FestReady mascot, typing on a laptop: recovering",
  calm: "FestReady mascot, relaxed: mitigated",
};

// Hand-drawn, flat, ink + the one accent. The paper colour (--mc-paper, default --surface) cuts the sticker gaps between shapes.
export default function Mascot({ mood = "happy", size = 96 }: { mood?: MascotMood; size?: number }) {
  return (
    <svg className={`mc mc-${mood}`} viewBox="0 0 200 200" width={size} height={size} role="img" aria-label={LABEL[mood]}>
      <g className="mc-all">
        <g className="mc-sparks">
          <path d="M160 124 L156 112" /><path d="M171 128 L181 119" /><path d="M178 139 L191 135" />
        </g>

        <g className="mc-body">
          <path className="ink" d="M70 134 C60 152 58 170 62 183 Q64 191 72 191 L118 191 Q126 191 127 183 C130 168 125 150 118 134 Z" />
        </g>

        <g className="mc-laptop">
          <path className="ink paper-line" d="M108 146 L168 139 L161 181 L98 186 Z" />
          <path className="mc-sparkle" d="M138 150 C139 158 141 160 149 162 C141 164 139 166 138 174 C137 166 135 164 127 162 C135 160 137 158 138 150 Z" />
        </g>
        <g className="mc-arm">
          <path className="ink" d="M74 146 C88 146 100 154 112 160 L108 176 C94 176 82 170 70 160 Z" />
          <circle className="ink paper-line" cx="113" cy="168" r="8.5" />
        </g>

        <g className="mc-flag">
          <path className="ink-stroke thin" d="M100 40 L100 13" />
          <path className="mc-cloth" d="M101 13 C113 7 123 20 137 12 C133 19 133 25 137 31 C123 37 113 26 101 31 Z" />
        </g>

        <g className="mc-head">
          <circle className="ink paper-line" cx="100" cy="86" r="48" />
          <ellipse className="mc-window" cx="100" cy="90" rx="36" ry="29" />
          <g className="mc-headset">
            <rect className="paper-line" x="42" y="72" width="14" height="30" rx="7" />
            <path className="mic" d="M49 100 Q52 118 70 120" />
          </g>
          <g className="mc-eyes">
            {mood === "happy" && <path className="line" d="M76 94 Q84 82 92 94 M108 94 Q116 82 124 94" />}
            {mood === "calm" && <path className="line soft" d="M76 88 Q84 97 92 88 M108 88 Q116 97 124 88" />}
            {mood === "alert" && (
              <>
                <circle className="ink" cx="84" cy="88" r="8" /><circle className="ink" cx="116" cy="88" r="8" />
                <circle className="glint" cx="87" cy="85" r="2.6" /><circle className="glint" cx="119" cy="85" r="2.6" />
              </>
            )}
            {mood === "working" && (
              <>
                <ellipse className="ink" cx="88" cy="94" rx="7" ry="6.5" /><ellipse className="ink" cx="120" cy="94" rx="7" ry="6.5" />
                <circle className="glint" cx="91" cy="92" r="2.2" /><circle className="glint" cx="123" cy="92" r="2.2" />
              </>
            )}
          </g>
        </g>

        {mood === "alert" && (
          <g className="mc-bang"><path d="M152 34 L152 48" /><circle cx="152" cy="58" r="2.8" /></g>
        )}
      </g>
    </svg>
  );
}
