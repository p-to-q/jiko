#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const serverRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultOutputDir = path.join(serverRoot, "local-clips");

const clips = [
  {
    key: "mixed.no-majority",
    text: "没有多数。"
  },
  {
    key: "minority.maintain",
    text: "两项维持。一项不同。路的另一边有信号。它还没有熄灭。"
  },
  {
    key: "minority.deviate",
    text: "两项偏离。一项不同。路的另一边有信号。它还没有熄灭。"
  },
  {
    key: "minority.static",
    text: "两项静止。一项不同。路的另一边有信号。它还没有熄灭。"
  },
  {
    key: "consensus.maintain",
    text: "太一致了。但一致不等于答案。"
  },
  {
    key: "consensus.deviate",
    text: "答案太整齐了。它们都同意，但你还在。"
  },
  {
    key: "consensus.static",
    text: "这次没有异声。系统合上了，你没有。"
  }
];

const options = parseArgs(process.argv.slice(2));
const outputDir = path.resolve(options.outputDir ?? process.env.TTS_CLIP_DIR ?? defaultOutputDir);
const command = options.command ?? process.env.TTS_GENERATE_COMMAND ?? "say";
const voice = options.voice ?? process.env.TTS_GENERATE_VOICE;
const extension = options.extension ?? process.env.TTS_GENERATE_EXTENSION ?? (command === "say" ? "aiff" : "wav");

await mkdir(outputDir, { recursive: true });

for (const clip of clips) {
  const outputPath = path.join(outputDir, `${clip.key}.${extension}`);
  const args = argsForCommand(command, clip.text, outputPath, voice);

  console.log(`generating ${path.relative(process.cwd(), outputPath)}: ${clip.text}`);
  if (command === "copy") {
    await writeFile(outputPath, `${clip.text}\n`, "utf8");
    continue;
  }

  await run(command, args, command === "piper" ? clip.text : undefined);
}

console.log(`done: ${clips.length} clips in ${outputDir}`);

function argsForCommand(commandName, text, outputPath, voiceName) {
  if (commandName === "say") {
    return [
      ...(voiceName ? ["-v", voiceName] : []),
      "-o",
      outputPath,
      text
    ];
  }

  if (commandName === "copy") {
    return [];
  }

  if (commandName === "piper") {
    const model = process.env.PIPER_VOICE;
    if (!model) {
      throw new Error("PIPER_VOICE is required when TTS_GENERATE_COMMAND=piper.");
    }

    return ["--model", model, "--output_file", outputPath];
  }

  const template = process.env.TTS_GENERATE_ARGS;
  if (!template) {
    throw new Error(`Unsupported TTS_GENERATE_COMMAND: ${commandName}. Set TTS_GENERATE_ARGS to use a custom command.`);
  }

  return template
    .split(" ")
    .filter(Boolean)
    .map((part) =>
      part
        .replaceAll("{text}", text)
        .replaceAll("{output}", outputPath)
        .replaceAll("{voice}", voiceName ?? "")
    );
}

function run(commandName, args, stdin) {
  return new Promise((resolve, reject) => {
    const child = spawn(commandName, args, {
      stdio: stdin === undefined ? "inherit" : ["pipe", "inherit", "inherit"]
    });

    if (stdin !== undefined) {
      child.stdin.end(stdin);
    }

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${commandName} exited with code ${code}`));
    });
  });
}

function parseArgs(args) {
  const result = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--") {
      continue;
    }

    if (arg === "--out") {
      result.outputDir = requireValue(args, index);
      index += 1;
      continue;
    }

    if (arg === "--command") {
      result.command = requireValue(args, index);
      index += 1;
      continue;
    }

    if (arg === "--voice") {
      result.voice = requireValue(args, index);
      index += 1;
      continue;
    }

    if (arg === "--extension") {
      result.extension = requireValue(args, index);
      index += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return result;
}

function requireValue(args, index) {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`Expected a value after ${args[index]}.`);
  }

  return value;
}

function printHelp() {
  console.log(`Usage: node apps/server/scripts/generate-local-clips.mjs [options]

Options:
  --out <dir>        Output directory. Defaults to TTS_CLIP_DIR or apps/server/local-clips.
  --command <name>   Generator command: say, piper, or copy. Defaults to say.
  --voice <name>     Voice name for macOS say.
  --extension <ext>   Output extension. Defaults to aiff for say, wav otherwise.

Examples:
  node apps/server/scripts/generate-local-clips.mjs --voice Tingting
  TTS_GENERATE_COMMAND=piper PIPER_VOICE=./voice.onnx node apps/server/scripts/generate-local-clips.mjs
  TTS_GENERATE_COMMAND=copy TTS_GENERATE_EXTENSION=txt node apps/server/scripts/generate-local-clips.mjs
  TTS_GENERATE_COMMAND=my-tts TTS_GENERATE_ARGS='--text {text} --out {output}' node apps/server/scripts/generate-local-clips.mjs
`);
}
