// Jiko sprite data.
// Original 9x9 pixel language, productized for rounded-rectangle screens.
//
// Dot grammar:
// "." = off / dim dot
// "1" = primary tone dot
// "2" = secondary tone dot

export const spriteSize = 9 as const;

export const spriteCharacters = [
  "king",
  "tree",
  "oracle"
] as const;

export const palettes = {
  "yellow": {
    "label": "Yellow / Orange / canonical amber",
    "primary": "#f09035",
    "secondary": "#eee6d2",
    "dim": "#2a2418",
    "halo": "#f09035",
    "glass": "#080805",
    "screen": "#050403"
  },
  "red": {
    "label": "Red / Hold / oxblood ember",
    "primary": "#e0523a",
    "secondary": "#ffc2a4",
    "dim": "#2a0c09",
    "halo": "#ff6a47",
    "glass": "#0d0303",
    "screen": "#060202"
  },
  "green": {
    "label": "Green / Deviate / verdigris moss",
    "primary": "#79bf72",
    "secondary": "#dceec8",
    "dim": "#0d1f13",
    "halo": "#8fe882",
    "glass": "#041009",
    "screen": "#020805"
  }
} as const;

export const frames = {
  "king": {
    "original": [
      "...111...",
      "..11111..",
      "...1.1...",
      ".1111111.",
      "1.11111.1",
      "..11111..",
      "...111...",
      "..1.1.1..",
      ".1.....1."
    ],
    "sway_left": [
      "..111....",
      ".11111...",
      "..1.1....",
      "1111111..",
      "111111.1.",
      ".11111...",
      "..111....",
      ".1.1.1...",
      "1.....1.."
    ],
    "sway_right": [
      "....111..",
      "...11111.",
      "....1.1..",
      "..1111111",
      ".1.111111",
      "...11111.",
      "....111..",
      "...1.1.1.",
      "..1.....1"
    ],
    "raise": [
      "...111...",
      "..11111..",
      "...1.1...",
      ".1111111.",
      "1.11111.1",
      "1.11111.1",
      "...111...",
      "..1.1.1..",
      ".1.....1."
    ],
    "bow": [
      ".........",
      "...111...",
      "..11111..",
      "...1.1...",
      ".1111111.",
      "..11111..",
      "..111....",
      ".1.1.1...",
      "1.....1.."
    ],
    "locked": [
      "...111...",
      "..11111..",
      "...1.1...",
      ".1111111.",
      "..11111..",
      "..11111..",
      "...111...",
      "..1.1.1..",
      ".1.....1."
    ]
  },
  "tree": {
    "original": [
      "....1....",
      "...111...",
      "..11111..",
      ".1111111.",
      "...111...",
      "..11111..",
      "....1....",
      "....1....",
      "...111..."
    ],
    "seed": [
      ".........",
      ".........",
      ".........",
      "....1....",
      "...111...",
      ".........",
      "....1....",
      "...111...",
      "..1...1.."
    ],
    "sprout": [
      "....1....",
      "...111...",
      "....1....",
      "..1.1.1..",
      ".1111111.",
      "....1....",
      "....1....",
      "...111...",
      "..1...1.."
    ],
    "wind_left": [
      "..1......",
      ".111.....",
      "11111....",
      "1111111..",
      "..111....",
      ".11111...",
      "....1....",
      "...1.....",
      "..111...."
    ],
    "wind_right": [
      "......1..",
      ".....111.",
      "....11111",
      "..1111111",
      "....111..",
      "...11111.",
      "....1....",
      ".....1...",
      "....111.."
    ],
    "branch": [
      "....1....",
      "..11111..",
      ".1111111.",
      "111121111",
      "..11111..",
      ".11.1.11.",
      "....1....",
      "...111...",
      "..1...1.."
    ],
    "root": [
      "....1....",
      "...111...",
      "..11111..",
      ".1111111.",
      "...111...",
      "..11111..",
      "....1....",
      "...111...",
      ".11...11."
    ]
  },
  "oracle": {
    "original": [
      "....1....",
      "..11111..",
      ".11...11.",
      "11.222.11",
      "1112.2111",
      "11.222.11",
      ".11...11.",
      "..11111..",
      "....1...."
    ],
    "closed": [
      "....1....",
      "..11111..",
      ".11...11.",
      "11.....11",
      "111222111",
      "11.....11",
      ".11...11.",
      "..11111..",
      "....1...."
    ],
    "half": [
      "....1....",
      "..11111..",
      ".11...11.",
      "11.222.11",
      "111...111",
      "11.222.11",
      ".11...11.",
      "..11111..",
      "....1...."
    ],
    "open": [
      "....1....",
      "..11111..",
      ".11...11.",
      "11.2.2.11",
      "111222111",
      "11.2.2.11",
      ".11...11.",
      "..11111..",
      "....1...."
    ],
    "split": [
      "....1....",
      "..11111..",
      ".11.1.11.",
      "112222211",
      "11.2.2.11",
      "112222211",
      ".11.1.11.",
      "..11111..",
      "....1...."
    ],
    "quiet": [
      ".........",
      "....1....",
      "..1...1..",
      ".1.....1.",
      "1..222..1",
      ".1.....1.",
      "..1...1..",
      "....1....",
      "........."
    ]
  }
} as const;

