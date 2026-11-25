import "./mascot.css";

export type MascotMood = "happy" | "alert" | "working" | "calm";

const LABEL: Record<MascotMood, string> = {
  happy: "FestReady mascot, smiling: all clear",
  alert: "FestReady mascot, wide-eyed: investigating",
  working: "FestReady mascot, typing on a laptop: recovering",
  calm: "FestReady mascot, relaxed: mitigated",
};

// Chibi, flat, ink + the one accent (+ a soft blush). The paper colour (--mc-paper, default --surface) cuts the sticker gaps between shapes.
export default function Mascot({ mood = "happy", size = 96 }: { mood?: MascotMood; size?: number }) {
  return (
    <svg className={`mc mc-${mood}`} viewBox="0 0 200 200" width={size} height={size} role="img" aria-label={LABEL[mood]}>
      <g className="mc-all">
        <g className="mc-sparks">
          <path d="M163 130 L159 119" /><path d="M174 134 L183 126" /><path d="M181 145 L192 142" />
        </g>

        <g className="mc-body">
          <ellipse className="ink" cx="82" cy="190" rx="12" ry="6.5" />
          <ellipse className="ink" cx="108" cy="190" rx="12" ry="6.5" />
          <ellipse className="ink paper-line" cx="95" cy="166" rx="33" ry="27" />
          <circle className="ink paper-line" cx="66" cy="172" r="8.5" />
        </g>

        <g className="mc-laptop">
          <rect className="mc-lid paper-line" x="108" y="143" width="70" height="45" rx="12" transform="rotate(-6 143 166)" />
          <path className="mc-sparkle" d="M144 153 Q145 164 156 166 Q145 168 144 179 Q143 168 132 166 Q143 164 144 153 Z" />
        </g>
        <g className="mc-arm">
          <path className="ink-stroke arm" d="M82 164 Q95 180 110 182" />
          <ellipse className="ink" cx="112" cy="183" rx="9.5" ry="8.5" />
        </g>

        <g className="mc-head">
          <g className="mc-flag">
            <path className="flag-pole" d="M100 40 L100 9" />
            <path className="mc-cloth" d="M101 9 C112 3 122 14 135 8 C131 14 131 21 135 27 C122 32 112 22 101 26 Z" />
          </g>
          <circle className="ink paper-line" cx="100" cy="86" r="56" />
          <ellipse className="mc-window" cx="100" cy="90" rx="46" ry="40" />
          <g className="mc-headset">
            <rect className="paper-line" x="34" y="72" width="16" height="32" rx="8" />
            <rect className="paper-line" x="150" y="72" width="16" height="32" rx="8" />
            <path className="mic" d="M42 102 Q44 124 62 126" />
            <circle className="mic-tip" cx="63" cy="126" r="3.6" />
          </g>
          <g className="mc-cheeks"><ellipse cx="68" cy="106" rx="7.5" ry="5" /><ellipse cx="132" cy="106" rx="7.5" ry="5" /></g>
          <g className="mc-eyes">
            {mood === "happy" && <path className="line" d="M73 95 Q82 80 91 95 M109 95 Q118 80 127 95" />}
            {mood === "calm" && <path className="line" d="M73 90 Q82 100 91 90 M109 90 Q118 100 127 90" />}
            {mood === "alert" && (
              <>
                <ellipse className="ink" cx="82" cy="88" rx="8.8" ry="10.8" /><ellipse className="ink" cx="118" cy="88" rx="8.8" ry="10.8" />
                <circle className="glint" cx="85.5" cy="83.5" r="3.5" /><circle className="glint" cx="121.5" cy="83.5" r="3.5" />
                <circle className="glint" cx="79" cy="93" r="1.6" /><circle className="glint" cx="115" cy="93" r="1.6" />
              </>
            )}
            {mood === "working" && (
              <>
                <ellipse className="ink" cx="82" cy="92" rx="8.2" ry="9.4" /><ellipse className="ink" cx="118" cy="92" rx="8.2" ry="9.4" />
                <circle className="glint" cx="85.2" cy="88" r="3.2" /><circle className="glint" cx="121.2" cy="88" r="3.2" />
                <circle className="glint" cx="79.5" cy="96.5" r="1.5" /><circle className="glint" cx="115.5" cy="96.5" r="1.5" />
              </>
            )}
          </g>
          {mood === "happy" && <path className="mouth" d="M93 105 Q96.5 111.5 100 105 Q103.5 111.5 107 105" />}
          {mood === "calm" && <path className="mouth" d="M94.5 106 Q100 111 105.5 106" />}
          {mood === "working" && <path className="mouth" d="M95.5 108 Q100 112 104.5 108" />}
          {mood === "alert" && <ellipse className="ink" cx="100" cy="109" rx="3.4" ry="4.3" />}
        </g>

        {mood === "alert" && (
          <>
            <g className="mc-bang"><path d="M158 30 L158 45" /><circle cx="158" cy="55" r="3" /></g>
            <path className="mc-drop" d="M46 44 Q38 55 46 60 Q54 55 46 44 Z" />
          </>
        )}
      </g>
    </svg>
  );
}
