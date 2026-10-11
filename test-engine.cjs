const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  P = require("./dist/engine.js"),
  fz = require("./dist/vendor/fzstd.js");
function cmd(w) {
  return {
    port: "GP0",
    op: w[0] >>> 24,
    w: Uint32Array.from(w),
    kind: "state",
  };
}
function make(packets, header = "PSXGPUDUMPv1\0\0") {
  const bytes = Buffer.alloc(
    header.length + packets.reduce((n, [t, w]) => n + 4 + w.length * 4, 0),
  );
  bytes.write(header, "binary");
  let p = header.length;
  for (const [t, w] of packets) {
    bytes.writeUInt32LE(((t << 24) | w.length) >>> 0, p);
    p += 4;
    for (const v of w) {
      bytes.writeUInt32LE(v >>> 0, p);
      p += 4;
    }
  }
  return new Uint8Array(bytes);
}
let b = make([
  [5, []],
  [0, [0x200000ff, 0, 4]],
  [0, [4 << 16]],
  [2, [500]],
]);
let dump = P.parse(b);
assert.equal(dump.commands.length, 2);
assert.equal(dump.commands[0].v.length, 3);
assert.equal(dump.commands[0].wordCount, undefined);
let gpu = new P.GPU();
gpu.apply(dump.commands[0]);
assert.equal(gpu.vram[1025], 31);
assert.equal(gpu.vram[1028], 0);
assert.equal(
  P.parse(
    make(
      [
        [5, []],
        [0, [0]],
        [2, [1]],
      ],
      "PSXGPUDUMPv1r1\0\0",
    ),
  ).commands.length,
  2,
);
assert.throws(() => P.parse(b.subarray(0, b.length - 1)), /Truncated/);
assert.throws(() => P.parse(new Uint8Array(20)), /supported/);
assert.throws(() => P.parse(make([[0, [0]]])), /Missing trace/);
gpu = new P.GPU();
gpu.apply(cmd([0xa0000000, 0, 2 | (1 << 16), 0x03e0001f]));
assert.deepEqual(Array.from(gpu.vram.slice(0, 2)), [31, 992]);
gpu.apply(cmd([0x80000000, 0, 10, 2 | (1 << 16)]));
assert.equal(gpu.vram[10], 31);
assert.equal(gpu.vram[11], 992);
gpu.apply(cmd([0xe6000003]));
gpu.vram[10] = 0x8001;
gpu.apply(cmd([0xa0000000, 10, 1 | (1 << 16), 31]));
assert.equal(gpu.vram[10], 0x8001);
gpu = new P.GPU();
gpu.vram[640] = 0x3210;
gpu.vram[480 * 1024 + 1] = 0x03e0;
assert.equal(gpu.tex(1, 0, { x: 640, y: 0, depth: 0 }, [0, 480]), 0x03e0);
gpu.vram[640] = 0x0504;
gpu.vram[480 * 1024 + 5] = 0x7c00;
assert.equal(gpu.tex(1, 0, { x: 640, y: 0, depth: 1 }, [0, 480]), 0x7c00);
gpu = new P.GPU();
let snap = gpu.snapshot();
gpu.vram[0] = 42;
gpu.state.area[0] = 7;
gpu.restore(snap);
assert.equal(gpu.vram[0], 0);
assert.equal(gpu.state.area[0], 0);
let file = process.argv[2];
if (file) {
  let raw = new Uint8Array(fs.readFileSync(file));
  let bytes = fz.decompress(raw);
  dump = P.parse(bytes);
  assert.equal(dump.commands.filter((c) => c.kind === "polygon").length, 2452);
  assert.equal(dump.commands.filter((c) => c.port !== "Event").length, 2478);
  let a = new P.GPU(),
    check;
  for (const c of dump.setup) a.apply(c, true);
  for (let i = 0; i < dump.commands.length; i++) {
    a.apply(dump.commands[i], true);
    if (i === 127) check = a.snapshot();
  }
  const end = a.vram.slice();
  a.restore(check);
  for (let i = 128; i < dump.commands.length; i++) a.apply(dump.commands[i]);
  assert.deepEqual(a.vram, end);
  console.log(
    "Spyro: compressed decode, 2452 polygons, 2478 GPU commands, deterministic restore/replay passed.",
  );
}
console.log(
  "Engine checks passed: both headers, split packets, malformed files, triangle coverage, uploads, copies, masks, 4/8-bit CLUTs, snapshot restore.",
);