export const animations = {
  "idle": {
    "intent": "ambient / device is alive but quiet",
    "fps": 4,
    "characters": {
      "king": [
        "original",
        "sway_left",
        "original",
        "sway_right"
      ],
      "tree": [
        "original",
        "wind_left",
        "original",
        "wind_right"
      ],
      "oracle": [
        "closed",
        "half",
        "closed",
        "quiet"
      ]
    }
  },
  "listening": {
    "intent": "side button held / user is speaking",
    "fps": 6,
    "characters": {
      "king": [
        "original",
        "raise",
        "original",
        "raise",
        "sway_right",
        "original"
      ],
      "tree": [
        "seed",
        "sprout",
        "original",
        "wind_left",
        "original",
        "wind_right"
      ],
      "oracle": [
        "closed",
        "half",
        "open",
        "half",
        "closed",
        "half"
      ]
    }
  },
  "reading": {
    "intent": "three readings are being computed",
    "fps": 8,
    "characters": {
      "king": [
        "sway_left",
        "original",
        "sway_right",
        "raise",
        "original",
        "bow",
        "original",
        "raise"
      ],
      "tree": [
        "sprout",
        "original",
        "wind_left",
        "original",
        "wind_right",
        "branch",
        "original",
        "root"
      ],
      "oracle": [
        "closed",
        "half",
        "open",
        "split",
        "open",
        "original",
        "half",
        "closed"
      ]
    }
  },
  "split": {
    "intent": "minority exists / disagreement surfaced",
    "fps": 7,
    "characters": {
      "king": [
        "original",
        "sway_left",
        "locked",
        "sway_right",
        "raise",
        "original"
      ],
      "tree": [
        "wind_left",
        "original",
        "branch",
        "wind_right",
        "original",
        "root"
      ],
      "oracle": [
        "open",
        "split",
        "open",
        "split",
        "original",
        "open"
      ]
    }
  },
  "locked": {
    "intent": "verdict locked / system stops speaking",
    "fps": 3,
    "characters": {
      "king": [
        "locked",
        "locked",
        "original",
        "locked"
      ],
      "tree": [
        "root",
        "original",
        "root",
        "original"
      ],
      "oracle": [
        "original",
        "open",
        "original",
        "closed"
      ]
    }
  },
  "sleep": {
    "intent": "screen saver / low power",
    "fps": 2,
    "characters": {
      "king": [
        "original",
        "locked"
      ],
      "tree": [
        "seed",
        "original"
      ],
      "oracle": [
        "quiet",
        "closed"
      ]
    }
  }
} as const;

export type SpriteName = keyof typeof frames;
export type SpriteTone = keyof typeof palettes;
export type SpriteAnimation = keyof typeof animations;
export type SpriteFrameId<T extends SpriteName = SpriteName> = keyof typeof frames[T];
