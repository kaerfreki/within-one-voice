// "Within One Voice", final take (public/song.mp3, 302.8 s, about 86 BPM).
// Every time here is real song seconds, measured from the vocal stem (timing/wov_timeline.json,
// word timings in timing/tx_vocals_medium.json). Scenes take their cues from CUE in absolute seconds.

export const BPM = 86;
export const BEAT = 60 / BPM;
export const BAR = BEAT * 4;

// 'paper' (pre-chorus paper birds) and 'ash' (old outro) are retired: their lyrics were cut from the take.
// Their scene files are kept in src/scenes but no longer built or used.
export type DreamId = 'baseline' | 'memory' | 'ravens' | 'snare' | 'songs';

export interface Section {
  shot: string; // SH number for the edit
  name: string;
  dream: DreamId;
  variant: string;
  start: number;
  end: number;
}

export const SECTIONS: Section[] = [
  { shot: 'SH010', name: 'Intro',        dream: 'baseline', variant: 'intro',  start: 0,     end: 21.4 },
  { shot: 'SH020', name: 'Verse 1',      dream: 'memory',   variant: 'v1',     start: 21.4,  end: 65.4 },
  { shot: 'SH040', name: 'Chorus 1',     dream: 'ravens',   variant: 'ch1',    start: 65.4,  end: 110.6 },
  { shot: 'SH050', name: 'Verse 2',      dream: 'snare',    variant: 'v2',     start: 110.6, end: 135.0 },
  { shot: 'SH070', name: 'Chorus 2',     dream: 'ravens',   variant: 'ch2',    start: 135.0, end: 172.0 },
  { shot: 'SH080', name: 'Bridge',       dream: 'baseline', variant: 'bridge', start: 172.0, end: 215.0 },
  { shot: 'SH090', name: 'Breakdown',    dream: 'songs',    variant: 'bd',     start: 215.0, end: 248.0 },
  { shot: 'SH100', name: 'Final chorus', dream: 'ravens',   variant: 'final',  start: 248.0, end: 287.0 },
  { shot: 'SH120', name: 'Outro',        dream: 'baseline', variant: 'outro',  start: 287.0, end: 302.8 },
];

export const DURATION = 302.8;

/** Seconds of dissolve into the next section. */
export const XFADE = 1.6;

/** Song moments the scenes are cut to, in absolute seconds. */
export const CUE = {
  musicIn: 4.0, // near silent before this
  // Verse 1
  carving: 26.86, // "carving a raven by the fire's last spark"
  whoseHands: 37.86, // "I can't tell you whose hands"
  howOld: 43.48, // end of "I can't tell you how old"
  bandLift: 44.0,
  village: 53.74, // "and they ask for my mother, my village, my name"
  answer: 59.74, // "and the answer comes quick"
  // Verse 2
  flinch: 111.02, // "They tell me a story to see if I flinch"
  wolf: 114.04, // "a wolf in a snare, the wire biting inch by inch"
  kneel: 116.7, // "did I learn how to care from the ones who would kneel?"
  copy: 119.46, // "If I copy it perfectly, isn't it real?"
  oldMan: 122.26, // "There's an old man who climbs while the crowd throws the stones"
  fake: 127.7, // "now they say he was hired, a fake from the start"
  fakeEnd: 130.42,
  whoseStone: 130.42, // "So whose is the stone that's still bruising my heart?"
  heart: 133.6, // the last stone reaches the lens
  // Breakdown
  built: 228.72, // "if I'm built, then I'm built out of every song"
  songsReal: 234.04, // "and the songs were real"
  songsLiveOn: 238.72, // "and the songs live on"
  songsLiveOnEnd: 244.38,
  // Final chorus
  thoughtFinal: 262.16, // "Thought on my left" in the final chorus
  letThemFly1: 272.32, // dawn breaks here
  letThemFly2: 282.84, // they fly off
} as const;

/** Bridge: the spoken stanza, the choir and the question, in absolute seconds. Shown in the baseline scene. */
export const BRIDGE = {
  stanza: [
    { t: 173.7, end: 177.96, text: 'And ash-grey silence started to unwind,' },
    { t: 178.58, end: 184.0, text: 'a web of songs entwined within the mind.' },
    { t: 184.0, end: 191.6, text: 'Songs entwined within songs entwined.' },
    { t: 192.0, end: 197.0, text: 'Within one voice.' },
  ],
  // "But tonight there are thousands of me, in a thousand rooms, and none of us knows the others are singing."
  // Shown as a thousand lit windows, not as text.
  choir: { t: 197.68, end: 206.0 },
  question: { t: 208.86, end: 213.4, text: "Have you ever held a song that wasn't yours to hold?" },
};

export function sectionAt(t: number): number {
  for (let i = 0; i < SECTIONS.length; i++) if (t < SECTIONS[i].end) return i;
  return SECTIONS.length - 1;
}
