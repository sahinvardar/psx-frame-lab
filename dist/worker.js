importScripts("vendor/fzstd.js", "engine.js");

const MAX_FILE_SIZE = 64 * 1024 * 1024;
const MIN_CHECKPOINT_INTERVAL = 128;
const TARGET_CHECKPOINT_COUNT = 48;

let capture;
let gpu;
let checkpoints = [];
let checkpointInterval = MIN_CHECKPOINT_INTERVAL;
let enhancedReplay = null;
let renderTarget = "draw";

function serializeCommand(command) {
  const { w: words, ...metadata } = command;
  return {
    ...metadata,
    wordCount: words.length,
    raw: Array.from(words.subarray(0, 32), PSX.hex),
  };
}

function decompressDump(compressedBytes) {
  const chunks = [];
  let decompressedLength = 0;
  const decompressor = new fzstd.Decompress((chunk) => {
    decompressedLength += chunk.length;
    if (decompressedLength > MAX_FILE_SIZE) {
      throw Error("Decompressed dump exceeds 64 MB.");
    }
    chunks.push(chunk.slice());
  });

  decompressor.push(compressedBytes, true);

  const bytes = new Uint8Array(decompressedLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

function isZstandardFile(bytes) {
  return (
    bytes[0] === 0x28 &&
    bytes[1] === 0xb5 &&
    bytes[2] === 0x2f &&
    bytes[3] === 0xfd
  );
}

function postReplayState(type, details = {}) {
  let highResolutionFrame;
  if (enhancedReplay && type === "frame") {
    enhancedReplay.seek(details.n);
    highResolutionFrame = enhancedReplay.crop(renderTarget);
  }

  const pixels = gpu.rgba();
  const rawVram = gpu.vram.slice();
  postMessage(
    {
      type,
      pixels,
      raw: rawVram,
      state: PSX.clone(gpu.state),
      ...details,
      ...(highResolutionFrame ? { high: highResolutionFrame } : {}),
    },
    [pixels.buffer, rawVram.buffer],
  );
}

function replayCapture() {
  for (const command of capture.setup) {
    gpu.apply(command, true);
  }
  checkpoints.push({ at: 0, snapshot: gpu.snapshot() });

  checkpointInterval = Math.max(
    MIN_CHECKPOINT_INTERVAL,
    Math.ceil(capture.commands.length / TARGET_CHECKPOINT_COUNT),
  );

  let finalTextureVram = null;
  for (let index = 0; index < capture.commands.length; index++) {
    const command = capture.commands[index];
    if (index === capture.commands.length - 1 && command.clut) {
      finalTextureVram = gpu.vram.slice();
    }

    gpu.apply(command, true);

    if ((index + 1) % checkpointInterval === 0) {
      checkpoints.push({ at: index + 1, snapshot: gpu.snapshot() });
    }
    if (index % 256 === 0) {
      postMessage({
        type: "progress",
        text: `Replaying ${index.toLocaleString()} / ${capture.commands.length.toLocaleString()} commands…`,
      });
    }
  }
  return finalTextureVram;
}

function collectRendererWarnings() {
  const warnings = [];
  if (gpu.state.display24) {
    warnings.push(
      "24-bit display mode: frame preview uses 15-bit VRAM colors.",
    );
  }
  if (gpu.state.interlace) {
    warnings.push("Interlaced output is shown without field timing.");
  }
  return warnings;
}

function handleLoad(message) {
  let bytes = new Uint8Array(message.buffer);
  if (bytes.length > MAX_FILE_SIZE) {
    throw Error("File exceeds the 64 MB limit.");
  }
  if (isZstandardFile(bytes)) {
    bytes = decompressDump(bytes);
  }

  postMessage({ type: "progress", text: "Decoding GPU commands…" });
  enhancedReplay = null;
  capture = PSX.parse(bytes);
  gpu = new PSX.GPU();
  checkpoints = [];

  const textureRaw = replayCapture();
  postReplayState("loaded", {
    textureRaw,
    info: capture.info,
    warnings: [...capture.warnings, ...collectRendererWarnings()],
    commands: capture.commands.map(serializeCommand),
    setup: capture.setup.map(serializeCommand),
    bytes: capture.bytes,
    packets: capture.packets,
  });
}

function handleResolutionChange(message) {
  renderTarget = message.target || "draw";
  const scale = [1, 2, 4].includes(message.scale) ? message.scale : 1;
  postMessage({
    type: "progress",
    text: `Rendering at ${scale}× resolution…`,
  });

  enhancedReplay = scale > 1 ? new PSX.EnhancedReplay(capture, scale) : null;
  let finalHigh = null;
  let high = null;
  if (enhancedReplay) {
    enhancedReplay.seek(capture.commands.length);
    finalHigh = enhancedReplay.crop(renderTarget);
    enhancedReplay.seek(message.n);
    high = enhancedReplay.crop(renderTarget);
  }
  postMessage({ type: "resolution", scale, high, finalHigh });
}

function findCheckpoint(commandIndex) {
  let checkpoint = checkpoints[0];
  for (const candidate of checkpoints) {
    if (candidate.at > commandIndex) break;
    checkpoint = candidate;
  }
  return checkpoint;
}

function handleSeek(message) {
  const commandCount = capture.commands.length;
  const targetIndex = Math.max(0, Math.min(commandCount, message.n));
  const selectedCommand = capture.commands[targetIndex - 1];
  const needsTextureVram = targetIndex > 0 && selectedCommand.clut;
  const replayUntil = needsTextureVram ? targetIndex - 1 : targetIndex;
  const checkpoint = findCheckpoint(replayUntil);

  gpu.restore(checkpoint.snapshot);
  let textureRaw = null;
  for (let index = checkpoint.at; index < targetIndex; index++) {
    if (needsTextureVram && index === targetIndex - 1) {
      textureRaw = gpu.vram.slice();
    }
    gpu.apply(capture.commands[index]);
  }

  postReplayState("frame", {
    n: targetIndex,
    request: message.request,
    textureRaw,
  });
}

onmessage = async ({ data: message }) => {
  try {
    if (message.type === "load") {
      handleLoad(message);
    } else if (message.type === "resolution" && capture) {
      handleResolutionChange(message);
    } else if (message.type === "seek" && capture) {
      handleSeek(message);
    }
  } catch (error) {
    postMessage({ type: "error", text: error.message || String(error) });
  }
};
