/**
 * Launch Studio — mode manifest (pure data, no React). Mode id `tanka-launch`.
 *
 * One launch-video run = one workspace. `film.json` is the stage
 * machine: idea → script → music → voice → VO → assets → picture → sound →
 * ★ rough cut → finals → deliver. `skill/scripts/tl.mjs` is its only writer;
 * every status is derived by `skill/scripts/lib/stage-state.mjs`, which the
 * viewer imports too, so the canvas and the CLI can never disagree.
 *
 * The viewer is a node canvas (modelled on Figma Weave): options per stage
 * as nodes, the picked path lit, each stage's page opening in place, and a
 * version node per format × language that expands into its storyboard,
 * player and timeline. The viewer never writes film.json: the producer's buttons
 * drop a request into `requests/` and tell the director, and `tl.mjs tick`
 * applies it.
 */

import type { ModeManifest } from "../../core/types/mode-manifest.js";

/**
 * The viewer's text inputs. EVERY pattern ends in a literal extension — the
 * watcher derives its file-type allowlist from these globs. The hashable
 * subset must match `HASH_TEXT_PATTERNS` in stage-state.mjs (a test pins it):
 * a file the viewer cannot see must not be a hash input, or the canvas would
 * show `changed` where tl.mjs shows `confirmed`. Media is never watched; its
 * URLs are built from paths recorded in these JSON files.
 */
export const TL_WATCH_PATTERNS = [
  "film.json",
  "ledger.jsonl",
  "timeline.json",
  "timelines/*.json",
  "remotion/scenes.json",
  "stages/**/*.json",
  "stages/**/*.md",
  "stages/**/*.txt",
  "stages/**/*.srt",
  "stages/**/*.vtt",
  "out/qc/**/*.json",
  "requests/*.json",
];

/**
 * Init-param defaults. Folders are empty: a run names its own asset and PRD folders, and the delivery folder falls back to the
 * scripts' platform default (common/host.py) when this is left empty. This file is also bundled into the viewer, so it never reads
 * `process` at module scope.
 */
const DEFAULTS = {
  assetRoots: "",
  prdRoot: "",
  deliveryDir: "",
  codexPath: "codex",
};

const TL_IGNORE = [
  "node_modules/**",
  "**/node_modules/**",
  ".pneuma/**",
  ".claude/**",
  ".agents/**",
  ".tl/**",
  "requests/applied/**",
  "**/frames/**",
];

const manifest: ModeManifest = {
  name: "tanka-launch",
  version: "0.1.0",
  pneumaVersion: "^3.55.0",
  changelog: {
    "0.1.0": [
      "A launch video from one idea: script, music and rhythm, voice, VO, assets, picture and sound, each with options on a node canvas",
      "Every stage from script to sound runs a countdown (30 min by default); when it runs out the recommended option is taken, and Auto-run takes them all the way to the rough cut",
      "The rough cut is the hard gate: finals, languages and delivery wait for the producer's approval, and no countdown or auto-run can pass it",
      "Every paid call is priced before it runs and the run stops at the budget cap ($60 by default), even during auto-run",
      "One stage machine (tl.mjs) writes film.json; the canvas derives every status with the same code, so a file edited after approval shows changed and everything built on it stale",
      "Mock mode runs the whole pipeline with local stand-ins (a local TTS, procedural placeholder beds and SFX, gradient stills and test clips) for $0; a selftest drives every stage script on a tiny fixture",
    ],
  },
  displayName: {
    en: "Launch Studio",
    "zh-CN": "发布视频工作室",
    ja: "ローンチスタジオ",
  },
  description: {
    en: "Turn an idea or a selling point into finished launch videos: script, music, voice, VO, assets, picture and sound as options on a canvas, a countdown on every stage, the rough cut as the one hard gate, then every format and language.",
    "zh-CN":
      "把一个想法或卖点做成完整的发布视频：脚本、音乐、声音、旁白、素材、画面和声音设计都以选项的形式摆在画布上，每一步都有倒计时，粗剪是唯一的硬关卡，之后输出全部格式与语言。",
    ja: "アイデアやセールスポイントからローンチ動画を完成させます。脚本・音楽・声・VO・素材・映像・サウンドをキャンバス上の選択肢として並べ、各ステージにカウントダウン、粗編集だけを唯一の関門にして、全フォーマット・全言語へ。",
  },
  // Two option nodes merging into a play head: choices becoming a film.
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="5.5" height="4" rx="1"/><rect x="2" y="16" width="5.5" height="4" rx="1"/><path d="M7.5 6H9a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H7.5"/><path d="M11 12h2.5"/><path d="M15.5 8.2v7.6l6-3.8z"/></svg>`,

  // Claude Code directs; Codex is supported. Everything the director does is
  // a script it runs and a file it reads back.
  supportedBackends: ["claude-code", "codex"],

  inspiredBy: {
    name: "Figma Weave (node canvas) and Pneuma Backlot (stage rail, hashed approvals)",
    url: "https://www.figma.com/weave/",
  },

  skill: {
    sourceDir: "skill",
    installName: "pneuma-tanka-launch",
    mdScene: `You and the producer are making a launch video. The producer types an idea or a selling point; you direct the run through its stages — idea, script, music & rhythm, voice, VO, assets, picture, sound, the rough cut, finals, delivery. Every stage from script to sound shows the producer options on a node canvas with a countdown; when it runs out the recommended option is taken. The rough cut is the one hard gate: only the producer approves it. \`tl.mjs\` in your skill's scripts is the only writer of film.json and ledger.jsonl — you never edit those two files by hand.`,
    // Keys land in the skill's `.env` (Pneuma writes it from the init
    // params); tl.mjs and the stage scripts parse that file. Folders, the
    // budget, the countdown and mock mode travel the same way.
    envMapping: {
      ELEVENLABS_API_KEY: "elevenLabsApiKey",
      FAL_KEY: "falApiKey",
      OPENROUTER_API_KEY: "openrouterApiKey",
      FIGMA_TOKEN: "figmaToken",
      TL_ASSET_ROOTS: "assetRoots",
      TL_PRD_ROOT: "prdRoot",
      TL_DELIVERY_DIR: "deliveryDir",
      TL_BUDGET_USD: "budgetUsd",
      TL_COUNTDOWN_MIN: "countdownMin",
      TL_CODEX_PATH: "codexPath",
      TL_MOCK: "mock",
    },
  },

  viewer: {
    watchPatterns: TL_WATCH_PATTERNS,
    ignorePatterns: TL_IGNORE,
    serveDir: ".",
  },

  sources: {
    // The run is film.json plus the stage files it points at, the ledger and
    // the timeline. The viewer parses them itself (viewer/model.ts) and
    // derives status with stage-state.mjs; it writes none of them.
    files: {
      kind: "file-glob",
      config: {
        patterns: TL_WATCH_PATTERNS,
        ignore: TL_IGNORE,
      },
    },
  },

  viewerApi: {
    workspace: {
      type: "all",
      multiFile: true,
      ordered: false,
      hasActiveFile: false,
      // The stage rail in the viewer's own top bar is the navigation.
      topBarNavigation: false,
    },
    actions: [
      {
        id: "navigate-to",
        label: "Show a node on the canvas",
        category: "navigate",
        agentInvocable: true,
        params: {
          address: {
            type: "object",
            description:
              'ViewerAddress: `{ "nodeId": "<stage>" }` opens that stage\'s page (e.g. `{ "nodeId": "music" }`); `{ "nodeId": "<stage>:<optionId>" }` opens it on that option (`{ "nodeId": "script:B" }`); `{ "nodeId": "version:<format>:<lang>" }` opens a version node (`{ "nodeId": "version:short-9x16:ja" }`), add `"time": <seconds>` to park its playhead; `{ "nodeId": "overview" }` fits the whole run.',
            required: true,
          },
        },
        description:
          "Put the canvas on what you are talking about: after you register options, open that stage (`{ nodeId: \"music\" }`); before you describe a scene or a cut problem, open the version at that second. An unknown stage, option or version is refused by name.",
      },
    ],
    // User → agent. `description` is the one-line hint the producer reads.
    commands: [
      {
        id: "confirm-stage",
        label: "Confirm",
        description: "Take the selected option for this stage and move on",
      },
      {
        id: "auto-run",
        label: "Auto-run to rough cut",
        description: "Take the recommended option at every stage up to the rough cut",
      },
      {
        id: "more-options",
        label: "Try more options",
        description: "Ask the director for more options at this stage",
      },
      {
        id: "countdown-expired",
        label: "Countdown expired",
        description: "A stage's countdown ran out; the recommended option is taken",
      },
    ],
  },

  agent: {
    permissionMode: "bypassPermissions",
    greeting: `<system-info pneuma-mode="Launch Studio" skill="pneuma-tanka-launch" session="new"></system-info>
The producer just opened Launch Studio. First run \`tl.mjs tick\` then \`tl.mjs status\` from your skill's scripts. If a run is in progress, say in one or two sentences where it stands (the stage it waits on, time left on its countdown, budget spent) and carry on. If there is no run yet, greet them in one sentence and ask for the idea or selling point for the video — mention that you'll show script options first and that every stage auto-advances after its countdown, up to the rough cut.`,
  },

  init: {
    contentCheckPattern: "film.json",
    // A fresh run: an empty film.json (written by the same createFilm the
    // CLI uses), the run README, a .gitignore, and the run's Remotion project.
    // `.gitignore` is listed on its own: the directory copy skips dotfiles.
    seedFiles: {
      "seed/": "./",
      "seed/.gitignore": ".gitignore",
    },
    seeds: [
      {
        id: "new-run",
        sourceKey: ["seed/", "seed/.gitignore"],
        displayName: {
          en: "New run",
          "zh-CN": "新的发布视频",
          ja: "新しいラン",
        },
        description: {
          en: "An empty run: type the idea or selling point in the chat and the director starts with three script options.",
          "zh-CN": "一个空白的运行：在对话里输入想法或卖点，导演会先给出三个脚本方案。",
          ja: "空のラン：チャットにアイデアかセールスポイントを入力すると、ディレクターが脚本案を 3 つ出します。",
        },
        tags: ["launch", "video", "remotion"],
      },
    ],
    params: [
      {
        name: "elevenLabsApiKey",
        label: "ElevenLabs API key",
        description:
          "VO, voice auditions, Video-to-Music and music composition, optional SFX. Tip: save it once in Pneuma → Settings → API Keys as ELEVENLABS_API_KEY and it fills in for every run.",
        type: "string",
        defaultValue: "",
        sensitive: true,
      },
      {
        name: "falApiKey",
        label: "fal.ai API key",
        description: "Seedance footage for scenes the asset library does not cover. Saved globally as FAL_KEY it fills in by itself.",
        type: "string",
        defaultValue: "",
        sensitive: true,
      },
      {
        name: "openrouterApiKey",
        label: "OpenRouter API key (optional)",
        description: "Image fallback when Codex / GPT Image 2 is not available.",
        type: "string",
        defaultValue: "",
        sensitive: true,
      },
      {
        name: "figmaToken",
        label: "Figma token (optional)",
        description: "Figma REST export of the product's design frames when no Figma MCP is available to the agent.",
        type: "string",
        defaultValue: "",
        sensitive: true,
      },
      {
        name: "assetRoots",
        label: "Asset folders",
        description: "Folders the asset stage searches before anything is generated, separated by semicolons.",
        type: "string",
        defaultValue: DEFAULTS.assetRoots,
      },
      {
        name: "prdRoot",
        label: "PRD folder",
        description: "Where the product requirements live; the idea stage reads selling points from here.",
        type: "string",
        defaultValue: DEFAULTS.prdRoot,
      },
      {
        name: "deliveryDir",
        label: "Delivery folder",
        description: "Finals are copied to <this folder>/<run>/ after the final OK (empty: ~/LaunchStudio/deliveries).",
        type: "string",
        defaultValue: DEFAULTS.deliveryDir,
      },
      {
        name: "budgetUsd",
        label: "Budget per run (USD)",
        description: "Paid calls stop at this cap and the director asks, even during auto-run.",
        type: "number",
        defaultValue: 60,
      },
      {
        name: "countdownMin",
        label: "Countdown per stage (minutes)",
        description: "How long a stage waits for your pick before the recommended option is taken.",
        type: "number",
        defaultValue: 30,
      },
      {
        name: "codexPath",
        label: "Codex CLI",
        description: "Used only when a stage needs new images from GPT Image 2.",
        type: "string",
        defaultValue: DEFAULTS.codexPath,
      },
      {
        name: "mock",
        label: "Mock providers",
        description: "On: no paid calls — a local voice for VO (macOS say; espeak-ng on Linux), procedural placeholder beds for music, placeholders for images and footage. For rehearsals.",
        type: "select",
        options: [
          { value: "off", label: "Off — real providers" },
          { value: "on", label: "On — local stand-ins, $0" },
        ],
        defaultValue: "off",
      },
    ],
    // Truthy flags for `{{#flag}}…{{/flag}}` sections in the skill text. The
    // installer has no inverted sections, so "missing" needs its own flag.
    deriveParams: (params) => {
      const has = (key: string) => String(params[key] ?? "").trim() !== "";
      const mockOn = /^(on|true|1|yes)$/i.test(String(params.mock ?? ""));
      return {
        ...params,
        mockEnabled: mockOn ? "true" : "",
        paidEnabled: mockOn ? "" : "true",
        elevenLabsConfigured: has("elevenLabsApiKey") ? "true" : "",
        elevenLabsMissing: has("elevenLabsApiKey") ? "" : "true",
        falConfigured: has("falApiKey") ? "true" : "",
        falMissing: has("falApiKey") ? "" : "true",
        openrouterConfigured: has("openrouterApiKey") ? "true" : "",
        figmaTokenConfigured: has("figmaToken") ? "true" : "",
      };
    },
  },

  evolution: {
    directive: `Learn how the producer makes launch videos: which script shape they pick (and which they reject),
the music palette and BPM arcs they keep, the voices they choose per language, how often they
let the countdown decide versus confirming themselves, what they change at the rough cut, and
what they spend per run. Evidence: session history, film.json (picks, who picked, notes),
the stage option files, ledger.jsonl and the rough-cut notes. Propose changes to the
skill's defaults and presets; never change a rule about the hard gate or the budget cap
without their explicit approval.`,
  },
};

export default manifest;
